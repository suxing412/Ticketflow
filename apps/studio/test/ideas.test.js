// ideas.test.js — 想法池：入池/放弃/拍板成专项容器
// 施工令-058（H103「专项是容器不是工单」）改了拍板的产物：旧口径落一张 `父单类型: 专项` 的
// 伪工单（号形 TK-S1），新口径落一条**专项注册表条目**（S-1）。本用例随之改写——
// 老断言留着只会锁死一个已被制作人裁掉的形制。
const assert = require('node:assert');
const { makeRoot } = require('./helper');
const store = require('../lib/core/store');
const ideas = require('../lib/pm/ideas');
const specials = require('../lib/specials');

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

t('拍板：想法→专项注册表条目（S 系列派号+回链，施工令-058）', () => {
  const root = makeRoot();
  store.create(root, 'TK-7', { id: 'TK-7', title: '占位', 职能: '程序', 项目: 'X' }, 'x');
  const a = ideas.add(root, '真实地形高程晕染');
  const r = ideas.拍板(root, a.idea.id, 'TK', 'TK');
  assert.ok(r.ok); assert.equal(r.专项, 'S-1');
  const p = specials.find(root, 'S-1');
  assert.equal(p.fm.状态, '立项');
  assert.equal(p.fm.名称, '真实地形高程晕染');
  assert.equal(p.fm.项目, 'TK');
  assert.equal(p.fm.单号前缀, 'TK', '前缀参数改了含义：它是将来子单的派号前缀，不是专项自己的号');
  assert.ok(p.body.includes('系统边界') && p.body.includes('验收标准'));
  assert.equal(store.find(root, 'TK-S1'), null, '不再往工单目录里塞伪单——TK-146/150 的病灶就在这一行');
  const idea = ideas.list(root).find((x) => x.id === a.idea.id);
  assert.equal(idea.状态, '已拍板'); assert.equal(idea.专项, 'S-1');
});

console.log(`全部通过：${passed} 项`);
