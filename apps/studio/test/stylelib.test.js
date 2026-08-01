// stylelib.test.js — 风格库 D12 精选制：入标杆/解析回环/移出/入美术库/来源旁存/防穿越
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sl = require('../lib/stylelib');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('stylelib 风格库测试（D12 审批点④）');

t('入标杆 → 解析回环：标题/正文/来源/日期齐', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '风格库'), { recursive: true });
  const r = sl.addAxiom(root, { 标题: '忠诚多向', 正文: '忠于个人/汉室/家族/利益，与人格七维联动。', 源单: 'TK-08' });
  assert.ok(r.ok);
  const es = sl.parseAxioms(root);
  assert.equal(es.length, 1);
  assert.equal(es[0].标题, '忠诚多向');
  assert.equal(es[0].源单, 'TK-08');
  assert.match(es[0].日期, /^\d{4}-\d{2}-\d{2}$/);
});

t('D42 项目归属：标杆落款带项目段并解析回环；旧格式（无项目段）项目为空', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '风格库'), { recursive: true });
  sl.addAxiom(root, { 标题: '甲公理', 正文: 'x', 源单: 'A-01', 项目: '甲' });
  sl.addAxiom(root, { 标题: '旧公理', 正文: 'y', 源单: 'B-01' }); // 不带项目 = 旧格式
  const es = sl.parseAxioms(root);
  assert.equal(es.find((e) => e.标题 === '甲公理').项目, '甲');
  assert.equal(es.find((e) => e.标题 === '旧公理').项目, null);
});

t('同名条目拒收；空标题/超长拒收', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '风格库'), { recursive: true });
  sl.addAxiom(root, { 标题: 'A', 正文: 'x', 源单: null });
  assert.ok(!sl.addAxiom(root, { 标题: 'A', 正文: 'y' }).ok, '同名拒');
  assert.ok(!sl.addAxiom(root, { 标题: '', 正文: 'y' }).ok, '空标题拒');
  assert.ok(!sl.addAxiom(root, { 标题: 'B', 正文: 'y'.repeat(301) }).ok, '超长拒');
});

t('移出标杆：只切目标 section，其余保留', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '风格库'), { recursive: true });
  sl.addAxiom(root, { 标题: '一', 正文: 'a' });
  sl.addAxiom(root, { 标题: '二', 正文: 'b' });
  sl.addAxiom(root, { 标题: '三', 正文: 'c' });
  assert.ok(sl.removeAxiom(root, '二').ok);
  const names = sl.parseAxioms(root).map((e) => e.标题);
  assert.deepEqual(names, ['一', '三']);
  assert.ok(!sl.removeAxiom(root, '不存在').ok);
});

t('入美术库：复制 + 旁存来源 meta + 列表可见', () => {
  const root = makeRoot();
  const proj = path.join(root, 'fakeproj'); fs.mkdirSync(path.join(proj, 'Art'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Art', 'hero.png'), 'PNG');
  const r = sl.addArt(root, { 源路径: 'Art/hero.png', 项目路径: proj, 说明: '主角立绘', 源单: 'TK-20', 项目: 'TK' });
  assert.ok(r.ok);
  const list = sl.listArt(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'hero.png');
  assert.ok(list[0].isImage);
  assert.equal(list[0].来源.源单, 'TK-20');
  assert.equal(list[0].来源.项目, 'TK'); // D42 项目归属旁存
  // 原件不动
  assert.ok(fs.existsSync(path.join(proj, 'Art', 'hero.png')));
});

t('撞名带单号前缀', () => {
  const root = makeRoot();
  const proj = path.join(root, 'fakeproj'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.png'), '1');
  sl.addArt(root, { 源路径: 'a.png', 项目路径: proj, 源单: 'T-1' });
  const r2 = sl.addArt(root, { 源路径: 'a.png', 项目路径: proj, 源单: 'T-2' });
  assert.ok(r2.ok);
  assert.equal(r2.name, 'T-2_a.png');
});

t('源文件越出项目仓库 → 拒（防任意读取）', () => {
  const root = makeRoot();
  const proj = path.join(root, 'fakeproj'); fs.mkdirSync(proj, { recursive: true });
  const outside = path.join(root, 'secret.txt'); fs.writeFileSync(outside, 'x');
  assert.ok(!sl.addArt(root, { 源路径: outside, 项目路径: proj, 源单: 'T-1' }).ok);
  assert.ok(!sl.addArt(root, { 源路径: '../secret.txt', 项目路径: proj, 源单: 'T-1' }).ok);
});

t('移出美术库：删文件+meta；非法文件名拒', () => {
  const root = makeRoot();
  const proj = path.join(root, 'fakeproj'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'b.png'), '1');
  sl.addArt(root, { 源路径: 'b.png', 项目路径: proj, 源单: 'T-1' });
  assert.ok(sl.removeArt(root, 'b.png').ok);
  assert.equal(sl.listArt(root).length, 0);
  assert.ok(!sl.removeArt(root, '../策划标杆.md').ok, '路径穿越拒');
});

t('空库解析/列表不炸', () => {
  const root = makeRoot();
  assert.deepEqual(sl.parseAxioms(root), []);
  assert.deepEqual(sl.listArt(root), []);
});

console.log(`全部通过：${passed} 项`);
