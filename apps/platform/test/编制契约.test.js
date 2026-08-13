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

console.log(`全部通过：${passed} 项`);
