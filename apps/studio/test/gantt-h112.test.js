// gantt-h112.test.js — H112/H113 丙案「甘特重画」行为判据（2026-08-24）
//
// 五条验收判据（落实表·丙）：停表灰带渲染 / 越线灰标「待重判」/ 专项条时间正确 /
// 甬道等距非时间 / 节点菱形来自债数据。每条都带变异自证（反向断言：把触发条件拿掉必须不再出现），
// 且**没有一条 grep 源码**——一律 test/frontend-sandbox.js 装载真 public/app.js、真调 甘特Html()/viewRelay()，
// 断言它真吐出来的 HTML；样式面与 public/style.css 对账（空 class＝画了个看不见的记号）。
//
// 几何断言的口径：不复刻实现里的窗口公式，而用**窗口无关不变量**——两条条子的宽度比 =
// 两段时长比（同一窗口做分母，约掉）。这样断言钉的是「条宽∝真实时长」这条事实，
// 重构窗口余白算法不假红，把甬道画成时间轴或把刻钟当整天必真红。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { 装载前端, 设项目 } = require('./frontend-sandbox');

let passed = 0;
const 待 = [];
const t = (n, f) => 待.push([n, f]);
console.log('gantt-h112 丙案甘特重画测试');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const 有主 = (sel) => new RegExp('\\.' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])').test(css);

// ---- 共用夹具 ----
const 现在 = '2026-08-24T12:00';
const S1主 = { 粒ID: 'p-s1', 型: '专项', 单号: 'S-1', 上级: 'F-10', 题: '编辑器专项', 状态: '已成单',
  计划开始: '2026-08-20', 计划完成: '2026-08-22' };
const 子1 = { 粒ID: 'c1', 上级: 'S-1', 序: 1, 题: '甲件', 状态: '已成单', 单号: 'TK-9',
  计划开始: '2026-08-20', 计划完成: '2026-08-21' };
const 子2 = { 粒ID: 'c2', 上级: 'S-1', 序: 2, 题: '乙件', 状态: '计划',
  计划开始: '2026-08-26T09:00', 计划完成: '2026-08-26T10:30' };
const 子3 = { 粒ID: 'c3', 上级: 'S-1', 序: 3, 题: '丙件', 状态: '计划' }; // 无期也得在甬道里看得见
const 刻钟散 = { 粒ID: 'd1', 题: '刻钟活', 状态: '已成单', 计划开始: '2026-08-24T09:00', 计划完成: '2026-08-24T10:30' };
const 越 = { 粒ID: 'x1', 题: '越线活', 状态: '计划', 计划开始: '2026-08-23T09:00', 计划完成: '2026-08-25' };
const 未越 = { 粒ID: 'x2', 题: '未越活', 状态: '计划', 计划开始: '2026-08-30', 计划完成: '2026-08-31' };

// 从整页 HTML 里切出一行/一块（到下一个行级标记为止），保证断言只打在自己那一行上
const 块 = (html, key) => {
  const i = html.indexOf(key);
  assert.ok(i >= 0, `页面里找不到 ${key}`);
  const 起 = Math.max(0, html.lastIndexOf('<div', i)); // 行开头（class 在 data-gid 前面，得整行截）
  const 界 = ['<div class="gtrow', '<div class="gtlane', '<div class="gtfg', '<div class="gtun', 'fglegend']
    .map((m) => html.indexOf(m, 起 + 10)).filter((x) => x >= 0);
  return html.slice(起, 界.length ? Math.min(...界) : html.length);
};
const 条几何 = (行块) => {
  const m = /class="gtbar [^"]*" style="left:([\d.]+)%;width:([\d.]+)%"/.exec(行块);
  assert.ok(m, '这一行没画出计划条：' + 行块.slice(0, 160));
  return { left: +m[1], width: +m[2] };
};
const 今线左 = (html) => {
  const m = /class="gttoday" style="left:([\d.]+)%/.exec(html);
  return m ? +m[1] : null;
};

/* ═══ ① 停表灰带：gates.paused → 灰带「产线关闭中 · 停表」，且触发提示整条短路 ═══ */
t('① 关闸期渲染停表灰带，且越线「待重判」提示整条短路（产线关＝判据短路，零提示）', () => {
  const ctx = 装载前端();
  const 停 = ctx.甘特Html([越, 未越], '2026-08-24', [], { 停表: true, 现在 });
  assert.ok(/class="gtstop"/.test(停), '停表时必须出灰带（class="gtstop"）');
  assert.ok(/产线关闭中 · 停表/.test(停), '灰带上要写明「产线关闭中 · 停表」');
  assert.ok(!/class="gtflag rejudge"/.test(停), '关闸期触发判据整条短路：越线条不许再挂「待重判」灰标（图例说明文字不算）');
  // 变异自证：产线开 → 灰带消失、越线提示恢复——证明上面三条不是无条件成立
  const 开 = ctx.甘特Html([越, 未越], '2026-08-24', [], { 停表: false, 现在 });
  assert.ok(!/class="gtstop"/.test(开), '产线开着不许出停表灰带');
  assert.ok(/class="gtflag rejudge"[^>]*>待重判</.test(开), '产线开时越线条应恢复「待重判」灰标');
  assert.ok(有主('gtstop'), '.gtstop 在样式表里没有主——画了条看不见的灰带');
});

/* ═══ ② 越线灰标：计划开始≤今时 且 状态=计划 → 灰「待重判」不标红；红色留给服务端判定 ═══ */
t('② 越线未表态的条灰标「待重判」不标红；超期红标（服务端判定）只挂在非越线人群上', () => {
  const ctx = 装载前端();
  // x1 连服务端判定都说超期——但它是越线候重判的计划粒，H112 定：重判前灰显，不标红
  const x1 = { ...越, 判定: { 已排期: true, 超期: true, 超期天: 1, 需重排: true, 延期: false } };
  // y1 是已成单的超期件：不在越线二选一人群里，服务端判定的红标照旧
  const y1 = { 粒ID: 'y1', 题: '超期在途件', 状态: '已成单', 计划开始: '2026-08-20', 计划完成: '2026-08-21',
    判定: { 已排期: true, 超期: true, 超期天: 3, 需重排: true } };
  const html = ctx.甘特Html([x1, y1, 未越], '2026-08-24', [], { 现在 });
  const 越行 = 块(html, 'data-gid="x1"');
  assert.ok(/class="gtflag rejudge"[^>]*>待重判</.test(越行), '越线的计划粒要挂灰标「待重判」');
  assert.ok(/ xline/.test(越行), '越线行要挂 xline 灰显记号');
  assert.ok(!/ gt-od/.test(越行) && !/>该重排</.test(越行),
    '越线候重判的条**不标红**：gt-od/「该重排」红标必须让位给灰标（H112：重判前不算超期事故）');
  const 红行 = 块(html, 'data-gid="y1"');
  assert.ok(/ gt-od/.test(红行) && />该重排</.test(红行),
    '非越线人群（已成单超期件）的服务端红标必须原样保留——灰标不许把整张图的红都吞了');
  // 变异自证：没越线的计划粒一个灰标都不许有
  const 未越行 = 块(html, 'data-gid="x2"');
  assert.ok(!/class="gtflag rejudge"/.test(未越行) && !/ xline/.test(未越行), '计划开始还没到今时线的条不许标「待重判」');
  assert.ok(有主('gtflag') && /\.gtflag\.rejudge(?![\w-])/.test(css), '.gtflag.rejudge 灰标在样式表里没有主');
  assert.ok(/\.gtrow\.xline(?![\w-])/.test(css), '.gtrow.xline 在样式表里没有主');
});

/* ═══ ③ 专项条时间正确：主行真实时间条，宽度∝真实时长；刻钟计划按分钟落位；周档降天粒度 ═══ */
t('③ 专项主行走真实时间：72h 专项条宽 = 1.5h 刻钟条宽 × 48（分钟几何，窗口无关不变量）', () => {
  const ctx = 装载前端();
  const html = ctx.甘特Html([S1主, 刻钟散], '2026-08-24', [], { 现在 });
  const sp = 条几何(块(html, 'data-gid="p-s1"'));
  const d1 = 条几何(块(html, 'data-gid="d1"'));
  const 比 = sp.width / d1.width;
  // S-1 计划 08-20→08-22（纯日期含尾）= 72h；刻钟活 09:00→10:30 = 1.5h。宽度比必须 = 时长比 48。
  // 把刻钟当整天画（旧日粒度几何）会得 3，甬道式等距会得 1——两种病都在这一条上翻红。
  assert.ok(Math.abs(比 - 48) < 0.5, `专项条/刻钟条宽度比应≈48（72h/1.5h），实得 ${比.toFixed(2)}（sp=${sp.width}% d1=${d1.width}%）`);
  // 时序落位：专项条(8-20起) 在 刻钟条(8-24 09:00) 左边；今时线(12:00) 在刻钟条右侧
  const 今左 = 今线左(html);
  assert.ok(今左 != null, '今时线没画出来');
  assert.ok(sp.left < d1.left && d1.left < 今左, `左右次序错了：sp=${sp.left} d1=${d1.left} 今=${今左}`);
  // 变异自证：把专项计划完成 08-22 改 08-21（少一天）→ 比值掉到 32——证明宽度真跟着时长走
  const 短 = { ...S1主, 计划完成: '2026-08-21' };
  const html2 = ctx.甘特Html([短, 刻钟散], '2026-08-24', [], { 现在 });
  const 比2 = 条几何(块(html2, 'data-gid="p-s1"')).width / 条几何(块(html2, 'data-gid="d1"')).width;
  assert.ok(Math.abs(比2 - 32) < 0.5, `改短一天后宽度比应≈32（48h/1.5h），实得 ${比2.toFixed(2)}`);
});

t('③b 专项无自身计划 → 聚合子粒区间灰细线（不冒充排期）；子粒全无期则连灰线也不画', () => {
  const ctx = 装载前端();
  const 子a = { 粒ID: 'ca', 上级: 'S-2', 序: 1, 题: '有期子', 状态: '计划', 计划开始: '2026-08-21', 计划完成: '2026-08-22' };
  const 子b = { 粒ID: 'cb', 上级: 'S-2', 序: 2, 题: '无期子', 状态: '计划' };
  const html = ctx.甘特Html([子a, 子b], '2026-08-24', [], { 现在 });
  assert.ok(/class="gtagg" style="left:[\d.]+%;width:[\d.]+%"/.test(html),
    '专项自身未排计划时，主行应画子粒区间聚合灰线（gtagg）');
  // 变异自证：子粒一格日期都没有 → 聚不出区间，灰线不许凭空出现
  const html2 = ctx.甘特Html([{ ...子a, 计划开始: undefined, 计划完成: undefined }, 子b], '2026-08-24', [], { 现在 });
  assert.ok(!/class="gtagg" style/.test(html2), '子粒全无期时不许画聚合灰线——凭空画线就是造排期');
  assert.ok(有主('gtagg'), '.gtagg 在样式表里没有主');
});

t('③c 周视图自动降天粒度：刻钟条(1.5h)升格成一整天，宽度比变 72h/24h=3', () => {
  const ctx = 装载前端();
  ctx.localStorage.setItem('gt-zoom', '周');
  const html = ctx.甘特Html([S1主, 刻钟散], '2026-08-24', [], { 现在 });
  const 比 = 条几何(块(html, 'data-gid="p-s1"')).width / 条几何(块(html, 'data-gid="d1"')).width;
  assert.ok(Math.abs(比 - 3) < 0.05, `周档宽度比应≈3（降天粒度后 72h/24h），实得 ${比.toFixed(2)}`);
  // 变异自证（对照日档 48）：两档确实是两套粒度，不是同一张图换个标题
  ctx.localStorage.setItem('gt-zoom', '日');
  const 比日 = (() => { const h = ctx.甘特Html([S1主, 刻钟散], '2026-08-24', [], { 现在 });
    return 条几何(块(h, 'data-gid="p-s1"')).width / 条几何(块(h, 'data-gid="d1"')).width; })();
  assert.ok(Math.abs(比日 - 48) < 0.5, '切回日档应恢复分钟几何（比≈48）');
  assert.equal(typeof ctx.gtZoom, 'function', '缩放按钮指到的 gtZoom 必须真存在');
  assert.ok(有主('gtzoom'), '.gtzoom 在样式表里没有主');
});

/* ═══ ④ 甬道等距非时间：节点按 序 排、不按时间落位；折叠权制作人（localStorage）═══ */
t('④ 甬道节点按 序 等距：无 left 定位、乱序喂入仍按序出、时间行反证有 left', () => {
  const ctx = 装载前端();
  // 乱序喂入（3,1,2）：甬道必须按 序 重排，而不是按喂入序或按日期
  const html = ctx.甘特Html([S1主, 子3, 子1, 子2], '2026-08-24', [], { 现在 });
  const 道 = 块(html, 'class="gtlane"');
  assert.equal((道.match(/class="gtnode/g) || []).length, 3, '甬道应有 3 个节点（含无期的丙件——没日期不等于不存在）');
  assert.ok(!/left:/.test(道), '甬道是**非时间轴**：节点不许有 left 百分比定位（等距由 flex 均分实现）');
  const [a, b, c] = ['甲件', '乙件', '丙件'].map((x) => 道.indexOf(x));
  assert.ok(a >= 0 && a < b && b < c, `节点须按 序 排：甲(${a}) < 乙(${b}) < 丙(${c})`);
  // 反证：同一张图里时间行（专项主行）确实带 left 定位——证明「无 left」不是全图皆然的空断言
  assert.ok(/left:/.test(块(html, 'data-gid="p-s1"')), '专项主行是时间条，必须有 left 定位');
  // 节点接线：有单号的进详情，没单号的改排期
  assert.ok(道.includes("location.hash='#/t/TK-9'"), '有单号的节点要接工单详情');
  assert.ok(道.includes("tqReplan('c3')"), '没单号的节点要接排期弹窗');
  assert.ok(有主('gtlane') && 有主('gtnode') && 有主('gtnd') && 有主('gtlgrid'), '甬道/节点样式没有主');
});

t('④b 折叠权在制作人：localStorage 折起后节点不渲染、报数还在；gtFoldSp 真存在', () => {
  const ctx = 装载前端();
  ctx.localStorage.setItem('gt-fold', JSON.stringify({ 'S-1': true }));
  const html = ctx.甘特Html([S1主, 子1, 子2, 子3], '2026-08-24', [], { 现在 });
  assert.ok(!/class="gtnode/.test(html), '折起的甬道不该渲染节点');
  assert.ok(/▸ 甬道 3 节点/.test(html), '折起也要报「里面还有几个节点」——折叠不是藏账');
  assert.equal(typeof ctx.gtFoldSp, 'function', '折叠按钮指到的 gtFoldSp 必须真存在');
  // 变异自证：撤掉折叠记录 → 节点回来
  ctx.localStorage.removeItem('gt-fold');
  assert.ok(/class="gtnode/.test(ctx.甘特Html([S1主, 子1, 子2, 子3], '2026-08-24', [], { 现在 })),
    '未折叠时节点必须在场');
});

/* ═══ ⑤ 节点菱形来自债数据：/api/attn 的债按 id 落到行/节点，点击走债自带路由 ═══ */
t('⑤ 闸债菱形：债落在对的行与节点上、点击走债的路由；无债零菱形（变异自证）', () => {
  const ctx = 装载前端();
  const 债 = [
    { gateKey: 'G6:S-1', 闸号: 'G6', 闸名: '专项验收', id: 'S-1', 路由: '#/tickets/编辑器', 停摆小时: 3 },
    { gateKey: 'G3:TK-9', 闸号: 'G3', 闸名: '保留单/散单终审', id: 'TK-9', 路由: '#/t/TK-9' },
  ];
  const html = ctx.甘特Html([S1主, 子1, 子2], '2026-08-24', [], { 现在, 债 });
  assert.equal((html.match(/class="gtgem"/g) || []).length, 2, '两笔债应各落一颗菱形，不多不少');
  assert.ok(块(html, 'data-gid="p-s1"').includes("gtGo('#/tickets/编辑器')"),
    'G6 专项验收的菱形要落在专项主行上，且点击走债自带的路由（不许前端按 id 形状猜）');
  assert.ok(块(html, 'class="gtlane"').includes("gtGo('#/t/TK-9')"),
    'G3 的菱形要落在甬道里 TK-9 那个节点上');
  assert.equal(typeof ctx.gtGo, 'function', '菱形 onclick 指到的 gtGo 必须真存在');
  // 变异自证 ×2：无债零菱形；债的 id 对不上任何行也零菱形（不许把别人的债挂错行）
  assert.equal(((ctx.甘特Html([S1主, 子1, 子2], '2026-08-24', [], { 现在, 债: [] })).match(/class="gtgem"/g) || []).length, 0,
    '没有债时一颗菱形都不许有——菱形的唯一数据源是 /api/attn 的债');
  assert.equal(((ctx.甘特Html([S1主, 子1, 子2], '2026-08-24', [], { 现在, 债: [{ 闸号: 'G3', id: 'ZZZ-404', 路由: '#/board' }] })).match(/class="gtgem"/g) || []).length, 0,
    'id 对不上任何行/节点的债不许乱挂');
  assert.ok(有主('gtgem'), '.gtgem 在样式表里没有主');
});

/* ═══ ⑥ 整页接线：viewRelay 真取 /api/gates 与 /api/attn，paused 直通停表灰带 ═══ */
t('⑥ viewRelay 接线：paused=true 整页出停表灰带，false 不出；两口都真被叫到', async () => {
  const 开页 = async (paused) => {
    const ctx = 装载前端();
    await 设项目(ctx, null, { TK: {} }); // 单项目 ⇒ 不过滤，别把判据混进项目视界那条线
    const 叫过 = [];
    ctx.fetch = async (u) => {
      const url = decodeURIComponent(String(u)).split('?')[0];
      叫过.push(url);
      const J = (o) => ({ ok: true, json: async () => o });
      if (url === '/api/schedule') return J({ 粒: [越], 计数: {}, 名册: {} });
      if (url === '/api/schedule/队列') return J({ 摘要: { 文: '1 批 · 1 项未完' }, 批们: [] });
      if (url === '/api/gates') return J({ paused, locks: { codex: { locked: false }, claude: { locked: false } } });
      if (url === '/api/attn') return J({ 债: [] });
      if (url === '/api/ideas') return J({ 想法: [] });
      if (url === '/api/pm/actions') return J({ 桶: [], 合计: 0, 心跳占比: 0, 窗: {} });
      return J({});
    };
    return { html: await ctx.viewRelay(), 叫过 };
  };
  const 关 = await 开页(true);
  assert.ok(关.叫过.includes('/api/gates') && 关.叫过.includes('/api/attn'),
    'viewRelay 必须真去取 /api/gates 与 /api/attn（甘特的停表与菱形只有这两个数据源）');
  assert.ok(/class="gtstop"/.test(关.html) && /产线关闭中 · 停表/.test(关.html),
    'gates.paused=true 时项管页甘特要出停表灰带');
  assert.ok(!/class="gtflag rejudge"/.test(关.html), '关闸期整页不许渲染越线触发灰标');
  // 变异自证：产线开 → 灰带消失、越线提示恢复（x1 计划开始 2026-08-23 已过真实今时）
  const 开 = await 开页(false);
  assert.ok(!/class="gtstop"/.test(开.html), 'paused=false 不许出停表灰带');
  assert.ok(/class="gtflag rejudge"[^>]*>待重判</.test(开.html), 'paused=false 时越线条应挂「待重判」灰标');
});

(async () => {
  for (const [n, f] of 待) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error('  ✗ ' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
