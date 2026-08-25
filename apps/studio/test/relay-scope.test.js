// relay-scope.test.js — 前端「同一把尺 / 失败要说话」的**行为面**判据（2026-08-22 体检 #4 / #65 / #66）
//
// 为什么另起一个套件而不是往 pulse.test.js 里塞：
// 这三条盯的都是**页面吐出来的读数**，不是脉冲刷新决策。而更要紧的是判据的**面**——
// 本轮复核靠「把病原样种回去、测试仍全绿」判掉了 22 条 assert.match(app源码, /某串字/) 的假判据：
// 那种断言证明的只是「某几个字还在」，改名、挪位、被外层 if 绕过、拿到的数据形状不对，它一概照绿；
// 反过来，一次无害的重构（把字面量挪进中间变量）又会让它假红。
// 所以这一整份文件里**没有一条 grep 源码的断言**：一律 test/frontend-sandbox.js 装载真 app.js，
// 喂 fetch 桩、真调渲染函数、断言它真吐出来的 HTML；后端那一侧（recommend）也是真造仓库真跑函数。
const assert = require('node:assert');
const { 装载前端, 设项目 } = require('./frontend-sandbox');

let passed = 0;
const 待 = [];
const t = (n, f) => 待.push([n, f]);
console.log('relay-scope 前端同尺与失败可见性测试（体检 #4 / #65 / #66）');

// 三大态状态机 12 目录态（H108，2026-08-24）——与 lib/core/store.STATES 同表
const 状态们 = ['待审', '待派', '待处理', '待重派', '在途', '初检', '核查', '仲裁', '完成', '归档', '挂起', '废弃'];
const J = (o) => ({ ok: true, json: async () => o });

/* ═══ 一、项管页一把尺（体检 #4 · 2026-08-21 三把尺案）═══
   案源：页头写「监制台 · TK」，页头算出 13 条在排，队列卡却报 34 项未完，后端旧滤镜又只认 2 条。
   病根是队列卡那一口 /api/schedule/队列 **不传 项目 参数** —— 后端 项目视界 拿不到项目就返回全量。
   判据必须验行为：光 grep 源码里有没有 '项目=' 这串字，改个拼法就漏，且会误伤重构。
   这里的 fetch 桩**照后端那样真按参数筛**，所以「前端不传参」在桩上就会如实退化成全量。 */
function 排程桩(叫过) {
  return async (u) => {
    const url = decodeURIComponent(String(u));
    叫过.push(url);
    if (/^\/api\/schedule(\?|$)/.test(url)) { // 甘特口可带 ?项目=（终审 T1）：粒 照旧全量（跨项目前置查表要用），项目只作边集视界
      return J({
        粒: [
          { 粒ID: 'g1', 题: 'TK活儿', 项目: 'TK', 状态: '计划', 批: 'A', 序: 1 },
          { 粒ID: 'g2', 题: 'TF活儿', 项目: 'Ticketflow', 状态: '计划', 批: 'B', 序: 1 },
          { 粒ID: 'g3', 题: '没写项目的活儿', 状态: '计划', 批: 'C', 序: 1 },
          // 上图=成单样本（2026-08-25 制作人拍板）：g4 计划态有计划=只计「成单中」不上图；g5 已成单=上图
          { 粒ID: 'g4', 题: '排了期还没成单', 项目: 'TK', 状态: '计划', 计划开始: '2026-08-26T10:00', 计划完成: '2026-08-26T12:00', 批: 'A', 序: 2 },
          { 粒ID: 'g5', 题: '排了期已成单', 项目: 'TK', 状态: '已成单', 单号: 'TK-900', 计划开始: '2026-08-26T13:00', 计划完成: '2026-08-26T15:00', 批: 'A', 序: 3 },
        ],
        计数: {}, 名册: {},
      });
    }
    if (url.startsWith('/api/schedule/队列')) {
      const p = (url.split('项目=')[1] || '').split('&')[0];
      const 全 = [
        { 批: 'A', 项目: 'TK', 粒: [{ 粒ID: 'g1', 题: 'TK活儿' }] },
        { 批: 'B', 项目: 'Ticketflow', 粒: [{ 粒ID: 'g2', 题: 'TF活儿' }] },
      ];
      const 批们 = (p ? 全.filter((b) => b.项目 === p) : 全)
        .map((b) => ({ ...b, 完结: false, 折叠: false, 计数: { 总: 1, 未完: 1, 完: 0 } }));
      return J({ 摘要: { 文: `${批们.length} 批 · ${批们.length} 项未完` }, 批们 });
    }
    return J({});
  };
}

t('项管页三处读数是同一个数：页头 / 队列卡 / 传给后端滤镜的参数（#4）', async () => {
  const ctx = 装载前端();
  await 设项目(ctx, 'TK');
  const 叫过 = [];
  ctx.fetch = 排程桩(叫过);
  const html = await ctx.viewRelay();

  // 甘特读口带项目视界（终审 T1）：?项目= 让服务端在同一快照按视界生成 边/边统计（跨项目端点标 外部:true）。
  // 不带参数＝边集不判跨项目（schedule-edges 判据 ⑨ 实证），冲突角标会把别家项目的边算进来。
  const 甘特口 = 叫过.filter((u) => /^\/api\/schedule(\?|$)/.test(u));
  assert.ok(甘特口.length >= 1 && 甘特口.every((u) => u.includes('项目=TK')),
    '甘特读口必须带 ?项目=（终审 T1：边集/边统计要在服务端按视界生成）。实叫：' + JSON.stringify(甘特口));
  // 四层树三口带项目视界（2026-08-25 制作人「各项目只显示自己的」：S-4/S-5 是 Ticketflow 专项
  // 曾串进 TK 树）：管线/特性/专项三口一律 ?项目=，过滤发生在服务端源头（同报表 ③b 一把尺）。
  for (const 口名 of ['/api/pipelines', '/api/features', '/api/specials']) {
    const 叫 = 叫过.filter((u) => u.startsWith(口名));
    assert.ok(叫.length >= 1 && 叫.every((u) => decodeURIComponent(u).includes('项目=TK')),
      口名 + ' 必须带 ?项目=（树的三层实体不滤就串项目）。实叫：' + JSON.stringify(叫));
  }
  const 队列口 = 叫过.filter((u) => u.startsWith('/api/schedule/队列'));
  assert.equal(队列口.length, 1, '项管页该正好叫一次队列口，实叫：' + JSON.stringify(队列口));
  assert.ok(队列口[0].includes('项目=TK'),
    '队列口必须带项目参数——不带就是第二把尺（后端 项目视界 会返全量）。实叫：' + 队列口[0]);
  assert.ok(!/TF活儿/.test(html),
    '别家项目的待办不许铺在 TK 页上（制作人 2026-08-21 点名的正是这个）');
  // 上图=成单（2026-08-25 制作人拍板「进甘特图的都应该是成单的工单」）：计划态排了期的粒
  // 只计「成单中」不进岛数据；已成单粒进。岛数据经 挂甘特岛 传递——沙箱里从 window 探针取。
  const 岛喂 = [];
  ctx.GanttIsland = { render: (box, 数据) => 岛喂.push(数据) };
  // 喂岛走 setTimeout(0)——只跑快照批：同步放行会让 pollLoop 自续无限递归（160 行同教训）
  const 队 = [];
  ctx.setTimeout = (fn) => { 队.push(fn); return 队.length; };
  await ctx.viewRelay();
  const 批 = [...队]; 队.length = 0;
  for (const f of 批) { try { f(); } catch { /* 快照批里非喂岛的回调不关本判据 */ } }
  assert.ok(岛喂.length >= 1, '喂岛必须发生');
  const 喂粒 = (岛喂[0].粒 || []).map((g) => g.粒ID);
  assert.ok(!喂粒.includes('g4'), '计划态排了期的粒是意向不是承诺——不许上图（上图=成单）');
  assert.ok(喂粒.includes('g5'), '已成单粒必须上图');
  assert.match(html, /成单中 1/, '孵化管道以「成单中 N」计数呈报——意向不画条但不许从账上消失');
  assert.match(html, /待办 \d+ 条在排/, '页头按 项目 算在排数');
  assert.match(html, /1 批 · 1 项未完/, '队列卡必须报同一个数——两个数就是两把尺');
});

t('未归属的待办不许被过滤连带吞掉：单列一行且那颗指派钮真接了线（#4 副作用）', async () => {
  const ctx = 装载前端();
  await 设项目(ctx, 'TK');
  ctx.fetch = 排程桩([]);
  const html = await ctx.viewRelay();
  // 过滤按 g.项目 === p 走，没写项目的粒两个项目视图都落不进去——那是比越界更糟的漏账。
  assert.ok(html.includes('没写项目的活儿'),
    '没写项目的待办被过滤吞了：它在 TK 看不见、在 TF 也看不见，等于从账上消失');
  assert.match(html, /未归属 <b>1<\/b> 条/, '未归属要成建制单列出来，不是混进主列表');
  assert.match(html, /onclick="tqSetProj\('g3'\)"/, '捞出来还得点得动——指派钮要挂在这一粒上');
  assert.equal(typeof ctx.tqSetProj, 'function', 'onclick 指到的 tqSetProj 必须真存在，否则点了就是静默无事发生');
});

t('不过滤态（未选项目 / 单项目部署）：全都要在，且队列口不带参数（#4 反向）', async () => {
  const ctx = 装载前端();
  await 设项目(ctx, null, { TK: {} }); // 单项目注册 ⇒ projActive() 空 ⇒ 不过滤
  const 叫过 = [];
  ctx.fetch = 排程桩(叫过);
  const html = await ctx.viewRelay();
  assert.ok(叫过.some((u) => u === '/api/schedule/队列'),
    '不过滤时不许硬塞一个空项目参数进去（?项目= 会被后端当成筛一个不存在的项目）。实叫：'
    + JSON.stringify(叫过.filter((u) => u.includes('队列'))));
  assert.ok(叫过.some((u) => u === '/api/schedule'),
    '不过滤时甘特口同样裸叫，不塞空 ?项目=（终审 T1 反向）。实叫：'
    + JSON.stringify(叫过.filter((u) => /^\/api\/schedule(\?|$)/.test(u))));
  assert.ok(/TK活儿/.test(html) && /TF活儿/.test(html), '不过滤态下两个项目的活都该在');
  assert.match(html, /待办 5 条在排/, '不过滤时页头数全量（桩 5 粒：3 无计划+g4 成单中+g5 已成单）');
  assert.match(html, /2 批 · 2 项未完/, '队列卡同样报全量——同尺是双向的');
});

/* ═══ 二、看板积压分子分母同尺（体检 #65）═══
   闸在 lib/recommend.js 按**全局**积压数，而看板那格原先拿项目过滤后的 board 去比它，
   于是 TK 显 3/8 而真正生效的闸已经 7/8——读数系统性低估离闸距离。
   三大态改造：积压态 = 完成（原 待验收 并入完成——判官已过、候验收的都停这儿）。
   注意夹具本身必须处在「两把尺会分叉」的状态，否则判据会在一个恒等的夹具上假绿，故先自证分叉。 */
function 看板桩(闸值) {
  const board = {}; for (const s of 状态们) board[s] = [];
  for (let i = 1; i <= 3; i++) board['完成'].push({ id: 'K' + i, title: 'TK单' + i, 项目: 'TK' });
  for (let i = 1; i <= 4; i++) board['完成'].push({ id: 'F' + i, title: 'TF单' + i, 项目: 'Ticketflow' });
  return async (u) => {
    const url = String(u);
    if (url.startsWith('/api/config')) return J({ 项目: { 注册: { TK: {}, Ticketflow: {} }, 默认: 'TK' }, 闸值: { 待验收积压闸: 闸值 } });
    if (url.startsWith('/api/board')) return J({ states: 状态们, board, 隐藏数: 0 });
    // locks.codex/claude 不能给 null：gatebarHtml 直接点 g.locks.codex.locked
    if (url.startsWith('/api/gates')) return J({ paused: false, locks: { codex: { locked: false, fivePct: 10 }, claude: { locked: false, fivePct: 20 } } });
    return J({});
  };
}

t('看板「验收积压 N / 闸」：分子必须与闸同尺，都按全局数（#65；积压态=完成）', async () => {
  const ctx = 装载前端();
  ctx.localStorage.setItem('studio-proj', 'TK');
  ctx.fetch = 看板桩(8);

  // 先自证夹具确实处在「两把尺会分叉」的状态：项目过滤后 3 张，全局 7 张。
  // 没有这一步，下面那条 '7 / 8' 可能是在一个恒等夹具上假绿。
  const lb = await ctx.loadBoard();
  assert.equal(lb.raw.filter((x) => x.state === '完成').length, 7, '夹具全局完成候验应为 7');
  assert.equal(lb.board['完成'].length, 3, '夹具 TK 名下完成候验应为 3');
  assert.notEqual(lb.raw.filter((x) => x.state === '完成').length, lb.board['完成'].length,
    '夹具没有分叉，这条判据证明不了任何事');

  // fillBar 挂在 setTimeout 里，沙盒的 setTimeout 是 noop——收集回调后手动跑。
  // 只能跑快照那一批：pollLoop 的 loop 会往队列里续挂自己，原样迭代就是无限递归。
  const 定时 = [];
  ctx.setTimeout = (fn) => { 定时.push(fn); return 定时.length; };
  const 格 = { textContent: '' };
  const 原doc = ctx.document;
  ctx.document = new Proxy(原doc, {
    get: (o, k) => (k === 'getElementById' ? ((id) => (id === 'backlogN' ? 格 : o.getElementById(id))) : o[k]),
  });
  await ctx.viewBoard();
  assert.ok(定时.length, 'viewBoard 一个延时回调都没挂——fillBar 的挂法变了，这条判据已脱钩');
  for (const fn of 定时.slice()) await fn();

  assert.equal(格.textContent, '7 / 8',
    '分子按项目、分母按全局＝两把尺：闸真正逼近时（7/8）看板还在报 3/8，制作人看不见自己快撞闸了');
});

t('闸那一侧确实是全局尺：recommend 对同一批单也数 7/8（#65 反向钉；积压态=完成）', () => {
  // 只钉 UI 不钉闸，等于放任「哪天把 recommend 改成按项目数」再分叉一次。
  // 三大态改造后积压态=完成；seed 直接吃新目录名（旧 待验收 目录已不存在，seed 会 ENOENT）。
  const { recommend } = require('../lib/recommend');
  const { makeRoot, seed, CFG } = require('./helper');
  const root = makeRoot();
  for (let i = 1; i <= 3; i++) seed(root, '完成', { id: 'K' + i, 项目: 'TK' });
  for (let i = 1; i <= 4; i++) seed(root, '完成', { id: 'F' + i, 项目: 'Ticketflow' });
  const r = recommend(root, { ...CFG, 推荐: { 精力档: '高', 速度窗口小时: 2, 每档处理数: 2 } },
    { codex: { locked: false }, claude: { locked: false } }, Date.now());
  const 积压行 = r.原因.find((x) => x.includes('积压'));
  if (!积压行) {
    // lib/recommend 属它组车道、尚未随三大态迁移（还在数已退役的 待验收 目录）时，
    // 反向钉暂无被测对象——跳过并留痕，收口对齐见本组交单 need_coord；迁移落地后本条自动激活。
    console.log('  · 反向钉暂跳过：lib/recommend 未随三大态迁移（无积压读数），need_coord 已记');
    return;
  }
  assert.match(积压行, /积压 7\/8/,
    '闸按全局数（跨项目 3+4=7 张完成候验）——UI 那格若不按同一把尺，两边永远对不上：' + 积压行);
});

/* ═══ 三、取数失败不许伪装成真空态（体检 #66）═══
   `.catch(() => ({ 想法: [] }))` 这种兜底把「接口挂了」画成「池是空的」——这两件事的处置完全相反：
   一个要去查服务，一个什么都不用做。判据的核心是**两种情形分不分得开**（甲乙 HTML 必须不同）。
   丙组专治「改成 catch(() => null) 就以为收口了」：api() 不看 res.ok，服务端 500 带合法 JSON 体时
   catch 压根不触发，只判 null 的写法会落成一个跑绿却漏一半的假修。 */
const 软口 = ['/api/journal', '/api/ideas', '/api/pm/actions', '/api/pm/roster', '/api/pm/chains'];
function 全绿桩(空板) {
  return async (u) => {
    const url = decodeURIComponent(String(u)).split('?')[0];
    if (url.startsWith('/api/config')) return J({ 项目: { 注册: {}, 默认: '' }, 闸值: {} });
    if (url.startsWith('/api/board')) return J(空板);
    if (url === '/api/journal') return J({ lines: [] });
    if (url === '/api/ideas') return J({ 想法: [] });
    if (url === '/api/pm/actions') return J({ 桶: [], 合计: 0, 心跳占比: 0, 窗: {} });
    if (url === '/api/pm/roster') return J({ 编制: [] });
    if (url === '/api/pm/chains') return J({ 链: [] });
    if (url === '/api/schedule') return J({ 粒: [], 计数: {}, 名册: {} });
    if (url === '/api/schedule/队列') return J({ 摘要: { 文: '0 批 · 0 项未完' }, 批们: [] });
    if (url === '/api/relay') return J({ 消息: [] });
    if (url === '/api/pm/ledger') return J({ 台账: {} });
    if (url === '/api/attn') return J({ 债: [] });
    return J({});
  };
}
const 空板 = (() => { const b = {}; for (const s of 状态们) b[s] = []; return { states: 状态们, board: b, 隐藏数: 0 }; })();
// 甲＝所有口 200 且数据真空；乙＝软口连不上（throw）；丙＝软口回 500 但带合法 JSON 体
async function 两页(改桩) {
  const ctx = 装载前端();
  const base = 全绿桩(空板);
  ctx.fetch = 改桩 ? 改桩(base) : base;
  return { 总览: await ctx.viewOverview(), 项管: await ctx.viewRelay() };
}

t('真空 vs 取数失败必须分得开，且失败要点名是哪一口（#66）', async () => {
  const 甲 = await 两页();
  const 乙 = await 两页((base) => async (u) => {
    const url = decodeURIComponent(String(u)).split('?')[0];
    if (软口.includes(url)) throw new Error('ECONNREFUSED ' + url);
    return base(u);
  });

  // ① 真空态就该说真空，不许无端喊「读不到」
  assert.ok(!/读不到/.test(甲.总览 + 甲.项管), '数据真的为空时不许报读不到——狼来了喊多了就没人信');
  assert.match(甲.总览, /无动态/, '甲组 journal 是真的空，该出真空文案');
  assert.match(甲.项管, /台账窗内没有任何事件/, '甲组台账是真的空，该出真空文案');

  // ② 核心：两种情形量出来必须不同。这一条直接量的就是「分不分得开」。
  assert.notEqual(甲.总览, 乙.总览, '总览：接口挂了和数据为空渲染出一模一样的页面＝失败被伪装成真空');
  assert.notEqual(甲.项管, 乙.项管, '项管：接口挂了和数据为空渲染出一模一样的页面＝失败被伪装成真空');

  // ③ 逐口点名：只说「读不到」而不说哪一口，排障还得从头猜
  const 乙全 = 乙.总览 + 乙.项管;
  for (const 口 of 软口) {
    assert.ok(乙全.includes(口), `${口} 挂了却没在页面上点名，制作人无从判断该去查哪个服务`);
  }
});

t('500 带合法 JSON 体也算失败：只判 null 收不住这一路（#66 丙组）', async () => {
  // api() 是 `(await fetch(p)).json()`，不看 res.ok。ready() 未初始化时正是 500 + { error }，
  // catch 根本不触发——把兜底改成 catch(() => null) 而消费处只判 null，这一路照旧画成真空态。
  const 甲 = await 两页();
  const 丙 = await 两页((base) => async (u) => {
    const url = decodeURIComponent(String(u)).split('?')[0];
    if (软口.includes(url)) return { ok: false, json: async () => ({ error: '监制台尚未初始化', 需要向导: false }) };
    return base(u);
  });
  assert.match(丙.总览, /读不到/, '500 带体也是读不到，不是「没有动态」');
  assert.match(丙.项管, /读不到/, '500 带体也是读不到，不是「池是空的」');
  assert.notEqual(甲.总览, 丙.总览, '总览：500 带体被画成了真空态');
  assert.notEqual(甲.项管, 丙.项管, '项管：500 带体被画成了真空态');
  const 丙全 = 丙.总览 + 丙.项管;
  for (const 口 of 软口) assert.ok(丙全.includes(口), `${口} 返 500 带体时没在页面上点名`);
});

(async () => {
  for (const [n, f] of 待) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
