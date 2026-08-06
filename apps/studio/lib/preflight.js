// preflight.js — 定稿预检（H62，2026-08-05 制作人批准）：历史审漏案变机器闸——不过不放行。
// 每条规则背后一个真实事故；新案入档时同步加规则。
// 0.24.9（施工令-002）从 server.js 抽出成模块：错误（拦截）与警示（不拦截）分列，两者皆可单测。
const store = require('./core/store');

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

// 预检警示：不拦截定稿，只随结果回报 + 落流水
function warnings(t) {
  if (!t) return [];
  return titleWarnings(t.fm && t.fm.title); // 标题规范适用全部单型（含专项/父单/机制单）
}

// 预检错误：任一条命中即拦截定稿
function preflight(root, t, cfg2) {
  if (!t || ['战役', '专项'].includes(t.fm.父单类型)) return []; // 专项父单不预检（不执行）
  const errs = [];
  const 职能表 = ['策划', '程序', '美术', 'QA', '装配'];
  if (!职能表.includes(String(t.fm.职能 || ''))) errs.push(`职能「${t.fm.职能}」不在编制表（${职能表.join('/')}）——TK-82 案`);
  if (!/^P[0-3]$/.test(String(t.fm.优先级 || ''))) errs.push(`优先级「${t.fm.优先级}」非 P0-P3——TK-82 案`);
  if (!['开', '关'].includes(String(t.fm.QA || '').trim())) errs.push(`QA「${t.fm.QA}」非 开/关（非标串会被闸门误判）——TK-84 案`);
  if (!['委托', '保留'].includes(String(t.fm.验收方式 || '').trim())) errs.push(`验收方式「${t.fm.验收方式}」非 委托/保留（非标串两检不接手，单会滞留待验收）——TK-88/83 案`);
  const 超时分 = ((cfg2 || {}).执行器 || {}).执行超时分钟 ?? 30;
  const 预估分 = parseFloat(t.fm.预计时间) * 60;
  if (预估分 && 预估分 * 2 > 超时分) errs.push(`预计 ${预估分} 分钟 ×2 > 超时闸 ${超时分} 分钟，会话大概率被处决——TK-80 案（调预估或调闸）`);
  const deps = t.fm.依赖;
  if (deps) {
    const arr = Array.isArray(deps) ? deps.map(String) : String(deps).split(/[，,\s]+/).filter(Boolean);
    for (const id of arr) {
      const d = store.find(root, id);
      if (!d) errs.push(`依赖 ${id} 不存在——悬空死锁——TK-79 案`);
      else if (d.state === '已归档' && d.fm.归档原因) errs.push(`依赖 ${id} 已带因归档（${d.fm.归档原因}），永不落袋——TK-79 案`);
    }
  }
  const body = t.body || '';
  if (!/验收标准/.test(body)) errs.push('正文缺验收标准章（空壳/丢正文单不放行）——TK-86 案');
  for (const ch of ['unity-run', 'unity-build']) {
    if (body.includes(ch) && ch === 'unity-build') errs.push('正文点名 unity-build——该通道是占位未实装——TK-71 案');
  }
  return errs;
}

module.exports = { preflight, warnings, titleWarnings, 标题上限 };
