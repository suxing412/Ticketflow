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
//   workspace/worktree                                              引 child_process，不接
//   orchestration/plan                                              跨界引 studio 内部模块，不接
// 两处未接的原因写在 docs/接线说明.md，不是遗漏。
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

// ——————————————————————————————————————————————————————————
// 配置
// ——————————————————————————————————————————————————————————
function 读JSON(p, 缺省) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 缺省; }
}
const 配置 = 读JSON(path.join(仓根, 'config', 'platform.config.json'), {});
const 包 = 读JSON(path.join(仓根, 'package.json'), {});
const 端口 = Number(process.env.PORT || (配置.server && 配置.server.port) || 4370);
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(绝对).toLowerCase()] || 'application/octet-stream' });
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
      const 排名 = 路由器.rankProviders(仓根, 配置, { role: 角色, kind: 类别 });
      return 发JSON(res, 200, {
        ok: true,
        角色: 排名[0] ? 排名[0].role : (角色 || (类别 === '执行' ? 'generalist' : 'reviewer')),
        类别,
        选中: 排名[0] ? 排名[0].name : null,
        排名: 排名.map((r) => ({ 名称: r.name, 分数: r.score, 理由: r.reasons })),
        说明: 排名.length ? '仅排名，未派发任何任务' : '无候选：检查 providers 是否启用、能力是否匹配',
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 路由历史：只读 journal/provider-runs.jsonl ———
  if (url路径 === '/api/routing/history' && req.method === 'GET') {
    try {
      const 上限 = Math.min(Math.max(Number(查询.get('limit')) || 50, 1), 500);
      const 角色 = 查询.get('role') || 查询.get('角色') || '';
      const 记录 = 路由历史.read(仓根, 上限);
      const 汇总 = {};
      if (角色 && registry) {
        for (const p of registry.list(配置)) 汇总[p.name] = 路由历史.summary(仓根, p.name, 角色);
      }
      return 发JSON(res, 200, {
        ok: true,
        账本: 路由历史.historyPath(仓根),
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

  if (url路径.startsWith('/api/')) return 发JSON(res, 404, { ok: false, error: '未知 API：' + url路径 });
  return 发静态(res, url路径);
});

服务.listen(端口, '127.0.0.1', () => {
  process.stdout.write(`[${平台名}] v${版本} 开机 → http://127.0.0.1:${端口}  （桩模式，零真实 CLI 调用）\n`);
  if (registry错误) process.stderr.write(`[${平台名}] 警告：${registry错误}\n`);
});
