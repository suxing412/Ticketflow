// recommend.test.js — 推荐在途 D28：制作人精力参考值
// 精力档（低=固定1）/ 高档随处理速度爬档 / 窗口过滤 / 池锁封顶 / 积压满归零 / 扣分叠加 / 暂停
const assert = require('node:assert');
const { recommend } = require('../lib/recommend');
const gates = require('../lib/gates');
const journal = require('../lib/journal');
const { makeRoot, seed, CFG } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('recommend 推荐在途测试（D28 精力参考值）');
const CFG4 = { ...CFG, agents: [...CFG.agents, { id: '美术-A', 职能: '美术', 执行池: 'claude' }] }; // 4 在岗
const R = (精力档, extra) => ({ ...CFG4, 推荐: { 精力档, 速度窗口小时: 2, 每档处理数: 2, ...extra } });
const UNLOCKED = { codex: { locked: false }, claude: { locked: false } };
const NOW = Date.now();
// 在 minAgo 分钟前落一条制作人决策流水
const decide = (root, minAgo, text) => journal.append(root, text || '验收 P-XX：通过→完成', new Date(NOW - minAgo * 60000));

t('低精力档 → 固定推荐 1', () => {
  const root = makeRoot();
  for (let i = 0; i < 6; i++) decide(root, 10); // 即使处理速度很快
  const r = recommend(root, R('低'), UNLOCKED, NOW);
  assert.equal(r.推荐, 1);
  assert.equal(r.精力档, '低');
  assert.ok(r.原因.some((x) => x.includes('低精力档')));
});

t('高精力档 · 无近期决策 → 起步档 1', () => {
  const root = makeRoot();
  const r = recommend(root, R('高'), UNLOCKED, NOW);
  assert.equal(r.推荐, 1);
  assert.ok(r.原因.some((x) => x.includes('处理 0 项决策')));
});

t('高精力档 · 窗口内 4 项决策（每档 2）→ 1+2=3', () => {
  const root = makeRoot();
  decide(root, 10, '验收 A1：通过→完成'); decide(root, 30, '投池 A2（待投→池 · 人闸）');
  decide(root, 50, '待定夺裁决 A3：接受（待定夺→待验收）'); decide(root, 70, '定稿 A4（草稿→待投）');
  const r = recommend(root, R('高'), UNLOCKED, NOW);
  assert.equal(r.推荐, 3);
  assert.ok(r.原因.some((x) => x.includes('4 项决策')));
});

t('速度再快也封顶可用人数（编制即上限）', () => {
  const root = makeRoot();
  for (let i = 0; i < 12; i++) decide(root, 5 + i); // 12 项 → 1+6=7 > 4
  const r = recommend(root, R('高'), UNLOCKED, NOW);
  assert.equal(r.推荐, 4);
});

t('窗口外的旧决策不计（3h 前，窗口 2h）', () => {
  const root = makeRoot();
  for (let i = 0; i < 6; i++) decide(root, 180 + i);
  const r = recommend(root, R('高'), UNLOCKED, NOW);
  assert.equal(r.推荐, 1); // 全部过期 → 起步档
});

t('agent 侧动作不算决策（领单/交产出/QA 裁定不爬档）', () => {
  const root = makeRoot();
  journal.append(root, '领单 A1（池→在途 · 策划-A）', new Date(NOW - 600000));
  journal.append(root, '交产出 A1（在途→质检）', new Date(NOW - 500000));
  journal.append(root, 'QA 通过 A1（质检→待验收）', new Date(NOW - 400000));
  const r = recommend(root, R('高'), UNLOCKED, NOW);
  assert.equal(r.推荐, 1);
});

t('claude 池锁：速度档 3 也被可用 1 人封顶', () => {
  const root = makeRoot();
  for (let i = 0; i < 4; i++) decide(root, 10 + i);
  const r = recommend(root, R('高'), { codex: { locked: false }, claude: { locked: true } }, NOW);
  assert.equal(r.可用, 1); // 只剩 程序-A(codex)
  assert.equal(r.推荐, 1);
  assert.ok(r.原因.some((x) => x.includes('claude')));
});

t('待验收积压满（8/8）→ 0，低/高档同拦', () => {
  const root = makeRoot();
  for (let i = 1; i <= 8; i++) seed(root, '待验收', { id: 'A' + i });
  for (let i = 0; i < 4; i++) decide(root, 10 + i);
  assert.equal(recommend(root, R('高'), UNLOCKED, NOW).推荐, 0);
  assert.equal(recommend(root, R('低'), UNLOCKED, NOW).推荐, 0);
});

t('高档扣分叠加：速度档 3 − 积压近闸 − 待定夺 − 滞留 = 0', () => {
  const root = makeRoot();
  for (let i = 0; i < 4; i++) decide(root, 10 + i); // 速度档 3
  for (let i = 1; i <= 6; i++) seed(root, '待验收', { id: 'A' + i }); // 6/8 ≥75% −1
  seed(root, '待定夺', { id: 'E1' }); // −1
  seed(root, '在途', { id: 'S1', 主办: 'x', 领单时间: new Date(NOW).toISOString() });
  require('../lib/core/store').update(root, 'S1', (fm) => { fm.滞留告警 = true; }); // −1
  const r = recommend(root, R('高'), UNLOCKED, NOW);
  assert.equal(r.推荐, 0);
  assert.equal(r.原因.length, 4);
});

t('暂停闸门 → 0', () => {
  const root = makeRoot();
  gates.setPaused(root, 'global', true);
  const r = recommend(root, R('高'), UNLOCKED, NOW);
  assert.equal(r.推荐, 0);
});

console.log(`全部通过：${passed} 项`);
