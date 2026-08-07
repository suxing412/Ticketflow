// docs.test.js — 知识总库文档分区聚合（施工令-015 / 020）：三分区聚合 / 定案分层 / 缺目录容错 / 越界拒读
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const matter = require('gray-matter');
const docs = require('../lib/docs');

let n = 0;
const t = (name, fn) => { fn(); console.log('  ✓ ' + name); n++; };
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'docs-'));
const write = (root, rel, body, fm) => {
  const f = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, fm ? matter.stringify(body, fm) : body, 'utf8');
  return f;
};

console.log('知识总库文档分区测试（施工令-015 / 020）');

// —— 施工令-020：四分区扩五分区，文档型三区（另两区是设计事实/美术标杆，各有数据源不走这里）——
t('分区名单 = 策划案 / 调研方案 / 技术方案（施工令-020 三区）', () => {
  assert.deepEqual(docs.zones(), ['策划案', '调研方案', '技术方案']);
  assert.equal(docs.list(mk(), '不存在的区'), null);
});

t('策划案根收缩为单根（竞品分析已移出本区）', () => {
  const root = mk();
  write(root, 'Docs/SLG/策划文档/02-项目概述.md', '# 项目概述\n正文');
  write(root, 'Docs/SLG/策划文档/系统模块/城池系统.md', '# 城池系统\n正文');
  write(root, 'Docs/SLG/竞品分析/三国志11.md', '# 三国志11\n正文');
  const r = docs.list(root, '策划案');
  assert.deepEqual(r.根.map((x) => x.根), ['Docs/SLG/策划文档'], '策划案只剩设计文档一根');
  assert.deepEqual(r.根.map((x) => x.标签), ['设计']);
  assert.equal(r.文档.length, 2, '竞品分析不再计入策划案');
  assert.ok(!r.文档.some((x) => x.根 === 'Docs/SLG/竞品分析'));
  const sub = r.文档.find((x) => x.文件名 === '城池系统.md');
  assert.equal(sub.子目录, '系统模块', '子目录须递归带出');
  assert.equal(sub.rel, 'Docs/SLG/策划文档/系统模块/城池系统.md');
});

t('调研方案新区：调研方案 + 竞品分析两根，标签区分', () => {
  const root = mk();
  write(root, 'Docs/SLG/调研方案/时间挡位调研总报告.md', '# 时间挡位\n正文');
  write(root, 'Docs/SLG/调研方案/陡坡条纹调研.md', '# 陡坡条纹\n正文');
  write(root, 'Docs/SLG/竞品分析/三国志11.md', '# 三国志11\n正文');
  write(root, 'Docs/SLG/策划文档/02-项目概述.md', '# 项目概述\n正文');
  const r = docs.list(root, '调研方案');
  assert.deepEqual(r.根.map((x) => x.根), ['Docs/SLG/调研方案', 'Docs/SLG/竞品分析']);
  assert.deepEqual(r.根.map((x) => x.标签), ['调研', '竞品']);
  assert.deepEqual(r.根.map((x) => x.数量), [2, 1]);
  assert.equal(r.文档.length, 3, '策划文档不串区');
  assert.deepEqual([...new Set(r.文档.map((x) => x.标签))].sort(), ['竞品', '调研'].sort());
  assert.ok(r.文档.every((x) => x.组 === undefined), '定案分层只给策划案，别区不带 组 字段');
});

t('调研方案分区可读本区两根，跨区一律拒读', () => {
  const root = mk();
  write(root, 'Docs/SLG/调研方案/甲调研.md', '正文');
  write(root, 'Docs/SLG/竞品分析/乙竞品.md', '正文');
  write(root, 'Docs/SLG/策划文档/丙设计.md', '正文');
  assert.ok(docs.read(root, '调研方案', 'Docs/SLG/调研方案/甲调研.md'));
  assert.ok(docs.read(root, '调研方案', 'Docs/SLG/竞品分析/乙竞品.md'));
  assert.equal(docs.read(root, '调研方案', 'Docs/SLG/策划文档/丙设计.md'), null, '策划文档不归调研方案区');
  assert.equal(docs.read(root, '策划案', 'Docs/SLG/竞品分析/乙竞品.md'), null, '竞品分析已移出策划案区');
});

// —— 施工令-020：策划案定案分层（定案 / 草案 / 决策记录）——
t('定案分层：状态明写定案词入定案组，其余（含无状态）归草案', () => {
  const root = mk();
  write(root, 'Docs/SLG/策划文档/甲.md', '正文', { 状态: '定案' });
  write(root, 'Docs/SLG/策划文档/乙.md', '正文', { 状态: '正式' });
  write(root, 'Docs/SLG/策划文档/丙.md', '正文', { 状态: '草案' });
  write(root, 'Docs/SLG/策划文档/丁.md', '正文', { 状态: '在写' });
  write(root, 'Docs/SLG/策划文档/戊.md', '# 无 frontmatter\n正文');
  const by = Object.fromEntries(docs.list(root, '策划案').文档.map((x) => [x.文件名, x]));
  assert.equal(by['甲.md'].组, '定案');
  assert.equal(by['乙.md'].组, '定案', '正式 也算定案词');
  assert.equal(by['丙.md'].组, '草案');
  assert.equal(by['丁.md'].组, '草案', '非定案词一律草案');
  assert.equal(by['戊.md'].组, '草案', '无状态标注默认归草案（从严）');
  assert.equal(by['甲.md'].状态, '定案', '状态原文须带出，供信息栏显示');
  assert.equal(by['戊.md'].状态, '', '无标注即空串');
});

t('定案分层：决策记录/ 子目录单列一组，状态标了也不改组', () => {
  const root = mk();
  write(root, 'Docs/SLG/策划文档/决策记录/2026-07-05-首个垂直切片访谈.md', '正文');
  write(root, 'Docs/SLG/策划文档/决策记录/深一层/追访.md', '正文', { 状态: '定案' });
  write(root, 'Docs/SLG/策划文档/系统模块/城池系统.md', '正文', { 状态: '定案' });
  const by = Object.fromEntries(docs.list(root, '策划案').文档.map((x) => [x.文件名, x]));
  assert.equal(by['2026-07-05-首个垂直切片访谈.md'].组, '决策记录');
  assert.equal(by['追访.md'].组, '决策记录', '决策记录子树整棵归本组');
  assert.equal(by['城池系统.md'].组, '定案', '别的子目录照常按状态判');
});

t('定案分层：三组名单与 groupOf 纯函数口径一致', () => {
  assert.deepEqual(docs.GROUPS, ['定案', '草案', '决策记录']);
  assert.equal(docs.groupOf({ 子目录: '', 状态: '定案' }), '定案');
  assert.equal(docs.groupOf({ 子目录: '', 状态: ' 定案 ' }), '定案', '状态两侧空白不影响判定');
  assert.equal(docs.groupOf({ 子目录: '', 状态: '' }), '草案');
  assert.equal(docs.groupOf({}), '草案', '字段全缺也不炸，兜底草案');
  assert.equal(docs.groupOf({ 子目录: '决策记录' }), '决策记录');
  assert.equal(docs.groupOf({ 子目录: '决策记录/2026' }), '决策记录');
  assert.equal(docs.groupOf({ 子目录: '决策记录草稿' }), '草案', '同名前缀的别的目录不误收');
});

t('标题取值：frontmatter > 一级标题 > 文件名', () => {
  const root = mk();
  write(root, 'Docs/SLG/技术方案/甲.md', '正文没有标题');
  write(root, 'Docs/SLG/技术方案/乙.md', '# 一级标题写法\n正文');
  write(root, 'Docs/SLG/技术方案/丙.md', '正文', { 标题: 'FM 标题' });
  const by = Object.fromEntries(docs.list(root, '技术方案').文档.map((x) => [x.文件名, x]));
  assert.equal(by['甲.md'].标题, '甲');
  assert.equal(by['乙.md'].标题, '一级标题写法');
  assert.equal(by['丙.md'].标题, 'FM 标题');
});

t('缺目录容错：不抛错，标 存在:false、清单为空', () => {
  const root = mk();
  const r = docs.list(root, '策划案');
  assert.equal(r.文档.length, 0);
  assert.deepEqual(r.根.map((x) => x.存在), [false]);
  const r3 = docs.list(root, '调研方案');
  assert.equal(r3.文档.length, 0);
  assert.deepEqual(r3.根.map((x) => x.存在), [false, false], '新区两根都缺也只是空态');
  const r2 = docs.list(root, '技术方案');
  assert.equal(r2.根[0].存在, false);
  assert.equal(r2.文档.length, 0);
});

t('只收 .md，其它扩展名不入清单', () => {
  const root = mk();
  write(root, 'Docs/SLG/技术方案/图.png', 'x');
  write(root, 'Docs/SLG/技术方案/说明.txt', 'x');
  write(root, 'Docs/SLG/技术方案/真.md', '# 真');
  const r = docs.list(root, '技术方案');
  assert.deepEqual(r.文档.map((x) => x.文件名), ['真.md']);
});

t('读单篇：正文与 frontmatter 分离，字数不含空白', () => {
  const root = mk();
  write(root, 'Docs/SLG/技术方案/规格.md', '甲 乙\n丙', { 锚号: 'T-01' });
  const f = docs.read(root, '技术方案', 'Docs/SLG/技术方案/规格.md');
  assert.equal(f.fm.锚号, 'T-01');
  assert.ok(f.body.includes('甲 乙'));
  assert.equal(f.字数, 3);
  assert.equal(f.标签, '方案');
  assert.equal(f.rel, 'Docs/SLG/技术方案/规格.md');
});

t('越界拒读：../ 逃逸、跨分区、非 md、不存在一律 null', () => {
  const root = mk();
  write(root, 'Docs/SLG/技术方案/规格.md', '正文');
  write(root, 'Docs/SLG/策划文档/别区.md', '正文');
  write(root, '秘密.md', '不该被读到');
  assert.equal(docs.read(root, '技术方案', '../秘密.md'), null);
  assert.equal(docs.read(root, '技术方案', 'Docs/SLG/技术方案/../../../秘密.md'), null);
  assert.equal(docs.read(root, '技术方案', '秘密.md'), null);
  assert.equal(docs.read(root, '技术方案', 'Docs/SLG/策划文档/别区.md'), null, '跨分区不给读');
  assert.equal(docs.read(root, '技术方案', 'Docs/SLG/技术方案/规格.txt'), null);
  assert.equal(docs.read(root, '技术方案', 'Docs/SLG/技术方案/没有这篇.md'), null);
  assert.equal(docs.read(root, '技术方案', ''), null);
  assert.ok(docs.read(root, '策划案', 'Docs/SLG/策划文档/别区.md'), '本分区内照常可读');
});

console.log('全部通过：' + n + ' 项');
