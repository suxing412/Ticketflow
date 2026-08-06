// dispatch.test.js — 派发引擎：就绪判定/排序/护城河/硬顶/挑单
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRoot, seed } = require('./helper');
const store = require('../lib/core/store');
const D = require('../lib/pm/dispatch');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('dispatch 派发引擎测试');

const CFG = { 执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', '装配'] } } };

t('就绪盘点：只收已放行+依赖落袋的待投单', () => {
  const root = makeRoot();
  seed(root, '待投', { id: 'A-1', 职能: '程序', 放行: true });
  seed(root, '待投', { id: 'A-2', 职能: '程序' }); // 未放行
  seed(root, '待投', { id: 'A-3', 职能: '程序', 放行: true, 依赖: 'A-9' });
  seed(root, '在途', { id: 'A-9', 职能: '程序', 主办: 'x', 领单时间: new Date().toISOString() }); // 依赖未落袋
  seed(root, '待投', { id: 'A-4', 职能: '程序', 放行: true, 依赖: 'A-8' });
  seed(root, '完成', { id: 'A-8', 职能: '程序' });
  const r = D.readySet(root, new Set());
  assert.deepEqual(r.map((x) => x.id).sort(), ['A-1', 'A-4']);
});

t('排序：P0 > 红链 > 创建时间', () => {
  const list = [
    { id: 'b', 优先级: 'P1', 红链: true, 创建时间: '2' },
    { id: 'a', 优先级: 'P0', 红链: false, 创建时间: '3' },
    { id: 'c', 优先级: 'P1', 红链: false, 创建时间: '1' },
  ];
  assert.deepEqual(D.sortReady(list).map((x) => x.id), ['a', 'b', 'c']);
});

t('沟通护城河：claude 余量≤保留线停拉，codex 不受影响，读数盲飞不硬拦', () => {
  const cfg = { 额度: { 沟通保留: 20 } };
  assert.equal(D.moatBlocked(cfg, { claude: { fivePct: 85 } }, 'claude'), true);  // 余15≤20
  assert.equal(D.moatBlocked(cfg, { claude: { fivePct: 70 } }, 'claude'), false); // 余30
  assert.equal(D.moatBlocked(cfg, { claude: { fivePct: 95 } }, 'codex'), false);
  assert.equal(D.moatBlocked(cfg, { claude: { fivePct: null } }, 'claude'), false);
});

t('挑单：按并发余量+池路由+锁态出清单，硬顶封死', () => {
  const ready = [
    { id: 'p1', 职能: '程序', 优先级: 'P0', 红链: false, 创建时间: '1' },
    { id: 'p2', 职能: '程序', 优先级: 'P1', 红链: false, 创建时间: '2' },
    { id: 'c1', 职能: '策划', 优先级: 'P0', 红链: false, 创建时间: '1' },
  ];
  const picks = D.pickNext(CFG, ready, { codex: 0, claude: 0 },
    { codex: { fivePct: 10 }, claude: { fivePct: 10 } }, { codex: 1, claude: 2 });
  assert.deepEqual(picks.map((p) => p.id + '/' + p.池).sort(), ['c1/claude', 'p1/codex']);
  // 项管把 codex 并发调到 99 也被硬顶按住
  const wild = D.pickNext(CFG, ready, { codex: 0, claude: 0 },
    { codex: { fivePct: 10 }, claude: { fivePct: 10 } }, { codex: 99, claude: 0 });
  assert.ok(wild.filter((p) => p.池 === 'codex').length <= D.HARD_CAP.codex);
  // 额度锁保险丝
  const locked = D.pickNext(CFG, ready, {}, { codex: { fivePct: 10, locked: true }, claude: { fivePct: 10 } }, { codex: 2, claude: 2 });
  assert.ok(!locked.some((p) => p.池 === 'codex'));
});

// ---- H85 派发死局自愈：编制全挂冻结池 → 临时改挂；部分冻结 → 用可用者；无处可去 → 滞留 ----
// 案源 2026-08-06：美术-A 唯一编制挂冻结的 codex 池，派发静默滞留而 UI 全绿（假健康）。
const 冻 = (p) => ({ fivePct: 10, locked: p === 'codex' });
const 全冻 = { codex: { fivePct: 10, locked: true }, claude: { fivePct: 10, locked: true } };
const R_ART = [{ id: 'a1', 职能: '美术', 优先级: 'P1', 红链: false, 创建时间: '1' }];

t('死局自愈①：唯一编制挂冻结池 → 自动改挂到可用池并带改挂标记', () => {
  const cfg = { 执行池: { codex: { 职能: ['程序', '美术'] }, claude: { 职能: ['策划'] } },
    agents: [{ id: '美术-A', 职能: '美术', 执行池: 'codex' }] };
  const picks = D.pickNext(cfg, R_ART, {}, { codex: 冻('codex'), claude: 冻('claude') }, { codex: 2, claude: 2 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].池, 'claude');
  assert.ok(picks[0].改挂 && picks[0].改挂.原池 === 'codex', '必须带改挂留痕');
});

t('死局自愈②：多编制部分冻结 → 用编制内可用池，不算改挂', () => {
  const cfg = { 执行池: { codex: { 职能: ['美术'] }, claude: { 职能: ['策划'] } },
    agents: [{ id: '美术-A', 职能: '美术', 执行池: 'codex' }, { id: '美术-B', 职能: '美术', 执行池: 'claude' }] };
  const picks = D.pickNext(cfg, R_ART, {}, { codex: 冻('codex'), claude: 冻('claude') }, { codex: 2, claude: 2 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].池, 'claude');
  assert.ok(!picks[0].改挂, '编制内本来就有可用池，不该打临时改挂标记');
});

t('死局自愈③：全池冻结无可用池 → 不派发，滞留等零派发告警', () => {
  const cfg = { 执行池: { codex: { 职能: ['美术'] }, claude: { 职能: ['策划'] } },
    agents: [{ id: '美术-A', 职能: '美术', 执行池: 'codex' }] };
  assert.deepEqual(D.pickNext(cfg, R_ART, {}, 全冻, { codex: 2, claude: 2 }), []);
});

t('死局自愈边界：池章直通单不自愈（工程单钉死 deepseek 是刻意的成本选择）', () => {
  const cfg = { 执行池: { codex: {}, claude: {}, deepseek: {} },
    agents: [{ id: '程序-A', 职能: '程序', 执行池: 'codex' }] };
  const ready = [{ id: 'e1', 职能: '程序', 优先级: 'P1', 红链: false, 创建时间: '1', 执行池: 'deepseek' }];
  const gi = { deepseek: { fivePct: 10, locked: true }, claude: { fivePct: 10 }, codex: { fivePct: 10 } };
  assert.deepEqual(D.pickNext(cfg, ready, {}, gi, { deepseek: 2, claude: 2 }), []);
});

t('死局自愈边界：零编制职能不臆造路由（照旧滞留）', () => {
  const cfg = { 执行池: { codex: { 职能: ['美术'] }, claude: { 职能: ['策划'] } }, agents: [] };
  assert.deepEqual(D.pickNext(cfg, R_ART, {}, { codex: 冻('codex'), claude: 冻('claude') }, { codex: 2, claude: 2 }), []);
});

t('编制池盘点 rosterPools：退役待归不算编制，按 config 顺序去重', () => {
  const cfg = { 执行池: { codex: { 职能: ['美术'] }, claude: {} },
    agents: [{ id: '美术-A', 职能: '美术', 执行池: 'codex' }, { id: '美术-B', 职能: '美术', 执行池: 'claude' },
      { id: '美术-C', 职能: '美术', 执行池: 'codex' }, { id: '美术-D', 职能: '美术', 执行池: 'deepseek', 上线: false }] };
  assert.deepEqual(D.rosterPools(cfg, '美术'), ['codex', 'claude']);
  assert.deepEqual(D.rosterPools(cfg, '程序'), []);
});

t('池冻结判据 poolFrozen：额度锁与护城河都算冻结，并发满不算', () => {
  const cfg = { 额度: { 沟通保留: 20 } };
  assert.equal(D.poolFrozen(cfg, { codex: { locked: true } }, 'codex'), true);
  assert.equal(D.poolFrozen(cfg, { claude: { fivePct: 85 } }, 'claude'), true);  // 护城河：余 15 ≤ 20
  assert.equal(D.poolFrozen(cfg, { codex: { fivePct: 99 } }, 'codex'), false);   // codex 无护城河、无锁
});

console.log(`全部通过：${passed} 项`);
