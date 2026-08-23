// inbox-route.test.js — 在途页（#/agents）这条路由上的 G11 编辑器锁（2026-08-22 体检 #34）
//
// 案情：在途页**按项目过滤**（施工令-012），锁那一块却按全局读：
//   · 主横幅报的是「全部被锁项目」——于是身处 Ticketflow 时会看见「TK 派发挂起」，
//     而 TK 的活这一页上一条也没有；
//   · 那颗按钮的请求体不带 项目，服务端一律落项目默认（TK）——**锁错项目比锁不上更坏**。
// 病灶已修（app.js 的 本项目 = projActive() || projDefault()，editorLock 带项目）。
// 缺的是能红的判据：原判据是 assert.match(app.js 源码, /projActive/) 这一族，
// 把 `const 本项目 = projActive() || projDefault()` 改回 `projDefault()` 照样全绿。
//
// 这里换行为面：真装前端、真跑 viewAgents、真按那颗按钮、看它发出去的请求体。
const assert = require('node:assert');
const { 装载前端 } = require('./frontend-sandbox');
const { 收尾 } = require('./helper');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('在途页路由 · G11 编辑器锁测试（#34）');

// 起一台「身处 项目名、服务端报 占用 这几个项目被锁」的在途页
const 开台 = async ({ 项目, 占用 }) => {
  const ctx = 装载前端();
  const 发出 = [];
  const cfg = { 项目: { 注册: { TK: {}, Ticketflow: {} }, 默认: 'TK' }, 执行器: { 派发制: true },
    闸值: {}, 执行池: {}, 模型: {}, quota: {}, server: {} };
  const agents = { 模式: '派发', 在跑: [], 判官: [], 就绪队列: [], 并发上限: { codex: 2, claude: 3 },
    滞留告警: [], 编辑器占用: 占用, 引擎作业: {} };
  const board = { states: ['在途'], board: { 在途: [] }, 隐藏数: 0 };
  ctx.fetch = async (u, o) => {
    const p = String(u); let b = {};
    if (p.startsWith('/api/config')) b = cfg;
    else if (p.startsWith('/api/agents')) b = agents;
    else if (p.startsWith('/api/board')) b = board;
    else if (p.startsWith('/api/editor-lock')) { 发出.push(o && o.body ? JSON.parse(o.body) : null); b = { ok: true }; }
    return { ok: true, json: async () => b };
  };
  ctx.toast = () => {};
  ctx.localStorage.setItem('studio-proj', 项目 || '');
  await ctx.loadCfg(true);              // force：绕开 30s 缓存，把项目注册表真摆进去
  const html = await ctx.viewAgents();
  // 按钮态只有开/关两种，从 onclick 里读出来——读的是页面真吐的那一颗，不是源码里那一行
  const m = html.match(/onclick="editorLock\((true|false)\)"/);
  return { ctx, html, 发出, 按钮: m && m[1] };
};

(async () => {

await t('#34 他项目的锁不许上本项目的主横幅（在途页是按项目过滤的）', async () => {
  const { html } = await 开台({ 项目: 'Ticketflow', 占用: ['TK'] });
  assert.ok(!/编辑器锁已关（验收中）/.test(html),
    '身处 Ticketflow，主横幅却在报别人家的锁——而 TK 的活这一页一条都没有');
  assert.match(html, /另有项目 TK 的编辑器锁也关着/,
    '他项目被锁也不能装看不见，另起一行说明即可（施工令-012 口径）');
});

await t('#34 按钮态看本项目：本项目没锁 ⇒ 这颗钮是「关锁」', async () => {
  const { 按钮, html } = await 开台({ 项目: 'Ticketflow', 占用: ['TK'] });
  assert.equal(按钮, 'true', '本项目没锁却摆着「开锁」——按下去是开一把根本不存在的锁');
  assert.match(html, /关锁 · 挂起派发/, '按钮文案要跟按钮态一致');
});

await t('#34 反例一路：本项目自己被锁 ⇒ 主横幅出、按钮翻成「开锁」', async () => {
  const { 按钮, html } = await 开台({ 项目: 'Ticketflow', 占用: ['Ticketflow'] });
  assert.match(html, /编辑器锁已关（验收中）/, '本项目被锁，主横幅必须出');
  assert.match(html, /项目 Ticketflow 派发挂起/, '横幅要指名道姓是哪个项目');
  assert.ok(!/另有项目/.test(html), '只有本项目被锁时，不该再冒出「另有项目」那一行');
  assert.equal(按钮, 'false', '本项目锁着 ⇒ 按钮该是「开锁」');
});

await t('#34 两个项目都锁着：主横幅报本项目，他项目另起一行——两条线不许混', async () => {
  const { html, 按钮 } = await 开台({ 项目: 'Ticketflow', 占用: ['TK', 'Ticketflow'] });
  assert.match(html, /项目 Ticketflow 派发挂起/);
  assert.match(html, /另有项目 TK 的编辑器锁也关着/);
  assert.equal(按钮, 'false');
});

await t('#34 点这颗钮，请求体带的是**当前语境项目**，不是项目默认值', async () => {
  const { ctx, 发出 } = await 开台({ 项目: 'Ticketflow', 占用: [] });
  await ctx.editorLock(true);
  assert.equal(发出.length, 1, '点了锁却没往 /api/editor-lock 发过东西');
  assert.equal(发出[0].关, true);
  assert.equal(发出[0].项目, 'Ticketflow',
    '锁错项目比锁不上更坏：服务端拿不到 项目 就落默认 TK，而你在这一页上根本看不见 TK');
  await ctx.editorLock(false);
  assert.deepEqual(发出[1], { 关: false, 项目: 'Ticketflow' }, '开锁同理');
});

await t('#34 单项目/未选语境下退回项目默认，不发一个空章', async () => {
  // projActive() 在「注册表 <2 个项目」或「没选」时返空——这时按默认项目走，
  // 但**绝不能**把 项目 这一格漏掉或发空串，那等于回到服务端猜的老路。
  const { ctx, 发出 } = await 开台({ 项目: '', 占用: [] });
  await ctx.editorLock(true);
  assert.equal(发出.length, 1);
  assert.equal(发出[0].项目, 'TK', '未选项目时该落配置里的默认项目：' + JSON.stringify(发出[0]));
});

/* ═══ 第二段：收件箱行的落点路由（#12/#40，app.js 消费侧）═══
 *
 * 案情：/api/attn 逐闸下发 路由 这一格（注册表落点的机器形态），收件箱行点下去就该照它跳。
 * 原样是按 id 形状猜——`/^[A-Z]-\d+$/.test(id) ? '#/tickets' : '#/t/'+id`——
 * 想法（I-7）、待办（uuid）、专项（S-2）一律落 `#/t/<非工单号>`，服务端明确回「工单不存在」。
 *
 * 这一格此前压在 test/gatereg.test.js 里，形态是两句 app.js 源码 grep；
 * 闸表组本轮把它删了（负向那句正则漏了一个连字符，病灶贴回去照绿），于是消费侧一度无判据。
 * 这里补上的是行为面：真跑 viewOverview()，把它真吐出来的 onclick 里的 hash 全抓出来对表。
 */
console.log('收件箱落点路由（#12/#40）');

const 开总览 = async (债) => {
  const ctx = 装载前端();
  ctx.fetch = async (u) => {
    const p = String(u); let b = {};
    if (p.startsWith('/api/attn')) b = { 逾期阈值小时: 24, 债 };
    else if (p.startsWith('/api/board')) b = { states: ['待验收', '待定夺', '在途', '质检', '池', '待投'], board: {}, 隐藏数: 0 };
    else if (p.startsWith('/api/journal')) b = { lines: [] };
    else if (p.startsWith('/api/agents')) b = { 在跑: [] };
    else if (p.startsWith('/api/config')) b = { 项目: { 注册: {}, 默认: 'TK' }, 闸值: {} };
    return { ok: true, json: async () => b };
  };
  const html = await ctx.viewOverview();
  // 读页面真吐出来的那一串，不读源码里那一行
  return [...html.matchAll(/onclick="location\.hash='([^']*)'"/g)].map((m) => m[1]);
};

// 四笔非工单实体：想法 / 待办（uuid）/ 工单 / 专项（末一笔归总监，落值守区）
const 四笔 = [
  { id: 'I-7', title: '想法待拍板', 闸名: 'G4 想法拍板', 归属: '制作人', 落点: '项管页 · 想法在池', 停摆小时: 5, 路由: '#/relay' },
  { id: '3f2a-9c11-uuid', title: '待办待放行', 闸名: 'G8 放行成单', 归属: '制作人', 落点: '项管页 · 待办队列', 停摆小时: 100, 路由: '#/relay' },
  { id: 'TK-9', title: '交付待验收', 闸名: 'G1 验收', 归属: '制作人', 落点: '工单详情', 停摆小时: 2, 路由: '#/t/TK-9' },
  { id: 'S-2', title: '专项关账', 闸名: 'G6 关账签字', 归属: '总监', 落点: '工单页 · 特性层', 停摆小时: 300, 路由: '#/tickets/P-1/F-3' },
];

await t('#12/#40 收件箱每一行都照注册表下发的 路由 跳，不按 id 形状猜', async () => {
  const hs = await 开总览(四笔);
  assert.deepEqual(hs, ['#/relay', '#/relay', '#/t/TK-9', '#/tickets/P-1/F-3'],
    '点下去落的地方与 /api/attn 下发的 路由 对不上：' + JSON.stringify(hs));
});

await t('#12/#40 非工单实体一个都不许落 #/t/<非工单号>（服务端会回「工单不存在」）', async () => {
  const hs = await 开总览(四笔);
  const 坏 = hs.filter((h) => /^#\/t\//.test(h) && !/^#\/t\/[A-Z]+-\d+$/.test(h));
  assert.deepEqual(坏, [], '这些行点下去会撞「工单不存在」：' + JSON.stringify(坏));
});

await t('#12/#40 服务端没下发 路由 时才回落 id 形状，且非工单号一律回首页不瞎跳', async () => {
  const hs = await 开总览([
    { id: 'TK-9', title: '有单号无路由', 闸名: 'G1 验收', 归属: '制作人', 落点: '工单详情', 停摆小时: 1 },
    { id: '3f2a-9c11-uuid', title: '无单号无路由', 闸名: 'G8 放行成单', 归属: '制作人', 落点: '项管页', 停摆小时: 1 },
  ]);
  assert.deepEqual(hs, ['#/t/TK-9', '#/'], '回落路径本身也得守住「不瞎跳」：' + JSON.stringify(hs));
});

await t('#12/#40 值守区（归属＝总监）那几行同样照 路由 跳', async () => {
  const hs = await 开总览(四笔);
  assert.equal(hs[hs.length - 1], '#/tickets/P-1/F-3',
    'G6 关账签字的落点在特性层，值守行不许退回 #/tickets 或 #/t/S-2');
});

收尾('收件箱落点路由 + 在途页 G11 编辑器锁', passed);
})().catch((e) => { console.error('  ✗ ' + (e && e.stack || e)); process.exit(1); });
