// store.test.js — 目录即状态机：建单/定位/列举/合法转移/非法转移/原子领单
const assert = require('node:assert');
const fs = require('fs');
const store = require('../lib/core/store');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('store 目录即状态机测试');

t('ensureDirs 建齐 9 状态目录 + 回执 + journal', () => {
  const root = makeRoot();
  for (const s of store.STATES) assert.ok(fs.existsSync(store.stateDir(root, s)), s);
  assert.ok(fs.existsSync(require('path').join(root, '回执')));
});

t('create → 草稿；find 定位；list 列举', () => {
  const root = makeRoot();
  const r = store.create(root, 'P-01', { id: 'P-01', title: '试', 职能: '策划' }, '正文');
  assert.equal(r.ok, true);
  const f = store.find(root, 'P-01');
  assert.equal(f.state, '草稿');
  assert.equal(f.fm.title, '试');
  assert.equal(store.list(root, '草稿').length, 1);
});

t('重复编号建单被拒', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'P-01' });
  assert.equal(store.create(root, 'P-01', { id: 'P-01' }, '').ok, false);
});

t('合法转移放行（草稿→待投→池）', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'P-01' });
  assert.equal(store.move(root, 'P-01', '草稿', '待投').ok, true);
  assert.equal(store.find(root, 'P-01').state, '待投');
  assert.equal(store.move(root, 'P-01', '待投', '池').ok, true);
  assert.equal(store.find(root, 'P-01').state, '池');
});

t('非法转移被拒（草稿→池 越级）', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'P-01' });
  const r = store.move(root, 'P-01', '草稿', '池');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('不合法'));
});

t('mutator 写入 frontmatter 并落盘', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'P-01' });
  store.move(root, 'P-01', '池', '在途', (fm) => { fm.主办 = '策划-A'; });
  assert.equal(store.find(root, 'P-01').fm.主办, '策划-A');
});

t('原子领单：源被并发移走 → 源不存在（rename 原子兜底）', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'P-01' });
  // 模拟并发者已抢走源（此刻目标尚不存在）
  fs.renameSync(store.ticketPath(root, '池', 'P-01'), store.ticketPath(root, '池', 'P-01') + '.taken');
  const r = store.move(root, 'P-01', '池', '在途');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('源不存在'));
});

t('并发领单：只有一个成功，先到者赢', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'P-02' });
  const r1 = store.move(root, 'P-02', '池', '在途', (fm) => { fm.主办 = 'A'; });
  const r2 = store.move(root, 'P-02', '池', '在途', (fm) => { fm.主办 = 'B'; });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, false); // 二次失败（目标已存在/源不存在均属"抢不到"）
  assert.equal(store.find(root, 'P-02').fm.主办, 'A');
});

t('目标已存在同名单则拒绝（防覆盖）', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'P-01' });
  seed(root, '池', { id: 'P-01' }); // 人为制造两处同名（异常态）
  const r = store.move(root, 'P-01', '待投', '池');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('已存在'));
});

console.log(`全部通过：${passed} 项`);
