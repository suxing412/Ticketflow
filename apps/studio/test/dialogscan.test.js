// dialogscan.test.js — 原生对话框哑弹扫描（施工令-012 / 巡礼 P1）
// 这道自检的价值全在「不误报」：一旦开始报噪声就会被当背景音忽略，下次 prompt 漏网照样漏。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ds = require('../lib/dialogscan');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('dialogscan 原生对话框扫描测试（施工令-012）');

t('三个 API 全命中，带行号与 api 名', () => {
  const hits = ds.scan(['const a = prompt("池名");', 'if (confirm("删?")) {}', 'alert("x");'].join('\n'), { 文件: 'app.js' });
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map((h) => h.api), ['prompt', 'confirm', 'alert']);
  assert.deepEqual(hits.map((h) => h.行), [1, 2, 3]);
  assert.equal(hits[0].文件, 'app.js');
});

t('window./globalThis. 前缀照样命中（换个写法绕不过去）', () => {
  assert.equal(ds.scan('const v = window.prompt("x");').length, 1);
  assert.equal(ds.scan('globalThis.alert("x");').length, 1);
  assert.equal(ds.scan('self.confirm("x");').length, 1);
});

t('注释不算：整行 // 、块注释、行尾注释', () => {
  assert.equal(ds.scan('// 2026-08-06 制作人实测：Electron 壳内原生 confirm() 哑弹').length, 0);
  assert.equal(ds.scan(' * 修法：把四次 prompt() 换掉').length, 0);
  assert.equal(ds.scan('/* 原生 alert() 不可用 */').length, 0);
  assert.equal(ds.scan('const x = 1; /* prompt("x") */').length, 0);
  assert.equal(ds.scan('const x = 1; // 别再用 prompt("x")').length, 0);
});

t('跨行块注释的中间行不算（第一版栽在这：修法注释把自己报成红灯）', () => {
  const src = [
    '/* 兼容池编辑：轻量四问式',
    '   施工令-012：四次原生 prompt() 换装成自绘 askInput()',
    '   confirm() 族十处已于 2026-08-06 换装 */',
    'window.compatEdit = async (name) => {};',
  ].join('\n');
  assert.deepEqual(ds.scan(src), []);
});

t('块注释闭合后同一行的真调用照样命中（状态机不吃过头）', () => {
  const src = ['/* 注释开始', '   prompt() 在这只是文字 */ const v = prompt("真调用");'].join('\n');
  const hits = ds.scan(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].行, 2);
});

t('行尾注释剥离放过 http:// 协议斜杠（不误伤后面的真代码）', () => {
  const hits = ds.scan('const u = "http://x/a"; confirm("走?");');
  assert.equal(hits.length, 1, '协议斜杠被当注释起点会把真调用一并吞掉');
});

t('自绘 ask 家族与同名前后缀标识符零命中（不误报）', () => {
  const src = [
    'window.ask = (msg) => new Promise((res) => {});',
    'window.askInput = (label, def, opts) => new Promise((res) => {});',
    'if (await ask("打回将归档旧单，确认？")) dAct();',
    'const v = await askInput("池名：", "");',
    'obj.confirm(1); this.alert(2); a.b.prompt(3);',
    'const noprompt = 1; myalert(2); doConfirm(3);',
  ].join('\n');
  assert.equal(ds.scan(src).length, 0);
});

t('摘要：零命中 null；命中出人读串，超 5 处带总数', () => {
  assert.equal(ds.摘要([]), null);
  assert.equal(ds.摘要(null), null);
  const many = Array.from({ length: 7 }, (_, i) => ({ 文件: 'app.js', 行: i + 1, api: 'prompt' }));
  const s = ds.摘要(many);
  assert.ok(s.includes('app.js:1 prompt()'));
  assert.ok(s.includes('等 7 处'), s);
});

t('实弹：生产前端 public/app.js 零命中（施工令-012 验收标准）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const hits = ds.scan(src, { 文件: 'public/app.js' });
  assert.equal(hits.length, 0, '前端仍有原生对话框：' + ds.摘要(hits));
});

console.log('全部通过：' + passed + ' 项');
