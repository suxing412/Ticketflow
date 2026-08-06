// lifecycle.test.js — 生命周期：happy path / QA自修→待定夺 / 定夺 / 验收 / 返工 / 撤回废弃收回 / 滞留
const assert = require('node:assert');
const life = require('../lib/lifecycle');
const store = require('../lib/core/store');
const { makeRoot, seed, CFG } = require('./helper');
const fs = require('fs');
const path = require('path');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const st = (root, id) => store.find(root, id).state;
console.log('lifecycle 生命周期测试');

t('happy path：草稿→待投→池→在途→质检→待验收→完成', () => {
  const root = makeRoot();
  seed(root, '草稿', { id: 'P-01', QA: '开' });
  assert.equal(life.定稿(root, 'P-01').ok, true); assert.equal(st(root, 'P-01'), '待投');
  assert.equal(life.投池(root, 'P-01').ok, true); assert.equal(st(root, 'P-01'), '池');
  store.move(root, 'P-01', '池', '在途', (fm) => { fm.主办 = '策划-A'; fm.领单时间 = new Date().toISOString(); });
  assert.equal(life.交产出(root, 'P-01', '# 回执').ok, true); assert.equal(st(root, 'P-01'), '质检');
  assert.equal(life.QA裁定(root, CFG, 'P-01', true).ok, true); assert.equal(st(root, 'P-01'), '待验收');
  assert.equal(life.验收(root, 'P-01', true).ok, true); assert.equal(st(root, 'P-01'), '完成');
});

t('QA 关：交产出直达待验收（跳过质检）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-02', QA: '关', 主办: 'A', 领单时间: new Date().toISOString() });
  life.交产出(root, 'P-02', null);
  assert.equal(st(root, 'P-02'), '待验收');
});

t('交产出写回执文件', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-03', QA: '关', 主办: 'A', 领单时间: new Date().toISOString() });
  life.交产出(root, 'P-03', '# 完工报告 P-03');
  assert.ok(require('fs').existsSync(require('path').join(root, '回执', 'P-03.md')));
});

t('QA 自修循环：不过→在途(自修+1)，达上限→待定夺', () => {
  const root = makeRoot();
  seed(root, '质检', { id: 'P-04', QA: '开', 主办: 'A' });
  life.QA裁定(root, CFG, 'P-04', false); // 第1轮
  assert.equal(st(root, 'P-04'), '在途');
  assert.equal(store.find(root, 'P-04').fm.自修次数, 1);
  store.move(root, 'P-04', '在途', '质检'); // 主办自修完再交
  life.QA裁定(root, CFG, 'P-04', false); // 第2轮（=上限）
  assert.equal(st(root, 'P-04'), '在途');
  store.move(root, 'P-04', '在途', '质检');
  life.QA裁定(root, CFG, 'P-04', false); // 第3轮 超上限
  assert.equal(st(root, 'P-04'), '待定夺');
});

t('待定夺裁决：接受→待验收 / 给方向→在途 / 打回→已归档', () => {
  const mk = (dec) => { const root = makeRoot(); seed(root, '待定夺', { id: 'D' }); life.定夺(root, 'D', dec); return st(root, 'D'); };
  assert.equal(mk('接受'), '待验收');
  assert.equal(mk('给方向'), '在途');
  assert.equal(mk('打回'), '已归档');
});

t('给方向清自修次数（接受/打回不动）', () => {
  const mk = (dec) => {
    const root = makeRoot();
    seed(root, '待定夺', { id: 'D', 自修次数: 3 });
    life.定夺(root, 'D', dec);
    return store.find(root, 'D').fm.自修次数;
  };
  assert.equal(mk('给方向'), 0);
  assert.equal(mk('接受'), 3);
  assert.equal(mk('打回'), 3);
});

t('回炉后 QA 不过走自修不三振（TK-97 连环三振案）', () => {
  const root = makeRoot();
  seed(root, '质检', { id: 'P-04b', QA: '开', 主办: 'A', 自修次数: 2 }); // 已到上限
  life.QA裁定(root, CFG, 'P-04b', false); // 超上限 → 待定夺
  assert.equal(st(root, 'P-04b'), '待定夺');
  assert.equal(store.find(root, 'P-04b').fm.自修次数, 3);
  life.定夺(root, 'P-04b', '给方向', '按这个方向重做');
  assert.equal(st(root, 'P-04b'), '在途');
  assert.equal(store.find(root, 'P-04b').fm.自修次数, 0);
  store.move(root, 'P-04b', '在途', '质检'); // 回炉重做后再交质检
  life.QA裁定(root, CFG, 'P-04b', false);
  assert.equal(st(root, 'P-04b'), '在途'); // 走自修而非直接三振
  assert.equal(store.find(root, 'P-04b').fm.自修次数, 1);
});

t('验收不过 → 已归档', () => {
  const root = makeRoot();
  seed(root, '待验收', { id: 'P-05' });
  life.验收(root, 'P-05', false);
  assert.equal(st(root, 'P-05'), '已归档');
});

t('返工：归档旧单 + 建新草稿（带返工自回链）', () => {
  const root = makeRoot();
  seed(root, '待验收', { id: 'P-06' });
  const r = life.返工(root, 'P-06', 'P-07', { id: 'P-07', title: '重做', 职能: '策划' }, '## 范围');
  assert.equal(r.ok, true);
  assert.equal(st(root, 'P-06'), '已归档');
  assert.equal(st(root, 'P-07'), '草稿');
  assert.equal(store.find(root, 'P-07').fm.返工自, 'P-06');
});

t('返工下游依赖接续：引用旧单的未终态单自动改指新单，终态单不动', () => {
  const root = makeRoot();
  seed(root, '待验收', { id: 'R-01' });
  seed(root, '池', { id: 'R-02', 依赖: 'R-01' });
  seed(root, '待投', { id: 'R-03', 依赖: 'R-01，R-02' });
  seed(root, '完成', { id: 'R-04', 依赖: 'R-01' });
  const r = life.返工(root, 'R-01', 'R-11', { id: 'R-11', title: '重做', 职能: '策划' }, '## 范围');
  assert.equal(r.ok, true);
  assert.deepEqual(r.依赖接续.sort(), ['R-02', 'R-03']);
  assert.equal(store.find(root, 'R-02').fm.依赖, 'R-11');
  assert.equal(store.find(root, 'R-03').fm.依赖, 'R-11，R-02');
  assert.equal(store.find(root, 'R-04').fm.依赖, 'R-01', '完成单历史不动');
});

t('撤回：在池→草稿；废弃：任意非终态→已归档；收回：在途→池清主办', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A' }); life.撤回(root, 'A'); assert.equal(st(root, 'A'), '草稿');
  seed(root, '质检', { id: 'B' }); life.废弃(root, 'B'); assert.equal(st(root, 'B'), '已归档');
  seed(root, '在途', { id: 'C', 主办: '策划-A', 领单时间: new Date().toISOString() });
  life.收回(root, 'C'); assert.equal(st(root, 'C'), '池');
  assert.equal(store.find(root, 'C').fm.主办, undefined);
});

t('滞留检查（R3）：超时单标告警但不自动撤回', () => {
  const root = makeRoot();
  const old = new Date(Date.now() - 5 * 3600000).toISOString(); // 5h 前
  seed(root, '在途', { id: 'S', 主办: '策划-A', 领单时间: old });
  seed(root, '质检', { id: 'Q', 主办: 'QA-A', 领单时间: old });
  seed(root, '在途', { id: 'N', 主办: '程序-A', 领单时间: new Date().toISOString() });
  const r = life.滞留检查(root, CFG);
  assert.equal(r.告警.length, 2); // 在途 S + 质检 Q 都超时
  assert.equal(st(root, 'S'), '在途'); // 不自动撤回，仍在途
  assert.equal(st(root, 'Q'), '质检');
  assert.equal(store.find(root, 'S').fm.滞留告警, true);
  assert.equal(st(root, 'N'), '在途'); // 新单不动
  // 再查一次不重复告警（只记一次）
  assert.equal(life.滞留检查(root, CFG).告警.length, 2);
});

t('推翻重做（制作人翻案）：完成→已归档带理由，自动编号新草稿+返工链+下游接续；无理由/非终态拒', () => {
  const root = makeRoot();
  store.create(root, 'TK-1', { id: 'TK-1', title: '探索', 职能: '程序', 项目: 'X', 优先级: 'P1' }, '原正文');
  fs.renameSync(path.join(root, '草稿', 'TK-1.md'), path.join(root, '完成', 'TK-1.md'));
  store.create(root, 'TK-2', { id: 'TK-2', title: '下游', 职能: '程序', 项目: 'X', 依赖: 'TK-1' }, 'x');
  assert.ok(!life.推翻(root, 'TK-1', '').ok, '无理由拒');
  const r = life.推翻(root, 'TK-1', '细胞感太重全部重来');
  assert.ok(r.ok); assert.equal(r.新单, 'TK-3');
  const old = store.find(root, 'TK-1');
  assert.equal(old.state, '已归档'); assert.ok(String(old.fm.归档原因).includes('推翻'));
  const nu = store.find(root, 'TK-3');
  assert.equal(nu.fm.返工自, 'TK-1'); assert.ok(nu.body.includes('细胞感'));
  assert.equal(store.find(root, 'TK-2').fm.依赖, 'TK-3', '下游接续');
  assert.ok(!life.推翻(root, 'TK-3', '再翻').ok, '草稿不可推翻');
});

t('隐藏归档：仅已归档可藏，可逆；非归档拒', () => {
  const root = makeRoot();
  store.create(root, 'TK-1', { id: 'TK-1', title: '废案', 职能: '程序', 项目: 'X' }, 'x');
  assert.ok(!life.隐藏(root, 'TK-1', true).ok, '草稿拒藏');
  fs.renameSync(path.join(root, '草稿', 'TK-1.md'), path.join(root, '已归档', 'TK-1.md'));
  assert.ok(life.隐藏(root, 'TK-1', true).ok);
  assert.equal(store.find(root, 'TK-1').fm.隐藏, true);
  assert.ok(life.隐藏(root, 'TK-1', false).ok);
  assert.equal(store.find(root, 'TK-1').fm.隐藏, undefined);
});

console.log(`全部通过：${passed} 项`);
