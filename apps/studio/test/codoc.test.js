// codoc.test.js — 协同策划文档（施工令-017）：解析 / 序列化 / 块操作（改增删移）/ 容错 / 存盘即页史
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const codoc = require('../lib/codoc');

let n = 0;
const t = (name, fn) => { fn(); console.log('  ✓ ' + name); n++; };
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'codoc-'));
const REL = 'Docs/SLG/策划文档/TK-总体策划.codoc.md';
const write = (root, rel, body) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body, 'utf8');
  return f;
};
const 样本 = [
  '<!--blk id=b1 作者=总监 时=2026-08-07T10:00:00.000Z-->',
  '# 设计基石',
  '玩家扮演的就是玩家。',
  '',
  '<!--blk id=b2 作者=制作人 时=2026-08-07T11:00:00.000Z-->',
  '## 核心循环',
  '一分钟决策。',
  '',
].join('\n');

console.log('协同策划文档测试（施工令-017）');

t('解析：元数据注释切块，id/作者/时/正文各归各位', () => {
  const d = codoc.parse(样本);
  assert.equal(d.块.length, 2);
  assert.deepEqual(d.块.map((b) => b.id), ['b1', 'b2']);
  assert.deepEqual(d.块.map((b) => b.作者), ['总监', '制作人']);
  assert.equal(d.块[0].时, '2026-08-07T10:00:00.000Z');
  assert.equal(d.块[0].文本, '# 设计基石\n玩家扮演的就是玩家。');
  assert.equal(d.块[1].文本, '## 核心循环\n一分钟决策。');
  assert.equal(d.前言, '', '无 frontmatter 时前言为空');
});

t('容错：无元数据的整段视作单块，作者=未知', () => {
  const d = codoc.parse('# 老文档\n\n第一段\n\n第二段');
  assert.equal(d.块.length, 1, '整篇无元数据 → 一块');
  assert.equal(d.块[0].作者, '未知');
  assert.equal(d.块[0].id, 'b1', 'id 缺失就地补发');
  assert.ok(d.块[0].文本.includes('第二段'), '正文一字不落');
  // 前半段无元数据、后半段有 → 前半段自成一块（作者未知），后半段照常
  const d2 = codoc.parse('开头没戳的话\n' + 样本);
  assert.equal(d2.块.length, 3);
  assert.deepEqual(d2.块.map((b) => b.作者), ['未知', '总监', '制作人']);
  assert.deepEqual(d2.块.map((b) => b.id), ['b3', 'b1', 'b2'], '补发的号避开文件里已用的 b1/b2');
});

t('容错：野作者归 未知、重复 id 后来者让位、空块与空注释不占位', () => {
  const d = codoc.parse([
    '<!--blk id=b1 作者=外包-->', '甲',
    '<!--blk id=b1 作者=策划-->', '乙',
    '<!--blk 作者=总监-->', '',      // 空块：丢弃
    '<!--blk id=b9 作者=策划-->', '丙',
  ].join('\n'));
  assert.deepEqual(d.块.map((b) => b.文本), ['甲', '乙', '丙'], '空块不入列');
  assert.equal(d.块[0].作者, '未知', '名单外的作者归一到未知');
  assert.equal(d.块[0].id, 'b1');
  assert.notEqual(d.块[1].id, 'b1', '撞号的后来者改号');
  assert.equal(d.块[2].id, 'b9');
  assert.equal(new Set(d.块.map((b) => b.id)).size, 3, '块 id 篇内唯一');
});

t('序列化：往返不失真，缺 时 就不造假戳', () => {
  const d = codoc.parse(样本);
  const s = codoc.serialize(d);
  const d2 = codoc.parse(s);
  assert.deepEqual(d2.块, d.块, 'parse→serialize→parse 完全一致');
  assert.ok(s.includes('<!--blk id=b1 作者=总监 时=2026-08-07T10:00:00.000Z-->'));
  const 无时 = codoc.serialize({ 前言: '', 块: [{ id: 'b1', 作者: '策划', 时: null, 文本: '甲' }] });
  assert.equal(无时.split('\n')[0], '<!--blk id=b1 作者=策划-->');
  assert.equal(codoc.parse(无时).块[0].时, null);
});

t('frontmatter 原样保留，不被当正文吃掉', () => {
  const d = codoc.parse('---\n标题: 总体策划\n---\n' + 样本);
  assert.equal(d.前言, '---\n标题: 总体策划\n---\n');
  assert.equal(d.块.length, 2);
  assert.ok(codoc.serialize(d).startsWith('---\n标题: 总体策划\n---\n'), '序列化把前言原样吐回');
});

t('块操作·改：正文替换 + 作者时戳改判，别的块纹丝不动', () => {
  const d = codoc.parse(样本);
  const r = codoc.apply(d, { 动作: '改', id: 'b1', 文本: '# 设计基石\n改过了' }, '制作人');
  assert.ok(r.ok);
  assert.equal(r.doc.块[0].文本, '# 设计基石\n改过了');
  assert.equal(r.doc.块[0].作者, '制作人');
  assert.ok(Date.parse(r.doc.块[0].时) > 0, '时戳是可解析的 ISO');
  assert.deepEqual(r.doc.块[1], d.块[1], '邻块零改动');
  assert.equal(d.块[0].文本, '# 设计基石\n玩家扮演的就是玩家。', '原 doc 不被就地改');
  assert.equal(codoc.apply(d, { 动作: '改', id: '不存在', 文本: 'x' }, '制作人').ok, false);
  assert.equal(codoc.apply(d, { 动作: '改', id: 'b1', 文本: '   ' }, '制作人').ok, false, '改成空块要拦');
});

t('块操作·增：默认追加，可锚定前/后插入', () => {
  const d = codoc.parse(样本);
  const 尾 = codoc.apply(d, { 动作: '增', 文本: '新的一块' }, '制作人');
  assert.deepEqual(尾.doc.块.map((b) => b.文本), ['# 设计基石\n玩家扮演的就是玩家。', '## 核心循环\n一分钟决策。', '新的一块']);
  assert.equal(尾.doc.块[2].作者, '制作人');
  assert.ok(!new Set(['b1', 'b2']).has(尾.id), '新块 id 不撞老号');
  const 中 = codoc.apply(d, { 动作: '增', 锚: 'b1', 位: '后', 文本: '插在中间' }, '制作人');
  assert.equal(中.doc.块[1].文本, '插在中间');
  const 前 = codoc.apply(d, { 动作: '增', 锚: 'b1', 位: '前', 文本: '插在最前' }, '制作人');
  assert.equal(前.doc.块[0].文本, '插在最前');
  assert.equal(codoc.apply(d, { 动作: '增', 锚: '没这块', 文本: 'x' }, '制作人').ok, false);
  assert.equal(codoc.apply(d, { 动作: '增', 文本: '' }, '制作人').ok, false, '空块不许新增');
});

t('块操作·删/移：删到最后一块要拦，移到头就停', () => {
  const d = codoc.parse(样本);
  const del = codoc.apply(d, { 动作: '删', id: 'b1' }, '制作人');
  assert.deepEqual(del.doc.块.map((b) => b.id), ['b2']);
  assert.equal(codoc.apply(del.doc, { 动作: '删', id: 'b2' }, '制作人').ok, false, '不许删空文档');
  const 下 = codoc.apply(d, { 动作: '移', id: 'b1', 方向: '下' }, '制作人');
  assert.deepEqual(下.doc.块.map((b) => b.id), ['b2', 'b1']);
  const 上 = codoc.apply(d, { 动作: '移', id: 'b2', 方向: '上' }, '制作人');
  assert.deepEqual(上.doc.块.map((b) => b.id), ['b2', 'b1']);
  assert.equal(codoc.apply(d, { 动作: '移', id: 'b1', 方向: '上' }, '制作人').ok, false, '已在头顶不再移');
  assert.equal(codoc.apply(d, { 动作: '移', id: 'b2', 方向: '下' }, '制作人').ok, false);
  assert.equal(codoc.apply(d, { 动作: '翻跟头', id: 'b1' }, '制作人').ok, false, '未知动作照拒');
});

t('读：路径口径同 docs（分区内 + 越界拒），且只认 .codoc.md', () => {
  const root = mk();
  write(root, REL, 样本);
  write(root, 'Docs/SLG/策划文档/普通稿.md', '正文');
  write(root, '秘密.codoc.md', '不该被读到');
  const f = codoc.read(root, '策划案', REL);
  assert.equal(f.块.length, 2);
  assert.equal(f.标题, '设计基石', '标题取首个一级标题');
  assert.equal(f.标签, '设计');
  assert.equal(f.rel, REL);
  assert.equal(codoc.read(root, '策划案', 'Docs/SLG/策划文档/普通稿.md'), null, '非 codoc 不给块级读');
  assert.equal(codoc.read(root, '技术方案', REL), null, '跨分区不给读');
  assert.equal(codoc.read(root, '策划案', 'Docs/SLG/策划文档/../../../秘密.codoc.md'), null, '../ 逃逸拒');
  assert.equal(codoc.read(root, '策划案', 'Docs/SLG/策划文档/没这篇.codoc.md'), null);
  assert.equal(codoc.isCodoc(REL) && !codoc.isCodoc('普通稿.md'), true);
});

t('存盘：内容落地 + git 提交只含该文件（页史取证）', () => {
  const root = mk();
  write(root, REL, 样本);
  write(root, '无关文件.txt', '别人的脏改动');
  // quotepath=false：不然中文路径回来是八进制转义，对不上；autocrlf=false：省掉 Windows 换行告警噪声
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'init');
  fs.writeFileSync(path.join(root, '无关文件.txt'), '提交时不该被捎带', 'utf8');

  const r = codoc.edit(root, '策划案', REL, { 动作: '改', id: 'b2', 文本: '## 核心循环\n改后的正文' }, '制作人');
  assert.ok(r.ok, r.error);
  assert.ok(r.提交, 'git 提交产生了短号：' + JSON.stringify(r.警示));
  assert.equal(r.警示, null);
  const 再读 = codoc.read(root, '策划案', REL);
  assert.equal(再读.块[1].文本, '## 核心循环\n改后的正文', '内容落盘');
  assert.equal(再读.块[1].作者, '制作人', '作者戳落盘');
  assert.equal(再读.块[0].作者, '总监', '没动的块作者不变');

  const stat = git('show', '--name-only', '--format=%s', 'HEAD').trim().split('\n').map((s) => s.trim()).filter(Boolean);
  assert.equal(stat[0], '协同文档 TK-总体策划.codoc.md · 制作人编辑', '提交信息按约定：' + stat[0]);
  assert.deepEqual(stat.slice(1), [REL], '这一笔只含该文件，脏改动没被捎带');
  assert.ok(git('status', '--porcelain').includes('无关文件.txt'), '别人的脏改动仍留在工作区');

  const 复存 = codoc.save(root, '策划案', REL, { 前言: 再读.前言, 块: 再读.块 }, '制作人');
  assert.equal(复存.无变更, true, '内容一字未改 → 不落空提交');
  assert.equal(复存.提交, null);
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '2', '页史仍是 init + 那一笔');
});

t('存盘容错：非 git 仓/内容无变化都不阻塞，回执带警示字段', () => {
  const root = mk();
  write(root, REL, 样本);
  const r = codoc.edit(root, '策划案', REL, { 动作: '增', 文本: '追加一块' }, '制作人');
  assert.ok(r.ok, '不是 git 仓照样存盘');
  assert.equal(r.提交, null);
  assert.ok(/git/.test(r.警示 || ''), '警示字段说明为何没页史：' + r.警示);
  assert.equal(codoc.read(root, '策划案', REL).块.length, 3, '文件真写进去了');
  assert.equal(codoc.edit(root, '策划案', REL, { 动作: '改', id: '不存在', 文本: 'x' }, '制作人').ok, false);
  assert.equal(codoc.edit(root, '策划案', 'Docs/SLG/策划文档/没这篇.codoc.md', { 动作: '增', 文本: 'x' }, '制作人').ok, false);
});

console.log('全部通过：' + n + ' 项');
