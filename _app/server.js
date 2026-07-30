// server.js — 监制台 HTTP 层，仅监听 127.0.0.1。纯路由，业务在 lib/。
const path = require('path');
const fs = require('fs');
const express = require('express');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const config = require('./lib/core/config');
const store = require('./lib/core/store');
const gates = require('./lib/gates');
const pool = require('./lib/pool');
const life = require('./lib/lifecycle');
const trace = require('./lib/trace');
const quota = require('./lib/quota');
const journal = require('./lib/journal');
const providerRegistry = require('./lib/providers/registry');
const providerRouter = require('./lib/routing/router');
const providerHistory = require('./lib/routing/history');
const worktrees = require('./lib/workspace/worktree');

const ROOT = config.resolveRoot();
let cfg = null; let initError = null;
if (!ROOT) initError = '未找到监制台仓库（缺 studio.config.json）。';
else { try { cfg = config.load(ROOT); store.ensureDirs(ROOT); } catch (e) { initError = '读配置失败：' + e.message; } }

const app = express();
app.use(express.json({ limit: '2mb' }));
// CSRF 护栏：写请求校验本机 Host + 同源 Origin
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!LOCAL.has(host)) return res.status(403).json({ error: '拒绝：非本机写请求' });
  const o = req.headers.origin;
  if (o) { let h = null; try { h = new URL(o).hostname; } catch { h = null; } if (!h || !LOCAL.has(h)) return res.status(403).json({ error: '拒绝：跨源写请求' }); }
  next();
});
const ready = (res) => { if (initError) { res.status(500).json({ error: initError }); return false; } return true; };
const mdHtml = (s) => sanitizeHtml(marked.parse(s || ''), { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2']) });

// ---- 工单池：全状态板（P2/P9甘特/P10树形 共用数据源）----
app.get('/api/board', (req, res) => {
  if (!ready(res)) return;
  const snap = store.snapshot(ROOT);
  const out = {};
  for (const s of store.STATES) out[s] = snap[s].map((t) => ({
    id: t.id, title: t.fm.title, 职能: t.fm.职能, role: t.fm.role || t.fm.角色 || t.fm.职能,
    provider: t.fm.provider || t.fm.供应商 || t.fm.执行池 || null, 优先级: t.fm.优先级, 规模: t.fm.规模,
    QA: t.fm.QA, 验收方式: t.fm.验收方式, 主办: t.fm.主办 || null, 项目: t.fm.项目 || null, // D42 多项目视界按此归属
    阶段: t.fm.阶段 || null, 预计时间: t.fm.预计时间 || null, // D43 流程视图用
    父单: t.fm.父单 || null, 依赖: t.fm.依赖 || null,
    workspace: t.fm.workspace ? { mode: t.fm.workspace.mode, branch: t.fm.workspace.branch || null, commit: t.fm.workspace.commit || null, isolated: !!t.fm.workspace.isolated } : null,
    领单时间: t.fm.领单时间 || null, 交付时间: t.fm.交付时间 || null, 滞留告警: !!t.fm.滞留告警,
  }));
  res.json({ states: store.STATES, board: out });
});
// （排期 API 已随甘特退役移除——拉取模型没有"计划日期"，时间轴只回放真实执行；里程碑=父单完成，已废）

// ---- 参数步进（P6）：白名单闸值写回 studio.config.json（全局在途上限已废——编制即上限）----
app.post('/api/config/gate', (req, res) => {
  if (!ready(res)) return;
  const { key, value } = req.body || {};
  const ALLOW = { 待验收积压闸: [1, 50], QA自修上限: [0, 10], 滞留超时小时: [1, 72] };
  if (!(key in ALLOW)) return res.status(400).json({ error: '不可调整的参数：' + key });
  const v = Number(value);
  if (!Number.isInteger(v) || v < ALLOW[key][0] || v > ALLOW[key][1]) return res.status(400).json({ error: `取值须在 ${ALLOW[key][0]}–${ALLOW[key][1]}` });
  cfg.闸值[key] = v;
  fs.writeFileSync(path.join(ROOT, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  journal.append(ROOT, `参数调整：${key} → ${v}`);
  res.json({ ok: true, 闸值: cfg.闸值 });
});

// ---- 执行器（D30）：内嵌拉取循环 = 监制台版监听器。试跑默认，实弹待接入 ----
const runner = require('./lib/runner');
app.get('/api/runner', (req, res) => { if (!ready(res)) return; res.json(runner.status(ROOT, cfg)); });
app.post('/api/runner/start', (req, res) => {
  if (!ready(res)) return;
  runner.start(ROOT, () => cfg);
  res.json({ ok: true, ...runner.status(ROOT, cfg) });
});
app.post('/api/runner/stop', (req, res) => {
  if (!ready(res)) return;
  runner.stop(ROOT);
  res.json({ ok: true, ...runner.status(ROOT, cfg) });
});
app.post('/api/runner/mode', (req, res) => {
  if (!ready(res)) return;
  const { 试跑 } = req.body || {};
  if (试跑 === false && !(cfg.执行器 && cfg.执行器.实弹解锁 === true))
    return res.status(400).json({ error: '实弹通道已就绪但未解锁：烧额度需你授权（config.执行器.实弹解锁 = true）。' });
  require('./lib/core/state').update(ROOT, (s) => { s.执行器 = { ...(s.执行器 || {}), 试跑: 试跑 !== false }; });
  journal.append(ROOT, `执行模式切换 → ${试跑 === false ? '实弹（已解锁授权）' : '试跑（零额度）'}`);
  res.json({ ok: true, ...runner.status(ROOT, cfg) });
});
// ---- 全量配置入 UI（2026-07-11 用户指示）：以下均为白名单化分区写回 ----
const saveCfg = () => fs.writeFileSync(path.join(ROOT, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');

// 执行池阈值（额度锁的杆）
app.post('/api/config/pool', (req, res) => {
  if (!ready(res)) return;
  const { pool, key, value } = req.body || {};
  const known = providerRegistry.configs(cfg);
  if (!known[pool]) return res.status(400).json({ error: '未知 Provider：' + pool });
  if (!['阈值', '周阈值'].includes(key)) return res.status(400).json({ error: '不可调整：' + key });
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1 || v > 100) return res.status(400).json({ error: '取值须在 1–100' });
  if (cfg.providers && cfg.providers[pool]) {
    cfg.providers[pool].quota = cfg.providers[pool].quota || {};
    cfg.providers[pool].quota[key] = v;
  }
  if (cfg.执行池 && cfg.执行池[pool]) cfg.执行池[pool][key] = v;
  saveCfg();
  journal.append(ROOT, `执行池阈值调整：${pool}.${key} → ${v}%`);
  res.json({ ok: true, 执行池: cfg.执行池 });
});

// 模型档（池默认 + 裁判档）；可选清单增补
app.post('/api/config/model', (req, res) => {
  if (!ready(res)) return;
  const { key, value } = req.body || {};
  if (!['codex默认', 'claude默认', '质检', '代核', '代裁'].includes(key)) return res.status(400).json({ error: '不可调整：' + key });
  const v = String(value || '').trim();
  cfg.模型 = cfg.模型 || {}; cfg.模型[key] = v; saveCfg();
  journal.append(ROOT, `模型档调整：${key} → ${v || '（CLI 默认）'}`);
  res.json({ ok: true, 模型: cfg.模型 });
});
app.post('/api/config/model-add', (req, res) => {
  if (!ready(res)) return;
  const { pool, name } = req.body || {};
  if (!providerRegistry.configs(cfg)[pool]) return res.status(400).json({ error: '未知 Provider：' + pool });
  const v = String(name || '').trim();
  if (!/^[\w.\-]{2,40}$/.test(v)) return res.status(400).json({ error: '模型名只允许字母数字点横线（2–40 位）' });
  cfg.模型 = cfg.模型 || {}; cfg.模型.可选 = cfg.模型.可选 || {};
  const list = cfg.模型.可选[pool] = cfg.模型.可选[pool] || [];
  if (!list.includes(v)) list.push(v);
  saveCfg();
  journal.append(ROOT, `可选模型增补：${pool} + ${v}`);
  res.json({ ok: true, 可选: cfg.模型.可选 });
});

// 额度刷新间隔（绝不爆表纪律的可调项，硬下限 120s 在 quota.js 兜底）
app.post('/api/config/quota', (req, res) => {
  if (!ready(res)) return;
  const v = Number((req.body || {}).value);
  if (!Number.isInteger(v) || v < 120 || v > 3600) return res.status(400).json({ error: '取值须在 120–3600 秒' });
  cfg.quota = cfg.quota || {}; cfg.quota.claudeMinIntervalSeconds = v; saveCfg();
  journal.append(ROOT, `额度刷新间隔调整 → ${v}s`);
  res.json({ ok: true, quota: cfg.quota });
});

// 实弹解锁（权力开关：UI 切换即制作人授权动作，journal 大字记录）
app.post('/api/config/live', (req, res) => {
  if (!ready(res)) return;
  const 解锁 = !!(req.body || {}).解锁;
  cfg.执行器 = cfg.执行器 || {}; cfg.执行器.实弹解锁 = 解锁;
  if (!解锁) require('./lib/core/state').update(ROOT, (s) => { s.执行器 = { ...(s.执行器 || {}), 试跑: true }; }); // 上锁同时退回试跑
  saveCfg();
  journal.append(ROOT, 解锁 ? '⚠ 实弹解锁 → 开（制作人 UI 授权，agent 可烧额度）' : '实弹解锁 → 关（回试跑，零额度）');
  res.json({ ok: true, 实弹解锁: 解锁 });
});

// 项目注册（加/改 同名覆盖；设默认；路径必须真实存在）
app.post('/api/config/project', (req, res) => {
  if (!ready(res)) return;
  const { 动作, 名称, 路径, 说明 } = req.body || {};
  cfg.项目 = cfg.项目 || { 默认: '', 注册: {} };
  if (动作 === '设默认') {
    if (!cfg.项目.注册[名称]) return res.status(400).json({ error: '项目未注册：' + 名称 });
    cfg.项目.默认 = 名称; saveCfg();
    journal.append(ROOT, `默认项目 → ${名称}`);
    return res.json({ ok: true, 项目: cfg.项目 });
  }
  if (动作 === '注册') {
    // 中文项目名放行（D42 注册页实测全链路 OK：目录即状态机文件名/编号前缀/过滤都吃中文）
    if (!/^[\w一-鿿-]{1,24}$/.test(String(名称 || ''))) return res.status(400).json({ error: '项目名只允许中文、字母数字下划线横线（≤24 位）' });
    const p = String(路径 || '').trim();
    if (!p || !fs.existsSync(p)) return res.status(400).json({ error: '路径不存在：' + p.slice(0, 60) });
    cfg.项目.注册[名称] = { 路径: p.replace(/\\/g, '/'), 说明: String(说明 || '').slice(0, 60) };
    if (!cfg.项目.默认) cfg.项目.默认 = 名称;
    saveCfg();
    journal.append(ROOT, `项目注册：${名称} → ${p}`);
    return res.json({ ok: true, 项目: cfg.项目 });
  }
  if (动作 === '删除') {
    if (!cfg.项目.注册[名称]) return res.status(400).json({ error: '项目未注册：' + 名称 });
    // 有未完成单引用该项目 → 拒删（防止执行 agent 领到无处落脚的单）
    const active = ['草稿', '待投', '池', '在途', '质检', '待验收', '待定夺', '执行失败'];
    const refs = [];
    for (const s of active) for (const t of store.list(ROOT, s)) if (t.fm.项目 === 名称) refs.push(t.id);
    if (refs.length) return res.status(400).json({ error: `有 ${refs.length} 张未完成单引用该项目（${refs.slice(0, 5).join('、')}${refs.length > 5 ? '…' : ''}），先处理再删` });
    delete cfg.项目.注册[名称];
    if (cfg.项目.默认 === 名称) cfg.项目.默认 = Object.keys(cfg.项目.注册)[0] || '';
    saveCfg();
    journal.append(ROOT, `项目删除：${名称}${cfg.项目.默认 ? `（默认项目→${cfg.项目.默认}）` : ''}`);
    return res.json({ ok: true, 项目: cfg.项目 });
  }
  res.status(400).json({ error: '未知动作：' + 动作 });
});

// 服务端口（重启生效）
app.post('/api/config/port', (req, res) => {
  if (!ready(res)) return;
  const v = Number((req.body || {}).value);
  if (!Number.isInteger(v) || v < 1024 || v > 65535) return res.status(400).json({ error: '端口须在 1024–65535' });
  cfg.server = cfg.server || {}; cfg.server.port = v; saveCfg();
  journal.append(ROOT, `服务端口 → ${v}（重启生效）`);
  res.json({ ok: true, port: v, note: '重启监制台后生效' });
});

app.post('/api/config/runner', (req, res) => {
  if (!ready(res)) return;
  const { key, value } = req.body || {};
  const NUM = { 间隔秒: [5, 600], 执行超时分钟: [5, 240], 记账间隔分钟: [0, 120] };
  if (!(key in NUM)) return res.status(400).json({ error: '不可调整的参数：' + key });
  const v = Number(value);
  if (!Number.isInteger(v) || v < NUM[key][0] || v > NUM[key][1]) return res.status(400).json({ error: `取值须在 ${NUM[key][0]}–${NUM[key][1]}` });
  cfg.执行器 = { ...(cfg.执行器 || {}), [key]: v };
  fs.writeFileSync(path.join(ROOT, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  journal.append(ROOT, `执行器参数调整：${key} → ${v}`);
  if (runner.isOn(ROOT)) runner.startLoop(ROOT, () => cfg); // 间隔生效需重排循环
  res.json({ ok: true, 执行器: cfg.执行器 });
});
// ---- 环境探针 = 全链路开机自检（用户定义：全绿 ⇒ 整个 app 可用）----
// 级别语义：红=核心不可用（阻断）；黄=能力受限（降级，如实弹不可/额度盲飞）；绿=就绪。
// 60s 服务端缓存（CLI 版本探测有秒级开销，总览灯也要读）。
let envCache = { at: 0, data: null };
app.get('/api/env', async (req, res) => {
  if (!ready(res)) return;
  if (envCache.data && Date.now() - envCache.at < 60000 && !req.query.force) return res.json(envCache.data);
  const os = require('os');
  const { execFile } = require('child_process');
  const probe = (cmd, args) => new Promise((resolve) => {
    const isAbs = /[\\/:]/.test(cmd);
    const run = () => execFile(isAbs ? `"${cmd}"` : cmd, args, { timeout: 8000, shell: true, windowsHide: true }, (err, stdout) => {
      if (!err) return resolve({ ok: true, note: String(stdout).trim().split('\n')[0].slice(0, 60) });
      resolve({ ok: false, note: err.killed ? '检测超时' : '已安装但运行失败：' + String(err.message).split(/\r?\n/)[0].slice(0, 40) });
    });
    if (isAbs) { if (!fs.existsSync(cmd)) return resolve({ ok: false, note: '路径不存在：' + cmd.slice(0, 50) }); return run(); }
    execFile('where', [cmd], { timeout: 5000, windowsHide: true }, (werr) => {
      if (werr) return resolve({ ok: false, note: '未安装或不在 PATH' });
      run();
    });
  });
  const item = (名称, 级别, note) => ({ 名称, 级别, note }); // 级别: 绿/黄/红

  // 组1 运行时与 CLI：按已启用 Provider 动态探测，不再假定系统永远只有 Codex/Claude。
  const enabledProviders = providerRegistry.list(cfg).filter((provider) => provider.enabled !== false);
  const probeRows = await Promise.all(enabledProviders.map(async (provider) => {
    try {
      const invocation = providerRegistry.create(cfg, provider.name).buildInvocation({ model: provider.defaultModel || '' });
      return { provider, result: await probe(provider.probeCommand || invocation.cmd, provider.probeArgs || ['--version']) };
    } catch (e) { return { provider, result: { ok: false, note: e.message } }; }
  }));
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
  const 运行时 = [
    item('node', '绿', process.version),
    ...probeRows.map(({ provider, result }) => item(`${provider.name} · ${provider.adapter}`, result.ok ? '绿' : '黄', result.note + (result.ok ? '' : `（${provider.name} 实弹不可用）`))),
    // 探针标准=运行时标准：启动已按 环境→注册表→config默认 注入，这里报有效值+来源
    item('代理', proxy ? '绿' : '黄', proxy ? proxy + '（' + (process.env.__STUDIO_PROXY_SRC || '环境变量') + '）' : '未解析到（环境/注册表/config 均空）'),
  ];

  // 组2 凭据与额度链路：只检查实际启用且已有专用探针的 Provider。
  const 凭据额度 = [];
  const enabledNames = new Set(enabledProviders.map((provider) => provider.name));
  if (enabledNames.has('claude')) {
    try {
      const cred = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth;
      if (!cred || !cred.accessToken) 凭据额度.push(item('claude 凭据', '红', '凭据文件无 token——claude auth login'));
      else if (cred.expiresAt > Date.now()) 凭据额度.push(item('claude 凭据', '绿', 'token 有效至 ' + new Date(cred.expiresAt).toTimeString().slice(0, 5)));
      else if (cred.refreshToken) 凭据额度.push(item('claude 凭据', '黄', 'token 过期，待自动续期（有 refresh）'));
      else 凭据额度.push(item('claude 凭据', '红', 'token 过期且无 refresh——claude auth login'));
    } catch { 凭据额度.push(item('claude 凭据', '红', '未登录（无凭据文件）——claude auth login')); }
    try {
      const th = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.studio-usage-throttle.json'), 'utf8'));
      const minMs = Math.max(120, Number((cfg.quota || {}).claudeMinIntervalSeconds) > 0 ? Number(cfg.quota.claudeMinIntervalSeconds) : 300) * 1000;
      if (th.lastGood && Date.now() - th.lastGood.at < minMs * 3) 凭据额度.push(item('claude 额度读数', '绿', new Date(th.lastGood.at).toTimeString().slice(0, 5) + ' 读数 · 5h ' + Math.round(th.lastGood.data.fiveHour.utilization) + '%'));
      else if (th.lastGood) 凭据额度.push(item('claude 额度读数', '黄', '读数陈旧（' + new Date(th.lastGood.at).toTimeString().slice(0, 5) + '）' + (th.backoffMs > minMs ? ' · 失败退避中 ' + Math.round(th.backoffMs / 60000) + 'min' : '')));
      else 凭据额度.push(item('claude 额度读数', '黄', '尚无成功读数' + (th.backoffMs > minMs ? '（退避中 ' + Math.round(th.backoffMs / 60000) + 'min）' : '')));
    } catch { 凭据额度.push(item('claude 额度读数', '黄', '尚未查询过')); }
  }
  if (enabledNames.has('codex')) {
    const rl = await require('./lib/quota').getRateLimits(cfg).catch(() => null);
    凭据额度.push(rl ? item('codex 登录态', '绿', 'app-server 正常 · 5h ' + (rl.primary && rl.primary.usedPercent != null ? Math.round(rl.primary.usedPercent) + '%' : '—'))
      : item('codex 登录态', '黄', 'app-server 无响应（未登录或未装，codex 额度盲飞）'));
  }
  if (!凭据额度.length) 凭据额度.push(item('Provider 凭据', '绿', '由各 Provider CLI 自行管理登录态'));

  // 组3 项目与目录
  const 项目目录 = [];
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  for (const [n, p] of Object.entries(reg)) {
    if (!fs.existsSync(p.路径)) 项目目录.push(item(`项目 ${n}`, '黄', '路径不存在：' + p.路径 + '（该项目实弹不可用）'));
    else if (!fs.existsSync(path.join(p.路径, '.git'))) 项目目录.push(item(`项目 ${n}`, '黄', p.路径 + '（非 git 仓库，产出无法落袋）'));
    else 项目目录.push(item(`项目 ${n}`, '绿', p.路径 + (cfg.项目.默认 === n ? ' · 默认' : '')));
  }
  if (!Object.keys(reg).length) 项目目录.push(item('项目注册', '黄', '空——实弹无目标仓库'));
  try {
    const t = path.join(ROOT, '回执', '.probe-' + Date.now());
    fs.writeFileSync(t, 'x'); fs.unlinkSync(t);
    项目目录.push(item('监制台目录', '绿', '九态目录 + 回执/journal 可写'));
  } catch (e) { 项目目录.push(item('监制台目录', '红', '不可写：' + e.message.slice(0, 50))); }

  // 组4 协议资产与配置完整性
  const 协议配置 = [];
  const roleNames = Object.keys(cfg.roles || {});
  const genericDir = path.join(ROOT, '角色协议');
  const legacyDir = path.join(ROOT, '岗位协议');
  const protocolDir = fs.existsSync(genericDir) ? genericDir : legacyDir;
  const commonName = fs.existsSync(path.join(protocolDir, 'common.md')) ? 'common' : '通用';
  const charters = roleNames.length ? [commonName, ...roleNames] : ['通用', '策划', '程序', '美术', 'QA', '装配'];
  const missing = charters.filter((n) => !fs.existsSync(path.join(protocolDir, n + '.md')));
  协议配置.push(missing.length ? item('角色协议', '黄', '缺：' + missing.join('、')) : item('角色协议', '绿', charters.length + ' 份齐全'));
  const lint = [];
  for (const fn of cfg.职能 || []) {
    const candidates = providerRouter.rankProviders(ROOT, cfg, { role: fn, kind: '执行' });
    if (!candidates.length) lint.push(`角色「${fn}」无可用 Provider（领单会失败）`);
  }
  for (const a of cfg.agents || []) if (!(cfg.职能 || []).includes(providerRouter.agentRole(a))) lint.push(`agent ${a.id} 的角色不在角色表`);
  if (cfg.项目 && cfg.项目.默认 && !reg[cfg.项目.默认]) lint.push('默认项目未注册');
  协议配置.push(lint.length ? item('config 完整性', lint.some((x) => x.includes('领单会失败')) ? '红' : '黄', lint.join('；'))
    : item('config 完整性', '绿', '角色↔Provider 路由 / agents / 默认项目 全部合法'));

  // 总灯：有红=阻断；无红有黄=降级；全绿=就绪
  const all = [...运行时, ...凭据额度, ...项目目录, ...协议配置];
  const reds = all.filter((x) => x.级别 === '红'), yellows = all.filter((x) => x.级别 === '黄');
  const data = {
    总灯: reds.length ? '阻断' : yellows.length ? '降级' : '就绪',
    结论: reds.length ? reds.map((x) => x.名称 + '：' + x.note)
      : yellows.length ? yellows.map((x) => x.名称 + '：' + x.note)
      : ['全链路就绪：试跑与实弹均可用'],
    组: { '运行时与 CLI': 运行时, '凭据与额度': 凭据额度, '项目与目录': 项目目录, '协议与配置': 协议配置 },
  };
  envCache = { at: Date.now(), data };
  res.json(data);
});

// ---- 推荐参数（P6）：精力档 + 速度参数（D28 推荐在途=制作人精力参考值）----
app.post('/api/config/recommend', (req, res) => {
  if (!ready(res)) return;
  const { key, value } = req.body || {};
  cfg.推荐 = cfg.推荐 || {};
  if (key === '精力档') {
    if (value !== '低' && value !== '高') return res.status(400).json({ error: '精力档只能是 低/高' });
    cfg.推荐.精力档 = value;
  } else {
    const NUM = { 速度窗口小时: [1, 24], 每档处理数: [1, 10] };
    if (!(key in NUM)) return res.status(400).json({ error: '不可调整的参数：' + key });
    const v = Number(value);
    if (!Number.isInteger(v) || v < NUM[key][0] || v > NUM[key][1]) return res.status(400).json({ error: `取值须在 ${NUM[key][0]}–${NUM[key][1]}` });
    cfg.推荐[key] = v;
  }
  fs.writeFileSync(path.join(ROOT, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  journal.append(ROOT, `推荐参数调整：${key} → ${value}`);
  res.json({ ok: true, 推荐: cfg.推荐 });
});

// ---- 职能编制变更（P6）：直接调各职能人数，编制即上限 ----
app.post('/api/config/staff', (req, res) => {
  if (!ready(res)) return;
  const { 职能, count } = req.body || {};
  const staff = require('./lib/staff');
  const r = staff.setStaff(ROOT, cfg, String(职能 || ''), Number(count));
  if (!r.ok) return res.status(400).json(r);
  fs.writeFileSync(path.join(ROOT, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  journal.append(ROOT, `编制变更：${r.职能} → ${r.count} 人${r.新增.length ? `（新增 ${r.新增.join('、')}）` : ''}${r.退役.length ? `（退役待归 ${r.退役.join('、')}）` : ''}${r.移除.length ? `（移除 ${r.移除.join('、')}）` : ''}`);
  res.json({ ...r, 在途上限: staff.onlineCount(cfg) });
});

// ---- 在途 agent 视角（P3）----
app.get('/api/agents', (req, res) => {
  if (!ready(res)) return;
  const fl = pool.inFlight(ROOT);
  const byAgent = {};
  for (const t of fl) if (t.fm.主办) byAgent[t.fm.主办] = {
    id: t.id, title: t.fm.title, state: t.state, 职能: t.fm.职能, role: t.fm.role || t.fm.职能,
    provider: t.fm.provider || t.fm.供应商 || t.fm.执行池 || null, 领单时间: t.fm.领单时间,
    workspace: t.fm.workspace ? { branch: t.fm.workspace.branch || null, commit: t.fm.workspace.commit || null, isolated: !!t.fm.workspace.isolated } : null,
  };
  const agents = (cfg.agents || []).map((a) => ({ ...a, 手持: byAgent[a.id] || null }));
  const 滞留 = fl.filter((t) => t.fm.滞留告警).map((t) => ({ id: t.id, state: t.state, 时长h: t.fm.滞留时长h }));
  res.json({ agents, 在途数: fl.length, 上限: require('./lib/staff').onlineCount(cfg), 滞留告警: 滞留 });
});

// ---- 工单详情（P8）：正文 + 四追溯链 + 回执 ----
app.get('/api/ticket', (req, res) => {
  if (!ready(res)) return;
  const id = String(req.query.id || '');
  const t = store.find(ROOT, id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  let 回执 = null;
  const rp = path.join(ROOT, '回执', `${id}.md`);
  if (fs.existsSync(rp)) 回执 = { raw: fs.readFileSync(rp, 'utf8'), html: mdHtml(fs.readFileSync(rp, 'utf8')) };
  res.json({ id, state: t.state, fm: t.fm, body: t.body, html: mdHtml(t.body), 链: trace.chains(ROOT, id), 回执 });
});

// 完成的 Integrator 工单由用户手动发布。只做 fast-forward；主分支前进或有脏改动时拒绝。
app.post('/api/workspace/publish', (req, res) => {
  if (!ready(res)) return;
  const id = String((req.body || {}).id || '');
  const t = store.find(ROOT, id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  if (t.state !== '完成' || providerRouter.taskRole(t) !== 'integrator')
    return res.status(400).json({ error: '只有已完成的 Integrator 工单可以发布' });
  const project = runner.projectPath(cfg, t);
  if (!project) return res.status(400).json({ error: '项目未注册或路径不存在' });
  try {
    const result = worktrees.publish(project, t.fm.workspace);
    const at = new Date().toISOString();
    store.update(ROOT, id, (fm) => { fm.workspace = { ...fm.workspace, publishedAt: at, publishedCommit: result.commit }; });
    journal.append(ROOT, `发布集成结果 ${id} → ${result.commit.slice(0, 10)}（fast-forward）`);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- 决策台（P4）：待验收 + 待定夺 ----
app.get('/api/decisions', (req, res) => {
  if (!ready(res)) return;
  const accept = store.list(ROOT, '待验收').map((t) => ({ id: t.id, title: t.fm.title, 职能: t.fm.职能, 验收方式: t.fm.验收方式, QA: t.fm.QA, 项目: t.fm.项目 }));
  const escal = store.list(ROOT, '待定夺').map((t) => ({ id: t.id, title: t.fm.title, 职能: t.fm.职能, 自修次数: t.fm.自修次数 || 0, 项目: t.fm.项目 }));
  res.json({ 待验收: accept, 待定夺: escal, 积压闸: (cfg.闸值 || {}).待验收积压闸, 积压: accept.length });
});

// ---- 两道闸状态（P1/P2 横幅）----
app.get('/api/gates', async (req, res) => {
  if (!ready(res)) return;
  try {
    const locks = await gates.allLocks(cfg);
    const providerLocks = {};
    for (const name of Object.keys(providerRegistry.configs(cfg))) providerLocks[name] = locks[name];
    const rec = require('./lib/recommend').recommend(ROOT, cfg, providerLocks);
    res.json({ paused: require('./lib/core/state').read(ROOT).paused, locks: providerLocks, 推荐: rec });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/gate/pause', (req, res) => {
  if (!ready(res)) return;
  const { scope, value } = req.body || {};
  if (!['global', ...Object.keys(providerRegistry.configs(cfg))].includes(scope)) return res.status(400).json({ error: '非法 scope' });
  const p = gates.setPaused(ROOT, scope, value);
  journal.append(ROOT, `暂停闸门：${scope} → ${value ? '合' : '开'}`);
  res.json({ ok: true, paused: p });
});

// ---- 生命周期动作（P4/P8 按钮）----
const ACTIONS = {
  定稿: (b) => life.定稿(ROOT, b.id),
  投池: (b) => life.投池(ROOT, b.id),
  撤回: (b) => life.撤回(ROOT, b.id),
  废弃: (b) => life.废弃(ROOT, b.id),
  收回: (b) => life.收回(ROOT, b.id),
  交产出: (b) => life.交产出(ROOT, b.id, b.回执),
  QA裁定: (b) => life.QA裁定(ROOT, cfg, b.id, !!b.通过),
  定夺: (b) => life.定夺(ROOT, b.id, b.决定),
  验收: (b) => life.验收(ROOT, b.id, !!b.通过),
  失败分诊: (b) => life.失败分诊(ROOT, b.id, b.决定), // D31：重投/上呈（废弃走通用废弃）
  解除复核: (b) => life.解除待复核(ROOT, b.id, b.说明), // D36：核对新版后解除
};
app.post('/api/act/:name', (req, res) => {
  if (!ready(res)) return;
  const fn = ACTIONS[req.params.name];
  if (!fn) return res.status(404).json({ error: '未知动作' });
  try { const r = fn(req.body || {}); res.status(r.ok ? 200 : 400).json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 领单（模拟/手动触发 agent 拉单）----
app.post('/api/claim', async (req, res) => {
  if (!ready(res)) return;
  try { const r = await pool.claim(ROOT, cfg, String((req.body || {}).agent || '')); res.status(r.ok ? 200 : 409).json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 起草/编辑工单（P7）----
app.post('/api/draft', (req, res) => {
  if (!ready(res)) return;
  const b = req.body || {};
  // 中文项目名放行后，编号前缀也吃中文（如 甲-01）
  if (!/^[A-Z0-9一-鿿]+(?:-\d+)*$/.test(String(b.id || ''))) return res.status(400).json({ error: '编号格式非法（前缀-数字，如 TK-13 / 甲-01）' });
  // R6 已按 D43④ 修订：美术允许委托，首样保留是拆单纪律（每类首张 保留 定调）而非代码硬拦
  const role = b.role || b.角色 || b.职能 || (cfg.职能 && cfg.职能[0]) || 'generalist';
  const fm = {
    id: b.id, title: b.title || '未命名', role, 职能: role, 产出物类型: b.产出物类型 || '文档',
    优先级: b.优先级 || 'P1', 规模: b.规模 || '单兵', QA: b.QA || '关', 验收方式: b.验收方式 || '保留',
    预计时间: b.预计时间 || '', 预计token: b.预计token || '',
    项目: b.项目 || (cfg.项目 && cfg.项目.默认) || '', // D32：执行 agent 据此定位目标仓库
    创建时间: b.创建时间 || new Date().toISOString().slice(0, 10), 更新时间: new Date().toISOString(),
  };
  if (b.阶段) fm.阶段 = String(b.阶段); // D43 阶段章
  if (b.父单) fm.父单 = b.父单;
  if (b.依赖) fm.依赖 = b.依赖;
  if (b.依据) fm.依据 = b.依据;
  if (b.required_capabilities || b.所需能力) fm.required_capabilities = b.required_capabilities || b.所需能力;
  if (b.write_scope || b.写入范围) fm.write_scope = b.write_scope || b.写入范围;
  if (b.routing || b.路由) fm.routing = b.routing || b.路由;
  const exist = store.find(ROOT, b.id);
  if (exist) {
    if (exist.state !== '草稿') return res.status(400).json({ error: `只有草稿可编辑（当前 ${exist.state}）` });
    const r = store.update(ROOT, b.id, (f) => { Object.assign(f, fm); return { body: b.body != null ? b.body : undefined }; });
    return res.json({ ...r, edited: true });
  }
  const r = store.create(ROOT, b.id, fm, b.body || '## 范围\n\n## 不要做\n\n## 验收标准\n\n## 完工要求\n');
  if (r.ok) journal.append(ROOT, `起草 ${b.id}（${fm.职能}）`);
  res.status(r.ok ? 200 : 400).json(r);
});

// ---- 锚号迁移（R5）：改编号广播全局，更新所有引用旧锚号的工单 ----
app.post('/api/anchor/migrate', (req, res) => {
  if (!ready(res)) return;
  const { 旧, 新, docKey } = req.body || {};
  if (!旧 || !新) return res.status(400).json({ error: '旧锚号/新锚号必填' });
  try { res.json(trace.migrateAnchor(ROOT, String(旧), String(新), docKey ? String(docKey) : null)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 参数与额度（P6）----
app.get('/api/config', (req, res) => { if (!ready(res)) return; res.json({
  闸值: cfg.闸值, 执行池: cfg.执行池, providers: cfg.providers || {}, roles: cfg.roles || {}, routing: cfg.routing || {},
  agents: cfg.agents, 职能: cfg.职能, 推荐: cfg.推荐 || {}, 项目: cfg.项目 || {}, 模型: cfg.模型 || {},
  执行器: cfg.执行器 || {}, quota: cfg.quota || {}, server: cfg.server || {}, profile: cfg.profile || 'game-studio',
}); });
app.get('/api/quota', async (req, res) => {
  if (!ready(res)) return;
  const [rl, cu] = await Promise.all([quota.getRateLimits(cfg), quota.getClaudeUsage(cfg)]);
  res.json({ codex: rl ? { windows: quota.windowsOf(rl) } : null, claude: cu ? { windows: quota.claudeWindows(cu) } : null });
});

// ---- 风格库（P5 · D12 精选制，审批点④落地）----
const stylelib = require('./lib/stylelib');
app.get('/api/style-lib', (req, res) => {
  if (!ready(res)) return;
  res.json({ 标杆: stylelib.parseAxioms(ROOT), 美术: stylelib.listArt(ROOT) });
});
// 入标杆（策划单 · 完成态；人工提炼是精选制的精髓，不自动摘录）
app.post('/api/stylelib/axiom', (req, res) => {
  if (!ready(res)) return;
  const { 标题, 正文, 源单 } = req.body || {};
  let axProj = String((req.body || {}).项目 || '').trim() || null;
  if (源单) {
    const t = store.find(ROOT, 源单);
    if (!t) return res.status(400).json({ error: '源单不存在：' + 源单 });
    if (t.state !== '完成') return res.status(400).json({ error: `只有完成单可入标杆（${源单} 当前 ${t.state}）` });
    axProj = t.fm.项目 || (cfg.项目 && cfg.项目.默认) || axProj; // 归属跟源单走（多项目视界）
  }
  const r = stylelib.addAxiom(ROOT, { 标题, 正文, 源单, 项目: axProj });
  if (!r.ok) return res.status(400).json(r);
  journal.append(ROOT, `入标杆：「${r.标题}」（来源 ${源单 || '手工'}，审批点④）`);
  res.json(r);
});
app.post('/api/stylelib/axiom-remove', (req, res) => {
  if (!ready(res)) return;
  const r = stylelib.removeAxiom(ROOT, (req.body || {}).标题);
  if (!r.ok) return res.status(400).json(r);
  journal.append(ROOT, `移出标杆：「${(req.body || {}).标题}」（精选制反向闸）`);
  res.json(r);
});
// 入美术库（美术/装配单 · 完成态；源文件限项目仓库内）
app.post('/api/stylelib/art', (req, res) => {
  if (!ready(res)) return;
  const { 源单, 源路径, 说明 } = req.body || {};
  const t = 源单 ? store.find(ROOT, 源单) : null;
  if (源单 && !t) return res.status(400).json({ error: '源单不存在：' + 源单 });
  if (t && t.state !== '完成') return res.status(400).json({ error: `只有完成单可入库（${源单} 当前 ${t.state}）` });
  const projName = (t && t.fm.项目) || (cfg.项目 && cfg.项目.默认);
  const proj = cfg.项目 && cfg.项目.注册 && cfg.项目.注册[projName];
  const r = stylelib.addArt(ROOT, { 源路径, 项目路径: proj && proj.路径, 说明, 源单, 项目: projName });
  if (!r.ok) return res.status(400).json(r);
  journal.append(ROOT, `入美术库：${r.name}（来源 ${源单 || '手工'}，审批点④）`);
  res.json(r);
});
app.post('/api/stylelib/art-remove', (req, res) => {
  if (!ready(res)) return;
  const r = stylelib.removeArt(ROOT, (req.body || {}).name);
  if (!r.ok) return res.status(400).json(r);
  journal.append(ROOT, `移出美术库：${(req.body || {}).name}`);
  res.json(r);
});

// ---- 可选模型（D38 扩展）：监测 + 配置增补。codex 读 ~/.codex/config.toml 的 model，
// claude 探 CLI 存在（别名 sonnet/opus/haiku 稳定）；config.模型.可选 可手动增补 ----
app.get('/api/models', (req, res) => {
  if (!ready(res)) return;
  const os = require('os');
  const opt = (cfg.模型 && cfg.模型.可选) || {};
  let codexDetect = null;
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
    const m = toml.match(/^\s*model\s*=\s*"([^"]+)"/m);
    if (m) codexDetect = m[1];
  } catch { /* 无 codex 配置 */ }
  const claudeCli = fs.existsSync(path.join(os.homedir(), '.local', 'bin', 'claude.exe'))
    || fs.existsSync(path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'));
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  const result = {
    codex: { 检测: codexDetect, 可选: uniq([codexDetect, ...(opt.codex || [])]) },
    claude: { cli: claudeCli, 可选: uniq(opt.claude || ['sonnet', 'opus', 'haiku']) },
  };
  for (const provider of providerRegistry.list(cfg)) {
    result[provider.name] = result[provider.name] || {};
    result[provider.name].adapter = provider.adapter;
    result[provider.name].enabled = provider.enabled !== false;
    result[provider.name].可选 = uniq([...(result[provider.name].可选 || []), ...(provider.models || []), ...(opt[provider.name] || [])]);
    if (provider.defaultModel) result[provider.name].默认 = provider.defaultModel;
  }
  res.json(result);
});

// ---- Provider / 动态路由快照：UI 与诊断只读，不暴露凭据环境变量的值 ----
app.get('/api/providers', (req, res) => {
  if (!ready(res)) return;
  const roles = Object.keys(cfg.roles || {}).length ? Object.keys(cfg.roles) : (cfg.职能 || []);
  const providers = providerRegistry.list(cfg).map((provider) => ({
    name: provider.name,
    adapter: provider.adapter,
    enabled: provider.enabled !== false,
    capabilities: provider.capabilities || [],
    defaultModel: provider.defaultModel || '',
    roles: provider.roles || [],
    scores: provider.scores || {},
  }));
  const routes = {};
  for (const role of roles) routes[role] = providerRouter.rankProviders(ROOT, cfg, { role, kind: role === 'reviewer' ? '质检' : '执行' });
  res.json({ providers, roles, routes, recent: providerHistory.read(ROOT, 50) });
});

// ---- 单个 agent 模型档调整（D38）：空 = 清覆盖回池默认 ----
app.post('/api/agent-model', (req, res) => {
  if (!ready(res)) return;
  const { id, 模型 } = req.body || {};
  const a = (cfg.agents || []).find((x) => x.id === id);
  if (!a) return res.status(400).json({ error: 'agent 不存在：' + id });
  const v = String(模型 || '').trim();
  if (v) a.模型 = v; else delete a.模型;
  fs.writeFileSync(path.join(ROOT, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  journal.append(ROOT, `模型档调整：${id} → ${v || '（池默认）'}`);
  res.json({ ok: true, agents: cfg.agents });
});

// ---- 阶段字典与阶段标准（D43）：字典=项目可配默认 L0-L2；标准=阶段标准.md 明文（缺则落模板）----
const stages = require('./lib/stages');
app.get('/api/stages', (req, res) => {
  if (!ready(res)) return;
  if (stages.ensureStandards(ROOT, cfg)) journal.append(ROOT, '阶段标准.md 模板已落盘（首次使用）');
  const proj = String(req.query.项目 || '') || (cfg.项目 && cfg.项目.默认) || '';
  res.json({ 阶段: stages.stagesFor(cfg, proj), 标准: stages.parseStandards(ROOT) });
});

// ---- 单个 agent 执行池切换：决定 CLI 归属与额度闸。切池清模型个体覆盖（旧池模型名对新池无意义）；
// 在途安全：领单时池名已盖章进工单 frontmatter，执行器只认章——切池只影响下一单 ----
app.post('/api/agent-pool', (req, res) => {
  if (!ready(res)) return;
  const { id, 池 } = req.body || {};
  const a = (cfg.agents || []).find((x) => x.id === id);
  if (!a) return res.status(400).json({ error: 'agent 不存在：' + id });
  const v = String(池 || '').trim();
  if (v === 'auto') {
    delete a.provider; delete a.供应商; delete a.执行池; delete a.模型;
    a.routing = { ...(a.routing || {}), mode: 'auto' };
    saveCfg();
    journal.append(ROOT, `Provider 路由切换：${id} → 自动择优`);
    return res.json({ ok: true, agents: cfg.agents });
  }
  if (!providerRegistry.configs(cfg)[v]) return res.status(400).json({ error: '未知 Provider：' + v });
  if ((a.provider || a.供应商 || a.执行池) !== v) {
    const hadModel = !!a.模型;
    a.provider = v; delete a.供应商; delete a.执行池; delete a.模型;
    a.routing = { ...(a.routing || {}), mode: 'pin' };
    saveCfg();
    journal.append(ROOT, `Provider 路由切换：${id} → ${v}${hadModel ? '（模型覆盖已清，回 Provider 默认）' : ''}`);
  }
  res.json({ ok: true, agents: cfg.agents });
});

// ---- 上游改动标记（复查#8 = D36）：锚号改版 → 引用它的未完成单全标待复核 ----
app.post('/api/review-flag', (req, res) => {
  if (!ready(res)) return;
  const { 锚号, 说明 } = req.body || {};
  if (!锚号) return res.status(400).json({ error: '缺 锚号（如 战斗系统#战斗-03）' });
  res.json(life.标记待复核(ROOT, String(锚号), 说明));
});

// ---- 需注意计数（Electron 桌面通知轮询用）----
app.get('/api/attention', (req, res) => {
  if (!ready(res)) return;
  const stalled = ['在途', '质检', '待定夺'].reduce((n, s) => n + store.list(ROOT, s).filter((t) => t.fm.滞留告警).length, 0);
  res.json({
    待验收: store.list(ROOT, '待验收').length,
    待定夺: store.list(ROOT, '待定夺').length,
    执行失败: store.list(ROOT, '执行失败').length,
    滞留告警: stalled,
  });
});

// ---- 总览动态 + 变更令牌 ----
app.get('/api/journal', (req, res) => { if (!ready(res)) return; res.json(journal.readLatest(ROOT)); });
app.get('/api/pulse', (req, res) => {
  if (!ready(res)) return;
  let acc = 0; const fold = (n) => { acc = ((acc * 31) + n) % Number.MAX_SAFE_INTEGER; };
  for (const s of store.STATES) { const d = store.stateDir(ROOT, s); try { for (const f of fs.readdirSync(d)) { const st = fs.statSync(path.join(d, f)); fold(Math.floor(st.mtimeMs)); } } catch { /* 空目录 */ } }
  res.json({ token: String(acc) });
});

app.use(express.static(path.join(__dirname, 'public')));
// 风格库静态服务（美术库缩略图直读；express.static 自带路径穿越防护）
if (!initError) app.use('/stylelib-files', express.static(path.join(ROOT, '风格库')));
const port = (cfg && cfg.server && cfg.server.port) || 4270;
// 滞留检查：启动跑一次 + 每 30 分钟一次（R3：只诊断告警，不自动撤回）
function 巡检() { if (initError) return; try { life.滞留检查(ROOT, cfg); } catch (e) { console.error('滞留检查失败：' + e.message); } }
// 代理自愈（0.8.1）：exe 的网络能力不再取决于"谁怎么启动它"。
// 解析链：进程环境 → 系统注册表 → config 网络.代理默认；解析结果注入自身进程环境，
// 此后所有子进程（curl / codex / claude CLI）统一继承。来源记号供探针如实报告。
function injectProxy() {
  if (initError) return;
  if (process.env.HTTPS_PROXY || process.env.https_proxy) { process.env.__STUDIO_PROXY_SRC = '环境变量'; return; }
  const fromReg = require('./lib/quota').getProxyUrl(); // env 为空时它走注册表
  const p = fromReg || (cfg.网络 && cfg.网络.代理默认) || '';
  if (!p) return;
  process.env.HTTPS_PROXY = p; process.env.HTTP_PROXY = p;
  process.env.https_proxy = p; process.env.http_proxy = p;
  process.env.__STUDIO_PROXY_SRC = fromReg ? '系统注册表' : 'config 默认';
  console.log(`代理注入：${p}（${process.env.__STUDIO_PROXY_SRC}）`);
}

function start() {
  return new Promise((resolve, reject) => {
    injectProxy();
    const srv = app.listen(port, '127.0.0.1', () => {
      console.log(initError ? `监制台启动但未就绪：${initError}` : `监制台已启动：http://127.0.0.1:${port}`);
      巡检();
      if (!initError) setInterval(巡检, 30 * 60000).unref();
      // 自动记账（D35）：定期把工单流转/回执/journal git commit 落袋，间隔读 config（0=关）
      if (!initError) {
        const 记账分 = (cfg.执行器 || {}).记账间隔分钟 ?? 10;
        if (记账分 > 0) {
          const ledger = require('./lib/ledger');
          const 记 = () => ledger.commitStudio(ROOT, (ok, note) => { if (ok) console.log('自动记账：' + note); });
          setInterval(记, 记账分 * 60000).unref();
        }
      }
      // 执行器随服务自动开工（D30 修订：开 exe 即开工厂，无需手动点启动）；
      // 停止按钮只管本次会话，"别干活"的常设语义交给暂停闸门/额度锁
      if (!initError) { try { require('./lib/runner').start(ROOT, () => cfg); } catch (e) { console.error('执行器启动失败：' + e.message); } }
      resolve({ port, server: srv, initError });
    });
    srv.on('error', reject);
  });
}
module.exports = { start, port, initError };
if (require.main === module) start().then(({ initError: e }) => { if (e) process.exitCode = 1; }).catch((e) => { console.error(e.message); process.exit(1); });
