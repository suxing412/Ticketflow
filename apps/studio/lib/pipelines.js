// 管线（H51/H52，0.19）：工单结构顶层单位——域的常青树。
// 实体分立律（H52）：管线与工单生命周期/不变量/状态机全然不同，故独立实体——
// 独立目录（管线/）、独立 schema（名称/阶段/状态/规格）、独立操作（开线/封存/复线）。
// 没有九态、没有 QA、没有派发，永不「完工」；与工单共享的接口面只有「树节点」（视图分区渲染）。
// 开线/封存是人闸（制作人拍板）；项管仅有建议权（章程 H50/H51）。
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const DIR = (root) => path.join(root, '管线');
const STATUSES = ['活跃', '封存'];

function ensure(root) { fs.mkdirSync(DIR(root), { recursive: true }); }

function list(root) {
  ensure(root);
  return fs.readdirSync(DIR(root)).filter((f) => /^P-\d+\.md$/.test(f)).map((f) => {
    const g = matter(fs.readFileSync(path.join(DIR(root), f), 'utf8'));
    return { id: f.replace(/\.md$/, ''), fm: g.data, body: g.content };
  }).sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
}

function find(root, id) {
  const file = path.join(DIR(root), `${id}.md`);
  if (!fs.existsSync(file)) return null;
  const g = matter(fs.readFileSync(file, 'utf8'));
  return { id, file, fm: g.data, body: g.content };
}

// 开线（人闸）：名称必填；阶段默认 L0；规格正文可空（后补）。
function create(root, 名称, 阶段, 规格) {
  if (!String(名称 || '').trim()) return { ok: false, error: '管线名称必填' };
  ensure(root);
  const mx = list(root).reduce((m, p) => Math.max(m, Number(p.id.slice(2))), 0);
  const id = `P-${mx + 1}`;
  const fm = { id, 名称: String(名称).trim(), 阶段: String(阶段 || 'L0'), 状态: '活跃', 开线时间: new Date().toISOString() };
  fs.writeFileSync(path.join(DIR(root), `${id}.md`), matter.stringify(String(规格 || ''), fm), 'utf8');
  return { ok: true, id, fm };
}

function update(root, id, mut) {
  const p = find(root, id);
  if (!p) return { ok: false, error: '管线不存在：' + id };
  mut(p.fm);
  if (p.fm.状态 && !STATUSES.includes(p.fm.状态)) return { ok: false, error: '非法状态：' + p.fm.状态 };
  p.fm.更新时间 = new Date().toISOString();
  fs.writeFileSync(p.file, matter.stringify(p.body, p.fm), 'utf8');
  return { ok: true, id, fm: p.fm };
}

// 封存/复线（人闸）：封存不是删除——树还在，只是不再挂新单。
function setStatus(root, id, 状态) {
  if (!STATUSES.includes(状态)) return { ok: false, error: '状态只能是 活跃/封存' };
  return update(root, id, (fm) => { fm.状态 = 状态; });
}

// 工单→管线解析：显式字段优先，否则沿父链上溯（子单继承战役父单的管线章）。
function pipelineOf(t, byId, guard) {
  let c = t, g = 0;
  while (c && g++ < (guard || 10)) {
    if (c.管线) return c.管线;
    c = c.父单 ? byId[c.父单] : null;
  }
  return null;
}

module.exports = { DIR, STATUSES, list, find, create, update, setStatus, pipelineOf };
