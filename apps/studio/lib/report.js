// report.js — 消耗报表（停车场老待办，2026-07-30 落地）：从明文事实源聚合生产消耗。
// 数据源三路：工单 frontmatter（领单/交付时间、预计时间、自修次数、代核/代裁戳）、
// 回执 实际消耗 章节（agent 自报，token 数 best-effort 解析）、journal 行（每日吞吐）。
// 只读聚合，不写任何东西。
const fs = require('fs');
const path = require('path');
const store = require('./core/store');

function hoursOf(est) { const n = parseFloat(est); return Number.isFinite(n) ? n : null; }

// 回执解析：实际消耗章节文本 + token 数（"1234 token"/"1,234 tokens"）+ 判官章节存在性
function parseReceipt(root, id) {
  try {
    const raw = fs.readFileSync(path.join(root, '回执', `${id}.md`), 'utf8');
    const sec = (name) => {
      const m = raw.split(/^## /m).find((s) => s.startsWith(name));
      return m ? m.slice(name.length).trim().split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 120) : null;
    };
    const tok = [...raw.matchAll(/([\d,]+)\s*tokens?/gi)].map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => Number.isFinite(n));
    return { 实际消耗: sec('实际消耗'), token估计: tok.length ? Math.max(...tok) : null, 代核报告: /^## 委托代核/m.test(raw), 代裁报告: /^## 委托代裁/m.test(raw) };
  } catch { return { 实际消耗: null, token估计: null, 代核报告: false, 代裁报告: false }; }
}

function aggregate(root) {
  const rows = [];
  for (const s of store.STATES) {
    for (const t of store.list(root, s)) {
      const fm = t.fm;
      const has = fm.领单时间 && fm.交付时间;
      const durH = has ? Math.max(0, (Date.parse(fm.交付时间) - Date.parse(fm.领单时间)) / 3600000) : null;
      rows.push({
        id: t.id, state: s, 职能: fm.职能 || '—', 项目: fm.项目 || '', 主办: fm.主办 || null,
        执行池: fm.执行池 || null, 阶段: fm.阶段 || null,
        预计h: hoursOf(fm.预计时间), 实际h: durH != null ? Math.round(durH * 100) / 100 : null,
        自修次数: Number(fm.自修次数) || 0,
        代核: fm.代核 ? fm.代核.结论 : null, 代裁: fm.代裁 ? fm.代裁.结论 : null,
        交付日: fm.交付时间 ? String(fm.交付时间).slice(0, 10) : null,
        ...parseReceipt(root, t.id),
      });
    }
  }
  const worked = rows.filter((r) => r.实际h != null);
  const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
  const group = (arr, key) => {
    const g = {};
    for (const r of arr) { const k = r[key] || '—'; (g[k] = g[k] || []).push(r); }
    return Object.entries(g).map(([k, items]) => ({
      名: k, 单数: items.length, 实际h合计: Math.round(sum(items, (x) => x.实际h) * 10) / 10,
      平均h: items.length ? Math.round(sum(items, (x) => x.实际h) / items.length * 100) / 100 : 0,
      自修合计: sum(items, (x) => x.自修次数),
    })).sort((a, b) => b.实际h合计 - a.实际h合计);
  };
  // 预估准确度：有预计也有实际的单
  const est = worked.filter((r) => r.预计h != null);
  const 偏差 = est.length ? Math.round((sum(est, (x) => x.实际h) / Math.max(0.01, sum(est, (x) => x.预计h))) * 100) : null;
  // 每日吞吐（按交付日）
  const byDay = {};
  for (const r of worked) if (r.交付日) { byDay[r.交付日] = byDay[r.交付日] || { 交付: 0, 实际h: 0 }; byDay[r.交付日].交付++; byDay[r.交付日].实际h += r.实际h; }
  const days = Object.entries(byDay).map(([d, v]) => ({ 日: d, 交付: v.交付, 实际h: Math.round(v.实际h * 10) / 10 })).sort((a, b) => a.日.localeCompare(b.日)).slice(-14);
  return {
    总览: {
      总单数: rows.length, 完成: rows.filter((r) => r.state === '完成').length,
      已归档: rows.filter((r) => r.state === '已归档').length,
      实际h合计: Math.round(sum(worked, (x) => x.实际h) * 10) / 10,
      预估偏差pct: 偏差, // 100=踩点，>100=实际超预计
      自修总轮: sum(rows, (x) => x.自修次数),
      代核通过: rows.filter((r) => r.代核 === '通过').length, 代核不过: rows.filter((r) => r.代核 === '不过').length,
      代裁给方向: rows.filter((r) => r.代裁 === '给方向').length, 代裁上呈: rows.filter((r) => r.代裁 === '上呈').length,
      token估计合计: sum(rows, (x) => x.token估计),
    },
    按职能: group(worked, '职能'), 按主办: group(worked.filter((r) => r.主办), '主办'),
    按池: group(worked.filter((r) => r.执行池), '执行池'), 按项目: group(worked, '项目'),
    每日: days,
    明细: rows.filter((r) => r.实际h != null || r.state === '完成' || r.state === '已归档')
      .sort((a, b) => String(b.交付日 || '').localeCompare(String(a.交付日 || ''))).slice(0, 100),
  };
}

module.exports = { aggregate, parseReceipt };
