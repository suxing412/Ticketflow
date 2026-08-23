// core/store.js — 目录即状态机（D19）。一张工单 = 恰好住在一个状态目录里的 .md 文件，
// 它所在的目录就是它的状态。改状态 = 目录间原子改名（fs.renameSync，同卷原子）。
// 领单竞态靠改名的原子性兜底：两个 agent 同抢，第二个的源文件已不在 → ENOENT → 领单失败。
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// 状态全集与合法转移（H108 三大态状态机，2026-08-24 制作人拍板取代十态；边表逐边溯源旧边）。
// 目录名即状态名。大态是分组视图不是目录——账上只有 12 个细分态。
const STATES = [
  '待审', '待派', '待处理', '待重派',        // 待办态
  '在途', '初检', '核查', '仲裁', '完成',    // 在途态（完成=出口驻留位：判官全过，停在验收闸前等专项级验收）
  '归档', '挂起', '废弃',                    // 结束态（挂起是唯一可逆终态；删除不存在）
];
const 大态 = { 待办: ['待审', '待派', '待处理', '待重派'], 在途: ['在途', '初检', '核查', '仲裁', '完成'], 结束: ['归档', '挂起', '废弃'] };
const 大态of = (s) => (大态.待办.includes(s) ? '待办' : 大态.在途.includes(s) ? '在途' : 大态.结束.includes(s) ? '结束' : null);
const TERMINAL = ['归档', '废弃'];   // 挂起可逆（唯一出边→待重派），不算真终态；完成不是终态
// 边表（每条注明旧边来源；DS-1/CX-3 两轮外审后补全封闭性）：
const TRANSITIONS = {
  待审: ['待派', '废弃'],                       // 总监审过→待派〔原 草稿→待投〕；废弃
  待派: ['在途', '待审', '废弃', '挂起'],        // 项管闸派发〔原 池→在途 + 待投→在途〕；退回改〔原 待投→草稿〕；废弃；挂起
  待处理: ['待重派', '待审', '完成', '废弃'],   // +完成：定夺「接受」出路（原 待定夺→待验收）            // 分诊回队〔原 执行失败→池〕；返修重拆〔原 H65 执行失败→草稿〕；废弃
  待重派: ['在途', '废弃', '挂起'],              // 重派（带重投标记）；废弃；挂起
  在途: ['初检', '核查', '完成', '待派', '待处理', '废弃', '挂起'], // QA开交产出→初检〔原 在途→质检〕；QA关简检→核查；免检保留单→完成〔原 在途→待验收〕；收回→待派〔原 在途→池〕；执行失败→待处理〔原 在途→执行失败〕；废弃；挂起
  初检: ['核查', '在途', '待处理', '废弃'],      // 过→核查；自修→在途〔原 质检→在途〕；三振→待处理〔原 质检→待定夺〕；废弃
  核查: ['完成', '仲裁', '在途', '待处理', '废弃'], // 过→完成〔原 质检→待验收〕；争议→仲裁；打回自修→在途；上交→待处理；废弃
  仲裁: ['完成', '待处理', '在途', '废弃'],      // 裁过→完成；裁不了上呈→待处理〔原→待定夺〕；打回→在途；废弃
  完成: ['归档', '待重派', '待审'],              // 专项验收过级联→归档〔原 完成→已归档〕；验收不过→待重派〔DS-1 补边〕；同号返修→待审〔原 待验收→草稿，H65〕
  挂起: ['待重派'],                             // 复活（人闸：制作人/总监专权；重投/推迟计数不清零，挂起不算重投）
  归档: [],
  废弃: [],
};

// 移动后钩子（P2 触发链的底座，CX-9）：所有目录迁移的唯一中心是 move()，钩子挂在这儿
// 保证「任何三大态切换」都有事件出口。挂接方注册回调；钩子失败绝不打断转移本身。
const 移动钩子 = [];
function on移动(fn) { if (typeof fn === 'function') 移动钩子.push(fn); }
function 触移动(ev) { for (const f of 移动钩子) { try { f(ev); } catch { /* 钩子炸了不还手 */ } } }
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

// Q20 状态目录互斥哨兵的**取证半边**（案源 2026-08-18 伪单事故：制作人往「在途」目录里
// 追加内容造出一张幻影单，同号在两个状态目录各住一份；派发引擎照单派 QA 去审那张近乎空的单，
// 无判词、无限重试约 61 轮 ≈ 117 万 token）。
// 病根在 find()：它按 STATES 顺序返回**第一命中**，同号双态时静默挑一个，链路全程无人喊停。
// 本函数只报事实——纯读、不写、不抛（目录缺失按空算）；熔断与急件在 lib/sentinel.js。
// 返回 [{ id, 状态: ['在途','完成'] }]，按单号排序；无冲突返回 []。
function 双态(root) {
  const 表 = new Map();
  for (const s of STATES) {
    let files;
    try { files = fs.readdirSync(stateDir(root, s)); } catch { continue; } // 目录不存在=该状态无单
    for (const f of files) {
      if (!f.endsWith('.md')) continue; // .claiming 抢占中间态不算（move 的原子占位）
      const id = f.replace(/\.md$/, '');
      if (!表.has(id)) 表.set(id, []);
      表.get(id).push(s);
    }
  }
  const out = [];
  for (const [id, 状态] of 表) if (状态.length > 1) out.push({ id, 状态 });
  return out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
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
    触移动({ id, from, to, 大态from: 大态of(from), 大态to: 大态of(to), t: fm.更新时间 });
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

// 新建单。H108 后入口态=待审（切完单等总监审核）；opts.初始态 允许指定（返工/工具用），
// 但只认 STATES 里的合法态——不许借这个口子造野目录。
function create(root, id, fm, body, opts = {}) {
  const 初 = opts.初始态 && STATES.includes(opts.初始态) ? opts.初始态 : '待审';
  const dst = ticketPath(root, 初, id);
  if (fs.existsSync(dst) || find(root, id)) return { ok: false, error: `编号已存在：${id}` };
  fs.mkdirSync(stateDir(root, 初), { recursive: true });
  fs.writeFileSync(dst, serialize(fm, body || ''), 'utf8');
  return { ok: true, id, state: 初, file: dst };
}

module.exports = {
  STATES, TERMINAL, TRANSITIONS,
  stateDir, ticketPath, ensureDirs, parse, serialize,
  find, list, snapshot, isLegal, move, update, create, 双态,
  大态, 大态of, on移动,
};
