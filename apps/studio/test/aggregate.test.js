// aggregate.test.js — 仓级测试聚合器 scripts/test-all.js 的判据（2026-08-22 体检 #48/#54）
//
// 案源：仓里 9 个 package 各自带 scripts.test（合计两百多项断言），**没有任何入口把它们串起来**。
// packages/budget 的预算闸、packages/quota 的额度闸——两道闸的本体就在那儿——长期无人跑。
// 本套件盯的是：聚合入口在位、扫得全、红能透传。
//
// 纪律：只做**纯扫描**与**假仓树端到端**两种验证。绝不在这里对真仓跑聚合器——
// 聚合器会去跑 apps/studio 的 跑测试.js，而本文件正是它的一员，那就是无限递归。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { 临时目录 } = require('./helper');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('仓级测试聚合器测试');

const 根 = path.join(__dirname, '..');
const 仓根 = path.resolve(根, '..', '..');
const 聚合器 = path.join(仓根, 'scripts', 'test-all.js');
const 有仓 = fs.existsSync(聚合器); // 打包产物里没有源码仓

function 造假仓(包们) {
  const 仓 = 临时目录('agg-');
  fs.mkdirSync(path.join(仓, 'packages'));
  for (const [名, j] of Object.entries(包们)) {
    const d = path.join(仓, 'packages', 名);
    fs.mkdirSync(d);
    if (j !== null) fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(j), 'utf8');
  }
  return 仓;
}

t('仓根 package.json 把 npm test 接到聚合器上（没接上等于没有入口）', () => {
  if (!有仓) return;
  const j = JSON.parse(fs.readFileSync(path.join(仓根, 'package.json'), 'utf8'));
  const s = String((j.scripts || {}).test || '');
  assert.match(s, /test-all\.js/, '仓根 npm test 必须走聚合器，实测：' + s);
  assert.ok(!s.includes('&&'), '不许再用 && 串——一红吞后面全部');
});

t('发现包()：真喂一棵目录树看它收谁（不是 grep 源码）', () => {
  if (!有仓) return;
  const { 发现包 } = require(聚合器);
  const 仓 = 造假仓({
    甲: { name: '甲', scripts: { test: 'node -e ""' } },
    乙: { name: '乙', scripts: { build: 'x' } },   // 有 package.json 但没有 test
    丙: null,                                      // 连 package.json 都没有
    丁: { name: '丁', scripts: { test: '   ' } },  // test 是空白串，等于没有
  });
  assert.deepEqual(发现包(仓).map((x) => x.名), ['甲'], '只该收 scripts.test 非空的包');
  fs.rmSync(仓, { recursive: true, force: true });
  assert.deepEqual(发现包(临时目录('agg-空-')), [], '没有 packages/ 目录时返回空，不许炸');
});

t('一个包红不许掐掉后面的，且退出码要透传', () => {
  if (!有仓) return;
  const 仓 = 造假仓({
    甲: { name: '甲', scripts: { test: 'node -e "console.log(\'  ✗ 甲炸了\'); process.exit(1)"' } },
    乙: { name: '乙', scripts: { test: 'node -e "console.log(\'  ✓ 乙\'); console.log(\'全部通过：1 项\')"' } },
  });
  let out = '', code = 0;
  try { out = execFileSync(process.execPath, [聚合器, 仓], { encoding: 'utf8', timeout: 120000 }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); code = e.status; }
  assert.equal(code, 1, '有红即整体红，实测 code=' + code + '\n' + out);
  assert.match(out, /甲炸了/, '红包的输出要原样透传');
  assert.match(out, /✓ 乙/, '甲红了，乙照样要跑——这正是「没有聚合器」与「串成 && 链」都做不到的');
  assert.match(out, /══ 包 2 · 套件 2 · 耗时 [\d.]+s · 红 1 ══/, '尾行是机器出口，格式不许漂：' + out);
  assert.match(out, /✗ packages\/甲/, '红名单要点名');
  fs.rmSync(仓, { recursive: true, force: true });
});

t('真仓覆盖闸：packages 下每个带 test 的包都在链上，新增包不补名单也自动红', () => {
  if (!有仓) return;
  const { 发现包, 跳过 } = require(聚合器);
  // 用例自己 readdirSync 数一遍做对拍——聚合器漏扫、扫错目录、悄悄改了收取条件，这里都会红。
  const 应有 = fs.readdirSync(path.join(仓根, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => {
      const p = path.join(仓根, 'packages', e.name, 'package.json');
      if (!fs.existsSync(p)) return false;
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return !!(j.scripts && j.scripts.test && String(j.scripts.test).trim());
    })
    .map((e) => e.name)
    .filter((n) => !跳过.has(n))
    .sort();
  assert.deepEqual(发现包(仓根).map((x) => x.名), 应有, '聚合器扫到的包与盘上不一致');
  assert.ok(应有.length >= 6, '仓里带 test 的包不该少于 6 个，实测 ' + 应有.length + '：' + 应有.join('/'));
  // 被跳过的必须是「已经在别处跑了」的，不许拿跳过当逃单借口。
  for (const n of 跳过) {
    const s = String(JSON.parse(fs.readFileSync(path.join(仓根, 'packages', n, 'package.json'), 'utf8')).scripts.test);
    const m = s.match(/apps\/studio\/test\/([\w.-]+\.test\.js)/);
    assert.ok(m, '跳过 ' + n + ' 的唯一正当理由是它指向 apps/studio/test/ 下的套件（已被 跑测试.js 收），实测：' + s);
    assert.ok(fs.existsSync(path.join(根, 'test', m[1])), '被跳过的包指向的套件 ' + m[1] + ' 不在盘上，等于这个包没人跑');
  }
});

console.log('全部通过：' + passed + ' 项');
