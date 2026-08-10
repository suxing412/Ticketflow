// progress.js — 执行进度百分比（施工令-004，制作人 2026-08-06 14:57 裁决：
// 「点进去我要看的其实就是执行进度，甚至我要百分比」）。
// 纯函数：无 IO、无全局态，输入一张单的现场快照，输出百分比 + 分段条 + 阶段如实命名。
// 服务端（/api/runner /api/agents）算好下发，前端只显示——口径唯一，可单测。
//
// 口径（施工令定稿，不许前端另立一套）：
//   阶段锚点  领单 5% ｜ 执行 5→60% ｜ 质检 60→75% ｜ 初检 75→80% ｜ 核查（深检）80→95% ｜ 落袋 100%
//   QA 关的单跳过质检段：执行 5→75%
//   验收方式=保留（无判官）：判官区并作一段「你验收」75→95%
//   阶段内插值 = 会话打点 k/n（施工令-041 §四起唯一来源；旧的「已耗时/预计时间」口径见文末修订注），
//               封顶该阶段上限——超时不回退、不越级，停在上限等阶段切换。
//   诚实纪律：永不显示 100% 直到真落袋；无预计时间的单阶段内不插值，直接显示阶段锚点。
//
// 进度打点协议（软契约）：执行方在输出流吐 `[进度 k/n 一句话]`，tail 里最后一个合法打点为准。
//   有打点 → 执行段内填充 = k/n；无打点或格式非法 → 停在阶段锚点。非法行一律忽略不炸。
//   缺失不告警不判罚，只影响显示精度。
//
// ---- 施工令-041 §四 口径修订（2026-08-11 巡礼 F2）----
// 原口径在无打点时按 耗时/预估 插值，于是同一张单会同时出现两个百分比：卡片头的数字（打点口径）
// 与计时行「已跑 X / 预估 Y」被读出来的比例（时间口径），实测 49% vs 28% 打架。
// 现口径：**百分比只由会话打点产生**，无打点一律停在阶段锚点；耗时/预估照旧显示，但只是时长，
// 不再折算成任何百分比。时间口径没有删除，降级为显式开关 `时间折算:true`（旧行为可复现、可单测），
// 生产两个下发口（/api/runner /api/agents）都不开它。超时判据仍吃 耗时 vs 预估——那是告警，不是进度。

// ---- 打点解析：容错优先，任何解析异常都退化为「没有打点」 ----
function 解析打点(tail) {
  if (typeof tail !== 'string' || !tail) return null;
  const re = /\[\s*进度\s+(\d+)\s*\/\s*(\d+)(?:[^\]\n]*)\]/g;
  let m; let hit = null;
  while ((m = re.exec(tail)) !== null) {
    const k = Number(m[1]); const n = Number(m[2]);
    if (!Number.isFinite(k) || !Number.isFinite(n)) continue; // 非数字：忽略
    if (n <= 0 || k < 0 || k > n) continue;                   // n=0 / k>n：非法，忽略
    hit = { k, n };                                            // 取最后一个合法打点
  }
  return hit;
}

// ---- 阶段表：按 QA 开关与验收方式裁段（段序 = 分段条的顺序） ----
function 阶段表(opts) {
  const qaOn = !(opts && opts.qaOn === false);
  const 委托 = !(opts && opts.委托 === false);
  const segs = [{ 名: '领单', lo: 5, hi: 5 }];
  segs.push({ 名: '执行', lo: 5, hi: qaOn ? 60 : 75 });
  if (qaOn) segs.push({ 名: '质检', lo: 60, hi: 75 });
  if (委托) { segs.push({ 名: '初检', lo: 75, hi: 80 }); segs.push({ 名: '核查', lo: 80, hi: 95 }); }
  else segs.push({ 名: '你验收', lo: 75, hi: 95 });
  segs.push({ 名: '落袋', lo: 100, hi: 100 });
  return segs;
}

// 在跑会话 kind → 阶段名（判官阶段如实命名，绝不冒充「执行」）
const KIND阶段 = { 执行: '执行', 质检: '质检', 初检: '初检', 代核: '核查', 核查: '核查', 代裁: '仲裁' };
const 判官阶段 = new Set(['质检', '初检', '核查', '仲裁', '定夺', '你验收']);

// 显示名：一眼知道现在到底在干什么（超时态自带盯守说明）
function 显示名(阶段, 超时) {
  if (阶段 === '执行') return 超时 ? '执行超预估 · 软超时盯守中' : '执行中';
  if (阶段 === '领单') return '衔接中';
  if (阶段 === '质检') return '质检中';
  if (阶段 === '初检') return '初检中 · 格式规范';
  if (阶段 === '核查') return '核查中 · 深检';
  if (阶段 === '你验收') return '待你验收';
  if (阶段 === '仲裁') return '仲裁中';
  if (阶段 === '定夺') return '待定夺';
  if (阶段 === '落袋') return '已落袋';
  return 阶段 || '—';
}

// 无在跑会话时，按目录状态定位阶段（目录态是兜底，现场态优先）
function 状态阶段(state, 委托, 初检已过) {
  if (state === '在途') return '领单';       // 单已领、会话未起：衔接中，如实停在领单锚点
  if (state === '质检') return '质检';
  if (state === '待验收') return 委托 ? (初检已过 ? '核查' : '初检') : '你验收';
  if (state === '待定夺') return '定夺';
  if (state === '执行失败') return '执行';
  if (state === '完成' || state === '已归档') return '落袋';
  return null;                               // 草稿/待投/池：还没进链条
}

/**
 * 计算一张单的执行进度。
 * @param {object} input
 *   state       工单目录状态（在途/质检/待验收/待定夺/完成…）
 *   kind        在跑会话环节（执行/质检/初检/代核/代裁），无会话传 null
 *   QA          fm.QA（'关' 以外一律按开——与 lifecycle 的 fail-closed 同口径）
 *   验收方式     fm.验收方式（'委托' 才有初检/核查两段判官）
 *   预计时间     fm.预计时间（小时，字符串或数字；缺失/非法 → 阶段内不插值）
 *   阶段起时     本阶段起始 ISO（在跑会话 startedAt）；无则不插值
 *   初检         该单是否已过初检（fm.初检 存在即真）
 *   tail        活尾巴文本（打点解析源）
 *   now         当前时刻毫秒（测试可注入）
 * @returns {{百分比:number,阶段:string,阶段名:string,判官:boolean,超时:boolean,段内:number,打点:?object,段:Array}}
 */
function compute(input) {
  const i = input || {};
  const now = typeof i.now === 'number' ? i.now : Date.now();
  const qaOn = String(i.QA == null ? '开' : i.QA).trim() !== '关';
  const 委托 = String(i.验收方式 == null ? '委托' : i.验收方式).trim() === '委托';
  const segs = 阶段表({ qaOn, 委托 });
  const 落袋了 = i.state === '完成' || i.state === '已归档';

  const 阶段 = 落袋了 ? '落袋'
    : (i.kind && KIND阶段[i.kind]) || 状态阶段(i.state, 委托, !!i.初检);

  // 还没进链条（草稿/待投/池）：不编进度
  if (!阶段) {
    return { 百分比: 0, 阶段: '未领单', 阶段名: '未领单', 判官: false, 超时: false, 段内: 0, 打点: null,
      段: segs.map((s) => ({ 名: s.名, 态: 'todo' })), 来源: '锚点', 锚点: 0 };
  }
  if (阶段 === '落袋') {
    return { 百分比: 100, 阶段: '落袋', 阶段名: '已落袋', 判官: false, 超时: false, 段内: 1, 打点: null,
      段: segs.map((s) => ({ 名: s.名, 态: 'done' })), 来源: '锚点', 锚点: 100 };
  }

  // 定夺/仲裁在链条之外（上呈到制作人手上）：借判官段位次显示，不插值
  const 位次名 = (阶段 === '定夺' || 阶段 === '仲裁') ? (委托 ? '初检' : '你验收') : 阶段;
  let idx = segs.findIndex((s) => s.名 === 位次名);
  if (idx < 0) idx = 1; // 兜底落在执行段（例如 QA 关的单意外报出质检会话）
  const seg = segs[idx];

  const est = parseFloat(i.预计时间);
  const estMs = Number.isFinite(est) && est > 0 ? est * 3600000 : 0;
  const 起 = i.阶段起时 ? Date.parse(i.阶段起时) : NaN;
  const 有起时 = Number.isFinite(起);
  const 耗时 = 有起时 ? Math.max(0, now - 起) : 0;

  const 打点 = 阶段 === '执行' ? 解析打点(i.tail) : null;
  const 时间折算 = i.时间折算 === true; // 施工令-041 §四：默认不折算，旧口径要显式开
  let 段内 = 0; let 来源 = '锚点';
  if (打点) { 段内 = 打点.k / 打点.n; 来源 = '打点'; }            // 有打点：执行段内按 k/n
  else if (时间折算 && estMs > 0 && 有起时) { 段内 = 耗时 / estMs; 来源 = '时间'; }
  // 无打点（且未开时间折算）→ 段内 0，直接显示阶段锚点：编不出来的进度就不编
  const 超时 = 阶段 === '执行' && estMs > 0 && 有起时 && 耗时 >= estMs;
  段内 = Math.max(0, Math.min(1, 段内));                   // 封顶该阶段上限：超时不回退、不越级

  let 百分比 = Math.round(seg.lo + (seg.hi - seg.lo) * 段内);
  if (!落袋了) 百分比 = Math.min(百分比, 99);              // 诚实纪律：不落袋永不 100%

  const 段 = segs.map((s, n) => ({
    名: s.名,
    态: n < idx ? 'done' : n === idx ? 'cur' : 'todo',
    ...(n === idx ? { 填充: 段内 } : {}),
  }));

  return {
    百分比, 阶段, 阶段名: 显示名(阶段, 超时), 判官: 判官阶段.has(阶段), 超时, 段内, 打点, 段,
    预估分钟: estMs ? Math.round(estMs / 60000) : null,
    // 来源/锚点随行（施工令-041 §四）：消费端要说得出这个数是怎么来的——
    // 「28% 是打点 3/7 报的」和「28% 是按时间猜的」，制作人的信任度天差地别。
    来源, 锚点: seg.lo,
  };
}

module.exports = { compute, 解析打点, 阶段表, 显示名, KIND阶段 };
