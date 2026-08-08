// docs.js — 知识总库·文档分区聚合（施工令-015 起）：策划案 / 调研方案 / 技术方案三个只读分区。
// 视图聚合制：文件零迁移，仍住在项目仓 Docs/SLG/** 下；这里只做「列目录 + 读正文」，
// 不写不删。缺目录不是错误——返回空清单并标 存在:false，前端照常渲空态。
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// 分区 → 根目录清单（相对项目仓）。标签用于同区内区分来源。
// 施工令-020（H92 配套）：调研从策划案里分家自立一区——策划案只剩设计文档根，
// 调研方案收「调研方案 + 竞品分析」两根；物理文件不迁移，只是展示位分家。
const DEFAULT_ZONES = {
  策划案: [
    { 根: 'Docs/SLG/策划文档', 标签: '设计' },
  ],
  调研方案: [
    { 根: 'Docs/SLG/调研方案', 标签: '调研' },
    { 根: 'Docs/SLG/竞品分析', 标签: '竞品' },
  ],
  技术方案: [
    { 根: 'Docs/SLG/技术方案', 标签: '方案' },
  ],
};

// 生效分区表。**就地改这个对象**（不重新赋值）——module.exports 导出的是它的引用，
// 换对象会让已 require 的调用方拿着旧表。
const ZONES = {};

// 分区根可配（config.文档分区）：默认值是游戏项目布局（Docs/SLG/**），换项目不必改代码。
// 段形与默认值同构：{ 分区名: [{根, 标签}] }，根相对项目仓、正斜杠；也收裸字符串根。
// 只认前端三区之名（策划案/调研方案/技术方案），没配到的分区保留默认——
// 配错一个分区不该把另外两个也弄没。
function setZones(custom) {
  for (const k of Object.keys(ZONES)) delete ZONES[k];
  const src = (custom && typeof custom === 'object' && !Array.isArray(custom)) ? custom : {};
  for (const name of Object.keys(DEFAULT_ZONES)) {
    const v = src[name];
    const defs = (Array.isArray(v) ? v : [])
      .map((d) => (typeof d === 'string' ? { 根: d, 标签: '' } : { 根: String((d || {}).根 || ''), 标签: String((d || {}).标签 || '') }))
      .filter((d) => d.根 && !d.根.includes('..')); // 越界根直接丢弃：resolve 的护栏之外再加一道
    ZONES[name] = defs.length ? defs : DEFAULT_ZONES[name];
  }
}
setZones(null); // 起手即默认表

const zones = () => Object.keys(ZONES);

// 定案分层（施工令-020）：策划案专属三组。数据层定组、前端只管画，口径单一处。
// 决策记录/ 子目录单列一组（它记的是「怎么定的」，不是设计正文）；
// 其余按 frontmatter 状态: 判——只有明写定案词才算定案，没标状态的一律草案（默认从严）。
const GROUPS = ['定案', '草案', '决策记录'];
const 定案词 = ['定案', '已定案', '正式'];
function groupOf(doc) {
  const sub = String((doc && doc.子目录) || '');
  if (sub === '决策记录' || sub.startsWith('决策记录/')) return '决策记录';
  return 定案词.includes(String((doc && doc.状态) || '').trim()) ? '定案' : '草案';
}

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
// 状态取 frontmatter.状态（施工令-020 定案分层的判据），没写就是空串 → 归草案。
function meta(abs) {
  let 标题 = path.basename(abs, '.md'), 字数 = 0, 状态 = '';
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    const g = matter(raw);
    const body = g.content || '';
    字数 = body.replace(/\s/g, '').length;
    const fmT = (g.data || {}).标题 || (g.data || {}).名称;
    if (fmT) 标题 = String(fmT);
    else { const h = body.match(/^\s*#\s+(.+)$/m); if (h) 标题 = h[1].trim(); }
    if ((g.data || {}).状态 != null) 状态 = String((g.data || {}).状态);
  } catch { /* 读不动的文件只留文件名 */ }
  let 更新时间 = null;
  try { 更新时间 = fs.statSync(abs).mtime.toISOString().slice(0, 10); } catch { /* 无 stat */ }
  return { 标题, 字数, 更新时间, 状态 };
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
        const doc = {
          rel: path.relative(projPath, f.abs).split(path.sep).join('/'),
          文件名: path.basename(f.abs),
          子目录: f.sub || '',
          标签: def.标签, 根: def.根,
          ...meta(f.abs),
        };
        if (zone === '策划案') doc.组 = groupOf(doc); // 定案分层只给策划案定组，别区不带这个字段
        文档.push(doc);
        n++;
      }
    }
    根.push({ 根: def.根, 标签: def.标签, 存在, 数量: n });
  }
  文档.sort((a, b) => a.根.localeCompare(b.根) || a.子目录.localeCompare(b.子目录) || a.文件名.localeCompare(b.文件名, 'zh'));
  return { 区: zone, 根, 文档 };
}

// 路径推导：rel 必须落在本分区某个根之内且是 .md——越界（../ 逃逸、跨分区、非 md）一律 null。
// 只算路径不碰磁盘，read 与 codoc（施工令-017）共用这一处，越界口径永远一致。
function resolve(projPath, zone, rel) {
  const defs = ZONES[zone];
  if (!defs || !projPath) return null;
  const r = String(rel || '');
  if (!r || !r.toLowerCase().endsWith('.md')) return null;
  const abs = path.resolve(projPath, r);
  const def = defs.find((d) => {
    const base = path.resolve(projPath, ...d.根.split('/'));
    return abs === base || abs.toLowerCase().startsWith(base.toLowerCase() + path.sep);
  });
  if (!def) return null;
  return { abs, def, rel: path.relative(path.resolve(projPath), abs).split(path.sep).join('/') };
}

// 读单篇：路径经 resolve 把关，读不动/不是文件一律 null。
function read(projPath, zone, rel) {
  const hit = resolve(projPath, zone, rel);
  if (!hit) return null;
  const { abs, def } = hit;
  let raw;
  try { if (!fs.statSync(abs).isFile()) return null; raw = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const g = matter(raw);
  return {
    区: zone, rel: abs.split(path.sep).join('/').slice(path.resolve(projPath).split(path.sep).join('/').length + 1),
    文件名: path.basename(abs), 标签: def ? def.标签 : null, 根: def ? def.根 : null,
    fm: g.data || {}, body: g.content || '', ...meta(abs),
  };
}

module.exports = { ZONES, DEFAULT_ZONES, setZones, GROUPS, zones, groupOf, list, read, resolve };
