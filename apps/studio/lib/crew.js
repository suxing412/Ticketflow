// crew.js — 工程队状态卡（施工令-002 立卡，施工令-041 §五 改直读）
// 原实现读一份手维护的 工程队/状态.json：卡上写什么全看总监记不记得改，巡礼 F8 抓到的正是
// 「卡上还挂着 002，工程队实际已经干到 040」——一份要人记得更新的镜子，迟早照的是昨天。
// 现在直读 工程队/ 目录实况，事实源就是文件本身：
//   · 最新 施工令-NNN-标题.md（序号最大者）→ 施工令号 + 标题
//   · 同号 回执-NNN.md 在 → 完工；不在 → 在做
//   · 更新时间 = 当前判据文件的 mtime（完工看回执，在做看施工令）
// 状态.json 就此作废（读逻辑删除，文件由总监清理）——它已经不是任何东西的事实源了。
//
// 铁律不变（施工令-002）：目录不存在/无权限/没有施工令文件一律静默返回 null。
// 生产部署（监制台装在别处）根本没有这个目录，读不到不能报错也不能渲染半张空卡。
const fs = require('fs');
const path = require('path');

const 默认目录 = 'D:\\GitHub\\Ticketflow\\工程队';
// 兼容期保留：外部若还有人 require 这个常量（旧版打包/脚本），指到目录里的老文件名不至于 undefined
const 默认文件 = path.join(默认目录, '状态.json');

const 令名 = /^施工令-(\d+)(?:-(.*))?\.md$/;
const 回执名 = (n) => `回执-${n}.md`;

const iso = (p) => { try { return fs.statSync(p).mtime.toISOString(); } catch { return ''; } };

// 读工程队卡：返回 {施工令,名称,状态,更新时间} 或 null
// 入参 dir 可覆盖（测试与将来多队场景用）；传的是文件也认——老调用方传 状态.json 路径时
// 退化成读它所在的目录，而不是崩在 readdirSync 上。
function read(dir) {
  try {
    let d = dir || 默认目录;
    try { if (fs.statSync(d).isFile()) d = path.dirname(d); } catch { return null; }
    const 令们 = fs.readdirSync(d).map((n) => {
      const m = 令名.exec(n);
      return m ? { 文件: n, 号: m[1], 序: Number(m[1]), 标题: (m[2] || '').trim() } : null;
    }).filter(Boolean);
    if (!令们.length) return null; // 空目录 / 没有施工令 → 整卡不渲染
    // 序号大者为最新：不用 mtime 排——补写旧令的注释会把一张早已完工的老卡顶到最前面
    const 新 = 令们.sort((a, b) => b.序 - a.序 || String(b.文件).localeCompare(String(a.文件)))[0];
    const 回执 = path.join(d, 回执名(新.号));
    const 完工 = fs.existsSync(回执);
    return {
      施工令: 新.号,
      名称: 新.标题.slice(0, 120),
      状态: 完工 ? '完工' : '在做',
      更新时间: iso(完工 ? 回执 : path.join(d, 新.文件)),
    };
  } catch { return null; } // 不存在/无权限一律静默
}

module.exports = { read, 默认目录, 默认文件 };
