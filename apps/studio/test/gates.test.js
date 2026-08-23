// gates.test.js — 两道闸：暂停总闸（H81 单闸）+ 额度锁（双池独立）
// 外呼绊线必须排在任何 lib/ 之前：lib/quota.js 在加载那一刻就把 child_process 解构走了（体检 #71）
const 绊线 = require('./外呼绊线'); 绊线.装绊线();
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const gates = require('../lib/gates');
const state = require('../lib/core/state');
const quota = require('../lib/quota');
const pool = require('../lib/pool');
const { makeRoot, seed, CFG } = require('./helper');

let passed = 0; const tests = [];
const t = (n, f) => tests.push([n, f]);
console.log('gates 两道闸测试');

t('暂停总闸：合闸 → canPull 拒绝；开闸 → 放行', async () => {
  const root = makeRoot();
  quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;
  gates.setPaused(root, true);
  let r = await gates.canPull(root, CFG, 'claude');
  assert.equal(r.allowed, false);
  assert.ok(r.reason.includes('全局暂停'));
  gates.setPaused(root, false);
  r = await gates.canPull(root, CFG, 'claude');
  assert.equal(r.allowed, true);
});

t('暂停总闸无分档（H81）：合闸对所有池一视同仁，默认开', async () => {
  const root = makeRoot();
  quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;
  assert.equal(gates.isPaused(root), false, '默认开闸（跑是常态）');
  assert.equal((await gates.canPull(root, CFG, 'codex')).allowed, true);
  assert.equal(gates.setPaused(root, true), true, 'setPaused 返回单一布尔');
  assert.equal((await gates.canPull(root, CFG, 'codex')).allowed, false);
  assert.equal((await gates.canPull(root, CFG, 'claude')).allowed, false);
});

t('旧 state 静默迁移（H81）：三档 paused / 试跑 / 实弹解锁 读到即归形，不炸', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, '.studio-state.json'), JSON.stringify({
    paused: { global: false, codex: true, claude: false },
    执行器: { 运行: true, 试跑: true, 实弹解锁: false },
  }), 'utf8');
  const s = state.read(root);
  assert.equal(s.paused, true, '任一旧档合上即总闸合（保守）');
  assert.equal(gates.isPaused(root), true);
  assert.ok(!('试跑' in s.执行器) && !('实弹解锁' in s.执行器), '历史包袱字段读掉');
  assert.equal(s.执行器.运行, true, '运行位不动');
  // 三档全开的旧盘 → 总闸开
  fs.writeFileSync(path.join(root, '.studio-state.json'), JSON.stringify({ paused: { global: false, codex: false, claude: false } }), 'utf8');
  assert.equal(state.read(root).paused, false);
});

t('额度锁：claude 5h 超阈值 → claude 锁、codex 不锁（双池独立）', async () => {
  const root = makeRoot();
  quota.getRateLimits = async () => ({ primary: { usedPercent: 20, resetsAt: 0, windowDurationMins: 300 } });
  quota.getClaudeUsage = async () => ({ fiveHour: { utilization: 88, resets_at: '2026-07-08T05:50:00Z' } });
  const locks = await gates.allLocks(CFG);
  assert.equal(locks.claude.locked, true);
  assert.equal(locks.codex.locked, false);
  assert.equal((await gates.canPull(root, CFG, 'claude')).allowed, false);
  assert.equal((await gates.canPull(root, CFG, 'codex')).allowed, true);
});

t('额度锁拦领单：claude 池锁死时 claude 岗领不到单', async () => {
  const root = makeRoot();
  quota.getRateLimits = async () => null;
  quota.getClaudeUsage = async () => ({ fiveHour: { utilization: 95, resets_at: '2026-07-08T05:50:00Z' } });
  seed(root, '池', { id: 'A', 职能: '策划' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, false);
  assert.ok(r.gated);
  assert.equal(require('../lib/core/store').find(root, 'A').state, '池'); // 没被领走
});

// ---- 施工令-010 第 4 条：codex 窗口正名（现实只有周窗，锁文案不得再写「5小时」）----
t('codex 只有周窗：锁文案按真窗口 label 呈现，不出「5小时」字样', () => {
  // 实机形状（node lib/quota.js 实读）：primary.windowDurationMins=10080、secondary=null
  const rl = { primary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: 1786243868 }, secondary: null };
  const l = gates.poolLock(CFG, 'codex', rl, null);
  assert.equal(l.locked, true, '77% ≥ 阈值 70% 照锁（判定逻辑不变）');
  assert.ok(l.reason.includes('周已用 77%'), '如实说周窗：' + l.reason);
  assert.ok(!l.reason.includes('5小时'), '文案里不许再有「5小时」：' + l.reason);
  assert.deepEqual(l.窗口.map((w) => w.label), ['周'], 'codex 只出一个窗口（额度卡据此只画周条）');
  assert.equal(l.窗口[0].pct, 77);
  assert.equal(l.窗口[0].阈值, 70);
  assert.equal(l.窗口[0].已越, true);
  assert.equal(l.fivePct, 77, '老字段口径不动（护城河/概览数字仍在读）');
});

t('claude 双窗不受影响：5小时 + 周两条都在，各挂各的杆', () => {
  const cu = { fiveHour: { utilization: 30, resets_at: '2026-08-07T05:50:00Z' },
    sevenDay: { utilization: 95, resets_at: '2026-08-09T05:50:00Z' } };
  const l = gates.poolLock(CFG, 'claude', null, cu);
  assert.deepEqual(l.窗口.map((w) => w.label), ['5小时', '周']);
  assert.deepEqual(l.窗口.map((w) => w.阈值), [70, 90], '5小时归 阈值、周归 周阈值');
  assert.deepEqual(l.窗口.map((w) => w.已越), [false, true]);
  assert.equal(l.locked, true);
  assert.ok(l.reason.includes('周已用 95%'), '周窗锁的文案是周：' + l.reason);
  // 5h 越线时文案仍写 5小时（claude 真有这个窗）
  const l2 = gates.poolLock(CFG, 'claude', null, { fiveHour: { utilization: 88, resets_at: 0 } });
  assert.ok(l2.reason.includes('5小时已用 88%'), l2.reason);
  assert.deepEqual(l2.窗口.map((w) => w.label), ['5小时'], '没有周窗读数就不画周条，不假造');
});

t('读数拿不到：窗口清单为空（额度卡不摆假窗），fail-open 不锁', () => {
  const l = gates.poolLock(CFG, 'codex', null, null);
  assert.deepEqual(l.窗口, []);
  assert.equal(l.locked, false);
  assert.equal(l.fivePct, null);
});

t('额度锁 fail-open：查询失败视为不锁', async () => {
  const root = makeRoot();
  quota.getRateLimits = async () => { throw new Error('boom'); };
  quota.getClaudeUsage = async () => { throw new Error('boom'); };
  assert.equal((await gates.canPull(root, CFG, 'claude')).allowed, true);
});

(async () => {
  for (const [n, f] of tests) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error(e); process.exit(1); });
