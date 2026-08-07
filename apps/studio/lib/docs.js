// docs.js — 知识总库·文档分区聚合（施工令-015）：策划案 / 技术方案两个只读分区。
// 视图聚合制：文件零迁移，仍住在项目仓 Docs/SLG/** 下；这里只做「列目录 + 读正文」，
// 不写不删。缺目录不是错误——返回空清单并标 存在:false，前端照常渲空态。
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// 分区 → 根目录清单（相对项目仓）。标签用于同区内区分来源（H89：调研也是策划产出，同区展示）。
const ZONES = {
  策划案: [
    { 根: 'Docs/SLG/策划文档', 标签: '设计' },
    { 根: 'Docs/SLG/竞品分析', 标签: '调研' },
  ],
  技术方案: [
    { 根: 'Docs/SLG/技术方案', 标签: '方案' },
  ],
};

const zones = () => Object.keys(ZONES);

function walk(dir, out, base, depth) {
  if (depth > 6) return out; // 防软链/异常深树
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { walk(p, out, base, depth + 1); continue; }
    if (!d.name.toLowerCase().endsWith('.md')) continue;
    out.push({ abs: p, sub: path.relative(base, path.dirname(p)).split(path.sep).filter(Boolean).join('/') });
  }
  return out;
}

// 单篇元信息：标题取 frontmatter.标题/名称 → 首个 # 一级标题 → 文件名。
function meta(abs) {
  let 标题 = path.basename(abs, '.md'), 字数 = 0;
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    const g = matter(raw);
    const body = g.content || '';
    字数 = body.replace(/\s/g, '').length;
    const fmT = (g.data || {}).标题 || (g.data || {}).名称;
    if (fmT) 标题 = String(fmT);
    else { const h = body.match(/^\s*#\s+(.+)$/m); if (h) 标题 = h[1].trim(); }
  } catch { /* 读不动的文件只留文件名 */ }
  let 更新时间 = null;
  try { 更新时间 = fs.statSync(abs).mtime.toISOString().slice(0, 10); } catch { /* 无 stat */ }
  return { 标题, 字数, 更新时间 };
}

// 分区清单：根逐个扫（缺目录容错），文档 rel 一律相对项目仓、正斜杠。
function list(projPath, zone) {
  const defs = ZONES[zone];
  if (!defs) return null;
  const 根 = [];
  const 文档 = [];
  for (const def of defs) {
    const base = path.join(projPath || '', ...def.根.split('/'));
    const 存在 = (() => { try { return fs.statSync(base).isDirectory(); } catch { return false; } })();
    let n = 0;
    if (存在) {
      for (const f of walk(base, [], base, 0)) {
        文档.push({
          rel: path.relative(projPath, f.abs).split(path.sep).join('/'),
          文件名: path.basename(f.abs),
          子目录: f.sub || '',
          标签: def.标签, 根: def.根,
          ...meta(f.abs),
        });
        n++;
      }
    }
    根.push({ 根: def.根, 标签: def.标签, 存在, 数量: n });
  }
  文档.sort((a, b) => a.根.localeCompare(b.根) || a.子目录.localeCompare(b.子目录) || a.文件名.localeCompare(b.文件名, 'zh'));
  return { 区: zone, 根, 文档 };
}

// 读单篇：rel 必须落在本分区某个根之内且是 .md——越界（../ 逃逸、非 md）一律拒。
function read(projPath, zone, rel) {
  const defs = ZONES[zone];
  if (!defs || !projPath) return null;
  const r = String(rel || '');
  if (!r || !r.toLowerCase().endsWith('.md')) return null;
  const abs = path.resolve(projPath, r);
  const inside = defs.some((def) => {
    const base = path.resolve(projPath, ...def.根.split('/'));
    return abs === base || abs.toLowerCase().startsWith(base.toLowerCase() + path.sep);
  });
  if (!inside) return null;
  let raw;
  try { if (!fs.statSync(abs).isFile()) return null; raw = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const g = matter(raw);
  const def = defs.find((d) => path.resolve(projPath, ...d.根.split('/')) === abs
    || abs.toLowerCase().startsWith(path.resolve(projPath, ...d.根.split('/')).toLowerCase() + path.sep));
  return {
    区: zone, rel: abs.split(path.sep).join('/').slice(path.resolve(projPath).split(path.sep).join('/').length + 1),
    文件名: path.basename(abs), 标签: def ? def.标签 : null, 根: def ? def.根 : null,
    fm: g.data || {}, body: g.content || '', ...meta(abs),
  };
}

module.exports = { ZONES, zones, list, read };
