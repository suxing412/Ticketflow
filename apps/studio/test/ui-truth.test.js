// ui-truth.test.js — 界面说的话必须是真的（2026-08-21 体检「界面真实性」维度）
// 四条同族，共同点是：**页面上的话没人核对过**。
//   ① 甘特脚注说「服务端不下发工期判定」——服务端从 08-20 起就在下发，这句话把 3 条真延期藏了一天
//   ② 启动页两张卡都写「安好」——同一时刻 /api/attn 报 5 笔债、3 笔逾期（含一笔停 47.9h）
//   ③ 报表页头写「监制台 · Ticketflow」，顶栏 8 个读数却是全工作室的
//   ④ 看板指路「去报表查（可搜可筛可按耗时排序）」——那三样报表页一样都没有
//
// 2026-08-22 复核换面：原先 ①②③b④ 全是 assert.match(app源码, /某串字/)。那种断言证明的只有
// 「某几个字还在」——把病原样种回去（改个类名、把判定读成 null、把截断脚注删掉）它照绿，
// 而改个变量名它又假红。本轮复核靠「种病重跑」判掉了 22 条这样的判据，本文件是其中之一。
// 现在一律真装 public/app.js（test/frontend-sandbox.js）、真调渲染函数、断言它吐出来的 HTML；
// 涉及样式的那半还要跟 public/style.css 对账——空 class 等于「画了个看不见的红条」。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const report = require('../lib/report');
const { makeRoot, seed } = require('./helper');
const { 装载前端 } = require('./frontend-sandbox');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('界面真实性测试');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

// 接口桩：按路径分发，未列到的给空对象。记下每次请求的完整 URL——
// 「切在服务端源头」这件事，只有看请求里到底带没带 ?项目= 才验得出。
function 桩(ctx, 供, 记 = []) {
  ctx._showHidden = false; // window 代理对未定义键返回 noop＝真值
  ctx.fetch = async (u) => {
    const s = String(u); 记.push(s);
    const k = s.split('?')[0];
    const v = 供[k];
    const j = typeof v === 'function' ? v(s) : (v === undefined ? {} : v);
    return { ok: true, json: async () => j };
  };
  return 记;
}
const 总览壳 = (h) => ({ 总单数: 1, 完成: 1, 已归档: 0, 实际h合计: h, 预估偏差pct: null, 自修总轮: 0,
  代核通过: 0, 代核不过: 0, 代裁给方向: 0, 代裁上呈: 0, token估计合计: 0 });

(async () => {

await t('① 甘特真按服务端判定画出红条与徽标，且每个记号在样式表里都有主', () => {
  const ctx = 装载前端();
  const 粒 = [
    { 粒ID: 'a', 题: '延期件', 状态: '未开工', 计划开始: '2026-08-25', 计划完成: '2026-08-25',
      基线开始: '2026-08-22', 基线完成: '2026-08-22',
      判定: { 已排期: true, 延期: true, 延期天: 3, 余量天: 3, 超期: false, 超期天: 0, 需重排: false } },
    { 粒ID: 'b', 题: '超期件', 状态: '在途', 计划开始: '2026-08-10', 计划完成: '2026-08-12',
      基线开始: '2026-08-10', 基线完成: '2026-08-12',
      判定: { 已排期: true, 延期: false, 超期: true, 超期天: 5, 需重排: true } },
  ];
  const html = ctx.甘特Html(粒, Date.parse('2026-08-22'), []);
  // 只看条子那一段：图例里「延 Nd」「该重排」是解释文字，本来就该常驻，拿全文断言会被图例假绿。
  const 条区 = (h) => h.slice(h.indexOf('gtbody'), h.indexOf('fglegend'));
  const 类们 = (h) => { const s = new Set();
    for (const m of h.matchAll(/class="([^"]*)"/g)) for (const c of m[1].trim().split(/\s+/)) if (c) s.add(c);
    return s; };
  // 类名按 token 取、不按子串取：'gt-lateX' 里含着 'gt-late'，用 includes 判会被改名蒙混过去。
  const 条 = 条区(html); const 有类 = 类们(条);
  assert.ok(有类.has('gt-late'), '延期行要挂延期记号，实得：' + [...有类].join(' '));
  assert.ok(有类.has('gt-od'), '超期行要挂超期记号，实得：' + [...有类].join(' '));
  // `>X<` 而不是 `X`：徽标是**看得见的元素文字**。只写进 title= 悬浮不算数——
  // 那要把鼠标停上去才知道，跟「藏起来」只差一个动作。
  assert.match(条, />延 3d</, '延期天数要写在徽标上——「延期了」而不说几天，等于没说');
  assert.match(条, />该重排</, '需重排要出徽标（写在悬浮里不算：得停鼠标才看得见）');
  assert.ok(/已超期 5 天/.test(条), '超期天数要进悬浮');
  // 那句失实的脚注：验渲染结果，不验源码里那几个字
  assert.ok(!/暂缺|待服务端下发|不下发/.test(html), '「红条与徽标暂缺 / 判定待下发」这类话必须从画面上消失');
  // 类名与样式表对账：光挂 class 不给规则，就是「画了个看不见的红条」（3 条真延期在条子上一点色都没有）。
  // 选择器同样按边界匹配：'.gt-lateNOPE' 不算 '.gt-late' 的主。
  const 有主 = (c) => new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').test(css);
  for (const c of [...有类].filter((c) => /^gt(-|flag)/.test(c))) {
    assert.ok(有主(c), `${c} 在样式表里没有主——空 class 画不出任何东西`);
  }
  assert.ok(/\.gtflag\.late(?![\w-])/.test(css), '「延 Nd」徽标的延期变体也要有样式');
  // 反证：不下发判定就什么都不画，证明上面几条不是无条件成立
  const 素 = 条区(ctx.甘特Html(粒.map(({ 判定, ...g }) => g), Date.parse('2026-08-22'), []));
  const 素类 = 类们(素);
  assert.ok(!素类.has('gt-late') && !素类.has('gt-od') && !/该重排|延 \d+d/.test(素),
    '服务端不下发判定时前端不许自己造——两把尺是这本账最贵的病');
});

await t('② 启动页债数吃 /api/attn，逾期出数，取不到就说「读数中」', async () => {
  const 项目 = { 项目: { 注册: { TK: { 单号前缀: 'TK' }, Ticketflow: { 单号前缀: 'TF' } }, 默认: 'TK' } };
  const 板 = { states: ['待派', '完成', '待处理'],
    board: { 待派: [{ id: 'TF-1', 项目: 'Ticketflow' }, { id: 'TK-182', 项目: 'TK' }],
      完成: [{ id: 'TK-9', 项目: 'TK' }], 待处理: [{ id: 'TK-10', 项目: 'TK' }] }, 隐藏数: 0 };
  const 跑 = async (attn) => {
    const ctx = 装载前端();
    桩(ctx, { '/api/config': 项目, '/api/board': 板, '/api/attn': attn, '/api/journal': { lines: [] },
      '/api/runner': {}, '/api/gates': { paused: false, locks: { codex: {}, claude: {} } } });
    if (attn === null) { const f = ctx.fetch; ctx.fetch = async (u) => (String(u).startsWith('/api/attn') ? Promise.reject(new Error('挂')) : f(u)); }
    await ctx.loadCfg(true);
    return ctx.viewHub();
  };

  // (a) 有债：数吃 attn，不吃工单状态
  const h = await 跑({ 逾期阈值小时: 24, 债: [{ id: 'TF-1', 停摆小时: 9.9 }, { id: 'TK-182', 停摆小时: 47.9 }] });
  assert.match(h, /需处理 1 · 逾期 1/, 'TK 有一笔债且停 47.9h > 阈值 24h——逾期要出数');
  assert.ok(!/安好/.test(h), '同一时刻 attn 明明报着债，卡上不许写「安好」（本条的原病）');
  assert.ok(!/需处理 2/.test(h), 'TK 板上有 完成+待处理 各一张，若回到旧轴这里会变 2——旧轴不许复活');
  assert.match(h.replace(/\s+/g, ''), /"">1<\/i>待派/, 'G1 项管闸放行债的落点就是「待派」这一栏，卡上必须有这个数');

  // (b) 无债：安好这条路还在（证明上面不是把「安好」整块删了了事）
  const h0 = await 跑({ 逾期阈值小时: 24, 债: [] });
  assert.match(h0, /安好/, '真没债时该说安好');
  assert.ok(!/需处理/.test(h0), '没债不许报需处理');

  // (c) attn 取不到：退化成「读数中」，不许拿旧轴顶上冒充安好
  const hx = await 跑(null);
  assert.match(hx, /债读数中/, 'attn 挂了就如实说读不到');
  assert.ok(!/安好|需处理/.test(hx), '读不到债的时候，「安好」和「需处理 N」都是编的');
});

t('③ 报表按项目切在服务端源头，各读数同源且账能加平', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'AA-1', 项目: '甲', 领单时间: '2026-08-01T00:00:00Z', 交付时间: '2026-08-01T01:00:00Z' });
  seed(root, '完成', { id: 'BB-1', 项目: '乙', 领单时间: '2026-08-01T00:00:00Z', 交付时间: '2026-08-01T02:00:00Z' });
  const 全 = report.aggregate(root);
  const 甲 = report.aggregate(root, { 项目: '甲', 默认项目: '甲' });
  const 乙 = report.aggregate(root, { 项目: '乙', 默认项目: '甲' });
  assert.equal(全.总览.完成, 2, '不传项目＝全量');
  assert.equal(甲.总览.完成 + 乙.总览.完成, 全.总览.完成, '切开之后账要加得平');
  assert.equal(甲.项目, '甲', '结果自带项目标注——不标就会被当成全工作室');
  assert.equal(甲.明细.length, 1, '明细也跟着切');
  // 自伤复现：首版用 rows.length=0 原地清空，不传项目时把源数组一起清了，全局读数当场归零
  assert.ok(全.总览.完成 > 0, '全量那一路不许被切分逻辑误伤');
});

await t('③b 报表页真把项目带给服务端，顶栏读数是本项目的；全局读数自带「全工作室」标注', async () => {
  const ctx = 装载前端();
  const 记 = 桩(ctx, {
    '/api/config': { 项目: { 注册: { TK: {}, Ticketflow: {} }, 默认: 'TK' }, 执行器: { 派发制: true } },
    // 服务端按 ?项目= 真给两份不同的数：TK 全量 103h，Ticketflow 3h。前端读到哪一份，一望便知。
    '/api/report': (u) => { const 本 = /项目=Ticketflow/.test(decodeURIComponent(u));
      return { 项目: 本 ? 'Ticketflow' : '', 总览: 总览壳(本 ? 3 : 103), 按职能: [], 按主办: [], 按池: [],
        按项目: [], 每日: [], 明细: [], 明细满: false }; },
    '/api/pm/ledger': { 台账: { 管理费: { token合计: 1385033, 次数: 12 }, 并发上限: {}, 父单成本: {} }, 事件: [] },
    '/api/scores': null,
    '/api/board': { states: [], board: {}, 隐藏数: 0 },
  });
  ctx.localStorage.setItem('studio-proj', 'Ticketflow');
  await ctx.loadCfg(true);
  const html = await ctx.viewReport();
  assert.ok(记.some((u) => u.startsWith('/api/report') && /项目=Ticketflow/.test(decodeURIComponent(u))),
    '切分要发生在服务端源头：请求里必须真带 ?项目=（前端自己滤一遍就是第二把尺）：' + 记.join(' '));
  assert.match(html, /<span class="lbl">实际工时<\/span><span class="num[^"]*">3h<\/span>/,
    '顶栏必须是本项目的数');
  assert.ok(!/103h/.test(html), '全工作室的数不许出现在项目语境的顶栏里');
  assert.match(html, /项目 Ticketflow/, '明细卡要标出这是哪个项目的账');
  // 项管台账确实是全工作室口径（服务端没按项目切）——那就必须在读数上写明，不许混进本项目语境
  assert.ok(!/管理费\(项管\)</.test(html), '全局读数必须自带「全工作室」标注，否则它会被当成本项目的管理费');
  assert.match(html, /管理费\(项管·全工作室\)/, '标注要真写在顶栏那一格上');
  assert.match(html, /项目管理台账 · 全工作室/, '台账卡标题同样要标');
  assert.match(html, /项目管理（全工作室）/, '「按职能」表里的项管行也要标');
});

await t('④ 截断如实说出来；看板指路句不许承诺报表页没有的能力', async () => {
  const 配 = { 项目: { 注册: { TK: {} }, 默认: 'TK' }, 执行器: { 派发制: false }, 闸值: {} };
  const 造 = (n, 满) => Array.from({ length: n }, (_, i) => ({ id: 'TK-' + i, state: '完成', 项目: 'TK',
    职能: '策划', 实际h: 1, 预计h: null, 自修次数: 0, 交付日: '2026-08-01', 阶段: null, 实际消耗: null }));
  const 报表 = async (n, 满) => {
    const ctx = 装载前端();
    桩(ctx, { '/api/config': 配, '/api/scores': null, '/api/pm/ledger': null,
      '/api/report': { 项目: '', 总览: 总览壳(9), 按职能: [], 按主办: [], 按池: [], 按项目: [], 每日: [],
        明细: 造(n), 明细满: 满 } });
    await ctx.loadCfg(true);
    return ctx.viewReport();
  };
  const 脚 = (h) => { const m = h.match(/<p class="subnote" style="margin-top:10px">([\s\S]*?)<\/p>/);
    assert.ok(m, '明细表底下那行脚注不见了'); return m[1]; };

  const 满页 = await 报表(94, true);
  const s1 = 脚(满页);
  assert.match(s1, /明细共 94 条/, '总数要报出来');
  assert.match(s1, /只画最近 40 条/, '截断要打印在页面上——静默截断读起来跟「一共就这些」一模一样');
  assert.match(s1, /服务端上限 100 条/, '被服务端 100 条上限截过也要说');
  assert.match(s1, /本表 40 行/, '真画了几行也要报');

  const 短页 = await 报表(10, false);
  const s2 = 脚(短页);
  assert.ok(!/只画最近/.test(s2), '没截断不许瞎报截断（狼来了）');
  assert.ok(!/服务端上限/.test(s2), '没被上限截过不许瞎报');
  assert.match(s2, /本表 10 行/, '行数要跟着真数走');

  // 指路句：以报表页**真有的能力**为准绳，逐词核对看板那句话（挡住「换个措辞继续吹」）
  const ctxB = 装载前端();
  桩(ctxB, { '/api/config': 配, '/api/board': { states: ['待派', '在途'], board: { 待派: [], 在途: [] }, 隐藏数: 0 } });
  await ctxB.loadCfg(true);
  const 板 = await ctxB.viewBoard();
  const i = 板.indexOf('bdone');
  assert.ok(i > 0, '看板底部那段指路文字不见了');
  const 指路 = 板.slice(i);
  const 能力 = [['搜', /<input/.test(满页)], ['筛', /rpFilter|<select/.test(满页)],
    ['排序', /<th[^>]*onclick/.test(满页)]];
  for (const [词, 有] of 能力) {
    if (!有) assert.ok(!new RegExp(词).test(指路), `报表页没有「${词}」这个能力，看板指路句里就不许出现这个字：` + 指路.slice(0, 200));
  }
  assert.ok(能力.some(([, 有]) => !有), '三样能力若全都有了，本条判据就失去意义——那时该改的是这条判据本身');
  assert.match(指路, /报表/, '指路本身要留着：看板不留完成列，做完的单总得告诉人去哪找');
});

/* ═══ ⑤/⑥ 三大态改造（H108，2026-08-24）的前端行为判据 ═══
   真装 app.js、真跑 viewBoard()/viewDetail()、断言真吐出来的 HTML——不 grep 源码文本。 */

await t('⑤ 看板三大组：12 态分 待办｜在途｜结束 三段，完成/归档不进列，结束段只计数', async () => {
  const store = require('../lib/core/store');
  const 造板 = (带大态) => {
    const board = {}; for (const s of store.STATES) board[s] = [];
    board['待审'].push({ id: 'TK-1', title: '甲', 职能: '策划' });
    board['在途'].push({ id: 'TK-2', title: '乙', 职能: '程序' });
    board['完成'].push({ id: 'TK-3', title: '丙', 职能: '程序' });
    board['归档'].push({ id: 'TK-4', title: '丁', 职能: '程序' });
    board['挂起'].push({ id: 'TK-5', title: '戊', 职能: '程序' });
    board['废弃'].push({ id: 'TK-6', title: '己', 职能: '程序' });
    return { states: store.STATES, board, 隐藏数: 0, ...(带大态 ? { 大态: 带大态 } : {}) };
  };
  const 跑板 = async (板) => {
    const ctx = 装载前端();
    桩(ctx, { '/api/config': { 项目: { 注册: { TK: {} }, 默认: 'TK' }, 闸值: {} }, '/api/board': 板,
      '/api/gates': { paused: false, locks: { codex: {}, claude: {} } } });
    await ctx.loadCfg(true);
    return ctx.viewBoard();
  };
  const h = await 跑板(造板(store.大态));
  // 三段都在且按 待办→在途→结束 排（用 data-bg 锁，不按字面搜——页面别处也有这些词）
  const at = (g) => h.indexOf(`data-bg="${g}"`);
  assert.ok(at('待办') >= 0 && at('在途') > at('待办') && at('结束') > at('在途'),
    `三段结构缺或乱序：待办@${at('待办')} 在途@${at('在途')} 结束@${at('结束')}`);
  // 段内细分列：列头 <h4> 逐态点名，且列落在自己的段里
  const 段区 = (g) => { const 起 = at(g); const 序 = ['待办', '在途', '结束'];
    const 后 = 序[序.indexOf(g) + 1]; return h.slice(起, 后 ? at(后) : h.length); };
  for (const s of store.大态.待办) assert.ok(段区('待办').includes(`<h4>${s}`), `待办段缺「${s}」列`);
  for (const s of store.大态.在途.filter((x) => x !== '完成')) assert.ok(段区('在途').includes(`<h4>${s}`), `在途段缺「${s}」列`);
  // 完成/归档 照旧不进看板列（落袋离场纪律）；结束段一张卡都不铺
  assert.ok(!h.includes('<h4>完成') && !h.includes('<h4>归档'), '完成/归档 不许成列');
  for (const id of ['TK-3', 'TK-4', 'TK-5', 'TK-6'])
    assert.ok(!h.includes(`data-tid="${id}"`), `${id} 是完成/结束段的单，不许铺成卡`);
  assert.ok(h.includes('data-tid="TK-1"') && h.includes('data-tid="TK-2"'), '活态卡照常铺');
  // 结束段计数入口：逐态报数（完成 也在这儿计数——它被摘出列，总得有处看见）
  for (const [k, n] of [['完成', 1], ['归档', 1], ['挂起', 1], ['废弃', 1]])
    assert.match(段区('结束'), new RegExp(`<span class="bek">${k}</span><b class="mono">${n}</b>`),
      `结束段缺「${k}」计数`);
  // 服务端分组表优先：服务端把 核查 挪进待办，前端要照画（读的是下发表，不是前端私货）
  const h2 = await 跑板(造板({ 待办: ['待审', '待派', '待处理', '待重派', '核查'],
    在途: ['在途', '初检', '仲裁', '完成'], 结束: ['归档', '挂起', '废弃'] }));
  assert.ok(/data-bg="待办"[\s\S]*?<h4>核查[\s\S]*?data-bg="在途"/.test(h2),
    '服务端下发的分组表没被采信——前端自创分组就是两把尺');
  // 服务端不下发时回落兜底，且兜底必须与 store.大态 同表（防前端私抄一份走散）
  const h3 = await 跑板(造板(null));
  const 段区3 = (g) => { const 序 = ['待办', '在途', '结束']; const 起 = h3.indexOf(`data-bg="${g}"`);
    const 后 = 序[序.indexOf(g) + 1]; return h3.slice(起, 后 ? h3.indexOf(`data-bg="${后}"`) : h3.length); };
  assert.ok(h3.indexOf('data-bg="待办"') >= 0 && h3.indexOf('data-bg="结束"') > 0, '兜底也要有三段');
  for (const s of store.大态.待办) assert.ok(段区3('待办').includes(`<h4>${s}`), `兜底分组缺「${s}」列`);
  for (const s of store.大态.在途.filter((x) => x !== '完成')) assert.ok(段区3('在途').includes(`<h4>${s}`), `兜底在途段缺「${s}」列`);
});

await t('⑥ 详情页进度条：审检链新阶段序列（QA开→初检→核查→完成；QA关无初检；保留免检直达；仲裁只在争议时出）', async () => {
  const ctx = 装载前端();
  const 段名 = async (fmExtra, state) => {
    ctx.fetch = async (u) => {
      const url = decodeURIComponent(String(u)).split('?')[0];
      if (url === '/api/ticket') return { ok: true, json: async () => ({ id: 'TK-1', state: state || '在途',
        fm: { id: 'TK-1', title: '活', 职能: '程序', ...fmExtra }, 链: { 父子: { 父: null, 子: [] }, 依赖: [] }, body: '' }) };
      if (url === '/api/runner') return { ok: true, json: async () => ({ 执行中: [], 间隔秒: 15 }) };
      return { ok: true, json: async () => ({}) };
    };
    const h = await ctx.viewDetail('TK-1');
    return [...h.matchAll(/class="lv-seg [^"]*">[\s\S]*?<span>([^<]*)<\/span>/g)].map((m) => m[1]);
  };
  assert.deepEqual(await 段名({ QA: '开', 验收方式: '委托' }), ['领单', '执行', '初检', '核查', '完成'],
    'QA 开的委托单：执行完走 初检→核查→完成（H108 审检链目录化）');
  assert.deepEqual(await 段名({ QA: '关', 验收方式: '委托' }), ['领单', '执行', '核查', '完成'],
    'QA 关：核查（简检）→完成，不出初检段');
  assert.deepEqual(await 段名({ QA: '开', 验收方式: '保留' }), ['领单', '执行', '完成'],
    '免检保留单：执行完直接完成，不走审检链');
  const 争议 = await 段名({ QA: '开', 验收方式: '委托' }, '仲裁');
  assert.deepEqual(争议, ['领单', '执行', '初检', '核查', '仲裁', '完成'],
    '争议单：仲裁段插在 核查 与 完成 之间，只在争议时出');
  // 旧阶段词在进度条上退役——「质检」「落袋」「待验收」不许再当段名出现
  for (const names of [await 段名({ QA: '开', 验收方式: '委托' }), 争议])
    for (const 旧 of ['质检', '落袋', '待验收', '你验收'])
      assert.ok(!names.includes(旧), `旧阶段词「${旧}」还在进度条上：` + names.join('/'));
});

await t('⑦ 看板列排定宽：bgcols 内联宽度＝CSS 列宽之和（Electron 30/Chromium 124 嵌套 flex 内容宽误算的防复发）', async () => {
  // 案情（2026-08-24）：制作人窗口（Electron 30 壳，Chromium 124）里 auto basis 的 .bgroup
  // 被算成内容宽的六成（待办 457px/应 676px，与视口宽无关），兄弟组按塌陷宽度排位互相叠压；
  // 同一引擎里定长 basis 的结束段渲染正确。修法＝渲染时给 .bgcols 写内联定宽。
  // 本判据的期望值从 style.css 现场解析、列宽类从渲染输出现读——JS 求和坏、像素表与 CSS
  // 走散、CSS 改列宽 JS 没跟，任何一侧都红。
  const store = require('../lib/core/store');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  const 抽 = (re, 名) => { const m = css.match(re); assert.ok(m, 'style.css 里找不到 ' + 名 + '——列宽定义挪了窝，本判据要跟着搬'); return Number(m[1]); };
  const 基宽 = 抽(/\.bcol2 \{ flex:0 0 (\d+)px/, '.bcol2 基宽');
  const 宽168 = 抽(/\.bcol2\.w168 \{ flex-basis:(\d+)px/, '.w168');
  const 宽128 = 抽(/\.bcol2\.w128 \{ flex-basis:(\d+)px/, '.w128');
  const 缝 = 抽(/\.bgcols \{ display:flex; gap:(\d+)px/, '.bgcols gap');
  const board = {}; for (const s of store.STATES) board[s] = [];
  const ctx = 装载前端();
  桩(ctx, { '/api/config': { 项目: { 注册: { TK: {} }, 默认: 'TK' }, 闸值: {} },
    '/api/board': { states: store.STATES, board, 大态: store.大态, 隐藏数: 0 },
    '/api/gates': { paused: false, locks: { codex: {}, claude: {} } } });
  await ctx.loadCfg(true);
  const h = await ctx.viewBoard();
  for (const g of ['待办', '在途']) {
    const 起 = h.indexOf(`data-bg="${g}"`);
    const 序 = ['待办', '在途', '结束']; const 后 = 序[序.indexOf(g) + 1];
    const 段 = h.slice(起, h.indexOf(`data-bg="${后}"`));
    // 列宽类从输出现读：每列真挂的 class 决定它占几像素
    const 列类 = [...段.matchAll(/class="bcol2 ([^"]*)"/g)].map((m) => m[1]);
    assert.ok(列类.length > 0, g + ' 段一列都没有');
    const 应 = 列类.reduce((a, c) => a + (/\bw168\b/.test(c) ? 宽168 : /\bw128\b/.test(c) ? 宽128 : 基宽), 0)
      + (列类.length - 1) * 缝;
    assert.match(段, new RegExp(`class="bgcols" style="width:${应}px"`),
      g + ` 段的列排没有定宽 width:${应}px（${列类.length} 列）——旧引擎会把组算塌、兄弟组叠上来`);
  }
  // 结束段结构不同（bendbody 计数入口），定宽由 CSS 的 .bgroup.bend flex-basis 管，不吃内联宽
  assert.ok(!/data-bg="结束"[^>]*>[\s\S]{0,200}?bgcols/.test(h.slice(h.indexOf('data-bg="结束"'))),
    '结束段不该出现 bgcols 列排');
});

console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error(e); process.exit(1); });
