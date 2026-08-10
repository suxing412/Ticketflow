// budget-接线.test.js — 预算闸的**消费方接线**测试（协-003 本体归位后拆出）
//
// 分工：`packages/budget/test.js` 证明本包自己的输出形状（零 app 依赖，那是入包条件）；
// 本文件证明 **studio 这边接得住**——冻结结构能直接喂进 dispatch，且池序真的会绕开超预算的池。
//
// 这两条原先住在 apps/studio/test/budget.test.js 里。本体迁 packages/budget 时，
// 纯契约那 12 条跟着包走，这 2 条留下——它们测的是 studio 的接线，不是包的契约。
// 其中「不改签名即生效」那条的断言一字未改，包括那句 “这一条不过，本单等于没做”。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 公用件走仓根 packages/（一仓拓扑）：apps/studio/test → 上三级到仓根
const B = require('../../../packages/budget/budget.js');
const D = require('../lib/pm/dispatch');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('budget 消费方接线测试（studio 侧）');

const 新根 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'budget-wire-'));
const 今 = '2026-08-08T10:00:00.000Z';

t('冻结结构可直接喂 poolFrozen：不改签名即生效', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { 'claude-key': { 日token: 10 } } }, 执行池: { 'claude-key': {} } };
  B.记(root, { 池: 'claude-key', 输入: 20, 输出: 0, t: 今 });
  const gi = B.并入({}, B.冻结池(cfg, root, 今));
  assert.equal(D.poolFrozen(cfg, gi, 'claude-key'), true, '这一条不过，本单等于没做');
});

t('实测证据：超预算的 key 池会被池序绕开（降级链路端到端）', () => {
  const root = 新根();
  const cfg = {
    执行池: { claude: { 计费: '订阅' }, 'claude-key': { 计费: '按量' }, codex: { 计费: '订阅' } },
    编制: [{ 职能: '程序', 池序: [{ 池: 'claude' }, { 池: 'claude-key' }, { 池: 'codex' }] }],
    预算: { 池: { 'claude-key': { 日token: 10 } } },
  };
  const ready = [{ id: 'T-1', 职能: '程序', 优先级: 'P1', 创建时间: '2026-08-08' }];
  // 套餐冻结 + key 池未超 → 落 key 池
  let gi = B.并入({ claude: { locked: true } }, B.冻结池(cfg, root, 今));
  assert.equal(D.pickNext(cfg, ready, {}, gi, { 'claude-key': 1, codex: 1 })[0].池, 'claude-key');
  // key 池烧超预算后 → 继续顺位到 codex，不再落 key 池
  B.记(root, { 池: 'claude-key', 输入: 99, 输出: 0, t: 今 });
  gi = B.并入({ claude: { locked: true } }, B.冻结池(cfg, root, 今));
  const picks = D.pickNext(cfg, ready, {}, gi, { 'claude-key': 1, codex: 1 });
  assert.equal(picks[0].池, 'codex', '超预算的池必须被绕开，否则保险丝形同虚设');
});

console.log(`全部通过：${passed} 项`);
