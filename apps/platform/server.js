// server.js — AI-DevPlatform 交钥匙壳 · 最小 HTTP 服务（施工令-025 出厂）
//
// 端口 4370（避开监制台 4270 与其心跳探测）。零第三方依赖，node 内置模块 only。
//
// 边界（出厂即锁定的形状，往后怎么长由本仓主人定）：
//   - 不含任何工单/职能/派发语义；
//   - 执行器接线只到「providers 注册表可枚举 + echo 级测试调用（桩模式）」为止；
//   - 桩模式是物理性的：本文件不引入 child_process，任何路径都发不起真实 CLI 进程，零计费。
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
  const url路径 = (req.url || '/').split('?')[0];

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

  if (url路径.startsWith('/api/')) return 发JSON(res, 404, { ok: false, error: '未知 API：' + url路径 });
  return 发静态(res, url路径);
});

服务.listen(端口, '127.0.0.1', () => {
  process.stdout.write(`[${平台名}] v${版本} 开机 → http://127.0.0.1:${端口}  （桩模式，零真实 CLI 调用）\n`);
  if (registry错误) process.stderr.write(`[${平台名}] 警告：${registry错误}\n`);
});
