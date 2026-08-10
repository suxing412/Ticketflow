#!/usr/bin/env node
// scripts/migrate-schedule.js — 排程台账首次迁移（施工令-040 第 7 条）
//
// 干的事：把两份**已经存在于文档里**的队列，一次性搬进排程台账，从此「接下来要做什么」
// 是系统数据而不是会话记忆。两个源：
//   ① 汉代地图修缮总清单.md §3 批次表 —— 批0/A/B（已在途/完成，生成终态并回填已知单号）
//                                       批C 五幅面单 / 批D 两项 / 批E 一项（生成计划粒）
//   ② 点名巡礼报告 §六 Q1-Qn 队列     —— 后续待办队列
//
// 三条纪律：
//   · 幂等：判重键 = 来源 + 题（见 lib/pm/schedule.判重键）。重跑只会打印「跳过 N」，不会造双份。
//     来源写到**准确章节**（… §3 批C / … §六 Q3）——不是为了好看，是因为它是身份的一半。
//   · 解析零命中即失败退出（code 2），绝不"成功地写进去 0 条"。文档结构变了要当场炸，
//     不能让制作人以为迁完了、面板上却空空如也。
//   · --dry 先看后写：解析结果全打出来，一个字节都不落盘。
//
// 用法：
//   node scripts/migrate-schedule.js --dry
//   node scripts/migrate-schedule.js --root D:/…/监制台 --清单 <总清单.md> --巡礼 <巡礼报告.md>
const fs = require('fs');
const path = require('path');
const schedule = require('../lib/pm/schedule');

const 默认清单 = 'D:/GitHub/TK/Docs/SLG/调研方案/汉代地图修缮总清单.md';
const 默认巡礼 = '白夜馆/2026-08-11-点名巡礼-排程可见性.md'; // 相对 root 解析

// ---- 通用：章节切片 ----
// 按标题层级切：命中标题行起，到**同级或更高级**的下一个标题为止。
// 不用"到下一个 ## 为止"这种写死层级的切法——文档里 §3 是 ## 还是 ### 由作者定，写死必漏。
function 章节(md, 标题正则) {
  const lines = String(md || '').split(/\r?\n/);
  let 起 = -1; let 级 = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s*(.+?)\s*$/);
    if (!m) continue;
    if (起 < 0) { if (标题正则.test(m[2])) { 起 = i + 1; 级 = m[1].length; } continue; }
    if (m[1].length <= 级) return lines.slice(起, i).join('\n');
  }
  return 起 < 0 ? null : lines.slice(起).join('\n');
}

// 文档状态词 → 粒状态。看不出来的一律「计划」（宁可少标终态，也不要把没做的活标成做完了）。
function 判状态(s) {
  const t = String(s || '');
  if (/撤销|作废|取消|放弃/.test(t)) return '撤销';
  if (/完成|已完工|落袋|已验收|✅|√/.test(t)) return '完成';
  if (/在途|进行中|已派|派发|执行中|已成单|待验收|质检/.test(t)) return '已成单';
  if (/起草|草稿|待审/.test(t)) return '起草中';
  return '计划';
}
const 抓单号 = (s) => { const m = String(s || '').match(/\b(TK-\d+)\b/i); return m ? m[1].toUpperCase() : null; };
// 表头别名：同一列在两份文档里叫法不同是常态，认语义不认字面
const 列名 = {
  批: /^(批|批次)$/, 序: /^(序|序号|次序|#|No\.?)$/i, 题: /^(题|标题|名称|项|条目|内容|工作项|面单)$/,
  管线: /^(管线|线|归属管线)$/, 状态: /^(状态|进度|态)$/, 单号: /^(单号|工单|工单号|已成单)$/,
  预估单元: /^(预估单元|单元|预估|工作量)$/, 池衡建议: /^(池衡建议|池衡|建议池|池)$/,
};
function 认列(表头) {
  const idx = {};
  表头.forEach((h, i) => { for (const [k, re] of Object.entries(列名)) if (idx[k] == null && re.test(h.replace(/\s/g, ''))) idx[k] = i; });
  return idx;
}
const 净 = (s) => String(s || '').replace(/^\**|\**$/g, '').replace(/`/g, '').trim();

// ---- ① 总清单 §3 批次表 ----
// 两种写法都吃：markdown 表格（有表头行 + 分隔行）与「### 批C」小节下的编号/无序列表。
// 现网文档是哪种由作者定，解析器多认一种的成本远低于「跑一半发现格式不对」的成本。
function 解析清单(md, { 文件名 = '汉代地图修缮总清单.md' } = {}) {
  const sec = 章节(md, /(^|[^0-9])3[.、．\s)]|批次/) ;
  if (sec == null) return { 粒: [], 报: ['未找到 §3 批次章节'] };
  const 报 = []; const 粒 = [];
  let 当前批 = null;
  let 表头 = null; let idx = null;
  const 序计数 = {};
  for (const raw of sec.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s*(.+)$/);
    if (h) { const b = 净(h[1]).match(/批\s*([0-9A-Za-z一二三四五六七八九十]+)/); if (b) { 当前批 = '批' + b[1]; 表头 = null; idx = null; } continue; }
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(净);
      if (/^[-: ]+$/.test(cells.join(''))) continue;             // 表格分隔行
      if (!表头) { 表头 = cells; idx = 认列(cells); if (idx.题 != null) continue; 表头 = null; idx = null; } // 认不出题列 = 不是数据表
      if (!idx) continue;
      const g = 行成粒(cells, idx, 当前批, 文件名, 序计数);
      if (g) 粒.push(g);
      continue;
    }
    const li = line.match(/^(?:[-*+]|\d+[.、)])\s+(.*)$/);
    if (li && 当前批) {
      const g = 列表成粒(净(li[1]), 当前批, 文件名, 序计数);
      if (g) 粒.push(g);
    }
  }
  报.push(`§3 批次表：解析 ${粒.length} 项（批：${[...new Set(粒.map((g) => g.批))].join('、') || '无'}）`);
  return { 粒, 报 };
}

function 行成粒(cells, idx, 当前批, 文件名, 序计数) {
  const 题 = 净(cells[idx.题] || '');
  if (!题 || /^(题|标题|名称|合计|小计)$/.test(题)) return null;
  const 批 = 净(idx.批 != null ? cells[idx.批] : '') || 当前批;
  if (!批) return null;
  const b = String(批).match(/批\s*([0-9A-Za-z一二三四五六七八九十]+)/);
  const 批名 = b ? '批' + b[1] : String(批);
  序计数[批名] = (序计数[批名] || 0) + 1;
  const 序文 = idx.序 != null ? 净(cells[idx.序]) : '';
  const 状态文 = idx.状态 != null ? 净(cells[idx.状态]) : '';
  const 单号 = (idx.单号 != null ? 抓单号(cells[idx.单号]) : null) || 抓单号(cells.join(' '));
  let 状态 = 判状态(状态文 || (单号 ? '在途' : ''));
  if (['已成单', '完成'].includes(状态) && !单号) 状态 = '计划'; // 无单号的终态落不了盘（校验会拒），按计划收
  const 单元 = idx.预估单元 != null ? parseFloat(净(cells[idx.预估单元])) : NaN;
  return {
    批: 批名,
    序: /^\d+$/.test(序文) ? Number(序文) : 序计数[批名],
    题, 管线: idx.管线 != null ? 净(cells[idx.管线]) || null : null,
    状态, 单号,
    池衡建议: idx.池衡建议 != null ? 净(cells[idx.池衡建议]) || null : null,
    预估单元: Number.isFinite(单元) ? 单元 : null,
    来源: `${文件名} §3 ${批名}`,
  };
}

function 列表成粒(文, 当前批, 文件名, 序计数) {
  const 题原 = 文.replace(/\s*[（(][^（()）]*[)）]\s*$/, '').trim(); // 尾括号注（状态/单号）不进题
  const 题 = 题原.replace(/^\s*(?:批[0-9A-Za-z]+[-—]?\d*|\d+)[.、:：]?\s*/, '').trim();
  if (!题) return null;
  序计数[当前批] = (序计数[当前批] || 0) + 1;
  const 单号 = 抓单号(文);
  let 状态 = 判状态(文);
  if (['已成单', '完成'].includes(状态) && !单号) 状态 = '计划';
  return { 批: 当前批, 序: 序计数[当前批], 题, 管线: null, 状态, 单号, 池衡建议: null, 预估单元: null, 来源: `${文件名} §3 ${当前批}` };
}

// ---- ② 巡礼报告 §六 Q 队列 ----
function 解析巡礼(md, { 文件名 = '巡礼报告.md' } = {}) {
  const sec = 章节(md, /^六[、.．\s)]|^6[、.．\s)].*队列|后续队列/);
  if (sec == null) return { 粒: [], 报: ['未找到 §六 队列章节'] };
  const 粒 = [];
  for (const raw of sec.split(/\r?\n/)) {
    const line = raw.trim();
    // Q 行的三种常见写法：「Q1 题」「- **Q1**：题」「| Q1 | 题 | … |」
    const m = line.replace(/^\|/, '').match(/^(?:[-*+]|\d+[.、)])?\s*\**\s*(Q(\d+))\s*\**\s*[：:.、)|\s]\s*(.+)$/);
    if (!m) continue;
    const 尾 = m[3].split('|').map(净).filter(Boolean);
    const 题 = (尾[0] || '').replace(/\s*[（(][^（()）]*[)）]\s*$/, '').trim();
    if (!题) continue;
    const 全 = line;
    const 单号 = 抓单号(全);
    let 状态 = 判状态(全);
    if (['已成单', '完成'].includes(状态) && !单号) 状态 = '计划';
    粒.push({
      批: 'Q队列', 序: Number(m[2]), 题, 管线: null, 状态, 单号,
      池衡建议: null, 预估单元: null, 来源: `${文件名} §六 ${m[1]}`,
    });
  }
  return { 粒, 报: [`§六 队列：解析 ${粒.length} 项（${粒.map((g) => `Q${g.序}`).join('、') || '无'}）`] };
}

// ---- 迁移主流程 ----
function 迁移(root, { 清单文本, 清单名, 巡礼文本, 巡礼名, 操作者 = '总监', dry = false } = {}) {
  const 报 = []; let 粒 = [];
  if (清单文本 != null) { const r = 解析清单(清单文本, { 文件名: 清单名 }); 粒 = 粒.concat(r.粒); 报.push(...r.报); }
  if (巡礼文本 != null) { const r = 解析巡礼(巡礼文本, { 文件名: 巡礼名 }); 粒 = 粒.concat(r.粒); 报.push(...r.报); }
  const 终态回填 = 粒.filter((g) => ['已成单', '完成'].includes(g.状态));
  if (!粒.length) return { ok: false, error: '解析到 0 条计划粒——文档结构与解析口径不符（核对 §3 批次表 / §六 队列的标题与列名），或路径指错了', 报 };
  if (dry) return { ok: true, dry: true, 粒, 报, 终态回填: 终态回填.length };
  const r = schedule.登记(root, 粒, 操作者);
  if (!r.ok) return { ok: false, error: r.error, 报 };
  return {
    ok: true, 报,
    新增: r.新增, 跳过: r.跳过,
    终态回填: r.新增.filter((g) => ['已成单', '完成'].includes(g.状态)).map((g) => `${g.题}→${g.单号}`),
  };
}

// ---- CLI ----
function 读参(argv) {
  const o = { dry: false, 操作者: '总监' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') o.dry = true;
    else if (a === '--root') o.root = argv[++i];
    else if (a === '--清单') o.清单 = argv[++i];
    else if (a === '--巡礼') o.巡礼 = argv[++i];
    else if (a === '--操作者') o.操作者 = argv[++i];
  }
  return o;
}

function main(argv) {
  const o = 读参(argv);
  const root = o.root || require('../lib/core/config').resolveRoot();
  if (!root) { console.error('找不到监制台仓库（缺 studio.config.json）——用 --root 指定'); return 2; }
  const 清单路径 = o.清单 || 默认清单;
  const 巡礼路径 = o.巡礼 ? o.巡礼 : path.join(root, 默认巡礼);
  const 读 = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { console.error(`读不到 ${p}：${e.code || e.message}`); return null; } };
  const 清单文本 = 读(清单路径); const 巡礼文本 = 读(巡礼路径);
  if (清单文本 == null && 巡礼文本 == null) return 2;
  const r = 迁移(root, {
    清单文本, 清单名: path.basename(清单路径),
    巡礼文本, 巡礼名: path.basename(巡礼路径),
    操作者: o.操作者, dry: o.dry,
  });
  for (const l of r.报) console.log('  · ' + l);
  if (!r.ok) { console.error('迁移失败：' + r.error); return 2; }
  if (r.dry) {
    console.log(`\n[--dry] 解析 ${r.粒.length} 粒（终态 ${r.终态回填} 粒），未写盘：`);
    for (const g of r.粒) console.log(`   ${g.批} #${g.序} ${g.状态.padEnd(3, '　')} ${g.单号 ? `[${g.单号}] ` : ''}${g.题}  ←${g.来源}`);
    return 0;
  }
  console.log(`\n迁移完成：新增 ${r.新增.length} 粒 · 判重跳过 ${r.跳过.length} 粒 · 终态回填 ${r.终态回填.length} 个单号`);
  for (const g of r.新增) console.log(`   + ${g.批} #${g.序} ${g.状态} ${g.单号 ? `[${g.单号}] ` : ''}${g.题}`);
  for (const s of r.跳过) console.log(`   = 跳过（已在账）${s.题}  ←${s.来源}`);
  console.log(`账本：${schedule.LOG(root)}`);
  return 0;
}

module.exports = { 章节, 解析清单, 解析巡礼, 迁移, 判状态, main };
if (require.main === module) process.exit(main(process.argv.slice(2)));
