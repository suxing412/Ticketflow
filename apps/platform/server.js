// server.js — AI-DevPlatform 交钥匙壳 · 最小 HTTP 服务（施工令-025 出厂）
//
// 端口 4370（避开监制台 4270 与其心跳探测）。零第三方依赖，node 内置模块 only。
//
// 边界（出厂即锁定的形状，往后怎么长由本仓主人定）：
//   - 不含任何工单/职能/派发语义；
//   - 执行器接线只到「providers 注册表可枚举 + echo 级测试调用（桩模式）」为止；
//   - 桩模式是物理性的：本文件不引入 child_process，任何路径都发不起真实 CLI 进程，零计费。
//
// 2026-08-10 接线：lib/ 下六个模块此前一个都没接到接口上（写好了、测过了，但没有任何
// 代码路径走得到）。本轮接了其中四个——判据是**不破坏上面那条物理保证**：
//   routing/router + routing/history + toolchain + review-opinion   零 child_process，已接
//   orchestration/plan                                              纯计算那半已接（store 改注入）
//   workspace/worktree   引 child_process，**不进本文件的依赖闭包**——它住独立进程
//                        scripts/工作区服务.js，本文件只用 http 转发过去。
//   执行加固 / 派单 / 调度 / 巡检 / 质检   同理**隔离**进 scripts/执行器.js。它们自身是纯计算，
//                        但只服务于「拉起 AI CLI」那条链，跟着能力走比跟着纯度走更清楚：
//                        谁要用它们，谁就得先有那个能力面。本文件只转发 /api/exec/*。
// 全部台账见 docs/接线说明.md 第四、六、八节。
//
// providers 消费走仓根 packages/providers（@papercrew/providers），
// 换布局时用环境变量 TICKETFLOW_PACKAGES 指向 packages/。
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const 仓根 = __dirname;
// 公用件解析统一走 lib/公用件（一仓拓扑）。此处曾自抄一份「往上找兄弟仓 Ticketflow」的
// 算法，一仓合并后解析成 <仓根>/apps/Ticketflow 而失效——同一个约定不留第二份。
const 公用件 = require('./lib/公用件');

// 本仓自有模块。四个都是纯计算或只读文件，不起进程——桩模式的物理保证不受影响，
// 契约测试里有一条断言盯着这件事（见 test/接线契约.test.js）。
const 路由器 = require('./lib/routing/router');
const 路由历史 = require('./lib/routing/history');
const 工具链 = require('./lib/toolchain');
const 评审意见 = require('./lib/review-opinion');
// plan 只用它纯计算的那半（解析 + 校验）。落盘的 materialize/consume 需要注入工单库，
// platform 目前没有自己的工单库，故不接——不是忘了，见 docs/接线说明.md 第四节。
const 计划 = require('./lib/orchestration/plan');
const 门禁 = require('./lib/门禁');
// 工单库（协-001）：纯 fs+path，落盘是文件操作不需要 git，故住本进程即可。
// 但它让本进程有了往仓外写文件的能力，三条约束见 lib/工单库.js 头部。
const 工单库 = require('./lib/工单库');
const 工单根 = 工单库.解析根目录(仓根);

// ——————————————————————————————————————————————————————————
// 配置
// ——————————————————————————————————————————————————————————
function 读JSON(p, 缺省) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 缺省; }
}
// 危险开关只能从 config/*.local.json 打开——那些文件被 .gitignore 结构性挡住。
// server 侧也要走同一套合并，否则它看到的配置与执行器不一致（比如工作区写开关），
// 两个进程对同一份事实各执一词，是最难查的那类 bug。
const 本地覆盖 = require('./lib/本地覆盖');
const { 配置, 生效的覆盖 } = 本地覆盖.应用(仓根, 读JSON(path.join(仓根, 'config', 'platform.config.json'), {}));
const 包 = 读JSON(path.join(仓根, 'package.json'), {});
const 端口 = Number(process.env.PORT || (配置.server && 配置.server.port) || 4370);
const { 令牌, 文件: 令牌路径, 新建: 令牌新建 } = 门禁.取令牌(仓根);
const 工作区端口 = Number(process.env.WORKSPACE_PORT || (配置.workspace && 配置.workspace.port) || 4371);
const 执行器端口 = Number(process.env.EXECUTOR_PORT || (配置.执行 && 配置.执行.port) || 4372);
// 战绩账本根：必须与执行器写入的那个根一致，否则 rank 读不到执行器写的战绩，闭环断掉。
// 环境变量只为测试隔离——改它必须两边同时改。
const 账本根 = process.env.PLATFORM_JOURNAL || 仓根;
const 平台名 = 配置.名称 || 包.name || 'AI-DevPlatform';
const 版本 = 配置.版本 || 包.version || '0.0.0';

// ——————————————————————————————————————————————————————————
// providers 注册表（一仓：仓根 packages/；TICKETFLOW_PACKAGES 可覆盖）
// ——————————————————————————————————————————————————————————
let registry = null;
let registry错误 = null;
try {
  registry = 公用件.载入('providers', 'registry.js');
} catch (e) {
  registry错误 = String(e.message); // lib/公用件 已给出人话修法与实际解析路径

}

// ——————————————————————————————————————————————————————————
// 瞭望塔读数（只读 watchtower-out/，绝不写）
// ——————————————————————————————————————————————————————————
const 瞭望塔出口 = path.resolve(仓根, (配置.watchtower && 配置.watchtower.outDir) || 'watchtower-out');
const 新鲜阈值毫秒 = Number((配置.watchtower && 配置.watchtower.freshMs) || 45000);
const 未读上限 = Number((配置.watchtower && 配置.watchtower.unreadLimit) || 50);

function 心跳状态() {
  let 原文 = null;
  try { 原文 = fs.readFileSync(path.join(瞭望塔出口, '心跳.txt'), 'utf8').trim(); } catch { /* 未见 */ }
  if (!原文) return { 存在: false, 在岗: false, 说明: '未见心跳戳（守护从未启动或出口目录不对）' };
  const t = new Date(原文);
  if (isNaN(t.getTime())) return { 存在: true, 在岗: false, 时刻: 原文, 说明: '心跳戳不可解析' };
  const 毫秒龄 = Date.now() - t.getTime();
  return { 存在: true, 时刻: 原文, 毫秒龄, 阈值毫秒: 新鲜阈值毫秒, 在岗: 毫秒龄 <= 新鲜阈值毫秒 };
}

function 未读账本() {
  try {
    const 行 = fs.readFileSync(path.join(瞭望塔出口, '未读账本.jsonl'), 'utf8')
      .trim().split(/\r?\n/).filter(Boolean);
    return {
      总数: 行.length,
      条目: 行.slice(-未读上限).map((l) => { try { return JSON.parse(l); } catch { return { 原文: l }; } }),
    };
  } catch { return { 总数: 0, 条目: [] }; }
}

// ——————————————————————————————————————————————————————————
// HTTP 工具
// ——————————————————————————————————————————————————————————
function 发JSON(res, 码, 体) {
  const s = JSON.stringify(体, null, 1);
  res.writeHead(码, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}
function 收体(req, 上限, 完成) {
  let 体 = '';
  req.on('data', (c) => { 体 += c; if (体.length > 上限) { req.destroy(); } });
  req.on('end', () => { try { 完成(体 ? JSON.parse(体) : {}); } catch { 完成(null); } });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const 静态根 = path.join(仓根, 'public');
function 发静态(res, url路径) {
  const 相对 = url路径 === '/' ? 'index.html' : decodeURIComponent(url路径.replace(/^\/+/, ''));
  const 绝对 = path.normalize(path.join(静态根, 相对));
  if (!绝对.startsWith(静态根 + path.sep) && 绝对 !== path.join(静态根, 'index.html')) {
    return 发JSON(res, 403, { ok: false, error: '路径越界' });
  }
  fs.readFile(绝对, (err, buf) => {
    if (err) return 发JSON(res, 404, { ok: false, error: '未找到：' + 相对 });
    const 类型 = MIME[path.extname(绝对).toLowerCase()] || 'application/octet-stream';
    // 首页发出去之前把令牌注进 </head> 前。注入脚本给同源请求自动带上 Authorization
    // 与 JSON 头，于是 public/index.html 里已有的 fetch 调用一行都不用改。
    // 令牌只随首页出门：跨站页面读不到本页内容，拿不到它。
    if (绝对 === path.join(静态根, 'index.html')) {
      const 注入 = String(buf).replace('</head>', 门禁.注入脚本(令牌) + '\n</head>');
      res.writeHead(200, { 'Content-Type': 类型 });
      return res.end(注入);
    }
    res.writeHead(200, { 'Content-Type': 类型 });
    res.end(buf);
  });
}

// ——————————————————————————————————————————————————————————
// 路由
// ——————————————————————————————————————————————————————————
const 服务 = http.createServer((req, res) => {
  // 原先只 split('?')[0] 把查询串整个丢掉。新接的几条要读 role/kind/limit，故正经解析一次。
  // 基底 URL 只为让 WHATWG URL 肯收相对路径，不参与任何判断。
  const 请求URL = new URL(req.url || '/', 'http://127.0.0.1');
  const url路径 = 请求URL.pathname;
  const 查询 = 请求URL.searchParams;

  // 门禁在路由之前。放在之后的话，未知路径的 404 会泄露「哪些接口存在」——
  // 未授权者不该有能力区分「这条接口不存在」和「这条接口存在但你进不来」。
  if (url路径.startsWith('/api/')) {
    const 拒 = 门禁.校验(req, { 令牌, 端口, 路径: url路径 });
    if (拒) return 发JSON(res, 拒.码, { ok: false, error: 拒.错误 });
  }

  if (url路径 === '/api/health') {
    return 发JSON(res, 200, {
      ok: true, 平台: 平台名, 版本, 端口,
      时刻: new Date().toISOString(),
      桩模式: true,
      公用件: 公用件.PACKAGES,
    });
  }

  if (url路径 === '/api/watchtower') {
    const 心跳 = 心跳状态();
    return 发JSON(res, 200, {
      ok: true,
      心跳,
      未读: 未读账本(),
      出口: 瞭望塔出口,
      ...(心跳.在岗 ? {} : { 拉起命令: 'npm run watchtower（前台）或 npm run watchtower:install 装登录自启' }),
    });
  }

  if (url路径 === '/api/providers' && req.method === 'GET') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: registry错误 });
    try {
      const providers = registry.list(配置).map((p) => ({
        名称: p.name, adapter: p.adapter,
        启用: p.enabled !== false,
        roles: p.roles || [],
        说明: p.说明 || '',
      }));
      return 发JSON(res, 200, { ok: true, 来源: 公用件.解析('providers'), providers });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  if (url路径 === '/api/providers/echo' && req.method === 'POST') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: registry错误 });
    return 收体(req, 64 * 1024, (体) => {
      if (!体 || !体.provider) return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "provider": "<名称>", "model"?, "prompt"? }' });
      try {
        const adapter = registry.create(配置, String(体.provider));
        const 调用 = adapter.buildInvocation({ model: 体.model ? String(体.model) : undefined });
        return 发JSON(res, 200, {
          ok: true, 桩: true,
          provider: adapter.name, adapter: adapter.adapter,
          调用,                                  // 组装出的进程调用（证明适配层接线通）
          回声: String(体.prompt || 'echo'),      // 桩回声：原样弹回
          说明: '桩模式：仅经 @papercrew/providers 组装调用参数，未落任何进程，零真实 CLI 调用零计费。',
        });
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }
    });
  }

  // ——— 动态路由：按角色给 Provider 排名 ———
  // 只算不派。返回每个候选的分数与理由，理由是给人看的——排名不透明就没人敢信它。
  if (url路径 === '/api/routing/rank' && req.method === 'GET') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: registry错误 });
    try {
      const 角色 = 查询.get('role') || 查询.get('角色') || '';
      const 类别 = 查询.get('kind') || 查询.get('类别') || '执行';
      const 排名 = 路由器.rankProviders(账本根, 配置, { role: 角色, kind: 类别 });
      // 全平局要**说出来**。否则调用方会把「按字母序排第一」误当成「评估下来最优」，
      // 那比没有排名更危险——它看起来像个判断，实际上一点信号都没有。
      const 无区分度 = 排名.length > 1 && 排名.every((r) => r.score === 排名[0].score);
      return 发JSON(res, 200, {
        ok: true,
        角色: 排名[0] ? 排名[0].role : (角色 || (类别 === '执行' ? 'generalist' : 'reviewer')),
        类别,
        选中: 排名[0] ? 排名[0].name : null,
        有区分度: !无区分度,
        排名: 排名.map((r) => ({ 名称: r.name, 分数: r.score, 理由: r.reasons })),
        说明: !排名.length ? '无候选：检查 providers 是否启用、能力是否匹配'
          : 无区分度 ? '本次排名无区分度：各候选得分相同，当前顺序仅按名称字母序，不代表评估结论。'
            + '要让排名真正有信号，需其一：providers.<名>.scores 显式打分、'
            + 'routing.roles.<角色>.prefer 声明偏好，或 journal/provider-runs.jsonl 积累实际战绩。'
            : '仅排名，未派发任何任务',
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 路由历史：只读 journal/provider-runs.jsonl ———
  if (url路径 === '/api/routing/history' && req.method === 'GET') {
    try {
      const 上限 = Math.min(Math.max(Number(查询.get('limit')) || 50, 1), 500);
      const 角色 = 查询.get('role') || 查询.get('角色') || '';
      const 记录 = 路由历史.read(账本根, 上限);
      const 汇总 = {};
      if (角色 && registry) {
        for (const p of registry.list(配置)) 汇总[p.name] = 路由历史.summary(账本根, p.name, 角色);
      }
      return 发JSON(res, 200, {
        ok: true,
        账本: 路由历史.historyPath(账本根),
        条数: 记录.length,
        ...(角色 ? { 角色, 汇总 } : {}),
        记录,
        ...(记录.length ? {} : { 说明: '尚无执行记录——桩模式不写账，真实派发接线后才会有内容' }),
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 工具链探测：只查文件是否存在，不安装、不下载 ———
  if (url路径 === '/api/toolchain' && req.method === 'GET') {
    try {
      const found = 工具链.resolve(仓根, 配置);
      return 发JSON(res, 200, {
        ok: true,
        就位: found.ok,
        目录: found.dir, node: found.node, npm: found.npm, npx: found.npx,
        候选路径: 工具链.candidates(仓根, 配置),
        注入指引: 工具链.guidance(仓根, 配置),
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 评审报告归一：纯文本进、结构化字段出 ———
  // 无状态、不落盘。各家 Provider 的 Markdown 格式不一，UI 不该自己去猜。
  if (url路径 === '/api/review/parse' && req.method === 'POST') {
    return 收体(req, 256 * 1024, (体) => {
      if (!体 || typeof 体.文本 !== 'string') {
        return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "文本": "<评审报告 Markdown>", "通过"?: true|false }' });
      }
      try {
        return 发JSON(res, 200, { ok: true, ...评审意见.parse(体.文本, 体.通过) });
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }
    });
  }

  // ——— 计划校验：Orchestrator 的自然语言输出 → 结构化 DAG ———
  // 只解析与校验，**不落盘**。落盘要注入工单库，platform 还没有自己的那一套。
  // 这条的价值在于：AI 提的计划先过确定性内核，角色/依赖/数量/写区不合规当场打回。
  if (url路径 === '/api/plan/validate' && req.method === 'POST') {
    return 收体(req, 512 * 1024, (体) => {
      if (!体 || typeof 体.输出 !== 'string') {
        return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "输出": "<Orchestrator 的回复原文>" }' });
      }
      try {
        const { plan, source } = 计划.resolvePlan(配置, 体.输出, undefined);
        return 发JSON(res, 200, {
          ok: true, 合规: true, 来源: source,
          摘要: plan.summary || '',
          任务数: plan.tasks.length,
          任务: plan.tasks.map((t) => ({
            key: t.key, 标题: t.title, 角色: t.role,
            依赖: t.dependsOn, 验收: t.acceptance, 写区: t.writeScope,
          })),
          说明: '仅校验，未落盘——物化子工单需要注入工单库，platform 尚无自有工单库',
        });
      } catch (e) {
        // 校验不通过是**正常业务结果**，不是服务故障，所以是 200 + 合规:false。
        return 发JSON(res, 200, { ok: true, 合规: false, 原因: e.message });
      }
    });
  }

  // ——— 工单库（协-001）———
  // 未配置根目录时一律 503 + 人话修法。**不猜路径不兜底**：猜一个位置往里写业务数据，
  // 等发现写错地方时数据已经散在两处了，比直接报错严重得多。
  if (url路径 === '/api/tickets' || url路径.startsWith('/api/tickets/')) {
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    const 根 = 工单根.根;

    if (url路径 === '/api/tickets' && req.method === 'GET') {
      try {
        const 状态 = 查询.get('state') || 查询.get('状态') || '';
        if (状态 && !工单库.STATES.includes(状态)) {
          return 发JSON(res, 400, { ok: false, error: `未知状态：${状态}（合法：${工单库.STATES.join('/')}）` });
        }
        const 单 = 工单库.list(根, 状态);
        return 发JSON(res, 200, { ok: true, 根目录: 根, 来源: 工单根.来源, 条数: 单.length, 工单: 单 });
      } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
    }

    if (url路径 === '/api/tickets' && req.method === 'POST') {
      return 收体(req, 256 * 1024, (体) => {
        if (!体 || !体.id) return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "id": "<编号>", "fm"?: {}, "正文"?: "" }' });
        try {
          const r = 工单库.create(根, String(体.id), 体.fm || {}, 体.正文 || '');
          return 发JSON(res, r.ok ? 201 : 400, r.ok ? { ok: true, ...r } : { ok: false, error: r.error });
        } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
      });
    }

    const 迁移 = url路径.match(/^\/api\/tickets\/([^/]+)\/move$/);
    if (迁移 && req.method === 'POST') {
      const id = decodeURIComponent(迁移[1]);
      return 收体(req, 64 * 1024, (体) => {
        if (!体 || !体.到) return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "到": "<目标状态>" }' });
        try {
          const 当前 = 工单库.find(根, id);
          if (!当前) return 发JSON(res, 404, { ok: false, error: `工单不存在：${id}` });
          const r = 工单库.move(根, id, 当前.state, String(体.到));
          return 发JSON(res, r.ok ? 200 : 409, r.ok ? { ok: true, ...r } : { ok: false, error: r.error });
        } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
      });
    }

    const 单张 = url路径.match(/^\/api\/tickets\/([^/]+)$/);
    if (单张 && req.method === 'GET') {
      try {
        const t = 工单库.find(根, decodeURIComponent(单张[1]));
        if (!t) return 发JSON(res, 404, { ok: false, error: `工单不存在：${decodeURIComponent(单张[1])}` });
        return 发JSON(res, 200, { ok: true, id: t.id, 状态: t.state, fm: t.fm, 正文: t.body });
      } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
    }

    return 发JSON(res, 404, { ok: false, error: '未知工单接口：' + url路径 });
  }

  // ——— 计划物化：把 /api/plan/validate 的下半场接上 ———
  // plan.js 的 materialize 要注入工单库，这里把两头接起来。**这是唯一会落盘的计划接口**。
  if (url路径 === '/api/plan/materialize' && req.method === 'POST') {
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    return 收体(req, 512 * 1024, (体) => {
      if (!体 || typeof 体.输出 !== 'string' || !体.父单) {
        return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "输出": "<Orchestrator 回复原文>", "父单": "<父单编号>" }' });
      }
      try {
        const 父 = 工单库.find(工单根.根, String(体.父单));
        if (!父) return 发JSON(res, 404, { ok: false, error: `父单不存在：${体.父单}` });
        工单库.建目录(工单根.根);
        const r = 计划.consume(工单根.根, 配置, { id: 父.id, fm: 父.fm }, 体.输出, { store: 工单库 });
        return 发JSON(res, 200, {
          ok: true, 来源: r.source, 摘要: r.plan.summary || '',
          子单: r.children, 新建: r.created, 更新: r.updated, 保留: r.retained,
          说明: '保留的是已开工或已完成的旧计划子单，重规划不覆盖它们',
        });
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }
    });
  }

  // ——— 执行链：转发给执行器进程，本文件绝不自己拉起 AI CLI ———
  // 与 /api/workspace 同一套路：能起进程的能力住独立进程，这里只用 http。
  // 两个隔离进程各管一种能力（git / AI CLI），可以单独关掉其中任意一个。
  if (url路径.startsWith('/api/exec/')) {
    const 尾 = url路径.slice('/api/exec'.length);
    const 代理 = http.request({
      host: '127.0.0.1', port: 执行器端口, method: req.method,
      path: 尾 + (请求URL.search || ''),
      headers: { Authorization: `Bearer ${令牌}`, 'Content-Type': 'application/json' },
    }, (上游) => {
      let s = '';
      上游.on('data', (d) => s += d);
      上游.on('end', () => {
        try { return 发JSON(res, 上游.statusCode, JSON.parse(s)); }
        catch { return 发JSON(res, 502, { ok: false, error: '执行器返回了非 JSON 内容' }); }
      });
    });
    代理.on('error', () => 发JSON(res, 503, {
      ok: false,
      error: `执行器未在 127.0.0.1:${执行器端口} 应答。它默认不随本服务启动——`
        + '手动拉起：npm run executor。它是唯一被允许拉起 AI CLI 的地方，本服务自己不碰 child_process。',
    }));
    req.pipe(代理);
    return;
  }

  // ——— 工作区：转发给隔离进程，本文件绝不自己起 git ———
  // worktree.js 引 child_process，**读 git 状态也要 spawn**（rev-parse/diff 一样起进程），
  // 所以「只接只读函数」绕不开那条保证。唯一出路是进程隔离：git 能力全住
  // scripts/工作区服务.js，这里只用 http 转发。于是 server.js 的依赖闭包依旧干净，
  // 那条传递闭包断言一个字都不用改。
  if (url路径.startsWith('/api/workspace/')) {
    const 尾 = url路径.slice('/api/workspace'.length);
    const 代理 = http.request({
      host: '127.0.0.1', port: 工作区端口, method: req.method,
      path: 尾 + (请求URL.search || ''),
      headers: { Authorization: `Bearer ${令牌}`, 'Content-Type': 'application/json' },
    }, (上游) => {
      let s = '';
      上游.on('data', (d) => s += d);
      上游.on('end', () => {
        try { return 发JSON(res, 上游.statusCode, JSON.parse(s)); }
        catch { return 发JSON(res, 502, { ok: false, error: '工作区服务返回了非 JSON 内容' }); }
      });
    });
    代理.on('error', () => 发JSON(res, 503, {
      ok: false,
      error: `工作区服务未在 127.0.0.1:${工作区端口} 应答。它默认不随本服务启动——`
        + '手动拉起：npm run workspace。它是唯一被允许起 git 进程的地方，本服务自己不碰 child_process。',
    }));
    代理.end();
    return;
  }

  if (url路径.startsWith('/api/')) return 发JSON(res, 404, { ok: false, error: '未知 API：' + url路径 });
  return 发静态(res, url路径);
});

服务.listen(端口, '127.0.0.1', () => {
  process.stdout.write(`[${平台名}] v${版本} 开机 → http://127.0.0.1:${端口}  （桩模式，零真实 CLI 调用）\n`);
  process.stdout.write(`[${平台名}] 门禁：${令牌新建 ? '已生成新令牌' : '沿用既有令牌'} → ${令牌路径}`
    + `（浏览器打开首页无需手工填；curl 需带 Authorization: Bearer <令牌>；`
    + `/api/health 免令牌，供瞭望塔心跳探测）\n`);
  if (registry错误) process.stderr.write(`[${平台名}] 警告：${registry错误}\n`);
});
