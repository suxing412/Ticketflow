// test/外呼绊线.js — 测试进程里「有没有真外呼」的可观测账（2026-08-22 体检 #71 余量）
//
// 案源：碰 pool.claim / gates.canPull / runner.tick 的套件里，光把 lib/quota 打桩**不构成判据**——
// 桩子被谁删掉，测试照绿（sentinel.test.js 实测过：全套 12 例零 child_process 调用，
// 纯属 lib/pool.js:80 把哨兵熔断放在 canPull 之前的副作用，不是纪律）。
// 绊线把这件事变成事实账：任何一次 spawn/execFile/https 请求都记一笔并**当场抛**，
// 末例断言这本账为空。原函数一概不调用——测试进程里不许存在真外呼这条路。
//
// 用法（**必须是套件的第一条 require，排在任何 lib/ 之前**）：
//   const 绊线 = require('./外呼绊线'); 绊线.装绊线();
//   …套件正文…
//   绊线.断言无外呼(assert);   // 末例
//
// 为什么必须排第一：lib/quota.js:9 是 `const { spawn, execFile } = require('child_process')`
// ——模块加载那一刻就把函数引用解构走了，事后再替 child_process 上的字段一点用没有。
//
// 只拦 child_process 与 https；**不拦 http**：起临时 express 实例做 HTTP 行为判据的套件
// （stub / feature-gate 一类）走的是 http，那是本机自跑不是外呼，拦了等于禁掉一整类真判据。

const 记录 = [];
let 已装 = false;

function 装绊线() {
  if (已装) return 记录;
  已装 = true;
  // 放行「起 node 自己」：runner/schedule/testrunner 一类套件要 spawn 子进程做行为判据
  // （真起一个 node 跑一段脚本，看它落什么账），那是**本机测试脚手架**，不是外呼。
  // 拦了它等于禁掉一整类真判据——而本项目正在做的事恰恰是把判据从 grep 换成真跑。
  // 残余风险：子 node 进去之后再调引擎，这一层拦不住。故只放行 node 二进制本身，
  // 别的可执行文件（codex/claude/git 等）一概照拦——引擎渗入正是靠那些名字进来的。
  const 是node = (c) => {
    const s = String(c || '');
    if (s === process.execPath) return true;
    const base = s.split(/[\\/]/).pop().toLowerCase();
    return base === 'node' || base === 'node.exe';
  };
  const 拦 = (名, 放行) => function (...a) {
    if (放行 && 是node(a[0])) return 原始[名.split('.')[1]].apply(this, a);
    const 摘 = 名 + ' ' + (() => { try { return JSON.stringify(a[0]); } catch { return String(a[0]); } })();
    记录.push(摘);
    throw new Error('真实外呼渗入测试：' + 摘 + '（该打桩的没打桩）');
  };
  const cp = require('child_process');
  const 原始 = {};
  for (const k of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) 原始[k] = cp[k];
  // exec/execSync 第一个参数是整条命令行，判不准，一律照拦（本仓没有套件用它们起 node）
  for (const k of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) cp[k] = 拦('child_process.' + k, true);
  for (const k of ['exec', 'execSync']) cp[k] = 拦('child_process.' + k, false);
  const https = require('https');
  https.request = 拦('https.request');
  https.get = 拦('https.get');

  // 收尾自动查账（2026-08-22）：抛异常是主防线，但**抛得出不等于拦得住**——
  // 套件若把调用包在 try/catch 里（本仓有好几处专测错误路径的用例就是这么写的），
  // 那一笔会被记下来然后咽掉，套件照样绿。所以退出时再查一次这本账。
  // 挂在模块里而不是要求每个套件写末例：靠人记得加末例，就是本轮判掉 22 条假判据的同一种病。
  process.on('exit', () => {
    if (!记录.length) return;
    process.exitCode = 1;
    console.error('  ✗ 真实外呼渗入测试（被套件吞掉了异常，但账记着）：' + JSON.stringify(记录));
  });
  return 记录;
}

// 末例用。传 assert 进来是为了不让本模块依赖某个 assert 版本，也让失败堆栈落在套件里。
function 断言无外呼(assert, 名 = '本套件') {
  assert.deepEqual(记录, [],
    名 + '里发生了真实外呼——测试跑一遍就会去点真 API / 起真会话 / 读真凭据：' + JSON.stringify(记录));
  return true;
}

module.exports = { 装绊线, 断言无外呼, 记录 };
