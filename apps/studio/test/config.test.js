// config.test.js — 配置加载：BOM 容忍（0.8.1 套件 E2E 事故回归）+ 根定位
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../lib/core/config');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('config 配置加载测试');

t('带 UTF-8 BOM 的配置可解析（PowerShell 5.1 / 记事本产物）', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.writeFileSync(path.join(d, 'studio.config.json'), '﻿' + JSON.stringify({ server: { port: 1 } }), 'utf8');
  assert.equal(config.load(d).server.port, 1);
});

t('无 BOM 照常解析', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.writeFileSync(path.join(d, 'studio.config.json'), JSON.stringify({ server: { port: 2 } }), 'utf8');
  assert.equal(config.load(d).server.port, 2);
});

t('resolveRoot：从子目录向上找到含配置的根', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  fs.writeFileSync(path.join(d, 'studio.config.json'), '{}', 'utf8');
  const sub = path.join(d, 'a', 'b'); fs.mkdirSync(sub, { recursive: true });
  assert.equal(config.resolveRoot(sub), d);
});

console.log(`全部通过：${passed} 项`);
