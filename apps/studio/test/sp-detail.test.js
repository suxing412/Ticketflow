// sp-detail.test.js — 专项详情页 #/sp/<S-n>（甘特施工令 P0-0 裁决③ · 交互表 #16「点名称进详情」）。
//
// 判据全走行为面（H104）：真装 public/app.js、真调 route()/viewSpecial()，断言它吐出的 HTML；
// 一条 grep 源码文本的断言都没有。
//
// 变异自证（落成时真跑过一轮，能红）：把 sp子单表 里子单行的 `<a … href="#/t/…">` 剥成
// `<span>`（链接拿掉、别的全留），「尾部：子单行可点跳 #/t/」与「路由面」两条当场红——
// 这两刀验的是「点得动」这个行为，不是「href 三个字母还在源码里」。删掉 route() 的 sp 分支，
// 「路由面」同样红（认不出的 hash 落回总览，页上不会有子单链接）。
const assert = require('node:assert');
const { 装载前端 } = require('./frontend-sandbox');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('专项详情页测试（#/sp/<S-n>）');

const ctx = 装载前端();

// /api/specials/:id 的真实形状（server.js：specials.聚合 + 正文）——字段名一律照 lib/specials.js 聚合()
const S3 = {
  id: 'S-3', 名称: '手修工具重构专项', 目标: '编辑器手修+贴真通道', 状态: '进行',
  管线: 'P-1', 特性: 'F-9', 项目: 'TK', 单号前缀: 'TK', 类型: '重构',
  完成定义: '制作人能在编辑器里顺手改图（手感过闸）', 别名: ['TK-146'],
  子单: [
    { id: 'TK-171', title: '面板卡死修复', state: '在途', 职能: '程序', 落袋: false },
    { id: 'TK-176', title: '笔刷吸附', state: '归档', 职能: '程序', 落袋: true },
  ],
  进度: { 总数: 2, 落袋: 1, 归档: 1, 废弃: 0, 在办: 1, 未起: 0, 百分比: 50 },
  预算: { 预计h: 8, 实耗h: 3.5, 预计token: 0, 实耗token: 120000, 偏差pct: 44 },
  基线: [],
  正文: '## 专项目标\n编辑器手修+贴真通道\n',
};

// 接口桩：按路径供数（无 query 段比对），没供的一律 {}
const 供 = (表) => {
  const 原 = ctx.fetch;
  ctx.fetch = async (u) => { const k = String(u).split('?')[0];
    return { ok: true, json: async () => (表[k] !== undefined ? 表[k] : {}) }; };
  return () => { ctx.fetch = 原; };
};
// 把某个挂载点换成能读回来的捕获盒（沙盒共享 Proxy 写进去读不出来，同 tf-layer 的成例）
const 捕获 = (目标id) => {
  const 盒 = { html: '' };
  const cap = { get innerHTML() { return 盒.html; }, set innerHTML(v) { 盒.html = String(v); },
    style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [], dataset: {} };
  const 原 = ctx.document.getElementById;
  ctx.document.getElementById = (id) => (id === 目标id ? cap : 原(id));
  return { 盒, 还原: () => { ctx.document.getElementById = 原; } };
};

(async () => {

await t('头部字段齐：id/名称/状态/管线/特性/项目（+别名），进度与账行在场', async () => {
  const 停 = 供({ '/api/specials/S-3': S3 });
  try {
    const html = await ctx.viewSpecial('S-3');   // 不带预取：连取数路径一起验
    assert.match(html, /spno">S-3</, '编号');
    assert.match(html, /spname">手修工具重构专项</, '名称');
    assert.match(html, /sp-st">进行</, '状态胶囊');
    assert.match(html, /title="管线归属（H51）">P-1</, '管线胶囊');
    assert.match(html, /title="特性归属">F-9</, '特性胶囊');
    assert.match(html, /title="项目">TK</, '项目胶囊');
    assert.ok(html.includes('原 TK-146'), '别名（伪单号追溯）');
    assert.match(html, /1\/2 落袋/, '进度读数');
    assert.ok(html.includes('预计 8h') && html.includes('实耗 3.5h') && html.includes('偏差 44%'), '预算账行');
  } finally { 停(); }
});

await t('中部：完成定义摆出来，正文经 wkMd 渲染成结构（不是生贴）', async () => {
  const 停 = 供({ '/api/specials/S-3': S3 });
  try {
    const html = await ctx.viewSpecial('S-3');
    assert.ok(html.includes('完成定义') && html.includes('手感过闸'), '完成定义原文在场');
    assert.match(html, /wk-h">专项目标</, '正文 ## 标题要渲染成标题节点，不是一行井号');
  } finally { 停(); }
});

await t('尾部：子单行可点跳 #/t/，落袋行带 done，职能/状态胶囊同 spCard 语言', async () => {
  const 停 = 供({ '/api/specials/S-3': S3 });
  try {
    const html = await ctx.viewSpecial('S-3');
    assert.ok(html.includes('href="#/t/TK-171"'), 'TK-171 行必须是链接——详情页存在的理由就是从树上点进来还能继续往下钻');
    assert.ok(html.includes('href="#/t/TK-176"'), 'TK-176 同上');
    assert.match(html, /sprow done" href="#\/t\/TK-176"/, '落袋行带 done 视觉（spCard 同款）');
    assert.ok(html.includes('子单清单 · 2 张 · 落袋 1'), '尾部要报数');
    assert.match(html, /fn-code">程序</, '职能胶囊');
  } finally { 停(); }
});

await t('路由面：#/sp/S-3 真的落到专项详情（bshell 面包屑=编号·名称，正文是本页）', async () => {
  const 停 = 供({
    '/api/setup/state': {},
    '/api/config': { 项目: { 注册: { TK: {} }, 默认: 'TK' } },
    '/api/specials/S-3': S3,
  });
  const { 盒, 还原 } = 捕获('app');
  ctx.location.hash = '#/sp/S-3';
  try {
    await ctx.route();
    assert.match(盒.html, /class="bhead"/, '详情页走 bshell 面包屑壳（同 #/t/ 形制），不是页签壳');
    assert.match(盒.html, /S-3 · 手修工具重构专项/, '面包屑 = 编号 · 名称');
    assert.ok(盒.html.includes('href="#/t/TK-171"'), '路由落下来的页面里子单行可点——分支没接上时这里是总览，没有这条链接');
  } finally { 还原(); 停(); ctx.location.hash = ''; }
});

await t('空态一：不在册的编号说话，不吐白屏也不装死', async () => {
  const 停 = 供({ '/api/specials/S-99': { error: '专项不存在' } });   // 服务端 404 的 json 形状
  try {
    const html = await ctx.viewSpecial('S-99');
    assert.match(html, /S-99 不在册/, '空态要点名编号');
    assert.ok(!html.includes('spkids'), '不在册就不许画子单区');
  } finally { 停(); }
});

await t('空态二：零子单专项——空槽条、无子单读数、空态文案、完成定义未写要明说', async () => {
  const 空专项 = { id: 'S-8', 名称: '新立的空壳', 目标: '', 状态: '立项', 管线: null, 特性: null,
    项目: 'TK', 完成定义: null, 别名: [], 子单: [],
    进度: { 总数: 0, 落袋: 0, 归档: 0, 废弃: 0, 在办: 0, 未起: 0, 百分比: 0 },
    预算: { 预计h: 0, 实耗h: 0, 预计token: 0, 实耗token: 0, 偏差pct: null }, 基线: [], 正文: '' };
  const 停 = 供({ '/api/specials/S-8': 空专项 });
  try {
    const html = await ctx.viewSpecial('S-8');
    assert.match(html, /spbar empty/, '零子单画空槽条（不编进度）');
    assert.ok(html.includes('无子单'), '读数区不许编百分比');
    assert.match(html, /还没有子单/, '子单区空态文案');
    assert.ok(html.includes('完成定义未写'), '完成定义缺格要明说，不留空档让人猜');
    assert.ok(html.includes('无正文'), '正文空态');
  } finally { 停(); }
});

await t('XSS 纪律（DS-9 入判据）：名称/正文/子单标题里的活标签一律转义', async () => {
  const 毒 = { ...S3, id: 'S-3', 名称: '<img src=x onerror=alert(1)>',
    目标: '<script>alert(2)</script>', 正文: '## 目标\n<script>alert(3)</script>\n',
    子单: [{ id: 'TK-1', title: '"><script>alert(4)</script>', state: '在途', 职能: '程序', 落袋: false }] };
  const 停 = 供({ '/api/specials/S-3': 毒 });
  try {
    const html = await ctx.viewSpecial('S-3');
    assert.ok(!html.includes('<script>'), '活的 script 标签一个都不许有');
    assert.ok(!html.includes('<img'), '活的 img 标签同上');
    assert.ok(html.includes('&lt;script&gt;'), '毒串要以转义后的原文可见，不是被吞掉');
  } finally { 停(); }
});

console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error('  不通过：' + (e && e.stack || e.message)); process.exit(1); });
