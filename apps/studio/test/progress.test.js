// progress.test.js — 执行进度百分比纯函数（施工令-004）：阶段锚点 / 阶段内插值 / 超时封顶 /
// QA 关跳段 / 无预计时间回落锚点 / 非落袋≠100 / 判官阶段如实命名 / 打点协议解析容错。
//
// 施工令-041 §四口径修订（巡礼 F2：同一张单 49% vs 28%）：百分比只由会话打点产生，
// 无打点一律停在阶段锚点。时间口径没删，降级为显式开关 `时间折算:true`——
// 004 设计稿的状态 A/B/C 三格仍逐值可复现（下方带 折 标记的用例就是它们），
// 只是生产两个下发口（/api/runner /api/agents）不再开它。
const assert = require('node:assert');
const progress = require('../lib/progress');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('progress 执行进度百分比测试（施工令-004 · 041 §四修订）');

const T0 = Date.parse('2026-08-06T10:00:00.000Z');
const 分 = (n) => T0 + n * 60000;
const 折 = { 时间折算: true }; // 旧时间口径：显式开才生效

t('阶段锚点：领单 5 / 执行起 5 / 质检起 60 / 初检起 75 / 核查起 80 / 落袋 100', () => {
  const base = { 预计时间: '', 阶段起时: null, now: T0 };
  assert.equal(progress.compute({ ...base, state: '在途', kind: null }).百分比, 5, '领单锚点 5%');
  assert.equal(progress.compute({ ...base, state: '在途', kind: '执行' }).百分比, 5, '执行段起点 5%');
  assert.equal(progress.compute({ ...base, state: '质检', kind: '质检' }).百分比, 60, '质检段起点 60%');
  assert.equal(progress.compute({ ...base, state: '待验收', kind: '初检' }).百分比, 75, '初检段起点 75%');
  assert.equal(progress.compute({ ...base, state: '待验收', kind: '代核' }).百分比, 80, '核查段起点 80%');
  assert.equal(progress.compute({ ...base, state: '完成' }).百分比, 100, '真落袋才 100%');
});

t('折 · 阶段内插值：执行跑到预估一半 → 5 + 55×0.5（设计稿口径复核）', () => {
  const r = progress.compute({ state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: new Date(T0).toISOString(), now: 分(15), ...折 });
  assert.equal(r.段内, 0.5);
  assert.equal(r.百分比, 33, '5 + 55×0.5 = 32.5 → 33');
  assert.equal(r.来源, '时间');
  // 设计稿状态 A：执行段内 67% → 42%
  const a = progress.compute({ state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: new Date(T0).toISOString(), now: 分(20.1), ...折 });
  assert.equal(a.百分比, 42, '设计稿状态 A 的 42% 对得上');
  // 设计稿状态 B：核查段内 47% → 87%
  const b = progress.compute({ state: '待验收', kind: '代核', 预计时间: '1', 阶段起时: new Date(T0).toISOString(), now: 分(28.2), ...折 });
  assert.equal(b.百分比, 87, '设计稿状态 B 的 87% 对得上');
});

// 施工令-041 §四：生产口径（不开 时间折算）——巡礼 F2 的「49% vs 28%」正死在这一格。
// 同一现场，旧口径按耗时报 33%，新口径老实停在锚点 5%，而超时告警一分不少。
t('041 §四 · 生产口径：无打点不按耗时折算，停在阶段锚点（超时照报）', () => {
  const 现场 = { state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: new Date(T0).toISOString() };
  const r = progress.compute({ ...现场, now: 分(15) });
  assert.equal(r.段内, 0, '不插值');
  assert.equal(r.百分比, 5, '停在执行段锚点——编不出来的进度就不编');
  assert.equal(r.来源, '锚点');
  assert.equal(r.锚点, 5, '锚点随行下发，前端才说得出这个数怎么来的');
  const 超 = progress.compute({ ...现场, now: 分(47) });
  assert.equal(超.超时, true, '超时判据仍吃 耗时 vs 预估——那是告警，不是进度');
  assert.equal(超.百分比, 5, '超时也不把百分比顶上去（顶上去就又成了时间折算）');
  assert.equal(超.阶段名, '执行超预估 · 软超时盯守中');
  // 有打点则一切照旧：百分比只认打点
  const 有点 = progress.compute({ ...现场, now: 分(47), tail: '[进度 3/7 验收标准2达成]' });
  assert.equal(有点.来源, '打点');
  assert.equal(有点.百分比, Math.round(5 + 55 * (3 / 7)));
});

t('折 · 超时封顶：跑过预估不回退、不越级，停在本阶段上限并标超时', () => {
  const r = progress.compute({ state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: new Date(T0).toISOString(), now: 分(47), ...折 });
  assert.equal(r.超时, true, '耗时 ≥ 预估 → 超时态');
  assert.equal(r.段内, 1, '段内封顶 1');
  assert.equal(r.百分比, 60, '停在执行段上限 60%（设计稿状态 C）');
  assert.equal(r.阶段名, '执行超预估 · 软超时盯守中');
  // 再跑三倍也不越级
  assert.equal(progress.compute({ state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: new Date(T0).toISOString(), now: 分(240), ...折 }).百分比, 60);
});

t('QA 关跳过质检段：执行 5→75%，分段条里没有质检', () => {
  const r = progress.compute({ state: '在途', kind: '执行', QA: '关', 预计时间: '1', 阶段起时: new Date(T0).toISOString(), now: 分(60), ...折 });
  assert.equal(r.百分比, 75, 'QA 关时执行段上限 75%');
  assert.deepEqual(r.段.map((s) => s.名), ['领单', '执行', '初检', '核查', '落袋']);
  const on = progress.compute({ state: '在途', kind: '执行', QA: '开', 预计时间: '1', 阶段起时: new Date(T0).toISOString(), now: 分(60), ...折 });
  assert.equal(on.百分比, 60, 'QA 开时执行段上限 60%');
  assert.deepEqual(on.段.map((s) => s.名), ['领单', '执行', '质检', '初检', '核查', '落袋']);
  // 非标 QA 串按开处理（与 lifecycle fail-closed 同口径）
  assert.equal(progress.compute({ state: '在途', kind: '执行', QA: '是', 预计时间: '1', 阶段起时: new Date(T0).toISOString(), now: 分(60), ...折 }).百分比, 60);
  // 打点口径下同样跳段（生产口径复核：QA 关时 7/7 打点顶到 75 而不是 60）
  assert.equal(progress.compute({ state: '在途', kind: '执行', QA: '关', tail: '[进度 7/7 收工]' }).百分比, 75);
});

t('无预计时间：阶段内不插值，直接显示阶段锚点（不编数字）', () => {
  const r = progress.compute({ state: '在途', kind: '执行', 预计时间: '', 阶段起时: new Date(T0).toISOString(), now: 分(600) });
  assert.equal(r.段内, 0);
  assert.equal(r.百分比, 5, '停在执行段锚点');
  assert.equal(r.超时, false, '没有预估就没有超时可言');
  assert.equal(progress.compute({ state: '待验收', kind: '代核', 预计时间: null, 阶段起时: new Date(T0).toISOString(), now: 分(600) }).百分比, 80);
});

t('折 · 非落袋永不 100%：核查段封顶 95，只有完成/已归档才 100', () => {
  const r = progress.compute({ state: '待验收', kind: '代核', 预计时间: '0.1', 阶段起时: new Date(T0).toISOString(), now: 分(999), ...折 });
  assert.equal(r.百分比, 95);
  assert.ok(r.百分比 < 100);
  assert.equal(progress.compute({ state: '完成' }).百分比, 100);
  assert.equal(progress.compute({ state: '已归档' }).百分比, 100);
});

t('判官阶段如实命名：不显示成执行，判官标记为真', () => {
  const q = progress.compute({ state: '质检', kind: '质检' });
  assert.equal(q.阶段, '质检'); assert.equal(q.阶段名, '质检中'); assert.equal(q.判官, true);
  const p = progress.compute({ state: '待验收', kind: '初检' });
  assert.equal(p.阶段, '初检'); assert.ok(p.阶段名.startsWith('初检中')); assert.equal(p.判官, true);
  const a = progress.compute({ state: '待验收', kind: '代核' });
  assert.equal(a.阶段, '核查'); assert.equal(a.阶段名, '核查中 · 深检'); assert.equal(a.判官, true);
  const e = progress.compute({ state: '在途', kind: '执行' });
  assert.equal(e.阶段, '执行'); assert.equal(e.判官, false);
  // 分段条当前段落在判官段上，执行段已 done
  assert.deepEqual(a.段.filter((s) => s.态 === 'cur').map((s) => s.名), ['核查']);
  assert.deepEqual(a.段.filter((s) => s.态 === 'done').map((s) => s.名), ['领单', '执行', '质检', '初检']);
});

t('验收方式=保留：判官两段并作「你验收」75→95，不假装有判官在跑', () => {
  const r = progress.compute({ state: '待验收', 验收方式: '保留' });
  assert.deepEqual(r.段.map((s) => s.名), ['领单', '执行', '质检', '你验收', '落袋']);
  assert.equal(r.百分比, 75);
  assert.equal(r.阶段名, '待你验收');
});

t('打点协议：取 tail 最后一个合法打点，执行段内填充 = k/n', () => {
  const 尾 = '[进度 1/7 起手] 干活干活 [进度 3/7 验收标准2达成] 继续';
  const r = progress.compute({ state: '在途', kind: '执行', tail: 尾, 预计时间: '10', 阶段起时: new Date(T0).toISOString(), now: 分(1) });
  assert.deepEqual(r.打点, { k: 3, n: 7 });
  assert.equal(r.百分比, Math.round(5 + 55 * (3 / 7)), '打点口径压过时间口径');
  // 打点 = n/n 也只到执行段上限，不越级
  assert.equal(progress.compute({ state: '在途', kind: '执行', tail: '[进度 7/7 收工]' }).百分比, 60);
});

t('打点容错：非法打点一律忽略不炸，回落时间口径', () => {
  assert.equal(progress.解析打点('[进度 5/0 除零]'), null, 'n=0 非法');
  assert.equal(progress.解析打点('[进度 9/3 超额]'), null, 'k>n 非法');
  assert.equal(progress.解析打点('[进度 abc 胡话]'), null, '非数字非法');
  assert.equal(progress.解析打点('[进度]'), null, '缺参非法');
  assert.equal(progress.解析打点(''), null);
  assert.equal(progress.解析打点(null), null);
  assert.equal(progress.解析打点(undefined), null);
  assert.deepEqual(progress.解析打点('[进度 9/3 超额] 又来 [进度 2/5 这条才算]'), { k: 2, n: 5 }, '非法忽略后取最后一个合法的');
  // 全非法 → 当没有打点：开了时间折算就回落时间口径，不开就停锚点。两条都不许抛
  const r = progress.compute({ state: '在途', kind: '执行', tail: '[进度 5/0][进度 9/3]', 预计时间: '0.5', 阶段起时: new Date(T0).toISOString(), now: 分(15), ...折 });
  assert.equal(r.打点, null);
  assert.equal(r.百分比, 33, '折算开：回落到时间口径');
  const r2 = progress.compute({ state: '在途', kind: '执行', tail: '[进度 5/0][进度 9/3]', 预计时间: '0.5', 阶段起时: new Date(T0).toISOString(), now: 分(15) });
  assert.equal(r2.百分比, 5, '生产口径：停在锚点');
  // 打点是软契约：没有也不报错、不惩罚
  assert.equal(progress.compute({ state: '在途', kind: '执行', tail: '普通输出没有打点' }).打点, null);
});

t('打点只管执行段：判官段不吃执行方的打点', () => {
  const r = progress.compute({ state: '待验收', kind: '代核', tail: '[进度 1/2 判官在数]', 预计时间: '1', 阶段起时: new Date(T0).toISOString(), now: T0 });
  assert.equal(r.打点, null);
  assert.equal(r.百分比, 80, '判官段回落时间口径（刚起 → 锚点）');
});

t('未领单（草稿/待投/池）不编进度：0% 且全段未到', () => {
  const r = progress.compute({ state: '待投' });
  assert.equal(r.百分比, 0);
  assert.equal(r.阶段, '未领单');
  assert.ok(r.段.every((s) => s.态 === 'todo'));
});

console.log(`全部通过：${passed} 项`);
