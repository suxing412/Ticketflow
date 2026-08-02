// relay.js — 遥控传令板：制作人（手机端）↔ Claude 制作人层 的双向留言通道
// 明文 jsonl 落盘（透明化）；Claude 侧由会话监视器 tail 该文件唤醒，回帖走同一文件。
// 定位：监制台内的保底指挥通道（官方 Remote Control 之外的第二路）。
const fs = require('fs');
const path = require('path');

const FILE = (root) => path.join(root, '遥控', 'thread.jsonl');

function append(root, from, text) {
  const t = String(text || '').trim();
  if (!t) return { ok: false, error: '空指令不收' };
  if (t.length > 4000) return { ok: false, error: '单条 ≤4000 字' };
  if (!['制作人', 'Claude'].includes(from)) return { ok: false, error: '非法署名' };
  fs.mkdirSync(path.dirname(FILE(root)), { recursive: true });
  const entry = { t: new Date().toISOString(), from, text: t };
  fs.appendFileSync(FILE(root), JSON.stringify(entry) + '\n', 'utf8');
  return { ok: true, entry };
}

function list(root, limit = 100) {
  try {
    const lines = fs.readFileSync(FILE(root), 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

module.exports = { append, list, FILE };
