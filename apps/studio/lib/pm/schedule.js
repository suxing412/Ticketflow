// pm/schedule.js — 排程台账（施工令-040 · Q1 后端半）
// 案源：2026-08-11 点名巡礼「监制台看不到后续的队列工作」——「接下来要做什么」此前只活在会话记忆里，
// 换会话即失忆，制作人在监制台上看到的永远只有**已经成单**的那几张，队列是空的。
// 本模块把「尚未成单的批次计划项」立成系统实体：**计划粒**。
//
// 三条硬口径（红队 v2 十一杀之后的结论，改一处就是改协议）：
//   ① 只追加：事件日志 jsonl，一次写盘 = 一条事件；读取时折叠成现态。**禁覆盖写**——
//      台账类的覆盖写吃过亏（pm/ledger 主档损毁案），排程账从设计上就不给覆盖留入口。
//   ② CAS：每粒一个版本号，写 API 必须带 预期版本，不符即拒并把现态回给调用方重试。
//      单进程内 appendFileSync 本身串行，但「读-改-写」跨请求不串行——不校验版本，
//      两个调用方先后读到同一现态、各自转移，后手会静默覆盖先手的意图。
//   ③ 状态机严进：计划→起草中→已成单→完成；前置态可撤销；**已成单不可直接撤销**
//      （单已经发出去了，撤粒不撤单＝台账与工单池对不上账，须先收回工单）。非法转移一律拒绝**并留痕**。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = (root) => path.join(root, '排程台账');
const LOG = (root) => path.join(DIR(root), '排程账.jsonl');

// 状态机（唯一实现，API/钩子/迁移三处共读——不许任何一处自己再判一遍）
const 转移表 = {
  计划: ['起草中', '撤销'],
  起草中: ['已成单', '撤销'],
  已成单: ['完成'],     // 撤销不在此列：要撤先收回工单（见 转移() 的专项拒因）
  完成: [],
  撤销: [],
};
const 状态全集 = Object.keys(转移表);
const 终态 = ['完成', '撤销'];
const 依赖规则集 = ['全部完成', '任一完成'];
const 操作域 = { 登记: ['总监', '项管'], 调整: ['项管', '总监'], 转移: ['总监', '项管', '制作人'] };

const nowIso = () => new Date().toISOString();
function journal(root, msg) { try { require('../journal').append(root, msg); } catch { /* 无 journal 环境（测试）忽略 */ } }

// ---- 事件层（只追加）----
// 事件形状：{ 粒ID, 事件类型, 字段变更, 版本号, 时刻, 操作者 }（+ 拒绝事件附 因）
function 事件流(root) {
  try {
    return fs.readFileSync(LOG(root), 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function 写事件(root, e) {
  fs.mkdirSync(DIR(root), { recursive: true });
  fs.appendFileSync(LOG(root), JSON.stringify(e) + '\n', 'utf8');
  return e;
}

// 折叠：事件流 → 现态表。拒绝事件是**审计痕**，既不改字段也不进版本——
// 折叠时整条跳过，否则一次误操作就会把版本号顶高，让所有正在重试的调用方全部 CAS 失败。
function 折叠(events) {
  const m = new Map();
  for (const e of events) {
    if (!e || !e.粒ID || e.事件类型 === '拒绝') continue;
    const cur = m.get(e.粒ID) || { 粒ID: e.粒ID, 版本号: 0, 登记时刻: e.时刻 || null };
    Object.assign(cur, e.字段变更 || {});
    cur.粒ID = e.粒ID; // 粒ID 不可变：字段变更里就算混进 粒ID 也覆盖不掉
    cur.版本号 = Number.isInteger(e.版本号) ? e.版本号 : cur.版本号 + 1;
    cur.更新时刻 = e.时刻 || cur.更新时刻 || null;
    cur.末次操作者 = e.操作者 || cur.末次操作者 || null;
    m.set(e.粒ID, cur);
  }
  return m;
}

// 排序口径唯一：批 → 序 → 题。API 下发即按此序，消费端（Q2 流程页/总览）不必各排各的。
const 比序 = (a, b) => String(a.批 || '').localeCompare(String(b.批 || ''), 'zh')
  || (Number(a.序) || 0) - (Number(b.序) || 0)
  || String(a.题 || '').localeCompare(String(b.题 || ''), 'zh');

function 现态(root) { return [...折叠(事件流(root)).values()].sort(比序); }
function 取(root, 粒ID) { return 折叠(事件流(root)).get(String(粒ID)) || null; }

// 判重键（迁移幂等口径，施工令第 7 条）：来源 + 题。
// 不用 批+序：批次表改序是常态（调整 API 就是干这个的），拿会变的字段当身份必然重复迁移。
const 判重键 = (x) => `${String(x.来源 || '').trim()}||${String(x.题 || '').trim()}`;

// ---- 校验（登记入口的唯一把关处，整批一条不合法则整批不写，同 roster.apply 口径）----
function 规范依赖(d) {
  if (d == null || d === '') return { 值: [] };
  if (!Array.isArray(d)) return { error: '依赖必须是数组' };
  const out = [];
  for (const it of d) {
    if (!it || typeof it !== 'object') return { error: '依赖项必须是 {ref,规则} 对象' };
    const ref = String(it.ref || '').trim();
    if (!ref) return { error: '依赖项缺 ref（粒ID 或单号）' };
    const 规则 = String(it.规则 || '全部完成').trim();
    if (!依赖规则集.includes(规则)) return { error: `依赖规则只能是 ${依赖规则集.join('/')}（收到 ${规则}）` };
    out.push({ ref: ref.slice(0, 80), 规则 });
  }
  return { 值: out };
}
function 规范粒(raw) {
  const x = raw || {};
  const 批 = String(x.批 ?? '').trim();
  const 题 = String(x.题 ?? '').trim();
  const 来源 = String(x.来源 ?? '').trim();
  if (!批) return { error: '批必填' };
  if (!题) return { error: '题必填' };
  if (!来源) return { error: '来源必填（文档§引用——判重与追溯都靠它）' };
  const 序 = x.序 == null || x.序 === '' ? 0 : Number(x.序);
  if (!Number.isInteger(序) || 序 < 0) return { error: `序须为非负整数（收到 ${x.序}）` };
  const 状态 = String(x.状态 ?? '计划').trim();
  if (!状态全集.includes(状态)) return { error: `未知状态：${状态}（可选 ${状态全集.join('/')}）` };
  const dep = 规范依赖(x.依赖);
  if (dep.error) return { error: dep.error };
  const 单号 = String(x.单号 ?? '').trim();
  // 已成单/完成 必须带单号：没有单号的「已成单」是对不上账的账——迁移终态回填走的正是这条路
  if (['已成单', '完成'].includes(状态) && !单号) return { error: `状态 ${状态} 必须回填单号` };
  let 预估单元 = null;
  if (x.预估单元 != null && x.预估单元 !== '') {
    预估单元 = Number(x.预估单元);
    if (!(预估单元 >= 0) || !Number.isFinite(预估单元)) return { error: `预估单元须为非负数（收到 ${x.预估单元}）` };
  }
  return {
    值: {
      批: 批.slice(0, 40), 序, 题: 题.slice(0, 120), 状态,
      管线: String(x.管线 ?? '').trim().slice(0, 40) || null,
      依赖: dep.值,
      池衡建议: String(x.池衡建议 ?? '').trim().slice(0, 60) || null,
      预估单元,
      来源: 来源.slice(0, 200),
      单号: 单号 ? 单号.slice(0, 40) : null,
    },
  };
}

// 拒绝留痕（状态机第 3 条「非法转移一律拒绝并留痕」）：审计事件进账 + journal 一行。
// 留在账里而不是只留 journal——排程账才是这个实体的事实源，翻它就该看得见谁在什么时候想干什么被拦了。
function 拒(root, g, 因, 操作者) {
  const 文 = String(因).slice(0, 200);
  try {
    写事件(root, { 粒ID: g.粒ID, 事件类型: '拒绝', 字段变更: {}, 版本号: g.版本号, 时刻: nowIso(), 操作者: String(操作者 || '').slice(0, 40), 因: 文 });
  } catch (e) { console.error('排程账拒绝留痕失败：' + e.message); }
  journal(root, `排程台账拒绝 ${g.粒ID}「${g.题 || ''}」：${文}`);
  return { ok: false, error: 文, 现态: g };
}

// CAS 校验（第 4 条）：写 API 的公共前置。冲突不进账（重试是正常流量，不该刷审计），
// 但必须把**现态**回给调用方——「拒了」不告诉对方现在是什么样，等于逼它盲猜重试。
function 校验版本(g, 预期版本) {
  if (预期版本 == null || 预期版本 === '') return { error: '预期版本必填（CAS：写前先读现态，把版本号带回来）' };
  const v = Number(预期版本);
  if (!Number.isInteger(v)) return { error: `预期版本须为整数（收到 ${预期版本}）` };
  if (v !== g.版本号) return { error: `版本冲突：预期 ${v}，现 ${g.版本号}——请按现态重试`, 冲突: true };
  return {};
}

// ---- 写 API ----

// 登记（整批）：新粒入账。幂等按 来源+题 判重，重复项跳过并如实回报（迁移重跑靠它）。
function 登记(root, 粒们, 操作者, opts = {}) {
  if (!Array.isArray(粒们) || !粒们.length) return { ok: false, error: '登记需要非空的计划粒数组' };
  const 人 = String(操作者 || '').trim();
  if (opts.校验操作域 !== false && !操作域.登记.includes(人)) {
    return { ok: false, 越权: true, error: `登记权在 ${操作域.登记.join('/')}（收到「${人 || '空'}」）` };
  }
  const 已有 = new Map(现态(root).map((g) => [判重键(g), g]));
  const 待写 = []; const 跳过 = []; const 错 = [];
  粒们.forEach((raw, i) => {
    const v = 规范粒(raw);
    if (v.error) { 错.push(`第 ${i + 1} 条「${String((raw || {}).题 || '').slice(0, 20)}」：${v.error}`); return; }
    const k = 判重键(v.值);
    const 命中 = 已有.get(k);
    if (命中) { 跳过.push({ 题: v.值.题, 来源: v.值.来源, 已有粒ID: 命中.粒ID }); return; }
    已有.set(k, { ...v.值, 粒ID: '(本批)' }); // 同一批里的重复项也算重，否则一次登记就能造出两条同粒
    待写.push(v.值);
  });
  if (错.length) return { ok: false, error: '整批未写入：' + 错.join('；') }; // 整批校验：一条不合法则一条都不落
  const 时刻 = nowIso();
  const 新增 = 待写.map((g) => {
    const 粒ID = crypto.randomUUID();
    写事件(root, { 粒ID, 事件类型: '登记', 字段变更: { ...g }, 版本号: 1, 时刻, 操作者: 人 });
    return { ...g, 粒ID, 版本号: 1, 登记时刻: 时刻, 更新时刻: 时刻, 末次操作者: 人 };
  });
  if (新增.length || 跳过.length) {
    journal(root, `排程台账登记（${人}）：新增 ${新增.length} 粒${跳过.length ? ` · 判重跳过 ${跳过.length} 粒（来源+题）` : ''}`);
  }
  return { ok: true, 新增, 跳过 };
}

// 转移：状态机唯一写口。带 CAS；非法转移拒绝并留痕。
function 转移(root, { 粒ID, 目标, 预期版本, 操作者, 单号, 说明 } = {}) {
  const g = 取(root, 粒ID);
  if (!g) return { ok: false, error: `计划粒不存在：${粒ID}` };
  const 人 = String(操作者 || '').slice(0, 40);
  const to = String(目标 || '').trim();
  if (!状态全集.includes(to)) return 拒(root, g, `未知目标状态：${to || '空'}（可选 ${状态全集.join('/')}）`, 人);
  const cas = 校验版本(g, 预期版本);
  if (cas.error) return { ok: false, error: cas.error, ...(cas.冲突 ? { 冲突: true } : {}), 现态: g };
  // 已成单→撤销 单列一条拒因：这不是"忘了配转移表"，是**业务上必须先收回工单**。
  // 只回一句「不合法的转移」，调用方会去改状态机；回这句，他会去收单。
  if (g.状态 === '已成单' && to === '撤销') {
    return 拒(root, g, `已成单不可直接撤销——先收回对应工单 ${g.单号 || '(未回填)'}，再撤粒`, 人);
  }
  if (g.状态 === to) return 拒(root, g, `已经是 ${to}，无需转移`, 人);
  if (!转移表[g.状态].includes(to)) {
    return 拒(root, g, `不合法的转移：${g.状态} → ${to}（${g.状态} 只能去 ${转移表[g.状态].join('/') || '无（终态）'}）`, 人);
  }
  const 新单号 = String(单号 || '').trim() || g.单号 || null;
  if (to === '已成单' && !新单号) return 拒(root, g, '转「已成单」必须回填单号', 人);
  const 变更 = { 状态: to };
  if (新单号 !== g.单号) 变更.单号 = 新单号;
  if (String(说明 || '').trim()) 变更.末次说明 = String(说明).trim().slice(0, 200);
  const e = 写事件(root, { 粒ID: g.粒ID, 事件类型: '转移', 字段变更: 变更, 版本号: g.版本号 + 1, 时刻: nowIso(), 操作者: 人 });
  journal(root, `排程粒转移 ${g.粒ID}「${g.题}」：${g.状态} → ${to}${变更.单号 ? ` · 单号 ${变更.单号}` : ''}（${人 || '未署名'}）`);
  return { ok: true, 粒: { ...g, ...变更, 版本号: e.版本号, 更新时刻: e.时刻, 末次操作者: 人 } };
}

// 调整（H99 项管域）：改序 / 改依赖 / 改池衡建议。带 CAS。
// 只开这三个字段：题/来源是身份（判重键），批/状态各有专路，单号只由钩子回填——
// 开成通用 patch 口，台账立刻退化成一张可以随便改的表，事件日志就白留了。
function 调整(root, { 粒ID, 预期版本, 序, 依赖, 池衡建议, 操作者, 说明 } = {}, opts = {}) {
  const g = 取(root, 粒ID);
  if (!g) return { ok: false, error: `计划粒不存在：${粒ID}` };
  const 人 = String(操作者 || '').trim();
  if (opts.校验操作域 !== false && !操作域.调整.includes(人)) {
    return { ok: false, 越权: true, error: `调整权在 ${操作域.调整.join('/')}（H99 项管域，收到「${人 || '空'}」）` };
  }
  const cas = 校验版本(g, 预期版本);
  if (cas.error) return { ok: false, error: cas.error, ...(cas.冲突 ? { 冲突: true } : {}), 现态: g };
  if (终态.includes(g.状态)) return 拒(root, g, `终态粒不可调整（当前 ${g.状态}）`, 人);
  const 变更 = {};
  if (序 != null && 序 !== '') {
    const n = Number(序);
    if (!Number.isInteger(n) || n < 0) return 拒(root, g, `序须为非负整数（收到 ${序}）`, 人);
    变更.序 = n;
  }
  if (依赖 !== undefined) {
    const d = 规范依赖(依赖);
    if (d.error) return 拒(root, g, d.error, 人);
    if (d.值.some((x) => x.ref === g.粒ID)) return 拒(root, g, '依赖不能指向自己', 人);
    变更.依赖 = d.值;
  }
  if (池衡建议 !== undefined) 变更.池衡建议 = String(池衡建议 || '').trim().slice(0, 60) || null;
  if (!Object.keys(变更).length) return { ok: false, error: '调整未给任何可改字段（序/依赖/池衡建议）', 现态: g };
  if (String(说明 || '').trim()) 变更.末次说明 = String(说明).trim().slice(0, 200);
  const e = 写事件(root, { 粒ID: g.粒ID, 事件类型: '调整', 字段变更: 变更, 版本号: g.版本号 + 1, 时刻: nowIso(), 操作者: 人 });
  journal(root, `排程粒调整 ${g.粒ID}「${g.题}」：${Object.keys(变更).filter((k) => k !== '末次说明').join('、')}（${人}）`);
  return { ok: true, 粒: { ...g, ...变更, 版本号: e.版本号, 更新时刻: e.时刻, 末次操作者: 人 } };
}

// ---- H57 挂接钩子（第 6 条）----
// 两个钩子都是**系统动作**：CAS 的预期版本由钩子自己读现态取——没有第二个调用方跟它抢同一粒，
// 抢的话也该由人那边的 API 拒绝。钩子失败一律只回结果不抛：起草/派发是主干，台账是账，
// 账记不上不能把主干带崩（调用点一律 try 包一层，与 pmLedger.event 同待遇）。

// 起草落草稿：计划 → 起草中 + 回填单号
function 挂钩起草(root, 粒ID, 单号) {
  const g = 取(root, 粒ID);
  if (!g) return { ok: false, error: `计划粒不存在：${粒ID}`, 无关: true };
  return 转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: g.版本号, 操作者: '系统·H57起草', 单号, 说明: `项管起草落草稿 ${单号 || ''}` });
}

// 派发：起草中 → 已成单。粒ID 优先，缺则按单号回查（老单 frontmatter 没有 粒ID，认不出就当无关，不猜）。
function 挂钩派发(root, 单号, 粒ID) {
  let g = 粒ID ? 取(root, 粒ID) : null;
  if (!g && 单号) g = 现态(root).find((x) => x.单号 === 单号 && !终态.includes(x.状态)) || null;
  if (!g) return { ok: false, error: '无对应计划粒（该单不出自排程台账）', 无关: true };
  // 重复派发（收回→重投）不该报错：粒已经是已成单了，这次派发对台账就是个空操作。
  if (g.状态 === '已成单') return { ok: true, 幂等: true, 粒: g };
  // 补链：粒还停在「计划」（工单是手工起草的，没走 /api/pm/draft），先补一步起草中再成单。
  // 宁可补链也不放宽状态机——状态机一旦允许 计划→已成单，「起草中」这一态就名存实亡。
  if (g.状态 === '计划') {
    const r0 = 转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: g.版本号, 操作者: '系统·派发补链', 单号, 说明: '派发时发现粒仍在计划态，补起草中一步' });
    if (!r0.ok) return r0;
    g = 取(root, g.粒ID);
  }
  return 转移(root, { 粒ID: g.粒ID, 目标: '已成单', 预期版本: g.版本号, 操作者: '系统·派发', 单号: 单号 || g.单号, 说明: `派发 ${单号 || ''}` });
}

module.exports = {
  DIR, LOG, 转移表, 状态全集, 终态, 依赖规则集, 操作域,
  事件流, 折叠, 现态, 取, 判重键, 规范粒, 规范依赖,
  登记, 转移, 调整, 挂钩起草, 挂钩派发,
};
