// patrol.test.js — 巡检零派发告警（H81）：就绪有单 + 连续零派发零执行 → 呼叫队列告警
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

t('就绪有单 + 连续两个周期零派发零执行 → 呼叫队列告警（含滞留单号）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'Z-1', 职能: '程序', 放行: true });
  seed(root, '待派', { id: 'Z-2', 职能: '策划', 放行: true });
  const r1 = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.deepEqual(r1.就绪.sort(), ['Z-1', 'Z-2'], '就绪盘点＝已放行且依赖就绪的待派单');
  assert.equal(r1.连续零, 1);
  assert.equal(r1.告警, null, '第一个周期只计数不报（≥2 才报）');
  assert.equal(告警数(root), 0);
  const r2 = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.equal(r2.连续零, 2);
  assert.ok(r2.告警, '第二个周期报警');
  assert.ok(r2.告警.includes('Z-1') && r2.告警.includes('Z-2'), '告警含滞留单号清单');
  const 信 = inbox.list(root, 50).filter((e) => e.类型 === '零派发');
  assert.equal(信.length, 1, '呼叫队列落一条');
  assert.equal(信[0].级别, '急');
  assert.ok(ledger.events(root, 50).some((e) => e.类型 === '零派发'), '台账留痕');
});

t('就绪队列空 → 不报（没活干不是故障）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'N-1', 职能: '程序' }); // 未放行不算就绪
  patrol.零派发告警(root, CFG, { 执行中: 0 });
  const r = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.deepEqual(r.就绪, []);
  assert.equal(r.连续零, 0);
  assert.equal(告警数(root), 0);
});

t('有执行中 → 计数归零不报（链条活着）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'B-1', 职能: '程序', 放行: true });
  patrol.零派发告警(root, CFG, { 执行中: 0 });
  const r = patrol.零派发告警(root, CFG, { 执行中: 1 });
  assert.equal(r.连续零, 0);
  assert.equal(告警数(root), 0);
});

t('周期内有新派发 → 计数归零不报（派发在动）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'D-1', 职能: '程序', 放行: true });
  patrol.零派发告警(root, CFG, { 执行中: 0 });
  ledger.event(root, '派发', { id: 'D-9', 池: 'codex' }); // 两次巡检之间派出去过
  const r = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.equal(r.连续零, 0);
  assert.equal(告警数(root), 0);
});

t('依赖未落袋不算就绪 → 不报（不是零派发，是没到点）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'U-1', 职能: '程序' });
  seed(root, '待派', { id: 'W-1', 职能: '程序', 放行: true, 依赖: 'U-1' });
  patrol.零派发告警(root, CFG, { 执行中: 0 });
  const r = patrol.零派发告警(root, CFG, { 执行中: 0 });
  assert.deepEqual(r.就绪, []);
  assert.equal(告警数(root), 0);
});

t('持续滞留不刷屏也不沉默：报过之后按复报间隔再提醒', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'S-1', 职能: '程序', 放行: true });
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

t('曾有打点 + 最后打点 >20 分钟未前进 + tail 无新输出 → 呼叫队列普通级一条', () => {
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

// ---- 零输出看门狗（施工令-010 第 3 条）：案源 TK-102 codex 会话零输出挂死 48 分钟无人察觉 ----
console.log('patrol 零输出看门狗测试（施工令-010）');
const 零输出数 = (root) => inbox.list(root, 200).filter((e) => e.类型 === '零输出').length;
const 执session = (id, o = {}) => ({ id, kind: '执行', 池: o.池 || 'codex', startedAt: new Date(T0).toISOString(), tail: o.tail || '', 收字节: o.收字节 || 0 });

t('零输出超时 → 呼叫队列急件一条，含单号 / 池 / 已历时', () => {
  const root = makeRoot();
  patrol.重置(root);
  const r0 = patrol.零输出(root, CFG, { 执行中: [执session('Z-1')], now: 分(7) });
  assert.equal(r0.告警.length, 0, '门槛 8 分钟内不报');
  const r1 = patrol.零输出(root, CFG, { 执行中: [执session('Z-1')], now: 分(9) });
  assert.equal(r1.告警.length, 1, '过门槛才报');
  assert.ok(r1.告警[0].includes('Z-1'), '含单号');
  assert.ok(r1.告警[0].includes('codex'), '含池');
  assert.ok(/9 分钟/.test(r1.告警[0]), '含已历时：' + r1.告警[0]);
  const 信 = inbox.list(root, 50).filter((e) => e.类型 === '零输出');
  assert.equal(信.length, 1);
  assert.equal(信[0].级别, '急', '零输出＝疑似挂死，走急件');
  assert.equal(信[0].单号, 'Z-1');
  const ev = ledger.events(root, 50).filter((e) => e.类型 === '零输出');
  assert.equal(ev.length, 1); assert.equal(ev[0].单, 'Z-1'); assert.equal(ev[0].已历时分, 9);
});

t('有输出不报：tail 有字 / 只在 stderr 收到字节（codex 常态）都算活着', () => {
  const root = makeRoot();
  patrol.重置(root);
  patrol.零输出(root, CFG, { 执行中: [执session('Z-2', { tail: '正在读工单…' })], now: 分(60) });
  assert.equal(零输出数(root), 0, 'tail 有字不报');
  // 施工令-010 第 5 条：codex 过程行全走 stderr——收字节 >0 即活性，tail 就算一时为空也不误报
  patrol.零输出(root, CFG, { 执行中: [执session('Z-3', { 收字节: 512 })], now: 分(60) });
  assert.equal(零输出数(root), 0, 'stderr-only 会话不误报');
});

t('同一会话只报一次；会话收场即忘（同单重投＝新会话，重新武装）', () => {
  const root = makeRoot();
  patrol.重置(root);
  for (const m of [9, 20, 48, 90]) patrol.零输出(root, CFG, { 执行中: [执session('Z-4')], now: 分(m) });
  assert.equal(零输出数(root), 1, '四轮巡检只报一次');
  const r = patrol.零输出(root, CFG, { 执行中: [], now: 分(120) });
  assert.deepEqual(r.盯守, [], '会话收场即忘');
  // 同单重投：startedAt 变了就是新会话，重新武装
  patrol.零输出(root, CFG, { 执行中: [{ id: 'Z-4', kind: '执行', 池: 'codex', startedAt: new Date(分(120)).toISOString(), tail: '' }], now: 分(140) });
  assert.equal(零输出数(root), 2, '新会话重新武装');
});

t('门槛读 config.并发.零输出分钟；判官会话与无时间戳会话不适用', () => {
  const root = makeRoot();
  patrol.重置(root);
  const cfg20 = { ...CFG, 并发: { 零输出分钟: 20 } };
  patrol.零输出(root, cfg20, { 执行中: [执session('Z-5')], now: 分(15) });
  assert.equal(零输出数(root), 0, '配额调到 20 分钟后 15 分钟不报');
  patrol.零输出(root, cfg20, { 执行中: [执session('Z-5')], now: 分(21) });
  assert.equal(零输出数(root), 1);
  patrol.重置(root);
  const root2 = makeRoot();
  patrol.零输出(root2, CFG, { 执行中: [{ id: 'J-9', kind: '代核', startedAt: new Date(T0).toISOString(), tail: '' }], now: 分(99) });
  patrol.零输出(root2, CFG, { 执行中: [{ id: 'N-9', kind: '执行', tail: '' }], now: 分(99) });
  assert.equal(零输出数(root2), 0, '判官会话/无拉起时间戳一律不适用');
});

// ── 议程第 34 条：队列空时的盲区（2026-08-28 补）──
//
// 盲区案源（2026-08-27 整夜）：十一粒排到点，而十一张待派单全部 放行=false。
// 就绪队列**恰恰是空的**，原判据第一条就判「队列本来就空」计数归零，整夜零告警。
// 原始案源（2026-08-06）盯的是「已放行单滞留」，看不见「排期到点却从未放行」这个变种。

t('第34条·队列空但有到点粒卡在放行侧 → 照报（原判据在这一路上是瞎的）', () => {
  const root = makeRoot();
  patrol.重置(root);
  seed(root, '待派', { id: 'K-1', 职能: '程序' });        // 未放行 → 不进就绪面
  const 卡 = [{ 单: 'K-1', 粒: 'g1', 计划开始: '2026-08-27T23:30' }];
  const r = patrol.零派发告警(root, CFG, { 执行中: 0, 到点无单: 卡 });
  assert.equal(r.就绪.length, 0, '就绪面本来就是空的——这正是原判据看不见它的原因');
  assert.ok(r.告警, '队列空 + 有到点粒卡放行侧 = 必须报，不许判「本来就空」了事');
  assert.match(r.告警, /到点无单可派/);
  assert.match(r.告警, /K-1/, '要点名是哪张单卡着');
  assert.equal(inbox.list(root, 200).filter((e) => e.类型 === '到点无单').length, 1, '进急件');
  assert.ok(ledger.events(root, 50).some((e) => e.类型 === '到点无单'), '台账留痕');
});

t('第34条·同一批单只在集合变化时报一次（15 分钟一拍不许喊三十遍）', () => {
  const root = makeRoot();
  patrol.重置(root);
  seed(root, '待派', { id: 'K-2', 职能: '程序' });
  const 卡 = [{ 单: 'K-2', 粒: 'g2', 计划开始: '2026-08-27T23:30' }];
  const a1 = patrol.零派发告警(root, CFG, { 执行中: 0, 到点无单: 卡 });
  const a2 = patrol.零派发告警(root, CFG, { 执行中: 0, 到点无单: 卡 });
  assert.ok(a1.告警, '首次报');
  assert.equal(a2.告警, null, '同一批不重复喊——喊多了就没人看了');
  const a3 = patrol.零派发告警(root, CFG, { 执行中: 0,
    到点无单: [...卡, { 单: 'K-3', 粒: 'g3', 计划开始: '2026-08-27T23:45' }] });
  assert.ok(a3.告警, '集合变化要重报——多卡一张是新信息');
});

t('第34条·无卡放行单时不误报（边界：传空数组）', () => {
  const root = makeRoot();
  patrol.重置(root);
  const r = patrol.零派发告警(root, CFG, { 执行中: 0, 到点无单: [] });
  assert.equal(r.告警, null, '没有卡放行的单就不该报此类告警');
  assert.equal(inbox.list(root, 200).filter((e) => e.类型 === '到点无单').length, 0);
});

// ── 议程第 35 条：复判诊断对但只记账不升级（2026-08-28 补）──
//
// 案源 2026-08-27 整夜：复判**诊断没错**——00:07 收官原话「空转属派发侧未拉起而非排期偏差」——
// 但它只往 journal 写一行就完事，15 分钟一轮连报四次，无人知晓，产线整夜零产出。
// **能正确判出病因、却没有任何途径把病因交出去，等于没诊断。**
// 这是「判了没人执行」在监控层的第四例。

t('第35条·复判判出非排期因 → 升格进急件与台账，不只是记一行流水', () => {
  const root = makeRoot();
  patrol.重置(root);
  const r = patrol.升格非排期空转(root, '空转属派发侧未拉起而非排期偏差');
  assert.equal(r.升, true, '首次必须升格');
  assert.match(r.文, /非排期/);
  assert.match(r.文, /复判只会重排/, '要说清为什么复判自己解不了这一类');
  assert.equal(inbox.list(root, 200).filter((e) => e.类型 === '空转非排期').length, 1, '进急件——只写 journal 就是原病');
  assert.ok(ledger.events(root, 50).some((e) => e.类型 === '空转非排期'), '台账留痕');
});

t('第35条·同一因由只升一次（复判是循环触发的，不去重就成新的刷屏源）', () => {
  const root = makeRoot();
  patrol.重置(root);
  const a = patrol.升格非排期空转(root, '空转属派发侧未拉起而非排期偏差');
  const b = patrol.升格非排期空转(root, '空转属派发侧未拉起而非排期偏差');
  assert.equal(a.升, true);
  assert.equal(b.升, false, '同一因由不重复升——否则从「漏报」翻到另一头去了');
  assert.equal(inbox.list(root, 200).filter((e) => e.类型 === '空转非排期').length, 1);

  // 因由变了要重升：那是新信息
  const c = patrol.升格非排期空转(root, '九张单全部停靠，堵在制作人定夺');
  assert.equal(c.升, true, '换了因由要重升');
  assert.equal(inbox.list(root, 200).filter((e) => e.类型 === '空转非排期').length, 2);
});

// ── 去重键取结构不取措辞（2026-08-28 15:2x 实测案）────────────────────────────
// 上面那条「同一因由只升一次」用的是**逐字节相同的字符串**——而生产里的 因 是复判会话
// 现写的散文，两轮之间永远不会字节相同。于是那条判据测的是一个不可能发生的情形：
// 它绿着，真 bug 照样上线，十五分钟两封急件。**判据要挑真会发生的输入，否则绿得没有意义。**
// 下面四条用今天那两封急件的原文当标本。

const 空转数 = (root) => inbox.list(root, 200).filter((e) => e.类型 === '空转非排期').length;

t('真标本回归·同一局面换个说法，不许再喊一封（06:39 与 06:54 两封急件原文）', () => {
  const root = makeRoot();
  patrol.重置(root);
  const 甲 = '停靠粒挪不动、待派粒卡在放行侧，且全表实起实完为 null，无偏差证据';
  const 乙 = '无实起实完可读，偏差不可断言；停靠粒等裁决、放行=false待派粒卡在放行侧，均非排期问题';
  assert.notEqual(甲, 乙, '前提：两句措辞确实不同，否则这条判据退化成上面那条');
  const a = patrol.升格非排期空转(root, 甲);
  const b = patrol.升格非排期空转(root, 乙);
  assert.equal(a.升, true, '首封要喊');
  assert.equal(b.升, false, '同一局面（都是 停靠+放行 堵着）换个说法不许再喊——原样这里会喊第二封');
  assert.equal(空转数(root), 1, '信箱里只该有一封');
});

t('真标本回归·堵点真换了一类才重喊（停靠 → 无单可派）', () => {
  const root = makeRoot();
  patrol.重置(root);
  patrol.升格非排期空转(root, '九张单全部停靠，堵在制作人定夺');
  const c = patrol.升格非排期空转(root, '队列空了，无单可派');
  assert.equal(c.升, true, '换了一类堵点是新信息，该喊');
  assert.equal(空转数(root), 2);
});

t('非排期因类一个都不命中 → 不升格（不是所有空转都归这条闸管）', () => {
  const root = makeRoot();
  patrol.重置(root);
  const r = patrol.升格非排期空转(root, '排期偏差过大，计划开始普遍早于实起');
  assert.equal(r.升, false, '这句讲的是排期本身的锅，不该走「非排期」这条升格口');
  assert.equal(空转数(root), 0, '不该有急件');
});

t('两把尺合一·词表里每一个因类都真能被判出来（调用侧与去重键同读一份）', () => {
  assert.ok(patrol.空转因类.length >= 5, '词表要导出且非空——调用侧靠它判要不要升格');
  for (const w of patrol.空转因类) {
    assert.deepEqual(patrol.非排期空转类('本轮空转因由：' + w), [w],
      `词表里的「${w}」必须被判出来——判定另写一份就是两把尺，改一处漏一处`);
  }
});

console.log(`全部通过：${passed} 项`);
