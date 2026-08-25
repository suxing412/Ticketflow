// dispatch-poolstamp.test.js — 池章语义修理（2026-08-26 TK-201 案 + 同日对抗评审返工「钉池/运行章分家」）
//
// 案发：回队单残留上次派发的 执行池 章，routePool 硬直通 → 章池（codex）额度冻结时
// pickNext 撞闸静默跳过、H85 自愈全程旁路——claude 双槽闲置，四单滞留 7h，journal 零字。
// 首修「回队清章」被评审击中一字段两义（故意钉池与运行章共用 执行池，无差别清章误杀钉池），
// 遂分家：fm.钉池=刻意路由指令（回队不清、路由只认它、撞冻结死局出声）；
//         fm.执行池=纯运行记录（回队即清、**永不参与路由**——残章漏清也只是账面尘埃）。
// 判据面：①钉池活直通 ②钉池冻死局＋拒因 ③运行章残章不路由（分家自证）④pickNext 零派发出声
// ⑤⑥⑦⑧⑨ 回队五真路清运行章（失败分诊/复活/收回/定夺给方向/验收不过）⑩裁决改池落钉池。
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
console.log('池章语义修理测试（TK-201 案·钉池/运行章分家）');

t('① 钉池活着：直通钉的池（评测/成本口径保真）', () => {
  const r = D.routePool(cfg, { id: 'TK-1', 钉池: 'claude', 职能: '程序' }, 冻codex, []);
  assert.deepEqual(r, { 池: 'claude' });
});

t('② 钉池冻结：死局返 null＋拒因出声，不借调', () => {
  const 拒 = [];
  const r = D.routePool(cfg, { id: 'TK-2', 钉池: 'codex', 职能: '程序' }, 冻codex, 拒);
  assert.equal(r, null, '钉池冻结必须走死局，不许直通也不许借调');
  assert.equal(拒.length, 1);
  assert.ok(/TK-2/.test(拒[0]) && /codex/.test(拒[0]), '拒因要点名单号与冻结池（实得 ' + 拒[0] + '）');
});

t('③ 分家自证：运行章残章（执行池:codex）不参与路由——冻结 codex 也照走编制/借调到 claude', () => {
  const 拒 = [];
  const r = D.routePool(cfg, { id: 'TK-3', 执行池: 'codex', 职能: '程序' }, 冻codex, 拒);
  assert.ok(r && r.池 === 'claude', 'TK-201 案的病根就是残章路由——分家后残章必须被无视（实得 ' + JSON.stringify(r) + '）');
  assert.equal(拒.length, 0, '残章不该产生任何滞留');
});

t('④ pickNext：钉池撞冻结→零派发但拒因非空（静默滞留封死）', () => {
  const 拒 = [];
  const picks = D.pickNext(cfg, [
    { id: 'TK-4', 钉池: 'codex', 职能: '程序', 优先级: 'P1', 红链: false, 计划开始: '', 创建时间: '1' },
  ], {}, 冻codex, { codex: 1, claude: 2 }, 拒);
  assert.deepEqual(picks, []);
  assert.equal(拒.length, 1, '零派发必须有滞留缘由，不许再静默');
});

t('⑤ 回队清章：失败分诊重投（待处理→待重派）销运行章、留钉池', () => {
  造单('TK-11', { 执行池: 'codex', 钉池: 'deepseek', 主办: '程序·TK-11' }, '待处理');
  const r = L.失败分诊(root, 'TK-11', '重投');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-11');
  assert.equal(t2.state, '待重派');
  assert.equal(t2.fm.执行池, undefined, '重投回队必须清 执行池 运行章');
  assert.equal(t2.fm.钉池, 'deepseek', '钉池是刻意指令，回队不许清（评审击杀点）');
});

t('⑥ 回队清章：复活（挂起→待重派）销运行章', () => {
  造单('TK-12', { 执行池: 'codex', 挂起时间: '2026-08-26', 挂起前态: '在途' }, '挂起');
  const r = L.复活(root, 'TK-12', '总监');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-12');
  assert.equal(t2.state, '待重派');
  assert.equal(t2.fm.执行池, undefined);
});

t('⑦ 回队清章：收回（在途→待派）销运行章', () => {
  造单('TK-13', { 执行池: 'claude', 主办: '程序·TK-13', 领单时间: '2026-08-26' }, '在途');
  const r = L.收回(root, 'TK-13');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-13');
  assert.equal(t2.state, '待派');
  assert.equal(t2.fm.执行池, undefined);
});

t('⑧ 回队清章：定夺给方向（待处理→待重派）销运行章——评审补的第六路', () => {
  造单('TK-14', { 执行池: 'codex', 主办: '程序·TK-14', 自修次数: 2 }, '待处理');
  const r = L.定夺(root, 'TK-14', '给方向', '按新方向重做', '制作人');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-14');
  assert.equal(t2.state, '待重派');
  assert.equal(t2.fm.执行池, undefined, '定夺给方向回队必须清运行章（评审实证此前漏清）');
});

t('⑨ 回队清章：单张验收不过（完成→待重派）销运行章——与 specials 验收打回 同判', () => {
  造单('TK-15', { 执行池: 'codex', 主办: '程序·TK-15' }, '完成');
  const r = L.验收(root, 'TK-15', false, '边界少验一条');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-15');
  assert.equal(t2.state, '待重派');
  assert.equal(t2.fm.执行池, undefined, '验收不过回队必须清运行章（评审实证此前漏清）');
});

t('⑩ 起草白名单透传钉池：起草章即意图，模型写 执行池 也翻译成 钉池 落盘（H88 通路）', () => {
  const B = require('../lib/pm/brain');
  const fm1 = B.draftFm({ fm: { title: 'x', 职能: '程序', 钉池: 'deepseek' }, body: '' }, { id: 'TK-9', 项目: 'TK' });
  assert.equal(fm1.钉池, 'deepseek');
  const fm3 = B.draftFm({ fm: { title: 'x', 职能: '程序', 执行池: 'deepseek' }, body: '' }, { id: 'TK-9', 项目: 'TK' });
  assert.equal(fm3.钉池, 'deepseek', '起草时不存在运行记录：模型按 H88 契约写的 执行池 就是钉池意图');
  assert.equal(fm3.执行池, undefined, '翻译后不落 执行池——运行章只归派发盖');
  const fm2 = B.draftFm({ fm: { title: 'x', 职能: '程序' }, body: '' }, { id: 'TK-9', 项目: 'TK' });
  assert.equal(fm2.钉池, undefined, '没钉就不落，不造字段');
});

console.log('全部通过：' + passed + ' 项');
