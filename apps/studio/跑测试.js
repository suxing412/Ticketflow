#!/usr/bin/env node
// 跑测试.js — 测试链的执行器。
//
// 案源（2026-08-21 体检）：package.json 的 test 原先是 60 个 `node test/*.test.js` 用 `&&` 串起来的一条长链。
// 后果是**一红吞五十二**：runner.test.js 排第 8，它一红，后面 52 个套件一次都不跑，
// 而输出看起来只是「少了几行」。当天实测 126 个 ✓ 就停，而基线宣称的是 859 项——
// 数字对不上却没人察觉，因为没人会去数。
//
// 三条纪律：
//   ① **逐个跑完再汇总**。一个套件红，别的照跑；最后按「有没有红」定退出码。
//   ② **保留原打印口径**（各套件自己的 ✓/✗ 原样透传）。deploy-ritual 的换装闸判据是
//      `npm test 2>&1 | grep -c "✗"` 必须为 0——换成 node:test 会改掉输出格式，直接打断那道闸。
//   ③ **把真实数字报出来**：套件数、断言数、红名单。基线数字必须是跑出来的，不是抄上一次的。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const 目录 = path.join(__dirname, 'test');
// 顺序固定（字典序）：顺序不定则「跑到第几个」这句话没有意义，排查时对不上账。
// 排除 helper.js 这类非套件文件——只认 *.test.js。
const 套件 = fs.readdirSync(目录).filter((f) => f.endsWith('.test.js')).sort();

// 单套件墙钟上限。默认 180s；测试自身要验「挂死算红」这条，180s 等不起，
// 故留一个环境变量口子（只影响时长，不影响判定路径）——判据里设成 1500ms 造一个真挂死的假套件，
// 看执行器是不是真把它记成红。没有这个口子，那条判据就只能退回 grep 源码，那不算数。
const 超时毫秒 = Number(process.env.测试超时毫秒) > 0 ? Number(process.env.测试超时毫秒) : 180000;

// 换装闸自守（2026-08-22 体检 #1/#5/#7）：闸判据是 `npm test 2>&1 | grep -c "叉号"` 必须为 0。
// 一个**退出码 0**的套件只要在输出里打了这个字符（最常见的是用例名里带它，跑绿也照印），
// 那道闸就永远到不了 0——闸不是被某次失败挡住，而是结构性不可达，且从输出上看一切正常。
// 实测已两犯（precheck.test.js 的基线用例名、testrunner.test.js 的 ✗ 计数用例名）。
// 故在执行器这一层把它变成硬约束：绿套件带叉号即判红并点名。
// 用码位取字符，不在本行落一个字面叉号——否则执行器自己的源码就成了下一个犯例。
const 叉 = String.fromCharCode(0x2717);

const 红 = []; const 绿带叉 = []; let 断言 = 0; const t0 = Date.now();
for (const f of 套件) {
  const r = spawnSync(process.execPath, [path.join(目录, f)], { encoding: 'utf8', timeout: 超时毫秒 });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  for (const m of out.matchAll(/全部通过：(\d+)/g)) 断言 += Number(m[1]);
  for (const m of out.matchAll(/(\d+) 项通过/g)) 断言 += Number(m[1]);
  // 超时（status===null 且有 signal）与非零退出一律算红，不许把「跑挂了」读成「跑过了」
  if (r.status !== 0) 红.push({ 套件: f, 退出: r.status, 信号: r.signal || null });
  // codex 事后审 #15（2026-08-24）：libuv 级崩溃（Assertion failed: !(handle->flags...)）可能
  // 发生在断言全过、退出码已定为 0 之后——聚合器若不看 stderr，「红 0」就躲过了一次进程级异常。
  // 这类崩溃不该当发布门槛的漏网：stderr 见 Assertion failed 一律判红，逼人去查成因。
  else if (/Assertion failed/.test(String(r.stderr || ''))) 红.push({ 套件: f, 退出: 0, 信号: 'stderr:Assertion failed' });
  else if (out.includes(叉)) 绿带叉.push(f);
}

const 秒 = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
console.log(`══ 套件 ${套件.length} · 断言 ${断言} · 耗时 ${秒}s · 红 ${红.length} ══`);
for (const x of 红) console.log(`  ✗ ${x.套件}（退出 ${x.退出}${x.信号 ? ' 信号 ' + x.信号 : ''}）`);
if (绿带叉.length) {
  // 这几行自己一个叉号都不许打——它们正是为了让 grep 计数归零而存在的。
  console.log(`  ！换装闸不可达：下列套件退出码 0，却在输出里打了叉号（U+2717），共 ${绿带叉.length} 个`);
  for (const f of 绿带叉) console.log(`      · ${f}`);
  console.log('    修法：把用例名/打印文案里的那个字符换成「不通过」二字。');
}
process.exit(红.length || 绿带叉.length ? 1 : 0);
