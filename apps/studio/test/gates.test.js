// gates.test.js — 两道闸：暂停总闸（H81 单闸）+ 额度锁（双池独立）
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
