// assembler.test.js — 装配器：依赖回执摘要 / 标签选段 / 截断 / 空态
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../lib/assembler');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('assembler 装配器测试');

const mkroot = () => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-'));
  fs.mkdirSync(path.join(r, '回执'), { recursive: true });
  return r;
};
const T = (fm, body) => ({ id: fm.id || 'X-2', fm, body: body || '' });

t('依赖回执摘要：优先产出/验收步骤/做了什么章节', () => {
  const r = mkroot();
  fs.writeFileSync(path.join(r, '回执', 'X-1.md'),
    '# 完工报告 X-1\n## 产出\nA.json\n## 做了什么\n烘了数据\n## 实际消耗\n1k\n## 异议\n无');
  const s = A.depReceipts(r, T({ 依赖: 'X-1' }));
  assert.ok(s.includes('A.json') && s.includes('烘了数据'));
  assert.ok(!s.includes('实际消耗'), '无关章节不进包');
});

t('标签选段：职能/产出物/正文关键词三路命中', () => {
  const md = '# 库\n\n## [程序 代码] 甲条\n内容甲\n\n## [美术] 乙条\n内容乙\n\n## [Unity] 丙条\n内容丙\n';
  const s = A.pickSections(md, ['程序', '代码'], '这单要动 Unity 场景');
  assert.ok(s.includes('内容甲'), '职能命中');
  assert.ok(!s.includes('内容乙'), '不相关不入包');
  assert.ok(s.includes('内容丙'), '正文关键词命中');
});

t('总装：三块拼装+空态不占位', () => {
  const r = mkroot();
  fs.writeFileSync(path.join(r, '坑档案.md'), '## [程序] 坑一\n别踩\n');
  fs.writeFileSync(path.join(r, '回执', 'D-1.md'), '## 产出\nout.md\n');
  const s = A.assemble(r, T({ 职能: '程序', 产出物类型: '代码', 依赖: 'D-1' }));
  assert.ok(s.includes('坑档案') && s.includes('别踩'));
  assert.ok(s.includes('上游依赖产出') && s.includes('out.md'));
  assert.ok(!s.includes('协议选段'), '缺文件的块不出现');
  assert.equal(A.assemble(mkroot(), T({ 职能: '策划' })), '', '全空返回空串');
});

t('截断纪律：单份与总额封顶', () => {
  const r = mkroot();
  fs.writeFileSync(path.join(r, '回执', 'B-1.md'), '## 产出\n' + 'x'.repeat(9000));
  fs.writeFileSync(path.join(r, '回执', 'B-2.md'), '## 产出\n' + 'y'.repeat(9000));
  fs.writeFileSync(path.join(r, '回执', 'B-3.md'), '## 产出\n' + 'z'.repeat(9000));
  fs.writeFileSync(path.join(r, '回执', 'B-4.md'), '## 产出\n' + 'w'.repeat(9000));
  const s = A.depReceipts(r, T({ 依赖: 'B-1，B-2，B-3，B-4' }));
  assert.ok(s.length < 8000, '总额封顶（实际 ' + s.length + '）');
});

console.log(`全部通过：${passed} 项`);
