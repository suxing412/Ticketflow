// roster.test.js — 编制去岗位化（H85 补章，施工令-008）：
//   旧岗位册 config.agents（程序-A/程序-B）→ 新编制 config.编制（每职能一行 + 池序）
//   迁移 / 幂等 / 损坏容错 / 快照 / 批量改动校验与整批落 / 拉取制兼容视图
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roster = require('../lib/roster');
const config = require('../lib/core/config');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('roster 编制去岗位化测试（H85 补章）');

// 生产形状样例（施工令-008 验收标准①）：六条 agents，程序双岗分挂两池
const 生产样例 = () => ({
  职能: ['策划', '程序', '美术', 'QA', '装配'],
  执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', '美术', 'QA', '装配'] }, deepseek: { 职能: [] } },
  agents: [
    { id: '策划-A', 职能: '策划', 执行池: 'claude' },
    { id: '程序-A', 职能: '程序', 执行池: 'codex' },
    { id: '程序-B', 职能: '程序', 执行池: 'claude', 模型: 'opus' },
    { id: '美术-A', 职能: '美术', 执行池: 'claude' },
    { id: 'QA-A', 职能: 'QA', 执行池: 'claude' },
    { id: '装配-A', 职能: '装配', 执行池: 'claude' },
  ],
});

t('迁移：生产形状六条 agents（程序双池）→ 五行编制，程序池序 codex→claude', () => {
  const cfg = 生产样例();
  assert.equal(roster.migrate(cfg), true, '有旧字段必判为已改动（调用方据此落盘）');
  assert.equal(cfg.agents, undefined, '旧字段必须删除，不留双源');
  assert.deepEqual(cfg.编制.map((r) => r.职能), ['策划', '程序', '美术', 'QA', '装配'], '五行编制');
  const 程序 = cfg.编制.find((r) => r.职能 === '程序');
  assert.deepEqual(程序.池序.map((p) => p.池), ['codex', 'claude'], '池按原序去重合并=路由优先级');
  assert.equal(程序.池序[1].档, 'opus', '各池取该池第一个显式档位');
  assert.equal(程序.池序[0].档, '', '未设档位=池默认');
});

t('迁移幂等：跑第二遍不再判为改动，内容一字不差', () => {
  const cfg = 生产样例();
  roster.migrate(cfg);
  const 快照 = JSON.stringify(cfg.编制);
  assert.equal(roster.migrate(cfg), false, '第二遍无改动（不该反复写盘）');
  assert.equal(JSON.stringify(cfg.编制), 快照);
  assert.equal(roster.migrate(cfg), false, '第三遍照旧');
});

t('迁移：同职能多岗位归并成一行，退役待归（上线:false）不进编制', () => {
  const cfg = { agents: [
    { id: '美术-A', 职能: '美术', 执行池: 'codex' },
    { id: '美术-B', 职能: '美术', 执行池: 'claude' },
    { id: '美术-C', 职能: '美术', 执行池: 'codex' }, // 同池重复：去重
    { id: '美术-D', 职能: '美术', 执行池: 'deepseek', 上线: false }, // 退役待归：去岗位化后无人可退役
  ] };
  roster.migrate(cfg);
  assert.equal(cfg.编制.length, 1);
  assert.deepEqual(cfg.编制[0].池序.map((p) => p.池), ['codex', 'claude']);
});

t('迁移损坏容错：坏行/空职能/缺池一律不炸，缺池只贡献「该职能存在」', () => {
  const cfg = { agents: [null, 'x', { 职能: '' }, { id: 'QA-A', 职能: 'QA' }, { id: '程序-A', 职能: '程序', 执行池: 'codex' }] };
  assert.doesNotThrow(() => roster.migrate(cfg));
  assert.deepEqual(cfg.编制, [{ 职能: 'QA', 池序: [] }, { 职能: '程序', 池序: [{ 池: 'codex', 档: '' }] }]);
  const bad = { 编制: [{ 职能: '程序', 池序: 'codex' }, { 职能: '程序', 池序: [{ 池: 'claude' }] }, 7] };
  assert.doesNotThrow(() => roster.migrate(bad));
  assert.deepEqual(bad.编制, [{ 职能: '程序', 池序: [{ 池: 'claude', 档: '' }] }], '同职能多行合并、坏行丢弃');
});

t('迁移：无编制信息的配置不硬塞空表（免得每次开机白写一次盘）', () => {
  const cfg = { server: { port: 4270 } };
  assert.equal(roster.migrate(cfg), false);
  assert.equal(cfg.编制, undefined);
});

t('config.load 读盘即迁移并落盘（生产配置的实际改形由运行时完成）', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-'));
  fs.writeFileSync(path.join(d, 'studio.config.json'), JSON.stringify(生产样例()), 'utf8');
  const cfg = config.load(d);
  assert.equal(cfg.agents, undefined);
  assert.equal(cfg.编制.length, 5);
  const 盘 = JSON.parse(fs.readFileSync(path.join(d, 'studio.config.json'), 'utf8'));
  assert.equal(盘.agents, undefined, '旧字段已从盘上删除');
  assert.deepEqual(盘.编制.find((r) => r.职能 === '程序').池序.map((p) => p.池), ['codex', 'claude']);
  const 再 = fs.readFileSync(path.join(d, 'studio.config.json'), 'utf8');
  config.load(d);
  assert.equal(fs.readFileSync(path.join(d, 'studio.config.json'), 'utf8'), 再, '幂等：第二次加载不再改盘');
});

t('read/poolsOf/has/modelFor：新形态直读，旧形态就地推导（不改 cfg）', () => {
  const 新 = { 编制: [{ 职能: '程序', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: 'opus' }] }] };
  assert.deepEqual(roster.poolsOf(新, '程序'), ['codex', 'claude']);
  assert.equal(roster.modelFor(新, '程序', 'claude'), 'opus');
  assert.equal(roster.modelFor(新, '程序', 'codex'), '');
  assert.equal(roster.has(新, '程序'), true);
  assert.equal(roster.has(新, '美术'), false);
  const 旧 = 生产样例();
  assert.deepEqual(roster.poolsOf(旧, '程序'), ['codex', 'claude'], '旧形态兼容读');
  assert.ok(Array.isArray(旧.agents), 'read 是只读的，不该顺手改 cfg');
});

t('拉取制兼容视图 agents()：去岗位化后 id 即职能名，旧 cfg 原样返回', () => {
  const 新 = { 编制: [{ 职能: '程序', 池序: [{ 池: 'codex', 档: 'gpt5' }] }, { 职能: 'QA', 池序: [] }] };
  assert.deepEqual(roster.agents(新), [
    { id: '程序', 职能: '程序', 执行池: 'codex', 模型: 'gpt5' },
    { id: 'QA', 职能: 'QA', 执行池: '', 模型: '' },
  ]);
  const 旧 = 生产样例();
  assert.equal(roster.agents(旧), 旧.agents, '仍持旧字段的内存态 cfg 行为零变化');
});

// ---- 快照（/api/pm/roster GET 口径）----
const SCFG = () => ({
  职能: ['策划', '程序', '美术'],
  执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', '美术'] } },
  编制: [{ 职能: '程序', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: 'opus' }] },
    { 职能: '美术', 池序: [{ 池: 'codex', 档: '' }] }],
});

t('快照：cfg.职能 全表打底，每职能一行；无编制行回落职能默认池并标 默认', () => {
  const rows = roster.snapshot(SCFG(), () => false);
  assert.deepEqual(rows.map((r) => r.职能), ['策划', '程序', '美术']);
  const 策划 = rows[0];
  assert.equal(策划.编制, false);
  assert.deepEqual(策划.池序.map((p) => [p.池, p.默认]), [['claude', true]]);
  assert.equal(策划.态, '在岗·职能默认池');
});

t('快照：首个可用池绿「在岗」，池序全冻黄「止派」，读数拿不到呈「额度读数中」', () => {
  const 冻codex = roster.snapshot(SCFG(), (p) => p === 'codex');
  const 程序 = 冻codex.find((r) => r.职能 === '程序');
  assert.equal(程序.首个可用, 'claude', '池序内顺位取第二个');
  assert.equal(程序.可用, true);
  assert.equal(程序.态, '在岗');
  const 美术 = 冻codex.find((r) => r.职能 === '美术');
  assert.equal(美术.首个可用, null);
  assert.equal(美术.可用, false);
  assert.equal(美术.态, '池序全冻·止派'); // 案源 2026-08-06：这里曾全绿假健康
  const 盲 = roster.snapshot(SCFG(), null);
  assert.equal(盲[1].可用, null);
  assert.equal(盲[1].态, '额度读数中');
});

t('快照：职能无池可挂（既无编制又无默认池）→ 未挂池·止派', () => {
  const rows = roster.snapshot({ 职能: ['音效'], 执行池: { claude: { 职能: [] } } }, () => false);
  assert.equal(rows[0].可用, false);
  assert.equal(rows[0].态, '未挂池·止派');
});

// ---- 批量改动（/api/pm/roster POST 口径）----
t('改动：按职能改池序，返回生效摘要，旧岗位册随写口退场', () => {
  const cfg = SCFG(); cfg.agents = [{ id: '程序-A', 职能: '程序', 执行池: 'codex' }]; // 残留双源
  const r = roster.apply(cfg, [{ 职能: '程序', 池序: [{ 池: 'claude', 档: 'opus' }, { 池: 'codex' }] }]);
  assert.equal(r.ok, true);
  assert.equal(r.生效.length, 1);
  assert.deepEqual(cfg.编制.find((x) => x.职能 === '程序').池序,
    [{ 池: 'claude', 档: 'opus' }, { 池: 'codex', 档: '' }]);
  assert.ok(r.生效[0].摘.includes('codex(opus)→claude') === false && r.生效[0].摘.includes('claude(opus)→codex'), r.生效[0].摘);
  assert.equal(cfg.agents, undefined);
});

t('改动：新建职能行 / 空池序清挂 / 缺池序=该行不动', () => {
  const cfg = SCFG();
  const r = roster.apply(cfg, [{ 职能: '策划', 池序: [{ 池: 'claude' }] }, { 职能: '美术', 池序: [] }, { 职能: '程序' }]);
  assert.equal(r.ok, true);
  assert.equal(r.生效.length, 2, '程序缺池序 → 不算生效');
  assert.deepEqual(roster.poolsOf(cfg, '策划'), ['claude']);
  assert.deepEqual(roster.poolsOf(cfg, '美术'), [], '空池序=回落职能默认池');
  assert.deepEqual(roster.poolsOf(cfg, '程序'), ['codex', 'claude'], '没点名改的行原样保留');
});

t('改动校验：未知职能/未知池/重复挂/重复职能/空改动一律整批拒，编制零改动', () => {
  const 原 = () => JSON.stringify(SCFG().编制);
  const bad = [
    [[], '改动必填'],
    [[{ 职能: '音效', 池序: [] }], '未知职能'],
    [[{ 职能: '程序', 池序: [{ 池: 'gemini' }] }], '未知池'],
    [[{ 职能: '程序', 池序: [{ 池: 'codex' }, { 池: 'codex' }] }], '重复挂'],
    [[{ 职能: '程序', 池序: [] }, { 职能: '程序', 池序: [] }], '两次'],
    [[{ 职能: '程序', 池序: 'codex' }], '须是数组'],
  ];
  for (const [体, 片] of bad) {
    const cfg = SCFG();
    const r = roster.apply(cfg, 体);
    assert.equal(r.ok, false, JSON.stringify(体));
    assert.ok(String(r.error).includes(片), `错误文案应含「${片}」，实为：${r.error}`);
    assert.equal(JSON.stringify(cfg.编制), 原(), '整批不写：一条不合法则编制一字不动');
  }
});

t('改动幂等：改成与现状相同 → 无生效条目（journal 记「无实际变化」）', () => {
  const cfg = SCFG();
  const r = roster.apply(cfg, [{ 职能: '程序', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: 'opus' }] }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.生效, []);
});

console.log(`全部通过：${passed} 项`);
