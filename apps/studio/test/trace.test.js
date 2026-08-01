// trace.test.js — 四追溯链 + 锚号迁移广播（R5）
const assert = require('node:assert');
const trace = require('../lib/trace');
const store = require('../lib/core/store');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('trace 追溯链测试');

t('chains：父子/返工/依据/依赖 四链齐全', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'M', title: '母单' });
  seed(root, '完成', { id: 'DEP' });
  seed(root, '池', { id: 'C', 父单: 'M', 依赖: 'DEP', 依据: '战斗系统#战斗-03' });
  const c = trace.chains(root, 'C');
  assert.equal(c.父子.父, 'M');
  assert.equal(c.依据, '战斗系统#战斗-03');
  assert.equal(c.依赖[0].id, 'DEP');
  assert.equal(c.依赖[0].state, '完成');
  // 母单能看到子单
  assert.ok(trace.chains(root, 'M').父子.子.some((x) => x.id === 'C'));
});

t('锚号迁移（R5）：广播更新所有引用旧锚号的未完成工单', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 依据: '战斗系统#战斗-03' });
  seed(root, '在途', { id: 'B', 依据: '战斗系统#战斗-03', 主办: 'x', 领单时间: new Date().toISOString() });
  seed(root, '完成', { id: 'DONE', 依据: '战斗系统#战斗-03' }); // 已完成单不动
  seed(root, '池', { id: 'C', 依据: '外交系统#外-01' }); // 不相关不动
  const r = trace.migrateAnchor(root, '战斗-03', '战斗-04', '战斗系统');
  assert.equal(r.更新数, 2); // A + B
  assert.equal(store.find(root, 'A').fm.依据, '战斗系统#战斗-04');
  assert.equal(store.find(root, 'B').fm.依据, '战斗系统#战斗-04');
  assert.equal(store.find(root, 'DONE').fm.依据, '战斗系统#战斗-03'); // 完成单不迁
  assert.equal(store.find(root, 'C').fm.依据, '外交系统#外-01'); // 无关单不动
});

t('affectedByRef：列出引用某锚号的未完成单（附加保险）', () => {
  const root = makeRoot();
  seed(root, '池', { id: 'A', 依据: '战斗系统#战斗-03' });
  seed(root, '完成', { id: 'D', 依据: '战斗系统#战斗-03' });
  const hits = trace.affectedByRef(root, '战斗-03');
  assert.equal(hits.length, 1); // 只列未完成的 A
  assert.equal(hits[0].id, 'A');
});

console.log(`全部通过：${passed} 项`);
