// pool.js — 拉取制核心（D3）：在池排序 + agent 领单（原子）。
// 领单 = store.move(池→在途)，改名的原子性保证并发同抢只有一个成功。
const store = require('./core/store');
const gates = require('./gates');
const router = require('./routing/router');

const PRI = { P0: 0, P1: 1, P2: 2, P3: 3 };

function poolFor(cfg, 职能) {
  const roleCfg = cfg.roles && cfg.roles[职能];
  if (roleCfg && roleCfg.defaultProvider) return roleCfg.defaultProvider;
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
  if (职能) items = items.filter((t) => router.taskRole(t) === 职能);
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
  const agent = (cfg.agents || []).find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: `agent 未注册：${agentId}` };
  if (agent.上线 === false) return { ok: false, error: `${agentId} 未上线` };
  const 职能 = router.agentRole(agent);
  if (!职能) return { ok: false, error: `${agentId} 未绑定角色` };

  const fl = inFlight(root);
  // 一人一张（D3b）：该 agent 已持单是唯一的数量约束——
  // D17 走到底（2026-07-11）：编制即上限，在途 ≤ 在岗人数由"每人一张"自然保证，无全局手调上限
  if (fl.some((t) => t.fm.主办 === agentId)) return { ok: false, error: `${agentId} 已持有在途单（一人一张）`, full: true };

  const nowIso = now || new Date().toISOString();
  let lastGate = null;
  for (const t of listPool(root, cfg, 职能)) {
    if (!depsSatisfied(root, t)) continue;
    if (t.fm.待复核) continue; // D36：上游改版未核对的单不派活
    const candidates = router.rankProviders(root, cfg, { agent, task: t, kind: '执行' });
    let selected = null;
    for (const candidate of candidates) {
      const gate = await gates.canPull(root, cfg, candidate.name);
      if (gate.allowed) { selected = candidate; break; }
      lastGate = { ...gate, provider: candidate.name };
    }
    if (!selected) continue;
    const poolName = selected.name;
    const r = store.move(root, t.id, '池', '在途', (fm) => {
      fm.主办 = agentId;
      fm.provider = poolName;       // V2：角色与厂商解耦后的实际路由结果
      fm.执行池 = poolName;          // 兼容旧 UI / 旧工单读取
      fm.路由分 = selected.score === Infinity ? '固定' : selected.score;
      fm.领单时间 = nowIso;
    }, nowIso);
    if (r.ok) return { ok: true, id: t.id, agent: agentId, provider: poolName, 执行池: poolName, route: selected };
    // r 失败多为被并发抢走 → 试队列下一张
  }
  if (lastGate) return { ok: false, error: lastGate.reason, resetAt: lastGate.resetAt, provider: lastGate.provider, gated: true };
  return { ok: false, error: '无可领单（池空 / 依赖未满足 / 都被抢走）', empty: true };
}

module.exports = { poolFor, listPool, inFlight, depsSatisfied, claim, criticalSet };
