// pm/ideas.js — 想法池（H49 双域分割·制作人层域）
// 轻量卡片：无验收标准、无排期压力，你我随聊随记；拍板 = 想法→父单（补边界+验收标准），
// 从此进入项目组域（项管切单派发）。明文 jsonl 落盘。
const fs = require('fs');
const path = require('path');
const store = require('../core/store');

const FILE = (root) => path.join(root, '想法', 'ideas.jsonl');

function list(root) {
  try {
    const lines = fs.readFileSync(FILE(root), 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function saveAll(root, arr) {
  fs.mkdirSync(path.dirname(FILE(root)), { recursive: true });
  const tmp = FILE(root) + '.tmp';
  fs.writeFileSync(tmp, arr.map((x) => JSON.stringify(x)).join('\n') + (arr.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, FILE(root));
}

function add(root, 文本, 备注) {
  const t = String(文本 || '').trim();
  if (!t) return { ok: false, error: '空想法不收' };
  if (t.length > 500) return { ok: false, error: '想法卡 ≤500 字（长了就是该拍板成父单了）' };
  const idea = { id: 'I-' + Date.now().toString(36), t: new Date().toISOString(), 文本: t, 备注: String(备注 || '').slice(0, 300), 状态: '在池' };
  const all = list(root); all.push(idea); saveAll(root, all);
  return { ok: true, idea };
}

function drop(root, id) {
  const all = list(root);
  const i = all.findIndex((x) => x.id === id && x.状态 === '在池');
  if (i < 0) return { ok: false, error: '想法不存在或已处理' };
  all[i].状态 = '已放弃'; saveAll(root, all);
  return { ok: true };
}

// 拍板：想法 → 父单草稿（人闸的前半步——制作人补齐边界与验收标准后正式生效）
function 拍板(root, id, 项目, 前缀) {
  const all = list(root);
  const i = all.findIndex((x) => x.id === id && x.状态 === '在池');
  if (i < 0) return { ok: false, error: '想法不存在或已处理' };
  // 自动派号（沿用推翻的派号法）
  let mx = 0;
  const px = String(前缀 || 'TK');
  for (const s of store.STATES) for (const x of store.list(root, s)) {
    const m = String(x.id).match(/^(.+)-(\d+)$/);
    if (m && m[1] === px) mx = Math.max(mx, Number(m[2]));
  }
  const newId = `${px}-${mx + 1}`;
  const fm = {
    id: newId, title: all[i].文本.slice(0, 40), 职能: '策划', 产出物类型: '规格',
    优先级: 'P1', 规模: '单兵', QA: '关', 验收方式: '保留', 预计时间: '', 预计token: '',
    项目: String(项目 || ''), 创建时间: new Date().toISOString().slice(0, 10),
    父单类型: '战役', 想法源: all[i].id,
  };
  const body = `## 战役目标（拍板前补齐）\n${all[i].文本}\n${all[i].备注 ? '\n> ' + all[i].备注 + '\n' : ''}\n## 系统边界（必填：写区圈定 + 不要做）\n（补齐后拍板生效）\n\n## 验收标准（必填：可判定条目 + 标注保留项）\n（补齐后拍板生效）\n`;
  const r = store.create(root, newId, fm, body);
  if (!r.ok) return r;
  all[i].状态 = '已拍板'; all[i].父单 = newId; saveAll(root, all);
  return { ok: true, 父单: newId };
}

module.exports = { list, add, drop, 拍板, FILE };
