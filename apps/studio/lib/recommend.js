// recommend.js — 推荐在途：制作人精力参考值（D28）。
// 不是 agent 侧的容量（那由"每人一张"天然限制），而是"制作人此刻该盯几张"的建议：
// 精力档打底（低=固定 1 张专注），高精力时随制作人实际处理决策的速度爬档，
// 再按流程健康度扣分（处理不过来时积压/待定夺自然上涨，推荐随之回落）。
const fs = require('fs');
const path = require('path');
const store = require('./core/store');
const state = require('./core/state');

// 制作人决策动作（journal 行前缀）——处理速度只数"要制作人动脑拍板"的条目，
// agent 侧动作（领单/交产出/QA 裁定）不计入。
const DECISION = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] (验收 |待定夺裁决 |投池 |定稿 |废弃 |收回 |撤回 )/;

// 数近 windowH 小时内的制作人决策条数（读最近两个月份日志，覆盖跨月边界）
function countDecisions(root, windowH, nowMs) {
  const dir = path.join(root, 'journal');
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.log$/.test(f)).sort().slice(-2);
  const since = nowMs - windowH * 3600000;
  let n = 0;
  for (const f of files) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      const m = line.match(DECISION);
      if (m && Date.parse(m[1].replace(' ', 'T')) >= since) n++;
    }
  }
  return n;
}

function recommend(root, cfg, locks, nowMs) {
  const now = nowMs || Date.now();
  const rc = cfg.推荐 || {};
  const 精力档 = rc.精力档 === '低' ? '低' : '高';
  const 窗口 = rc.速度窗口小时 ?? 2;
  const 每档 = rc.每档处理数 ?? 2;

  const agents = (cfg.agents || []).filter((a) => a.上线 !== false);
  const 上限 = agents.length; // D17 走到底：编制即上限
  const 原因 = [];
  const paused = state.read(root).paused;
  const inFlight = [...store.list(root, '在途'), ...store.list(root, '质检'), ...store.list(root, '待定夺')];
  const 当前 = inFlight.length;
  const mk = (v, avail) => ({ 推荐: v, 当前, 上限, 在岗: agents.length, 可用: avail, 精力档, 原因 });

  if (paused.global) { 原因.push('暂停闸门已合：不建议新领单'); return mk(0, 0); }

  const lockedPools = new Set();
  if (locks) for (const [k, l] of Object.entries(locks)) if (l && l.locked) lockedPools.add(k);
  for (const [k, v] of Object.entries(paused)) if (k !== 'global' && v) lockedPools.add(k);
  const avail = agents.filter((a) => !lockedPools.has(a.执行池));
  const 池注 = lockedPools.size ? `，${[...lockedPools].join('/')} 池不可用，可用 ${avail.length}/${agents.length}` : `，可用 ${avail.length}/${agents.length}`;

  const backlog = store.list(root, '待验收').length;
  const 闸 = (cfg.闸值 || {}).待验收积压闸 ?? 8;

  if (精力档 === '低') {
    if (backlog >= 闸) { 原因.push(`待验收积压 ${backlog}/${闸} 已满：先验收再投`); return mk(0, avail.length); }
    原因.push(`低精力档：专注一张，处理完再取${池注}`);
    return mk(Math.min(1, avail.length), avail.length);
  }

  // 高精力：随处理速度爬档。近窗口内每处理 每档 项决策 +1 档，起步 1，封顶可用人数。
  const W = countDecisions(root, 窗口, now);
  let base = Math.min(1 + Math.floor(W / 每档), avail.length);
  原因.push(`高精力档：近 ${窗口}h 处理 ${W} 项决策 → 速度档 ${base}${池注}`);

  if (backlog >= 闸) { base = 0; 原因.push(`待验收积压 ${backlog}/${闸} 已满：先验收再投`); }
  else if (backlog >= Math.ceil(闸 * 0.75)) { base -= 1; 原因.push(`待验收积压 ${backlog}/${闸} 接近闸值 −1`); }

  const escal = store.list(root, '待定夺').length;
  if (escal > 0) { base -= 1; 原因.push(`待定夺 ${escal} 张等你裁 −1`); }

  const stalled = inFlight.filter((t) => t.fm.滞留告警).length;
  if (stalled > 0) { base -= 1; 原因.push(`滞留告警 ${stalled} 张 −1`); }

  return mk(Math.max(0, base), avail.length);
}

module.exports = { recommend, countDecisions };
