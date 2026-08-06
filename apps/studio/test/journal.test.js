// journal.test.js — 流水多行条目折叠（施工令-002 第 4 项）
// 案源 2026-08-06 13:14：质检回执的「结论：不过／质量分：1」整段被写进一条流水，
// 续行没有时间戳，动态日志把它们当独立事件渲染在开工行下方——泄漏。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const journal = require('../lib/journal');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('journal 流水多行折叠测试');

t('多行条目只留首行，续行不成独立行', () => {
  const raw = [
    '[2026-08-06 13:14] 实弹开工 TK-90（QA-A · 质检）',
    '[2026-08-06 13:16] 质检执行完成 TK-90（QA-A · 逐条对照验收标准',
    '结论：不过',
    '质量分：1）',
    '[2026-08-06 13:20] 派发 TK-91（待投→在途）',
  ];
  const out = journal.foldLines(raw);
  assert.equal(out.length, 3, '五行折成三条事件，实得 ' + out.length);
  assert.ok(!out.some((l) => l === '结论：不过'), '「结论：不过」不再单独成行');
  assert.ok(!out.some((l) => l === '质量分：1）'), '「质量分：1）」不再单独成行');
  assert.ok(out[1].startsWith('[2026-08-06 13:16] 质检执行完成 TK-90'), '首行原样保留');
  assert.ok(out[1].endsWith('…'), '被吞的续行以省略号示意：' + out[1]);
  assert.equal(out[2], '[2026-08-06 13:20] 派发 TK-91（待投→在途）', '后续正常条目不受影响');
});

t('单行流水零改动', () => {
  const raw = ['[2026-08-06 09:00] 定稿 A-1（草稿→待投）', '[2026-08-06 09:01] 投池 A-1（待投→池 · 人闸）'];
  assert.deepEqual(journal.foldLines(raw), raw);
});

t('连续多条续行只加一个省略号', () => {
  const out = journal.foldLines(['[2026-08-06 10:00] 头', 'a', 'b', 'c']);
  assert.deepEqual(out, ['[2026-08-06 10:00] 头…']);
});

t('开头就是裸行（截断的日志）不丢内容', () => {
  const out = journal.foldLines(['半截行', '[2026-08-06 10:00] 头']);
  assert.deepEqual(out, ['半截行', '[2026-08-06 10:00] 头']);
});

t('readLatest 出口已折叠（前端拿到的就是干净事件行）', () => {
  const root = makeRoot();
  const dir = path.join(root, 'journal');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-08.log'),
    '[2026-08-06 13:14] 实弹开工 TK-90\n[2026-08-06 13:16] 质检完成 TK-90（结论如下\n结论：不过\n质量分：1）\n', 'utf8');
  const { lines } = journal.readLatest(root);
  assert.equal(lines.length, 2, '前端只看到两条事件，实得 ' + lines.length);
  assert.ok(lines.every((l) => /^\[/.test(l)), '每条都带时间戳前缀');
});

console.log('全部通过：' + passed + ' 项');
