// wiki（0.20，H52 第三类实体）：游戏设计事实源——词条常青、无状态机、靠双链组网。
// 存放在项目仓 Docs/wiki/**/*.md（明文即事实源，git 可审计）；_待审/ 是 agent 提案区，
// 入册/退回是制作人人闸。与工单互链：frontmatter.来源工单 回指，锚号联动走 D36。
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const DIR = (projPath) => path.join(projPath, 'Docs', 'wiki');
const PENDING = '_待审';

function ensure(projPath) {
  fs.mkdirSync(path.join(DIR(projPath), PENDING), { recursive: true });
}

function walk(dir, out, base) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== PENDING) walk(p, out, base); continue; }
    if (!d.name.endsWith('.md')) continue;
    out.push({ file: p, rel: path.relative(base, p) });
  }
  return out;
}

const LINK_RE = /\[\[([^\]|#]+?)(?:\|[^\]]*)?\]\]/g;

// 源文档字段归一（施工令-015）：frontmatter 可写 `源文档: a.md`、逗号/顿号分隔的一行、
// 或 YAML 数组。统一吐字符串数组（相对项目仓的路径），无则空数组。
function srcDocs(fm) {
  const v = fm.源文档;
  if (v == null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,，、；;]/);
  return [...new Set(arr.map((x) => String(x).trim().replace(/\\/g, '/')).filter(Boolean))];
}

// 全量索引：条目 + 双链图 + 反向链接。条目名 = frontmatter.名称 || 文件名。
function scan(projPath) {
  ensure(projPath);
  const base = DIR(projPath);
  const files = walk(base, [], base);
  const entries = [];
  for (const f of files) {
    let fm = {}, body = '';
    try { const g = matter(fs.readFileSync(f.file, 'utf8')); fm = g.data || {}; body = g.content || ''; } catch { continue; }
    const 名称 = String(fm.名称 || path.basename(f.file, '.md'));
    const links = [...new Set([...body.matchAll(LINK_RE)].map((m) => m[1].trim()))];
    entries.push({
      名称, 分类: fm.分类 || path.dirname(f.rel).split(path.sep)[0] || '未分类',
      状态: fm.状态 || '正式', 锚号: fm.锚号 || null, 来源工单: fm.来源工单 || null,
      // 源文档（施工令-015）：词条从哪篇策划案/技术方案提炼而来——溯源链。
      // 可写成单值或多值；一律归一为数组，前端逐条给链接。
      源文档: srcDocs(fm),
      更新时间: fm.更新时间 || null, rel: f.rel, links,
      字数: body.replace(/\s/g, '').length,
    });
  }
  const byName = Object.fromEntries(entries.map((e) => [e.名称, e]));
  for (const e of entries) e.backlinks = entries.filter((o) => o !== e && o.links.includes(e.名称)).map((o) => o.名称);
  return { entries, byName };
}

function readEntry(projPath, 名称) {
  const { entries } = scan(projPath);
  const e = entries.find((x) => x.名称 === 名称);
  if (!e) return null;
  const g = matter(fs.readFileSync(path.join(DIR(projPath), e.rel), 'utf8'));
  return { ...e, fm: g.data, body: g.content };
}

function pending(projPath) {
  ensure(projPath);
  const dir = path.join(DIR(projPath), PENDING);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const g = matter(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { 文件: f, 名称: String(g.data.名称 || f.replace(/\.md$/, '')), 分类: g.data.分类 || '未分类', 来源工单: g.data.来源工单 || null, 字数: (g.content || '').replace(/\s/g, '').length };
  });
}

// 入册（人闸）：待审 → 正式条目，落对应分类目录；同名已存在则拒（防覆盖，改名或先删）。
function approve(projPath, 文件) {
  const src = path.join(DIR(projPath), PENDING, 文件);
  if (!fs.existsSync(src)) return { ok: false, error: '待审稿不存在：' + 文件 };
  const g = matter(fs.readFileSync(src, 'utf8'));
  const 名称 = String(g.data.名称 || 文件.replace(/\.md$/, ''));
  const 分类 = String(g.data.分类 || '未分类');
  const destDir = path.join(DIR(projPath), 分类);
  const dest = path.join(destDir, `${名称}.md`);
  if (fs.existsSync(dest)) return { ok: false, error: `正式区已有同名条目「${名称}」——改名或先处置旧条目` };
  fs.mkdirSync(destDir, { recursive: true });
  g.data.状态 = '正式';
  g.data.更新时间 = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dest, matter.stringify(g.content, g.data), 'utf8');
  fs.unlinkSync(src);
  return { ok: true, 名称, 分类 };
}

// 退回（人闸）：删除待审稿（agent 的提案不入史，理由由调用方记 journal）。
function reject(projPath, 文件) {
  const src = path.join(DIR(projPath), PENDING, 文件);
  if (!fs.existsSync(src)) return { ok: false, error: '待审稿不存在：' + 文件 };
  fs.unlinkSync(src);
  return { ok: true };
}

// 关系图数据：节点=条目（分类着色），边=双链（含指向未建条目的“虚位”节点）。
function graph(projPath) {
  const { entries, byName } = scan(projPath);
  const nodes = entries.map((e) => ({ id: e.名称, 分类: e.分类, 状态: e.状态, 度: e.links.length + e.backlinks.length }));
  const ghost = new Set();
  const edges = [];
  for (const e of entries) for (const to of e.links) {
    if (!byName[to]) ghost.add(to);
    edges.push({ from: e.名称, to });
  }
  for (const g of ghost) nodes.push({ id: g, 分类: '未建', 状态: '虚位', 度: 1 });
  return { nodes, edges };
}

module.exports = { DIR, PENDING, scan, readEntry, pending, approve, reject, graph };
