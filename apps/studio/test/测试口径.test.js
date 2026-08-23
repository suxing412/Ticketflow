// 测试口径.test.js — 测试链自身的三条口径（2026-08-22 体检 #1/#5/#7 · #60 · #70/#37 ④）
//
// 这三条都不是「某个功能对不对」，而是**「测试这句话本身可不可信」**：
//   ① 换装闸零叉号：绿套件在输出里打叉号，会让 deploy-ritual 的 `grep -c 叉号 == 0` 结构性不可达。
//   ② 收尾口径归一：跑测试.js 的「断言 M」靠尾行正则数，helper.收尾() 的格式一改就静默少收上百项。
//   ③ 夹具不陈旧：test/helper.js 的 闸值 与 lib/setup.js 模板配置() 分叉，会把参数页两表对拍搅混。
//
// 纪律：一律**真跑**——①② 造临时假巢真跑 跑测试.js 的副本看它的实际输出与退出码，
// ③ 真调 lib/setup 的模板生成与 lib/gatereg 的取值函数。本文件里没有一条 assert.match(源码, /.../)。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CFG, 临时目录, 收尾 } = require('./helper');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ' + String.fromCharCode(0x2713) + ' ' + n); };
console.log('测试口径测试（换装闸零叉号 / 收尾口径 / 夹具时效）');

const 根 = path.join(__dirname, '..');
const 叉 = String.fromCharCode(0x2717); // 本文件自己不许出现字面叉号，否则它就是下一个犯例

// 假巢：一份 跑测试.js 副本 + 一个 test/ 目录，随便塞假套件。
// 绝不在这里对真的 test/ 跑执行器——本文件正是它的一员，那就是无限递归。
function 造巢(套件们) {
  const 巢 = 临时目录('口径-');
  const d = path.join(巢, 'test');
  fs.mkdirSync(d);
  for (const [名, 体] of Object.entries(套件们)) fs.writeFileSync(path.join(d, 名), 体, 'utf8');
  fs.copyFileSync(path.join(根, '跑测试.js'), path.join(巢, '跑测试.js'));
  return 巢;
}
function 跑巢(巢) {
  try {
    return { out: execFileSync(process.execPath, [path.join(巢, '跑测试.js')], { encoding: 'utf8', timeout: 60000 }), code: 0 };
  } catch (e) {
    return { out: String(e.stdout || '') + String(e.stderr || ''), code: e.status == null ? '没返回：' + (e.code || e.signal || e.message) : e.status };
  }
}
const 绿套件 = (名) => `console.log('  ' + String.fromCharCode(0x2713) + ' ${名}'); console.log('全部通过：1 项');`;

// ── ① 换装闸零叉号 ────────────────────────────────────────────────
t('绿套件在输出里打叉号 → 执行器点名并判红（换装闸不可达是硬伤，不是风格问题）', () => {
  const 巢 = 造巢({
    // 退出码 0，但用例名里带叉号——今日实测的两个犯例（precheck / testrunner）就是这个形状
    'a.test.js': `console.log('  ' + String.fromCharCode(0x2713) + ' 甲（' + String.fromCharCode(0x2717) + ' 也是应答）'); console.log('全部通过：1 项'); process.exit(0);`,
    'b.test.js': 绿套件('乙'),
  });
  const { out, code } = 跑巢(巢);
  assert.equal(code, 1, '绿着带叉号必须判红，实测 code=' + code + '\n' + out);
  assert.ok(out.includes('换装闸不可达'), '要说明白为什么红：' + out);
  assert.ok(out.includes('a.test.js'), '必须点名到套件，不许只报个总数：' + out);
  assert.ok(!out.includes('b.test.js'), '干净的套件不许被连坐：' + out);
  fs.rmSync(巢, { recursive: true, force: true });
});

t('全绿且零叉号 → 不点名、退出 0（这条防的是上一条误伤）', () => {
  const 巢 = 造巢({ 'a.test.js': 绿套件('甲'), 'b.test.js': 绿套件('乙') });
  const { out, code } = 跑巢(巢);
  assert.equal(code, 0, '两个干净的绿套件必须整体绿：' + out);
  assert.equal(out.match(new RegExp(叉, 'g')), null, '全绿跑一遍还能 grep 到叉号，换装闸就永远过不去：' + out);
  assert.ok(!out.includes('换装闸不可达'), '没犯例就不许喊：' + out);
  fs.rmSync(巢, { recursive: true, force: true });
});

t('红套件照旧点名，且不因为它带叉号就被记成「绿带叉」（两类不许串味）', () => {
  const 巢 = 造巢({
    'a.test.js': `console.log('  ' + String.fromCharCode(0x2717) + ' 甲炸了'); process.exit(1);`,
    'b.test.js': 绿套件('乙'),
  });
  const { out, code } = 跑巢(巢);
  assert.equal(code, 1, '有红即整体红');
  assert.ok(out.includes('红 1'), '尾行要如实报红数：' + out);
  assert.ok(!out.includes('换装闸不可达'), '真红的套件走红名单那条路，不许再被扣一顶「绿带叉」的帽子：' + out);
  fs.rmSync(巢, { recursive: true, force: true });
});

// ── ② 收尾口径归一 ────────────────────────────────────────────────
t('helper.收尾() 打出来的那一行，执行器真的数得进「断言 M」', () => {
  // 不抄格式：真调 收尾() 把它当场打出来的字捞走，再原样喂给执行器。
  // 这样 收尾() 的格式与 跑测试.js 的计数正则谁先改，这一格都会红。
  const 原 = console.log; const 收 = [];
  console.log = (...a) => 收.push(a.join(' '));
  try { 收尾('假套件', 7); 收尾(null, 5); } finally { console.log = 原; }
  assert.equal(收.length, 2, '收尾() 应当只打一行');
  const 巢 = 造巢({
    'a.test.js': 'console.log(' + JSON.stringify(收[0]) + ');',
    'b.test.js': 'console.log(' + JSON.stringify(收[1]) + ');',
  });
  const { out, code } = 跑巢(巢);
  assert.equal(code, 0, out);
  assert.ok(out.includes('断言 12'), '收尾()（具名 7 + 匿名 5）没被数进总账，「N 套件 M 项」就是假数：' + out);
  fs.rmSync(巢, { recursive: true, force: true });
});

t('收尾() 只走一种口径：不许同一行被两条计数正则各收一遍（重复计数＝虚报）', () => {
  const 原 = console.log; const 收 = [];
  console.log = (...a) => 收.push(a.join(' '));
  try { 收尾('假套件', 9); } finally { console.log = 原; }
  const 巢 = 造巢({ 'a.test.js': 'console.log(' + JSON.stringify(收[0]) + ');' });
  const { out } = 跑巢(巢);
  assert.ok(out.includes('断言 9') && !out.includes('断言 18'), '一行被数了两遍：' + out);
  fs.rmSync(巢, { recursive: true, force: true });
});

// ── ③ 夹具时效 ────────────────────────────────────────────────────
t('helper 夹具的 闸值 键集 == lib/setup 模板配置() 的 闸值 键集（退役键不许在夹具里续命）', () => {
  const 模板 = require('../lib/setup').模板配置();
  assert.deepEqual(Object.keys(CFG.闸值).sort(), Object.keys(模板.闸值).sort(),
    '夹具与新部署模板的闸值形状分叉——参数页「画哪几张卡 ↔ 写口收哪几个键」的两表对拍会被夹具搅混。'
    + ' 夹具=' + JSON.stringify(Object.keys(CFG.闸值)) + ' 模板=' + JSON.stringify(Object.keys(模板.闸值)));
});

t('夹具里的 人闸超时小时 是真被读的那一格（不是摆设）', () => {
  const gatereg = require('../lib/gatereg');
  assert.equal(gatereg.逾期阈值(CFG), CFG.闸值.人闸超时小时, '夹具配的 T 没被取值函数读到');
  assert.equal(gatereg.逾期阈值({ 闸值: { 人闸超时小时: 6 } }), 6, '取值函数根本不看配置');
});

收尾('测试口径', passed);
