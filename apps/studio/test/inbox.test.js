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

t('要人动手的一律不许静音（零派发/零输出/打点停滞必须进信箱）', () => {
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

console.log('全部通过：' + passed + ' 项');
