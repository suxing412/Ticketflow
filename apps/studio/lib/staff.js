// staff.js — 职能编制变更（D17 走到底：编制即上限，全局在途上限=在岗人数，非手调参数）。
// 扩编：按 职能-A/B/C… 命名补人（沿用职能默认执行池）。
// 缩编：优先移除空闲者；正持单的标 上线:false（退役待归——干完这张就退场，不粗暴打断）。
const pool = require('./pool');

const LETTERS = 'ABCDEFGHIJ';

function setStaff(root, cfg, 职能, count) {
  if (!(cfg.职能 || []).includes(职能)) return { ok: false, error: `未知职能：${职能}` };
  if (!Number.isInteger(count) || count < 0 || count > 10) return { ok: false, error: '人数须在 0–10' };
  const poolName = pool.poolFor(cfg, 职能);
  const busy = new Set(pool.inFlight(root).map((t) => t.fm.主办).filter(Boolean));
  const others = (cfg.agents || []).filter((a) => a.职能 !== 职能);
  const mine = (cfg.agents || []).filter((a) => a.职能 === 职能).sort((a, b) => a.id.localeCompare(b.id));
  const next = [];
  const 退役 = []; const 移除 = []; const 新增 = [];
  // 前 count 个：在岗（清掉 上线:false）；不够则补新人
  for (let i = 0; i < count; i++) {
    if (mine[i]) { const a = { ...mine[i] }; delete a.上线; next.push(a); }
    else { const id = `${职能}-${LETTERS[i]}`; next.push({ id, 职能, 执行池: poolName }); 新增.push(id); }
  }
  // 超编部分：忙着的标退役待归，空闲的直接移除
  for (let i = count; i < mine.length; i++) {
    const a = { ...mine[i] };
    if (busy.has(a.id)) { a.上线 = false; next.push(a); 退役.push(a.id); }
    else 移除.push(a.id);
  }
  cfg.agents = [...others, ...next];
  return { ok: true, 职能, count, 新增, 退役, 移除, agents: cfg.agents };
}

// 在岗人数（上线 !== false）——全局在途上限的推导值
function onlineCount(cfg) {
  return (cfg.agents || []).filter((a) => a.上线 !== false).length;
}

module.exports = { setStaff, onlineCount };
