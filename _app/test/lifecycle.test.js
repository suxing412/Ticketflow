// lifecycle.test.js — 生命周期：happy path / QA自修→待定夺 / 定夺 / 验收 / 返工 / 撤回废弃收回 / 滞留
const assert = require('node:assert');
const life = require('../lib/lifecycle');
const store = require('../lib/core/store');
const { makeRoot, seed, CFG } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const st = (root, id) => store.find(root, id).state;
console.log('lifecycle 生命周期测试');

t('happy path：草稿→待投→池→在途→质检→待验收→完成', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'P-01', QA: '开' });
  assert.equal(life.定稿(root, 'P-01').ok, true); assert.equal(st(root, 'P-01'), '待投');
  assert.equal(life.投池(root, 'P-01').ok, true); assert.equal(st(root, 'P-01'), '池');
  store.move(root, 'P-01', '池', '在途', (fm) => { fm.主办 = '策划-A'; fm.领单时间 = new Date().toISOString(); });
  assert.equal(life.交产出(root, 'P-01', '# 回执').ok, true); assert.equal(st(root, 'P-01'), '质检');
  assert.equal(life.QA裁定(root, CFG, 'P-01', true).ok, true); assert.equal(st(root, 'P-01'), '待验收');
  assert.equal(life.验收(root, 'P-01', true).ok, true); assert.equal(st(root, 'P-01'), '完成');
});

t('QA 关：交产出直达待验收（跳过质检）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-02', QA: '关', 主办: 'A', 领单时间: new Date().toISOString() });
  life.交产出(root, 'P-02', null);
  assert.equal(st(root, 'P-02'), '待验收');
});

t('交产出写回执文件', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-03', QA: '关', 主办: 'A', 领单时间: new Date().toISOString() });
  life.交产出(root, 'P-03', '# 完工报告 P-03');
  assert.ok(require('fs').existsSync(require('path').join(root, '回执', 'P-03.md')));
});

t('Orchestrator 解析失败后可从已保存计划恢复到待验收', () => {
  const root = makeRoot();
  seed(root, '执行失败', { id: 'PLAN-RECOVER', role: 'orchestrator', 职能: 'orchestrator', 失败原因: '缺少 JSON' });
  const r = life.恢复计划产出(root, 'PLAN-RECOVER', '# 已从结构化计划恢复');
  assert.ok(r.ok);
  assert.equal(st(root, 'PLAN-RECOVER'), '待验收');
  assert.ok(store.find(root, 'PLAN-RECOVER').fm.计划恢复时间);
  assert.ok(require('fs').existsSync(require('path').join(root, '回执', 'PLAN-RECOVER.md')));
});

t('QA 自修循环：不过→在途(自修+1)，达上限→待定夺', () => {
  const root = makeRoot();
  seed(root, '质检', { id: 'P-04', QA: '开', 主办: 'A' });
  life.QA裁定(root, CFG, 'P-04', false); // 第1轮
  assert.equal(st(root, 'P-04'), '在途');
  assert.equal(store.find(root, 'P-04').fm.自修次数, 1);
  store.move(root, 'P-04', '在途', '质检'); // 主办自修完再交
  life.QA裁定(root, CFG, 'P-04', false); // 第2轮（=上限）
  assert.equal(st(root, 'P-04'), '在途');
  store.move(root, 'P-04', '在途', '质检');
  life.QA裁定(root, CFG, 'P-04', false); // 第3轮 超上限
  assert.equal(st(root, 'P-04'), '待定夺');
});

t('待定夺裁决：接受→待验收 / 给方向→在途 / 打回→已归档', () => {
  const mk = (dec) => { const root = makeRoot(); seed(root, '待定夺', { id: 'D' }); life.定夺(root, 'D', dec); return st(root, 'D'); };
  assert.equal(mk('接受'), '待验收');
  assert.equal(mk('给方向'), '在途');
  assert.equal(mk('打回'), '已归档');
});

t('验收不过 → 已归档', () => {
  const root = makeRoot();
  seed(root, '待验收', { id: 'P-05' });
  life.验收(root, 'P-05', false);
  assert.equal(st(root, 'P-05'), '已归档');
});

t('返工：归档旧单 + 建新草稿（带返工自回链）', () => {
  const root = makeRoot();
  seed(root, '待验收', { id: 'P-06' });
  const r = life.返工(root, 'P-06', 'P-07', { id: 'P-07', title: '重做', 职能: '策划' }, '## 范围');
  assert.equal(r.ok, true);
  assert.equal(st(root, 'P-06'), '已归档');
  assert.equal(st(root, 'P-07'), '草稿');
  assert.equal(store.find(root, 'P-07').fm.返工自, 'P-06');
});

t('撤回：在池→草稿；废弃：任意非终态→已归档；收回：在途→池清主办', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A' }); life.撤回(root, 'A'); assert.equal(st(root, 'A'), '草稿');
  seed(root, '质检', { id: 'B' }); life.废弃(root, 'B'); assert.equal(st(root, 'B'), '已归档');
  seed(root, '在途', { id: 'C', 主办: '策划-A', 领单时间: new Date().toISOString() });
  life.收回(root, 'C'); assert.equal(st(root, 'C'), '池');
  assert.equal(store.find(root, 'C').fm.主办, undefined);
});

t('滞留检查（R3）：超时单标告警但不自动撤回', () => {
  const root = makeRoot();
  const old = new Date(Date.now() - 5 * 3600000).toISOString(); // 5h 前
  seed(root, '在途', { id: 'S', 主办: '策划-A', 领单时间: old });
  seed(root, '质检', { id: 'Q', 主办: 'QA-A', 领单时间: old });
  seed(root, '在途', { id: 'N', 主办: '程序-A', 领单时间: new Date().toISOString() });
  const r = life.滞留检查(root, CFG);
  assert.equal(r.告警.length, 2); // 在途 S + 质检 Q 都超时
  assert.equal(st(root, 'S'), '在途'); // 不自动撤回，仍在途
  assert.equal(st(root, 'Q'), '质检');
  assert.equal(store.find(root, 'S').fm.滞留告警, true);
  assert.equal(st(root, 'N'), '在途'); // 新单不动
  // 再查一次不重复告警（只记一次）
  assert.equal(life.滞留检查(root, CFG).告警.length, 2);
});

console.log(`全部通过：${passed} 项`);
