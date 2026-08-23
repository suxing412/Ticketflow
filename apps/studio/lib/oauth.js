// oauth.js — OAuth 续命哨兵（施工令-055，Q13 粒兑现）。
//
// 案源：OAuth 二次断链。08-10 三层剥洋葱；08-12 22:50 token 到点集体 401——判官席空烧三振、
// TK-163/164 连坐，人工修复 25 分钟。两次的共同点都不是「修不好」，而是**没人提前知道**：
// 凭据的寿命是一个可以在到期前几十分钟就读出来的确定性数字，我们却一直等 401 打脸才发现。
//
// 本模块把那个数字变成三件事（全确定性、零 token、零外呼）：
//   ① 巡检哨兵 哨兵()   —— 临期（<30 分钟）发急件催重登；已过期/未登录 再加一道门禁横幅；
//   ② 派发预检 派发预检() —— 寿命 <5 分钟的 claude 订阅会话直接拒派（撞上去必 401，
//                          而 401 在判官席上是要计失败次数的——白烧三振比不派危险得多）；
//   ③ 只读横幅 横幅()   —— /api/gates 的一位，UI 据此在门禁位挂常驻红条。
//
// 判据只认 claudeAiOauth.expiresAt 这一个字段（施工令要件 1 的原话）。读不到 / 文件缺失 /
// 没有 accessToken / expiresAt 不是数 —— 一律按「未登录」办（要件 3）：探不出寿命的凭据
// 与没有凭据在后果上是同一件事，都得响亮，绝不静默放行。
//
// 二期（施工令-057，055 上线首日 2026-08-13 的两处实证）在此之上再加两件：
//   ④ 临期自续 自续()   —— 16:49 实证：一发无头 `claude -p` 就把 token 续了 +8h。既然机器
//                          自己能修，哨兵就不该一上来先叫人：临期/过期先探一发，续成只留流水，
//                          **续败才发急件**。判据不认探针的退出码而认 expiresAt 有没有往前走
//                          ——「跑通了但没续上」和「压根没跑通」在后果上是同一件事。
//   ⑤ 拒派节流 拒派留痕()/拒派恢复() —— 16:43-16:44 三连同文：拒派挂在派发拍上，一分钟能刷三条
//                          一模一样的 journal。同单同因只在**状态变化**时留痕（首拒一条、恢复一条，
//                          恢复条附「期间拒派 N 次」），中间静默计数。
//
// 唯一会写凭据文件的路径是自续探针里的 CLI 自己（本模块仍不解析、不改写 .credentials.json，
// 只在探针前后各读一次做对比）。查用量那条线上的 quota.refreshClaudeToken 各走各的，互不知道。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const 临期分钟默认 = 30; // 要件 1：剩余低于此 → 先自续，续不上才急件催重登
const 拒派分钟默认 = 5;  // 要件 2：剩余低于此 → claude 订阅会话拒派
const 节流分钟默认 = 30; // 要件 3：同状态每 30 分钟至多一封急件
const 探针上限默认 = 2;  // 二期要件 3：同一到期窗口（且同一态）至多两发自续探针
// 重挂间隔（2026-08-22 体检 #41）：额度打空后，距上一发满 N 分钟放行**一发**。
// 没有它，「两发打空」就等于「本窗永久锁死」——而本窗要解锁只能靠 expiresAt 前移，
// expiresAt 前移又只能靠那两发已被封死的探针：自指死锁，实测 06:46—09:46 卡了 3h50m。
// 速率上限＝每 N 分钟一发 haiku 单词调用，「防循环烧调用」这条约束仍然守得住。
const 自续重挂分钟默认 = 30;
const 探针超时秒默认 = 60; // 二期要件 2：探针 60 秒不回就算续败
const 探针模型默认 = 'haiku'; // 探针只要「跑通一次调用」，用最便宜的档；空串＝不带 --model

const 凭据路径 = () => path.join(os.homedir(), '.claude', '.credentials.json');

// 阈值可配（config.凭据 段），默认即施工令原值。留这个口子是因为 access token 的实际寿命
// 由厂商定，哪天厂商把它砍到 15 分钟，30 分钟的临期线就会变成常亮红灯——那时改配置，不改代码。
function 参数(cfg) {
  const c = (cfg && cfg.凭据) || {};
  const 正数 = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    临期分钟: 正数(c.临期分钟, 临期分钟默认),
    拒派分钟: 正数(c.拒派分钟, 拒派分钟默认),
    节流分钟: 正数(c.节流分钟, 节流分钟默认),
    探针上限: 正数(c.探针上限, 探针上限默认),
    自续重挂分钟: Number.isFinite(Number(c.自续重挂分钟)) && Number(c.自续重挂分钟) >= 0
      ? Number(c.自续重挂分钟) : 自续重挂分钟默认, // 0 = 关掉重挂（打满即锁死，055 老行为）
    探针超时秒: 正数(c.探针超时秒, 探针超时秒默认),
    探针模型: c.探针模型 === undefined ? 探针模型默认 : String(c.探针模型 || ''),
    自续开: c.自续 !== false, // 默认开；出事时一行配置能把整套自续按死回 055 行为
  };
}

// ---- 读数（时钟与文件路径均可注入，测试不碰真凭据）----
// 返回 { 态, 剩余分, 剩余毫秒, expiresAt, 可续, 因 }；态 ∈ 有效/临期/过期/未登录。
function 寿命(cfg, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const { 临期分钟 } = 参数(cfg);
  const 未登录 = (因) => ({ 态: '未登录', 剩余分: null, 剩余毫秒: null, expiresAt: null, 可续: false, 因 });
  let raw;
  try {
    raw = opts.读 ? opts.读() : fs.readFileSync(opts.文件 || 凭据路径(), 'utf8');
  } catch (e) {
    return 未登录(e && e.code === 'ENOENT'
      ? '本机没有凭据文件（~/.claude/.credentials.json）——未登录'
      : '凭据文件读不动：' + String((e && e.message) || e).slice(0, 60));
  }
  let c;
  try { c = JSON.parse(raw).claudeAiOauth; } catch { return 未登录('凭据文件不是合法 JSON，寿命不可判——按未登录办'); }
  if (!c || !c.accessToken) return 未登录('凭据文件里没有 accessToken——未登录');
  const exp = Number(c.expiresAt);
  if (!Number.isFinite(exp) || exp <= 0) return 未登录('凭据没有 expiresAt，寿命不可判——按未登录办');
  const 剩余毫秒 = exp - now;
  const 剩余分 = Math.floor(剩余毫秒 / 60000);
  const 可续 = !!c.refreshToken;
  const base = { 剩余分, 剩余毫秒, expiresAt: exp, 可续 };
  const 到点 = new Date(exp).toTimeString().slice(0, 5);
  if (剩余毫秒 <= 0) {
    return { 态: '过期', ...base, 因: `token 已于 ${到点} 过期${可续 ? '（有 refresh，下次调用可自动续期，但续不上就是集体 401）' : '（且无 refresh，必须重登）'}` };
  }
  if (剩余毫秒 < 临期分钟 * 60000) {
    return { 态: '临期', ...base, 因: `token 剩余 ${剩余分} 分钟（${到点} 到期）` };
  }
  return { 态: '有效', ...base, 因: `token 有效至 ${到点}（剩余 ${剩余分} 分钟）` };
}

// 一键重登配方：与 server 的「官方登录命令」同一口径（config.执行器.登录命令.claude 可覆盖），
// 但本模块不能依赖 server——那是进程内的一个闭包。改为惰性问 runner 要 CLI 绝对路径，
// 问不到就退回裸命令名。配方进急件正文，制作人复制即可跑，不用先去翻文档。
function 登录配方(cfg) {
  const 覆盖 = ((cfg || {}).执行器 || {}).登录命令 || {};
  if (覆盖.claude) return String(覆盖.claude);
  try { return `"${require('./runner').resolveCli('claude').cmd}" auth login`; }
  catch { return 'claude auth login'; }
}

// ---- 自续探针（施工令-057 要件 2/3）----
// 实证（2026-08-13 16:49）：token 只剩几分钟时跑一发无头 `claude -p`，CLI 自己拿 refreshToken
// 换了新的，expiresAt 直接 +8h。所以「临期」这件事在多数时候根本不需要惊动人——它需要的是
// 有人替它发一次调用。这里就是那一发。
//
// 三条纪律：
//   · 用最便宜的档（默认 --model haiku）问一个字，我们不看它答什么，只看它跑不跑得通；
//   · 60 秒不回就 kill（连 CLI 都拉不起来的机器，等下去只是把巡检拍拖住）；
//   · 同一到期窗口至多两发（要件 3）。窗口用 expiresAt 当键：续成了 expiresAt 就变，
//     计数自然复位；续不成则第三拍起不再白烧调用，改成叫人。
//
// 2026-08-22 体检（#27/#41）：这本记忆原是 `new Map()`——一个纯进程内对象，两处都不成立。
//   ① **重启即白送两发**：今晨 10:30 那次「自续成功（第 1 发）」不是修好了，是 10:15
//      执行器重启把计数清了撞对的。这种「重启就好」最坏：它让人以为病没了。
//   ② **窗口键只认 expiresAt，不认态**：临期那一发与过期那一发共用同一份额度。而临期
//      与过期在后果上根本是两件事（08-22 06:16 journal 实证「探针跑通了但 expiresAt 没动」
//      正是临期那发的典型下场），临期把两发烧光，token 真过期后就一发都不剩，
//      之后只会每 30 分钟重复同一封急件。键上补一位态，两个态各自计额度。
// 落盘位置与 人闸升格 同待遇：.studio-state.json（core/state 只依赖 fs/path/durable，无循环依赖）。
const state = require('./core/state');
// 影子是**兜底不是主本**：盘写不动时（只读挂载、锁超时）不能连「防烧钱」上限一起丢——
// 那样就从「重启白送两发」退化成「每拍都白送」。读时盘优先、盘无才看影子。
const 探针影子 = new Map();
const 探针记忆 = {
  // root → { 窗: `${expiresAt}|${态}`, 次数, 末次 }
  get: (root) => {
    let 盘 = null;
    try { 盘 = (state.read(root) || {}).OAuth自续 || null; } catch { 盘 = null; }
    return 盘 || 探针影子.get(root) || null;
  },
  set: (root, v) => {
    探针影子.set(root, v);
    try { state.update(root, (s) => { s.OAuth自续 = v; }); } catch { /* 状态写不动不该把哨兵带崩，影子顶住 */ }
  },
  delete: (root) => {
    探针影子.delete(root);
    try { state.update(root, (s) => { delete s.OAuth自续; }); } catch { /* 同上 */ }
  },
  clear: () => { 探针影子.clear(); /* 盘上那份按 root 存，全清走 重置(root) */ },
};

function 默认探针(cfg) {
  const { 探针超时秒, 探针模型 } = 参数(cfg);
  return new Promise((resolve) => {
    let cmd;
    try { cmd = require('./runner').resolveCli('claude').cmd; } catch (e) { return resolve({ ok: false, 因: 'CLI 定位失败：' + String((e && e.message) || e).slice(0, 60) }); }
    // 代理必带：中台验证过的坑，claude 无头调用不走代理必死（与 runner.proxyEnv 同一口径）。
    const env = { ...process.env };
    const p = env.HTTPS_PROXY || env.https_proxy || ((cfg && cfg.网络 && cfg.网络.代理默认) || '');
    if (p) { env.HTTPS_PROXY = p; env.HTTP_PROXY = p; env.https_proxy = p; env.http_proxy = p; }
    const args = ['-p', '--output-format', 'text', ...(探针模型 ? ['--model', 探针模型] : [])];
    let child;
    try { child = spawn(cmd, args, { env, windowsHide: true, shell: cmd.endsWith('.cmd'), stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ ok: false, 因: '探针启动失败：' + String((e && e.message) || e).slice(0, 60) }); }
    let 完 = false, err = '';
    const 收 = (r) => { if (完) return; 完 = true; clearTimeout(闸); try { child.kill(); } catch { /* 已退出 */ } resolve(r); };
    const 闸 = setTimeout(() => 收({ ok: false, 因: `探针超时 ${探针超时秒}s（CLI 没在时限内回话）` }), 探针超时秒 * 1000);
    child.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    child.on('error', (e) => 收({ ok: false, 因: '探针进程错误：' + String((e && e.message) || e).slice(0, 60) }));
    child.on('close', (code) => 收(code === 0
      ? { ok: true, 因: '探针跑通（退出码 0）' }
      : { ok: false, 因: `探针退出码 ${code}${err ? '：' + err.replace(/\s+/g, ' ').trim().slice(-120) : ''}` }));
    // 提示词走 stdin（与 runner 同法，免 argv 编码坑）；纯 ASCII 一个词，答什么无所谓
    try { child.stdin.write('ping'); child.stdin.end(); } catch { /* 进程已死，close 分支会收尾 */ }
  });
}

// 试一发自续。返回 { 尝试, 成功, 增毫秒, 增文, 因, 次数 }；**判成功只认 expiresAt 往前走了**。
// 探针可注入（opts.探针）——测试不拉真 CLI，也不碰真凭据。
async function 自续(root, cfg, opts = {}) {
  const { 探针上限, 自续重挂分钟 } = 参数(cfg);
  const 前 = opts.前 || 寿命(cfg, opts);
  if (!前.可续) return { 尝试: false, 成功: false, 次数: 0, 因: '凭据里没有 refreshToken——自续无从谈起，只能人工重登' };
  // 窗口键 = expiresAt + 态：同一张 token 的「临期」与「过期」是两个窗口，各自计额度（体检 #27）
  const 窗 = `${前.expiresAt}|${前.态 || ''}`;
  const 现在 = opts.now != null ? opts.now : Date.now();
  const m = 探针记忆.get(root);
  const 同窗 = !!(m && m.窗 === 窗);
  const 已试 = 同窗 ? (Number(m.次数) || 0) : 0;
  const 末次 = 同窗 ? (Number(m.末次) || 0) : 0;
  const 满 = 已试 >= 探针上限;
  const 重挂 = 满 && 自续重挂分钟 > 0 && 现在 - 末次 >= 自续重挂分钟 * 60000; // 打满后每 N 分钟放行一发（体检 #41）
  if (满 && !重挂) {
    return { 尝试: false, 成功: false, 次数: 已试, 已尽: true, 因: `本到期窗口（${前.态}）已试 ${已试} 次自续（上限 ${探针上限}）——${自续重挂分钟 > 0 ? `距上一发满 ${自续重挂分钟} 分钟后再重挂一发` : '不再重试'}，防循环烧调用` };
  }
  探针记忆.set(root, { 窗, 次数: 已试 + 1, 末次: 现在 });
  let r;
  try { r = await (opts.探针 ? opts.探针({ cfg, 前, 次: 已试 + 1 }) : 默认探针(cfg)); }
  catch (e) { r = { ok: false, 因: '探针抛错：' + String((e && e.message) || e).slice(0, 60) }; }
  const 后 = 寿命(cfg, opts); // 重读一次凭据文件：CLI 续没续，只有这一个字段说了算
  const 增毫秒 = (Number(后.expiresAt) || 0) - (Number(前.expiresAt) || 0);
  const 次数 = 已试 + 1;
  if (增毫秒 > 0) {
    return { 尝试: true, 成功: true, 增毫秒, 增文: 时长文(增毫秒), 次数, 剩余分: 后.剩余分, expiresAt: 后.expiresAt,
      因: `自续成功 ${时长文(增毫秒)}（第 ${次数} 发探针；原剩 ${前.剩余分} 分钟 → 现剩 ${后.剩余分} 分钟，到期 ${new Date(后.expiresAt).toTimeString().slice(0, 5)}）` };
  }
  return { 尝试: true, 成功: false, 次数, 因: (r && r.ok)
    ? `第 ${次数} 发探针跑通了但 expiresAt 没动——CLI 没触发续期`
    : `第 ${次数} 发探针未续上：${(r && r.因) || '未知原因'}` };
}

// +8h / +45m：给流水与急件用的人话时长
function 时长文(ms) {
  const h = ms / 3600000;
  if (h >= 1) return `+${Number(h.toFixed(1)).toString().replace(/\.0$/, '')}h`;
  return `+${Math.max(1, Math.round(ms / 60000))}m`;
}

// ---- 巡检哨兵（要件 1/3 + 二期要件 2）：挂在 15 分钟巡检拍上 ----
// 节流键 = 态：状态一变立刻放行一封（临期→过期是升级，不该被上一封的窗口压住），
// 同状态则 节流分钟 内至多一封。恢复成「有效」即清记忆——下一次临期重新武装。
const 记忆 = new Map(); // root → { 态, 上封 }

// 二期起本函数是 async：临期/过期先走一发自续探针（要件 2），续成就没人需要被吵醒。
// 调用方（server 巡检拍）不 await，只挂 .catch——自续那一发最多 60 秒，不该把同一拍的其余巡检拖住。
async function 哨兵(root, cfg, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const { 节流分钟, 临期分钟, 自续开 } = 参数(cfg);
  let s = 寿命(cfg, opts);
  if (s.态 === '有效') { 记忆.delete(root); 探针记忆.delete(root); return { 态: s.态, 剩余分: s.剩余分, 告警: null, 节流: false, 横幅: null, 自续: null }; }

  // ---- 先自续、续败才叫人（施工令-057 要件 2）----
  // 过期也探——refresh token 的寿命远长于 access token，08-12 那次真正缺的就是这一发。
  // 「有没有 refreshToken / 本窗口还剩几发」全由 自续() 一处裁定（它会不烧调用地回绝），
  // 这里只管把两种态送进去：判据分散在两处，迟早有一处忘了改。
  let 自续果 = null;
  if (自续开 && (s.态 === '临期' || s.态 === '过期')) {
    自续果 = await 自续(root, cfg, { ...opts, 前: s });
    if (自续果.成功) {
      const 后 = 寿命(cfg, opts);
      记忆.delete(root); // 自续成功即复位：下次真临期时不被上一封的窗口压住
      const 文 = `OAuth 自续成功 ${自续果.增文}：${自续果.因}——未惊动制作人`;
      try { require('./journal').append(root, 文); } catch { /* 留痕失败不阻塞 */ }
      try { require('./pm/ledger').event(root, 'OAuth自续', { 结果: '成功', 增文: 自续果.增文, 剩余分: 后.剩余分, 次数: 自续果.次数 }); } catch { /* 记账失败不阻塞 */ }
      const 仍需横幅 = 后.态 === '过期' || 后.态 === '未登录';
      return { 态: 后.态, 剩余分: 后.剩余分, 告警: null, 节流: false, 自续: 自续果,
        横幅: 仍需横幅 ? { 态: 后.态, 文案: 后.因, 配方: 登录配方(cfg), 剩余分: 后.剩余分 } : null };
    }
    s = 寿命(cfg, opts); // 探针可能把凭据搅成别的样（如重登被冲掉）——叫人前以最新读数为准
    if (s.态 === '有效') { 记忆.delete(root); return { 态: s.态, 剩余分: s.剩余分, 告警: null, 节流: false, 横幅: null, 自续: 自续果 }; }
  }

  const 需横幅 = s.态 === '过期' || s.态 === '未登录';
  const m = 记忆.get(root);
  const 节流 = !!(m && m.态 === s.态 && now - m.上封 < 节流分钟 * 60000);
  const 文 = s.态 === '临期'
    ? `OAuth 即将到期，请重登：${s.因}——低于 ${临期分钟} 分钟即告警，到点会集体 401（08-12 案：判官席空烧三振）`
    : s.态 === '过期'
      ? `OAuth 已过期，请重登：${s.因}——claude 池会话随时 401，派发预检将拒派`
      : `OAuth 未登录，请重登：${s.因}——claude 池（含判官三席）无凭据可用`;
  // 自续结果挂在配方**后面**：急件正文截 300 字，一键重登那截绝不能被自续说明挤掉。
  const 全文 = `${文}｜一键重登：${登录配方(cfg)}${自续果 ? `｜${自续果.尝试 ? '自续已试' : '自续未试'}：${自续果.因}` : ''}`;
  const 横幅 = 需横幅 ? { 态: s.态, 文案: 文, 配方: 登录配方(cfg), 剩余分: s.剩余分 } : null;
  if (节流) return { 态: s.态, 剩余分: s.剩余分, 告警: null, 节流: true, 横幅, 自续: 自续果 };

  记忆.set(root, { 态: s.态, 上封: now });
  try { require('./inbox').post(root, '急', 'OAuth续命', 全文.slice(0, 300)); } catch { /* 信箱失败不阻塞留痕 */ }
  try { require('./journal').append(root, 全文); } catch { /* 留痕失败不阻塞告警 */ }
  const 自续账 = !自续果 ? '未试' : 自续果.尝试 ? '试过未成' : 自续果.已尽 ? '本窗额度已尽' : '不可续';
  try { require('./pm/ledger').event(root, 'OAuth告警', { 态: s.态, 剩余分: s.剩余分, 自续: 自续账 }); } catch { /* 记账失败不阻塞 */ }
  return { 态: s.态, 剩余分: s.剩余分, 告警: 全文, 节流: false, 横幅, 自续: 自续果 };
}

// ---- 派发预检（要件 2）：runner 拉起会话前问一句 ----
// 只管**吃 OAuth 订阅登录态**的会话：claude 池且没走托管 key（判官三席 质检/代核/代裁 恒属此类）。
// codex 有自己的 ~/.codex 登录态、deepseek/*-key 池走注入令牌——它们与这份凭据的寿命无关，
// 一律放行（要件 2 明文：codex 池不受影响）。
// 拒派不是失败：调用方据此**不开会话、不计判官失败次数**，下一拍重来。真撞上 401 才是失败，
// 而那一发会被计进 判官重试上限——三次就把这张单钉死等人工，正是 08-12 那 25 分钟的来源。
function 派发预检(root, cfg, o = {}) {
  const 池 = o.池 || 'claude';
  if (池 !== 'claude' || o.用托管) return { 放行: true, 态: '不适用', 剩余分: null, 因: `${池} 池不吃 OAuth 订阅凭据，本条不适用` };
  const { 拒派分钟 } = 参数(cfg);
  const s = 寿命(cfg, o);
  if (s.态 === '未登录') return { 放行: false, 态: s.态, 剩余分: null, 因: `OAuth 未登录（${s.因}）——拉起必 401，拒派` };
  if (s.剩余毫秒 < 拒派分钟 * 60000) {
    return { 放行: false, 态: s.态, 剩余分: s.剩余分,
      因: s.态 === '过期'
        ? `OAuth 已过期 ${Math.abs(s.剩余分)} 分钟——拉起必 401，拒派（重登后自动恢复）`
        : `OAuth 仅剩 ${s.剩余分} 分钟（拒派线 ${拒派分钟} 分钟）——会话跑到一半撞 401 会白烧一轮，拒派` };
  }
  return { 放行: true, 态: s.态, 剩余分: s.剩余分, 因: s.因 };
}

// ---- 拒派留痕节流（施工令-057 要件 1）----
// 案源 2026-08-13 16:43-16:44：拒派挂在派发拍上，一分钟刷了三条一模一样的 journal。
// 拒派本身没错，错在它把「一个持续状态」当成「一串事件」记——三十条同文流水既盖住了真事件，
// 也没多告诉人半个字。改成状态机留痕：**同单同因只在状态变化时落一条**。
//   首拒 → 记一条（人从这一条知道「这张单开始被拦了」）；
//   期间 → 静默计数（因没变就没有新信息）；
//   因变 → 记新的一条（临期不足 → 过期是升级，得看得见）；
//   恢复 → 记一条，附「期间拒派 N 次」（人从这一条知道「拦了多久、拦了多少发」）。
// 记忆是进程内的：重启后计数从头算，最多多记一条首拒——比持久化一个纯显示用的计数划算。
// 键的分隔符取 NUL：路径里能出现空格，单号里不会出现任何控制符，两段拼串撞车的可能性归零。
// 源码里写转义序列、不留裸字节——同 runner.js 洗 ANSI 那处的规矩（裸控制字节会让 git/grep
// 把整个文件当二进制，也容易被改文件的编辑器吃掉）。
const 拒派记忆 = new Map(); // `${root}\u0000${单}` → { 因键, 次数 }
const 拒键 = (root, 单) => `${root}\u0000${单}`;

// 拒派时问一句「这条该不该记」。因键 = 拒派理由的类别（态），换了因就是新状态。
function 拒派留痕(root, 单, 因键) {
  const k = 拒键(root, 单);
  const m = 拒派记忆.get(k);
  if (m && m.因键 === String(因键)) { m.次数 += 1; return { 记: false, 次数: m.次数, 首: false }; }
  拒派记忆.set(k, { 因键: String(因键), 次数: 1 });
  return { 记: true, 次数: 1, 首: true, 换因: !!m };
}

// 放行时问一句「之前拦过吗」。拦过 → 该记恢复条并把期间次数交出去，同时清账。
function 拒派恢复(root, 单) {
  const k = 拒键(root, 单);
  const m = 拒派记忆.get(k);
  if (!m) return { 记: false, 次数: 0 };
  拒派记忆.delete(k);
  return { 记: true, 次数: m.次数, 因键: m.因键 };
}

// ---- 只读横幅（要件 1 后半）：/api/gates 的一位，纯读盘无副作用（不发信、不动节流记忆）----
// 过期/未登录才出条：临期只走急件（要件 1 的分档），门禁位上常年挂黄条会把红条也一起看瞎。
function 横幅(cfg, opts = {}) {
  const s = 寿命(cfg, opts);
  if (s.态 !== '过期' && s.态 !== '未登录') return null;
  return { 态: s.态, 文案: s.因, 配方: 登录配方(cfg), 剩余分: s.剩余分 };
}

// 三本记忆一起复位（告警节流 / 探针窗口 / 拒派计数）——测试与重登后都要求「像刚开机一样」。
function 重置(root) {
  if (root) {
    记忆.delete(root); 探针记忆.delete(root);
    // 分隔符必须与 拒键() 同源（2026-08-22 体检）：原文拼的是空格，而 拒键() 拼的是 NUL，
    // 两边对不上 ⇒ 重置(root) 这条路从来没清掉过一条拒派记忆（只有无参全清那条有效）。
    // 不再手拼第二遍：拿 拒键(root, '') 取前缀，改了 拒键 这里自动跟着走。
    const 前缀 = 拒键(root, '');
    for (const k of 拒派记忆.keys()) if (k.startsWith(前缀)) 拒派记忆.delete(k);
    return;
  }
  记忆.clear(); 探针记忆.clear(); 拒派记忆.clear();
}

module.exports = { 寿命, 哨兵, 自续, 派发预检, 拒派留痕, 拒派恢复, 横幅, 登录配方, 参数, 重置, 凭据路径,
  临期分钟默认, 拒派分钟默认, 节流分钟默认, 探针上限默认, 自续重挂分钟默认, 探针超时秒默认 };
