// receipt-multipart.test.js — 回执多段保全（2026-08-26 截头四案：TK-185/190/204、TF-4）
//
// 案发：extractClaudeText「取匹配关键词的最后一段」默认报告单条消息——长回执被会话
// 切成多条 assistant 消息时只留含「结论：」的尾段，头段（产出/做了什么/自测结果）丢弃，
// 落盘回执从代码块中段起头，初检齐刷刷判「缺自测结果章」，候人裁队列净涨。
// 判据面：①跨段报告头身尾全保②单段报告照旧剪掉前置闲聊③无标记全拼④非 JSON 原样。
const assert = require('node:assert');

process.env.STUDIO_STUB = '1';
const R = require('../lib/runner');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('回执多段保全测试（2026-08-26 截头四案）');

const 行 = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

t('① 跨段报告：头（完工报告+自测结果）、身（代码块）、尾（结论）三段全保，不截头', () => {
  const raw = [
    行('先说两句过程闲聊'),
    行('# 完工报告\n## 产出\nX\n## 自测结果\n1. ✓'),
    行('```js\nfunction a(){}\n```\n## 异议\n无'),
    行('## 实际消耗\n约 1h\n结论：通过'),
  ].join('\n');
  const r = R.extractClaudeText(raw);
  assert.ok(/自测结果/.test(r), '头段的自测结果章必须幸存——四案全倒在这一格');
  assert.ok(/function a/.test(r) && /结论：通过/.test(r), '身尾同样在');
  assert.ok(!/过程闲聊/.test(r), '报告标记之前的过程叙述照旧剪掉');
});

t('② 单段报告：与旧口径同效（前置闲聊剪掉，报告独取）', () => {
  const raw = [行('闲聊'), 行('# 完工报告\n## 自测结果\n全绿\n结论：通过')].join('\n');
  const r = R.extractClaudeText(raw);
  assert.ok(/自测结果/.test(r) && !/闲聊/.test(r));
});

t('③ 无报告标记：全拼兜底', () => {
  const raw = [行('甲'), 行('乙')].join('\n');
  assert.equal(R.extractClaudeText(raw), '甲\n\n乙');
});

t('④ 非 JSON 流：原样返回', () => {
  assert.equal(R.extractClaudeText('纯文本输出'), '纯文本输出');
});

t('⑥ 首段无关键词也不丢（TK-204 复发案）：报告被切成多条、关键词落在后段时，头段照留', () => {
  // 案发：TK-204 落盘回执从半截 JSON「径见输出的…」起头，做了什么/自测结果/实际消耗三章全灭——
  // 一修按「第一个带报告语汇的段」起拼，首段（真正的报告开头）不含关键词就被整段丢弃。
  const raw = [
    行('# 完工报告 TK-204\n\n## 做了什么\n\n- 双写落件\n\n## 自测结果\n\n- ✓ 标准 1：在位'),
    行('**A2 ✓** 双写落件段源码 `enginectl.js:251-267`\n\n## 实际消耗\n约 1h；约 8 万 tokens\n\n结论：通过'),
  ].join('\n');
  const r = R.extractClaudeText(raw);
  assert.ok(/## 做了什么/.test(r) && /## 自测结果/.test(r), '首段三章必须幸存——丢头正是本案病灶');
  assert.ok(/## 实际消耗/.test(r) && /结论：通过/.test(r), '后段照拼');
});

t('⑦ 两端闲聊仍剪：无结构短开场白/收尾语剪掉，有结构的一律留', () => {
  const raw = [
    行('好的，我先看一下工单。'),
    行('# 完工报告 X-77\n\n## 自测结果\n- ✓ 标准 1：在位\n\n结论：通过'),
    行('收工，辛苦。'),
  ].join('\n');
  const r = R.extractClaudeText(raw);
  assert.ok(!/我先看一下工单/.test(r), '无结构短开场白剪掉');
  assert.ok(!/收工，辛苦/.test(r), '无结构短收尾剪掉');
  assert.ok(/## 自测结果/.test(r));
  // 长的过程叙述（≥200 字）宁可留着：剪错比留错贵（初检只查章存在性）
  const 长开场 = '先说明本轮背景：'.padEnd(210, '背景细节。');
  const r2 = R.extractClaudeText([行(长开场), 行('# 完工报告\n## 自测结果\n- ✓ 标准 1\n结论：通过')].join('\n'));
  assert.ok(r2.includes('先说明本轮背景'), '长叙述不剪——宁可多留，绝不丢内容');
});

t('⑤ TK-35 案兼容：报告后的无结构短散文尾巴照旧剪掉，结构性续段（## 章/围栏/编号）不受误伤', () => {
  const raw1 = [行('先做点事'), 行('# 完工报告 TK-X\n## 产出\nA.md'), 行('顺手收个尾，闲聊一句')].join('\n');
  const r1 = R.extractClaudeText(raw1);
  assert.ok(r1.startsWith('# 完工报告') && !r1.includes('闲聊'), '尾闲聊剪除（TK-35 案原判据）');
  const raw2 = [行('# 完工报告\n## 自测结果\n全绿'), 行('## 异议\n无\n结论：通过')].join('\n');
  assert.ok(/异议/.test(R.extractClaudeText(raw2)), '带章头的续段是报告体，不许被当闲聊剪掉');
});

console.log('全部通过：' + passed + ' 项');
