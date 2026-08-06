// crew.test.js — 工程队状态卡（施工令-002 第 5 项）
// 铁律：生产部署下状态文件不存在，读不到不能抛错——整卡不渲染（read 返回 null）。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crew = require('../lib/crew');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('crew 工程队状态卡测试');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-'));
const 写 = (name, s) => { const p = path.join(tmp, name); fs.writeFileSync(p, s, 'utf8'); return p; };

t('有状态文件 → 四字段读出（卡片渲染）', () => {
  const p = 写('状态.json', JSON.stringify({ 施工令: '002', 名称: '短题制与工程队状态卡', 状态: '施工中', 更新时间: '2026-08-06T13:30:00.000Z' }));
  assert.deepEqual(crew.read(p), { 施工令: '002', 名称: '短题制与工程队状态卡', 状态: '施工中', 更新时间: '2026-08-06T13:30:00.000Z' });
});

t('文件不存在 → null 且不抛错（生产部署的常态）', () => {
  assert.equal(crew.read(path.join(tmp, '不存在.json')), null);
});

t('坏 JSON → null 且不抛错', () => {
  assert.equal(crew.read(写('坏.json', '{施工令: 002,')), null);
});

t('非对象（数组/字符串/null）→ null', () => {
  assert.equal(crew.read(写('数组.json', '[1,2]')), null);
  assert.equal(crew.read(写('串.json', '"施工中"')), null);
  assert.equal(crew.read(写('空.json', 'null')), null);
});

t('空壳对象 → null（没内容不占版面）', () => {
  assert.equal(crew.read(写('空壳.json', '{}')), null);
});

t('缺字段容错：有一个关键字段就渲染，缺的补空串', () => {
  assert.deepEqual(crew.read(写('半.json', '{"状态":"待验收"}')), { 施工令: '', 名称: '', 状态: '待验收', 更新时间: '' });
});

t('默认路径是施工令约定的工程队状态文件', () => {
  assert.ok(crew.默认文件.endsWith(path.join('工程队', '状态.json')) || /工程队.状态\.json$/.test(crew.默认文件), crew.默认文件);
  assert.doesNotThrow(() => crew.read(), '读默认路径永不抛错（文件在不在都一样）');
});

console.log('全部通过：' + passed + ' 项');
