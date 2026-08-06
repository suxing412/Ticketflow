// pm/dispatch.js — 派发引擎（H49）：就绪即拉起，完成即销毁
// 确定性调度归本模块（纯规则零 token）：依赖就绪判定 / 就绪排序 / 护城河与并发闸 / 挑单。
// 判断性调度（切单/分诊/简报）归项管 LLM（pm/brain，事件唤醒）。
const store = require('../core/store');
const pool = require('../pool');

// 依赖全部落袋才算就绪（沿用 H15：未完成不可派）
function depsDone(root, t) {
  const d = t.fm.依赖;
  if (!d) return true;
  const ids = (Array.isArray(d) ? d.map(String) : String(d).split(/[，,\s]+/)).filter(Boolean);
  // 落袋 = 完成，或「无因归档」（正常交付后的整理性归档）。带 归档原因（废弃/验收打回/
  // 定夺打回/推翻替代）的归档一律不算——夜班推演 #4：一刀切只认完成会把 13 张已交付
  // 后归档的依赖判成永不就绪；H59 首案（TK-76 废弃却被旧逻辑当落袋）则是反向翻车。
  for (const id of ids) {
    const dep = store.find(root, id);
    if (!dep) continue;
    const ok = dep.state === '完成' || (dep.state === '已归档' && !dep.fm.归档原因);
    if (!ok) return false;
  }
  return true;
}

// 就绪盘点：待投目录中 已放行 + 依赖就绪 的单（待投=九态下「待起」的物理家）
function readySet(root, crit) {
  const out = [];
  for (const t of store.list(root, '待投')) {
    if (!t.fm.放行) continue;
    if (t.fm.待复核) continue; // 挂起旗同样拦派发（2026-08-05 推演补漏：此前只拦断点续跑）
    if (!depsDone(root, t)) continue;
    out.push({ id: t.id, 职能: t.fm.职能, 优先级: t.fm.优先级 || 'P2', 执行池: t.fm.执行池 || null, // 池章直通（0.22.2：兼容池评测单盖章曾被 poolFor 覆盖）
      红链: crit ? crit.has(t.id) : false, 创建时间: t.fm.创建时间 || '' });
  }
  return out;
}

// 排序（H43⑤ 沿用）：优先级 > 红链 > 创建时间
function sortReady(list) {
  const P = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return [...list].sort((a, b) =>
    (P[a.优先级] ?? 9) - (P[b.优先级] ?? 9)
    || (b.红链 ? 1 : 0) - (a.红链 ? 1 : 0)
    || String(a.创建时间).localeCompare(String(b.创建时间)));
}

// 沟通护城河（代码级保险丝）：claude 池余量 ≤ 保留线 → 停拉 claude 生产单
// gatesInfo: {claude:{fivePct}} 已用百分比；保留线读 config（默认 20）
function moatBlocked(cfg, gatesInfo, poolName) {
  if (poolName !== 'claude') return false;
  const 保留 = Number((cfg.额度 || {}).沟通保留 ?? 20);
  const used = gatesInfo && gatesInfo.claude && gatesInfo.claude.fivePct;
  if (used == null) return false; // 读数盲飞不硬拦（额度锁另有兜底）
  return (100 - used) <= 保留;
}

// 硬顶（代码级）：任何情况下每池并发不得超过此值——项管只能在此以内调
const HARD_CAP = { codex: 3, claude: 3, deepseek: 3 };

// 池冻结判据（H85）：额度锁 或 沟通护城河——两者都是「这个池现在一张都不许派」。
// 并发满不算冻结：那是等下个周期就有的槽位，为它改挂只会把路由搅乱。
function poolFrozen(cfg, gatesInfo, poolName) {
  if (moatBlocked(cfg, gatesInfo, poolName)) return true;
  return !!(gatesInfo && gatesInfo[poolName] && gatesInfo[poolName].locked);
}

// 职能编制所挂的池（H85 用工权归项管）：按 config.agents 出现顺序去重，退役待归者不算编制。
// 编制即「这个职能有活人挂在哪些池上」——死局自愈的第一顺位候选来源。
function rosterPools(cfg, 职能) {
  const out = [];
  for (const a of (cfg.agents || [])) {
    if (a.上线 === false) continue;
    if (职能 && a.职能 !== 职能) continue;
    const p = a.执行池 || pool.poolFor(cfg, a.职能);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

// 派发死局自愈（H85）：案源 2026-08-06——美术-A 唯一编制挂冻结的 codex 池，
// 派发静默滞留而 UI 仍显「在岗」全绿，制作人亲自发现假健康。
// 三态：①编制里还有人挂在没冻结的池 → 用可用者，不改挂（编制照旧，只是换个人干）
//       ②编制全挂在冻结池上 → 临时借调到第一个可用池，打 改挂 标记（工单落 fm.临时改池 + journal + 台账）
//       ③一个可用池都没有 → 返回 null，本轮滞留，交给零派发告警看门狗
// 池章直通（工单 frontmatter 已盖 执行池，如工程单钉死 deepseek）不参与自愈：那是刻意的成本选择。
function routePool(cfg, r, gatesInfo) {
  const 章 = r.执行池;
  const base = 章 || pool.poolFor(cfg, r.职能) || 'claude';
  if (章 || !poolFrozen(cfg, gatesInfo, base)) return { 池: base };
  const roster = rosterPools(cfg, r.职能);
  if (!roster.length) return null; // 该职能零编制：没有用工事实可依，不臆造路由，照旧滞留
  const 编制内 = roster.find((p) => !poolFrozen(cfg, gatesInfo, p));
  if (编制内) return { 池: 编制内 }; // ①部分冻结：编制里还有可用池，正常路由，不算改挂
  const 全池 = [...roster, ...Object.keys(cfg.执行池 || {})];
  const 借调 = 全池.find((p) => !poolFrozen(cfg, gatesInfo, p));
  if (!借调) return null; // ③全冻结无处可去
  return { 池: 借调, 改挂: { 原池: base, 因: `${base} 池冻结 · ${r.职能}编制无可用池，临时借调` } }; // ②
}

// 挑单：给定在跑计数与闸态，返回本轮可拉起的清单（不执行，纯决策——可测）
function pickNext(cfg, ready, runningByPool, gatesInfo, caps) {
  const picks = [];
  const cnt = { ...runningByPool };
  for (const r of sortReady(ready)) {
    const route = routePool(cfg, r, gatesInfo);
    if (!route) continue; // 死局：无可用池，滞留等零派发告警
    const poolName = route.池;
    const cap = Math.min(Number((caps || {})[poolName]) || 1, HARD_CAP[poolName] || 1);
    if ((cnt[poolName] || 0) >= cap) continue;
    if (poolFrozen(cfg, gatesInfo, poolName)) continue; // 保险丝：自愈选出来的池也得过一遍闸
    picks.push({ id: r.id, 池: poolName, ...(route.改挂 ? { 改挂: route.改挂 } : {}) });
    cnt[poolName] = (cnt[poolName] || 0) + 1;
  }
  return picks;
}

module.exports = { depsDone, readySet, sortReady, moatBlocked, poolFrozen, rosterPools, routePool, pickNext, HARD_CAP };
