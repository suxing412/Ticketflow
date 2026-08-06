// crew.js — 工程队状态卡（施工令-002）：监制台只读一份外部状态文件，队侧由总监维护。
// 铁律：文件不存在/损坏/结构不对一律静默返回 null——生产部署下没有这个文件，不能报错也不能渲染。
const fs = require('fs');

const 默认文件 = 'D:\\GitHub\\Ticketflow\\工程队\\状态.json';

// 读状态卡：返回 {施工令,名称,状态,更新时间} 或 null
function read(file) {
  try {
    const raw = fs.readFileSync(file || 默认文件, 'utf8');
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const pick = (k) => (v[k] == null ? '' : String(v[k]).slice(0, 120));
    const card = { 施工令: pick('施工令'), 名称: pick('名称'), 状态: pick('状态'), 更新时间: pick('更新时间') };
    if (!card.施工令 && !card.名称 && !card.状态) return null; // 空壳不渲染
    return card;
  } catch { return null; } // 不存在/无权限/坏 JSON 一律静默
}

module.exports = { read, 默认文件 };
