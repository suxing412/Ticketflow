// 协-041 甲：质检不过转「修复」职责，并以返修上限防止无限烧额度。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const 平台根 = path.resolve(__dirname, '..');
const 返修 = require('../lib/返修');
const 工单库 = require('../lib/工单库');
const 派单 = require('../lib/派单');
const router = require('../lib/routing/router');
const 计划 = require('../lib/orchestration/plan');
const 提示装配 = require('../lib/提示装配');
let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('返修契约测试');

t('不过 → 修复，原角色只记第一次，返修次数递增', () => {
  const fm = { role: 'backend' };
  let r = 返修.判后处置({ 执行: { 返修上限: 2 } }, fm, '不过');
  assert.deepEqual({ 转: r.转修复, 步: r.下一步, 次: r.返修次数, 原: r.原角色 },
    { 转: true, 步: '待投', 次: 1, 原: 'backend' });
  返修.应用(fm, r, 'T1');
  assert.deepEqual({ role: fm.role, 原角色: fm.原角色, 返修次数: fm.返修次数 },
    { role: '修复', 原角色: 'backend', 返修次数: 1 });
  r = 返修.判后处置({ 执行: { 返修上限: 2 } }, fm, '不过');
  返修.应用(fm, r, 'T2');
  assert.equal(fm.原角色, 'backend', '后续不过不能把原角色覆盖成修复');
  assert.equal(fm.返修次数, 2);
});

t('验不了、判官失败与通过都不转职责', () => {
  for (const 结论 of ['验不了', '判官失败', '通过']) {
    const fm = { role: 'frontend' };
    const r = 返修.判后处置({}, fm, 结论);
    assert.equal(r.转修复, false, 结论);
    assert.equal(r.下一步, undefined, 结论);
    返修.应用(fm, r);
    assert.deepEqual(fm, { role: 'frontend' }, 结论);
  }
});

t('已达返修上限 → 真实挂起状态，原因落单且可人工重投', () => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), '返修-'));
  try {
    工单库.建目录(根);
    工单库.create(根, 'R-1', { role: '修复', 原角色: 'backend', 返修次数: 2 }, '正文');
    工单库.move(根, 'R-1', '草稿', '待投');
    工单库.move(根, 'R-1', '待投', '在途');
    工单库.move(根, 'R-1', '在途', '质检');
    const r = 返修.判后处置({ 执行: { 返修上限: 2 } }, 工单库.find(根, 'R-1').fm, '不过');
    assert.equal(r.下一步, '挂起');
    const m = 工单库.move(根, 'R-1', '质检', r.下一步, (fm) => 返修.应用(fm, r, 'T3'));
    assert.equal(m.ok, true);
    const 单 = 工单库.find(根, 'R-1');
    assert.equal(单.state, '挂起');
    assert.match(单.fm.挂起原因, /已返修 2 次仍不过/);
    assert.equal(单.fm.返修次数, 2, '没有再次转修复就不能虚增次数');
    assert.equal(工单库.isLegal('挂起', '待投'), true);
  } finally { fs.rmSync(根, { recursive: true, force: true }); }
});

const 配 = {
  roles: { 修复: {}, reviewer: {} },
  providers: {
    claude: { scores: { default: { quality: 85 } } },
    codex: { scores: { default: { quality: 57 } } },
  },
  routing: { roles: {
    修复: { allow: ['codex', 'claude'], prefer: ['codex'] },
    reviewer: { allow: ['codex', 'claude'], prefer: ['codex', 'claude'] },
  } },
};

t('修复按硬池序派给 codex；修的人不判自己的活', () => {
  assert.equal(router.rankProviders(null, 配, { role: '修复' })[0].name, 'codex');
  const 判官 = router.rankProviders(null, 配, {
    role: 'reviewer', kind: '质检', task: { fm: { role: '修复', 执行池: 'codex' } },
  });
  assert.equal(判官[0].name, 'claude');
  assert.ok(判官.every((p) => p.name !== 'codex'));
});

t('修复必须在写权白名单；不在就由写权矛盾闸拒派', () => {
  const 开 = 派单.权限参数({ 执行: { 权限: { 放开: ['修复'] } } }, '修复', 'codex-cli');
  assert.equal(开.模式, '放开');
  assert.equal(派单.写权矛盾({ fm: { role: '修复', 产出物类型: '代码' } }, 开), null);
  const 关 = 派单.权限参数({ 执行: { 权限: { 放开: [] } } }, '修复', 'codex-cli');
  assert.ok(派单.写权矛盾({ fm: { role: '修复', 产出物类型: '代码' } }, 关));
});

t('编排计划不允许预设修复职责', () => {
  assert.throws(() => 计划.normalizePlan({ roles: { backend: {}, 修复: {} } }, { tasks: [{
    key: 'repair', title: '预设失败', role: '修复', acceptance: ['完成'],
  }] }), /不允许预设.*修复/);
});

t('回炉提示继续携带上一轮阻断问题，不因角色变化丢失', () => {
  const r = 提示装配.回炉要求({ role: '修复', 质检结论: '不过',
    质检意见: { 问题: ['漏了测试'], 证据: ['npm test 失败'] } });
  assert.equal(r.有, true);
  assert.match(r.文, /漏了测试/);
  assert.match(r.文, /npm test 失败/);
});

t('执行器接入判后决策，挂起原因同时进入工单、回执和急件', () => {
  const src = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.match(src, /返修\.判后处置\(配置, t\.fm, 判\.结论\)/);
  assert.match(src, /返修\.应用\(fm, 返修处置\)/);
  assert.match(src, /返修挂起/);
  assert.match(src, /返修上限已到，停手待人工/);
});

console.log(`全部通过：${passed} 项`);
