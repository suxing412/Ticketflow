// artifacts.js — 回执产出定位（验收动线：点进工单三秒看到产出在哪）
// 优先吃结构化「## 产出」章节（通用章程 v1.1：策划/美术必写、装配一条入口、程序/QA 免写）；
// 无该章节走 fallback 正则抓路径（旧回执如 TK-24 不用重跑）。
const fs = require('fs');
const path = require('path');

// 像"项目内文件路径"的 token：含 / 且带扩展名；排除 URL 与盘符绝对路径（产出必须相对项目仓）
// 裸路径段不含空格（带空格的路径走反引号通道）；避免把前置中文动词吞进 token
const PATH_RE = /(?<![:\w/.])([\w一-鿿][\w一-鿿.\-]*(?:\/[\w一-鿿][\w一-鿿.\-]*)+\.\w{1,6})(?![\w/])/g;
const looksLikePath = (s) => /\//.test(s) && !/^[a-zA-Z]+:\/\//.test(s) && !/^[a-zA-Z]:[\\/]/.test(s);

function extract(receiptRaw) {
  if (!receiptRaw) return { 来源: null, 路径: [] };
  const secs = receiptRaw.split(/^## /m);
  const out = [];
  const seen = new Set();
  const add = (p) => { const k = p.trim().replace(/\\/g, '/'); if (k && looksLikePath(k) && !seen.has(k)) { seen.add(k); out.push(k); } };
  // 结构化：## 产出 章节逐行（去列表符/反引号/行尾注释）
  const sec = secs.find((s) => s.split('\n')[0].trim() === '产出');
  if (sec) {
    for (const line of sec.split('\n').slice(1)) {
      const t = line.replace(/^[-*·]\s*/, '').replace(/`/g, '').split(/[（(]|——| {2}/)[0].trim();
      if (t && !t.startsWith('#') && !/^（|^\(/.test(t)) add(t);
    }
    if (out.length) return { 来源: '结构化', 路径: out.slice(0, 20) };
  }
  // fallback：全回执抓反引号内与裸写的路径样 token
  for (const m of receiptRaw.matchAll(/`([^`\n]+)`/g)) add(m[1]);
  for (const m of receiptRaw.matchAll(PATH_RE)) add(m[1]);
  return { 来源: out.length ? 'fallback' : null, 路径: out.slice(0, 20) };
}

// 路径解析 + 越界防护（同 stylelib 铁律：越出项目仓 → null）
function resolveIn(root, rel) {
  if (!root || !rel) return null;
  const abs = path.resolve(root, rel);
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) return null;
  return abs;
}

// 详情页数据：抽取 + 落盘核验
function locate(receiptRaw, projRoot) {
  const { 来源, 路径 } = extract(receiptRaw);
  return { 来源, 产出: 路径.map((p) => {
    const abs = resolveIn(projRoot, p);
    let 大小 = null;
    try { 大小 = abs ? fs.statSync(abs).size : null; } catch { /* 不存在 */ }
    return { 路径: p, 存在: 大小 != null, 大小 };
  }) };
}

module.exports = { extract, resolveIn, locate };
