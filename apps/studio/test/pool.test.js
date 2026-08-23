// pool.test.js — 拉取制：排序/职能匹配/在途上限/一人一张/依赖/原子领单
// 外呼绊线必须排在任何 lib/ 之前：lib/quota.js 在加载那一刻就把 child_process 解构走了（体检 #71）
const 绊线 = require('./外呼绊线'); 绊线.装绊线();
const assert = require('node:assert');
const pool = require('../lib/pool');
const store = require('../lib/core/store');
const quota = require('../lib/quota');
const { makeRoot, seed, CFG } = require('./helper');

// 断网：让额度锁 fail-open（不触真实 codex/claude）
quota.getRateLimits = async () => null;
quota.getClaudeUsage = async () => null;

let passed = 0; const tests = [];
const t = (n, f) => tests.push([n, f]);
console.log('pool 拉取制测试');

t('listPool 按优先级 > 创建时间排序', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 职能: '策划', 优先级: 'P2', 创建时间: '2026-07-01' });
  seed(root, '池', { id: 'B', 职能: '策划', 优先级: 'P0', 创建时间: '2026-07-03' });
  seed(root, '池', { id: 'C', 职能: '策划', 优先级: 'P2', 创建时间: '2026-06-20' });
  assert.deepEqual(pool.listPool(root, CFG, '策划').map((x) => x.id), ['B', 'C', 'A']);
});

t('领单：职能匹配，队首入在途并记主办', async () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 职能: '策划', 优先级: 'P1' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, true);
  assert.equal(r.id, 'A');
  const f = store.find(root, 'A');
  assert.equal(f.state, '在途');
  assert.equal(f.fm.主办, '策划-A');
  assert.equal(f.fm.执行池, 'claude');
});

t('领单：不领他职能的单', async () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 职能: '程序' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, false);
  assert.ok(r.empty);
  assert.equal(store.find(root, 'A').state, '池'); // 程序单还在池里
});

t('一人一张：已持在途单不能再领', async () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'X', 职能: '策划', 主办: '策划-A', 领单时间: new Date().toISOString() });
  seed(root, '池', { id: 'Y', 职能: '策划' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('一人一张'));
});

t('D17 修订：同职能多 agent 可并行（职能并发=在岗人数）', async () => {
  const root = makeRoot();
  seed(root, '质检', { id: 'X', 职能: '策划', 主办: '策划-B', 领单时间: new Date().toISOString() });
  seed(root, '池', { id: 'Y', 职能: '策划' });
  const r = await pool.claim(root, CFG, '策划-A'); // 策划-B 已持单，策划-A 仍可领
  assert.equal(r.ok, true);
  assert.equal(r.id, 'Y');
});

t('编制即上限：他人持单不挡我，只有自己持单才拒（每人一张）', async () => {
  const root = makeRoot();
  const now = new Date().toISOString();
  seed(root, '在途', { id: 'A1', 职能: '程序', 主办: '程序-A', 领单时间: now });
  seed(root, '质检', { id: 'A2', 职能: 'QA', 主办: 'QA-A', 领单时间: now });
  seed(root, '池', { id: 'Y', 职能: '策划' });
  const r = await pool.claim(root, CFG, '策划-A'); // 别人都持单，策划-A 空手 → 可领
  assert.equal(r.ok, true);
  const r2 = await pool.claim(root, CFG, '策划-A'); // 自己已持单 → 拒
  assert.equal(r2.ok, false);
  assert.ok(r2.error.includes('一人一张'));
});

t('依赖未完成 → 跳过该单', async () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'DEP', 职能: '程序', 主办: '程序-A', 领单时间: new Date().toISOString() });
  seed(root, '池', { id: 'A', 职能: '策划', 依赖: 'DEP' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, false);
  assert.ok(r.empty); // DEP 未完成，A 不可领
});

t('依赖已完成 → 可领', async () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'DEP', 职能: '程序' });
  seed(root, '池', { id: 'A', 职能: '策划', 依赖: 'DEP' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, true);
  assert.equal(r.id, 'A');
});

t('切池：agent 个体执行池覆盖职能默认，领单盖新池章', async () => {
  const root = makeRoot();
  // 程序职能默认 codex 池；程序-B 个体切到 claude 池 → 领单章应为 claude
  const cfg2 = { ...CFG, agents: [...CFG.agents, { id: '程序-B', 职能: '程序', 执行池: 'claude' }] };
  seed(root, '池', { id: 'A', 职能: '程序' });
  const r = await pool.claim(root, cfg2, '程序-B');
  assert.equal(r.ok, true);
  assert.equal(r.执行池, 'claude');
  assert.equal(store.find(root, 'A').fm.执行池, 'claude');
});

t('红链优先（D43⑤）：同优先级内关键路径单先被领；红链优先=false 时回退纯时间序', async () => {
  const root = makeRoot();
  // A 独行小单（先创建）；B 是长链头（B←C←D，加权 9h）——同 P1，红链应插队
  seed(root, '池', { id: 'A', 职能: '策划', 优先级: 'P1', 预计时间: '1h', 创建时间: '2026-07-01' });
  seed(root, '池', { id: 'B', 职能: '策划', 优先级: 'P1', 预计时间: '3h', 创建时间: '2026-07-02' });
  seed(root, '待投', { id: 'C', 职能: '程序', 依赖: 'B', 预计时间: '4h' });
  seed(root, '待投', { id: 'D', 职能: '装配', 依赖: 'C', 预计时间: '2h' });
  assert.deepEqual(pool.listPool(root, CFG, '策划').map((x) => x.id), ['B', 'A'], '红链 B 插队');
  const off = { ...CFG, 执行器: { ...(CFG.执行器 || {}), 红链优先: false } };
  assert.deepEqual(pool.listPool(root, off, '策划').map((x) => x.id), ['A', 'B'], '关掉回退时间序');
});

t('原子领单竞态：跳过被抢走的，领下一张', async () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 职能: '策划', 优先级: 'P0' });
  // 模拟 A 在领单瞬间被并发移走
  store.move(root, 'A', '池', '待投'); // A 已不在池
  seed(root, '池', { id: 'B', 职能: '策划', 优先级: 'P1' });
  const r = await pool.claim(root, CFG, '策划-A');
  assert.equal(r.ok, true);
  assert.equal(r.id, 'B'); // A 被抢走，领到 B
});

/* ===== poolFor 去双账（施工令-027，2026-08-09）=====
   现网 2026-08-09 03:00 的真实分歧（本夹具 1:1 复刻，只是把职能名换成中性名）：
     · 编制表 cfg.编制 —— 派发/领单真正走的那本账
     · 老映射 cfg.执行池.<池>.职能 —— 改造前 poolFor 读的那本账
   两本一旦对不上，poolFor 就在撒谎；之所以没炸，是所有调用点都写成「池序[0] || poolFor()」。*/
const 双账CFG = {
  职能: ['策划', '程序', '美术', '技术策划'],
  执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', '美术'] }, deepseek: { 职能: [] } },
  编制: [
    { 职能: '策划', 池序: [{ 池: 'claude', 档: '' }] },                              // 两账一致
    { 职能: '程序', 池序: [{ 池: 'claude', 档: '' }, { 池: 'codex', 档: '' }] },      // 分歧：老表说 codex
    { 职能: '美术', 池序: [{ 池: 'codex', 档: '' }] },                               // 分歧：老表说 claude
    { 职能: '技术策划', 池序: [{ 池: 'claude', 档: '' }] },                          // 编制有、老表**没有**
  ],
};
// 改造前的 poolFor 原文（对拍基准，逐字保留）
const poolForOld = (cfg, 职能) => {
  for (const [p, c] of Object.entries(cfg.执行池 || {})) if ((c.职能 || []).includes(职能)) return p;
  return null;
};

t('poolFor 委托编制表：编制有而老表无的职能照样解析得出池（技术策划误报红灯案）', () => {
  assert.equal(poolForOld(双账CFG, '技术策划'), null, '前提：老映射里确实没有这个职能');
  assert.equal(pool.poolFor(双账CFG, '技术策划'), 'claude', '编制表说 claude，就该答 claude');
});

t('poolFor 两账分歧时以编制为准（老表的答案是过期的那个）', () => {
  assert.equal(pool.poolFor(双账CFG, '程序'), 'claude'); // 老表答 codex
  assert.equal(pool.poolFor(双账CFG, '美术'), 'codex');  // 老表答 claude
});

t('poolFor 老映射兜底：无编制行 / 池序为空时逐字回落旧行为', () => {
  const 无编制 = { ...双账CFG, 编制: [] };
  for (const fn of 无编制.职能) assert.equal(pool.poolFor(无编制, fn), poolForOld(无编制, fn), fn);
  const 空池序 = { ...双账CFG, 编制: [{ 职能: '美术', 池序: [] }] };
  assert.equal(pool.poolFor(空池序, '美术'), 'claude', '池序显式清空 = 回落职能默认池');
  assert.equal(pool.poolFor(双账CFG, '不存在的职能'), null);
});

t('行为等价：所有调用点的「池序[0] || poolFor()」新旧解析结果零差异', () => {
  // 全仓调用点都是这个形状（dispatch.js:107 / recommend.js:55 / pool.claim / roster.snapshot），
  // 即 poolFor 只在池序为空时才被消费——这条断言就是施工令-027「行为等价」那一条的机器化。
  const roster = require('../lib/roster');
  for (const cfg of [双账CFG, CFG, { ...双账CFG, 编制: [] }]) {
    for (const fn of [...(cfg.职能 || []), ...roster.read(cfg).map((r) => r.职能)]) {
      const 池序 = roster.poolsOf(cfg, fn);
      assert.equal(池序[0] || pool.poolFor(cfg, fn), 池序[0] || poolForOld(cfg, fn), `${fn} 生效池不该变`);
    }
  }
});

(async () => {
  for (const [n, f] of tests) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error(e); process.exit(1); });
