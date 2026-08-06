// concurrency.js — 并发参数（config.并发 段）的唯一读写点（施工令-010，制作人 2026-08-06 23:59 批准）。
//
// 设定考古（H86）：D17「编制即上限」已随派发制迁移为池并发语义；H85 编制权归项管——本段把
// 「审检并发」同规格下放：项管按待验收/待定夺积压动态调，代码不写死。审检并行被制作人明确
// 否决为默认（23:29 拍板），所以默认仍是 1（＝旧单槽行为逐位等价），要并行得项管显式调。
//
// 段形：config.并发 = { 审检: 1, 零输出分钟: 8, 硬顶: { 审检: 2 } }
//   审检       — 同类判官（两检初检 / 核查 / 仲裁）各自的并发槽数；1 = 单槽（现状）
//   零输出分钟 — 零输出看门狗判据（pm/patrol.零输出），执行会话拉起这么久还零输出即急件
//   硬顶       — 成本保险丝。**仅制作人可改**（文档声明）：项管调配端点拒改此字段，
//                代码只做「不越硬顶」的校验，越顶一律拒绝（端点 400）。
//
// 池并发（codex/claude/deepseek）现有配置维持不动——存在 项管台账.并发上限，代码级保险丝是
// dispatch.HARD_CAP。本模块不搬它的家，只在 view() 里连同硬顶一并呈出，让「并发」有一处看得全的口径；
// apply() 也校验池配额，落盘由调用方写台账（记账口径与审检同一条 journal + 台账「并发调配」）。

const 默认值 = { 审检: 1, 零输出分钟: 8 };
const 硬顶默认 = { 审检: 2 };
const 零输出上限 = 600; // 10 小时：看门狗不是保险丝，给个防手滑的天花板

function 正整数(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && Math.floor(n) === n ? n : null;
}

// 硬顶快照：config.并发.硬顶 覆盖内置默认（制作人专属改动路径＝手改配置）
function 硬顶(cfg) {
  const h = ((cfg && cfg.并发) || {}).硬顶 || {};
  const out = { ...硬顶默认 };
  for (const k of Object.keys(硬顶默认)) { const n = 正整数(h[k]); if (n) out[k] = n; }
  return out;
}

// 生效读数（永远不越硬顶：配置被手改越顶也按硬顶截，代码侧绝不放大成本）
function read(cfg) {
  const c = (cfg && cfg.并发) || {};
  const cap = 硬顶(cfg);
  return {
    审检: Math.min(正整数(c.审检) || 默认值.审检, cap.审检),
    零输出分钟: Math.min(正整数(c.零输出分钟) || 默认值.零输出分钟, 零输出上限),
  };
}
function 审检(cfg) { return read(cfg).审检; }
function 零输出分钟(cfg) { return read(cfg).零输出分钟; }

// 池并发的硬顶与现值（现值住在项管台账，本模块只读参数不碰盘）
function 池硬顶() { return { ...require('./pm/dispatch').HARD_CAP }; }

// ---- 批量调配（/api/pm/concurrency POST 的口径）----
// 改动体 { 审检?, 零输出分钟?, 池?: { codex?, claude?, deepseek? }, }；池现值由调用方传入（台账读数）。
// 先全量校验再整批落：一条不合法则整批不写（与 roster.apply 同款，避免半截生效）。
// 返回 { ok, 并发, 池, 生效:[{项,前,后,摘}] }——并发=写回 config.并发 的新值，池=写回台账的新值。
function apply(cfg, 改动, 池现值) {
  if (!改动 || typeof 改动 !== 'object' || Array.isArray(改动)) {
    return { ok: false, error: '改动必填（{审检?,零输出分钟?,池?:{codex,claude,deepseek}}）' };
  }
  if ('硬顶' in 改动) return { ok: false, error: '硬顶是成本保险丝，仅制作人可改（手改 config.并发.硬顶）——项管无权' };
  const cap = 硬顶(cfg);
  const 前 = read(cfg);
  const 生效 = [];
  const next = { ...前 };

  if (改动.审检 != null) {
    const n = 正整数(改动.审检);
    if (!n) return { ok: false, error: '审检并发须是正整数' };
    if (n > cap.审检) return { ok: false, error: `审检并发 ${n} 越硬顶 ${cap.审检}（成本保险丝仅制作人可改）`, 越顶: true };
    if (n !== 前.审检) { next.审检 = n; 生效.push({ 项: '审检', 前: 前.审检, 后: n, 摘: `审检并发 ${前.审检} → ${n}` }); }
  }
  if (改动.零输出分钟 != null) {
    const n = 正整数(改动.零输出分钟);
    if (!n || n > 零输出上限) return { ok: false, error: `零输出分钟须是 1..${零输出上限} 的正整数` };
    if (n !== 前.零输出分钟) { next.零输出分钟 = n; 生效.push({ 项: '零输出分钟', 前: 前.零输出分钟, 后: n, 摘: `零输出看门狗 ${前.零输出分钟}m → ${n}m` }); }
  }

  const 池上限 = 池硬顶();
  const 池前 = { ...(池现值 || {}) };
  const 池next = { ...池前 };
  if (改动.池 != null) {
    if (typeof 改动.池 !== 'object' || Array.isArray(改动.池)) return { ok: false, error: '池须是对象（{池名:并发数}）' };
    for (const [名, v] of Object.entries(改动.池)) {
      if (!(名 in 池上限)) return { ok: false, error: '未知池：' + 名 };
      const n = 正整数(v);
      if (!n) return { ok: false, error: `${名} 池并发须是正整数` };
      if (n > 池上限[名]) return { ok: false, error: `${名} 池并发 ${n} 越硬顶 ${池上限[名]}（代码级保险丝，项管只能在此以内调）`, 越顶: true };
      if (n !== 池前[名]) { 池next[名] = n; 生效.push({ 项: '池·' + 名, 前: 池前[名] ?? null, 后: n, 摘: `${名} 池并发 ${池前[名] ?? '—'} → ${n}` }); }
    }
  }

  if (!生效.length) return { ok: false, error: '改动为空或与现值一致（可改：审检 / 零输出分钟 / 池.<池名>）' };
  return { ok: true, 并发: next, 池: 池next, 生效 };
}

// 写回 cfg.并发（保留 硬顶 字段原样——它不归本写口管）
function write(cfg, 并发) {
  cfg.并发 = { ...(cfg.并发 || {}), ...并发 };
  return cfg.并发;
}

// 聚合快照（GET 口径）：审检/零输出在 config，池并发在台账——一处看得全
function view(cfg, 池现值) {
  return { 并发: read(cfg), 硬顶: 硬顶(cfg), 池并发: { ...(池现值 || {}) }, 池硬顶: 池硬顶() };
}

module.exports = { read, write, apply, view, 审检, 零输出分钟, 硬顶, 池硬顶, 默认值, 硬顶默认, 零输出上限 };
