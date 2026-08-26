// verify-orphan.test.js — 核查孤儿补链（2026-08-26 巡检案）
//
// 案发：代核章落盘（store.update）与 送仲裁（store.move）两步不原子——中断在缝上即孤儿：
// 章在 → 审检挑单条件 !fm.代核 不再挑它；边没走 → 永滞留核查目录。TK-183/186/188/192
// 四张滞留 12h+，唯一出声是每 30 分钟一条滞留告警（且原 送仲裁 失败分支静默）。
// 判据面：①孤儿识别纯函数（只认 代核.结论=不过 且非挂起）②补链端到端（核查→仲裁 真迁）。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.STUDIO_STUB = '1';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-'));
const store = require('../lib/core/store');
const R = require('../lib/runner');
const L = require('../lib/lifecycle');
store.ensureDirs(root);
fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify({ 项目: { 注册: { TK: {} }, 默认: 'TK' } }));

const 造单 = (id, fm = {}, 态 = '核查') => {
  fs.writeFileSync(path.join(root, 态, id + '.md'),
    '---\n' + Object.entries({ id, title: id + '题', 职能: '程序', 放行: true, ...fm })
      .map(([k, v]) => k + ': ' + JSON.stringify(v)).join('\n') + '\n---\n正文\n');
};

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('核查孤儿补链测试（2026-08-26 案）');

t('① 孤儿识别：代核不过且非挂起才算——通过/未核/挂起/初检不过候人 都不误伤', () => {
  造单('TK-801', { 代核: { 结论: '不过', 时间: '2026-08-25T12:00:00Z' } });          // 真孤儿
  造单('TK-802', { 代核: { 结论: '通过', 时间: '2026-08-25T12:00:00Z' }, 待引擎实证: true }); // 候实证驻留位，不许碰
  造单('TK-803', {});                                                                 // 还没核，审检自会挑
  造单('TK-804', { 代核: { 结论: '不过' }, 挂起: '制作人冻结' });                      // 挂起=原位冻结
  造单('TK-805', { 初检: { 结论: '不过' } });                                          // 初检不过候人工/返修（设计态）
  const ids = R.核查孤儿们(root).map((x) => x.id).sort();
  assert.deepEqual(ids, ['TK-801'], '只有代核不过的孤儿命中（实得 ' + ids.join(',') + '）');
});

t('② 补链端到端：孤儿经 送仲裁 真迁仲裁目录，代核章保留（史不改）', () => {
  const r = L.送仲裁(root, 'TK-801', '核查不过（孤儿补链自愈）');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-801');
  assert.equal(t2.state, '仲裁');
  assert.equal(t2.fm.代核.结论, '不过', '补链只走边不改章——章是核查席的判断记录');
  assert.deepEqual(R.核查孤儿们(root).map((x) => x.id), [], '补链后孤儿清零（自愈收敛，不许每拍重推同一张）');
});

t('③ 回炉清审检章（TK-197 循环误伤案）：仲裁打回销 代核/核查/初检——新产出必走全新核查，不被旧章再送仲裁', () => {
  造单('TK-806', { 代核: { 结论: '不过' }, 核查: { 结论: '不过' }, 初检: { 结论: '过' }, 主办: '程序·TK-806' }, '仲裁');
  const r = L.仲裁定(root, 'TK-806', '打回', '给方向回炉');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-806');
  assert.equal(t2.state, '在途');
  assert.ok(!t2.fm.代核 && !t2.fm.核查 && !t2.fm.初检, '旧审检章必须随回炉销毁——它是对上一版产出的判断');
  // 反向自证：残章若在，孤儿补链会把回炉单当孤儿——分家判据
  造单('TK-807', { 代核: { 结论: '不过' } }, '核查');
  assert.deepEqual(R.核查孤儿们(root).map((x) => x.id), ['TK-807'], '真孤儿照抓；打回后的 TK-806 不在核查不受扫');
});

t('④ 仲裁孤儿（12:11 第二现场）：代裁章在而边未走的才算；识别+按章补推+清章链全绿', () => {
  造单('TK-810', { 代裁: { 结论: '给方向', 时间: '2026-08-25T12:30:00Z' }, 仲裁因: '核查不过' }, '仲裁');
  造单('TK-811', { 代裁: { 结论: '上呈' } }, '仲裁');
  造单('TK-812', {}, '仲裁'); // 未裁：代裁席自会挑，不算孤儿
  const ids = R.仲裁孤儿们(root).map((x) => x.id).sort();
  assert.deepEqual(ids, ['TK-810', 'TK-811'], '只有带裁章的滞留单算孤儿（实得 ' + ids.join(',') + '）');
  const r = L.仲裁定(root, 'TK-810', '打回', '孤儿补链');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-810');
  assert.equal(t2.state, '在途');
  assert.ok(!t2.fm.代裁 && !t2.fm.代核, '打回回炉销全部旧审检章（含 代裁——TK-197 案清单漏它的教训）');
});

t('⑤ 送仲裁清旧裁章（TK-197 卡死案）：再入仲裁的单不带上一轮代裁章，代裁席才会重裁', () => {
  造单('TK-813', { 代核: { 结论: '不过' }, 代裁: { 结论: '给方向', 时间: '2026-08-25T21:04:00Z' } }, '核查');
  const r = L.送仲裁(root, 'TK-813', '核查不过（第二轮）');
  assert.ok(r.ok, JSON.stringify(r));
  const t2 = store.find(root, 'TK-813');
  assert.equal(t2.state, '仲裁');
  assert.equal(t2.fm.代裁, undefined, '旧裁章随入仲裁销毁——留着就挡住新一轮裁决的挑单');
});

console.log('全部通过：' + passed + ' 项');
