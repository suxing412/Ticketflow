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

/* ===== 挂起 / 解挂（施工令-021 · 制作人裁决权补全）===== */

t('挂起：原位冻结——单不挪窝，只盖 frontmatter 印；终态拒挂；重复挂拒', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-h1', 主办: '策划-A' });
  seed(root, '完成', { id: 'P-h2' });
  seed(root, '已归档', { id: 'P-h3' });
  const r = life.挂起(root, 'P-h1', '制作人', '整个方向不对');
  assert.ok(r.ok);
  assert.equal(st(root, 'P-h1'), '在途', '挂起绝不改状态目录——原位是这道闸的全部意义');
  const s = store.find(root, 'P-h1').fm.挂起;
  assert.equal(s.操作者, '制作人'); assert.equal(s.理由, '整个方向不对'); assert.equal(s.挂起时状态, '在途');
  assert.ok(s.时间, '时间戳必落');
  assert.ok(!life.挂起(root, 'P-h1').ok, '重复挂拒');
  assert.ok(!life.挂起(root, 'P-h2').ok, '完成单拒挂');
  assert.ok(!life.挂起(root, 'P-h3').ok, '已归档单拒挂');
  assert.ok(!life.挂起(root, '不存在的单').ok);
});

t('解挂：原状态原位复活 + 留下冻了多久的账；未挂起单拒解', () => {
  const root = makeRoot();
  seed(root, '待定夺', { id: 'P-h4' });
  assert.ok(!life.解挂(root, 'P-h4').ok, '没挂过不能解');
  life.挂起(root, 'P-h4', '制作人');
  const 挂时 = store.find(root, 'P-h4').fm.挂起.时间;
  assert.ok(life.解挂(root, 'P-h4', '制作人').ok);
  const fm = store.find(root, 'P-h4').fm;
  assert.equal(store.find(root, 'P-h4').state, '待定夺', '原位复活');
  assert.equal(fm.挂起, undefined, '印必须真的擦掉，否则筛选处永远跳过它');
  assert.equal(fm.解挂记录.挂起于, 挂时);
});

t('挂起单不可交产出（防残留会话把冻结单顶出原位）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-h5', 主办: '策划-A', QA: '开' });
  life.挂起(root, 'P-h5', '制作人');
  const r = life.交产出(root, 'P-h5', '# 回执');
  assert.ok(!r.ok); assert.ok(String(r.error).includes('挂起'));
  assert.equal(st(root, 'P-h5'), '在途');
  life.解挂(root, 'P-h5');
  assert.ok(life.交产出(root, 'P-h5', '# 回执').ok, '解挂后照常交');
  assert.equal(st(root, 'P-h5'), '质检');
});

t('滞留检查跳过挂起单：制作人按停的单不该再报「卡住了」', () => {
  const root = makeRoot();
  const 久 = new Date(Date.now() - 9 * 3600000).toISOString();
  seed(root, '在途', { id: 'P-h6', 主办: '策划-A', 领单时间: 久 });
  seed(root, '在途', { id: 'P-h7', 主办: '程序-A', 领单时间: 久 });
  life.挂起(root, 'P-h6', '制作人');
  const { 告警 } = life.滞留检查(root, CFG);
  assert.deepEqual(告警.map((x) => x.id), ['P-h7'], '只报没挂起的那张');
  assert.equal(store.find(root, 'P-h6').fm.滞留告警, undefined);
});

t('全树挂起：父单 + 全部子孙（跨两层）；终态子单与已挂子单跳过并如实回报', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-p', 父单类型: '专项' });
  seed(root, '待投', { id: 'P-c1', 父单: 'P-p' });
  seed(root, '池', { id: 'P-c2', 父单: 'P-p' });
  seed(root, '在途', { id: 'P-g1', 父单: 'P-c1', 主办: '策划-A' }); // 孙层：必须一起冻
  seed(root, '完成', { id: 'P-c3', 父单: 'P-p' });                  // 终态：跳过
  seed(root, '质检', { id: 'P-c4', 父单: 'P-p' });
  life.挂起(root, 'P-c4', '制作人', '这张我单独停的');              // 已挂：跳过
  const r = life.挂起树(root, 'P-p', '制作人', '专项整个不对');
  assert.ok(r.ok);
  assert.deepEqual(r.挂起.sort(), ['P-c1', 'P-c2', 'P-g1', 'P-p'].sort());
  assert.deepEqual(r.跳过.map((x) => x.id).sort(), ['P-c3', 'P-c4']);
  assert.equal(store.find(root, 'P-g1').fm.挂起.连带自, 'P-p', '连带来源要留痕，解挂树按此认领');
  assert.equal(store.find(root, 'P-p').fm.挂起.连带自, undefined, '头单不是被连带的');
  for (const id of ['P-p', 'P-c1', 'P-c2', 'P-g1']) assert.ok(store.find(root, id).fm.挂起, id + ' 应已挂');
  assert.equal(store.find(root, 'P-c3').fm.挂起, undefined, '完成单不动');
});

t('全树解挂：只放被本单连带的；制作人单独挂的子单保持挂起', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'Q-p', 父单类型: '专项' });
  seed(root, '待投', { id: 'Q-c1', 父单: 'Q-p' });
  seed(root, '待投', { id: 'Q-c2', 父单: 'Q-p' });
  life.挂起(root, 'Q-c2', '制作人', '这张是我自己停的');
  life.挂起树(root, 'Q-p', '制作人');
  const r = life.解挂树(root, 'Q-p', '制作人');
  assert.ok(r.ok);
  assert.deepEqual(r.解挂.sort(), ['Q-c1', 'Q-p']);
  assert.deepEqual(r.跳过.map((x) => x.id), ['Q-c2']);
  assert.ok(store.find(root, 'Q-c2').fm.挂起, '独立挂起的不代解——那是另一道闸');
  assert.equal(store.find(root, 'Q-c1').fm.挂起, undefined);
});

t('子孙盘点带环路防护：手改出的父子环不把机器转死', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R-a', 父单: 'R-b' });
  seed(root, '在途', { id: 'R-b', 父单: 'R-a' });
  const kids = life.子孙(root, 'R-a');
  assert.deepEqual(kids.map((x) => x.id), ['R-b'], '环上的另一头只收一次，不无限递归');
});

t('挂起兼容旧单：无挂起字段=未挂，废弃/收回等既有动作不受影响', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'S-1', 主办: '策划-A' }); // 老单：frontmatter 里压根没有挂起这一栏
  assert.equal(store.find(root, 'S-1').fm.挂起, undefined);
  assert.ok(life.收回(root, 'S-1').ok);
  seed(root, '池', { id: 'S-2' });
  life.挂起(root, 'S-2', '制作人');
  assert.ok(life.废弃(root, 'S-2').ok, '挂起单仍可被直接废弃——制作人改主意不必先解挂');
  assert.equal(st(root, 'S-2'), '已归档');
});

console.log(`全部通过：${passed} 项`);
