// pool.js — 拉取制核心（D3）：在池排序 + agent 领单（原子）。
// 领单 = store.move(池→在途)，改名的原子性保证并发同抢只有一个成功。
const store = require('./core/store');
const gates = require('./gates');

const PRI = { P0: 0, P1: 1, P2: 2, P3: 3 };

function poolFor(cfg, 职能) {
  for (const [pool, c] of Object.entries(cfg.执行池 || {})) {
    if ((c.职能 || []).includes(职能)) return pool;
  }
  return null;
}

// ---- 关键路径（D43⑤）：未完成工单的依赖图上，预计时间加权的最长链 ----
// 与流程视图同一口径（红链）。环上节点不参与（波次算法同款兜底）。
function criticalSet(root) {
  const done = new Set(['完成', '已归档']);
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

// 在池单，可选按职能过滤。排序：优先级 > 红链（D43⑤ 同优先级内关键路径先走，可用 执行器.红链优先=false 关）> 创建时间。
function listPool(root, cfg, 职能) {
  let items = store.list(root, '池');
  if (职能) items = items.filter((t) => t.fm.职能 === 职能);
  const crit = (cfg && cfg.执行器 && cfg.执行器.红链优先 === false) ? new Set() : criticalSet(root);
  items.sort((a, b) => (PRI[a.fm.优先级] ?? 9) - (PRI[b.fm.优先级] ?? 9)
    || (crit.has(b.id) ? 1 : 0) - (crit.has(a.id) ? 1 : 0)
    || String(a.fm.创建时间 || '').localeCompare(String(b.fm.创建时间 || '')));
  return items;
}

// 在途口径（占用在途上限的状态）：在途 + 质检 + 待定夺（都还没交还给你我做终态决定）。
function inFlight(root) {
  return [...store.list(root, '在途'), ...store.list(root, '质检'), ...store.list(root, '待定夺')];
}

function depsSatisfied(root, t) {
  const deps = t.fm.依赖;
  if (!deps) return true;
  const arr = Array.isArray(deps) ? deps : String(deps).split(/[，,\s]+/).filter(Boolean);
  return arr.every((id) => { const d = store.find(root, id); return d && d.state === '完成'; });
}

// 领单：某 agent 领本职能队首可领单。校验 职能匹配 / 闸门额度锁 / 在途上限 / 一人一张 / 依赖。
async function claim(root, cfg, agentId, now) {
  // 编制读取统一走 lib/roster（H85 补章去岗位化）：新形态下一个职能就是一个执行位、id 即职能名；
  // 仍持旧 config.agents 的内存态 cfg 由 roster 兼容返回，本函数行为不变。
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
    if (t.fm.挂起) continue;   // 施工令-021：挂起单不给领（拉取制这条路同样得堵，否则派发制堵了它还能从池里被捞走）
    const r = store.move(root, t.id, '池', '在途', (fm) => {
      fm.主办 = agentId; fm.执行池 = poolName; fm.领单时间 = nowIso;
    }, nowIso);
    if (r.ok) return { ok: true, id: t.id, agent: agentId, 执行池: poolName };
    // r 失败多为被并发抢走 → 试队列下一张
  }
  return { ok: false, error: '无可领单（池空 / 依赖未满足 / 都被抢走）', empty: true };
}

module.exports = { poolFor, listPool, inFlight, depsSatisfied, claim, criticalSet };
