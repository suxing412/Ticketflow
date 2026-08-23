#!/usr/bin/env node
// propcheck.js — 传播不全「升机判」（2026-08-19 全量对账审计 D 批落地）。
//
// 病族：**改了正本忘了副本**。已复发三次，每次都是人肉传播漏了一站：
//   · fable 文案三次不死案（正本改了，skill-templates / 项目副本里的旧文案照跑）
//   · billFee 两次失联案（同一名字在两处各活各的）
//   · H100 打点退役漏改 skill-templates 与 TK 副本
// H78「八站传播」把动作规范化了，但**验证仍靠人肉 grep**——漏站与漏 grep 是同一种失误，
// 所以口头判据（「我改了」）必须升级为机判：本脚本对给定关键词遍历八站，逐站报命中，
// 给出「全库零活体命中」与否的机器结论 + 退出码。
//
// 用法：
//   node packages/propcheck/propcheck.js <关键词> [关键词2 ...] [选项]
//     --要求 零命中      任何一站还有活体命中 → 退出码 1（退役类改动的判据）
//     --要求 全站命中    任何一个适用站零命中 → 退出码 1（新增类改动的判据）
//     --json             输出机器可读 JSON
//     --明细 N           每站最多列 N 条命中（默认 8，0=不列）
//     --宽               不做退役标注过滤：所有命中都算活体（要看原始面貌时用）
//     --站 名=路径       追加/覆盖一个站的位置（可重复；测试与临时排查用）
//     --只站 名          只扫这一站（子串匹配站名）
//     --台账根 路径      记账落点的根（默认 <协议仓>/监制台）；每次运行往 <根>/瞭望塔/传播核查.jsonl 追一行
//     --不记账           只核查不留痕（排查态用；常规跑一律记，否则「断更」这条闸读不到东西）
//     --含史料           零命中判据把史料站（决议史/班次归档）也算进去（默认豁免——
//                        历史记载里必然留着旧词，那是史实不是漂移；永远红的判据等于没有判据）
//     --含代码           取消代码站的**注释豁免**：注释里的旧词也算活体（要看原始面貌时用）
//   退出码：0=判据满足（或未给判据）；1=判据不满足；2=用法错误。
//
// 「活体命中」口径：命中行若带**退役标注**（删除线 ~~…~~、已退役/已废止/已作废/已删除/已迁移），
// 视为「留痕不是留活」，不计活体。这个表**故意窄**——宁可多报一条让人再看一眼，
// 不可把一条还在生效的旧文案判成「已经退役了」。要扩它先想清楚：这条命中要不要人动手改？
const fs = require('fs');
const path = require('path');
const os = require('os');

const 仓根 = path.resolve(__dirname, '..', '..');                    // packages/propcheck → Ticketflow 仓根
const 监制台源 = path.join(仓根, 'apps', 'studio');
const 默认扩展 = ['.md', '.js', '.mjs', '.cjs', '.json', '.jsonl', '.ps1', '.bat', '.txt', '.yml', '.yaml'];
const 跳过目录 = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'obj', 'bin', 'Library', 'Temp', '.vs', '.idea', 'coverage']);
// 退役标记：同一行里出现这些词，说明**这句话讲的是「它已经不算数了」**，不是拿它当现行法。
// 2026-08-21 体检扩表：原表只认「已退役/已废止」这类完成态，于是漏掉三大族——
//   ① 改判族：「改判 D3/D29 拉取制判例」——这是改判记录本身，正是传播到位的证据
//   ② 兼容族：「拉取制兼容视图」「拉取制（旧路径，可回退）」——代码里保留回退分支是设计
//   ③ 退役动词族：「拉取制退役、派发制立宪」——H49 原文的措辞
// 不扩表的后果实测过：「拉取制」一词全库 38 条命中，逐条查完**没有一条是漂移**，
// 而判据照红。**永远红的判据等于没有判据**，人只会学会绕过它。
const 退役标记 = ['~~', '已退役', '已废止', '已作废', '已删除', '已迁移', '退役）', '退役)',
  '改判', '推翻', '退役、', '退役——', '退役自', '不再是现行法', '原始记录', '已随', '退役（', '退役('];
// 【为什么不继续往下扩表】2026-08-21 体检实测：「拉取制」全库 38 条命中，逐条查完
// **只有一条是真漂移**（管线总协议把它列进「不动的 B 级」，已订正）。其余分三类：
//   决议史/白夜馆＝史实（走史料站豁免）、协议库＝改判记录本身（走退役标记）、
//   **代码＝保留回退分支的正当注释**（「拉取制这条路同样得堵」「拉取制兼容视图」）。
// 最后这类扩不进标记表——它们讲的不是「已废止」，是「这条旧路还在，得一起堵」。
// 继续扩表就是为了让判据变绿而放宽判据，那正是本次体检要治的病。
// 故改走分型：见 站表() 的 代码站 标。
//
// 【代码站豁免的收窄 · 2026-08-22 体检 #44】
// 原做法是**整站放行**：代码站一律不参与「零命中」。实测这道口子太宽——
// 「决策台」在代码站 28 条活体命中里，26 条确实是回退分支的正当注释，
// 但 public/app.js:104（顶栏 tagline）与 :884（抽屉提示）是**真在跑的界面文案**，
// 整站放行等于给这两条真漂移发通行证。整站豁免不是豁免，是关掉判据。
// 改为**按位置**豁免：命中落在 JS 注释里 → 记「注」（不计活体）；落在字符串/模板/
// 配置值/界面文案里 → 记「活」，照样进判据。实测收益：拉取制 站4 的 3 条与站6 的 8 条
// 全落注释归零（正当豁免一条不误伤），决策台残 2 条正好是上面那两条真文案。
const JS族 = ['.js', '.mjs', '.cjs'];
// 逐行算「本行哪些列在注释里」。块注释状态跨行——这一格是必需的，不是讲究：
// app.js:1123 与 :1146 都是 /* … */ 块注释的**续行**，行首没有任何注释标记，
// 只看单行的写法（「行内 // 或 /* 在关键词之前」）会把它们误判成活体文案。
// 同时要认字符串：`const u = 'http://x/拉取制'` 里的 // 不是注释开头。
// 不追求 JS 解析器级正确（正则字面量里的 /* 之类不管）——这里是核查器不是编译器，
// 判错的方向也定死了：宁可把注释当活体多报一条让人再看一眼，不可把活文案判成注释。
function 注释掩码(行表) {
  const out = []; let 块 = false;
  for (const 行 of 行表) {
    const m = new Array(行.length).fill(false);
    let i = 0; let 串 = null;
    while (i < 行.length) {
      if (块) { m[i] = true; if (行.startsWith('*/', i)) { m[i + 1] = true; 块 = false; i += 2; } else i++; continue; }
      if (串) { if (行[i] === '\\') { i += 2; continue; } if (行[i] === 串) 串 = null; i++; continue; }
      if (行.startsWith('//', i)) { for (let k = i; k < 行.length; k++) m[k] = true; break; }
      if (行.startsWith('/*', i)) { m[i] = true; m[i + 1] = true; 块 = true; i += 2; continue; }
      if (行[i] === '"' || 行[i] === "'" || 行[i] === '`') { 串 = 行[i]; i++; continue; }
      i++;
    }
    out.push(m);
  }
  return out;
}
// 本行这个词是不是**全部**落在注释里。只要有一处露在代码/文案里就算活体。
function 全在注释(行, 词, 掩) {
  if (!掩) return false;
  let i = 行.indexOf(词); let 见 = false;
  while (i >= 0) { 见 = true; if (!掩[i]) return false; i = 行.indexOf(词, i + 1); }
  return 见;
}
const 单文件上限 = 2 * 1024 * 1024;

// 协议仓（AI-GameStudio）位置：环境变量 > 仓根同级 > 常见落点。找不到的站会如实报「不存在」，不静默跳过。
function 协议仓(opts = {}) {
  const 候选 = [opts.协议仓, process.env.AI_GAMESTUDIO_ROOT,
    path.resolve(仓根, '..', 'AI-GameStudio'), 'D:/GitHub/AI-GameStudio'].filter(Boolean);
  return 候选.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || 候选[候选.length - 1];
}

// 项目侧 .claude/skills：仓根同级目录逐个看一眼（TK / Ticketflow / 其它注册项目都在同一层）
function 项目技能目录() {
  const out = [];
  const 上 = path.dirname(仓根);
  let 兄弟 = [];
  try { 兄弟 = fs.readdirSync(上, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(上, d.name)); } catch { /* 读不动就只报仓根自己 */ }
  for (const d of [仓根, ...兄弟]) {
    const p = path.join(d, '.claude', 'skills');
    try { if (fs.existsSync(p)) out.push(p); } catch { /* 忽略不可读项 */ }
  }
  return out;
}

function 总监技能目录() { return path.join(os.homedir(), '.claude', 'skills'); }

function 记忆目录() {
  const base = path.join(os.homedir(), '.claude', 'projects');
  const out = [];
  try {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'memory');
      if (fs.existsSync(p)) out.push(p);
    }
  } catch { /* 无记忆目录=该站不存在，如实报 */ }
  return out;
}

// 八站清单（H78 protocol-sync 的机判版；站名与那张表逐条对应）
function 站表(opts = {}) {
  const G = 协议仓(opts);
  const 技 = 总监技能目录();
  // 史料站（2026-08-21 体检）：**历史记载里必然留着旧词，那不是漂移**。
  // 决议史 :80 那条正是「H49 宣布拉取制退役」本身——拿它当活体旧词，判据注定永远红；
  // 白夜馆是班次归档，历史报告里写过「决策台」也是史实。**永远红的判据等于没有判据**，
  // 人只会学会绕过它。故：零命中判据默认跳过史料站，另给 --含史料 保留全量视图。
  // 「全站命中」不受影响——新决议本就该誊进决议史，那一路仍要求它命中。
  const t = (站, 位置, 说明, 标 = {}) => ({ 站, 位置: 位置.filter(Boolean), 说明, 史料: !!标.史料, 代码: !!标.代码 });
  return [
    t('1 决议史', [path.join(G, '历史库', '决议史.md')], '条目本身（史料：只增不改，旧词是史实）', { 史料: true }),
    t('2 协议库正本', [path.join(G, '协议库')], 'S/A/B/C/D/E 各册'),
    t('3 岗位协议', [path.join(G, '监制台', '岗位协议')], '执行编制即读生效'),
    t('4 提示词接线', [path.join(监制台源, 'lib', 'pm', 'brain.js'), path.join(监制台源, 'lib', 'runner.js')],
      '切单/起草/裁决/执行/判官 prompt（代码站，同上）', { 代码: true }),
    t('5 技能舰队', [技, ...项目技能目录(), path.join(仓根, 'packages', 'skill-templates'), path.join(仓根, 'packages', 'role-protocol-templates')], '总监侧 + 项目侧 + 套件模板'),
    t('6 机制代码/config', [path.join(监制台源, 'lib'), path.join(监制台源, 'server.js'), path.join(监制台源, 'public'),
      path.join(G, '监制台', 'studio.config.json'), path.join(仓根, '套件', 'studio.config.template.json')],
      '监制台代码 + 活体配置 + 发行模板（代码站：回退分支的注释里必然提旧制度名，不计入零命中）', { 代码: true }),
    t('7 跨会话记忆', 记忆目录(), 'memory/（史料：跨会话速览是当时写的，改它要走记忆整理不走传播）', { 史料: true }),
    t('8 汇报模板', [path.join(技, 'evening-report'), path.join(技, 'morning-report')], '汇报节律与格式'),
    t('8b 班次归档', [path.join(G, '白夜馆')], '历史班次报告（史料：写过的话是当时的实况）', { 史料: true }),
  ];
}

function 走文件(p, 扩展, out, 深度 = 0) {
  let st;
  try { st = fs.statSync(p); } catch { return; }
  if (st.isFile()) {
    if (st.size > 单文件上限) return;
    if (扩展 && !扩展.includes(path.extname(p).toLowerCase())) return;
    out.push(p);
    return;
  }
  if (!st.isDirectory() || 深度 > 12) return;
  let 项 = [];
  try { 项 = fs.readdirSync(p); } catch { return; }
  for (const n of 项) {
    if (跳过目录.has(n)) continue;
    走文件(path.join(p, n), 扩展, out, 深度 + 1);
  }
}

function 是退役标注(行, 关键词, 标记) {
  return 标记.some((m) => 行.includes(m)) && 行.includes(关键词);
}

// 扫一站。返回 { 站, 位置, 存在, 文件数, 命中:[{file,line,text,关键词,活体,注释}], 活体数, 标注数, 注释数 }
function 扫一站(站, 关键词表, opts = {}) {
  const 扩展 = opts.全部扩展 ? null : (opts.扩展 || 默认扩展);
  const 标记 = opts.宽 ? [] : (opts.退役标记 || 退役标记);
  const 文件 = [];
  let 存在 = false;
  for (const loc of 站.位置) {
    try { if (!fs.existsSync(loc)) continue; } catch { continue; }
    存在 = true;
    走文件(loc, 扩展, 文件);
  }
  // 代码站的注释豁免（#44）：只对 JS 家族生效——.json/.md 没有注释语法，
  // 那里的旧词就是活的（studio.config.json 的配置值、模板 md 的正文）。
  const 注释豁免 = !!站.代码 && !opts.含代码 && !opts.宽;
  const 命中 = [];
  for (const f of [...new Set(文件)]) {
    let 文本;
    try { 文本 = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (!关键词表.some((k) => 文本.includes(k))) continue;
    const 行表 = 文本.split(/\r?\n/);
    const 掩 = (注释豁免 && JS族.includes(path.extname(f).toLowerCase())) ? 注释掩码(行表) : null;
    for (let i = 0; i < 行表.length; i++) {
      for (const k of 关键词表) {
        if (!行表[i].includes(k)) continue;
        const 注释 = 全在注释(行表[i], k, 掩 && 掩[i]);
        命中.push({
          file: f, line: i + 1, text: 行表[i].trim().slice(0, 200), 关键词: k, 注释,
          活体: !注释 && !是退役标注(行表[i], k, 标记),
        });
      }
    }
  }
  return {
    // 站的分型标必须原样透传——本处**同一个漏犯了两次**（先漏 史料、再漏 代码）：
    // 站表里标了、判据里读了，中间这一层没带出去，于是豁免静默失效而判据照红。
    // 判据：test/propcheck.test.js「站分型标要透传到结果里」。
    站: 站.站, 说明: 站.说明, 位置: 站.位置, 史料: !!站.史料, 代码: !!站.代码, 存在, 文件数: new Set(文件).size, 命中,
    活体数: 命中.filter((h) => h.活体).length, 标注数: 命中.filter((h) => !h.活体 && !h.注释).length,
    注释数: 命中.filter((h) => h.注释).length,
  };
}

// 全库扫描。opts.站 可整表替换（测试/临时排查）。
function 扫描(关键词, opts = {}) {
  const 关键词表 = (Array.isArray(关键词) ? 关键词 : [关键词]).map(String).filter(Boolean);
  if (!关键词表.length) throw new Error('至少给一个关键词');
  let 表 = opts.站 || 站表(opts);
  if (opts.只站) 表 = 表.filter((s) => s.站.includes(opts.只站));
  const 站结果 = 表.map((s) => 扫一站(s, 关键词表, opts));
  const 活体总数 = 站结果.reduce((a, s) => a + s.活体数, 0);
  return {
    关键词: 关键词表, 站: 站结果, 活体总数,
    标注总数: 站结果.reduce((a, s) => a + s.标注数, 0),
    注释总数: 站结果.reduce((a, s) => a + (s.注释数 || 0), 0),
    全库零活体命中: 活体总数 === 0,
    缺站: 站结果.filter((s) => !s.存在).map((s) => s.站),          // 位置根本不存在的站：判据里不当「零命中」用
    零命中站: 站结果.filter((s) => s.存在 && s.活体数 === 0).map((s) => s.站),
  };
}

// 判据。要求='零命中' | '全站命中'；不给要求就只报不判。
// 【2026-08-22 #44】代码站不再整站豁免——豁免收窄到「命中落在注释里」那一层，
// 在 扫一站() 就把注释命中判成非活体了。这里只剩**史料站**一条整站豁免。
function 判据(结果, 要求, 含史料) {
  if (!要求) return { 通过: true, 判据: '无（只报不判）', 说明: `活体命中 ${结果.活体总数} 条` };
  if (要求 === '零命中') {
    // 史料站不参与零命中判据（除非 --含史料）：见 站表() 的说明。
    const 现役 = 结果.站.filter((s) => 含史料 || !s.史料);
    const n = 现役.reduce((a, s) => a + (s.活体数 || 0), 0);
    const 豁免命中 = 结果.站.filter((s) => s.史料 && s.活体数 && !现役.includes(s));
    return {
      通过: n === 0, 判据: `现役站零活体命中（${含史料 ? '无' : '史料站'}豁免；代码站只豁免注释里的命中）`,
      说明: (n === 0 ? '现役各站零活体命中——传播完全' : `仍有 ${n} 条活体命中（${现役.filter((s) => s.活体数).map((s) => `${s.站}×${s.活体数}`).join('、')}）`)
        + (豁免命中.length ? ` · 豁免站另有 ${豁免命中.reduce((a, s) => a + s.活体数, 0)} 条（${豁免命中.map((s) => s.站).join('、')}，不计入判据）` : ''),
    };
  }
  if (要求 === '全站命中') {
    const 漏 = 结果.零命中站;
    return { 通过: 漏.length === 0, 判据: '每个存在的站都有活体命中', 说明: 漏.length ? `零命中站：${漏.join('、')}` : '各站均已誊到' };
  }
  return { 通过: false, 判据: 要求, 说明: `未知判据：${要求}（只认 零命中 / 全站命中）` };
}

// ══════════ 记账口（2026-08-22 体检 #55 前置件二）══════════
// 原样本模块**零写文件动作**——「传播核查」只是报告抬头的一句文案，跑完即散。
// 于是「这道核查上次是什么时候跑的」全库无人知道，G18「传播核查断更」这类闸
// 读不到任何东西：判据读一个没人写的文件 = 恒空假账，正是文件头 19-20 行明令要防的那种
// （G13/G14 无人消费就是这么来的）。故每次运行追一行到 <数据根>/瞭望塔/传播核查.jsonl。
//
// 三条口径：
//   ① **一行一次运行**，JSON Lines：闸只读最后一行即可判断断更，绝不许把全语料扫描压进值守 tick。
//   ② **根可注入**（opts.台账根 / --台账根 / 环境变量）：测试写临时目录，绝不碰生产工作区。
//   ③ **写不进不许炸**：核查器的本职是核查，记账是副产品。目录只读/盘满时如实回 记:false，
//      判据结论与退出码一个字都不受影响——否则一次记账故障能把整条传播流水线打停。
function 台账根(opts = {}) {
  return String(opts.台账根 || process.env.PROPCHECK_台账根 || process.env.PROPCHECK_LEDGER_ROOT
    || path.join(协议仓(opts), '监制台'));
}
function 台账路径(opts = {}) { return path.join(台账根(opts), '瞭望塔', '传播核查.jsonl'); }

// 追一行。返回 { 记, 文件, 行 } 或 { 记:false, 因 }。
function 记账(结果, 判, opts = {}) {
  const 文件 = 台账路径(opts);
  if (opts.不记账) return { 记: false, 因: '不记账', 文件 };
  const 行 = {
    时间: new Date().toISOString(),
    关键词: (结果 && 结果.关键词) || [],
    判据: (判 && 判.判据) || '无（只报不判）',
    通过: !!(判 && 判.通过),
  };
  try {
    fs.mkdirSync(path.dirname(文件), { recursive: true });
    fs.appendFileSync(文件, JSON.stringify(行) + '\n', 'utf8');
    return { 记: true, 文件, 行 };
  } catch (e) {
    return { 记: false, 因: String((e && e.message) || e), 文件 };
  }
}

function 渲染(结果, 判, 明细上限) {
  const L = [];
  L.push(`传播核查（propcheck）· 关键词：${结果.关键词.join(' / ')}`);
  L.push('站                     文件   活体   退役标注   注释  位置');
  for (const s of 结果.站) {
    const 位 = s.存在 ? s.位置.map((p) => p.replace(/\\/g, '/')).join(' , ') : `（不存在）${s.位置.map((p) => p.replace(/\\/g, '/')).join(' , ')}`;
    L.push(`${s.站.padEnd(20, ' ')} ${String(s.文件数).padStart(5)} ${String(s.活体数).padStart(6)} ${String(s.标注数).padStart(9)} ${String(s.注释数 || 0).padStart(6)}  ${位}`);
    if (明细上限 > 0) {
      for (const h of s.命中.slice(0, 明细上限)) {
        L.push(`      ${h.活体 ? '活' : (h.注释 ? '注' : '痕')} ${h.file.replace(/\\/g, '/')}:${h.line}  ${h.text}`);
      }
      if (s.命中.length > 明细上限) L.push(`      …另有 ${s.命中.length - 明细上限} 条`);
    }
  }
  L.push('');
  L.push(`活体命中合计：${结果.活体总数}（退役标注 ${结果.标注总数}、代码注释 ${结果.注释总数}）· 全库零活体命中：${结果.全库零活体命中 ? '是' : '否'}`);
  if (结果.缺站.length) L.push(`位置不存在的站：${结果.缺站.join('、')}（这些站没被判作「零命中」，别拿它当传播完成的证据）`);
  L.push(`判据：${判.判据} → ${判.通过 ? '通过' : '不通过'}｜${判.说明}`);
  return L.join('\n');
}

function 解析参数(argv) {
  const o = { 关键词: [], 明细: 8, 站覆盖: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--要求') o.要求 = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--宽') o.宽 = true;
    else if (a === '--含史料') o.含史料 = true;
    else if (a === '--含代码') o.含代码 = true; // 取消代码站的注释豁免：注释里的旧词也算活体（原始面貌视图）
    else if (a === '--全部扩展') o.全部扩展 = true;
    else if (a === '--明细') o.明细 = Number(argv[++i]) || 0;
    else if (a === '--只站') o.只站 = argv[++i];
    else if (a === '--协议仓') o.协议仓 = argv[++i];
    else if (a === '--台账根') o.台账根 = argv[++i];   // 记账落点的根（默认 <协议仓>/监制台）；测试指临时目录
    else if (a === '--不记账') o.不记账 = true;        // 只核查不留痕（排查态用；常规跑一律记）
    else if (a === '--站') o.站覆盖.push(String(argv[++i] || ''));
    else if (a.startsWith('--')) o.错 = `未知选项：${a}`;
    else o.关键词.push(a);
  }
  return o;
}

function main(argv) {
  const o = 解析参数(argv);
  if (o.错) { console.error(o.错); return 2; }
  if (!o.关键词.length) {
    console.error('用法：node packages/propcheck/propcheck.js <关键词> [--要求 零命中|全站命中] [--json] [--明细 N] [--只站 名] [--站 名=路径] [--宽]');
    return 2;
  }
  const opts = { 协议仓: o.协议仓, 宽: o.宽, 含代码: o.含代码, 全部扩展: o.全部扩展, 只站: o.只站,
    台账根: o.台账根, 不记账: o.不记账 };
  if (o.站覆盖.length) {
    const 表 = 站表(opts);
    for (const kv of o.站覆盖) {
      const i = kv.indexOf('=');
      if (i < 0) { console.error(`--站 需写成 名=路径：${kv}`); return 2; }
      const 名 = kv.slice(0, i); const p = kv.slice(i + 1);
      const 命 = 表.find((s) => s.站.includes(名));
      if (命) 命.位置 = [...命.位置, p]; else 表.push({ 站: 名, 位置: [p], 说明: '命令行追加' });
    }
    opts.站 = 表;
  }
  const 结果 = 扫描(o.关键词, opts);
  const 判 = 判据(结果, o.要求, !!o.含史料);
  // 记账在判据之后、输出之前：跑过就得留痕，**判据红也要留**——
  // 「上次跑是什么时候」与「上次跑过没过」是两件事，断更闸问的是前者。
  const 账 = 记账(结果, 判, opts);
  if (o.json) {
    console.log(JSON.stringify({ ...结果, 判据结论: 判, 记账: 账 }, null, 1));
  } else {
    console.log(渲染(结果, 判, o.明细));
    console.log(账.记 ? `已记账：${账.文件.replace(/\\/g, '/')}`
      : `未记账（${账.因}）：${账.文件.replace(/\\/g, '/')}`);
  }
  return 判.通过 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { 扫描, 扫一站, 判据, 站表, 渲染, 解析参数, main, 默认扩展, 退役标记, 注释掩码, 全在注释,
  记账, 台账路径, 台账根 };
