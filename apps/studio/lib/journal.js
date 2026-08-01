// journal.js — 变更流水（只追加，永不修改历史）
const fs = require('fs');
const path = require('path');

function stamp(now) {
  const d = now || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 追加一行到 journal/<YYYY-MM>.log
function append(root, text, now) {
  const dir = path.join(root, 'journal');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const d = now || new Date();
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  fs.appendFileSync(path.join(dir, `${month}.log`), `[${stamp(d)}] ${text}\n`, 'utf8');
}

// 把一次保存的变更集合并成一条摘要（PRD 2.5）
function saveSummary(changes) {
  const parts = changes.map((c) => {
    if (c.type === 'create') return `${c.id} 新建${c.parent ? `（parent: ${c.parent}）` : ''}`;
    const fields = Object.entries(c.diff || {})
      .map(([k, [oldV, newV]]) => `${k} ${oldV ?? '空'}→${newV ?? '空'}`).join('、');
    const parts2 = [fields, c.bodyChanged ? '正文修改' : ''].filter(Boolean).join('、');
    return `${c.id} ${parts2 || '无实质变更'}`;
  });
  return `保存：${parts.join('；')}`;
}

// 读取最新月份日志（agent 补课用）
function readLatest(root) {
  const dir = path.join(root, 'journal');
  if (!fs.existsSync(dir)) return { month: null, lines: [] };
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.log$/.test(f)).sort();
  if (!files.length) return { month: null, lines: [] };
  const latest = files[files.length - 1];
  const lines = fs.readFileSync(path.join(dir, latest), 'utf8').split('\n').filter(Boolean);
  return { month: latest.replace('.log', ''), lines };
}

module.exports = { append, saveSummary, readLatest };
