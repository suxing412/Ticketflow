// roster.js — 编制（H85 补章「去岗位化」，2026-08-06 制作人裁决）的唯一读写点。
//
// 新模型：config.编制 = [{ 职能, 池序: [{ 池, 档 }] }]，**每职能恰好一行**。
//   「程序-A/程序-B」是常驻岗位时代的遗物：派发制下执行者因单而生、完成即销毁，
//   同一编制想开几个无头 CLI 就开几个（并发由 dispatch 的硬顶与项管并发上限管），
//   所以编制表记的是「这个职能能在哪些池上干活、按什么优先级」，不是人头册。
//   池序 = 路由优先级（dispatch.routePool 顺序取第一个未冻结池）；档 = 该池的模型覆盖（空 = 池默认）。
//
// 旧 config.agents 兼容：read() 读到只有旧字段的 cfg 会**就地推导**（不改 cfg，供内存态旧对象用）；
// migrate() 才是真迁移（写 cfg.编制 + 删 cfg.agents），由 core/config.load 在读盘时调用并落盘。
// 迁移幂等、损坏容错：坏行丢弃不抛，跑第二遍不再产生变化。

const S = (v) => String(v == null ? '' : v).trim();

// 单行归形：{职能, 池序:[{池,档}]}。池按出现序去重，同池取第一个显式档位。
function normalizeRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const 职能 = S(row.职能);
  if (!职能) return null;
  const 池序 = [];
  const src = Array.isArray(row.池序) ? row.池序 : [];
  for (const p of src) {
    // 宽进：既收 {池,档} 也收裸池名字符串（手改配置的常见写法）
    const 池 = S(p && typeof p === 'object' ? p.池 : p);
    if (!池) continue;
    const 档 = S(p && typeof p === 'object' ? p.档 : '');
    const hit = 池序.find((x) => x.池 === 池);
    if (hit) { if (!hit.档 && 档) hit.档 = 档; continue; }
    池序.push({ 池, 档 });
  }
  return { 职能, 池序 };
}

// 整表归形：坏行丢弃；同职能多行合并（去岗位化的核心不变量——每职能一行）
function normalize(list) {
  const out = [];
  for (const row of (Array.isArray(list) ? list : [])) {
    const r = normalizeRow(row);
    if (!r) continue;
    const hit = out.find((x) => x.职能 === r.职能);
    if (!hit) { out.push(r); continue; }
    for (const p of r.池序) {
      const h2 = hit.池序.find((x) => x.池 === p.池);
      if (h2) { if (!h2.档 && p.档) h2.档 = p.档; }
      else hit.池序.push(p);
    }
  }
  return out;
}

// 旧形态 config.agents（岗位册）→ 新形态编制行：
//   按职能分组、池按原序去重合并、各池取该池第一个显式档位；退役待归（上线:false）不进编制
//   ——去岗位化后没有「人」可退役，那面旗只对岗位有意义。
//   无显式执行池的旧 agent 只贡献「该职能存在」，不占池序位（派发照旧回落职能默认池）。
function fromAgents(agents) {
  const out = [];
  for (const a of (Array.isArray(agents) ? agents : [])) {
    if (!a || typeof a !== 'object') continue;
    if (a.上线 === false) continue;
    const 职能 = S(a.职能);
    if (!职能) continue;
    let row = out.find((x) => x.职能 === 职能);
    if (!row) { row = { 职能, 池序: [] }; out.push(row); }
    const 池 = S(a.执行池);
    if (!池) continue;
    const hit = row.池序.find((x) => x.池 === 池);
    const 档 = S(a.模型);
    if (hit) { if (!hit.档 && 档) hit.档 = 档; continue; }
    row.池序.push({ 池, 档 });
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 迁移（幂等）：返回 true 表示 cfg 被改动过、调用方应落盘。
// 三种入参：只有新字段（归形，通常无变化）/ 只有旧字段（推导后删旧）/ 两者都在（以新为准，删旧）。
function migrate(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  const 有新 = Array.isArray(cfg.编制);
  const 有旧 = Array.isArray(cfg.agents);
  if (!有新 && !有旧) return false; // 无编制信息的配置不硬塞空表（免得每次开机都写一次盘）
  const next = 有新 ? normalize(cfg.编制) : fromAgents(cfg.agents);
  const changed = 有旧 || !same(next, cfg.编制);
  cfg.编制 = next;
  if (有旧) delete cfg.agents;
  return changed;
}

// 只读读取（不改 cfg）：新字段优先，旧字段兜底推导。
// 内存态 cfg（测试夹具 / 未过迁移的对象）照样读得出编制，lib 层不必各自兼容。
function read(cfg) {
  if (!cfg || typeof cfg !== 'object') return [];
  if (Array.isArray(cfg.编制)) return normalize(cfg.编制);
  if (Array.isArray(cfg.agents)) return fromAgents(cfg.agents);
  return [];
}

function rowOf(cfg, 职能) {
  const fn = S(职能);
  return read(cfg).find((r) => r.职能 === fn) || null;
}

// 职能编制存在性：派发/质检挑活的判据（原「agents 里有没有这个职能的人头」）
function has(cfg, 职能) {
  return !!rowOf(cfg, 职能);
}

// 池序（只要池名）——dispatch 路由的优先级序列
function poolsOf(cfg, 职能) {
  const r = rowOf(cfg, 职能);
  return r ? r.池序.map((p) => p.池) : [];
}

// 某职能在某池上的模型档（空 = 池默认）
function modelFor(cfg, 职能, 池) {
  const r = rowOf(cfg, 职能);
  if (!r) return '';
  const hit = r.池序.find((p) => p.池 === S(池));
  return hit ? hit.档 : '';
}

// 拉取制（旧路径，可回退）兼容视图：去岗位化后一个职能就是一个执行位，id 即职能名。
// 仍持旧 config.agents 的内存态 cfg 原样返回——旧测试/旧盘不因本次改造改变行为。
function agents(cfg) {
  if (cfg && Array.isArray(cfg.agents) && cfg.agents.length) return cfg.agents;
  return read(cfg).map((r) => ({
    id: r.职能, 职能: r.职能,
    执行池: (r.池序[0] || {}).池 || '',
    模型: (r.池序[0] || {}).档 || '',
  }));
}

// 池序摘要（journal/台账/UI 共用一种写法）：codex(opus)→claude
function 池序摘(池序) {
  const s = (Array.isArray(池序) ? 池序 : []).map((p) => p.池 + (p.档 ? `(${p.档})` : '')).join('→');
  return s || '—（回落职能默认池）';
}

// ---- 只读快照（/api/pm/roster GET 的口径）----
// 每职能一行（cfg.职能 全表打底，编制里多出来的职能补在后面——漏挂的职能也要看得见）。
// 可用性不在这里另算一套：冻结判据由调用方注入（server 传 dispatch.poolFrozen），
// UI 与调度共用同一把尺。读数拿不到时传 null，如实呈「额度读数中」，绝不假绿。
function snapshot(cfg, isFrozen) {
  const rows = read(cfg);
  const 全职能 = [];
  for (const fn of (Array.isArray(cfg && cfg.职能) ? cfg.职能 : [])) { const v = S(fn); if (v && !全职能.includes(v)) 全职能.push(v); }
  for (const r of rows) if (!全职能.includes(r.职能)) 全职能.push(r.职能);
  const poolFor = require('./pool').poolFor;
  return 全职能.map((职能) => {
    const row = rows.find((r) => r.职能 === 职能);
    const 默认池 = poolFor(cfg, 职能);
    // 池序空 = 没显式挂池：派发会回落职能默认池，快照如实把那个池摆出来并标 默认
    const eff = (row && row.池序.length) ? row.池序.map((p) => ({ 池: p.池, 档: p.档, 默认: false }))
      : (默认池 ? [{ 池: 默认池, 档: '', 默认: true }] : []);
    const 池序 = eff.map((p) => ({ ...p, 冻结: isFrozen ? isFrozen(p.池) : null }));
    const 首个可用 = (池序.find((p) => p.冻结 === false) || {}).池 || null;
    let 可用; let 态;
    if (!池序.length) { 可用 = false; 态 = '未挂池·止派'; }
    else if (首个可用) { 可用 = true; 态 = row ? '在岗' : '在岗·职能默认池'; }
    else if (池序.some((p) => p.冻结 == null)) { 可用 = null; 态 = '额度读数中'; }
    else { 可用 = false; 态 = '池序全冻·止派'; }
    return { 职能, 编制: !!row, 池序, 首个可用, 可用, 态, 摘: 池序摘(eff) };
  });
}

// ---- 批量改编制（/api/pm/roster POST 的口径）----
// 改动体 [{ 职能, 池序?: [{池,档}] }]：先全量校验再整批落，一条不合法则整批不写（避免半截生效）。
// 池序 缺省 = 该行不动；池序 [] = 显式清空（回落职能默认池）。返回 生效 供记账。
function apply(cfg, list) {
  const items = Array.isArray(list) ? list : [];
  if (!items.length) return { ok: false, error: '改动必填（[{职能,池序:[{池,档}]}]）' };
  const 职能表 = Array.isArray(cfg && cfg.职能) ? cfg.职能.map(S) : [];
  const 池表 = Object.keys((cfg && cfg.执行池) || {});
  const 待改 = [];
  for (const c of items) {
    const 职能 = S(c && c.职能);
    if (!职能) return { ok: false, error: '职能必填（编制表每职能一行，已无 agent id）' };
    if (职能表.length && !职能表.includes(职能)) return { ok: false, error: '未知职能：' + 职能 };
    if (待改.some((x) => x.职能 === 职能)) return { ok: false, error: '同一职能在一批里出现两次：' + 职能 };
    if (c.池序 == null) { 待改.push({ 职能, 池序: null }); continue; } // 不动这一行
    if (!Array.isArray(c.池序)) return { ok: false, error: `${职能}：池序须是数组` };
    const 池序 = [];
    for (const p of c.池序) {
      const 池 = S(p && typeof p === 'object' ? p.池 : p);
      if (!池) return { ok: false, error: `${职能}：池名不可为空` };
      if (!池表.includes(池)) return { ok: false, error: '未知池：' + 池 };
      if (池序.some((x) => x.池 === 池)) return { ok: false, error: `${职能}：池序里重复挂了 ${池}` };
      池序.push({ 池, 档: S(p && typeof p === 'object' ? p.档 : '') });
    }
    待改.push({ 职能, 池序 });
  }
  const rows = read(cfg);
  const 生效 = [];
  for (const c of 待改) {
    if (!c.池序) continue;
    const row = rows.find((r) => r.职能 === c.职能);
    const 前 = row ? row.池序 : [];
    if (same(前, c.池序)) continue;
    生效.push({ 职能: c.职能, 前, 后: c.池序, 摘: `${c.职能} 池序 ${池序摘(前)} → ${池序摘(c.池序)}` });
    if (row) row.池序 = c.池序; else rows.push({ 职能: c.职能, 池序: c.池序 });
  }
  cfg.编制 = normalize(rows);
  delete cfg.agents; // 旧岗位册若还挂着，随本次写口一并退场（不留双源）
  return { ok: true, 生效 };
}

module.exports = { normalize, normalizeRow, fromAgents, migrate, read, rowOf, has, poolsOf, modelFor, agents, snapshot, apply, 池序摘 };
