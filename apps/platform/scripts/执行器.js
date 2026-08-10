// 执行器 —— 唯一被允许拉起 AI CLI 的地方（协-002）。
//
// 为什么又是一个独立进程（不复用工作区服务）：
//   工作区服务的能力面是 **git**；本进程的能力面是 **拉起任意 AI CLI**。
//   风险量级不同。混在一个进程里，将来想单独关掉其中一个就办不到了。
//   server.js 依旧只用 http 转发，那条传递闭包断言第三次不需要例外。
//
// 三重真跑前置（协-002 拍板 C），缺一即拒：
//   ① 请求体显式 {"干跑": false}          防手滑
//   ② 配置 执行.允许真跑 = true            防「服务起来了就能花钱」
//   ③ 该池在 预算.池 里配了上限            防没有刹车就上路
// 三条各自独立，不互相替代。
//
// 默认不随 server 启动：npm run executor
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const 平台根 = path.resolve(__dirname, '..');
const 门禁 = require(path.join(平台根, 'lib', '门禁.js'));
const 公用件 = require(path.join(平台根, 'lib', '公用件.js'));
const 加固 = require(path.join(平台根, 'lib', '执行加固.js'));
const 派单 = require(path.join(平台根, 'lib', '派单.js'));
const 工单库 = require(path.join(平台根, 'lib', '工单库.js'));
const 路由历史 = require(path.join(平台根, 'lib', 'routing', 'history.js'));

function 读JSON(p, 缺省) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 缺省; }
}
const 本地覆盖 = require(path.join(平台根, 'lib', '本地覆盖.js'));
// 危险开关（允许真跑 / 预算上限）只能从 config/*.local.json 打开——那些文件不入库。
// 入库的 platform.config.json 永远是最严默认，本机放宽是本机的事。
const { 配置, 生效的覆盖 } = 本地覆盖.应用(平台根, 读JSON(path.join(平台根, 'config', 'platform.config.json'), {}));
const 端口 = Number(process.env.EXECUTOR_PORT || (配置.执行 && 配置.执行.port) || 4372);
const 允许真跑 = (配置.执行 && 配置.执行.允许真跑) === true;
const 上限毫秒 = Number((配置.执行 && 配置.执行.超时毫秒) || 900000);
const 静默毫秒 = Number((配置.执行 && 配置.执行.静默毫秒) || 120000);
const { 令牌 } = 门禁.取令牌(平台根);
const 工单根 = 工单库.解析根目录(平台根);

let registry = null;
try { registry = 公用件.载入('providers', 'registry.js'); } catch { /* 下面报 */ }

function 发JSON(res, 码, 体) {
  const 文 = JSON.stringify(体, null, 1);
  res.writeHead(码, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(文) });
  res.end(文);
}

// ——————————————————————————————————————————————————————————
// 真跑三闸
// ——————————————————————————————————————————————————————————
function 真跑许可(池) {
  if (!允许真跑) {
    return { 准: false, 码: 403, 错: '真跑未启用：config/platform.config.json 需写 执行.允许真跑 = true。'
      + '这道闸独立于请求体的「干跑」参数——防的是「服务起来了就能花钱」。' };
  }
  const 上限 = ((配置.预算 && 配置.预算.池) || {})[池];
  if (!上限 || !Object.keys(上限).length) {
    return { 准: false, 码: 403, 错: `池「${池}」没有配预算上限（预算.池.${池}）。没有刹车不许上路——`
      + '这道闸独立于总开关：开了总开关也不代表每个池都有上限。' };
  }
  return { 准: true };
}

// ——————————————————————————————————————————————————————————
// 工作目录：绝不在主工作区跑（施工令决定 3）
// ——————————————————————————————————————————————————————————
// 决定 3 原文：「不给『直接在主工作区跑』这个选项。主工作区全程零改动。」
// 完整的 worktree 隔离（prepare→checkpoint→publish）属协-003，本期未做。
// 但「未做隔离」不等于「可以在主工作区跑」——那是把一条已批准的安全决定悄悄降级。
// 故本期的处置是：**没有隔离目录就拒绝真跑**，而不是退回主工作区。
//
// 隔离目录来源：配置 执行.工作目录（须在仓外），或每次真跑现建一个临时目录。
// 无论哪种，落在仓根之内一律拒——那正是决定 3 要挡的事。
const 仓根 = path.resolve(平台根, '..', '..');

function 取工作目录() {
  const 配的 = String((配置.执行 && 配置.执行.工作目录) || '').trim();
  const 目标 = 配的 ? path.resolve(配的) : fs.mkdtempSync(path.join(require('os').tmpdir(), 'platform-run-'));
  const 相对 = path.relative(仓根, 目标);
  if (!相对.startsWith('..') && !path.isAbsolute(相对)) {
    return {
      ok: false,
      错: `工作目录落在仓根之内（${目标}）。施工令决定 3：不给「直接在主工作区跑」这个选项。`
        + `请把 执行.工作目录 指向仓外，或留空由本进程现建临时目录。`,
    };
  }
  if (!fs.existsSync(目标)) fs.mkdirSync(目标, { recursive: true });
  return { ok: true, 目录: 目标, 临时: !配的 };
}

// codex 的消耗取不到 usage（非 stream-json），必须显式呈报，闷着跑等于账目失真
function 计量提示(池) {
  return 池 === 'codex'
    ? '⚠ 本次消耗**不计入预算账**：codex 非 stream-json 输出，budget.usageOf 取不到 usage（见 packages/budget/README.md）'
    : null;
}

// ——————————————————————————————————————————————————————————
// 真实拉起（唯一 spawn 点）
// ——————————————————————————————————————————————————————————
function 拉起(调用, 提示词, 工作目录, 回调) {
  const 起时 = Date.now();
  let 输出 = ''; let 错出 = ''; let 末次输出时 = 起时; let 已杀 = false;
  const p = spawn(调用.cmd, 调用.args, { cwd: 工作目录, env: { ...process.env, ...(调用.env || {}) } });

  const 计时 = setInterval(() => {
    const 判 = 加固.软超时判定({ 现在: Date.now(), 起时, 末次输出时, 上限毫秒, 静默毫秒 });
    if (判.该杀 && !已杀) {
      已杀 = true;
      try { p.kill(); } catch { /* 已退出 */ }
      clearInterval(计时);
      回调({ 退出码: -1, 输出, 错出, 耗时毫秒: Date.now() - 起时, 验尸: 判.原因, 活尾巴: 加固.活尾巴(输出) });
    }
  }, 5000);

  p.stdout.on('data', (d) => { 输出 += d; 末次输出时 = Date.now(); });
  p.stderr.on('data', (d) => { 错出 += d; 末次输出时 = Date.now(); });
  if (调用.promptMode === 'stdin') { try { p.stdin.write(String(提示词 || '')); p.stdin.end(); } catch { /* 管道已断 */ } }

  p.on('close', (码) => {
    if (已杀) return;
    clearInterval(计时);
    回调({ 退出码: 码, 输出, 错出, 耗时毫秒: Date.now() - 起时, 验尸: null, 活尾巴: null });
  });
  p.on('error', (e) => {
    if (已杀) return;
    clearInterval(计时);
    回调({ 退出码: -2, 输出, 错出: String(e.message), 耗时毫秒: Date.now() - 起时, 验尸: `拉不起来：${e.message}`, 活尾巴: null });
  });
}

// 战绩账本根。默认平台根——必须与 server.js 里 rank/history 读的那个根**一致**，
// 否则写进 A 读的是 B，闭环从一开始就断了。环境变量只为让测试隔离，
// 不是给运行时用的（改了它就得同时改 server 侧，两边必须对齐）。
const 账本根 = process.env.PLATFORM_JOURNAL || 平台根;

// 战绩落账：路由历史的**第一个写入方**。写了它，/api/routing/rank 才第一次有真信号。
//
// 注意 dry 记录**照写但不算数**：history.summary 会把 dry 行过滤掉，
// 所以干跑再多次也不会让 rank 产生区分度——干跑是演练，不是战绩。
// 这条是有意的：如果干跑能刷出信号，那 rank 就成了「谁演练得多谁排前面」。
function 记战绩(条目) {
  try { 路由历史.append(账本根, 条目); } catch { /* 账写不进不该反过来打断执行 */ }
  if (条目.dry) return;                       // 干跑不进预算账——没花钱就别记账
  try {
    const budget = 公用件.载入('budget', 'budget.js');
    const u = budget.usageOf(条目._输出 || '');
    if (u.输入 || u.输出) budget.记(账本根, { 池: 条目.provider, 单: 条目.ticket, ...u });
  } catch { /* budget 缺位不阻断 */ }
}

function 收体(req, 上限, 完成) {
  let 体 = '';
  req.on('data', (c) => { 体 += c; if (体.length > 上限) req.destroy(); });
  req.on('end', () => { try { 完成(体 ? JSON.parse(体) : {}); } catch { 完成(null); } });
}

const 服务 = http.createServer((req, res) => {
  const 请求URL = new URL(req.url || '/', 'http://127.0.0.1');
  const 路径 = 请求URL.pathname;

  const 拒 = 门禁.校验(req, { 令牌, 端口, 路径: '/api/执行器' });
  if (拒) return 发JSON(res, 拒.码, { ok: false, error: 拒.错误 });

  if (路径 === '/health') {
    return 发JSON(res, 200, {
      ok: true, 服务: '执行器', 端口, 允许真跑, 上限毫秒, 静默毫秒,
      工单库: 工单根.ok ? 工单根.根 : null,
      说明: '本进程是唯一被允许拉起 AI CLI 的地方；干跑默认开启',
    });
  }

  // 派活 + 执行。干跑默认，三闸齐备才真跑。
  const m = 路径.match(/^\/run\/([^/]+)$/);
  if (m && req.method === 'POST') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: 'providers 注册表加载失败' });
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    const id = decodeURIComponent(m[1]);

    return 收体(req, 256 * 1024, (体) => {
      const 干跑 = !(体 && 体.干跑 === false);      // 缺省即干跑
      const t = 工单库.find(工单根.根, id);
      if (!t) return 发JSON(res, 404, { ok: false, error: `工单不存在：${id}` });

      const 派 = 派单.选派(平台根, 配置, {
        角色: t.fm.role || t.fm.职能 || '',
        公用件, 账本根: 平台根,
      });
      if (!派.ok) return 发JSON(res, 409, { ok: false, ...派 });

      let 调用;
      try {
        const adapter = registry.create(配置, 派.选中);
        调用 = adapter.buildInvocation({ model: 体 && 体.model ? String(体.model) : undefined });
        // A3：受限角色覆盖掉适配器默认的权限绕过开关
        if (派.权限.模式 === '受限') {
          调用 = { ...调用, args: [...调用.args.filter((a) => !/^--dangerously-/.test(a)), ...派.权限.参数] };
        }
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }

      const 共同 = {
        ok: true, 工单: id, provider: 派.选中, 角色: t.fm.role || t.fm.职能 || '',
        权限: 派.权限, 降级: 派.降级, 跳过: 派.跳过, 调用,
        ...(派.预算闸 ? { 预算闸: 派.预算闸 } : {}),
      };

      if (干跑) {
        记战绩({ provider: 派.选中, role: 共同.角色, ticket: id, ok: true, dry: true, durationMs: 0 });
        return 发JSON(res, 200, { ...共同, 干跑: true, 说明: '干跑：全链路走完但未拉起任何进程，零计费。真跑需 {"干跑": false} 且满足另两闸。' });
      }

      const 许 = 真跑许可(派.选中);
      if (!许.准) return 发JSON(res, 许.码, { ...共同, ok: false, error: 许.错 });

      // 决定 3：没有隔离目录就拒绝真跑，而不是退回主工作区
      const 工作 = 取工作目录();
      if (!工作.ok) return 发JSON(res, 403, { ...共同, ok: false, error: 工作.错 });

      const 落 = 派单.落单(工单库, 工单根.根, id, 派);
      if (!落.ok) return 发JSON(res, 409, { ...共同, ok: false, error: 落.error });

      拉起(调用, (体 && 体.提示词) || t.body || '', 工作.目录, (r) => {
        const 判 = 加固.成败判定({ 退出码: r.退出码, 输出: r.输出 });
        记战绩({
          provider: 派.选中, role: 共同.角色, ticket: id,
          ok: 判.成, dry: false, durationMs: r.耗时毫秒, _输出: r.输出,
        });
        return 发JSON(res, 200, {
          ...共同, 干跑: false, 成: 判.成,
          ...(判.成 ? {} : { 失败原因: 判.原因 }),
          耗时毫秒: r.耗时毫秒,
          ...(r.验尸 ? { 验尸: r.验尸, 活尾巴: r.活尾巴 } : {}),
          工作目录: 工作.目录,
          ...(工作.临时 ? { 工作目录说明: "本次现建的临时隔离目录（仓外）——决定 3：主工作区全程零改动" } : {}),
          ...(计量提示(派.选中) ? { 计量提示: 计量提示(派.选中) } : {}),
        });
      });
    });
  }

  return 发JSON(res, 404, { ok: false, error: '未知路径：' + 路径 });
});

服务.listen(端口, '127.0.0.1', () => {
  process.stdout.write(`[执行器] 上岗 → http://127.0.0.1:${端口}\n`);
  process.stdout.write(`[执行器] 真跑：${允许真跑 ? '**总开关已开**（仍需逐池预算上限 + 请求显式关干跑）' : '关闭（默认）'}\n`);
  // 本机放宽了哪几处必须看得见：悄悄生效的安全降级比不降级更危险，人会以为还锁着
  process.stdout.write(`[执行器] ${本地覆盖.摘要(生效的覆盖)}\n`);
  const 有上限 = Object.keys((配置.预算 && 配置.预算.池) || {});
  process.stdout.write(`[执行器] 配了预算上限的池：${有上限.length ? 有上限.join('/') : '无（任何池都不许真跑）'}\n`);
});
