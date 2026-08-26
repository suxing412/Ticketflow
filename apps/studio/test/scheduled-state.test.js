// scheduled-state.test.js — H116「已排期」态全链判据（2026-08-26 制作人 01:04 拍板）
//
// 被测协议：已排期 = 放行 ∧ 有计划开始。
//   · 桥（lib/pm/schedule.同步已排期态）：排期落账（重排/表态重排）→ 待派/待重派 迁入 已排期；
//     计划被清 → 已排期 退回 待派。唯一桥，别处不许各迁各的。
//   · 对称（lifecycle.放行）：先排后放的单，放行那一刻补迁。
//   · 扫描面（dispatch.readySet）：已排期 是唯一被今时线扫描的排期态；待派/待重派 只剩散单直派道，
//     有粒ID 的单一律不直派（G24 未排期视野兜底）。
//   · 存量迁移脚本（scratchpad/迁移已排期.js）：同一把尺（放行∧粒ID∧粒有计划开始）。
//
// 变异自证（实跑记录，见 H116 收尾报告）：
//   ① 删 schedule.同步已排期态 的迁入分支 → 本套件 ①②当场红；
//   ② 删 dispatch.readySet 的「有粒待派单跳过」一刀 → 本套件 ④ 当场红。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRoot, seed, 收尾 } = require('./helper');
const store = require('../lib/core/store');
const S = require('../lib/pm/schedule');
const D = require('../lib/pm/dispatch');
const life = require('../lib/lifecycle');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('已排期态（H116）测试');

const 登记一 = (root, o = {}) => {
  const r = S.登记(root, [{ 题: o.题 || '粒' + Math.random().toString(36).slice(2, 6), 来源: 'H116判据', ...o }], '总监');
  assert.ok(r.ok, '登记应成功：' + r.error);
  return r.新增[0];
};
const 版本 = (root, gid) => S.取(root, gid).版本号;

// ── ① 桥双向：排期落账→迁入；清计划→退回；表态重排同桥 ──────────────
t('桥双向：重排落计划 → 待派迁已排期；清计划 → 退回待派；表态重排走同一座桥', () => {
  const root = makeRoot();
  const g = 登记一(root, { 题: '桥粒' });
  S.挂钩起草(root, g.粒ID, 'TK-800');            // 回填单号（桥按 粒.单号 找单）
  seed(root, '待派', { id: 'TK-800', 放行: true, 粒ID: g.粒ID });
  // 排期落账 → 迁入
  const r1 = S.重排(root, { 粒ID: g.粒ID, 预期版本: 版本(root, g.粒ID), 计划开始: '2026-09-01', 计划完成: '2026-09-02', 因: 'H116 首排', 操作者: '项管' });
  assert.ok(r1.ok, r1.error);
  assert.equal(store.find(root, 'TK-800').state, '已排期', '重排落计划开始 → 单迁 已排期');
  // 清计划 → 退回待派
  const r2 = S.重排(root, { 粒ID: g.粒ID, 预期版本: 版本(root, g.粒ID), 计划开始: null, 计划完成: null, 因: '清计划', 操作者: '项管' });
  assert.ok(r2.ok, r2.error);
  assert.equal(store.find(root, 'TK-800').state, '待派', '计划被清 → 退回 待派');
  assert.equal(store.find(root, 'TK-800').fm.放行, true, '退回不撤放行旗——排期与放行是两面旗');
  // 表态重排（H112 写口）走同一座桥
  const r3 = S.表态(root, { 粒ID: g.粒ID, 预期版本: 版本(root, g.粒ID), 触发源: '巡检', 决定: '重排', 类别: '前置依赖未到', 新计划开始: '2026-09-03', 因: '依赖到了再开工', 操作者: '项管' });
  assert.ok(r3.ok, r3.error);
  assert.equal(store.find(root, 'TK-800').state, '已排期', '表态重排同样是排期落账——同一座桥迁入');
  // journal 留痕（桥的迁移要能对账）
  const 月 = new Date().toISOString().slice(0, 7);
  const 痕 = fs.readFileSync(path.join(root, 'journal', 月 + '.log'), 'utf8');
  assert.ok(痕.includes('进已排期 TK-800'), '迁入要留痕');
  assert.ok(痕.includes('退排期 TK-800'), '退回要留痕');
});

// ── ② 放行对称：先排后放，放行那一刻补迁 ──────────────────────────
t('放行对称：粒先有计划、单后放行 → lifecycle.放行 当场补迁 已排期', () => {
  const root = makeRoot();
  const g = 登记一(root, { 题: '先排粒', 计划开始: '2026-09-05', 计划完成: '2026-09-06', 因: '登记即带排期（P0-8 带因）' });
  S.挂钩起草(root, g.粒ID, 'TK-801');
  seed(root, '待派', { id: 'TK-801', 粒ID: g.粒ID });   // 未放行：排期在先，桥不迁（放行是闸，排期不代闸）
  assert.equal(store.find(root, 'TK-801').state, '待派', '未放行的单排了期也不迁');
  const r = life.放行(root, 'TK-801');
  assert.ok(r.ok, r.error);
  const t1 = store.find(root, 'TK-801');
  assert.equal(t1.state, '已排期', '放行动作侧对称补同步：放行∧有计划 → 迁 已排期');
  assert.equal(t1.fm.放行, true);
});

// ── ③ 散单不迁：无粒ID 的单不受桥与迁移影响，直派道照旧 ─────────────
t('散单不迁：无粒的单留在待派直派道；别的粒重排动不到它', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'TK-802', 放行: true, QA: '关' });   // 散单
  const g = 登记一(root, { 题: '别的粒' });                      // 无单号的粒：重排也牵不走任何单
  const r = S.重排(root, { 粒ID: g.粒ID, 预期版本: 版本(root, g.粒ID), 计划开始: '2020-01-01', 因: '判据', 操作者: '项管' });
  assert.ok(r.ok, r.error);
  assert.equal(store.find(root, 'TK-802').state, '待派', '散单不迁');
  const ready = D.readySet(root, null);
  const 行 = ready.find((x) => x.id === 'TK-802');
  assert.ok(行, '散单照常在就绪面（排期外杂活容量驱动）');
  assert.equal(行.态, '待派', '态字段=真实所在目录（派发 move 以它为源态）');
});

// ── ④ dispatch 扫描面：有粒待派单不入就绪；已排期到点入、未到点不入 ──
t('扫描面：待派里有粒的单不入就绪（就算到点）；已排期到点入、未到点拦', () => {
  const root = makeRoot();
  const ga = 登记一(root, { 题: '甲', 计划开始: '2020-01-01', 因: '判据' });  // 早已到点
  const gb = 登记一(root, { 题: '乙', 计划开始: '2020-01-01', 因: '判据' });
  const gc = 登记一(root, { 题: '丙', 计划开始: '2099-01-01', 因: '判据' });  // 未来
  seed(root, '待派', { id: 'TK-810', 放行: true, 粒ID: ga.粒ID });       // 有粒还在待派＝没走排期桥，不直派
  seed(root, '已排期', { id: 'TK-811', 放行: true, 粒ID: gb.粒ID });     // 已排期且到点：入
  seed(root, '已排期', { id: 'TK-812', 放行: true, 粒ID: gc.粒ID });     // 已排期未到点：拦
  seed(root, '待派', { id: 'TK-813', 放行: true });                      // 散单：入
  const ids = D.readySet(root, null).map((x) => x.id).sort();
  assert.deepEqual(ids, ['TK-811', 'TK-813'],
    '唯一扫描的排期态是 已排期；待派有粒单（TK-810）与未到点单（TK-812）都不入（实得 ' + ids.join(',') + '）');
  const 态 = Object.fromEntries(D.readySet(root, null).map((x) => [x.id, x.态]));
  assert.equal(态['TK-811'], '已排期', '就绪行带真实源态');
});

// ── ⑤ 迁移脚本判据：同一把尺（放行∧粒ID∧粒有计划开始），演练不写、真跑原子迁、幂等 ──
const 脚本 = process.env.H116迁移脚本 || 'C:/Users/suxin/AppData/Local/Temp/claude/C--Users-suxin-Desktop-ai-vault/45bf2b4e-1f79-42c1-ad25-2d264f1e1c9a/scratchpad/迁移已排期.js';
if (!fs.existsSync(脚本)) {
  console.log('  · ⑤迁移脚本判据：脚本不在（' + 脚本 + '，scratchpad 已清）——跳过，不计通过');
} else {
  t('迁移脚本：演练零写盘；真跑只迁 放行∧粒ID∧有计划开始 的单；重跑幂等', () => {
    const { execFileSync } = require('child_process');
    const root = makeRoot();
    const g迁 = 登记一(root, { 题: '应迁', 计划开始: '2026-09-01', 因: '判据' });
    const g无 = 登记一(root, { 题: '无期' });
    const g重 = 登记一(root, { 题: '重派迁', 计划开始: '2026-09-02', 因: '判据' });
    seed(root, '待派', { id: 'TK-820', 放行: true, 粒ID: g迁.粒ID });    // 应迁
    seed(root, '待派', { id: 'TK-821', 放行: true });                    // 散单：留
    seed(root, '待重派', { id: 'TK-822', 放行: true, 粒ID: g无.粒ID }); // 粒无计划：留（G24 视野）
    seed(root, '待派', { id: 'TK-823', 粒ID: g迁.粒ID });                // 未放行：留
    seed(root, '待重派', { id: 'TK-824', 放行: true, 粒ID: 'ghost-悬空' }); // 悬空粒：留 + 点名
    seed(root, '待重派', { id: 'TK-825', 放行: true, 粒ID: g重.粒ID });  // 待重派→已排期 边也走
    const 跑 = (args) => execFileSync(process.execPath, [脚本, '--root', root, ...args], { encoding: 'utf8', timeout: 30000 });
    const 演 = 跑([]);
    assert.match(演, /应迁 2/, '演练点数：TK-820 + TK-825（实出：' + 演.split('\n')[1] + '）');
    for (const id of ['TK-820', 'TK-821', 'TK-822', 'TK-823', 'TK-824', 'TK-825']) {
      assert.notEqual(store.find(root, id).state, '已排期', '演练一个字节不写：' + id);
    }
    const 真 = 跑(['--真跑']);
    assert.match(真, /成 2 \/ 应迁 2/, '真跑迁成两张：' + 真.split('\n').pop());
    assert.equal(store.find(root, 'TK-820').state, '已排期');
    assert.equal(store.find(root, 'TK-825').state, '已排期');
    for (const [id, st] of [['TK-821', '待派'], ['TK-822', '待重派'], ['TK-823', '待派'], ['TK-824', '待重派']]) {
      assert.equal(store.find(root, id).state, st, id + ' 不该动');
    }
    assert.match(真, /悬空粒 1/, '悬空粒要点名');
    const 月 = new Date().toISOString().slice(0, 7);
    const 痕 = fs.readFileSync(path.join(root, 'journal', 月 + '.log'), 'utf8');
    assert.ok(痕.includes('进已排期 TK-820') && 痕.includes('进已排期 TK-825'), '迁移逐单留痕');
    assert.ok(痕.includes('H116 存量迁移收口'), '收口一行汇总留痕');
    const 再 = 跑(['--真跑']);
    assert.match(再, /应迁 0/, '重跑幂等：已迁的单不在扫描面');
  });
}

t('⑥ 排期态兜底扫描（2026-08-26 案）：绕过 lifecycle.放行 直写 fm.放行 的单，下一拍被补迁', () => {
  const root = makeRoot();
  const g = 登记一(root, { 题: '兜底粒', 预估单元: 1, 计划开始: '2026-08-26T09:00', 计划完成: '2026-08-26T10:00', 因: '判据' });
  seed(root, '待派', { id: 'TK-830', 职能: '程序', 粒ID: g.粒ID });
  S.挂钩起草(root, g.粒ID, 'TK-830'); // 回填单号（同真实已成单粒：桥按 粒.单号 找单）
  // 模拟项管裁决改单/改池：store.update 直写放行，**不经 lifecycle.放行()** → 桥不触发
  store.update(root, 'TK-830', (fm) => { fm.放行 = true; });
  assert.equal(store.find(root, 'TK-830').state, '待派', '直写放行后桥确实没迁——这就是病灶');
  // 兜底扫描（每拍在 runner.tick 内跑，此处直调同一函数）
  const 迁 = require('../lib/runner').排期态兜底(root);
  assert.deepEqual(迁, ['TK-830'], '兜底扫描要补迁并回报单号：' + JSON.stringify(迁));
  assert.equal(store.find(root, 'TK-830').state, '已排期', '补迁进已排期（否则今时线永远扫不到）');
  // 幂等：再扫一次不重复动、不刷痕
  assert.deepEqual(require('../lib/runner').排期态兜底(root), [], '已在已排期的不再计入补迁');
  // 边界：未放行的不许被兜底带走（放行是项管闸，兜底只补桥的漏，不代开闸）
  const g2 = 登记一(root, { 题: '未放行粒', 预估单元: 1, 计划开始: '2026-08-26T11:00', 计划完成: '2026-08-26T12:00', 因: '判据' });
  seed(root, '待派', { id: 'TK-831', 职能: '程序', 粒ID: g2.粒ID, 放行: false });
  S.挂钩起草(root, g2.粒ID, 'TK-831');
  assert.deepEqual(require('../lib/runner').排期态兜底(root), [], '未放行单不许被兜底迁走');
  assert.equal(store.find(root, 'TK-831').state, '待派');
});

收尾('已排期态', passed);
