// progress.test.js — 执行进度百分比纯函数（H108 三大态改道后的口径）：
// 阶段锚点 / 阶段内插值 / 超预期封顶 / QA 关跳段 / 无时长数据回落锚点 / 归档才 100 / 完成定格 99 /
// 判官阶段如实命名 / 三级取数优先级。
// H108 段表：领单5 ｜ 执行5→60(QA开)/75(QA关) ｜ 初检60→75(QA段更名，质检会话驻初检目录) ｜
//           核查75→95(两检+深检并段) ｜ 落袋100。原「你验收」段随 H110 移到验收闸，不在链条里。
const assert = require('node:assert');
const progress = require('../lib/progress');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('progress 执行进度百分比测试（施工令-004/049 · H108 改道）');

const T0 = Date.parse('2026-08-06T10:00:00.000Z');
const 分 = (n) => T0 + n * 60000;
const 起 = new Date(T0).toISOString();

t('阶段锚点（H108）：领单 5 / 执行起 5 / 初检起 60 / 核查起 75 / 完成 99 / 归档落袋 100', () => {
  const base = { 预计时间: '', 阶段起时: null, now: T0 };
  assert.equal(progress.compute({ ...base, state: '在途', kind: null }).百分比, 5, '领单锚点 5%');
  assert.equal(progress.compute({ ...base, state: '在途', kind: '执行' }).百分比, 5, '执行段起点 5%');
  assert.equal(progress.compute({ ...base, state: '初检', kind: '质检' }).百分比, 60, '初检段（QA复核）起点 60%');
  assert.equal(progress.compute({ ...base, state: '核查', kind: '初检' }).百分比, 75, '两检机判驻核查段，起点 75%');
  assert.equal(progress.compute({ ...base, state: '核查', kind: '代核' }).百分比, 75, '深检同段');
  assert.equal(progress.compute({ ...base, state: '完成' }).百分比, 99, 'H108：完成=出口驻留位，判官过而已，不满格');
  assert.equal(progress.compute({ ...base, state: '归档' }).百分比, 100, '归档=落袋才 100%');
});

t('H108 完成驻留位：定格 99、落袋段留 todo、不上预算时钟', () => {
  const r = progress.compute({ state: '完成', 阶段起时: 起, now: 分(600) });
  assert.equal(r.百分比, 99);
  assert.equal(r.阶段, '完成');
  assert.ok(r.阶段名.includes('候验收'), '显示名说清在等验收：' + r.阶段名);
  assert.equal(r.时长来源, '无', '等人签字的时长不由机器编');
  assert.equal(r.段.find((s) => s.名 === '落袋').态, 'todo', '落袋段没走完');
  assert.ok(r.段.filter((s) => s.名 !== '落袋').every((s) => s.态 === 'done'), '判官段全过');
  assert.equal(progress.compute({ state: '废弃' }).百分比, 100, '废弃=终态，条子收口（同旧「归档原因:废弃」显示）');
});

t('时间口径插值：执行跑到预期一半 → 5 + 55×0.5', () => {
  const r = progress.compute({ state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: 起, now: 分(15) });
  assert.equal(r.段内, 0.5);
  assert.equal(r.百分比, 33, '5 + 55×0.5 = 32.5 → 33');
  assert.equal(r.来源, '时间');
  assert.equal(r.时长来源, '工单预计', '执行段第三级兜底：这张单自己的 预计时间');
  assert.equal(r.预期分钟, 30);
  assert.equal(r.耗时分钟, 15);
  assert.equal(progress.compute({ state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: 起, now: 分(20.1) }).百分比, 42);
});

t('判官阶段有活的进度（H100/H108）：初检/核查/仲裁按预算时间推进，不冻在锚点', () => {
  const q = progress.compute({ state: '初检', kind: '质检', 阶段起时: 起, now: 分(12) }); // 缺省初检预期 0.4h=24 分
  assert.equal(q.段内, 0.5);
  assert.equal(q.百分比, 68, '60 + 15×0.5 = 67.5 → 68');
  assert.equal(q.来源, '时间');
  assert.equal(q.时长来源, '配置均时');
  assert.equal(q.判官, true);
  const a = progress.compute({ state: '核查', kind: '代核', 阶段起时: 起, now: 分(9) }); // 核查 0.5h=30 分
  assert.equal(a.百分比, 81, '75 + 20×0.3 = 81');
  assert.deepEqual(a.段.find((s) => s.态 === 'cur'), { 名: '核查', 态: 'cur', 填充: 0.3 });
  // 两检机判（kind 初检）与深检同段同预算——段位一致，条子不跳
  const p = progress.compute({ state: '核查', kind: '初检', 阶段起时: 起, now: 分(15) });
  assert.equal(p.百分比, 85, '75 + 20×0.5 = 85');
  // 仲裁：借核查段位次，走自己的 0.3h 预算
  const arb = progress.compute({ state: '仲裁', kind: '代裁', 阶段起时: 起, now: 分(9) });
  assert.equal(arb.阶段, '仲裁');
  assert.equal(arb.百分比, 85, '75 + 20×(9/18) = 85（仲裁 0.3h=18 分）');
});

t('三级取数：① 滚动均时 压过 ② 配置手配 压过 ③ 工单预计时间', () => {
  const 表 = { [progress.均时键('程序', '执行')]: { 小时: 2, n: 5 }, [progress.均时键('程序', '核查')]: { 小时: 1, n: 4 } };
  const 现场 = { state: '在途', kind: '执行', 职能: '程序', 预计时间: '0.5', 阶段起时: 起 };
  const r = progress.compute({ ...现场, 均时: 表, 阶段均时: { 执行: 5 }, now: 分(60) });
  assert.equal(r.时长来源, '滚动均时');
  assert.equal(r.样本数, 5);
  assert.equal(r.预期分钟, 120, '① 级：同职能×同阶段近 N 单中位 2h，压过手配 5h 与工单 0.5h');
  assert.equal(r.百分比, 33, '5 + 55×(60/120)');
  // ② 级：无滚动样本时吃配置表（手配值压过缺省表）——H108 段名 初检（原 质检）
  const c = progress.compute({ state: '初检', kind: '质检', 职能: '程序', 阶段均时: { 初检: 1 }, 阶段起时: 起, now: 分(30) });
  assert.equal(c.时长来源, '配置均时');
  assert.equal(c.预期分钟, 60, '手配 阶段均时.初检=1h 覆盖缺省 0.4h');
  assert.equal(c.百分比, 68, '60 + 15×0.5');
  // 均时表不跨职能借数：美术单查不到程序单的均时，老实降级
  const 借 = progress.compute({ ...现场, 职能: '美术', 均时: 表, now: 分(60) });
  assert.equal(借.时长来源, '工单预计', '程序|执行 的均时喂不了美术单');
  // ③ 级：执行段回落工单 预计时间（缺省表故意不给 执行 配值，见 lib/progress.js 注释）
  assert.equal(progress.compute({ ...现场, now: 分(15) }).时长来源, '工单预计');
  // 表值容忍裸数字（外部喂进来的旧形态表不炸）
  assert.equal(progress.compute({ ...现场, 均时: { [progress.均时键('程序', '执行')]: 2 }, now: 分(60) }).预期分钟, 120);
});

t('无时长数据 / 无会话起时：停在阶段锚点，编不出来的进度就不编', () => {
  // 执行段：没有工单预计、没有均时、缺省表也不给执行配值 → 三级全空
  const r = progress.compute({ state: '在途', kind: '执行', 预计时间: '', 阶段起时: 起, now: 分(600) });
  assert.equal(r.段内, 0);
  assert.equal(r.百分比, 5, '停在执行段锚点');
  assert.equal(r.来源, '锚点');
  assert.equal(r.时长来源, '无');
  assert.equal(r.超时, false, '没有预期时长就没有超预期可言');
  assert.equal(r.预期分钟, null);
  // 有预算但没有会话起时（单在初检态、判官会话没起）：一样停锚点——
  // 拿领单时间顶上去等于给「卡住的单」编进度，服务端因此只把在跑会话的 startedAt 传进来。
  const 无起 = progress.compute({ state: '初检', kind: '质检', 阶段起时: null, now: 分(600) });
  assert.equal(无起.百分比, 60);
  assert.equal(无起.来源, '锚点');
  assert.equal(无起.耗时分钟, null);
  // 待处理（H108：原 执行失败/待定夺 合并）＝总监分诊台：借核查段位次，不上预算时钟
  const 夺 = progress.compute({ state: '待处理', 阶段起时: 起, now: 分(600) });
  assert.equal(夺.阶段, '定夺');
  assert.equal(夺.时长来源, '无');
  assert.equal(夺.百分比, 75, '借核查段位次显示，不插值');
  assert.ok(夺.阶段名.includes('待处理'), '显示名说人话：' + 夺.阶段名);
});

t('超预期：不回退不越级不装满，停在段上限并报超预期百分比', () => {
  const r = progress.compute({ state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: 起, now: 分(47) });
  assert.equal(r.超时, true, '已耗时 > 预期时长 → 超预期态');
  assert.equal(r.超期pct, 57, '47 / 30 - 1 = 56.7% → 57%');
  assert.equal(r.段内, 1, '段内封顶 1');
  assert.equal(r.百分比, 60, '停在执行段上限 60%（设计稿状态 C）');
  assert.equal(r.阶段名, '执行超预期 · 软超时盯守中');
  assert.equal(r.段.find((s) => s.态 === 'cur').超期pct, 57, '超预期随当前段下发，段名后缀由前端画');
  // 再跑三倍也不越级，只是超得更多
  const 久 = progress.compute({ state: '在途', kind: '执行', 预计时间: '0.5', 阶段起时: 起, now: 分(240) });
  assert.equal(久.百分比, 60);
  assert.equal(久.超期pct, 700);
  // 判官段同待遇：初检（QA复核）超预期照报，条子停在 75 不越级到核查
  const q = progress.compute({ state: '初检', kind: '质检', 阶段起时: 起, now: 分(36) });
  assert.equal(q.超时, true);
  assert.equal(q.超期pct, 50);
  assert.equal(q.百分比, 75);
  assert.ok(q.阶段名.endsWith('超预期'), q.阶段名);
  // 刚好跑满不算超（严格大于才是超）
  assert.equal(progress.compute({ state: '初检', kind: '质检', 阶段起时: 起, now: 分(24) }).超时, false);
});

t('QA 关跳过初检段：执行 5→75%，分段条里没有初检', () => {
  const r = progress.compute({ state: '在途', kind: '执行', QA: '关', 预计时间: '1', 阶段起时: 起, now: 分(60) });
  assert.equal(r.百分比, 75, 'QA 关时执行段上限 75%');
  assert.deepEqual(r.段.map((s) => s.名), ['领单', '执行', '核查', '落袋']);
  const on = progress.compute({ state: '在途', kind: '执行', QA: '开', 预计时间: '1', 阶段起时: 起, now: 分(60) });
  assert.equal(on.百分比, 60, 'QA 开时执行段上限 60%');
  assert.deepEqual(on.段.map((s) => s.名), ['领单', '执行', '初检', '核查', '落袋']);
  // 非标 QA 串按开处理（与 lifecycle fail-closed 同口径）
  assert.equal(progress.compute({ state: '在途', kind: '执行', QA: '是', 预计时间: '1', 阶段起时: 起, now: 分(60) }).百分比, 60);
  assert.equal(progress.compute({ state: '在途', kind: '执行', QA: '关', 预计时间: '1', 阶段起时: 起, now: 分(30) }).百分比, 40, '5 + 70×0.5');
});

t('不落袋不满格：核查段封顶 95、完成 99，只有 归档/废弃 才 100', () => {
  const r = progress.compute({ state: '核查', kind: '代核', 阶段起时: 起, now: 分(999) });
  assert.equal(r.百分比, 95);
  assert.ok(r.百分比 < 100);
  assert.equal(progress.compute({ state: '完成' }).百分比, 99, '完成≠落袋（H108 口径反转的正身）');
  assert.equal(progress.compute({ state: '归档' }).百分比, 100);
  assert.equal(progress.compute({ state: '废弃' }).百分比, 100);
});

t('判官阶段如实命名：不显示成执行，判官标记为真', () => {
  const q = progress.compute({ state: '初检', kind: '质检' });
  assert.equal(q.阶段, '初检'); assert.ok(q.阶段名.startsWith('初检中'), q.阶段名); assert.equal(q.判官, true);
  const p = progress.compute({ state: '核查', kind: '初检' });
  assert.equal(p.阶段, '核查'); assert.equal(p.判官, true);
  const a = progress.compute({ state: '核查', kind: '代核' });
  assert.equal(a.阶段, '核查'); assert.equal(a.阶段名, '核查中 · 深检'); assert.equal(a.判官, true);
  const e = progress.compute({ state: '在途', kind: '执行' });
  assert.equal(e.阶段, '执行'); assert.equal(e.判官, false);
  const arb = progress.compute({ state: '仲裁', kind: '代裁' });
  assert.equal(arb.阶段, '仲裁'); assert.equal(arb.阶段名, '仲裁中'); assert.equal(arb.判官, true);
  // 分段条当前段落在判官段上，执行段已 done
  assert.deepEqual(a.段.filter((s) => s.态 === 'cur').map((s) => s.名), ['核查']);
  assert.deepEqual(a.段.filter((s) => s.态 === 'done').map((s) => s.名), ['领单', '执行', '初检']);
});

t('H100 · 打点退役：tail 里的 [进度 k/n] 不再参与进度，解析器只剩诊断用途', () => {
  const 尾 = '[进度 1/7 起手] 干活干活 [进度 3/7 验收标准2达成] 继续';
  const r = progress.compute({ state: '在途', kind: '执行', tail: 尾, 预计时间: '0.5', 阶段起时: 起, now: 分(15) });
  assert.equal(r.百分比, 33, '打点不参与：这个 33 是 15/30 分推的，不是 3/7');
  assert.equal(r.来源, '时间');
  assert.equal(r.打点, undefined, '打点字段不再随行下发');
  // 无时长数据时也不拿打点凑数：停锚点
  assert.equal(progress.compute({ state: '在途', kind: '执行', tail: 尾, 预计时间: '', 阶段起时: 起, now: 分(15) }).百分比, 5);
  // 解析器仍在（pm/patrol 打点停滞看门狗拿它当活性信号），容错照旧：非法一律忽略不炸
  assert.deepEqual(progress.解析打点(尾), { k: 3, n: 7 }, '取最后一个合法打点');
  assert.equal(progress.解析打点('[进度 5/0 除零]'), null, 'n=0 非法');
  assert.equal(progress.解析打点('[进度 9/3 超额]'), null, 'k>n 非法');
  assert.equal(progress.解析打点('[进度 abc 胡话]'), null, '非数字非法');
  assert.equal(progress.解析打点('[进度]'), null, '缺参非法');
  assert.equal(progress.解析打点(''), null);
  assert.equal(progress.解析打点(null), null);
  assert.equal(progress.解析打点(undefined), null);
  assert.deepEqual(progress.解析打点('[进度 9/3 超额] 又来 [进度 2/5 这条才算]'), { k: 2, n: 5 });
});

t('未进链条（待审/待派/待重派/挂起）不编进度：0% 且全段未到', () => {
  for (const s of ['待审', '待派', '待重派', '挂起']) {
    const r = progress.compute({ state: s });
    assert.equal(r.百分比, 0, s + ' 不编进度');
    assert.equal(r.阶段, '未领单');
    assert.ok(r.段.every((x) => x.态 === 'todo'));
  }
});

/* ===== 滚动均时（① 级取数）：样本抽取 + 中位 ===== */
const 单 = (职能, o) => ({ id: 'X', fm: { 职能, ...o } });
const iso = (h) => new Date(T0 + h * 3600000).toISOString();

t('阶段样本：只从有独立起止戳的阶段取数，缺站不补造', () => {
  const s = progress.阶段样本([
    单('程序', { 领单时间: iso(0), 交付时间: iso(2) }),                                    // 执行 2h
    单('程序', { 领单时间: iso(0), 交付时间: iso(1), 初检: { 时间: iso(2) }, 核查: { 时间: iso(2.5) } }), // 执行 1h + 核查 0.5h
    单('美术', { 领单时间: iso(0), 交付时间: iso(3), 代核: { 时间: iso(4) } }),             // 执行 3h；无初检章 → 核查无起点，不取
    单('程序', { 领单时间: iso(5), 交付时间: iso(1) }),                                    // 交付早于领单：脏数据，不取
    单('程序', {}),                                                                        // 缺戳：不取
  ]);
  assert.deepEqual(s.map((x) => [x.职能, x.阶段, x.小时]),
    [['程序', '执行', 2], ['程序', '执行', 1], ['程序', '核查', 0.5], ['美术', '执行', 3]]);
  assert.deepEqual(progress.阶段样本(null), [], '空入参不炸');
  // QA复核（初检段）没有独立完成戳（过关只改目录状态、覆盖 更新时间），永远不出样本——
  // 宁可走配置缺省值，也不拿含排队等待的跨段差冒充判官时长。
  assert.equal(s.some((x) => x.阶段 === '初检' || x.阶段 === '质检'), false);
});

t('滚动均时：近 N 单中位、样本 <3 不上台、异常时长不进样本', () => {
  const 样 = (小时, 时间) => ({ 职能: '程序', 阶段: '执行', 小时, 时间 });
  const 表 = progress.滚动均时([样(1, iso(1)), 样(3, iso(2)), 样(2, iso(3))]);
  assert.equal(表[progress.均时键('程序', '执行')].小时, 2, '中位 2（均值也是 2，下一格分辨得开）');
  assert.equal(表[progress.均时键('程序', '执行')].n, 3);
  // 中位而非均值：一张跑飞的单（挂起过夜）拉不动中位
  assert.equal(progress.滚动均时([样(1, iso(1)), 样(2, iso(2)), 样(20, iso(3))])[progress.均时键('程序', '执行')].小时, 2);
  // 只取最近 N 单：老单再多也不回头拖累
  const 近 = progress.滚动均时([样(9, iso(1)), 样(9, iso(2)), 样(1, iso(3)), 样(1, iso(4)), 样(1, iso(5))], { N: 3 });
  assert.equal(近[progress.均时键('程序', '执行')].小时, 1);
  assert.equal(近[progress.均时键('程序', '执行')].n, 3);
  // 样本不足 3 不上台（一两张单的中位不叫均时，降级到配置表）
  assert.deepEqual(progress.滚动均时([样(1, iso(1)), 样(2, iso(2))]), {});
  // 超 24h / 零负时长不进样本：那是挂起、跨夜滞留或脏数据，不是真干活时长
  assert.deepEqual(progress.滚动均时([样(30, iso(1)), 样(48, iso(2)), 样(0, iso(3)), 样(-1, iso(4))]), {});
  assert.deepEqual(progress.滚动均时(null), {}, '空入参不炸');
  // 端到端：样本 → 均时表 → compute 吃到 ① 级取数
  const 表2 = progress.滚动均时(progress.阶段样本([
    单('程序', { 领单时间: iso(0), 交付时间: iso(2) }),
    单('程序', { 领单时间: iso(3), 交付时间: iso(5) }),
    单('程序', { 领单时间: iso(6), 交付时间: iso(8) }),
  ]));
  const r = progress.compute({ state: '在途', kind: '执行', 职能: '程序', 均时: 表2, 阶段起时: 起, now: 分(60) });
  assert.equal(r.时长来源, '滚动均时');
  assert.equal(r.预期分钟, 120);
  assert.equal(r.百分比, 33);
});

console.log(`全部通过：${passed} 项`);
