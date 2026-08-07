// codoc.js — 协同策划文档（施工令-017）：`*.codoc.md` 的块级解析 / 序列化 / 增删改移 / 存盘即页史。
// 格式：正文是普通 markdown，块与块之间用 HTML 注释当元数据分隔线：
//   <!--blk id=b12 作者=制作人 时=2026-08-07T15:00:00.000Z-->
// 块 = 一段 / 一表 / 一节，粒度由写的人定。容错第一条：无元数据的整段视作单块（作者=未知），
// 于是任何一篇普通 .codoc.md 都能被读进来编辑，不需要先「转格式」。
// 写盘只碰这一个文件，git 也只提交这一个文件（路径限定 commit），绝不替别人的脏改动背书。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const docs = require('./docs');

const 作者集 = ['制作人', '总监', '策划'];
const 未知 = '未知';
const 后缀 = '.codoc.md';

const isCodoc = (rel) => String(rel || '').toLowerCase().endsWith(后缀);
// 作者归一：不在名单里的一律落 未知，色带才有确定的三档 + 兜底。
const 归一作者 = (a) => (作者集.includes(String(a || '').trim()) ? String(a).trim() : 未知);

// ---- 解析 ----
const 分隔行 = /^<!--\s*blk\b([\s\S]*?)-->$/;
// 属性写法宽松：key=值（值到空格为止）或 key="含空格的值"，缺项不报错。
function 拆属性(s) {
  const out = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|[^\s]*)/g;
  let m;
  while ((m = re.exec(String(s || '')))) out[m[1]] = m[3] !== undefined ? m[3] : m[2];
  return out;
}
const 去空边 = (lines) => {
  const a = lines.slice();
  while (a.length && !a[0].trim()) a.shift();
  while (a.length && !a[a.length - 1].trim()) a.pop();
  return a.join('\n');
};

// parse(raw) → { 前言, 块: [{ id, 作者, 时, 文本 }] }
// 前言 = frontmatter 原文（含 --- 围栏），原样保留、原样吐回，本模块不解释它。
// id 缺失或撞车一律就地补发新号，保证块 id 在一篇内唯一——否则「改 b3」会打中两块。
function parse(raw) {
  const src = String(raw == null ? '' : raw).replace(/\r\n/g, '\n');
  let 前言 = '', body = src;
  const fm = src.match(/^---\n[\s\S]*?\n---\n?/);
  if (fm) { 前言 = fm[0]; body = src.slice(fm[0].length); }

  const 段 = []; // { 元: attrs|null, 行: [] }
  let 当前 = { 元: null, 行: [] };
  for (const line of body.split('\n')) {
    const m = line.trim().match(分隔行);
    if (m) { 段.push(当前); 当前 = { 元: 拆属性(m[1]), 行: [] }; continue; }
    当前.行.push(line);
  }
  段.push(当前);

  // 先把文件里写明的 id 全收进占位表，再给缺号的补发——否则后文的 id=b1 会和前面刚补发的 b1 撞车。
  const 实=段.filter((s)=>去空边(s.行));
  const 用过 = new Set(实.map((s) => String((s.元 && s.元.id) || '').trim()).filter(Boolean));
  const 已发 = new Set();
  let 序 = 0;
  const 发号 = () => { do { 序 += 1; } while (用过.has('b' + 序)); 用过.add('b' + 序); return 'b' + 序; };
  const 块 = [];
  for (const s of 实) {
    const 文本 = 去空边(s.行);
    let id = String((s.元 && s.元.id) || '').trim();
    if (!id || 已发.has(id)) id = 发号(); else 已发.add(id); // 重复 id 后来者让位，第一处保留原号
    块.push({
      id,
      作者: 归一作者(s.元 && (s.元.作者 || s.元.author)),
      时: String((s.元 && (s.元.时 || s.元.time)) || '') || null,
      文本,
    });
  }
  return { 前言, 块 };
}

// serialize(doc) → 文本。每块前置一行元数据；时/作者缺就不写那一项，别造假戳。
function serialize(doc) {
  const 前言 = String((doc && doc.前言) || '');
  const 块 = (doc && doc.块) || [];
  const 体 = 块.map((b) => {
    const 元 = ['id=' + b.id, '作者=' + 归一作者(b.作者)];
    if (b.时) 元.push('时=' + b.时);
    return `<!--blk ${元.join(' ')}-->\n${String(b.文本 == null ? '' : b.文本).replace(/\r\n/g, '\n').trim()}\n`;
  }).join('\n');
  return 前言 + 体;
}

// ---- 块操作 ----
// op = { 动作: 改|增|删|移, id, 文本, 锚, 位: 前|后, 方向: 上|下 }，作者由调用方钉死。
// 返回 { ok, doc, id, error }；任何一步失败都不改原 doc（就地改的是副本）。
function apply(doc, op, 作者) {
  const a = 归一作者(作者);
  const 时 = new Date().toISOString();
  const 块 = ((doc && doc.块) || []).map((b) => ({ ...b }));
  const d = { 前言: (doc && doc.前言) || '', 块 };
  const 动作 = String((op && op.动作) || '').trim();
  const 找 = (id) => 块.findIndex((b) => b.id === String(id || ''));

  if (动作 === '改') {
    const i = 找(op.id);
    if (i < 0) return { ok: false, error: '块不存在：' + op.id };
    const t = String(op.文本 == null ? '' : op.文本).trim();
    if (!t) return { ok: false, error: '改成空块请用「删」——空块不留在正本里' };
    块[i] = { ...块[i], 文本: t, 作者: a, 时 };
    return { ok: true, doc: d, id: 块[i].id };
  }
  if (动作 === '增') {
    const t = String(op.文本 == null ? '' : op.文本).trim();
    if (!t) return { ok: false, error: '新块正文不能为空' };
    const 用过 = new Set(块.map((b) => b.id));
    let n = 块.length + 1;
    while (用过.has('b' + n)) n += 1;
    const 新 = { id: 'b' + n, 作者: a, 时, 文本: t };
    const 锚 = String(op.锚 || '').trim();
    if (!锚) 块.push(新);
    else {
      const i = 找(锚);
      if (i < 0) return { ok: false, error: '锚块不存在：' + 锚 };
      块.splice(op.位 === '前' ? i : i + 1, 0, 新);
    }
    return { ok: true, doc: d, id: 新.id };
  }
  if (动作 === '删') {
    const i = 找(op.id);
    if (i < 0) return { ok: false, error: '块不存在：' + op.id };
    if (块.length <= 1) return { ok: false, error: '这是最后一块——删空等于删文档，请直接删文件' };
    块.splice(i, 1);
    return { ok: true, doc: d, id: String(op.id) };
  }
  if (动作 === '移') {
    const i = 找(op.id);
    if (i < 0) return { ok: false, error: '块不存在：' + op.id };
    const j = op.方向 === '上' ? i - 1 : i + 1;
    if (j < 0 || j >= 块.length) return { ok: false, error: '已经到头了' };
    const [x] = 块.splice(i, 1);
    块.splice(j, 0, x);
    return { ok: true, doc: d, id: x.id };
  }
  return { ok: false, error: '未知动作：' + 动作 + '（改/增/删/移）' };
}

// ---- 读 / 存 ----
// 路径推导复用 docs.resolve（同一套分区与越界口径），再加一道 .codoc.md 门槛。
function 定位(projPath, zone, rel) {
  const hit = docs.resolve(projPath, zone, rel);
  if (!hit || !isCodoc(hit.rel)) return null;
  return hit;
}

function read(projPath, zone, rel) {
  const hit = 定位(projPath, zone, rel);
  if (!hit) return null;
  let raw;
  try { if (!fs.statSync(hit.abs).isFile()) return null; raw = fs.readFileSync(hit.abs, 'utf8'); } catch { return null; }
  const doc = parse(raw);
  let 标题 = path.basename(hit.abs).replace(/\.codoc\.md$/i, '');
  const h = doc.块.map((b) => b.文本).join('\n').match(/^\s*#\s+(.+)$/m);
  if (h) 标题 = h[1].trim();
  let 更新时间 = null;
  try { 更新时间 = fs.statSync(hit.abs).mtime.toISOString().slice(0, 10); } catch { /* 无 stat */ }
  return {
    区: zone, rel: hit.rel, 文件名: path.basename(hit.abs), 标签: hit.def.标签, 根: hit.def.根,
    标题, 更新时间, 前言: doc.前言, 块: doc.块,
    字数: doc.块.reduce((n, b) => n + b.文本.replace(/\s/g, '').length, 0),
  };
}

// git 只碰这一个文件：add -- <rel> 后 commit -- <rel>（路径限定，仓里别的脏改动不会被捎带）。
// 失败不阻塞保存——文件已经落盘，git 出事只回警示字段，由 UI 明示。
function gitCommit(projPath, rel, 作者) {
  // stderr 走 pipe 不走 inherit：git 的告警（换行符转换等）不该喷到监制台控制台，出错时从 e.stderr 取。
  const run = (args) => execFileSync('git', ['-C', projPath, ...args],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const 短 = (e) => String((e && (e.stderr || e.message)) || e).trim().split('\n')[0].slice(0, 200);
  try { run(['rev-parse', '--is-inside-work-tree']); } catch (e) { return { 提交: null, 警示: '项目仓不是 git 工作区，已存盘但无页史：' + 短(e) }; }
  try {
    run(['add', '--', rel]);
    try { run(['diff', '--cached', '--quiet', '--', rel]); return { 提交: null, 警示: null, 无变更: true }; } catch { /* 有变更，继续提交 */ }
    run(['commit', '-m', `协同文档 ${path.basename(rel)} · ${归一作者(作者)}编辑`, '--', rel]);
    let sha = null;
    try { sha = run(['rev-parse', '--short', 'HEAD']).trim(); } catch { /* 拿不到短号不算失败 */ }
    return { 提交: sha, 警示: null };
  } catch (e) { return { 提交: null, 警示: 'git 提交失败（内容已存盘）：' + 短(e) }; }
}

// save：序列化 → 写盘 → git。写盘失败才算失败，git 失败只是警示。
function save(projPath, zone, rel, doc, 作者) {
  const hit = 定位(projPath, zone, rel);
  if (!hit) return { ok: false, error: '文档不在本分区范围内，或不是 .codoc.md' };
  const text = serialize(doc);
  try {
    fs.mkdirSync(path.dirname(hit.abs), { recursive: true });
    fs.writeFileSync(hit.abs, text, 'utf8');
  } catch (e) { return { ok: false, error: '写盘失败：' + (e.message || String(e)) }; }
  const g = gitCommit(projPath, hit.rel, 作者);
  return { ok: true, rel: hit.rel, 提交: g.提交, 警示: g.警示, 无变更: !!g.无变更 };
}

// 一次成型：读 → 改 → 存。UI 的唯一写入口，作者一律由调用方钉死。
function edit(projPath, zone, rel, op, 作者) {
  const cur = read(projPath, zone, rel);
  if (!cur) return { ok: false, error: '文档不存在或不在本分区范围内' };
  const r = apply({ 前言: cur.前言, 块: cur.块 }, op, 作者);
  if (!r.ok) return r;
  const s = save(projPath, zone, rel, r.doc, 作者);
  if (!s.ok) return s;
  return { ...s, id: r.id, 块: read(projPath, zone, rel).块 };
}

module.exports = { 作者集, 未知, 后缀, isCodoc, parse, serialize, apply, read, save, edit };
