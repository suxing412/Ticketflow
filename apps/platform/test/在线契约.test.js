// 在线契约测试（协-019）—— 无人值守长跑靠的那几条。
//
// 分三层，一层都不能省：
//   · 判定层：呼叫去重 / 闸判据 / 轮转——纯函数，快
//   · 端点层：**真起服务打一遍**。这条规矩抄自 studio 0.26.16 的实录：
//     `/api/attn` 里 `runner.status()` 漏传 cfg，函数内读 `cfg.执行器` 抛 TypeError、端点 500，
//     而 lib 层 13 项全绿——因为炸的是**端点接线**不是判据逻辑。
//     谓词有单测 ≠ 端点跑得起来。本轮顺带补上协-018 欠的 /api/quota 那一格。
//   · 守护层：真把执行器杀掉，看它自己回不回来。这是本单的验收标准第一条，
//     只有真杀真等才算数。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const http = require('http');

const 呼叫 = require('../lib/呼叫');
const 闸表 = require('../lib/闸注册表');
const 轮转 = require('../lib/轮转');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const 异步项 = [];
const T = (n, f) => 异步项.push([n, f]);
console.log('在线契约测试（无人值守长跑）');

const 平台根 = path.resolve(__dirname, '..');
const 临根 = () => fs.mkdtempSync(path.join(os.tmpdir(), '在线-'));

// ---------- 呼叫信箱：去重 ----------
t('同一条告警重复 100 次，信箱里只有一笔（静默窗内）', () => {
  const 根 = 临根();
  for (let i = 0; i < 100; i++) 呼叫.急(根, '在途超时', 'TK-1 已在途 40 分钟', { 单: 'TK-1' });
  const 全 = 呼叫.列(根, 500);
  assert.equal(全.length, 1, '轮询式巡检每轮都会报同一条——不去重的话这条信道很快就没人看了');
  fs.rmSync(根, { recursive: true, force: true });
});

t('去重的是记账不是判断：被压了多少次要写在下一笔里', () => {
  // 一条报了 265 次的告警，和一条只报过一次的，在信箱里必须长得不一样——
  // studio 08-20 的九天死循环正是因为长得一样，才表现为「一条不动的红标」。
  const 根 = 临根();
  for (let i = 0; i < 9; i++) 呼叫.急(根, '在途超时', 'TK-1 卡住', { 单: 'TK-1' });
  呼叫.急(根, '在途超时', 'TK-1 卡住了更久', { 单: 'TK-1' });     // 摘要变了 = 状态变了
  const 全 = 呼叫.列(根, 500);
  assert.equal(全.length, 2);
  assert.equal(全[1].同因压制, 8, '第二笔要带上「上一轮之后又被压了 8 次」');
  fs.rmSync(根, { recursive: true, force: true });
});

t('不同指纹互不压制（把两个问题并成一条比重复喊更糟）', () => {
  const 根 = 临根();
  呼叫.急(根, '在途超时', 'A 卡住', { 单: 'TK-1' });
  呼叫.急(根, '在途超时', 'B 卡住', { 单: 'TK-2' });
  呼叫.常(根, '预算冻结', '池 claude 冻结', { 池: 'claude' });
  assert.equal(呼叫.列(根, 500).length, 3);
  fs.rmSync(根, { recursive: true, force: true });
});

t('静默秒=0 的事件每次都落（进程重启这类，少一条就对不上账）', () => {
  const 根 = 临根();
  for (let i = 0; i < 3; i++) 呼叫.常(根, '进程重启', '执行器退出（码 1）', { 静默秒: 0 });
  assert.equal(呼叫.列(根, 500).length, 3);
  fs.rmSync(根, { recursive: true, force: true });
});

t('未读走游标水位，不改写历史行（信箱是账本不是待办清单）', () => {
  const 根 = 临根();
  呼叫.急(根, 'A', '一', { 静默秒: 0 }); 呼叫.急(根, 'B', '二', { 静默秒: 0 });
  assert.equal(呼叫.未读(根).length, 2);
  呼叫.标记已读(根);
  assert.equal(呼叫.未读(根).length, 0);
  assert.equal(呼叫.列(根, 500).length, 2, '标记已读不许删行');
  fs.rmSync(根, { recursive: true, force: true });
});

// ---------- 轮转 ----------
t('流水超上限就切分归档，保留 N 份，超出的丢掉', () => {
  const 根 = 临根();
  const f = path.join(根, 'x.jsonl');
  fs.writeFileSync(f, 'a'.repeat(2000));
  assert.equal(轮转.转(f, { 上限字节: 5000 }).转, false, '没到上限不该转');
  assert.equal(轮转.转(f, { 上限字节: 1000, 保留: 2 }).转, true);
  assert.ok(!fs.existsSync(f), '转完原文件应当不在——调用方下一次 append 会自动新建');
  assert.ok(fs.existsSync(轮转.分名(f, 1)));
  fs.writeFileSync(f, 'b'.repeat(2000)); 轮转.转(f, { 上限字节: 1000, 保留: 2 });
  fs.writeFileSync(f, 'c'.repeat(2000)); 轮转.转(f, { 上限字节: 1000, 保留: 2 });
  assert.ok(!fs.existsSync(轮转.分名(f, 3)), '保留 2 份就只该有 .1 和 .2');
  fs.rmSync(根, { recursive: true, force: true });
});

t('轮转失败只是不转，绝不抛（流水是证据面，宁可胖也不能断）', () => {
  assert.equal(轮转.转(path.join(临根(), '不存在.jsonl')).转, false);
});

// ---------- 闸注册表 ----------
const 单 = (id, state, fm) => ({ id, state, fm: { title: id, ...fm } });
const 早 = new Date(Date.now() - 5 * 3600e3).toISOString();
const 更早 = new Date(Date.now() - 40 * 3600e3).toISOString();

t('发起型闸不进清单（没有队列的动作不可能「欠着」）', () => {
  const r = 闸表.等我({ 工单表: [] });
  assert.equal(r.计数, 0);
  assert.ok(r.注册.some((g) => g.闸号 === 'P7' && g.判据 === null), '发起型仍要登记在册——人得知道有这些口子');
  assert.ok(r.注册.some((g) => g.闸号 === 'P12' && g.判据 === null),
    '工作区回收的 pending 要起 git 才算得出来，本模块是纯的——让它恒空好过让它撒谎');
});

t('按停摆时长降序，时长未知的排最后', () => {
  const r = 闸表.等我({ 工单表: [
    单('A', '草稿', { 创建时间: 早 }), 单('B', '草稿', {}), 单('C', '草稿', { 创建时间: 更早 }),
  ] });
  assert.deepEqual(r.债.map((x) => x.id), ['C', 'A', 'B'], '最久的排最前，这是催办的天然序');
  assert.equal(r.债[2].停摆小时, null, '不知道多久 ≠ 刚发生，但也不该冒充最久');
});

t('gateKey 幂等：同闸同实体扫出几次都只算一笔', () => {
  const 表 = [单('A', '草稿', { 创建时间: 早 })];
  const r = 闸表.等我({ 工单表: [...表, ...表] });
  assert.equal(r.计数, 1);
  assert.equal(r.债[0].gateKey, 'P1:A');
});

t('待投 ≠ 欠你一笔：自动派发接管 / 依赖没就绪 / 池全冻结，三种都不算', () => {
  // 照 studio「backlog ≠ 欠债」那条收窄。虚报会把整份清单变成噪声，
  // 而漏报会被超时升格捞回来——两害相权，宁可恒空也不虚报。
  const 表 = [单('A', '待投', { 创建时间: 早 })];
  assert.equal(闸表.等我({ 工单表: 表 }).计数, 1, '前提：正常情况下它确实欠你一点');
  assert.equal(闸表.等我({ 工单表: 表, 自动派发开: true }).计数, 0, '有人接管了');
  assert.equal(闸表.等我({ 工单表: 表, 依赖就绪: () => false }).计数, 0, '它在等上游，不在等你');
  assert.equal(闸表.等我({ 工单表: 表, 可用池数: 0 }).计数, 0, '它在等额度窗口，你点了也派不出去');
});

t('订阅耗尽这笔债不是工单状态——只看工单目录永远看不见它', () => {
  const r = 闸表.等我({ 工单表: [], 耗尽: { claude: { 时刻: 早 } } });
  assert.equal(r.计数, 1);
  assert.equal(r.债[0].闸号, 'P4');
  assert.match(r.债[0].title, /API 按 token 计费/);
});

t('被我们自己中断的单，与跑太久卡住的单，分得开', () => {
  // 前者重投是安全的（它根本没跑完），后者得先弄清它在干什么。混成一类就没法自动化处置。
  const r = 闸表.等我({
    工单表: [单('A', '在途', { 派单时间: 更早 }), 单('B', '在途', { 派单时间: 更早, 中断: '服务停机中断', 中断于: 早 })],
    卡死阈值: 30 * 60 * 1000,
  });
  const of = (id) => r.债.find((x) => x.id === id);
  assert.equal(of('A').闸号, 'P3', '没盖章的按卡死分诊');
  assert.equal(of('B').闸号, 'P6', '盖了章的走中断续跑，不该再报一次卡死');
  assert.equal(r.计数, 2);
});

t('依赖死结：上游不存在或已归档 = 永远不会完成', () => {
  const r = 闸表.等我({ 工单表: [
    单('A', '待投', { 依赖: ['不存在的'], 创建时间: 早 }),
    单('B', '待投', { 依赖: ['C'], 创建时间: 早 }), 单('C', '已归档', {}),
  ], 依赖就绪: () => false });
  assert.equal(r.债.filter((x) => x.闸号 === 'P5').length, 2);
});

t('一条闸哑了要报出来，不许假装它是空的', () => {
  const 根 = 临根();
  fs.writeFileSync(path.join(根, '闸注册表.json'), JSON.stringify([{ 闸号: 'X1', 名称: '瞎编的', 判据: '根本没有这个判据' }]));
  const r = 闸表.等我({ 工单表: [], 账本根: 根 });
  assert.equal(r.计数, 0);
  assert.equal(r.失败.length, 1, '静默返回空 = 假装没有欠债');
  fs.rmSync(根, { recursive: true, force: true });
});

t('逾期升格：停摆超 T 小时的才算', () => {
  const 表 = [单('A', '草稿', { 创建时间: 早 }), 单('B', '草稿', { 创建时间: 更早 })];
  assert.deepEqual(闸表.逾期({ 工单表: 表 }, 24).map((x) => x.id), ['B']);
});

t('运行态在**每次进出在跑清单**时都落盘（协-021）', () => {
  // 实测发现：协-019 只在 上岗/自动开关/停机 四个点写态，于是 `在跑` 字段永远是
  // 开机那一刻的快照——HW-3 真跑到第 5 分钟时，工单明明在「在途」，态文件里的 在跑 还是 []。
  // **一个永远为空的在跑清单比没有这个字段更坏**：它看起来像个答案。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.match(源, /在跑单\.add\([^)]*\);\s*写态\(/, '加进在跑清单时要写一次态，否则别的进程看不见它在跑');
  assert.match(源, /在跑单\.delete\([^)]*\);\s*写态\(/, '跑完出清单也要写一次，否则态文件会一直挂着一张早跑完的单');
});

t('耗尽台账读写：执行器写、server 读，跨进程那半笔债靠它才看得见', () => {
  const 根 = 临根();
  assert.deepEqual(闸表.读耗尽(根), {}, '没有台账时是空对象，不抛');
  闸表.写耗尽(根, { claude: { 时刻: 早 } });
  assert.equal(Object.keys(闸表.读耗尽(根)).length, 1);
  fs.rmSync(根, { recursive: true, force: true });
});

// ---------- 端点层：真起服务打一遍 ----------
// 抄 studio 0.26.16 立的规矩：凡新端点，必须有这一格。
function 起一台(o = {}) {
  const 账本 = o.账本根 || 临根();
  const 端口 = o.端口 || 4881;
  const 子 = spawn(process.execPath, [path.join(平台根, o.脚本 || 'server.js')], {
    env: { ...process.env, PORT: String(端口), PLATFORM_JOURNAL: 账本, PLATFORM_NO_QUOTA_FETCH: '1',
      EXECUTOR_PORT: String(端口 + 1), WORKSPACE_PORT: String(端口 + 2) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { 子, 端口, 账本根: 账本 };
}
const 令牌 = (() => {
  try { return fs.readFileSync(path.join(平台根, 'config', 'api-token.txt'), 'utf8').trim(); } catch { return ''; }
})();
function 打(端口, 路径) {
  return new Promise((定) => {
    const q = http.request({ host: '127.0.0.1', port: 端口, path: 路径, method: 'GET', timeout: 8000,
      headers: { Authorization: `Bearer ${令牌}` } }, (r) => {
      let s = ''; r.on('data', (d) => s += d);
      r.on('end', () => { let j = null; try { j = JSON.parse(s); } catch { j = { __非JSON: s.slice(0, 120) }; } 定([r.statusCode, j]); });
    });
    q.on('timeout', () => { q.destroy(); 定([0, { __超时: true }]); });
    q.on('error', (e) => 定([0, { __错: e.code || e.message }]));
    q.end();
  });
}
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
async function 等就绪(端口, 上限 = 40) {
  for (let i = 0; i < 上限; i++) {
    const [码] = await 打(端口, '/api/health');
    if (码 === 200) return true;
    await 等(250);
  }
  return false;
}

T('端点实跑 · /api/attn 与 /api/inbox：真起 server 打一遍（漏传参这类只有起服务才炸得出来）', async () => {
  const 台 = 起一台({ 端口: 4881 });
  try {
    assert.ok(await 等就绪(4881), 'server 没起来');
    const [码, j] = await 打(4881, '/api/attn');
    // 工单库没配时 503 也是**对的**——它明说了「这不是零欠账」。两种都接受，但形状必须完整。
    assert.ok(码 === 200 || 码 === 503, `/api/attn 不该 500：${码} ${JSON.stringify(j).slice(0, 200)}`);
    if (码 === 200) {
      assert.equal(typeof j.计数, 'number');
      assert.ok(Array.isArray(j.债) && Array.isArray(j.注册) && Array.isArray(j.逾期));
      assert.equal(typeof j.逾期阈值小时, 'number');
    }
    const [码2, j2] = await 打(4881, '/api/inbox');
    assert.equal(码2, 200, '/api/inbox 必须 200');
    assert.ok(Array.isArray(j2.呼叫) && typeof j2.未读 === 'number');
  } finally { try { 台.子.kill(); } catch { /* 已经没了 */ } }
});

T('端点实跑 · /api/ready：存活 ≠ 就绪（另外两个进程没起时必须 503 并说清是谁）', async () => {
  const 台 = 起一台({ 端口: 4884 });
  try {
    assert.ok(await 等就绪(4884), 'server 没起来');
    const [码, j] = await 打(4884, '/api/ready');
    assert.equal(码, 503, '只起了 server，工作区与执行器都没起——这台机器不该自称就绪');
    assert.ok(j.未就绪.some((s) => /执行器/.test(s)), '要点名是谁没起：' + JSON.stringify(j.未就绪));
    const [码H] = await 打(4884, '/api/health');
    assert.equal(码H, 200, '存活探针照旧 200——瞭望塔探的是它，不该被就绪拖红');
  } finally { try { 台.子.kill(); } catch { /* 已经没了 */ } }
});

T('端点实跑 · /api/quota：补上协-018 欠的那一格（当时只有 lib 层断言）', async () => {
  const 台 = 起一台({ 端口: 4887 });
  try {
    assert.ok(await 等就绪(4887), 'server 没起来');
    const [码, j] = await 打(4887, '/api/quota');
    assert.equal(码, 200, `/api/quota 必须 200：${JSON.stringify(j).slice(0, 200)}`);
    assert.ok(Array.isArray(j.明细) && Array.isArray(j.盲区), '形状要完整');
  } finally { try { 台.子.kill(); } catch { /* 已经没了 */ } }
});

// ---------- 守护层：真杀真等 ----------
T('守护 · 杀掉执行器，它自己回来，且重启进呼叫信箱', async () => {
  // 本单的验收标准第一条。只有真杀真等才算数——
  // 「代码里写了 setTimeout 重起」和「它真的回来了」是两回事。
  const 账本 = 临根();
  const 子 = spawn(process.execPath, [path.join(平台根, 'scripts', '开机.js')], {
    env: { ...process.env, PORT: '4891', WORKSPACE_PORT: '4892', EXECUTOR_PORT: '4893',
      PLATFORM_JOURNAL: 账本, PLATFORM_NO_QUOTA_FETCH: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    let 起来 = false;
    for (let i = 0; i < 60 && !起来; i++) { const [码] = await 打(4893, '/health'); 起来 = 码 === 200; if (!起来) await 等(250); }
    assert.ok(起来, '执行器没在 4893 起来');
    const [, h1] = await 打(4893, '/health');
    const pid1 = h1.pid || (await (async () => { const j = JSON.parse(fs.readFileSync(path.join(账本, 'journal', '执行器态.json'), 'utf8')); return j.pid; })());
    assert.ok(pid1, '拿不到执行器 pid');

    process.kill(pid1, 'SIGKILL');                 // 模拟「凌晨三点它自己崩了」

    let 回来 = false; let pid2 = null;
    for (let i = 0; i < 80 && !回来; i++) {
      await 等(250);
      const [码] = await 打(4893, '/health');
      if (码 === 200) {
        try { pid2 = JSON.parse(fs.readFileSync(path.join(账本, 'journal', '执行器态.json'), 'utf8')).pid; } catch { pid2 = null; }
        回来 = pid2 && pid2 !== pid1;
      }
    }
    assert.ok(回来, '执行器被杀之后没有自己回来——无人值守就是靠这条成立的');
    const 信 = 呼叫.列(账本, 100);
    assert.ok(信.some((x) => x.类型 === '进程重启'), '重起必须留痕，否则「每小时崩一次」和「一切正常」长得一样：'
      + JSON.stringify(信.map((x) => x.类型)));
  } finally {
    try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(子.pid), '/T', '/F'], { stdio: 'ignore' }); else 子.kill(); } catch { /* 已经没了 */ }
  }
});

T('守护 · 请它收工：三个进程都自己走完，执行器留下停机的落款', async () => {
  // Windows 上这条只有走 IPC 才成立：node 把 SIGTERM/SIGINT 映射成**无条件终止**，
  // `process.on('SIGTERM')` 在被杀时一次都不会执行——于是「把在跑的单盖章标记中断」
  // 那段代码在 Windows 上等于不存在。踩过这个坑才补的 IPC 通道，所以这一格必须在。
  const 账本 = 临根();
  const 子 = spawn(process.execPath, [path.join(平台根, 'scripts', '开机.js')], {
    env: { ...process.env, PORT: '4895', WORKSPACE_PORT: '4896', EXECUTOR_PORT: '4897',
      PLATFORM_JOURNAL: 账本, PLATFORM_NO_QUOTA_FETCH: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let 退出码 = null;
  子.on('exit', (c) => { 退出码 = c == null ? 0 : c; });
  try {
    let 起来 = false;
    for (let i = 0; i < 60 && !起来; i++) { const [码] = await 打(4897, '/health'); 起来 = 码 === 200; if (!起来) await 等(250); }
    assert.ok(起来, '执行器没在 4897 起来');

    子.send({ 停机: '测试请它收工' });
    for (let i = 0; i < 40 && 退出码 === null; i++) await 等(250);
    assert.notEqual(退出码, null, '请它收工之后监工没退——宽限到了也该硬杀兜底');

    const 态 = JSON.parse(fs.readFileSync(path.join(账本, 'journal', '执行器态.json'), 'utf8'));
    assert.match(String(态.因), /^停机\(/, '执行器要留下停机的落款，证明它是自己走的而不是被硬杀的：' + 态.因);
    const [码后] = await 打(4897, '/health');
    assert.notEqual(码后, 200, '停完了端口还应答，说明进程根本没走');
  } finally {
    try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(子.pid), '/T', '/F'], { stdio: 'ignore' }); else 子.kill('SIGKILL'); } catch { /* 已经没了 */ }
  }
});

// ---------- 跑异步那批 ----------
(async () => {
  for (const [名, fn] of 异步项) { await fn(); passed++; console.log('  ✓ ' + 名); }
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error(e); process.exit(1); });
