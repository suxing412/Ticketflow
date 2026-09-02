// draft-bounce.test.js — 待审打回：G21 宣告了却一直没有实现的那颗钮（2026-08-28）
//
// 案源（四张实证，卡在待审 30~79 小时）：TF-3 / TF-6 / TF-14 / TK-213。
// 四张全是起草解析器腰斩的残稿——断点都在代码围栏将开处（「主口：」「单一出口：」），
// 根因今日已修（brain.js 改为「区间内最后一个围栏才收口」）。TF-14 连「验收标准」整章都没有。
//
// 这四张的处境是本仓提案里那个病的教科书例：
//   · **不能审过**——没有验收标准的单不可审，判官拿什么判过与不过；
//   · **不该废弃**——需求是真的（起草链确实缺那道预检闸），废掉等于把需求也扔了；
//   · 于是一条出路都没有，而 G21 闸表上明明写着「审过/打回」两颗钮。
//
// 更难看的一笔：今日补 核查打回 时，lifecycle.js 那段注释里写下「与 G21 那处同型，
// 本次一并按同一取向补上实现」——然后只做了核查那一半。**在注释里宣告一件没发生的事。**
// 本文件是那笔的偿还，也是它的判据。
//
// 落点为什么是 废弃 而不是 归档：`待审` 的合法出边只有 废弃 与 待派（store.isLegal 实测），
// 加 待审→归档 是改 H108 状态机、属协议动作。故走废弃边，
// 但用 fm.打回重拆 把「稿子废了、需求没废」这件事写死——判据面第 ③ 条盯的就是它。
const assert = require('node:assert');
const life = require('../lib/lifecycle');
const store = require('../lib/core/store');
const { makeRoot, seed } = require('./helper');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('draft-bounce 待审打回（G21 空钮案）');

t('① 待审单可打回 → 落废弃，且带得走说明', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'B-1', title: '起草落盘前置校验闸' });
  const r = life.待审打回(root, 'B-1', '正文断在「单一出口：」，无验收标准章，不可审');
  assert.equal(r.ok, true, '待审单必须能打回——原样这里根本没有这个函数');
  const t2 = store.find(root, 'B-1');
  assert.equal(t2.state, '废弃', '落点＝废弃（待审无归档边）');
  assert.match(t2.fm.废弃因, /打回重拆/, '废弃因要标明这是打回不是拉闸');
  assert.match(t2.body, /## 待审打回/, '说明要进正文——重拆那一轮读的是正文，写进 fm 等于说给自己听');
  assert.match(t2.body, /单一出口/, '说明原文要在');
});

t('② 不给说明就打不回（不说为什么，重拆那一轮只能靠猜）', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'B-2', title: 'x' });
  for (const 空 of [undefined, '', '   ']) {
    const r = life.待审打回(root, 'B-2', 空);
    assert.equal(r.ok, false, `说明为 ${JSON.stringify(空)} 时必须拒绝`);
    assert.match(r.error, /说明/);
  }
  assert.equal(store.find(root, 'B-2').state, '待审', '拒绝了就不许动单');
});

t('③ 打回 ≠ 普通废弃：fm.打回重拆 立起来，需求没跟着稿子一起死', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'B-3', title: 'x' });
  seed(root, '待审', { id: 'B-4', title: 'y' });
  life.待审打回(root, 'B-3', '残稿，重拆');
  life.废弃(root, 'B-4', '需求本身不成立');
  assert.equal(store.find(root, 'B-3').fm.打回重拆, true, '打回要立这面旗——它是「稿废需求不废」的唯一凭据');
  assert.ok(!store.find(root, 'B-4').fm.打回重拆, '普通废弃不许立这面旗，否则两者分不开');
});

t('④ 非待审态一律拒绝（打回是切单审的动作，不是万能出口）', () => {
  const root = makeRoot();
  for (const s of ['待派', '在途', '核查', '完成']) {
    const id = 'B-s-' + s;
    seed(root, s, { id, title: 'x' });
    const r = life.待审打回(root, id, '理由');
    assert.equal(r.ok, false, `${s} 态不该能走待审打回`);
    assert.match(r.error, /待审/);
    assert.equal(store.find(root, id).state, s, '拒绝了就不许动单');
  }
});

t('⑤ 依赖悬空要喊出来（有单挂着它，打回后那条依赖就断了）', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'B-5', title: 'x' });
  seed(root, '待派', { id: 'B-6', title: 'y', 依赖: 'B-5' });
  const r = life.待审打回(root, 'B-5', '残稿重拆');
  assert.equal(r.ok, true);
  const 流水 = require('fs').readFileSync(
    require('path').join(root, 'journal', new Date().toISOString().slice(0, 7) + '.log'), 'utf8');
  assert.match(流水, /B-5[\s\S]*依赖悬空[\s\S]*B-6|依赖悬空：B-6/,
    '悬空的下游单号要落流水——静默断链正是本仓反复栽过的坑');
});

t('⑥ 悬空扫描是共用的一份：废弃与打回看见同一批下游（两把尺就会改一处漏一处）', () => {
  const 造 = (动作) => {
    const root = makeRoot();
    seed(root, '待审', { id: 'X', title: 'x' });
    for (const [id, st] of [['D1', '待派'], ['D2', '在途'], ['D3', '已排期'], ['D4', '挂起']]) {
      seed(root, st, { id, title: id, 依赖: 'X' });
    }
    动作(root);
    return require('fs').readFileSync(
      require('path').join(root, 'journal', new Date().toISOString().slice(0, 7) + '.log'), 'utf8');
  };
  const 甲 = 造((root) => life.待审打回(root, 'X', '残稿'));
  const 乙 = 造((root) => life.废弃(root, 'X', '不做了'));
  for (const d of ['D1', 'D2', 'D3', 'D4']) {
    assert.match(甲, new RegExp(d), `打回要扫到 ${d}`);
    assert.match(乙, new RegExp(d), `废弃要扫到 ${d}`);
  }
});

console.log(`全部通过：${passed} 项`);
