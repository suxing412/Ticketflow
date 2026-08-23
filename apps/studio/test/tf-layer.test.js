// tf-layer.test.js — Ticketflow 项目的工单页曾是两步死胡同（2026-08-21 体检「重」）。
//
// 案情：管线层那张 TF 卡自陈「不挂管线——只有专项+工单两层」，点下去却落进 tkL2('Ticketflow')，
// 而 tkL2 按 `f.管线 === pl` 过滤 —— 全部 18 条特性挂的都是 P-1..P-4，必空。
// 于是页面显示「管线 / Ticketflow」的面包屑 +「这条管线下还没有特性」：
// **两句都是假话**（TF 没有管线层，也不是「特性为空」），而 TF 真有的专项与工单在本页不可达。
//
// 判据取行为面而非文本面：真装 app.js、真调渲染函数、断言它吐出来的 HTML。
// —— 08-22 我给单实例锁配判据时只 grep 了源码文本，正撞在本轮另一条体检结论上，故此处不重蹈。
const assert = require('node:assert');
const { 装载前端 } = require('./frontend-sandbox');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('Ticketflow 层测试');

const ctx = 装载前端();
const 专项们 = [
  { id: 'S-3', 项目: 'TK', 特性: 'F-10', 状态: '进行', 名称: '手修工具重构专项', 进度: {}, 子单: [] },
  { id: 'S-4', 项目: 'Ticketflow', 特性: null, 状态: '立项', 名称: 'OAuth 续命链', 进度: {}, 子单: [] },
  { id: 'S-5', 项目: 'Ticketflow', 特性: null, 状态: '立项', 名称: '值守自愈', 进度: {}, 子单: [] },
];

(async () => {

await t('TF 层真吐出本项目的专项，不再是「还没有特性」', async () => {
  const html = await ctx.tkTF(专项们);
  assert.ok(html.includes('S-4'), 'S-4 要在页面上——它此前在本页不可达');
  assert.ok(html.includes('S-5'), 'S-5 同上');
  assert.ok(!html.includes('S-3'), 'TK 的专项不许露脸（项目边界，制作人 08-21 点名）');
  assert.ok(!/还没有特性/.test(html), '不许再宣称「这条管线下还没有特性」——TF 根本没有特性这一层');
  assert.ok(!/管线/.test(html.slice(0, html.indexOf('sp-head'))), '面包屑不许写「管线」：'
    + html.slice(0, 160));
  assert.ok(/Ticketflow/.test(html), '面包屑要落在 Ticketflow 上');
});

await t('路由面：#/tickets/Ticketflow 真的落到 TF 层，而不是特性层', async () => {
  // 只测 tkTF 不够——旧病灶在**路由**：卡片指向 #/tickets/Ticketflow，viewTickets 把它当管线号
  // 交给 tkL2。故这里从 hash 出发，走真 viewTickets，喂真形状的接口数据。
  const 供 = {
    '/api/features': { 特性: [{ id: 'F-10', 管线: 'P-1', 名称: '地图', 状态: '活跃' }] },
    '/api/specials': { 专项: 专项们 },
    '/api/pipelines': { 管线: [{ id: 'P-1', 名称: '地图管线', 状态: '活跃' }] },
  };
  const 原 = ctx.fetch;
  ctx.fetch = async (u) => ({ ok: true, json: async () => 供[String(u).split('?')[0]] || {} });
  ctx.location.hash = '#/tickets/Ticketflow';
  try {
    const html = await ctx.viewTickets();
    assert.ok(html.includes('S-4') && html.includes('S-5'), 'TF 的专项要在这条路由下露出');
    assert.ok(!/还没有特性/.test(html), '不许再落进特性层的空态');
    assert.ok(!/P-1/.test(html), '别的管线的东西不许混进来');
    // 反证：同一套数据走 P-1 应当照常落特性层（证明不是把整个路由改瘫了）
    ctx.location.hash = '#/tickets/P-1';
    const h2 = await ctx.viewTickets();
    assert.ok(h2.includes('F-10'), 'P-1 照旧走特性层');
  } finally { ctx.fetch = 原; ctx.location.hash = ''; }
});

await t('专项一个都没有时也要说话，不吐白屏', async () => {
  const html = await ctx.tkTF([{ id: 'S-3', 项目: 'TK', 状态: '进行', 名称: 'x', 进度: {}, 子单: [] }]);
  assert.match(html, /还没有专项/, '空态要有文案');
});

await t('管线层：本项目一张管线卡都没有时给空态，不留白', () => {
  ctx.window._proj = null;
  // projActive 读 localStorage，桩里恒为 null ⇒ p 为空 ⇒ 不过滤项目。
  // 这里验的是「卡为空时走空态分支」：喂零条管线。
  const html = ctx.tkL1([], []);
  assert.match(html, /还没有管线/, '空管线要有空态文案——原样直接吐空 tkgrid，白屏一片');
  assert.ok(!/tkgrid"><\/div>/.test(html), '不许出现空的 tkgrid');
});

await t('tkL2 里那句只为 TF 存在的回落名已随特判摘掉', () => {
  const 线 = ctx.tkL2('P-9', [], []);   // 不在册的管线：走回落分支
  assert.ok(线.includes('P-9'), '回落用 id 本身');
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.ok(!/pl === 'Ticketflow' \? 'Ticketflow' : pl/.test(src), '死特判不许留着');
});

await t('数据面复核：TF 确实一条特性都挂不上——证明旧路必然是死胡同', () => {
  // 这条不看代码看数据：若哪天真给 TF 建了特性，本条会红，提醒回来重估这套形状。
  const F = require('../lib/features');
  const R = 'D:/GitHub/AI-GameStudio/监制台';
  if (!require('fs').existsSync(R)) { console.log('  · 跳过（无部署工作区）'); return; }
  const 挂TF = F.list(R).filter((f) => f.fm.管线 === 'Ticketflow');
  assert.equal(挂TF.length, 0, 'TF 名下没有特性——旧路 tkL2 必空，死胡同是结构性的不是数据偶然');
});

/* ===== 散单那半条（2026-08-22 复核补：#22 / #35）=====
   上面六项判的是「专项那半」——TF 层不再谎称「这条管线下还没有特性」、专项在本页可达。
   但原病灶是**两半**：TF 名下不挂任何专项的那些单（TF-1 就是其中一张）在归属结构页
   任何一层都渲染不到。修法是 tkTF 里排一拍 tkTFDirect() 去铺散单区；
   现有六项在「把那一拍删掉」的变异下全绿——即整页不可见那半条一条判据都没有。
   下面两项分别钉住：① tkTFDirect 自己捞得对 ② tkTF 真的会去叫它。 */

// 把 #tk-direct 换成一个能被读回来的捕获盒（沙盒的 el 是共享 Proxy，写进去读不出来）
const 捕获挂载点 = () => {
  const 盒 = { html: '' };
  const cap = { get innerHTML() { return 盒.html; }, set innerHTML(v) { 盒.html = String(v); },
    style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [] };
  const 原 = ctx.document.getElementById;
  ctx.document.getElementById = (id) => (id === 'tk-direct' ? cap : 原(id));
  return { 盒, 还原: () => { ctx.document.getElementById = 原; } };
};

const 板夹具 = {
  states: ['待派', '完成'],
  board: {
    待派: [{ id: 'TF-1', 项目: 'Ticketflow', 专项: null, title: '条文编址与引用化', 职能: '程序' }],
    完成: [{ id: 'TK-25', 项目: 'Ticketflow', 专项: null, title: '已落袋的散单', 职能: '程序' },
      { id: 'TF-7', 项目: 'Ticketflow', 专项: 'S-4', title: '挂在专项底下的', 职能: '程序' },
      { id: 'TK-9', 项目: 'TK', 专项: null, title: '别人家的单', 职能: '策划' }],
  },
  隐藏数: 0,
};
const 挂板 = () => {
  const 原 = ctx.fetch;
  ctx.fetch = async (u) => ({ ok: true, json: async () => (String(u).startsWith('/api/board') ? 板夹具
    : (String(u).startsWith('/api/config') ? { 项目: { 注册: { TK: {}, Ticketflow: {} }, 默认: 'TK' } } : {})) });
  return () => { ctx.fetch = 原; };
};

await t('TF 散单：不挂专项的 TF 单真出现在本页（TF-1 案，整页不可见那半条）', async () => {
  const 停板 = 挂板(); const { 盒, 还原 } = 捕获挂载点();
  ctx.localStorage.setItem('studio-proj', 'Ticketflow');
  try {
    await ctx.loadCfg(true);           // force：绕开 30s 缓存，把项目注册表真摆进去
    await ctx.tkTFDirect();
    assert.match(盒.html, /TF-1/, 'TF-1 必须露面——原病灶正是它在归属结构页任何一层都渲染不到');
    assert.match(盒.html, /TK-25/, '已落袋的散单也归本页，不是只列在途的');
    assert.ok(!/TF-7/.test(盒.html), '挂了专项的单不是散单，它归专项卡（否则一张单在两处各算一遍）');
    assert.ok(!/TK-9/.test(盒.html), '别的项目的散单不许混进来（项目边界）');
    assert.match(盒.html, /散单 2 张/, '要报数——「有几张」是这一区存在的全部理由');
    assert.match(盒.html, /落袋 1/, '落袋数要分开报');
  } finally { 还原(); 停板(); }
});

await t('TF 散单：一张散单都没有时说话，不留个空 div 在那儿', async () => {
  const 原 = ctx.fetch;
  ctx.fetch = async (u) => ({ ok: true, json: async () => (String(u).startsWith('/api/board')
    ? { states: ['完成'], board: { 完成: [{ id: 'TF-7', 项目: 'Ticketflow', 专项: 'S-4', title: 'x' }] }, 隐藏数: 0 }
    : (String(u).startsWith('/api/config') ? { 项目: { 注册: { TK: {}, Ticketflow: {} }, 默认: 'TK' } } : {})) });
  const { 盒, 还原 } = 捕获挂载点();
  try { await ctx.loadCfg(true); await ctx.tkTFDirect(); assert.match(盒.html, /没有散单/, '空态要有文案'); }
  finally { 还原(); ctx.fetch = 原; }
});

await t('tkTF 真的会去铺散单区，不是画完挂载点就算（删掉那一拍，8 张单当场重新不可达）', async () => {
  const 停板 = 挂板(); const { 盒, 还原 } = 捕获挂载点();
  const 排 = []; const 原st = ctx.setTimeout; ctx.setTimeout = (fn) => { 排.push(fn); };
  try {
    await ctx.loadCfg(true);
    const html = await ctx.tkTF(专项们);
    assert.match(html, /id="tk-direct"/, '散单挂载点要在');
    assert.ok(排.length, 'tkTF 一拍都没排——挂载点画了没人去填，等于白画');
    for (const fn of 排) await fn();   // 真跑它排下去的那一拍，看散单区到底填没填
    assert.match(盒.html, /TF-1/, '排了拍却没把散单填进去（沙盒的 setTimeout 是 noop，必须真跑）');
    assert.match(盒.html, /散单 2 张/);
  } finally { ctx.setTimeout = 原st; 还原(); 停板(); }
});

console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error('  ✗ ' + (e && e.stack || e.message)); process.exit(1); });
