// 额度取数 —— 订阅窗口的快照从哪来（协-018）。
//
// ⚠ **本模块引 child_process，只准执行器进程持有**（与 workspace/worktree.js 同纪律）。
// `server.js` 的依赖闭包里不许出现 child_process——那是桩模式的物理保证，接线契约测试盯着。
// 判定那一半是纯的，住在 lib/额度闸.js，server 与派单只读本模块落下的盘。
//
// 两个取数口：
//   · codex —— 拉起 `codex app-server`，走 JSON-RPC 问 account/rateLimits/read。本地调用，
//     零 token、无账号级限流，代价只是起一个进程。
//   · claude —— GET api.anthropic.com/api/oauth/usage，凭 ~/.claude/.credentials.json 里的
//     accessToken。**有账号级限流**，纪律见下。
//
// ============ 一条硬纪律：只读 .credentials.json，绝不写 ============
//
// studio 的 lib/quota.js 在 token 快过期时会刷新，并把新 token（含**轮换后的**
// refresh_token）原子写回 ~/.claude/.credentials.json。两个产品跑在同一台机器、
// 同一个 Claude 账号上。platform 若也刷：
//   ① refresh_token 是轮换的——谁后刷，谁手里的旧 refresh 就作废。两边互相把对方踢下线，
//      而表现只是「额度偶尔读不到」，查起来极难；
//   ② usage 端点有账号级限流（对方 2026-07-11 吃过两次 429，窗口长达小时级），
//      两个产品各有各的节流盘、互不知情，合起来的实际频率是两倍。
// 所以：**过期就当读不到**（fail-open + 标盲区），刷新永远归 studio 那一侧。
// 节流间隔也取更保守的默认值：600s（studio 是 300s）。
'use strict';

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const 超时毫秒 = 20000;
const CRED = path.join(os.homedir(), '.claude', '.credentials.json');
const 节流文件 = (账本根) => path.join(账本根, 'journal', '额度节流.json');
const 快照文件 = (账本根) => path.join(账本根, 'journal', '额度快照.json');

function 读JSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

// 原子写：直接写目标文件的话，读方（server / 派单）可能读到写到一半的半截 JSON，
// 而半截 JSON 的表现是「解析失败 → 当读不到 → 静默 fail-open」。
function 落盘(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function 代理() {
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) {
    if (String(process.env[k] || '').trim()) return process.env[k].trim();
  }
  return null;  // 注册表回落是 studio 的 exe 双击场景；platform 从终端起，env 就够
}

// ---- codex：app-server 的 JSON-RPC 握手（照 studio 的实测序列）----
// 任何失败都回 { 因 }，绝不抛：守门查不着不能反过来卡死管线。
function 拉codex() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true });
    } catch (e) { return resolve({ 因: `起不来 codex app-server：${e.message}` }); }

    let 完 = false;
    const 收 = (r) => {
      if (完) return;
      完 = true;
      clearTimeout(计时);
      try { child.kill(); } catch { /* 可能已退出 */ }
      resolve(r);
    };
    const 计时 = setTimeout(() => 收({ 因: `codex app-server 超时（${超时毫秒 / 1000}s 无应答）` }), 超时毫秒);
    child.on('error', (e) => 收({ 因: `codex app-server 起不来：${e.message}（这台机器装 codex 了吗）` }));

    const 发 = (o) => { try { child.stdin.write(JSON.stringify(o) + '\n'); } catch (e) { 收({ 因: `写不进 stdin：${e.message}` }); } };
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const 行 = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!行) continue;
        let msg; try { msg = JSON.parse(行); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) return 收({ 因: `initialize 被拒：${JSON.stringify(msg.error).slice(0, 200)}` });
          发({ jsonrpc: '2.0', method: 'initialized' });
          发({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: null });
        } else if (msg.id === 2) {
          if (msg.error || !msg.result) return 收({ 因: `rateLimits 读不到：${JSON.stringify(msg.error || {}).slice(0, 200)}` });
          return 收({ rl: msg.result.rateLimits || msg.result });
        }
      }
    });
    发({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'ai-devplatform-quota', title: '额度查询', version: '1.0.0' } } });
  });
}

// ---- claude：OAuth usage（只读凭据，不刷新，见头部纪律）----
function 拉claude() {
  return new Promise((resolve) => {
    const cred = 读JSON(CRED);
    const oauth = cred && cred.claudeAiOauth;
    if (!oauth || !oauth.accessToken) {
      return resolve({ 因: `读不到 Claude OAuth 凭据（${CRED}）——这台机器上 claude CLI 登录过吗` });
    }
    if (oauth.expiresAt && oauth.expiresAt < Date.now() + 60000) {
      // 刻意不刷新：refresh_token 轮换会把 studio 手里的凭据顶掉（见头部纪律）。
      return resolve({ 因: 'accessToken 已过期——platform 只读不刷（刷新归 studio 侧，避免 refresh_token 轮换互踢）' });
    }
    const args = ['-s', '--max-time', '15'];
    const p = 代理(); if (p) args.push('-x', p);
    args.push('https://api.anthropic.com/api/oauth/usage',
      '-H', `Authorization: Bearer ${oauth.accessToken}`,
      '-H', 'anthropic-beta: oauth-2025-04-20');
    execFile('curl', args, { windowsHide: true, timeout: 超时毫秒 }, (err, stdout) => {
      if (err) return resolve({ 因: `usage 请求失败：${String(err.message || err).split('\n')[0]}` });
      let d; try { d = JSON.parse(stdout); } catch { return resolve({ 因: 'usage 回的不是 JSON（可能是限流页或代理拦截）' }); }
      if (!d || !d.five_hour) return resolve({ 因: `usage 回体里没有 five_hour：${JSON.stringify(d).slice(0, 160)}` });
      resolve({ usage: { fiveHour: d.five_hour, sevenDay: d.seven_day } });
    });
  });
}

// 池 → 取数口。按 **adapter** 认，不按池名认。
//
// 按名认是踩过的坑（拓扑事实④）：studio 的 resolveCli 只把恰好叫 `codex` 的池路由到
// codex CLI，于是 `codex-key` 静默走了另一条路。这里从一开始就按 adapter 认——
// 池叫什么名字是人起的，adapter 才是「它到底是哪家 CLI」的事实。
function 取数口(配置, 池) {
  const a = (((配置 && 配置.providers) || {})[池] || {}).adapter;
  if (a === 'codex-cli') return { 形态: 'codex', 拉: 拉codex, 限流: false };
  if (a === 'claude-cli') return { 形态: 'claude', 拉: 拉claude, 限流: true };
  return null;
}

// 节流：limited 的口子（claude）守死间隔 + 失败退避 ×3；本地口子（codex）只做轻缓存。
function 节流判(账本根, 池, 配置, 现在) {
  const q = (配置 && 配置.quota) || {};
  const 最小秒 = Math.max(120, Number(q.claude最小间隔秒) > 0 ? Number(q.claude最小间隔秒) : 600);
  const t = 读JSON(节流文件(账本根)) || {};
  const 项 = t[池] || {};
  const 间隔 = 项.退避毫秒 && 项.退避毫秒 > 最小秒 * 1000 ? 项.退避毫秒 : 最小秒 * 1000;
  if (项.上次尝试于 && 现在 - 项.上次尝试于 < 间隔) {
    return { 跳过: true, 因: `节流窗口未到（距上次 ${Math.round((现在 - 项.上次尝试于) / 1000)}s，需 ${Math.round(间隔 / 1000)}s）`, 盘: t, 最小秒 };
  }
  return { 跳过: false, 盘: t, 最小秒 };
}

function 记节流(账本根, 盘, 池, { 成功, 最小秒, 现在 }) {
  const 项 = 盘[池] || (盘[池] = {});
  项.上次尝试于 = 现在;
  if (成功) { 项.退避毫秒 = 最小秒 * 1000; 项.上次成功于 = 现在; }
  else 项.退避毫秒 = Math.min((项.退避毫秒 || 最小秒 * 1000) * 3, 3600000);
  try { 落盘(节流文件(账本根), 盘); } catch { /* 节流盘写不了不该把取数打掉 */ }
}

// 取一轮 —— 给每个**订阅池**取一次数，合并进既有快照后落盘。
//
// 合并而不是覆盖：某个池这一轮被节流跳过（或取失败），不该把它上一次的好读数抹掉。
// 上一次的读数会带着它自己的 取于 时刻，旧到什么程度由判定那边按 快照弃用秒 处置。
async function 取一轮(配置, 账本根, o = {}) {
  const 现在 = o.现在 || Date.now();
  const 计费 = require('./计费');
  const 旧 = 读JSON(快照文件(账本根)) || {};
  const 池表 = { ...(旧.池 || {}) };
  const 动作 = [];

  for (const 池 of Object.keys((配置 && 配置.providers) || {})) {
    if (计费.模式(配置, 池) !== 计费.订阅) continue;       // 只有订阅池有窗口这回事
    const 口 = 取数口(配置, 池);
    if (!口) { 动作.push({ 池, 结果: '跳过', 因: '不认识这个 adapter 的额度来源' }); continue; }

    if (口.限流) {
      const 节 = 节流判(账本根, 池, 配置, 现在);
      if (节.跳过) { 动作.push({ 池, 结果: '节流', 因: 节.因 }); continue; }
      const r = await 口.拉();
      记节流(账本根, 节.盘, 池, { 成功: !r.因, 最小秒: 节.最小秒, 现在 });
      池表[池] = r.因
        ? { ...(池表[池] || {}), 形态: 口.形态, 上次失败于: new Date(现在).toISOString(), 因: r.因 }
        : { 形态: 口.形态, 取于: new Date(现在).toISOString(), usage: r.usage };
      动作.push({ 池, 结果: r.因 ? '失败' : '取到', ...(r.因 ? { 因: r.因 } : {}) });
      continue;
    }

    const r = await 口.拉();
    池表[池] = r.因
      ? { ...(池表[池] || {}), 形态: 口.形态, 上次失败于: new Date(现在).toISOString(), 因: r.因 }
      : { 形态: 口.形态, 取于: new Date(现在).toISOString(), rl: r.rl };
    动作.push({ 池, 结果: r.因 ? '失败' : '取到', ...(r.因 ? { 因: r.因 } : {}) });
  }

  const 快照 = { 更新于: new Date(现在).toISOString(), 池: 池表 };
  try { 落盘(快照文件(账本根), 快照); } catch (e) { return { ok: false, 错误: `快照写不下去：${e.message}`, 动作 }; }
  return { ok: true, 快照, 动作 };
}

module.exports = { 取一轮, 拉codex, 拉claude, 取数口, 快照文件, 节流文件 };
