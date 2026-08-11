// poolbalance.test.js — 池衡控制面（H99 · 施工令-045 第 11 条）
// 被测面（逐条对应施工令要件）：
//   ①读数归一与盲区（不编数、不沿用旧值）②切换权界与位白名单 ③品味锁四个命中分支
//   ④派发时快照（在途单不受切换影响）⑤迟滞窗内拒切 / 阈值不足拒切 ⑥台账事件二分
//   ⑦失败回退（含首发秒死不计数）+ 冷却 ⑧CAS 冲突拒写 ⑨人工覆盖冻结与解除 ⑩越权硬拒 + 留痕
// 纪律：决策全走纯函数直调（零 I/O），落配置那几格走 执行动作() 真写 cfg + 真写台账——
// 「判定在 API 层」这句话如果只由纯函数背书，等于没测（施工令-039 那类事故的温床）。
const assert = require('node:assert');
const { makeRoot, seed } = require('./helper');
const PB = require('../lib/pm/poolbalance');
const ledger = require('../lib/pm/ledger');
const roster = require('../lib/roster');
const store = require('../lib/core/store');

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('poolbalance 池衡控制面测试');

// 三池三职能的最小配置：程序挂 codex→claude（可平衡）、美术挂 claude（品味岗）、策划挂 claude→deepseek
const CFG = () => JSON.parse(JSON.stringify({
  职能: ['策划', '程序', '美术', 'QA'],
  执行池: {
    codex: { 阈值: 70, 周阈值: 90 },
    claude: { 阈值: 70, 周阈值: 90 },
    deepseek: { 阈值: 70, 周阈值: 90, 兼容: { base: 'https://api.deepseek.com/anthropic', key: 'sk-test-key-1234' } },
  },
  模型: { claude默认: 'sonnet', codex默认: 'gpt-5', 质检: 'sonnet', 核查: 'opus', 项管: 'opus' },
  编制: [
    { 职能: '程序', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: '' }] },
    { 职能: '美术', 池序: [{ 池: 'claude', 档: '' }] },
    { 职能: '策划', 池序: [{ 池: 'claude', 档: '' }, { 池: 'deepseek', 档: '' }] },
    { 职能: 'QA', 池序: [{ 池: 'claude', 档: '' }] },
  ],
  池衡: { 开: true, 最小间隔分钟: 30, 阈值差: 20, 冷却分钟: 60, 失败回退次数: 2, 自愈窗秒: 30 },
}));

// 读数夹具：可用度直接给，绕开采集（采集另有专测）
const R = (m) => Object.fromEntries(Object.entries(m).map(([池, v]) => [池,
  v == null ? { 池, 盲区: true, 可用度: null, 因: '测试夹具：盲区', 读数时刻: null }
    : { 池, 盲区: false, 可用度: v, 读数时刻: '2026-08-11T20:00:00.000Z', 明细: [] }]));
const 空历史 = { 最近: {}, 冷却至: {}, 现在: Date.now(), 冷却中: () => false };
const 位们Of = (cfg, 活单 = []) => PB.位全集(cfg).map((b) => {
  const 锁 = PB.品味锁(b, 活单);
  return { ...b, 锁, 锁合规: 锁 ? PB.锁合规(cfg, b) : true, 高档: PB.品味档(cfg) };
});
const 找 = (list, 位) => list.find((d) => d.位 === 位);

(async () => {
  // ================= 要件 1 · 额度读数真实源与盲区 =================
  await t('要件1 读数归一：三池各有其源，可用度按「距自己那道闸还剩几成」算', async () => {
    const cfg = CFG();
    const r = PB.归一读数(cfg, {
      claude凭据: true,
      locks: {
        claude: { locked: false, 窗口: [{ label: '5小时', pct: 35, 阈值: 70 }, { label: '周', pct: 45, 阈值: 90 }], 更新于: Date.parse('2026-08-11T20:00:00Z') },
        codex: { locked: false, 窗口: [{ label: '周', pct: 14, 阈值: 70 }] },
      },
      余额: { deepseek: { 可用: true, 余额: 25, 币种: 'CNY', 读数时刻: '2026-08-11T20:00:00.000Z' } },
      时刻: '2026-08-11T20:00:00.000Z',
    });
    assert.equal(r.claude.盲区, false);
    assert.equal(r.claude.可用度, 50, '5h 35/70 → 剩 50%；周 45/90 → 剩 50%，取最紧的');
    assert.equal(r.claude.读数时刻, '2026-08-11T20:00:00.000Z', '读数必须带取数时刻');
    assert.equal(r.codex.可用度, 80, 'codex 周窗 14/70 → 剩 80%');
    assert.equal(r.deepseek.可用度, 50, '余额 25 / 满额 50 → 50%');
    assert.equal(r.deepseek.源, 'deepseek 余额接口');
  });

  await t('要件1 盲区：探针无数 / 读数陈旧 / 无凭据 三条都报盲区，不编数不沿用旧值', async () => {
    const cfg = CFG();
    const 无数 = PB.归一读数(cfg, { claude凭据: true, locks: { claude: null, codex: null }, 余额: {}, 时刻: 'T0' });
    for (const p of ['claude', 'codex', 'deepseek']) {
      assert.equal(无数[p].盲区, true, p + ' 应盲区');
      assert.equal(无数[p].可用度, null, '盲区池一律不给可用度数字——编数就是撒谎');
    }
    // 陈旧：quota 在节流窗口内会供「最后一次好读数」，那是给 UI 看的，做切换判据即为沿用旧值充数
    const 陈 = PB.归一读数(cfg, { claude凭据: true, 余额: {}, 时刻: 'T0',
      locks: { claude: { 陈旧: true, 更新于: Date.parse('2026-08-11T10:00:00Z'), 窗口: [{ label: '5小时', pct: 5, 阈值: 70 }] }, codex: null } });
    assert.equal(陈.claude.盲区, true, '陈旧读数应判盲区');
    assert.ok(/陈旧/.test(陈.claude.因), '拒因要说清是陈旧：' + 陈.claude.因);
    assert.equal(陈.claude.读数时刻, '2026-08-11T10:00:00.000Z', '盲区也要如实报那份旧读数的取数时刻');
    // 凭据不在 = 订阅态不可判
    const 无凭 = PB.归一读数(cfg, { claude凭据: false, 余额: {}, 时刻: 'T0',
      locks: { claude: { locked: false, 窗口: [{ label: '5小时', pct: 5, 阈值: 70 }] }, codex: null } });
    assert.equal(无凭.claude.盲区, true);
    assert.ok(/凭据/.test(无凭.claude.因), '拒因要指向凭据：' + 无凭.claude.因);
  });

  await t('要件1 余额端点：只认已知有余额接口的厂，认不出就不猜', async () => {
    assert.equal(PB.余额端点('deepseek', 'https://api.deepseek.com/anthropic'), 'https://api.deepseek.com/user/balance');
    assert.equal(PB.余额端点('deepseek', null), 'https://api.deepseek.com/user/balance');
    assert.equal(PB.余额端点('kimi', 'https://api.moonshot.cn/anthropic'), null, '未知厂不猜端点');
  });

  // ================= 要件 2 · 切换权界 =================
  await t('要件2 位白名单：只有 执行·<职能> / QA / 核查 在册', async () => {
    const cfg = CFG();
    const 全 = PB.位全集(cfg).map((b) => b.位);
    assert.deepEqual(全.filter((x) => x.startsWith('执行·')).sort(), ['执行·QA', '执行·程序', '执行·美术', '执行·策划'].sort());
    assert.ok(全.includes('QA') && 全.includes('核查'), '判官两席在册');
    assert.equal(PB.解析位(cfg, '执行·程序').ok, true);
    assert.equal(PB.解析位(cfg, '执行·锻造').ok, false, '编制里没有的职能不在册');
  });

  await t('要件2 禁改域：门禁/放行工具/人闸/角色模型/并发上限 一律越权', async () => {
    const cfg = CFG();
    for (const 位 of ['门禁', '放行工具', '人闸', '并发上限', '项管', '总监', '制作人', '仲裁', '执行器.放行工具']) {
      const r = PB.解析位(cfg, 位);
      assert.equal(r.ok, false, 位 + ' 应拒');
      assert.equal(r.越权, true, 位 + ' 应标越权（而不是混进"未知位"）');
    }
  });

  await t('要件2 判官席只可切档：请求换池如实拒绝，不假装能改 runner 定死的池', async () => {
    const cfg = CFG();
    const 位 = PB.解析位(cfg, 'QA');
    const 换池 = PB.落位(cfg, 位, 'codex', 'sonnet');
    assert.equal(换池.ok, false);
    assert.ok(/runner/.test(换池.error), '拒因要指认 runner 那处硬编码：' + 换池.error);
    const 换档 = PB.落位(cfg, 位, 'claude', 'haiku');
    assert.equal(换档.ok, true);
    assert.equal(cfg.模型.质检, 'haiku', 'QA 席切档落在 config.模型.质检');
  });

  // ================= 要件 3 · 品味锁 =================
  await t('要件3 品味锁 · 分支①职能=美术：无条件锁', async () => {
    const cfg = CFG();
    const 位 = PB.解析位(cfg, '执行·美术');
    const 锁 = PB.品味锁(位, []);
    assert.ok(锁 && /美术/.test(锁.因), '美术位应锁：' + JSON.stringify(锁));
  });

  await t('要件3 品味锁 · 分支②工单带「品味敏感: 是」：该职能执行位被锁', async () => {
    const cfg = CFG();
    const 位 = PB.解析位(cfg, '执行·程序');
    assert.equal(PB.品味锁(位, [{ id: 'TK-1', 职能: '程序', 品味敏感: false, 验收方式: '委托' }]), null, '普通单不锁');
    const 锁 = PB.品味锁(位, [{ id: 'TK-2', 职能: '程序', 品味敏感: true, 验收方式: '委托' }]);
    assert.ok(锁 && /TK-2/.test(锁.因) && /品味敏感/.test(锁.因), '品味敏感单应锁并指名单号：' + JSON.stringify(锁));
  });

  await t('要件3 品味锁 · 分支③验收方式=保留：品味单在手即锁', async () => {
    const cfg = CFG();
    const 位 = PB.解析位(cfg, '执行·策划');
    const 锁 = PB.品味锁(位, [{ id: 'TK-3', 职能: '策划', 品味敏感: false, 验收方式: '保留' }]);
    assert.ok(锁 && /TK-3/.test(锁.因) && /保留/.test(锁.因), '保留验收单应锁：' + JSON.stringify(锁));
    // 别的职能的品味单不该殃及本位
    assert.equal(PB.品味锁(位, [{ id: 'TK-4', 职能: '程序', 品味敏感: true, 验收方式: '保留' }]), null);
  });

  await t('要件3 品味锁 · 分支④判官席：只被委托验收链上的品味单/美术单锁（保留单压根不过判官）', async () => {
    const cfg = CFG();
    const 位 = PB.解析位(cfg, '核查');
    assert.equal(PB.品味锁(位, [{ id: 'TK-5', 职能: '策划', 品味敏感: true, 验收方式: '保留' }]), null, '保留验收不过判官，不锁判官席');
    const 锁 = PB.品味锁(位, [{ id: 'TK-6', 职能: '美术', 品味敏感: false, 验收方式: '委托' }]);
    assert.ok(锁 && /TK-6/.test(锁.因), '委托链上的美术单应锁判官席');
  });

  await t('要件3 品味锁在 API 层落地：项管切换被拒 4xx + 台账留痕（不依赖提示词自律）', async () => {
    const root = makeRoot(); const cfg = CFG();
    seed(root, '待投', { id: 'TK-P1', 职能: '程序', 品味敏感: '是', 验收方式: '委托' });
    const r = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·程序', 池: 'claude', 预期版本: PB.版本(cfg), 操作者: '项管', 理由: '试图绕锁' });
    assert.equal(r.ok, false);
    assert.equal(r.码, 403);
    assert.equal(r.品味锁, true);
    assert.equal(roster.poolsOf(cfg, '程序')[0], 'codex', '被拒就不许有任何配置改动');
    const ev = ledger.events(root, 50).filter((e) => e.类型 === '池衡拒绝');
    assert.equal(ev.length, 1, '拒绝必须留痕');
    assert.equal(ev[0].因类, '品味锁');
    assert.equal(ev[0].位, '执行·程序');
  });

  await t('要件3 品味锁归位：锁着却不在 claude 高档上 → 决策出「归位」而不是「拒」', async () => {
    const cfg = CFG();
    cfg.编制 = [{ 职能: '美术', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: '' }] }];
    cfg.池衡.品味档 = 'opus';
    const d = 找(PB.决策({ 位们: 位们Of(cfg, []), 读数: R({ codex: 90, claude: 90 }), 参: PB.参数(cfg), 历史: 空历史 }), '执行·美术');
    assert.equal(d.动作, '归位');
    assert.equal(d.到, 'claude');
    assert.equal(d.目标档, 'opus');
  });

  await t('要件3 归位真能落地：锁着却在 codex 上的位，巡检一拍就被拽回 claude 高档', async () => {
    // 自查抓到的坑：品味锁若把「朝 claude 高档去的那一次切换」也拦下，锁就退化成「锁住现状」——
    // 位一旦飘到便宜池上就永远回不来。这一格锁死归位这条通路是通的。
    const root = makeRoot(); const cfg = CFG();
    cfg.编制 = [{ 职能: '美术', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: '' }] }];
    cfg.池衡.品味档 = 'opus';
    const out = PB.巡检(root, cfg, R({ codex: 90, claude: 30 }), { 活单: [] });
    assert.equal(out.切.length, 1, '归位应真落地，实得 ' + JSON.stringify(out.拒));
    assert.equal(roster.poolsOf(cfg, '美术')[0], 'claude');
    assert.equal(roster.modelFor(cfg, '美术', 'claude'), 'opus', '归位要连档一起拽回高档');
    const ev = ledger.events(root, 20).find((e) => e.类型 === '池衡归位');
    assert.ok(ev, '归位要记「池衡归位」而不是普通切换：' + ledger.events(root, 20).map((e) => e.类型).join(','));
    assert.equal(ev.从, 'codex'); assert.equal(ev.到, 'claude');
    // 但「不是归位」的切换照旧被锁拦住（放行判据只认正好落在锁那一格上的请求）
    const 假归位 = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·美术', 池: 'codex', 因类: '品味锁', 预期版本: PB.版本(cfg), 操作者: '项管' });
    assert.equal(假归位.码, 403, '打着归位旗号往便宜池切，一样拒');
    const 错档 = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·美术', 池: 'claude', 档: 'haiku', 因类: '品味锁', 预期版本: PB.版本(cfg), 操作者: '项管' });
    assert.equal(错档.码, 403, '池对了档不对，也不算归位');
  });

  // ================= 要件 5 · 迟滞防抖 =================
  await t('要件5 阈值不足拒切：差 < 阈值差 就不切（差一点点换池是噪音）', async () => {
    const cfg = CFG();
    const d = 找(PB.决策({ 位们: 位们Of(cfg), 读数: R({ codex: 50, claude: 65, deepseek: 50 }), 参: PB.参数(cfg), 历史: 空历史 }), '执行·程序');
    assert.equal(d.动作, '不切');
    assert.equal(d.因类, '阈值不足');
    assert.equal(d.差, 15);
    // 拉开到 20 就该切
    const d2 = 找(PB.决策({ 位们: 位们Of(cfg), 读数: R({ codex: 45, claude: 65, deepseek: 50 }), 参: PB.参数(cfg), 历史: 空历史 }), '执行·程序');
    assert.equal(d2.动作, '切');
    assert.equal(d2.从, 'codex'); assert.equal(d2.到, 'claude');
    assert.ok(d2.触发读数 && d2.触发读数.取数时刻, '切换判词必须挂上触发读数与取数时刻');
  });

  await t('要件5 迟滞窗内拒切：距上次切换不足最小间隔，即便够阈值也不切', async () => {
    const cfg = CFG();
    const 现在 = Date.now();
    const 历史 = { 最近: { '执行·程序': { t: 现在 - 10 * 60000, 类型: '池衡切换', 从: 'claude', 到: 'codex' } }, 冷却至: {}, 现在, 冷却中: () => false };
    const d = 找(PB.决策({ 位们: 位们Of(cfg), 读数: R({ codex: 30, claude: 90, deepseek: 50 }), 参: PB.参数(cfg), 历史 }), '执行·程序');
    assert.equal(d.动作, '不切');
    assert.equal(d.因类, '迟滞');
    assert.ok(d.拟切 && d.拟切.到 === 'claude', '拟切要如实记下来，事后才对得上账');
    // 越过窗口即放行
    const 历史2 = { ...历史, 最近: { '执行·程序': { t: 现在 - 40 * 60000, 类型: '池衡切换', 从: 'claude', 到: 'codex' } } };
    assert.equal(找(PB.决策({ 位们: 位们Of(cfg), 读数: R({ codex: 30, claude: 90, deepseek: 50 }), 参: PB.参数(cfg), 历史: 历史2 }), '执行·程序').动作, '切');
  });

  await t('要件5 迟滞参数入 studio.config.json 可调（0 值与缺省都回落默认）', async () => {
    const cfg = CFG();
    cfg.池衡.最小间隔分钟 = 5; cfg.池衡.阈值差 = 3;
    assert.equal(PB.参数(cfg).最小间隔分钟, 5);
    assert.equal(PB.参数(cfg).阈值差, 3);
    delete cfg.池衡.最小间隔分钟;
    assert.equal(PB.参数(cfg).最小间隔分钟, 30, '缺省回落默认 30');
  });

  await t('要件5 API 层迟滞：项管显式切换在窗内也拒（429）并留痕', async () => {
    const root = makeRoot(); const cfg = CFG();
    const 现在 = Date.now();
    ledger.event(root, '池衡切换', { 位: '执行·程序', 从: 'claude', 到: 'codex', 由: '项管自动' });
    const r = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·程序', 池: 'claude', 预期版本: PB.版本(cfg), 操作者: '项管' }, { 现在 });
    assert.equal(r.ok, false);
    assert.equal(r.码, 429);
    assert.equal(r.迟滞, true);
    assert.ok(ledger.events(root, 50).some((e) => e.类型 === '池衡拒绝' && e.因类 === '迟滞'));
  });

  // ================= 要件 11 · 盲区池不参与平衡 =================
  await t('要件11 盲区池不参与平衡：候选里剔除盲区池；当前池盲区则整位不动', async () => {
    const cfg = CFG();
    // claude 盲区 → 程序位只剩 codex，无从比较
    const d = 找(PB.决策({ 位们: 位们Of(cfg), 读数: R({ codex: 20, claude: null, deepseek: 90 }), 参: PB.参数(cfg), 历史: 空历史 }), '执行·程序');
    assert.equal(d.动作, '不切');
    assert.equal(d.因类, '已最佳', 'deepseek 再空也不在程序位的池序里，盲区的 claude 不作候选');
    // 当前池盲区 → 不切，且拒因指名盲区
    const cfg2 = CFG();
    const d2 = 找(PB.决策({ 位们: 位们Of(cfg2), 读数: R({ codex: null, claude: 95, deepseek: 50 }), 参: PB.参数(cfg2), 历史: 空历史 }), '执行·程序');
    assert.equal(d2.动作, '不切');
    assert.equal(d2.因类, '盲区');
    assert.ok(/不参与平衡/.test(d2.因));
  });

  // ================= 要件 7 · 失败回退 =================
  await t('要件7 失败回退：切入池连续失败达阈值 → 回退原池；首发秒死不计数', async () => {
    const cfg = CFG();
    const 现在 = Date.parse('2026-08-11T21:00:00Z');
    const 切时 = 现在 - 20 * 60000;
    const 历史 = { 最近: { '执行·程序': { t: 切时, 类型: '池衡切换', 从: 'claude', 到: 'codex' } }, 冷却至: {}, 现在, 冷却中: () => false };
    const 单 = (id, 领, 失) => ({ id, 职能: '程序', 执行池: 'codex', 领单时间: new Date(领).toISOString(), 失败时间: new Date(失).toISOString() });
    // 两发都是「秒死」（5 秒内）：自愈窗内，不计
    const 秒死 = PB.回退判定({ 位们: 位们Of(cfg), 参: PB.参数(cfg), 历史,
      失败单们: [单('TK-A', 现在 - 10 * 60000, 现在 - 10 * 60000 + 5000), 单('TK-B', 现在 - 9 * 60000, 现在 - 9 * 60000 + 5000)] });
    assert.equal(秒死.length, 0, '首发秒死属抖动，不该把池衡打回原形');
    // 两发都跑了 5 分钟才死：计数达标 → 回退
    const 真死 = PB.回退判定({ 位们: 位们Of(cfg), 参: PB.参数(cfg), 历史,
      失败单们: [单('TK-C', 现在 - 10 * 60000, 现在 - 5 * 60000), 单('TK-D', 现在 - 8 * 60000, 现在 - 3 * 60000)] });
    assert.equal(真死.length, 1);
    assert.equal(真死[0].位, '执行·程序');
    assert.equal(真死[0].从, 'codex'); assert.equal(真死[0].到, 'claude');
    assert.deepEqual(真死[0].失败单, ['TK-C', 'TK-D']);
    // 切换之前就死的单不算这一池的账
    const 旧账 = PB.回退判定({ 位们: 位们Of(cfg), 参: PB.参数(cfg), 历史,
      失败单们: [单('TK-E', 切时 - 60 * 60000, 切时 - 30 * 60000), 单('TK-F', 切时 - 50 * 60000, 切时 - 20 * 60000)] });
    assert.equal(旧账.length, 0);
  });

  await t('要件7 回退令该池进入冷却，且冷却期内不作候选（迟滞计时一并重置）', async () => {
    const cfg = CFG();
    const 现在 = Date.now();
    const 参 = PB.参数(cfg);
    const h = PB.历史Of([{ 类型: '池衡回退', t: new Date(现在 - 10 * 60000).toISOString(), 位: '执行·程序', 从: 'codex', 到: 'claude' }], 参, 现在);
    assert.equal(h.冷却中('codex'), true, '把活跑死的那个池进冷却');
    assert.equal(h.冷却中('claude'), false);
    assert.ok(h.最近['执行·程序'] && h.最近['执行·程序'].t, '回退也刷新迟滞计时');
    const d = 找(PB.决策({ 位们: 位们Of(cfg), 读数: R({ codex: 99, claude: 10, deepseek: 50 }), 参, 历史: h }), '执行·程序');
    assert.notEqual(d.动作, '切', 'codex 再空，冷却期内也不许切回去');
  });

  await t('要件7 回退只推翻「切换」：品味归位与人工覆盖不被自动推翻', async () => {
    const cfg = CFG();
    const 现在 = Date.now();
    const 单 = (id) => ({ id, 职能: '程序', 执行池: 'codex', 领单时间: new Date(现在 - 10 * 60000).toISOString(), 失败时间: new Date(现在 - 60000).toISOString() });
    const mk = (类型) => ({ 最近: { '执行·程序': { t: 现在 - 20 * 60000, 类型, 从: 'claude', 到: 'codex' } }, 冷却至: {}, 现在, 冷却中: () => false });
    assert.equal(PB.回退判定({ 位们: 位们Of(cfg), 参: PB.参数(cfg), 历史: mk('池衡归位'), 失败单们: [单('a'), 单('b')] }).length, 0);
    assert.equal(PB.回退判定({ 位们: 位们Of(cfg), 参: PB.参数(cfg), 历史: mk('池衡覆盖'), 失败单们: [单('a'), 单('b')] }).length, 0);
    assert.equal(PB.回退判定({ 位们: 位们Of(cfg), 参: PB.参数(cfg), 历史: mk('池衡切换'), 失败单们: [单('a'), 单('b')] }).length, 1);
    // 人工覆盖在位 → 自动面整体冻结，回退也不动
    assert.equal(PB.回退判定({ 位们: 位们Of(cfg), 参: PB.参数(cfg), 历史: mk('池衡切换'), 失败单们: [单('a'), 单('b')], 覆盖: { '执行·程序': { 由: '总监' } } }).length, 0);
  });

  // ================= 要件 8 · CAS =================
  await t('要件8 CAS：缺版本拒、旧版本 409 冲突拒、UI 手改即令旧版本失效', async () => {
    const root = makeRoot(); const cfg = CFG();
    const v0 = PB.版本(cfg);
    assert.equal(PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·程序', 池: 'claude', 操作者: '项管' }).error.includes('预期版本必填'), true);
    // 并发的 UI 手改（等价于 /api/config/model 改了质检档）
    cfg.模型.质检 = 'haiku';
    const r = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·程序', 池: 'claude', 预期版本: v0, 操作者: '项管' });
    assert.equal(r.ok, false);
    assert.equal(r.码, 409);
    assert.equal(r.冲突, true);
    assert.equal(roster.poolsOf(cfg, '程序')[0], 'codex', '后写被拒，不许覆盖先手');
    // 按现态重试即通
    const r2 = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·程序', 池: 'claude', 预期版本: PB.版本(cfg), 操作者: '项管', 理由: '重试' });
    assert.equal(r2.ok, true, r2.error);
    assert.equal(roster.poolsOf(cfg, '程序')[0], 'claude');
  });

  await t('要件8 版本对编制/模型档/池衡三面都敏感', async () => {
    const a = CFG(); const v = PB.版本(a);
    const b = CFG(); b.编制[0].池序.reverse(); assert.notEqual(PB.版本(b), v);
    const c = CFG(); c.模型.核查 = 'sonnet'; assert.notEqual(PB.版本(c), v);
    const d = CFG(); d.池衡.阈值差 = 5; assert.notEqual(PB.版本(d), v);
    const e = CFG(); e.项目 = { 默认: 'X' }; assert.equal(PB.版本(e), v, '与池位无关的分区不该让 CAS 抖动');
  });

  // ================= 要件 6 · 审计入台账（事件二分）=================
  await t('要件6 台账事件二分：项管的手记「项管自动」，总监/制作人的手记「人工覆盖」', async () => {
    const root = makeRoot(); const cfg = CFG();
    const r1 = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·程序', 池: 'claude', 预期版本: PB.版本(cfg), 操作者: '项管', 理由: '平衡' });
    assert.equal(r1.ok, true, r1.error);
    const r2 = PB.执行动作(root, cfg, { 动作: '人工覆盖', 位: 'QA', 档: 'opus', 预期版本: PB.版本(cfg), 操作者: '总监', 理由: '质检要看得更严' });
    assert.equal(r2.ok, true, r2.error);
    const ev = ledger.events(root, 50).filter((e) => String(e.类型).startsWith('池衡'));
    const 切 = ev.find((e) => e.类型 === '池衡切换');
    assert.equal(切.由, '项管自动');
    assert.equal(切.从, 'codex'); assert.equal(切.到, 'claude');
    assert.ok(切.生效范围.includes('新派发'), '事件要写明生效范围（要件 4 的账面证据）');
    const 覆 = ev.find((e) => e.类型 === '池衡覆盖');
    assert.equal(覆.由, '人工覆盖');
    assert.equal(覆.操作者, '总监');
  });

  // ================= 要件 9 · 人工覆盖优先并冻结 =================
  await t('要件9 人工覆盖冻结项管自动切换，直至人工解除', async () => {
    const root = makeRoot(); const cfg = CFG();
    const ov = PB.执行动作(root, cfg, { 动作: '人工覆盖', 位: '执行·程序', 池: 'claude', 预期版本: PB.版本(cfg), 操作者: '制作人', 理由: '这批单我要盯着' });
    assert.equal(ov.ok, true, ov.error);
    assert.ok(cfg.池衡.人工覆盖['执行·程序'], '覆盖落进 config，重启不丢');
    // 项管再来切：冻结拒（409）
    const r = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·程序', 池: 'codex', 预期版本: PB.版本(cfg), 操作者: '项管' });
    assert.equal(r.ok, false); assert.equal(r.码, 409);
    assert.ok(/覆盖/.test(r.error));
    // 决策层同样冻结（自动巡检不会绕过它）
    const d = 找(PB.决策({ 位们: 位们Of(cfg), 读数: R({ codex: 95, claude: 10, deepseek: 50 }), 参: PB.参数(cfg), 历史: 空历史, 覆盖: cfg.池衡.人工覆盖 }), '执行·程序');
    assert.equal(d.动作, '拒'); assert.equal(d.因类, '人工覆盖');
    // 解除后恢复
    const un = PB.执行动作(root, cfg, { 动作: '解除覆盖', 位: '执行·程序', 预期版本: PB.版本(cfg), 操作者: '制作人' });
    assert.equal(un.ok, true, un.error);
    assert.equal(cfg.池衡.人工覆盖['执行·程序'], undefined);
    assert.ok(ledger.events(root, 50).some((e) => e.类型 === '池衡解除覆盖'));
  });

  await t('要件9 人工覆盖不受品味锁拦（品味决定只属于人）；项管的同一动作被拦', async () => {
    const root = makeRoot(); const cfg = CFG();
    seed(root, '待投', { id: 'TK-A1', 职能: '美术', 验收方式: '委托' });
    const 项管 = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·美术', 池: 'codex', 预期版本: PB.版本(cfg), 操作者: '项管' });
    assert.equal(项管.码, 403); assert.equal(项管.品味锁, true);
    const 人 = PB.执行动作(root, cfg, { 动作: '人工覆盖', 位: '执行·美术', 池: 'codex', 预期版本: PB.版本(cfg), 操作者: '制作人', 理由: '这批美术单只是切图，走便宜池' });
    assert.equal(人.ok, true, 人.error);
    assert.equal(roster.poolsOf(cfg, '美术')[0], 'codex');
  });

  // ================= 要件 10 · 越权硬拒 =================
  await t('要件10 越权硬拒：非白名单动作 / 改门禁改白名单改人闸 一律 403 + 台账留痕', async () => {
    const root = makeRoot(); const cfg = CFG();
    const 前 = JSON.stringify(cfg);
    const 越权们 = [
      { 动作: '改门禁', 位: '门禁', 操作者: '项管' },
      { 动作: '切换', 位: '放行工具', 池: 'claude', 操作者: '项管' },
      { 动作: '切换', 位: '人闸', 池: 'claude', 操作者: '项管' },
      { 动作: '切换', 位: '并发上限', 池: 'claude', 操作者: '项管' },
      { 动作: '切换', 位: '项管', 池: 'codex', 操作者: '项管' },
      { 动作: '人工覆盖', 位: '执行·程序', 池: 'codex', 操作者: '项管' }, // 项管不得自授人工覆盖
      { 动作: 'patch', 位: '执行·程序', 池: 'codex', 操作者: '项管' },
    ];
    for (const req of 越权们) {
      const r = PB.执行动作(root, cfg, { ...req, 预期版本: PB.版本(cfg) });
      assert.equal(r.ok, false, JSON.stringify(req) + ' 应拒');
      assert.equal(r.码, 403, JSON.stringify(req) + ' 应 403，实得 ' + r.码);
      assert.equal(r.越权, true, JSON.stringify(req) + ' 应标越权');
    }
    assert.equal(JSON.stringify(cfg), 前, '越权请求不许留下任何配置改动');
    const ev = ledger.events(root, 80).filter((e) => e.类型 === '池衡越权');
    assert.equal(ev.length, 越权们.length, '每一次越权都要留痕，实得 ' + ev.length);
  });

  await t('要件10 白名单是枚举：动作全集就四个，且各有操作域', async () => {
    assert.deepEqual(PB.动作白名单, ['切换', '回退', '人工覆盖', '解除覆盖']);
    assert.deepEqual(PB.操作域.人工覆盖, ['总监', '制作人'], '人工覆盖是人的权，项管不在域内');
  });

  // ================= 要件 4 · 派发时快照 =================
  await t('要件4 派发时快照：切换只改配置，在途单的 执行池 章一字不动', async () => {
    const root = makeRoot(); const cfg = CFG();
    // 验收方式显式给 委托：helper 的默认是 保留，而 保留 是品味锁的命中条之一（要件 3），
    // 不写清楚这两张单就会连带把程序位锁死，测的就不是快照了。
    seed(root, '在途', { id: 'TK-R1', 职能: '程序', 验收方式: '委托', 执行池: 'codex', 主办: '程序·TK-R1', 领单时间: '2026-08-11T19:00:00Z' });
    seed(root, '待投', { id: 'TK-R2', 职能: '程序', 验收方式: '委托', 放行: true });
    const r = PB.执行动作(root, cfg, { 动作: '切换', 位: '执行·程序', 池: 'claude', 预期版本: PB.版本(cfg), 操作者: '项管', 理由: 'codex 快满了' });
    assert.equal(r.ok, true, r.error);
    assert.equal(store.find(root, 'TK-R1').fm.执行池, 'codex', '在途会话沿用派发时快照，不中途换马');
    // 此后新派发的才吃新池：走 dispatch.routePool（派发引擎的真实取池路径）
    const D = require('../lib/pm/dispatch');
    const 新 = D.routePool(cfg, { id: 'TK-R2', 职能: '程序' }, { codex: { locked: false }, claude: { locked: false } });
    assert.equal(新.池, 'claude', '新派发走切后的池');
  });

  // ================= 巡检编排（端到端：读数 → 决策 → 落配置 → 台账）=================
  await t('巡检端到端：一拍之内完成切换、落配置、写台账；开关关掉即整体不动', async () => {
    const root = makeRoot(); const cfg = CFG();
    const 读数 = R({ codex: 20, claude: 90, deepseek: 60 });
    const out = PB.巡检(root, cfg, 读数, { 活单: [] });
    assert.equal(out.切.length, 1, '程序位 codex 20% → claude 90%，该切；实得 ' + JSON.stringify(out.切));
    assert.equal(out.切[0].位, '执行·程序');
    assert.equal(roster.poolsOf(cfg, '程序')[0], 'claude');
    assert.ok(ledger.events(root, 50).some((e) => e.类型 === '池衡切换' && e.由 === '项管自动'));
    // 紧接着再跑一拍、读数整个翻转：程序位刚切完，迟滞必须挡住它横跳回去
    const out2 = PB.巡检(root, cfg, R({ codex: 90, claude: 20, deepseek: 60 }), { 活单: [] });
    assert.equal(out2.切.some((d) => d.位 === '执行·程序'), false, '刚切完就想切回去 = 横跳，迟滞必须挡住');
    assert.equal(找(out2.不切, '执行·程序').因类, '迟滞');
    assert.equal(roster.poolsOf(cfg, '程序')[0], 'claude', '横跳被挡，配置留在上一拍的落点');
    // 总开关
    const cfg2 = CFG(); cfg2.池衡.开 = false;
    const out3 = PB.巡检(makeRoot(), cfg2, 读数, { 活单: [] });
    assert.equal(out3.开, false);
    assert.equal(out3.切.length, 0);
  });

  await t('巡检遇品味锁：已在 claude 上的锁位，再空的便宜池也切不走 → 记「池衡拒绝」，配置一字不动', async () => {
    const root = makeRoot(); const cfg = CFG();
    // 锁位已合规（claude 首位），此时 codex 再空也不许切走——这才是「拒」该出现的场合；
    // 若锁位还蹲在便宜池上，那一拍出的是「归位」不是「拒」（见上文归位那一格）。
    cfg.编制 = [{ 职能: '程序', 池序: [{ 池: 'claude', 档: '' }, { 池: 'codex', 档: '' }] }];
    const out = PB.巡检(root, cfg, R({ codex: 95, claude: 20 }), { 活单: [{ id: 'TK-Z', 职能: '程序', 品味敏感: true, 验收方式: '委托' }] });
    assert.equal(out.切.length, 0);
    assert.equal(out.拒.length, 1);
    assert.equal(out.拒[0].因类, '品味锁');
    assert.ok(out.拒[0].拟切 && out.拒[0].拟切.到 === 'codex', '拟切要如实记下来，事后才对得上账');
    assert.equal(roster.poolsOf(cfg, '程序')[0], 'claude');
    assert.ok(ledger.events(root, 50).some((e) => e.类型 === '池衡拒绝' && e.因类 === '品味锁'));
  });

  // ================= 矩阵视图（要件 9 的数据面）=================
  await t('要件9 矩阵：职能 × 当前池 × 模型档 + 各池读数/盲区 + 最近 5 条事件', async () => {
    const root = makeRoot(); const cfg = CFG();
    for (let i = 0; i < 7; i++) ledger.event(root, '池衡切换', { 位: '执行·程序', 从: 'codex', 到: 'claude', 由: '项管自动', n: i });
    const m = PB.矩阵(cfg, R({ codex: 40, claude: 80, deepseek: null }), { 事件: ledger.events(root, 200), 活单: [{ id: 'TK-M', 职能: '美术', 验收方式: '委托' }] });
    assert.ok(m.版本 && m.版本.length === 12, 'CAS 版本随矩阵下发，前端照着回传');
    const 程序 = m.位.find((b) => b.位 === '执行·程序');
    assert.equal(程序.当前池, 'codex');
    assert.equal(程序.读数.可用度, 40);
    const 美术 = m.位.find((b) => b.位 === '执行·美术');
    assert.ok(美术.锁 && 美术.锁.应为.startsWith('claude'), '锁位要标出「应为」');
    assert.equal(m.事件.length, 5, '最近 5 条');
    assert.equal(m.池.find((p) => p.池 === 'deepseek').盲区, true, '盲区池在矩阵上要看得见');
    assert.equal(m.位.find((b) => b.位 === 'QA').档, 'sonnet');
  });

  console.log(`poolbalance：${passed} 项通过`);
})().catch((e) => { console.error('✗ ' + e.message); console.error(e.stack); process.exit(1); });
