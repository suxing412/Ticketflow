// inbox.test.js — 收件箱噪声闸（制作人 2026-08-21 批准）
// 案源：08-20 盘账实测 377 条未读里 122 条是机器心跳（巡检异常 66 + 编辑器占用 56），
// 把真正的人闸通知（专项待签/收口报告/裁决上呈/代核不过/上呈 共 25 条）全埋了。
// 收件箱是「要人动手的事」的册子，不是事件总线。
const assert = require('node:assert');
const fs = require('fs');
const ib = require('../lib/inbox');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('收件箱噪声闸测试');

t('噪声类型不进收件箱，但降级进 journal（不是丢弃，是换地方放）', () => {
  const root = makeRoot();
  const r = ib.post(root, '常', '巡检异常', '某某异常');
  assert.equal(r.ok, true);
  assert.equal(r.降级, true, '如实回报被降级，不假装写进去了');
  assert.equal(ib.list(root).length, 0, '收件箱里没有它');
  const jn = fs.readFileSync(require('path').join(root, 'journal', new Date().toISOString().slice(0, 7) + '.log'), 'utf8');
  assert.match(jn, /降级不入收件箱.*巡检异常/, 'journal 照记——信息不丢');
});

t('两类心跳被拦：巡检异常/编辑器占用（只有这两条是纯系统呼吸）', () => {
  const root = makeRoot();
  for (const k of ['巡检异常', '编辑器占用']) {
    assert.equal(ib.post(root, '常', k, 'x').降级, true, k + ' 该被拦');
  }
  assert.equal(ib.list(root).length, 0);
});

t('要人动手的一律不许静音（零派发/零输出/打点停滞必须进入呼叫队列）', () => {
  // 噪声表收窄过两轮，两轮都是被既有测试打红纠正的：首版误划 零派发/零输出，
  // 二版误划 打点停滞（它带单号，说的是「这一单卡住了」）。判据是「要不要人动手」。
  const root = makeRoot();
  for (const k of ['零派发', '零输出', '打点停滞']) {
    assert.equal(ib.post(root, '急', k, 'x').降级, undefined, k + ' 要人动手，拦了等于静音');
  }
  assert.equal(ib.list(root).length, 3);
});

t('人闸通知照常进（拦的是心跳不是所有东西）', () => {
  const root = makeRoot();
  for (const k of ['专项待签', '收口报告', '裁决上呈', '代核不过', '上呈', '候引擎实证']) {
    assert.equal(ib.post(root, '急', k, 'x').降级, undefined, k + ' 不该被拦');
  }
  assert.equal(ib.list(root).length, 6);
});

t('markRead 只推游标，一行都不删（append-only 纪律）', () => {
  const root = makeRoot();
  ib.post(root, '急', '专项待签', 'a'); ib.post(root, '急', '上呈', 'b');
  const 行前 = fs.readFileSync(ib.FILE(root), 'utf8').split(/\r?\n/).filter(Boolean).length;
  assert.equal(ib.unread(root).length, 2);
  ib.markRead(root);
  const 行后 = fs.readFileSync(ib.FILE(root), 'utf8').split(/\r?\n/).filter(Boolean).length;
  assert.equal(ib.unread(root).length, 0, '标已读后未读清零');
  assert.equal(行后, 行前, '历史行一条不少——已读是水位不是删除');
});

t('标已读之后来的新件照样是未读（水位只管过去）', () => {
  const root = makeRoot();
  ib.post(root, '急', '专项待签', 'old');
  ib.markRead(root);
  const before = Date.now();
  while (Date.now() === before) { /* 跨过同一毫秒，免得新件时刻等于游标 */ }
  ib.post(root, '急', '上呈', 'new');
  assert.equal(ib.unread(root).length, 1);
  assert.equal(ib.unread(root)[0].摘要, 'new');
});


// ---- 未读不许被尾截静默吞掉（2026-08-22 体检 #69）----
// 直接 append 造戳而不是循环 ib.post：post 取 new Date()，600 次会挤在同几毫秒里，
// t 不严格递增，游标线就没法精确压在第 50 条上——判据得是确定的，不能靠时钟分辨率。
const path2 = require('path');
const 造件 = (root, n) => {
  const dir = path2.join(root, '呼叫'); fs.mkdirSync(dir, { recursive: true });
  const 行 = []; const 基 = Date.parse('2026-08-01T00:00:00.000Z');
  for (let i = 1; i <= n; i++) 行.push(JSON.stringify({ t: new Date(基 + i * 1000).toISOString(), 级别: '常', 类型: '人闸', 摘要: '第 ' + i + ' 条' }));
  fs.writeFileSync(path2.join(dir, 'inbox.jsonl'), 行.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
  return (i) => new Date(基 + i * 1000).toISOString();
};

t('未读不许被尾截静默吞掉（600 行、游标压在第 50 条 → 未读 550）', () => {
  const root = makeRoot();
  const 戳 = 造件(root, 600);
  fs.writeFileSync(require('path').join(root, '呼叫', 'cursor.json'), JSON.stringify({ at: 戳(50) }), 'utf8');
  const u = ib.unread(root);
  assert.equal(u.length, 550, '早于游标线但落在末 500 行之外的未读不许被丢（尾截时这里是 500）');
  assert.equal(u[0].摘要, '第 51 条', '最早那条未读必须是第 51 条——是「第 101 条」就说明被尾截切掉了 50 条');
  assert.equal(u[u.length - 1].摘要, '第 600 条', '末条照旧在');
});

t('缺 t 的坏件不许无声消失（undefined > string 恒 false，原样直接吞）', () => {
  const root = makeRoot();
  const 戳 = 造件(root, 3);
  fs.appendFileSync(ib.FILE(root), JSON.stringify({ 级别: '急', 类型: '上呈', 摘要: '没戳的件' }) + String.fromCharCode(10), 'utf8');
  fs.writeFileSync(require('path').join(root, '呼叫', 'cursor.json'), JSON.stringify({ at: 戳(3) }), 'utf8');
  const u = ib.unread(root);
  assert.deepEqual(u.map((e) => e.摘要), ['没戳的件'], '三条已读之外只剩它——它必须被看见，不许因为没有 t 就静默消失');
});

t('尾截不许靠「把常数调大」糊过去（1200 行、游标压在第 100 条 → 未读 1100）', () => {
  // 上一格用 600 行复现原案（末 500 行尾截）。但只钉 600，把上限从 500 改成 1000 就能骗过它，
  // 而病根（有个有限上限、超出静默丢）一个字没动。这一格把「调大常数」这条退路也堵上：
  // 判据钉的是 unread 的**性质**——游标之后有多少就给多少，不是某个具体数字。
  const root = makeRoot();
  const 戳 = 造件(root, 1200);
  fs.writeFileSync(require('path').join(root, '呼叫', 'cursor.json'), JSON.stringify({ at: 戳(100) }), 'utf8');
  const u = ib.unread(root);
  assert.equal(u.length, 1100, '游标之后有多少就该给多少（上限 500 得 500，上限 1000 得 1000，都不对）');
  assert.equal(u[0].摘要, '第 101 条', '最早那条未读必须是第 101 条');
});
console.log('全部通过：' + passed + ' 项');
