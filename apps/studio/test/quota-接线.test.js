// quota-接线.test.js — 额度解读件的**消费方接线**测试（施工令-059 本体归位后拆出）
//
// 分工：`packages/quota/test.js` 证明本包自己的输出形状（零 app 依赖，那是入包条件）；
// 本文件证明 **studio 这边接得住**——壳转发的是真包（不是复制品）、gates 拿包里的窗口去锁池、
// 三候选兜底与失效响亮化（照 046 先例）在这一侧真的生效。
//
// 既有的 gates.test.js 一字未改，那 9 条本身就是「判定没变」的背书：它们喂的是快照、
// 断的是锁不锁与文案，本令把解析搬进包里之后逐条照过。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// 公用件走仓根 packages/（一仓拓扑）：apps/studio/test → 上三级到仓根
const 包 = require('../../../packages/quota/quota.js');
const quota = require('../lib/quota');
const gates = require('../lib/gates');
const { CFG } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('quota 消费方接线测试（studio 侧）');

const 仓根 = path.resolve(__dirname, '..', '..', '..');
const 死路 = '../../../packages/quota-不存在/quota.js'; // 逼候选①失守用（相对 lib/ 解析）
function 仓(packages路径) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-res-'));
  const cfg = packages路径 === undefined ? {} : { packages路径 };
  fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify(cfg), 'utf8');
  return root;
}
const journal读 = (root) => {
  const dir = path.join(root, 'journal');
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
};

/* ===================== 一、壳转发的是真包，不是复制品 ===================== */

t('七个纯函数逐个同源：壳上拿到的就是 packages/quota 那一份（不是分叉的副本）', () => {
  for (const k of ['windowsOf', 'claudeWindows', 'describe', 'describeClaude', 'fmtReset', 'windowLabel', 'gateOf']) {
    assert.equal(quota[k], 包[k], `quota.${k} 不是包里那一个——壳分叉了，两边会各自演化`);
  }
  // 取数那一半仍留在壳里（有 I/O，不入包）：消费方的 require 路径与调用名一个没变
  for (const k of ['queryRateLimits', 'getRateLimits', 'checkGate', 'queryClaudeUsage', 'getClaudeUsage', 'eagerRefresh', 'getProxyUrl']) {
    assert.equal(typeof quota[k], 'function', `壳少了取数面 ${k}`);
  }
  assert.deepEqual(quota.失效位(), {}, '正常命中时失效位一个字段都不出（返回体逐字节不变）');
});

t('壳里不再有窗口解析的第二实现：源码扫一遍，纯函数体已搬空', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'quota.js'), 'utf8');
  const 代码 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, '');
  for (const 名 of ['windowsOf', 'claudeWindows', 'windowLabel', 'fmtReset', 'describeClaude']) {
    assert.ok(!new RegExp('function\\s+' + 名 + '\\s*\\(').test(代码),
      `壳里还留着 function ${名}——本体该在包里，留一份就是等着两边分叉`);
  }
  assert.ok(!/usedPercent|utilization/.test(代码), '壳里还在读窗口字段：解读归包，取数归壳');
  // 硬编码绝对路径（046 那颗钉子）不许在新壳里复活。盘符前要求是串首/空白/引号/括号——
  // 否则 https:// 里的 "p://" 会误命中（本壳有 OAuth 端点 URL，budget 那边没有）
  const 盘符 = /(^|[\s'"(=])[A-Za-z]:[\\/]/m;
  assert.ok(!盘符.test(src), '壳里出现了盘符绝对路径：' + (src.match(/(^|[\s'"(=])[A-Za-z]:[\\/][^'"\s]*/m) || [])[0]);
});

/* ===================== 二、gates 接得住（判定由包驱动）===================== */

t('gates 的窗口全从包里来：codex 单窗只画一条周条，未知池按 claude 口径走', () => {
  const rl = { primary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: 1786243868 }, secondary: null };
  const l = gates.poolLock(CFG, 'codex', rl, null);
  assert.deepEqual(l.窗口.map((w) => w.label), 包.windowsOf(rl).map((w) => w.label), 'gates 的窗口清单与包的解析必须同源');
  assert.equal(l.locked, true);
  // 未知池名（编制里新加的池还没配阈值）：走 claude 口径读 cu，阈值落默认 70/90，绝不抛
  const cu = { fiveHour: { utilization: 88, resets_at: 0 } };
  const u = gates.poolLock(CFG, '还没配的新池', null, cu);
  assert.equal(u.locked, true, '未知池不该因为没配就恒不锁——默认阈值兜底');
  assert.equal(u.窗口[0].阈值, 70);
  assert.deepEqual(gates.poolLock(CFG, '还没配的新池', null, null).窗口, [], '空快照 → 不摆假窗');
});

t('包坏了 gates 也不炸：解析件失效时窗口为空、fail-open 不锁（代价写在回执里）', () => {
  // 直接把空实现喂给 poolLock 的上游——用失守态的解析结果验行为，不改生产代码
  const m = quota.解析({ 相对: 死路, 环境: path.join(仓根, '不存在的包目录'), 根: 仓('') });
  assert.equal(m.失效, true);
  assert.deepEqual(m.windowsOf({ primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 0 } }), [],
    '空实现的窗口解析必须给空清单（gates 据此不锁，与既有 fail-open 纪律同向）');
  assert.equal(m.gateOf(null, {}).allowed, true);
  assert.match(m.gateOf(null, {}).reason, /失效/, 'fail-open 也要说明白是因为件失效，不能装作一切正常');
});

/* ===================== 三、三候选兜底（照 046 先例）===================== */

t('候选③读 studio.config.json · packages路径命中真包；缺省/空串跳过该候选', () => {
  const root = 仓(path.join(仓根, 'packages'));
  const m = quota.解析({ 相对: 死路, 环境: '', 根: root });
  assert.equal(m, 包, '候选③没解析到真包（require 缓存同源即同对象）');
  assert.equal(m.失效, undefined, '命中时不该带失效位');
  assert.equal(journal读(root), '', '命中时不该往流水里写东西');
  // 相对值按**监制台仓根**解析（打包态的实际形态：包目录搁在仓库旁边，配置里写相对位置）
  const rel = 仓('包们');
  const 假包 = path.join(rel, '包们', 'quota');
  fs.mkdirSync(假包, { recursive: true });
  fs.writeFileSync(path.join(假包, 'quota.js'),
    'module.exports = { windowsOf: () => [{ 假: true }], claudeWindows: () => [], describe: () => [],'
    + ' describeClaude: () => [], fmtReset: () => "", windowLabel: () => "", gateOf: () => ({ allowed: true }) };', 'utf8');
  const 相对命中 = quota.解析({ 相对: 死路, 环境: '', 根: rel });
  assert.deepEqual(相对命中.windowsOf(), [{ 假: true }], '配置里的相对路径没按仓根解析');
  assert.equal(相对命中.失效, undefined);
  for (const v of [undefined, '', '   ']) {
    const bad = quota.解析({ 相对: 死路, 环境: '', 根: 仓(v) });
    assert.equal(bad.失效, true, `packages路径=${JSON.stringify(v)} 竟解析出了东西`);
    assert.match(bad.失败因[2].因, /为空|缺 studio\.config\.json/, '空配置的失败因该明说是空，不该是别的错');
  }
});

t('候选②（TICKETFLOW_PACKAGES）接得住，且命中后轮不到候选③', () => {
  const 中 = quota.解析({ 相对: 死路, 环境: path.join(仓根, 'packages'), 根: 仓('') });
  assert.equal(中, 包);
});

t('形状校验：解析到半截包（缺 gateOf）当场判失败进下一候选，不把瘸腿件接进来', () => {
  const rel = 仓('半截');
  const 半 = path.join(rel, '半截', 'quota');
  fs.mkdirSync(半, { recursive: true });
  fs.writeFileSync(path.join(半, 'quota.js'), 'module.exports = { windowsOf: () => [], claudeWindows: () => [] };', 'utf8');
  const m = quota.解析({ 相对: 死路, 环境: '', 根: rel });
  assert.equal(m.失效, true, '半截包被当成好件接了进来——守门会静默失灵');
  assert.match(m.失败因[2].因, /模块形状不对（缺 .*gateOf.*）/, m.失败因[2].因);
});

t('三候选全失守：落空实现 + journal 留「额度解读件失效」+ 对象带失效位与三条失败因', () => {
  const root = 仓('');
  const m = quota.解析({ 相对: 死路, 环境: path.join(仓根, '不存在的包目录'), 根: root });
  assert.equal(m.失效, true);
  assert.equal(m.失败因.length, 3, '失败因必须逐候选各一条，缺一条就等于瞒了一条线索');
  assert.deepEqual(m.失败因.map((f) => f.候选),
    ['仓内相对', 'TICKETFLOW_PACKAGES 环境变量', 'studio.config.json · packages路径']);
  assert.match(m.失败因[0].因, /quota-不存在|Cannot find module/);
  assert.match(m.失败因[1].因, /不存在的包目录|Cannot find module/);
  // 响亮化第一层：流水留证（控制台那行开机就滚没了）
  const log = journal读(root);
  assert.match(log, /额度解读件失效/, 'journal 没落失效事件——静默失效正是 046 要修的病');
  assert.match(log, /额度锁恒不锁/, '流水里没写清代价，运维不知道这会儿是在裸奔');
  assert.match(log, /仓内相对/, '流水里没带候选失败因，运维照样不知道该修哪一条');
  assert.equal(m.journal, '已落');
  // 响亮化第二层：接口失效位的形状（留给消费方展开，形制照 budget-resolve.失效位）
  assert.deepEqual(quota.失效位(m), { quota失效: true, quota失败因: m.失败因 });
  assert.deepEqual(quota.失效位(包), {}, '正常命中时失效位必须一个字段都不出');
});

/* ===================== 四、子进程实测：失守态与关闸态的真实行为 ===================== */

// 失守态怎么造：子进程里把「仓内相对」那一次 require 拦下——生产代码不留测试后门，
// 拦截写在测试的子进程脚本里（同 stub.test.js / budget-接线.test.js「干净进程」的手法）。
function 探(root, 脚本, 拦包) {
  const code = `
    ${拦包 ? `const Module = require('module');
    const 原 = Module._load;
    Module._load = function (r) {
      if (/packages.quota.quota[.]js$/.test(r)) throw new Error('演练：仓内相对候选强制失守');
      return 原.apply(this, arguments);
    };` : ''}
    const 记 = [];
    const cp = require('child_process');
    const 真spawn = cp.spawn;
    cp.spawn = function (...a) { 记.push(a[0]); return 真spawn.apply(this, a); };
    ${脚本}
  `;
  const out = execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, STUDIO_ROOT: root, TICKETFLOW_PACKAGES: '' }, encoding: 'utf8', timeout: 60000,
  });
  return { 出: out, 值: JSON.parse(out.split('@@')[1]) };
}

t('失守态实测：gates 照常出锁快照（不锁、无窗口），控制台与流水都喊了一嗓子', () => {
  const root = 仓('');
  const rl = JSON.stringify({ primary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: 0 } });
  const r = 探(root, `
    const g = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'gates.js'))});
    const l = g.poolLock({ 执行池: { codex: { 阈值: 70 } } }, 'codex', ${rl}, null);
    process.stdout.write('@@' + JSON.stringify({ locked: l.locked, 窗口: l.窗口, fivePct: l.fivePct }) + '@@');
  `, true);
  assert.equal(r.值.locked, false, '解读件失效时是 fail-open 不锁——这是本令认下的代价，写在回执里');
  assert.deepEqual(r.值.窗口, []);
  assert.equal(r.值.fivePct, null);
  assert.match(journal读(root), /额度解读件失效/, '真进程起来时没往流水落失效事件');
});

t('正常态对照：同一段脚本、同一批快照，包在位时该锁的照锁（差异确由失守带来）', () => {
  const root = 仓(path.join(仓根, 'packages'));
  const rl = JSON.stringify({ primary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: 0 } });
  const r = 探(root, `
    const g = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'gates.js'))});
    const l = g.poolLock({ 执行池: { codex: { 阈值: 70 } } }, 'codex', ${rl}, null);
    process.stdout.write('@@' + JSON.stringify({ locked: l.locked, 窗口: l.窗口.map((w) => w.label), 因: l.reason }) + '@@');
  `, false);
  assert.equal(r.值.locked, true);
  assert.deepEqual(r.值.窗口, ['周']);
  assert.match(r.值.因, /周已用 99%/);
  assert.equal(journal读(root), '', '正常命中时流水不该有失效事件');
});

t('关闸态（gatePercent=0）不发起查询：一次 spawn 都没有，判定仍是「守门已关闭」', () => {
  const r = 探(仓(path.join(仓根, 'packages')), `
    const q = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'quota.js'))});
    q.checkGate({ quota: { gatePercent: 0 } }).then((g) => {
      process.stdout.write('@@' + JSON.stringify({ g, spawn: 记 }) + '@@');
    });
  `, false);
  assert.deepEqual(r.值.g, { allowed: true, threshold: 0, reason: '额度守门已关闭' });
  assert.deepEqual(r.值.spawn, [], '关闸了还去拉 codex app-server——白烧一次外呼');
});

console.log(`全部通过：${passed} 项`);
