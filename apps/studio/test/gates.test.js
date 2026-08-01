// gates.test.js — 两道闸：暂停闸门 + 额度锁（双池独立）
const assert = require('node:assert');
const gates = require('../lib/gates');
const quota = require('../lib/quota');
const pool = require('../lib/pool');
const { makeRoot, seed, CFG } = require('./helper');

let passed = 0; const tests = [];
const t = (n, f) => tests.push([n, f]);
console.log('gates 两道闸测试');

t('暂停闸门：全局暂停 → canPull 拒绝；恢复 → 放行', async () => {
  const root = makeRoot();
  quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;
  gates.setPaused(root, 'global', true);
  let r = await gates.canPull(root, CFG, 'claude');
  assert.equal(r.allowed, false);
  assert.ok(r.reason.includes('全局暂停'));
  gates.setPaused(root, 'global', false);
  r = await gates.canPull(root, CFG, 'claude');
  assert.equal(r.allowed, true);
});

t('暂停闸门按池：暂停 codex 不影响 claude', async () => {
  const root = makeRoot();
  quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;
  gates.setPaused(root, 'codex', true);
  assert.equal((await gates.canPull(root, CFG, 'codex')).allowed, false);
  assert.equal((await gates.canPull(root, CFG, 'claude')).allowed, true);
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
