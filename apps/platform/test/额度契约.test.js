// 额度闸契约测试（协-018）—— 订阅窗口这道闸的判据与接线。
//
// 两半各测各的：
//   · 判定半（lib/额度闸.js）：纯函数，快照进、挡 map 出。判定本体是 packages/quota.gateOf，
//     所以这里**不重测包**（那是它自己 16 项的事），只测我方补的那些口径：
//     claude 双窗归一、按计费模式分闸、盲区、过期读数不锁池。
//   · 取数半（lib/额度取数.js）：有 child_process，只准执行器持有。这里测**隔离**，
//     不测真取数——真取数要拉起 codex app-server / 发 OAuth 请求，那是实跑不是断言。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const 额度闸 = require('../lib/额度闸');
const 派单 = require('../lib/派单');
const 公用件 = require('../lib/公用件');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('额度闸契约测试');

const 平台根 = path.resolve(__dirname, '..');
const 包 = 公用件.载入('quota', 'quota.js');

// 出厂形状的配置骨架：三个池各一种计费模式，正好覆盖「谁受本闸管」的三条分支。
const 基配 = () => ({
  providers: {
    codex: { adapter: 'codex-cli' },
    claude: { adapter: 'claude-cli' },
    echo: { adapter: 'command-cli' },
  },
  计费: { codex: { 模式: '订阅' }, claude: { 模式: '订阅' }, echo: { 模式: '本地' } },
  quota: { gatePercent: 80, costBufferPercent: 30, weeklyGatePercent: 90 },
});

// 时间一律注入，不读真实时钟：判定里有「读数多久了」「重置时刻过了没」两处比时间，
// 用真实时钟的话这些断言会在某些时刻自己变红，而红的是测试不是代码。
const 现在 = Date.parse('2026-08-23T12:00:00Z');
const 时刻 = (分前) => new Date(现在 - 分前 * 60000).toISOString();

// ---- 归一：claude 双窗进 gateOf ----
// 这是**我方补的口径**，不是包里的东西：gateOf 读 rl.primary/secondary（codex 形状），
// claude 快照是 {fiveHour, sevenDay}。不归一的话 claude 池根本进不了判定，
// 而表现是「claude 永远不被额度锁」——跟「claude 额度充足」长得一模一样。
t('claude 双窗归一成 gateOf 认得的形状，且窗口 label 不说错话', () => {
  const rl = 额度闸.归一({
    形态: 'claude',
    usage: { fiveHour: { utilization: 42, resets_at: '2026-08-23T15:00:00Z' }, sevenDay: { utilization: 88, resets_at: '2026-08-27T00:00:00Z' } },
  });
  assert.equal(rl.primary.usedPercent, 42);
  assert.equal(rl.secondary.usedPercent, 88);
  // label 由包按 windowDurationMins 自报值算（施工令-010 窗口正名），我方只负责把时长填对
  assert.equal(包.windowLabel(rl.primary), '5小时');
  assert.equal(包.windowLabel(rl.secondary), '周');
});

t('只有周窗读得到时，把它放 primary——不白丢一条读得到的读数', () => {
  // gateOf 缺 primary 就直接 fail-open。若照原位放进 secondary，
  // 一条 95% 的周窗读数会被当成「查询不可用」放行，那是把已知当未知。
  const rl = 额度闸.归一({ 形态: 'claude', usage: { sevenDay: { utilization: 95, resets_at: '2026-08-27T00:00:00Z' } } });
  assert.equal(rl.primary.usedPercent, 95);
  assert.equal(包.windowLabel(rl.primary), '周');
  assert.equal(rl.secondary, null);
});

t('codex 快照原样递进去（它本来就是 gateOf 的形状）', () => {
  const rl0 = { primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1786243868 } };
  assert.deepEqual(额度闸.归一({ 形态: 'codex', rl: rl0 }), rl0);
  assert.equal(额度闸.归一({ 形态: 'codex', rl: null }), null);
  assert.equal(额度闸.归一(null), null);
});

// ---- 按计费模式分闸 ----
t('只管订阅池：api 池归预算闸、本地池不管、未声明不硬造窗口', () => {
  const cfg = 基配();
  cfg.计费.codex = { 模式: 'api' };
  delete cfg.计费.claude;                     // 未声明
  const r = 额度闸.判(cfg, null, { 现在 });
  const of = (池) => r.明细.find((m) => m.池 === 池);
  assert.equal(of('codex').适用, false, 'api 池不该进额度闸——它没有会重置的窗口');
  assert.equal(of('echo').适用, false, '本地池根本没有厂商额度');
  assert.equal(of('claude').适用, false, '未声明计费模式时无从判断窗口，本闸不管（真跑前由计费闸拦）');
  assert.deepEqual(r.挡, {});
});

// ---- 判定：越线就锁，且理由来自包 ----
t('订阅池主窗越线 → 挡，且理由逐字来自 packages/quota.gateOf', () => {
  const cfg = 基配();
  const 快照 = { 更新于: 时刻(1), 池: { codex: { 形态: 'codex', 取于: 时刻(1),
    rl: { primary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: '2026-08-24T00:00:00Z' } } } } };
  const r = 额度闸.判(cfg, 快照, { 现在 });
  const 期 = 包.gateOf(快照.池.codex.rl, cfg);
  assert.equal(期.allowed, false, '前提：77% ≥ 拦截线 70%（min(80, 100−30)）');
  assert.equal(r.挡.codex, 期.reason, '判定不分叉——理由必须是包给的那一句，不许我方另写一套说辞');
  assert.ok(!('claude' in r.挡), '没有读数的池不该被锁');
});

t('claude 池经归一后同样会被锁（不归一的话它永远锁不上）', () => {
  const cfg = 基配();
  const 快照 = { 更新于: 时刻(1), 池: { claude: { 形态: 'claude', 取于: 时刻(1),
    usage: { fiveHour: { utilization: 91, resets_at: '2026-08-23T17:00:00Z' } } } } };
  const r = 额度闸.判(cfg, 快照, { 现在 });
  assert.ok(r.挡.claude, 'claude 双窗必须能进判定：' + JSON.stringify(r.明细));
  assert.match(r.挡.claude, /5小时/, '窗口 label 要说真窗口，不能说成周');
});

t('没越线就放行，窗口读数照样摆出来（可派 ≠ 没数）', () => {
  const cfg = 基配();
  const 快照 = { 更新于: 时刻(1), 池: { codex: { 形态: 'codex', 取于: 时刻(1),
    rl: { primary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: '2026-08-24T00:00:00Z' } } } } };
  const r = 额度闸.判(cfg, 快照, { 现在 });
  assert.deepEqual(r.挡, {});
  const m = r.明细.find((x) => x.池 === 'codex');
  assert.equal(m.挡, false);
  assert.equal(m.窗口[0].pct, 20);
});

// ---- 盲区：读不到就放行，但必须被看见 ----
// 这是本闸最要紧的一条。fail-open 是包的红线（守门查不着不能反过来卡死管线），
// 而 fail-open 的**代价**是这段时间没有任何刹车——所以每一次放行都要留在 盲区 里。
// 「没有池被锁」有两种成因：真的都没超 / 根本没读到数。不区分就是把不知道显示成充足。
t('没有快照 → 全部订阅池 fail-open，且每个都进盲区', () => {
  const r = 额度闸.判(基配(), null, { 现在 });
  assert.deepEqual(r.挡, {});
  assert.deepEqual(r.盲区.map((b) => b.池).sort(), ['claude', 'codex']);
  assert.ok(r.盲区.every((b) => b.因), '盲区必须带因——只说「不可用」等于让人自己去猜');
});

t('读数太旧（超过弃用线）→ 当读不到处理，进盲区', () => {
  const cfg = 基配();
  cfg.quota.快照弃用秒 = 3600;
  const 快照 = { 池: { codex: { 形态: 'codex', 取于: 时刻(120),
    rl: { primary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: '2026-08-24T00:00:00Z' } } } } };
  const r = 额度闸.判(cfg, 快照, { 现在 });
  assert.deepEqual(r.挡, {}, '两小时前的读数不该继续锁池');
  assert.match(r.盲区.find((b) => b.池 === 'codex').因, /太旧/);
});

t('陈旧但未弃用 → 照判，但盲区里要说它偏旧了', () => {
  const cfg = 基配();
  cfg.quota.快照最长秒 = 900; cfg.quota.快照弃用秒 = 3600;
  const 快照 = { 池: { codex: { 形态: 'codex', 取于: 时刻(30),
    rl: { primary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: '2026-08-24T00:00:00Z' } } } } };
  const r = 额度闸.判(cfg, 快照, { 现在 });
  assert.equal(r.明细.find((m) => m.池 === 'codex').陈旧, true);
  assert.match(r.盲区.find((b) => b.池 === 'codex').因, /偏旧/);
});

t('读数指向的重置时刻已经过去 → 不拿过期读数锁池', () => {
  // 窗口早已重置，这份快照描述的是**上一个**窗口。拿它锁池的表现是
  // 「派不出去，也没人说得清为什么」——而真相是那个 100% 早就归零了。
  const cfg = 基配();
  const 快照 = { 池: { codex: { 形态: 'codex', 取于: 时刻(5),
    rl: { primary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: '2026-08-23T06:00:00Z' } } } } };
  const r = 额度闸.判(cfg, 快照, { 现在 });
  assert.deepEqual(r.挡, {});
  assert.match(r.盲区.find((b) => b.池 === 'codex').因, /重置时刻/);
});

t('gatePercent 显式为 0 = 关闸（连判都不判）', () => {
  const cfg = 基配(); cfg.quota.gatePercent = 0;
  const r = 额度闸.判(cfg, { 池: { codex: { 形态: 'codex', 取于: 时刻(1), rl: { primary: { usedPercent: 99 } } } } }, { 现在 });
  assert.equal(r.关闸, true);
  assert.deepEqual(r.挡, {});
});

// ---- 接线：并进同一个 挡 map ----
t('额度冻结并进 派单.冻结情况 的 挡——池序降级三处零额外接线', () => {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), '额度闸-'));
  fs.mkdirSync(path.join(临, 'journal'), { recursive: true });
  fs.writeFileSync(path.join(临, 'journal', '额度快照.json'), JSON.stringify({
    更新于: new Date().toISOString(),
    池: { codex: { 形态: 'codex', 取于: new Date().toISOString(),
      rl: { primary: { usedPercent: 96, windowDurationMins: 10080, resetsAt: new Date(Date.now() + 864e5).toISOString() } } } },
  }), 'utf8');
  const 冻 = 派单.冻结情况(公用件, 基配(), 临);
  assert.equal(冻.ok, true, '额度闸不该影响预算闸的 ok（两道闸失效方向刻意相反）');
  assert.ok(冻.挡.codex, '越线的订阅池必须出现在 挡 里：' + JSON.stringify(冻));
  assert.match(冻.挡.codex, /额度闸/, '要标明是哪道闸挡的——两道闸的解法完全不同');
  fs.rmSync(临, { recursive: true, force: true });
});

t('现场回放：token 超线但订阅窗口可信且仅 4% 时，只警戒不冻结', () => {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), '额度闸-现场-'));
  try {
    const cfg = 基配();
    cfg.预算 = { 池: { codex: { 日token: 100 } } };
    const budget = 公用件.载入('budget', 'budget.js');
    budget.记(临, { 池: 'codex', 单: 'HW-6', 输入: 200, 输出: 1, t: new Date().toISOString() });
    fs.mkdirSync(path.join(临, 'journal'), { recursive: true });
    fs.writeFileSync(path.join(临, 'journal', '额度快照.json'), JSON.stringify({
      更新于: new Date().toISOString(),
      池: { codex: { 形态: 'codex', 取于: new Date().toISOString(),
        rl: { primary: { usedPercent: 4, windowDurationMins: 300, resetsAt: new Date(Date.now() + 3600e3).toISOString() },
          secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: new Date(Date.now() + 86400e3).toISOString() } } } },
    }), 'utf8');
    const 冻 = 派单.冻结情况(公用件, cfg, 临);
    assert.ok(!冻.挡.codex, '可信窗口只有 4%，token 口径差不该独立否决：' + JSON.stringify(冻));
    assert.equal(冻.警戒.length, 1);
    assert.match(冻.警戒[0].说, /5小时 4%.*周 60%.*未越线/);
  } finally { fs.rmSync(临, { recursive: true, force: true }); }
});

t('额度闸失效不阻断派单（fail-open），与预算闸失效的 503 方向相反', () => {
  // 预算闸读不到数 → 真跑前提 503 拒跑（钱的事）。额度闸读不到 → 照跑（订阅窗口的事）。
  // 这两个方向必须都被钉住：合并成一个 ok 的那天，其中一个就会悄悄变成另一个。
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), '额度闸-'));
  const 冻 = 派单.冻结情况(公用件, 基配(), 临);
  assert.equal(冻.ok, true);
  assert.equal(派单.真跑前提(冻).准, true, '没有额度读数不该拦住真跑');
  assert.ok(冻.额度.盲区.length, '但盲区要如实报出来');
  fs.rmSync(临, { recursive: true, force: true });
});

// ---- 隔离：取数不许进 server 的闭包 ----
t('lib/额度取数.js 引 child_process，server.js 的闭包里碰不到它', () => {
  const 取数源 = fs.readFileSync(path.join(平台根, 'lib', '额度取数.js'), 'utf8');
  assert.match(取数源, /require\('child_process'\)/, '前提：取数确实要起进程（codex app-server）');
  // 闭包本身由 接线契约.test.js 那条传递闭包断言守着；这里守的是**别名洞**——
  // 有人图省事在判定件里 require 取数件，闭包断言会红，但红在哪一行不明显。
  const 闸源 = fs.readFileSync(path.join(平台根, 'lib', '额度闸.js'), 'utf8');
  assert.ok(!/require\(['"]\.\/额度取数/.test(闸源), '判定件不得引取数件——那会把 child_process 拖进 server 的闭包');
  const 服务源 = fs.readFileSync(path.join(平台根, 'server.js'), 'utf8');
  assert.ok(!/额度取数/.test(服务源.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')),
    'server.js 不得提及取数件：取数归执行器，server 只读它落下的快照');
});

t('取数件被执行器持有（否则快照永远不会被写出来）', () => {
  const 执源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.match(执源, /额度取数/, '执行器是唯一被允许起进程的地方，取数必须住在它这边');
  assert.match(执源, /取一轮/, '要有定期取数，否则快照只会有开机那一份，很快就过弃用线');
});

t('取数口按 adapter 认，不按池名认', () => {
  // 按名认是踩过的坑：studio 的 resolveCli 只把恰好叫 codex 的池路由到 codex CLI，
  // 于是 codex-key 静默走了另一条路。池名是人起的，adapter 才是「它到底是哪家」。
  const 取数 = require('../lib/额度取数');
  const cfg = { providers: { 我随便起的名: { adapter: 'codex-cli' }, codex: { adapter: 'command-cli' } } };
  assert.equal(取数.取数口(cfg, '我随便起的名').形态, 'codex');
  assert.equal(取数.取数口(cfg, 'codex'), null, '叫 codex 但 adapter 是 command-cli 的池，不该被当成 codex');
});

t('公用件消费面：额度闸走 lib/公用件，不自抄第二份解析', () => {
  const 闸源 = fs.readFileSync(path.join(平台根, 'lib', '额度闸.js'), 'utf8');
  assert.match(闸源, /require\('\.\/公用件'\)/);
  assert.ok(!/\.\.\/\.\.\/\.\.\/packages/.test(闸源), '公用件消费只有 lib/公用件 一个入口——同一个约定写两遍就会漏改一遍');
});

console.log('全部通过：' + passed + ' 项');
