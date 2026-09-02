// draft-fence.test.js — 起草解析围栏配对（2026-08-26 截断病根因案）
//
// 案发：parseTickets 非贪婪正则把正文里嵌套代码块的开栏 ``` 当成 ticket 块收尾——
// TF-3 断在「主口：」、TF-6 断在「协议固定：」（都是模型正要开 ```js 示例的位置），
// TK-196/213/182 同因。症状酷似「模型输出未完」，真凶是解析器吞文。
// 判据面：①嵌套单围栏正文完整收②多重嵌套+多 ticket 块互不串③无嵌套逐字节等价旧口径
// ④未闭合块宁缺毋残。全按 H104 行为判据，变异（换回非贪婪正则）必红。
const assert = require('node:assert');

process.env.STUDIO_STUB = '1';
const B = require('../lib/pm/brain');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('起草解析围栏配对测试（2026-08-26 截断根因案）');

const 包 = (体) => '前言\n```ticket\n' + 体 + '\n```\n尾注';

t('① 正文带嵌套代码块：块后内容不被吞（TF-3/TF-6 案型）', () => {
  const 体 = 'title: 修理\n职能: 程序\n---\n## 执行内容\n主口：\n```js\nfunction 预检(fm, body) {}\n```\n## 验收标准\n1. 变异自证能红';
  const r = B.parseTickets(包(体));
  assert.equal(r.tickets.length, 1);
  assert.ok(/验收标准/.test(r.tickets[0].body), '嵌套围栏之后的章节必须还在——旧解析在 ```js 处就收口了');
  assert.ok(/function 预检/.test(r.tickets[0].body), '嵌套代码本身也要完整保留');
});

t('② 多重嵌套 + 双 ticket 块：各归各，不串块', () => {
  const txt = '```ticket\ntitle: 甲\n---\n甲文\n```bash\nnpm test\n```\n甲尾\n```\n夹缝\n```ticket\ntitle: 乙\n---\n乙文\n```\n## 拆单简报\n两张';
  const r = B.parseTickets(txt);
  assert.equal(r.tickets.length, 2, '两张各自成单（实得 ' + r.tickets.length + '）');
  assert.ok(/甲尾/.test(r.tickets[0].body) && !/夹缝/.test(r.tickets[0].body), '甲块收在自己的栈空 ```，不吞夹缝');
  assert.equal(r.tickets[1].fm.title, '乙');
  assert.ok(/两张/.test(r.brief), '拆单简报照旧提取');
});

t('③ 无嵌套正文：与旧口径逐字节等价（回归面）', () => {
  const 体 = 'title: 平单\n优先级: P1\n---\n## 背景\n平文\n---\n## 执行\n分割线也保';
  const r = B.parseTickets(包(体));
  assert.equal(r.tickets.length, 1);
  assert.equal(r.tickets[0].fm.title, '平单');
  assert.equal(r.tickets[0].fm.优先级, 'P1');
  assert.ok(/背景[\s\S]*---[\s\S]*分割线也保/.test(r.tickets[0].body), '正文内 --- 经 join 复原（旧口径）');
});

t('④ 未闭合 ticket 块（上游真截停）：宁缺毋残，不落半张', () => {
  const r = B.parseTickets('```ticket\ntitle: 残\n---\n正文写到一半就没了');
  assert.equal(r.tickets.length, 0, '残块不成单——半张残单正是本案病灶，宁可空手触发重试');
});

t('⑤ fm 前多打一个 ---（TF-8/TF-12 错位案）：真 fm 仍进 fm，不落兜底值', () => {
  // 案发：模型在 frontmatter 前多打 ---，split 首段为空 → head 空 → fm 全取兜底
  // （title=起草单 / 单型=修复单 / 预计时间=0.25），假估值一路进排期与切单预检。
  const 体 = '\n---\ntitle: OAuth拒派去重自证\n单型: 工程单\n预计时间: 0.75h\n---\n## 背景\n正文在此';
  const r = B.parseTickets('```ticket\n' + 体 + '\n```');
  assert.equal(r.tickets.length, 1);
  assert.equal(r.tickets[0].fm.title, 'OAuth拒派去重自证', '真 fm 必须进 fm（实得 ' + JSON.stringify(r.tickets[0].fm).slice(0, 60) + '）');
  assert.equal(r.tickets[0].fm.单型, '工程单');
  assert.equal(r.tickets[0].fm.预计时间, '0.75h');
  assert.ok(/## 背景/.test(r.tickets[0].body) && !/单型/.test(r.tickets[0].body), 'fm 不许残留在正文里');
  // 正常形态零回归
  const r2 = B.parseTickets('```ticket\ntitle: 正常单\n单型: 实现单\n---\n## 背景\n文\n```');
  assert.equal(r2.tickets[0].fm.title, '正常单');
  assert.ok(/## 背景/.test(r2.tickets[0].body));
});

// ── 2026-08-28 复发：上一版只修了 ```lang 那一半 ─────────────────────────
//
// 上面 ①② 验的都是**带语言标记**的嵌套围栏（```js / ```bash）。而模型写命令行示例时
// 大多不写语言标记，裸 ``` 开栏照旧被当成 ticket 收尾——同一个病换个写法立刻复发。
// 实证：TF-14 今日起草，断在「单一出口：」正是一个裸围栏之前。回头对账，
// TF-3（断「主口：」）、TF-6（断「协议固定…：」）、TK-213（断「输出契约要求「一个」）
// **四张全部恰好断在代码块开栏处**——四张所谓「截断标本」一张都不是模型没写完。
//
// 教训不在「少写了一个正则分支」，在**判据只覆盖了自己想到的那一种写法**：
// ①② 里的夹具都是我方手写的、都带语言标记，于是真实模型输出的那一种从没被验过。
t('⑥ 裸围栏（无语言标记）开的代码块：块后章节不被吞（TF-14 案型）', () => {
  const 体 = 'title: 闸单\n职能: 程序\n---\n## 背景\n病灶\n\n## 执行内容\n单一出口：\n\n```\n查草稿({ fm, body })\n```\n\n## 验收标准\n1. 判据自证能红';
  const r = B.parseTickets(包(体));
  assert.equal(r.tickets.length, 1);
  assert.ok(/## 验收标准/.test(r.tickets[0].body),
    '裸围栏之后的整章被吞掉了——这正是 TF-3/TF-6/TK-213/TF-14 四张单的真实死因');
  assert.ok(/查草稿/.test(r.tickets[0].body), '裸围栏里的代码本身也要留住');
});

t('⑦ 裸围栏 + 双块：区段各自收各自的尾，不越界吃下一块', () => {
  const txt = '```ticket\ntitle: 甲\n---\n## 背景\na\n\n```\ncmd\n```\n\n## 验收标准\nb\n```\n\n```ticket\ntitle: 乙\n---\n## 背景\nc\n## 验收标准\nd\n```\n## 拆单简报\n两张';
  const r = B.parseTickets(txt);
  assert.equal(r.tickets.length, 2, '两张各自成单（实得 ' + r.tickets.length + '）');
  assert.deepEqual(r.tickets.map((x) => x.fm.title), ['甲', '乙']);
  assert.ok(!/title: 乙/.test(r.tickets[0].body), '甲块不许把乙块吃进正文');
  assert.ok(/两张/.test(r.brief));
});

t('⑧ 拆单简报里的围栏不参与配对（它是块外散文）', () => {
  const txt = '```ticket\ntitle: 丙\n---\n## 背景\nx\n## 验收标准\ny\n```\n## 拆单简报\n盘点时跑的是：\n```\nnode 跑测试.js\n```\n完毕';
  const r = B.parseTickets(txt);
  assert.equal(r.tickets.length, 1);
  assert.ok(!/node 跑测试/.test(r.tickets[0].body), '简报里的代码块被吸进工单正文了');
  assert.ok(/node 跑测试/.test(r.brief), '简报本身照旧完整提取');
});

t('⑨ 一个围栏都没等到的截停：仍旧宁缺毋残', () => {
  const r = B.parseTickets('```ticket\ntitle: 残\n---\n## 背景\n写到一半就没了');
  assert.equal(r.tickets.length, 0, '连收尾候选都没有时，这条路一个字没松');
});

console.log('全部通过：' + passed + ' 项');
