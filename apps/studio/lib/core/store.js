// core/store.js — 目录即状态机（D19）。一张工单 = 恰好住在一个状态目录里的 .md 文件，
// 它所在的目录就是它的状态。改状态 = 目录间原子改名（fs.renameSync，同卷原子）。
// 领单竞态靠改名的原子性兜底：两个 agent 同抢，第二个的源文件已不在 → ENOENT → 领单失败。
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// 状态全集与合法转移（D13 状态机 + D31 执行失败态）。目录名即状态名。
const STATES = ['草稿', '待投', '池', '在途', '质检', '待验收', '待定夺', '执行失败', '完成', '已归档'];
const TERMINAL = ['完成', '已归档'];
const TRANSITIONS = {
  草稿: ['待投', '已归档'],                 // 定稿→待投；废弃
  待投: ['池', '草稿', '已归档'],           // 投池释放；退回改；废弃
  池: ['在途', '待投', '草稿', '已归档'],   // 领单；撤回；废弃
  在途: ['质检', '待验收', '池', '执行失败', '已归档'], // 交产出；收回退池；执行失败(D31 本地入位)；废弃
  质检: ['待验收', '在途', '待定夺', '执行失败', '已归档'], // QA过；自修；修不好上交；QA执行失败
  待定夺: ['待验收', '在途', '已归档'],     // 接受→待验收；给方向→在途；打回→归档(+新单)
  执行失败: ['池', '待定夺', '已归档'],     // D31 分诊三出路：重投；上呈用户；废弃
  待验收: ['完成', '已归档'],               // 通过→完成；不过→归档(+新单)
  完成: [],
  已归档: [],
};

function stateDir(root, state) { return path.join(root, state); }
function ticketPath(root, state, id) { return path.join(stateDir(root, state), `${id}.md`); }

function ensureDirs(root) {
  for (const s of STATES) fs.mkdirSync(stateDir(root, s), { recursive: true });
  fs.mkdirSync(path.join(root, '回执'), { recursive: true });
  fs.mkdirSync(path.join(root, 'journal'), { recursive: true });
}

function parse(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const g = matter(raw);
  return { fm: g.data, body: g.content, raw };
}

function serialize(fm, body) {
  // 剔除 undefined 值：js-yaml 对 undefined 直接抛异常——手写工单缺字段（如 更新时间）
  // 曾在 finishOk 的 store.update 里炸掉整个主进程（0.9.1 实测，用户截图在案）。
  // 明文即事实源 = 用户会手写工单，序列化必须容忍字段缺失。
  const clean = {};
  for (const [k, v] of Object.entries(fm || {})) if (v !== undefined) clean[k] = v;
  return matter.stringify(body || '', clean);
}

// 扫描全部状态目录，定位一张单。返回 { id, state, file, fm, body } 或 null。
function find(root, id) {
  for (const state of STATES) {
    const file = ticketPath(root, state, id);
    if (fs.existsSync(file)) {
      const { fm, body } = parse(file);
      return { id, state, file, fm, body };
    }
  }
  return null;
}

// 列一个状态目录里的所有单（已解析）。
function list(root, state) {
  const dir = stateDir(root, state);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const id = f.replace(/\.md$/, '');
    const { fm, body } = parse(path.join(dir, f));
    return { id, state, file: path.join(dir, f), fm, body };
  });
}

// 全库快照：每个状态 → 单列表。
function snapshot(root) {
  const out = {};
  for (const s of STATES) out[s] = list(root, s);
  return out;
}

function isLegal(from, to) {
  return TRANSITIONS[from] && TRANSITIONS[from].includes(to);
}

// 状态转移：校验合法性 → 更新 frontmatter（updated + mutator）→ 原子改名到目标目录。
// mutator(fm) 可改 frontmatter（如写入 主办/领单时间）。返回 { ok, id, from, to, file } 或 { ok:false, error }。
// 原子性：目标已存在则拒绝；源不存在（已被并发移走）→ ENOENT → { ok:false, error:'源不存在（已被抢走或已流转）' }。
function move(root, id, from, to, mutator, nowIso) {
  if (!STATES.includes(to)) return { ok: false, error: `非法目标状态：${to}` };
  if (!isLegal(from, to)) return { ok: false, error: `不合法的转移：${from} → ${to}` };
  const src = ticketPath(root, from, id);
  const dst = ticketPath(root, to, id);
  if (fs.existsSync(dst)) return { ok: false, error: `目标已存在同名单：${to}/${id}` };
  let parsed;
  try { parsed = parse(src); } catch { return { ok: false, error: '源不存在（已被抢走或已流转）' }; }
  const fm = { ...parsed.fm, 更新时间: nowIso || parsed.fm.更新时间 || new Date().toISOString() };
  if (mutator) mutator(fm);
  // 先写目标（带更新后的 fm），再删源；用 rename 保证原子——但要先落盘更新的 fm。
  // 策略：把更新后的内容写进目标临时文件，再 rename 源→占位、目标 tmp→目标，最后删源。
  // 简化且保持原子领单语义：用 renameSync 抢占源（原子），成功后再改写内容。
  const claimTmp = src + '.claiming';
  try {
    fs.renameSync(src, claimTmp); // 原子抢占：并发者第二个会 ENOENT
  } catch {
    return { ok: false, error: '源不存在（已被抢走或已流转）' };
  }
  try {
    fs.writeFileSync(dst, serialize(fm, parsed.body), 'utf8');
    fs.unlinkSync(claimTmp);
    return { ok: true, id, from, to, file: dst };
  } catch (e) {
    // 回滚抢占
    try { fs.renameSync(claimTmp, src); } catch { /* 尽力 */ }
    return { ok: false, error: '写目标失败：' + e.message };
  }
}

// 原地改 frontmatter（不换状态），如用户在起草页编辑草稿。
function update(root, id, mutator, nowIso) {
  const t = find(root, id);
  if (!t) return { ok: false, error: '工单不存在' };
  const fm = { ...t.fm, 更新时间: nowIso || t.fm.更新时间 || new Date().toISOString() };
  let body = t.body;
  const res = mutator(fm, t);
  if (res && typeof res.body === 'string') body = res.body;
  fs.writeFileSync(t.file, serialize(fm, body), 'utf8');
  return { ok: true, id, state: t.state };
}

// 新建草稿单。
function create(root, id, fm, body) {
  const dst = ticketPath(root, '草稿', id);
  if (fs.existsSync(dst) || find(root, id)) return { ok: false, error: `编号已存在：${id}` };
  fs.mkdirSync(stateDir(root, '草稿'), { recursive: true });
  fs.writeFileSync(dst, serialize(fm, body || ''), 'utf8');
  return { ok: true, id, state: '草稿', file: dst };
}

module.exports = {
  STATES, TERMINAL, TRANSITIONS,
  stateDir, ticketPath, ensureDirs, parse, serialize,
  find, list, snapshot, isLegal, move, update, create,
};
