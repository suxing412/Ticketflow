// wiki.test.js — 设计事实源：索引/双链/待审人闸
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const wiki = require('../lib/wiki');

let n = 0;
const t = (name, fn) => { fn(); console.log('  ✓ ' + name); n++; };
const mk = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-'));
  fs.mkdirSync(path.join(root, 'Docs', 'wiki', '地图'), { recursive: true });
  return root;
};
const write = (root, rel, fm, body) => {
  const matter = require('gray-matter');
  const f = path.join(root, 'Docs', 'wiki', rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, matter.stringify(body, fm), 'utf8');
};

console.log('wiki 设计事实源测试');

t('索引与双链反向链接', () => {
  const root = mk();
  write(root, '地图/甲.md', { 名称: '甲', 分类: '地图' }, '引用 [[乙]] 与 [[丙]]');
  write(root, '地图/乙.md', { 名称: '乙', 分类: '地图' }, '回指 [[甲]]');
  const { entries, byName } = wiki.scan(root);
  assert.equal(entries.length, 2);
  assert.deepEqual(byName['甲'].links.sort((a,b)=>a.localeCompare(b,'zh')), ['丙','乙'].sort((a,b)=>a.localeCompare(b,'zh')));
  assert.deepEqual(byName['乙'].backlinks, ['甲']);
});

t('关系图含未建虚位节点', () => {
  const root = mk();
  write(root, '地图/甲.md', { 名称: '甲', 分类: '地图' }, '[[不存在的条目]]');
  const g = wiki.graph(root);
  assert.ok(g.nodes.some((x) => x.id === '不存在的条目' && x.分类 === '未建'));
  assert.equal(g.edges.length, 1);
});

t('待审入册与退回（人闸）', () => {
  const root = mk();
  write(root, '_待审/新稿.md', { 名称: '军团编制', 分类: '系统' }, '草案内容');
  assert.equal(wiki.pending(root).length, 1);
  const r = wiki.approve(root, '新稿.md');
  assert.ok(r.ok); assert.equal(r.分类, '系统');
  assert.equal(wiki.pending(root).length, 0);
  assert.ok(wiki.scan(root).byName['军团编制']);
  assert.equal(wiki.scan(root).byName['军团编制'].状态, '正式');
  write(root, '_待审/坏稿.md', { 名称: '军团编制', 分类: '系统' }, '同名重复');
  const dup = wiki.approve(root, '坏稿.md');
  assert.ok(!dup.ok, '同名须拒');
  assert.ok(wiki.reject(root, '坏稿.md').ok);
});

console.log('全部通过：' + n + ' 项');
