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
  // 只认「完成」：已归档含废弃/打回/推翻（完成→已归档唯一入口=推翻重做），皆非落袋。
  // H59 首案（TK-79 误派发，2026-08-05）：TK-76 废弃归档曾被当作依赖已了结。
  const done = new Set(['完成']);
  for (const id of ids) {
    const dep = store.find(root, id);
    if (dep && !done.has(dep.state)) return false;
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

// 挑单：给定在跑计数与闸态，返回本轮可拉起的清单（不执行，纯决策——可测）
function pickNext(cfg, ready, runningByPool, gatesInfo, caps) {
  const picks = [];
  const cnt = { ...runningByPool };
  for (const r of sortReady(ready)) {
    const poolName = r.执行池 || pool.poolFor(cfg, r.职能) || 'claude';
    const cap = Math.min(Number((caps || {})[poolName]) || 1, HARD_CAP[poolName] || 1);
    if ((cnt[poolName] || 0) >= cap) continue;
    if (moatBlocked(cfg, gatesInfo, poolName)) continue;
    if (gatesInfo && gatesInfo[poolName] && gatesInfo[poolName].locked) continue; // 额度锁保险丝
    picks.push({ id: r.id, 池: poolName });
    cnt[poolName] = (cnt[poolName] || 0) + 1;
  }
  return picks;
}

module.exports = { depsDone, readySet, sortReady, moatBlocked, pickNext, HARD_CAP };
