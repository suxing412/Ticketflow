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

console.log(`全部通过：${passed} 项`);
