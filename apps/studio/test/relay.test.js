// relay.test.js — 遥控传令板：追加/读取/校验
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const relay = require('../lib/relay');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('relay 遥控传令测试');

t('追加与读取回环，按序返回', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  assert.ok(relay.append(root, '制作人', '把地形晕染开个单').ok);
  assert.ok(relay.append(root, 'Claude', '收到，已开 TK-41').ok);
  const l = relay.list(root);
  assert.equal(l.length, 2);
  assert.equal(l[0].from, '制作人');
  assert.equal(l[1].from, 'Claude');
  assert.ok(l[0].t && l[0].text);
});

t('空指令/超长/非法署名拒收', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  assert.ok(!relay.append(root, '制作人', '  ').ok);
  assert.ok(!relay.append(root, '制作人', 'x'.repeat(4001)).ok);
  assert.ok(!relay.append(root, '路人', '冒名').ok);
});

t('limit 截尾取最新', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  for (let i = 0; i < 5; i++) relay.append(root, '制作人', '第' + i + '条');
  const l = relay.list(root, 2);
  assert.equal(l.length, 2);
  assert.equal(l[1].text, '第4条');
});

t('无文件不炸', () => {
  assert.deepEqual(relay.list(fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'))), []);
});

console.log(`全部通过：${passed} 项`);
