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
// 2026-08-12 起随 npm start 一并起（scripts/开机.js 带的）。单起：npm run workspace
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
const 本地覆盖 = require(path.join(平台根, 'lib', '本地覆盖.js'));
// 允许写 同样是危险开关，只能从不入库的 config/workspace.local.json 打开。
const { 配置, 生效的覆盖 } = 本地覆盖.应用(平台根, 读JSON(path.join(平台根, 'config', 'platform.config.json'), {}));
// 只有注册表现读。其余配置（端口、允许写）开机定死是对的——那些是这个进程的形状，
// 中途换掉只会让「我现在到底跑在什么设置下」变得说不清。
// 注册表不一样：它由界面写入，而且是写操作白名单，捧着旧表 = 刚登记的项目用不了。
const 现读注册表 = () => {
  const c = 本地覆盖.应用(平台根, 读JSON(path.join(平台根, 'config', 'platform.config.json'), {})).配置;
  return (c.项目 && c.项目.注册) || {};
};
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

function 收体(req, 上限, 完成) {
  let 体 = '';
  req.on('data', (c) => { 体 += c; if (体.length > 上限) req.destroy(); });
  req.on('end', () => { try { 完成(体 ? JSON.parse(体) : {}); } catch { 完成(null); } });
}

const 服务 = http.createServer((req, res) => {
  const 请求URL = new URL(req.url || '/', 'http://127.0.0.1');
  // 解码：本服务的路径带中文（/write/审阅区、/write/收工），
  // 调用方必须编码才发得出去（node 的 http.request 对未转义字符直接抛），
  // 于是这边收到的是 %E5%AE%A1%E9%98%85%E5%8C%BA。不解码就永远匹配不上，
  // 表现为 404「未知路径」——而两边看起来都没错。
  // try：地址栏里手敲的半截百分号会让 decode 抛，那种就按原样匹配（落 404）。
  let 路径 = 请求URL.pathname;
  try { 路径 = decodeURIComponent(路径); } catch { /* 解不开就按原样 */ }
  const 查询 = 请求URL.searchParams;

  // 与 server.js 同一套门禁、同一个令牌文件。这里没有免令牌例外——
  // 瞭望塔不探本服务，没有非带不可的理由。
  const 拒 = 门禁.校验(req, { 令牌, 端口, 路径: '/api/工作区' });
  if (拒) return 发JSON(res, 拒.码, { ok: false, error: 拒.错误 });

  if (路径 === '/health') {
    return 发JSON(res, 200, { ok: true, 服务: '工作区', 端口, 仓根, 允许写, 说明: '本进程是唯一被允许起 git 进程的地方' });
  }

  // ——— 只读几条 ———
  //
  // 定位仓库**优先按注册表的项目名**，路径只是退路。
  //
  // 收窄路径 只放行仓根之内，而登记的项目（靶仓、海投王）全住在仓外——
  // 只认路径的话，这几个只读端点对真实项目从一开始就够不着：
  // 想看「这个项目攒了多少遗留工作区」，传路径被判越界，传不了就看不见。
  // 于是这几个端点写了大半年，一个界面调用方都没有——接上按钮也没用。
  // 注册表本身就是显式白名单，和写操作用的是同一条准绳，不额外放宽任何东西。
  function 解析仓(路径参数名) {
    const 项目名 = String(查询.get('项目') || 查询.get('project') || '').trim();
    if (!项目名) return 收窄路径(查询.get(路径参数名));
    const 注册 = 现读注册表();
    const 项 = 注册[项目名];
    if (!项 || !项.路径) {
      return { ok: false, 错误: `项目「${项目名}」不在注册表里。已登记：${Object.keys(注册).join('/') || '（无）'}` };
    }
    const p = path.resolve(项.路径);
    if (!fs.existsSync(p)) return { ok: false, 错误: `项目路径不存在：${p}` };
    return { ok: true, 路径: p, 项目: 项目名 };
  }

  if (路径 === '/repo' && req.method === 'GET') {
    const 闸 = 解析仓('dir');
    if (!闸.ok) return 发JSON(res, 400, { ok: false, error: 闸.错误 });
    try {
      const 是仓 = 工作区.isGitRepo(闸.路径);
      return 发JSON(res, 200, { ok: true, 目录: 闸.路径, 是Git仓: 是仓, 仓顶: 是仓 ? 工作区.repoTop(闸.路径) : null });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  if (路径 === '/worktrees' && req.method === 'GET') {
    const 闸 = 解析仓('repository');
    if (!闸.ok) return 发JSON(res, 400, { ok: false, error: 闸.错误 });
    try {
      const 表 = 工作区.worktreeList(闸.路径);
      return 发JSON(res, 200, { ok: true, 仓库: 闸.路径, 条数: 表.length, worktrees: 表 });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // 遗留工作区（协-009）：目录还在，但对应的工单已完成或压根不存在。
  // 纯读不动手——「有多少垃圾」得先看得见，收不收是另一回事。
  //
  // 用 POST 而不是 GET：工单表要整份递进来（本进程的能力面是 git，不读工单库），
  // 塞进查询串的话，板子一大就顶爆请求行——node 默认 maxHeaderSize 16KB，
  // 而请求行也算在里头。POST 不代表写，这条一个 git 对象都不改，所以仍在写闸外面。
  if (路径 === '/遗留' && req.method === 'POST') {
    return 收体(req, 1024 * 1024, (体) => {
      if (!体) return 发JSON(res, 400, { ok: false, error: '需要 JSON 体' });
      const 项目名 = String(体.项目 || '').trim();
      const 注册 = 现读注册表();
      const 项 = 注册[项目名];
      if (!项 || !项.路径) {
        return 发JSON(res, 400, { ok: false, error: `项目「${项目名 || '(空)'}」不在注册表里。已登记：${Object.keys(注册).join('/') || '（无）'}` });
      }
      const 仓 = path.resolve(项.路径);
      if (!fs.existsSync(仓)) return 发JSON(res, 400, { ok: false, error: `项目路径不存在：${仓}` });
      try {
        const 出 = 工作区.遗留工作区(平台根, 配置, { path: 仓 }, Array.isArray(体.工单) ? 体.工单 : []);
        return 发JSON(res, 200, {
          ok: true, 项目: 项目名, 仓库: 仓,
          条数: 出.待收.length, 遗留: 出.待收,
          // 不是我们建的那些也报出来，只是不给「收」——人得知道这个仓里还有别人的东西
          别人的: 出.别人的, 别人的条数: 出.别人的.length,
        });
      } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
    });
  }

  if (路径 === '/changes' && req.method === 'GET') {
    const 闸 = 解析仓('dir');
    if (!闸.ok) return 发JSON(res, 400, { ok: false, error: 闸.错误 });
    try {
      // 受管 / 新增 分开报（协-034）：判官篡改检查只认受管改动。
      // 合成一个清单的话，某个项目的 .gitignore 恰好没盖住 dist，
      // 判官跑一次 build 就会被自己判成作弊——而它什么坏事都没干。
      const 分 = 工作区.变更分类(闸.路径);
      const 文件 = [...new Set([...分.受管, ...分.新增])];
      return 发JSON(res, 200, {
        ok: true, 目录: 闸.路径, 条数: 文件.length, 变更: 文件,
        受管: 分.受管, 新增: 分.新增,
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // 「这几个提交进主线了吗」——纯读，给上游销「待集成」戳用。
  // 放在写闸外面：它一个 git 对象都不改，要求开写权限反而会让人为了销个戳去开写。
  if (路径 === '/含有' && req.method === 'GET') {
    const 闸 = 解析仓('repository');
    if (!闸.ok) return 发JSON(res, 400, { ok: false, error: 闸.错误 });
    const 候选 = String(查询.get('提交') || 查询.get('commits') || '').split(',').map((s) => s.trim()).filter(Boolean);
    try {
      return 发JSON(res, 200, { ok: true, 项目: 闸.项目 || null, 含有: 工作区.含有(闸.路径, 候选) });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 写操作（协-003）———
  // 默认关闭。开关是独立的授权决定，不随「服务起来了」顺带获得。
  if (路径.startsWith('/write/')) {
    if (!允许写) {
      return 发JSON(res, 403, {
        ok: false,
        error: '写操作未启用。要开需写 config/workspace.local.json（不入库）的 允许写: true，'
          + '并明白这意味着带令牌的调用方可以在目标项目里建分支、提交、合并。',
      });
    }
    return 收体(req, 256 * 1024, (体) => {
      if (!体) return 发JSON(res, 400, { ok: false, error: '需要 JSON 体' });

      // 项目路径同样过路径闸：写操作能改的仓，必须是显式配置过的，不是请求想指哪就指哪。
      const 项目名 = String(体.项目 || '').trim();
      // 现读注册表，不用开机时那份。人在界面上登记完项目，这个进程还捧着旧表的话，
      // 表现是「刚登记好的项目，一提交就说不在注册表里」——界面上每一处都显示登记成功。
      // 同一类问题在执行器的工单根上踩过一次（协-005），不重蹈。
      const 注册 = 现读注册表();
      const 项 = 注册[项目名];
      if (!项 || !项.路径) {
        return 发JSON(res, 400, {
          ok: false,
          error: `项目「${项目名 || '(空)'}」不在注册表里。写操作只认 项目.注册 中登记过的仓——`
            + `否则带令牌的调用方能让本服务往任意 git 仓里提交。已登记：${Object.keys(注册).join('/') || '（无）'}`,
        });
      }
      const 项目 = { name: 项目名, path: path.resolve(项.路径) };
      if (!fs.existsSync(项目.path)) return 发JSON(res, 400, { ok: false, error: `项目路径不存在：${项目.path}` });

      try {
        if (路径 === '/write/prepare') {
          const 工单 = 体.工单 || {};
          if (!工单.id) return 发JSON(res, 400, { ok: false, error: '需要 工单.id' });
          const 依赖 = Array.isArray(体.依赖) ? 体.依赖 : [];
          const w = 工作区.prepare(平台根, 配置, 工单, 项目, {
            role: 工单.fm && 工单.fm.role,
            dependencies: 依赖,          // integrate 从各自的 fm.workspace.commit 取检查点
          });
          return 发JSON(res, 200, { ok: true, 工作区: w });
        }
        if (路径 === '/write/checkpoint') {
          if (!体.工作区) return 发JSON(res, 400, { ok: false, error: '需要 工作区（prepare 的返回值原样传回）' });
          // 改动了哪些文件，**必须在这一刻取**：提交之后 diff 就空了，
          // 发布并收工之后连工作区目录都没了。质检要看的正是这份清单。
          // 取不到不算失败——检查点本身才是这次请求的主事。
          let 变更文件 = [];
          try { 变更文件 = 工作区.changedFiles(体.工作区.path); } catch { /* 拿不到就空着 */ }
          const r = 工作区.checkpoint(配置, 体.工作区, 体.工单 || {});
          // r 摆在后面：agent 自己提交过的情况下，工作树是干净的，上面那份
          // changedFiles 必然是空的，而 checkpoint 会用「起点..HEAD」算出真名单。
          // 顺序反了就会拿空清单盖掉真清单——质检又要看着「（无文件改动）」判不过。
          return 发JSON(res, 200, { ok: true, 变更文件, ...r });
        }
        if (路径 === '/write/publish') {
          if (!体.工作区) return 发JSON(res, 400, { ok: false, error: '需要 工作区' });
          const r = 工作区.publish(项目, 体.工作区);
          // 发布成功之后顺手收工（协-009）。**发布是收工唯一正当的时机**：
          // 到这一步那些提交已经快进合并进主线了，worktree 和分支再留着就是垃圾。
          // 收不掉不算发布失败——活已经合进去了，那才是这次请求的主事。
          // 所以收工结果单独一个字段，不影响 ok。
          let 收 = null;
          try { 收 = 工作区.收工(项目, 体.工作区); } catch (e) { 收 = { ok: false, 错误: e.message }; }
          return 发JSON(res, 200, { ok: true, ...r, 收工: 收 });
        }
        // 手动收工：给那些没走到发布就停下的单用（人工废弃、判不过放弃、跑挂了）。
        // 不自动做——没发布就意味着那条分支上的提交是这台机器上**唯一的一份**，
        // 该不该扔是人的决定。真要扔，-d 还会再挡一道（未合并的删不掉）。
        // 审阅区：给判官一份只读的代码视图（协-011）。
        // 归在 /write/ 下是因为它要建 worktree（动 git），不是因为判官会写——
        // 判官拿到的是 detached HEAD，没有分支，交付不了任何东西。
        if (路径 === '/write/审阅区') {
          if (!体.工单 || !体.commit) return 发JSON(res, 400, { ok: false, error: '需要 工单 与 commit' });
          // 第六个参数是**被审那张单**：审阅区要按它的 需要依赖 装依赖（协-033）。
          // 判官核的就是这张单的验收标准，要跑的命令跟执行方是同一批。
          const r = 工作区.审阅区(平台根, 配置, 项目, String(体.工单), String(体.commit), 体.单据 || null);
          return 发JSON(res, r.ok ? 200 : 400, r.ok ? { ok: true, ...r } : { ok: false, error: r.错误 });
        }
        if (路径 === '/write/收工') {
          if (!体.工作区 && !体.分支) return 发JSON(res, 400, { ok: false, error: '需要 工作区 或 分支' });
          const r = 工作区.收工(项目, 体.工作区 || {}, { 分支: 体.分支 });
          return 发JSON(res, r.ok ? 200 : 409, r);
        }
        return 发JSON(res, 404, { ok: false, error: '未知写操作：' + 路径 });
      } catch (e) {
        // git 层的失败（冲突、基线前进、写区越界）是**业务结果**，回 409 让调用方能分诊，
        // 不是 500——500 会让人以为服务坏了，实际是工单该重做。
        return 发JSON(res, 409, { ok: false, error: e.message });
      }
    });
  }

  return 发JSON(res, 404, { ok: false, error: '未知路径：' + 路径 });
});

服务.listen(端口, '127.0.0.1', () => {
  process.stdout.write(`[工作区服务] 上岗 → http://127.0.0.1:${端口}  仓根 ${仓根}\n`);
  process.stdout.write(`[工作区服务] ${本地覆盖.摘要(生效的覆盖)}
`);
  process.stdout.write(`[工作区服务] 写操作：${允许写 ? '**已启用**（可建分支/提交/合并）' : '关闭（默认）'}\n`);
});

// 优雅停机（协-019）：本进程没有在跑的活要保全（git 操作都是同步短命的），
// 但**得走**——监工收摊时若它不退，整台停机就得等满宽限再硬杀，Ctrl-C 会变得很钝。
// IPC 是 Windows 上唯一收得到的通道：信号在那儿是无条件终止，handler 根本不执行。
function 收工(因) {
  process.stdout.write(`[工作区服务] 收到 ${因}，停机\n`);
  try { 服务.close(); } catch { /* 已经关了 */ }
  setTimeout(() => process.exit(0), 200).unref();
}
for (const 信号 of ['SIGINT', 'SIGTERM']) process.on(信号, () => 收工(信号));
process.on('message', (m) => { if (m && m.停机) 收工(`IPC:${m.停机}`); });
