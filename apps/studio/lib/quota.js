// quota.js — codex / claude 账号限额：查询（零 token 消耗）、缓存、守门。
// codex 走 app-server 协议；claude 走 OAuth usage 接口（读 ~/.claude/.credentials.json）。
// 也可作 CLI：node quota.js [--oneline]
//
// 施工令-059（应 robinwang2 请求）：**解读**那一半已归位 packages/quota（形制照 packages/budget）——
// 窗口解析 windowsOf/claudeWindows、百分比、label、重置时刻、守门判定 gateOf 全在包里，纯函数。
// 留在本文件的是**取数**那一半：拉 app-server、发 OAuth 请求、刷 token、节流、缓存、CLI。
// 消费方（gates / server / runner）require 的还是这里，导出名一个没变：本文件把包里那几个纯函数原样转发。
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const QUERY_TIMEOUT_MS = 20000;
let cache = { at: 0, data: null }; // codex app-server 快照缓存（本地零 token，无限流之虞）

/* ===================== 公用件三候选解析（照 budget-resolve · 施工令-046）=====================
   打包态坑（0.26.5 冒烟案）：asar 内 ../../../packages 逃不出应用包，故有三候选：
     ①仓内相对（开发态）→②TICKETFLOW_PACKAGES 环境变量→③studio.config.json · packages路径
   （壳里不许出现盘符绝对路径——候选③此前在 budget 那边是硬编码某台机器的仓根，换机即死。）
   缺省/空串=跳过该候选，相对值按监制台仓根解析。
   全失守不静默：console + journal 双留痕 + 对象上打 失效/失败因（失效位() 供接口展开）。
   与 budget-resolve 是同一套算法的第二份实现——写区只到 lib/quota.js，不动 046 那两个文件；
   两份合一（提 lib/公用件解析.js，budget-resolve 转调）值得单开一令，见回执-059「留给下一令」。 */

// 候选③的配置读取。不走 core/config.load()——那条路会顺带跑编制迁移并**写盘**，
// 而这里只是取一个字符串，在 require 期做写盘副作用不划算。BOM 容忍与 load() 同款。
function 读配置包路径(根) {
  const raw = fs.readFileSync(path.join(根, 'studio.config.json'), 'utf8');
  const cfg = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
  return typeof cfg.packages路径 === 'string' ? cfg.packages路径.trim() : '';
}

// 空实现：额度**解读**缺席但绝不炸 gates/派发——与既有纪律同向（查询失败一律 fail-open，
// 守门查不着不能反过来卡死管线）。代价是这段时间不会有任何池被额度锁住，所以更要吭声：
// 控制台一行 + journal 一条 + 对象上的失效位。保险丝烧了要响。
function 空实现(失败因, 根) {
  const 说 = 失败因.map((f) => `${f.候选}：${f.因}`).join('；');
  console.error('[quota] 额度解读件失效——三候选全失守，落空实现：窗口读不出、额度锁恒不锁（' + 说 + '）');
  // 控制台那行开机就滚没了，流水是唯一留得住的证据面；找不到仓根就只剩控制台，如实记下这一点。
  let journal = '未落（找不到监制台仓库，无处可落）';
  if (根) {
    try {
      require('./journal').append(根, `额度解读件失效：三候选全失守，落空实现——窗口读不出、额度锁恒不锁｜${说}`);
      journal = '已落';
    } catch (e) { journal = '未落（' + e.message + '）'; }
  }
  return {
    windowsOf: () => [], claudeWindows: () => [], describe: () => [], describeClaude: () => [],
    fmtReset: () => '未知', windowLabel: () => '窗口',
    gateOf: () => ({ allowed: true, threshold: 0, reason: '额度解读件失效，放行（fail-open）' }),
    失效: true, 失败因, journal,
  };
}

// 解析。参数全部可注入（测试用）：
//   相对=候选①的路径（不给则走字面量 require，保持打包器的静态可分析性）
//   环境=候选②的 TICKETFLOW_PACKAGES 值　根=候选③找 studio.config.json 的仓根
function 解析(o = {}) {
  const 环境 = o.环境 !== undefined ? o.环境 : process.env.TICKETFLOW_PACKAGES;
  const 根 = o.根 !== undefined ? o.根 : require('./core/config').resolveRoot();
  const 候选 = [
    {
      名: '仓内相对',
      取: () => (o.相对 ? require(o.相对) : require('../../../packages/quota/quota.js')),
    },
    {
      名: 'TICKETFLOW_PACKAGES 环境变量',
      取: () => {
        if (!环境) throw new Error('未设');
        return require(path.join(环境, 'quota/quota.js'));
      },
    },
    {
      名: 'studio.config.json · packages路径',
      取: () => {
        if (!根) throw new Error('找不到监制台仓库（缺 studio.config.json）');
        const p = 读配置包路径(根);
        if (!p) throw new Error('配置里 packages路径 为空——跳过该候选');
        return require(path.join(path.resolve(根, p), 'quota/quota.js'));
      },
    },
  ];
  const 失败因 = [];
  for (const c of 候选) {
    try {
      const m = c.取();
      // 形状校验：解析到了但不是额度解读件（半截包/同名文件）比找不到更坑——当场判失败进下一候选。
      // 七个面一个都不能缺：少了 windowsOf 额度卡画不出窗口，少了 gateOf 守门整块失灵，
      // 而两者都会**静默**地表现为「一切正常，就是从来不锁」——正是 046 要根治的那种病。
      const 缺 = ['windowsOf', 'claudeWindows', 'describe', 'describeClaude', 'fmtReset', 'windowLabel', 'gateOf']
        .filter((k) => typeof (m || {})[k] !== 'function');
      if (缺.length) throw new Error('模块形状不对（缺 ' + 缺.join('/') + '）');
      return m;
    } catch (e) {
      // 只留首行：MODULE_NOT_FOUND 的 message 后面挂着整段 Require stack，
      // 原样带进 journal 与 UI 悬停就是三屏噪音，首行「Cannot find module 'X'」才是那条线索。
      失败因.push({ 候选: c.名, 因: String(e && e.message || e).split('\n')[0] });
    }
  }
  return 空实现(失败因, 根);
}

// 接口失效位（形制照 budget-resolve.失效位）：正常命中时是空对象——返回体逐字节不变。
function 失效位(q) {
  const m = q || 包;
  return m && m.失效 ? { quota失效: true, quota失败因: m.失败因 || [] } : {};
}

const 包 = 解析(); // 本壳自己也用它：checkGate 的判定、CLI 的文案都从包里取

/* ===================== 以下是取数那一半（有 I/O，故不入包）===================== */

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
        // 走 core/durable：写 → fsync → 改名。凭据被断电写成 NUL 的后果是**下次开机登不上**，
        // 比台账丢账更急（2026-08-21 台账 21918 字节全 NUL 案同族）。
        require('./core/durable').写(CRED_PATH, JSON.stringify(cred));
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

// ===== 额度读数时序账（落实表 P0-1 · 2026-08-24）=====
// 每次**成功**读数把逐窗行 {t, 池, 窗, utilization, resets_at} 追加到 生产根/瞭望塔/额度读数.jsonl。
// 行怎么摊、resets_at 归成什么形态是解读活，在 包.claudeUsageRows（纯函数）；这儿只做追加落盘。
// 只追加（appendFileSync）不整文件重写——时序账天生只增，整写反而给断电留「全文变 NUL」的窗口
//（durable.写 的 fsync+改名是给「整文件就是现值」的档准备的，账簿口径用追加即可）。
// 写失败绝不打断查询本身：时序账是旁账，额度查询是主业。
function 记读数(root, 池, data, t) {
  try {
    if (!root || !data || typeof 包.claudeUsageRows !== 'function') return 0;
    const 行们 = 包.claudeUsageRows(data);
    if (!行们.length) return 0;
    const now = t || new Date().toISOString();
    const file = path.join(root, '瞭望塔', '额度读数.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, 行们.map((r) => JSON.stringify({ t: now, 池, ...r })).join('\n') + '\n', 'utf8');
    return 行们.length;
  } catch { return 0; }
}
function 默根() { try { return require('./core/config').resolveRoot(); } catch { return null; } }

// 保留原始一次性查询（CLI 模式用），不走节流。root/opts 皆可注入（测试用）：
// root 缺省走 resolveRoot；opts.oauth/opts.fetch 让测试零凭据零外呼地走完真流程。
async function queryClaudeUsage(root, opts = {}) {
  const oauth = opts.oauth !== undefined ? opts.oauth : readClaudeOauth();
  if (!oauth || !oauth.accessToken) return null;
  const data = await (opts.fetch || fetchUsage)(oauth.accessToken);
  if (data) 记读数(root !== undefined ? root : 默根(), 'claude', data);
  return data;
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
  if (data) { t.backoffMs = minMs; t.lastGood = { at: now, data }; writeThrottle(t); 记读数(默根(), 'claude', data); return { ...data, 更新于: now }; }
  t.backoffMs = Math.min((t.backoffMs || minMs) * 3, 3600000); writeThrottle(t);
  return stale(t.lastGood);
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

// 守门 = 取数 + 判定。判定整块在 packages/quota.gateOf（纯函数），这里只负责把快照喂进去。
// gatePercent 显式设 0 时不发起查询（测试/离线环境用）——递 null 进去，包里那条早退分支照旧应答。
async function checkGate(cfg) {
  const q = (cfg && cfg.quota) || {};
  if (Number(q.gatePercent) === 0) return 包.gateOf(null, cfg);
  return 包.gateOf(await getRateLimits(cfg), cfg);
}

module.exports = { queryRateLimits, getRateLimits, checkGate,
  queryClaudeUsage, getClaudeUsage, eagerRefresh, getProxyUrl, 记读数,
  // 以下七个是 packages/quota 的纯函数，本壳原样转发（消费方 require 路径与调用名不变）
  describe: 包.describe, describeClaude: 包.describeClaude, fmtReset: 包.fmtReset, windowLabel: 包.windowLabel,
  windowsOf: 包.windowsOf, claudeWindows: 包.claudeWindows, gateOf: 包.gateOf,
  解析, 失效位, 读配置包路径, 包 };

// ---- CLI 模式（供监听器写 USAGE 日志 / 人工双击查看）：codex + claude 一起报 ----
if (require.main === module) {
  const oneline = process.argv.includes('--oneline');
  Promise.all([queryRateLimits(), queryClaudeUsage()]).then(([rl, cu]) => {
    const lines = [];
    const codexParts = 包.describe(rl);
    if (codexParts.length) lines.push('codex：' + codexParts.join(' · '));
    const claudeParts = 包.describeClaude(cu);
    if (claudeParts.length) lines.push('claude：' + claudeParts.join(' · '));
    if (!lines.length) { console.error('限额查询失败'); process.exit(2); }
    console.log(oneline ? lines.join(' | ') : lines.join('\n'));
    process.exit(0);
  });
}
