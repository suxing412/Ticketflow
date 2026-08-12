// wake.test.js — 项管唤醒接线：定稿切单事件/收口去重/连环上呈
const assert = require('node:assert');
const { makeRoot, seed } = require('./helper');
const store = require('../lib/core/store');
const wake = require('../lib/pm/wake');
const ledger = require('../lib/pm/ledger');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('wake 项管唤醒测试');

t('战役父单定稿触发切单事件；普通单不触发', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'P-1', 父单类型: '战役', 项目: 'X' });
  const p = store.find(root, 'P-1');
  assert.equal(wake.onCampaignFinalized(root, {}, p, null, { test: true }).woke, true);
  assert.ok(ledger.events(root).some((e) => e.类型 === '切单启动' && e.父单 === 'P-1'));
  seed(root, '待投', { id: 'N-1' });
  assert.equal(wake.onCampaignFinalized(root, {}, store.find(root, 'N-1'), null, { test: true }).woke, false);
});

t('收口检测：全落袋才唤醒且只唤醒一次；有未完子单不唤醒', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'C-1', 父单类型: '战役' });
  seed(root, '完成', { id: 'C-2', 父单: 'C-1' });
  seed(root, '在途', { id: 'C-3', 父单: 'C-1', 主办: 'x', 领单时间: new Date().toISOString() });
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), [], '有在途不收口');
  store.move(root, 'C-3', '在途', '质检');
  store.move(root, 'C-3', '质检', '待验收');
  store.move(root, 'C-3', '待验收', '完成');
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), ['C-1'], '全落袋唤醒');
  assert.deepEqual(wake.checkCloseouts(root, {}, { test: true }), [], '台账去重不重复唤醒');
  assert.ok(ledger.events(root).some((e) => e.类型 === '收口待验'));
});

t('连环失败：同战役 ≥2 异常单上呈一次', () => {
  const root = makeRoot();
  seed(root, '执行失败', { id: 'F-1', 父单: 'P-9' });
  assert.deepEqual(wake.checkChainFailures(root), [], '单发不上呈');
  seed(root, '待定夺', { id: 'F-2', 父单: 'P-9' });
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
  seed(root, '待投', { id: 'P-54', 父单类型: '战役', 项目: 'X' });
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
  assert.equal(store.find(root, 'P-54').state, '待投', '父单原位不动，等条件齐了复切');
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
