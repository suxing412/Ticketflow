// 总启动器 —— 一条命令把整个产品带起来（协-005）。
//
// 为什么需要它：本产品按**能力**切了三个进程，这个切分是有意的（见下），
// 但代价是人要开三个终端。「装好之后开三个终端才能用」不叫可跑的产品。
//
//   :4370  server.js         只转发。闭包里没有 child_process，物理上起不了 CLI 进程
//   :4371  工作区服务.js      只碰 git
//   :4372  执行器.js          唯一被允许拉起 AI CLI 的地方
//
// 本文件是**监工**，不是第四种能力：它只负责起进程和收尸，不处理任何业务请求，
// 不监听端口。child_process 住在这里不破坏上面那条保证——server.js 的模块闭包
// 依旧干净，任何打到 :4370 的请求都走不到能 spawn 的代码。
//
// ⚠ 自动拉起执行器**不等于**放开花钱。真跑仍然要同时过三闸：
// 请求体 {"干跑": false} + config/执行.local.json 的 允许真跑 + 预算.池 里有上限。
// 执行器进程活着只是「随时能干活」，不是「已经在花钱」。
// 真不想让它活着：设 PLATFORM_NO_EXECUTOR=1。
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const 平台根 = path.resolve(__dirname, '..');

const 无执行器 = String(process.env.PLATFORM_NO_EXECUTOR || '') === '1';

const 名单 = [
  { 名: 'server', 脚本: path.join(平台根, 'server.js'), 口: 4370, 色: 36 },
  { 名: '工作区', 脚本: path.join(平台根, 'scripts', '工作区服务.js'), 口: 4371, 色: 32 },
  ...(无执行器 ? [] : [{ 名: '执行器', 脚本: path.join(平台根, 'scripts', '执行器.js'), 口: 4372, 色: 33 }]),
];

const 孩子 = [];
let 收摊中 = false;

// 三路日志混在一个终端里，不标出处就没法看。
// 但三个子进程**自己已经打了标签**（[执行器] 上岗 …），再套一层就成了
// 「[执行器　] [执行器] 上岗」——重复且更难读。所以自带标签的行只染色不加前缀，
// 没标签的行（异常栈就是）才补前缀，免得孤零零一段栈不知道是谁吐的。
//
// 补齐用显示宽度不用字符数：中文在终端占两列，padEnd 按字符补必然对不齐。
const 显宽 = (s) => [...s].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
const 宽 = Math.max(...名单.map((x) => 显宽(x.名)));
function 转发输出(子, 条) {
  const 头 = `\x1b[${条.色}m[${条.名}${' '.repeat(宽 - 显宽(条.名))}]\x1b[0m `;
  const 接 = (流) => {
    let 余 = '';
    流.on('data', (块) => {
      余 += String(块);
      const 行 = 余.split(/\r?\n/);
      余 = 行.pop();                                  // 最后一段可能是半行，留到下次
      for (const l of 行) {
        // 记一笔端口冲突。退出码分不出来：Windows 上 taskkill /F 杀掉的进程
        // 和端口占用退出的进程，退出码都是 1。只能看它到底吐没吐这句。
        // 不看就乱猜的后果实测过一次——被我 kill 掉的进程，日志上写着「端口被占用」。
        if (/EADDRINUSE|address already in use/i.test(l)) 条.端口冲突 = true;
        process.stdout.write(l.startsWith('[') ? `\x1b[${条.色}m${l}\x1b[0m\n` : 头 + l + '\n');
      }
    });
  };
  接(子.stdout); 接(子.stderr);
}

function 收摊(码) {
  if (收摊中) return;
  收摊中 = true;
  for (const { 子, 条 } of 孩子) {
    if (子.exitCode !== null || 子.signalCode) continue;
    // Windows 上 child.kill() 收不掉孙子进程——执行器起的 AI CLI 就是孙子。
    // 不用 taskkill /T 的话，Ctrl-C 之后 CLI 还在后台跑，还在计费。
    if (process.platform === 'win32') {
      try { spawn('taskkill', ['/PID', String(子.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已经没了 */ }
    } else {
      try { 子.kill('SIGTERM'); } catch { /* 已经没了 */ }
    }
    process.stdout.write(`[开机] 停 ${条.名}\n`);
  }
  setTimeout(() => process.exit(码 || 0), 300);
}

for (const 条 of 名单) {
  const 子 = spawn(process.execPath, [条.脚本], {
    cwd: 平台根,
    // ELECTRON_RUN_AS_NODE：桌面壳里 process.execPath 是 electron.exe，
    // 不带这个变量它会当成一个 app 去开窗口，而不是跑脚本。命令行下这变量无害。
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  转发输出(子, 条);
  孩子.push({ 子, 条 });

  子.on('exit', (码, 信号) => {
    if (收摊中) return;
    // 一个死了就全停，不留半拉产品。
    // 「server 还在但执行器已经死了」是最难受的状态：界面照常开，派活按钮照常点，
    // 点了没反应也没报错——正是本仓一直在防的那种安静的失败。
    process.stdout.write(
      `\n[开机] ${条.名} 退出（码 ${码}${信号 ? ' 信号 ' + 信号 : ''}）。`
      + `半个产品比全停更难查，故一并停掉。\n`
      + (条.端口冲突 ? `[开机] ${条.口} 端口已被占用：多半是上一次没关干净，或者你另开了一份。\n`
        + `[开机] 查是谁占着：netstat -ano | findstr :${条.口}\n` : ''));
    收摊(码 || 1);
  });
  子.on('error', (e) => {
    process.stdout.write(`[开机] ${条.名} 起不来：${e.message}\n`);
    收摊(1);
  });
}

process.stdout.write(
  `[开机] 起了 ${名单.length} 个进程：${名单.map((x) => `${x.名}:${x.口}`).join('  ')}\n`
  + (无执行器 ? '[开机] PLATFORM_NO_EXECUTOR=1，执行器没起——只能干跑。\n' : '')
  + '[开机] 界面 → http://127.0.0.1:4370 　停止 → Ctrl-C\n');

for (const 信号 of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(信号, () => 收摊(0));
process.on('exit', () => { for (const { 子 } of 孩子) { try { 子.kill(); } catch { /* 收尾尽力而为 */ } } });
