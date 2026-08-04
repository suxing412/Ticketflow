// pm/ledger.js — 项目管理台账（H49）：职位常驻 = 台账常驻 + 事件唤醒
// 全明文落盘（透明化）：就绪队列 / 在跑 / 事件流水 / 按父单成本归集。
// 台账是唯一事实源；崩溃重启读盘续班。写入原子（temp+rename）。
const fs = require('fs');
const path = require('path');

const DIR = (root) => path.join(root, '项管台账');
const STATE = (root) => path.join(DIR(root), '台账.json');
const EVENTS = (root) => path.join(DIR(root), '事件.jsonl');

const DEFAULT = () => ({
  就绪队列: [],       // [{id, 优先级, 红链, 入列时间}]（依赖就绪、等槽位/额度）
  在跑: {},           // id → {拉起时间, 池, 模型}
  父单成本: {},       // 父单id → {token合计, 单数, 完成数}
  管理费: { token合计: 0, 次数: 0 },
  并发上限: { codex: 1, claude: 2 },   // 项管可调（保险丝以内）
  更新时间: null,
});

function read(root) {
  try {
    const s = JSON.parse(fs.readFileSync(STATE(root), 'utf8'));
    return { ...DEFAULT(), ...s };
  } catch { return DEFAULT(); }
}

function write(root, ledger) {
  fs.mkdirSync(DIR(root), { recursive: true });
  ledger.更新时间 = new Date().toISOString();
  const tmp = STATE(root) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  fs.renameSync(tmp, STATE(root));
  return ledger;
}

function update(root, fn) {
  const l = read(root);
  fn(l);
  return write(root, l);
}

// 事件流水：只追加（派发/落袋/失败/切单/报警……）
const INBOX_TYPES = { 待审: '急', 上呈: '急', 收口报告: '急', 额度报警: '急' };
function event(root, 类型, data) {
  if (INBOX_TYPES[类型]) { try { require('../inbox').post(root, INBOX_TYPES[类型], 类型, JSON.stringify(data).slice(0, 200), data && data.父单 ? { 单号: data.父单 } : undefined); } catch { /* 信箱失败不阻塞记账 */ } }
  fs.mkdirSync(DIR(root), { recursive: true });
  const e = { t: new Date().toISOString(), 类型, ...(data || {}) };
  fs.appendFileSync(EVENTS(root), JSON.stringify(e) + '\n', 'utf8');
  return e;
}

function events(root, limit = 200) {
  try {
    const lines = fs.readFileSync(EVENTS(root), 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

module.exports = { read, write, update, event, events, DIR, DEFAULT };
