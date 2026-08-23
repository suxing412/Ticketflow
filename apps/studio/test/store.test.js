// store.test.js — 目录即状态机（H108 十二态）：建目录/定位/列举/合法转移/旧边拒绝/原子领单/移动钩子
const assert = require('node:assert');
const fs = require('fs');
const store = require('../lib/core/store');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('store 目录即状态机测试');

t('ensureDirs 建齐全部状态目录（12 态）+ 回执 + journal', () => {
  const root = makeRoot();
  assert.equal(store.STATES.length, 12);
  for (const s of ['待审', '待派', '待处理', '待重派', '在途', '初检', '核查', '仲裁', '完成', '归档', '挂起', '废弃']) {
    assert.ok(store.STATES.includes(s), `STATES 缺 ${s}`);
    assert.ok(fs.existsSync(store.stateDir(root, s)), `目录缺 ${s}`);
  }
  assert.ok(fs.existsSync(require('path').join(root, '回执')));
  assert.ok(fs.existsSync(require('path').join(root, 'journal')));
});

t('大态分组齐整：12 态各归其组，TERMINAL=[归档,废弃]', () => {
  assert.deepEqual(store.大态.待办, ['待审', '待派', '待处理', '待重派']);
  assert.deepEqual(store.大态.在途, ['在途', '初检', '核查', '仲裁', '完成']);
  assert.deepEqual(store.大态.结束, ['归档', '挂起', '废弃']);
  assert.equal(store.大态of('初检'), '在途');
  assert.equal(store.大态of('挂起'), '结束');
  assert.equal(store.大态of('池'), null, '旧态名不在任何大态');
  assert.deepEqual(store.TERMINAL, ['归档', '废弃']);
});

t('合法链放行：待审→待派→在途→初检→核查→完成→归档', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'P-01' });
  for (const [from, to] of [['待审', '待派'], ['待派', '在途'], ['在途', '初检'], ['初检', '核查'], ['核查', '完成'], ['完成', '归档']]) {
    assert.equal(store.move(root, 'P-01', from, to).ok, true, `${from}→${to} 应放行`);
    assert.equal(store.find(root, 'P-01').state, to);
  }
});

t('旧边必拒：待投→池 不复存在（池已并入待派、放行成 fm 标记）', () => {
  assert.ok(!store.isLegal('待投', '池'));
  assert.ok(!store.isLegal('待派', '池'));
  const root = makeRoot();
  seed(root, '待派', { id: 'P-02' });
  const r = store.move(root, 'P-02', '待派', '池');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('非法目标状态'), r.error);
  assert.equal(store.find(root, 'P-02').state, '待派', '拒绝时单不动');
});

t('非法转移被拒（待审→在途 越过项管闸）；挂起只有一条出边→待重派', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'P-03' });
  const r = store.move(root, 'P-03', '待审', '在途');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('不合法'));
  assert.deepEqual(store.TRANSITIONS.挂起, ['待重派'], '挂起唯一可逆边');
  assert.ok(!store.isLegal('归档', '待审'), '归档零出边');
  assert.ok(!store.isLegal('废弃', '待重派'), '废弃零出边');
});

t('on移动 钩子真触发：move 一次收到事件含大态 from/to', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'P-04' });
  const 收 = [];
  store.on移动((ev) => 收.push(ev));
  const r = store.move(root, 'P-04', '待派', '在途', (fm) => { fm.主办 = '策划-A'; });
  assert.equal(r.ok, true);
  assert.equal(收.length, 1, 'move 一次恰好一发事件');
  const ev = 收[0];
  assert.equal(ev.id, 'P-04');
  assert.equal(ev.from, '待派'); assert.equal(ev.to, '在途');
  assert.equal(ev.大态from, '待办'); assert.equal(ev.大态to, '在途');
  assert.ok(ev.t && !Number.isNaN(Date.parse(ev.t)), '事件带可解析时间戳');
  // 失败的 move 不发事件（钩子只报真转移）
  store.move(root, 'P-04', '在途', '归档'); // 不合法
  assert.equal(收.length, 1, '非法转移不触钩子');
});

t('mutator 写入 frontmatter 并落盘', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'P-05' });
  store.move(root, 'P-05', '待派', '在途', (fm) => { fm.主办 = '策划-A'; });
  assert.equal(store.find(root, 'P-05').fm.主办, '策划-A');
});

t('原子领单：源被并发移走 → 源不存在（rename 原子兜底）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'P-06' });
  fs.renameSync(store.ticketPath(root, '待派', 'P-06'), store.ticketPath(root, '待派', 'P-06') + '.taken');
  const r = store.move(root, 'P-06', '待派', '在途');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('源不存在'));
});

t('并发领单：只有一个成功，先到者赢', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'P-07' });
  const r1 = store.move(root, 'P-07', '待派', '在途', (fm) => { fm.主办 = 'A'; });
  const r2 = store.move(root, 'P-07', '待派', '在途', (fm) => { fm.主办 = 'B'; });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false); // 二次失败（目标已存在/源不存在均属"抢不到"）
  assert.equal(store.find(root, 'P-07').fm.主办, 'A');
});

t('目标已存在同名单则拒绝（防覆盖）', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'P-08' });
  seed(root, '待派', { id: 'P-08' }); // 人为制造两处同名（异常态）
  const r = store.move(root, 'P-08', '待审', '待派');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('已存在'));
});

t('重复编号建单被拒（create 的占位判定仍有效）', () => {
  // 【need_coord 备忘】store.create 目前仍写 '草稿' 目录——不在新 STATES 里，find 找不到它。
  // 目标目录改 '待审' 归 core/store.js 持有组；此处只锁「重复拒绝」这半边行为。
  const root = makeRoot();
  const r1 = store.create(root, 'P-09', { id: 'P-09', title: '试' }, '正文');
  assert.equal(r1.ok, true);
  assert.equal(store.create(root, 'P-09', { id: 'P-09' }, '').ok, false);
});

console.log(`全部通过：${passed} 项`);
