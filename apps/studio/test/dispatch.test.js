// dispatch.test.js — 派发引擎：就绪判定/排序/护城河/硬顶/挑单
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRoot, seed } = require('./helper');
const store = require('../lib/core/store');
const D = require('../lib/pm/dispatch');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('dispatch 派发引擎测试');

const CFG = { 执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', '装配'] } } };

t('就绪盘点：只收已放行+依赖就绪的待派单（H108：完成/无因归档=就绪）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'A-1', 职能: '程序', 放行: true });
  seed(root, '待派', { id: 'A-2', 职能: '程序' }); // 未放行
  seed(root, '待派', { id: 'A-3', 职能: '程序', 放行: true, 依赖: 'A-9' });
  seed(root, '在途', { id: 'A-9', 职能: '程序', 主办: 'x', 领单时间: new Date().toISOString() }); // 依赖未就绪
  seed(root, '待派', { id: 'A-4', 职能: '程序', 放行: true, 依赖: 'A-8' });
  seed(root, '完成', { id: 'A-8', 职能: '程序' });
  seed(root, '待派', { id: 'A-5', 职能: '程序', 放行: true, 依赖: 'A-7' });
  seed(root, '归档', { id: 'A-7', 职能: '程序' }); // 无因归档=落袋，解除依赖
  seed(root, '待派', { id: 'A-6', 职能: '程序', 放行: true, 依赖: 'A-0' });
  seed(root, '归档', { id: 'A-0', 职能: '程序', 归档原因: '废弃' }); // 带因归档不解除
  seed(root, '待重派', { id: 'B-1', 职能: '程序', 放行: true }); // 待重派同盘
  const r = D.readySet(root, new Set());
  assert.deepEqual(r.map((x) => x.id).sort(), ['A-1', 'A-4', 'A-5', 'B-1']);
});

t('依赖闸 CX-11：解析不出的 ref 不放行（查无此单≠已满足）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'C-1', 职能: '程序', 放行: true, 依赖: '不存在的单号' });
  assert.deepEqual(D.readySet(root, new Set()), []);
});

t('排序：P0 > 红链 > 创建时间', () => {
  const list = [
    { id: 'b', 优先级: 'P1', 红链: true, 创建时间: '2' },
    { id: 'a', 优先级: 'P0', 红链: false, 创建时间: '3' },
    { id: 'c', 优先级: 'P1', 红链: false, 创建时间: '1' },
  ];
  assert.deepEqual(D.sortReady(list).map((x) => x.id), ['a', 'b', 'c']);
});

t('沟通护城河：claude 余量≤保留线停拉，codex 不受影响，读数盲飞不硬拦', () => {
  const cfg = { 额度: { 沟通保留: 20 } };
  assert.equal(D.moatBlocked(cfg, { claude: { fivePct: 85 } }, 'claude'), true);  // 余15≤20
  assert.equal(D.moatBlocked(cfg, { claude: { fivePct: 70 } }, 'claude'), false); // 余30
  assert.equal(D.moatBlocked(cfg, { claude: { fivePct: 95 } }, 'codex'), false);
  assert.equal(D.moatBlocked(cfg, { claude: { fivePct: null } }, 'claude'), false);
});

t('挑单：按并发余量+池路由+锁态出清单，硬顶封死', () => {
  const ready = [
    { id: 'p1', 职能: '程序', 优先级: 'P0', 红链: false, 创建时间: '1' },
    { id: 'p2', 职能: '程序', 优先级: 'P1', 红链: false, 创建时间: '2' },
    { id: 'c1', 职能: '策划', 优先级: 'P0', 红链: false, 创建时间: '1' },
  ];
  const picks = D.pickNext(CFG, ready, { codex: 0, claude: 0 },
    { codex: { fivePct: 10 }, claude: { fivePct: 10 } }, { codex: 1, claude: 2 });
  assert.deepEqual(picks.map((p) => p.id + '/' + p.池).sort(), ['c1/claude', 'p1/codex']);
  // 项管把 codex 并发调到 99 也被硬顶按住
  const wild = D.pickNext(CFG, ready, { codex: 0, claude: 0 },
    { codex: { fivePct: 10 }, claude: { fivePct: 10 } }, { codex: 99, claude: 0 });
  assert.ok(wild.filter((p) => p.池 === 'codex').length <= D.HARD_CAP.codex);
  // 额度锁保险丝
  const locked = D.pickNext(CFG, ready, {}, { codex: { fivePct: 10, locked: true }, claude: { fivePct: 10 } }, { codex: 2, claude: 2 });
  assert.ok(!locked.some((p) => p.池 === 'codex'));
});

// ---- H85 派发死局自愈（施工令-008 去岗位化后改造：编制=每职能一行，池序即路由优先级）----
// 案源 2026-08-06：美术编制唯一挂在冻结的 codex 池，派发静默滞留而 UI 全绿（假健康）。
// 三态语义沿用 007：①池序内顺位（不算改挂）②整条全冻→借调打标 ③无处可去→滞留。
const 冻 = (p) => ({ fivePct: 10, locked: p === 'codex' });
const 全冻 = { codex: { fivePct: 10, locked: true }, claude: { fivePct: 10, locked: true } };
const R_ART = [{ id: 'a1', 职能: '美术', 优先级: 'P1', 红链: false, 创建时间: '1' }];
const 编制 = (池序) => ({ 执行池: { codex: { 职能: ['程序', '美术'] }, claude: { 职能: ['策划'] } },
  编制: [{ 职能: '美术', 池序: 池序.map((p) => ({ 池: p, 档: '' })) }] });

t('死局自愈①：池序整条全冻 → 借调可用池并带改挂标记', () => {
  const picks = D.pickNext(编制(['codex']), R_ART, {}, { codex: 冻('codex'), claude: 冻('claude') }, { codex: 2, claude: 2 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].池, 'claude');
  assert.ok(picks[0].改挂 && picks[0].改挂.原池 === 'codex', '必须带改挂留痕');
});

t('死局自愈②：池序部分冻结 → 顺位取下一个池，不算改挂', () => {
  const picks = D.pickNext(编制(['codex', 'claude']), R_ART, {}, { codex: 冻('codex'), claude: 冻('claude') }, { codex: 2, claude: 2 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].池, 'claude');
  assert.ok(!picks[0].改挂, '池序内切换是编制本来就授权的，不该打临时改挂标记');
});

t('死局自愈③：全池冻结无可用池 → 不派发，滞留等零派发告警', () => {
  assert.deepEqual(D.pickNext(编制(['codex']), R_ART, {}, 全冻, { codex: 2, claude: 2 }), []);
});

t('池序即优先级：首位未冻结就走首位，第二位不抢跑', () => {
  const picks = D.pickNext(编制(['claude', 'codex']), R_ART, {}, { codex: { fivePct: 10 }, claude: { fivePct: 10 } }, { codex: 2, claude: 2 });
  assert.deepEqual(picks.map((p) => p.池), ['claude']);
  const 反 = D.pickNext(编制(['codex', 'claude']), R_ART, {}, { codex: { fivePct: 10 }, claude: { fivePct: 10 } }, { codex: 2, claude: 2 });
  assert.deepEqual(反.map((p) => p.池), ['codex']);
});

t('死局自愈边界：钉池单不自愈（工程单钉死 deepseek 是刻意的成本选择；2026-08-26 分家后钉章字段=钉池）', () => {
  const cfg = { 执行池: { codex: {}, claude: {}, deepseek: {} },
    编制: [{ 职能: '程序', 池序: [{ 池: 'codex', 档: '' }] }] };
  const ready = [{ id: 'e1', 职能: '程序', 优先级: 'P1', 红链: false, 创建时间: '1', 钉池: 'deepseek' }];
  const gi = { deepseek: { fivePct: 10, locked: true }, claude: { fivePct: 10 }, codex: { fivePct: 10 } };
  assert.deepEqual(D.pickNext(cfg, ready, {}, gi, { deepseek: 2, claude: 2 }), []);
  // 分家反向自证：同样的钉法若只落在 执行池（运行章残迹）——路由必须无视，照走编制 codex
  const 残 = [{ id: 'e1', 职能: '程序', 优先级: 'P1', 红链: false, 创建时间: '1', 执行池: 'deepseek' }];
  assert.deepEqual(D.pickNext(cfg, 残, {}, gi, { deepseek: 2, claude: 2, codex: 2 }).map((p) => p.池), ['codex']);
});

t('死局自愈边界：零编制职能不臆造路由（照旧滞留）', () => {
  const cfg = { 执行池: { codex: { 职能: ['美术'] }, claude: { 职能: ['策划'] } }, 编制: [] };
  assert.deepEqual(D.pickNext(cfg, R_ART, {}, { codex: 冻('codex'), claude: 冻('claude') }, { codex: 2, claude: 2 }), []);
  // 零编制且默认池没冻 → 照常走职能默认池（不因为没编制就停派）
  const ok = D.pickNext(cfg, R_ART, {}, { codex: { fivePct: 10 }, claude: { fivePct: 10 } }, { codex: 2, claude: 2 });
  assert.deepEqual(ok.map((p) => p.池), ['codex']);
});

t('编制池序 rosterPools：读的是 config.编制，每职能一行', () => {
  const cfg = { 执行池: { codex: { 职能: ['美术'] }, claude: {} },
    编制: [{ 职能: '美术', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: 'opus' }] }] };
  assert.deepEqual(D.rosterPools(cfg, '美术'), ['codex', 'claude']);
  assert.deepEqual(D.rosterPools(cfg, '程序'), []);
});

t('旧岗位册形状仍能路由（内存态未迁移的 cfg 兼容读，行为与新形态一致）', () => {
  const 旧 = { 执行池: { codex: { 职能: ['程序', '美术'] }, claude: { 职能: ['策划'] } },
    agents: [{ id: '美术-A', 职能: '美术', 执行池: 'codex' }, { id: '美术-B', 职能: '美术', 执行池: 'claude' }] };
  assert.deepEqual(D.rosterPools(旧, '美术'), ['codex', 'claude']);
  const picks = D.pickNext(旧, R_ART, {}, { codex: 冻('codex'), claude: 冻('claude') }, { codex: 2, claude: 2 });
  assert.equal(picks[0].池, 'claude');
  assert.ok(!picks[0].改挂);
});

t('池冻结判据 poolFrozen：额度锁与护城河都算冻结，并发满不算', () => {
  const cfg = { 额度: { 沟通保留: 20 } };
  assert.equal(D.poolFrozen(cfg, { codex: { locked: true } }, 'codex'), true);
  assert.equal(D.poolFrozen(cfg, { claude: { fivePct: 85 } }, 'claude'), true);  // 护城河：余 15 ≤ 20
  assert.equal(D.poolFrozen(cfg, { codex: { fivePct: 99 } }, 'codex'), false);   // codex 无护城河、无锁
});

// ---- 计费标记与跨计费降级（2026-08-08 制作人裁决「套餐优先、用完降级到 key」）----
// 红线：订阅→按量是**开始花钱**的时刻，必须留得下痕；同计费的池切换不许打扰。
const 计费cfg = {
  执行池: {
    claude: { 职能: ['程序'], 计费: '订阅' },
    'claude-key': { 职能: [], 计费: '按量' },
    codex: { 职能: [], 计费: '订阅' },
    deepseek: { 职能: [], 兼容: { base: 'https://x.example.com', key: 'sk-xx' } },
  },
  编制: [{ 职能: '程序', 池序: [{ 池: 'claude' }, { 池: 'claude-key' }] }],
};
const R_程序 = [{ id: 'T-1', 职能: '程序', 优先级: 'P1', 创建时间: '2026-08-08' }];

t('计费Of：显式字段优先，没写就按有没有 兼容 段推断（兼容端点=按量）', () => {
  assert.equal(D.计费Of(计费cfg, 'claude'), '订阅');
  assert.equal(D.计费Of(计费cfg, 'claude-key'), '按量');
  assert.equal(D.计费Of(计费cfg, 'deepseek'), '按量', '有兼容段就是按量，不必显式写');
  assert.equal(D.计费Of(计费cfg, '没这个池'), '订阅', '未知池按订阅算，不臆造费用');
});

t('降级Of：只有 订阅→按量 出标记；同计费、反方向、同池都不出', () => {
  assert.ok(D.降级Of(计费cfg, 'claude', 'claude-key'));
  assert.equal(D.降级Of(计费cfg, 'claude', 'codex'), null, '订阅→订阅换谁都不花钱，不许打扰');
  assert.equal(D.降级Of(计费cfg, 'claude-key', 'claude'), null, '按量→订阅是省钱方向');
  assert.equal(D.降级Of(计费cfg, 'claude', 'claude'), null);
});

t('套餐用完自动降级到 key 池：池序顺位落到 claude-key，并带降级标记', () => {
  const gi = { claude: { locked: true }, 'claude-key': { locked: false } };
  const picks = D.pickNext(计费cfg, R_程序, {}, gi, { claude: 1, 'claude-key': 1 });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].池, 'claude-key', '这就是「套餐用完再用 key」——零新机制，池序本来就是它');
  assert.ok(picks[0].降级, '跨计费切换必须带标记，否则 runner 无从留痕');
  assert.equal(picks[0].降级.原计费, '订阅');
  assert.equal(picks[0].降级.新计费, '按量');
  assert.ok(!picks[0].改挂, '池序内顺位不是借调，别混淆两种标记');
});

t('护城河触线同样触发降级（生产不停，改为按量继续——但必须看得见）', () => {
  const gi = { claude: { fivePct: 85 }, 'claude-key': {} }; // 余 15 ≤ 保留线 20
  const picks = D.pickNext({ ...计费cfg, 额度: { 沟通保留: 20 } }, R_程序, {}, gi, { claude: 1, 'claude-key': 1 });
  assert.equal(picks[0].池, 'claude-key');
  assert.ok(picks[0].降级, '护城河从"刹车"变"换挡"，不留痕就是账单惊喜');
});

t('套餐可用时不降级、不留痕（别把正常派发也报成花钱）', () => {
  const picks = D.pickNext(计费cfg, R_程序, {}, { claude: {}, 'claude-key': {} }, { claude: 1 });
  assert.equal(picks[0].池, 'claude');
  assert.ok(!picks[0].降级);
});

t('借调路径也判降级：池序全冻时借到按量池，同样出标记', () => {
  const cfg2 = { ...计费cfg, 编制: [{ 职能: '程序', 池序: [{ 池: 'claude' }] }] };
  const gi = { claude: { locked: true }, codex: { locked: true }, 'claude-key': {}, deepseek: {} };
  const picks = D.pickNext(cfg2, R_程序, {}, gi, { 'claude-key': 1, deepseek: 1 });
  assert.equal(picks.length, 1);
  assert.ok(picks[0].改挂, '借调要出改挂');
  assert.ok(picks[0].降级, '借调到按量池同样是开始花钱');
});

console.log(`全部通过：${passed} 项`);
