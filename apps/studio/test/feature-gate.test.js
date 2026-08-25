// feature-gate.test.js — 「闸」族行为判据（2026-08-22 体检 #14 / #64 / #59 / #37 / #70）
//
// 为什么另起一册、为什么一条 grep 都不写：
//   上一轮复核靠「把病原样种回去、测试仍全绿」判掉了 22 条假判据，全是
//   `assert.match(fs.readFileSync('app.js'), /某串字/)` 这一族。那种断言证明的只是
//   「某几个字还在源码里」——换个写法照样有病（漏真病），改个变量名就假红（误伤重构）。
//   本册四组判据一律走行为面：**真装前端、真调渲染函数、真点那颗按钮、真起服务打端点**。
//
// 覆盖：
//   ① #14/#64 G9 管线开线——按钮真在管线层，且点下去真发 POST /api/pipelines
//   ② #64      G8 待办放行成单——按钮真在项管页待办队列，且点下去真发 转移 计划→起草中
//   ③ #59      特性待审——待审卡真长出审核出口，点下去真发 /api/features/审核；活跃卡不许长
//   ④ #37/#70  参数页闸值卡——画出来的每一格都必须点得动（页面闸门 vs 写口白名单对拍），
//              人闸超时小时 在册、0 是合法值、越上限要挡、说明栏不许空
//
// 注册表对账的口径：断言 g.按钮 出现在 **<button> 的内文** 里，不是页面任意位置。
// 反向验证见汇报——「页面里出现『放行成单』四个字」这种写法在未修的版本上也会绿。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { 装载前端 } = require('./frontend-sandbox');
const { makeRoot, 收尾, 回收临时根 } = require('./helper');
const gr = require('../lib/gatereg');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('闸族界面入口测试（#14/#64/#59/#37/#70）');

// 按钮内文（剥掉内层标签）——「页面上有没有这颗钮」只能这么问，
// 问「页面里有没有这几个字」等于把 title/注释/说明文案也算进来，那是假判据。
const 钮文 = (html) => [...String(html).matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
  .map((m) => m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
const 闸 = (号) => {
  const g = gr.缺省注册表.find((x) => x.闸号 === 号);
  assert.ok(g, `注册表里没有 ${号}——判据的锚点没了，先去看 lib/gatereg.js`);
  return g;
};

(async () => {

/* ===================== ① G9 管线开线（#14 / #64）===================== */

await t('G9：注册表承诺的「开线」按钮真在管线层，且是一颗 <button> 而非一句说明', () => {
  const ctx = 装载前端();
  // 沙盒 window 是 Proxy，未定义键返 noop（真值）——_showSealed 必须显式压平，
  // 否则「封存的线默认不显示」这一条会被桩本身伪造成显示。
  ctx._showSealed = false;
  const html = ctx.tkL1([{ id: 'P-1', 名称: '河道', 状态: '活跃', 阶段: 'L0' },
    { id: 'P-9', 名称: '旧线', 状态: '封存' }], []);
  const 钮 = 钮文(html);
  const g9 = 闸('G9');
  assert.ok(钮.some((s) => s.includes(g9.按钮)),
    `注册表 G9 写着 落点「${g9.落点}」/ 按钮「${g9.按钮}」，管线层的按钮却只有 ${JSON.stringify(钮)}`);
  assert.equal(typeof ctx.plOpen, 'function', '按钮绑的函数要真存在，不能只画个壳');
  assert.equal(typeof ctx.plToggleSealed, 'function',
    'window._showSealed 此前全库一处读零处写——封存的线调不出来，开关也得有入口');
  assert.ok(!html.includes('P-9'), '_showSealed=false 时封存线不出现（证明这颗开关管的是真事）');
  ctx._showSealed = true;
  assert.ok(ctx.tkL1([{ id: 'P-9', 名称: '旧线', 状态: '封存' }], []).includes('P-9'),
    '打开「显示封存」就该看得见封存线');
});

await t('G9：点「开线」真发 POST /api/pipelines，名称去空白、阶段带上', async () => {
  const ctx = 装载前端();
  const 呼 = [];
  ctx.fetch = async (u, o) => {
    呼.push([String(u), o && o.body ? JSON.parse(o.body) : null]);
    return { ok: true, json: async () => (String(u) === '/api/pipelines' && o ? { ok: true, id: 'P-7' } : {}) };
  };
  const 问 = [];
  ctx.askInput = async (label) => { 问.push(label); return 问.length === 1 ? '  河道系统  ' : '原型'; };
  const 吐 = []; ctx.toast = (m) => 吐.push(m);
  await ctx.plOpen();
  const 发 = 呼.filter(([u, b]) => u === '/api/pipelines' && b);
  assert.equal(发.length, 1, '点了开线却没往 /api/pipelines 发过东西：' + JSON.stringify(呼));
  assert.deepEqual(发[0][1], { 名称: '河道系统', 阶段: '原型' }, '请求体形状不对（lib/pipelines.create 收 名称/阶段）');
  assert.equal(问.length, 2, '开线要问名称与阶段两问');
  assert.ok(吐.some((m) => m.includes('P-7')), '开完要把新线号回给人看：' + JSON.stringify(吐));
});

await t('G9：取消（askInput 返 null）一个请求都不许发', async () => {
  const ctx = 装载前端();
  const 呼 = [];
  ctx.fetch = async (u, o) => { 呼.push(String(u)); return { ok: true, json: async () => ({}) }; };
  ctx.askInput = async () => null;
  ctx.toast = () => {};
  await ctx.plOpen();
  assert.deepEqual(呼.filter((u) => u === '/api/pipelines'), [], '取消却发了请求');
});

/* ===================== ② G8 待办放行成单——已裁撤（2026-08-26）===================== */
// 制作人第一性拷问+对抗审「该去」：新单流（排期作业→孵化→审→放行→已排期）不经就绪旗，
// 闸上已无水流。判据反转：裁撤要裁干净——注册表无此闸、判据无此谓词、前端无此机件。

await t('G8 裁撤自证：注册表无 G8、无「待办候放行」判据、前端无 tqRelease/待办队列Html 残件', () => {
  assert.ok(!gr.缺省注册表.some((x) => x.闸号 === 'G8'), 'G8 已裁撤，注册表里不许再有这一行');
  assert.ok(!gr.缺省注册表.some((x) => x.判据 === '待办候放行'), '裁撤的判据不许被别的闸引用');
  const ctx = 装载前端();
  assert.equal(ctx.tqRelease, undefined, 'tqRelease 该随区块拆除——留着就是死链路复活的种子');
  assert.equal(ctx.待办队列Html, undefined, '待办队列Html 该随区块拆除');
  assert.equal(typeof ctx.tqEditDeps, 'function', '编依赖能力不随区块陪葬（入口迁甘特右键菜单）');
});

/* ===================== ③ 特性待审的界面出口（#59）===================== */

const 特性卡 = (ctx, 状态) => ctx.tkFeatCard({ id: 状态 === '待审' ? 'F-99' : 'F-98',
  名称: 状态 === '待审' ? '待审的那个' : '活的', 状态, 管线: 'P-1', 边界: '', 单数: 0 });

await t('#59 待审特性卡上真长出可点的审核出口（通过 / 退回两颗）', () => {
  const ctx = 装载前端();
  const 钮 = 钮文(特性卡(ctx, '待审'));
  assert.ok(钮.length >= 2, '待审态只画一个「待审」徽章＝告诉人「去别处找」：' + JSON.stringify(钮));
  assert.ok(钮.some((s) => s.includes('审核通过')), '缺「审核通过」：' + JSON.stringify(钮));
  assert.ok(钮.some((s) => s.includes('退回')), '缺「退回」：' + JSON.stringify(钮));
  assert.match(特性卡(ctx, '待审'), /ftAudit\('F-99'/, '按钮要真绑到 ftAudit 上');
  assert.equal(typeof ctx.ftAudit, 'function');
});

await t('#59 活跃/封存态不许长出审核钮（审过的不该再问一遍）', () => {
  const ctx = 装载前端();
  assert.deepEqual(钮文(特性卡(ctx, '活跃')), [], '活跃卡冒出了按钮');
  assert.ok(!/ftAudit/.test(特性卡(ctx, '封存')), '封存卡冒出了审核动作');
});

await t('#59 点「审核通过」真发 /api/features/审核，带 id / 通过 / 审核人', async () => {
  const ctx = 装载前端();
  const 呼 = [];
  ctx.fetch = async (u, o) => { 呼.push([decodeURIComponent(String(u)), o && o.body ? JSON.parse(o.body) : null]);
    return { ok: true, json: async () => ({ ok: true }) }; };
  ctx.ask = async () => true;
  ctx.askInput = async () => '看过了，开';
  ctx.toast = () => {};
  await ctx.ftAudit('F-99', true);
  const 发 = 呼.filter(([u, b]) => u === '/api/features/审核' && b);
  assert.equal(发.length, 1, '点了审核通过却没发请求：' + JSON.stringify(呼));
  assert.equal(发[0][1].id, 'F-99');
  assert.equal(发[0][1].通过, true);
  assert.ok(发[0][1].审核人, '审核要留署名，否则台账上是无主签字');
  assert.equal(发[0][1].说明, '看过了，开');
  // 退回走同一条口、通过位翻面
  呼.length = 0;
  await ctx.ftAudit('F-99', false);
  assert.equal(呼.filter(([u, b]) => u === '/api/features/审核' && b)[0][1].通过, false);
});

await t('#59 确认框点「取消」就什么都不发（人闸不许被误触）', async () => {
  const ctx = 装载前端();
  const 呼 = [];
  ctx.fetch = async (u) => { 呼.push(decodeURIComponent(String(u))); return { ok: true, json: async () => ({}) }; };
  ctx.ask = async () => false;
  ctx.toast = () => {};
  await ctx.ftAudit('F-99', true);
  assert.deepEqual(呼.filter((u) => u === '/api/features/审核'), []);
});

/* ============ ④ 参数页闸值卡：页面闸门 vs 写口白名单对拍（#37 / #70）============ */

// 页面画出来的每一格 ± 步进器，都必须真能写进去——这是这两条的**唯一**可证命题。
// 故判据必须两头都真：一头真跑 viewParams 拿它吐的 data-key，一头真起服务打 /api/config/gate。
const 画出的键 = async (闸值, 白名单) => {
  const ctx = 装载前端();
  const cfg = { 闸值, 执行器: {}, 执行池: {}, 项目: {}, 模型: {}, quota: {}, server: {} };
  if (白名单) cfg.闸值白名单 = 白名单;
  ctx.fetch = async (u) => ({ ok: true, json: async () => (String(u).startsWith('/api/config') ? cfg
    : (String(u).startsWith('/api/runner') ? { 运行: false } : {})) });
  const html = await ctx.viewParams();
  return { 键: [...html.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]), html };
};

// 实盘那份 闸值 才是这条对拍的现实标的；工作区不在（干净机器/CI）时退回四格缺省。
const 实盘闸值 = () => {
  try {
    const c = JSON.parse(fs.readFileSync('D:/GitHub/AI-GameStudio/监制台/studio.config.json', 'utf8'));
    if (c && c.闸值 && Object.keys(c.闸值).length) return c.闸值;
  } catch { /* 没有工作区就用缺省 */ }
  return { 待验收积压闸: 8, QA自修上限: 2, 滞留超时小时: 4, 人闸超时小时: 24 };
};

const 打端点 = (闸值) => {
  const root = makeRoot();
  const cfgPath = path.join(root, 'studio.config.json');
  const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  c.闸值 = { ...闸值 };
  fs.writeFileSync(cfgPath, JSON.stringify(c), 'utf8');
  // 端口避开 4270（活体监制台）与 49xx（stub.test.js 那一带），按 pid 散开免得并跑撞车
  const PORT = 5100 + (process.pid % 200);
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${PORT}';
      const P = async (b) => { const r = await fetch(B + '/api/config/gate', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
        return [r.status, await r.json()]; };
      const out = { 闸值: (await (await fetch(B + '/api/config')).json()).闸值, 逐格: {} };
      for (const k of Object.keys(out.闸值)) out.逐格[k] = await P({ key: k, value: out.闸值[k] });
      out.零 = await P({ key: '人闸超时小时', value: 0 });
      out.越界 = await P({ key: '人闸超时小时', value: 169 });
      out.未登记 = await P({ key: '莫须有的闸', value: 1 });
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    });`;
  const out = execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, STUDIO_STUB: '1', STUDIO_ROOT: root, STUDIO_PORT: String(PORT) },
    encoding: 'utf8', timeout: 90000,
  });
  const 段 = out.split('@@');
  assert.ok(段.length >= 2, '子进程没吐回执（服务没起来？）：\n' + out.slice(-800));
  return JSON.parse(段[1]);
};

const 闸值 = 实盘闸值();
const 端 = 打端点(闸值);

await t('#37 参数页画出来的每一格，写口都收得下（页面闸门 vs 写口白名单对拍）', async () => {
  const { 键 } = await 画出的键(端.闸值, null); // 服务端尚未下发白名单 ⇒ 走回落口径，正是活体今天的样子
  assert.ok(键.length, '一格都没画出来——参数页整块空了');
  for (const k of 键) {
    assert.ok(端.逐格[k], `页面画了 ${k} 这张卡，端点却根本没被问到（键对不上）`);
    assert.equal(端.逐格[k][0], 200,
      `${k} 在参数页上有 ± 钮却点不动：POST /api/config/gate 回 ${端.逐格[k][0]} ${JSON.stringify(端.逐格[k][1])}`);
  }
});

await t('#70 人闸超时小时：这一格画得出来、在写口白名单里、0 是合法值、越上限要挡', async () => {
  assert.ok(Object.keys(端.闸值).includes('人闸超时小时'), '实盘 闸值 里没有这一格（08-21 00:23 拍板 T=24h）');
  const { 键 } = await 画出的键(端.闸值, null);
  assert.ok(键.includes('人闸超时小时'), '参数页上根本没画这一格：' + JSON.stringify(键));
  assert.equal(端.逐格.人闸超时小时[0], 200, '画出来了却点不动——正是本条病灶');
  assert.equal(端.零[0], 200, '0＝关闭升格，是文档承认的合法值，写口必须收：' + JSON.stringify(端.零));
  assert.equal(端.零[1].闸值.人闸超时小时, 0, '收了却没写进去');
  assert.equal(端.越界[0], 400, '169 超一周上限，必须挡');
  assert.match(String(端.越界[1].error || ''), /168/, '挡的时候要说清上限：' + JSON.stringify(端.越界[1]));
  assert.equal(端.未登记[0], 400, '未登记的键必须挡');
});

await t('#70 这张卡有说明文字，且说明随取值变（不是一句写死的话）', async () => {
  const a = await 画出的键({ ...端.闸值, 人闸超时小时: 24 }, null);
  const b = await 画出的键({ ...端.闸值, 人闸超时小时: 6 }, null);
  const 抓 = (h) => { const m = h.match(/data-key="人闸超时小时"><h4>[^<]*<\/h4><p class="pmeta">([^<]*)</); return m && m[1]; };
  const s24 = 抓(a.html); const s6 = 抓(b.html);
  assert.ok(s24 && s24.trim(), '这张卡的说明栏是空的——一个光秃秃的步进器，谁也不知道调的是什么');
  assert.match(s24, /24/, '说明要把当前取值念出来');
  assert.match(s6, /6/, '换个取值说明要跟着变');
  assert.match(s24, /0/, '「0＝关闭升格」这条语义必须在卡上说，否则没人敢往下调到 0');
});

await t('#70 白名单一旦随 /api/config 下发，页面闸门就该改认它（不再拿说明表当闸门）', async () => {
  // 这一条钉的是**关系**不是某个键：服务端补上 闸值白名单 之后，说明表里有、白名单里没有的
  // 键必须立刻从参数页消失。今天服务端还没下发（回落口径），故这里直接把白名单喂进去验行为。
  const 白 = { 待验收积压闸: [1, 50], QA自修上限: [0, 10], 滞留超时小时: [1, 72], 人闸超时小时: [0, 168] };
  const { 键 } = await 画出的键({ ...端.闸值, 间隔秒: 5, 全局在途上限: 3 }, 白);
  assert.deepEqual(键.slice().sort(), Object.keys(白).slice().sort(),
    '白名单在手时，只许画白名单里的格：' + JSON.stringify(键));
  const 回落 = await 画出的键({ ...端.闸值, 间隔秒: 5, 全局在途上限: 3 }, null);
  assert.ok(回落.键.includes('间隔秒'),
    '回落口径（P6META 说明表）本来就是写口白名单的超集——这正是必须把白名单下发下来的理由');
  assert.ok(!回落.键.includes('全局在途上限'), '已退役的键早该从说明表里清掉（#70 一段）');
});

/* ====== ⑤ 特性聚合落袋口径（H108 三大态：完成+归档 算落袋，废弃留分母；2026-08-24 C 组）====== */

await t('特性聚合：落袋 = 完成+归档 · 废弃留在分母不进分子（与 specials.落袋态 同判）', () => {
  const FT = require('../lib/features');
  const { seed } = require('./helper');
  const root = makeRoot();
  const f = FT.提请(root, { 名称: '水体', 管线: 'P-1', 边界: '管水', 挂载: { 工单: ['TK-1'] } });
  assert.ok(f.ok, '夹具：提请要成');
  FT.审核(root, f.id, { 通过: true, 审核人: '总监' });
  seed(root, '完成', { id: 'TK-1', 特性: f.id });   // 做完等关账——新口径算落袋
  seed(root, '归档', { id: 'TK-2', 特性: f.id });   // 已验收落袋
  seed(root, '废弃', { id: 'TK-3', 特性: f.id });   // 出基线：分母留、分子不进
  seed(root, '在途', { id: 'TK-4', 特性: f.id });
  const v = FT.聚合(root, f.id);
  assert.equal(v.单数, 4);
  assert.equal(v.落袋, 2, '完成+归档 都算落袋（H108 口径）；原「已归档」字面已不存在，认的是新目录态「归档」');
  assert.equal(v.百分比, 50, '废弃留在分母——废掉一张不该让特性完成度凭空变好看');
});

回收临时根();
收尾('闸族界面入口', passed);
})().catch((e) => { console.error('  ✗ ' + (e && e.stack || e)); try { 回收临时根(); } catch { /* 尽力 */ } process.exit(1); });
