const assert = require('node:assert');
const runner = require('../lib/runner');
const { makeRoot, 收尾 } = require('./helper');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

console.log('派发制提示词测试');

t('工单正文完整内嵌到执行提示词', () => {
  const root = makeRoot();
  const body = [
    '## 范围',
    '只校准 runner 的测试基线。',
    '## 验收标准',
    '正文完整注入提示词。',
    'DISPATCH-BODY-SENTINEL',
  ].join('\n');
  const ticket = { id: 'DISPATCH-1', fm: { 职能: '程序', title: '派发基线' }, body };
  const prompt = runner.buildPrompt(root, ticket, { name: 'TK', path: 'D:/project' });

  assert.ok(prompt.includes(body), 'assert.ok(prompt.includes(body)): 工单正文必须完整内嵌');
  assert.ok(prompt.includes('DISPATCH-BODY-SENTINEL'), 'assert.ok(prompt.includes(sentinel)): 正文哨兵必须可见');
});

t('组装提示词不携带退役取单路径', () => {
  const root = makeRoot();
  const ticket = { id: 'DISPATCH-2', fm: { 职能: '程序', title: '派发基线' }, body: 'DISPATCH-CLEAN-SENTINEL' };
  const prompt = runner.buildPrompt(root, ticket, { name: 'TK', path: 'D:/project' });
  const retiredPullTokens = [
    ['co', 'llab'].join(''),
    ['信', '箱'].join(''),
    ['mail', 'box'].join(''),
    ['watch', '-mail', 'box'].join(''),
  ];

  for (const token of retiredPullTokens) {
    assert.equal(prompt.includes(token), false,
      `assert.equal(prompt.includes(${token}), false): 提示词不得引用退役取单路径`);
  }
});

收尾('派发制提示词', passed);
