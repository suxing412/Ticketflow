// escalation.test.js — 上呈原因落库 + 卷宗取数（施工令-012 / 巡礼 P2-3）
// 病灶：卷宗第一栏「上呈原因」靠 grep 流水，二级兜底 /上呈|待定夺/ 会命中滞留告警行
// （滞留检查每 30 分钟给滞留单追加一条，且跨月后 readLatest 读不到原始上呈行，兜底必然顶上）。
// 修法两段：lifecycle 流转时写 fm.上呈原因；前端优先读字段，流水只作老单兜底且剔噪声。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const life = require('../lib/lifecycle');
const store = require('../lib/core/store');
const { makeRoot, seed, CFG } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const fmOf = (root, id) => store.find(root, id).fm;
console.log('escalation 上呈原因落库测试（施工令-012）');

/* ---- 一、lifecycle 侧：进待定夺就落库 ---- */

t('QA 三振进待定夺：fm.上呈原因 写自修轮次与上限', () => {
  const root = makeRoot();
  seed(root, '初检', { id: 'E-01', QA: '开', 主办: 'A', 自修次数: 2 });
  assert.equal(life.QA裁定(root, CFG, 'E-01', false).ok, true);
  assert.equal(store.find(root, 'E-01').state, '待处理');
  const 因 = fmOf(root, 'E-01').上呈原因;
  assert.ok(因, '三振上呈没写 上呈原因');
  assert.match(因, /QA 自修 3 轮仍未过（上限 2）/);
  assert.match(因, /三振上呈/);
});

t('QA 未超上限回在途：不写 上呈原因（没上呈就别留话）', () => {
  const root = makeRoot();
  seed(root, '初检', { id: 'E-02', QA: '开', 主办: 'A' });
  life.QA裁定(root, CFG, 'E-02', false);
  assert.equal(store.find(root, 'E-02').state, '在途');
  assert.equal(fmOf(root, 'E-02').上呈原因, undefined);
});

t('QA 通过：不写 上呈原因', () => {
  const root = makeRoot();
  seed(root, '初检', { id: 'E-03', QA: '开', 主办: 'A' });
  life.QA裁定(root, CFG, 'E-03', true);
  assert.equal(fmOf(root, 'E-03').上呈原因, undefined);
});

t('失败上呈出路已消亡（H108）：待处理本身即分诊位，失败分诊只认重投', () => {
  const root = makeRoot();
  seed(root, '待处理', { id: 'E-04', 主办: 'A', 失败原因: 'CLI 非零退出 code=1', 失败次数: 2 });
  const r = life.失败分诊(root, 'E-04', '上呈');
  assert.equal(r.ok, false, '旧「上呈」出路应被拒绝');
  assert.match(r.error, /定夺/, '拒绝话术应指路 定夺');
  assert.equal(store.find(root, 'E-04').state, '待处理', '拒绝时单不动窝');
  assert.equal(fmOf(root, 'E-04').上呈原因, undefined, '拒绝路径不写 上呈原因');
});

t('失败分诊重投：回待重派（带放行旗）不写 上呈原因', () => {
  const root = makeRoot();
  seed(root, '待处理', { id: 'E-05', 主办: 'A', 失败原因: 'x' });
  life.失败分诊(root, 'E-05', '重投');
  assert.equal(store.find(root, 'E-05').state, '待重派');
  assert.equal(fmOf(root, 'E-05').放行, true, '重投=明确指令，带放行旗');
  assert.equal(fmOf(root, 'E-05').上呈原因, undefined);
});

t('原因单行且限长（多行/超长仲裁因不撑爆 frontmatter）', () => {
  const root = makeRoot();
  seed(root, '仲裁', { id: 'E-06', 主办: 'A', 仲裁因: 'a\nb\n' + 'x'.repeat(400) });
  life.仲裁定(root, 'E-06', '上呈');
  const 因 = fmOf(root, 'E-06').上呈原因;
  assert.ok(!因.includes('\n'), '上呈原因不得多行');
  assert.ok(因.length <= 200, '上呈原因超 200 字：' + 因.length);
});

t('滞留检查只标告警，绝不改写 上呈原因（噪声不污染事实源）', () => {
  const root = makeRoot();
  seed(root, '初检', { id: 'E-07', QA: '开', 主办: 'A', 自修次数: 2 });
  life.QA裁定(root, CFG, 'E-07', false);
  const 原 = fmOf(root, 'E-07').上呈原因;
  life.滞留检查(root, CFG, Date.now() + 9 * 3600000);
  assert.equal(fmOf(root, 'E-07').滞留告警, true);
  assert.equal(fmOf(root, 'E-07').上呈原因, 原);
});

/* ---- 二、前端侧：卷宗取数 escalReason（从 public/app.js 原样抽出，纯函数无 DOM 依赖）---- */

const escalReason = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const a = src.indexOf('// @testable-begin escalReason');
  const b = src.indexOf('// @testable-end escalReason');
  assert.ok(a >= 0 && b > a, 'public/app.js 里的 escalReason 抽取标记丢了——测试与实现已脱钩');
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(a, b) + '\nreturn escalReason;')();
})();

const 滞留行 = '[2026-08-07 01:09] 滞留告警 E-99（待定夺 停留 7h，超 4h）——请人工检查，未自动撤回';
const 三振行 = '[2026-08-06 22:10] QA 修不好 E-99 → 待定夺（四件套呈你我）';

t('字段优先：有 fm.上呈原因 就直接用，流水再吵也盖不住', () => {
  const r = escalReason({ 上呈原因: 'QA 自修 3 轮仍未过（上限 2）→ 三振上呈' }, [滞留行, 滞留行], 'E-99');
  assert.equal(r, 'QA 自修 3 轮仍未过（上限 2）→ 三振上呈');
});

t('老单兜底：无字段时仍从流水捞到真正的上呈行', () => {
  assert.equal(escalReason({}, [三振行, 滞留行], 'E-99'), 三振行);
});

t('病灶复现回归：只剩滞留告警行时绝不冒名顶替', () => {
  const r = escalReason({}, [滞留行], 'E-99');
  assert.ok(!r.includes('滞留告警'), '滞留告警又顶上来了：' + r);
  assert.equal(r, '（流水与工单里都没记到上呈原因）');
});

t('「待定夺裁决」是裁决结果不是上呈原因，二级兜底不再收', () => {
  const 裁决行 = '[2026-08-07 02:00] 待定夺裁决 E-99：给方向（待定夺→在途 · 制作人）';
  assert.ok(!escalReason({}, [裁决行], 'E-99').includes('待定夺裁决'));
});

t('二级兜底仍认「上呈」与「→ 待定夺」转移行', () => {
  const 行 = '[2026-08-07 03:00] 连环异常 E-99 上呈：执行链三连超时';
  assert.equal(escalReason({}, [行], 'E-99'), 行);
  const 转移行 = '[2026-08-07 03:00] E-99 由 执行失败 → 待定夺';
  assert.equal(escalReason({}, [转移行], 'E-99'), 转移行);
});

t('一级正则优先于二级：真上呈事件盖过旁支「上呈」行', () => {
  const 旁支 = '[2026-08-06 20:00] 战役 B-1 连环异常上呈（含 E-99）';
  assert.equal(escalReason({}, [三振行, 旁支, 滞留行], 'E-99'), 三振行);
});

t('流水与字段都空：退回 fm 自修次数 / 失败原因，最后才认输', () => {
  assert.match(escalReason({ 自修次数: 3 }, [], 'E-99'), /自修 3 轮未过/);
  assert.match(escalReason({ 失败原因: 'CLI 崩了' }, [], 'E-99'), /执行失败上呈：CLI 崩了/);
  assert.equal(escalReason(null, null, 'E-99'), '（流水与工单里都没记到上呈原因）');
});

t('端到端：三振单的 fm 直接喂给取数函数，卷宗读到的就是落库那句', () => {
  const root = makeRoot();
  seed(root, '初检', { id: 'E-10', QA: '开', 主办: 'A', 自修次数: 2 });
  life.QA裁定(root, CFG, 'E-10', false);
  life.滞留检查(root, CFG, Date.now() + 9 * 3600000); // 制造噪声条件
  const r = escalReason(fmOf(root, 'E-10'), [滞留行.replace(/E-99/g, 'E-10')], 'E-10');
  assert.match(r, /QA 自修 3 轮仍未过/);
  assert.ok(!r.includes('滞留告警'));
});

console.log('全部通过：' + passed + ' 项');
