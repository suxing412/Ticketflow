// testrunner.test.js — 测试链执行器自身的判据（2026-08-21 体检立，2026-08-22 体检加固）
// 案源：原 package.json 的 test 是 60 个 `node test/*.test.js` 用 && 串成的长链。
// **一红吞五十二**：runner.test.js 排第 8，它一红后面 52 个套件一次都不跑，
// 而输出只是「少了几行」——当天实测 126 个 ✓ 就停，基线却宣称 859 项，数字对不上没人察觉。
// 本套件盯的是：这个执行器别再退化回那种形态。
//
// 2026-08-22 加固纪律：本套件里的判据一律**真跑真看输出**。
// 上一轮复核判掉了 22 条 `assert.match(读源码, /某串字/)` 式的假判据——它既漏真病（换个写法照样有病），
// 又误伤重构（改个变量名就假红）。凡是能在临时巢里真跑一遍的，就不许去 grep 源码。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { 等到, 临时目录 } = require('./helper');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const T = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('测试链执行器测试');

const 根 = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(根, 'package.json'), 'utf8'));

// 造一个「假巢」：一份 跑测试.js 副本 + 一个 test/ 目录，里面随便塞假套件。
// 这样能对执行器做端到端的行为验证，而不必去动真的 68 个套件。
function 造巢(套件们) {
  const 巢 = 临时目录('tr-');
  const d = path.join(巢, 'test');
  fs.mkdirSync(d);
  for (const [名, 体] of Object.entries(套件们)) fs.writeFileSync(path.join(d, 名), 体, 'utf8');
  fs.copyFileSync(path.join(根, '跑测试.js'), path.join(巢, '跑测试.js'));
  return 巢;
}

function 跑巢(巢, env) {
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(巢, '跑测试.js')], {
      encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, env || {}),
    });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    // execFileSync 自己超时（子进程压根没返回）时 status 是 undefined/null——
    // 这跟「执行器判它红」是两回事，原样交给断言去分辨，不许在这里抹平。
    code = e.status === undefined || e.status === null ? '执行器自己没返回：' + (e.code || e.signal || e.message) : e.status;
  }
  return { out, code };
}

(async () => {

t('test 脚本不许再是 && 长链（一红吞五十二的原形）', () => {
  const s = String(pkg.scripts.test);
  assert.ok(!s.includes('&&'), 'test 脚本里出现 && 即回退到旧形态：' + s);
  assert.match(s, /跑测试\.js/, 'test 必须走执行器');
});

t('执行器按后缀收全 test/*.test.js，不多收 helper 也不漏新套件', () => {
  // 行为面：真塞四个文件进假巢，看它到底跑了哪几个。
  // 多收（把 helper.js 当套件）会炸，漏收（手抄清单）会少数——两头都由这一格看住。
  const 巢 = 造巢({
    'a.test.js': "console.log('  ✓ 甲'); console.log('全部通过：1 项');",
    'z.test.js': "console.log('  ✓ 癸'); console.log('全部通过：1 项');",
    'helper.js': "console.log('helper 被当套件跑了'); process.exit(1);",
    '笔记.txt': '这不是 JS，跑它必炸',
  });
  const { out, code } = 跑巢(巢);
  assert.equal(code, 0, '两个绿套件应整体绿：' + out);
  assert.match(out, /══ 套件 2 /, '只该认 *.test.js 这两个，实测输出：' + out);
  assert.ok(!/helper 被当套件跑了/.test(out), 'helper.js 不是套件，不许收进去');
  assert.match(out, /甲/); assert.match(out, /癸/, '按后缀收就不会漏掉新加的套件');
  const 盘上 = fs.readdirSync(path.join(根, 'test')).filter((f) => f.endsWith('.test.js'));
  assert.ok(盘上.length >= 60, '当前应有 60+ 套件，实测 ' + 盘上.length);
  fs.rmSync(巢, { recursive: true, force: true });
});

t('一个套件红不许掐掉后面的（本条即整条修法的理由）', () => {
  const 巢 = 造巢({
    'a.test.js': "console.log('  ✓ 甲'); console.log('全部通过：1 项');",
    'b.test.js': "console.log('  ✗ 乙炸了'); process.exit(1);",
    'c.test.js': "console.log('  ✓ 丙'); console.log('全部通过：2 项');",
    // 第二种收尾口径（仓里 estimate/poolbalance/pulse/specials 共上百项走的就是这条）：
    // 不造它，跑测试.js 里收 `N 项通过` 的那行就没人看守，删掉也没人喊。
    'd.test.js': "console.log('  ✓ 丁'); console.log('specials 全部 4 项通过');",
  });
  const { out, code } = 跑巢(巢);
  assert.equal(code, 1, '有红即整体红');
  assert.match(out, /甲/); assert.match(out, /丙/, '乙红了，丙照样要跑——这正是 && 链做不到的');
  assert.match(out, /丁/, '红的后面全都要跑完，不是跑到下一个就算');
  assert.match(out, /断言 7/, '两种收尾口径都要累加（甲 1 + 丙 2 + 丁 4）——只收一种，上百项会被静默吞掉：' + out);
  assert.match(out, /✗ b\.test\.js/, '红名单要点名，不许只报个总数');
  fs.rmSync(巢, { recursive: true, force: true });
});

t('全绿时输出里一个叉号都不许有（deploy-ritual 换装闸判的就是叉号计数）', () => {
  // 换装闸是 `npm test 2>&1 | grep -c "✗"` 必须为 0。
  // 所以「全绿」必须真的做到零 ✗：执行器自己不许加装饰，子套件输出要原样透传。
  const 巢 = 造巢({
    'a.test.js': "console.log('  ✓ 甲'); console.log('全部通过：1 项');",
    'b.test.js': "console.log('  ✓ 乙'); console.log('全部通过：1 项');",
    'c.test.js': "console.log('  ✓ 丙'); console.log('全部通过：1 项');",
  });
  const { out, code } = 跑巢(巢);
  assert.equal(code, 0, '三个绿套件必须整体绿：' + out);
  assert.equal(out.match(/✗/g), null, '全绿跑一遍还能 grep 到 ✗，换装闸就永远过不去：' + out);
  assert.equal((out.match(/✓/g) || []).length, 3, '子套件的 ✓ 要原样透传，不许改格式：' + out);
  assert.match(out, /══ 套件 3 · 断言 3 · 耗时 [\d.]+s · 红 0 ══/, '尾行是唯一的机器出口，格式不许漂：' + out);
  fs.rmSync(巢, { recursive: true, force: true });
});

t('挂死算红：超时被杀不许读成通过', () => {
  // 行为面。默认超时 180s 等不起，用 测试超时毫秒 把闸压到 1.5s，只改时长不改判定路径。
  const 巢 = 造巢({
    'a.test.js': "console.log('  ✓ 甲'); console.log('全部通过：1 项');",
    'hang.test.js': "console.log('挂死了'); setInterval(() => {}, 1000);",
  });
  const { out, code } = 跑巢(巢, { 测试超时毫秒: '1500' });
  assert.equal(code, 1, '挂死的套件必须把整条链判红，实测 code=' + code + '\n' + out);
  assert.match(out, /✗ hang\.test\.js/, '挂死的要点名，不许静默吞掉：' + out);
  assert.match(out, /甲/, '前一个套件的输出照旧要在');
  fs.rmSync(巢, { recursive: true, force: true });
});

await T('等到() 是条件轮询，不是睡一段墙钟（时序假设不许回潮）', async () => {
  // 案源（2026-08-21）：runner.test.js 用 `await sleep(40)` 等 spawn 子进程写两行 stderr，
  // 本机连跑 10 次 10 红。这一格坐在换装闸的唯一机器出口上，靠运气的断言让「全绿」整体不可信。
  // 行为面两向都验：条件成立要**马上**返回（而且真的轮询过多次），条件不成立要**指名道姓**地抛。
  let 次 = 0;
  const t0 = Date.now();
  const 好 = await 等到(() => { 次++; return 次 >= 3; }, 3000, '数到三');
  const 用时 = Date.now() - t0;
  assert.equal(好, true, '条件成立要返回 true');
  assert.ok(次 >= 3, '必须真的反复求值条件（轮询），实测只求值 ' + 次 + ' 次——睡墙钟的实现只会求值 1 次');
  assert.ok(用时 < 1500, '条件一成立就该返回，实测等了 ' + 用时 + 'ms——这是在睡墙钟');

  let 抛了 = null;
  try { await 等到(() => false, 120, '永不成立的条件'); } catch (e) { 抛了 = e; }
  assert.ok(抛了, '超时必须抛，静默返回会让后面的断言替它背锅');
  assert.match(String(抛了.message), /永不成立的条件/, '失败信息要指名道姓：' + (抛了 && 抛了.message));
});

t('文档里的测试规模不许与盘上分叉（数字只有一个权威出口）', () => {
  // 不是正则扫源码，是拿**文档声称的数**去比**磁盘真实状态**，且按行限定只管含 `npm test` 的口径行。
  // 案源（2026-08-21 体检）：README 抄着「134 项测试」、说明书抄着「35 套件 334 例」，盘上早已 60+。
  // 手抄的数字没有任何机器看守，一次都对不上也没人知道。
  const 盘上 = fs.readdirSync(path.join(根, 'test')).filter((f) => f.endsWith('.test.js')).length;
  const 仓根 = path.resolve(根, '..', '..');
  let 锚 = 0;
  for (const rel of ['README.md', 'docs/仓库总说明书.md']) {
    const p = path.join(仓根, ...rel.split('/'));
    if (!fs.existsSync(p)) continue; // 打包产物里没有源码仓，跳过不算失败
    for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (!/npm test/.test(l)) continue;
      锚++;
      for (const m of l.matchAll(/(\d+)\s*套件/g)) {
        assert.equal(Number(m[1]), 盘上, rel + ' 写着 ' + m[1] + ' 套件，盘上是 ' + 盘上 + '——数字以 跑测试.js 尾行为准');
      }
      assert.ok(!/\d+\s*(例|项测试)/.test(l), rel + ' 在手抄断言数；断言数跑完才知道，文档硬写必漂：' + l.trim());
    }
  }
  assert.ok(锚 >= 2, '两份文档里的 npm test 口径行找不着了——判据失去锚点，等于形同虚设（实测锚点 ' + 锚 + '）');
});

console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error('  ✗ ' + (e && e.stack || e)); process.exit(1); });
