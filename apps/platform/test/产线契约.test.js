// 产线契约测试（协-004）：依赖集成 / 调度并发 / 巡检告警
//
// 这三块的共同点是**错了不会报错**：依赖没接上只会让子单拿到缺半截的工作区，
// 并发闸算错只会多烧一份钱，巡检漏了只会让卡单一直躺着。
// 全是安静的失败，所以必须有断言主动去问。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
const 调度 = require(path.join(平台根, 'lib', '调度.js'));
const 巡检 = require(path.join(平台根, 'lib', '巡检.js'));
const 派单 = require(path.join(平台根, 'lib', '派单.js'));
const 工单库 = require(path.join(平台根, 'lib', '工单库.js'));

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('产线契约测试');

// ---- 依赖就绪 ----
const 沙盒 = fs.mkdtempSync(path.join(os.tmpdir(), 'line-'));
工单库.建目录(沙盒);
工单库.create(沙盒, 'D-1', { id: 'D-1', role: 'backend', title: '上游' }, '');
工单库.create(沙盒, 'D-2', { id: 'D-2', role: 'backend', title: '下游', 依赖: ['D-1'] }, '');
工单库.create(沙盒, 'D-3', { id: 'D-3', role: 'backend', title: '依赖幽灵', 依赖: ['不存在'] }, '');

t('依赖未完成时拒派，并点名卡在谁身上', () => {
  const r = 派单.依赖就绪(工单库, 沙盒, 工单库.find(沙盒, 'D-2'));
  assert.equal(r.ok, false);
  assert.ok(/D-1\(草稿\)/.test(r.error), '要写清卡在哪张、什么状态：' + r.error);
  assert.deepEqual(r.未完成.map((x) => x.id), ['D-1']);
});

t('依赖找不到时也拒派，且与「未完成」分开报', () => {
  const r = 派单.依赖就绪(工单库, 沙盒, 工单库.find(沙盒, 'D-3'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.缺失, ['不存在']);
  assert.ok(/找不到/.test(r.error), r.error);
});

t('依赖全完成才放行，并把依赖单交出去（integrate 要用）', () => {
  工单库.move(沙盒, 'D-1', '草稿', '待投');
  工单库.move(沙盒, 'D-1', '待投', '在途');
  工单库.move(沙盒, 'D-1', '在途', '完成', (fm) => { fm.workspace = { commit: 'a'.repeat(40) }; });
  const r = 派单.依赖就绪(工单库, 沙盒, 工单库.find(沙盒, 'D-2'));
  assert.equal(r.ok, true);
  assert.equal(r.依赖单.length, 1);
  assert.equal(r.依赖单[0].fm.workspace.commit.length, 40,
    'integrate 靠 fm.workspace.commit 找上游产出——只写 fm.检查点 它会静默跳过');
});

t('无依赖的单直接放行', () => {
  assert.equal(派单.依赖就绪(工单库, 沙盒, 工单库.find(沙盒, 'D-1')).ok, true);
});

// ---- 调度并发 ----
t('并发上限默认 1（并发是显式决定，不是默认姿态）', () => {
  assert.equal(调度.并发上限({}, 'claude'), 1, '缺配置必须是 1——默认并发等于默认多烧钱');
  assert.equal(调度.并发上限({ 执行: { 并发: { 默认: 3 } } }, 'claude'), 3);
  assert.equal(调度.并发上限({ 执行: { 并发: { 默认: 3, claude: 1 } } }, 'claude'), 1, '池级覆盖默认');
  assert.equal(调度.并发上限({ 执行: { 并发: { 默认: 0 } } }, 'x'), 1, '0 或负数按 1 兜底，不能变成不限');
});

t('排一轮：按优先级与创建时间排序，先来先服务', () => {
  const 待 = [
    { id: 'b', fm: { 优先级: 'P1', 创建时间: '2026-01-02' } },
    { id: 'a', fm: { 优先级: 'P0', 创建时间: '2026-01-03' } },
    { id: 'c', fm: { 优先级: 'P1', 创建时间: '2026-01-01' } },
  ];
  const r = 调度.排一轮({ 执行: { 并发: { 默认: 9 } } }, {
    待投表: 待, 在跑: {}, 依赖就绪: () => true, 选池: () => 'claude',
  });
  assert.deepEqual(r.派.map((x) => x.id), ['a', 'c', 'b'], 'P0 先；同级里老单先，防新单插队饿死老单');
});

t('排一轮：并发满了就停，且逐条说清为什么', () => {
  const 待 = [{ id: 'x', fm: {} }, { id: 'y', fm: {} }];
  const r = 调度.排一轮({ 执行: { 并发: { 默认: 1 } } }, {
    待投表: 待, 在跑: {}, 依赖就绪: () => true, 选池: () => 'claude',
  });
  assert.equal(r.派.length, 1);
  assert.equal(r.跳过.length, 1);
  assert.ok(/并发上限 1/.test(r.跳过[0].原因), '跳过必须给原因，否则「为什么没派」只能靠猜：' + r.跳过[0].原因);
});

t('排一轮：已在跑的占额度', () => {
  const r = 调度.排一轮({ 执行: { 并发: { 默认: 2 } } }, {
    待投表: [{ id: 'x', fm: {} }], 在跑: { claude: 2 }, 依赖就绪: () => true, 选池: () => 'claude',
  });
  assert.equal(r.派.length, 0, '在跑的必须计入占用，否则并发闸形同虚设');
});

t('排一轮：依赖未就绪与无可用 Provider 分开报', () => {
  const r = 调度.排一轮({}, {
    待投表: [{ id: 'x', fm: {} }, { id: 'y', fm: {} }],
    在跑: {}, 依赖就绪: (t2) => t2.id !== 'x', 选池: (t2) => (t2.id === 'y' ? null : 'claude'),
  });
  assert.equal(r.派.length, 0);
  assert.ok(/依赖未就绪/.test(r.跳过.find((s) => s.id === 'x').原因));
  assert.ok(/无可用 Provider/.test(r.跳过.find((s) => s.id === 'y').原因));
});

t('统计在跑：按执行池分组', () => {
  const { 在跑 } = 调度.统计在跑([
    { id: '1', fm: { 执行池: 'claude' } }, { id: '2', fm: { 执行池: 'claude' } }, { id: '3', fm: { 执行池: 'codex' } },
  ]);
  assert.deepEqual(在跑, { claude: 2, codex: 1 });
});

t('统计在跑：挑出疑似卡死的（它占着额度，是「派不出去」的真原因）', () => {
  const 此刻 = Date.parse('2026-08-12T12:00:00.000Z');
  const { 在跑, 疑似卡死 } = 调度.统计在跑([
    { id: '新', fm: { 执行池: 'claude', 派单时间: '2026-08-12T11:55:00.000Z' } },   // 5 分钟，正常
    { id: '卡', fm: { 执行池: 'claude', 派单时间: '2026-08-11T20:00:00.000Z' } },   // 16 小时
    { id: '无时间', fm: { 执行池: 'codex' } },                                      // 说不清死活
  ], 此刻, 30 * 60 * 1000);
  assert.deepEqual(在跑, { claude: 2, codex: 1 }, '疑似卡死的照样计入在跑——**不自动回收额度**');
  assert.deepEqual(疑似卡死.map((x) => x.id).sort(), ['卡', '无时间']);
  assert.equal(疑似卡死.find((x) => x.id === '卡').分钟, 960);
  assert.equal(疑似卡死.find((x) => x.id === '无时间').分钟, null);
  // 不传阈值时退回纯统计：调用方没打算查卡死，就不该凭空多出一串
  assert.deepEqual(调度.统计在跑([{ id: 'x', fm: { 执行池: 'a' } }]).疑似卡死, []);
});

t('归因：把「已达并发上限」补成人能行动的一句', () => {
  // 原先巡检在一边报「在途超时」，调度在另一边说「上限满了」，隔着一个页面，
  // 人得自己把两条连起来。实测踩到：ORCH-1 卡 925 分钟，claude 上限 2，
  // 于是每轮只能派一张，而界面上没有任何一处把这两件事摆在一起。
  const 跳过 = [
    { id: 'A', 原因: '池 claude 已达并发上限 2' },
    { id: 'B', 原因: '依赖未就绪' },
    { id: 'C', 原因: '池 codex 已达并发上限 1' },
  ];
  const 出 = 调度.归因(跳过, [{ id: 'ORCH-1', 池: 'claude', 分钟: 925 }]);
  assert.ok(/ORCH-1/.test(出[0].原因) && /925/.test(出[0].原因), 出[0].原因);
  assert.ok(/退回待投/.test(出[0].原因), '要给出下一步动作，不能只描述现象');
  assert.deepEqual(出[0].疑似卡死, ['ORCH-1']);
  assert.equal(出[1].原因, '依赖未就绪', '与并发无关的跳过原因不该被改');
  assert.equal(出[2].原因, '池 codex 已达并发上限 1', '别的池不该被安上 claude 的嫌疑');
  // 没有卡死时原样返回：不该凭空给每条跳过都缀一段话
  assert.deepEqual(调度.归因(跳过, []), 跳过);
});

// ---- 巡检 ----
const 现在 = Date.parse('2026-08-10T12:00:00.000Z');
t('卡在途：超时报急，且说清后果', () => {
  const 告 = 巡检.卡在途([{ id: 'T', fm: { 派单时间: '2026-08-10T11:00:00.000Z' } }], 现在, 30 * 60 * 1000);
  assert.equal(告.length, 1);
  assert.equal(告[0].级别, '急');
  assert.ok(/占着并发额度/.test(告[0].说明), '要说清后果，不然人不知道为什么该管它：' + 告[0].说明);
});

t('卡在途：没到阈值不报；无派单时间单独报常级', () => {
  assert.equal(巡检.卡在途([{ id: 'T', fm: { 派单时间: '2026-08-10T11:50:00.000Z' } }], 现在, 30 * 60 * 1000).length, 0);
  const 无 = 巡检.卡在途([{ id: 'T', fm: {} }], 现在, 30 * 60 * 1000);
  assert.equal(无[0].级别, '常', '判断不了跑多久不等于出事，别拿急级淹没真告警');
});

t('零派发：有待投却一张没派 → 急，并带原因分布', () => {
  const 告 = 巡检.零派发(3, 0, [{ 原因: '依赖未就绪' }, { 原因: '依赖未就绪' }, { 原因: '池 claude 已达并发上限 1' }]);
  assert.equal(告.length, 1);
  assert.equal(告[0].级别, '急');
  assert.ok(/依赖未就绪×2/.test(告[0].说明), '原因要聚合计数，一眼看出主因：' + 告[0].说明);
  assert.equal(巡检.零派发(3, 1, []).length, 0, '派出去了就不报');
  assert.equal(巡检.零派发(0, 0, []).length, 0, '没待投也不报——没活干不是异常');
});

t('依赖死结：缺失与互依都要抓出来', () => {
  const 全 = [
    { id: 'A', state: '待投', fm: { 依赖: ['B'] } },
    { id: 'B', state: '待投', fm: { 依赖: ['A'] } },
    { id: 'C', state: '待投', fm: { 依赖: ['幽灵'] } },
  ];
  const 告 = 巡检.依赖死结(全);
  assert.ok(告.some((x) => x.类型 === '依赖成环'), '互依必须抓——两张都永远不会就绪');
  assert.ok(告.some((x) => x.类型 === '依赖缺失'), '依赖不存在也必须抓');
  assert.ok(告.every((x) => x.级别 === '急'));
});

t('依赖死结：已完成的单不参与判定', () => {
  assert.equal(巡检.依赖死结([{ id: 'A', state: '完成', fm: { 依赖: ['幽灵'] } }]).length, 0,
    '已完成的单再报依赖问题是噪音');
});

t('预算冻结报常级（闸住是设计行为，但人得知道）', () => {
  const 告 = 巡检.预算告警({ claude: '日 token 超限' });
  assert.equal(告[0].级别, '常');
  assert.ok(/顺位到别家或积压/.test(告[0].说明), '要说清它对产线的影响');
});

t('巡一轮把四类合起来', () => {
  const 全 = [
    { id: 'T', state: '在途', fm: { 派单时间: '2026-08-10T10:00:00.000Z' } },
    { id: 'W', state: '待投', fm: {} },
  ];
  const 告 = 巡检.巡一轮({}, { 全部工单: 全, 现在, 冻结: { codex: 'x' }, 本轮派出: 0, 本轮跳过: [{ 原因: 'a' }] });
  const 类 = 告.map((x) => x.类型);
  assert.ok(类.includes('在途超时') && 类.includes('零派发') && 类.includes('预算冻结'));
});

// ---- 质检 ----
const 质检 = require(path.join(平台根, 'lib', '质检.js'));

t('默认要质检——跳过必须是显式决定', () => {
  // 反过来（默认不检、要检才配）会让「没配 = 没人验收」，那是最危险的默认。
  assert.equal(质检.需质检({}, { id: 'T', fm: { role: 'backend' } }).要, true, '缺配置必须是「要检」');
  assert.equal(质检.需质检({ 质检: { 启用: false } }, { id: 'T', fm: {} }).要, false, '全局关闭');
  assert.equal(质检.需质检({}, { id: 'T', fm: { QA: '关' } }).要, false, '工单显式声明免检');
  assert.equal(质检.需质检({ 质检: { 免检角色: ['integrator'] } }, { id: 'T', fm: { role: 'integrator' } }).要, false);
});

t('reviewer 的产出不再送检（判官判判官会无限递归）', () => {
  const r = 质检.需质检({}, { id: 'T', fm: { role: 'reviewer' } });
  assert.equal(r.要, false);
  assert.ok(/递归/.test(r.因), r.因);
});

t('质检提示词给客观材料，不喂执行方的自述', () => {
  const p = 质检.质检提示词({ id: 'T-9', fm: { title: '加个函数' }, body: '## 验收标准\n- [ ] 有导出' }, ['index.js']);
  assert.ok(p.includes('T-9') && p.includes('加个函数'));
  assert.ok(p.includes('- index.js'), '要列出实际改动的文件');
  assert.ok(p.includes('结论：通过'), '要规定输出格式，否则解析不出结论');
  assert.ok(/不要修改任何文件/.test(p), '判官只该读和判');
});

t('拿不到改动清单 ≠ 确实没改文件——这两句对判官的含义完全相反', () => {
  // 首次真跑（2026-08-12）当场撞到：E2E-1 的实现已经合进 master，
  // 判官却被告知「实际改动的文件：（无文件改动）」，于是判不过——
  // 它做的判断没错，错的是喂给它的材料。R-1 连挂三次多半也是这个。
  const 空 = 质检.质检提示词({ id: 'T', fm: {}, body: '## 验收标准\n- [ ] 有导出' }, []);
  assert.ok(!/（无文件改动）/.test(空), '不能把「取材失败」印成「确实没改」——那是判不过的铁证');
  assert.ok(/不等于没改文件/.test(空), '要明确告诉判官这行的含义：' + 空.slice(-200));
  assert.ok(/不要仅凭这一行/.test(空), '要给出该怎么办，不能只描述状态');
  // 有清单时照常列
  const 有 = 质检.质检提示词({ id: 'T', fm: {}, body: '' }, ['util.js']);
  assert.ok(有.includes('- util.js') && !/不等于没改文件/.test(有));
});

t('跑成功但零改动：退回待投并记原因，不许静默留在在途', () => {
  // 首次真跑的第二轮撞到：clamp 上一轮已经合进去，这轮 AI 无事可做，
  // 检查点无改动不提交 → 不发布 → 不流转，工单就这么静静留在「在途」。
  // 人看到一张卡住的单，而巡检迟早报「在途超时，执行器可能已挂」——**归错了因**：
  // 进程好好地跑完了。而且它还白占一个并发额度。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.ok(/!c\.体\.committed && !c\.体\.changed/.test(源), '要单独认出「跑成功但零改动」这条路');
  assert.ok(/'在途', '待投'[\s\S]{0,200}fm\.空转/.test(源), '空转要退回待投并把原因写进工单');
  assert.ok(/空转 \? \{ 空转 \}/.test(源), '空转要顶在回执里——人点完真跑看的是响应，不是工单文件');
  // **不替人下结论**：平台判不出是「本来就做完了」还是「agent 没动手」
  assert.ok(/判不出是哪种情况/.test(源), '这是歧义结果，不该替人断言是哪一种');
});

t('质检处理函数里不许引用 /run 作用域的变量（跨作用域引用会整进程崩）', () => {
  // 实测：给质检加审阅区时直接写了 项目名，那是 /run 里的变量。
  // 执行器一收到质检请求就 ReferenceError，**整个进程崩掉**，
  // 而 179 项测试一条都没红——质检的真跑路径从来没被覆盖过。
  //
  // 这条断言拿函数体当文本查：把 /qa/ 那段剪出来，看它用到的标识符
  // 是不是都在自己这段里声明过。粗糙，但足够挡住「顺手引用了隔壁作用域」。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  // 用注释头当锚，别拿含正则的那行去 indexOf——转义一错就整条断言失效
  // （第一版就是这样，报「找不到质检段」而不是报真问题）。
  const 起 = 源.indexOf('// ——— 质检（协-004）');
  const 止 = 源.indexOf('// 派活 + 执行', 起);
  assert.ok(起 > 0 && 止 > 起, '找不到质检段——改了结构就把这条断言一起改');
  const 段 = 源.slice(起, 止);
  // 这几个是 /run 独有的局部变量，质检段里出现即为跨作用域引用
  for (const 名 of ['共同.角色', '装配', '拼.提示', '工作区.commit']) {
    assert.ok(!段.includes(名), `质检段引用了 /run 的局部变量：${名}`);
  }
  // 项目名必须在本段里自己声明
  if (段.includes('项目名')) {
    assert.ok(/const 项目名 = /.test(段), '质检段用了 项目名 却没在本段声明——那是 /run 的变量');
  }
});

t('跨厂是偏好不是硬要求：替代者全冻结时退回原执行方，并如实标出来', () => {
  // 两层各自正确，合起来会把活卡死：router 在排名阶段排除原执行方（跨厂避让），
  // 而预算冻结在派单层才发生。于是「替代者全被冻结」时候选是空的——
  // 但原执行方明明可用。实测（海投王 HW-1）：claude 干的活，跨厂排除 claude、
  // codex 被预算闸冻结，结果报「全部候选都不可用」，质检彻底卡死。
  //
  // 同源评审弱于跨厂，但**弱于跨厂 ≠ 不如不判**。
  const 源 = fs.readFileSync(path.join(平台根, 'lib', '派单.js'), 'utf8');
  assert.ok(/同源兜底/.test(源), '缺少同源兜底——替代者全冻结时质检会卡死');
  assert.ok(/类别 !== '执行'/.test(源), '兜底只该用于评审类，执行不能因为「没别家」就随便挑');
  // 必须说出来，不能悄悄降级
  assert.ok(/同源兜底 \? \{ 同源兜底 \}/.test(源), '兜底要写进回执');
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.ok(/派\.同源兜底/.test(执), '执行器要把同源兜底透传给调用方——否则界面上看不出这次判官和执行方同源');
});

t('判官必须拿到代码视图，拿不到就得说出来', () => {
  // 判官此前跑在现建的空目录里，跟被评审的代码毫无关系：被告知「改了 util.js」，
  // 去读，得到 ENOENT。它的判断没错——「工作区中不存在 util.js」是它眼前的事实——
  // 错的是我们没给它代码。实测 QA-VERIFY：实现已合进主线且功能正确，仍被判不过。
  const 提 = 质检.质检提示词({ id: 'T', fm: {}, body: '## 验收标准\n- [ ] x' }, ['util.js'], { 审阅区: true });
  assert.ok(/代码就在你的当前工作目录里/.test(提), '有审阅区时要告诉判官去哪儿看：' + 提.slice(0, 200));
  const 无 = 质检.质检提示词({ id: 'T', fm: {}, body: '' }, ['util.js'], { 审阅区: false });
  assert.ok(/没有给你代码视图/.test(无), '没有审阅区时必须明说，否则判官会把「找不到文件」当成「没实现」');
  assert.ok(/不要把「目录里找不到文件」当成「没有实现」/.test(无), 无.slice(0, 300));
});

t('质检的改动清单默认读工单，不指望调用方传', () => {
  // 原先执行器只认 体.变更文件，而没有任何调用方会传——界面的 判() 只发 {干跑}。
  // 于是判官每次都拿到空清单。这类「接口要一个参数，而没人会给」的洞
  // 不会报错，只会让功能长期以一种看似合理的方式失效。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.ok(/t\.fm && t\.fm\.变更文件/.test(源), '质检要能从工单 frontmatter 读改动清单');
  assert.ok(/fm\.变更文件 = c\.体\.变更文件/.test(源), '执行成功时要把改动清单写进工单');
  const 服 = fs.readFileSync(path.join(平台根, 'scripts', '工作区服务.js'), 'utf8');
  assert.ok(/changedFiles\(体\.工作区\.path\)/.test(服),
    '改动清单必须在**检查点那一刻**取：提交之后 diff 就空了，收工之后目录都没了');
});

t('判定：通过→完成，不过→回待投（不是失败终态）', () => {
  const 通 = 质检.判定(0, '结论：通过\n\n## 阻断问题\n无\n');
  assert.equal(通.结论, '通过');
  assert.equal(通.下一步, '完成');

  const 否 = 质检.判定(0, '结论：不过\n\n## 阻断问题\n- 没有导出\n- 漏了测试\n');
  assert.equal(否.结论, '不过');
  assert.equal(否.下一步, '待投', '判不过回待投重做，同一张单可以再跑');
  assert.ok(否.意见.问题.length >= 2, '要把阻断问题归一出来：' + JSON.stringify(否.意见.问题));
});

t('判官失败不打整单——工单维持原状待重判', () => {
  for (const [码, 出] of [[1, '崩了'], [0, ''], [0, '一堆没有结论的废话']]) {
    const r = 质检.判定(码, 出);
    assert.equal(r.结论, '判官失败', `退出码 ${码} 输出「${出.slice(0, 6)}」应判判官失败`);
    assert.equal(r.下一步, null, '判官自己挂了不该改变工单状态——那不是被评审方的错');
  }
});

// ---- 输出提取（2026-08-10 首次跨厂真判踩出来的）----
const 输出提取 = require(path.join(平台根, 'lib', '输出提取.js'));

t('codex JSONL：抽出最后一条 agent_message，不把流事件当正文', () => {
  // 这段是**真实的 codex 输出结构**（首次跨厂真判抓的样本）。
  // 不抽的话，review-opinion 会把 thread.started / command_execution 这些
  // 流事件当成「阻断问题」——判官明明工作正常，回执却是一堆 JSON 垃圾。
  const 流 = [
    '{"type":"thread.started","thread_id":"x"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"我先看一眼文件。"}}',
    '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"ls","exit_code":0}}',
    '2026-08-10T14:27:42Z ERROR codex_models_manager: failed to refresh',
    '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"结论：不过\\n## 阻断问题\\n- 改了不该改的文件"}}',
    '{"type":"turn.completed","usage":{"input_tokens":1}}',
  ].join('\n');
  const r = 输出提取.抽正文(流, 'codex-jsonl');
  assert.equal(r.来源, 'codex-jsonl');
  assert.ok(r.正文.startsWith('结论：不过'), '要取最后一条 agent_message，不是第一条：' + r.正文.slice(0, 40));
  assert.ok(!r.正文.includes('thread.started'), '流事件不得混进正文');
  // 非 JSON 的日志行（codex 会往 stdout 混 ERROR 行）不能把解析带崩
  assert.equal(输出提取.逐行JSON(流).length, 6);
});

t('claude stream-json：取最后一条 assistant 文本', () => {
  const 流 = [
    '{"type":"system","subtype":"init"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"我先想想。"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"结论：通过"}]}}',
  ].join('\n');
  const r = 输出提取.抽正文(流, 'claude-stream-json');
  assert.equal(r.正文, '结论：通过');
});

t('抽不出正文时回退原文，且标记提取失败', () => {
  // 空会让上游误判成「零输出」，进而把一次成功的运行记成失败、污染路由战绩。
  const r = 输出提取.抽正文('{"type":"turn.started"}', 'codex-jsonl');
  assert.ok(r.提取失败, '要标记出来，人才知道是格式变了而不是判官没说话');
  assert.ok(r.正文.length > 0, '必须回退原文，不能返回空');
  // 未知格式原样返回，不猜
  assert.equal(输出提取.抽正文('随便一段话', '没见过的格式').正文, '随便一段话');
});

t('端到端：抽正文 → 质检判定，结论与问题都干净', () => {
  const 流 = [
    '{"type":"thread.started"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"结论：不过\\n## 阻断问题\\n- 没有导出\\n- 漏了测试\\n## 验收证据\\n- 看了 index.js"}}',
  ].join('\n');
  const 抽 = 输出提取.抽正文(流, 'codex-jsonl');
  const 判 = 质检.判定(0, 抽.正文);
  assert.equal(判.结论, '不过');
  assert.deepEqual(判.意见.问题, ['没有导出', '漏了测试'], '问题里不得混入流事件');
  assert.equal(判.意见.证据.length, 1);
});

// ---- 受限参数按适配器分（同一次真判踩出来的）----
t('受限参数按适配器分：claude 的 flag 不能塞给 codex', () => {
  const 配 = { providers: { codex: { adapter: 'codex-cli' } }, 执行: { 权限: { 放开: [] } } };
  const c = 派单.权限参数(配, 'reviewer', 'claude-cli');
  const x = 派单.权限参数(配, 'reviewer', 'codex-cli');
  assert.deepEqual(c.参数, ['--permission-mode', 'plan']);
  assert.ok(x.参数.includes('--sandbox'), 'codex 用沙箱表达同一件事');
  assert.ok(!x.参数.includes('--permission-mode'),
    'codex 不认这个 flag——实测退出码 2，且加固②会把它归类成「判官失败」，看上去像判官不稳定');
});

t('旧的数组写法仍兼容，但必须响亮告警', () => {
  // 保留兼容是为了不破坏既有配置，但一刀切正是本次故障的成因，不能默默接受。
  const 配 = { 执行: { 权限: { 放开: [], 受限参数: ['--permission-mode', 'plan'] } } };
  const r = 派单.权限参数(配, 'reviewer', 'codex-cli');
  assert.ok(r.警告, '数组写法必须带警告');
  assert.ok(/跨厂时必挂/.test(r.警告), r.警告);
});

t('未知适配器：明说受限模式形同虚设', () => {
  const r = 派单.权限参数({}, 'reviewer', '没见过-cli');
  assert.deepEqual(r.参数, []);
  assert.ok(/形同虚设/.test(r.警告), '注不进参数就等于没受限，必须说出来：' + r.警告);
});

// ---- 编排提示：契约不能只存在于代码里（2026-08-11 首次跑 orchestrator 踩到）----
const 编排提示 = require(path.join(平台根, 'lib', '编排提示.js'));
const 计划模块 = require(path.join(平台根, 'lib', 'orchestration', 'plan.js'));

t('契约块点名顶层键必须叫 tasks', () => {
  // 首次真跑：AI 输出 {"tickets":[...]}，拆解本身完全正确——两张子单、角色合法、
  // 验收标准客观、依赖对——只因顶层键不叫 tasks 就整份作废，白烧 88 秒。
  // 根因不是 AI 不听话，是**契约只存在于代码里，没人告诉它**。
  const 块 = 编排提示.契约块({ roles: { backend: {}, reviewer: {} } });
  assert.ok(/顶层键必须叫 `tasks`/.test(块), '必须显式点名，别指望 AI 猜');
  assert.ok(/不是 tickets/.test(块), '要点名最容易猜错的那个：AI 第一次就写了 tickets');
  assert.ok(/backend \/ reviewer/.test(块), '角色词表要从配置里取，不写死');
});

t('契约与 plan.js 的实际校验不许漂移', () => {
  // 这条断言的意义：plan.js 改了字段名而提示没跟着改，会重演同一次事故。
  const 源 = fs.readFileSync(path.join(平台根, 'lib', 'orchestration', 'plan.js'), 'utf8');
  const 块 = 编排提示.契约块({});
  // plan.js 认的顶层键
  assert.ok(/value\.tasks \|\| value\.任务/.test(源), 'plan.js 的顶层键契约变了，契约块要同步改');
  // 提示里承诺的字段，plan.js 必须真的读
  for (const 键 of ['acceptance', 'dependsOn', 'writeScope', 'role', 'key', 'title']) {
    assert.ok(块.includes(键), `契约块应说明 ${键}`);
    assert.ok(源.includes(键), `plan.js 应真的读 ${键}——契约里承诺了却不读，等于骗 AI`);
  }
});

t('只给 orchestrator 附加契约，别的角色不受污染', () => {
  const a = 编排提示.拼提示({}, 'orchestrator', '原正文');
  assert.equal(a.附加, true);
  assert.ok(a.提示.startsWith('原正文'), '原正文必须在前，契约在后');
  assert.ok(a.提示.length > '原正文'.length);
  const b = 编排提示.拼提示({}, 'backend', '原正文');
  assert.equal(b.附加, false);
  assert.equal(b.提示, '原正文', '给 backend 附计划契约会诱导它去输出计划而不是干活');
});

t('按契约写的计划，plan.js 真的收', () => {
  // 端到端闭环：契约块说什么，plan.js 就得收什么。
  const 计划文本 = '```json\n' + JSON.stringify({
    summary: '两步',
    tasks: [
      { key: 'a', title: '实现', role: 'backend', acceptance: ['能跑'] },
      { key: 'b', title: '评审', role: 'reviewer', dependsOn: ['a'], acceptance: ['无阻断'] },
    ],
  }) + '\n```';
  const r = 计划模块.resolvePlan({ roles: { backend: {}, reviewer: {} } }, 计划文本, undefined);
  assert.equal(r.plan.tasks.length, 2);
  assert.deepEqual(r.plan.tasks[1].dependsOn, ['a']);
});

// ---- 反复回炉（协-005）----
t('反复回炉：判不过达阈值才报，且只算工单的锅', () => {
  const 全 = [{ id: 'X', state: '待投', fm: {} }];
  const 战 = (n) => Array.from({ length: n }, () => ({ role: 'reviewer', qualityPassed: false, ticket: 'X' }));
  assert.equal(巡检.反复回炉(全, 战(2), 3).length, 0, '没到阈值不报——单次判不过是正常的');
  const 告 = 巡检.反复回炉(全, 战(3), 3);
  assert.equal(告.length, 1);
  assert.equal(告[0].级别, '急');
  assert.ok(/继续重跑只是烧钱/.test(告[0].说明), '要说清为什么该停下来看：' + 告[0].说明);
  // 判官自己失败的不算——那不是工单的错
  const 判官挂 = Array.from({ length: 5 }, () => ({ role: 'reviewer', qualityPassed: undefined, ticket: 'X' }));
  assert.equal(巡检.反复回炉(全, 判官挂, 3).length, 0, '判官挂了不该记在工单头上');
  // 后来过了就不再提
  assert.equal(巡检.反复回炉([{ id: 'X', state: '完成', fm: {} }], 战(5), 3).length, 0);

  // 单已经不在库里（被删了）→ 不报。
  //
  // 战绩账本是只追加的，它永远记着这张单被判不过几次。原先只在「找得到且已完成」
  // 时跳过，于是删掉的单会一直报「反复回炉」，而且**永远消不掉**——
  // 告警要人去看一张已经不存在的单。实测踩到（R-1 删掉之后告警仍在）。
  // 一条无法通过任何操作解除的告警比不报更糟：它会训练人无视整个告警区。
  assert.equal(巡检.反复回炉([], 战(5), 3).length, 0, '删掉的单不该继续报，那条告警永远消不掉');
  assert.equal(巡检.反复回炉([{ id: '别的单', state: '待投', fm: {} }], 战(5), 3).length, 0);
});

// ---- 提示装配（协-005）：角色协议与回炉要求 ----
const 提示装配 = require(path.join(平台根, 'lib', '提示装配.js'));
const 工单模板 = require(path.join(平台根, 'lib', '工单模板.js'));

t('角色协议真的被读进提示（六份出厂就在库里，此前从没人喂过 AI）', () => {
  const r = 提示装配.装配(平台根, { body: '干活', fm: { role: 'backend' } });
  assert.ok(r.提示.startsWith('干活'), '工单正文必须在最前——它是这次要干的事');
  assert.ok(/backend 角色协议/.test(r.提示));
  assert.ok(/必须带可运行测试/.test(r.提示), '协议正文要真的进去，不是只有标题');
  assert.equal(r.装配记录.角色协议, 'backend');
});

t('缺角色协议不报错，但**如实告知**', () => {
  // 静默少喂一段约束，事后没人能从回执里看出来
  const r = 提示装配.装配(平台根, { body: 'x', fm: { role: '没这个角色' } });
  assert.ok(!r.装配记录.角色协议);
  assert.ok(/没有 角色协议模板/.test(r.装配记录.角色协议缺), r.装配记录.角色协议缺);
});

t('回炉要求：判不过时把上次的阻断问题喂回去，且排在最后', () => {
  // 重跑时 AI 看不到上次为什么没过，同一个坑会照踩不误，每踩一次都是真实付费
  const r = 提示装配.装配(平台根, {
    body: '干活',
    fm: { role: 'backend', 质检结论: '不过', 质检判官: 'codex', 质检时间: 'T',
      质检意见: { 问题: ['没有导出 greet'], 证据: ['看了 index.js'] } },
  });
  assert.ok(/被判不过/.test(r.提示));
  assert.ok(/没有导出 greet/.test(r.提示), '阻断问题要逐条喂回');
  assert.ok(r.提示.indexOf('被判不过') > r.提示.indexOf('backend 角色协议'),
    '回炉要求排最后——LLM 对末尾注意力更高，而「上次为什么没过」是这轮最该先解决的');
  assert.ok(/标准自相矛盾|需要人来改单/.test(r.提示),
    '要允许 AI 反驳标准本身：反复判不过时问题往往就出在标准上');
});

t('判过或没判过的单不带回炉要求', () => {
  assert.equal(提示装配.回炉要求({ 质检结论: '通过', 质检意见: { 问题: [] } }).有, false);
  assert.equal(提示装配.回炉要求({}).有, false);
});

// ---- 工单模板 ----
t('模板给的是填空提示而不是空行（空行只会被跳过）', () => {
  const r = 工单模板.取('backend');
  assert.ok(r.有);
  assert.ok(/## 验收标准/.test(r.正文));
  assert.ok(/具体文件|具体函数名/.test(r.正文), '要逼人想「这条怎么验」');
  // reviewer 模板要点破那个最常见的写坏方式
  assert.ok(/不是「被评审方要满足什么」/.test(工单模板.取('reviewer').正文));
});

t('体检挑毛病但不拦不改（标准是人对「做对了」的定义）', () => {
  const 含糊 = ['## 验收标准', '- [ ] 实现正确', '- [ ] 代码健壮'].join('\n');
  const r = 工单模板.体检(含糊);
  assert.ok(r.病.some((b) => /主观词/.test(b.说)), '「正确」「健壮」判官没法验：' + JSON.stringify(r.病));

  const 占位 = ['## 验收标准', '- [ ] <具体文件>'].join('\n');
  assert.ok(工单模板.体检(占位).病.some((b) => /占位符/.test(b.说)), '模板没填就建单要报');

  assert.ok(!工单模板.体检('## 范围\n干活').ok, '压根没有验收标准一节 → 急');

  // R-1 那两条是客观的，必须放行——把「用错了工具」误判成「单子写得烂」，
  // 会让人去改一张本来没问题的单，而真正的错误原封不动。
  const R1 = ['## 验收标准', '- [ ] 有非空文字输出', '- [ ] 未产生任何文件改动'].join('\n');
  assert.equal(工单模板.体检(R1).ok, true);
});

fs.rmSync(沙盒, { recursive: true, force: true });
console.log(`全部通过：${passed} 项`);
