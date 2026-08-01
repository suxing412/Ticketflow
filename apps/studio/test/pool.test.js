// pool.test.js — 拉取制：排序/职能匹配/在途上限/一人一张/依赖/原子领单
const assert = require('node:assert');
const pool = require('../lib/pool');
const store = require('../lib/core/store');
const quota = require('../lib/quota');
const { makeRoot, seed, CFG } = require('./helper');

// 断网：让额度锁 fail-open（不触真实 codex/claude）
quota.getRateLimits = async () => null;
quota.getClaudeUsage = async () => null;

let passed = 0; const tests = [];
const t = (n, f) => tests.push([n, f]);
console.log('pool 拉取制测试');

t('listPool 按优先级 > 创建时间排序', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 职能: '策划', 优先级: 'P2', 创建时间: '2026-07-01' });
  seed(root, '池', { id: 'B', 职能: '策划', 优先级: 'P0', 创建时间: '2026-07-03' });
  seed(root, '池', { id: 'C', 职能: '策划', 优先级: 'P2', 创建时间: '2026-06-20' });
  assert.deepEqual(pool.listPool(root, CFG, '策划').map((x) => x.id), ['B', 'C', 'A']);
});

t('领单：职能匹配，队首入在途并记主办', async () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 职能: '策划', 优先级: 'P1' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, true);
  assert.equal(r.id, 'A');
  const f = store.find(root, 'A');
  assert.equal(f.state, '在途');
  assert.equal(f.fm.主办, '策划-A');
  assert.equal(f.fm.执行池, 'claude');
});

t('领单：不领他职能的单', async () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 职能: '程序' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, false);
  assert.ok(r.empty);
  assert.equal(store.find(root, 'A').state, '池'); // 程序单还在池里
});

t('一人一张：已持在途单不能再领', async () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'X', 职能: '策划', 主办: '策划-A', 领单时间: new Date().toISOString() });
  seed(root, '池', { id: 'Y', 职能: '策划' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('一人一张'));
});

t('D17 修订：同职能多 agent 可并行（职能并发=在岗人数）', async () => {
  const root = makeRoot();
  seed(root, '质检', { id: 'X', 职能: '策划', 主办: '策划-B', 领单时间: new Date().toISOString() });
  seed(root, '池', { id: 'Y', 职能: '策划' });
  const r = await pool.claim(root, CFG, '策划-A'); // 策划-B 已持单，策划-A 仍可领
  assert.equal(r.ok, true);
  assert.equal(r.id, 'Y');
});

t('编制即上限：他人持单不挡我，只有自己持单才拒（每人一张）', async () => {
  const root = makeRoot();
  const now = new Date().toISOString();
  seed(root, '在途', { id: 'A1', 职能: '程序', 主办: '程序-A', 领单时间: now });
  seed(root, '质检', { id: 'A2', 职能: 'QA', 主办: 'QA-A', 领单时间: now });
  seed(root, '池', { id: 'Y', 职能: '策划' });
  const r = await pool.claim(root, CFG, '策划-A'); // 别人都持单，策划-A 空手 → 可领
  assert.equal(r.ok, true);
  const r2 = await pool.claim(root, CFG, '策划-A'); // 自己已持单 → 拒
  assert.equal(r2.ok, false);
  assert.ok(r2.error.includes('一人一张'));
});

t('依赖未完成 → 跳过该单', async () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'DEP', 职能: '程序', 主办: '程序-A', 领单时间: new Date().toISOString() });
  seed(root, '池', { id: 'A', 职能: '策划', 依赖: 'DEP' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, false);
  assert.ok(r.empty); // DEP 未完成，A 不可领
});

t('依赖已完成 → 可领', async () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'DEP', 职能: '程序' });
  seed(root, '池', { id: 'A', 职能: '策划', 依赖: 'DEP' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, true);
  assert.equal(r.id, 'A');
});

t('切池：agent 个体执行池覆盖职能默认，领单盖新池章', async () => {
  const root = makeRoot();
  // 程序职能默认 codex 池；程序-B 个体切到 claude 池 → 领单章应为 claude
  const cfg2 = { ...CFG, agents: [...CFG.agents, { id: '程序-B', 职能: '程序', 执行池: 'claude' }] };
  seed(root, '池', { id: 'A', 职能: '程序' });
  const r = await pool.claim(root, cfg2, '程序-B');
  assert.equal(r.ok, true);
  assert.equal(r.执行池, 'claude');
  assert.equal(store.find(root, 'A').fm.执行池, 'claude');
});

t('红链优先（D43⑤）：同优先级内关键路径单先被领；红链优先=false 时回退纯时间序', async () => {
  const root = makeRoot();
  // A 独行小单（先创建）；B 是长链头（B←C←D，加权 9h）——同 P1，红链应插队
  seed(root, '池', { id: 'A', 职能: '策划', 优先级: 'P1', 预计时间: '1h', 创建时间: '2026-07-01' });
  seed(root, '池', { id: 'B', 职能: '策划', 优先级: 'P1', 预计时间: '3h', 创建时间: '2026-07-02' });
  seed(root, '待投', { id: 'C', 职能: '程序', 依赖: 'B', 预计时间: '4h' });
  seed(root, '待投', { id: 'D', 职能: '装配', 依赖: 'C', 预计时间: '2h' });
  assert.deepEqual(pool.listPool(root, CFG, '策划').map((x) => x.id), ['B', 'A'], '红链 B 插队');
  const off = { ...CFG, 执行器: { ...(CFG.执行器 || {}), 红链优先: false } };
  assert.deepEqual(pool.listPool(root, off, '策划').map((x) => x.id), ['A', 'B'], '关掉回退时间序');
});

t('原子领单竞态：跳过被抢走的，领下一张', async () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 职能: '策划', 优先级: 'P0' });
  // 模拟 A 在领单瞬间被并发移走
  store.move(root, 'A', '池', '待投'); // A 已不在池
  seed(root, '池', { id: 'B', 职能: '策划', 优先级: 'P1' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, true);
  assert.equal(r.id, 'B'); // A 被抢走，领到 B
});

(async () => {
  for (const [n, f] of tests) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error(e); process.exit(1); });
