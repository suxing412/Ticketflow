// 工作区服务 —— 唯一被允许起 git 进程的地方。
//
// 为什么要单独一个进程（这是整件事的关键）：
//   lib/workspace/worktree.js 引 child_process。只要 server.js 直接或间接 require 它，
//   「server.js 任何路径都发不起真实进程」这条保证当场作废——**读 git 状态也要 spawn**，
//   rev-parse / diff / ls-files 一样起进程，所谓「只读所以安全」是站不住的。
//
//   所以不能靠"只接只读函数"绕过去，只能靠**进程隔离**：git 能力全部住在本进程，
//   server.js 通过 http 转发过来，它自己从头到尾只用 http 模块。
//   于是 test/接线契约.test.js 里那条传递闭包断言**一个字都不用改**，继续守着 server。
//
// 默认不随 server 启动，要用手动拉：npm run workspace
//
// 写操作（worktree add / add -A / commit / merge）默认**关闭**。
// 打开要在 config/platform.config.json 里显式写 workspace.允许写: true。
// 理由：把 git commit / merge 挂到 HTTP 上是一项独立的授权决定，不该由「服务起来了」
// 顺带获得。默认关着，打开是仓主的动作，日志里也会写明当前是开是关。
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
const 门禁 = require(path.join(平台根, 'lib', '门禁.js'));
const 工作区 = require(path.join(平台根, 'lib', 'workspace', 'worktree.js'));

function 读JSON(p, 缺省) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 缺省; }
}
const 配置 = 读JSON(path.join(平台根, 'config', 'platform.config.json'), {});
const 端口 = Number(process.env.WORKSPACE_PORT || (配置.workspace && 配置.workspace.port) || 4371);
const 允许写 = (配置.workspace && 配置.workspace.允许写) === true;
const { 令牌 } = 门禁.取令牌(平台根);

// 仓根：本服务只允许在这棵树里活动。HTTP 传进来的路径一律先过这一关。
const 仓根 = path.resolve(平台根, '..', '..');

function 发JSON(res, 码, 体) {
  const 文 = JSON.stringify(体, null, 1);
  res.writeHead(码, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(文) });
  res.end(文);
}

// 路径闸：外部传进来的目录必须落在仓根内，且必须真实存在。
// 不做这一关的话，带令牌的调用方可以拿 dir=C:\ 把本机 git 仓库探个遍。
function 收窄路径(输入) {
  const 原始 = String(输入 || '').trim() || 仓根;
  const 绝对 = path.resolve(仓根, 原始);
  const 相对 = path.relative(仓根, 绝对);
  if (相对.startsWith('..') || path.isAbsolute(相对)) {
    return { ok: false, 错误: `路径越界：只允许仓根 ${仓根} 之内，实得 ${绝对}` };
  }
  if (!fs.existsSync(绝对)) return { ok: false, 错误: `路径不存在：${绝对}` };
  return { ok: true, 路径: 绝对 };
}

const 服务 = http.createServer((req, res) => {
  const 请求URL = new URL(req.url || '/', 'http://127.0.0.1');
  const 路径 = 请求URL.pathname;
  const 查询 = 请求URL.searchParams;

  // 与 server.js 同一套门禁、同一个令牌文件。这里没有免令牌例外——
  // 瞭望塔不探本服务，没有非带不可的理由。
  const 拒 = 门禁.校验(req, { 令牌, 端口, 路径: '/api/工作区' });
  if (拒) return 发JSON(res, 拒.码, { ok: false, error: 拒.错误 });

  if (路径 === '/health') {
    return 发JSON(res, 200, { ok: true, 服务: '工作区', 端口, 仓根, 允许写, 说明: '本进程是唯一被允许起 git 进程的地方' });
  }

  // ——— 只读三条 ———
  if (路径 === '/repo' && req.method === 'GET') {
    const 闸 = 收窄路径(查询.get('dir'));
    if (!闸.ok) return 发JSON(res, 400, { ok: false, error: 闸.错误 });
    try {
      const 是仓 = 工作区.isGitRepo(闸.路径);
      return 发JSON(res, 200, { ok: true, 目录: 闸.路径, 是Git仓: 是仓, 仓顶: 是仓 ? 工作区.repoTop(闸.路径) : null });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  if (路径 === '/worktrees' && req.method === 'GET') {
    const 闸 = 收窄路径(查询.get('repository'));
    if (!闸.ok) return 发JSON(res, 400, { ok: false, error: 闸.错误 });
    try {
      const 表 = 工作区.worktreeList(闸.路径);
      return 发JSON(res, 200, { ok: true, 仓库: 闸.路径, 条数: 表.length, worktrees: 表 });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  if (路径 === '/changes' && req.method === 'GET') {
    const 闸 = 收窄路径(查询.get('dir'));
    if (!闸.ok) return 发JSON(res, 400, { ok: false, error: 闸.错误 });
    try {
      const 文件 = 工作区.changedFiles(闸.路径);
      return 发JSON(res, 200, { ok: true, 目录: 闸.路径, 条数: 文件.length, 变更: 文件 });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 写操作 ———
  // 代码不在这里实现。默认关闭时连路由都不注册，开启时也只回一个明确的「未实现」，
  // 而不是留一条半通的路。要接哪一个写操作，得单独决定单独做——
  // 「服务起来了顺带就能 commit」正是要避免的事。
  if (路径.startsWith('/write/')) {
    if (!允许写) {
      return 发JSON(res, 403, {
        ok: false,
        error: '写操作未启用。要开需在 config/platform.config.json 写 workspace.允许写: true，'
          + '并明白这意味着带令牌的调用方可以在本仓建分支、提交、合并。',
      });
    }
    return 发JSON(res, 501, {
      ok: false,
      error: '写操作尚未实现。允许写已开启，但具体哪个写操作要暴露、以什么形状暴露，'
        + '是逐个决定的事，不随开关一起获得。',
    });
  }

  return 发JSON(res, 404, { ok: false, error: '未知路径：' + 路径 });
});

服务.listen(端口, '127.0.0.1', () => {
  process.stdout.write(`[工作区服务] 上岗 → http://127.0.0.1:${端口}  仓根 ${仓根}\n`);
  process.stdout.write(`[工作区服务] 写操作：${允许写 ? '**已启用**（可建分支/提交/合并）' : '关闭（默认）'}\n`);
});
