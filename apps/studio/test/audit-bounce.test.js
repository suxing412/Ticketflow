// audit-bounce.test.js — 核查打回：初检不过的单原本无路可走（2026-08-28 TF-15 案）
//
// 案源：TF-15 第三轮初检判「不过」（回执没逐条应答验收标准），runner 只写 fm.初检 与一行流水
// 「留核查（返修或人工裁）」，单**原地留在核查**。而——
//   · 深检挑单要求 `fm.初检.结论 === '过'`
//   · 初检本身只挑 `!fm.初检` 的单
// 于是这张单既不会被深检捡走、也不会被初检重判，**永远蹲在核查里**。
// 核查态对外只暴露了 实证放行（还要求已盖 H97 候检印），其余出边只有废弃——
// 流水许诺的那两条路当时一条都不存在。**闸表宣告了一个点了没反应的按钮**。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const life = require('../lib/lifecycle');
const store = require('../lib/core/store');
const { makeRoot, seed, 收尾 } = require('./helper');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('audit-bounce 核查打回（TF-15 案）');

const 造 = (id, extra = {}) => {
  const root = makeRoot();
  seed(root, '核查', { id, 初检: { 结论: '不过', 缺项: ['逐条应答'] }, ...extra });
  return root;
};

t('核查→在途：初检不过的单终于有路可走', () => {
  const root = 造('A-1');
  const r = life.核查打回(root, 'A-1', '回执补齐十一条逐条应答；产出与代码不必再动');
  assert.equal(r.ok, true, '实得：' + JSON.stringify(r));
  assert.equal(store.find(root, 'A-1').state, '在途');
});

t('两枚章必须一起销——不销，回炉一轮照旧卡在同一个坑', () => {
  const root = 造('A-2', { 代核: { 结论: '通过' } });
  life.核查打回(root, 'A-2', '补逐条应答');
  const fm = store.find(root, 'A-2').fm;
  assert.equal(fm.初检, undefined, '初检章不销，重跑时初检只挑无章的单，它照旧被跳过');
  assert.equal(fm.代核, undefined, '代核章不销，深检也不会再捡它');
});

t('自修次数归零：回炉是人给的新起点，不清则回来一次不过即三振', () => {
  const root = 造('A-3', { 自修次数: 2 });
  life.核查打回(root, 'A-3', '补逐条应答');
  assert.equal(store.find(root, 'A-3').fm.自修次数, 0);
});

t('说明写进正文——执行会话读的是正文，只落 fm 等于说给自己听', () => {
  const root = 造('A-4');
  life.核查打回(root, 'A-4', '只补回执的自测结果一节，十一条逐条应答');
  const body = store.find(root, 'A-4').body;
  assert.match(body, /## 核查打回/, '要有自己的段落，便于回炉那一轮一眼看到');
  assert.match(body, /十一条逐条应答/, '说明原文必须在正文里');
});

t('说明必填：不说为什么打回，回炉那一轮只能靠猜', () => {
  const root = 造('A-5');
  const r = life.核查打回(root, 'A-5', '   ');
  assert.equal(r.ok, false);
  assert.match(r.error, /说明/);
  assert.equal(store.find(root, 'A-5').state, '核查', '拒了就不许动窝');
});

t('非核查态一律拒（打回是审检链上的边，不是万用退格键）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'A-6' });
  const r = life.核查打回(root, 'A-6', '试试');
  assert.equal(r.ok, false);
  assert.match(r.error, /只有核查中单/);
});

t('留痕：流水说得出打回了什么单、因为什么', () => {
  const root = 造('A-7');
  life.核查打回(root, 'A-7', '补齐逐条应答');
  let 流水 = '';
  for (const f of fs.readdirSync(path.join(root, 'journal'))) 流水 += fs.readFileSync(path.join(root, 'journal', f), 'utf8');
  assert.match(流水, /核查打回 A-7/);
  assert.match(流水, /补齐逐条应答/, '因由要进流水——只写「打回了」，事后查不出为什么');
});

收尾('audit-bounce', passed);
