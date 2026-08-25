// draft-ownership.test.js — 受托起草归属透传（2026-08-26 假 100% 案）
//
// 案发：受托起草只透传 粒ID/依赖，归属档一档不落 → 孵化单在工单页管线聚合里集体失踪，
// 分母只剩老单，四条管线齐报 99-100% 落袋。修法：粒.上级（F/S/P 前缀）翻直接归属档随起草落盘。
// 判据面：①归属自上级 三前缀映射＋异形返 null（不硬造归属——为图造数红线）
// ②draftFm 注入落档 ③注入盖过模型自填 ④无归属不添档（散单口径）。
const assert = require('node:assert');

process.env.STUDIO_STUB = '1';
const B = require('../lib/pm/brain');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('受托起草归属透传测试（2026-08-26 假 100% 案）');

t('① 归属自上级：F→特性 / S→专项 / P→管线，异形与空一律 null', () => {
  assert.deepEqual(B.归属自上级('F-9'), { 特性: 'F-9' });
  assert.deepEqual(B.归属自上级('S-3'), { 专项: 'S-3' });
  assert.deepEqual(B.归属自上级('P-1'), { 管线: 'P-1' });
  assert.equal(B.归属自上级(''), null);
  assert.equal(B.归属自上级(null), null);
  assert.equal(B.归属自上级('X-1'), null, '认不出的前缀不硬造归属');
  assert.equal(B.归属自上级('F-'), null);
});

const tk = { fm: { title: '题', 职能: '程序' }, body: '' };

t('② draftFm 带归属：直接归属档落 fm', () => {
  const fm = B.draftFm(tk, { id: 'TK-9', 项目: 'TK', 粒ID: 'g-1', 依赖: null, 归属: { 专项: 'S-3' } });
  assert.equal(fm.专项, 'S-3');
  assert.equal(fm.粒ID, 'g-1');
});

t('③ 注入盖过模型自填：排程台账是归属事实源', () => {
  const 自填 = { fm: { title: '题', 职能: '程序', 管线: 'P-9' }, body: '' };
  const fm = B.draftFm(自填, { id: 'TK-9', 项目: 'TK', 粒ID: 'g-1', 依赖: null, 归属: { 管线: 'P-1' } });
  assert.equal(fm.管线, 'P-1', '委托注入的归属必须盖过模型自填');
});

t('④ 无归属不添档：散单/无上级粒照旧', () => {
  const fm = B.draftFm(tk, { id: 'TK-9', 项目: 'TK', 粒ID: 'g-1', 依赖: null, 归属: null });
  assert.equal(fm.专项, undefined);
  assert.equal(fm.特性, undefined);
  assert.equal(fm.管线, undefined);
});

console.log('全部通过：' + passed + ' 项');
