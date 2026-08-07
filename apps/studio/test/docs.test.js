// docs.test.js — 知识总库文档分区聚合（施工令-015）：两分区聚合 / 缺目录容错 / 越界拒读
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

console.log('知识总库文档分区测试（施工令-015）');

t('分区名单 = 策划案 / 技术方案', () => {
  assert.deepEqual(docs.zones(), ['策划案', '技术方案']);
  assert.equal(docs.list(mk(), '不存在的区'), null);
});

t('策划案聚合两根（H89：设计 + 调研同区，标签区分）', () => {
  const root = mk();
  write(root, 'Docs/SLG/策划文档/02-项目概述.md', '# 项目概述\n正文');
  write(root, 'Docs/SLG/策划文档/系统模块/城池系统.md', '# 城池系统\n正文');
  write(root, 'Docs/SLG/竞品分析/三国志11.md', '# 三国志11\n正文');
  const r = docs.list(root, '策划案');
  assert.equal(r.文档.length, 3);
  assert.deepEqual(r.根.map((x) => x.标签), ['设计', '调研']);
  assert.deepEqual(r.根.map((x) => x.数量), [2, 1]);
  assert.deepEqual([...new Set(r.文档.map((x) => x.标签))].sort(), ['设计', '调研'].sort());
  const sub = r.文档.find((x) => x.文件名 === '城池系统.md');
  assert.equal(sub.子目录, '系统模块', '子目录须递归带出');
  assert.equal(sub.rel, 'Docs/SLG/策划文档/系统模块/城池系统.md');
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
  assert.deepEqual(r.根.map((x) => x.存在), [false, false]);
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
