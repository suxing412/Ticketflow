// 回执路径.js — 把回执里的裸相对路径解析成真实文件（议程第 40 条，2026-08-28）
//
// **议程原条目的诊断是错的**，先记这个：原文写「Docs/ 产出不入版本，回执引用的文件事后查无」。
// 实测：`D:/GitHub/TK/Docs` 有 126 个文件在 git 里，被点名「查无」的两份都在。
// 真相是回执写的是**相对各自项目根**的路径（`Docs/SLG/…` 相对 TK 仓、`apps/studio/…` 相对 Ticketflow 仓），
// 而查的人站在监制台目录下找，当然找不到。
// **问题不是「不入版本」，是「路径没说清相对谁」**——两者的修法完全不同：
// 前者要改 .gitignore，后者要在读的时候补上仓根。
//
// 存量 1382 处裸相对路径不改写（回执是 append-only 的事实记录，事后批量改写它比问题本身更坏）。
// 改成读的时候能解析：回执 fm 里本来就有 项目 字段，拿它去注册表取仓根即可。
const fs = require('fs');
const path = require('path');

// 看着像路径的片段：Docs/… apps/… lib/… tools/… Assets/… test/… public/… packages/…
// 只认这几个根，不做通用匹配——「a/b」这种两个字母的东西满篇都是，通用匹配会把散文切碎。
// 前置边界用**否定式**而不是白名单：回执里的分隔符五花八门（空格、反引号、全角冒号「：」、
// 箭头「→」、括号、行首…），白名单必漏。实测第一版只列了 ` \`（(【`，
// 「产出：Docs/x.md」里的全角冒号就没在列，整条摘不出来——**白名单式边界是漏检的常见来源**。
// 否定式只要求「前一个字符不是路径字符」，于是 `xDocs/` 和 `a/Docs/` 仍不会误命中。
const 路径头 = /(?:^|[^A-Za-z0-9_./\\-])((?:Docs|Assets|apps|lib|tools|test|tests|public|packages|scripts|intel|server|config)\/[^\s`)）】,，、"'；;]{1,120})/g;

// 从回执正文里摘出所有裸相对路径
function 摘路径(正文) {
  const 出 = new Set();
  let m;
  路径头.lastIndex = 0;
  while ((m = 路径头.exec(String(正文 || '')))) {
    // 去掉尾随的标点与 markdown 残留
    const p = m[1].replace(/[`*）)】,，。、；;]+$/, '').trim();
    // 通配符不是文件（`Docs/**`、`Docs/*.md` 这类是在说范围，不是在指某个文件）
    if (/[*?]/.test(p)) continue;
    if (p.length > 2) 出.add(p);
  }
  return [...出];
}

// 仓根：项目名 → 路径。取不到就回 null（**不猜**：猜错会把「查无」变成「指向别人家的同名文件」，更坏）
function 仓根(cfg, 项目) {
  const reg = (cfg && cfg.项目 && cfg.项目.注册) || {};
  const name = String(项目 || (cfg && cfg.项目 && cfg.项目.默认) || '').trim();
  const r = reg[name];
  return (r && r.路径) ? String(r.路径) : null;
}

// 解析一份回执：{ 项目, 正文 } → [{ 相对, 绝对, 在: bool }]
// 在=false 不是错误，可能是产物后来被改名/删除——它只是如实报告，由调用方决定怎么看。
function 解析(cfg, { 项目, 正文, root = null } = {}) {
  const 根 = 仓根(cfg, 项目);
  return 摘路径(正文).map((rel) => {
    if (!根) return { 相对: rel, 绝对: null, 在: null, 因: `项目「${项目 || '（空）'}」不在注册表，定位不了仓根` };
    const abs = path.resolve(根, rel);
    // 越界防护：解析出来的绝对路径必须仍在仓内。`../../` 这种能把路径指到仓外，
    // 一个「验证产物存在」的功能不该变成任意路径探测器。
    if (!abs.toLowerCase().startsWith(path.resolve(根).toLowerCase())) {
      return { 相对: rel, 绝对: null, 在: null, 因: '解析后越出仓根，拒绝' };
    }
    let 在 = false;
    try { 在 = fs.existsSync(abs); } catch { 在 = false; }
    return { 相对: rel, 绝对: abs, 在 };
  });
}

// 体检：一份回执里有多少产物路径查无。给巡检/收口用。
function 体检(cfg, { 项目, 正文 }) {
  const 全 = 解析(cfg, { 项目, 正文 });
  const 查无 = 全.filter((x) => x.在 === false);
  const 定位不了 = 全.filter((x) => x.在 === null);
  return { 总: 全.length, 在: 全.filter((x) => x.在 === true).length, 查无, 定位不了 };
}

module.exports = { 摘路径, 仓根, 解析, 体检, 路径头 };
