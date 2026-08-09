// brain.test.js — 项管切单：ticket 块解析 + 子单 frontmatter 白名单（落盘存活）
// 病灶：提示词要求写的字段，白名单不带就在建单时被静默吞掉——已吃两次（H88 依据、TK-106~116 管线）。
// 本套件专盯这条缝：解析拿得到 ≠ 落得到盘，两段都要锁。
const assert = require('node:assert');
const store = require('../lib/core/store');
const { parseTickets, childFm, draftFm } = require('../lib/pm/brain');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('brain 切单解析 + 子单白名单测试');

const 块 = (fmLines, body) => '```ticket\n' + fmLines.join('\n') + '\n---\n' + body + '\n```';
const 基本 = ['title: 海岸线钉零', '单型: 实现单', '职能: 程序', '优先级: P1', 'QA: 开', '验收方式: 委托'];

t('parseTickets：管线字段解析得到（中文键名不被正则漏掉）', () => {
  const { tickets } = parseTickets(块([...基本, '管线: P-3'], '## 范围\n钉零'));
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].fm.管线, 'P-3', '解析层拿到管线号');
});

t('childFm：ticket 块写了管线 → 白名单带过去（不被吞）', () => {
  const { tickets } = parseTickets(块([...基本, '管线: P-3'], '## 范围\n钉零'));
  const fm = childFm(tickets[0], { id: 'TK-120', ids: ['TK-120'], parentId: 'TK-S9', 项目: 'SLG' });
  assert.equal(fm.管线, 'P-3', '管线必须落到子单 fm——TK-106~116 漏章案的正面锁');
});

t('落盘存活：建单再读回来，管线还在（端到端到磁盘）', () => {
  const root = makeRoot();
  const { tickets } = parseTickets(块([...基本, '管线: P-3'], '## 范围\n钉零\n## 验收标准\n□ 绿'));
  const fm = childFm(tickets[0], { id: 'TK-120', ids: ['TK-120'], parentId: 'TK-S9', 项目: 'SLG' });
  assert.ok(store.create(root, 'TK-120', fm, tickets[0].body).ok);
  assert.equal(store.find(root, 'TK-120').fm.管线, 'P-3', '读回来还在才算落盘');
});

t('没写管线 → 字段不出现（留空进散单是合法态，不许塞空串）', () => {
  const { tickets } = parseTickets(块(基本, '## 范围\n杂务'));
  const fm = childFm(tickets[0], { id: 'TK-121', ids: ['TK-121'], parentId: 'TK-S9', 项目: 'SLG' });
  assert.ok(!('管线' in fm), '缺省不造字段，交给父链继承/散单行');
});

t('白名单其余项未被改动：依据落盘、依赖同批序号换真编号、缺省值照旧', () => {
  const { tickets } = parseTickets(块([...基本, '依据: TK-99', '依赖: 1,2'], '## 范围\n钉零'));
  const fm = childFm(tickets[0], { id: 'TK-122', ids: ['TK-120', 'TK-121', 'TK-122'], parentId: 'TK-S9', 项目: 'SLG' });
  assert.equal(fm.依据, 'TK-99', 'H88 依据栏照旧落盘');
  assert.equal(fm.依赖, 'TK-120，TK-121', '同批序号 1,2 → 实际编号');
  assert.equal(fm.父单, 'TK-S9'); assert.equal(fm.项目, 'SLG');
  assert.equal(fm.规模, '单兵'); assert.equal(fm.切单人, '项管');
  const 空 = childFm({ fm: {} }, { id: 'TK-123', ids: [], parentId: 'TK-S9', 项目: 'SLG' });
  assert.equal(空.职能, '程序'); assert.equal(空.单型, '实现单'); assert.equal(空.QA, '开');
  assert.ok(!('依赖' in 空), '无依赖不造空字段');
});

// ---- 单张起草路径（draftTicket）：TK-115/116 案发现场，无父单可继承，漏章必进散单 ----
t('单张起草带管线 → 落盘存活（读回来还在）', () => {
  const root = makeRoot();
  const { tickets } = parseTickets(块([...基本, '管线: P-3'], '## 范围\n钉零\n## 验收标准\n□ 绿'));
  const fm = draftFm(tickets[0], { id: 'TK-130', 项目: 'SLG' });
  assert.equal(fm.管线, 'P-3', '白名单带过去');
  assert.ok(store.create(root, 'TK-130', fm, tickets[0].body).ok);
  const 回 = store.find(root, 'TK-130');
  assert.equal(回.fm.管线, 'P-3', '起草单无父单可继承，落盘存活是唯一保障');
  assert.ok(!('父单' in 回.fm), '单张起草不挂父单（H53 收口/成本归集不许伪装拆单结构）');
});

t('draftFm 其余白名单未被改动：依据落盘、缺省单型=修复单、没写管线不造字段', () => {
  const { tickets } = parseTickets(块(基本, '## 范围\n杂务'));
  const fm = draftFm(tickets[0], { id: 'TK-131', 项目: 'SLG' });
  assert.ok(!('管线' in fm), '缺省不造字段');
  assert.equal(fm.规模, '单兵'); assert.equal(fm.切单人, '项管'); assert.equal(fm.项目, 'SLG');
  const 空 = draftFm({ fm: { 依据: 'TK-99' } }, { id: 'TK-132', 项目: '' });
  assert.equal(空.依据, 'TK-99', 'H88 依据栏照旧');
  assert.equal(空.单型, '修复单', '起草单缺省单型与 cut（实现单）不同，别写串');
  assert.equal(空.title, '起草单'); assert.equal(空.职能, '程序');
});

t('切单提示词带管线两处：口径条目 + 输出契约字段清单', () => {
  const { buildCutPrompt } = require('../lib/pm/brain');
  const root = makeRoot();
  const p = buildCutPrompt(root, {}, { id: 'TK-S9', fm: { 项目: 'SLG' }, body: '造地图' }, '');
  assert.ok(/管线归属必填/.test(p), '口径条目在');
  assert.ok(/管线: <本单所属管线号/.test(p), '输出契约字段清单在——不列字段等于不让写');
  assert.ok(/TK-106~116/.test(p), '案源留痕');
});

console.log('全部通过：' + passed + ' 项');
