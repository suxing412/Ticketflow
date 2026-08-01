// quota.js — codex / claude 账号限额：查询（零 token 消耗）、缓存、守门判定。
// codex 走 app-server 协议；claude 走 OAuth usage 接口（读 ~/.claude/.credentials.json）。
// 也可作 CLI：node quota.js [--oneline]
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const QUERY_TIMEOUT_MS = 20000;
let cache = { at: 0, data: null }; // codex app-server 快照缓存（本地零 token，无限流之虞）

// 代理自适应：exe 双击启动没有代理 env，回落读系统注册表（同 watch-mailbox.ps1 策略）
function getProxyUrl() {
  for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) {
    if (process.env[name]) return process.env[name].trim();
  }
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('reg', ['query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const enable = /ProxyEnable\s+REG_DWORD\s+0x1/.test(out);
    const m = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
    if (enable && m) {
      let server = m[1];
      const hm = server.match(/(?:^|;)https?=([^;]+)/);
      if (hm) server = hm[1];
      else if (server.includes('=')) return null;
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(server)) server = 'http://' + server;
      return server;
    }
  } catch { /* 注册表读取尽力而为 */ }
  return null;
}

// claude 订阅用量：GET api.anthropic.com/api/oauth/usage（curl 走代理，失败返回 null）。
// token 过期自动用 refreshToken 换新（与 Claude Code CLI 同一 OAuth 流程），
// 新 token 原子写回 .credentials.json 供 CLI 共用——修"额度监测不到"：
// 监制台此前只读不刷新，accessToken 过期后查询恒 401 返回空。
const CRED_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // Claude Code CLI 官方 client_id

function readClaudeOauth() {
  try { return (JSON.parse(fs.readFileSync(CRED_PATH, 'utf8')).claudeAiOauth) || null; } catch { return null; }
}

function refreshClaudeToken(oauth) {
  return new Promise((resolve) => {
    if (!oauth || !oauth.refreshToken) return resolve(null);
    const args = ['-s', '--max-time', '20'];
    const proxy = getProxyUrl();
    if (proxy) args.push('-x', proxy);
    args.push('https://console.anthropic.com/v1/oauth/token', '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: OAUTH_CLIENT_ID }));
    execFile('curl', args, { windowsHide: true, timeout: QUERY_TIMEOUT_MS }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const d = JSON.parse(stdout);
        if (!d.access_token) return resolve(null);
        // 原子写回（含轮换后的 refresh_token，否则 CLI 手里的旧 refresh 会失效）
        const cred = JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
        cred.claudeAiOauth = { ...cred.claudeAiOauth, accessToken: d.access_token,
          refreshToken: d.refresh_token || oauth.refreshToken,
          expiresAt: Date.now() + (Number(d.expires_in) > 0 ? Number(d.expires_in) * 1000 : 3600000) };
        const tmp = CRED_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(cred), 'utf8');
        fs.renameSync(tmp, CRED_PATH);
        resolve(cred.claudeAiOauth.accessToken);
      } catch { resolve(null); }
    });
  });
}

function fetchUsage(token) {
  return new Promise((resolve) => {
    const args = ['-s', '--max-time', '15'];
    const proxy = getProxyUrl();
    if (proxy) args.push('-x', proxy);
    args.push('https://api.anthropic.com/api/oauth/usage',
      '-H', `Authorization: Bearer ${token}`,
      '-H', 'anthropic-beta: oauth-2025-04-20');
    execFile('curl', args, { windowsHide: true, timeout: QUERY_TIMEOUT_MS }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const d = JSON.parse(stdout);
        if (!d.five_hour) return resolve(null);
        resolve({ fiveHour: d.five_hour, sevenDay: d.seven_day });
      } catch { resolve(null); }
    });
  });
}

// ===== 绝不爆表的刷新纪律（2026-07-11 两次 429 教训后定死）=====
// oauth 用量/令牌端点有账号级限流，且限流窗口可能长达小时级。硬保证：
//   1) 任何情况下两次请求间隔 ≥ 5 分钟（可配 quota.claudeMinIntervalSeconds，下限 120s）
//   2) 失败退避 ×3：5m→15m→45m→60m 封顶；成功即复位
//   3) 节流状态持久化到磁盘（~/.claude/.studio-usage-throttle.json）——重启 exe 不清零，
//      当天多次换装也不会把频率抬回去（此前每次重启都重置节流，是 429 复发的帮凶）
//   4) 窗口内/失败时供给"最后一次好读数"（带 更新于/陈旧 标记），UI 不再无谓显示 —
const THROTTLE_PATH = path.join(os.homedir(), '.claude', '.studio-usage-throttle.json');
function readThrottle() { try { return JSON.parse(fs.readFileSync(THROTTLE_PATH, 'utf8')); } catch { return {}; } }
function writeThrottle(t) { try { fs.writeFileSync(THROTTLE_PATH, JSON.stringify(t)); } catch { /* 尽力 */ } }

async function queryClaudeUsage() { // 保留原始一次性查询（CLI 模式用），不走节流
  const oauth = readClaudeOauth();
  if (!oauth || !oauth.accessToken) return null;
  return fetchUsage(oauth.accessToken);
}

// 事件驱动急刷（0.7.2）：完工瞬间才是额度真变化的时刻——把节流窗口提前作废，
// 让下一次 gates 轮询立即取新读数。仍守两条底线：距上次请求 ≥120s 硬地板；
// 失败退避期间不打扰（退避是在保护限流窗口，急刷不得破坏）。
function eagerRefresh(cfg) {
  const q = (cfg && cfg.quota) || {};
  const minMs = Math.max(120, Number(q.claudeMinIntervalSeconds) > 0 ? Number(q.claudeMinIntervalSeconds) : 300) * 1000;
  const t = readThrottle();
  if (t.backoffMs && t.backoffMs > minMs) return false; // 失败退避中
  if (t.lastAttemptAt && Date.now() - t.lastAttemptAt < 120000) return false; // 硬地板
  t.lastAttemptAt = 0; writeThrottle(t);
  cache.at = 0; // codex 本地缓存一并作废（零成本）
  return true;
}

async function getClaudeUsage(cfg) {
  const q = (cfg && cfg.quota) || {};
  const minMs = Math.max(120, Number(q.claudeMinIntervalSeconds) > 0 ? Number(q.claudeMinIntervalSeconds) : 300) * 1000;
  const now = Date.now();
  const t = readThrottle();
  const stale = (g) => g ? { ...g.data, 更新于: g.at, 陈旧: now - g.at > minMs * 2 } : null;
  // 窗口未到：只供陈旧读数，绝不发请求
  if (t.lastAttemptAt && now - t.lastAttemptAt < (t.backoffMs || minMs)) return stale(t.lastGood);
  t.lastAttemptAt = now; writeThrottle(t); // 先占窗口，防并发双发
  const oauth = readClaudeOauth();
  if (!oauth || !oauth.accessToken) return stale(t.lastGood);
  let token = oauth.accessToken;
  if (oauth.expiresAt && oauth.expiresAt < now + 60000) token = (await refreshClaudeToken(oauth)) || token;
  const data = await fetchUsage(token);
  if (data) { t.backoffMs = minMs; t.lastGood = { at: now, data }; writeThrottle(t); return { ...data, 更新于: now }; }
  t.backoffMs = Math.min((t.backoffMs || minMs) * 3, 3600000); writeThrottle(t);
  return stale(t.lastGood);
}

// 结构化窗口数据（label/pct/reset），供界面画进度条；text 版继续服务 CLI 与日志
function windowsOf(rl) {
  const out = [];
  if (!rl) return out;
  for (const key of ['primary', 'secondary']) {
    const w = rl[key];
    if (!w || w.usedPercent == null) continue;
    out.push({ label: windowLabel(w), pct: Math.round(w.usedPercent), reset: fmtReset(w.resetsAt) });
  }
  return out;
}
function claudeWindows(cu) {
  const out = [];
  if (!cu) return out;
  const push = (w, label) => { if (w && w.utilization != null) out.push({ label, pct: Math.round(w.utilization), reset: fmtReset(w.resets_at) }); };
  push(cu.fiveHour, '5小时');
  push(cu.sevenDay, '周');
  return out;
}

function describeClaude(cu) {
  const parts = [];
  if (!cu) return parts;
  const fmt = (w, label) => {
    if (!w || w.utilization == null) return;
    parts.push(`${label} 已用 ${Math.round(w.utilization)}%（${fmtReset(w.resets_at)} 重置）`);
  };
  fmt(cu.fiveHour, '5小时');
  fmt(cu.sevenDay, '周');
  return parts;
}

// 查询限额快照；任何失败都返回 null（守门 fail-open，绝不能因查询挂了卡死管线）
function queryRateLimits() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], shell: false });
    } catch {
      return resolve(null);
    }

    let settled = false;
    const finish = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* 子进程可能已退出 */ }
      resolve(data);
    };
    const timer = setTimeout(() => finish(null), QUERY_TIMEOUT_MS);

    child.on('error', () => finish(null));

    const send = (obj) => {
      try { child.stdin.write(JSON.stringify(obj) + '\n'); } catch { finish(null); }
    };

    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) return finish(null);
          send({ jsonrpc: '2.0', method: 'initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: null });
        } else if (msg.id === 2) {
          if (msg.error || !msg.result) return finish(null);
          finish(msg.result.rateLimits || msg.result);
        }
      }
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'ticket-hub-quota', title: '限额查询', version: '1.0.0' } },
    });
  });
}

// 带缓存的查询：tick/排期/接口共用，避免每次都拉起 app-server
async function getRateLimits(cfg) {
  const q = (cfg && cfg.quota) || {};
  // codex 走本地 app-server（零 token 无限流），缓存 30s 让读数更活
  const maxAgeMs = (Number(q.cacheSeconds) > 0 ? Number(q.cacheSeconds) : 30) * 1000;
  if (cache.data && Date.now() - cache.at < maxAgeMs) return cache.data;
  const data = await queryRateLimits();
  if (data) cache = { at: Date.now(), data };
  return data;
}

function fmtReset(resetsAt) {
  if (resetsAt == null) return '未知';
  let d;
  if (typeof resetsAt === 'number') d = new Date(resetsAt * (resetsAt > 1e12 ? 1 : 1000));
  else d = new Date(resetsAt);
  if (isNaN(d.getTime())) return String(resetsAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function windowLabel(w) {
  if (!w || w.windowDurationMins == null) return '窗口';
  const mins = w.windowDurationMins;
  if (mins <= 360) return `${Math.round(mins / 60)}小时`;
  if (mins >= 9000) return '周';
  return `${mins}分钟`;
}

function describe(rl) {
  const parts = [];
  if (!rl) return parts;
  for (const key of ['primary', 'secondary']) {
    const w = rl[key];
    if (!w) continue;
    const pct = w.usedPercent == null ? '?' : Math.round(w.usedPercent);
    parts.push(`${windowLabel(w)} 已用 ${pct}%（${fmtReset(w.resetsAt)} 重置）`);
  }
  if (rl.planType) parts.push(`套餐 ${rl.planType}`);
  return parts;
}

// 守门判定（双闸 + 余量感知）。查询失败 fail-open 放行。
// - 5h 闸：有效阈值 = min(gatePercent, 100 - costBufferPercent)。costBuffer 是"单张工单
//   的预估消耗"——守门只在派发瞬间检查，不留余量就会 79% 放行、一单烧 30% 冲破 100%
//   （2026-07-06 实测每张 Unity 单吃 25~30%，TK-11-10 事故即此）
// - 周闸：周窗烧穿是灾难级（停摆数日），weeklyGatePercent 兜底
// gatePercent 显式设 0 = 关闭守门（不发起查询，测试/离线环境用）
async function checkGate(cfg) {
  const q = (cfg && cfg.quota) || {};
  if (Number(q.gatePercent) === 0) return { allowed: true, threshold: 0, reason: '额度守门已关闭' };
  const gatePercent = Number(q.gatePercent) > 0 ? Number(q.gatePercent) : 80;
  const costBuffer = q.costBufferPercent != null ? Number(q.costBufferPercent) : 30;
  const threshold = Math.min(gatePercent, 100 - costBuffer);
  const weeklyThreshold = q.weeklyGatePercent != null ? Number(q.weeklyGatePercent) : 90;
  const rl = await getRateLimits(cfg);
  if (!rl || !rl.primary || rl.primary.usedPercent == null) {
    return { allowed: true, threshold, snapshot: rl, reason: '额度查询不可用，放行（fail-open）' };
  }
  const toISO = (raw) => {
    if (raw == null) return null;
    const d = typeof raw === 'number' ? new Date(raw * (raw > 1e12 ? 1 : 1000)) : new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const used = rl.primary.usedPercent;
  if (used >= threshold) {
    return {
      allowed: false, threshold, snapshot: rl, usedPercent: used, resetAt: toISO(rl.primary.resetsAt),
      reason: `${windowLabel(rl.primary)}窗口已用 ${Math.round(used)}%（拦截线 ${threshold}%＝阈值与单张余量取严），${fmtReset(rl.primary.resetsAt)} 重置`,
    };
  }
  const weekly = rl.secondary && rl.secondary.usedPercent;
  if (weekly != null && weekly >= weeklyThreshold) {
    return {
      allowed: false, threshold: weeklyThreshold, snapshot: rl, usedPercent: weekly, resetAt: toISO(rl.secondary.resetsAt),
      reason: `周窗口已用 ${Math.round(weekly)}%（周阀门 ${weeklyThreshold}%），${fmtReset(rl.secondary.resetsAt)} 重置——周额度烧穿会停摆数日，从严把守`,
    };
  }
  return { allowed: true, threshold, snapshot: rl, usedPercent: used };
}

module.exports = { queryRateLimits, getRateLimits, checkGate, describe, fmtReset, windowLabel,
  queryClaudeUsage, getClaudeUsage, describeClaude, windowsOf, claudeWindows, eagerRefresh, getProxyUrl };

// ---- CLI 模式（供监听器写 USAGE 日志 / 人工双击查看）：codex + claude 一起报 ----
if (require.main === module) {
  const oneline = process.argv.includes('--oneline');
  Promise.all([queryRateLimits(), queryClaudeUsage()]).then(([rl, cu]) => {
    const lines = [];
    const codexParts = describe(rl);
    if (codexParts.length) lines.push('codex：' + codexParts.join(' · '));
    const claudeParts = describeClaude(cu);
    if (claudeParts.length) lines.push('claude：' + claudeParts.join(' · '));
    if (!lines.length) { console.error('限额查询失败'); process.exit(2); }
    console.log(oneline ? lines.join(' | ') : lines.join('\n'));
    process.exit(0);
  });
}
