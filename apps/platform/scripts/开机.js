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
// ⚠ 自动拉起执行器**不等于**放开花钱。真跑仍然要同时过四闸：
// 请求体 {"干跑": false} + config/执行.local.json 的 允许真跑 + 预算.池 里有上限。
// 执行器进程活着只是「随时能干活」，不是「已经在花钱」。
// 真不想让它活着：设 PLATFORM_NO_EXECUTOR=1。
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const 平台根 = path.resolve(__dirname, '..');
// 与 server / 执行器 用同一个账本根，否则守护写的呼叫落在另一个信箱里，界面上看不见。
const 账本根 = process.env.PLATFORM_JOURNAL || 平台根;


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

  // ——— 先礼后兵（协-019）———
  //
  // 原先直接 taskkill /F。那条对孙子进程是必要的，但它有个后果：
  // **子进程的停机处理一次都不会跑**。而 Windows 上换成 child.kill('SIGTERM') 也没用——
  // node 在 Windows 上把 SIGTERM/SIGINT 映射成无条件终止，`process.on('SIGTERM')` 收不到。
  // 于是执行器「把在跑的工单盖章标记中断」那段代码在 Windows 上永远不会执行，
  // 而它恰恰是本单要解决的问题之一。
  //
  // 所以走 **IPC**：spawn 时开了 ipc 通道，这里先送一条「停机」，给它一点时间自己收拾，
  // 再落 taskkill /T /F 兜底（孙子进程还是得靠它，AI CLI 就是孙子，不杀还在计费）。
  const 宽限毫秒 = 2500;
  for (const { 子, 条 } of 孩子) {
    if (子.exitCode !== null || 子.signalCode) continue;
    try { if (子.connected) 子.send({ 停机: '监工收摊' }); } catch { /* 通道没了就直接硬杀 */ }
    process.stdout.write(`[开机] 请 ${条.名} 收工（${宽限毫秒 / 1000}s 宽限）\n`);
  }
  const 硬杀 = () => {
    for (const { 子, 条 } of 孩子) {
      if (子.exitCode !== null || 子.signalCode) continue;
      // Windows 上 child.kill() 收不掉孙子进程——执行器起的 AI CLI 就是孙子。
      // 不用 taskkill /T 的话，Ctrl-C 之后 CLI 还在后台跑，还在计费。
      if (process.platform === 'win32') {
        try { spawn('taskkill', ['/PID', String(子.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* 已经没了 */ }
      } else {
        try { 子.kill('SIGKILL'); } catch { /* 已经没了 */ }
      }
      process.stdout.write(`[开机] 停 ${条.名}（宽限到了，硬杀）\n`);
    }
    setTimeout(() => process.exit(码 || 0), 300);
  };
  // 都自己走完了就不必等满宽限——正常停机应当是干脆的。
  const 轮询 = setInterval(() => {
    if (孩子.every(({ 子 }) => 子.exitCode !== null || 子.signalCode)) { clearInterval(轮询); 硬杀(); }
  }, 100);
  setTimeout(() => { clearInterval(轮询); 硬杀(); }, 宽限毫秒).unref();
}

// ——— 守护（协-019）———
//
// 原策略是「一个死了就全停」，理由写得很对：半个产品比全停难查——
// 「server 还在但执行器已经死了」时界面照常开、按钮照常点、点了没反应也没报错。
//
// 但那条理由的前提是**有人看着**。无人值守时它的意思变成了：凌晨三点执行器崩一次，
// 整台机器停到早上。于是改成：崩了就按退避重起，并且**每一次重起都进呼叫信箱**——
// 自愈不等于装作没事发生，那会把「天天崩一次」藏成「一切正常」。
//
// 熔断：短窗内连崩 N 次仍不活，说明这不是偶发（多半是配置坏了或端口被占），
// 再重起就是死循环。这时候才回到老策略：全停 + 一条急报，说清为什么不再试。
const 退避表 = [1000, 2000, 5000, 10000, 30000];     // 第 n 次重起等多久
const 熔断窗毫秒 = 5 * 60 * 1000;                    // 5 分钟内
const 熔断次数 = 5;                                  // 连崩 5 次就不再重起

function 呼叫发(级别, 类型, 摘要, extra) {
  // 守护自己也要能发信——它是**唯一**知道「子进程崩了」的那一方。
  // 引 lib/呼叫 不破坏任何隔离：本文件本来就是持有 child_process 的监工进程。
  try { require(path.join(平台根, 'lib', '呼叫.js')).发(账本根, 级别, 类型, 摘要, extra); }
  catch (e) { process.stdout.write(`[开机] 呼叫写不进去（${e.message}）\n`); }
}

function 退出处置(条, 码, 信号) {
  if (收摊中) return;
  const 现在 = Date.now();
  条.崩史 = (条.崩史 || []).filter((t) => 现在 - t < 熔断窗毫秒);
  条.崩史.push(现在);
  const 次 = 条.崩史.length;
  const 尾 = 条.端口冲突
    ? `${条.口} 端口已被占用：多半是上一次没关干净，或者你另开了一份。`
      + `查是谁占着：netstat -ano | findstr :${条.口}`
    : '';

  if (次 >= 熔断次数) {
    process.stdout.write(
      `\n[开机] ${条.名} 在 ${Math.round(熔断窗毫秒 / 60000)} 分钟内崩了 ${次} 次，不再重起（熔断）。`
      + `半个产品比全停更难查，故一并停掉。\n` + (尾 ? `[开机] ${尾}\n` : ''));
    呼叫发('急', '守护熔断',
      `${条.名} 在 ${Math.round(熔断窗毫秒 / 60000)} 分钟内崩了 ${次} 次（最后一次码 ${码}${信号 ? ' 信号 ' + 信号 : ''}）。`
      + `已停止重起并把整台停掉——反复重起只会是死循环。${尾}`, { 指纹: `熔断|${条.名}`, 静默秒: 0 });
    return 收摊(码 || 1);
  }

  const 等 = 退避表[Math.min(次 - 1, 退避表.length - 1)];
  process.stdout.write(
    `\n[开机] ${条.名} 退出（码 ${码}${信号 ? ' 信号 ' + 信号 : ''}），${等 / 1000}s 后重起（本窗第 ${次} 次）。\n`
    + (尾 ? `[开机] ${尾}\n` : ''));
  // 重起**必须留痕**：不留的话，一个每小时崩一次的产品看起来和一个健康的产品一模一样。
  呼叫发(次 === 1 ? '常' : '急', '进程重启',
    `${条.名} 退出（码 ${码}${信号 ? ' 信号 ' + 信号 : ''}），守护将在 ${等 / 1000}s 后重起它。`
    + `本窗（${Math.round(熔断窗毫秒 / 60000)} 分钟）内第 ${次} 次。${尾}`,
    { 指纹: `重启|${条.名}|${次}`, 静默秒: 0 });
  条.端口冲突 = false;
  const 计时 = setTimeout(() => { if (!收摊中) 起(条); }, 等);
  if (计时.unref) 计时.unref();
}

function 起(条) {
  const 子 = spawn(process.execPath, [条.脚本], {
    // ⚠ 这里**不传 cwd**，是踩出来的。
    // 打包成 asar 后 平台根 落在 resources\app.asar 里，那是个文件；拿它当 cwd，
    // spawn 直接 ENOENT——而且 Windows 把错误挂在可执行文件名上，报
    // 「spawn AI-DevPlatform.exe ENOENT」，看着像 exe 自己没了，完全指不到真原因。
    //
    // 第一版想用 statSync().isDirectory() 挡一道，没用：**electron 给 fs 打了补丁，
    // asar 内部路径在 statSync 眼里就是个正经目录**，守卫返回 true 照样传下去。
    // 判断「这路径能不能当 cwd」在 electron 里问 fs 是问错了对象。
    // 三个子进程都从 __dirname 算自己的路径，本来就不依赖 cwd，索性不传。
    // ELECTRON_RUN_AS_NODE：桌面壳里 process.execPath 是 electron.exe，
    // 不带这个变量它会当成一个 app 去开窗口，而不是跑脚本。命令行下这变量无害。
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    // 第四条 'ipc'：收摊时用它请子进程自己收工（Windows 上信号是无条件终止，
    // process.on('SIGTERM') 根本收不到，见 收摊() 里那段）。
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  转发输出(子, 条);
  // 同一条只留最新的那个句柄：重起之后 孩子[] 里若还留着旧的，
  // 收摊时会去 taskkill 一个早就不存在的 pid——而那个 pid 可能已经被系统分给别人了。
  const 位 = 孩子.findIndex((x) => x.条 === 条);
  if (位 >= 0) 孩子[位] = { 子, 条 }; else 孩子.push({ 子, 条 });

  子.on('exit', (码, 信号) => 退出处置(条, 码, 信号));
  子.on('error', (e) => {
    process.stdout.write(`[开机] ${条.名} 起不来：${e.message}\n`);
    退出处置(条, 1, null);
  });
}

for (const 条 of 名单) 起(条);

process.stdout.write(
  `[开机] 起了 ${名单.length} 个进程：${名单.map((x) => `${x.名}:${x.口}`).join('  ')}\n`
  + (无执行器 ? '[开机] PLATFORM_NO_EXECUTOR=1，执行器没起——只能干跑。\n' : '')
  + '[开机] 界面 → http://127.0.0.1:4370 　停止 → Ctrl-C\n');

for (const 信号 of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(信号, () => 收摊(0));
// 监工自己也收 IPC 停机。两个用处：被别的东西托管时（计划任务、测试夹具）能请它体面地走；
// 以及 Windows 上 process.kill(pid,'SIGINT') 是无条件终止（只有真的在控制台按 Ctrl-C 才走 handler），
// 没有这条就没法在测试里验证「停机时在跑的单有没有被盖章」。
process.on('message', (m) => { if (m && m.停机) { process.stdout.write(`[开机] 收到停机请求（${m.停机}）\n`); 收摊(0); } });
process.on('exit', () => { for (const { 子 } of 孩子) { try { 子.kill(); } catch { /* 收尾尽力而为 */ } } });
