// h107-derive.test.js — 四层架构「只记直接上级」的推导链（H107，2026-08-23 制作人补决议号）
//
// 案情：H51 挂载律要求「域内一切工单必挂对应管线」（工单 fm 直写 管线: P-#），
// H107 四层架构要求「只记直接上级、不多处记同一事实」——两条正面冲突。
// 制作人 2026-08-23 裁定：「四层架构应该写历史决议，新决议覆盖旧的」，故 H107 取代 H51 挂载律。
//
// 取代要真成立，读侧必须推得出来：工单 → 专项 → 特性 → 管线。
// 原样 pipelineOf 只顺 父单 链找 管线 字段，推导链一格都用不上——
// 那样摘掉工单的 管线 章就等于丢归属，章程改了代码没跟上，正是本项目账实分叉的老病。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../lib/pipelines');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('H107 归属推导测试');
const NL = String.fromCharCode(10);

function 建(root) {
  const w = (d, id, fm) => {
    const p = path.join(root, d);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, id + '.md'),
      '---' + NL + Object.entries(fm).map(([k, v]) => k + ': ' + v).join(NL) + NL + '---' + NL, 'utf8');
  };
  w('管线', 'P-1', { 名称: '地图管线', 状态: '活跃' });
  w('管线', 'P-2', { 名称: '战斗管线', 状态: '活跃' });
  w('特性', 'F-1', { 名称: '地形编辑', 管线: 'P-1', 状态: '活跃' });
  w('特性', 'F-2', { 名称: '技能系统', 管线: 'P-2', 状态: '活跃' });
  w('专项', 'S-1', { 名称: '手修工具', 特性: 'F-1', 状态: '进行' });
  w('专项', 'S-2', { 名称: '连招', 特性: 'F-2', 状态: '进行' });
  w('专项', 'S-9', { 名称: '无特性层的专项', 管线: 'P-2', 状态: '进行' });
}

t('只记直接上级：工单只写 专项，管线照样推得出来（H107 正路）', () => {
  const root = makeRoot(); 建(root);
  assert.equal(P.pipelineOf({ id: 'TK-1', 专项: 'S-1' }, {}, 10, { root }), 'P-1',
    'S-1→F-1→P-1 这条链必须走得通——走不通，H107 就只是纸面条文');
  assert.equal(P.pipelineOf({ id: 'TK-2', 专项: 'S-2' }, {}, 10, { root }), 'P-2');
});

t('存量兜底：老单直写的 管线 章仍然认（H51 时代满库都是这个写法）', () => {
  const root = makeRoot(); 建(root);
  assert.equal(P.pipelineOf({ id: 'TK-3', 管线: 'P-2' }, {}, 10, { root }), 'P-2',
    '一改章程就全库丢归属，那不是取代是砸账');
});

t('两样都有时以推导为准——推导链才是权威，直写章是冗余副本', () => {
  const root = makeRoot(); 建(root);
  assert.equal(P.pipelineOf({ id: 'TK-4', 专项: 'S-1', 管线: 'P-9' }, {}, 10, { root }), 'P-1',
    '「不多处记同一事实」的意思正是：两处打架时，冗余那份不算数');
});

t('沿父链上溯：子单不记归属，父单记了也算', () => {
  const root = makeRoot(); 建(root);
  const byId = { 'TK-10': { id: 'TK-10', 专项: 'S-2' } };
  assert.equal(P.pipelineOf({ id: 'TK-11', 父单: 'TK-10' }, byId, 10, { root }), 'P-2');
});

t('无特性层的项目形状：专项直挂管线也推得出（H52 不同项目不同形状）', () => {
  const root = makeRoot(); 建(root);
  assert.equal(P.pipelineOf({ id: 'TK-5', 专项: 'S-9' }, {}, 10, { root }), 'P-2');
});

t('什么都没有就是没有——不许瞎猜一个管线出来', () => {
  const root = makeRoot(); 建(root);
  assert.equal(P.pipelineOf({ id: 'TK-6' }, {}, 10, { root }), null);
  assert.equal(P.pipelineOf({ id: 'TK-7', 专项: 'S-不存在' }, {}, 10, { root }), null,
    '专项号查无此项时回 null，不许回落到「第一条管线」之类的臆测');
});

t('切单提示词已随 H107 改口径：不再教项管直写 管线', () => {
  // 这条是文本判据，但它盯的对象**本身就是文本**（发给 agent 的提示词）——
  // 提示词里写什么，agent 就照做什么，没有别的行为面可验。
  const b = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pm', 'brain.js'), 'utf8');
  assert.ok(!b.includes('管线归属必填'),
    'H51 时代那句「管线归属必填…frontmatter 必须写 管线: P-N」必须消失——它还在，每张新单就还在多记一遍');
  assert.ok(b.includes('只记直接上级'), '要正面写出 H107 的口径');
  assert.ok(!b.includes("'管线: <本单所属管线号"), '切单模板不许再留 管线 格');
  assert.ok(b.includes("'专项: <本单所属专项号"), '模板改成记直接上级');
});

console.log('全部通过：' + passed + ' 项');
