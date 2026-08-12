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
// **不碰刷新**：这里一个字节都不写凭据文件。自动续期归 quota.refreshClaudeToken（那是查用量
// 的副产品）与 CLI 自己；哨兵只负责「看见并喊」。看的人和修的人分开，是这一模块能保持
// 零副作用、可随便在巡检里调用的前提。
const fs = require('fs');
const os = require('os');
const path = require('path');

const 临期分钟默认 = 30; // 要件 1：剩余低于此 → 急件催重登
const 拒派分钟默认 = 5;  // 要件 2：剩余低于此 → claude 订阅会话拒派
const 节流分钟默认 = 30; // 要件 3：同状态每 30 分钟至多一封急件

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

// ---- 巡检哨兵（要件 1/3）：挂在 15 分钟巡检拍上 ----
// 节流键 = 态：状态一变立刻放行一封（临期→过期是升级，不该被上一封的窗口压住），
// 同状态则 节流分钟 内至多一封。恢复成「有效」即清记忆——下一次临期重新武装。
const 记忆 = new Map(); // root → { 态, 上封 }

function 哨兵(root, cfg, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const { 节流分钟, 临期分钟 } = 参数(cfg);
  const s = 寿命(cfg, opts);
  const 需横幅 = s.态 === '过期' || s.态 === '未登录';
  if (s.态 === '有效') { 记忆.delete(root); return { 态: s.态, 剩余分: s.剩余分, 告警: null, 节流: false, 横幅: null }; }

  const m = 记忆.get(root);
  const 节流 = !!(m && m.态 === s.态 && now - m.上封 < 节流分钟 * 60000);
  const 文 = s.态 === '临期'
    ? `OAuth 即将到期，请重登：${s.因}——低于 ${临期分钟} 分钟即告警，到点会集体 401（08-12 案：判官席空烧三振）`
    : s.态 === '过期'
      ? `OAuth 已过期，请重登：${s.因}——claude 池会话随时 401，派发预检将拒派`
      : `OAuth 未登录，请重登：${s.因}——claude 池（含判官三席）无凭据可用`;
  const 全文 = `${文}｜一键重登：${登录配方(cfg)}`;
  const 横幅 = 需横幅 ? { 态: s.态, 文案: 文, 配方: 登录配方(cfg), 剩余分: s.剩余分 } : null;
  if (节流) return { 态: s.态, 剩余分: s.剩余分, 告警: null, 节流: true, 横幅 };

  记忆.set(root, { 态: s.态, 上封: now });
  try { require('./inbox').post(root, '急', 'OAuth续命', 全文.slice(0, 300)); } catch { /* 信箱失败不阻塞留痕 */ }
  try { require('./journal').append(root, 全文); } catch { /* 留痕失败不阻塞告警 */ }
  try { require('./pm/ledger').event(root, 'OAuth告警', { 态: s.态, 剩余分: s.剩余分 }); } catch { /* 记账失败不阻塞 */ }
  return { 态: s.态, 剩余分: s.剩余分, 告警: 全文, 节流: false, 横幅 };
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

// ---- 只读横幅（要件 1 后半）：/api/gates 的一位，纯读盘无副作用（不发信、不动节流记忆）----
// 过期/未登录才出条：临期只走急件（要件 1 的分档），门禁位上常年挂黄条会把红条也一起看瞎。
function 横幅(cfg, opts = {}) {
  const s = 寿命(cfg, opts);
  if (s.态 !== '过期' && s.态 !== '未登录') return null;
  return { 态: s.态, 文案: s.因, 配方: 登录配方(cfg), 剩余分: s.剩余分 };
}

function 重置(root) { if (root) 记忆.delete(root); else 记忆.clear(); }

module.exports = { 寿命, 哨兵, 派发预检, 横幅, 登录配方, 参数, 重置, 凭据路径, 临期分钟默认, 拒派分钟默认, 节流分钟默认 };
