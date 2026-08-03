// assembler.js — agent 装配器（H49 落地第二步）：拉起 agent 时的背包组装
// 装配件：上游依赖回执摘要 + 坑档案选段 + 协议选段。开销计入该单预算——选段必须节制。
// 选段格式约定（坑档案.md / 协议选段.md 共用）：
//   ## [标签1 标签2 …] 标题
//   正文…
// 命中规则：任一标签 ∈ {工单职能, 产出物类型} 或出现在工单正文中 → 该节入包。
const fs = require('fs');
const path = require('path');

const DEP_CAP = 2200;   // 单份依赖回执截断
const DEP_TOTAL = 6600; // 依赖回执总额
const SEC_CAP = 3000;   // 选段总额

function depIds(t) {
  const d = t.fm && t.fm.依赖;
  if (!d) return [];
  return (Array.isArray(d) ? d.map(String) : String(d).split(/[，,\s]+/)).filter(Boolean);
}

// 依赖回执摘要：优先「产出/验收步骤/做了什么」章节，超长截尾
function depReceipts(root, t) {
  const out = [];
  let total = 0;
  for (const id of depIds(t)) {
    const rp = path.join(root, '回执', `${id}.md`);
    let raw = '';
    try { raw = fs.readFileSync(rp, 'utf8'); } catch { continue; }
    const secs = raw.split(/^## /m);
    const pick = secs.filter((s) => /^(产出|验收步骤|做了什么)/.test(s)).map((s) => '## ' + s.trim()).join('\n');
    let text = (pick || raw).slice(0, DEP_CAP);
    if (total + text.length > DEP_TOTAL) text = text.slice(0, Math.max(0, DEP_TOTAL - total));
    if (!text) break;
    total += text.length;
    out.push(`【依赖 ${id} 的回执摘要】\n${text}`);
  }
  return out.join('\n\n');
}

// 标签化选段：从 md 里挑与本单相关的节
function pickSections(md, tags, bodyText) {
  if (!md) return '';
  const body = String(bodyText || '');
  const parts = md.split(/^## /m).slice(1);
  const hits = [];
  for (const p of parts) {
    const head = p.split('\n')[0];
    const m = head.match(/^\[([^\]]*)\]/);
    if (!m) continue;
    const secTags = m[1].split(/\s+/).filter(Boolean);
    const hit = secTags.some((tg) => tags.includes(tg) || body.includes(tg));
    if (hit) hits.push('## ' + p.trim());
  }
  return hits.join('\n\n').slice(0, SEC_CAP);
}

// 总装：返回可直接拼进提示词的两段（空则返回空串，不占位）
function assemble(root, t) {
  const tags = [t.fm.职能, t.fm.产出物类型].filter(Boolean).map(String);
  const body = t.body || '';
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
  const deps = depReceipts(root, t);
  const pits = pickSections(read('坑档案.md'), tags, body);
  const rules = pickSections(read('协议选段.md'), tags, body);
  const blocks = [];
  if (rules) blocks.push(`=== 相关协议选段（必须遵守）===\n${rules}`);
  if (pits) blocks.push(`=== 坑档案（前人踩过，别再摔）===\n${pits}`);
  if (deps) blocks.push(`=== 上游依赖产出（你在此之上工作）===\n${deps}`);
  return blocks.join('\n\n');
}

module.exports = { assemble, depReceipts, pickSections, depIds };
