// gates.js — 两道闸（D26 / H81）：暂停总闸（手动，唯一布尔总闸）+ 额度锁（自动，双池独立）。
// 二者拦"领单/派发"：canPull(池) 决定该池 agent 能否从池里领单。
// H81 常开单闸制：跑是常态、停是例外——三档（全局/codex/claude）收成一个总闸，默认开。
const state = require('./core/state');
const quota = require('./quota');

function isPaused(root) {
  return !!state.read(root).paused;
}

function setPaused(root, val) {
  return state.update(root, (s) => { s.paused = !!val; return s.paused; });
}

// 单池额度锁判定。rl=codex rateLimits，cu=claude usage。
function poolLock(cfg, pool, rl, cu) {
  const pc = (cfg.执行池 && cfg.执行池[pool]) || {};
  const th = pc.阈值 || 70;
  const wth = pc.周阈值 || 90;
  let five = null; let week = null;
  if (pool === 'codex') { const ws = quota.windowsOf(rl); five = ws[0] || null; week = ws[1] || null; }
  else { const ws = quota.claudeWindows(cu); five = ws.find((w) => w.label === '5小时') || null; week = ws.find((w) => w.label === '周') || null; }
  const fivePct = five ? five.pct : null;
  const weekPct = week ? week.pct : null;
  let locked = false; let reason = null; let resetAt = null;
  if (fivePct != null && fivePct >= th) { locked = true; reason = `${pool} 池 5小时已用 ${fivePct}%（阈值 ${th}%），领单已冻`; resetAt = five.reset; }
  else if (weekPct != null && weekPct >= wth) { locked = true; reason = `${pool} 池 周已用 ${weekPct}%（周阈值 ${wth}%），领单已冻`; resetAt = week ? week.reset : null; }
  const out = { pool, locked, reason, resetAt, fivePct, weekPct };
  if (pool !== 'codex' && cu && cu.更新于) { out.更新于 = cu.更新于; out.陈旧 = !!cu.陈旧; } // 节流窗口内供的是旧读数，如实标注
  return out;
}

// 双池锁快照（并发查，任一查询失败 fail-open 视为不锁）。
async function allLocks(cfg) {
  const [rl, cu] = await Promise.all([
    quota.getRateLimits(cfg).catch(() => null),
    quota.getClaudeUsage(cfg).catch(() => null),
  ]);
  return { codex: poolLock(cfg, 'codex', rl, cu), claude: poolLock(cfg, 'claude', rl, cu), rl, cu };
}

// 领单前置：该池能否拉单（暂停闸门 + 额度锁）。
async function canPull(root, cfg, pool) {
  if (isPaused(root)) return { allowed: false, reason: '暂停总闸：已合闸（全局暂停）' };
  const locks = await allLocks(cfg);
  const l = locks[pool];
  if (l && l.locked) return { allowed: false, reason: l.reason, resetAt: l.resetAt };
  return { allowed: true };
}

module.exports = { isPaused, setPaused, poolLock, allLocks, canPull };
