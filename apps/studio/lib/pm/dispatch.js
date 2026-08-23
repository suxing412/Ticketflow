// pm/dispatch.js — 派发引擎（H49）：就绪即拉起，完成即销毁
// 确定性调度归本模块（纯规则零 token）：依赖就绪判定 / 就绪排序 / 护城河与并发闸 / 挑单。
// 判断性调度（切单/分诊/简报）归项管 LLM（pm/brain，事件唤醒）。
const store = require('../core/store');
const pool = require('../pool');
const roster = require('../roster');

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
  // Q20 哨兵（案源 2026-08-18 伪单事故）：同号双态 = 事实源自相矛盾 → 全线熔断，一张都不派。
  // 落在这里而不是 runner：readySet 是派发制唯一的就绪入口，堵住它就堵住整条派发路；
  // 且巡检的零派发看门狗走同一函数，熔断期它读到空队列，不会再叠一条「该派没派」的误报。
  if (require('../sentinel').熔断(root).熔断) return [];
  const out = [];
  for (const t of store.list(root, '待投')) {
    if (!t.fm.放行) continue;
    if (t.fm.待复核) continue; // 挂起旗同样拦派发（2026-08-05 推演补漏：此前只拦断点续跑）
    if (t.fm.挂起) continue;   // 施工令-021：制作人原位冻结的单不进就绪队列——零派发计数亦据此不把它算作「该派没派」
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

// 职能编制的池序（H85 补章「去岗位化」）：编制表每职能一行，池序即路由优先级。
// 读取统一走 lib/roster（旧 config.agents 由它兼容推导，本模块不再认岗位册）。
function rosterPools(cfg, 职能) {
  return roster.poolsOf(cfg, 职能);
}

// 派发挑池 + 死局自愈（H85／补章去岗位化）：案源 2026-08-06——美术编制唯一挂在冻结的 codex 池，
// 派发静默滞留而 UI 仍显「在岗」全绿，制作人亲自发现假健康。
// 池序即路由优先级，三态语义沿用 007：
//   ①池序里还有未冻结的池 → 取第一个可用的（**池序内切换不算改挂**，那本来就是编制授权的池）
//   ②池序整条全冻 → 临时借调 config.执行池 里第一个可用池，打 改挂 标记（工单落 fm.临时改池 + journal + 台账）
//   ③一个可用池都没有 → 返回 null，本轮滞留，交给零派发告警看门狗
// 边界：池章直通（工单 frontmatter 已盖 执行池，如工程单钉死 deepseek）不参与自愈——那是刻意的成本选择；
//       零编制职能只走职能默认池，冻了就滞留，不臆造借调（没有用工事实可依）。
// 计费性质（2026-08-08 制作人裁决「套餐优先、用完降级到 key」的配套）：
// 显式 计费 字段优先；没写就按有没有 兼容 段推断（兼容端点一律按量计费）。
// 这个字段存在的唯一理由是**让跨计费的切换留得下痕**——见下面的 降级。
function 计费Of(cfg, 池) {
  const p = (cfg.执行池 || {})[池] || {};
  if (p.计费 === '按量' || p.计费 === '订阅') return p.计费;
  return p.兼容 ? '按量' : '订阅';
}

// 跨计费降级判定：订阅 → 按量 是**成本性质的改变**，不是普通的池切换。
// 旧样「池序内切换不算改挂」在 claude→codex 之间是对的（都是订阅，换谁都不花钱），
// 但 claude→claude-key 意味着从这一刻起每一单都在真金白银地烧，静默是不可接受的：
// 用户看到的是「一切正常在跑」，实际是账单在涨。所以这里单独出一个 降级 标记，
// 由 runner 落 journal + 台账 + 信箱急件（改挂只在借调时出，两者互不替代）。
function 降级Of(cfg, 原池, 新池) {
  if (!原池 || !新池 || 原池 === 新池) return null;
  const a = 计费Of(cfg, 原池); const b = 计费Of(cfg, 新池);
  if (a === b) return null;
  if (!(a === '订阅' && b === '按量')) return null; // 按量→订阅是省钱方向，不必打扰
  return { 原池, 新池, 原计费: a, 新计费: b, 因: `${原池} 套餐额度用尽/受限，降级到按量计费池 ${新池}——从此单起产生费用` };
}

function routePool(cfg, r, gatesInfo) {
  if (r.执行池) return { 池: r.执行池 };
  const 池序 = rosterPools(cfg, r.职能);
  const base = 池序[0] || pool.poolFor(cfg, r.职能) || 'claude';
  if (!池序.length) return poolFrozen(cfg, gatesInfo, base) ? null : { 池: base };
  const 可用 = 池序.find((p) => !poolFrozen(cfg, gatesInfo, p));
  if (可用) { // ①
    const 降级 = 降级Of(cfg, 池序[0], 可用);
    return { 池: 可用, ...(降级 ? { 降级 } : {}) };
  }
  const 借调 = Object.keys(cfg.执行池 || {}).find((p) => !poolFrozen(cfg, gatesInfo, p));
  if (!借调) return null; // ③
  const 降级 = 降级Of(cfg, base, 借调);
  return { 池: 借调, 改挂: { 原池: base, 因: `${base} 池冻结 · ${r.职能}编制池序全冻，临时借调` }, ...(降级 ? { 降级 } : {}) }; // ②
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
    picks.push({ id: r.id, 池: poolName, ...(route.改挂 ? { 改挂: route.改挂 } : {}), ...(route.降级 ? { 降级: route.降级 } : {}) });
    cnt[poolName] = (cnt[poolName] || 0) + 1;
  }
  return picks;
}

module.exports = { depsDone, readySet, sortReady, moatBlocked, poolFrozen, rosterPools, routePool, pickNext, 计费Of, 降级Of, HARD_CAP };
