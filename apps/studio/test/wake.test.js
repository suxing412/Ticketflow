// wake.test.js — 项管唤醒接线：定稿切单事件/收口去重/连环上呈
const assert = require('node:assert');
const { makeRoot, seed } = require('./helper');
const store = require('../lib/core/store');
const wake = require('../lib/pm/wake');
const ledger = require('../lib/pm/ledger');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('wake 项管唤醒测试');

t('战役父单定稿触发切单事件；普通单不触发', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'P-1', 父单类型: '战役', 项目: 'X' });
  const p = store.find(root, 'P-1');
  assert.equal(wake.onCampaignFinalized(root, {}, p, null, { test: true }).woke, true);
  assert.ok(ledger.events(root).some((e) => e.类型 === '切单启动' && e.父单 === 'P-1'));
  seed(root, '待投', { id: 'N-1' });
  assert.equal(wake.onCampaignFinalized(root, {}, store.find(root, 'N-1'), null, { test: true }).woke, false);
});

t('收口检测：全落袋才唤醒且只唤醒一次；有未完子单不唤醒', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'C-1', 父单类型: '战役' });
  seed(root, '完成', { id: 'C-2', 父单: 'C-1' });
  seed(root, '在途', { id: 'C-3', 父单: 'C-1', 主办: 'x', 领单时间: new Date().toISOString() });
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), [], '有在途不收口');
  store.move(root, 'C-3', '在途', '质检');
  store.move(root, 'C-3', '质检', '待验收');
  store.move(root, 'C-3', '待验收', '完成');
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), ['C-1'], '全落袋唤醒');
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), [], '台账去重不重复唤醒');
  assert.ok(ledger.events(root).some((e) => e.类型 === '收口待验'));
});

t('连环失败：同战役 ≥2 异常单上呈一次', () => {
  const root = makeRoot();
  seed(root, '执行失败', { id: 'F-1', 父单: 'P-9' });
  assert.deepEqual(wake.checkChainFailures(root), [], '单发不上呈');
  seed(root, '待定夺', { id: 'F-2', 父单: 'P-9' });
  assert.deepEqual(wake.checkChainFailures(root), ['P-9'], '两发上呈');
  assert.deepEqual(wake.checkChainFailures(root), [], '去重');
  assert.ok(ledger.events(root).some((e) => e.类型 === '上呈' && e.父单 === 'P-9'));
});

console.log(`全部通过：${passed} 项`);
