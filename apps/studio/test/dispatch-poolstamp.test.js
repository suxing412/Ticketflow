// dispatch-poolstamp.test.js — 池章语义修理（2026-08-26 TK-201 案）
//
// 案发：回队单残留上次派发的 执行池 章，routePool 硬直通 → 章池（codex）额度冻结时
// pickNext 撞闸静默跳过、H85 自愈全程旁路——claude 双槽闲置，四单滞留 7h，journal 零字。
// 判据面：①章池活着直通不变 ②章池冻结→死局＋拒因出声（不借调，钉池保评测口径）
// ③pickNext 全链零派发但拒因非空 ④回队三真路（失败分诊/复活/收回）清运行章。
// 另两处回队（runner 评估回呈、specials 验收打回）夹具重，由 ② 的出声闸兜底：漏清的章
// 至多滞留出声，不可能再静默——这正是本案要治的病灶。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.STUDIO_STUB = '1';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poolstamp-'));
const store = require('../lib/core/store');
const D = require('../lib/pm/dispatch');
const L = require('../lib/lifecycle');
store.ensureDirs(root);
fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify({ 项目: { 注册: { TK: {} }, 默认: 'TK' }, 执行池: { codex: {}, claude: {} } }));

const 造单 = (id, fm = {}, 态 = '待派') => {
  fs.writeFileSync(path.join(root, 态, id + '.md'),
    '---\n' + Object.entries({ id, title: id + '题', 职能: '程序', 放行: true, ...fm })
      .map(([k, v]) => k + ': ' + JSON.stringify(v)).join('\n') + '\n---\n正文\n');
};
const cfg = { 执行池: { codex: {}, claude: {} } };
const 冻codex = { codex: { locked: true, fivePct: 100 }, claude: { locked: false, fivePct: 30 } };

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('池章语义修理测试（2026-08-26 TK-201 案）');

t('① 章池活着：池章直通不变（钉池单仍钉池）', () => {
  const r = D.routePool(cfg, { id: 'TK-1', 执行池: 'claude', 职能: '程序' }, 冻codex, []);
  assert.deepEqual(r, { 池: 'claude' });
});

t('② 章池冻结：死局返 null＋拒因出声，不借调（评测口径保真）', () => {
  const 拒 = [];
  const r = D.routePool(cfg, { id: 'TK-2', 执行池: 'codex', 职能: '程序' }, 冻codex, 拒);
  assert.equal(r, null, '章池冻结必须走死局，不许直通也不许借调');
  assert.equal(拒.length, 1);
  assert.ok(/TK-2/.test(拒[0]) && /codex/.test(拒[0]), '拒因要点名单号与冻结池（实得 ' + 拒[0] + '）');
});

t('③ pickNext：钉池撞冻结→零派发但拒因非空（静默滞留封死）', () => {
  const 拒 = [];
  const picks = D.pickNext(cfg, [
    { id: 'TK-3', 执行池: 'codex', 职能: '程序', 优先级: 'P1', 红链: false, 计划开始: '', 创建时间: '1' },
  ], {}, 冻codex, { codex: 1, claude: 2 }, 拒);
  assert.deepEqual(picks, []);
  assert.equal(拒.length, 1, '零派发必须有滞留缘由，不许再静默');
});

t('④ 回队清章：失败分诊重投（待处理→待重派）销运行章', () => {
  造单('TK-11', { 执行池: 'codex', 主办: '程序·TK-11' }, '待处理');
  const r = L.失败分诊(root, 'TK-11', '重投');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-11');
  assert.equal(t2.state, '待重派');
  assert.equal(t2.fm.执行池, undefined, '重投回队必须清 执行池 运行章');
});

t('⑤ 回队清章：复活（挂起→待重派）销运行章', () => {
  造单('TK-12', { 执行池: 'codex', 挂起时间: '2026-08-26', 挂起前态: '在途' }, '挂起');
  const r = L.复活(root, 'TK-12', '总监');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-12');
  assert.equal(t2.state, '待重派');
  assert.equal(t2.fm.执行池, undefined, '复活回队必须清 执行池 运行章');
});

t('⑥ 回队清章：收回（在途→待派）销运行章', () => {
  造单('TK-13', { 执行池: 'claude', 主办: '程序·TK-13', 领单时间: '2026-08-26' }, '在途');
  const r = L.收回(root, 'TK-13');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-13');
  assert.equal(t2.state, '待派');
  assert.equal(t2.fm.执行池, undefined, '收回必须清 执行池 运行章');
});

console.log('全部通过：' + passed + ' 项');
