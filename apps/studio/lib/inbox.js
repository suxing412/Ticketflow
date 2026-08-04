// 呼叫信箱（0.21，用户拍板「所有监视器统一为一个嵌入监制台」）：
// 需要制作人层（Claude/用户）介入或知晓的事件，全部结构化落此信箱——
// 会话侧只需一条监视器 tail 本文件，每行都是呼叫（不再用正则猜日志措辞，漏报机制性绝根）。
// journal 仍是人读流水；信箱是机器信道。级别：急=需要行动，常=知会即可。
const fs = require('fs');
const path = require('path');

const FILE = (root) => path.join(root, '呼叫', 'inbox.jsonl');

function post(root, 级别, 类型, 摘要, extra) {
  try {
    fs.mkdirSync(path.dirname(FILE(root)), { recursive: true });
    const entry = { t: new Date().toISOString(), 级别, 类型, 摘要: String(摘要).slice(0, 300), ...(extra || {}) };
    fs.appendFileSync(FILE(root), JSON.stringify(entry) + '\n', 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function list(root, limit) {
  try {
    const lines = fs.readFileSync(FILE(root), 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-(limit || 100)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// 已读水位（游标制，不改写历史行——append-only 纪律）
const CURSOR = (root) => path.join(root, '呼叫', 'cursor.json');
function unread(root) {
  let at = '';
  try { at = JSON.parse(fs.readFileSync(CURSOR(root), 'utf8')).at || ''; } catch { /* 从头 */ }
  return list(root, 500).filter((e) => e.t > at);
}
function markRead(root) {
  fs.mkdirSync(path.dirname(CURSOR(root)), { recursive: true });
  fs.writeFileSync(CURSOR(root), JSON.stringify({ at: new Date().toISOString() }), 'utf8');
  return { ok: true };
}

module.exports = { FILE, post, list, unread, markRead };
