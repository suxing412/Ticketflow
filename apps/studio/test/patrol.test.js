// patrol.test.js — 巡检零派发告警（H81）：就绪有单 + 连续零派发零执行 → 呼叫信箱告警
// 案源 2026-08-06：换装后暂停闸漏开，四张放行单滞留 9.5 小时零派发零告警。
const assert = require('node:assert');
const patrol = require('../lib/pm/patrol');
const ledger = require('../lib/pm/ledger');
const inbox = require('../lib/inbox');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('patrol 巡检零派发告警测试（H81）');
const CFG = { 执行器: { 派发制: true } };
const 告警数 = (root) => inbox.list(root, 200).filter((e) => e.类型 === '零派发').length;

t('就绪有单 + 连续两个周期零派发零执行 → 信箱告警（含滞留单号）', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'Z-1', 职能: '程序', 放行: true });
  seed(root, '待投', { id: 'Z-2', 职能: '策划', 放行: true });
  const r1 = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.deepEqual(r1.就绪.sort(), ['Z-1', 'Z-2'], '就绪盘点＝已放行且依赖就绪的待投单');
  assert.equal(r1.连续零, 1);
  assert.equal(r1.告警, null, '第一个周期只计数不报（≥2 才报）');
  assert.equal(告警数(root), 0);
  const r2 = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.equal(r2.连续零, 2);
  assert.ok(r2.告警, '第二个周期报警');
  assert.ok(r2.告警.includes('Z-1') && r2.告警.includes('Z-2'), '告警含滞留单号清单');
  const 信 = inbox.list(root, 50).filter((e) => e.类型 === '零派发');
  assert.equal(信.length, 1, '呼叫信箱落一条');
  assert.equal(信[0].级别, '急');
  assert.ok(ledger.events(root, 50).some((e) => e.类型 === '零派发'), '台账留痕');
});

t('就绪队列空 → 不报（没活干不是故障）', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'N-1', 职能: '程序' }); // 未放行不算就绪
  patrol.零派发告警(root, CFG, { 执行中: 0 });
  const r = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.deepEqual(r.就绪, []);
  assert.equal(r.连续零, 0);
  assert.equal(告警数(root), 0);
});

t('有执行中 → 计数归零不报（链条活着）', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'B-1', 职能: '程序', 放行: true });
  patrol.零派发告警(root, CFG, { 执行中: 0 });
  const r = patrol.零派发告警(root, CFG, { 执行中: 1 });
  assert.equal(r.连续零, 0);
  assert.equal(告警数(root), 0);
});

t('周期内有新派发 → 计数归零不报（派发在动）', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'D-1', 职能: '程序', 放行: true });
  patrol.零派发告警(root, CFG, { 执行中: 0 });
  ledger.event(root, '派发', { id: 'D-9', 池: 'codex' }); // 两次巡检之间派出去过
  const r = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.equal(r.连续零, 0);
  assert.equal(告警数(root), 0);
});

t('依赖未落袋不算就绪 → 不报（不是零派发，是没到点）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'U-1', 职能: '程序' });
  seed(root, '待投', { id: 'W-1', 职能: '程序', 放行: true, 依赖: 'U-1' });
  patrol.零派发告警(root, CFG, { 执行中: 0 });
  const r = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.deepEqual(r.就绪, []);
  assert.equal(告警数(root), 0);
});

t('持续滞留不刷屏也不沉默：报过之后按复报间隔再提醒', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'S-1', 职能: '程序', 放行: true });
  const 报 = [];
  for (let i = 0; i < patrol.门槛 + patrol.复报间隔; i++) 报.push(!!patrol.零派发告警(root, CFG, { 执行中: 0 }).告警);
  assert.equal(报.filter(Boolean).length, 2, `${patrol.门槛 + patrol.复报间隔} 个周期内报 2 次（首报 + 一次复报）`);
  assert.equal(告警数(root), 2);
});

// ---- 打点停滞看门狗（施工令-004 追加范围）：打点是软契约，缺席不罚，签了却不动才提醒 ----
console.log('patrol 打点停滞看门狗测试（施工令-004）');
const 停滞数 = (root) => inbox.list(root, 200).filter((e) => e.类型 === '打点停滞').length;
const 会话 = (id, tail) => ({ id, kind: '执行', tail });
const T0 = Date.parse('2026-08-06T10:00:00.000Z');
const 分 = (n) => T0 + n * 60000;

t('曾有打点 + 最后打点 >20 分钟未前进 + tail 无新输出 → 信箱普通级一条', () => {
  const root = makeRoot();
  patrol.重置(root);
  const 尾 = 'building… [进度 2/7 骨架搭好]';
  const r0 = patrol.打点停滞(root, CFG, { 执行中: [会话('S-1', 尾)], now: T0 });
  assert.equal(r0.告警.length, 0, '首次观测只建基线');
  const r1 = patrol.打点停滞(root, CFG, { 执行中: [会话('S-1', 尾)], now: 分(19) });
  assert.equal(r1.告警.length, 0, '未满 20 分钟不报');
  const r2 = patrol.打点停滞(root, CFG, { 执行中: [会话('S-1', 尾)], now: 分(21) });
  assert.equal(r2.告警.length, 1, '超过 20 分钟才报');
  assert.ok(r2.告警[0].includes('S-1') && r2.告警[0].includes('2/7'), '告警含单号与最后打点');
  const 信 = inbox.list(root, 50).filter((e) => e.类型 === '打点停滞');
  assert.equal(信.length, 1);
  assert.equal(信[0].级别, '常', '级别普通不急');
  assert.equal(信[0].单号, 'S-1');
  assert.ok(ledger.events(root, 50).some((e) => e.类型 === '打点停滞'), '台账留痕');
  // 同一次停滞不刷屏
  patrol.打点停滞(root, CFG, { 执行中: [会话('S-1', 尾)], now: 分(40) });
  assert.equal(停滞数(root), 1, '一次停滞只报一次');
});

t('无打点的单不适用本条：跑再久也不报（软契约缺席不判罚）', () => {
  const root = makeRoot();
  patrol.重置(root);
  const 尾 = '一直在输出，但从来没打过点';
  for (const m of [0, 21, 60, 300]) patrol.打点停滞(root, CFG, { 执行中: [会话('N-1', 尾)], now: 分(m) });
  assert.equal(停滞数(root), 0);
});

t('打点前进 → 解除并重新计时，不报', () => {
  const root = makeRoot();
  patrol.重置(root);
  patrol.打点停滞(root, CFG, { 执行中: [会话('P-1', '[进度 1/5 起手]')], now: T0 });
  patrol.打点停滞(root, CFG, { 执行中: [会话('P-1', '[进度 2/5 推进]')], now: 分(15) });
  const r = patrol.打点停滞(root, CFG, { 执行中: [会话('P-1', '[进度 2/5 推进]')], now: 分(30) });
  assert.equal(r.告警.length, 0, '打点在 15 分处前进过，30 分时才停 15 分钟');
  assert.equal(停滞数(root), 0);
});

t('打点没动但 tail 还在吐字 → 不报（会话活着，只是没吆喝）', () => {
  const root = makeRoot();
  patrol.重置(root);
  patrol.打点停滞(root, CFG, { 执行中: [会话('L-1', '[进度 3/9 干着]')], now: T0 });
  patrol.打点停滞(root, CFG, { 执行中: [会话('L-1', '[进度 3/9 干着] 编译中…')], now: 分(15) });
  const r = patrol.打点停滞(root, CFG, { 执行中: [会话('L-1', '[进度 3/9 干着] 编译中… 还在跑')], now: 分(30) });
  assert.equal(r.告警.length, 0);
  assert.equal(停滞数(root), 0);
});

t('非执行会话（判官）与空在跑表不适用：不报不炸', () => {
  const root = makeRoot();
  patrol.重置(root);
  patrol.打点停滞(root, CFG, { 执行中: [{ id: 'J-1', kind: '代核', tail: '[进度 1/3 核着]' }], now: T0 });
  patrol.打点停滞(root, CFG, { 执行中: [{ id: 'J-1', kind: '代核', tail: '[进度 1/3 核着]' }], now: 分(60) });
  const r = patrol.打点停滞(root, CFG, { 执行中: [], now: 分(90) });
  assert.deepEqual(r.盯守, [], '会话收场即忘，不留幽灵');
  assert.equal(停滞数(root), 0);
});

console.log(`全部通过：${passed} 项`);
