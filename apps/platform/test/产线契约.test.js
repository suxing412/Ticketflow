// 产线契约测试（协-004）：依赖集成 / 调度并发 / 巡检告警
//
// 这三块的共同点是**错了不会报错**：依赖没接上只会让子单拿到缺半截的工作区，
// 并发闸算错只会多烧一份钱，巡检漏了只会让卡单一直躺着。
// 全是安静的失败，所以必须有断言主动去问。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
const 调度 = require(path.join(平台根, 'lib', '调度.js'));
const 巡检 = require(path.join(平台根, 'lib', '巡检.js'));
const 派单 = require(path.join(平台根, 'lib', '派单.js'));
const 工单库 = require(path.join(平台根, 'lib', '工单库.js'));

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('产线契约测试');

// ---- 依赖就绪 ----
const 沙盒 = fs.mkdtempSync(path.join(os.tmpdir(), 'line-'));
工单库.建目录(沙盒);
工单库.create(沙盒, 'D-1', { id: 'D-1', role: 'backend', title: '上游' }, '');
工单库.create(沙盒, 'D-2', { id: 'D-2', role: 'backend', title: '下游', 依赖: ['D-1'] }, '');
工单库.create(沙盒, 'D-3', { id: 'D-3', role: 'backend', title: '依赖幽灵', 依赖: ['不存在'] }, '');

t('依赖未完成时拒派，并点名卡在谁身上', () => {
  const r = 派单.依赖就绪(工单库, 沙盒, 工单库.find(沙盒, 'D-2'));
  assert.equal(r.ok, false);
  assert.ok(/D-1\(草稿\)/.test(r.error), '要写清卡在哪张、什么状态：' + r.error);
  assert.deepEqual(r.未完成.map((x) => x.id), ['D-1']);
});

t('依赖找不到时也拒派，且与「未完成」分开报', () => {
  const r = 派单.依赖就绪(工单库, 沙盒, 工单库.find(沙盒, 'D-3'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.缺失, ['不存在']);
  assert.ok(/找不到/.test(r.error), r.error);
});

t('依赖全完成才放行，并把依赖单交出去（integrate 要用）', () => {
  工单库.move(沙盒, 'D-1', '草稿', '待投');
  工单库.move(沙盒, 'D-1', '待投', '在途');
  工单库.move(沙盒, 'D-1', '在途', '完成', (fm) => { fm.workspace = { commit: 'a'.repeat(40) }; });
  const r = 派单.依赖就绪(工单库, 沙盒, 工单库.find(沙盒, 'D-2'));
  assert.equal(r.ok, true);
  assert.equal(r.依赖单.length, 1);
  assert.equal(r.依赖单[0].fm.workspace.commit.length, 40,
    'integrate 靠 fm.workspace.commit 找上游产出——只写 fm.检查点 它会静默跳过');
});

t('无依赖的单直接放行', () => {
  assert.equal(派单.依赖就绪(工单库, 沙盒, 工单库.find(沙盒, 'D-1')).ok, true);
});

// ---- 调度并发 ----
t('并发上限默认 1（并发是显式决定，不是默认姿态）', () => {
  assert.equal(调度.并发上限({}, 'claude'), 1, '缺配置必须是 1——默认并发等于默认多烧钱');
  assert.equal(调度.并发上限({ 执行: { 并发: { 默认: 3 } } }, 'claude'), 3);
  assert.equal(调度.并发上限({ 执行: { 并发: { 默认: 3, claude: 1 } } }, 'claude'), 1, '池级覆盖默认');
  assert.equal(调度.并发上限({ 执行: { 并发: { 默认: 0 } } }, 'x'), 1, '0 或负数按 1 兜底，不能变成不限');
});

t('排一轮：按优先级与创建时间排序，先来先服务', () => {
  const 待 = [
    { id: 'b', fm: { 优先级: 'P1', 创建时间: '2026-01-02' } },
    { id: 'a', fm: { 优先级: 'P0', 创建时间: '2026-01-03' } },
    { id: 'c', fm: { 优先级: 'P1', 创建时间: '2026-01-01' } },
  ];
  const r = 调度.排一轮({ 执行: { 并发: { 默认: 9 } } }, {
    待投表: 待, 在跑: {}, 依赖就绪: () => true, 选池: () => 'claude',
  });
  assert.deepEqual(r.派.map((x) => x.id), ['a', 'c', 'b'], 'P0 先；同级里老单先，防新单插队饿死老单');
});

t('排一轮：并发满了就停，且逐条说清为什么', () => {
  const 待 = [{ id: 'x', fm: {} }, { id: 'y', fm: {} }];
  const r = 调度.排一轮({ 执行: { 并发: { 默认: 1 } } }, {
    待投表: 待, 在跑: {}, 依赖就绪: () => true, 选池: () => 'claude',
  });
  assert.equal(r.派.length, 1);
  assert.equal(r.跳过.length, 1);
  assert.ok(/并发上限 1/.test(r.跳过[0].原因), '跳过必须给原因，否则「为什么没派」只能靠猜：' + r.跳过[0].原因);
});

t('排一轮：已在跑的占额度', () => {
  const r = 调度.排一轮({ 执行: { 并发: { 默认: 2 } } }, {
    待投表: [{ id: 'x', fm: {} }], 在跑: { claude: 2 }, 依赖就绪: () => true, 选池: () => 'claude',
  });
  assert.equal(r.派.length, 0, '在跑的必须计入占用，否则并发闸形同虚设');
});

t('排一轮：依赖未就绪与无可用 Provider 分开报', () => {
  const r = 调度.排一轮({}, {
    待投表: [{ id: 'x', fm: {} }, { id: 'y', fm: {} }],
    在跑: {}, 依赖就绪: (t2) => t2.id !== 'x', 选池: (t2) => (t2.id === 'y' ? null : 'claude'),
  });
  assert.equal(r.派.length, 0);
  assert.ok(/依赖未就绪/.test(r.跳过.find((s) => s.id === 'x').原因));
  assert.ok(/无可用 Provider/.test(r.跳过.find((s) => s.id === 'y').原因));
});

t('统计在跑：按执行池分组', () => {
  const 在 = 调度.统计在跑([
    { id: '1', fm: { 执行池: 'claude' } }, { id: '2', fm: { 执行池: 'claude' } }, { id: '3', fm: { 执行池: 'codex' } },
  ]);
  assert.deepEqual(在, { claude: 2, codex: 1 });
});

// ---- 巡检 ----
const 现在 = Date.parse('2026-08-10T12:00:00.000Z');
t('卡在途：超时报急，且说清后果', () => {
  const 告 = 巡检.卡在途([{ id: 'T', fm: { 派单时间: '2026-08-10T11:00:00.000Z' } }], 现在, 30 * 60 * 1000);
  assert.equal(告.length, 1);
  assert.equal(告[0].级别, '急');
  assert.ok(/占着并发额度/.test(告[0].说明), '要说清后果，不然人不知道为什么该管它：' + 告[0].说明);
});

t('卡在途：没到阈值不报；无派单时间单独报常级', () => {
  assert.equal(巡检.卡在途([{ id: 'T', fm: { 派单时间: '2026-08-10T11:50:00.000Z' } }], 现在, 30 * 60 * 1000).length, 0);
  const 无 = 巡检.卡在途([{ id: 'T', fm: {} }], 现在, 30 * 60 * 1000);
  assert.equal(无[0].级别, '常', '判断不了跑多久不等于出事，别拿急级淹没真告警');
});

t('零派发：有待投却一张没派 → 急，并带原因分布', () => {
  const 告 = 巡检.零派发(3, 0, [{ 原因: '依赖未就绪' }, { 原因: '依赖未就绪' }, { 原因: '池 claude 已达并发上限 1' }]);
  assert.equal(告.length, 1);
  assert.equal(告[0].级别, '急');
  assert.ok(/依赖未就绪×2/.test(告[0].说明), '原因要聚合计数，一眼看出主因：' + 告[0].说明);
  assert.equal(巡检.零派发(3, 1, []).length, 0, '派出去了就不报');
  assert.equal(巡检.零派发(0, 0, []).length, 0, '没待投也不报——没活干不是异常');
});

t('依赖死结：缺失与互依都要抓出来', () => {
  const 全 = [
    { id: 'A', state: '待投', fm: { 依赖: ['B'] } },
    { id: 'B', state: '待投', fm: { 依赖: ['A'] } },
    { id: 'C', state: '待投', fm: { 依赖: ['幽灵'] } },
  ];
  const 告 = 巡检.依赖死结(全);
  assert.ok(告.some((x) => x.类型 === '依赖成环'), '互依必须抓——两张都永远不会就绪');
  assert.ok(告.some((x) => x.类型 === '依赖缺失'), '依赖不存在也必须抓');
  assert.ok(告.every((x) => x.级别 === '急'));
});

t('依赖死结：已完成的单不参与判定', () => {
  assert.equal(巡检.依赖死结([{ id: 'A', state: '完成', fm: { 依赖: ['幽灵'] } }]).length, 0,
    '已完成的单再报依赖问题是噪音');
});

t('预算冻结报常级（闸住是设计行为，但人得知道）', () => {
  const 告 = 巡检.预算告警({ claude: '日 token 超限' });
  assert.equal(告[0].级别, '常');
  assert.ok(/顺位到别家或积压/.test(告[0].说明), '要说清它对产线的影响');
});

t('巡一轮把四类合起来', () => {
  const 全 = [
    { id: 'T', state: '在途', fm: { 派单时间: '2026-08-10T10:00:00.000Z' } },
    { id: 'W', state: '待投', fm: {} },
  ];
  const 告 = 巡检.巡一轮({}, { 全部工单: 全, 现在, 冻结: { codex: 'x' }, 本轮派出: 0, 本轮跳过: [{ 原因: 'a' }] });
  const 类 = 告.map((x) => x.类型);
  assert.ok(类.includes('在途超时') && 类.includes('零派发') && 类.includes('预算冻结'));
});

fs.rmSync(沙盒, { recursive: true, force: true });
console.log(`全部通过：${passed} 项`);
