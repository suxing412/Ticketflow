// artifacts.js — 回执产出定位（验收动线：点进工单三秒看到产出在哪）
// 优先吃结构化「## 产出」章节（通用章程 v1.1：策划/美术必写、装配一条入口、程序/QA 免写）；
// 无该章节走 fallback 正则抓路径（旧回执如 TK-24 不用重跑）。
//
// 施工令-051（案源 TK-160/TK-156 满屏假红）：判据从「含斜杠」收紧到「像仓内文件」。
// 旧判据只问一句「有没有 /」，于是 Unity 菜单路径 `Tools/TK/汉代地图/手修编辑器`、
// 度量串 `2.21/2.46 km`、`0.00/0.00 km` 全被当成交付文件拿去磁盘找，找不到就扣红「缺失」——
// 假红一多，真缺失反而没人信。新判据：含目录分隔 **且** 带扩展名，或磁盘实测存在。
const fs = require('fs');
const path = require('path');

// 像"项目内文件路径"的 token：含 / 且带扩展名；排除 URL 与盘符绝对路径（产出必须相对项目仓）
// 裸路径段不含空格（带空格的路径走反引号通道）；避免把前置中文动词吞进 token
const PATH_RE = /(?<![:\w/.])([\w一-鿿][\w一-鿿.\-]*(?:\/[\w一-鿿][\w一-鿿.\-]*)+\.\w{1,6})(?![\w/])/g;

// 扩展名须以字母打头：挡住 `Docs/方案v1.2`、`进度/3.7` 这类拿版本号/小数冒充扩展名的串
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,5}$/;
const URL_RE = /^[a-zA-Z][\w+.-]*:\/\//;
const DRIVE_RE = /^[a-zA-Z]:[\\/]/;
// 数字/单位串：回执正文里的度量天然带斜杠（「2.21/2.46 km」＝实测/目标），最像路径也最不是路径
const UNIT = '(?:km|m|cm|mm|kg|ms|s|h|min|%|MB|KB|GB|TB|fps|px|万|次|秒|分|分钟|小时|个|倍|条|张|轮)';
const NUM_RE = new RegExp(`^\\d+(?:[.,]\\d+)?(?:\\s*[/／]\\s*\\d+(?:[.,]\\d+)?)*\\s*${UNIT}?$`, 'i');
// 编辑器菜单路径：说的是「从哪打开」，不是「交了什么」。带扩展名的（Assets/Create/x.asset）不在此列
const MENU_RE = /^(?:Tools|SLG|Window|GameObject|Component|Assets\/Create|Edit|Help)\//;

// 过形闸（TF-7，案源 TK-203）：**带合法扩展名 ≠ 指向某个具体文件**。
// H97 引擎门禁要求验收标准写成「谁跑哪条命令、回执里贴哪几个数字」，回执因此普遍引用命令产物的
// 通配与占位路径：`Assets/**/*.unity` 说的是一族文件，`enginectl-baselines/results-….xml` 说的是
// 一个省略了时间戳的样例。两者都过得了 051 的四道噪声闸、被 EXT_RE 判成真路径，随即 statSync 必然
// 扑空、扣红「缺失」。红色是「回执声称交了、仓里却没有」的专用信号——声称本身就不是一个具体文件时，
// 它没有资格出现。故在扩展名放行与磁盘实测**之前**先问一句「这串指得出唯一一个文件吗」。
const GLOB_RE = /[*?[\]{}]/;                                            // 通配元字符
const PLACEHOLDER_RE = /…|\.{3}|<[^<>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%s/; // 省略号／尖括号／${}／{{}}／%s 占位

// 路径解析 + 越界防护（同 stylelib 铁律：越出项目仓 → null）
function resolveIn(root, rel) {
  if (!root || !rel) return null;
  const abs = path.resolve(root, rel);
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) return null;
  return abs;
}

// 候选串够不够格当产出物。projRoot 可缺省（纯解析场景）——缺省时只剩「带扩展名」这一条路
function isArtifactPath(s, projRoot) {
  const k = String(s == null ? '' : s).trim().replace(/\\/g, '/');
  if (!k || !k.includes('/')) return false;
  if (URL_RE.test(k) || DRIVE_RE.test(k)) return false;
  if (NUM_RE.test(k)) return false;
  if (MENU_RE.test(k) && !EXT_RE.test(k)) return false;
  // 过形闸必须压在 EXT_RE 放行与 resolveIn/statSync 之前：既省无谓磁盘 IO，
  // 也不让 `Assets/**/*.unity` 这种串被当相对路径去解析
  if (GLOB_RE.test(k) || PLACEHOLDER_RE.test(k)) return false;
  if (EXT_RE.test(k)) return true;
  // 无扩展名：只有磁盘实测存在才认（LICENSE、Dockerfile、无后缀脚本这类真交付物）
  const abs = resolveIn(projRoot, k);
  if (!abs) return false;
  try { fs.statSync(abs); return true; } catch { return false; }
}

function extract(receiptRaw, projRoot) {
  if (!receiptRaw) return { 来源: null, 路径: [] };
  const secs = receiptRaw.split(/^## /m);
  const out = [];
  const seen = new Set();
  const add = (p) => { const k = p.trim().replace(/\\/g, '/'); if (k && isArtifactPath(k, projRoot) && !seen.has(k)) { seen.add(k); out.push(k); } };
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

// 详情页数据：抽取 + 落盘核验
function locate(receiptRaw, projRoot) {
  const { 来源, 路径 } = extract(receiptRaw, projRoot);
  return { 来源, 产出: 路径.map((p) => {
    const abs = resolveIn(projRoot, p);
    let 大小 = null;
    try { 大小 = abs ? fs.statSync(abs).size : null; } catch { /* 不存在 */ }
    return { 路径: p, 存在: 大小 != null, 大小 };
  }) };
}

module.exports = { extract, resolveIn, locate, isArtifactPath };
