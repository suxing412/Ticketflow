// 编制契约测试 —— 「哪个角色归哪个模型」（协-015）。
//
// 照抄 studio 的 lib/roster 的四条设计，这一套就是盯着那四条：
// 每角色一行、池序有序、整批校验再落、可用性与调度同尺。
'use strict';
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const 平台根 = path.resolve(__dirname, '..');
const 编制 = require(path.join(平台根, 'lib', '编制.js'));
const router = require(path.join(平台根, 'lib', 'routing', 'router.js'));
const 加固 = require(path.join(平台根, 'lib', '执行加固.js'));

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('编制契约测试');

const 配 = (routing) => ({
  roles: { backend: {}, reviewer: {}, orchestrator: {} },
  providers: { claude: {}, codex: {}, echo: {} },
  ...(routing ? { routing } : {}),
});

t('每个角色都要出现——「没配」本身是要被看见的状态', () => {
  // 从表里消失的话，人以为这个角色没人管，实际它在按全局排名派。
  const 行 = 编制.读(配());
  assert.deepEqual(行.map((r) => r.角色).sort(), ['backend', 'orchestrator', 'reviewer']);
  assert.deepEqual(行[0].池序, []);
});

t('池序是**有序**的，且按出现序去重', () => {
  // 有序是这个设计的全部意义：单选表达不了「优先 claude，它冻结了就用 codex」。
  const 行 = 编制.读(配({ roles: { backend: { prefer: ['codex', 'claude', 'codex'] } } }));
  const b = 行.find((r) => r.角色 === 'backend');
  assert.deepEqual(b.池序, ['codex', 'claude'], '顺序要保住，重复要去掉');
});

t('快照的可用性来自注入的冻结判定（与调度同一把尺）', () => {
  // 各算各的话，界面显示「可用」而实际派不出去，人会以为平台坏了。
  const c = 配({ roles: { backend: { prefer: ['codex', 'claude'] } } });
  const 冻 = (池) => 池 === 'codex';
  const b = 编制.快照(c, 冻).find((r) => r.角色 === 'backend');
  assert.equal(b.池态[0].冻结, true);
  assert.equal(b.首个可用, 'claude', '第一个没被冻结的才是实际会用的');
  assert.equal(b.可用, true);
  // 全冻 → 止派，且态要说清是「冻」不是「没配」
  const 全冻 = 编制.快照(c, () => true).find((r) => r.角色 === 'backend');
  assert.equal(全冻.可用, false);
  assert.ok(/冻/.test(全冻.态), 全冻.态);
  // 读数拿不到 → 既不说可用也不说不可用
  const 未知 = 编制.快照(c, () => null).find((r) => r.角色 === 'backend');
  assert.equal(未知.可用, null);
  assert.ok(/读数/.test(未知.态), '拿不到额度读数时不许假绿也不许假红：' + 未知.态);
});

t('没指定池序时，快照要如实摆出「实际会考虑哪些池」', () => {
  // 显示一个空表会让人以为没人干活，而实际它在按全局排名派。
  const b = 编制.快照(配(), () => false).find((r) => r.角色 === 'backend');
  assert.deepEqual(b.池态.map((p) => p.池), ['claude', 'codex', 'echo']);
  assert.ok(b.池态.every((p) => p.指定 === false), '这些是全局排名带出来的，不是指定的');
  assert.ok(/全局排名/.test(b.态));
});

t('整批校验再落：一条不合法则整批不写', () => {
  // 半截生效比不生效更难查——人看到一半改成了一半没改，会去猜哪里有随机性，
  // 而实际只是中途撞上一条非法输入。
  const c = 配();
  const r = 编制.应用(c, [
    { 角色: 'backend', 池序: ['claude'] },       // 这条合法
    { 角色: 'reviewer', 池序: ['不存在的池'] },   // 这条不合法
  ]);
  assert.equal(r.ok, false);
  assert.ok(/未知池/.test(r.错误), r.错误);
  assert.equal(c.routing, undefined, '整批不写——合法的那条也不许落');
});

t('校验：未知角色 / 重复角色 / 池序重复 / 非数组', () => {
  const c = 配();
  assert.ok(/未知角色/.test(编制.应用(c, [{ 角色: '没这个', 池序: [] }]).错误));
  assert.ok(/出现两次/.test(编制.应用(c, [{ 角色: 'backend', 池序: [] }, { 角色: 'backend', 池序: [] }]).错误));
  assert.ok(/重复挂了/.test(编制.应用(c, [{ 角色: 'backend', 池序: ['claude', 'claude'] }]).错误));
  assert.ok(/须是数组/.test(编制.应用(c, [{ 角色: 'backend', 池序: 'claude' }]).错误));
  assert.ok(/必填/.test(编制.应用(c, []).错误));
});

t('池序缺省 = 不动这一行；[] = 显式清空回落全局排名', () => {
  const c = 配({ roles: { backend: { prefer: ['claude'] }, reviewer: { prefer: ['codex'] } } });
  // 缺省不动
  const 甲 = 编制.应用(c, [{ 角色: 'backend' }]);
  assert.deepEqual(甲.生效, [], '没给池序就该什么都不改');
  // [] 是显式清空，要记进生效
  const 乙 = 编制.应用(c, [{ 角色: 'backend', 池序: [] }]);
  assert.equal(乙.生效.length, 1);
  assert.deepEqual(乙.routing.roles.backend.prefer, []);
  assert.deepEqual(乙.routing.roles.reviewer.prefer, ['codex'], '别的角色不该被顺手改掉');
});

t('没变就不记生效（免得流水里全是空改动）', () => {
  const c = 配({ roles: { backend: { prefer: ['claude', 'codex'] } } });
  assert.deepEqual(编制.应用(c, [{ 角色: 'backend', 池序: ['claude', 'codex'] }]).生效, []);
  // 顺序变了要算变
  assert.equal(编制.应用(c, [{ 角色: 'backend', 池序: ['codex', 'claude'] }]).生效.length, 1,
    '顺序就是这个设计的全部意义，换序必须算改动');
});

t('写的是 routing.roles.<角色>.prefer，不新造字段', () => {
  // router 已经在读 prefer/allow/deny。新造一套等于让同一件事有两个真相。
  const r = 编制.应用(配(), [{ 角色: 'backend', 池序: ['claude'] }]);
  assert.deepEqual(r.routing.roles.backend.prefer, ['claude']);
  // 落地之后 router 必须真的按它排
  const router = require(path.join(平台根, 'lib', 'routing', 'router.js'));
  const 排 = router.rankProviders(null, { ...配(), routing: r.routing }, { role: 'backend' });
  assert.equal(排[0].name, 'claude', '编制改了但路由没跟着变——那这个功能等于没有');
});

// 用不等分的真配置比例守住协-039：等分夹具会把「池序仅加 2 分」的故障藏起来。
const 路由配 = (prefer) => ({
  roles: { backend: {}, reviewer: {} },
  providers: {
    claude: { scores: { default: { quality: 85 } } },
    codex: { scores: { default: { quality: 57 } } },
    spare: { scores: { default: { quality: 100 } } },
    reserve: { scores: { default: { quality: 90 } } },
    echo: { 桩: true, scores: { default: { quality: 0 } } },
  },
  routing: { roles: { backend: { prefer }, reviewer: { prefer } } },
});
const 排名 = (c, context = {}) => router.rankProviders(null, c, { role: 'backend', ...context });

t('池序翻转 → 首选翻转；高分池不能插队，分数不掺池序加分', () => {
  const c = 路由配(['claude', 'codex']);
  const 前 = 排名(c);
  const 改 = 编制.应用(c, [{ 角色: 'backend', 池序: ['codex', 'claude'] }]);
  assert.equal(改.ok, true);
  const 后 = 排名({ ...c, routing: 改.routing });
  assert.deepEqual(前.map((p) => p.name), ['claude', 'codex', 'spare', 'reserve']);
  assert.deepEqual(后.map((p) => p.name), ['codex', 'claude', 'spare', 'reserve']);
  assert.ok(后[0].score < 后[1].score, '低分首选仍必须排第一');
  for (const p of 前) assert.equal(后.find((r) => r.name === p.name).score, p.score, '换序不改变评分');
  assert.equal(后[0].score, 53.5, '质量 57 × .5 + 成功率 50 × .3 + 延迟/成本各 50 × .1');
  assert.match(后[0].reasons.join('；'), /池序.*1/, '低分排前必须解释是池序优先');
});

t('池序首位被冻结 → 按序取第二位并留下跳过原因', () => {
  const 择 = 加固.择候选(排名(路由配(['codex', 'claude'])), { codex: '预算闸冻结' });
  assert.equal(择.选中.name, 'claude');
  assert.equal(择.降级, true);
  assert.deepEqual(择.跳过, [{ 名称: 'codex', 跳过原因: '预算闸冻结' }]);
});

t('池序全冻 → 名单外仍按分数借调；全部冻结才无候选', () => {
  const 排 = 排名(路由配(['codex', 'claude']));
  const 冻 = { codex: '预算闸冻结', claude: '额度闸冻结' };
  const 择 = 加固.择候选(排, 冻);
  assert.equal(择.选中.name, 'spare');
  assert.deepEqual(择.跳过.map((p) => p.名称), ['codex', 'claude']);
  assert.equal(择.降级, true);
  assert.equal(加固.择候选(排, { ...冻, spare: '冻结', reserve: '冻结' }).选中, null);
});

t('没指定池序仍按分数排；池序不能绕过白名单、禁用和能力过滤', () => {
  assert.deepEqual(排名(路由配([])).map((p) => p.name), ['spare', 'reserve', 'claude', 'codex']);
  const c = 路由配(['echo', 'codex', 'claude', 'spare']);
  c.routing.roles.backend.allow = ['codex', 'claude'];
  assert.deepEqual(排名(c).map((p) => p.name), ['codex', 'claude'], 'prefer 不能扩大 allow');
  c.routing.roles.backend.deny = ['codex'];
  assert.deepEqual(排名(c).map((p) => p.name), ['claude']);
  delete c.routing.roles.backend.deny;
  c.providers.codex.enabled = false;
  assert.deepEqual(排名(c).map((p) => p.name), ['claude']);
  c.providers.codex.enabled = true;
  c.providers.codex.capabilities = ['chat'];
  c.roles.backend.requiredCapabilities = ['code'];
  assert.deepEqual(排名(c).map((p) => p.name), ['claude']);
  delete c.roles.backend.requiredCapabilities;
  c.providers.codex.roles = ['reviewer'];
  assert.deepEqual(排名(c).map((p) => p.name), ['claude']);
});

t('跨厂评审仍避开原执行方，显式固定仍优先于池序', () => {
  const c = 路由配(['codex', 'claude']);
  const context = { role: 'reviewer', kind: '质检', task: { fm: { provider: 'codex' } } };
  assert.deepEqual(排名(c, context).map((p) => p.name), ['claude', 'spare', 'reserve']);
  c.routing.crossProviderReview = false;
  assert.equal(排名(c, context)[0].name, 'codex');
  assert.equal(排名(c, { task: { fm: { routing: { pin: 'claude' } } } })[0].name, 'claude');
});

t('桩池不能写入编制，整批拒绝且不改变原配置或白名单', () => {
  const c = 路由配(['claude']);
  c.routing.roles.reviewer.allow = ['echo'];
  const 前 = JSON.stringify(c);
  const r = 编制.应用(c, [
    { 角色: 'backend', 池序: ['codex'] },
    { 角色: 'reviewer', 池序: ['echo'] },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.错误, /echo.*桩/);
  assert.equal(JSON.stringify(c), 前, '合法行也不能部分生效，allow 不该被改动');
});

t('改编制要留理由，且服务端强制', () => {
  // 三个月后回头看「为什么 reviewer 挂在 codex 上」，没有理由就只能靠猜。
  const 源 = fs.readFileSync(path.join(平台根, 'server.js'), 'utf8');
  assert.ok(/理由必填/.test(源), '服务端必须强制理由');
  const 前 = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  assert.ok(/请写一句理由/.test(前), '界面也要拦一道，别让人白填一遍表单才被拒');
});

t('执行器现读 routing——改完不用重启', () => {
  // 同一类问题在工单根（协-005）、项目注册表（协-007）上各踩过一次：
  // 界面上改完，另一个进程还捧着开机那份，表现是「改了没反应」而每一处都显示成功。
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.ok(/function 现配置\(\)/.test(执), '执行器要有现读 routing 的入口');
  assert.ok(!/派单\.选派\(平台根, 配置,/.test(执),
    '还有调用点在用开机那份配置——编制改了它不认');
});

// HTTP 端到端：隔离配置、工单与账本，只起 server（不会调用 AI CLI）。
async function 接口契约() {
  const os = require('os');
  const net = require('net');
  const { spawn } = require('child_process');
  const { once } = require('events');
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), '编制接口-'));
  const 配置目录 = path.join(临, 'config');
  fs.mkdirSync(配置目录);
  const 空闲端口 = () => new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
  let srv;
  try {
    // backend 用出厂不等分；reviewer 用等分，专门防「池序有区分却报字母序」回归。
    fs.writeFileSync(path.join(配置目录, 'routing.local.json'), JSON.stringify({ roles: {
      backend: { allow: ['claude', 'codex'], prefer: [] },
      reviewer: { allow: ['claude', 'codex'], prefer: [], weights: { quality: 0, success: 0, latency: 0, cost: 0 } },
    } }));
    const port = await 空闲端口();
    const env = { ...process.env, PORT: String(port),
      PLATFORM_CONFIG: 配置目录, PLATFORM_JOURNAL: 临, PLATFORM_TICKETS: path.join(临, 'tickets'),
      WORKSPACE_PORT: String(await 空闲端口()), EXECUTOR_PORT: String(await 空闲端口()) };
    delete env.PLATFORM_NO_LOCAL;
    delete env.TICKETFLOW_PACKAGES;
    srv = spawn(process.execPath, [path.join(平台根, 'server.js')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const 已退出 = once(srv, 'close');
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('编制测试服务启动超时')), 10000);
        const 失败 = (e) => { clearTimeout(timer); reject(e); };
        srv.once('error', 失败);
        srv.once('exit', (code) => 失败(new Error(`编制测试服务提前退出：${code}`)));
        srv.stderr.resume();
        srv.stdout.on('data', (d) => { if (String(d).includes('开机 →')) { clearTimeout(timer); resolve(); } });
      });
      const token = fs.readFileSync(path.join(配置目录, 'api-token.txt'), 'utf8').trim();
      const 请求 = async (url, body) => {
        const r = await fetch(`http://127.0.0.1:${port}${url}`, {
          method: body ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000),
        });
        return { status: r.status, body: await r.json() };
      };
      for (const 池序 of [['codex', 'claude'], ['claude', 'codex']]) {
        const 写 = await 请求('/api/roster', { 改动: [{ 角色: 'backend', 池序 }], 理由: '协-039 隔离契约验收' });
        assert.equal(写.status, 200);
        const 排 = await 请求('/api/routing/rank?role=backend');
        assert.equal(排.status, 200);
        assert.equal(排.body.选中, 池序[0], 'POST 后排名必须立即换序，不重启');
        assert.deepEqual(排.body.排名.map((p) => p.名称), 池序);
        const 落 = JSON.parse(fs.readFileSync(path.join(配置目录, 'routing.local.json'), 'utf8'));
        assert.deepEqual(落.roles.backend.prefer, 池序);
        assert.deepEqual(落.roles.backend.allow, ['claude', 'codex'], '不能跟着改白名单');
      }
      passed++; console.log('  ✓ HTTP：编制双向换序立即改变排名，落盘保留白名单');
      const 前 = fs.readFileSync(path.join(配置目录, 'routing.local.json'), 'utf8');
      const 拒 = await 请求('/api/roster', { 改动: [{ 角色: 'backend', 池序: ['echo'] }], 理由: '不能保存桩池' });
      assert.equal(拒.status, 400);
      assert.match(拒.body.error, /桩池/);
      assert.equal(fs.readFileSync(path.join(配置目录, 'routing.local.json'), 'utf8'), 前);
      passed++; console.log('  ✓ HTTP：桩池写入返回 400，原配置保持不变');
      const 平 = await 请求('/api/routing/rank?role=reviewer');
      assert.equal(平.body.有区分度, false);
      const 写 = await 请求('/api/roster', { 改动: [{ 角色: 'reviewer', 池序: ['codex', 'claude'] }], 理由: '同分仍有明确池序' });
      assert.equal(写.status, 200);
      const 序 = await 请求('/api/routing/rank?role=reviewer');
      assert.equal(序.body.排名[0].分数, 序.body.排名[1].分数);
      assert.equal(序.body.选中, 'codex');
      assert.equal(序.body.有区分度, true);
      assert.doesNotMatch(序.body.说明, /字母序|无区分度/);
      passed++; console.log('  ✓ HTTP：同分但有池序时，不再误报字母序或无区分度');
    } finally {
      if (srv.exitCode === null) srv.kill();
      await 已退出;
    }
  } finally {
    // 只删本测试独占创建的临时目录，且等子进程完全关闭后再删。
    fs.rmSync(临, { recursive: true, force: true });
  }
}

接口契约().then(() => console.log(`全部通过：${passed} 项`)).catch((e) => {
  console.error(e); process.exitCode = 1;
});
