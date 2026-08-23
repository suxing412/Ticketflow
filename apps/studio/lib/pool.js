// pool.js — 拉取制核心（D3）：待派队列排序 + agent 领单（原子）。
// H108 三大态状态机（2026-08-24）：「池」目录退役并入「待派」，放行降为 fm 标记（项管闸语义）——
// 可领集合 = 待派目录里 fm.放行===true 的单。领单 = store.move(待派→在途)，改名原子性保证并发同抢只有一个成功。
const store = require('./core/store');
const gates = require('./gates');

const PRI = { P0: 0, P1: 1, P2: 2, P3: 3 };

// ---- 池归属（施工令-027 去双账，2026-08-09）----
// 双账病历：H85 之后「职能挂哪个池」有两本账——① 编制表 cfg.编制[].池序（派发/领单实际走的那本）
// ② 老映射 cfg.执行池.<池>.职能（poolFor 读的那本）。两本一旦分歧，poolFor 就在撒谎：
// 现网 2026-08-09 实测 程序 编制 claude→codex 而老映射答 codex、美术 编制 codex 而老映射答 claude。
// 之所以没炸，是因为所有调用点都写成「池序[0] || poolFor(...)」——poolFor 只是池序为空时的兜底，
// 它那个错答案压根没被消费（TK-106~108 跑通属侥幸）。现在把权威收归一处：
//   编制表是唯一权威 → 职能→池序首位；老映射降为**迁移期兜底**，仅在该职能无编制行/池序为空时才查。
// 冻结不在这里算：poolFor 是同步函数（自检 lint 也在调），把额度冻结判据塞进来会让"归属"随额度漂移；
// 「首位**可用**池」的可用性由 dispatch.routePool 用 poolFrozen 逐池挑，两处职责不混。
function poolFor(cfg, 职能) {
  const 池序 = require('./roster').poolsOf(cfg, 职能);
  if (池序.length) return 池序[0];
  for (const [pool, c] of Object.entries((cfg && cfg.执行池) || {})) {
    if ((c.职能 || []).includes(职能)) return pool; // 兜底：未迁移配置 / 旧测试夹具 / 编制漏挂
  }
  return null;
}

// ---- 关键路径（D43⑤）：未完成工单的依赖图上，预计时间加权的最长链 ----
// 与流程视图同一口径（红链）。环上节点不参与（波次算法同款兜底）。
function criticalSet(root) {
  // H108 终态集合逐处按语义判：这里问的是「这张单还欠不欠工」。完成=判官全过（活已做完，
  // 只等专项级验收）、归档=落袋、废弃=判死——三者都不再欠工，不参与未完成依赖图。
  // 挂起是目录态但活还欠着（可逆），照旧留在图里（与旧 fm 标记时代行为一致）。
  const done = new Set(['完成', '归档', '废弃']);
  const all = [];
  for (const s of store.STATES) if (!done.has(s)) all.push(...store.list(root, s));
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  const depsOf = (t) => t.fm.依赖
    ? (Array.isArray(t.fm.依赖) ? t.fm.依赖 : String(t.fm.依赖).split(/[，,\s]+/)).filter((d) => byId[d]) : [];
  const memo = {}; const visiting = new Set();
  const longest = (id) => {
    if (memo[id]) return memo[id];
    if (visiting.has(id)) return { len: 0, path: [] }; // 成环：断链兜底
    visiting.add(id);
    let best = { len: 0, path: [] };
    for (const d of depsOf(byId[id])) { const r = longest(d); if (r.len > best.len) best = r; }
    visiting.delete(id);
    const h = parseFloat(byId[id].fm.预计时间) || 1;
    return memo[id] = { len: best.len + h, path: [...best.path, id] };
  };
  let cp = { len: 0, path: [] };
  for (const t of all) { const r = longest(t.id); if (r.len > cp.len) cp = r; }
  // 孤节点不算链：没有依赖关系的图里"最贵的一张单"不该插队（那是优先级的事）
  return cp.path.length >= 2 ? new Set(cp.path) : new Set();
}

// 可领单（H108：待派目录 × 放行标记），可选按职能过滤。放行不是目录跳变而是项管闸的 fm 标记——
// 没盖放行旗的待派单对拉取制不可见。排序：优先级 > 红链（D43⑤ 同优先级内关键路径先走，
// 可用 执行器.红链优先=false 关）> 创建时间。
function listPool(root, cfg, 职能) {
  // 待重派同盘（H113/lifecycle 口径注）：重投/复活回队的单落 待重派 且带放行旗，与 dispatch.readySet 同一张就绪面。
  let items = [...store.list(root, '待派'), ...store.list(root, '待重派')].filter((t) => t.fm.放行 === true);
  if (职能) items = items.filter((t) => t.fm.职能 === 职能);
  const crit = (cfg && cfg.执行器 && cfg.执行器.红链优先 === false) ? new Set() : criticalSet(root);
  items.sort((a, b) => (PRI[a.fm.优先级] ?? 9) - (PRI[b.fm.优先级] ?? 9)
    || (crit.has(b.id) ? 1 : 0) - (crit.has(a.id) ? 1 : 0)
    || String(a.fm.创建时间 || '').localeCompare(String(b.fm.创建时间 || '')));
  return items;
}

// 在途口径（占用在途上限/执行槽的状态）：在途 + 初检 + 核查 + 仲裁。
// H108 统计口径：**排除完成**——完成是在途大态的出口驻留位（判官全过等专项级验收），
// 不占执行槽；把它算进去会让并发/容量统计随积压的待验收单虚高。
function inFlight(root) {
  return [...store.list(root, '在途'), ...store.list(root, '初检'), ...store.list(root, '核查'), ...store.list(root, '仲裁')];
}

function depsSatisfied(root, t) {
  const deps = t.fm.依赖;
  if (!deps) return true;
  const arr = Array.isArray(deps) ? deps : String(deps).split(/[，,\s]+/).filter(Boolean);
  // H108 语义（与 dispatch.depsDone 同口径，两处不许飘）：完成=判官全过做完等关账即满足；
  // 归档且无归档原因=正常落袋满足；带归档原因（废弃/打回/推翻替代）的归档与 废弃 目录都不满足
  // （依赖悬空要改挂，废弃() 侧有告警）。
  return arr.every((id) => { const d = store.find(root, id); return d && (d.state === '完成' || (d.state === '归档' && !d.fm.归档原因)); });
}

// 领单：某 agent 领本职能队首可领单。校验 职能匹配 / 闸门额度锁 / 在途上限 / 一人一张 / 依赖。
async function claim(root, cfg, agentId, now) {
  // 编制读取统一走 lib/roster（H85 补章去岗位化）：新形态下一个职能就是一个执行位、id 即职能名；
  // 仍持旧 config.agents 的内存态 cfg 由 roster 兼容返回，本函数行为不变。
  // Q20 哨兵：同号双态时拉取制这条路同样得堵——派发制堵了它还能从池里被捞走（同 施工令-021 挂起旗的教训）
  const 哨 = require('./sentinel').熔断(root);
  if (哨.熔断) return { ok: false, error: `同号双态哨兵熔断派发：${哨.签名}`, 熔断: true };
  const agent = require('./roster').agents(cfg).find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: `执行位未注册：${agentId}（编制表里没有这个职能）` };
  if (agent.上线 === false) return { ok: false, error: `${agentId} 未上线` };
  const 职能 = agent.职能;
  const poolName = agent.执行池 || poolFor(cfg, 职能);
  if (!poolName) return { ok: false, error: `${职能} 未绑定执行池` };

  const gate = await gates.canPull(root, cfg, poolName);
  if (!gate.allowed) return { ok: false, error: gate.reason, resetAt: gate.resetAt, gated: true };

  const fl = inFlight(root);
  // 一人一张（D3b）：该 agent 已持单是唯一的数量约束——
  // D17 走到底（2026-07-11）：编制即上限，在途 ≤ 在岗人数由"每人一张"自然保证，无全局手调上限
  if (fl.some((t) => t.fm.主办 === agentId)) return { ok: false, error: `${agentId} 已持有在途单（一人一张）`, full: true };

  const nowIso = now || new Date().toISOString();
  for (const t of listPool(root, cfg, 职能)) {
    if (!depsSatisfied(root, t)) continue;
    if (t.fm.待复核) continue; // D36：上游改版未核对的单不派活
    if (t.fm.挂起) continue;   // H108 后挂起是目录态（待派单挂起即搬进 挂起 目录）；此处 fm 旗判据留作迁移期兜底
    const r = store.move(root, t.id, t.state, '在途', (fm) => { // t.state ∈ 待派/待重派，两条边都在边表上
      fm.主办 = agentId; fm.执行池 = poolName; fm.领单时间 = nowIso;
    }, nowIso);
    if (r.ok) return { ok: true, id: t.id, agent: agentId, 执行池: poolName, 自: t.state };
    // r 失败多为被并发抢走 → 试队列下一张
  }
  return { ok: false, error: '无可领单（池空 / 依赖未满足 / 都被抢走）', empty: true };
}

module.exports = { poolFor, listPool, inFlight, depsSatisfied, claim, criticalSet };
