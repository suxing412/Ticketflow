// ideas.test.js — 想法池：入池/放弃/拍板成父单
const assert = require('node:assert');
const { makeRoot } = require('./helper');
const store = require('../lib/core/store');
const ideas = require('../lib/pm/ideas');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('ideas 想法池测试');

t('入池/列表/放弃', () => {
  const root = makeRoot();
  assert.ok(!ideas.add(root, ' ').ok, '空拒收');
  const a = ideas.add(root, '做个地形晕染', '看着舒服点');
  assert.ok(a.ok);
  assert.equal(ideas.list(root).length, 1);
  assert.ok(ideas.drop(root, a.idea.id).ok);
  assert.equal(ideas.list(root).filter((x) => x.状态 === '在池').length, 0);
  assert.ok(!ideas.drop(root, a.idea.id).ok, '已处理不可重复放弃');
});

t('拍板：想法→父单草稿（战役型+回链），派号接续', () => {
  const root = makeRoot();
  store.create(root, 'TK-7', { id: 'TK-7', title: '占位', 职能: '程序', 项目: 'X' }, 'x');
  const a = ideas.add(root, '真实地形高程晕染');
  const r = ideas.拍板(root, a.idea.id, 'TK', 'TK');
  assert.ok(r.ok); assert.equal(r.父单, 'TK-8');
  const p = store.find(root, 'TK-8');
  assert.equal(p.state, '草稿');
  assert.equal(p.fm.父单类型, '战役');
  assert.equal(p.fm.想法源, a.idea.id);
  assert.ok(p.body.includes('系统边界') && p.body.includes('验收标准'));
  const idea = ideas.list(root).find((x) => x.id === a.idea.id);
  assert.equal(idea.状态, '已拍板'); assert.equal(idea.父单, 'TK-8');
});

console.log(`全部通过：${passed} 项`);
