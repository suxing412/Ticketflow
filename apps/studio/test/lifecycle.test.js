// lifecycle.test.js — H108 生命周期：审过/放行标记/交产出三路/初检自修三振/核查仲裁/分诊/验收/
// 同号返修/撤回废弃收回/挂起复活/滞留/返工推翻/引擎门禁
const assert = require('node:assert');
const life = require('../lib/lifecycle');
const store = require('../lib/core/store');
const { makeRoot, seed, CFG } = require('./helper');
const fs = require('fs');
const path = require('path');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const st = (root, id) => store.find(root, id).state;
console.log('lifecycle 生命周期测试');

t('happy path：待审→待派(审过)→放行标记→在途→初检→核查→完成→归档(验收)', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'P-01', QA: '开' });
  assert.equal(life.审过(root, 'P-01').ok, true); assert.equal(st(root, 'P-01'), '待派');
  assert.equal(life.放行(root, 'P-01').ok, true);
  assert.equal(st(root, 'P-01'), '待派', '放行不再是目录跳变');
  assert.equal(store.find(root, 'P-01').fm.放行, true, '放行=待派单上的 fm 标记（pool 只领 放行===true）');
  store.move(root, 'P-01', '待派', '在途', (fm) => { fm.主办 = '策划-A'; fm.领单时间 = new Date().toISOString(); });
  assert.equal(life.交产出(root, 'P-01', '# 回执').ok, true); assert.equal(st(root, 'P-01'), '初检');
  assert.equal(life.QA裁定(root, CFG, 'P-01', true).ok, true); assert.equal(st(root, 'P-01'), '核查');
  assert.equal(life.核查过(root, 'P-01').ok, true); assert.equal(st(root, 'P-01'), '完成');
  assert.equal(life.验收(root, 'P-01', true).ok, true); assert.equal(st(root, 'P-01'), '归档');
});

t('放行守卫：非待派拒、重复放行拒；撤回放行原地落 false', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'P-01b' });
  assert.ok(!life.放行(root, 'P-01b').ok, '待审不可放行');
  life.审过(root, 'P-01b');
  life.放行(root, 'P-01b');
  assert.ok(!life.放行(root, 'P-01b').ok, '重复放行拒');
  assert.ok(life.撤回放行(root, 'P-01b').ok);
  assert.equal(st(root, 'P-01b'), '待派');
  assert.equal(store.find(root, 'P-01b').fm.放行, false);
  assert.ok(!life.撤回放行(root, 'P-01b').ok, '未放行不可撤');
});

t('QA 关：交产出走核查简检（不进初检）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-02', QA: '关', 主办: 'A', 领单时间: new Date().toISOString() });
  life.交产出(root, 'P-02', null);
  assert.equal(st(root, 'P-02'), '核查');
});

t('免检保留单：交产出直达完成；只标免检不标保留照走审检链（fail-closed）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-02b', QA: '关', 免检: true, 验收方式: '保留', 主办: 'A', 领单时间: new Date().toISOString() });
  life.交产出(root, 'P-02b', null);
  assert.equal(st(root, 'P-02b'), '完成');
  seed(root, '在途', { id: 'P-02c', QA: '关', 免检: true, 验收方式: '委托', 主办: 'A', 领单时间: new Date().toISOString() });
  life.交产出(root, 'P-02c', null);
  assert.equal(st(root, 'P-02c'), '核查', '免检+委托不成立，走简检');
});

t('交产出写回执文件', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'P-03', QA: '关', 主办: 'A', 领单时间: new Date().toISOString() });
  life.交产出(root, 'P-03', '# 完工报告 P-03');
  assert.ok(fs.existsSync(path.join(root, '回执', 'P-03.md')));
});

t('QA 自修循环：不过→在途(自修+1)，三振→待处理（原 质检→待定夺）且上呈原因落 fm', () => {
  const root = makeRoot();
  seed(root, '初检', { id: 'P-04', QA: '开', 主办: 'A' });
  life.QA裁定(root, CFG, 'P-04', false); // 第1轮
  assert.equal(st(root, 'P-04'), '在途');
  assert.equal(store.find(root, 'P-04').fm.自修次数, 1);
  store.move(root, 'P-04', '在途', '初检'); // 主办自修完再交
  life.QA裁定(root, CFG, 'P-04', false); // 第2轮（=上限）
  assert.equal(st(root, 'P-04'), '在途');
  store.move(root, 'P-04', '在途', '初检');
  life.QA裁定(root, CFG, 'P-04', false); // 第3轮 超上限
  assert.equal(st(root, 'P-04'), '待处理');
  assert.ok(String(store.find(root, 'P-04').fm.上呈原因).includes('三振'), '四件套上呈原因照写');
});

t('待处理分诊三出路：接受→完成 / 给方向→待重派 / 废弃→废弃目录(带废弃因)', () => {
  const mk = (dec) => { const root = makeRoot(); seed(root, '待处理', { id: 'D' }); const r = life.定夺(root, 'D', dec); return { root, r, s: st(root, 'D') }; };
  // 【need_coord】任务书写明「接受→完成」，但 store.TRANSITIONS 权威边表的 待处理 出边只有
  // [待重派,待审,废弃]——缺 待处理→完成。lifecycle 已按任务书指向 完成，边补上即自动通；
  // 在那之前锁「拒绝且不动单」的现状，防静默走错门。
  const 接 = mk('接受');
  if (store.isLegal('待处理', '完成')) {
    assert.equal(接.s, '完成');
  } else {
    assert.ok(!接.r.ok && String(接.r.error).includes('不合法'), '缺边期：拒绝而非走错门');
    assert.equal(接.s, '待处理', '拒绝时单不动');
  }
  assert.equal(mk('给方向').s, '待重派');
  const 废 = mk('废弃');
  assert.equal(废.s, '废弃');
  assert.equal(store.find(废.root, 'D').fm.废弃因, '定夺废弃');
  const root = makeRoot(); seed(root, '待处理', { id: 'D2' });
  assert.ok(!life.定夺(root, 'D2', '打回').ok, '旧决定「打回」已消亡');
});

t('给方向清自修次数（接受/废弃不动）+ 方向文本落正文', () => {
  const mk = (dec) => {
    const root = makeRoot();
    seed(root, '待处理', { id: 'D', 自修次数: 3 });
    life.定夺(root, 'D', dec, dec === '给方向' ? '往东做' : null);
    return store.find(root, 'D');
  };
  const 给 = mk('给方向');
  assert.equal(给.fm.自修次数, 0);
  assert.ok(给.body.includes('往东做'), '方向文本随单走，重派后主办能读到');
  assert.equal(mk('接受').fm.自修次数, 3);
  assert.equal(mk('废弃').fm.自修次数, 3);
});

t('回炉后 QA 不过走自修不三振（TK-97 连环三振案，新链：待重派→在途→初检）', () => {
  const root = makeRoot();
  seed(root, '初检', { id: 'P-04b', QA: '开', 主办: 'A', 自修次数: 2 }); // 已到上限
  life.QA裁定(root, CFG, 'P-04b', false); // 超上限 → 待处理
  assert.equal(st(root, 'P-04b'), '待处理');
  assert.equal(store.find(root, 'P-04b').fm.自修次数, 3);
  life.定夺(root, 'P-04b', '给方向', '按这个方向重做');
  assert.equal(st(root, 'P-04b'), '待重派');
  assert.equal(store.find(root, 'P-04b').fm.自修次数, 0);
  store.move(root, 'P-04b', '待重派', '在途'); // 重派
  store.move(root, 'P-04b', '在途', '初检'); // 回炉重做后再交初检
  life.QA裁定(root, CFG, 'P-04b', false);
  assert.equal(st(root, 'P-04b'), '在途'); // 走自修而非直接三振
  assert.equal(store.find(root, 'P-04b').fm.自修次数, 1);
});

t('核查链：核查过→完成；送仲裁→仲裁(争议因落 fm)；非核查态拒', () => {
  const root = makeRoot();
  seed(root, '核查', { id: 'C-01' });
  assert.ok(life.核查过(root, 'C-01').ok);
  assert.equal(st(root, 'C-01'), '完成');
  seed(root, '核查', { id: 'C-02' });
  assert.ok(life.送仲裁(root, 'C-02', '初检核查判词相左').ok);
  assert.equal(st(root, 'C-02'), '仲裁');
  assert.equal(store.find(root, 'C-02').fm.仲裁因, '初检核查判词相左');
  seed(root, '在途', { id: 'C-03', 主办: 'x' });
  assert.ok(!life.核查过(root, 'C-03').ok);
  assert.ok(!life.送仲裁(root, 'C-03').ok);
});

t('仲裁定：裁过→完成 / 上呈→待处理(上呈原因) / 打回→在途；未知决定拒', () => {
  const mk = (dec) => { const root = makeRoot(); seed(root, '仲裁', { id: 'J', 仲裁因: '判词相左' }); const r = life.仲裁定(root, 'J', dec); return { root, r, s: st(root, 'J') }; };
  assert.equal(mk('裁过').s, '完成');
  const 呈 = mk('上呈');
  assert.equal(呈.s, '待处理');
  assert.ok(String(store.find(呈.root, 'J').fm.上呈原因).includes('仲裁'), '上呈原因落 fm');
  assert.equal(mk('打回').s, '在途');
  assert.ok(!mk('和稀泥').r.ok);
});

t('单张验收：通过→归档（落袋）；不过→待重派带返修因（原 待验收→已归档另开新单，现同号回队）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'P-05' });
  assert.ok(life.验收(root, 'P-05', true).ok);
  assert.equal(st(root, 'P-05'), '归档');
  seed(root, '完成', { id: 'P-05b' });
  assert.ok(life.验收(root, 'P-05b', false, '细节不合品味').ok);
  assert.equal(st(root, 'P-05b'), '待重派');
  assert.equal(store.find(root, 'P-05b').fm.返修因, '细节不合品味');
  seed(root, '在途', { id: 'P-05c', 主办: 'x' });
  assert.ok(!life.验收(root, 'P-05c', true).ok, '只有完成单可验收');
});

t('同号返修 H65：完成→待审 与 待处理→待审，返修轮+1、检痕清场、计数保留', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'F-01', 主办: 'A', 领单时间: new Date().toISOString(), 交付时间: new Date().toISOString(), 失败次数: 2, 核查: { 结论: '通过' } });
  assert.ok(life.返修(root, 'F-01', '标准没变，产出不合').ok);
  const f1 = store.find(root, 'F-01');
  assert.equal(f1.state, '待审');
  assert.equal(f1.fm.返修轮, 1);
  assert.equal(f1.fm.失败次数, 2, 'H65 计数不清零');
  assert.equal(f1.fm.主办, undefined); assert.equal(f1.fm.核查, undefined, '下一轮重新过检');
  assert.equal(f1.fm.放行, false);
  assert.ok(f1.body.includes('返修说明'), '说明落正文');
  seed(root, '待处理', { id: 'F-02', 失败原因: 'CLI 崩溃' });
  assert.ok(life.返修(root, 'F-02').ok);
  assert.equal(st(root, 'F-02'), '待审');
  seed(root, '在途', { id: 'F-03', 主办: 'x' });
  assert.ok(!life.返修(root, 'F-03').ok, '只有完成/待处理可同号返修');
});

t('撤回：待派→待审（原 池/待投→草稿），撤放行旗；非待派拒', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'A', 放行: true });
  assert.ok(life.撤回(root, 'A').ok);
  assert.equal(st(root, 'A'), '待审');
  assert.equal(store.find(root, 'A').fm.放行, false);
  seed(root, '在途', { id: 'A2', 主办: 'x' });
  assert.ok(!life.撤回(root, 'A2').ok, '在途要收回不是撤回');
});

t('废弃：→废弃目录带废弃因（原 已归档+归档原因:废弃）；完成/终态拒', () => {
  const root = makeRoot();
  seed(root, '初检', { id: 'B' });
  assert.ok(life.废弃(root, 'B', '方向作废').ok);
  assert.equal(st(root, 'B'), '废弃');
  assert.equal(store.find(root, 'B').fm.废弃因, '方向作废');
  seed(root, '完成', { id: 'B2' });
  assert.ok(!life.废弃(root, 'B2').ok, '完成无废弃边（翻案走推翻，收账走验收）');
  seed(root, '归档', { id: 'B3' });
  assert.ok(!life.废弃(root, 'B3').ok, '终态拒');
  seed(root, '废弃', { id: 'B4' });
  assert.ok(!life.废弃(root, 'B4').ok, '废弃单不可再废弃');
});

t('收回：在途→待派（原 在途→池），清主办、撤放行旗', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'C', 主办: '策划-A', 领单时间: new Date().toISOString(), 放行: true });
  assert.ok(life.收回(root, 'C').ok);
  assert.equal(st(root, 'C'), '待派');
  const fm = store.find(root, 'C').fm;
  assert.equal(fm.主办, undefined);
  assert.equal(fm.领单时间, undefined);
  assert.equal(fm.放行, false, '收回=收权：待重放行');
});

t('执行失败入位：在途/初检→待处理（原→执行失败目录），失败因/次数/时间照写', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'E-01', 主办: 'x', 失败次数: 1 });
  assert.ok(life.执行失败(root, 'E-01', 'CLI 超时').ok);
  const fm = store.find(root, 'E-01').fm;
  assert.equal(st(root, 'E-01'), '待处理');
  assert.equal(fm.失败原因, 'CLI 超时');
  assert.equal(fm.失败次数, 2);
  assert.equal(fm.主办, 'x', '不清主办（诊断线索）');
  seed(root, '初检', { id: 'E-02', 主办: 'x' });
  assert.ok(life.执行失败(root, 'E-02', '判官崩了').ok);
  assert.equal(st(root, 'E-02'), '待处理');
  seed(root, '待派', { id: 'E-03' });
  assert.ok(!life.执行失败(root, 'E-03', 'x').ok, '没在执行谈不上执行失败');
});

t('重投：待处理→待重派（原 执行失败→池），fm.重投次数=(旧值||0)+1、带放行、清执行痕迹', () => {
  const root = makeRoot();
  seed(root, '待处理', { id: 'E-04', 主办: 'x', 领单时间: new Date().toISOString(), 交付时间: new Date().toISOString(), 失败原因: '超时' });
  assert.ok(life.失败分诊(root, 'E-04', '重投').ok);
  let fm = store.find(root, 'E-04').fm;
  assert.equal(st(root, 'E-04'), '待重派');
  assert.equal(fm.重投次数, 1, '旧值缺省按 0 起算');
  assert.equal(fm.放行, true, '重投=明确指令带放行');
  assert.equal(fm.主办, undefined); assert.equal(fm.交付时间, undefined);
  seed(root, '待处理', { id: 'E-05', 重投次数: 3 });
  life.失败分诊(root, 'E-05', '重投');
  assert.equal(store.find(root, 'E-05').fm.重投次数, 4, '累计不重置');
  seed(root, '待处理', { id: 'E-06' });
  assert.ok(!life.失败分诊(root, 'E-06', '上呈').ok, '上呈出路已消亡：待处理本身就是分诊位');
});

/* ===== 挂起 / 复活（施工令-021 → H108：fm 标记升格目录态，唯一可逆终态）===== */

t('挂起：真入挂起目录，fm.挂起前态/挂起因落档；无挂起边的状态拒（待审/初检/完成/归档）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'H-01', 主办: '策划-A' });
  const r = life.挂起(root, 'H-01', '整个方向不对');
  assert.ok(r.ok);
  assert.equal(st(root, 'H-01'), '挂起', '挂起是目录态不再是原位标记');
  const fm = store.find(root, 'H-01').fm;
  assert.equal(fm.挂起前态, '在途');
  assert.equal(fm.挂起因, '整个方向不对');
  assert.ok(fm.挂起时间 && !Number.isNaN(Date.parse(fm.挂起时间)));
  assert.ok(!life.挂起(root, 'H-01', 'x').ok, '重复挂拒');
  for (const [s, id] of [['待审', 'H-02'], ['初检', 'H-03'], ['完成', 'H-04'], ['归档', 'H-05']]) {
    seed(root, s, { id });
    assert.ok(!life.挂起(root, id, 'x').ok, `${s} 无挂起边应拒`);
    assert.equal(st(root, id), s, '拒绝时不动单');
  }
  assert.ok(!life.挂起(root, '不存在的单', 'x').ok);
});

t('复活：挂起→待重派（唯一可逆边）+ 人闸（制作人/总监专权）+ 重投/推迟计数不清零', () => {
  const root = makeRoot();
  seed(root, '待重派', { id: 'H-06', 重投次数: 2, 推迟次数: 1 });
  life.挂起(root, 'H-06', '先停一停', '制作人');
  const 挂时 = store.find(root, 'H-06').fm.挂起时间;
  assert.ok(!life.复活(root, 'H-06', '策划-A').ok, '执行 agent 不许开这道闸');
  assert.ok(!life.复活(root, 'H-06').ok, '匿名不许');
  assert.equal(st(root, 'H-06'), '挂起', '人闸拒绝时单不动');
  assert.ok(life.复活(root, 'H-06', '总监').ok);
  const fm = store.find(root, 'H-06').fm;
  assert.equal(st(root, 'H-06'), '待重派');
  assert.equal(fm.重投次数, 2, '挂起不算重投，计数不清零');
  assert.equal(fm.推迟次数, 1, '推迟计数同样不清零');
  assert.equal(fm.复活记录.挂起于, 挂时, '冻了多久要留得下账');
  assert.equal(fm.复活记录.前态, '待重派');
  assert.equal(fm.挂起因, undefined, '活单上不留失效印（折进复活记录）');
  seed(root, '待派', { id: 'H-07' });
  assert.ok(!life.复活(root, 'H-07', '制作人').ok, '未挂起不可复活');
});

t('全树挂起：父单+全部子孙（跨两层）入挂起目录；无边子单与已挂子单跳过并如实回报', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'T-p', 父单类型: '专项' });
  seed(root, '待派', { id: 'T-c1', 父单: 'T-p' });
  seed(root, '待重派', { id: 'T-c2', 父单: 'T-p' });
  seed(root, '在途', { id: 'T-g1', 父单: 'T-c1', 主办: '策划-A' }); // 孙层：必须一起冻
  seed(root, '完成', { id: 'T-c3', 父单: 'T-p' });                  // 无挂起边：跳过
  seed(root, '在途', { id: 'T-c4', 父单: 'T-p' });
  life.挂起(root, 'T-c4', '这张我单独停的', '制作人');              // 已挂：跳过
  const r = life.挂起树(root, 'T-p', '专项整个不对', '制作人');
  assert.ok(r.ok);
  assert.deepEqual(r.挂起.sort(), ['T-c1', 'T-c2', 'T-g1', 'T-p'].sort());
  assert.deepEqual(r.跳过.map((x) => x.id).sort(), ['T-c3', 'T-c4']);
  for (const id of ['T-p', 'T-c1', 'T-c2', 'T-g1']) assert.equal(st(root, id), '挂起', id + ' 应已入挂起目录');
  assert.equal(store.find(root, 'T-g1').fm.连带自, 'T-p', '连带来源要留痕，复活树按此认领');
  assert.equal(store.find(root, 'T-p').fm.连带自, undefined, '头单不是被连带的');
  assert.equal(st(root, 'T-c3'), '完成', '完成单不动');
});

t('全树复活：只放被本单连带的→待重派；制作人单独挂的子单保持挂起', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'U-p', 父单类型: '专项' });
  seed(root, '待派', { id: 'U-c1', 父单: 'U-p' });
  seed(root, '待派', { id: 'U-c2', 父单: 'U-p' });
  life.挂起(root, 'U-c2', '这张是我自己停的', '制作人');
  life.挂起树(root, 'U-p', null, '制作人');
  const r = life.复活树(root, 'U-p', '制作人');
  assert.ok(r.ok);
  assert.deepEqual(r.复活.sort(), ['U-c1', 'U-p']);
  assert.deepEqual(r.跳过.map((x) => x.id), ['U-c2']);
  assert.equal(st(root, 'U-c2'), '挂起', '独立挂起的不代解——那是另一道闸');
  assert.equal(st(root, 'U-c1'), '待重派');
  assert.equal(st(root, 'U-p'), '待重派');
});

t('子孙盘点带环路防护：手改出的父子环不把机器转死', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R-a', 父单: 'R-b' });
  seed(root, '在途', { id: 'R-b', 父单: 'R-a' });
  const kids = life.子孙(root, 'R-a');
  assert.deepEqual(kids.map((x) => x.id), ['R-b'], '环上的另一头只收一次，不无限递归');
});

t('旧制 fm.挂起 标记残留（迁移前老单）：交产出拒、滞留检查跳过——代码认新形态也认旧残留', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'L-01', 主办: 'A', QA: '开', 挂起: { 操作者: '制作人', 时间: '2026-08-01T00:00:00Z' } });
  const r = life.交产出(root, 'L-01', '# 回执');
  assert.ok(!r.ok); assert.ok(String(r.error).includes('挂起'));
  assert.equal(st(root, 'L-01'), '在途');
});

t('滞留检查（R3）：覆盖在途/初检/核查/仲裁/待处理，超时标告警不自动撤回；完成不算滞留', () => {
  const root = makeRoot();
  const old = new Date(Date.now() - 5 * 3600000).toISOString(); // 5h 前
  seed(root, '在途', { id: 'S', 主办: '策划-A', 领单时间: old });
  seed(root, '初检', { id: 'Q', 主办: 'QA-A', 领单时间: old });
  seed(root, '核查', { id: 'V', 领单时间: old });
  seed(root, '完成', { id: 'W', 领单时间: old }); // 驻留位等验收是本意
  seed(root, '在途', { id: 'N', 主办: '程序-A', 领单时间: new Date().toISOString() });
  const r = life.滞留检查(root, CFG);
  assert.deepEqual(r.告警.map((x) => x.id).sort(), ['Q', 'S', 'V']);
  assert.equal(st(root, 'S'), '在途'); // 不自动撤回
  assert.equal(store.find(root, 'S').fm.滞留告警, true);
  assert.equal(store.find(root, 'W').fm.滞留告警, undefined, '完成不入滞留口径');
  assert.equal(life.滞留检查(root, CFG).告警.length, 3, '再查不重复告警（只记一次）');
});

t('返工：在检旧单→废弃(返工替代)；完成旧单→归档(返工替代)；新单落待审带返工自；下游依赖接续', () => {
  const root = makeRoot();
  seed(root, '核查', { id: 'R-01' }); // 活没成被替代 → 废弃
  seed(root, '待派', { id: 'R-02', 依赖: 'R-01' });
  seed(root, '待审', { id: 'R-03', 依赖: 'R-01，R-02' });
  seed(root, '完成', { id: 'R-04', 依赖: 'R-01' }); // 完成单依赖是历史，不动
  const r = life.返工(root, 'R-01', 'R-11', { id: 'R-11', title: '重做', 职能: '策划' }, '## 范围');
  assert.equal(r.ok, true);
  assert.equal(st(root, 'R-01'), '废弃');
  assert.equal(store.find(root, 'R-01').fm.废弃因, '返工替代');
  assert.equal(st(root, 'R-11'), '待审', '新单落待审（原 草稿）');
  assert.equal(store.find(root, 'R-11').fm.返工自, 'R-01');
  assert.deepEqual(r.依赖接续.sort(), ['R-02', 'R-03']);
  assert.equal(store.find(root, 'R-02').fm.依赖, 'R-11');
  assert.equal(store.find(root, 'R-03').fm.依赖, 'R-11，R-02');
  assert.equal(store.find(root, 'R-04').fm.依赖, 'R-01', '完成单历史不动');
  // 完成旧单被返工替代 → 归档（判官过过的活，按原义归档不废弃）
  seed(root, '完成', { id: 'R-05' });
  assert.ok(life.返工(root, 'R-05', 'R-15', { id: 'R-15', title: '重做', 职能: '策划' }, 'x').ok);
  assert.equal(st(root, 'R-05'), '归档');
  assert.equal(store.find(root, 'R-05').fm.归档原因, '返工替代');
});

t('推翻重做（制作人翻案）：完成→归档带理由，自动编号新待审单+返工链+下游接续；无理由/非终态拒', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'TK-1', title: '探索', 职能: '程序', 项目: 'X', 优先级: 'P1', body: '原正文' });
  seed(root, '待派', { id: 'TK-2', title: '下游', 职能: '程序', 项目: 'X', 依赖: 'TK-1' });
  assert.ok(!life.推翻(root, 'TK-1', '').ok, '无理由拒');
  const r = life.推翻(root, 'TK-1', '细胞感太重全部重来');
  assert.ok(r.ok); assert.equal(r.新单, 'TK-3');
  const old = store.find(root, 'TK-1');
  assert.equal(old.state, '归档'); assert.ok(String(old.fm.归档原因).includes('推翻'));
  const nu = store.find(root, 'TK-3');
  assert.equal(nu.state, '待审');
  assert.equal(nu.fm.返工自, 'TK-1'); assert.ok(nu.body.includes('细胞感'));
  assert.equal(store.find(root, 'TK-2').fm.依赖, 'TK-3', '下游接续');
  assert.ok(!life.推翻(root, 'TK-3', '再翻').ok, '待审单不可推翻');
});

t('隐藏归档：仅归档单可藏，可逆；非归档拒', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'TK-1', title: '废案' });
  assert.ok(!life.隐藏(root, 'TK-1', true).ok, '待审拒藏');
  fs.renameSync(path.join(root, '待审', 'TK-1.md'), path.join(root, '归档', 'TK-1.md'));
  assert.ok(life.隐藏(root, 'TK-1', true).ok);
  assert.equal(store.find(root, 'TK-1').fm.隐藏, true);
  assert.ok(life.隐藏(root, 'TK-1', false).ok);
  assert.equal(store.find(root, 'TK-1').fm.隐藏, undefined);
});

// ---- 施工令-032② 引擎门禁停闸（H97）——H108 闸位从待验收移到核查 ----
const 门禁单 = `## 背景
随口提一句无关紧要。

## 验收标准

1. 编译零错误
2. 四个测试类全绿：\`node tools/enginectl.js unity-test --project D:/GitHub/TK\`

## 不要做
不打包。`;
const 普通单 = '## 验收标准\n\n1. 文档落盘\n2. 术语表齐备\n';

t('门禁命中：默认特征扫「验收标准」章，命中即报出是哪条特征', () => {
  assert.equal(life.引擎门禁命中(CFG, { body: 门禁单 }), 'enginectl');
  assert.equal(life.引擎门禁命中(CFG, { body: 普通单 }), null);
  assert.equal(life.引擎门禁命中(CFG, { body: '## 验收标准\n\n1. 走 unity-test 子集\n' }), 'unity-test');
  assert.equal(life.引擎门禁命中(CFG, { body: '## 验收标准\n\n1. 受控重建一次\n' }), '受控重建');
});

t('门禁命中只扫验收标准章：背景里提 enginectl 不把整张单拖进门禁', () => {
  const b = '## 背景\n上游 TK-112 是用 enginectl 跑的。\n\n## 验收标准\n\n1. 文档落盘\n';
  assert.equal(life.引擎门禁命中(CFG, { body: b }), null);
  assert.equal(life.引擎门禁命中(CFG, { body: '## 范围\n随便写\n' }), null, '无验收标准章 → 不判门禁');
});

t('门禁特征走 config：自定义正则生效、非法配置回落内置默认、总开关可关', () => {
  const cfg2 = { ...CFG, 执行器: { ...CFG.执行器, 引擎门禁: { 特征: ['实机跑一遍', 'dotnet\\s+build'] } } };
  assert.deepEqual(life.引擎门禁特征(cfg2), ['实机跑一遍', 'dotnet\\s+build']);
  assert.equal(life.引擎门禁命中(cfg2, { body: 门禁单 }), null, '换了特征表后旧词不再命中');
  assert.equal(life.引擎门禁命中(cfg2, { body: '## 验收标准\n\n1. dotnet   build 零错误\n' }), 'dotnet\\s+build', '正则语义生效（不是字面量）');
  for (const bad of [{ 特征: [] }, { 特征: 'enginectl' }, { 特征: [1, 2] }, {}]) {
    assert.deepEqual(life.引擎门禁特征({ 执行器: { 引擎门禁: bad } }), life.引擎门禁默认特征, '非法配置回落默认：' + JSON.stringify(bad));
  }
  assert.equal(life.引擎门禁命中({ 执行器: { 引擎门禁: { 开: false } } }, { body: 门禁单 }), null, '总开关关掉即不判');
});

t('门禁特征坏正则：不炸路径，回落字面量包含判定（fail-safe 向严，不静默放行）', () => {
  const cfg2 = { 执行器: { 引擎门禁: { 特征: ['unity-test('] } } }; // 括号不闭合 = 非法正则
  assert.equal(life.引擎门禁命中(cfg2, { body: '## 验收标准\n\n1. 跑 unity-test(subset)\n' }), 'unity-test(');
  assert.equal(life.引擎门禁命中(cfg2, { body: 普通单 }), null);
});

t('候检印 + 实证放行：核查原位盖印不动窝 → 放行核查→完成，fm 与既有动作族同构', () => {
  const root = makeRoot();
  seed(root, '核查', { id: 'G-01', 验收方式: '委托', body: 门禁单 });
  const r = life.候引擎实证(root, 'G-01', 'enginectl', '核查');
  assert.ok(r.ok);
  assert.equal(st(root, 'G-01'), '核查', '原位不动（store.update 不是 move）');
  const 印 = store.find(root, 'G-01').fm.待引擎实证;
  assert.equal(印.命中, 'enginectl');
  assert.equal(印.判源, '核查');
  assert.ok(印.时间 && !Number.isNaN(Date.parse(印.时间)), '时间是可解析 ISO（与 挂起/核查 同构）');

  const r2 = life.实证放行(root, 'G-01', '总监', '137/137 全绿已誊入回执终节');
  assert.ok(r2.ok);
  assert.equal(st(root, 'G-01'), '完成');
  const 放 = store.find(root, 'G-01').fm.实证放行;
  assert.equal(放.操作者, '总监');
  assert.equal(放.候检于, 印.时间, '候检于 = 盖印时刻（与 复活记录.挂起于 同构）');
  assert.equal(放.命中, 'enginectl');
  assert.ok(放.说明.includes('137/137'));
  assert.ok(!store.find(root, 'G-01').fm.待引擎实证, '放行后清候检印');
});

t('实证放行守卫：没盖候检印的单拒开、非核查拒开、不存在拒开', () => {
  const root = makeRoot();
  seed(root, '核查', { id: 'G-02', 验收方式: '委托', body: 门禁单 });
  const a = life.实证放行(root, 'G-02', '总监');
  assert.ok(!a.ok && a.error.includes('未停引擎门禁闸'), a.error);
  assert.equal(st(root, 'G-02'), '核查', '拒开不动单');
  seed(root, '在途', { id: 'G-03', 主办: '程序-A' });
  assert.ok(!life.实证放行(root, 'G-03', '总监').ok);
  assert.ok(!life.实证放行(root, 'G-99', '总监').ok);
  assert.ok(!life.候引擎实证(root, 'G-03', 'enginectl').ok, '候检印也只盖核查中单');
});

t('门禁单返修照旧：候检印随返修清场（下一轮重新过检重新判门禁）', () => {
  const root = makeRoot();
  seed(root, '核查', { id: 'G-06', 验收方式: '委托', body: 门禁单 });
  life.候引擎实证(root, 'G-06', 'enginectl', '核查');
  life.核查过(root, 'G-06'); // 单走到完成后制作人才发现证据不合格
  assert.ok(life.返修(root, 'G-06', '证据不合格，重跑').ok);
  assert.equal(st(root, 'G-06'), '待审');
  assert.equal(store.find(root, 'G-06').fm.返修轮, 1);
  assert.equal(store.find(root, 'G-06').fm.待引擎实证, undefined, '候检印随返修清场');
});

console.log(`全部通过：${passed} 项`);
