// 「4370 上这份到底是谁」—— 实例身份与端口冲突取证（协-038）。
//
// 起因是同机跑了两份 apps/platform：一份用仓内 config/，另一份用
//   PLATFORM_CONFIG=…\output\platform-concurrency-qa-20260828
// 后者先起占住 4370，前者反复 EADDRINUSE、5 分钟连崩 5 次触发熔断，整台起不来。
// 而人在界面上什么都看不出来——界面就在 4370 上，打开它看到的是**另一份**。
//
// 当时的取证代价：curl /api/health 通、`ok: true`（看着一切正常）→ 拿仓内
// config/api-token.txt 调任何要令牌的接口 401（对方有它自己的令牌）→ netstat 找 pid
// → Get-CimInstance 读命令行，才看见对方的 PLATFORM_CONFIG。三步十几分钟。
//
// 一个 `ok: true` 却属于另一份实例的健康检查，是最坏的一类假信号。所以：
//   ① 健康检查**自报身份**：pid、启动时间、配置目录和它的来源；
//   ② 撞端口时先探一下对方的健康检查，把「占着 4370 的是谁」直接印出来，
//      而不是让人自己去 netstat。
//
// 注意 PLATFORM_CONFIG 换掉的只是**配置目录**，端口仍从 platform.config.json 读。
// 它给的错觉是「换个配置目录就能并行跑一份」——实际上两份必抢同三个端口。
// 这个错觉本身也在这里拆掉：非默认配置目录时开机横幅明说「端口照旧，互斥」。
'use strict';
const path = require('path');
const http = require('http');
const 配置位置 = require('./配置位置.js');

// 进程活了多久要有个起点。用模块首次被 require 的时刻——三个进程都在开机阶段引它，
// 差几毫秒，而这个字段是给人看「这份是什么时候起来的」，不是给人算性能的。
const 启动于 = new Date().toISOString();

function 配置来源(平台根) {
  const 指定 = String(process.env.PLATFORM_CONFIG || '').trim();
  const 目录 = 配置位置.可写配置目录(平台根);
  const 默认目录 = path.join(平台根, 'config');
  return {
    目录,
    来源: 指定 ? 'PLATFORM_CONFIG' : (配置位置.在包内(平台根) ? 'exe 同级 config/' : '仓内 config/'),
    是默认: path.resolve(目录) === path.resolve(默认目录),
  };
}

// 摊进健康检查响应的那几个字段。名字都用中文键，与既有健康检查一致。
function 身份(平台根, 进程名) {
  const c = 配置来源(平台根);
  return { 进程: 进程名, pid: process.pid, 启动于, 配置目录: c.目录, 配置来源: c.来源 };
}

// 非默认配置目录时该说的那句话。返回 null 表示没什么可说的（默认目录）。
function 横幅(平台根, 端口表) {
  const c = 配置来源(平台根);
  if (c.是默认) return null;
  const 口 = Object.entries(端口表 || {}).map(([k, v]) => `${k} ${v}`).join(' / ');
  return `本实例用的是非默认配置目录（${c.来源}）：${c.目录}\n`
    + `  端口仍按配置解析${口 ? `（${口}）` : ''}，**不随配置目录变**——`
    + '同机的默认实例与本实例互斥，谁先起谁占着。';
}

// 探一探端口上那位是谁。
//
// /api/health 免令牌（瞭望塔要探它），所以 server 一探即知。
// 工作区/执行器的 /health 要令牌，对方用的是它自己那份配置目录里的令牌，
// 我们必然 401——但 401 本身就是答案的一半：「有人在，且不认我这份令牌」。
function 探(端口, { 超时毫秒 = 1500 } = {}) {
  const 试 = (路径) => new Promise((定) => {
    const 请 = http.get({ host: '127.0.0.1', port: 端口, path: 路径, timeout: 超时毫秒 }, (上游) => {
      let s = '';
      上游.on('data', (d) => { s += d; if (s.length > 64 * 1024) 请.destroy(); });
      上游.on('end', () => { let 体 = null; try { 体 = JSON.parse(s); } catch { /* 非 JSON：多半根本不是 platform */ } 定({ 码: 上游.statusCode, 体 }); });
    });
    请.on('timeout', () => { 请.destroy(); 定(null); });
    请.on('error', () => 定(null));
  });
  return 试('/api/health').then((r) => (r ? r : 试('/health')));
}

// 把探到的东西说成人话。这段话是本模块存在的理由，值得写全。
function 说占用(端口, 探到) {
  if (!探到) {
    return `${端口} 被占着，但对方不应答 HTTP 健康检查——不像是一份 platform。`
      + `查是谁：netstat -ano | findstr :${端口}`;
  }
  const b = 探到.体 || {};
  if (b.配置目录) {
    return `${端口} 被**另一份 platform** 占着：${b.进程 || b.服务 || 'server'}`
      + ` pid ${b.pid || '?'}，配置目录 ${b.配置目录}（来源 ${b.配置来源 || '?'}）`
      + `，起于 ${b.启动于 || '?'}。\n`
      + `  两份 platform 用同一组端口——PLATFORM_CONFIG 只换配置目录、不换端口。`
      + `先停掉不要的那份再起。`;
  }
  if (探到.码 === 401 || 探到.码 === 403) {
    return `${端口} 上有人应答，但不认本实例的令牌（HTTP ${探到.码}）——`
      + `多半是另一份 platform 的进程，它用的是它自己配置目录里的令牌。`
      + `查是谁：netstat -ano | findstr :${端口}`;
  }
  return `${端口} 上有 HTTP 服务在应答（HTTP ${探到.码}），但它没自报身份，不像本产品的进程。`
    + `查是谁：netstat -ano | findstr :${端口}`;
}

// 给 http 服务装上「撞端口时说清对方是谁」。
//
// 不装的话表现是一段裸的 EADDRINUSE 栈：只说「4370 被占」，不说被谁占。
// 而监工看见这段就按退避重起，连崩 5 次熔断把整台停掉——人拿到的最终结论是
// 「产品起不来」，离真因（另一份实例）还差三步取证。
//
// 打印的行里**必须保留 EADDRINUSE 字样**：scripts/开机.js 靠正则认它来判端口冲突
// （退出码分不出来，Windows 上 taskkill 杀掉的和端口占用退出的都是 1）。
function 装端口冲突(服务, { 名, 端口 }) {
  服务.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      process.stderr.write(`[${名}] EADDRINUSE：127.0.0.1:${端口} 起不来，正在问问对方是谁…\n`);
      return 探(端口).then((r) => {
        process.stderr.write(`[${名}] ${说占用(端口, r)}\n`);
        process.exit(1);
      });
    }
    process.stderr.write(`[${名}] 监听 ${端口} 失败：${e && e.message}\n`);
    process.exit(1);
  });
}

// 监工没了就别独活（协-038）。
//
// 原先「共存亡」是单向的：监工发现子进程死了就全停。但实测的那次是**反过来**——
// 监工先没了，server 独活，配置目录都被删了它还占着 4370，挡住下一份起不来，
// 最后靠人 Stop-Process 才腾出来。空壳占端口比崩掉更难查。
//
// 只在**有 IPC 通道**时挂（即由监工拉起）。手工 `node server.js` 起的没有 channel，
// 不受影响——那种跑法本来就没有监工可盯。
function 盯监工(名, 停) {
  if (!process.channel) return false;
  process.on('disconnect', () => {
    process.stdout.write(`[${名}] 监工没了（IPC 断开），本进程跟着收工——不留空壳占端口。\n`);
    停('监工断线');
  });
  return true;
}

module.exports = { 配置来源, 身份, 横幅, 探, 说占用, 装端口冲突, 盯监工, 启动于 };
