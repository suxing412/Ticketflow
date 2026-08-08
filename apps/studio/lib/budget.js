// budget.js — 预算闸（施工令-021）：额度锁的按量计费孪生。
//
// 为什么必须有它：现有成本刹车（执行池.*.阈值 / 周阈值、额度.沟通保留）比的都是
// 订阅端点读回的 5h/周 用量百分比。API key 按量计费、**没有这个窗口**，
// gates.poolLock 对 key 池永远算不出 fivePct 于是恒不锁——
// 「套餐用完降级到 key」一旦触发，跑多少烧多少，唯一止损手段是人盯着。
//
// 接入方式刻意选了**不改 poolFrozen 签名**：本模块产出的冻结结果由调用方并进 gatesInfo，
// 于是池序降级（dispatch.routePool）、编制快照可用性、UI 三处自动跟着走，零额外接线。
// 超预算与额度锁同级——都是「这个池现在一张都不许派」。
//
// 定位：**保险丝，不是财务系统**。厂商账单口径各异，本模块只求偏保守的估算，
// 宁可早刹一点。精确对账不在范围内（施工令-021「不要做」第三条）。

const fs = require('fs');
const path = require('path');

const 账本 = (root) => path.join(root, '预算账.jsonl');

// ---- usage 提取（与 pm/brain.js 的 extractUsage 同源同教训）----
// 输入/缓存/输出分列：缓存读计费约为常价 1/10，混进合计会虚胖离群
// （brain 侧「起草 57.9 万 token」案）。input/cache 取最大值（累计量），output 累加（增量）。
function usageOf(raw) {
  let 输入 = 0, 缓存 = 0, 输出 = 0;
  for (const line of String(raw || '').split('\n')) {
    const s = line.replace('\r', '').trim();
    if (!s.startsWith('{')) continue;
    try {
      const e = JSON.parse(s);
      const u = e.usage || (e.message && e.message.usage);
      if (!u) continue;
      if (u.input_tokens) 输入 = Math.max(输入, u.input_tokens);
      if (u.cache_read_input_tokens) 缓存 = Math.max(缓存, u.cache_read_input_tokens);
      if (u.output_tokens) 输出 += u.output_tokens;
    } catch { /* 非 JSON 行忽略 */ }
  }
  return { 输入, 缓存, 输出 };
}

// ---- 记账（只追加；写失败不抛——记账失败绝不能挡住交单）----
function 记(root, 条) {
  const rec = {
    t: 条.t || new Date().toISOString(),
    池: String(条.池 || ''), 单: 条.单 || null,
    输入: Number(条.输入) || 0, 缓存: Number(条.缓存) || 0, 输出: Number(条.输出) || 0,
  };
  if (!rec.池) return null;
  try {
    fs.mkdirSync(path.dirname(账本(root)), { recursive: true });
    fs.appendFileSync(账本(root), JSON.stringify(rec) + '\n', 'utf8');
  } catch { return null; }
  return rec;
}

function 读账(root) {
  let raw = '';
  try { raw = fs.readFileSync(账本(root), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { const j = JSON.parse(s); if (j && j.池) out.push(j); } catch { /* 坏行丢弃不抛 */ }
  }
  return out;
}

const 日键 = (iso) => String(iso || '').slice(0, 10);   // YYYY-MM-DD
const 月键 = (iso) => String(iso || '').slice(0, 7);    // YYYY-MM

// 价目表：config.预算.价目[池] = { 输入, 输出, 缓存? }，单位=每百万 token 的金额。
// 没配价目就只有 token 口径（金额上限那一路自然不生效）。
function 估费(cfg, 池, u) {
  const 价 = (((cfg || {}).预算 || {}).价目 || {})[池];
  if (!价) return null;
  const M = 1000000;
  const 缓存价 = Number(价.缓存) >= 0 ? Number(价.缓存) : (Number(价.输入) || 0) / 10; // 缓存读约常价 1/10
  return ((u.输入 || 0) * (Number(价.输入) || 0)
    + (u.输出 || 0) * (Number(价.输出) || 0)
    + (u.缓存 || 0) * 缓存价) / M;
}

// 汇总某池的当日 / 当月用量（now 可注入，便于测试）
function 汇总(root, 池, now) {
  const 此刻 = (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
  const d = 日键(此刻), m = 月键(此刻);
  const 空 = () => ({ 输入: 0, 缓存: 0, 输出: 0, token: 0, 条数: 0 });
  const 日 = 空(), 月 = 空();
  for (const r of 读账(root)) {
    if (r.池 !== 池) continue;
    const 加 = (o) => {
      o.输入 += r.输入 || 0; o.缓存 += r.缓存 || 0; o.输出 += r.输出 || 0;
      o.token += (r.输入 || 0) + (r.输出 || 0); // 合计不含缓存（虚胖防线）
      o.条数 += 1;
    };
    if (月键(r.t) === m) { 加(月); if (日键(r.t) === d) 加(日); }
  }
  return { 日, 月 };
}

// ---- 判据：某池是否超预算 ----
// config.预算.池[池] = { 日token, 月token, 日额, 月额 }
// 未配 = 不管（绝不臆造上限）；token 与金额两种表达可并存，**任一触线即超**。
function 超预算(cfg, root, 池, now) {
  const 限 = (((cfg || {}).预算 || {}).池 || {})[池];
  if (!限) return { 超: false };
  const s = 汇总(root, 池, now);
  const 查 = (窗名, 用, 限token, 限额) => {
    if (限token > 0 && 用.token >= 限token) {
      return `${窗名}用量 ${用.token} token ≥ 上限 ${限token}`;
    }
    if (限额 > 0) {
      const 费 = 估费(cfg, 池, 用);
      if (费 != null && 费 >= 限额) return `${窗名}估算费用 ${费.toFixed(2)} ≥ 上限 ${限额}`;
    }
    return null;
  };
  const 因 = 查('日', s.日, Number(限.日token) || 0, Number(限.日额) || 0)
    || 查('月', s.月, Number(限.月token) || 0, Number(限.月额) || 0);
  return 因 ? { 超: true, 因: `${池} 池预算已用尽：${因}`, 汇总: s } : { 超: false, 汇总: s };
}

// ---- 并入 gatesInfo 的冻结表 ----
// 结构与 gates.poolLock 的输出对齐（{locked, reason}），于是 dispatch.poolFrozen
// 不改一个字就认它。只列**确实超了**的池——没配预算的池不出现在这里。
function 冻结池(cfg, root, now) {
  const out = {};
  const 池表 = ((cfg || {}).预算 || {}).池 || {};
  for (const 池 of Object.keys(池表)) {
    const r = 超预算(cfg, root, 池, now);
    if (r.超) out[池] = { locked: true, reason: r.因, 预算: true };
  }
  return out;
}

// 把预算冻结并进已有的 gatesInfo（额度锁的结果），同池以「任一锁上即锁」合并
function 并入(gatesInfo, 冻结) {
  const g = { ...(gatesInfo || {}) };
  for (const [池, v] of Object.entries(冻结 || {})) {
    g[池] = { ...(g[池] || {}), ...v, locked: true };
  }
  return g;
}

// 只读快照（API / UI 用）
function view(cfg, root, now) {
  const 池表 = ((cfg || {}).预算 || {}).池 || {};
  return Object.keys(池表).map((池) => {
    const r = 超预算(cfg, root, 池, now);
    return { 池, 上限: 池表[池], 汇总: r.汇总 || 汇总(root, 池, now), 超: !!r.超, 因: r.因 || null };
  });
}

module.exports = { 账本, usageOf, 记, 读账, 汇总, 估费, 超预算, 冻结池, 并入, view, 日键, 月键 };
