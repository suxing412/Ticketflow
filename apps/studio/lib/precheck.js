// precheck.js — 两检初检的「机判」实现（施工令-031 / H96，制作人 2026-08-09 12:59 批准）。
//
// 案源：flash 初检一夜五次形式性误拦（其中两次拦的是**单据自己写了豁免条款**的占位），
// 外加 TK-102 长回执被 12000 字截断后误杀。结论：schema 校验是纯代码的活，交给 LLM 是错配。
// 本模块把初检从「一次 CLI 会话」改成「一次函数调用」——零 token、零会话、结果可复现、
// 判据可逐条审。flash 路径没删，留在 config.执行器.两检.初检.二线LLM（默认 false）当回滚路。
//
// 与旧初检**同构**（下游深检/核查零改动就能接）：
//   返回 { 初检: '过'|'不过', 缺项: string[], 备注: string, 判源: '机判', 判定: [...], 统计: {...} }
//   runner 只消费 初检/缺项/备注/判源；判定/统计 是给测试与 UI 看的明细，不入 fm。
//
// 豁免白名单是本模块的灵魂（案源直指于此）：单据正文写了「总监代劳」「不判失分」
// 「初检不得以占位判缺项」这类条款时，对应占位**不判缺项**，且豁免命中逐条写进备注——
// 透明可审，不是黑箱放水。参见 TK-112 验收标准 21、TK-113 验收标准 10 的原文措辞。
const fs = require('fs');
const path = require('path');

// ---- 默认阈值（全部可被 config.执行器.两检.初检 逐项覆盖；此处是硬编码兜底）----
const 默认 = {
  // 回执尺寸上限：超限即拒并注明「截断风险」——判官读不全的回执不该被判「过」（TK-102 案）
  回执上限字节: 2 * 1024 * 1024,
  // 回执必备章节（章节齐备）
  必备章节: ['自测结果', '实际消耗', '异议'],
  // 工单 frontmatter 必填结构位（初检要的那几格；交付时间等簿记项归生命周期，不在此拦）
  必填字段: ['id', 'title', '职能', '验收方式'],
  // 禁语表：空壳标志。命中即缺项——除非豁免白名单命中
  禁语: ['In progress', 'Waiting', '等待确认', '跑完后补', '待誊入', '实测后誊入', '稍后补', '待补充'],
  // 豁免白名单：单据正文出现即开豁免域（条目级优先，全单级兜底）
  豁免措辞: ['总监代劳', '不判失分', '初检不得以占位判缺项', '代劳誊入', '代劳实测'],
  // 实际消耗须用时 + token 双报
  报数双报: true,
  // 返修单须有「相对上轮改了什么」说明
  返修说明: true,
  // 二线 LLM（旧 flash 路径）总开关：true 才回到 CLI 会话判法
  二线LLM: false,
  // 备注长度上限（fm 里塞太长会把 YAML 撑爆）
  备注上限: 1200,
};

// 配置读口：cfg.执行器.两检.初检.* 覆盖默认值。非法值（负数/空数组/类型不符）一律回落默认，
// 绝不因为一格配置写坏就让初检行为漂移。
function 参数(cfg) {
  const c = (((cfg || {}).执行器 || {}).两检 || {}).初检 || {};
  const 数 = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const 表 = (v, d) => (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') ? v.slice() : d);
  const 真假 = (v, d) => (typeof v === 'boolean' ? v : d);
  return {
    回执上限字节: 数(c.回执上限字节, 默认.回执上限字节),
    必备章节: 表(c.必备章节, 默认.必备章节),
    必填字段: 表(c.必填字段, 默认.必填字段),
    禁语: 表(c.禁语, 默认.禁语),
    豁免措辞: 表(c.豁免措辞, 默认.豁免措辞),
    报数双报: 真假(c.报数双报, 默认.报数双报),
    返修说明: 真假(c.返修说明, 默认.返修说明),
    二线LLM: 真假(c.二线LLM, 默认.二线LLM),
    备注上限: 数(c.备注上限, 默认.备注上限),
  };
}
// runner 的路由判据：默认走机判，显式开 二线LLM 才回 flash CLI
function 用二线LLM(cfg) { return 参数(cfg).二线LLM === true; }

// 尺寸人读化：小的报 KB、大的报 MB。备注头与逐项判定共用同一口径——
// 同一份回执在两处报出不同数字（3554.9 KB vs 3.47 MB）读起来像两回事，桩台实测时当场发现的。
function 尺(b) { return b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB' : (b / 1024).toFixed(1) + ' KB'; }

// ---- 文本切片工具 ----
const 圈号 = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function 圈转数(ch) { const i = 圈号.indexOf(ch); return i < 0 ? null : i + 1; }

// 取 markdown 某个标题下的正文（到下一个同级或更高级标题为止）。名可为多个别名，取先命中者。
// 取**最后一次**出现——返修单的回执是分轮追加的，早轮的章节不作数。
function 章节(text, ...别名) {
  const s = String(text || '');
  const lines = s.split(/\r?\n/);
  let 起 = -1; let 级 = 2;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s*(.+?)\s*$/);
    if (!m) continue;
    if (!别名.some((n) => m[2].includes(n))) continue;
    起 = i + 1; 级 = m[1].length;
  }
  if (起 < 0) return null;
  const out = [];
  for (let i = 起; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= 级) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

// 末轮正文：H65 同活同号下回执是分轮追加的（lifecycle.交产出 写 `## 第 N 轮回执（返修后）`）。
// 初检只判最新一轮——早轮的占位是历史，不是本轮的空壳。
function 末轮(text) {
  const s = String(text || '');
  const re = /^#{1,6}\s*第\s*\d+\s*轮回执/gm;
  let last = null; let m;
  while ((m = re.exec(s))) last = m.index;
  return last === null ? s : s.slice(last);
}

// ---- 验收标准条目抽取 ----
// 优先阿拉伯编号（`1.` / `1)` / `1、`，编号即键，与回执表格的 # 列对得上）；
// 无编号时退圈号（①②）；再退 checkbox（`- [ ]`，按出现次序编 1..N）。
// 续行（不以条目符号开头的非空行）并进当前条目正文——豁免措辞常写在续行里。
function 验收标准条目(body) {
  const sec = 章节(body, '验收标准');
  if (sec === null) return [];
  const lines = sec.split(/\r?\n/);
  const 采 = (识别) => {
    const items = []; let cur = null;
    for (const ln of lines) {
      const k = 识别(ln);
      if (k) { cur = { 号: k.号, 文: k.文 }; items.push(cur); continue; }
      if (cur && ln.trim() && !/^\s*[-*]\s*\[[ xX]\]/.test(ln)) cur.文 += '\n' + ln;
    }
    return items;
  };
  const 阿拉伯 = 采((ln) => {
    const m = ln.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(\d{1,2})(?:\*\*)?[.、)]\s+(.*)$/);
    return m ? { 号: Number(m[1]), 文: m[2] } : null;
  });
  if (阿拉伯.length >= 2) return 去重(阿拉伯);
  const 圈 = 采((ln) => {
    const m = ln.match(new RegExp(`^\\s*(?:[-*]\\s*)?([${圈号}])\\s*(.*)$`));
    return m ? { 号: 圈转数(m[1]), 文: m[2] } : null;
  });
  if (圈.length >= 2) return 去重(圈);
  let n = 0;
  const 勾 = 采((ln) => {
    const m = ln.match(/^\s*[-*]\s*\[[ xX]\]\s*(.*)$/);
    return m ? { 号: ++n, 文: m[1] } : null;
  });
  return 去重(勾);
}
// 同号只留首现（TK-112 那种「A 组 1-3 / B 组 4-15」的分组正文里编号不会重，但防手滑）
function 去重(items) {
  const seen = new Set();
  return items.filter((x) => (x.号 && !seen.has(x.号) ? (seen.add(x.号), true) : false));
}

// ---- 回执逐条应答抽取 ----
// 判定符：✓/✗ 一族 + 文字判定。注意 ✗ 也是**应答**——初检只问「给没给判定」，
// 判定对不对是深检（opus）的事，这条边界踩过界就又变成形式性误拦了。
const 判定符 = /[✓✔√✅☑❌✗✘×]|通过|不过|达标|未达|不适用|N\/A|豁免/i;
// 回执里给出判定的行 → 编号。支持表格行 `| 10 | … | ✓ |`、列表 `10. ✓ …`、圈号 `⑩ ✓ …`
function 应答表(自测) {
  const map = new Map(); let 序 = 0; let 判定符数 = 0;
  for (const ln of String(自测 || '').split(/\r?\n/)) {
    if (/^\s*\|?\s*[-:| ]+\s*\|?\s*$/.test(ln)) continue; // markdown 表格分隔行
    const 有判 = 判定符.test(ln);
    if (有判) 判定符数++;
    let 号 = null;
    let m = ln.match(/^\s*\|\s*(?:\*\*)?#?\s*(\d{1,2})\s*(?:\*\*)?\s*\|/);
    if (m) 号 = Number(m[1]);
    if (号 === null) { m = ln.match(/^\s*(?:[-*]\s*)?(?:\*\*)?(\d{1,2})(?:\*\*)?[.、)]\s+/); if (m) 号 = Number(m[1]); }
    if (号 === null) { m = ln.match(new RegExp(`^\\s*(?:[-*]\\s*)?[|]?\\s*([${圈号}])`)); if (m) 号 = 圈转数(m[1]); }
    if (号 === null && /^\s*[-*]\s*\[[ xX]\]/.test(ln)) 号 = ++序;
    if (号 !== null && 有判 && !map.has(号)) map.set(号, ln.trim());
  }
  return { map, 判定符数 };
}

// ---- 豁免 ----
function 命中措辞(text, 表) {
  const s = String(text || '');
  return 表.filter((w) => s.includes(w));
}

// ---- 主判 ----
// t: { id, fm, body }（store.find 的形状）；opts.receiptPath 可覆盖回执路径（测试用）
function run(root, t, cfg, opts = {}) {
  const P = 参数(cfg);
  const fm = (t && t.fm) || {};
  const body = (t && t.body) || '';
  const rp = opts.receiptPath || path.join(root, '回执', `${(t && t.id) || ''}.md`);
  const 缺项 = []; const 判定 = []; const 豁免记 = [];
  const 记 = (项, 结论, 说明) => { 判定.push({ 项, 结论, 说明 }); if (结论 === '缺') 缺项.push(说明); if (结论 === '豁免') 豁免记.push(说明); };

  // 全单级豁免域：单据正文（含各轮返修说明）写了豁免条款 → 占位类判定一律不判缺项
  const 全单豁免 = 命中措辞(body, P.豁免措辞);

  // ① 回执存在且非空
  let raw = null; let 字节 = 0;
  try { 字节 = fs.statSync(rp).size; raw = fs.readFileSync(rp, 'utf8'); } catch { /* 下方判缺 */ }
  if (raw === null) {
    记('回执', '缺', '回执文件不存在（回执/' + ((t && t.id) || '?') + '.md）——无产出可核');
    return 收(P, '不过', 缺项, 判定, 豁免记, { 回执字节: 0, 标准条数: 0, 应答条数: 0, 禁语命中: [] });
  }
  if (!raw.trim()) {
    记('回执', '缺', '回执为空文件——空输出不作数');
    return 收(P, '不过', 缺项, 判定, 豁免记, { 回执字节: 字节, 标准条数: 0, 应答条数: 0, 禁语命中: [] });
  }
  记('回执', '过', `回执在位 ${尺(字节)}`);

  // ② 尺寸上限：超限即拒并注明「截断风险」（TK-102 案：2MB 回执被判官截断后尾部问题看不见）
  const 超限 = 字节 > P.回执上限字节;
  if (超限) {
    记('尺寸', '缺', `回执 ${尺(字节)} 超上限 ${尺(P.回执上限字节)}——**截断风险**：`
      + '判官读不全，尾部问题会被漏看（TK-102 案），退回拆分或摘要后重交');
  } else {
    记('尺寸', '过', `尺寸 ${尺(字节)} ≤ 上限 ${尺(P.回执上限字节)}`);
  }

  // 判材：末轮回执全文（**不截断**——机判读全文，这正是 TK-102 误杀的根治点）
  const 本轮 = 末轮(raw);

  // ③ fm 必填结构位
  const 缺字段 = P.必填字段.filter((k) => !String(fm[k] == null ? '' : fm[k]).trim());
  if (缺字段.length) 记('字段', '缺', `工单 frontmatter 缺必填结构位：${缺字段.join('、')}`);
  else 记('字段', '过', `frontmatter 结构位齐（${P.必填字段.join('/')}）`);

  // ④ 章节齐备
  const 缺章 = P.必备章节.filter((n) => 章节(本轮, n) === null);
  if (缺章.length) 记('章节', '缺', `回执缺章节：${缺章.map((x) => '「' + x + '」').join('')}`);
  else 记('章节', '过', `必备章节齐（${P.必备章节.join('/')}）`);

  // ④b 实际消耗双报（用时 + token）
  if (P.报数双报) {
    const 耗 = 章节(本轮, '实际消耗') || '';
    const 有时 = /\d/.test(耗) && /(时|分钟|小时|min|h\b|秒)/i.test(耗);
    const 有token = /token/i.test(耗) && /\d/.test(耗);
    if (!耗) { /* 缺章已在 ④ 记过，不重复判 */ }
    else if (!有时 || !有token) 记('报数', '缺', `实际消耗未双报（用时${有时 ? '✓' : '✗'} / token${有token ? '✓' : '✗'}）`);
    else 记('报数', '过', '实际消耗用时 + token 双报齐');
  }

  // ⑤ 逐条应答：按单据「验收标准」条目数对照回执逐条给判定（✓/✗ 皆算应答）
  const 标准 = 验收标准条目(body);
  const 自测 = 章节(本轮, '自测结果', '自测', '自检结果') || '';
  const { map: 应答, 判定符数 } = 应答表(自测);
  let 应答条数 = 0;
  if (!标准.length) {
    记('逐条', '过', '单据未列可编号的验收标准条目——本项不判（拆单侧问题，不算执行方缺项）');
  } else if (!应答.size && 判定符数 >= 标准.length) {
    // 宽松放行：回执没给编号但判定符数量足额（散文/无序表体例）。形式性误拦的高发区，
    // 这里明确不判——「有没有逐条判」由深检看内容，初检只兜「一个判定都没给」的空壳。
    应答条数 = 判定符数;
    记('逐条', '过', `回执未按编号列行，但自测结果含 ${判定符数} 处判定符 ≥ 标准 ${标准.length} 条——体例宽松放行`);
  } else {
    const 未答 = [];
    for (const it of 标准) {
      if (应答.has(it.号)) { 应答条数++; continue; }
      const 条豁 = 命中措辞(it.文, P.豁免措辞);
      if (条豁.length) { 记('逐条', '豁免', `标准 ${it.号} 未给判定 → 条目级豁免命中「${条豁.join('」「')}」，占位不判缺项`); continue; }
      if (全单豁免.length) { 记('逐条', '豁免', `标准 ${it.号} 未给判定 → 全单豁免命中「${全单豁免.join('」「')}」，占位不判缺项`); continue; }
      未答.push(it.号);
    }
    if (未答.length) 记('逐条', '缺', `自测结果未逐条应答验收标准：缺第 ${未答.join('、')} 条（共 ${标准.length} 条，已答 ${应答条数} 条）`);
    else 记('逐条', '过', `验收标准 ${标准.length} 条逐条有判定（应答 ${应答条数}${判定.filter((d) => d.项 === '逐条' && d.结论 === '豁免').length ? ' + 豁免 ' + 判定.filter((d) => d.项 === '逐条' && d.结论 === '豁免').length : ''}）`);
  }

  // ⑥ 禁语（空壳标志）——豁免白名单优先
  const 禁语命中 = [];
  for (const w of P.禁语) {
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const n = (本轮.match(re) || []).length;
    if (n) 禁语命中.push({ 词: w, 次: n });
  }
  if (!禁语命中.length) 记('禁语', '过', '禁语表零命中');
  else {
    const 摘 = 禁语命中.map((x) => `${x.词}×${x.次}`).join('、');
    if (全单豁免.length) 记('禁语', '豁免', `禁语命中（${摘}）→ 单据豁免条款「${全单豁免.join('」「')}」命中，占位不判缺项`);
    else 记('禁语', '缺', `回执含空壳标志：${摘}（单据无豁免条款）`);
  }

  // ⑦ 返修单须说明相对上轮改了什么
  if (P.返修说明 && Number(fm.返修轮) > 0) {
    const ok = /相对上轮|本轮改|本轮补|返修|第\s*\d+\s*轮回执/.test(本轮);
    if (ok) 记('返修', '过', `返修轮 ${fm.返修轮}：回执有本轮说明`);
    else 记('返修', '缺', `返修轮 ${fm.返修轮} 但回执无「相对上轮改了什么」说明`);
  }

  const 结论 = 缺项.length ? '不过' : '过';
  return 收(P, 结论, 缺项, 判定, 豁免记, { 回执字节: 字节, 标准条数: 标准.length, 应答条数, 禁语命中 });
}

// 备注装配：一行总账 + 逐项判定 + 豁免记录。透明可审是硬要求——豁免必须看得见。
function 收(P, 结论, 缺项, 判定, 豁免记, 统计) {
  const 过数 = 判定.filter((d) => d.结论 === '过').length;
  const 头 = `机判初检｜结论 ${结论}｜回执 ${尺(统计.回执字节)}｜`
    + `验收标准 ${统计.标准条数} 条 / 应答 ${统计.应答条数}｜判项 ${判定.length}（过 ${过数} · 豁免 ${豁免记.length} · 缺 ${缺项.length}）`;
  const 体 = 判定.map((d) => `${d.结论 === '过' ? '✓' : d.结论 === '豁免' ? '⊘' : '✗'} [${d.项}] ${d.说明}`);
  let 备注 = [头, ...体].join('\n');
  if (备注.length > P.备注上限) 备注 = 备注.slice(0, P.备注上限 - 3) + '…';
  return { 初检: 结论, 缺项: 缺项.slice(0, 10), 备注, 判源: '机判', 判定, 豁免: 豁免记, 统计 };
}

module.exports = { run, 参数, 用二线LLM, 默认, 验收标准条目, 应答表, 章节, 末轮, 命中措辞 };
