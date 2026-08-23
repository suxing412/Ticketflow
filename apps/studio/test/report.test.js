// report.test.js — 消耗报表聚合：时长/分组/预估偏差/回执 token 解析/判官戳统计
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const report = require('../lib/report');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('report 消耗报表测试');

t('聚合：实际时长=交付-领单；按职能/主办/池分组；预估偏差；每日交付', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'A-01', 职能: '程序', 主办: '程序-A', 执行池: 'codex', 预计时间: '2h',
    领单时间: '2026-07-29T10:00:00.000Z', 交付时间: '2026-07-29T13:00:00.000Z' }); // 3h 实际
  seed(root, '完成', { id: 'A-02', 职能: '策划', 主办: '策划-A', 执行池: 'claude', 预计时间: '1h',
    领单时间: '2026-07-29T10:00:00.000Z', 交付时间: '2026-07-29T11:00:00.000Z', 自修次数: 2,
    代核: { 结论: '通过', 时间: 'x' } });
  seed(root, '待派', { id: 'A-03', 职能: '程序' }); // 未开工不计时长
  const d = report.aggregate(root);
  assert.equal(d.总览.完成, 2);
  assert.equal(d.总览.实际h合计, 4);
  assert.equal(d.总览.预估偏差pct, Math.round(4 / 3 * 100), '实际4h/预计3h');
  assert.equal(d.总览.自修总轮, 2);
  assert.equal(d.总览.代核通过, 1);
  const prog = d.按职能.find((g) => g.名 === '程序');
  assert.equal(prog.单数, 1); assert.equal(prog.实际h合计, 3);
  assert.equal(d.按池.find((g) => g.名 === 'codex').实际h合计, 3);
  assert.equal(d.每日[0].交付, 2);
});

t('回执解析：实际消耗章节摘取 + token 数 best-effort + 判官报告存在性', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, '回执'), { recursive: true });
  fs.writeFileSync(path.join(root, '回执', 'B-01.md'),
    '# 完工报告 B-01\n## 做了什么\n事\n## 实际消耗\n约 45 分钟 · 12,500 tokens\n## 委托代核\n通过\n', 'utf8');
  const r = report.parseReceipt(root, 'B-01');
  assert.ok(r.实际消耗.includes('45 分钟'));
  assert.equal(r.token估计, 12500);
  assert.equal(r.代核报告, true);
  assert.equal(r.代裁报告, false);
  const none = report.parseReceipt(root, '不存在');
  assert.equal(none.token估计, null);
});
console.log(`全部通过：${passed} 项`);
