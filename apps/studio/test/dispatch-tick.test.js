// dispatch-tick.test.js — 派发决策层（H108 三大态 + CX-11 语义反转，2026-08-24 改造）
// 原样是走 runner.tick 的集成套；H108 改造期 runner 归执行器组独占，本套下沉到 dispatch 决策层
// （readySet/depsDone/pickNext/routePool 全是纯决策，seed 铺盘即可验行为）——runner 侧的
// 端到端由 runner.test.js（执行器组名下）接续。
// 外呼绊线必须排在任何 lib/ 之前：lib/quota.js 在加载那一刻就把 child_process 解构走了（体检 #71）
const 绊线 = require('./外呼绊线'); 绊线.装绊线();
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRoot, seed, 收尾 } = require('./helper');
const store = require('../lib/core/store');
const dispatch = require('../lib/pm/dispatch');
const quota = require('../lib/quota');
// 测试隔离（同 runner.test 2026-08-05 案：额度闸查真实订阅用量会假失败）
quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('dispatch 派发决策层测试（H108 + CX-11）');

const CFG = {
  执行器: { 派发制: true },
  执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', 'QA', '装配'] } },
  编制: [{ 职能: '程序', 池序: [{ 池: 'codex', 档: '' }] }],
  闸值: {},
};

// 当月 journal 文件（同 sentinel.test 的取法）
const 流水 = (root) => {
  const f = path.join(root, 'journal',
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}.log`);
  try { return fs.readFileSync(f, 'utf8'); } catch { return ''; }
};

t('readySet 从 待派 取放行单：放行旗在的进队列，没旗的不进', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'D-1', 职能: '程序', 放行: true });
  seed(root, '待派', { id: 'D-2', 职能: '程序' }); // 未放行不动
  const r = dispatch.readySet(root, new Set());
  assert.deepEqual(r.map((x) => x.id), ['D-1']);
  assert.equal(r[0].态, '待派');
});

t('readySet 兼收 待重派（重投带旗）：回队单同一条就绪路，态字段如实标来处', () => {
  const root = makeRoot();
  seed(root, '待重派', { id: 'R-1', 职能: '程序', 放行: true });
  seed(root, '待重派', { id: 'R-2', 职能: '程序' }); // 没旗的重派单同样不进
  const r = dispatch.readySet(root, new Set());
  assert.deepEqual(r.map((x) => [x.id, x.态]), [['R-1', '待重派']]);
});

t('CX-11 语义反转：依赖 ref 全库查无此单 → 不放行（原样 continue 是当已满足放走）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'X-1', 职能: '程序', 放行: true, 依赖: 'NO-SUCH-99' });
  const t1 = store.find(root, 'X-1');
  assert.equal(dispatch.depsDone(root, t1), false, '坏 ref 必须判未就绪');
  assert.deepEqual(dispatch.readySet(root, new Set()), [], '坏 ref 单不得进就绪队列');
});

t('CX-11 留痕：坏 ref 落 journal（单号+ref 都点名），且 15 秒一拍反复判不刷屏', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'X-2', 职能: '程序', 放行: true, 依赖: 'GHOST-7' });
  const t2 = store.find(root, 'X-2');
  dispatch.depsDone(root, t2);
  dispatch.depsDone(root, t2);
  dispatch.depsDone(root, t2);
  const log = 流水(root);
  const 痕 = log.split(/\r?\n/).filter((l) => l.includes('依赖解析失败') && l.includes('X-2') && l.includes('GHOST-7'));
  assert.equal(痕.length, 1, `坏 ref 留痕应恰一条（实测 ${痕.length}）：${JSON.stringify(痕)}`);
});

t('依赖做完口径（H108 逐个按语义判）：完成/无因归档=就绪；带因归档/废弃/在途=未就绪', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'A-1' });
  seed(root, '归档', { id: 'A-2' });                    // 无因归档=落袋
  seed(root, '归档', { id: 'A-3', 归档原因: '废弃' });   // 历史废弃留在归档（不改史）
  seed(root, '废弃', { id: 'A-4' });                    // 新废弃是目录态
  seed(root, '在途', { id: 'A-5', 主办: '程序' });
  const 判 = (依赖) => {
    const id = seed(root, '待派', { 职能: '程序', 放行: true, 依赖 });
    return dispatch.depsDone(root, store.find(root, id));
  };
  assert.equal(判('A-1'), true, '依赖在 完成（做完等关账）应就绪');
  assert.equal(判('A-2'), true, '依赖无因归档（落袋）应就绪');
  assert.equal(判('A-3'), false, '带 归档原因 的归档不算落袋');
  assert.equal(判('A-4'), false, '废弃目录态的依赖永不就绪');
  assert.equal(判('A-5'), false, '依赖还在途不得放行');
  assert.equal(判('A-1，A-2'), true, '多依赖全就绪才放行');
  assert.equal(判('A-1，A-5'), false, '多依赖有一条未就绪即拦');
});

t('并发闸（pickNext 纯决策）：单池上限内逐张放行，其余排队', () => {
  const ready = [1, 2, 3, 4].map((i) => ({ id: 'C-' + i, 职能: '程序', 优先级: 'P1', 执行池: null, 红链: false, 创建时间: '2026-07-0' + i }));
  const picks = dispatch.pickNext(CFG, ready, {}, { codex: { locked: false }, claude: { locked: false } }, { codex: 1 });
  assert.deepEqual(picks.map((p) => [p.id, p.池]), [['C-1', 'codex']], 'codex 并发 1 只放一张');
});

t('H85 死局自愈（routePool 纯决策）：本职池序全冻 → 借调可用池并打 改挂 标记', () => {
  const gatesInfo = { codex: { locked: true }, claude: { locked: false } };
  const r = dispatch.routePool(CFG, { id: 'H-1', 职能: '程序' }, gatesInfo);
  assert.equal(r.池, 'claude', 'codex 冻结应借调 claude');
  assert.ok(r.改挂 && r.改挂.原池 === 'codex', '借调必须带 改挂 留痕：' + JSON.stringify(r));
});

收尾('', passed);
