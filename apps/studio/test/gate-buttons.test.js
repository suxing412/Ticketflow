// gate-buttons.test.js — 闸表点名的那几颗钮，界面上到底有没有（2026-08-22 体检 #64/#14/#44③/#58）
//
// 案情：lib/gatereg.js 的注册表逐格写着「落点 / 按钮」，其中
//   · G8 放行成单（落点：项管页 · 待办队列）
//   · G9 开线（落点：工单页 · 管线层）
// 两颗在前端**零命中**——闸表指着一个不存在的控件，人闸结构上按不下去。
//
// 为什么这条判据必须查 <button> 的**内文**而不是页面文本：
//   app.js 的 rlgate 小注里本来就有「放行成单是人闸……」这句话，
//   于是 `assert.match(html, /放行成单/)` 在**病还在的时候**照样绿。
//   本文件把那条弱判据的反例原地存档（用例②），谁想退回去查页面文本，先看那一格。
//
// 判的是行为不是文本：装载前端 → 真跑 viewRelay()/tkL1() → 从真吐出来的 HTML 里
// 剥出全部 <button> 的内文；再真按下去，看它往哪个端点发什么请求。
const assert = require('node:assert');
const { 装载前端 } = require('./frontend-sandbox');
const { 收尾 } = require('./helper');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('闸表按钮落地测试（#64 G8 放行成单 / #14 G9 开线）');

// 从真吐出来的 HTML 里剥 <button> 内文。剥标签而不是整段匹配——
// title=""、class="" 里的字一律不算数（G8 那颗钮的 title 里就有「放行成单」四个字）。
const 按钮内文 = (html) => (String(html).match(/<button[^>]*>[\s\S]*?<\/button>/g) || [])
  .map((b) => b.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
const 有钮 = (html, 词) => 按钮内文(html).some((s) => s.includes(词));

// ---- 排期页（G8 落点：项管页 · 待办队列）----
const 开排期页 = async ({ 就绪 }) => {
  const ctx = 装载前端();
  const 发出 = [];
  const 粒 = [{ 粒ID: 'g1', 题: '甲待办', 状态: '计划', 就绪: !!就绪, 版本号: 3, 项目: 'TK', 上级: '', 序: 1 }];
  const 队列 = { 摘要: { 文: '共 1 项' }, 批们: [{ 批: 'B1', 完结: false, 计数: { 总: 1, 完: 0, 未完: 1 }, 预估: 2,
    粒: [{ 粒ID: 'g1', 上级: '', 序: 1, 状态: '计划', 题: '甲待办', 提示: '提示', 置灰: false }] }] };
  ctx.fetch = async (u, o) => {
    const p = String(u); let b = {};
    if (p.startsWith('/api/relay')) b = { 消息: [], 值守: true };
    else if (p.startsWith('/api/pm/ledger')) b = { 台账: {} };
    else if (p.startsWith('/api/pm/roster')) b = { 编制: [] };
    else if (p.startsWith('/api/pm/chains')) b = { 链: [] };
    else if (p.startsWith('/api/schedule/')) { if (o && o.method === 'POST') { 发出.push({ 到: p, 体: JSON.parse(o.body) }); b = { ok: true }; } else b = 队列; }
    else if (p.startsWith('/api/schedule')) b = { 粒, 计数: {}, 名册: {} };
    else if (p.startsWith('/api/ideas')) b = { 想法: [] };
    else if (p.startsWith('/api/pm/actions')) b = { 桶: [] };
    return { ok: true, json: async () => b };
  };
  ctx.toast = () => {}; ctx.repaint = () => {}; ctx.route = () => {}; ctx.ask = async () => true;
  const html = await ctx.viewRelay();
  return { ctx, html, 发出 };
};

(async () => {

await t('#64 反转（G8 裁撤 2026-08-26）：举着就绪旗也不许再画「放行成单」钮——死链路拆干净', async () => {
  // 原判据锁「有就绪必有钮」；裁定「该去」后判据反转：任何态都不许有这颗钮、
  // 待办队列区块整体不出现（第一性+对抗审，墓碑在 app.js 项管页 ②）。
  const { html } = await 开排期页({ 就绪: true });
  assert.ok(!有钮(html, '放行成单'), 'G8 已裁撤，放行钮不许再出现：' + JSON.stringify(按钮内文(html)));
  assert.ok(!/id="rl-queue"/.test(html), '待办队列区块（#rl-queue）该整体拆除');
});

await t('#64 反转续：tqRelease 机件已随 G8 拆除——按不下去因为根本不存在', async () => {
  const { ctx, 发出 } = await 开排期页({ 就绪: true });
  assert.equal(ctx.tqRelease, undefined, 'tqRelease 该拆干净——留着的死函数是链路复活的种子');
  assert.equal(发出.length, 0, '拆除后不许有任何 转移 被发出');
});

// ---- 工单页管线层（G9 落点：工单页 · 管线层）----
const 开管线层 = () => {
  const ctx = 装载前端();
  const 发出 = [];
  ctx.fetch = async (u, o) => {
    const p = String(u);
    if (o && o.method === 'POST') { 发出.push({ 到: p, 体: JSON.parse(o.body) }); return { ok: true, json: async () => ({ ok: true, id: 'P-9' }) }; }
    return { ok: true, json: async () => ({}) };
  };
  ctx.toast = () => {}; ctx.route = () => {}; ctx.ask = async () => true;
  const html = ctx.tkL1([{ id: 'P-1', 名称: '地图管线', 状态: '活跃', 阶段: 'L0' }], []);
  return { ctx, html, 发出 };
};

await t('#14/#64 G9：管线层上「开线」必须是一颗真按钮', () => {
  const { html } = 开管线层();
  assert.ok(有钮(html, '开线'),
    'G9 的人闸在界面上按不下去：按钮内文里没有「开线」。现有按钮＝' + JSON.stringify(按钮内文(html)));
});

await t('#14/#64 G9：按下去真发 POST /api/pipelines，名称与阶段都带上', async () => {
  const { ctx, 发出 } = 开管线层();
  const 答 = ['战斗管线', 'L1'];
  ctx.askInput = async () => 答.shift();
  await ctx.plOpen();
  assert.equal(发出.length, 1, '点开线却没往 /api/pipelines 发过东西');
  assert.equal(发出[0].到, '/api/pipelines');
  assert.deepEqual(发出[0].体, { 名称: '战斗管线', 阶段: 'L1' });
});

await t('#14/#64 G9：取消（askInput 回 null）不许落一条空线', async () => {
  const { ctx, 发出 } = 开管线层();
  ctx.askInput = async () => null;
  await ctx.plOpen();
  assert.equal(发出.length, 0, '用户按了取消却开了一条线');
});

// ---- #44③ 撤决策台的界面文案 ----
await t('#44③ 顶栏那句话不许再写「决策台」（该页 08-21 已撤）', () => {
  const ctx = 装载前端();
  const html = ctx.shell('', '<i></i>');
  assert.ok(!/决策台/.test(html),
    '顶栏 tagline 还在给一个撤掉的页面打广告：' + (html.match(/<p class="tagline">[^<]*/) || [''])[0]);
});

// ---- #58 D28 推荐在途退役后的残余 ----
await t('#58 孤儿步进器 rStep 已下岗（它 POST 的 /api/config/recommend 已 404、找的卡片全库不存在）', () => {
  const ctx = 装载前端();
  assert.ok(!('rStep' in ctx), 'rStep 还在全局上——它按下去只会打一个 404');
  assert.equal(typeof ctx.rrStep, 'function', 'rrStep 是另一个函数，不许被一起误删');
});

// ---- 看板待派列（G26 停靠单候裁 · 落点「看板 · 待派列」）----
//
// 本文件立此的原意就是防「闸表指着一个不存在的控件」（#64 G8 / #14 G9 两颗当年零命中）。
// 2026-08-28 新立 G26 时又犯一次：动作口接了、闸表写了按钮，界面上那颗钮没画。
// **而本文件是逐闸手写的、没有全闸覆盖闸，所以它自己没抓出来**——这个局限记在这儿，
// 真要根治得另立一格遍历闸表逐条验，那是更大的一改。
const 卡 = (停靠) => 装载前端().bcard({
  id: 'TK-9', title: '手感闸复验', 职能: '程序', 优先级: 'P1',
  停靠, 停靠因: 停靠 ? '前置人闸未决：TK-180 闸一待制作人拍板' : null,
});

await t('G26·停靠单在看板上认得出来，且「解除停靠/废弃」是两颗真按钮', () => {
  const html = 卡(true);
  assert.ok(/class="pk"/.test(html), '停靠单要有可见标记，否则跟普通待派单分不出来');
  assert.ok(有钮(html, '解除停靠'), 'G26 闸表宣告的钮必须真存在。现有按钮＝' + JSON.stringify(按钮内文(html)));
  assert.ok(有钮(html, '废弃'), 'G26 按钮列写的是「解除停靠/废弃」两颗');
  assert.ok(/前置人闸未决/.test(html), '因由要带出来——不说在等什么，这条闸就只是九个单号');
});

await t('G26·未停靠的单不长这两颗钮（不误伤普通待派单）', () => {
  const html = 卡(false);
  assert.deepEqual(按钮内文(html), [], '普通待派单不该出现任何逐卡动作钮');
  assert.ok(!/class="pk"/.test(html), '也不该带停靠标记');
});

await t('G26·两颗钮各自打对端点，且挡住卡片跳转的冒泡', () => {
  const html = 卡(true);
  // 用 includes 而不是正则：这一段被转义吃了两轮（生成脚本的模板字面量一轮、shell 一轮），
  // 括号先变捕获组、再变任意字符，两次都「看着在验实际没验」。字面量匹配没有这个问题。
  assert.ok(html.includes("unpark('TK-9')"), '解除停靠要调 unpark');
  assert.ok(html.includes("discardOne('TK-9')"), '废弃要调 discardOne');
  // 卡片本身 onclick 会跳详情；不挡冒泡的话点钮＝跳走，动作根本发不出去
  const 钮们 = String(html).match(/<button[^>]*>/g) || [];
  for (const b of 钮们) assert.ok(/stopPropagation/.test(b), '逐卡钮必须挡冒泡：' + b);
});

await t('G26·动作口在前端真存在（unpark/discardOne 不是写在字符串里的空名字）', () => {
  const ctx = 装载前端();
  assert.equal(typeof ctx.unpark, 'function', 'onclick 里写了 unpark，函数就得真在');
  assert.equal(typeof ctx.discardOne, 'function');
});

收尾('闸表按钮落地', passed);
})().catch((e) => { console.error('  ✗ ' + (e && e.stack || e)); process.exit(1); });
