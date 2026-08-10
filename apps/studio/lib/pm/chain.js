// pm/chain.js — 关键汇报事件链（施工令-037，制作人 2026-08-09 18:34 批准设计稿）
//
// 案源：关键汇报此前是「平铺事件行」——每条都是断头账。制作人 18:31 点名：
// 「每一项都应该有回应：什么时候被委托起草/切单/送审/审过/派发、为什么派发、后续等待什么、状态怎么样」。
//
// 本模块把 **台账事件流水**（项管台账/事件.jsonl，只追加）与 **工单 frontmatter 结构位**
// （审批时间/领单时间/交付时间/初检/核查/代裁/待引擎实证/返修轮…）按单号归组，拼成一单一链。
//
// 三条硬纪律（施工令「不要做」原文）：
//   ① **纯读**：本模块只 read，绝不 write/move/update——不动台账写入面，不动调度语义，零新事件源。
//   ② **关键站白名单**：只收 起草/切单/定稿/派发/交产出/审检结论/返修/定夺/上呈/终态 这几类，
//      巡检心跳、宽限、零派发、编制/并发调整一律不进链——全量流水另有「详细流水」区。
//   ③ **缺站不补造**：有多少事件显多少。历史事件不回填、不迁移、不猜测——
//      老单缺 派发 事件就少那一行，绝不拿 更新时间 顶上来假装它派发过。
//
// 「现在等什么」复用 lifecycle 的状态语义（含施工令-032② / H97 的 待引擎实证 停闸态），
// 判定表见 现在等什么()——七态逐态由 test/chain.test.js 锁死，改一个字都要过测试。

const store = require('../core/store');
const ledger = require('./ledger');

// ---- 关键站白名单（台账事件侧）----
// 不在表里的事件类型（巡检/宽限/零派发/打点停滞/零输出/编制调整/并发调配/额度报警/迁移）
// 一律不进事件链：它们是调度面的噪声或全局事件，不回答「这一单现在怎么样」。
const 关键事件 = new Set([
  '派单委托', '待审', '切单启动', '切单失败',   // 起草 / 切单
  '定稿放行',                                    // 定稿放行
  '派发', '临时改池', '跨计费降级',              // 派发（含「为什么是这个池」）
  '评估回呈', '裁决',                            // 定夺族
  '上呈', '收口待验', '收口报告',                // 上呈 / 收口
]);

// 站序号：仅用于**同一时刻**多行时的稳定排序，不当链条骨架用——
// 真实链条会因返修而回环，时间戳才是唯一事实源。
const 站序 = { 起草: 1, 切单: 1, 返修: 2, 定稿: 3, 派发: 4, 交产出: 5, 质检: 6, 初检: 7, 核查: 8, 候实证: 9, 定夺: 10, 上呈: 11, 挂起: 12, 失败: 13, 终态: 20 };

const ms = (x) => { const n = Date.parse(x || ''); return Number.isNaN(n) ? null : n; };
const 短 = (s, n) => { const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n) + '…' : v; };

// 耗时人话：交产出行「（9 分钟）」那一档
function 历时(fromIso, toIso) {
  const a = ms(fromIso); const b = ms(toIso);
  if (a == null || b == null || b < a) return null;
  const m = Math.round((b - a) / 60000);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`;
}

// 一条台账事件牵扯到的单号（事件字段名各异：id / 单 / 父单 / 子单[]）
function 事件单号(e) {
  const out = [];
  const add = (v) => { const s = String(v || '').trim(); if (s && !out.includes(s)) out.push(s); };
  add(e.id); add(e.单); add(e.父单);
  for (const k of (Array.isArray(e.子单) ? e.子单 : [])) add(k);
  return out;
}

/* ===================== 一、事件流水 → 站行 ===================== */
// 返回 {站, t, 文, 因} 或 null（该事件对这张单不成站）。
// 委托事由：/api/pm/draft 的 派单委托 事件里带着制作人原话，起草站的「为什么起这张单」
// 就靠它——但它不带单号（起草时单号还没生出来），所以在 建链() 里按时间窗与紧随其后的
// 待审 事件配对，配不上就不写（缺站不补造）。
function 事件行(e, id) {
  const 类 = e.类型;
  if (!关键事件.has(类)) return null;
  switch (类) {
    case '待审':
      if (String(e.单 || '') === id) return { 站: '起草', t: e.t, 文: '受托起草完成 → 草稿呈总监审', 因: e.起草 === '单张' ? '项管单张起草（H57 派单委托）' : null };
      if (String(e.父单 || '') === id) return { 站: '切单', t: e.t, 文: `项管切单完成 → ${(e.子单 || []).length} 张子单呈总监审`, 因: (e.子单 || []).join('、') || null };
      return { 站: '起草', t: e.t, 文: '项管切单完成 → 呈总监审', 因: e.父单 ? `父单 ${e.父单}` : null };
    case '切单启动':
      return { 站: '切单', t: e.t, 文: '项管受托切单（仓况盘点中）', 因: e.触发 === '定稿自动' ? '父单定稿自动唤醒' : null };
    case '切单失败':
      return { 站: '切单', t: e.t, 文: '切单失败', 因: 短(e.error, 80) || null };
    case '定稿放行':
      return { 站: '定稿', t: e.t, 文: '总监审定稿 → 放行', 因: null };
    case '派发':
      return { 站: '派发', t: e.t, 文: '放行 → 派发引擎拉起', 因: e.池 ? `${e.池} 池` : null };
    case '临时改池':
      return { 站: '派发', t: e.t, 文: `临时改池 ${e.原池 || '?'} → ${e.新池 || '?'}`, 因: 短(e.因, 80) || null };
    case '跨计费降级':
      return { 站: '派发', t: e.t, 文: `跨计费降级 ${e.原池 || '?'} → ${e.新池 || '?'}`, 因: 短(e.因, 90) || null };
    case '评估回呈':
      return { 站: '定夺', t: e.t, 文: `执行会话评估回呈（第 ${e.轮 || 1} 轮）：判做不了`, 因: '项管裁决中' };
    case '裁决':
      return { 站: '定夺', t: e.t, 文: `项管裁决评估回呈：${e.处置 || '—'}`, 因: null };
    case '上呈':
      return { 站: '上呈', t: e.t, 文: '上呈制作人', 因: 短(e.因 || e.原因, 90) || ((e.异常单 || []).join('、') || null) };
    case '收口待验':
      return { 站: '交产出', t: e.t, 文: `专项全落袋（子单 ${e.子单数 ?? '?'} 张）→ 收口报告生成中`, 因: null };
    case '收口报告':
      return { 站: '终态', t: e.t, 文: '专项收口报告已出', 因: e.报告 ? 短(e.报告, 80) : null };
    default:
      return null;
  }
}

/* ===================== 二、工单 frontmatter → 站行 ===================== */
// fm 结构位是「不会随事件窗滚出去」的那一半事实：台账 jsonl 只读最近 N 条，
// 但审批时间/领单时间/交付时间/审检章 永远躺在单上。两边拼起来才是完整链。
// 注意：返修 会清掉 主办/领单时间/交付时间/初检/核查/质检人（lifecycle.返修），
// 所以老轮次的这些站在 fm 里查无实据——那正是「缺站不补造」适用的地方，只留 返修轮 计数行。
function fm行(t) {
  const fm = t.fm || {};
  const rows = [];
  const 轮 = Number(fm.返修轮) || 0;

  if (轮 > 0) {
    // 返修没有独立时间戳（lifecycle.返修 只记 返修轮 计数）。锚在本轮定稿之前一瞬：
    // 返修 → 草稿 → 重新定稿 是固定次序，这样摆位不会说谎，也不冒充一个不存在的时刻。
    rows.push({ 站: '返修', t: null, 锚: ms(fm.审批时间) != null ? ms(fm.审批时间) - 1 : null, 前: true,
      文: `第 ${轮} 轮返修（H65 同号改写，计数保留）`, 因: '主办/领单/交付/审检章随轮清场，旧轮站点不回填' });
  }
  if (fm.审批时间 || fm.审批人) {
    rows.push({ 站: '定稿', t: fm.审批时间 || null, 文: '总监审定稿 → 放行',
      因: [fm.审批人 ? `审批人 ${fm.审批人}` : null, 轮 > 0 ? `第 ${轮 + 1} 轮` : null].filter(Boolean).join(' · ') || null });
  }
  if (fm.领单时间) {
    rows.push({ 站: '派发', t: fm.领单时间, 文: '放行 → 派发引擎拉起',
      因: [fm.执行池 ? `${fm.执行池} 池` : null, fm.主办 ? `主办 ${fm.主办}` : null].filter(Boolean).join(' · ') || null });
  }
  if (fm.临时改池) {
    rows.push({ 站: '派发', t: fm.临时改池.时间 || null, 锚: ms(fm.领单时间), 文: `临时改池 ${fm.临时改池.原池 || '?'} → ${fm.临时改池.新池 || fm.执行池 || '?'}`, 因: 短(fm.临时改池.因, 80) || null });
  }
  if (fm.交付时间) {
    const 用 = 历时(fm.领单时间, fm.交付时间);
    const qa关 = String(fm.QA || '').trim() === '关';
    rows.push({ 站: '交产出', t: fm.交付时间, 文: `执行完工交产出${用 ? `（${用}）` : ''}`, 因: qa关 ? 'QA 关 · 直达待验收' : '进质检' });
  }
  if (fm.质检人) {
    // QA 裁定不落时间戳（lifecycle.QA裁定 只改 自修次数），锚在交产出之后。
    rows.push({ 站: '质检', t: null, 锚: ms(fm.交付时间), 文: `QA 质检（${fm.质检人}）`,
      因: Number(fm.自修次数) > 0 ? `自修 ${fm.自修次数} 轮` : null });
  }
  if (fm.初检) {
    rows.push({ 站: '初检', t: fm.初检.时间 || null, 锚: ms(fm.交付时间), 文: `两检初检：${fm.初检.结论 || '—'}`,
      因: [(fm.初检.缺项 || []).length ? `缺项 ${短((fm.初检.缺项 || []).join('；'), 90)}` : null, fm.初检.判源 ? `判源 ${fm.初检.判源}` : null].filter(Boolean).join(' · ') || null });
  }
  const 核 = fm.核查 || fm.代核; // H68 双写：新章 核查 优先，旧章 代核 兼容
  if (核) {
    rows.push({ 站: '核查', t: 核.时间 || null, 锚: ms(fm.交付时间), 文: `核查（深检）：${核.结论 || '—'}`, 因: null });
  }
  if (fm.待引擎实证) {
    rows.push({ 站: '候实证', t: fm.待引擎实证.时间 || null, 文: '核查过 · 候引擎实证（H97 门禁停闸，不转完成）',
      因: [fm.待引擎实证.命中 ? `命中「${fm.待引擎实证.命中}」` : null, fm.待引擎实证.判源 ? `判源 ${fm.待引擎实证.判源}` : null].filter(Boolean).join(' · ') || null });
  }
  if (fm.代裁) {
    rows.push({ 站: '定夺', t: fm.代裁.时间 || null, 文: `代裁裁决：${fm.代裁.结论 || '—'}`, 因: null });
  }
  if (fm.上呈原因) {
    // 上呈原因 写在流转那一刻但不带独立时间戳，锚在代裁之前（三振上呈 → 代裁读四件套）。
    const 锚 = ms(fm.代裁 && fm.代裁.时间);
    rows.push({ 站: '上呈', t: null, 锚: 锚 != null ? 锚 - 1 : ms(fm.更新时间), 前: 锚 != null, 文: '上呈制作人', 因: 短(fm.上呈原因, 120) || null });
  }
  if (fm.失败时间 || fm.失败原因) {
    rows.push({ 站: '失败', t: fm.失败时间 || null, 锚: ms(fm.交付时间) || ms(fm.领单时间), 文: `执行失败${fm.失败次数 ? `（第 ${fm.失败次数} 次）` : ''}`, 因: 短(fm.失败原因, 90) || null });
  }
  if (fm.挂起) {
    rows.push({ 站: '挂起', t: fm.挂起.时间 || null, 文: `挂起 · 原位冻结（${fm.挂起.操作者 || '制作人'}）`,
      因: [fm.挂起.理由 ? 短(fm.挂起.理由, 80) : null, fm.挂起.连带自 ? `连带自 ${fm.挂起.连带自}` : null].filter(Boolean).join(' · ') || null });
  }
  if (fm.解挂记录) {
    rows.push({ 站: '挂起', t: fm.解挂记录.时间 || null, 文: `解挂 · 原位复活（${fm.解挂记录.操作者 || '制作人'}）`, 因: null });
  }
  if (fm.实证放行) {
    rows.push({ 站: '终态', t: fm.实证放行.时间 || null, 文: `实证放行 → 完成（${fm.实证放行.操作者 || '总监'}）`,
      因: [fm.实证放行.命中 ? `门禁「${fm.实证放行.命中}」证据已确认入回执` : '引擎证据已确认入回执', fm.实证放行.说明 ? 短(fm.实证放行.说明, 80) : null].filter(Boolean).join(' · ') });
  }
  return rows;
}

// 终态行：完成/已归档单的最后一行（有了 实证放行 行就不再重复盖一行）
function 终态行(t) {
  const fm = t.fm || {};
  if (t.state === '完成') {
    if (fm.实证放行) return null; // 实证放行行本身就是终态行
    return { 站: '终态', t: fm.更新时间 || null, 文: '验收通过 → 完成落袋',
      因: (fm.核查 || fm.代核) && (fm.核查 || fm.代核).结论 === '通过' ? '核查通过 · 总监代劳（D11/D34）' : '制作人签字' };
  }
  if (t.state === '已归档') {
    return { 站: '终态', t: fm.更新时间 || null, 文: `归档${fm.归档原因 ? `：${fm.归档原因}` : ''}`, 因: fm.归档原因 ? null : '正常交付后的整理性归档' };
  }
  return null;
}

/* ===================== 三、「现在等什么、等谁」 ===================== */
// 七态判定表（验收标准逐态锁死）。态 = **lifecycle 语义态**，不等于目录名：
// 待引擎实证 是 待验收 + fm.待引擎实证 候检印 的停闸态（施工令-032② / H97），
// 目录上仍住在 待验收，但它等的人和普通待验收完全不同——混作一谈就是断头账。
//
// 闸 三档同时也是徽章三档：终=绿（完成折叠一行）/ 机=橙（在途）/ 人=紫（等人闸）。
function 现在等什么(root, t) {
  const fm = (t && t.fm) || {};
  const 态 = t.state === '待验收' && fm.待引擎实证 ? '待引擎实证' : t.state;
  const 人 = (什么, 谁) => ({ 态, 闸: '人', 什么, 谁 });
  const 机 = (什么, 谁) => ({ 态, 闸: '机', 什么, 谁 });

  // 挂起=原位冻结，全链路跳过（施工令-021）——冻结优先于本态的常规等待，先答「等解挂」。
  if (fm.挂起 && !store.TERMINAL.includes(t.state)) return 人('解挂放行（原位冻结中，全链路跳过）', '制作人');
  // 待复核=上游改版待核对（D36）：池中不可领、在途不起新执行。
  if (fm.待复核 && !store.TERMINAL.includes(t.state)) return 人(`核对上游新版后解除待复核（锚 ${fm.待复核.锚号 || '?'}）`, '总监');

  switch (态) {
    case '草稿':
      return 人('总监审改定稿（定稿预检 H62 过后放行）', '总监');
    case '待投': {
      if (!fm.放行) return 人('总监定稿放行（放行旗未落）', '总监');
      const 未就绪 = 未就绪依赖(root, t);
      if (未就绪.length) return 机(`依赖单落袋：${未就绪.join('、')}`, '上游工单');
      return 机('派发引擎拉起（已进就绪队列，等槽位/额度）', '派发引擎');
    }
    case '池':
      return 机('执行会话领单（池中待领）', `${fm.执行池 || '默认'} 池`);
    case '在途':
      return 机('执行会话交产出', fm.主办 || `${fm.职能 || '执行'}·${fm.执行池 || '池'}`);
    case '质检':
      return 机('QA 判官裁定（通过→待验收 / 不过→自修）', 'QA 判官');
    case '待引擎实证':
      return 人('总监实证放行（确认引擎实测证据已入回执）', '总监');
    case '待验收': {
      const 委托 = String(fm.验收方式 == null ? '委托' : fm.验收方式).trim() === '委托';
      const 核 = fm.核查 || fm.代核;
      if (委托) {
        if (fm.初检 && fm.初检.结论 === '不过') return 人('制作人裁（返修补齐格式规范 / 废弃）', '制作人');
        if (!fm.初检) return 机('两检初检裁定（格式与规范）', '初检判官');
        if (!核) return 机('核查判官深检裁定（逐条对照验收标准）', '核查判官');
        if (核.结论 === '不过') return 人('制作人裁（返修 / 废弃，核验报告已附回执）', '制作人');
      }
      return 人('制作人验收签字（终闸）', '制作人');
    }
    case '待定夺':
      if (fm.代裁) return 人(`制作人定夺（接受 / 给方向 / 打回）——代裁结论「${fm.代裁.结论 || '—'}」`, '制作人');
      return 机('代裁判官仲裁（四件套待裁）', '代裁判官');
    case '执行失败':
      return 人('失败分诊（重投 / 上呈 / 废弃）', '总监');
    case '完成':
    case '已归档':
      return { 态, 闸: '终', 什么: null, 谁: null };
    default:
      return { 态, 闸: '机', 什么: '（未知状态，按在途口径盯守）', 谁: '—' };
  }
}

// 依赖未就绪清单：口径与 dispatch.depsDone 同一把尺（完成 或 无因归档 才算落袋）。
// 不自己另写一套「什么叫落袋」——同一条判据写两处，迟早有一处漏改。
function 未就绪依赖(root, t) {
  const d = (t.fm || {}).依赖;
  if (!d) return [];
  const ids = (Array.isArray(d) ? d.map(String) : String(d).split(/[，,\s]+/)).filter(Boolean);
  const out = [];
  for (const id of ids) {
    const dep = store.find(root, id);
    if (!dep) continue; // 与 depsDone 同口径：查无此单不拦（可能是外部锚）
    const ok = dep.state === '完成' || (dep.state === '已归档' && !dep.fm.归档原因);
    if (!ok) out.push(id);
  }
  return out;
}

/* ===================== 四、一单一链 ===================== */
function 建链(root, t, evs, 委托表) {
  const rows = [];
  for (const e of evs || []) {
    const r = 事件行(e, t.id);
    if (r) rows.push(r);
  }
  // 委托事由摘要：起草站的「为什么起这张单」。只在配得上时才写（缺站不补造）。
  // 有事由就顶掉「项管单张起草」这句套话：制作人问的是「为什么起这张单」，不是「谁起的」。
  const 由 = 委托表 && 委托表[t.id];
  if (由) for (const r of rows) if (r.站 === '起草') r.因 = `委托事由：${由}`;

  rows.push(...fm行(t));
  const 终 = 终态行(t);
  if (终) rows.push(终);

  // 排序：时间戳是唯一骨架；无时间戳的站（返修/质检/上呈…）用锚点定位，
  // 同锚点时按站序稳定排列。锚也没有的行沉到末尾，绝不伪造时刻。
  const withKey = rows.map((r, i) => {
    const tm = ms(r.t);
    const 锚 = tm != null ? tm : (r.锚 != null ? r.锚 : null);
    return { r, i, 序: 锚, 站n: 站序[r.站] || 50 };
  });
  withKey.sort((a, b) => {
    if (a.序 == null && b.序 == null) return a.站n - b.站n || a.i - b.i;
    if (a.序 == null) return 1;
    if (b.序 == null) return -1;
    return a.序 - b.序 || a.站n - b.站n || a.i - b.i;
  });

  // 去重：同一站在同一分钟内的重复行（台账 派发 事件 与 fm.领单时间 是同一件事的两处记账），
  // 保留信息更全的那条（因 更长）。跨轮次的同站行分钟不同，不会被误并。
  const out = [];
  const seen = new Map();
  for (const w of withKey) {
    const key = w.r.站 + '|' + (w.序 == null ? 'x' + w.站n : Math.floor(w.序 / 60000));
    const prev = seen.get(key);
    const 富 = (x) => (x.因 ? String(x.因).length : 0) + (x.t ? 1 : 0);
    if (prev) { if (富(w.r) > 富(prev.r)) { out[prev.pos] = w.r; seen.set(key, { r: w.r, pos: prev.pos }); } continue; }
    seen.set(key, { r: w.r, pos: out.length });
    out.push(w.r);
  }
  return out.map((r) => ({ 站: r.站, t: r.t || null, 文: r.文, ...(r.因 ? { 因: r.因 } : {}) }));
}

// 徽章文案：完成单折叠成一行时，这一行必须自己说清「什么时候、被谁收的」。
function 徽(t, 等) {
  const fm = t.fm || {};
  if (t.state === '完成') {
    const 由 = fm.实证放行 ? `${fm.实证放行.操作者 || '总监'}实证放行`
      : (fm.核查 || fm.代核) && (fm.核查 || fm.代核).结论 === '通过' ? '核查通过代劳'
        : '制作人签字';
    return `完成 · ${由}`;
  }
  if (t.state === '已归档') return `已归档${fm.归档原因 ? ` · ${fm.归档原因}` : ''}`;
  if (fm.挂起) return '挂起 · 原位冻结';
  return 等 && 等.谁 ? `待${等.谁}` : (等 && 等.态) || t.state;
}

/* ===================== 五、关键汇报聚合入口 ===================== */
/**
 * 关键汇报事件链聚合（纯读）。
 * @param {string} root 工作区根
 * @param {object} opts { limit 卡片上限(默认12) / 事件窗 台账事件读取条数(默认300) / 含隐藏 }
 * @returns {{链:Array, 窗:{事件:number,单:number}}}
 */
function 汇总(root, opts) {
  const o = opts || {};
  const 事件窗 = Number(o.事件窗) || 300;
  const limit = Number(o.limit) || 12;
  const evs = ledger.events(root, 事件窗);

  // 委托事由配对：派单委托 事件不带单号（起草时单号还没生出来），按「紧随其后的第一条
  // 单张待审」配对，窗口 30 分钟（brain.draftTicket 起草超时上限 10 分钟，留三倍余量）。
  // 配不上就不写——宁可少一行「为什么」，也不给错单挂错事由。
  const 委托表 = {};
  const 窗ms = 30 * 60000;
  for (let i = 0; i < evs.length; i++) {
    if (evs[i].类型 !== '派单委托') continue;
    const t0 = ms(evs[i].t);
    for (let j = i + 1; j < evs.length; j++) {
      const e = evs[j];
      if (e.类型 === '派单委托') break;                 // 又一次委托：本条到此为止
      if (e.类型 !== '待审' || !e.单) continue;
      const t1 = ms(e.t);
      if (t0 == null || t1 == null || t1 - t0 > 窗ms) break;
      if (!委托表[e.单]) 委托表[e.单] = 短(evs[i].需求, 90);
      break;
    }
  }

  // 收单：全部活单 ∪ 事件窗里出现过的单号 ∪ 最近 limit 张终态单。
  // 草稿不进关键汇报——它还没被委托出去，链条无从谈起（起草站由 待审 事件带进来）。
  // 第三项是防「事件滚出窗口就瞎」：台账 jsonl 只读尾 N 条，刚落袋的单若被巡检心跳挤出窗，
  // 关键汇报会当它不存在——而它恰恰是制作人最想确认的那张。fm 不会滚，按 更新时间 补进来。
  const 活态 = ['待投', '池', '在途', '质检', '待验收', '待定夺', '执行失败'];
  const 候选 = new Map();
  for (const s of 活态) for (const t of store.list(root, s)) 候选.set(t.id, t);
  const 终单 = [];
  for (const s of store.TERMINAL) for (const t of store.list(root, s)) 终单.push(t);
  终单.sort((a, b) => (ms((b.fm || {}).更新时间) || 0) - (ms((a.fm || {}).更新时间) || 0));
  for (const t of 终单.slice(0, limit)) if (!候选.has(t.id)) 候选.set(t.id, t);
  const evById = new Map();
  for (const e of evs) {
    if (!关键事件.has(e.类型)) continue;
    for (const id of 事件单号(e)) {
      if (!evById.has(id)) evById.set(id, []);
      evById.get(id).push(e);
      if (!候选.has(id)) { const t = store.find(root, id); if (t) 候选.set(id, t); }
    }
  }

  const 卡 = [];
  for (const [id, t] of 候选) {
    if (t.fm && t.fm.隐藏 && !o.含隐藏) continue;
    if (t.state === '草稿' && !evById.has(id)) continue;
    const 等 = 现在等什么(root, t);
    const 链 = 建链(root, t, evById.get(id) || [], 委托表);
    const 最近 = 链.reduce((m, r) => { const x = ms(r.t); return x != null && x > m ? x : m; }, 0)
      || ms((t.fm || {}).更新时间) || 0;
    卡.push({
      id, title: (t.fm || {}).title || '', state: t.state, 态: 等.态,
      职能: (t.fm || {}).职能 || null, 执行池: (t.fm || {}).执行池 || null,
      管线: (t.fm || {}).管线 || null, 返修轮: Number((t.fm || {}).返修轮) || 0,
      父单: (t.fm || {}).父单 || null,
      档: 等.闸 === '终' ? 'done' : 等.闸 === '人' ? 'wait' : 'doing',
      徽: 徽(t, 等),
      活: 等.闸 !== '终',
      等: 等.闸 === '终' ? null : { 什么: 等.什么, 谁: 等.谁, 闸: 等.闸 },
      链, 最近,
    });
  }
  卡.sort((a, b) => (b.活 ? 1 : 0) - (a.活 ? 1 : 0) || b.最近 - a.最近 || String(a.id).localeCompare(String(b.id)));
  return { 链: 卡.slice(0, limit), 窗: { 事件: evs.length, 单: 卡.length } };
}

module.exports = { 汇总, 建链, 现在等什么, 事件行, fm行, 终态行, 事件单号, 未就绪依赖, 历时, 关键事件, 站序 };
