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
const roster = require('./lib/roster');
const life = require('./lib/lifecycle');
const trace = require('./lib/trace');
const quota = require('./lib/quota');
const journal = require('./lib/journal');
const dialogscan = require('./lib/dialogscan'); // 原生对话框哑弹扫描（施工令-012），/api/env 自检用

// ROOT 可变（2026-08-08 首次运行向导）：没有 studio.config.json 时不再是死局——
// 向导建完工作区后**就地重挂**，不用重启进程。模块作用域的 let，所有闭包读到的都是新值。
const 起动时刻 = new Date().toISOString(); // 版本自证用：跑了多久，配合版本号判断是不是刚换的那一份
let ROOT = config.resolveRoot();
let cfg = null; let initError = null;
if (!ROOT) initError = '未找到监制台仓库（缺 studio.config.json）。';
else { try { cfg = config.load(ROOT); store.ensureDirs(ROOT); } catch (e) { initError = '读配置失败：' + e.message; } }

/* ---- 官方桩闸 STUDIO_STUB=1（施工令-039，案源 037 首启真派发 40s 事故 · 021 同族第二案）----
   工程队起桩台此前各自手搓空转钩（037 手搓 Module._load、038 手搓改写导出 + 越界计数器），
   两起事故全因**手搓漏面**：漏的从来不是自己写的那几个调用点，是没想到的那一个（server 自身
   的开工调用、巡检定时器、向导重挂）。根治办法不是让每个桩台作者更小心，是把闸做进服务本身。

   硬关口径 = 直接空转 runner 模块的**派发导出**。模块对象在 require 缓存里只有一份，于是
   任何调用方（路由 / 巡检 setInterval / 向导就地重挂 / 今后新增的任何一处）拿到的都是哑函数，
   不靠调用点自觉、不随代码演进漏面。外呼面（额度真调 / 连通探测）同理停用——桩台既不派发也不计费。
   不置位时本块整体不执行，行为逐位不变。 */
const STUB = process.env.STUDIO_STUB === '1';
// 空转记录：哪些派发/外呼入口被调过又被拦下。随 /api/runner 下发，桩台作者一眼看清
// 「这台确实被调了、也确实什么都没干」——037 的事故正是没人看得见这一层才烧了 40 秒。
const 桩台拦截 = [];
if (STUB) {
  const r = require('./lib/runner');
  // 生命周期面（服务开工/停手必调）：空转即可，被调是正常的
  for (const k of ['start', 'stop', 'stopLoop']) r[k] = function 桩台空转() { 桩台拦截.push(k); };
  // 真派发面：拉起会话 / 掐会话 / 排调度循环——哑掉，且返回值取"什么都没发生"的形状
  r.startLoop = function 桩台空转() { 桩台拦截.push('startLoop'); };
  r.tick = async function 桩台空转() { 桩台拦截.push('tick'); return { skipped: true, reason: '桩台模式：派发面已硬关' }; };
  r.startWork = async function 桩台空转() { 桩台拦截.push('startWork'); return false; };
  r.killTicket = function 桩台空转() { 桩台拦截.push('killTicket'); return false; };
  // 外呼面：额度查询会真调 CLI/HTTP（计费+限流），连通探测会真发请求
  const q = require('./lib/quota');
  q.getRateLimits = async () => null; q.queryRateLimits = async () => null;
  q.getClaudeUsage = async () => null; q.queryClaudeUsage = async () => null;
  q.eagerRefresh = () => {};
  // 额度闸从严：桩台一律不放行（真派发面已哑，这里是第二道）
  q.checkGate = async () => ({ allowed: false, threshold: 0, reason: '桩台模式：额度查询停用，一律不放行' });
  // 池衡余额外呼（H99 · 施工令-045）：deepseek 系的 /user/balance 是真 HTTP 请求，桩台一律不发。
  // 额度那两池的外呼已随 quota 一并哑掉（gates.allLocks 读它），于是桩台的三池读数**全报盲区**——
  // 这正是桩台该有的样子：读不到就说读不到，绝不编数（要件 1）。
  const pb = require('./lib/pm/poolbalance');
  pb.探余额 = async () => ({ error: '桩台模式：余额外呼已停用' });
  const np = require('./lib/netprobe');
  np.httpProbe = async () => null;
  np.探 = async () => ({ 直连: null, 经代理: null });
  // 项管脑（H49）：五个入口每个都 spawn 一次 claude CLI，是全站最大的一笔计费外呼。
  // 「零计费」离了这一面就是空话——起草/切单/收口/答疑/代裁一律哑掉，回调按「桩台不作业」回。
  const brain = require('./lib/pm/brain');
  for (const k of ['draftTicket', 'cut', 'closeout', 'answer', 'adjudicateReferral']) {
    brain[k] = function 桩台空转(...args) {
      桩台拦截.push('brain.' + k);
      // 回调取「最后一个函数参数」而不是「最后一个参数」：draftTicket 自施工令-040 起
      // 尾巴上多了一个 opts（粒ID 挂接），死认末位就会把 opts 当 cb，桩台从此不回调——
      // 手搓漏面的老毛病换个地方复发（本文件顶上那段注释说的就是它）。
      const cb = [...args].reverse().find((a) => typeof a === 'function');
      if (cb) cb({ ok: false, error: '桩台模式：项管脑外呼已停用' });
    };
  }
}
// /api/runner 的桩台印：桩台模式下「运行」恒 false，且带 桩台:true 让调用方一眼看出这台不是实弹台
const 桩台印 = (st) => (STUB ? { ...st, 桩台: true, 运行: false, 桩台拦截: [...桩台拦截] } : st);

const app = express();
app.use(express.json({ limit: '2mb' }));
// ---- 远程访问（0.17.10）：默认只听 127.0.0.1；config.网络.远程.开 = true 时听 0.0.0.0，
// 一切请求须持令牌（?t= 首访换 cookie / x-studio-token 头）。实弹台有项目仓全写权，令牌是底线。
const REMOTE = () => (cfg && cfg.网络 && cfg.网络.远程) || {};
// 令牌三候选（2026-08-21 体检）：环境变量 > 凭据.json（.gitignore 第 4 行早已排除）> 配置文件。
// 案源：令牌原先明文写在 studio.config.json 的 网络.远程.令牌，而该文件**被版本控制**，
// 已随 97 次自动记账推进远端仓（该仓私有、远程监听关着，故是隐患不是失火）。
// 同一份 .gitignore 早就把 凭据.json 排除在外——「密钥不进库」是既定纪律，只有这一条漏网。
// 配置里保留旧值仍可用（不砸现网），但新写一律落 凭据.json；置空即彻底搬走。
function 远程令牌() {
  const 环 = String(process.env.STUDIO_REMOTE_TOKEN || '').trim();
  if (环) return 环;
  try {
    const c = require('./lib/creds').read(ROOT);
    const t = c && c.远程令牌;
    if (t) return String(t).trim();
  } catch { /* 无凭据档：回落配置 */ }
  return String(REMOTE().令牌 || '').trim();
}
const isLocalReq = (req) => {
  const ip = String(req.socket.remoteAddress || '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};
const tokenOk = (req) => {
  const tk = 远程令牌();
  if (!tk) return false;
  const got = req.query.t || req.headers['x-studio-token'] || (String(req.headers.cookie || '').match(/studio_t=([\w-]+)/) || [])[1];
  return got === tk;
};
app.use((req, res, next) => {
  // 硬约束：**没令牌就不许开远程**。原样只在写配置那一刻补生成，
  // 而人手把配置里的令牌删空之后，开关仍是 true —— 那一刻门就是敞的。
  const remoteOn = !!REMOTE().开 && !!远程令牌();
  if (!isLocalReq(req)) {
    if (!remoteOn) return res.status(403).json({ error: '远程访问未开启' });
    if (!tokenOk(req)) return res.status(401).send('<meta charset="utf-8">需要访问令牌：请用带 ?t=令牌 的链接打开');
    if (req.query.t) res.setHeader('Set-Cookie', `studio_t=${req.query.t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
    return next(); // 令牌即身份，远程写放行
  }
  // 本机请求维持原 CSRF 护栏：写请求校验本机 Host + 同源 Origin
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!LOCAL.has(host) && !tokenOk(req)) return res.status(403).json({ error: '拒绝：非本机写请求' });
  const o = req.headers.origin;
  if (o) { let h = null; try { h = new URL(o).hostname; } catch { h = null; }
    if ((!h || !LOCAL.has(h)) && !tokenOk(req)) return res.status(403).json({ error: '拒绝：跨源写请求' }); }
  next();
});
const ready = (res) => { if (initError) { res.status(500).json({ error: initError, 需要向导: !ROOT }); return false; } return true; };

// ---- 首次运行向导（2026-08-08）：缺 studio.config.json 不再是死局 ----
// 旧样：resolveRoot 返回 null → initError → main.js showErrorBox + quit。
// 而**加项目的 UI 就在那个进不去的 app 里**，于是新用户只能先手写 JSON。
// 这两个端点**不过 ready() 闸**——它们正是用来把 app 从未就绪状态里捞出来的。
const setup = require('./lib/setup');
app.get('/api/setup/state', (req, res) => {
  res.json({
    需要向导: !ROOT || !!initError,
    当前工作区: ROOT || null,
    错误: initError || null,
    候选目录: setup.候选目录(),
  });
});
app.post('/api/setup', (req, res) => {
  if (!isLocalReq(req)) return res.status(403).json({ error: '建工作区只能在本机操作' });
  const r = setup.建工作区((req.body || {}).目录);
  if (!r.ok) return res.status(400).json(r);
  try {
    ROOT = r.root;                       // 就地重挂：省掉一次重启
    cfg = config.load(ROOT);
    store.ensureDirs(ROOT);
    docs.setZones(cfg.文档分区);
    initError = null;
    journal.append(ROOT, `首次运行向导：工作区就位于 ${ROOT}（${r.新建 ? '新建配置' : '沿用已有配置'}）`);
    try { runner.start(ROOT, () => cfg); } catch { /* 执行器起不来不挡向导，参数页还能手动开 */ }
  } catch (e) {
    initError = '向导建完但加载失败：' + e.message;
    return res.status(500).json({ ok: false, error: initError });
  }
  res.json({ ...r, 就绪: true });
});

// ---- 凭据托管（2026-08-08 路 B：订阅态归 CLI，key 归 app）----
const creds = require('./lib/creds');
// 官方登录命令：可见拉起，不做无头（登录本来就是交互动作，藏进无头进程是自找麻烦——
// 同施工令-011「编辑器绝对可见化」的道理）。命令可在 config.执行器.登录命令 里覆盖。
const 登录命令 = (厂商) => {
  const 覆盖 = ((cfg || {}).执行器 || {}).登录命令 || {};
  if (覆盖[厂商]) return String(覆盖[厂商]);
  if (厂商 === 'codex') return 'codex login';
  return `"${runner.resolveCli('claude').cmd}" auth login`;
};
// 登录命令的可执行体在不在（施工令-027「不可用的按钮不许摆着」）：
// 不在就不给按钮——点了只会弹一个报 not recognized 的黑窗，那不叫功能。
// 命令被 config.执行器.登录命令 覆盖过的，视为用户自己知道在干什么，一律放行。
const 登录可用 = (厂商) => new Promise((resolve) => {
  if ((((cfg || {}).执行器 || {}).登录命令 || {})[厂商]) return resolve(true);
  const cmd = 厂商 === 'codex' ? 'codex' : runner.resolveCli('claude').cmd;
  if (/[\\/:]/.test(cmd)) return resolve(fs.existsSync(cmd)); // 绝对路径：直接看文件在不在
  require('child_process').execFile('where', [cmd], { timeout: 5000, windowsHide: true }, (e) => resolve(!e));
});
// 订阅态四档（施工令-027 圆点语义统一）：可用=绿 / 受限=黄（能自愈，无需人管）/ 失效=红（要人重登）/ 未知=灰（探不到，别假绿也别乱报红）。
// note **不含厂商名**——名字由前端的 <b>厂商</b> 出，两边都写就是 08-09 巡检抓到的「codex codex …」叠字。
app.get('/api/creds', async (req, res) => {
  if (!ready(res)) return;
  const os2 = require('os');
  // 订阅态：claude 读凭据文件、codex 问 app-server（本地零 token）——app 不存它们的任何东西
  let claude订阅;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os2.homedir(), '.claude', '.credentials.json'), 'utf8')).claudeAiOauth;
    if (!c || !c.accessToken) claude订阅 = { 态: '失效', 已登录: false, note: '凭据文件里没有 token，需重新登录' };
    else if (c.expiresAt > Date.now()) claude订阅 = { 态: '可用', 已登录: true, note: 'token 有效至 ' + new Date(c.expiresAt).toTimeString().slice(0, 5) };
    else if (c.refreshToken) claude订阅 = { 态: '受限', 已登录: true, note: 'token 已过期，下次调用凭 refresh 自动续期' };
    else claude订阅 = { 态: '失效', 已登录: false, note: 'token 过期且无 refresh，需重新登录' };
  } catch (e) {
    claude订阅 = (e && e.code === 'ENOENT')
      ? { 态: '失效', 已登录: false, note: '本机没有凭据文件（未登录）' }
      : { 态: '未知', 已登录: false, note: '凭据文件读不动：' + String(e && e.message).slice(0, 40) };
  }
  // codex 没有可读的凭据文件，只能问 app-server：无响应时「未装 / 未登录 / 服务没起」三者分不清，
  // 那就是**未知**（灰），不是失效（红）——按施工令-027 的圆点语义如实呈。
  const rl = await require('./lib/quota').getRateLimits(cfg).catch(() => null);
  const w0 = rl ? (require('./lib/quota').windowsOf(rl)[0] || null) : null;
  const codex订阅 = rl
    ? { 态: '可用', 已登录: true, note: 'app-server 应答' + (w0 ? ` · ${w0.label}已用 ${w0.pct}%` : '') }
    : { 态: '未知', 已登录: false, note: 'app-server 无响应——未装 / 未登录 / 服务没起，探不出是哪种（额度盲飞）' };
  // 本处理器改成 async 之后多了一条纪律：express 4 不接管 async 抛出的异常，
  // 漏抛一次这个请求就永远不回，凭据卡在"读取中…"上转到天荒地老。整体兜底，宁可如实报错。
  try {
    const [claude可登, codex可登] = await Promise.all([登录可用('claude'), 登录可用('codex')]);
    res.json({
      订阅: {
        claude: { ...claude订阅, 可登录: claude可登, 命令: 登录命令('claude') },
        codex: { ...codex订阅, 可登录: codex可登, 命令: 登录命令('codex') },
      },
      托管: creds.list(ROOT),
      可加密: creds.可加密(),
      登录命令: { claude: 登录命令('claude'), codex: 登录命令('codex') },
    });
  } catch (e) {
    res.status(500).json({ error: '凭据探测失败：' + String(e && e.message).slice(0, 120) });
  }
});
app.post('/api/auth/login', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '登录只能在本机操作' });
  const 厂商 = String((req.body || {}).厂商 || '').trim();
  if (!['claude', 'codex'].includes(厂商)) return res.status(400).json({ error: '厂商只能是 claude / codex' });
  const 命令 = 登录命令(厂商);
  try {
    // start 开一个可见控制台跑官方登录命令：浏览器授权由第一方完成，
    // app 只负责拉起与事后验收（路 B 的全部内容）。
    require('child_process').spawn('cmd', ['/c', 'start', '监制台登录', 'cmd', '/k', 命令],
      { detached: true, windowsHide: false }).unref();
  } catch (e) {
    return res.status(500).json({ error: '拉起登录终端失败：' + e.message, 命令 });
  }
  journal.append(ROOT, `拉起 ${厂商} 官方登录（路 B：授权全程第一方，app 只验收）`);
  res.json({ ok: true, 命令, 提示: '在弹出的终端里完成登录，回来点「重新检测」' });
});
app.post('/api/creds', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '密钥管理只能在本机操作' });
  const { 池, key, base, 模型 } = req.body || {};
  const r = creds.setKey(ROOT, 池, { key, base, 模型 });
  if (!r.ok) return res.status(400).json(r);
  journal.append(ROOT, `凭据托管：${r.池} 已存 key（${r.指纹}，DPAPI 密文落盘，明文不入配置）`);
  res.json(r);
});
app.post('/api/creds/remove', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '密钥管理只能在本机操作' });
  const r = creds.remove(ROOT, String((req.body || {}).池 || ''));
  if (!r.ok) return res.status(400).json(r);
  journal.append(ROOT, `凭据托管：${(req.body || {}).池} 的 key 已删除`);
  res.json(r);
});
const mdHtml = (s) => sanitizeHtml(marked.parse(s || ''), { allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2']) });

// ---- 工单池：全状态板（P2/P9甘特/P10树形 共用数据源）----
app.get('/api/board', (req, res) => {
  if (!ready(res)) return;
  const snap = store.snapshot(ROOT);
  const showHidden = req.query.含隐藏 === '1';
  let 隐藏数 = 0;
  for (const s of store.STATES) snap[s] = snap[s].filter((t) => { if (t.fm.隐藏) { 隐藏数++; return showHidden; } return true; });
  const out = {};
  for (const s of store.STATES) out[s] = snap[s].map((t) => ({
    隐藏: !!t.fm.隐藏,
    id: t.id, title: t.fm.title, 职能: t.fm.职能, 优先级: t.fm.优先级, 规模: t.fm.规模,
    QA: t.fm.QA, 验收方式: t.fm.验收方式, 主办: t.fm.主办 || null, 项目: t.fm.项目 || null, // D42 多项目视界按此归属
    阶段: t.fm.阶段 || null, 预计时间: t.fm.预计时间 || null, // D43 流程视图用
    父单: t.fm.父单 || null, 依赖: t.fm.依赖 || null, 管线: t.fm.管线 || null, // H51 管线章
    父单类型: t.fm.父单类型 || null,
    // H103 · 施工令-058：专项挂链 + 伪单印。迁移至专项 有值 = 这张单是被实体化掉的**容器伪单**，
    // 工单板据此把它从盘面上摘掉（要件5「工单板不再显示专项伪单」）——纸面还在，只是不占条位。
    专项: t.fm.专项 || null, 迁移至专项: t.fm.迁移至专项 || null,
    领单时间: t.fm.领单时间 || null, 交付时间: t.fm.交付时间 || null, 滞留告警: !!t.fm.滞留告警,
    挂起: t.fm.挂起 || null, // 施工令-021：工单池卡/树形行/流程节点/在途四处的 ❄ 置灰都读这一个字段
    // 施工令-022 流程视图（现在线管线甘特）两个必需字段：
    //   更新时间 = 本单最近一次事件，管线「闲置 N 天」直书取它算时间差；
    //   归档原因 = 沉淀抽屉四分类的判据（废弃 / 返工替代 / 推翻替代）——没有它，已归档区里
    //              「主动废掉的」和「被新单顶替的」在页面上长一个样，制作人分不出哪些是自己拍的板。
    更新时间: t.fm.更新时间 || null, 归档原因: t.fm.归档原因 || null,
    // 施工令-038：候引擎实证印（施工令-032② / H97）是 待验收 之下的**停人闸**子态，
    // 流程页「等你签字」绿框判据要它才分得清「等你直收」与「等判官接手」——只下发有无，不下发印文。
    待引擎实证: !!t.fm.待引擎实证,
  }));
  res.json({ states: store.STATES, board: out, 隐藏数 });
});

// ---- 管线（H51/H52，0.19）：独立实体，开线/封存=人闸（仅本机） ----
const pipelines = require('./lib/pipelines');
// ---- 呼叫信箱（0.21）：确定性监视统一出口——会话侧一条监视器 tail 此文件即可 ----
const inbox = require('./lib/inbox');
app.get('/api/inbox', (req, res) => {
  if (!ready(res)) return;
  res.json({ 未读: inbox.unread(ROOT), 全部: inbox.list(ROOT, Number(req.query.limit) || 50) });
});
app.post('/api/inbox/read', (req, res) => {
  if (!ready(res)) return;
  res.json(inbox.markRead(ROOT));
});

// ---- 派单委托（H57）：制作人层提需求 → 项管起草 → Claude 审 → 放行 ----
app.post('/api/pm/draft', (req, res) => {
  if (!ready(res)) return;
  const 需求 = String((req.body || {}).需求 || '').trim();
  if (!需求) return res.status(400).json({ error: '需求必填' });
  // 粒ID（施工令-040 第 6 条）：这次起草是在**兑现哪一条排程计划**。可选——手工委托照旧不带。
  // 带了就当场校验存在性：等到十分钟后起草回调里才发现粒不存在，那条 token 已经烧掉了。
  const 粒ID = String((req.body || {}).粒ID || '').trim();
  if (粒ID && !schedule.取(ROOT, 粒ID)) {
    // 丙-4 补留痕：受理即拒也是一次「项管想起草但没起成」，此前只回 400、台账零痕，
    // 事后查「这条计划粒为什么一直没兑现」查不到任何东西。
    记事件('起草失败', { 阶段: '受理', 粒ID, error: '计划粒不存在' });
    return res.status(400).json({ error: '计划粒不存在：' + 粒ID });
  }
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  // 项目透传（2026-08-21 对账补）：施工令-061 让 Ticketflow 自立为第二项目（前缀 TF），
  // brain.draftTicket 也早就认 opts.项目 并据此选号段——**唯独这条委托路没把它传下去**，
  // 于是任何走派单委托起的单一律落项目默认值（TK），监制台自维护的活会被编进游戏的号段里。
  // 缺省仍是项目默认：不传项目的老调用方行为一字不变。
  const name = String((req.body || {}).项目 || '').trim() || (cfg.项目 && cfg.项目.默认) || '';
  if (name && !reg[name]) return res.status(400).json({ error: `未注册的项目：${name}（可选 ${Object.keys(reg).join('/')}）` });
  const projPath = name && reg[name] && reg[name].路径;
  journal.append(ROOT, '派单委托受理（H57）：' + 需求.slice(0, 60) + (粒ID ? `（兑现计划粒 ${粒ID}）` : ''));
  // 这条事件是关键汇报链「委托事由」的唯一来源（chain.js 按 30 分钟窗与随后的 单张待审 配对）——
  // 它没落盘，起草站就只能显示「项管单张起草」这句套话，制作人问的「为什么起这张单」永远没答案。
  记事件('派单委托', { 需求: 需求.slice(0, 200), ...(粒ID ? { 粒ID } : {}) });
  require('./lib/pm/brain').draftTicket(ROOT, cfg, 需求, projPath, (r) => {
    journal.append(ROOT, r.ok ? '项管起草完成：' + r.单 + '（草稿待审）' : '项管起草失败：' + (r.error || ''));
    // 丙-4 补留痕：成功那半有 brain 的「待审」事件兜着，**失败这半此前只进 journal**——
    // 台账里根本没有 起草失败 这个类型，于是「项管起草失败 N 次」在流水与分桶里一条都查不到，
    // 而 journal 是给人读的长文流水，机器对不了账。不新增写盘链路，就借既有 记事件 出口补齐；
    // 成功不补记（会与 待审 双计，把起草次数报高）。
    if (!r.ok) 记事件('起草失败', { 阶段: '起草', 需求: 需求.slice(0, 120), error: String(r.error || '').slice(0, 200), ...(粒ID ? { 粒ID } : {}) });
  }, { 粒ID: 粒ID || null, 项目: name || null });
  res.json({ ok: true, 状态: '项管起草中，完成后草稿区+信道可见', 项目: name, ...(粒ID ? { 粒ID } : {}) });
});

// ---- Wiki（0.20，H52 第三类实体）：设计事实源浏览 + 待审人闸 + 关系图 ----
const wiki = require('./lib/wiki');
function wikiProj(req) {
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  const name = String(req.query.项目 || req.body && req.body.项目 || '') || (cfg.项目 && cfg.项目.默认) || '';
  const p = name && reg[name] && reg[name].路径;
  return p && fs.existsSync(p) ? p : null;
}
app.get('/api/wiki', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册或路径不存在' });
  const { entries } = wiki.scan(p);
  res.json({ 条目: entries, 待审: wiki.pending(p) });
});
app.get('/api/wiki/entry', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册' });
  const e = wiki.readEntry(p, String(req.query.名称 || ''));
  if (!e) return res.status(404).json({ error: '条目不存在' });
  res.json(e);
});
app.get('/api/wiki/graph', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册' });
  res.json(wiki.graph(p));
});
app.post('/api/wiki/approve', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册' });
  const r = wiki.approve(p, String((req.body || {}).文件 || ''));
  if (r.ok) journal.append(ROOT, `wiki 入册「${r.名称}」（${r.分类} · 制作人人闸）`);
  res.status(r.ok ? 200 : 400).json(r);
});
app.post('/api/wiki/reject', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册' });
  const 文件 = String((req.body || {}).文件 || '');
  const r = wiki.reject(p, 文件);
  if (r.ok) journal.append(ROOT, `wiki 退回待审稿 ${文件}（制作人人闸）`);
  res.status(r.ok ? 200 : 400).json(r);
});

// ---- 知识总库·文档分区（施工令-015；施工令-020 起三区）：策划案 / 调研方案 / 技术方案聚合，只读。
// 路径来源 = 项目注册推仓路径（同 /api/ticket 的 引擎作业 取法）；缺目录不报错，返空清单。
const docs = require('./lib/docs');
if (cfg) docs.setZones(cfg.文档分区); // 分区根可配（默认=游戏项目布局），换项目改配置不改代码
app.get('/api/docs', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册或路径不存在' });
  const zone = String(req.query.区 || '');
  const r = docs.list(p, zone);
  if (!r) return res.status(400).json({ error: '未知分区：' + zone + '（可选 ' + docs.zones().join('/') + '）' });
  res.json(r);
});
app.get('/api/docs/file', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册或路径不存在' });
  const r = docs.read(p, String(req.query.区 || ''), String(req.query.rel || ''));
  if (!r) return res.status(404).json({ error: '文档不存在或不在本分区范围内' });
  res.json(r);
});

// ---- 协同策划文档（施工令-017）：*.codoc.md 块级读写，保存即项目仓 git 页史。
// UI 是唯一写者，作者一律钉死 制作人——总监/策划走文件与 API 直改，不经这条路。
const codoc = require('./lib/codoc');
const codocArg = (req, k, alias) => String((req.query && (req.query[k] ?? req.query[alias]))
  ?? (req.body && (req.body[k] ?? req.body[alias])) ?? '');
app.get('/api/codoc', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册或路径不存在' });
  const r = codoc.read(p, codocArg(req, '区', 'zone'), codocArg(req, 'rel', 'file'));
  if (!r) return res.status(404).json({ error: '协同文档不存在，或不是本分区内的 .codoc.md' });
  res.json(r);
});
app.post('/api/codoc', (req, res) => {
  if (!ready(res)) return;
  const p = wikiProj(req);
  if (!p) return res.status(400).json({ error: '项目未注册或路径不存在' });
  const b = req.body || {};
  const rel = codocArg(req, 'rel', 'file');
  const r = codoc.edit(p, codocArg(req, '区', 'zone'), rel,
    { 动作: b.动作, id: b.id, 文本: b.文本, 锚: b.锚, 位: b.位, 方向: b.方向 }, '制作人');
  if (r.ok && !r.无变更) {
    journal.append(ROOT, `协同文档 ${require('path').basename(rel)} ${b.动作}块 ${r.id || ''}（制作人 · ${r.提交 ? 'git ' + r.提交 : r.警示 || '无页史'}）`);
  }
  res.status(r.ok ? 200 : 400).json(r);
});

app.get('/api/pipelines', (req, res) => {
  if (!ready(res)) return;
  const ps = pipelines.list(ROOT).map((p) => ({ id: p.id, ...p.fm }));
  res.json({ 管线: ps });
});
app.post('/api/pipelines', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '开线是人闸，只能在本机操作' });
  const { 名称, 阶段, 规格 } = req.body || {};
  const r = pipelines.create(ROOT, 名称, 阶段, 规格);
  if (r.ok) journal.append(ROOT, `开线 ${r.id}「${名称}」（H51 人闸）`);
  res.status(r.ok ? 200 : 400).json(r);
});
app.post('/api/pipelines/status', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '封存/复线是人闸，只能在本机操作' });
  const { id, 状态 } = req.body || {};
  const r = pipelines.setStatus(ROOT, id, 状态);
  if (r.ok) journal.append(ROOT, `管线${状态} ${id}（H51 人闸）`);
  res.status(r.ok ? 200 : 400).json(r);
});
// （排期 API 已随甘特退役移除——拉取模型没有"计划日期"，时间轴只回放真实执行；里程碑=父单完成，已废）

// ---- 专项注册表（H103 · 施工令-058）：容器不是工单，独立实体独立 API ----
// 人闸两处、机器口两处，边界与管线注册表同规格：**立项与关账只准本机操作**（isLocalReq），
// 切单与迁移是机器动作但都由人发起，故同样钉在本机——远端瞭望塔只有读权。
const specials = require('./lib/specials');
// ---- 特性注册表（四层第二层；制作人 2026-08-20 拍板，施工令-061 配套）----
// 与专项/管线两条并列。读面公开；写面两条：提请（项管）与审核（总监），
// 审核是人闸故只认本机（同 /api/specials 口径）。
app.get('/api/features', (req, res) => {
  if (!ready(res)) return;
  const F = require('./lib/features');
  const 快照 = store.snapshot(ROOT);
  const 专项表 = require('./lib/specials').list(ROOT);
  res.json({ 特性: F.list(ROOT).map((f) => F.聚合(ROOT, f, { 快照, 专项表 })) });
});
app.get('/api/features/:id', (req, res) => {
  if (!ready(res)) return;
  const F = require('./lib/features');
  const v = F.聚合(ROOT, String(req.params.id));
  if (!v) return res.status(404).json({ error: '特性不存在' });
  const f = F.find(ROOT, String(req.params.id));
  // 直挂单明细只在详情页下发：列表页要的是计数，若在那儿一并捞，18 个特性会把全库单扫 18 遍
  const 直挂 = F.直挂单(ROOT, String(req.params.id))
    .map((t) => ({ id: t.id, state: t.state, fm: { title: t.fm.title, 职能: t.fm.职能 } }));
  res.json({ ...v, 正文: f.body, 直挂 });
});
const FT_ACTIONS = {
  // 提请：项管的动作。禁预规划闸在 features.提请 里（附不出活即拒），此处不复判。
  提请: (b) => require('./lib/features').提请(ROOT, { ...b, 提请人: b.提请人 || '项管' }),
  // 审核：总监的人闸。过→活跃，不过→就地封存留痕。
  审核: (b) => require('./lib/features').审核(ROOT, String(b.id || ''), { 通过: !!b.通过, 审核人: b.审核人 || '总监', 说明: b.说明 }),
  // 编辑：制作人在工单页双击名字就地改。改名不动挂链（工单记的是 F-n 号不是名字）
  编辑: (b) => require('./lib/features').编辑(ROOT, String(b.id || ''), { 名称: b.名称, 边界: b.边界, 操作者: b.操作者 || '制作人' }),
  封存: (b) => require('./lib/features').转移(ROOT, String(b.id || ''), '封存', { 操作者: b.操作者 || '总监', 因: b.因 }),
  复活: (b) => require('./lib/features').转移(ROOT, String(b.id || ''), '活跃', { 操作者: b.操作者 || '总监', 因: b.因 }),
};
app.post('/api/features/:action', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '特性写面只能在本机操作' });
  const fn = FT_ACTIONS[String(req.params.action || '')];
  if (!fn) return res.status(404).json({ error: '未知特性动作（只有 提请/审核/编辑/封存/复活）' });
  try {
    const r = fn(req.body || {});
    if (r.ok) journal.append(ROOT, `特性${req.params.action} ${r.id || (req.body || {}).id}${r.fm ? `「${r.fm.名称}」` : ''}`);
    res.status(r.ok === false ? 400 : 200).json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/specials', (req, res) => {
  if (!ready(res)) return;
  const 快照 = store.snapshot(ROOT); // 一次扫盘喂全部聚合：一个专项扫一遍会让十条专项扫十遍
  res.json({ 专项: specials.list(ROOT).map((s) => specials.聚合(ROOT, s, { 快照 })) });
});
app.get('/api/specials/:id', (req, res) => {
  if (!ready(res)) return;
  const v = specials.聚合(ROOT, String(req.params.id));
  if (!v) return res.status(404).json({ error: '专项不存在' });
  const s = specials.find(ROOT, String(req.params.id));
  res.json({ ...v, 正文: s.body });
});
app.post('/api/specials', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '立项是人闸，只能在本机操作' });
  const b = req.body || {};
  const r = specials.立项(ROOT, { ...b, 操作者: b.操作者 || '制作人' });
  if (!r.ok) return res.status(400).json(r);
  journal.append(ROOT, `专项立项 ${r.id}「${r.fm.名称}」（H103 人闸）`);
  // 要件2：H49 的切单挂钩从「定稿」迁到「立项」——条目一成立就唤醒项管切单。
  // 派发制没开时不自动切（同旧口径：手工模式下由人点「切单」），免得关着执行器还偷偷起会话。
  if (cfg.执行器 && cfg.执行器.派发制 && b.自动切单 !== false) {
    const proj = r.fm.项目 && cfg.项目 && cfg.项目.注册 && cfg.项目.注册[r.fm.项目];
    require('./lib/pm/wake').on专项立项(ROOT, cfg, { id: r.id, fm: r.fm }, proj && proj.路径);
    return res.json({ ...r, 项管: `切单已启动（${(cfg.模型 || {}).项管 || 'fable'}），简报完成后进台账待审` });
  }
  res.json(r);
});
// 三个动作走 :action 参数，不写字面量中文路径——**字面量中文路径在 express 4 下必 404**
// （同 /api/schedule/:action 与 /api/pm/poolbalance/:action 的成例；参数名也只能是 ASCII，
//   path-to-regexp 不认中文占位符，会把它当字面量）。这一行踩过就不该再踩第二次。
const SP_ACTIONS = {
  // 关账：唯一人闸。签字人缺省「制作人」，但缺省不等于免签——specials.关账 里空名照样拒。
  关账: (b) => {
    const r = specials.关账(ROOT, String(b.id || ''), b.签字人 || '制作人', b.说明);
    if (r.ok) {
      journal.append(ROOT, `专项关账 ${b.id}（签字 ${b.签字人 || '制作人'}${b.说明 ? '：' + b.说明 : ''}）——唯一人闸落笔`);
      pmLedger.event(ROOT, '专项关账', { 父单: String(b.id), 专项: String(b.id), 签字人: b.签字人 || '制作人' });
    }
    return r;
  },
  // 完成定义（2026-08-20）：关账的对照物。存量专项没这一格，签字前在页面上补。
  定完成定义: (b) => specials.定完成定义(ROOT, String(b.id || ''), b.文, b.操作者 || '制作人'),
  // 复切（054 候期出口的下半步）：条件齐了人来点一下，走的是与立项同一条唤醒线。
  切单: (b) => {
    const s = specials.find(ROOT, String(b.id || ''));
    if (!s) return { ok: false, error: '专项不存在' };
    const proj = s.fm.项目 && cfg.项目 && cfg.项目.注册 && cfg.项目.注册[s.fm.项目];
    require('./lib/pm/wake').on专项立项(ROOT, cfg, s, proj && proj.路径);
    return { ok: true, 说明: `切单已启动（${(cfg.模型 || {}).项管 || 'fable'}）` };
  },
  // 迁移（要件4）：**默认演练**。真跑要显式 {执行:true}——迁移改的是工单 frontmatter 与目录，
  // 一个手滑就得靠 git 捞回来，所以默认那一档永远是「只算给你看」。
  迁移: (b) => specials.迁移(ROOT, b.计划, { 演练: !b.执行, 操作者: b.操作者 || '制作人' }),
};
app.post('/api/specials/:action', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '专项动作是人闸，只能在本机操作' });
  const fn = SP_ACTIONS[String(req.params.action || '')];
  if (!fn) return res.status(404).json({ error: '未知专项动作（只有 关账/定完成定义/切单/迁移）' });
  try { const r = fn(req.body || {}); res.status(r.ok === false ? 400 : 200).json(r); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 参数步进（P6）：白名单闸值写回 studio.config.json（全局在途上限已废——编制即上限）----
// 闸值写口白名单：**哪些格能调、各自区间多少，全系统只有这一份**（2026-08-22 体检 #37/#70）。
// 原先它锁在 /api/config/gate 的函数体里，外面读不到，于是参数页只能自己另拿一张「说明表」
// 当闸门画卡——两张表一分裂，闸值里冒出一格没进白名单的，页面就长出一颗点一下必 400 的钮。
// 提到模块级并随 /api/config 下发，画口与写口从此吃同一份。
const 闸值白名单 = { 待验收积压闸: [1, 50], QA自修上限: [0, 10], 滞留超时小时: [1, 72], 人闸超时小时: [0, 168] };

app.post('/api/config/gate', (req, res) => {
  if (!ready(res)) return;
  const { key, value } = req.body || {};
  const ALLOW = 闸值白名单;
  if (!(key in ALLOW)) return res.status(400).json({ error: '不可调整的参数：' + key });
  const v = Number(value);
  if (!Number.isInteger(v) || v < ALLOW[key][0] || v > ALLOW[key][1]) return res.status(400).json({ error: `取值须在 ${ALLOW[key][0]}–${ALLOW[key][1]}` });
  cfg.闸值[key] = v;
  fs.writeFileSync(path.join(ROOT, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  journal.append(ROOT, `参数调整：${key} → ${v}`);
  res.json({ ok: true, 闸值: cfg.闸值 });
});

// ---- 执行器（D30 / H81 常开单闸制）：内嵌调度循环 = 监制台版监听器。运行即实弹，无模式开关 ----
const runner = require('./lib/runner');
const progress = require('./lib/progress');
// 执行进度（施工令-004）：口径唯一在 lib/progress.js，服务端算好随 /api/runner /api/agents 下发，
// 前端只负责显示——两处视图不许各算各的。
// 滚动均时（施工令-049 / H100 要件② ① 级取数）：近 N 张完结单的「同职能×同阶段」实测中位。
// 每次 /api/runner 都全库扫一遍太贵（脉冲 3s 一次），这里 60s 一算缓存住；读盘失败沿用上次，
// 拿不到就是空表——自动降级到 ② 配置表 / ③ 工单预计时间，进度不会因为取不到均时就断供。
let 均时缓存 = { t: 0, 表: {} };
function 均时表() {
  const now = Date.now();
  if (now - 均时缓存.t < 60000) return 均时缓存.表;
  let 表 = 均时缓存.表;
  try {
    const 完结 = [...store.list(ROOT, '完成'), ...store.list(ROOT, '已归档')];
    表 = progress.滚动均时(progress.阶段样本(完结), { N: (cfg.进度 && cfg.进度.均时样本数) || 8 });
  } catch { /* 读盘失败：沿用上次的表，不炸接口 */ }
  均时缓存 = { t: now, 表 };
  return 表;
}
function 进度Of(t, live) {
  return progress.compute({
    state: t ? t.state : '', kind: live ? live.kind : null,
    QA: t && t.fm ? t.fm.QA : '开', 验收方式: t && t.fm ? t.fm.验收方式 : '委托',
    职能: t && t.fm ? t.fm.职能 : null,
    预计时间: t && t.fm ? t.fm.预计时间 : null, 初检: !!(t && t.fm && t.fm.初检),
    阶段起时: live ? live.startedAt : null, tail: live ? live.tail : null,
    均时: 均时表(), 阶段均时: cfg.阶段均时 || null,
  });
}
function runnerStatus() {
  const st = runner.status(ROOT, cfg);
  st.执行中 = (st.执行中 || []).map((e) => {
    let t = null; try { t = store.find(ROOT, e.id); } catch { /* 单已挪走：按无单算 */ }
    return { ...e, 进度: 进度Of(t, e) };
  });
  return 桩台印(st);
}
app.get('/api/runner', (req, res) => { if (!ready(res)) return; res.json(runnerStatus()); });
app.post('/api/runner/start', (req, res) => {
  if (!ready(res)) return;
  runner.start(ROOT, () => cfg); // 桩台模式下这是哑函数：点了也起不来，且下面照报 运行:false
  res.json({ ok: true, ...桩台印(runner.status(ROOT, cfg)) });
});
app.post('/api/runner/stop', (req, res) => {
  if (!ready(res)) return;
  runner.stop(ROOT);
  res.json({ ok: true, ...桩台印(runner.status(ROOT, cfg)) });
});
// /api/runner/mode（试跑↔实弹）已随 H81 常开单闸制拆除：运行即实弹，停手闸是暂停总闸
// ---- 全量配置入 UI（2026-07-11 用户指示）：以下均为白名单化分区写回 ----
const saveCfg = () => config.save(ROOT, cfg); // 落盘口径唯一在 core/config（无 BOM · 2 空格 · 末尾换行）

// 执行池阈值（额度锁的杆）
app.post('/api/config/pool', (req, res) => {
  if (!ready(res)) return;
  const { pool, key, value } = req.body || {};
  if (!['codex', 'claude'].includes(pool)) return res.status(400).json({ error: '未知池：' + pool });
  if (!['阈值', '周阈值'].includes(key)) return res.status(400).json({ error: '不可调整：' + key });
  const v = Number(value);
  if (!Number.isInteger(v) || v < 1 || v > 100) return res.status(400).json({ error: '取值须在 1–100' });
  cfg.执行池[pool][key] = v; saveCfg();
  journal.append(ROOT, `执行池阈值调整：${pool}.${key} → ${v}%`);
  res.json({ ok: true, 执行池: cfg.执行池 });
});

// 兼容池管理（0.22.1，仅本机）：新增/更新 Anthropic 兼容厂商池；删除=停用（职能清空保历史）
app.post('/api/config/compat-pool', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '密钥管理只能在本机操作' });
  const { 池名, base, key, 模型 } = req.body || {};
  const name = String(池名 || '').trim();
  if (!/^[a-z][a-z0-9-]{1,19}$/.test(name)) return res.status(400).json({ error: '池名须为小写字母开头的英文标识（2-20 位）' });
  if (['codex', 'claude'].includes(name)) return res.status(400).json({ error: '原生池不走兼容配置' });
  cfg.执行池 = cfg.执行池 || {};
  const old = cfg.执行池[name] || { 职能: [], 阈值: 70, 周阈值: 90 };
  const compat = { ...(old.兼容 || {}) };
  if (base) { try { new URL(String(base)); } catch { return res.status(400).json({ error: 'base 不是合法 URL' }); } compat.base = String(base); }
  if (key) compat.key = String(key);
  if (模型) compat.模型 = String(模型);
  if (!compat.base || !compat.key) return res.status(400).json({ error: 'base 与 key 必填（更新时 key 可留空保留旧值）' });
  cfg.执行池[name] = { ...old, 兼容: compat };
  saveCfg();
  journal.append(ROOT, `兼容池配置：${name}（${compat.base} · ${compat.模型 || 'CLI 默认模型'}）——密钥不入日志`);
  res.json({ ok: true });
});

// 模型档（池默认 + 裁判档）；可选清单增补
app.post('/api/config/model', (req, res) => {
  if (!ready(res)) return;
  const { key, value } = req.body || {};
  if (!['codex默认', 'claude默认', '质检', '代核', '代裁', '核查', '仲裁', '项管'].includes(key)) return res.status(400).json({ error: '不可调整：' + key });
  const v = String(value || '').trim();
  cfg.模型 = cfg.模型 || {}; cfg.模型[key] = v; saveCfg();
  journal.append(ROOT, `模型档调整：${key} → ${v || '（CLI 默认）'}`);
  res.json({ ok: true, 模型: cfg.模型 });
});
app.post('/api/config/model-add', (req, res) => {
  if (!ready(res)) return;
  const { pool, name } = req.body || {};
  if (!['codex', 'claude'].includes(pool)) return res.status(400).json({ error: '未知池：' + pool });
  const v = String(name || '').trim();
  if (!/^[\w.\-]{2,40}$/.test(v)) return res.status(400).json({ error: '模型名只允许字母数字点横线（2–40 位）' });
  cfg.模型 = cfg.模型 || {}; cfg.模型.可选 = cfg.模型.可选 || {};
  const list = cfg.模型.可选[pool] = cfg.模型.可选[pool] || [];
  if (!list.includes(v)) list.push(v);
  saveCfg();
  journal.append(ROOT, `可选模型增补：${pool} + ${v}`);
  res.json({ ok: true, 可选: cfg.模型.可选 });
});

// 池衡参数（H99 · 施工令-045 要件 5）：迟滞/阈值/冷却/回退次数与自动平衡总开关。
// 走 /api/config/* 这条老路而不是项管的受限动作 API——**调参是总监与制作人的事**，
// 项管只在参数定下的框里动手；把它塞进受限动作里等于让项管自己放宽自己的闸。
app.post('/api/config/poolbalance', (req, res) => {
  if (!ready(res)) return;
  const { key, value } = req.body || {};
  const NUM = { 最小间隔分钟: [1, 720], 阈值差: [1, 100], 冷却分钟: [1, 1440], 失败回退次数: [1, 10], 自愈窗秒: [0, 600] };
  cfg.池衡 = cfg.池衡 || {};
  if (key === '开') { cfg.池衡.开 = !!value; }
  else if (key in NUM) {
    const v = Number(value);
    if (!Number.isInteger(v) || v < NUM[key][0] || v > NUM[key][1]) return res.status(400).json({ error: `取值须在 ${NUM[key][0]}–${NUM[key][1]}` });
    cfg.池衡[key] = v;
  } else return res.status(400).json({ error: '不可调整的池衡参数：' + key });
  saveCfg();
  journal.append(ROOT, `池衡参数调整：${key} → ${key === '开' ? (value ? '开' : '关') : Number(value)}`);
  // 版本随回：参数在 CAS 切片里，改完不换新版本前端下一手必 409
  res.json({ ok: true, 池衡: cfg.池衡, 版本: require('./lib/pm/poolbalance').版本(cfg) });
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

// /api/config/live（实弹解锁权力开关）已随 H81 常开单闸制拆除：执行器只要「运行」即实弹

// 项目注册（加/改 同名覆盖；设默认；路径必须真实存在）
app.post('/api/config/project', (req, res) => {
  if (!ready(res)) return;
  const { 动作, 名称, 路径, 说明, 引擎 } = req.body || {};
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
    // 同名覆盖 = 改路径/说明/引擎，其余档案字段（阶段等）原样保留——覆盖不是重建
    const prev = cfg.项目.注册[名称] || {};
    const entry = { ...prev, 路径: p.replace(/\\/g, '/'), 说明: String(说明 || '').slice(0, 60) };
    if (引擎 && 引擎.类型) {
      if (!require('./lib/engines').TYPES.includes(引擎.类型)) return res.status(400).json({ error: '引擎类型只允许 godot/unity/unreal' });
      entry.引擎 = { 类型: 引擎.类型, ...(引擎.版本 ? { 版本: String(引擎.版本).slice(0, 24) } : {}) };
    } else if (引擎 === null) delete entry.引擎; // 显式 null = 清除档案
    cfg.项目.注册[名称] = entry;
    if (!cfg.项目.默认) cfg.项目.默认 = 名称;
    saveCfg();
    journal.append(ROOT, `项目注册：${名称} → ${p}${entry.引擎 ? `（引擎 ${entry.引擎.类型}${entry.引擎.版本 ? ' ' + entry.引擎.版本 : ''}）` : ''}`);
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

  // 组1 运行时与 CLI（探针标准=实弹标准：claude 走执行器同款绝对路径解析）
  const claudeCmd = runner.resolveCli('claude').cmd;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  // 活性验证（2026-08-08 死代理案）：旧样只报「解析到了什么代理」，不验它连不连得上——
  // 那台机器上 7890 根本没进程在听，这一项却是绿的，而每张执行单都死在 ConnectionRefused。
  // 现按「探针标准=实弹标准」真发一次请求：实弹经代理访问 API，探针就经同一个代理访问同一个 API。
  // 判据翻译在 lib/netprobe（纯函数可单测），本处只做装配。
  const netprobe = require('./lib/netprobe');
  const [codexP, claudeP, 连通] = await Promise.all([
    probe('codex', ['--version']),
    probe(claudeCmd, ['--version']),
    netprobe.探(proxy),
  ]);
  const pv = netprobe.verdict({ proxy, 来源: proxy ? (process.env.__STUDIO_PROXY_SRC || '环境变量') : '', ...连通 });
  const 运行时 = [
    item('node', '绿', process.version),
    item('codex CLI', codexP.ok ? '绿' : '黄', codexP.note + (codexP.ok ? '' : '（codex 池实弹不可用）')),
    item('claude CLI', claudeP.ok ? '绿' : '黄', claudeP.note + (claudeP.ok ? (claudeCmd !== 'claude' ? '（~/.local/bin，免 PATH）' : '') : '（claude 池实弹不可用）')),
    item('API 连通', pv.级别, pv.note),
  ];

  // 组2 凭据与额度链路（2026-07-11 限流风波的直接教训）
  const 凭据额度 = [];
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
  const rl = await require('./lib/quota').getRateLimits(cfg).catch(() => null);
  凭据额度.push(rl ? item('codex 登录态', '绿', 'app-server 正常 · 5h ' + (rl.primary && rl.primary.usedPercent != null ? Math.round(rl.primary.usedPercent) + '%' : '—'))
    : item('codex 登录态', '黄', 'app-server 无响应（未登录或未装，codex 额度盲飞）'));

  // 组3 项目与目录
  const 项目目录 = [];
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  const engines = require('./lib/engines');
  for (const [n, p] of Object.entries(reg)) {
    if (!fs.existsSync(p.路径)) 项目目录.push(item(`项目 ${n}`, '黄', '路径不存在：' + p.路径 + '（该项目实弹不可用）'));
    else if (!fs.existsSync(path.join(p.路径, '.git'))) 项目目录.push(item(`项目 ${n}`, '黄', p.路径 + '（非 git 仓库，产出无法落袋）'));
    else 项目目录.push(item(`项目 ${n}`, '绿', p.路径 + (cfg.项目.默认 === n ? ' · 默认' : '')));
    const ec = engines.checkProject(p); // 引擎档案自检（无档案不出灯）
    if (ec) 项目目录.push(item(`项目 ${n} 引擎`, ec.级别, ec.note));
  }
  if (!Object.keys(reg).length) 项目目录.push(item('项目注册', '黄', '空——实弹无目标仓库'));
  try {
    const t = path.join(ROOT, '回执', '.probe-' + Date.now());
    fs.writeFileSync(t, 'x'); fs.unlinkSync(t);
    // 态数活读 store.STATES（2026-08-22 体检 #67②）：原文写死「九态」，而 STATES 早已 10 态——
    // 自检面每加一态就腐一次，报的是一个过期的数。写死中文数字＝把常量抄进文案。
    项目目录.push(item('监制台目录', '绿', `${store.STATES.length} 态目录 + 回执/journal 可写`));
  } catch (e) { 项目目录.push(item('监制台目录', '红', '不可写：' + e.message.slice(0, 50))); }

  // 组4 协议资产与配置完整性
  const 协议配置 = [];
  // 章程清单活读 cfg.职能（施工令-027）：写死六份的年代，新增职能（技术策划）注册后自检照报"齐全"，
  // 缺的那份章程要等 agent 开工才发现。通用是所有职能共读的底章，永远算一份。
  const charters = ['通用', ...(cfg.职能 || []).map(String)].filter((n, i, a) => n && a.indexOf(n) === i);
  const missing = charters.filter((n) => !fs.existsSync(path.join(ROOT, '岗位协议', n + '.md')));
  协议配置.push(missing.length ? item('岗位协议', '黄', `缺：${missing.join('、')}（应有 ${charters.length} 份：通用 + ${(cfg.职能 || []).length} 职能）`)
    : item('岗位协议', '绿', charters.length + ' 份齐全'));
  const lint = [];
  // 池归属走编制口径（施工令-027）：poolFor 已委托 cfg.编制 池序，老映射 执行池.<池>.职能 仅兜底
  for (const fn of cfg.职能 || []) if (!pool.poolFor(cfg, fn)) lint.push(`职能「${fn}」无执行池归属（编制表未挂池序、老映射也没有——领单/派发会失败）`);
  for (const r of roster.read(cfg)) {
    if (!(cfg.职能 || []).includes(r.职能)) lint.push(`编制行「${r.职能}」的职能不在职能表`);
    for (const p of r.池序) if (!(cfg.执行池 || {})[p.池]) lint.push(`编制行「${r.职能}」池序里的 ${p.池} 池未注册`);
  }
  if (cfg.项目 && cfg.项目.默认 && !reg[cfg.项目.默认]) lint.push('默认项目未注册');
  协议配置.push(lint.length ? item('config 完整性', lint.some((x) => x.includes('领单会失败')) ? '红' : '黄', lint.join('；'))
    : item('config 完整性', '绿', '职能↔池映射 / 编制 / 默认项目 全部合法'));
  // 原生对话框扫描（施工令-012 / 巡礼 P1）：prompt/confirm/alert 在 Electron 壳内是哑弹，
  // 浏览器预览却一切正常——只在浏览器巡礼必漏。换装前的 grep 从此变成开机自检的一项。
  try {
    const 前端 = path.join(__dirname, 'public', 'app.js');
    const hits = dialogscan.scan(fs.readFileSync(前端, 'utf8'), { 文件: 'app.js' });
    协议配置.push(hits.length
      ? item('原生对话框扫描', '黄', `Electron 壳内哑弹：${dialogscan.摘要(hits)}——确认门改自绘 ask()，输入框改自绘 askInput()`)
      : item('原生对话框扫描', '绿', '前端零命中 prompt/confirm/alert（自绘 ask / askInput 家族）'));
  } catch (e) { 协议配置.push(item('原生对话框扫描', '黄', '前端源码不可读，未能扫描：' + String(e.message).slice(0, 50))); }

  // 总灯：有红=阻断；无红有黄=降级；全绿=就绪
  const all = [...运行时, ...凭据额度, ...项目目录, ...协议配置];
  const reds = all.filter((x) => x.级别 === '红'), yellows = all.filter((x) => x.级别 === '黄');
  const data = {
    总灯: reds.length ? '阻断' : yellows.length ? '降级' : '就绪',
    结论: reds.length ? reds.map((x) => x.名称 + '：' + x.note)
      : yellows.length ? yellows.map((x) => x.名称 + '：' + x.note)
      : ['全链路就绪：执行链可实弹开工'],
    组: { '运行时与 CLI': 运行时, '凭据与额度': 凭据额度, '项目与目录': 项目目录, '协议与配置': 协议配置 },
  };
  envCache = { at: Date.now(), data };
  res.json(data);
});

// ---- 瞭望塔心跳（2026-08-22 体检 #68②）----
// 塔死要看得见：守护每 30s 覆盖写一行 ISO 时刻到 <ROOT>/瞭望塔/心跳.txt（packages/watchtower
// 接线说明 §五·1），断更即守护不在。**无塔≠塔死**：本仓没装瞭望塔时下发 在岗:null，
// 不立债也不假红——否则每一个测试根、每一台没装塔的机器都会被打满红。
//
// 阈值 90 秒 = 三个心跳周期，**与 G20 闸判据同一把尺**（lib/gatereg.js:90 与 :265）。
// 原补丁写的是 apps/platform 那侧的 45s，闸表组落 G20 时已书面否掉：45s 只留一拍半余量，
// 一次调度抖动就报塔死。这一格与闸各写一个数，就会出现「值守板不立债、端点说塔死」的分叉——
// 本项目反复修的正是这一种。要改阈值请连 gatereg.js:265 一起改。
const 心跳阈值秒 = 90;
app.get('/api/watchtower', (req, res) => {
  if (!ready(res)) return;
  let 原文 = null;
  try { 原文 = fs.readFileSync(path.join(ROOT, '瞭望塔', '心跳.txt'), 'utf8').trim(); } catch { /* 未装塔或塔没写过 */ }
  if (!原文) return res.json({ 在岗: null, 说明: '本仓未装瞭望塔（无 瞭望塔/心跳.txt）——不立债，不假红' });
  const t = Date.parse(原文);
  if (!Number.isFinite(t)) return res.json({ 在岗: null, 说明: '心跳戳读不出：' + 原文.slice(0, 40) });
  const 秒龄 = Math.round((Date.now() - t) / 1000);
  res.json({ 在岗: 秒龄 <= 心跳阈值秒, 秒龄, 戳: 原文, 阈值秒: 心跳阈值秒 });
});

// ---- 推荐参数（P6）已摘除（2026-08-22 体检 #58）----
// 精力档 + 速度参数是「推荐在途」那张卡的写口，卡随 0.23.11 制度改版 / 0.24.7 视图清仓撤了，
// 写口却活到今天。唯一调用方 public/app.js 的 window.rStep 是个孤儿——它找的
// `.paramcard[data-rkey]` 全库不存在，点了必静默失败。留着只是给人一个能 200 的死路。

// ---- 职能编制变更（P6 · 已退役）：按人数扩缩编（职能-A/-B/-C）随 H85 补章「去岗位化」一并拆除。
// 编制表现在每职能一行，唯一写口是 /api/pm/roster（改的是池序，不是人头）。lib/staff.js 已删除。

// ---- 在途 agent 视角（P3）----
app.get('/api/agents', (req, res) => {
  if (!ready(res)) return;
  const fl = pool.inFlight(ROOT);
  const 滞留 = fl.filter((t) => t.fm.滞留告警).map((t) => ({ id: t.id, state: t.state, 时长h: t.fm.滞留时长h }));
  if (cfg.执行器 && cfg.执行器.派发制) {
    // H49 派发制视图：一次性执行者（因单而生）+ 判官编制 + 就绪队列/并发
    const runStatus = require('./lib/runner').status(ROOT, cfg);
    const liveByTicket = Object.fromEntries((runStatus.执行中 || []).map((e) => [e.id, e]));
    const isParent = (t) => ['战役','专项'].includes(t.fm.父单类型) || ['战役','专项'].includes(t.fm.主办); // H53：组织容器不是执行者
    // 判官会话在跑的单（初检/核查落在待验收）也是在跑执行者——设计稿-004 状态 B：
    // 核查中的卡就该出现在在途页，阶段名如实显示「核查中 · 深检」，不冒充执行也不消失
    const 审中 = (runStatus.执行中 || []).filter((e) => e.kind !== '执行' && !fl.some((t) => t.id === e.id))
      .map((e) => { try { return store.find(ROOT, e.id); } catch { return null; } }).filter(Boolean);
    const 在跑 = [...fl.filter((t) => ['在途', '质检'].includes(t.state) || liveByTicket[t.id]), ...审中].filter((t) => !isParent(t)).map((t) => ({
      主办: t.fm.主办 || '（衔接中）', id: t.id, title: t.fm.title, state: t.state,
      职能: t.fm.职能, 池: t.fm.执行池 || '', 领单时间: t.fm.领单时间 || null, 项目: t.fm.项目 || '',
      // 建设性①（施工令-012）：有没有执行会话直接下发，前端不再靠「进度.阶段==='领单'」猜。
      // 更新时间＝进本状态的时刻，无会话卡据此报「已等 N 分钟」。
      有会话: !!liveByTicket[t.id], 更新时间: t.fm.更新时间 || null,
      环节: (liveByTicket[t.id] || {}).kind || null, 环节起时: (liveByTicket[t.id] || {}).startedAt || null,
      尾: (liveByTicket[t.id] || {}).tail || null,
      进度: 进度Of(t, liveByTicket[t.id] || null), // 施工令-004：卡片不点详情就看得见百分比与阶段
    }));
    // 判官席（H85 补章去岗位化）：不再列人头，编制有 QA 这一行就有一席，会话标签即职能名
    const 判官 = roster.has(cfg, 'QA') ? [(() => {
      // 判官单多在「待验收」，不在 inFlight 口径内——按单是否还在库判在岗（原 fl 口径漏判成待命）
      const busy = (runStatus.执行中 || []).find((e) => e.kind !== '执行' && e.id && (() => { try { return !!store.find(ROOT, e.id); } catch { return false; } })());
      return { id: 'QA', 忙: !!busy, 当前: busy ? busy.id : null, 环节: busy ? busy.kind : null };
    })()] : [];
    const l = pmLedger.read(ROOT);
    return res.json({ 模式: '派发', 在跑, 判官, 就绪队列: l.就绪队列 || [], 并发上限: l.并发上限, 滞留告警: 滞留, 编辑器占用: runStatus.编辑器占用 || [], 引擎作业: runStatus.引擎作业 || {} });
  }
  const byAgent = {};
  for (const t of fl) if (t.fm.主办) byAgent[t.fm.主办] = { id: t.id, title: t.fm.title, state: t.state, 职能: t.fm.职能, 领单时间: t.fm.领单时间 };
  // 拉取制视图（旧路径，可回退）：去岗位化后一个职能=一个执行位，id 即职能名；上限=编制行数
  const agents = roster.agents(cfg).map((a) => ({ ...a, 手持: byAgent[a.id] || null }));
  res.json({ agents, 在途数: fl.length, 上限: roster.read(cfg).length, 滞留告警: 滞留 });
});

// ---- 工单详情（P8）：正文 + 四追溯链 + 回执 ----
app.get('/api/ticket', (req, res) => {
  if (!ready(res)) return;
  const id = String(req.query.id || '');
  const t = store.find(ROOT, id);
  if (!t) return res.status(404).json({ error: '工单不存在' });
  let 回执 = null; let 产出 = null;
  const rp = path.join(ROOT, '回执', `${id}.md`);
  if (fs.existsSync(rp)) {
    const raw = fs.readFileSync(rp, 'utf8');
    回执 = { raw, html: mdHtml(raw) };
    // 产出速览：定位回执产出到项目仓（验收动线——路径不该埋在正文里）
    const proj = t.fm.项目 && cfg.项目 && cfg.项目.注册 && cfg.项目.注册[t.fm.项目];
    if (proj) 产出 = require('./lib/artifacts').locate(raw, proj.路径);
  }
  // 引擎作业（TK-97 案）：该单所属项目仓的 enginectl 锁与心跳；无项目/无锁/文件缺失一律 null
  const projReg = t.fm.项目 && cfg.项目 && cfg.项目.注册 && cfg.项目.注册[t.fm.项目];
  const 引擎作业 = (() => { try { return require('./lib/engines').jobStatus(projReg && projReg.路径); } catch { return null; } })();
  res.json({ id, state: t.state, fm: t.fm, body: t.body, html: mdHtml(t.body), 链: trace.chains(ROOT, id), 回执, 产出, 引擎作业 });
});

// ---- 项管信道（0.18.6，前身遥控传令板）：制作人 ↔ 项管（fable）问答 + 汇报流（明文 jsonl 留档）----
const relay = require('./lib/relay');
let pmBusy = false; // 项管答话一次一问（fable 会话贵，排队不并发）
app.get('/api/relay', (req, res) => {
  if (!ready(res)) return;
  const brainWorking = (() => { try { return require('./lib/pm/brain').getWorking(); } catch { return null; } })();
  const runnerOn = (() => { try { return require('./lib/runner').isOn(ROOT); } catch { return false; } })();
  res.json({ 消息: relay.list(ROOT, Number(req.query.limit) || 100), 项管忙: pmBusy, 作业: brainWorking, 值守: runnerOn });
});
app.post('/api/relay', (req, res) => {
  if (!ready(res)) return;
  const text = (req.body || {}).text;
  const r = relay.append(ROOT, '制作人', text);
  if (!r.ok) return res.status(400).json(r);
  journal.append(ROOT, `项管信道·制作人：${String(text).slice(0, 60)}`);
  if (pmBusy) { relay.append(ROOT, '项管', '（上一问仍在作答，稍候再问——项管一次一问）'); return res.json({ ...r, 项管忙: true }); }
  pmBusy = true;
  require('./lib/pm/brain').answer(ROOT, cfg, text, (a) => {
    pmBusy = false;
    relay.append(ROOT, '项管', a.text || a.error || '（无应答）');
    journal.append(ROOT, `项管信道·答：${String(a.text || '').slice(0, 60)}`);
  });
  res.json(r);
});
// 远程配置（参数页卡片）：开关 + 令牌重生成（仅本机可改——远程端不许给自己续权）
app.post('/api/config/remote', (req, res) => {
  if (!ready(res)) return;
  if (!isLocalReq(req)) return res.status(403).json({ error: '远程配置只能在本机修改' });
  const { 开, 重生成令牌 } = req.body || {};
  cfg.网络 = cfg.网络 || {}; cfg.网络.远程 = cfg.网络.远程 || {};
  if (typeof 开 === 'boolean') cfg.网络.远程.开 = 开;
  // 新令牌一律落**凭据档**（.gitignore 已排除），不再写回 studio.config.json——
  // 那个文件进版本控制，写回去等于再泄一次（2026-08-21 体检：旧值已随 97 次记账推进远端仓）。
  let 新令牌 = null;
  if (重生成令牌 || (cfg.网络.远程.开 && !远程令牌())) {
    新令牌 = require('crypto').randomBytes(16).toString('hex');
    const creds = require('./lib/creds');
    const cur = creds.read(ROOT) || {};
    cur.远程令牌 = 新令牌;
    creds.write(ROOT, cur);
    cfg.网络.远程.令牌 = ''; // 配置里只留空位，值在凭据档
  }
  require('./lib/core/durable').写(path.join(ROOT, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n');
  const 有令牌 = !!远程令牌();
  journal.append(ROOT, `远程访问：${cfg.网络.远程.开 ? '开' : '关'}${新令牌 ? '（令牌已重生成，落凭据档）' : ''}${cfg.网络.远程.开 && !有令牌 ? ' ⚠ 无令牌，实际不放行' : ''}（重启生效监听地址）`);
  // 令牌只在**刚生成**时回一次（人得拿到它）；此后一律不回显——回显等于给每个能打开参数页的东西一份口令。
  res.json({ ok: true, 远程: { 开: !!cfg.网络.远程.开, 有令牌, ...(新令牌 ? { 令牌: 新令牌 } : {}) } });
});

// ---- H49 双域：想法池 + 项管 ----
const ideas = require('./lib/pm/ideas');
const pmLedger = require('./lib/pm/ledger');
/* 台账事件唯一出口（施工令-039，案源 037 勘察实锤）。
   旧样：派单委托 / 定稿放行 两处写 require('./lib/ledger').event(...)——**指错了模块**。
   lib/ledger 只有 commitStudio（git 记账），事件属主是 lib/pm/ledger。于是每次调用都抛
   TypeError，又被 `catch { }` 空吞，两类事件一个月零落盘无人发现（现网 事件.jsonl 570 行零命中）。
   吞异常是帮凶：错的是 require，瞒下来的是空 catch。此后事件一律走这道口子——
   属主唯一（pmLedger），失败必留痕（console 保底 + journal 落盘，双保险各自独立 try）。
   语义边界：event() 只 append 事件.jsonl（急件类型另投信箱），**不改状态机、零调度语义影响**。
   函数声明有提升，模块内任何位置（含本行之上的 /api/pm/draft）运行期都调得到。 */
function 记事件(类型, data) {
  try { return pmLedger.event(ROOT, 类型, data); } catch (e) {
    console.error(`台账事件落盘失败（${类型}）：${e.message}`);
    try { journal.append(ROOT, `台账事件落盘失败（${类型}）：${e.message}`); } catch { /* 留痕失败不阻塞主流程 */ }
    return null;
  }
}
app.get('/api/ideas', (req, res) => {
  if (!ready(res)) return;
  res.json({ 想法: ideas.list(ROOT).filter((x) => req.query.全部 === '1' || x.状态 === '在池') });
});
app.post('/api/ideas', (req, res) => {
  if (!ready(res)) return;
  const { 动作, id, 文本, 备注, 项目, 前缀 } = req.body || {};
  let r;
  if (动作 === '放弃') r = ideas.drop(ROOT, id);
  else if (动作 === '拍板') {
    // 施工令-058：拍板产出的是**专项注册表条目**，不再是伪工单（H103）。
    r = ideas.拍板(ROOT, id, 项目 || (cfg.项目 && cfg.项目.默认) || '', 前缀 || (cfg.项目 && cfg.项目.默认) || 'TK');
    if (r.ok) journal.append(ROOT, `拍板：想法 ${id} → 专项 ${r.专项}（补齐边界与验收标准后立项生效）`);
  } else { r = ideas.add(ROOT, 文本, 备注); if (r.ok) journal.append(ROOT, `想法入池：${String(文本).slice(0, 40)}`); }
  res.status(r.ok ? 200 : 400).json(r);
});
// 台账下发（丙-4 改：杀假读数）。此前直接 res.json(pmLedger.read(ROOT))，把 read() 的兜底空壳
// 原样交给界面——报表页的「专项成本归集」表就靠 父单成本 画，而那个字段全仓零写入方，于是那张表
// 从上线起永远写着「暂无归集」。改走 视图()：父单成本 读时真算，在跑（死镜像）不再下发，
// 并随包下发 字段来源——消费方据此分得清「真的是 0」和「这儿根本没实现」。
app.get('/api/pm/ledger', (req, res) => {
  if (!ready(res)) return;
  res.json({ 台账: pmLedger.视图(ROOT), 事件: pmLedger.events(ROOT, Number(req.query.limit) || 80) });
});
/* 项管行为流水（丙-4 · 制作人「让它的行为可视化」）。
   案源：/api/pm/ledger 只下发尾 80 条，而台账里 巡检 + 台账对齐 + 池衡拒绝 三类机器心跳占了
   全量的四分之三——项管真正的判断动作（估时校准、裁决、拒切、并发调配）全滚出窗口，
   干了也等于没干。这里按桶下发：心跳归一桶只报计数，判断类各成一桶各留最近 N 条明细。
   **纯读聚合**：业务全在 lib/pm/ledger.分桶（纯函数，可整片单测），此处只做路由与参数夹逼。 */
app.get('/api/pm/actions', (req, res) => {
  if (!ready(res)) return;
  const 夹 = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), lo), hi) : d; };
  const 窗 = 夹(req.query.窗, 3000, 1, 50000);   // 读进来参与计数的事件条数（默认盖过全量）
  const 每桶 = 夹(req.query.每桶, 8, 0, 50);      // 每个判断桶保留的明细条数
  res.json(pmLedger.分桶(pmLedger.events(ROOT, 窗), { 每桶 }));
});
// 关键汇报事件链（施工令-037）：台账事件流水 + 工单 frontmatter 结构位按单号归组，一单一链。
// **纯读聚合**——零新事件源、零调度语义改动、零写盘；业务全在 lib/pm/chain（可单测），此处只做路由。
// 15s 活体轮询打的就是这个口子，所以它必须便宜：只读 jsonl 尾 N 条 + 活单目录，不碰 LLM 不碰网络。
app.get('/api/pm/chains', (req, res) => {
  if (!ready(res)) return;
  res.json(require('./lib/pm/chain').汇总(ROOT, {
    limit: Number(req.query.limit) || 12,
    事件窗: Number(req.query.事件窗) || 300,
    含隐藏: req.query.含隐藏 === '1',
  }));
});
app.post('/api/pm/cut', (req, res) => {
  if (!ready(res)) return;
  const { 父单 } = req.body || {};
  const t = store.find(ROOT, String(父单 || ''));
  if (!t) return res.status(404).json({ error: '父单不存在' });
  const proj = t.fm.项目 && cfg.项目 && cfg.项目.注册 && cfg.项目.注册[t.fm.项目];
  journal.append(ROOT, `项管切单启动：${父单}（fable 档，完成后简报待审）`);
  pmLedger.event(ROOT, '切单启动', { 父单 });
  // 落账口径与定稿自动唤醒共用 wake.onCutResult（施工令-054）：三出口（切成/拒切候期/真失败）
  // 只此一份实现——手工切单也走同一个判语存档路径，免得「候期」在自动链合法、在手工链记失败。
  require('./lib/pm/brain').cut(ROOT, cfg, String(父单), proj && proj.路径,
    (r) => require('./lib/pm/wake').onCutResult(ROOT, String(父单), r));
  res.json({ ok: true, 状态: `切单进行中（${(cfg.模型 || {}).项管 || '项管档'}），完成后拆单简报进台账待审` });
});

// ---- 编制（H85，2026-08-06 制作人裁决「编制只需要存一单数据放在项管那让项管自己管理」；
//      同日补章「去岗位化」：编制表每职能一行，-A/-B 岗位册退役，存储位改为 config.编制）----
// 用工权随派单权归项管（H57 延伸）。业务在 lib/roster（snapshot/apply 可单测），此处只做路由。
// GET = 只读快照（可用性用 dispatch.poolFrozen 实算——UI 与调度同一把尺，绝不各算各的）；
// POST = 批量调整 {改动:[{职能,池序?}],理由}，仅供项管调用与总监代劳，监制台不提供编辑界面。
app.get('/api/pm/roster', async (req, res) => {
  if (!ready(res)) return;
  const D = require('./lib/pm/dispatch');
  let gi = null;
  try { const locks = await gates.allLocks(cfg); gi = require('./lib/budget').并入({ codex: locks.codex, claude: locks.claude }, require('./lib/budget').冻结池(cfg, ROOT)); } catch { /* 读数盲飞：可用性按未知呈报，不假绿 */ }
  const 编制 = roster.snapshot(cfg, gi ? ((p) => D.poolFrozen(cfg, gi, p)) : null);
  res.json({ 编制, 池态: gi });
});
app.post('/api/pm/roster', (req, res) => {
  if (!ready(res)) return;
  const { 改动, 理由 } = req.body || {};
  const r = roster.apply(cfg, 改动); // 先全量校验再整批落：一条不合法则整批不写
  if (!r.ok) return res.status(400).json({ error: r.error });
  saveCfg();
  const 摘 = r.生效.map((v) => v.摘).join('；') || '（无实际变化）';
  journal.append(ROOT, `项管编制调整（H85 去岗位化）：${摘}｜理由：${String(理由 || '未述').slice(0, 120)}`);
  pmLedger.event(ROOT, '编制调整', { 生效: r.生效, 理由: String(理由 || '').slice(0, 200) });
  res.json({ ok: true, 生效: r.生效, 编制: cfg.编制 });
});

// ---- 并发调配（施工令-010，制作人 2026-08-06 23:59 批准）----
// 并发调配权随编制权一并归项管（H85 同规格下放）：项管按待验收/待定夺积压动态调审检并发与池并发。
// 硬顶＝成本保险丝，仅制作人可改（config.并发.硬顶 / dispatch.HARD_CAP），越顶一律 400。
// GET = 聚合快照（审检+零输出在 config、池并发在台账，一处看得全）；
// POST = {审检?,零输出分钟?,池?:{codex,claude,deepseek},理由}，整批校验通过才落，记账口径同编制调整。
const concurrency = require('./lib/concurrency');
app.get('/api/pm/concurrency', (req, res) => {
  if (!ready(res)) return;
  res.json(concurrency.view(cfg, pmLedger.read(ROOT).并发上限));
});
app.post('/api/pm/concurrency', (req, res) => {
  if (!ready(res)) return;
  const { 理由, ...改动 } = req.body || {};
  const 池前 = pmLedger.read(ROOT).并发上限 || {};
  const r = concurrency.apply(cfg, 改动, 池前);
  if (!r.ok) return res.status(400).json({ error: r.error, ...(r.越顶 ? { 越顶: true } : {}) });
  concurrency.write(cfg, r.并发); saveCfg();
  if (JSON.stringify(r.池) !== JSON.stringify(池前)) pmLedger.update(ROOT, (l) => { l.并发上限 = r.池; });
  const 摘 = r.生效.map((v) => v.摘).join('；');
  journal.append(ROOT, `并发调配（施工令-010）：${摘}｜理由：${String(理由 || '未述').slice(0, 120)}`);
  pmLedger.event(ROOT, '并发调配', { 生效: r.生效, 理由: String(理由 || '').slice(0, 200) });
  res.json({ ok: true, 生效: r.生效, ...concurrency.view(cfg, pmLedger.read(ROOT).并发上限) });
});

// ---- 池衡控制面（H99 · 施工令-045）----
// 案源：制作人 2026-08-11 决议「项管拥有读额度切模型的权力，他应该做到平衡才行」。
// 业务全在 lib/pm/poolbalance（读数归一/决策/回退/CAS/品味锁都在那儿可单测），此处**只做路由**。
// 写路由是**枚举动作**而不是通用 patch：项管手里只有这四把钥匙，别的门连锁孔都没有——
// 「brain 提示词自由文本不能直接改 cfg」这一条，靠的就是这里没有第二个写口（要件 10）。
const poolbalance = require('./lib/pm/poolbalance');
app.get('/api/pm/poolbalance', async (req, res) => {
  if (!ready(res)) return;
  const 读数 = await poolbalance.采集(ROOT, cfg).catch(() => ({}));
  res.json(poolbalance.矩阵(cfg, 读数, { 事件: pmLedger.events(ROOT, 400), 活单: poolbalance.活单摘(ROOT) }));
});
app.post('/api/pm/poolbalance/:action', (req, res) => { // 中文动作名走 :action 参数（同 /api/schedule/:action：字面量中文路径在 express 4 下必 404）
  if (!ready(res)) return;
  const b = req.body || {};
  const r = poolbalance.执行动作(ROOT, cfg, { ...b, 动作: String(req.params.action || '') }, { 保存: saveCfg });
  // 码由 lib 给：403 越权/品味锁 · 409 CAS 冲突或覆盖冻结 · 429 迟滞窗内 · 400 其余语义错
  if (!r.ok) return res.status(r.码 || 400).json(r);
  res.json(r);
});

// ---- 排程台账（施工令-040 · Q1 后端半）----
// 案源 2026-08-11 点名巡礼：「监制台看不到后续的队列工作」。计划粒 = 尚未成单的批次计划项，
// 业务全在 lib/pm/schedule（事件折叠/状态机/CAS 都在那儿可单测），此处**只做路由**：
// 取参 → 调 → 按 ok 决定状态码。三条写路由一律显式带 预期版本（CAS 是 API 层的硬要求，
// 不是"底层顺手做了"——版本冲突回 409 并把现态一起下发，前端照着重试即可）。
// 消费接线（流程页/总览/晨晚报）在施工令-041，本令不动前端。
const schedule = require('./lib/pm/schedule');
app.get('/api/schedule', (req, res) => {
  if (!ready(res)) return;
  const 粒 = schedule.现态(ROOT); // 已按 批/序 排好：排序口径在 lib 里唯一，消费端不许各排各的
  const 计数 = {};
  for (const s of schedule.状态全集) 计数[s] = 粒.filter((g) => g.状态 === s).length;
  // 工期判定随现态下发（2026-08-20 补，项管页甘特点名要它）：延期/超期/需重排的**唯一实现**
  // 是 lib 里的纯函数，前端够不着。不下发的后果不是「少个字段」，是甘特要么不敢画红条、
  // 要么自己复刻一套判定——那就成了两把尺，同一条待办在甘特图和晨晚报里给出不同的延期天数。
  // 判定挂在每粒身上而不是另开一个端点：它是这粒的属性，分两处取必然有一处拿的是旧的。
  const 带判定 = 粒.map((g) => ({ ...g, 判定: schedule.工期判定(g) }));
  // 名册随现态下发（2026-08-21 归属换轴）：上级号 → 可读名。
  // 前端不自己去拼——特性册与专项册各有权威源，两处各拼一遍就是两把尺。
  const 名册 = {};
  try { for (const f of require('./lib/features').list(ROOT) || []) 名册[f.id] = (f.fm && f.fm.名称) || ''; } catch { /* 退化成裸号，不炸页 */ }
  try { for (const sp of require('./lib/specials').list(ROOT) || []) 名册[sp.id] = (sp.fm && sp.fm.名称) || ''; } catch { /* 同上 */ }
  res.json({ 粒: 带判定, 计数, 名册, 型集: schedule.型集, 状态全集: schedule.状态全集, 转移表: schedule.转移表 });
});
// 三条写路由走 :action 参数而不是三个中文字面量路径——express 4 的静态路径按**原始 URL**
// 匹配，而 fetch('/api/schedule/登记') 发出去的是百分号编码，字面量路由一律 404（本令实测踩到）。
// 参数位由 express 解码，中文动作名从此两种写法都认。同 /api/act/:name 的既有口径。
const 排程动作 = {
  登记: (b) => schedule.登记(ROOT, b.粒 || b.批次 || [], b.操作者),
  转移: (b) => {
    const 人 = String(b.操作者 || '').trim();
    if (!schedule.操作域.转移.includes(人)) return { ok: false, 越权: true, error: `转移权在 ${schedule.操作域.转移.join('/')}（收到「${人 || '空'}」）` };
    return schedule.转移(ROOT, { 粒ID: b.粒ID, 目标: b.目标, 预期版本: b.预期版本, 操作者: 人, 单号: b.单号, 说明: b.说明 });
  },
  // 就绪 透传（2026-08-20）：项管排完一批说「这批可以放了」，G8「待办放行成单」人闸的判据读的就是它。
  // **必须原样透传，不许 `b.就绪 || false` 兜底**——省略键在 lib 侧是「这一格不动」，兜底会把它变成「改成 false」。
  调整: (b) => schedule.调整(ROOT, { 粒ID: b.粒ID, 预期版本: b.预期版本, 序: b.序, 依赖: b.依赖, 池衡建议: b.池衡建议, 就绪: b.就绪, 项目: b.项目, 型: b.型, 上级: b.上级, 操作者: b.操作者, 说明: b.说明 }),
  // 重排（制作人：「发生延期或是超期完成需要重新排期」）：另开一口不并进 调整——
  // 排期改动必须留下「从哪天挪到哪天、较基线延几天、为什么」，混进调整就只剩一行「改了几个字段」。
  // 三格同样原样透传：不传＝不动，显式 null＝清空。
  重排: (b) => schedule.重排(ROOT, { 粒ID: b.粒ID, 计划开始: b.计划开始, 计划完成: b.计划完成, 工期天: b.工期天, 因: b.因, 操作者: b.操作者, 预期版本: b.预期版本 }),
};
app.post('/api/schedule/:action', (req, res) => { // 参数名只能是 ASCII：path-to-regexp 不认中文占位符（会当字面量）
  if (!ready(res)) return;
  const 名 = String(req.params.action || '');
  const fn = 排程动作[名];
  if (!fn) return res.status(404).json({ error: `未知排程动作：${名}（可选 ${Object.keys(排程动作).join('/')}）` });
  const b = req.body || {};
  const r = fn(b);
  // 409 = 拿旧版本写，前端照回传的现态静默重试即可；400 = 语义就不对，重试也没用；403 = 不在操作域
  if (!r.ok) return res.status(r.越权 ? 403 : r.冲突 ? 409 : 400).json(r);
  记事件('排程' + 名, { 粒ID: b.粒ID || undefined, 操作者: String(b.操作者 || ''), ...(名 === '登记' ? { 新增: r.新增.length, 跳过: r.跳过.length } : {}), ...(名 === '转移' ? { 目标: b.目标, 单号: r.粒.单号 || '' } : {}) });
  res.json(r);
});

// ---- 排程台账 · 三消费读口（施工令-041 · Q2）----
// 呈现判据全在 lib/pm/schedule-view（纯函数，5 态 × 3 消费可整片单测），此处仍**只做路由**：
// 取现态 → 喂进去 → 下发。三条都是纯读，没有一条会写账。
// 路由同样走 :action 参数：中文字面量路径在 express 4 下按原始 URL 匹配，
// fetch('/api/schedule/切片') 发出去是百分号编码，字面量一律 404（040 实测踩过）。
const scheduleView = require('./lib/pm/schedule-view');
const 排程读 = {
  // 流程页：管线行 + 「监制台维护队列」（批无管线的 Q 队列粒）
  流程: () => scheduleView.流程页(schedule.现态(ROOT)),
  // 总览横幅：在做 + 排程待办 + 决策台待签，一行话三问。
  // 「在做」与流程页现在区同一口径：目录态 在途/质检 ∪ 有活跃会话（判官会话也算在做）——
  // 只数 runner.执行中 的话，一张已领单但会话还没起的单会让横幅报「现在无在做」，
  // 而同一时刻流程页那条橙区里明明躺着它。挂起的原位冻结单两处都不算在做。
  摘要: () => {
    const 在跑 = []; const 见 = new Set();
    const 收 = (id, title) => { if (id && !见.has(id)) { 见.add(id); 在跑.push({ id, title: title || '' }); } };
    for (const t of pool.inFlight(ROOT)) if (['在途', '质检'].includes(t.state) && !t.fm.挂起) 收(t.id, t.fm.title);
    for (const e of (runnerStatus().执行中 || [])) {
      let t = null; try { t = store.find(ROOT, e.id); } catch { /* 单已挪走：只报单号 */ }
      if (!t || !t.fm.挂起) 收(e.id, t && t.fm ? t.fm.title : '');
    }
    const 待签 = store.list(ROOT, '待验收').length + store.list(ROOT, '待定夺').length;
    return scheduleView.摘要({ 在跑, 粒们: schedule.现态(ROOT), 待签 });
  },
  // 晨晚报组稿：当日状态变更过的 + 计划中的前 N 条
  切片: (q) => scheduleView.切片(schedule.现态(ROOT), { 日: q.日, 上限: q.上限 ? Number(q.上限) : undefined }),
  // 项目内「队列」页（施工令-042 §一）：本项目全量五态计划粒，按 批→序 分组 + 依赖置灰
  队列: (q) => {
    const ctx = 工单语境(q.项目);
    // 名册：上级号 → 可读名。不喂的话组头只剩「F-10」这种裸号，人得自己去背编号表。
    // 特性与专项各有权威源，在这里合并一次喂给纯函数（视图层不去读盘）。
    const 名册 = {};
    try { for (const f of require('./lib/features').list(ROOT) || []) 名册[f.id] = (f.fm && f.fm.名称) || ''; } catch { /* 特性册不可读：退化成裸号，不炸页 */ }
    try { for (const sp of require('./lib/specials').list(ROOT) || []) 名册[sp.id] = (sp.fm && sp.fm.名称) || ''; } catch { /* 同上 */ }
    return scheduleView.队列页(schedule.现态(ROOT), { 项目: q.项目, 管线集: ctx.管线集, 单号集: ctx.单号集, 单号态: ctx.单号态, 名册 });
  },
  // 主页工程队队列卡（施工令-042 §二）：无管线的待办粒（Q 队列），最多 N 行
  工程队: (q) => scheduleView.工程队队列(schedule.现态(ROOT), {
    上限: q.上限 ? Number(q.上限) : 8,
    单号态: 工单语境('').单号态,
  }),
};
// 队列页的项目归属与依赖判据要的工单佐证（施工令-042 §一）：
// 计划粒身上没有项目章（040 的字段表里就没这一格），管线与单号是它跟项目之间仅有的两根绳子；
// 依赖若指向工单，还得知道那张单了结没有。三份佐证都从工单池现取，不缓存——
// 队列页本来就是低频页，缓存换来的那点耗时，抵不上「看到的是上一分钟的账」这种错。
function 工单语境(项目) {
  const snap = store.snapshot(ROOT);
  const 单号态 = {}; const 全单 = [];
  for (const s of store.STATES) {
    for (const t of (snap[s] || [])) {
      单号态[t.id] = s;
      全单.push({ id: t.id, 项目: t.fm.项目 || null, 管线: t.fm.管线 || null, 父单: t.fm.父单 || null });
    }
  }
  const byId = Object.fromEntries(全单.map((t) => [t.id, t]));
  const p = String(项目 || '').trim();
  const 默认 = (cfg && cfg.项目 && cfg.项目.默认) || '';
  // 无章的单归默认项目——与前端 projOf() 同一口径（多项目视界 D42），否则老单会整片判成外项目
  const 本项目 = p ? 全单.filter((t) => (t.项目 || 默认) === p) : 全单;
  const 管线集 = [...new Set(本项目.map((t) => pipelines.pipelineOf(t, byId)).filter(Boolean))];
  return { 单号态, 管线集, 单号集: 本项目.map((t) => t.id) };
}
app.get('/api/schedule/:action', (req, res) => {
  if (!ready(res)) return;
  const 名 = String(req.params.action || '');
  const fn = 排程读[名];
  if (!fn) return res.status(404).json({ error: `未知排程读口：${名}（可选 ${Object.keys(排程读).join('/')}）` });
  res.json(fn(req.query || {}));
});

// ---- 产出调起：打开文件/所在文件夹（仅限该单所属项目仓内，越界拒）----
app.post('/api/open', (req, res) => {
  if (!ready(res)) return;
  const { id, 路径, 方式 } = req.body || {};
  const t = store.find(ROOT, String(id || ''));
  if (!t) return res.status(404).json({ error: '工单不存在' });
  const proj = t.fm.项目 && cfg.项目 && cfg.项目.注册 && cfg.项目.注册[t.fm.项目];
  if (!proj) return res.status(400).json({ error: '该单无所属项目，无法定位产出' });
  const abs = require('./lib/artifacts').resolveIn(proj.路径, String(路径 || ''));
  if (!abs) return res.status(400).json({ error: '路径越出项目仓，拒绝调起' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '文件不存在：' + String(路径).slice(0, 60) });
  const { spawn } = require('child_process');
  const win = abs.replace(/\//g, '\\');
  if (方式 === '文件夹') spawn('explorer', ['/select,', win], { detached: true, windowsHide: true }).unref();
  else spawn('cmd', ['/c', 'start', '', win], { detached: true, windowsHide: true }).unref();
  res.json({ ok: true });
});

// ---- 决策台（P4）：待验收 + 待定夺 ----
app.get('/api/decisions', (req, res) => {
  if (!ready(res)) return;
  // 挂起字段随行（施工令-021）：决策台要据此置灰并给出解挂按钮——不带这一栏，制作人在签字位上
  // 看到的就是一张「看着能签、点下去被拦」的单。
  const accept = store.list(ROOT, '待验收').map((t) => ({ id: t.id, title: t.fm.title, 职能: t.fm.职能, 验收方式: t.fm.验收方式, QA: t.fm.QA, 项目: t.fm.项目, 挂起: t.fm.挂起 || null, 父单类型: t.fm.父单类型 || null }));
  const escal = store.list(ROOT, '待定夺').map((t) => ({ id: t.id, title: t.fm.title, 职能: t.fm.职能, 自修次数: t.fm.自修次数 || 0, 项目: t.fm.项目, 挂起: t.fm.挂起 || null, 父单类型: t.fm.父单类型 || null }));
  res.json({ 待验收: accept, 待定夺: escal, 积压闸: (cfg.闸值 || {}).待验收积压闸, 积压: accept.length });
});

// ---- 等我（施工令-061 二·2）：全系统唯一的「欠人几笔」谓词 ----
// 与上面 /api/decisions 的关键差别：那条按**工单状态**取（待验收∪待定夺），故专项关账这类
// 非工单实体的闸结构上取不到——08-20 实测欠 3 笔而决策台报 1 笔，页顶还写「积压 1/8」。
// 本条按**闸**取，逐闸查各自的权威源。/api/decisions 在次序闸走完（详情页补齐通过入库钮 +
// 三个孤儿闸安家）之前不动，两条并行一个周期供对拍——先建后删是硬前置，不是保守。
app.get('/api/attn', (req, res) => {
  if (!ready(res)) return;
  const gr = require('./lib/gatereg');
  // status 要 (root, cfg) 两参——漏传 cfg 会在函数内读 cfg.执行器 时抛 TypeError，
  // 而这条端点没被单测覆盖，只有真机冒烟才炸得出来（0.26.15 换装冒烟实录）。
  const 活跃 = new Set((runner.status(ROOT, cfg).执行中 || []).map((s) => s.id));
  const T = gr.逾期阈值(cfg); // 唯一取值口（原为 `|| 24`，与 runner 的 `?? 24` 打架：T=0 时两边判反）
  const r = gr.等我(ROOT, { 归属: req.query.归属 || undefined, deps: { 活跃单: 活跃 } });
  // T<=0 = 关闭升格（2026-08-21 案）：阈值那一格必须下发 null，不能只清 逾期 数组——
  // public/app.js:167-168 与 :328 是拿 逾期阈值小时 自己重算标记的，阈值留着 0 的话前端照样全红。
  res.json({ ...r, 逾期阈值小时: T > 0 ? T : null, 逾期: T > 0 ? r.债.filter((x) => x.停摆小时 != null && x.停摆小时 >= T) : [] });
});

// ---- 两道闸状态（P1/P2 横幅）----
app.get('/api/gates', async (req, res) => {
  if (!ready(res)) return;
  try {
    const locks = await gates.allLocks(cfg);
    // 沟通护城河读数（施工令-006）：UI 此前完全不提示，制作人看不出「claude 生产单为什么不动」。
    // 判定不另写一套——直接问 dispatch.moatBlocked，UI 与调度同一把尺，绝不各算各的。
    const gi = require('./lib/budget').并入({ codex: locks.codex, claude: locks.claude }, require('./lib/budget').冻结池(cfg, ROOT));
    const 保留 = Number((cfg.额度 || {}).沟通保留 ?? 20);
    const moat = { 池: 'claude', 保留线: 保留, 窗口: '5h', 余量: locks.claude.fivePct == null ? null : 100 - locks.claude.fivePct,
      已越: require('./lib/pm/dispatch').moatBlocked(cfg, gi, 'claude') };
    // 预算闸失效位（施工令-046）：三候选全失守时 lib/budget 落的是空实现——不落账、不冻结、零症状。
    // 这一位是那台哑火保险丝在 API 面的唯一出口，参数页额度卡据此挂红标。正常命中时返回体逐字节不变。
    // OAuth 门禁横幅（施工令-055 要件 1）：已过期/未登录才出条（临期只走急件），纯读盘无副作用。
    // 挂在 /api/gates 而不是新开端点——门禁位本来就是「为什么不派单」的唯一问答处，凭据死了也是一种闸。
    // 推荐在途（D28）已随精力档/拉取制退役：前端 0.23.11 撤制度、0.24.7 清视图（app.js `const recCards = '';`
    // 就是它的墓碑）。服务端这一格却留到今天——前端每 5 秒轮一次 /api/gates，于是每 5 秒
    // 算一整套 recommend()（内含 countDecisions 全量读 journal，活体 2.4MB），算出来的数零处显示。
    res.json({ paused: require('./lib/core/state').read(ROOT).paused, locks: gi, 护城河: moat,
      OAuth: require('./lib/oauth').横幅(cfg),
      ...require('./lib/budget-resolve').失效位(require('./lib/budget')) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// H69 评分仪表盘：岗位×模型矩阵聚合（均分+样本数，n<5 前端灰显）。只读仪表盘，不接奖惩。
app.get('/api/scores', (req, res) => {
  if (!ready(res)) return;
  const all = require('./lib/pm/ledger').scores(ROOT);
  const agg = {};
  for (const s of all) {
    let key;
    if (s.线 === '审检评执行') key = `执行|${s.职能 || '?'}|${s.池 || '?'}${s.模型 ? '/' + s.模型 : ''}`;
    else if (s.线 === '执行评拆单') key = `项管拆单|${s.切单人 || '项管'}|opus`;
    else if (s.线 === '项管评审检') key = `审检报告|核查+质检|opus`;
    else continue;
    (agg[key] = agg[key] || { 总: 0, n: 0 }).总 += s.分; agg[key].n += 1;
  }
  const 误判 = all.filter((s) => s.线 === '审检误判');
  const rows = Object.entries(agg).map(([k, v]) => {
    const [线, 岗位, 模型] = k.split('|');
    return { 线, 岗位, 模型, 均分: Math.round((v.总 / v.n) * 10) / 10, n: v.n };
  });
  res.json({ rows, 审检误判: { 漏判: 误判.filter((x) => x.类型 === '漏判').length, 误杀: 误判.filter((x) => x.类型 === '误杀').length, 明细: 误判.slice(-10) } });
});

// 编辑器锁（H64）：制作人开 Unity 前手动关锁=声明验收，派发挂起；用完编辑器退出自动开锁。
app.post('/api/editor-lock', (req, res) => {
  if (!ready(res)) return;
  const { 项目, 关 } = req.body || {};
  const name = 项目 || (cfg.项目 && cfg.项目.默认) || 'TK';
  require('./lib/core/state').update(ROOT, (s) => {
    s.编辑器锁 = s.编辑器锁 || {};
    if (关) s.编辑器锁[name] = { 关: true, 关时: new Date().toISOString(), 见过编辑器: false };
    else delete s.编辑器锁[name];
  });
  journal.append(ROOT, `编辑器锁 ${name} → ${关 ? '关（制作人要开 Unity 验收，派发挂起）' : '开（手动解锁，派发恢复）'}`);
  res.json({ ok: true, 编辑器锁: require('./lib/core/state').read(ROOT).编辑器锁 || {} });
});
// 暂停总闸（H81 常开单闸制）：无 scope 的单开关，默认开（跑是常态，停是例外）
app.post('/api/gate/pause', (req, res) => {
  if (!ready(res)) return;
  const p = gates.setPaused(ROOT, !!(req.body || {}).value);
  journal.append(ROOT, `暂停总闸 → ${p ? '合（全链停派发）' : '开（恢复派发）'}`);
  res.json({ ok: true, paused: p });
});

// ---- 生命周期动作（P4/P8 按钮）----
const ACTIONS = {
  定稿: (b) => life.定稿(ROOT, b.id),
  投池: (b) => life.投池(ROOT, b.id),
  撤回: (b) => life.撤回(ROOT, b.id),
  废弃: (b) => { runner.killTicket(ROOT, b.id); return life.废弃(ROOT, b.id); }, // 在途被废弃：先掐会话再挪单（2026-08-05）
  收回: (b) => { runner.killTicket(ROOT, b.id); return life.收回(ROOT, b.id); },
  交产出: (b) => life.交产出(ROOT, b.id, b.回执),
  QA裁定: (b) => life.QA裁定(ROOT, cfg, b.id, !!b.通过),
  定夺: (b) => life.定夺(ROOT, b.id, b.决定, b.方向, b.裁决人), // 方向文本随 给方向 落工单正文（D43③）
  验收: (b) => life.验收(ROOT, b.id, !!b.通过),
  失败分诊: (b) => life.失败分诊(ROOT, b.id, b.决定), // D31：重投/上呈（废弃走通用废弃）
  解除复核: (b) => life.解除待复核(ROOT, b.id, b.说明), // D36：核对新版后解除
  返修: (b) => life.返修(ROOT, b.id, b.说明), // H65：同活同号——执行失败/待验收回草稿改写，计数保留（掐在飞审检会话已内置在 life.返修，施工令-032①，别在这层重复掐）
  实证放行: (b) => life.实证放行(ROOT, b.id, b.操作者, b.说明), // 施工令-032② H97：门禁单核查过后候检，总监确认引擎证据入回执 → 转完成
  推翻: (b) => life.推翻(ROOT, b.id, b.理由), // 制作人翻案：完成/已归档 → 自动编号返工草稿
  隐藏: (b) => life.隐藏(ROOT, b.id, b.值), // 隐藏归档：默认视图湮灭，纸面可考
  // 施工令-021 制作人裁决权：挂起=原位冻结（单不挪窝，全链路跳过），解挂=原位复活。
  // 掐会话与废弃/收回同款——在途单被冻结时进程还在跑，等于没冻。
  挂起: (b) => {
    // 先掐后冻：反过来的话，冻结与掐会话之间那一小段里会话可能刚好收线，
    // 交产出虽被 life 层的挂起守卫挡住，却会白白走一趟失败路径（回执已落盘、状态没动）。
    runner.killTicket(ROOT, b.id);
    if (!b.全树) return life.挂起(ROOT, b.id, b.操作者, b.理由);
    for (const c of life.子孙(ROOT, b.id)) runner.killTicket(ROOT, c.id);
    return life.挂起树(ROOT, b.id, b.操作者, b.理由);
  },
  解挂: (b) => (b.全树 ? life.解挂树(ROOT, b.id, b.操作者) : life.解挂(ROOT, b.id, b.操作者)),
  放行: (b) => { // H49 派发制：待投单标放行（依赖就绪即被派发引擎拉起）
    const t = store.find(ROOT, b.id);
    if (!t) return { ok: false, error: '不存在' };
    if (t.state !== '待投') return { ok: false, error: `只有待投单可放行（当前 ${t.state}）` };
    const r = store.update(ROOT, b.id, (fm) => { fm.放行 = true; });
    if (r.ok) journal.append(ROOT, `放行 ${b.id}（H49：入就绪队列，依赖就绪即派发）`);
    return r;
  },
};
// H49：派发制下「投池」语义重定向为放行（旧 UI 按钮零改动兼容）
const legacy投池 = ACTIONS.投池;
ACTIONS.投池 = (b) => (cfg.执行器 && cfg.执行器.派发制) ? ACTIONS.放行(b) : legacy投池(b);
// H49 接线①：专项父单定稿 → 项管自动切单（拍板的下半步）
// 定稿预检（H62）已抽出 lib/preflight.js：错误=拦截，警示=不拦截只提醒（H83 短题制）
const { preflight, warnings: preflightWarn } = require('./lib/preflight');
const legacy定稿 = ACTIONS.定稿;
ACTIONS.定稿 = (b) => {
  const t0 = store.find(ROOT, b.id);
  const errs = preflight(ROOT, t0, cfg);
  if (errs.length) {
    journal.append(ROOT, `定稿预检拦截 ${b.id}：${errs.length} 条（H62）`);
    return { ok: false, error: '预检不过：' + errs.join('；') };
  }
  const warns = preflightWarn(t0, ROOT); // 短题制 + 管线归属警示：只提醒不拦截，老单在途单照过（传 ROOT 才能沿父链判继承）
  if (warns.length) journal.append(ROOT, `定稿预检警示 ${b.id}：${warns.join('；')}（未拦截）`);
  if (t0 && !['战役', '专项'].includes(t0.fm.父单类型)) {
    store.update(ROOT, b.id, (fm) => { fm.审批人 = '总监'; fm.审批时间 = new Date().toISOString(); }); // H62 归因记账：放行章落单
  }
  const r = legacy定稿(b);
  if (r.ok && warns.length) r.警示 = warns; // 随结果回前端提示，动作照常完成
  // H57 透明化：定稿是 Claude 审批放行动作，入台账事件供项管视图可见
  if (r.ok) 记事件('定稿放行', { 单: b.id });
  if (r.ok && cfg.执行器 && cfg.执行器.派发制) {
    const t = store.find(ROOT, b.id);
    // 施工令-058 要件2：这条挂钩从此**只服务存量战役号**。专项已实体化，它的切单挂在
    // 「立项」那一刻（POST /api/specials）——容器不再有「定稿」这一态可挂。
    // 未迁移的存量 专项父单工单还留在库里时：不自动切，但明说一句去哪儿切，不让人对着静默发呆。
    if (t && t.fm.父单类型 === '战役') {
      const proj = t.fm.项目 && cfg.项目 && cfg.项目.注册 && cfg.项目.注册[t.fm.项目];
      require('./lib/pm/wake').onCampaignFinalized(ROOT, cfg, t, proj && proj.路径);
      return { ...r, 项管: `切单已启动（${(cfg.模型 || {}).项管 || 'opus'}），简报完成后进台账待审` };
    }
    if (t && t.fm.父单类型 === '专项') {
      journal.append(ROOT, `定稿 ${b.id} 是存量专项伪单：切单挂钩已迁至「专项立项」（施工令-058），未自动切单`);
      return { ...r, 项管: '本单是存量专项伪单——专项已实体化（H103）：请走 专项页 迁移，或在专项页立项后自动切单' };
    }
  }
  return r;
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
  const fm = {
    id: b.id, title: b.title || '未命名', 职能: b.职能 || '策划', 产出物类型: b.产出物类型 || '文档',
    优先级: b.优先级 || 'P1', 规模: b.规模 || '单兵', QA: b.QA || '关', 验收方式: b.验收方式 || '保留',
    预计时间: b.预计时间 || '', 预计token: b.预计token || '',
    项目: b.项目 || (cfg.项目 && cfg.项目.默认) || '', // D32：执行 agent 据此定位目标仓库
    创建时间: b.创建时间 || new Date().toISOString().slice(0, 10), 更新时间: new Date().toISOString(),
  };
  if (b.阶段) fm.阶段 = String(b.阶段); // D43 阶段章
  if (b.粒ID) fm.粒ID = String(b.粒ID); // 施工令-040：本单兑现的排程计划粒（可选，手工起草也能挂）
  if (b.父单) fm.父单 = b.父单;
  if (b.依赖) fm.依赖 = b.依赖;
  if (b.依据) fm.依据 = b.依据;
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
// ---- 版本自证（2026-08-21 体检）----
// 案源：换装脚本的「验活」只 GET /api/config 看有没有应答，**证明不了换的是新版**；
// 而整个活体（API 与 UI）都不报自己是哪个版本，想比也无从比起。
// 实证：当日确认 G15 真进了包，靠的是 grep 活体解包出来的 app.asar 二进制——那不该是常规手段。
// 本端点不看 ready()：**服务半死时更需要知道跑的是哪一版**，而版本号是编译进包的静态值，不依赖仓库就绪。
app.get('/api/version', (req, res) => {
  let 码印 = null;
  try { 码印 = require('./lib/buildstamp').活体(); } catch { /* 指纹算不出不影响报版本 */ }
  res.json({
    版本: require('./package.json').version,
    码印: 码印 ? 码印.指纹 : null,
    文件数: 码印 ? 码印.文件数 : null,
    起于: 起动时刻,
  });
});

app.get('/api/config', (req, res) => {
  if (!ready(res)) return;
  // 兼容池密钥脱敏（0.22.1）：config 会流向远程客户端，密钥只留尾四位指纹
  const pools = JSON.parse(JSON.stringify(cfg.执行池 || {}));
  // 托管标记（施工令-029）：key 迁进 DPAPI 托管后 config 明文字段是空的，
  // 界面若照旧渲染「密钥 未设」会像掉了配置——如实标出「已托管」，兜底字段还在就一并说明。
  let 托管池 = new Set();
  try { 托管池 = new Set(creds.list(ROOT).map((r) => r.池)); } catch { /* 托管库读不动不影响参数页 */ }
  for (const [n, p] of Object.entries(pools)) {
    if (!p.兼容) continue;
    if (p.兼容.key) p.兼容.key = '●●●●' + String(p.兼容.key).slice(-4);
    if (托管池.has(n)) p.兼容.托管 = true;
  }
  res.json({ 闸值: cfg.闸值, 闸值白名单, 执行池: pools, 编制: cfg.编制 || roster.read(cfg), 职能: cfg.职能, 项目: cfg.项目 || {}, 模型: cfg.模型 || {}, 执行器: cfg.执行器 || {}, quota: cfg.quota || {}, server: cfg.server || {} });
});
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
  res.json({
    codex: { 检测: codexDetect, 可选: uniq([codexDetect, ...(opt.codex || [])]) },
    claude: { cli: claudeCli, 可选: uniq(opt.claude || ['sonnet', 'opus', 'haiku']) },
  });
});

// 单个 agent 模型档调整（D38）已并入 /api/pm/roster（H85 编制权下放项管）——参数页编制区已拆，不再有第二条写路径

// ---- 消耗报表（停车场老待办落地）：明文事实源只读聚合，项目过滤走查询参数 ----
const report = require('./lib/report');
app.get('/api/report', (req, res) => {
  if (!ready(res)) return;
  // 项目切分在服务端做（2026-08-21 体检）：前端各自过滤就是两把尺——
  // 实测报表页头写「监制台 · Ticketflow」而顶栏 8 个读数是全工作室的。
  res.json(report.aggregate(ROOT, {
    项目: String(req.query.项目 || '').trim(),
    默认项目: (cfg.项目 && cfg.项目.默认) || '',
  }));
});

// ---- 阶段字典与阶段标准（D43）：字典=项目可配默认 L0-L2；标准=阶段标准.md 明文（缺则落模板）----
const stages = require('./lib/stages');
app.get('/api/stages', (req, res) => {
  if (!ready(res)) return;
  if (stages.ensureStandards(ROOT)) journal.append(ROOT, '阶段标准.md 模板已落盘（D43 首次使用）');
  const proj = String(req.query.项目 || '') || (cfg.项目 && cfg.项目.默认) || '';
  res.json({ 阶段: stages.stagesFor(cfg, proj), 标准: stages.parseStandards(ROOT) });
});

// 单个 agent 执行池切换已并入 /api/pm/roster（H85）。在途安全性不变：领单时池名已盖章进工单
// frontmatter，执行器只认章——改编制只影响下一单。

// ---- 上游改动标记（复查#8 = D36）：锚号改版 → 引用它的未完成单全标待复核 ----
app.post('/api/review-flag', (req, res) => {
  if (!ready(res)) return;
  const { 锚号, 说明 } = req.body || {};
  if (!锚号) return res.status(400).json({ error: '缺 锚号（如 战斗系统#战斗-03）' });
  res.json(life.标记待复核(ROOT, String(锚号), 说明));
});

// ---- 需注意计数 · **已退役，零消费方**（2026-08-21 体检换轴）----
// 原为 Electron 桌面通知的数据源。判据轴是「哪些**工单**处于 待验收∪待定夺∪执行失败」，
// 正是 lib/gatereg.js 立模块时判定必须换掉的那条轴——投池放行、专项关账、值守断更这些
// 非工单态的人闸它结构上看不见。当日同一分钟实测：本端点报全 0，/api/attn 报 计数 5。
// main.js 已改读 /api/attn?归属=制作人。本端点**留而不删**：
//   ① 旧版 exe 若还在跑会打它，删了就是把老客户端打成 404；
//   ② 留着这段代码 + 这段注释，比在 git 史里找「为什么当年有两条轴」便宜。
// 判据：全库零调用方 —— grep -rn "api/attention" apps packages | grep -v "^apps/studio/server.js" | grep -v "// " → 应为空。
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
// 工程队状态卡（施工令-002）：只读一份外部状态文件；无文件/坏文件回 {卡:null}，前端整卡不渲染
app.get('/api/crew', (req, res) => { res.json({ 卡: require('./lib/crew').read() }); });
app.get('/api/pulse', (req, res) => {
  if (!ready(res)) return;
  let acc = 0; const fold = (n) => { acc = ((acc * 31) + n) % Number.MAX_SAFE_INTEGER; };
  for (const s of store.STATES) { const d = store.stateDir(ROOT, s); try { for (const f of fs.readdirSync(d)) { const st = fs.statSync(path.join(d, f)); fold(Math.floor(st.mtimeMs)); } } catch { /* 空目录 */ } }
  res.json({ token: String(acc) });
});

// no-store：asar 内文件 mtime 恒定会骗过 ETag，换版后 Electron 磁盘缓存端出旧 UI（0.17.2 实测坑）
app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store') }));
// 风格库静态服务（美术库缩略图直读；express.static 自带路径穿越防护）
if (!initError) app.use('/stylelib-files', express.static(path.join(ROOT, '风格库')));
// STUDIO_PORT 覆盖（2026-08-08）：配置未就绪时也得有个能听的端口，
// 且开第二实例做验证时不该去抢正在服役那个的 4270。
const port = Number(process.env.STUDIO_PORT) || (cfg && cfg.server && cfg.server.port) || 4270;
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
    const bindAddr = REMOTE().开 ? '0.0.0.0' : '127.0.0.1'; // 远程开=全接口监听（令牌把门）
    const srv = app.listen(port, bindAddr, () => {
      console.log(initError ? `监制台启动但未就绪：${initError}` : `监制台已启动：http://127.0.0.1:${port}${bindAddr === '0.0.0.0' ? '（远程监听已开，令牌把门）' : ''}`);
      // 醒目一行：桩台与实弹台长得一模一样，唯一区别就是这行日志——起错台是 037 事故的第一步
      if (STUB) console.log('★★ 桩台模式（STUDIO_STUB=1）：零派发零计费 —— 执行器派发面已硬关，额度查询与连通探测已停用 ★★');
      巡检();
      if (!initError) setInterval(巡检, 30 * 60000).unref();
      // 自动记账（D35）：定期把工单流转/回执/journal git commit 落袋，间隔读 config（0=关）
      if (!initError) {
        const 记账分 = (cfg.执行器 || {}).记账间隔分钟 ?? 10;
        if (记账分 > 0) {
          const ledger = require('./lib/ledger');
          // 失败也要留痕（2026-08-21 体检）：原样 `if (ok)` —— 成功打屏、失败静默。
          // 收尾处置已抽成 lib/ledger.js 的具名工厂（#50）：写在这里的匿名闭包除了 grep 源码
          // 没有第二种验法，抽出去才验得动（判据见 test/ledger-scope.test.js）。
          const 记 = () => ledger.commitStudio(ROOT, ledger.记账回调(ROOT)); // 回调实现与判据都在 lib/ledger.js
          setInterval(记, 记账分 * 60000).unref();
        }
      }
      // 项管在途巡检（H61，2026-08-05 用户拍板）：每 15 分钟体检在途单——会话存活/进展尾巴/
      // 耗时对预估。确定性检查零 token；异常入呼叫信箱上报总监裁决，台账留巡检心跳。
      if (!initError) {
        // 拍体已搬进 lib/pm/patroltick.js（2026-08-22 体检 #24/#28）：闭在 setInterval 里的代码
        // 只能被源码文本判据看着，而「一只狗炸了后面几只还跑不跑」「连炸三拍立不立债」这两件事
        // 全是运行期行为——搬出来才验得动（测试真造一只必炸的狗、真跑三拍、真看 state 与信箱）。
        // ROOT/cfg 传取值函数：首次运行向导会就地重挂这两个，按值捕获会一直拿着旧仓库。
        const 巡检拍 = require('./lib/pm/patroltick').造巡检拍(() => ROOT, () => cfg, { 保存: saveCfg });
        setInterval(巡检拍, 15 * 60000).unref();
      }
      // 执行器随服务自动开工（D30 修订：开 exe 即开工厂，无需手动点启动）；
      // 停止按钮只管本次会话，"别干活"的常设语义交给暂停闸门/额度锁
      if (!initError) { try { require('./lib/runner').start(ROOT, () => cfg); } catch (e) { console.error('执行器启动失败：' + e.message); } }
      // 升格环与执行器开关解耦（2026-08-22 体检 #25 第二重）：挂在**开机处**而不是 start() 里。
      // stop() → stopLoop() 拆的是产线那条 15 秒环，碰不到这条——「人欠的债不因产线停摆而消失」
      // 这句话到此才在机器上成立（上方注释「停止按钮只管本次会话」正是本条的依据）。
      if (!initError) { try { require('./lib/runner').start升格环(ROOT, () => cfg); } catch (e) { console.error('升格环启动失败：' + e.message); } }
      resolve({ port, server: srv, initError });
    });
    srv.on('error', reject);
  });
}
module.exports = { start, port, initError };
if (require.main === module) start().then(({ initError: e }) => { if (e) process.exitCode = 1; }).catch((e) => { console.error(e.message); process.exit(1); });
