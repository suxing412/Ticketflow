const assert = require('node:assert');
const review = require('../lib/review-opinion');

const parsed = review.parse(`## 评审结论
实现满足主要验收。

## 阻断问题
- 无

## 潜在风险与漏洞
- 并发边界尚未做压力测试
- Windows 长路径未覆盖

## 验收证据
- npm test：通过

结论：通过`, true, { provider: 'claude' });
assert.equal(parsed.结论, '通过');
assert.deepEqual(parsed.问题, []);
assert.equal(parsed.风险.length, 2);
assert.deepEqual(parsed.证据, ['npm test：通过']);

const failed = review.parse('实现目录不存在\n结论：不过', false);
assert.equal(failed.结论, '不过');
assert.ok(failed.问题.includes('实现目录不存在'));

const fm = {};
review.append(fm, parsed); review.append(fm, failed);
assert.equal(fm.评审记录.length, 2);
assert.equal(fm.最新评审.结论, '不过');
const historical = review.fromTicket({ fm: { 代裁: { 时间: '2026-01-01' } } }, '## 委托代裁\n## 分析\n实现为空，需重新执行。\n\n结论：上呈');
assert.equal(historical[0].类型, '委托代裁');
assert.equal(historical[0].结论, '不过');
console.log('  ✓ AI 评审意见解析、失败兜底与历史保留');
