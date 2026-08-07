// preflight.test.js — 定稿预检（H62 拦截项）+ 短题制警示（H83，施工令-002）
// 短题制铁律：标题超长/含枚举符只警示，绝不进 errs——老单与在途单不能被新纪律锁死。
const assert = require('node:assert');
const store = require('../lib/core/store');
const { preflight, warnings, titleWarnings, 职能表, 基础职能 } = require('../lib/preflight');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('preflight 定稿预检 + 短题制警示测试（H62/H83）');
const CFG = { 执行器: { 执行超时分钟: 30 } };
const 正文 = '## 范围\n做事\n## 验收标准\n□ 做完';

t('标题 >24 字 → 警示（不进拦截项）', () => {
  const root = makeRoot();
  const 长题 = '监制台工单卡片标题短题制与工程队状态卡兜底改造施工';
  assert.ok([...长题].length > 24, '样例标题确实超 24 字');
  seed(root, '草稿', { id: 'W-1', title: 长题, 职能: '程序', 优先级: 'P1', QA: '关', 验收方式: '委托', body: 正文 });
  const tk = store.find(root, 'W-1');
  const w = warnings(tk);
  assert.equal(w.length, 1, '产生一条警示');
  assert.ok(/超 24/.test(w[0]), '警示点名字数超限：' + w[0]);
  assert.deepEqual(preflight(root, tk, CFG), [], '不拦截：拦截项为空');
});

t('标题含 ①② 类枚举符 → 警示（不进拦截项）', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'W-2', title: '短题制①源头②预检', 职能: '程序', 优先级: 'P1', QA: '关', 验收方式: '委托', body: 正文 });
  const tk = store.find(root, 'W-2');
  const w = warnings(tk);
  assert.equal(w.length, 1);
  assert.ok(/枚举符/.test(w[0]), '警示点名枚举符：' + w[0]);
  assert.deepEqual(preflight(root, tk, CFG), [], '不拦截');
});

t('两条同时命中 → 两条警示，仍不拦截', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'W-3', title: '监制台工单卡片标题①短题制与②工程队状态卡兜底改造', 职能: '程序', 优先级: 'P1', QA: '关', 验收方式: '委托', body: 正文 });
  const tk = store.find(root, 'W-3');
  assert.equal(warnings(tk).length, 2);
  assert.deepEqual(preflight(root, tk, CFG), []);
});

t('合规短标题 → 零警示', () => {
  assert.deepEqual(titleWarnings('海岸线钉零与衰减'), []);
  assert.deepEqual(titleWarnings('短题制与工程队状态卡'), []);
  assert.deepEqual(titleWarnings(''), [], '空标题不由短题制管（另有字段校验）');
});

t('短题制警示适用全部单型：专项父单不预检但照样出警示', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'W-4', title: '监制台工单卡片标题短题制与工程队状态卡兜底改造施工', 父单类型: '专项', 职能: '无此职能', body: '' });
  const tk = store.find(root, 'W-4');
  assert.deepEqual(preflight(root, tk, CFG), [], '专项父单不预检（既有行为不变）');
  assert.equal(warnings(tk).length, 1, '短题制不放过父单');
});

t('H62 拦截项未被改动：非标字段照旧拦截', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'W-5', title: '短题', 职能: '产品', 优先级: 'P9', QA: '是', 验收方式: '自动', body: '## 范围\n无验收章' });
  const errs = preflight(root, store.find(root, 'W-5'), CFG);
  assert.ok(errs.length >= 5, '职能/优先级/QA/验收方式/缺验收标准 全部命中，实得 ' + errs.length + ' 条');
});

// ---- H88：职能校验改读 roster 活编制表（施工令-014 第 4 条）----
// 病灶：职能表曾是 preflight.js 里一行写死的五者，新增职能必须回来改代码才放得过。
const 编制CFG = (职能列) => ({ 执行器: { 执行超时分钟: 30 }, 编制: 职能列.map((职能) => ({ 职能, 池序: [{ 池: 'claude', 档: '' }] })) });
const 新职能单 = (root, id) => {
  seed(root, '草稿', { id, title: '方案单接线', 职能: '技术策划', 优先级: 'P1', QA: '开', 验收方式: '委托', body: 正文 });
  return store.find(root, id);
};

t('编制表含新职能（技术策划）→ 预检放行，零改代码', () => {
  const root = makeRoot();
  const tk = 新职能单(root, 'W-6');
  const cfg = 编制CFG(['策划', '技术策划', '程序', '美术', 'QA', '装配']);
  assert.deepEqual(preflight(root, tk, cfg), [], '编制表里有就该过，实得：' + preflight(root, tk, cfg).join('｜'));
});

t('编制表不含该职能 → 照旧拦截（闸没被拆）', () => {
  const root = makeRoot();
  const tk = 新职能单(root, 'W-7');
  const errs = preflight(root, tk, 编制CFG(['策划', '程序', '美术', 'QA', '装配']));
  assert.equal(errs.length, 1, '只该命中职能一条，实得：' + errs.join('｜'));
  assert.ok(/不在编制表/.test(errs[0]) && /TK-82 案/.test(errs[0]), '报错文案保留可定位串：' + errs[0]);
  assert.ok(/技术策划/.test(errs[0]), '报错点名被拦的职能：' + errs[0]);
});

t('编制表读不出（cfg 无编制）→ 回落基础六职能，不 fail-close 拦死全场', () => {
  const root = makeRoot();
  const tk = 新职能单(root, 'W-8');
  assert.deepEqual(preflight(root, tk, { 执行器: { 执行超时分钟: 30 } }), [], '无编制字段时不该拦');
  assert.deepEqual(职能表(null), 基础职能, '空 cfg 回落基础表');
  assert.deepEqual(职能表({ 编制: [] }), 基础职能, '空编制表也回落，不是「零职能全拦」');
});

t('编制表是唯一数据源：旧 agents 岗位册也认（roster 推导口径一致）', () => {
  const root = makeRoot();
  const tk = 新职能单(root, 'W-9');
  const 旧盘 = { 执行器: { 执行超时分钟: 30 }, agents: [{ id: '技术策划-A', 职能: '技术策划', 执行池: 'claude' }] };
  assert.deepEqual(preflight(root, tk, 旧盘), [], '旧字段 cfg 经 roster.read 推导后照样放行');
});

console.log('全部通过：' + passed + ' 项');
