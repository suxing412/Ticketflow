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

/* ===================== 估时自校准接线（H101 · 施工令-050）=====================
 * 锁三处：①提示词自律那一半的文本确实在（切单/起草两条链都要有）
 *        ②取数层真把「预计 vs 实际」两端凑齐（时间从工单戳、token 从预算账）
 *        ③机器兜底那一半确实改写了 fm 并落了台账事件——只有提示词就是「请你遵守」，
 *          模型漏读一行即退回自由拍值，而那正是 H101 要治的病。 */
const fs = require('fs');
const path = require('path');
const { seed } = require('./helper');
const estimate = require('../lib/pm/estimate');

t('切单提示词带校准步：纪律条目 + 校准表 + 输出契约里的粒度口径', () => {
  const { buildCutPrompt } = require('../lib/pm/brain');
  const root = makeRoot();
  const 表 = estimate.校准表({ 时间: [], token: [] });
  const p = buildCutPrompt(root, {}, { id: 'TK-S9', fm: { 项目: 'SLG' }, body: '造地图' }, '', estimate.提示词块(表));
  assert.ok(/③历史校准（H101 已制度化/.test(p), '六件套第③条改挂校准表');
  assert.ok(/不得自由拍值/.test(p), '自律纪律原文在');
  assert.ok(/估时校准表（H101/.test(p), '校准表块注进去了');
  assert.ok(/机器兜底/.test(p), '明写机器会复核改写——不是吓唬，是实况');
  assert.ok(/预计时间: <小时数——基准估值 × 校准系数/.test(p), '输出契约字段带粒度口径');
  assert.ok(/估时校准引用/.test(p), '简报要写引用了哪一格与算式');
  // 不传校准块也不掉纪律（取数失败降级路径）：退化成「无历史可校」版
  const 空 = buildCutPrompt(root, {}, { id: 'TK-S9', fm: {}, body: '造地图' }, '');
  assert.ok(/无历史可校/.test(空) && /不得自由拍值/.test(空));
});

t('起草提示词带校准步（buildDraftPrompt 抽成纯函数才断言得了）', () => {
  const { buildDraftPrompt } = require('../lib/pm/brain');
  const 表 = estimate.校准表({ 时间: [], token: [] });
  const p = buildDraftPrompt({}, '把海岸线钉零', 'D:/proj', estimate.提示词块(表));
  assert.ok(/估时校准表（H101/.test(p) && /不得自由拍值/.test(p), '起草链与切单链同一套纪律');
  assert.ok(/起草说明里必须单列「估时校准引用」/.test(p), '留痕要求写进提示词');
  assert.ok(/FIELD_RULES|字段规范/.test(p) && /短题制/.test(p), '原有纪律段未被挤掉');
  assert.ok(/=== 制作人层需求 ===[\s\S]*把海岸线钉零/.test(p), '需求还在最后');
});

t('取数层：完结单的「预计 vs 实际」两端凑齐（时间取工单戳、token 取预算账，可注入）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'TK-200', 职能: '程序', 单型: '实现单', 预计时间: '0.5', 预计token: '50000',
    领单时间: '2026-08-10T00:00:00.000Z', 交付时间: '2026-08-10T01:00:00.000Z' });
  seed(root, '已归档', { id: 'TK-201', 职能: '程序', 单型: '实现单', 预计时间: '0.5', 预计token: '50000',
    领单时间: '2026-08-10T00:00:00.000Z', 交付时间: '2026-08-10T01:00:00.000Z' });
  seed(root, '在途', { id: 'TK-202', 职能: '程序', 单型: '实现单', 预计时间: '0.5' }); // 没完结：不该进样本
  const { 历史样本 } = require('../lib/pm/brain');
  const 单表 = 历史样本(root, { 读账: () => [
    { 池: 'claude', 单: 'TK-200', 输入: 40000, 缓存: 900000, 输出: 30000 }, // 缓存不计入合计（虚胖防线）
    { 池: 'claude', 单: 'TK-200', 输入: 0, 缓存: 0, 输出: 0 },
    { 池: 'claude', 单: '无此单', 输入: 1, 输出: 1 },
  ] });
  assert.deepEqual(单表.map((x) => x.id).sort(), ['TK-200', 'TK-201'], '只取 完成/已归档');
  const m = Object.fromEntries(单表.map((x) => [x.id, x.实耗token]));
  assert.equal(m['TK-200'], 70000, '输入+输出，缓存不进合计');
  assert.equal(m['TK-201'], 0, '账上没有＝无 token 计量（不计量池），只校时间');
  const 样本 = estimate.比样本(单表);
  assert.equal(样本.时间.length, 2);
  assert.equal(样本.时间[0].比, 2, '1h 实际 ÷ 0.5h 预计');
  assert.equal(样本.token.length, 1, '只有 TK-200 有实耗');
  // 读账缺席（预算闸落空实现）不炸：只剩时间维
  assert.equal(历史样本(root, { 读账: null }).every((x) => x.实耗token >= 0), true);
});

t('机器兜底：落 fm 前复核改写估值 + 台账落「估时校准」事件（晨报按它对账）', () => {
  const root = makeRoot();
  const { 校准落fm, 备校准 } = require('../lib/pm/brain');
  const 表 = estimate.校准表(estimate.比样本([0, 1, 2].map((i) => ({
    fm: { 职能: '程序', 单型: '实现单', 预计时间: '0.5', 预计token: '50000',
      领单时间: `2026-08-1${i}T00:00:00.000Z`, 交付时间: `2026-08-1${i}T01:00:00.000Z` },
    实耗token: 70000,
  }))));
  const fm = { id: 'TK-300', 职能: '程序', 单型: '实现单', 预计时间: '0.25', 预计token: '50000' };
  const 记 = 校准落fm(root, 'TK-300', fm, 表);
  assert.equal(fm.预计时间, '0.5', '0.25 × 2 → 0.5h，就地改写（模型拍的值不作数）');
  assert.equal(fm.预计token, '70000', '5 万 × 1.4 → 7 万');
  assert.equal(记.时间.来源, '同组中位比');
  const 事件 = fs.readFileSync(path.join(root, '项管台账', '事件.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const e = 事件.find((x) => x.类型 === '估时校准');
  assert.ok(e && e.单 === 'TK-300', '落痕：台账有这条事件');
  assert.deepEqual(e.时间, { 校前: 0.25, 校后: 0.5, 系数: 2, 样本数: 3, 来源: '同组中位比' }, '样本数/系数/校前→校后 齐备');
  // 无表（取数失败）→ 不改不记，估值保留模型原值：校准挂了不许把切单带崩
  const fm2 = { 职能: '程序', 单型: '实现单', 预计时间: '0.25', 预计token: '50000' };
  assert.equal(校准落fm(root, 'TK-301', fm2, null), null);
  assert.equal(fm2.预计时间, '0.25');
  // 备校准 在空仓上也出得了表与块（无样本版），不抛
  const b = 备校准(root);
  assert.ok(b.表 && /不得自由拍值/.test(b.块));
});

console.log('全部通过：' + passed + ' 项');
