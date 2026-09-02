// gatereg.test.js — 闸注册表 + 等我()（施工令-061 第二节）
// 病灶：决策台按「工单状态」找人闸，专项关账这类非工单闸结构上看不见——08-20 实测欠 3 笔只报 1 笔。
// 本套件盯三条缝：①换轴后非工单闸收得到 ②发起型不许冒充欠债 ③backlog 不许冒充欠债。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../lib/core/store');
const gr = require('../lib/gatereg');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('闸注册表 + 等我() 测试');

const fm = (id, o = {}) => ({ id, title: id, 职能: '程序', 单型: '实现单', QA: '关', 验收方式: '委托', 项目: 'TK', ...o });
// 空桩：默认依赖会去读真盘，测试里一律注入空实现，只放开被测的那一路
const 空 = {
  specials: { list: () => [] },
  ideas: { list: () => [] },
  schedule: { 现态: () => [] },
  // G23 停表问的产线闸：不注桩就会去读真盘 state 的 paused——测试里显式给「开」，
  // 要测停表的用例自己换「关」（见 G23 三档那格）
  gates: { isPaused: () => false },
  wiki: { pending: () => [] },
  features: { list: () => [] },   // G19 同理：不注桩就会去读真盘的 特性/，还会顺手 mkdir 一个空目录
  // G18 同理：目录走注入而不是就地拼 root/项管台账——注入了才验得出「有没有哪一处漏改还在就地拼」
  台账目录: (r) => path.join(r, '__无台账__'),
  // 值守三闸的产出物在 root 之外（白夜馆是 root 的兄弟），测试 root 的父目录是系统共享临时目录——
  // 不注空实现就会把别人扔在 <tmp> 里的东西当成本仓的值守馆。指向 root 内的不存在路径 = 恒空。
  值守: { 班档目录: (r) => path.join(r, '__无馆__'), 瞭望塔目录: (r) => path.join(r, '__无塔__') },
  // G15 同理：不注空实现就会拿真源码树去比，把测试结果绑到开发机的当下状态上
  码印: { 比对: () => ({ 一致: true, 因: '测试桩' }), 源码改动时刻: () => null },
  配置: () => ({}),
  配置状态: () => ({}),   // G16 同理：不注桩就会去读真盘的 state，把测试绑到开发机当下状态
  台账: { 事件流体检: () => ({ 总行: 0, 坏行: [], 含NUL: false }) },  // G17 同理
};

t('注册表：文件缺失回落缺省表，不静默变空（条数由缺省表自证，标题不写死数字免得它自己先腐）', () => {
  const root = makeRoot();
  const 表 = gr.注册表(root);
  assert.equal(表.length, gr.缺省注册表.length, '缺失文件时回落的必须是整张缺省表，不是子集');
  assert.ok(表.length >= 16, '至少 16 条：12 条法源闸 + G12 失败分诊 + G13/G14 值守 + G15 码印');
  assert.equal(new Set(表.map((g) => g.闸号)).size, 表.length, '闸号不许重——重号会让 gateKey 撞车，两笔债折成一笔');
  assert.ok(表.every((g) => g.闸号 && g.名称 && g.法源 && g.型 && g.归属), '每条闸五要素齐（含归属）');
  assert.ok(表.some((g) => g.名称 === '专项验收'), 'H109 验收闸在册（原 G6 专项关账升格叙事）——它正是决策台看不见的那个');
  assert.ok(表.some((g) => g.闸号 === 'G21' && g.判据 === '待审' && g.归属 === '总监'), 'H108 切单待审闸在册，归总监');
  assert.equal(表.filter((g) => g.判据 === '专项候关账').length, 1,
    '专项验收只许一条闸（曾拟 G22 另立，同判据两条闸会让同一笔债出两个 gateKey）');
});

t('注册表：文件在则以文件为准（人可增补）', () => {
  const root = makeRoot();
  fs.writeFileSync(gr.REG_FILE(root), JSON.stringify([
    { 闸号: 'X1', 名称: '自定闸', 法源: '测试', 型: '响应', 判据: '待派候放行', 落点: '看板', 按钮: '放行' },
  ]), 'utf8');
  const 表 = gr.注册表(root);
  assert.equal(表.length, 1);
  assert.equal(表[0].闸号, 'X1');
});

// 原为五条（含 G4 入标杆）。2026-08-28 G4 随风格库子系统一并退役——
// 子系统 08-26 计划内退役，闸表那一格漏退，宣告着一颗三处都不存在的按钮。
// 数字跟着退到四条，不是判据放宽：它验的仍是「发起型一条都不许产生欠债」，
// 只是名单少了一条。**数字改小的同时把为什么写在这儿**，否则下次有人看到 4
// 只会以为本来就是 4，G4 那段历史就没了。
t('发起型闸不产生欠债（撤回/废弃/开线/编辑器锁）', () => {
  const root = makeRoot();
  const r = gr.等我(root, { deps: 空 });
  assert.equal(r.计数, 0, '空仓零欠债');
  const 发起 = gr.缺省注册表.filter((g) => g.型 === '发起');
  assert.equal(发起.length, 4, '四条发起型（G4 入标杆 2026-08-28 退役）');
  assert.equal(发起.find((g) => g.闸号 === 'G4'), undefined, 'G4 已退役，号不复用');
  assert.ok(发起.every((g) => g.判据 === null), '发起型判据显式为 null——没有队列就不许有 pending');
});

t('换轴实证：专项关账收得到（非工单实体，旧决策台结构上看不见）', () => {
  const root = makeRoot();
  const r = gr.等我(root, {
    现在: '2026-08-20T00:00:00Z',
    deps: { ...空, specials: { list: () => [
      { id: 'S-1', fm: { 名称: '编辑器专项', 状态: '收口', 关账时间: null, 收口时间: '2026-08-18T00:00:00Z' } },
      { id: 'S-2', fm: { 名称: '已关账的', 状态: '关账', 关账时间: '2026-08-19T00:00:00Z' } },
      { id: 'S-3', fm: { 名称: '还在跑', 状态: '进行', 关账时间: null } },
    ] } },
  });
  assert.equal(r.计数, 1, '只有 收口且未关账 那一笔算欠债');
  assert.equal(r.债[0].gateKey, 'G6:S-1');
  assert.equal(r.债[0].停摆小时, 48, '停摆时长按收口时刻算');
});

t('G3 完成候终审（H110/DS-5）：专项委托单等专项级验收不算债；保留单、散单、待实证单才算', () => {
  // 新「完成」= 在途出口驻留位，判官全过但**未经验收**。专项子单停这儿等兄弟（G6 收它的债），
  // 不是人闸；散单没有兄弟，永远等不来专项级验收——DS-5：必须单独立债。
  const root = makeRoot();
  seed(root, '完成', { id: 'TK-1', 验收方式: '委托', 专项: 'S-1' });   // 无债：等 S-1 的专项级验收
  seed(root, '完成', { id: 'TK-2', 验收方式: '保留', 专项: 'S-1' });   // 有债：保留单挂了专项也得制作人过目
  seed(root, '完成', { id: 'TK-3', 验收方式: '委托' });               // 有债：散单（fm.专项 空）
  seed(root, '完成', { id: 'TK-4', 验收方式: '委托', 专项: 'S-1', 待引擎实证: { 命中: '引擎门禁' } }); // 有债：等实测证据
  const r = gr.等我(root, { deps: 空 });
  assert.deepEqual(r.债.map((x) => x.id).sort(), ['TK-2', 'TK-3', 'TK-4'],
    '专项委托单不进人闸清单——它的验收债在 G6 专项层，按单立债就是双计');
  assert.ok(r.债.every((x) => x.闸号 === 'G3' && x.归属 === '制作人'), '三笔都是 G3 制作人的债');
});

t('G3 反向用例：全是专项委托单的完成态零债——完成 ≠ 落袋，但也不许恒真（G14 教训）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'TK-5', 验收方式: '委托', 专项: 'S-1' });
  seed(root, '完成', { id: 'TK-6', 验收方式: '委托', 专项: 'S-2' });
  assert.equal(gr.等我(root, { deps: 空 }).计数, 0, '整目录都在等专项级验收 → 一笔人债都不许报');
});

t('严判据：有活跃会话的单不算你的活（会话还在收尾，承 TK-117）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'TK-3', 验收方式: '保留' });
  const r = gr.等我(root, { deps: { ...空, 活跃单: new Set(['TK-3']) } });
  assert.equal(r.计数, 0);
});

t('G1 项管闸（H109）：待派未放行=欠项管；放行旗竖起当场销债；脏值不当放行', () => {
  const root = makeRoot();
  assert.equal(gr.等我(root, { deps: 空 }).计数, 0, '空待派零债（反向：零积压不报债）');
  seed(root, '待派', { id: 'TK-A1' });                       // 无旗 → 债
  seed(root, '待派', { id: 'TK-A2', 放行: true });           // 已放行 → 非债
  seed(root, '待派', { id: 'TK-A3', 放行: 'true' });         // 边界：字符串脏值 ≠ 放行，照报
  const r = gr.等我(root, { deps: 空 });
  const g1 = r.债.filter((x) => x.闸号 === 'G1');   // H112 后待派单无排期还会带出一笔 G24 聚合债，各闸各查
  assert.deepEqual(g1.map((x) => x.id).sort(), ['TK-A1', 'TK-A3'], '严判 !==true：没批过的单一张不放');
  assert.ok(g1.every((x) => x.归属 === '项管'), 'H109：放行语义移交项管，不再归双');
  assert.ok(r.债.some((x) => x.gateKey === 'G24:未排期'), '三张待派单都没排期粒 → G24 未排期聚合债同场立起（H112/DS-12）');
  assert.deepEqual(gr.等我(root, { deps: 空, 归属: '项管' }).债.filter((x) => x.闸号 === 'G1').map((x) => x.id).sort(),
    ['TK-A1', 'TK-A3'], '按归属=项管能单独收到');
  assert.equal(gr.等我(root, { deps: 空, 归属: '制作人' }).计数, 0, '项管的债不进制作人清单');
});

t('G2/G12 待处理分水岭（H108 合并目录）：上呈原因在=制作人拍板，不在=总监分诊，恒不双计', () => {
  const root = makeRoot();
  assert.equal(gr.等我(root, { deps: 空 }).计数, 0, '空待处理两闸都零债');
  seed(root, '待处理', { id: 'TK-B1', 上呈原因: '三振上呈：QA 修不好，四件套待裁' });  // 定夺类 → G2
  seed(root, '待处理', { id: 'TK-B2', 失败原因: 'CLI 超时' });                        // 失败裸单 → G12
  seed(root, '待处理', { id: 'TK-B3', 上呈原因: '' });                                // 边界：空串=没上呈 → G12
  const r = gr.等我(root, { deps: 空 });
  const g2 = r.债.filter((x) => x.闸号 === 'G2');
  const g12 = r.债.filter((x) => x.闸号 === 'G12');
  assert.deepEqual(g2.map((x) => x.id), ['TK-B1'], '带上呈原因（四件套）的才等制作人');
  assert.deepEqual(g12.map((x) => x.id).sort(), ['TK-B2', 'TK-B3'], '没上呈的归总监分诊，空串不算上呈');
  assert.equal(g2[0].归属, '制作人');
  assert.ok(g12.every((x) => x.归属 === '总监'));
  assert.equal(r.计数, 3, '三张单三笔债——互补拆分，一张单绝不在两个闸各出一笔');
});

t('G21 切单待审（H108）：待审整目录都是总监的债，审过出目录即销', () => {
  const root = makeRoot();
  assert.equal(gr.等我(root, { deps: 空 }).计数, 0, '空待审零债（反向）');
  seed(root, '待审', { id: 'TK-C1', 交付时间: '2026-08-20T00:00:00Z' });
  const r = gr.等我(root, { 现在: '2026-08-22T00:00:00Z', deps: 空 });
  assert.equal(r.计数, 1);
  assert.deepEqual([r.债[0].gateKey, r.债[0].归属, r.债[0].路由, r.债[0].停摆小时],
    ['G21:TK-C1', '总监', '#/board', 48], '切单审核归总监，落看板待审列，停摆按 fm 时间戳算');
  // 边界=状态机行为：同一张单挪去 待派（审过）后债自销——判据轴是目录，不是历史
  fs.renameSync(store.ticketPath(root, '待审', 'TK-C1'), store.ticketPath(root, '待派', 'TK-C1'));
  const r2 = gr.等我(root, { deps: 空 });
  assert.equal(r2.债.filter((x) => x.闸号 === 'G21').length, 0, '审过出目录 → G21 债当场归零');
  assert.deepEqual(r2.债.map((x) => x.闸号).sort(), ['G1', 'G24'],
    '审过未放行 → 债换主到 G1 项管闸，链条接得上；进了待派又没排期粒 → G24 未排期同步立起（H112）');
});

t('G23 今时线越线（H112）三档：有债/无债/停表——产线关=判据整条短路，删掉停表条件这格当场红', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'TK-Z1' });     // 已派出去的单：线越了也没债
  seed(root, '待派', { id: 'TK-Z2' });     // 还窝在待派的单：越线即欠表态
  seed(root, '待重派', { id: 'TK-Z3' });   // 待重派同待遇（分诊回队还没重派出去）
  seed(root, '已排期', { id: 'TK-Z5' });   // H116：已排期同在可派视野——排期落账迁了目录，到点没走照样欠
  const 粒 = (题, o) => ({ 粒ID: 'g-' + 题, 题, 状态: '计划', ...o });
  const 未到 = 粒('未到点', { 计划开始: '2026-08-30T10:00' });
  const 已派 = 粒('已在途', { 计划开始: '2026-08-01T10:00', 单号: 'TK-Z1' });
  const 无单 = 粒('无单号已排期', { 计划开始: '2026-08-20T09:15' });   // 刻钟级新形态
  const 在待派 = 粒('单在待派', { 计划开始: '2026-08-19', 单号: 'TK-Z2' }); // 存量纯日期：当日 00:00 起算
  const 在重派 = 粒('单在待重派', { 计划开始: '2026-08-20T18:45', 单号: 'TK-Z3' });
  const 在已排期 = 粒('单在已排期态', { 计划开始: '2026-08-20T08:00', 单号: 'TK-Z5' }); // H116 新家
  const 未排 = 粒('还没排期的');                                        // 无计划开始：G23 管不着（那是 G24 的活）
  const 查 = (粒们, paused, 现在) => gr.等我(root, {
    现在, deps: { ...空, schedule: { 现态: () => 粒们 }, gates: { isPaused: () => !!paused } },
  }).债.filter((d) => d.闸号 === 'G23');
  // 现在 一律传**无时区尾巴**的本地串——排点毫秒 按本地读，判据两侧同一把尺，换机器不漂
  assert.equal(查([未到, 已派, 未排], false, '2026-08-21T09:15').length, 0,
    '无债档：未到点/单已在途/没排期 一笔都不算');
  const r = 查([未到, 已派, 无单, 在待派, 在重派, 在已排期, 未排], false, '2026-08-21T09:15');
  assert.deepEqual(r.map((x) => x.id).sort(), ['g-单在已排期态', 'g-单在待派', 'g-单在待重派', 'g-无单号已排期'],
    '有债档：无单号但已排期 + 单还窝在待派/待重派/已排期（H116 可派三态）的越线粒，每粒一债');
  assert.ok(r.every((x) => x.归属 === '项管' && x.路由 === '#/relay' && x.gateKey === 'G23:' + x.id),
    '归项管、落项管页、gateKey=G23:粒ID（幂等键）');
  assert.equal(r.find((x) => x.id === 'g-无单号已排期').停摆小时, 24,
    '停摆自=计划开始：09:15 排的点、次日 09:15 来问 → 恰 24h（刻钟级排点真被读进判据，不是按天取整）');
  // 停表档（变异自证）：同一份数据只把产线闸合上 → 整条归零。把判据里的停表早退删掉，这一句当场红。
  assert.equal(查([未到, 已派, 无单, 在待派, 在重派], true, '2026-08-21T09:15').length, 0,
    '产线关=停表：债在数据层就不成立，零触发零写入；重开时这批自然整批立债');
  // 表态豁免档（终审 T3①，谓词=schedule.越线待表态判）：已表态（任一决定，折叠记 末次表态时刻）
  // 且表态晚于本次越线时刻（=计划开始）⇒ 债消——表态答的就是这次越线；表态后计划再挪到未来
  // 又越线（新计划开始 > 表态时刻）⇒ 豁免失效，新越线要新表态。删掉谓词的豁免分支，前半句当场红。
  const 已表态 = 粒('已表态派发', { 计划开始: '2026-08-20T09:00', 末次表态时刻: '2026-08-20T10:00:00.000Z' });
  const 再越线 = 粒('表态后再越线', { 计划开始: '2026-08-21T08:00', 末次表态时刻: '2026-08-20T10:00:00.000Z' });
  assert.deepEqual(查([已表态, 再越线], false, '2026-08-21T09:15').map((x) => x.id), ['g-表态后再越线'],
    '表态豁免：表态晚于越线的粒不再入债（派发后 G23 消）；表态后计划再越线的粒照欠——豁免不是免死金牌');
});

t('G23 债在 逾期() 视野内：24h 未表态升格（归属=项管照样升格，对象=总监走升格环既有分流）', () => {
  const root = makeRoot();
  const deps = { ...空, schedule: { 现态: () => [
    { 粒ID: 'g-老', 题: '拖了两天', 状态: '计划', 计划开始: '2026-08-19T09:00' },
    { 粒ID: 'g-新', 题: '刚越线', 状态: '计划', 计划开始: '2026-08-21T06:00' },
  ] } };
  const o = { 现在: '2026-08-21T09:00', deps };
  assert.deepEqual(gr.逾期(root, 24, o).map((x) => x.id), ['g-老'],
    '逾期() 不筛归属——项管的债一样超时升格（升格环对非制作人归属走 journal，对象即总监）');
  assert.deepEqual(gr.等我(root, { ...o, 归属: '项管' }).债.map((x) => x.id).sort(), ['g-新', 'g-老'],
    '按归属=项管两笔都收得到');
  assert.equal(gr.等我(root, { ...o, 归属: '制作人' }).债.length, 0, '项管的债不进制作人清单');
});

t('G24 未排期（DS-12 防僵尸单）：待派∪待重派 无排期=债，计划态粒无日期同病——聚合一债带清单', () => {
  const root = makeRoot();
  const G24 = (deps, 现在) => gr.等我(root, { 现在, deps }).债.filter((d) => d.闸号 === 'G24');
  assert.equal(G24(空).length, 0, '空仓零债（反向：没有单也没有粒就没有「未排期」）');
  seed(root, '待派', { id: 'TK-N1' });     // 压根没有粒：最重的僵尸形态
  seed(root, '待派', { id: 'TK-N3' });     // 有粒且有排期：不算
  seed(root, '待派', { id: 'TK-N4' });     // 粒还在计划态、无日期、带单号：算，且与粒去重只数一遍
  seed(root, '待重派', { id: 'TK-N2' });   // 已成单粒无排期：算（分诊回队后没人给它排）
  const 粒们 = [
    { 粒ID: 'gN3', 题: 'N3粒', 状态: '已成单', 单号: 'TK-N3', 计划开始: '2026-09-01' },
    { 粒ID: 'gN4', 题: 'N4粒', 状态: '计划', 单号: 'TK-N4' },
    { 粒ID: 'gN2', 题: 'N2粒', 状态: '已成单', 单号: 'TK-N2' },
    { 粒ID: 'gB', 题: '河改批', 状态: '计划' },                          // backlog 无日期：算
    { 粒ID: 'gS', 题: '排好了', 状态: '计划', 计划开始: '2026-09-20' },   // 排了：不算
    { 粒ID: 'gDone', 题: '完的', 状态: '完成', 单号: 'TK-N9' },           // 终态粒：不进任何账
  ];
  const deps = { ...空, schedule: { 现态: () => 粒们 } };
  const r = G24(deps, '2026-08-21T09:00');
  assert.equal(r.length, 1, '聚合一债：逐条立几十笔只会把清单变噪声');
  assert.deepEqual([r[0].gateKey, r[0].归属, r[0].路由], ['G24:未排期', '项管', '#/relay']);
  assert.match(r[0].title, /未排期 4 条/,
    'TK-N1（无粒）+ TK-N4（计划粒去重后一笔）+ TK-N2（已成单粒无排期）+ 河改批（backlog）＝4，实测：' + r[0].title);
  for (const 名 of ['TK-N1', 'TK-N2', 'TK-N4', '河改批']) assert.ok(r[0].title.includes(名), '清单要点名 ' + 名 + '：' + r[0].title);
  for (const 名 of ['TK-N3', '排好了', '完的']) assert.ok(!r[0].title.includes(名), 名 + ' 不该在清单里：' + r[0].title);
  // 前 5 截断：清单是给人一眼看的，不是把全库倒进标题
  const 多 = Array.from({ length: 7 }, (_, i) => ({ 粒ID: 'x' + i, 题: '批' + i, 状态: '计划' }));
  const r多 = G24({ ...空, schedule: { 现态: () => 多 } });
  // 换了排程账后四张单全失了粒：4 单 + 7 backlog 粒 = 11 条，仍只点前 5 个名字
  assert.match(r多[0].title, /未排期 11 条：TK-N1、TK-N3、TK-N4、TK-N2、批0…$/,
    '只点前 5 个名字，余下收进省略号：' + r多[0].title);
  // 反向（恒真闸教训 G14）：排期补齐 → 债当场归零。四张单的粒全给上未来日期，backlog 也排上。
  const 齐 = 粒们.map((g) => ({ ...g, 计划开始: g.计划开始 || '2026-09-10' }))
    .concat([{ 粒ID: 'gN1', 题: 'N1粒', 状态: '已成单', 单号: 'TK-N1', 计划开始: '2026-09-10' }]);
  const r齐 = G24({ ...空, schedule: { 现态: () => 齐 } }, '2026-08-21T09:00');
  assert.equal(r齐.length, 0, '全排上日子 → 未排期债销光（不许恒真）');
});

t('backlog 不冒充欠债（G8 已裁撤 2026-08-26）：举了就绪旗也不再立放行债，未排期照进 G24 聚合债', () => {
  const root = makeRoot();
  const 粒 = (id, o) => ({ 粒ID: id, 题: id, 状态: '计划', ...o });
  const r1 = gr.等我(root, { deps: { ...空, schedule: { 现态: () => [粒('g1'), 粒('g2'), 粒('g3')] } } });
  assert.deepEqual(r1.债.map((x) => x.gateKey), ['G24:未排期'],
    'backlog 不立放行债，但没排日子这件事进 G24 聚合债（一笔，不逐粒刷屏——H112/DS-12）');
  // 裁撤自证：就绪旗举着也不再产 G8 债——新单流不经就绪旗，这条闸连判据都没了
  const r2 = gr.等我(root, { deps: { ...空, schedule: { 现态: () => [粒('g1'), 粒('g2', { 就绪: true })] } } });
  assert.equal(r2.债.filter((x) => x.闸号 === 'G8').length, 0, 'G8 裁撤后不许再立债');
  assert.ok(!gr.缺省注册表.some((x) => x.闸号 === 'G8'), '注册表不许残留 G8 行');
});

t('幂等：同闸同实体只算一笔（gateKey 去重）', () => {
  const root = makeRoot();
  const dup = { fm: { 名称: '同一个', 状态: '收口', 关账时间: null, 收口时间: '2026-08-19T00:00:00Z' }, id: 'S-9' };
  const r = gr.等我(root, { deps: { ...空, specials: { list: () => [dup, dup, dup] } } });
  assert.equal(r.计数, 1);
});

t('排序：停摆最久的排最前；时长未知的垫底', () => {
  const root = makeRoot();
  const r = gr.等我(root, {
    现在: '2026-08-20T00:00:00Z',
    deps: { ...空, specials: { list: () => [
      { id: 'S-新', fm: { 名称: '新', 状态: '收口', 关账时间: null, 收口时间: '2026-08-19T22:00:00Z' } },
      { id: 'S-久', fm: { 名称: '久', 状态: '收口', 关账时间: null, 收口时间: '2026-08-10T00:00:00Z' } },
      { id: 'S-无', fm: { 名称: '无戳', 状态: '收口', 关账时间: null } },
    ] } },
  });
  assert.deepEqual(r.债.map((x) => x.id), ['S-久', 'S-新', 'S-无']);
});

t('逾期：按小时阈值筛，缺省 24h', () => {
  const root = makeRoot();
  const deps = { ...空, specials: { list: () => [
    { id: 'S-老', fm: { 名称: '老', 状态: '收口', 关账时间: null, 收口时间: '2026-08-18T00:00:00Z' } },
    { id: 'S-新', fm: { 名称: '新', 状态: '收口', 关账时间: null, 收口时间: '2026-08-19T20:00:00Z' } },
  ] } };
  assert.deepEqual(gr.逾期(root, 24, { 现在: '2026-08-20T00:00:00Z', deps }).map((x) => x.id), ['S-老']);
  assert.equal(gr.逾期(root, 100, { 现在: '2026-08-20T00:00:00Z', deps }).length, 0);
});

t('一条判据哑掉不带崩全表（失败如实登记，不假装为空）', () => {
  const root = makeRoot();
  const r = gr.等我(root, { deps: { ...空,
    specials: { list: () => { throw new Error('盘读挂了'); } },
    ideas: { list: () => [{ id: 'i1', 文: '一个想法' }] },
  } });
  assert.equal(r.计数, 1, '别的闸照常出数');
  assert.equal(r.失败.length, 1);
  assert.equal(r.失败[0].闸号, 'G6');
  assert.match(r.失败[0].因, /盘读挂了/);
});

t('禁以通知为数据源：模块不 require inbox（硬约束①的机器判据）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'gatereg.js'), 'utf8');
  const 代码 = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/require\(['"].*inbox/.test(代码), '收件箱是广播不是账本——377 条未读即实证');
});

t('归属分流：总监/项管的闸不报进制作人清单（混数就说不清欠的是谁的）', () => {
  const root = makeRoot();
  seed(root, '待处理', { id: 'TK-90', 失败原因: 'CLI 崩溃' });   // G12 总监
  seed(root, '完成', { id: 'TK-91', 验收方式: '保留' });          // G3 制作人
  seed(root, '待派', { id: 'TK-92' });                            // G1 项管
  assert.deepEqual(gr.等我(root, { deps: 空, 归属: '制作人' }).债.map((x) => x.id), ['TK-91']);
  assert.deepEqual(gr.等我(root, { deps: 空, 归属: '总监' }).债.map((x) => x.id), ['TK-90'], '失败分诊归总监');
  assert.deepEqual(gr.等我(root, { deps: 空, 归属: '项管' }).债.map((x) => x.id), ['TK-92', '未排期'],
    '放行归项管（H109）；待派单无排期粒又带出 G24 聚合债（H112，停摆未知垫底）');
  assert.equal(gr.等我(root, { deps: 空 }).计数, 4, '不传归属即全收（G12+G3+G1+G24）');
});

t('值守两闸：判据落在产出物，不落在「定时器挂没挂」（2026-08-21 案）', () => {
  // 案源：审计疑「晨晚报定时任务阵亡」，复核推翻——瞭望塔时钟天天准点开火、心跳在跳，
  // 断的是消费侧：账本水位卡 11 天、身后积压 1271 条含急件 178。**闹钟天天响，屋里没人。**
  // 教训一句话：器材查得再全也证明不了产出发生。故这两闸只认产出物的时间戳。
  const root = makeRoot();
  // 白夜馆在 root 的**兄弟位**，而测试 root 是系统临时目录下的一格——
  // 于是上一轮崩在中途的运行会把 <tmp>/白夜馆 留在原地，让下一轮的「空仓」断言失真。
  // 先清场再断言，收尾走 finally：测试自己不许有隐藏前置状态。
  const 馆 = path.join(root, '白夜馆'); const 塔 = path.join(root, '瞭望塔');
  const 值守 = { 班档目录: () => 馆, 瞭望塔目录: () => 塔 };
  const 空债 = gr.等我(root, { deps: { ...空, 值守 } }).债;
  assert.equal(空债.filter((d) => ['G13', 'G14'].includes(d.闸号)).length, 0,
    '没有白夜馆/瞭望塔的仓 = 没立值守制，不许凭空报债（宁可恒空也不虚报）');

  // 立起两个产出物再测
  fs.mkdirSync(馆, { recursive: true });
  fs.writeFileSync(path.join(馆, '2026-08-11-夜班.md'), '归档', 'utf8');
  // 断更判的是**多久没有新归档**，取文件 mtime。刚写出来的文件 mtime 就是此刻，
  // 那是「刚补完」不是「断更」——要测断更就得把时间拨老。
  const 拨老 = (f, 小时) => { const t = new Date(Date.now() - 小时 * 3600000); fs.utimesSync(f, t, t); };
  拨老(path.join(馆, '2026-08-11-夜班.md'), 72);
  fs.mkdirSync(塔, { recursive: true });
  fs.writeFileSync(path.join(塔, '账本水位.json'), JSON.stringify({ 至: '2026-08-09T18:32:49.756Z' }), 'utf8');
  fs.writeFileSync(path.join(塔, '未读账本.jsonl'),
    ['2026-08-08T00:00:00Z', '2026-08-15T00:00:00Z', '2026-08-20T00:00:00Z'].map((t) => JSON.stringify({ t })).join(String.fromCharCode(10)), 'utf8');

  const r = gr.等我(root, { 现在: '2026-08-21T00:00:00Z', deps: { ...空, 值守 } });
  const g13 = r.债.find((d) => d.闸号 === 'G13');
  const g14 = r.债.find((d) => d.闸号 === 'G14');
  assert.ok(g13, '班档断更收得到');
  assert.match(g13.title, /2026-08-11-夜班\.md/, '报的是最新那一份，不是随便一份');
  assert.ok(g14, '账本水位停滞收得到');
  assert.equal(g14.停摆小时, 269.5, '停摆自 = 水位的「至」（08-09 18:32 → 08-21 00:00 = 11 天余），于是停多久一目了然');
  assert.match(g14.title, /积压 2 条/, '水位之后的才算积压（3 条里有 1 条在水位之前）');
  assert.equal(g13.归属, '总监');
  assert.equal(g14.归属, '总监');
  assert.equal(gr.等我(root, { deps: { ...空, 值守 }, 归属: '制作人' }).债.filter((d) => ['G13', 'G14'].includes(d.闸号)).length, 0,
    '值守是总监自己的账，不占制作人版面');

  // 积压为零就不是债——**恒真判据**是本模块头注明令要防的那种「永远为满的假账」，
  // 而 G14 首版正是恒真：1300 条清完账 3 秒它又报「水位未推进」。
  fs.writeFileSync(path.join(塔, '账本水位.json'), JSON.stringify({ 至: '2026-08-20T23:59:59.000Z' }), 'utf8');
  const r清 = gr.等我(root, { 现在: '2026-08-21T00:00:00Z', deps: { ...空, 值守 } });
  assert.equal(r清.债.filter((d) => d.闸号 === 'G14').length, 0,
    '水位推到最新（身后零积压）→ 不许再报债。水位不推进本身不是欠债，水位不推进而身后有人在等才是');
  assert.ok(r清.债.some((d) => d.闸号 === 'G13'), 'G13 不受影响——两闸各判各的，别一起哑掉');

  // 补完归档就不是债——G13 首版也是**恒真闸**（2026-08-24 修）：判据体无条件返回一笔，
  // 补完最新一期它照报，只是把新文件的时刻当「停摆自」。同 G14 首版一个病，
  // 而本模块文件头明令要防「永远为满的假账」。
  fs.writeFileSync(path.join(馆, '2026-08-23-白夜班.md'), '刚补的一期', 'utf8');
  const r补 = gr.等我(root, { deps: { ...空, 值守 } });
  assert.equal(r补.债.filter((d) => d.闸号 === 'G13').length, 0,
    '刚补完班次归档 → 不许再报债。有归档不是债，断更才是债');
  // 再拨老一次，确认它该报的时候还报得出来（防上一条修过头把闸修哑）
  拨老(path.join(馆, '2026-08-23-白夜班.md'), 72);
  const r又断 = gr.等我(root, { deps: { ...空, 值守 } });
  const g13又 = r又断.债.find((d) => d.闸号 === 'G13');
  assert.ok(g13又, '拨老到 72 小时前 → 该报还得报，别修成永远不响');
  assert.match(g13又.title, /小时无新归档/, '要说清断了多久');

  // 注入的路径必须**真被用上**，不许有哪一处漏改还在就地拼 root/瞭望塔。
  // 案源：本条实装时 lib 里正有这么一处漏网，而上面那些断言全绿——因为测试里的塔
  // 恰好就在 root/瞭望塔，两条路径重合，漏改看不出来。故这里把塔挪到别处再验一次。
  const 塔2 = path.join(root, '别处的塔');
  fs.mkdirSync(塔2, { recursive: true });
  fs.writeFileSync(path.join(塔2, '账本水位.json'), JSON.stringify({ 至: '2026-08-09T18:32:49.756Z' }), 'utf8');
  fs.writeFileSync(path.join(塔2, '未读账本.jsonl'),
    ['2026-08-15T00:00:00Z', '2026-08-16T00:00:00Z', '2026-08-17T00:00:00Z', '2026-08-18T00:00:00Z']
      .map((t) => JSON.stringify({ t })).join(String.fromCharCode(10)), 'utf8');
  const r2 = gr.等我(root, { 现在: '2026-08-21T00:00:00Z', deps: { ...空, 值守: { 班档目录: () => 馆, 瞭望塔目录: () => 塔2 } } });
  assert.match(r2.债.find((d) => d.闸号 === 'G14').title, /积压 4 条/, '积压数要来自注入的那个塔，不是 root/瞭望塔');
});

t('端点实跑 · /api/attn 与 /api/features：真起服务打一遍（漏传参这类只有起服务才炸得出来）', () => {
  // 案源：0.26.15 换装冒烟。/api/attn 里 runner.status() 漏传 cfg，函数内读 cfg.执行器 抛 TypeError，
  // 端点 500。lib 层 13 项测试全绿——因为炸的是**端点接线**不是判据逻辑。
  // 教训：谓词有单测 ≠ 端点跑得起来。凡新端点，必须有一格真起服务打一遍。
  const { execFileSync } = require('child_process');
  const path = require('path');
  const root = makeRoot();
  const port = 4933;
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const G = async (u) => { const r = await fetch(B + u); let j = null; try { j = await r.json(); } catch { j = { __非JSON: true }; } return [r.status, j]; };
      const out = {};
      let [s, j] = await G('/api/attn');
      out.attn = [s, typeof j.计数, Array.isArray(j.债), typeof j.逾期阈值小时];
      [s, j] = await G('/api/attn?' + encodeURIComponent('归属') + '=' + encodeURIComponent('制作人'));
      out.attn归属 = [s, Array.isArray(j.债)];
      [s, j] = await G('/api/features');
      out.features = [s, Array.isArray(j.特性)];
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });
  `;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const out = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  assert.deepEqual(out.attn, [200, 'number', true, 'number'], '/api/attn 必须 200 且形状完整——500 说明接线断了');
  assert.deepEqual(out.attn归属, [200, true], '带归属参数照样 200');
  assert.deepEqual(out.features, [200, true], '/api/features 200 且回特性数组');
});

t('每条闸自带路由，且随债下发（2026-08-21 收件箱死链族）', () => {
  // 案源：注册表逐闸写好了 落点（「项管页 · 待办队列」「Wiki 页」…），但那一格只拿去拼文案；
  // 真正决定跳哪儿的是前端一行「按 id 形状猜」——想法 I-xxx、待办 uuid、wiki 名称全不匹配，
  // 一律跳 #/t/<非工单号>，服务端明确回「工单不存在」。而注释上面就写着「按注册表落点直达」。
  const root = makeRoot();
  const 缺 = gr.缺省注册表.filter((g) => !g.路由);
  assert.deepEqual(缺.map((g) => g.闸号), [], '每条闸都要有路由——将来加闸忘写，这一格会红');
  assert.ok(gr.缺省注册表.every((g) => String(g.路由).startsWith('#/')), '路由是 hash 形，不是页面名');

  const 空 = { specials: { list: () => [] }, schedule: { 现态: () => [] }, wiki: { pending: () => [] }, gates: { isPaused: () => false },
    ideas: { list: () => [{ id: 'I-abc', 文本: '做个存档系统', t: '2026-08-20T00:00:00Z' }] },
    值守: { 班档目录: (r) => path.join(r, '__无__'), 瞭望塔目录: (r) => path.join(r, '__无__') },
    码印: { 比对: () => ({ 一致: true }), 源码改动时刻: () => null }, 配置: () => ({}) };
  seed(root, '完成', { id: 'TK-9', 验收方式: '保留' });
  const 债 = gr.等我(root, { deps: 空 }).债;
  const g3 = 债.find((d) => d.闸号 === 'G3');
  const g7 = 债.find((d) => d.闸号 === 'G7');
  assert.equal(g3.路由, '#/t/TK-9', '{id} 占位在服务端就替换掉——替换规则只许有一处');
  assert.equal(g7.路由, '#/relay', '非工单实体跳它自己的落点，不跳工单详情页');
  assert.equal(g7.title, '做个存档系统',
    '想法的标题字段叫 **文本**；原写 x.文||x.题 两个都不存在，三级兜底全落到 id，收件箱上只剩个裸号');
});

t('注册表路由随债下发 · 全响应闸实证：每笔债的 路由 = 注册表那一格，非工单实体绝不跳 #/t/', () => {
  // 案源（2026-08-21 收件箱死链族 · 2026-08-22 复核重立）：注册表逐闸写着落点，消费端却「按 id
  // 形状猜」——想法 I-xxx、待办 uuid、wiki 名称一律被送去 `#/t/<非工单号>`，服务端只会回
  // 「工单不存在」，点进去就是死页。治法是**路由随债下发**，而上一版判据是两句源码 grep：
  // 复核实测把病灶原样种回去（前端改回猜形状、闸表删掉 路由 列），19 项测试一格没红。
  // 故这一格改成真跑：给**每一条响应闸**都造一笔真债，逐笔比对债上的 路由 与注册表那一格。
  const root = makeRoot();
  const 馆 = path.join(root, '实证馆'); const 塔 = path.join(root, '实证塔'); const 账 = path.join(root, '实证台账');
  fs.mkdirSync(馆, { recursive: true }); fs.mkdirSync(塔, { recursive: true }); fs.mkdirSync(账, { recursive: true });
  fs.writeFileSync(path.join(馆, '2026-08-11-夜班.md'), '归档', 'utf8');
  // G13 判「多久没有新归档」，刚写的文件不算断更——夹具要把 mtime 拨老才出得了债
  { const t = new Date(Date.now() - 72 * 3600000); fs.utimesSync(path.join(馆, '2026-08-11-夜班.md'), t, t); }
  fs.writeFileSync(path.join(塔, '账本水位.json'), JSON.stringify({ 至: '2026-08-09T00:00:00Z' }), 'utf8');
  fs.writeFileSync(path.join(塔, '未读账本.jsonl'), JSON.stringify({ t: '2026-08-20T00:00:00Z' }), 'utf8');
  fs.writeFileSync(path.join(塔, '心跳.txt'), '2026-08-20T23:00:00Z', 'utf8');   // G20：距「现在」1 小时 > 90s
  fs.writeFileSync(path.join(账, '台账.json.损毁-1.json'), '{}', 'utf8');          // G18：退空现场
  fs.writeFileSync(path.join(账, '台账.json.待人裁'), '{}', 'utf8');
  // 工单五闸（G1/G2/G3/G12/G21）走真盘，不注桩——路由带 {id} 的正是这几条
  seed(root, '待审', { id: 'TK-21' });                                      // G21 切单待审
  seed(root, '待派', { id: 'TK-1' });                                        // G1 未放行
  seed(root, '待处理', { id: 'TK-2', 上呈原因: '三振上呈，四件套待裁' });     // G2 定夺类
  seed(root, '完成', { id: 'TK-3', 验收方式: '保留' });                       // G3 保留单终审
  seed(root, '待处理', { id: 'TK-4', 失败原因: 'CLI 超时' });                 // G12 失败裸单
  // G26 停靠单候裁：待派里被人为摁住等裁的单。必须与 TK-1（G1 未放行）分开两张——
  // 同一张单不会既在 G1 又在 G26，正是「摘出去要有地方接」这条设计的实证。
  seed(root, '待派', { id: 'TK-5', 停靠: true, 停靠因: '项目错配候定夺废弃', 停靠自: '2026-08-19T00:00:00Z' });
  // G27 候引擎实证：核查目录里盖了 H97 候检印、还没走实证放行的单。
  // **与 TK-3（G3 完成候终审）分开两张**：G3 只扫完成目录，盖印到放行之间那一段在核查——
  // 正是这一段两天没人看见（TK-185/TK-203 实况，2026-08-26 05:54 起）。
  seed(root, '核查', { id: 'TK-6', 待引擎实证: { 命中: 'enginectl', 时间: '2026-08-19T00:00:00Z', 判源: '核查' } });
  const 待办uuid = '68ad57db-9ccc-4135-b5e9-fac139b526f0';   // 待办的 id 是 uuid，怎么猜都猜不成工单号
  const 全 = {
    specials: { list: () => [{ id: 'S-1', fm: { 名称: '编辑器专项', 状态: '收口', 关账时间: null, 收口时间: '2026-08-18T00:00:00Z', 管线: 'P-1', 特性: 'F-3' } }] },
    ideas: { list: () => [{ id: 'I-m5x2k9', 文本: '做个存档系统', t: '2026-08-19T00:00:00Z' }] },
    // 河道分段（无日期）喂 G24 未排期；越线粒（计划开始已过、无单号）喂 G23 今时线
    schedule: { 现态: () => [
      { 粒ID: 待办uuid, 题: '河道分段', 状态: '计划', 就绪: true },
      { 粒ID: '粒-越线', 题: '越线的', 状态: '计划', 计划开始: '2026-08-19T12:00' },
    ] },
    gates: { isPaused: () => false },   // G23 产线开才有债（停表档另有专测）
    wiki: { pending: () => [{ 名称: '美术标杆-配色' }] },
    features: { list: () => [{ id: 'F-7', fm: { 名称: '水体图层', 状态: '待审', 管线: 'P-2', 提请时间: '2026-08-19T00:00:00Z' } }] },
    台账目录: () => 账,
    值守: { 班档目录: () => 馆, 瞭望塔目录: () => 塔 },
    码印: { 比对: () => ({ 一致: false, 因: '活体 0.26.1 / 源码 0.26.9' }), 源码改动时刻: () => '2026-08-20T00:00:00Z' },
    配置: () => ({}),
    配置状态: () => ({ 巡检异常拍: 3, 巡检异常起: '2026-08-20T00:00:00Z' }),
    台账: { 事件流体检: () => ({ 总行: 3445, 坏行: [2728], 含NUL: true }) },
    // G25 值守塔阵亡（TK-210）：生产端把对账结论写 .值守心跳.json，判据照抄不二次算阈值
    值守心跳: { STATE_FILE: '实证心跳.json', 读态: () => ({ 阵亡: true, 阵亡起: '2026-08-20T12:00:00Z', 无回执: 3, seq: 5, 在位: { seq: 1 } }) },
  };
  fs.writeFileSync(path.join(root, '实证心跳.json'), '{}', 'utf8'); // 判据先验文件在不在（不在=没开值守心跳）
  const r = gr.等我(root, { 现在: '2026-08-21T00:00:00Z', deps: 全 });
  const 表 = gr.注册表(root);
  const 响应 = 表.filter((g) => g.判据);

  // ① 覆盖完备：每条响应闸都真出了债。将来加一条闸而这里没给它造数据，**这一格先红**——
  //    免得新闸的路由一次都没被验过就上线（G7/G10 当年正是「现网空队列＝潜伏未爆」）。
  const 出债的 = new Set(r.债.map((d) => d.闸号));
  assert.deepEqual(响应.filter((g) => !出债的.has(g.闸号)).map((g) => g.闸号), [],
    '每条响应闸都要被这一格覆盖到（新闸要在这补夹具）；判据失败列：' + JSON.stringify(r.失败));

  // ② 逐笔比对：债上的 路由 必须等于**这里写死的那一格**。
  //    早先这一格是拿注册表模板现算 `g.路由.replace('{id}',…)` 出来比的——那等于用被测对象
  //    自己算一遍期望值，改坏模板两边一起变，判据照绿。故期望值在测试里独立写死一张表：
  //    新闸没写进来先红（逼人当场想清它该跳哪儿），改坏任何一条模板也红。
  const 期望路由 = {
    G1: '#/board', G2: '#/t/TK-2', G3: '#/t/TK-3', G12: '#/board', G21: '#/board',
    G6: '#/tickets/P-1/F-3',      // 专项挂 P-1/F-3 → 第三层那页，spCard 与关账签字钮都在那儿
    G7: '#/relay', G8: '#/relay', G10: '#/wiki',
    G13: '#/', G14: '#/', G15: '#/', G16: '#/', G17: '#/', G18: '#/', G20: '#/', G25: '#/',
    G19: '#/tickets/P-2',         // 待审特性挂 P-2 → 该管线的特性层，审核两颗钮画在特性卡上
    G23: '#/relay', G24: '#/relay', // 今时线/未排期都是排期账的债，表态与排期都在项管页（H112）
    G26: '#/board',               // 停靠单候裁：单还蹲在待派列里，解除停靠与废弃两颗钮都画在看板那一列
    G27: '#/t/TK-6',              // 候引擎实证：要看着回执里的引擎证据才能签，钮跟着单据详情走（同 G3）
  };
  assert.deepEqual(响应.filter((g) => !(g.闸号 in 期望路由)).map((g) => g.闸号), [],
    '新加的响应闸要在 期望路由 表里写明它跳哪儿——写不出来说明这条闸没想清落点');
  for (const d of r.债) {
    assert.equal(d.路由, 期望路由[d.闸号],
      `${d.闸号} 的路由不对：债上「${d.路由}」应为「${期望路由[d.闸号]}」（注册表模板「${表.find((x) => x.闸号 === d.闸号).路由}」）`);
    assert.ok(d.路由 && d.路由.startsWith('#/'), `${d.闸号} 的路由要是 hash 形，拿到的是「${d.路由}」`);
    assert.ok(!String(d.路由).includes('{'), `${d.闸号} 的占位没被替换：「${d.路由}」`);
  }

  // ③ 真病：非工单实体一笔都不许跳 #/t/。服务端对那个 id 只会回「工单不存在」，那就是死链。
  const 工单号 = /^[A-Z][A-Za-z]*-\d+$/;
  const 死链 = r.债.filter((d) => String(d.路由).startsWith('#/t/') && !工单号.test(String(d.id)));
  assert.deepEqual(死链.map((d) => d.闸号 + ':' + d.id + '→' + d.路由), [], '任何 #/t/<非工单号> 都是死链');

  // ④ 点名三类非工单实体各自的落点，免得 ③ 靠「恰好一笔非工单债都没有」空过
  const 取 = (n) => r.债.find((d) => d.闸号 === n);
  assert.deepEqual([取('G7').id, 取('G7').路由], ['I-m5x2k9', '#/relay'], '想法（I-xxx）落项管页');
  assert.equal(取('G8'), undefined, 'G8 已裁撤（2026-08-26），uuid 待办不再立放行债');
  assert.deepEqual([取('G10').id, 取('G10').路由], ['美术标杆-配色', '#/wiki'], 'wiki（名称）落 Wiki 页');
  assert.deepEqual([取('G3').id, 取('G3').路由], ['TK-3', '#/t/TK-3'], '真工单才跳工单详情页');
  assert.equal(取('G6').路由, '#/tickets/P-1/F-3', '专项落它那张 spCard 真被画出来的那一层，不是管线网格');
  assert.deepEqual([取('G19').id, 取('G19').路由], ['F-7', '#/tickets/P-2'], '待审特性落它自己管线的特性层');
});

t('桌面通知读的是全系统唯一谓词（main.js 接线）', () => {
  // 这一格原先还压着两句 app.js 源码 grep，2026-08-22 复核当场判掉，故删：
  //   · 负向那句写 `到: /^[A-Z]\d+$/.test`，而病灶写的是 `[A-Z]-\d+`——差一个连字符，
  //     把病灶原样贴回去它照绿。守着一个匹配不到病灶的正则，比没守更坏：让人以为有人在看。
  //   · 正向那句 `assert.match(src, /到: x\.路由 \|\|/)` 只证明「某几个字还在」，
  //     换个写法就假红、被外层 if 绕过就假绿——本项目已明令这类判据不算数。
  // 闸表这一侧的真判据改由下面那格「注册表路由随债下发 · 全响应闸实证」承担（真调 等我() 取 路由）；
  // 前端那一侧（viewOverview 到底把 hash 拼成什么）由 test/frontend-sandbox.js 真跑渲染函数另立一格。
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const NL = String.fromCharCode(10); // 字面换行经不住本项目的编辑管道（当日五犯），用码点写
  const 代码 = m.split(NL).filter((l) => !l.trim().startsWith('//')).join(NL);
  assert.ok(!/api\/attention/.test(代码), '桌面通知不许再读已退役的 /api/attention（那条轴看不见非工单人闸）');
  assert.match(代码, /api\/attn\?/, '改读全系统唯一谓词');
  assert.match(代码, /gateKey/, '按 gateKey 集合比新增，不按计数上涨——签掉一笔又来一笔时计数净值不变，会整笔漏报');
});

t('G16 巡检连炸：一次不算，连三拍（45 分钟）才立债', () => {
  // 案源：六只看门狗原本串在一个裸 catch 里同生共死，先炸的一只把后面全静默掐掉。
  // 逐狗兜异常之后，还得有人知道「狗自己坏了」——不然只是把静默从一处挪到另一处。
  const root = makeRoot();
  const 造 = (n, 起) => ({ ...空, 配置状态: () => ({ 巡检异常拍: n, 巡检异常起: 起 }) });
  assert.equal(gr.等我(root, { deps: 造(0) }).债.filter((d) => d.闸号 === 'G16').length, 0, '零异常不报');
  assert.equal(gr.等我(root, { deps: 造(2) }).债.filter((d) => d.闸号 === 'G16').length, 0, '两拍还不算——一次异常可能只是瞬时的');
  const r = gr.等我(root, { 现在: '2026-08-21T12:00:00Z', deps: 造(3, '2026-08-21T11:00:00Z') });
  const g16 = r.债.find((d) => d.闸号 === 'G16');
  assert.ok(g16, '三拍即立债');
  assert.equal(g16.归属, '总监', '看门狗是我的活，不占制作人版面');
  assert.equal(g16.停摆小时, 1, '停摆自 = 第一拍炸的时刻，据它算欠了多久');
  assert.match(g16.title, /连续 3 拍/);
});

t('G17 台账坏行：读不出来的行不许静默跳过（2026-08-21 案）', () => {
  // 案源：事件.jsonl 第 2728 行有 133 个前导 NUL，JSON 本体完好却被读侧 .filter(Boolean) 抹掉——
  // 账少算一笔而没人知道。**坏行不是「少一条」，是「整本账不可信」**：
  // append-only 的日志中间坏一行，后面全部内容的可信度都要打折。
  const root = makeRoot();
  const 注 = (体检) => ({ ...空, 台账: { 事件流体检: () => 体检 } });
  assert.equal(gr.等我(root, { deps: 注({ 总行: 3445, 坏行: [], 含NUL: false }) }).债.filter((d) => d.闸号 === 'G17').length, 0,
    '干净账本零债');
  const r = gr.等我(root, { deps: 注({ 总行: 3445, 坏行: [2728], 含NUL: true }) });
  const g17 = r.债.find((d) => d.闸号 === 'G17');
  assert.ok(g17, '有坏行就要立债');
  assert.match(g17.title, /行号 2728/, '要点名是哪一行——不点名等于让人自己去翻 3445 行');
  assert.match(g17.title, /NUL/, 'NUL 是成因线索，要报出来');
  assert.equal(g17.归属, '总监');
  // 只有 NUL 没有坏行（NUL 落在无关位置）同样要报——它是断电写坏的证据
  assert.equal(gr.等我(root, { deps: 注({ 总行: 10, 坏行: [], 含NUL: true }) }).债.filter((d) => d.闸号 === 'G17').length, 1);
});

t('G18 台账退空：主档崩了退回空账，账面看着正常只是数字全是 0（2026-08-20 管理费 98.1 万归零案）', () => {
  // G17 盯的是事件流里读不出来的**行**，这条盯的是**主档本身**崩了。
  // lib/pm/ledger.js 已经把损毁现场留档、把记账改道 台账.json.待人裁——可那两样都只是留痕：
  // 留档在、人不知道，就等于没留。所以这条闸的活是「把留痕摆上值守板」。
  const root = makeRoot();
  const 账 = path.join(root, '台账区'); fs.mkdirSync(账, { recursive: true });
  const 注 = { ...空, 台账目录: () => 账 };
  const 取 = () => gr.等我(root, { deps: 注 }).债.filter((d) => d.闸号 === 'G18');
  assert.equal(取().length, 0, '空目录零债');
  fs.writeFileSync(path.join(账, '台账.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(账, '台账.json.bak'), '{}', 'utf8');
  assert.equal(取().length, 0, '主档与副本都好好的，同样零债——正常记账不许被当成灾情');

  // 现场之一：损毁档（真账坏过的物证）
  const 损 = path.join(账, '台账.json.损毁-1755800000000.json');
  fs.writeFileSync(损, '{}', 'utf8');
  const a = 取();
  assert.equal(a.length, 1, '留了损毁档就立债');
  assert.equal(a[0].gateKey, 'G18:项管台账');
  assert.ok(a[0].title.includes('损毁档 1 份'), '份数要报出来：' + a[0].title);
  assert.equal(a[0].归属, '总监', '记账是我的活，不占制作人版面');
  assert.ok(a[0].停摆自, '停摆自取现场文件的落盘时刻——退空多久了要看得见');

  // 现场之二：记账改道（门闩此刻还挂着 = 还没捞回来）
  const 裁 = path.join(账, '台账.json.待人裁');
  fs.writeFileSync(裁, '{}', 'utf8');
  assert.ok(取()[0].title.includes('待人裁'), '门闩还挂着要报出来，那是「此刻仍未捞回」的证据：' + 取()[0].title);

  // **反向用例**（本项目 G14 犯过「清完账 3 秒又报债」的恒真闸事故）：
  // 人把损毁档里的账捞回来、现场清掉之后，这条闸必须当场归零。
  fs.rmSync(裁); fs.rmSync(损);
  assert.equal(取().length, 0, '现场清干净就必须销债——盯的是「现场还在不在」，不是「历史上出过事」');

  // 注入的目录必须真被用上：真 root 下另铺一份现场，注入指向别处时不许把它算进来
  const 别处 = path.join(root, '项管台账'); fs.mkdirSync(别处, { recursive: true });
  fs.writeFileSync(path.join(别处, '台账.json.待人裁'), '{}', 'utf8');
  assert.equal(取().length, 0, '算的是注入的那个目录，不是就地拼的 root/项管台账');
  assert.equal(gr.等我(root, { deps: { ...空, 台账目录: () => 别处 } }).债.filter((d) => d.闸号 === 'G18').length, 1,
    '指到那个目录才算得到——两句合起来才证明路径真的走了注入');
});

t('G19 特性待审：审批事实推导不出来，没闸催它就只会烂在树里（2026-08-22 体检 #59）', () => {
  // 「待审」的行为差别是**挂不了单**（lib/features.js 头注）：项管提请完就躺在那儿，
  // 界面上审核两颗钮已经有了，但没有任何东西会催——特性卡在待审，它名下的活一张单也开不出来。
  const root = makeRoot();
  const F = (id, 状态, o = {}) => ({ id, fm: { 名称: id + ' 号特性', 状态, 管线: 'P-2', ...o } });
  const 造 = (...fx) => ({ ...空, features: { list: () => fx } });
  const 取 = (d) => gr.等我(root, { 现在: '2026-08-22T00:00:00Z', deps: d }).债.filter((x) => x.闸号 === 'G19');
  assert.equal(取(造()).length, 0, '一个特性都没有 → 零债');
  assert.equal(取(造(F('F-1', '活跃'), F('F-2', '封存'))).length, 0,
    '**反向用例**：活跃/封存都不是在等人——审完就必须销债，不许恒真（G14 案）');
  const r = 取(造(F('F-1', '活跃'), F('F-99', '待审', { 提请时间: '2026-08-21T00:00:00Z' })));
  assert.equal(r.length, 1, '只有待审那一条算债');
  assert.deepEqual([r[0].gateKey, r[0].id, r[0].title], ['G19:F-99', 'F-99', 'F-99 号特性']);
  assert.equal(r[0].归属, '总监', '开线是制作人人闸、开特性下放项管、**审归总监**');
  assert.equal(r[0].停摆小时, 24, '停摆自 = 提请时刻，项管提请之后压了多久一目了然');
  assert.equal(r[0].路由, '#/tickets/P-2', '跳它自己管线的特性层——审核两颗钮画在那一页的特性卡上');

  // 真盘一趟：形状假设（list() 回 { id, fm, body }）直接拿 lib/features 验。
  // 猜成扁平的 f.状态 就是**恒空**——闸立了、判据在、一笔也出不来，比没立更坏。
  const 特性目录 = path.join(root, '特性'); fs.mkdirSync(特性目录, { recursive: true });
  const NL = String.fromCharCode(10);
  fs.writeFileSync(path.join(特性目录, 'F-98.md'),
    ['---', 'id: F-98', '名称: 真盘特性', '管线: P-3', '状态: 待审', "提请时间: '2026-08-21T00:00:00Z'", '---', ''].join(NL), 'utf8');
  const 真 = { ...空 }; delete 真.features;   // 只放开这一路走真模块
  const rr = gr.等我(root, { 现在: '2026-08-22T00:00:00Z', deps: 真 }).债.filter((x) => x.闸号 === 'G19');
  assert.deepEqual(rr.map((x) => [x.id, x.title, x.路由]), [['F-98', '真盘特性', '#/tickets/P-3']],
    'lib/features.list 的真形状喂进来照样出债——桩上绿不算数');
});

t('G20 瞭望塔失守：塔是值守的眼睛，它自己死的那一刻最不可能有人喊（2026-08-22 体检 #68）', () => {
  // G13/G14 治的都是「塔在跳、消费侧断了」；这条治的是塔本身停跳。
  // 阈值 90 秒 = 三个心跳周期，与 packages/watchtower/watchtower.js 自报「在跳」同一把尺
  // （塔每 30s 覆盖写一行 ISO）。取 45s 就是一拍半，一次写盘抖动即立债——那是把噪声当灾情。
  const root = makeRoot();
  const 塔 = path.join(root, '实证塔20');
  const 注 = { ...空, 值守: { 班档目录: (r) => path.join(r, '__无馆__'), 瞭望塔目录: () => 塔 } };
  const 现在 = '2026-08-22T12:00:00Z'; const T0 = Date.parse(现在);
  const 取 = () => gr.等我(root, { 现在, deps: 注 }).债.filter((d) => d.闸号 === 'G20');
  assert.equal(取().length, 0, '心跳文件不存在 = 本仓没装塔 → 一笔都不许报（宁可恒空也不虚报）');
  fs.mkdirSync(塔, { recursive: true });
  const 写戳 = (偏秒) => fs.writeFileSync(path.join(塔, '心跳.txt'), new Date(T0 - 偏秒 * 1000).toISOString(), 'utf8');
  写戳(10); assert.equal(取().length, 0, '10 秒前跳过 → 在岗');
  写戳(90); assert.equal(取().length, 0, '恰好 90 秒（三拍）仍算在岗——边界含等号，与写口那把尺同一档');
  写戳(91);
  const r = 取();
  assert.equal(r.length, 1, '91 秒即断更立债');
  assert.deepEqual([r[0].gateKey, r[0].归属], ['G20:瞭望塔', '总监']);
  assert.ok(r[0].title.includes('心跳断更'), '标题要说清是断更：' + r[0].title);
  assert.ok(r[0].停摆自, '停摆自 = 最后一跳，据它算断了多久');
  // **反向用例**：塔重挂上就必须当场销债（G14 恒真闸案）
  写戳(5);
  assert.equal(取().length, 0, '塔活过来 → 立刻销债');
  // 戳读不出来 ≠ 断更：那是塔写坏了（G16 巡检族的活），这条闸判不出在不在岗就不许报
  fs.writeFileSync(path.join(塔, '心跳.txt'), '不是个时间', 'utf8');
  assert.equal(取().length, 0, '戳解析不出 → 不虚报');
  fs.writeFileSync(path.join(塔, '心跳.txt'), '', 'utf8');
  assert.equal(取().length, 0, '空文件同样不报');
  // 注入的塔必须真被用上：root/瞭望塔 放一份**新鲜**戳，注入的塔放一份陈旧戳 → 债要按注入那份算
  const 就地塔 = path.join(root, '瞭望塔'); fs.mkdirSync(就地塔, { recursive: true });
  fs.writeFileSync(path.join(就地塔, '心跳.txt'), new Date(T0 - 5000).toISOString(), 'utf8');
  写戳(600);
  assert.equal(取().length, 1, '读的是注入的那个塔，不是就地拼的 root/瞭望塔——两份戳一新一旧才验得出来');
});

t('G27 候引擎实证：盖印到放行之间那一段在核查目录，而 G3 只扫完成——这一段原本谁都看不见', () => {
  const root = makeRoot();
  // 核查目录里盖了 H97 候检印的单 = G27 的债
  seed(root, '核查', { id: 'TK-E1', 待引擎实证: { 命中: 'enginectl', 时间: '2026-08-19T00:00:00Z', 判源: '核查' } });
  // 同在核查但没盖印的单不该被算进来（代核还没跑到它，那不是人在等）
  seed(root, '核查', { id: 'TK-E2' });
  // 已经转进完成、仍带印的归 G3（它的判据里列着 待引擎实证）——两条闸不许把同一张单各计一笔
  seed(root, '完成', { id: 'TK-E3', 专项: 'S-9', 待引擎实证: { 命中: 'enginectl', 时间: '2026-08-19T00:00:00Z' } });

  const r = gr.等我(root, { 现在: '2026-08-21T00:00:00Z', deps: 空 });
  const g27 = r.债.filter((x) => x.闸号 === 'G27');
  assert.deepEqual(g27.map((x) => x.id), ['TK-E1'], '只认核查目录里盖了印的那张');
  assert.equal(g27[0].归属, '总监', '实证放行的操作域就是总监，别报进制作人的清单');
  assert.match(g27[0].因, /enginectl/, '因要说出门禁命中了什么——只给单号等于没说在等什么');
  assert.equal(g27[0].停摆自, '2026-08-19T00:00:00Z',
    '停摆自取盖印时刻，不取单的更新时刻——后者被任何一次无关 fm 改写刷新，会把两天等成零小时');

  const g3 = r.债.filter((x) => x.闸号 === 'G3').map((x) => x.id);
  assert.ok(g3.includes('TK-E3'), '转进完成的仍归 G3');
  assert.ok(!g3.includes('TK-E1'), '还在核查的不许被 G3 重复计一笔');
});

t('G6 路由分流：spCard 画在哪一页就跳哪一页，够不着的老实回落（2026-08-22 体检 #67③）', () => {
  // 病灶：注册表 G6 写 路由 '#/tickets'——那是**管线网格**，而「关账签字」那颗钮画在 spCard 上，
  // spCard 只在 tkL3（#/tickets/<管线>/<特性>）与 TF 专用层（#/tickets/Ticketflow）两处渲染。
  // 门牌指到一层，人点进去看见一片管线卡，那颗钮在哪儿全靠自己找。
  const root = makeRoot();
  const 路 = (fm) => gr.等我(root, { deps: { ...空, specials: { list: () => [
    { id: 'S-1', fm: { 名称: 'x', 状态: '收口', 关账时间: null, 收口时间: '2026-08-18T00:00:00Z', ...fm } },
  ] } } }).债.find((d) => d.闸号 === 'G6').路由;
  assert.equal(路({ 管线: 'P-1', 特性: 'F-3' }), '#/tickets/P-1/F-3', '两格都在 → 第三层，spCard 与关账钮都在那儿');
  assert.equal(路({ 管线: null, 特性: null, 项目: 'Ticketflow' }), '#/tickets/Ticketflow',
    'TF 不设管线与特性层（H52 不同项目不同形状），它的卡画在 TF 专用层');
  assert.equal(路({ 管线: 'P-1' }), '#/tickets',
    '有管线无特性（S-1/S-2/S-3 那批存量）→ 现有界面没有一页画得出它的卡，回落一层。回落是实话，编个 hash 只是把死链换个位置');
  assert.equal(路({}), '#/tickets', '三格全无照样回落');
  // 占位漏出去比不跳更坏：'#/tickets/undefined' 点进去是空页，看的人会以为数据没了
  for (const fm of [{ 管线: 'P-1' }, {}, { 特性: 'F-3' }, { 管线: '', 特性: 'F-3' }]) {
    const h = 路(fm);
    assert.ok(h && !h.includes('{') && !h.includes('undefined') && !h.includes('null'),
      '回落路由不许带占位/undefined/null，拿到的是「' + h + '」（' + JSON.stringify(fm) + '）');
  }
});

t('T<=0 = 关闭升格，不是「阈值 0 即全红」：口径落进判定本身，不指望调用方各记一遍（2026-08-21 案）', () => {
  // 案源：runner.js 用 `?? 24` 并注明「0 是合法值＝关闭升格」，/api/attn 那侧用 `|| 24`——
  // 把 闸值.人闸超时小时 设成 0，runner 侧一封信不发，界面侧照旧按 24 小时把债标红，两边打架且无提示。
  // 逾期阈值() 当时把 T 的**取值**收成一处，但「T<=0 怎么办」仍散在各调用方，等着第三个人不知道。
  const root = makeRoot();
  const deps = { ...空, specials: { list: () => [
    { id: 'S-老', fm: { 名称: '老', 状态: '收口', 关账时间: null, 收口时间: '2026-08-18T00:00:00Z' } },
  ] } };
  const o = { 现在: '2026-08-20T00:00:00Z', deps };
  assert.deepEqual(gr.逾期(root, 1, o).map((x) => x.id), ['S-老'], 'T=1 该有逾期——这一格不成立，下面两格就是假绿');
  assert.deepEqual(gr.逾期(root, 0, o), [], 'T=0 是「关闭升格」，不是「阈值 0 故全部逾期」——读反了正是本案病灶');
  assert.deepEqual(gr.逾期(root, -1, o), [], '负值同待遇');
  assert.deepEqual(gr.逾期(root, 24, o).map((x) => x.id), ['S-老'], '关掉的只有 T<=0 那一档，正常阈值照旧出数');
  assert.deepEqual(gr.逾期(root, null, o).map((x) => x.id), ['S-老'], '不传 T 仍走缺省 24，不许被新早退顺手吃掉');
});

t('端点实跑 · 人闸超时小时=0 时 /api/attn 必须下发「关闭升格」（阈值 null + 零逾期，债照常在）', () => {
  // 上一格判的是谓词；这一格判的是**接线**：前端 public/app.js 拿 逾期阈值小时 自己重算红标，
  // 阈值留着 0 的话页面照样全红——所以端点必须下发 null，而不是只把 逾期 数组清空。
  const { execFileSync } = require('child_process');
  const root = makeRoot();
  const port = 4934;
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'studio.config.json'), 'utf8'));
  cfg.闸值 = { ...(cfg.闸值 || {}), 人闸超时小时: 0 };
  fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify(cfg), 'utf8');
  seed(root, '完成', { id: 'TK-77', 验收方式: '保留' });   // 造一笔真债（G3 保留单终审；更新时间 2026-07-08，早就该逾期）
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
      const r = await fetch('http://127.0.0.1:${port}/api/attn');
      const j = await r.json();
      process.stdout.write('@@' + JSON.stringify([r.status, j.逾期阈值小时, (j.逾期 || []).length, (j.债 || []).map((x) => x.id)]) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify(['起服务失败', String(e.message)]) + '@@'); process.exit(1); });
  `;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const out = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '[]');
  assert.deepEqual(out.slice(0, 3), [200, null, 0],
    'T=0 → 阈值下发 null（不是 0）、逾期清空；拿到的是 ' + JSON.stringify(out));
  assert.ok(out[3] && out[3].includes('TK-77'),
    '债本身照常在——关的是升格，不是把债藏起来。这一格若空，上面那两格就是空过：' + JSON.stringify(out));
});

console.log('全部通过：' + passed + ' 项');
