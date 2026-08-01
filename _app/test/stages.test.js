// stages.test.js — 阶段化生产（D43）：字典默认/项目覆盖、阶段标准解析回环、模板落盘
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const stages = require('../lib/stages');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('stages 阶段化测试（D43）');

t('字典：无配置走默认 L0-L2；项目可覆盖（字符串/对象两种写法）', () => {
  assert.deepEqual(stages.stagesFor({}, 'X').map((s) => s.代号), ['L0', 'L1', 'L2']);
  const cfg = { 项目: { 注册: { 甲: { 路径: 'x', 阶段: ['P0 立项', { 代号: 'P1', 名称: '量产' }] } } } };
  const got = stages.stagesFor(cfg, '甲');
  assert.deepEqual(got, [{ 代号: 'P0', 名称: '立项' }, { 代号: 'P1', 名称: '量产' }]);
  assert.deepEqual(stages.stagesFor(cfg, '乙').map((s) => s.代号), ['L0', 'L1', 'L2'], '未覆盖项目走默认');
});

t('模板落盘 + 解析回环：阶段×职能双层结构', () => {
  const root = makeRoot();
  assert.equal(stages.ensureStandards(root), true, '首次落模板');
  assert.equal(stages.ensureStandards(root), false, '已存在不重写');
  const std = stages.parseStandards(root);
  assert.ok(std.L0 && std.L1 && std.L2);
  assert.ok(std.L0.策划.includes('规则闭环'));
  assert.ok(std.L1.程序.includes('测试随行'));
});

t('手工编辑容忍：自定义阶段名/中英冒号/· 列表符都能解析', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, '阶段标准.md'), '# 标准\n## P0 立项\n- 策划: 一页纸立项书\n· 程序：技术可行性 demo\n\n## P1\n- 美术：概念稿三选一\n', 'utf8');
  const std = stages.parseStandards(root);
  assert.equal(std.P0.策划, '一页纸立项书');
  assert.equal(std.P0.程序, '技术可行性 demo');
  assert.equal(std.P1.美术, '概念稿三选一');
});

t('通用软件 Profile 使用 PLAN/BUILD/VERIFY，并落通用角色标准', () => {
  const root = makeRoot();
  const cfg = { profile: 'software-project' };
  assert.deepEqual(stages.stagesFor(cfg, 'X').map((x) => x.代号), ['PLAN', 'BUILD', 'VERIFY']);
  assert.equal(stages.ensureStandards(root, cfg), true);
  const parsed = stages.parseStandards(root);
  assert.ok(parsed.PLAN.orchestrator && parsed.VERIFY.integrator);
});
console.log(`全部通过：${passed} 项`);
