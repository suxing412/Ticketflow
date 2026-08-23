// preflight.js — 定稿预检（H62，2026-08-05 制作人批准）：历史审漏案变机器闸——不过不放行。
// 每条规则背后一个真实事故；新案入档时同步加规则。
// 0.24.9（施工令-002）从 server.js 抽出成模块：错误（拦截）与警示（不拦截）分列，两者皆可单测。
const store = require('./core/store');
const roster = require('./roster');

// 职能校验的数据源（H88，2026-08-07）：编制表是活的，新增职能（技术策划）不该再回来改这行硬清单。
// 唯一读口是 roster（去岗位化后 cfg.编制 每职能一行），预检与派发共用同一张表。
// 回落：编制表读不出来（配置缺失 / 未过迁移的内存态 cfg）时用基础六职能——
// fail-open 到旧行为，绝不因为读不到配置就把所有单一律拦死。
const 基础职能 = ['策划', '技术策划', '程序', '美术', 'QA', '装配'];
function 职能表(cfg2) {
  const rows = roster.read(cfg2 || {}).map((r) => r.职能).filter(Boolean);
  return rows.length ? rows : 基础职能;
}

// 短题制（H83，2026-08-06 制作人裁决）：标题短到不点详情也能认单。
// 只警示不拦截——老单与在途单不受影响，是提醒不是闸。
const 标题上限 = 24;
const 枚举符 = /[①-⑳]/; // ①-⑳
function titleWarnings(title) {
  const s = String(title || '');
  const w = [];
  if ([...s].length > 标题上限) w.push(`标题 ${[...s].length} 字超 ${标题上限}（短题制 H83：≤16 字「对象+动作」，卡片一眼认单）`);
  if (枚举符.test(s)) w.push('标题含 ①② 类范围枚举符（短题制 H83：枚举进正文「范围」章，禁入标题）');
  return w;
}

// 管线归属（TK-106~116 案，2026-08-09）：整条地图施工链漏写管线章，全堆进看板「散单」行，制作人亲自抓出。
// 归属可继承（口径同 pipelines.pipelineOf）：本单没写就沿父链上溯，父链上有章即算有归属。
// 只警示不拦截——存量单与确无归属的独立杂务照过。root 缺省时只查本单（不误报父链继承的子单需传 root）。
function 管线Warnings(t, root) {
  let c = t; let g = 0;
  while (c && c.fm && g++ < 10) {
    if (String(c.fm.管线 || '').trim()) return [];
    const 父 = c.fm.父单;
    c = (root && 父) ? store.find(root, String(父)) : null;
  }
  return ['缺管线归属（frontmatter 管线: P-#）：本单与父链都没写，看板会把它堆进「散单」行——TK-106~116 漏章案'];
}

// 预检警示：不拦截定稿，只随结果回报 + 落流水
function warnings(t, root) {
  if (!t) return [];
  return [
    ...titleWarnings(t.fm && t.fm.title), // 标题规范适用全部单型（含专项/父单/机制单）
    ...管线Warnings(t, root),
  ];
}

// 预检错误：任一条命中即拦截定稿
function preflight(root, t, cfg2) {
  if (!t || ['战役', '专项'].includes(t.fm.父单类型)) return []; // 专项父单不预检（不执行）
  const errs = [];
  const 编制 = 职能表(cfg2);
  if (!编制.includes(String(t.fm.职能 || ''))) errs.push(`职能「${t.fm.职能}」不在编制表（${编制.join('/')}）——TK-82 案`);
  if (!/^P[0-3]$/.test(String(t.fm.优先级 || ''))) errs.push(`优先级「${t.fm.优先级}」非 P0-P3——TK-82 案`);
  if (!['开', '关'].includes(String(t.fm.QA || '').trim())) errs.push(`QA「${t.fm.QA}」非 开/关（非标串会被闸门误判）——TK-84 案`);
  if (!['委托', '保留'].includes(String(t.fm.验收方式 || '').trim())) errs.push(`验收方式「${t.fm.验收方式}」非 委托/保留（非标串两检不接手，单会滞留审检链）——TK-88/83 案`);
  const 超时分 = ((cfg2 || {}).执行器 || {}).执行超时分钟 ?? 30;
  const 预估分 = parseFloat(t.fm.预计时间) * 60;
  if (预估分 && 预估分 * 2 > 超时分) errs.push(`预计 ${预估分} 分钟 ×2 > 超时闸 ${超时分} 分钟，会话大概率被处决——TK-80 案（调预估或调闸）`);
  const deps = t.fm.依赖;
  if (deps) {
    const arr = Array.isArray(deps) ? deps.map(String) : String(deps).split(/[，,\s]+/).filter(Boolean);
    for (const id of arr) {
      const d = store.find(root, id);
      if (!d) errs.push(`依赖 ${id} 不存在——悬空死锁——TK-79 案`);
      // 三大态改造（2026-08-24）：废弃 独立成目录态＝永不落袋；历史废弃单不改史、
      // 仍以「归档 + 归档原因」躺在归档目录，故带因归档这条继续认。洁净归档＝落袋，依赖已兑现不拦。
      else if (d.state === '废弃') errs.push(`依赖 ${id} 已废弃，永不落袋——TK-79 案`);
      else if (d.state === '归档' && d.fm.归档原因) errs.push(`依赖 ${id} 已带因归档（${d.fm.归档原因}），永不落袋——TK-79 案`);
    }
  }
  const body = t.body || '';
  if (!/验收标准/.test(body)) errs.push('正文缺验收标准章（空壳/丢正文单不放行）——TK-86 案');
  for (const ch of ['unity-run', 'unity-build']) {
    if (body.includes(ch) && ch === 'unity-build') errs.push('正文点名 unity-build——该通道是占位未实装——TK-71 案');
  }
  return errs;
}

module.exports = { preflight, warnings, titleWarnings, 管线Warnings, 标题上限, 职能表, 基础职能 };
