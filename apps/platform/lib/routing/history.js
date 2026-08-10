// routing/history.js — Provider 执行结果的只追加历史。
// 任务定义仍由工单负责；这里只记录路由效果，供后续选择更合适的厂商。
const fs = require('fs');
const path = require('path');

const historyPath = (root) => path.join(root, 'journal', 'provider-runs.jsonl');

function append(root, event) {
  try {
    fs.mkdirSync(path.join(root, 'journal'), { recursive: true });
    fs.appendFileSync(historyPath(root), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', 'utf8');
    return true;
  } catch { return false; }
}

function read(root, limit = 300) {
  try {
    const lines = fs.readFileSync(historyPath(root), 'utf8').trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function summary(root, provider, role, limit = 50) {
  const rows = read(root, 500).filter((row) => row.provider === provider && row.role === role && !row.dry).slice(-limit);
  const qualityRows = rows.filter((row) => typeof row.qualityPassed === 'boolean');
  const completed = qualityRows.length ? qualityRows : rows.filter((row) => typeof row.ok === 'boolean');
  if (!completed.length) return { runs: 0, successRate: 50, avgDurationMs: null };
  const success = completed.filter((row) => qualityRows.length ? row.qualityPassed : row.ok).length;
  const durations = completed.map((row) => Number(row.durationMs)).filter((n) => Number.isFinite(n) && n >= 0);
  // 小样本采用带先验的成功率，避免某厂商只成功一次就永久霸榜。
  const successRate = Math.round(((success + 2) / (completed.length + 4)) * 100);
  const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  return { runs: completed.length, successRate, avgDurationMs, basis: qualityRows.length ? 'review' : 'execution' };
}

module.exports = { historyPath, append, read, summary };
