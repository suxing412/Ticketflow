// ledger-sync.test.js — 工单台账自动对齐（H102 · 施工令-052 第 5 条）
// 被测面：差量纯函数各分支（新单挂粒 / 返修承袭 / 状态各迁移 / 废弃口径 / 只前进不倒退 /
// 孤粒告警）、执行器（CAS 落地 · 幂等 · 失败重试一轮 · 信箱告警）、挂拍（journal 增量去抖合并
// + 5 分钟例行兜底 + 首跑全量）。
// 纪律沿用 schedule.test：接线那一格走**真 runner.tick**，不拿 mock 冒充接线证据——
// 挂接点挂错了而单测全绿，正是施工令-039 那类事故的温床。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRoot, seed } = require('./helper');
const LS = require('../lib/pm/ledger-sync');
const S = require('../lib/pm/schedule');
const store = require('../lib/core/store');
const state = require('../lib/core/state');
const inbox = require('../lib/inbox');
const pmLedger = require('../lib/pm/ledger');
const quota = require('../lib/quota');
// 测试隔离（同 dispatch-tick 2026-08-05 案）：额度闸别去查真实订阅用量
quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('ledger-sync 台账自动对齐测试');

// 专项 + 子单的标准铺法：父单是容器（父单类型=专项），子单挂 父单
const 铺专项 = (root, { 父 = 'TK-150', 名 = '编辑器专项', 父态 = '在途' } = {}) => {
  seed(root, 父态, { id: 父, title: 名, 父单类型: '专项', 职能: '策划' });
  return 父;
};
const 差 = (root) => LS.差量(store.snapshot(root), S.现态(root));

(async () => {
  // ---- ① 新单挂粒 ----
  await t('新单挂粒：专项子单无粒 → 登粒（批=父单专项名 · 题=单题 · 单号挂链 · 依赖照 fm）', async () => {
    const root = makeRoot();
    铺专项(root);
    seed(root, '草稿', { id: 'TK-156', title: '大纲树拖拽', 父单: 'TK-150', 职能: '程序', 依赖: ['TK-151', 'TK-152'] });
    const { 动作, 异常 } = 差(root);
    assert.equal(动作.length, 1, '一张缺粒子单 = 一条登粒动作');
    assert.equal(异常.length, 0);
    const a = 动作[0];
    assert.equal(a.动作, '登粒');
    assert.equal(a.批, '编辑器专项', '批名取父单专项名');
    assert.equal(a.题, '大纲树拖拽');
    assert.equal(a.单号, 'TK-156', '单号挂链');
    assert.equal(a.父单, 'TK-150');
    assert.equal(a.序, 156, '序取单号数字尾——重跑同序，不靠"当前有几粒"这种会漂的量');
    assert.equal(a.状态, '起草中', '单在草稿 → 粒起草中');
    assert.deepEqual(a.依赖, [{ ref: 'TK-151', 规则: '全部完成' }, { ref: 'TK-152', 规则: '全部完成' }],
      '依赖照 fm（工单依赖=全部落袋才就绪 → 粒规则 全部完成）');
    // 逗号分隔的老写法（dispatch.depsDone 同款）也要认
    seed(root, '草稿', { id: 'TK-157', title: '属性面板', 父单: 'TK-150', 依赖: 'TK-151，TK-152' });
    const b = 差(root).动作.find((x) => x.单号 === 'TK-157');
    assert.deepEqual(b.依赖.map((d) => d.ref), ['TK-151', 'TK-152'], '逗号分隔字符串依赖同样解析');
  });

  await t('不该登的不登：散单 / 非专项父单的子单 / 专项父单自身 / 已有粒的单', async () => {
    const root = makeRoot();
    铺专项(root);
    seed(root, '草稿', { id: 'TK-200', title: '散单' });                                  // 无父单
    seed(root, '草稿', { id: 'TK-201', title: '普通父', 父单类型: '普通' });
    seed(root, '草稿', { id: 'TK-202', title: '普通父的子', 父单: 'TK-201' });              // 父单不是专项/战役
    seed(root, '草稿', { id: 'TK-203', title: '父单不存在', 父单: 'TK-999' });
    seed(root, '草稿', { id: 'TK-204', title: '嵌套专项', 父单: 'TK-150', 父单类型: '战役' }); // 自己也是容器
    assert.deepEqual(差(root).动作, [], '容器与散单一律不造粒');
    // 已有粒（粒ID 挂链 / 单号挂链两条认亲路各验一次）
    const g1 = S.登记(root, [{ 批: '编辑器专项', 序: 1, 题: '已登甲', 来源: 'x1', 状态: '起草中', 单号: 'TK-205' }], '总监').新增[0];
    seed(root, '草稿', { id: 'TK-205', title: '已登甲', 父单: 'TK-150' });                  // 靠单号认
    seed(root, '草稿', { id: 'TK-206', title: '已登乙', 父单: 'TK-150', 粒ID: g1.粒ID });   // 靠粒ID 认（单号对不上也认）
    assert.deepEqual(差(root).动作.map((x) => x.单号), [], '认得出粒的单不再重复登');
  });

  await t('返修承袭：返工/推翻新号登粒时承袭原粒的批（不另起一个批）', async () => {
    const root = makeRoot();
    铺专项(root, { 名: '汉代地图专项' });
    S.登记(root, [{ 批: '批A', 序: 1, 题: '水系描线', 来源: '总清单 §3 批A', 状态: '完成', 单号: 'TK-128' }], '总监');
    seed(root, '已归档', { id: 'TK-128', title: '水系描线', 父单: 'TK-150', 归档原因: '返工替代' });
    seed(root, '草稿', { id: 'TK-170', title: '水系描线（推翻重做）', 父单: 'TK-150', 返工自: 'TK-128' });
    const a = 差(root).动作.find((x) => x.单号 === 'TK-170');
    assert.equal(a.动作, '登粒');
    assert.equal(a.批, '批A', '承袭原粒批，而不是父单专项名「汉代地图专项」');
    assert.ok(a.因.includes('承袭'), '动作要自带因，回执里能读懂为什么这样登：' + a.因);
    // 原粒无从查起时退回父单专项名
    seed(root, '草稿', { id: 'TK-171', title: '孤返工', 父单: 'TK-150', 返工自: 'TK-888' });
    assert.equal(差(root).动作.find((x) => x.单号 === 'TK-171').批, '汉代地图专项');
  });

  // ---- ② 状态随单 ----
  await t('状态映射：九态逐格（待投仍算起草中 / 已归档按有无归档原因分岔）', async () => {
    const 期 = {
      草稿: '起草中', 待投: '起草中', 池: '已成单', 在途: '已成单', 质检: '已成单',
      待验收: '已成单', 待定夺: '已成单', 执行失败: '已成单', 完成: '完成',
    };
    for (const s of store.STATES) {
      if (s === '已归档') continue;
      assert.equal(LS.目标状态({ state: s, fm: {} }), 期[s], `${s} 应映到 ${期[s]}`);
    }
    assert.equal(LS.目标状态({ state: '已归档', fm: {} }), '完成', '无因归档=正常交付后的整理性归档（落袋口径）');
    for (const 因 of ['废弃', '验收打回', '定夺打回', '返工替代', '推翻替代（制作人翻案）']) {
      assert.equal(LS.目标状态({ state: '已归档', fm: { 归档原因: 因 } }), '撤销', `带因归档（${因}）不算交付`);
    }
  });

  await t('状态随单：计划粒→已成单走补链两步；单完成→粒完成；单无因归档→粒完成', async () => {
    const root = makeRoot();
    铺专项(root);
    const g = S.登记(root, [{ 批: '编辑器专项', 序: 1, 题: '在途单', 来源: 's1' }], '总监').新增[0];
    seed(root, '在途', { id: 'TK-160', title: '在途单', 父单: 'TK-150', 粒ID: g.粒ID });
    const a = 差(root).动作.find((x) => x.单号 === 'TK-160');
    assert.equal(a.动作, '转移');
    assert.equal(a.从, '计划'); assert.equal(a.到, '已成单');
    assert.deepEqual(a.路径, ['起草中', '已成单'], '状态机不放宽：计划→已成单必须补起草中一步');
    // 完成 / 无因归档
    const g2 = S.登记(root, [{ 批: '编辑器专项', 序: 2, 题: '完成单', 来源: 's2', 状态: '已成单', 单号: 'TK-161' }], '总监').新增[0];
    seed(root, '完成', { id: 'TK-161', title: '完成单', 父单: 'TK-150', 粒ID: g2.粒ID });
    const g3 = S.登记(root, [{ 批: '编辑器专项', 序: 3, 题: '归档单', 来源: 's3', 状态: '已成单', 单号: 'TK-162' }], '总监').新增[0];
    seed(root, '已归档', { id: 'TK-162', title: '归档单', 父单: 'TK-150', 粒ID: g3.粒ID });
    const m = new Map(差(root).动作.map((x) => [x.单号, x]));
    assert.deepEqual(m.get('TK-161').路径, ['完成']);
    assert.deepEqual(m.get('TK-162').路径, ['完成'], '无因归档同样收成完成');
  });

  await t('废弃口径：已成单粒不可直撤 → 走 完成 + 说明「废弃闭合」（TK-144 先例）', async () => {
    const root = makeRoot();
    铺专项(root);
    const g = S.登记(root, [{ 批: '编辑器专项', 序: 1, 题: '被废单', 来源: 's', 状态: '已成单', 单号: 'TK-165' }], '总监').新增[0];
    seed(root, '已归档', { id: 'TK-165', title: '被废单', 父单: 'TK-150', 粒ID: g.粒ID, 归档原因: '废弃' });
    const a = 差(root).动作[0];
    assert.deepEqual(a.路径, ['完成'], '已成单→撤销 状态机禁行，改走完成');
    assert.ok(a.说明.includes('废弃闭合') && a.说明.includes('TK-144'), '说明要写清这是废弃闭合而非真交付：' + a.说明);
    // 前置态的粒该撤就撤，不走这条特例
    const g2 = S.登记(root, [{ 批: '编辑器专项', 序: 2, 题: '早废单', 来源: 's2' }], '总监').新增[0];
    seed(root, '已归档', { id: 'TK-166', title: '早废单', 父单: 'TK-150', 粒ID: g2.粒ID, 归档原因: '废弃' });
    const b = 差(root).动作.find((x) => x.单号 === 'TK-166');
    assert.deepEqual(b.路径, ['撤销'], '计划态粒直接撤销');
    // 落地一遍，确认真能过状态机（不是纸上谈兵）
    LS.执行(root, 差(root).动作);
    assert.equal(S.取(root, g.粒ID).状态, '完成');
    assert.ok(S.取(root, g.粒ID).末次说明.includes('废弃闭合'));
    assert.equal(S.取(root, g2.粒ID).状态, '撤销');
  });

  await t('只前进不倒退：粒已终态不动；H65 返修同号回草稿不把已成单粒拽回去', async () => {
    const root = makeRoot();
    铺专项(root);
    const g = S.登记(root, [{ 批: '编辑器专项', 序: 1, 题: '返修单', 来源: 's', 状态: '已成单', 单号: 'TK-167' }], '总监').新增[0];
    seed(root, '草稿', { id: 'TK-167', title: '返修单', 父单: 'TK-150', 粒ID: g.粒ID, 返修轮: 1 }); // 返修：单回草稿，号不变
    assert.deepEqual(差(root).动作, [], '已成单 → 起草中 不可达：账不倒着写');
    const g2 = S.登记(root, [{ 批: '编辑器专项', 序: 2, 题: '完成粒', 来源: 's2', 状态: '完成', 单号: 'TK-168' }], '总监').新增[0];
    seed(root, '在途', { id: 'TK-168', title: '完成粒', 父单: 'TK-150', 粒ID: g2.粒ID });
    assert.deepEqual(差(root).动作, [], '终态粒一律不再随单动');
    assert.equal(S.取(root, g2.粒ID).状态, '完成');
  });

  // ---- ③ 孤粒 ----
  await t('孤粒：粒指的单不存在 → 报异常不自动删；信箱告警按粒去重', async () => {
    const root = makeRoot();
    S.登记(root, [{ 批: '批A', 序: 1, 题: '幽灵粒', 来源: 's', 状态: '已成单', 单号: 'TK-777' }], '总监');
    const { 动作, 异常 } = 差(root);
    assert.deepEqual(动作, [], '孤粒不产生任何自动动作');
    assert.equal(异常.length, 1);
    assert.equal(异常[0].类型, '孤粒');
    assert.equal(异常[0].单号, 'TK-777');
    assert.ok(异常[0].说明.includes('不自动删'), '异常文案要点明人裁：' + 异常[0].说明);
    const r1 = LS.同步(root, { 触发: '例行' });
    assert.equal(r1.新报孤粒.length, 1);
    assert.equal(S.现态(root).length, 1, '报异常归报异常，粒一条都不许少');
    assert.equal(inbox.list(root).filter((e) => e.类型 === '台账孤粒').length, 1);
    const r2 = LS.同步(root, { 触发: '例行' });
    assert.deepEqual(r2.新报孤粒, [], '同一条孤粒不重复告警（否则 5 分钟一拍能把信箱淹了）');
    assert.equal(inbox.list(root).filter((e) => e.类型 === '台账孤粒').length, 1);
  });

  // ---- ④ 执行器 ----
  await t('执行器：动作走 schedule CAS 通道落地 + 重跑幂等零动作 + 台账落对齐事件', async () => {
    const root = makeRoot();
    铺专项(root);
    seed(root, '在途', { id: 'TK-156', title: '大纲树拖拽', 父单: 'TK-150', 职能: '程序' });
    seed(root, '完成', { id: 'TK-157', title: '属性面板', 父单: 'TK-150' });
    const r = LS.同步(root, { 触发: '首跑' });
    assert.equal(r.动作.length, 2);
    assert.equal(r.败.length, 0, JSON.stringify(r.败));
    const 粒 = S.现态(root);
    assert.equal(粒.length, 2);
    assert.deepEqual(粒.map((g) => `${g.单号}:${g.状态}`).sort(), ['TK-156:已成单', 'TK-157:完成']);
    assert.ok(粒.every((g) => g.批 === '编辑器专项'), '批名落对');
    // 事件形状（要件2：每次同步落台账事件，含动作数）
    const ev = pmLedger.events(root).filter((e) => e.类型 === '台账对齐');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].动作数, 2); assert.equal(ev[0].登粒, 2); assert.equal(ev[0].触发, '首跑');
    // 重跑：全库没变 → 零动作，但事件照落（"这一拍查过了没差量"本身就是账）
    const r2 = LS.同步(root, { 触发: '例行' });
    assert.deepEqual(r2.动作, [], '幂等：重跑不再造粒');
    assert.equal(S.现态(root).length, 2);
    assert.equal(pmLedger.events(root).filter((e) => e.类型 === '台账对齐').length, 2);
    assert.equal(pmLedger.events(root).filter((e) => e.类型 === '台账对齐').pop().动作数, 0);
  });

  await t('执行器：失败重试一轮，仍败则入信箱告警（其余动作照常落，不整批陪葬）', async () => {
    const root = makeRoot();
    铺专项(root);
    seed(root, '在途', { id: 'TK-156', title: '好单', 父单: 'TK-150' });
    seed(root, '完成', { id: 'TK-158', title: '坏粒单', 父单: 'TK-150' });
    // 注入一条指向"不存在的粒"的现态：转移动作必然两次都失败
    const 假粒 = { 粒ID: '00000000-0000-0000-0000-000000000000', 批: '编辑器专项', 序: 1, 题: '坏粒单', 状态: '计划', 单号: 'TK-158', 版本号: 1 };
    const r = LS.同步(root, { 触发: '例行', 粒们: [假粒] });
    assert.equal(r.动作.length, 2, '一条登粒（TK-156）+ 一条转移（假粒）');
    assert.equal(r.成.length, 1, '好动作照落');
    assert.equal(r.败.length, 1);
    assert.ok(/不存在/.test(r.败[0].error), r.败[0].error);
    assert.ok('首错' in r.败[0], '重试一轮要留下首错，看得出确实试了两次');
    assert.equal(S.现态(root).filter((g) => g.单号 === 'TK-156').length, 1, '一条失败不该拖垮同批其余动作');
    const 告 = inbox.list(root).filter((e) => e.类型 === '台账对齐失败');
    assert.equal(告.length, 1);
    assert.ok(告[0].摘要.includes('TK-158'), 告[0].摘要);
    assert.equal(pmLedger.events(root).filter((e) => e.类型 === '台账对齐').pop().失败, 1);
  });

  // ---- ⑤ 挂拍：事件去抖 + 例行兜底 ----
  await t('扫事件：journal 增量按关键词命中；自产行不自触发；光标只推到完整行末', async () => {
    const root = makeRoot();
    const 月 = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const 写 = (s) => fs.appendFileSync(path.join(root, 'journal', `${月}.log`), s, 'utf8');
    fs.mkdirSync(path.join(root, 'journal'), { recursive: true });
    写('[2026-08-12 21:00] 保存：TK-1 无实质变更\n');
    const 首 = LS.扫事件(root, { 光标: null });
    assert.deepEqual(首.命中, [], '首扫不回放历史（上线首拍本就要全量对齐，回放只是白跑）');
    assert.ok(首.光标.偏移 > 0);
    写('[2026-08-12 21:01] 派发 TK-156（待投→在途）\n[2026-08-12 21:02] 保存：TK-9 无实质变更\n');
    const 二 = LS.扫事件(root, 首);
    assert.equal(二.命中.length, 1, '只认 成单/派发/归档/废弃/推翻 五个词');
    assert.ok(二.命中[0].includes('派发 TK-156'));
    // 自产行：一次对齐会写出「… → 已成单（系统·台账对齐）」，认它就会自激出第二拍空跑
    写(`[2026-08-12 21:03] 排程粒转移 x「y」：起草中 → 已成单 · 单号 TK-156（${LS.操作者}）\n`);
    assert.deepEqual(LS.扫事件(root, 二).命中, [], '自产行不自触发');
    // 半行（写盘写到一半）：光标停在上一个完整行末，下一拍连着读完整
    const 三 = LS.扫事件(root, 二);
    写('[2026-08-12 21:04] 废弃 TK-99（在途');
    const 四 = LS.扫事件(root, 三);
    assert.deepEqual(四.命中, [], '半行不入账');
    assert.equal(四.光标.偏移, 三.光标.偏移, '光标不越过残行——UTF-8 多字节被切开会乱码');
    写('→已归档）\n');
    assert.equal(LS.扫事件(root, 四).命中.length, 1, '补齐后整行读到');
    // 换月：新文件从头读
    fs.writeFileSync(path.join(root, 'journal', '2099-01.log'), '[2099-01-01 00:00] 归档 TK-1\n', 'utf8');
    const 换 = LS.扫事件(root, 四);
    assert.equal(换.光标.文件, '2099-01.log');
    assert.equal(换.命中.length, 1, '换月不漏事件');
  });

  await t('拍频：首跑立刻；事件去抖 30s 合并连发；5 分钟例行兜底；其余拍不动', async () => {
    const 基 = 1000000;
    assert.equal(LS.应同步(基, {}).触发, '首跑', '从没同步过 → 首跑全量');
    assert.equal(LS.应同步(基, { 末次同步: 基 }).触发, null, '刚同步完不重复拍');
    assert.equal(LS.应同步(基 + 29000, { 末次同步: 基, 待同步起: 基 }).触发, null, '去抖窗内不落地');
    assert.equal(LS.应同步(基 + 30000, { 末次同步: 基, 待同步起: 基 }).触发, '事件', '满 30s 才落地');
    assert.equal(LS.应同步(基 + 60000, { 末次同步: 基 }).触发, null, '没事件就等例行拍');
    assert.equal(LS.应同步(基 + 5 * 60000, { 末次同步: 基 }).触发, '例行', '5 分钟兜底');
  });

  await t('去抖合并：连发三条事件只落一次同步，锚点钉在第一条上', async () => {
    const root = makeRoot();
    铺专项(root);
    const 月 = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const 记 = (s) => { fs.mkdirSync(path.join(root, 'journal'), { recursive: true }); fs.appendFileSync(path.join(root, 'journal', `${月}.log`), s + '\n', 'utf8'); };
    const 基 = 2000000;
    记('[t] 开工（流水先有内容，首扫才有光标可钉）');
    assert.equal(LS.拍(root, { 现在: 基 }).触发, '首跑', '上线首拍=全量对齐');
    记('[t] 派发 TK-156（待投→在途）');
    seed(root, '在途', { id: 'TK-156', title: '甲', 父单: 'TK-150' });
    const p1 = LS.拍(root, { 现在: 基 + 5000 });
    assert.equal(p1.触发, null, '事件刚到，去抖窗里先不动');
    assert.equal(p1.待同步起, 基 + 5000, '去抖锚在第一条未服务事件上');
    记('[t] 归档 TK-157（在途→已归档）');
    seed(root, '完成', { id: 'TK-157', title: '乙', 父单: 'TK-150' });
    const p2 = LS.拍(root, { 现在: 基 + 20000 });
    assert.equal(p2.触发, null, '连发的第二条不重置锚点，也不各落一次');
    assert.equal(p2.待同步起, 基 + 5000);
    const p3 = LS.拍(root, { 现在: 基 + 36000 });
    assert.equal(p3.触发, '事件', '自第一条事件起满 30s → 一次落地');
    assert.equal(p3.动作.length, 2, '连发被合并进同一次同步');
    assert.equal(LS.读状态(root).待同步起, 0, '落地后去抖旗清零');
    // 例行兜底：事件线一条没有，5 分钟后照样拍
    seed(root, '草稿', { id: 'TK-158', title: '丙', 父单: 'TK-150' });
    assert.equal(LS.拍(root, { 现在: 基 + 100000 }).触发, null, '既无事件又不到 5 分钟：不拍');
    const p4 = LS.拍(root, { 现在: 基 + 36000 + 5 * 60000 });
    assert.equal(p4.触发, '例行');
    assert.equal(p4.动作.length, 1, '例行拍捞回事件线漏掉的那张（这就是兜底的意义）');
    assert.equal(S.现态(root).length, 3);
  });

  // ---- ⑥ 首跑全量回填（要件4）----
  await t('首跑全量回填：编辑器专项 11 单 5 粒 → 补齐 156~161 六粒', async () => {
    const root = makeRoot();
    铺专项(root, { 名: '编辑器专项' });
    // 已登的 5 粒（总监手工登过的那批）
    const 已登 = [['TK-151', '大纲树骨架'], ['TK-152', '节点增删'], ['TK-153', '拖拽排序'], ['TK-154', '撤销栈'], ['TK-155', '存盘格式']];
    for (const [id, 题] of 已登) {
      const g = S.登记(root, [{ 批: '编辑器专项', 序: LS.序号(id), 题, 来源: `编辑器专项总清单 §2 ${id}`, 状态: '完成', 单号: id }], '总监').新增[0];
      seed(root, '完成', { id, title: 题, 父单: 'TK-150', 粒ID: g.粒ID });
    }
    // 忘登的 6 张（156~161），状态各异
    const 忘登 = [['TK-156', '属性面板', '完成'], ['TK-157', '预览联动', '完成'], ['TK-158', '快捷键表', '已归档'],
      ['TK-159', '多选框选', '在途'], ['TK-160', '导出校验', '待验收'], ['TK-161', '空态文案', '草稿']];
    for (const [id, 题, 态] of 忘登) seed(root, 态, { id, title: 题, 父单: 'TK-150', 职能: '程序' });
    assert.equal(S.现态(root).length, 5, '对齐前：11 单只见 5 粒（案源现场）');

    const r = LS.同步(root, { 触发: '首跑' });
    assert.equal(r.动作.length, 6, '首跑动作清单恰 6 条');
    assert.deepEqual(r.动作.map((a) => a.单号), ['TK-156', 'TK-157', 'TK-158', 'TK-159', 'TK-160', 'TK-161']);
    assert.ok(r.动作.every((a) => a.动作 === '登粒' && a.批 === '编辑器专项'));
    assert.deepEqual(r.动作.map((a) => a.状态), ['完成', '完成', '完成', '已成单', '已成单', '起草中'],
      '登粒直接落到目标态（终态回填口径，同 migrate-schedule）');
    assert.equal(r.败.length, 0);
    assert.equal(S.现态(root).length, 11, '对齐后 11 单 11 粒');
    assert.equal(S.现态(root).filter((g) => g.批 === '编辑器专项').length, 11);
    assert.deepEqual(差(root).动作, [], '首跑之后再差量为零');
  });

  // ---- ⑦ 接线实证：真 runner.tick ----
  await t('接线：真 runner.tick 跑一拍 → 台账自动对齐（领单制分支同样对齐）', async () => {
    const runner = require('../lib/runner');
    const root = makeRoot();
    state.update(root, (s) => { s.执行器 = { 运行: true }; });
    铺专项(root);
    seed(root, '完成', { id: 'TK-156', title: '被总监忘登的单', 父单: 'TK-150' });
    const CFG = { ...require('./helper').CFG, agents: [], 编制: [] }; // 领单制（无 执行器.派发制）
    await runner.tick(root, CFG, { durMs: 0, 对齐: { 现在: 3000000 } });
    const 粒 = S.现态(root);
    assert.equal(粒.length, 1, 'tick 一拍就该把忘登的粒补上（挂接点错了这里必红）');
    assert.equal(粒[0].单号, 'TK-156');
    assert.equal(粒[0].状态, '完成');
    assert.equal(粒[0].末次操作者, '项管');
    assert.ok(pmLedger.events(root).some((e) => e.类型 === '台账对齐' && e.触发 === '首跑'));
  });

  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error('  ✗ ' + (e.stack || e.message)); process.exit(1); });
