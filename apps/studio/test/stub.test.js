// stub.test.js — 官方桩闸 STUDIO_STUB + 台账两类事件落盘（施工令-039）
// 锁死四件事：①置位时派发面/外呼面全哑且 /api/runner 恒报桩台 ②不置位时逐位不变
//            ③派单委托/定稿放行两类事件真落盘读回 ④委托事由 30 分钟窗配对生效
//
// 两态为什么用子进程：server.js 的桩闸在模块求值期一次性生效，require 缓存只有一份，
// 同进程里换 env 再 require 拿到的还是第一次的结果——两态必须各自一个干净进程。
//
// 不置位那一态**只做模块级取证，绝不起服务**：不置位 = 真执行器，server.start() 会立刻
// runner.start → startLoop → 同步跑一次真 tick（037 首启真派发 40s 事故正是这条路）。
// 「不置位行为逐位不变」的可证命题是「桩闸整块不执行」，起服务不是必要条件，也不值那个风险。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pmLedger = require('../lib/pm/ledger');
const chain = require('../lib/pm/chain');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('官方桩闸 + 台账事件落盘测试（施工令-039）');

const SERVER = path.join(__dirname, '..', 'server.js');
const 模块 = (...p) => JSON.stringify(path.join(__dirname, '..', 'lib', ...p));

// 子进程里求值 server.js 并回报现场。只 require 不 start——require 本身不监听端口、不派发。
// 表达式可返回 Promise，统一 await 后回传。
function 探(env, 表达式) {
  const code = `
    require(${JSON.stringify(SERVER)});
    const r = require(${模块('runner')});
    const q = require(${模块('quota')});
    const np = require(${模块('netprobe')});
    const b = require(${模块('pm', 'brain')});
    Promise.resolve((${表达式}))
      .then((v) => { process.stdout.write('@@' + JSON.stringify(v) + '@@'); process.exit(0); })
      .catch((e) => { process.stdout.write('@@' + JSON.stringify({ __错: String(e && e.message) }) + '@@'); process.exit(0); });
  `;
  const out = execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000,
  });
  const v = JSON.parse(out.split('@@')[1]);
  if (v && v.__错) throw new Error('子进程求值失败：' + v.__错);
  return v;
}
// 桩台工作区：配置齐全（否则 initError 挡住 /api/runner），零工单（第二道保险）
function 桩台仓() {
  const root = makeRoot();
  const p = path.join(root, 'studio.config.json');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  c.执行器 = { ...(c.执行器 || {}), 派发制: true };
  fs.writeFileSync(p, JSON.stringify(c), 'utf8');
  return root;
}
const 派发面 = ['start', 'stop', 'stopLoop', 'startLoop', 'tick', 'startWork', 'killTicket'];
const 脑面 = ['draftTicket', 'cut', 'closeout', 'answer', 'adjudicateReferral'];

/* ===================== 一、桩闸置位：派发面与外呼面全哑 ===================== */

t('①置位：runner 派发面整族被换成空转（start/stop/stopLoop/startLoop/tick/startWork/killTicket）', () => {
  const 名 = 探({ STUDIO_STUB: '1', STUDIO_ROOT: 桩台仓() }, `${JSON.stringify(派发面)}.map((k) => r[k].name)`);
  assert.deepEqual(名, 派发面.map(() => '桩台空转'));
});

t('①置位：tick / startWork 调了也不派发——返回「什么都没发生」，running 表始终空', () => {
  const v = 探({ STUDIO_STUB: '1', STUDIO_ROOT: 桩台仓() },
    `(async () => ({ tick: await r.tick('x', {}), 起工: await r.startWork('x', {}, {}, 'a', '执行'), 在跑: r.running.size }))()`);
  assert.equal(v.tick.skipped, true);
  assert.match(v.tick.reason, /桩台模式：派发面已硬关/);
  assert.equal(v.起工, false, 'startWork 竟报起工成功');
  assert.equal(v.在跑, 0, '桩台竟拉起了会话');
});

t('①置位：外呼面停用——额度查询恒空、连通探测恒空、项管脑五入口全哑', () => {
  const v = 探({ STUDIO_STUB: '1', STUDIO_ROOT: 桩台仓() }, `(async () => ({
    额度: await q.getRateLimits({}), 用量: await q.getClaudeUsage({}), 原始: await q.queryRateLimits(),
    闸: await q.checkGate({}),
    探针: await np.探(''), 原始探针: await np.httpProbe('http://x', null),
    脑: ${JSON.stringify(脑面)}.map((k) => b[k].name),
  }))()`);
  assert.equal(v.额度, null); assert.equal(v.用量, null); assert.equal(v.原始, null);
  assert.equal(v.闸.allowed, false, '桩台额度闸竟放行');
  assert.match(v.闸.reason, /桩台模式/);
  assert.deepEqual(v.探针, { 直连: null, 经代理: null });
  assert.equal(v.原始探针, null);
  assert.deepEqual(v.脑, 脑面.map(() => '桩台空转'), '项管脑外呼未停用（每个入口都 spawn 一次 claude CLI）');
});

// 池衡余额外呼（H99 · 施工令-045）：deepseek 系的 /user/balance 是真 HTTP 请求，桩台一律不发。
// 顺带锁死一条**调用路径**：采集必须经 module.exports.探余额 调，模块内局部直调会从桩闸旁边溜过去
// （037/038 两起「手搓漏面」事故正是这一型）——所以这里断言的是 采集 的产物，不只是导出名。
function 按量池仓() {
  const root = 桩台仓();
  const p = path.join(root, 'studio.config.json');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  c.执行池.deepseek = { 阈值: 70, 周阈值: 90, 兼容: { base: 'https://api.deepseek.com/anthropic', key: 'sk-stub-key-0000' } };
  fs.writeFileSync(p, JSON.stringify(c), 'utf8');
  return root;
}
t('①置位：池衡余额外呼停用，且采集经导出面调用——三池读数全报盲区，绝不编数', () => {
  const root = 按量池仓();
  const v = 探({ STUDIO_STUB: '1', STUDIO_ROOT: root }, `(async () => {
    const pb = require(${模块('pm', 'poolbalance')});
    const cfg = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(root, 'studio.config.json'))}, 'utf8'));
    return { 名: pb.探余额.name, 读数: await pb.采集(${JSON.stringify(root)}, cfg) };
  })()`);
  assert.notEqual(v.名, '探余额', '桩台下 探余额 竟还是原厂函数');
  for (const 池 of ['claude', 'codex', 'deepseek']) {
    assert.equal(v.读数[池].盲区, true, `${池} 竟在桩台下报出了读数`);
    assert.equal(v.读数[池].可用度, null, `${池} 盲区却带着可用度数字——编数就是撒谎`);
  }
});

t('①置位：项管脑被调时回调按「桩台不作业」回，不静默丢掉调用方', () => {
  const v = 探({ STUDIO_STUB: '1', STUDIO_ROOT: 桩台仓() },
    `new Promise((res) => b.draftTicket('x', {}, '需求', null, (r) => res(r)))`);
  assert.equal(v.ok, false);
  assert.match(v.error, /桩台模式/);
});

/* ===================== 二、桩闸不置位：逐位不变 ===================== */

t('②不置位：桩闸整块不执行——派发面/项管脑/探针全是原厂函数，一个都没被换', () => {
  const v = 探({ STUDIO_ROOT: 桩台仓() }, `({
    派发: ${JSON.stringify(派发面)}.map((k) => r[k].name),
    脑: ${JSON.stringify(脑面)}.map((k) => b[k].name),
    探针: np.探.name,
  })`);
  assert.deepEqual(v.派发, 派发面, '派发面被动了（不置位必须逐位不变）');
  assert.deepEqual(v.脑, 脑面);
  assert.equal(v.探针, '探');
});

t('②开关只认精确的 "1"——STUDIO_STUB=0/true/空 一律按不置位（半开状态最骗人）', () => {
  for (const val of ['0', 'true', '']) {
    const n = 探({ STUDIO_STUB: val, STUDIO_ROOT: 桩台仓() }, 'r.tick.name');
    assert.equal(n, 'tick', `STUDIO_STUB=${JSON.stringify(val)} 不该开闸`);
  }
});

/* ===================== 三、桩台起服务：/api/runner 恒哑 ===================== */

t('③桩台起服务实测：/api/runner 报 桩台:true 运行:false，点启动也起不来，执行器状态没被写脏', () => {
  const root = 桩台仓();
  const port = 4931;
  // 收尾用 srv.close() 让事件循环自然排空，不用 process.exit——服务还在监听时硬退，
  // Windows 上 libuv 会 abort（UV_HANDLE_CLOSING 断言），断言全过了却报进程崩，白查一轮。
  const code = `
    require(${JSON.stringify(SERVER)}).start().then(async ({ server: srv }) => {
      const j = async (u, m) => (await fetch('http://127.0.0.1:${port}' + u, m ? { method: m } : undefined)).json();
      const 查 = await j('/api/runner');
      const 点 = await j('/api/runner/start', 'POST');   // 主动点「启动执行器」
      process.stdout.write('@@' + JSON.stringify({
        查: { 桩台: 查.桩台, 运行: 查.运行, 执行中: (查.执行中 || []).length, 拦截: 查.桩台拦截 },
        点: { 桩台: 点.桩台, 运行: 点.运行, 拦截: 点.桩台拦截 },
      }) + '@@');
      srv.close();
    });
  `;
  const out = execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, STUDIO_STUB: '1', STUDIO_ROOT: root, STUDIO_PORT: String(port) },
    encoding: 'utf8', timeout: 60000,
  });
  assert.match(out, /桩台模式（STUDIO_STUB=1）：零派发零计费/, '启动横幅未打出——桩台与实弹台就靠这行分辨');
  const v = JSON.parse(out.split('@@')[1]);
  assert.equal(v.查.桩台, true);
  assert.equal(v.查.运行, false);
  assert.equal(v.查.执行中, 0);
  assert.equal(v.点.桩台, true);
  assert.equal(v.点.运行, false, '桩台下点启动竟报运行中');
  // 拦截簿可见：服务开工那一次 runner.start 确实被调过，也确实被拦下了（037 就毁在这层不可见）
  assert.ok(v.查.拦截.includes('start'), '服务开工的 runner.start 没进拦截簿：' + JSON.stringify(v.查.拦截));
  assert.ok(v.点.拦截.filter((x) => x === 'start').length >= 2, '点启动那一次没进拦截簿：' + JSON.stringify(v.点.拦截));
  // 派发面没动过盘：runner.start 会把 执行器.运行 写成 true，桩台下这一笔必须不存在
  let st = {}; try { st = JSON.parse(fs.readFileSync(path.join(root, '.studio-state.json'), 'utf8')); } catch { /* 没这文件更好 */ }
  assert.notEqual((st.执行器 || {}).运行, true, '桩台竟把执行器状态写成了运行中');
});

/* ===================== 三′、H108 三大态：/api/board 下发 12 态 + 大态分组 ===================== */
// STUB 只验**接口形状**（前端 G 组吃这个形状画看板三组），不当派发链路判据——链路归执行器组。

t("③'H108/H116 /api/board 真起 STUB 服务打一遍：13 态齐全 + 大态:{待办/在途/结束} 分组表下发", () => {
  const store = require('../lib/core/store');
  const root = 桩台仓();
  seed(root, '待派', { id: 'B-1', 放行: true });
  seed(root, '完成', { id: 'B-2' });
  const port = 4932;
  const code = `
    require(${JSON.stringify(SERVER)}).start().then(async ({ server: srv }) => {
      const j = await (await fetch('http://127.0.0.1:${port}/api/board')).json();
      process.stdout.write('@@' + JSON.stringify(j) + '@@');
      srv.close();
    });
  `;
  const out = execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, STUDIO_STUB: '1', STUDIO_ROOT: root, STUDIO_PORT: String(port) },
    encoding: 'utf8', timeout: 60000,
  });
  const v = JSON.parse(out.split('@@')[1]);
  assert.deepEqual(v.states, store.STATES, 'states 必须与 store.STATES 全同（13 态）');
  assert.equal(v.states.length, 13, '十三态一个不许少（H116 补 已排期）');
  assert.ok(v.states.includes('已排期'), 'H116：已排期 必在下发态表里');
  assert.deepEqual(v.大态, store.大态, '大态分组表必须原样下发 store.大态（前端不许自己抄分组）');
  assert.deepEqual(Object.keys(v.大态), ['待办', '在途', '结束'], '三大组齐且序稳');
  assert.deepEqual([...v.大态.待办, ...v.大态.在途, ...v.大态.结束].sort(), [...store.STATES].sort(),
    '三组并起来恰是 13 态——漏一态就是看板上凭空消失一列');
  assert.deepEqual(Object.keys(v.board).sort(), [...store.STATES].sort(), 'board 每态一键');
  assert.deepEqual(v.board.待派.map((x) => x.id), ['B-1'], '待派列真下发了铺的单');
  assert.deepEqual(v.board.完成.map((x) => x.id), ['B-2'], '完成列真下发了铺的单');
});

/* ===================== 四、台账两类事件：真落盘、读得回 ===================== */
// 案源：两处 require 指错模块（lib/ledger 只有 commitStudio），TypeError 被空 catch 吞掉，
// 现网 事件.jsonl 570 行零命中一个月无人发现。锁死「属主对 + 落盘 + 读回 + 不再吞异常」。

t('④错指那一步会真抛：lib/ledger 没有 event，lib/pm/ledger 才是事件属主', () => {
  assert.equal(typeof require('../lib/ledger').event, 'undefined', 'lib/ledger 不该有 event');
  assert.equal(typeof pmLedger.event, 'function', 'lib/pm/ledger 必须是事件属主');
  assert.throws(() => require('../lib/ledger').event(makeRoot(), '派单委托', {}), TypeError);
});

t('④派单委托 + 定稿放行：落盘后 events() 读得回，字段完整且真在 事件.jsonl 里', () => {
  const root = makeRoot();
  pmLedger.event(root, '派单委托', { 需求: '流程页把在跑核查会话的单也算作现在在做' });
  pmLedger.event(root, '定稿放行', { 单: 'TK-201' });
  const evs = pmLedger.events(root, 50);
  const 委托 = evs.find((e) => e.类型 === '派单委托');
  const 放行 = evs.find((e) => e.类型 === '定稿放行');
  assert.ok(委托, '派单委托未落盘');
  assert.ok(放行, '定稿放行未落盘');
  assert.match(委托.需求, /核查会话/);
  assert.equal(放行.单, 'TK-201');
  assert.ok(Date.parse(委托.t), '事件缺时间戳');
  const 盘 = fs.readFileSync(path.join(root, '项管台账', '事件.jsonl'), 'utf8');
  assert.match(盘, /派单委托/); assert.match(盘, /定稿放行/);
});

t('④server.js 源码里不再有错指 lib/ledger 的 .event 调用，两类事件都走统一出口', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  // 先剥注释再扫——本次修复的说明里原样引了那个坏写法当案源，块注释里那行不算代码
  const 代码 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, '');
  const 坏 = 代码.split(/\r?\n/).filter((l) => /require\(['"]\.\/lib\/ledger['"]\)\s*\.\s*event/.test(l));
  assert.deepEqual(坏, [], '仍有错指 lib/ledger 的事件调用：' + 坏.join(' | '));
  assert.match(src, /记事件\('派单委托'/, '派单委托未走统一出口');
  assert.match(src, /记事件\('定稿放行'/, '定稿放行未走统一出口');
});

t('④空 catch 不再吞异常：记事件 失败分支 console + journal 双留痕（错一个月没人发现的根因）', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  const m = src.match(/function 记事件[\s\S]*?\n}/);
  assert.ok(m, '未找到 记事件 统一出口');
  assert.match(m[0], /console\.error/, '失败分支没有 console 留痕');
  assert.match(m[0], /journal\.append/, '失败分支没有 journal 留痕');
});

/* ===================== 五、委托事由配对：037 的链条随之生效 ===================== */

const 写事件 = (root, 行) => {
  const p = path.join(root, '项管台账', '事件.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 行.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
};
const 基 = Date.parse('2026-08-09T19:00:00+08:00');
const iso = (分) => new Date(基 + 分 * 60000).toISOString();

t('⑤委托事由配对生效：起草站从「项管单张起草」套话变成真实委托事由摘要', () => {
  const root = makeRoot();
  const id = seed(root, '在途', { id: 'TK-301', title: '流程页现在区判据', 主办: '程序' });
  // 修好之后的现实时序：/api/pm/draft 先落 派单委托（此刻单号还没生出来），起草完成才有 单张待审
  写事件(root, [
    { t: iso(0), 类型: '派单委托', 需求: '流程页把在跑核查会话的单也算作现在在做，别塞进等你签字' },
    { t: iso(6), 类型: '待审', 单: id, 起草: '单张' },
  ]);
  const 卡 = chain.汇总(root, { 事件窗: 300 }).链.find((c) => c.id === id);
  assert.ok(卡, '关键汇报里没有这张单');
  const 起草站 = 卡.链.find((x) => x.站 === '起草');
  assert.ok(起草站, '缺起草站');
  assert.match(起草站.因, /^委托事由：/, '起草站没吃到委托事由，仍是套话：' + 起草站.因);
  assert.match(起草站.因, /核查会话/);
});

t('⑤对照：没有 派单委托 事件时仍是「项管单张起草」套话——证明上一例的差异确由本修复带来', () => {
  const root = makeRoot();
  const id = seed(root, '在途', { id: 'TK-303', title: '同样一张单', 主办: '程序' });
  写事件(root, [{ t: iso(6), 类型: '待审', 单: id, 起草: '单张' }]);
  const 卡 = chain.汇总(root, { 事件窗: 300 }).链.find((c) => c.id === id);
  const 起草站 = 卡.链.find((x) => x.站 === '起草');
  assert.ok(起草站, '缺起草站');
  assert.equal(起草站.因, '项管单张起草（H57 派单委托）');
});

t('⑤配不上就不写：派单委托 超出 30 分钟窗的，绝不给错单挂错事由', () => {
  const root = makeRoot();
  const id = seed(root, '在途', { id: 'TK-302', title: '不相干的单', 主办: '程序' });
  写事件(root, [
    { t: iso(0), 类型: '派单委托', 需求: '一小时前的另一件事' },
    { t: iso(75), 类型: '待审', 单: id, 起草: '单张' },
  ]);
  const 卡 = chain.汇总(root, { 事件窗: 300 }).链.find((c) => c.id === id);
  const 起草站 = 卡.链.find((x) => x.站 === '起草');
  assert.ok(起草站, '缺起草站');
  assert.ok(!/^委托事由：/.test(起草站.因 || ''), '超窗竟也配上了：' + 起草站.因);
});

console.log('全部通过：' + passed + ' 项');
