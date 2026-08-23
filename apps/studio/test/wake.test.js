// wake.test.js — 项管唤醒接线（H108 改道）：定稿切单事件 / 收口去重与签字位上移「完成」/ 连环上呈（待处理口径）
const assert = require('node:assert');
const { makeRoot, seed } = require('./helper');
const store = require('../lib/core/store');
const wake = require('../lib/pm/wake');
const ledger = require('../lib/pm/ledger');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('wake 项管唤醒测试（H108）');

t('战役父单定稿触发切单事件；普通单不触发', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'P-1', 父单类型: '战役', 项目: 'X' });
  const p = store.find(root, 'P-1');
  assert.equal(wake.onCampaignFinalized(root, {}, p, null, { test: true }).woke, true);
  assert.ok(ledger.events(root).some((e) => e.类型 === '切单启动' && e.父单 === 'P-1'));
  seed(root, '待派', { id: 'N-1' });
  assert.equal(wake.onCampaignFinalized(root, {}, store.find(root, 'N-1'), null, { test: true }).woke, false);
});

t('首子单派发推手：父单 待派→在途（H53 状态诚实映射，H108 边改道）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'B-1', 父单类型: '战役' });
  wake.onChildDispatched(root, 'B-1');
  assert.equal(store.find(root, 'B-1').state, '在途', '战役开打，父单入在途');
  assert.equal(store.find(root, 'B-1').fm.主办, '专项');
  wake.onChildDispatched(root, 'B-1'); // 已在途：幂等不再动
  assert.equal(store.find(root, 'B-1').state, '在途');
});

t('收口检测（H108 口径）：子单全到 完成/归档/废弃 才唤醒且只唤醒一次；签字位上移「完成」', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'C-1', 父单类型: '战役', 主办: '专项' });
  seed(root, '完成', { id: 'C-2', 父单: 'C-1' });
  seed(root, '在途', { id: 'C-3', 父单: 'C-1', 主办: 'x', 领单时间: new Date().toISOString() });
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), [], '有在途不收口');
  store.move(root, 'C-3', '在途', '完成'); // H108：免检直达边（在途→完成 在边表上）
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), ['C-1'], '全部做完唤醒');
  assert.equal(store.find(root, 'C-1').state, '完成', '父单上「完成」＝唯一签字位（原 待验收，H108 驻留位）');
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), [], '台账去重不重复唤醒');
  assert.ok(ledger.events(root).some((e) => e.类型 === '收口待验'));
});

t('收口 · 待派父单两步上位（待派→在途→完成，不抄状态机近路）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'C-10', 父单类型: '战役' });
  seed(root, '完成', { id: 'C-11', 父单: 'C-10' });
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), ['C-10']);
  assert.equal(store.find(root, 'C-10').state, '完成', '待派父单也能走到签字位（两步合法转移）');
});

t('收口 · 废弃子单算「不欠工」但不算「做成」：混编可收口，全废弃不收口', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'C-20', 父单类型: '战役', 主办: '专项' });
  seed(root, '完成', { id: 'C-21', 父单: 'C-20' });
  seed(root, '废弃', { id: 'C-22', 父单: 'C-20', 废弃因: '方向废止' });
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), ['C-20'], '完成+废弃混编：不被废弃单卡死');
  // 全废弃：没有任何一张做成的单，收不了口（收口报告没有可签的产出）
  const root2 = makeRoot();
  seed(root2, '在途', { id: 'C-30', 父单类型: '战役', 主办: '专项' });
  seed(root2, '废弃', { id: 'C-31', 父单: 'C-30' });
  assert.deepEqual(wake.checkCloseouts(root2, {}, { test: true }), [], '全废弃不叫收口');
});

t('连环失败（H108）：同战役 ≥2 张待处理（原 执行失败+待定夺 合并口径）上呈一次', () => {
  const root = makeRoot();
  seed(root, '待处理', { id: 'F-1', 父单: 'P-9', 失败原因: 'CLI 崩溃' });
  assert.deepEqual(wake.checkChainFailures(root), [], '单发不上呈');
  seed(root, '待处理', { id: 'F-2', 父单: 'P-9', 上呈原因: 'QA 三振' });
  assert.deepEqual(wake.checkChainFailures(root), ['P-9'], '两发上呈');
  assert.deepEqual(wake.checkChainFailures(root), [], '去重');
  assert.ok(ledger.events(root).some((e) => e.类型 === '上呈' && e.父单 === 'P-9'));
});

/* ===================== 切单三出口（施工令-054 · TK-146 案）=====================
 * 病灶：切单输出没有 ticket 块就一律记「切单失败」，模型写的「现在不该切」判语连同理由
 * 一起被吞——父单纪律明写候期，机器却记了一笔失败，制作人在台账里看不到任何理由。
 * 三分支各锁一条：候期记候期不记失败且父单原位不动、真失败照旧记失败、切成两样都不记。 */
const relay = require('../lib/relay');
const 候期结果 = {
  ok: false, error: '拒切候期', 候期: true,
  理由: '承重方案 TK-200 未落袋', 复切时机: 'TK-200 落袋并定案后',
  判语: '## 拒切判语\n前置方案缺位，硬切出来的实现单必因接口变动整批返修。',
};

t('切单出口·拒切候期：记「切单候期」存判语全文，不记失败，父单原位不动', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'P-54', 父单类型: '战役', 项目: 'X' });
  const r = wake.onCutResult(root, 'P-54', 候期结果);
  assert.equal(r.出口, '候期');
  const evs = ledger.events(root);
  const e = evs.find((x) => x.类型 === '切单候期');
  assert.ok(e, '候期事件落账');
  assert.equal(e.父单, 'P-54');
  assert.equal(e.理由, '承重方案 TK-200 未落袋');
  assert.equal(e.复切时机, 'TK-200 落袋并定案后');
  assert.ok(/整批返修/.test(e.判语), '判语全文存档——TK-146 丢的正是这一段');
  assert.ok(!evs.some((x) => x.类型 === '切单失败'), '候期不是失败，不许双记');
  assert.equal(store.find(root, 'P-54').state, '待派', '父单原位不动，等条件齐了复切');
  assert.ok(relay.list(root).some((m) => m.from === '项管' && /拒切候期：P-54/.test(m.text) && /整批返修/.test(m.text)),
    '判语同时呈信道——只存档不呈报等于换个地方吞');
});

t('切单出口·真失败：空输出/格式坏照旧记「切单失败」，不误判成候期', () => {
  const root = makeRoot();
  const r = wake.onCutResult(root, 'P-55', { ok: false, error: '切单输出无子单块' });
  assert.equal(r.出口, '失败');
  const evs = ledger.events(root);
  assert.ok(evs.some((x) => x.类型 === '切单失败' && x.父单 === 'P-55' && x.error === '切单输出无子单块'));
  assert.ok(!evs.some((x) => x.类型 === '切单候期'), '没有判语就不是候期');
});

t('切单出口·切成：两样都不记（待审事件由 brain.cut 落，不在本函数职责内）', () => {
  const root = makeRoot();
  const r = wake.onCutResult(root, 'P-56', { ok: true, 子单: ['P-57', 'P-58'] });
  assert.equal(r.出口, '切成');
  const evs = ledger.events(root);
  assert.ok(!evs.some((x) => ['切单失败', '切单候期'].includes(x.类型)), '切成不落异常事件');
});

console.log(`全部通过：${passed} 项`);
