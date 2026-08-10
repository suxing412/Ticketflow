// schedule-view.test.js — 排程三消费 + 工程队卡直读（施工令-041 §六.1）
// 被测面：
//   ① 5 态（计划/起草中/已成单/完成/撤销）× 3 消费（流程页/总览摘要/晨晚报切片）= 15 组呈现断言
//   ② Q 队列分流（批无管线 → 监制台维护队列，不混进产品管线行）
//   ③ crew 直读三态（在做/完工/目录空）
// 纪律：全程纯函数级，不起浏览器也不起 server——呈现判据本来就该能脱离 DOM 被问责。
// 五态的**呈现差异**是本令的核心口径，所以逐态逐消费各写一条，不合并成循环：
// 合并之后某一格挂了，报错信息只会说「第 3 轮不符」，而不是「已成单不该出现在流程页」。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const V = require('../lib/pm/schedule-view');
const crew = require('../lib/crew');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('schedule-view 三消费接线 + crew 直读测试（施工令-041）');

// ---- 造粒：字段口径与 schedule.现态() 下发的现态逐字一致 ----
const 当日 = new Date(2026, 7, 11, 10, 0, 0).toISOString();   // 本地 2026-08-11 10:00
const 昨日 = new Date(2026, 7, 10, 10, 0, 0).toISOString();
const NOW = new Date(2026, 7, 11, 20, 0, 0).getTime();        // 本地 2026-08-11 20:00（晚报时分）
const 粒 = (状态, o = {}) => ({
  粒ID: o.粒ID || 'g-' + 状态,
  批: o.批 === undefined ? '批C' : o.批,
  序: o.序 === undefined ? 1 : o.序,
  题: o.题 || '面单·' + 状态,
  状态,
  管线: o.管线 === undefined ? 'P-3' : o.管线,
  依赖: [],
  池衡建议: o.池衡建议 || null,
  预估单元: o.预估单元 === undefined ? 2 : o.预估单元,
  来源: o.来源 || '总清单.md §3 批C',
  单号: ['已成单', '完成'].includes(状态) ? (o.单号 || 'TK-127') : (o.单号 || null),
  版本号: 1,
  登记时刻: o.更新时刻 || 当日,
  更新时刻: o.更新时刻 || 当日,
});
const 五态 = ['计划', '起草中', '已成单', '完成', '撤销'];
const 全谱 = () => 五态.map((s) => 粒(s));
const 流程题 = (r) => [...Object.values(r.管线行).flat(), ...r.维护队列].map((c) => c.题);
const 切片今日 = (粒们, o) => V.切片(粒们, { 日: 'today', now: NOW, ...(o || {}) });

// ================= 消费① 流程页（5 态）=================
t('流程页 × 计划：进管线行，徽章「计划」，提示带来源与预估', () => {
  const r = V.流程页(全谱());
  const c = r.管线行['P-3'].find((x) => x.状态 === '计划');
  assert.ok(c, '计划粒必须出现在本管线的「接下来」里——这正是本令要修的「队列看不见」');
  assert.equal(c.徽章, '计划');
  assert.ok(c.提示.includes('总清单.md §3 批C'), '提示应带来源：' + c.提示);
  assert.ok(c.提示.includes('2 单元'), '提示应带预估：' + c.提示);
});

t('流程页 × 起草中：进管线行，徽章「起草中」（与纯计划一眼可分）', () => {
  const c = V.流程页(全谱()).管线行['P-3'].find((x) => x.状态 === '起草中');
  assert.ok(c, '起草中仍未成单，照样属于「接下来」');
  assert.equal(c.徽章, '起草中');
});

t('流程页 × 已成单：不出现（工单条才是它此刻的脸，画两条＝同一件事数两遍）', () => {
  assert.ok(!流程题(V.流程页(全谱())).includes('面单·已成单'));
});

t('流程页 × 完成：不出现（活已落袋，去沉淀抽屉找）', () => {
  assert.ok(!流程题(V.流程页(全谱())).includes('面单·完成'));
});

t('流程页 × 撤销：不出现（已决定不做，不占版面）', () => {
  assert.ok(!流程题(V.流程页(全谱())).includes('面单·撤销'));
});

// ================= 消费② 总览摘要条（5 态）=================
const 摘 = (粒们, o) => V.摘要({ 在跑: [{ id: 'TK-135', title: '汉代地图批B收尾' }], 粒们, 待签: 3, ...(o || {}) });
t('摘要 × 计划：计入「接下来」，并作为下一项题出场', () => {
  const s = 摘([粒('计划', { 题: '批C 面单二' })]);
  assert.equal(s.接下来, 1);
  assert.equal(s.下一项题, '批C 面单二');
  assert.equal(s.文, '现在在做 1（汉代地图批B收尾） → 接下来 1 项（批C 面单二） → 等你 3 项');
});

t('摘要 × 起草中：计入「接下来」（还没成单就还是接下来的活）', () => {
  assert.equal(摘([粒('起草中')]).接下来, 1);
});

t('摘要 × 已成单：不计（它已经在工单池里被数过一遍）', () => {
  const s = 摘([粒('已成单')]);
  assert.equal(s.接下来, 0);
  assert.equal(s.文, '现在在做 1（汉代地图批B收尾） → 接下来无计划 → 等你 3 项');
});

t('摘要 × 完成：不计', () => { assert.equal(摘([粒('完成')]).接下来, 0); });

t('摘要 × 撤销：不计', () => { assert.equal(摘([粒('撤销')]).接下来, 0); });

// ================= 消费③ 晨晚报切片（5 态）=================
t('切片 × 计划（当日登记）：进当日变更；非当日的计划粒落「计划」段', () => {
  const r = 切片今日([粒('计划'), 粒('计划', { 粒ID: 'g-老计划', 题: '批D 校色', 更新时刻: 昨日 })]);
  assert.deepEqual(r.变更.map((c) => c.题), ['面单·计划'], '当日登记＝当日变更');
  assert.deepEqual(r.计划.map((c) => c.题), ['批D 校色'], '老计划粒进「计划」段供晨报组稿');
  assert.equal(r.日, '2026-08-11');
});

t('切片 × 起草中：当日转起草中 → 进变更（晨报要说得出「今天开了什么草稿」）', () => {
  assert.deepEqual(切片今日([粒('起草中')]).变更.map((c) => c.状态), ['起草中']);
});

t('切片 × 已成单：当日成单 → 进变更（带单号，晚报可点名）', () => {
  const c = 切片今日([粒('已成单')]).变更[0];
  assert.equal(c.状态, '已成单');
  assert.equal(c.单号, 'TK-127');
  // 徽章跟着状态走：写死「计划」的话，晚报里一条已成单的粒会挂着「计划」牌子（本令冒烟实测抓到）
  assert.equal(c.徽章, '已成单');
});

t('切片 × 完成：当日完成 → 进变更（这是晚报的落袋段）', () => {
  assert.deepEqual(切片今日([粒('完成')]).变更.map((c) => c.状态), ['完成']);
});

t('切片 × 撤销：当日撤销 → 进变更（今天砍了什么也得报，不许静默消失）', () => {
  assert.deepEqual(切片今日([粒('撤销')]).变更.map((c) => c.状态), ['撤销']);
});

// ================= 分流与边界 =================
t('Q 队列（批无管线）不进管线行，落「监制台维护队列」', () => {
  const r = V.流程页([粒('计划', { 粒ID: 'g-q', 批: 'Q队列', 序: 2, 题: '排程台账后端', 管线: null }), 粒('计划')]);
  assert.deepEqual(r.维护队列.map((c) => c.题), ['排程台账后端']);
  assert.deepEqual(r.管线行['P-3'].map((c) => c.题), ['面单·计划'], 'Q 队列粒不许混进产品管线的接下来');
  assert.deepEqual(r.计数, { 管线: 1, 维护: 1 });
  assert.equal(r.总数, 2);
});

t('流程页：入参已按 批/序 排好，分桶不重排（排序口径唯一在 040）', () => {
  const r = V.流程页([粒('计划', { 粒ID: 'a', 序: 1, 题: '一' }), 粒('计划', { 粒ID: 'b', 序: 2, 题: '二' }), 粒('计划', { 粒ID: 'c', 序: 3, 题: '三' })]);
  assert.deepEqual(r.管线行['P-3'].map((c) => c.题), ['一', '二', '三']);
});

t('摘要空态：三段各有各的空话术，不渲染成「在做 0（）」', () => {
  const s = V.摘要({ 在跑: [], 粒们: [粒('完成')], 待签: 0 });
  assert.equal(s.文, '现在无在做 → 接下来无计划 → 无待你处理');
  assert.equal(s.首条题, null);
  assert.equal(s.下一项题, null);
});

t('切片：计划段封顶 N 条并如实报截断数（晨报组稿不被 50 条计划淹掉）', () => {
  const 多 = Array.from({ length: 8 }, (_, i) => 粒('计划', { 粒ID: 'g' + i, 序: i, 题: '计划' + i, 更新时刻: 昨日 }));
  const r = 切片今日(多, { 上限: 3 });
  assert.equal(r.计划.length, 3);
  assert.equal(r.计数.计划, 8);
  assert.equal(r.计数.计划已截, 5);
});

t('切片按本地日切：UTC 串前 10 位当日期会差一整天（东八区实测）', () => {
  const 凌晨 = new Date(2026, 7, 11, 1, 0, 0).toISOString(); // 本地 8/11 01:00 → UTC 仍是 8/10
  assert.equal(V.本地日(凌晨), '2026-08-11');
  assert.deepEqual(切片今日([粒('完成', { 更新时刻: 凌晨 })]).变更.length, 1);
});

// ================= 工程队卡直读（施工令-041 §五）=================
const 造队 = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-'));
  for (const [n, s] of Object.entries(files)) fs.writeFileSync(path.join(d, n), s || '# ' + n, 'utf8');
  return d;
};

t('crew 直读 · 在做：最新施工令有、同号回执没有 → 状态=在做', () => {
  const d = 造队({ '施工令-040-排程台账A.md': '', '回执-040.md': '', '施工令-041-排程台账B.md': '' });
  const c = crew.read(d);
  assert.equal(c.施工令, '041', '序号最大者为最新（不看 mtime：补写旧令注释会把老卡顶到最前）');
  assert.equal(c.名称, '排程台账B');
  assert.equal(c.状态, '在做');
  assert.ok(!Number.isNaN(Date.parse(c.更新时间)), '更新时间取施工令 mtime：' + c.更新时间);
});

t('crew 直读 · 完工：同号回执在 → 状态=完工，时间取回执 mtime', () => {
  const d = 造队({ '施工令-040-排程台账A.md': '', '回执-040.md': '' });
  const c = crew.read(d);
  assert.equal(c.施工令, '040');
  assert.equal(c.状态, '完工');
  assert.equal(c.更新时间, fs.statSync(path.join(d, '回执-040.md')).mtime.toISOString());
});

t('crew 直读 · 目录空 / 无施工令 / 不存在 → null（生产部署没有这个目录，整卡不渲染）', () => {
  assert.equal(crew.read(造队({})), null);
  assert.equal(crew.read(造队({ '调研-引擎通道路径选型.md': '', '状态.json': '{}' })), null, '状态.json 已作废，不再是任何判据');
  assert.equal(crew.read(path.join(os.tmpdir(), '压根不存在-' + Date.now())), null);
  assert.doesNotThrow(() => crew.read(), '读默认目录永不抛错（在不在都一样）');
});

t('crew 直读 · 传文件路径退化成读其所在目录（老调用方传 状态.json 不炸）', () => {
  const d = 造队({ '施工令-041-排程台账B.md': '', '状态.json': '{}' });
  assert.equal(crew.read(path.join(d, '状态.json')).施工令, '041');
});

console.log('全部通过：' + passed + ' 项');
