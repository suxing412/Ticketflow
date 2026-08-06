// concurrency.test.js — 并发参数段 config.并发（施工令-010）：读数/硬顶截断/项管调配校验
const assert = require('node:assert');
const C = require('../lib/concurrency');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('concurrency 并发参数段测试（施工令-010）');

t('缺省口径：审检 1（＝旧单槽）、零输出 8 分钟、硬顶 审检 2', () => {
  assert.deepEqual(C.read({}), { 审检: 1, 零输出分钟: 8 });
  assert.equal(C.审检({}), 1);
  assert.equal(C.零输出分钟({}), 8);
  assert.deepEqual(C.硬顶({}), { 审检: 2 });
});

t('显式配额生效；非正整数/垃圾值一律回落默认（不炸不放大）', () => {
  assert.equal(C.审检({ 并发: { 审检: 2 } }), 2);
  assert.equal(C.零输出分钟({ 并发: { 零输出分钟: 15 } }), 15);
  for (const bad of [0, -1, 1.5, 'x', null, {}, []]) {
    assert.equal(C.审检({ 并发: { 审检: bad } }), 1, '坏值 ' + JSON.stringify(bad) + ' 回落 1');
  }
});

t('硬顶是成本保险丝：手改配置越顶也按硬顶截，代码侧绝不放大', () => {
  assert.equal(C.审检({ 并发: { 审检: 99 } }), 2, '越顶按硬顶 2 截');
  assert.equal(C.零输出分钟({ 并发: { 零输出分钟: 99999 } }), C.零输出上限);
});

t('硬顶可由制作人手改 config.并发.硬顶（唯一放大路径）', () => {
  const cfg = { 并发: { 审检: 3, 硬顶: { 审检: 3 } } };
  assert.deepEqual(C.硬顶(cfg), { 审检: 3 });
  assert.equal(C.审检(cfg), 3);
});

t('项管调配：合法改动出 生效 记录 + 新值，不动硬顶字段', () => {
  const cfg = { 并发: { 审检: 1, 硬顶: { 审检: 2 } } };
  const r = C.apply(cfg, { 审检: 2, 零输出分钟: 12 }, { codex: 1, claude: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.并发, { 审检: 2, 零输出分钟: 12 });
  assert.equal(r.生效.length, 2);
  assert.ok(r.生效.some((v) => v.摘 === '审检并发 1 → 2'));
  C.write(cfg, r.并发);
  assert.equal(C.审检(cfg), 2);
  assert.deepEqual(cfg.并发.硬顶, { 审检: 2 }, '写回不吞硬顶字段');
});

t('越硬顶拒绝（端点据此 400）：审检与池各自把关', () => {
  const cfg = { 并发: {} };
  const a = C.apply(cfg, { 审检: 3 }, {});
  assert.equal(a.ok, false); assert.equal(a.越顶, true);
  assert.ok(/越硬顶 2/.test(a.error), a.error);
  const b = C.apply(cfg, { 池: { codex: 99 } }, { codex: 1 });
  assert.equal(b.ok, false); assert.equal(b.越顶, true);
  assert.ok(/越硬顶 3/.test(b.error), b.error);
  assert.equal(C.审检(cfg), 1, '拒绝的改动不落地');
});

t('项管改不动硬顶：带 硬顶 字段的改动直接拒', () => {
  const r = C.apply({ 并发: {} }, { 硬顶: { 审检: 9 } }, {});
  assert.equal(r.ok, false);
  assert.ok(/仅制作人可改/.test(r.error), r.error);
});

t('池并发：合法值出新值（写回台账由端点做），未知池/坏值拒', () => {
  const cfg = { 并发: {} };
  const ok = C.apply(cfg, { 池: { codex: 2 } }, { codex: 1, claude: 2 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.池, { codex: 2, claude: 2 }, '只动点名的池，其余原样');
  assert.ok(ok.生效.some((v) => v.项 === '池·codex'));
  assert.equal(C.apply(cfg, { 池: { 火星池: 1 } }, {}).ok, false);
  assert.equal(C.apply(cfg, { 池: { codex: 0 } }, {}).ok, false);
  assert.deepEqual(C.池硬顶(), require('../lib/pm/dispatch').HARD_CAP, '池硬顶与调度同一把尺');
});

t('空改动/无变化一律拒（不写空账，不刷无意义 journal）', () => {
  const cfg = { 并发: { 审检: 2, 硬顶: { 审检: 2 } } };
  assert.equal(C.apply(cfg, {}, {}).ok, false);
  assert.equal(C.apply(cfg, null, {}).ok, false);
  assert.equal(C.apply(cfg, { 审检: 2 }, {}).ok, false, '与现值一致＝无变化');
});

t('聚合快照 view：审检/零输出在 config、池并发在台账，一处看得全', () => {
  const v = C.view({ 并发: { 审检: 2 } }, { codex: 1, claude: 2 });
  assert.deepEqual(v.并发, { 审检: 2, 零输出分钟: 8 });
  assert.deepEqual(v.硬顶, { 审检: 2 });
  assert.deepEqual(v.池并发, { codex: 1, claude: 2 });
  assert.ok(v.池硬顶.codex >= 1);
});

console.log(`全部通过：${passed} 项`);
