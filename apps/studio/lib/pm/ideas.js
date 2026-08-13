// pm/ideas.js — 想法池（H49 双域分割·制作人层域）
// 轻量卡片：无验收标准、无排期压力，你我随聊随记；拍板 = 想法→父单（补边界+验收标准），
// 从此进入项目组域（项管切单派发）。明文 jsonl 落盘。
const fs = require('fs');
const path = require('path');

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

// 拍板：想法 → **专项注册表条目**（施工令-058 要件2 / H103「专项是容器不是工单」）。
// 0.26 之前这里造的是一张 `父单类型: 专项` 的工单（旧号形 <项目>-S#），于是容器一出生就带着
// QA/验收方式/预计时间这些执行者才需要的字段，还得在九态里挑一个假装住着——TK-146/150 的病
// 就是从这一行开始的。现在它产出注册表条目：S 系列号、四态容器状态机、零工单字段。
// 前缀参数没退休，改了含义：它是**子单**将来的派号前缀（专项号一律 S-n，见 specials.立项）。
function 拍板(root, id, 项目, 前缀) {
  const all = list(root);
  const i = all.findIndex((x) => x.id === id && x.状态 === '在池');
  if (i < 0) return { ok: false, error: '想法不存在或已处理' };
  const 文 = all[i].文本;
  const r = require('../specials').立项(root, {
    名称: 文.slice(0, 40), 目标: 文, 项目: String(项目 || ''), 单号前缀: String(前缀 || 'TK'),
    因: `想法拍板（${all[i].id}）`, 操作者: '制作人',
    正文: `## 专项目标（拍板前补齐）\n${文}\n${all[i].备注 ? '\n> ' + all[i].备注 + '\n' : ''}\n## 系统边界（必填：写区圈定 + 不要做）\n（补齐后立项生效）\n\n## 验收标准（必填：可判定条目 + 标注保留项）\n（补齐后立项生效）\n`,
  });
  if (!r.ok) return r;
  all[i].状态 = '已拍板'; all[i].专项 = r.id; saveAll(root, all);
  return { ok: true, 专项: r.id };
}

module.exports = { list, add, drop, 拍板, FILE };
