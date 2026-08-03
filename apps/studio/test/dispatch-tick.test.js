// dispatch-tick.test.js — 派发制 tick 集成：迁移/派发/一次性主办/试跑续流
const assert = require('node:assert');
const { makeRoot, seed } = require('./helper');
const store = require('../lib/core/store');
const runner = require('../lib/runner');
const state = require('../lib/core/state');

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('dispatch-tick 派发制集成测试');

const CFG = {
  执行器: { 派发制: true, 实弹解锁: false },
  执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', 'QA', '装配'] } },
  agents: [{ id: 'QA-A', 职能: 'QA', 执行池: 'claude' }],
  闸值: {},
};

(async () => {
  await t('存量池单自动迁移待投并放行', async () => {
    const root = makeRoot();
    state.update(root, (s) => { s.执行器 = { 运行: true, 试跑: true }; });
    seed(root, '池', { id: 'M-1', 职能: '程序' });
    await runner.tick(root, CFG, { durMs: 0 });
    const m = store.find(root, 'M-1');
    assert.ok(['待投', '在途', '质检', '待验收', '完成'].includes(m.state), '已迁移并可能已被派发（当前 ' + m.state + '）');
    assert.ok(store.list(root, '池').length === 0, '池已清空');
  });

  await t('派发：放行+依赖就绪 → 一次性主办拉起（试跑同步完成走到待验收）', async () => {
    const root = makeRoot();
    state.update(root, (s) => { s.执行器 = { 运行: true, 试跑: true }; });
    seed(root, '待投', { id: 'D-1', 职能: '程序', 放行: true, QA: '关' });
    seed(root, '待投', { id: 'D-2', 职能: '程序' }); // 未放行不动
    await runner.tick(root, CFG, { durMs: 0 });
    const d1 = store.find(root, 'D-1');
    assert.equal(d1.state, '待验收', 'QA关试跑同步直达待验收（当前 ' + d1.state + '）');
    assert.equal(d1.fm.主办, '程序·D-1', '一次性主办=职能·单号');
    assert.equal(store.find(root, 'D-2').state, '待投', '未放行不派');
  });

  await t('并发闸：单池上限内逐张放行', async () => {
    const root = makeRoot();
    state.update(root, (s) => { s.执行器 = { 运行: true, 试跑: true }; });
    for (let i = 1; i <= 4; i++) seed(root, '待投', { id: 'C-' + i, 职能: '程序', 放行: true, QA: '关' });
    // 试跑 durMs 大：让首轮拉起的悬在执行中占并发
    await runner.tick(root, CFG, { durMs: 60000 });
    const 在途 = store.list(root, '在途').length;
    assert.equal(在途, 1, 'codex 默认并发 1（实际 ' + 在途 + '）');
    assert.equal(store.list(root, '待投').length, 3, '其余排队');
  });

  console.log(`全部通过：${passed} 项`);
})();
