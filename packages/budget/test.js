// budget.test.js — 预算闸（施工令-021）
// 红线：**未配预算的池永不被冻结**（不配=不管，绝不臆造上限），
// 以及冻结结构必须能直接喂给 dispatch.poolFrozen——那是本单零接线的全部前提。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const B = require('../lib/budget');
const D = require('../lib/pm/dispatch');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('budget 预算闸测试（施工令-021）');

const 新根 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'budget-'));
const 今 = '2026-08-08T10:00:00.000Z';
const 上月 = '2026-07-20T10:00:00.000Z';
const 昨天 = '2026-08-07T10:00:00.000Z';

t('usage 提取：输入/缓存取最大值，输出累加，三者分列', () => {
  const 流 = [
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 30 } } }),
    '不是 json 的一行',
    JSON.stringify({ usage: { input_tokens: 1200, cache_read_input_tokens: 5000, output_tokens: 70 } }),
  ].join('\n');
  assert.deepEqual(B.usageOf(流), { 输入: 1200, 缓存: 5000, 输出: 100 });
  assert.deepEqual(B.usageOf(''), { 输入: 0, 缓存: 0, 输出: 0 });
  assert.deepEqual(B.usageOf(null), { 输入: 0, 缓存: 0, 输出: 0 });
});

t('记账只追加；坏行容错；缺文件返回空汇总不抛', () => {
  const root = 新根();
  assert.deepEqual(B.读账(root), []);
  assert.equal(B.汇总(root, 'x', 今).日.token, 0);
  B.记(root, { 池: 'deepseek', 单: 'T-1', 输入: 100, 缓存: 900, 输出: 50, t: 今 });
  B.记(root, { 池: 'deepseek', 单: 'T-2', 输入: 200, 输出: 60, t: 今 });
  fs.appendFileSync(B.账本(root), '{坏行\n\n', 'utf8');
  assert.equal(B.读账(root).length, 2, '坏行丢弃但不能影响好行');
  assert.equal(B.记(root, { 池: '' }), null, '无池名不记');
});

t('合计不含缓存（缓存读约常价 1/10，混进合计会虚胖离群）', () => {
  const root = 新根();
  B.记(root, { 池: 'p', 输入: 100, 缓存: 999999, 输出: 50, t: 今 });
  assert.equal(B.汇总(root, 'p', 今).日.token, 150);
  assert.equal(B.汇总(root, 'p', 今).日.缓存, 999999, '缓存本身仍要如实留数');
});

t('窗口切分：当日 / 当月 各算各的，跨月不串', () => {
  const root = 新根();
  B.记(root, { 池: 'p', 输入: 10, 输出: 10, t: 上月 });
  B.记(root, { 池: 'p', 输入: 20, 输出: 20, t: 昨天 });
  B.记(root, { 池: 'p', 输入: 30, 输出: 30, t: 今 });
  const s = B.汇总(root, 'p', 今);
  assert.equal(s.日.token, 60, '当日只算今天那条');
  assert.equal(s.月.token, 100, '当月算本月两条，不含上月');
});

t('池隔离：别的池的账不算到我头上', () => {
  const root = 新根();
  B.记(root, { 池: 'a', 输入: 1000, 输出: 1000, t: 今 });
  B.记(root, { 池: 'b', 输入: 1, 输出: 1, t: 今 });
  assert.equal(B.汇总(root, 'b', 今).日.token, 2);
});

t('红线：未配预算的池永不被冻结（不配 = 不管）', () => {
  const root = 新根();
  B.记(root, { 池: '野池', 输入: 9e8, 输出: 9e8, t: 今 });
  assert.equal(B.超预算({ 预算: { 池: {} } }, root, '野池', 今).超, false);
  assert.equal(B.超预算({}, root, '野池', 今).超, false);
  assert.deepEqual(B.冻结池({ 预算: { 池: {} } }, root, 今), {});
});

t('token 上限：日线触发，且是 ≥ 不是 >', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { k: { 日token: 100 } } } };
  B.记(root, { 池: 'k', 输入: 50, 输出: 49, t: 今 });
  assert.equal(B.超预算(cfg, root, 'k', 今).超, false);
  B.记(root, { 池: 'k', 输入: 1, 输出: 0, t: 今 });
  const r = B.超预算(cfg, root, 'k', 今);
  assert.equal(r.超, true);
  assert.ok(r.因.includes('日用量'));
});

t('月线独立生效：日线没到但月线到了照样超', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { k: { 日token: 1000, 月token: 100 } } } };
  B.记(root, { 池: 'k', 输入: 60, 输出: 0, t: 昨天 });
  B.记(root, { 池: 'k', 输入: 60, 输出: 0, t: 今 });
  const r = B.超预算(cfg, root, 'k', 今);
  assert.equal(r.超, true);
  assert.ok(r.因.includes('月'), '应由月线触发：' + r.因);
});

t('金额上限：按价目表估算，缓存默认按输入价 1/10', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { k: { 日额: 1 } }, 价目: { k: { 输入: 3, 输出: 15 } } } };
  // 100 万输入 = 3；缓存 100 万 = 0.3；输出 0 → 3.3 ≥ 1
  B.记(root, { 池: 'k', 输入: 1000000, 缓存: 1000000, 输出: 0, t: 今 });
  const 费 = B.估费(cfg, 'k', { 输入: 1000000, 缓存: 1000000, 输出: 0 });
  assert.ok(Math.abs(费 - 3.3) < 1e-9, '估费 = ' + 费);
  assert.equal(B.超预算(cfg, root, 'k', 今).超, true);
});

t('没配价目表时金额上限自然失效，只剩 token 口径（不臆造费用）', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { k: { 日额: 0.0001 } } } };
  B.记(root, { 池: 'k', 输入: 999999, 输出: 999999, t: 今 });
  assert.equal(B.估费(cfg, 'k', { 输入: 1, 输出: 1 }), null);
  assert.equal(B.超预算(cfg, root, 'k', 今).超, false, '算不出费用就不许判超');
});

// ---- 与 dispatch 的接线（本单零接线的全部前提）----
t('冻结结构可直接喂 poolFrozen：不改签名即生效', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { 'claude-key': { 日token: 10 } } }, 执行池: { 'claude-key': {} } };
  B.记(root, { 池: 'claude-key', 输入: 20, 输出: 0, t: 今 });
  const gi = B.并入({}, B.冻结池(cfg, root, 今));
  assert.equal(D.poolFrozen(cfg, gi, 'claude-key'), true, '这一条不过，本单等于没做');
});

t('并入：不覆盖已有额度锁信息，同池任一锁上即锁', () => {
  const 已 = { claude: { locked: true, reason: '订阅额度锁' }, 'claude-key': { fivePct: 3 } };
  const g = B.并入(已, { 'claude-key': { locked: true, reason: '预算', 预算: true } });
  assert.equal(g.claude.reason, '订阅额度锁', '别的池原样保留');
  assert.equal(g['claude-key'].locked, true);
  assert.equal(g['claude-key'].fivePct, 3, '原有字段不丢');
  assert.equal(g['claude-key'].预算, true);
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

t('view：只列配了预算的池，带上限/用量/是否超', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { k: { 日token: 10 } } } };
  B.记(root, { 池: 'k', 输入: 20, 输出: 0, t: 今 });
  const v = B.view(cfg, root, 今);
  assert.equal(v.length, 1);
  assert.equal(v[0].池, 'k');
  assert.equal(v[0].超, true);
  assert.equal(v[0].汇总.日.token, 20);
});

console.log(`全部通过：${passed} 项`);
