// chain.test.js — 关键汇报事件链（施工令-037 · H108 三大态状态机改造 2026-08-24）
// 锁死三件事：①「现在等什么」十二态逐态判定 ②关键站白名单与「缺站不补造」 ③纯读（零写盘）。
// H108 语义要点（与旧版判据的三处硬差异，改回去任何一处这里都要红）：
//   · 完成 ≠ 终态：判官全过、驻留验收闸前候专项级验收（人闸紫，不是绿档折叠）
//   · 依赖落袋只认 归档（DS-9）：完成 未经验收，不解依赖
//   · 审检链目录化：初检/核查/仲裁 都是目录态，判官全 AI（机闸）
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const chain = require('../lib/pm/chain');
const pmLedger = require('../lib/pm/ledger');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('chain 关键汇报事件链测试（施工令-037 · H108）');

// helper.seed 的 更新时间 是写死的（白名单在前，opts 透传吃不进去），要改只能走 store.update
const 改更新时间 = (root, id, iso) => require('../lib/core/store').update(root, id, () => {}, iso);
const 事件 = (root, 类型, data, iso) => {
  const dir = path.join(root, '项管台账');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, '事件.jsonl'), JSON.stringify({ t: iso || new Date().toISOString(), 类型, ...(data || {}) }) + '\n', 'utf8');
};

/* ===================== 一、「现在等什么」十二态逐态锁死 ===================== */
// 一态一断言，判错一个字都不许过——断头账就是从「等谁」说不清开始的。

t('①待审（原 草稿）：等总监审核定稿（待审闸，人闸）', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'W0' });
  const r = chain.现在等什么(root, require('../lib/core/store').find(root, 'W0'));
  assert.equal(r.态, '待审');
  assert.equal(r.闸, '人');
  assert.equal(r.谁, '总监');
  assert.match(r.什么, /审核定稿/);
});

t('②待派（已放行 · 依赖就绪）：等派发引擎拉起，机闸', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'W1', 放行: true });
  const r = chain.现在等什么(root, require('../lib/core/store').find(root, 'W1'));
  assert.equal(r.态, '待派');
  assert.equal(r.闸, '机');
  assert.equal(r.谁, '派发引擎');
  assert.match(r.什么, /派发引擎拉起/);
});

t('②待派分叉：未放行=等项管闸（H109 放行归项管，机闸）；依赖未归档=等上游工单', () => {
  const root = makeRoot();
  const store = require('../lib/core/store');
  seed(root, '待派', { id: 'W2' }); // 无放行旗
  const a = chain.现在等什么(root, store.find(root, 'W2'));
  assert.equal(a.闸, '机'); assert.equal(a.谁, '项管'); assert.match(a.什么, /项管闸放行/);

  seed(root, '在途', { id: 'DEP', 主办: 'x', 领单时间: new Date().toISOString() });
  seed(root, '归档', { id: 'DONE2' });
  seed(root, '待派', { id: 'W3', 放行: true, 依赖: 'DEP DONE2' });
  const b = chain.现在等什么(root, store.find(root, 'W3'));
  assert.equal(b.闸, '机');
  assert.match(b.什么, /依赖单落袋（归档）：DEP$/, '只列没落袋的那张，已归档（无因）的 DONE2 不许混进去');
});

t('②落袋口径只认归档（DS-9）：完成 未经验收不解依赖；带因归档同样不算', () => {
  const root = makeRoot();
  const store = require('../lib/core/store');
  seed(root, '完成', { id: 'FIN' }); // 判官全过但没验收
  seed(root, '待派', { id: 'W4', 放行: true, 依赖: 'FIN' });
  assert.match(chain.现在等什么(root, store.find(root, 'W4')).什么, /依赖单落袋（归档）：FIN/,
    'H108 硬差异：原「完成=落袋」口径已废——完成 未经专项级验收，不许放下游开工');
  seed(root, '归档', { id: 'ARC2', 归档原因: '废弃' });
  seed(root, '待派', { id: 'W5', 放行: true, 依赖: 'ARC2' });
  assert.match(chain.现在等什么(root, store.find(root, 'W5')).什么, /依赖单落袋（归档）：ARC2/, '带归档原因的历史归档不算落袋');
  seed(root, '归档', { id: 'ARC' });
  seed(root, '待派', { id: 'W6', 放行: true, 依赖: 'ARC' });
  assert.match(chain.现在等什么(root, store.find(root, 'W6')).什么, /派发引擎拉起/, '无因归档＝真落袋，依赖解除');
});

t('③在途：等执行会话交产出，等谁=主办（机闸）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R1', 主办: '装配·R1', 领单时间: new Date().toISOString(), 执行池: 'claude' });
  const r = chain.现在等什么(root, require('../lib/core/store').find(root, 'R1'));
  assert.equal(r.态, '在途'); assert.equal(r.闸, '机'); assert.equal(r.谁, '装配·R1');
  assert.match(r.什么, /交产出/);
});

t('④审检链目录态：初检/核查/仲裁 逐席机闸（H108 判官全 AI，项管全权）', () => {
  const root = makeRoot();
  const store = require('../lib/core/store');
  seed(root, '初检', { id: 'Q1', QA: '开', 交付时间: new Date().toISOString() });
  const a = chain.现在等什么(root, store.find(root, 'Q1'));
  assert.equal(a.态, '初检'); assert.equal(a.闸, '机'); assert.equal(a.谁, '初检判官');
  assert.match(a.什么, /三振→待处理/, '三振出口要写明（原 质检→待定夺 改道 待处理）');
  seed(root, '核查', { id: 'Q2', 交付时间: new Date().toISOString() });
  const b = chain.现在等什么(root, store.find(root, 'Q2'));
  assert.equal(b.闸, '机'); assert.equal(b.谁, '核查判官'); assert.match(b.什么, /争议→仲裁/);
  seed(root, '仲裁', { id: 'Q3' });
  const c = chain.现在等什么(root, store.find(root, 'Q3'));
  assert.equal(c.闸, '机'); assert.equal(c.谁, '仲裁判官');
});

t('⑤完成：不是绿档终态——候专项级验收（验收闸，人闸制作人，H110）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'F1' });
  const r = chain.现在等什么(root, require('../lib/core/store').find(root, 'F1'));
  assert.equal(r.态, '完成');
  assert.equal(r.闸, '人', 'H108 硬差异：完成 折成绿档就是把「没验收」冒充「落袋」');
  assert.equal(r.谁, '制作人');
  assert.match(r.什么, /专项级验收/);
});

t('⑥待引擎实证（施工令-032② / H97 停闸态）：目录住在 完成，但态与等谁都必须分家', () => {
  const root = makeRoot();
  seed(root, '完成', {
    id: 'G1', 验收方式: '委托',
    初检: { 结论: '过', 时间: new Date().toISOString() },
    核查: { 结论: '通过', 时间: new Date().toISOString() },
    待引擎实证: { 命中: 'enginectl', 时间: new Date().toISOString(), 判源: '核查' },
  });
  const r = chain.现在等什么(root, require('../lib/core/store').find(root, 'G1'));
  assert.equal(r.态, '待引擎实证', '停闸态不许报成普通候验收——那是 H97 第二把钥匙存在的全部理由');
  assert.equal(r.闸, '人');
  assert.equal(r.谁, '总监');
  assert.match(r.什么, /实证放行/);
  assert.match(r.什么, /引擎实测证据/);
});

t('⑦待处理三分叉（原 待定夺+执行失败 合并）：代裁→制作人；失败→总监分诊；其余→总监', () => {
  const root = makeRoot();
  const store = require('../lib/core/store');
  seed(root, '待处理', { id: 'D2', 上呈原因: 'QA 三振', 代裁: { 结论: '上呈', 时间: new Date().toISOString() } });
  const b = chain.现在等什么(root, store.find(root, 'D2'));
  assert.equal(b.态, '待处理'); assert.equal(b.闸, '人'); assert.equal(b.谁, '制作人');
  assert.match(b.什么, /上呈/, '代裁结论要摆进「等什么」——不写清楚就还是断头账');

  seed(root, '待处理', { id: 'X1', 失败原因: 'CLI 非零退出', 失败时间: new Date().toISOString() });
  const c = chain.现在等什么(root, store.find(root, 'X1'));
  assert.equal(c.闸, '人'); assert.equal(c.谁, '总监'); assert.match(c.什么, /失败分诊/);

  seed(root, '待处理', { id: 'X2', 上呈原因: '仲裁裁不了' });
  const d = chain.现在等什么(root, store.find(root, 'X2'));
  assert.equal(d.闸, '人'); assert.equal(d.谁, '总监'); assert.match(d.什么, /分诊处置/);
});

t('⑧待重派：分诊完回队，等派发引擎重派（机闸，带重投标记）', () => {
  const root = makeRoot();
  seed(root, '待重派', { id: 'RD1', 重投次数: 1 });
  const r = chain.现在等什么(root, require('../lib/core/store').find(root, 'RD1'));
  assert.equal(r.闸, '机'); assert.equal(r.谁, '派发引擎'); assert.match(r.什么, /重派/);
});

t('⑨归档/废弃：终态，等=null（徽章绿档折叠一行）', () => {
  const root = makeRoot();
  const store = require('../lib/core/store');
  seed(root, '归档', { id: 'A1' });
  const a = chain.现在等什么(root, store.find(root, 'A1'));
  assert.equal(a.闸, '终'); assert.equal(a.什么, null); assert.equal(a.谁, null);
  seed(root, '废弃', { id: 'A2', 废弃原因: '路线切换' });
  assert.equal(chain.现在等什么(root, store.find(root, 'A2')).闸, '终');
});

t('⑩挂起：目录态与旧 fm 标记都答「解挂复活」（迁移过渡期两种形态都要认）', () => {
  const root = makeRoot();
  const store = require('../lib/core/store');
  seed(root, '挂起', { id: 'S0', 挂起: { 操作者: '制作人', 时间: new Date().toISOString(), 理由: '等实拍' } });
  const a = chain.现在等什么(root, store.find(root, 'S0'));
  assert.equal(a.闸, '人'); assert.equal(a.谁, '制作人'); assert.match(a.什么, /解挂复活/);
  assert.match(a.什么, /待重派/, '挂起唯一出边是 待重派，答案里要写明复活去哪');

  // 旧形态：fm.挂起 标记还挂在原目录上（迁移由总控做，代码先认两种）
  seed(root, '在途', { id: 'S1', 主办: 'x', 领单时间: new Date().toISOString(), 挂起: { 操作者: '制作人', 时间: new Date().toISOString() } });
  const b = chain.现在等什么(root, store.find(root, 'S1'));
  assert.equal(b.闸, '人'); assert.match(b.什么, /解挂/);
  assert.equal(b.态, '在途', '态还是目录态——冻的是流转，不是身份');

  seed(root, '待派', { id: 'S2', 放行: true, 待复核: { 锚号: '战斗系统#战斗-03' } });
  const c = chain.现在等什么(root, store.find(root, 'S2'));
  assert.equal(c.闸, '人'); assert.match(c.什么, /待复核/);

  // 终态单身上的残留旗不许把绿档翻成紫档
  seed(root, '归档', { id: 'S3', 挂起: { 操作者: '制作人', 时间: new Date().toISOString() } });
  assert.equal(chain.现在等什么(root, store.find(root, 'S3')).闸, '终');
});

/* ===================== 二、关键站白名单与缺站不补造 ===================== */

t('白名单：巡检心跳/宽限/零派发/编制调整 一律不进事件链', () => {
  for (const 类 of ['巡检', '宽限', '零派发', '打点停滞', '零输出', '编制调整', '并发调配', '迁移']) {
    assert.equal(chain.事件行({ 类型: 类, id: 'T1', t: new Date().toISOString() }, 'T1'), null, `${类} 不该成站`);
  }
  for (const 类 of ['待审', '派发', '上呈', '裁决', '切单启动']) {
    assert.ok(chain.关键事件.has(类), `${类} 必须在白名单里`);
  }
});

t('事件归组：id / 单 / 父单 / 子单[] 四种字段名都能认出单号', () => {
  assert.deepEqual(chain.事件单号({ 类型: '派发', id: 'A' }), ['A']);
  assert.deepEqual(chain.事件单号({ 类型: '待审', 单: 'B' }), ['B']);
  assert.deepEqual(chain.事件单号({ 类型: '待审', 父单: 'P', 子单: ['C1', 'C2'] }), ['P', 'C1', 'C2']);
});

t('切单事件两面看：父单行报「切出几张」，子单行报「呈总监审 · 父单是谁」', () => {
  const e = { 类型: '待审', t: '2026-08-09T05:00:00.000Z', 父单: 'P', 子单: ['K1', 'K2'] };
  assert.match(chain.事件行(e, 'P').文, /2 张子单/);
  assert.equal(chain.事件行(e, 'K1').因, '父单 P');
});

// 施工令-054：拒切候期与切单失败在链上必须分得开——制作人看链是要判「在等前置」还是「切崩了」。
t('切单候期上链（施工令-054）：写「拒切候期＋理由」，复切时机挂在因上，不与失败混为一谈', () => {
  const e = { 类型: '切单候期', t: '2026-08-12T01:18:00.000Z', 父单: 'P', 理由: '承重方案 TK-200 未落袋', 复切时机: 'TK-200 落袋后' };
  const 行 = chain.事件行(e, 'P');
  assert.equal(行.站, '切单');
  assert.match(行.文, /拒切候期：承重方案 TK-200 未落袋/);
  assert.match(行.因, /复切时机：TK-200 落袋后/);
  assert.ok(!/失败/.test(行.文), '候期不是失败，链上一个「失败」字都不该出现');
  assert.ok(chain.关键事件.has('切单候期'), '不进白名单就等于判语落了账没人看得见（TK-146 下半截病）');
});

t('缺站不补造：无派发事件且无领单时间 → 链里就是没有派发行（不拿更新时间顶上）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'N1', 放行: true, 审批人: '总监', 审批时间: '2026-08-09T01:00:00.000Z' });
  const 链 = chain.建链(root, require('../lib/core/store').find(root, 'N1'), []);
  assert.deepEqual(链.map((r) => r.站), ['定稿']);
});

t('去重：台账 派发 事件与 fm.领单时间 是同一件事的两处记账，同分钟合成一行且取信息更全的那条', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'M1', 主办: '程序·M1', 执行池: 'claude', 领单时间: '2026-08-09T06:11:35.720Z' });
  const evs = [{ 类型: '派发', t: '2026-08-09T06:11:35.000Z', id: 'M1', 池: 'claude' }];
  const 链 = chain.建链(root, require('../lib/core/store').find(root, 'M1'), evs);
  const 派 = 链.filter((r) => r.站 === '派发');
  assert.equal(派.length, 1, '同一分钟的同站两条记账要并成一行');
  assert.match(派[0].因, /主办 程序·M1/, '保留信息更全的那条');
});

t('跨轮次同站不误并：两次派发相隔一小时，两行都在（TK-114 真数据形态）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'M2', 返修轮: 1, 执行池: 'claude', 领单时间: '2026-08-09T06:11:35.720Z', 审批时间: '2026-08-09T06:11:34.373Z' });
  const evs = [
    { 类型: '派发', t: '2026-08-09T05:13:33.993Z', id: 'M2', 池: 'claude' },
    { 类型: '派发', t: '2026-08-09T06:11:35.721Z', id: 'M2', 池: 'claude' },
  ];
  const 链 = chain.建链(root, require('../lib/core/store').find(root, 'M2'), evs);
  assert.equal(链.filter((r) => r.站 === '派发').length, 2);
});

t('链条按时间排序；返修行锚在本轮定稿之前；完成单收「完成」行不冒充终态', () => {
  const root = makeRoot();
  seed(root, '完成', {
    id: 'C1', 返修轮: 1, QA: '开', 执行池: 'claude', 主办: '装配·C1',
    审批人: '总监', 审批时间: '2026-08-09T06:11:34.373Z',
    领单时间: '2026-08-09T06:11:35.720Z', 交付时间: '2026-08-09T08:31:07.866Z',
  });
  改更新时间(root, 'C1', '2026-08-09T09:19:03.818Z');
  const evs = [{ 类型: '待审', t: '2026-08-09T05:11:22.041Z', 单: 'C1', 起草: '单张' }];
  const 链 = chain.建链(root, require('../lib/core/store').find(root, 'C1'), evs);
  assert.deepEqual(链.map((r) => r.站), ['起草', '返修', '定稿', '派发', '交产出', '完成']);
  const 尾 = 链[链.length - 1];
  assert.match(尾.文, /候专项级验收/, 'H108：完成行必须写明「候验收」——原「验收通过 → 完成落袋」是旧口径');
  assert.ok(!/落袋/.test(尾.文), '完成 未经验收，一个「落袋」字都不许出现');
});

t('交产出带耗时；QA 关的单如实写「简检核查」（H108 审检链：QA 关不再直达待验收）', () => {
  const root = makeRoot();
  seed(root, '核查', { id: 'E1', QA: '关', 领单时间: '2026-08-09T09:24:31.635Z', 交付时间: '2026-08-09T09:33:25.767Z' });
  const 行 = chain.建链(root, require('../lib/core/store').find(root, 'E1'), []).find((r) => r.站 === '交产出');
  assert.match(行.文, /（9 分钟）/);
  assert.match(行.因, /简检核查/);
  assert.equal(chain.历时('2026-08-09T01:00:00Z', '2026-08-09T03:30:00Z'), '2 小时 30 分');
  assert.equal(chain.历时('2026-08-09T01:00:00Z', null), null, '缺一头就不编耗时');
});

t('审检各站落章：初检缺项 / 核查结论 / 候实证命中 / 实证放行 逐条上链', () => {
  const root = makeRoot();
  seed(root, '完成', {
    id: 'J1', 验收方式: '委托', 领单时间: '2026-08-09T01:00:00.000Z', 交付时间: '2026-08-09T02:00:00.000Z',
    初检: { 结论: '过', 判源: '机判', 时间: '2026-08-09T02:01:00.000Z' },
    核查: { 结论: '通过', 时间: '2026-08-09T02:10:00.000Z' },
    实证放行: { 操作者: '总监', 时间: '2026-08-09T02:30:00.000Z', 命中: 'enginectl', 候检于: '2026-08-09T02:11:00.000Z' },
    更新时间: '2026-08-09T02:30:00.000Z',
  });
  const 链 = chain.建链(root, require('../lib/core/store').find(root, 'J1'), []);
  assert.deepEqual(链.map((r) => r.站), ['派发', '交产出', '初检', '核查', '终态']);
  assert.match(链.find((r) => r.站 === '初检').文, /过/);
  assert.match(链.find((r) => r.站 === '核查').文, /深检/);
  const 终 = 链.find((r) => r.站 === '终态');
  assert.match(终.文, /实证放行/);
  assert.match(终.因, /门禁「enginectl」/);
  assert.equal(链.filter((r) => ['终态', '完成'].includes(r.站)).length, 1, '实证放行行本身就是收尾行，不许再盖一行');
});

t('上呈形态：上呈原因锚在代裁之前，四件套因由要摆到脸上', () => {
  const root = makeRoot();
  seed(root, '待处理', {
    id: 'U1', QA: '开', 领单时间: '2026-08-09T06:11:35.000Z', 交付时间: '2026-08-09T07:30:00.000Z',
    质检人: 'QA', 自修次数: 3,
    上呈原因: 'QA 自修 3 轮仍未过（上限 2）→ 三振上呈，四件套待裁',
    代裁: { 结论: '上呈', 时间: '2026-08-09T07:56:12.918Z' },
  });
  const 链 = chain.建链(root, require('../lib/core/store').find(root, 'U1'), []);
  assert.deepEqual(链.map((r) => r.站), ['派发', '交产出', '质检', '上呈', '定夺']);
  assert.match(链.find((r) => r.站 === '质检').因, /自修 3 轮/);
  assert.match(链.find((r) => r.站 === '上呈').因, /三振上呈/);
});

t('挂起/失败也上链（活单尾端要答得出「为什么停在这」）；废弃单收终态行', () => {
  const root = makeRoot();
  seed(root, '待处理', {
    id: 'K1', 领单时间: '2026-08-09T01:00:00.000Z',
    失败原因: 'CLI 非零退出', 失败次数: 2, 失败时间: '2026-08-09T01:40:00.000Z',
    挂起: { 操作者: '制作人', 时间: '2026-08-09T02:00:00.000Z', 理由: '等制作人实拍' },
  });
  const 站 = chain.建链(root, require('../lib/core/store').find(root, 'K1'), []).map((r) => r.站);
  assert.deepEqual(站, ['派发', '失败', '挂起']);
  seed(root, '废弃', { id: 'K2', 废弃原因: '路线切换（TK-144 先例）', 更新时间: '2026-08-09T03:00:00.000Z' });
  const 尾 = chain.建链(root, require('../lib/core/store').find(root, 'K2'), []).pop();
  assert.equal(尾.站, '终态');
  assert.match(尾.文, /废弃：路线切换/);
});

/* ===================== 三、汇总入口（活体口径 / 三档徽章 / 纯读） ===================== */

t('汇总：活单在前；完成单是活单（候验收紫档）；归档单折叠绿档', () => {
  const root = makeRoot();
  seed(root, '归档', { id: 'TK-115', title: '汉代地图数据路线调研', 验收方式: '委托', 核查: { 结论: '通过', 时间: '2026-08-09T09:50:41.648Z' }, 更新时间: '2026-08-09T09:50:41.654Z' });
  seed(root, '完成', { id: 'TK-116', title: '长江黄河远景常显', 验收方式: '保留', 领单时间: '2026-08-09T09:24:31.645Z', 交付时间: '2026-08-09T09:33:25.767Z', 更新时间: '2026-08-09T09:33:25.767Z' });
  事件(root, '待审', { 单: 'TK-115', 起草: '单张' }, '2026-08-09T09:23:16.544Z');
  事件(root, '巡检', { 在途: 2, 异常: 0 }, '2026-08-09T09:26:33.997Z');
  const r = chain.汇总(root, {});
  assert.equal(r.链[0].id, 'TK-116', '完成是活单（候验收），排在归档单前面');
  assert.equal(r.链[0].档, 'wait', 'H108：完成=人闸紫档，不是绿档');
  assert.equal(r.链[0].等.谁, '制作人');
  assert.match(r.链[0].徽, /完成 · 候专项级验收/);
  const done = r.链.find((x) => x.id === 'TK-115');
  assert.equal(done.档, 'done');
  assert.equal(done.等, null);
  assert.match(done.徽, /^归档/);
});

t('汇总：隐藏单默认不进；limit 截断；事件窗只喂关键事件', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'H1', 隐藏: true });
  seed(root, '完成', { id: 'H2' });
  assert.deepEqual(chain.汇总(root, {}).链.map((x) => x.id), ['H2']);
  assert.equal(chain.汇总(root, { 含隐藏: true }).链.length, 2);
  for (let i = 0; i < 5; i++) seed(root, '在途', { id: 'L' + i, 主办: 'x', 领单时间: new Date(Date.now() - i * 1000).toISOString() });
  assert.equal(chain.汇总(root, { limit: 3 }).链.length, 3);
});

t('汇总：委托事由按 30 分钟窗与紧随的单张待审配对，超窗/错序一律不挂（宁缺毋错）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'V1' });
  seed(root, '完成', { id: 'V2' });
  事件(root, '派单委托', { 需求: '长江黄河最远档必须双河在场' }, '2026-08-09T09:20:00.000Z');
  事件(root, '待审', { 单: 'V1', 起草: '单张' }, '2026-08-09T09:23:00.000Z');
  事件(root, '派单委托', { 需求: '一个隔了两小时才落地的委托' }, '2026-08-09T10:00:00.000Z');
  事件(root, '待审', { 单: 'V2', 起草: '单张' }, '2026-08-09T12:30:00.000Z');
  const r = chain.汇总(root, {});
  const v1 = r.链.find((x) => x.id === 'V1').链.find((x) => x.站 === '起草');
  assert.match(v1.因, /委托事由：长江黄河/);
  const v2 = r.链.find((x) => x.id === 'V2').链.find((x) => x.站 === '起草');
  assert.ok(!/委托事由/.test(v2.因 || ''), '超 30 分钟窗不许乱认亲');
});

t('纯读铁律：汇总跑完，工单目录与台账文件字节级零变化', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'P1', 验收方式: '委托' });
  seed(root, '归档', { id: 'P2' });
  事件(root, '待审', { 单: 'P1', 起草: '单张' }, '2026-08-09T09:00:00.000Z');
  pmLedger.write(root, pmLedger.DEFAULT());
  const 指纹 = () => {
    const out = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p); else out.push(p + ':' + fs.readFileSync(p, 'utf8').length + ':' + fs.statSync(p).mtimeMs);
      }
    };
    walk(root);
    return out.sort().join('\n');
  };
  const before = 指纹();
  chain.汇总(root, {});
  chain.汇总(root, { limit: 50, 事件窗: 1000 });
  assert.equal(指纹(), before, '关键汇报只准读——写一个字节都是越权');
});

t('汇总：三档徽章与闸别一一对应（终=done绿 / 人=wait紫 / 机=doing橙）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'Z1', 主办: 'x', 领单时间: new Date().toISOString() });
  seed(root, '完成', { id: 'Z2' });
  seed(root, '归档', { id: 'Z3' });
  seed(root, '废弃', { id: 'Z4' });
  seed(root, '挂起', { id: 'Z5' });
  const m = {};
  for (const c of chain.汇总(root, {}).链) m[c.id] = c.档;
  assert.deepEqual(m, { Z1: 'doing', Z2: 'wait', Z3: 'done', Z4: 'done', Z5: 'wait' },
    'H108：完成=wait（候验收）；挂起=wait（候解挂）；只有 归档/废弃 是 done');
});

console.log(`全部通过：${passed} 项`);
