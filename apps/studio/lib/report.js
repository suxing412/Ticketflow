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

// aggregate(root, opts) —— opts.项目 传了就**在取行的源头切一次**，此后所有读数自然同源。
// 案源（2026-08-21 体检）：报表页头写着「监制台 · Ticketflow」，顶栏 8 个读数却是全工作室的；
// 前端注释还自称「明细/分组按项目过滤」，实际只过滤了明细一处——一张卡格里两种尺并排。
// 为什么切在源头而不是让前端各自过滤：**过滤只许有一把尺**。前端复算一遍，
// 迟早出现「顶栏说 140 完成、分组加起来 12」这种没人说得清谁对的局面。
// opts.项目 为空即全工作室（单项目部署/未选项目时本来就该是全量）。
function aggregate(root, opts = {}) {
  const 项目 = String((opts && opts.项目) || '').trim();
  const 默认项目 = String((opts && opts.默认项目) || '').trim();
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
  // 源头切一次：此后 总览/按职能/按池/每日/明细 全部同源，页面上不会再出现两把尺。
  // 归属口径与 projOf 一致：无章的单归项目默认（老账兼容，不静默丢）。
  // **不原地改 rows**：首版写成 `rows.length=0; rows.push(...全行)`，而不传项目时
  // 全行 === rows 本身，清空即把源数据一起清了，全局读数当场归零（自测当场打红）。
  const 本账 = 项目 ? rows.filter((r) => (r.项目 || 默认项目) === 项目) : rows.slice();
  const worked = 本账.filter((r) => r.实际h != null);
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
    项目: 项目 || null, // 页面据它如实标注这份数是谁的——不标就会被当成全工作室
    总览: {
      总单数: 本账.length, 完成: 本账.filter((r) => r.state === '完成').length,
      已归档: 本账.filter((r) => r.state === '已归档').length,
      实际h合计: Math.round(sum(worked, (x) => x.实际h) * 10) / 10,
      预估偏差pct: 偏差, // 100=踩点，>100=实际超预计
      自修总轮: sum(本账, (x) => x.自修次数),
      代核通过: 本账.filter((r) => r.代核 === '通过').length, 代核不过: 本账.filter((r) => r.代核 === '不过').length,
      代裁给方向: 本账.filter((r) => r.代裁 === '给方向').length, 代裁上呈: 本账.filter((r) => r.代裁 === '上呈').length,
      token估计合计: sum(本账, (x) => x.token估计),
    },
    按职能: group(worked, '职能'), 按主办: group(worked.filter((r) => r.主办), '主办'),
    按池: group(worked.filter((r) => r.执行池), '执行池'), 按项目: group(worked, '项目'),
    每日: days,
    明细: 本账.filter((r) => r.实际h != null || r.state === '完成' || r.state === '已归档')
      .sort((a, b) => String(b.交付日 || '').localeCompare(String(a.交付日 || ''))).slice(0, 100),
    // 明细被上限截过没有——页面据它如实说明「更早的未取」。
    // 静默截断读起来跟「一共就这些」一模一样，那正是本次体检要治的那类。
    明细满: 本账.filter((r) => r.实际h != null || r.state === '完成' || r.state === '已归档').length > 100,
  };
}

module.exports = { aggregate, parseReceipt };
