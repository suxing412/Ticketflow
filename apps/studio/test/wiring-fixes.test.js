// wiring-fixes.test.js — 一批「小而确定」的接线错（2026-08-21 体检第五轮）
// 共同点：都是**写的一头和读的一头没对过**，各自单看都像对的。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const chain = require('../lib/pm/chain');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('接线订正测试');
const 参数页实测 = [];   // 异步断言收在这里，末尾统一 await——同步 t() 吞不下 Promise
const NL = String.fromCharCode(10);
const 剥 = (s) => s.split(NL).filter((l) => !l.trim().startsWith('//')).join(NL);
const app = 剥(fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8'));
const runner = 剥(fs.readFileSync(path.join(__dirname, '..', 'lib', 'runner.js'), 'utf8'));
const server = 剥(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'));

t('fm.临时改池 写对象不写字符串（读侧按对象取 .原池/.因/.时间）', () => {
  assert.match(runner, /fm\.临时改池 = \{ 原池:/, '写侧必须是对象');
  assert.ok(!/fm\.临时改池 = `/.test(runner), '模板字符串写法不许回来——在字符串上取 .原池 一律 undefined');
  // 行为面：喂一张带该字段的单，追溯行里不许出现 ? 与空因
  // 入参是**工单**（{ id, fm }），不是裸 fm
  const 行 = chain.fm行({ id: 'TK-1', fm: {
    领单时间: '2026-08-20T00:00:00Z',
    临时改池: { 原池: 'codex', 新池: 'claude', 因: 'codex 额度冻结', 时间: '2026-08-20T00:05:00Z' },
  } });
  const r = (行 || []).find((x) => String(x.文 || '').includes('临时改池'));
  assert.ok(r, '追溯链里要有这一行');
  assert.ok(!/\?/.test(r.文), '渲染行不许出现 ?（写字符串时它永远是「? → xxx」）：' + r.文);
  assert.equal(r.因, 'codex 额度冻结', '因不许为空——「为什么这单没在本职池跑」正是这一格要答的');
  assert.ok(r.t, '时间不许为空');
  // 反向：喂旧的字符串形状，确认它**确实**渲染成问号（证明这条判据抓的是真病）
  const 旧 = chain.fm行({ id: 'TK-2', fm: { 领单时间: '2026-08-20T00:00:00Z', 临时改池: 'codex→claude（额度冻结）' } })
    .find((x) => String(x.文 || '').includes('临时改池'));
  assert.match(旧.文, /\?/, '旧字符串形状确实渲染成问号——这就是本条修法的理由');
});

t('编辑器锁按项目：请求带项目，横幅与按钮态只看本项目', () => {
  assert.match(app, /post\('\/api\/editor-lock', \{ 关, 项目 \}\)/, '请求体必须带项目');
  assert.ok(!/post\('\/api\/editor-lock', \{ 关 \}\)/.test(app), '不带项目的老写法不许回来——会锁到项目默认值上');
  assert.match(app, /const 本锁 = 全锁\.filter/, '横幅按本项目过滤');
  assert.match(app, /const 锁定 = 本锁\.length > 0/, '按钮态看本项目的锁，不看别人的');
});

// 参数页那格改成行为面（2026-08-22）：原样是四条 grep。它今天**因为源码变好而假红**——
// 前端把闸门从「说明表 P6META」换成了服务端下发的真白名单（更对：说明表是白名单的超集），
// 而判据锁着旧写法的字面量。文本判据的两副作用在这一格上同时发作：漏真病 + 误伤重构。
// 现在真跑 viewParams()，喂三种 config，看它到底画出哪几张卡。
参数页实测.push((async () => {
  const { 装载前端 } = require('./frontend-sandbox');
  const ctx = 装载前端();
  const 画 = async (cfg) => {
    ctx.fetch = async (u) => ({ ok: true, json: async () => (String(u).startsWith('/api/config') ? cfg : {}) });
    ctx._cfgAt = 0;
    const html = await ctx.viewParams();
    return [...String(html).matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  };
  // 服务端下发白名单时：只画白名单里的格，闸值里多出来的一律不画
  const 卡 = await 画({ 闸值: { 待验收积压闸: 3, 人闸超时小时: 24, 全局在途上限: 5 },
    闸值白名单: { 待验收积压闸: [1, 50], 人闸超时小时: [0, 168] } });
  assert.ok(卡.includes('人闸超时小时'), '白名单里的格要画出来（T=24h 那格曾整格缺席）：' + JSON.stringify(卡));
  assert.ok(!卡.includes('全局在途上限'),
    '不在写口白名单里的格不许长出步进器——点一下必 400。不出现 好过 出现了点不动：' + JSON.stringify(卡));
  // 白名单里有、说明表里没有：卡照画（说明缺失不该让人改不了参数）
  const 卡2 = await 画({ 闸值: { 新参数X: 1 }, 闸值白名单: { 新参数X: [0, 9] } });
  assert.deepEqual(卡2, ['新参数X'], '有写口就该有钮，说明没写不是拦人的理由');
  // 老版服务端没下发白名单：回落成「有说明才画」，不许把整个参数区画空
  const 卡3 = await 画({ 闸值: { 待验收积压闸: 3, 全局在途上限: 5 } });
  assert.ok(卡3.includes('待验收积压闸') && !卡3.includes('全局在途上限'),
    '回落口径要仍然挡得住没说明的格，且不许画空：' + JSON.stringify(卡3));
})());

t('参数页：写口白名单是全系统唯一一份，且认得 人闸超时小时', () => {
  // 只留「唯一性」这一条文本判据——它盯的是「有没有第二处自己另写一份」，
  // 这件事本身就在文本层面，用行为验不出来（两份表内容相同时行为一致，分裂了才出事）。
  // 用字面量切分而不是正则：正则里的方括号要转义，而本项目的编辑管道会吃掉反斜杠（今日第七犯）
  const 份数 = server.split('待验收积压闸: [1, 50]').length - 1;
  assert.equal(份数, 1, '写口白名单只许有一份，实测 ' + 份数 + ' 份——两份就会各自漂移');
  assert.ok(server.includes('人闸超时小时: [0, 168]'), '写口要认它，否则那张卡点一下必 400');
  assert.ok(server.includes('闸值白名单,'), '要随 /api/config 下发，画口才吃得到同一份');
  assert.match(app, /人闸超时小时: '小时，人闸停摆超/, '要有说明文字');
});

t('想法拍板不再送人去已摘牌的页', () => {
  assert.ok(!/location\.hash = '#\/specials'/.test(app), '#/specials 已随四层架构摘牌，落到的是管线卡片层');
  assert.match(app, /尚未挂到特性下，需先指定归属/, '如实说明新专项还找不到——不许让人去一个空页里翻');
});

t('单实例锁：形状备注（真判据已搬到 test/single-instance.test.js，这里不再算数）', () => {
  // 案源：坑档案里那条完工判据白纸黑字写着「Electron 单实例锁挡住重复拉起」，
  // 而全库 grep requestSingleInstanceLock **零命中**——判据自称有的东西代码里没有。
  //
  // **本格已被降级为形状备注（2026-08-22 体检 #20）**。原样是下面五条 assert.match，
  // 复核实测：**把锁整块拆掉，五条断言仍全绿**——它们 grep 的是被剥了注释的 main.js 文本，
  // 而剥注释器不认识 if/else 的结构。更要命的是它们从来测不出真正的那个洞：
  // `app.whenReady().then(createWindow)` 挂在 if/else **外面**，于是第二份照样起服务抢 4270，
  // 全靠 app.quit() 抢在前面——那是赛跑，不是闸。
  //
  // 真判据现在在 test/single-instance.test.js：桩掉 electron 与 ./server 真 require 一遍 main.js，
  // 断言「拿不到锁 → 起服务次数 = 0」。把 whenReady 挪回 if 外，那一格立刻红（实测 exit 1）。
  // 这里只留形状备注，任何一条都不许再被当作本条的完工判据。
  const m = 剥(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'));
  assert.match(m, /app\.requestSingleInstanceLock\(\)/, '锁要真在（形状备注）');
  assert.match(m, /second-instance/, '第二次双击要把已在跑的窗拉到前台（形状备注）');
  // 反向锁一格，防止有人删掉行为判据文件：判据文件不在了，这里就红
  assert.ok(fs.existsSync(path.join(__dirname, 'single-instance.test.js')),
    '单实例锁的行为判据文件不见了——本格是备注不是判据，它没了就等于这条闸又回到零判据状态');
});

t('逾期阈值只有一处取值口（?? vs || 的口径分裂）', () => {
  // 案源：runner 用 `?? 24` 并注明「0 是合法值＝关闭升格」，/api/attn 用 `|| 24`。
  // 把 闸值.人闸超时小时 设成 0：runner 按「关闭」执行，/api/attn 仍按 24 判逾期并标红——
  // **两边口径打架，界面照常显示，无任何提示**。抽成一处不是为省字，是让第三处不可能再各写一遍。
  const gr = require('../lib/gatereg');
  assert.equal(gr.逾期阈值({}), 24, '缺省 24');
  assert.equal(gr.逾期阈值({ 闸值: { 人闸超时小时: 0 } }), 0, '**0 是合法值**——|| 会把它吃成 24');
  assert.equal(gr.逾期阈值({ 闸值: { 人闸超时小时: 8 } }), 8);
  assert.equal(gr.逾期阈值({ 闸值: { 人闸超时小时: 'abc' } }), 24, '坏值回落缺省，不许算出 NaN');
  // 只禁「**取值**读法」，不禁键名本身——参数页写口白名单 ALLOW 里必须有这个键，那是该有的。
  // 判据要盯的是「有没有第二处自己解释 ?? / || 的地方」，不是「这七个字出现过几次」。
  const 直读 = [runner, server].join(String.fromCharCode(10))
    .match(/人闸超时小时\s*(\?\?|\|\|)/g) || [];
  assert.deepEqual(直读, [], `不许再有第二处自解释取值（实测 ${直读.length} 处：${直读.join('、')}）`);
  assert.match(runner, /gatereg'\)\.逾期阈值\(cfg\)/, 'runner 走唯一口');
  assert.match(server, /gr\.逾期阈值\(cfg\)/, 'server 走唯一口');
});

t('活体自证版本：形状备注（真判据已搬到 liveproof / deploy-verify，这里不再算数）', () => {
  // 案源：换装脚本的验活只 GET /api/config 看有没有回；当日确认新代码真进了包，
  // 靠的是 grep 活体解包出来的 app.asar 二进制——那不该是常规手段。
  //
  // **本格已被降级为形状备注（2026-08-22 体检 #56）**。原样是下面这一串 assert.match：
  // 复核实测把 server.js 的 `版本: require('./package.json').version` 改成写死的 '0.27.0'，
  // 五条断言仍全绿——它只问「源码里出现过 package.json.version 这几个字」，
  // 不问「端点回的是不是真版本号」。而换装断言就靠那个数，它一撒谎旧版就能冒充新版过关。
  //
  // 真判据现在有两处，都真跑：
  //   · test/liveproof.test.js —— 真起服务打 /api/version，比真版本号 + 真码印；
  //   · test/deploy-verify.test.js —— 把换装.ps1 的验活块原文对着桩服务真跑，看退出码。
  assert.match(server, /app\.get\('\/api\/version'/, '要有版本端点（形状备注）');
  const ps = fs.readFileSync(path.join(__dirname, '..', '换装.ps1'), 'utf8');
  assert.match(ps, /api\/version/, '换装脚本要取它（形状备注）');
  for (const f of ['liveproof.test.js', 'deploy-verify.test.js']) {
    assert.ok(fs.existsSync(path.join(__dirname, f)),
      `${f} 不见了——本格是备注不是判据，它没了就等于版本自证又回到零行为判据状态`);
  }
});

Promise.all(参数页实测).then(() => {
  console.log('  ✓ 参数页闸门·行为面实测（真跑 viewParams）'); passed++;
  console.log('全部通过：' + passed + ' 项');
}).catch((e) => { console.error('  ✗ 参数页闸门·行为面：' + e.message); process.exit(1); });
