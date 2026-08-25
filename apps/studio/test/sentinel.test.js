// sentinel.test.js — Q20 状态目录互斥哨兵：同号双态即熔断派发 + 发急件
// 案源 2026-08-18 伪单事故：在途单目录被追加内容造出幻影单（同号在两个状态目录各一份），
// find() 静默挑首命中 → 派发照跑 → QA 审空单、无判词、无限重试约 61 轮 ≈117 万 token。
// 本套盯四件事：**扫得出**（纯读取证）、**堵得住**（两条派发路都熔断）、
// **喊得出**（急件+journal，且不刷屏）、**恢复得了**（删掉多余那份即自动复产）。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ── 外呼绊线（2026-08-22 体检 #71）──────────────────────────────────
// **必须装在任何 lib/ require 之前**：lib/quota.js:9 是 `const { spawn, execFile } = require('child_process')`
// ——模块加载那一刻就把函数引用解构走了，事后再替 child_process 上的字段一点用没有。
// 为什么要绊线：光把 quota 打桩不构成判据（桩子被删掉，测试照绿——今日实测正是如此，
// 全套 12 例零 child_process 调用，因为唯一那条 claim 撞在 lib/pool.js:80 的哨兵熔断上就返回了）。
// 绊线把「有没有真外呼」变成可观测事实：任何一次 spawn/execFile/https.request 都会被记下来，
// 末例断言这本账为空。原函数一概不调用——测试进程里不许存在真外呼这条路。
const 外呼记录 = [];
{
  const cp = require('child_process');
  const 拦 = (名) => function (...a) {
    外呼记录.push(名 + ' ' + JSON.stringify(a[0]));
    throw new Error(`真实外呼渗入测试：${名} ${JSON.stringify(a[0])}（该打桩的没打桩）`);
  };
  for (const k of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) cp[k] = 拦('child_process.' + k);
  const https = require('https');
  https.request = 拦('https.request');
  https.get = 拦('https.get');
}

const { makeRoot, seed, CFG } = require('./helper');
const store = require('../lib/core/store');
const sentinel = require('../lib/sentinel');
const dispatch = require('../lib/pm/dispatch');
const gates = require('../lib/gates');
const inbox = require('../lib/inbox');
// 额度桩（坑档案「真实额度渗入测试」2026-08-05：判官类外部查询在套件顶部一律 mock；
// 同 test/pool.test.js:9-10、test/gates.test.js:16 的手法）。
// 本套此前是全仓唯一碰 pool.claim / gates.canPull 却**不** mock 的——今日不外呼纯属
// lib/pool.js:80 把哨兵熔断放在 canPull 之前的副作用，不是纪律：加一例非熔断态的 claim
// 就会真去 execFile('curl', … api.anthropic.com) 与 spawn('codex')，并读真实凭据文件。
// 返 null 走 lib/gates.js poolLock 的 fivePct/weekPct 均 null 分支 → fail-open，
// 现有各例行为零变化（修前 12 项全绿，修后仍 12 项全绿）。
const quota = require('../lib/quota');
quota.getRateLimits = async () => null;
quota.getClaudeUsage = async () => null;

let passed = 0;
const 队 = [];
const t = (n, f) => 队.push([n, f]); // 同步/异步混跑：全部排队，末尾按序 await
console.log('sentinel Q20 状态目录互斥哨兵测试');

// 造一张幻影单：同号同时住两个状态目录（正是 08-18 那次手改追加的等价物）
function 造双态(root, id, 甲, 乙) {
  seed(root, 甲, { id });
  fs.copyFileSync(store.ticketPath(root, 甲, id), store.ticketPath(root, 乙, id));
}

t('干净仓零报：一单一目录时哨兵不熔断（不许误伤产线）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'T-1', 放行: true });
  seed(root, '在途', { id: 'T-2', 主办: '策划' });
  assert.deepEqual(store.双态(root), []);
  assert.equal(sentinel.熔断(root).熔断, false);
});

t('同号双态扫得出：报出单号与它同时住着的两个目录', () => {
  const root = makeRoot();
  造双态(root, 'T-9', '在途', '完成');
  const 冲突 = store.双态(root);
  assert.equal(冲突.length, 1);
  assert.equal(冲突[0].id, 'T-9');
  assert.deepEqual(冲突[0].状态.slice().sort(), ['在途', '完成']);
});

t('扫描是纯读：不建目录、不落文件（哨兵自己不许改事实源）', () => {
  const root = makeRoot();
  造双态(root, 'T-8', '待派', '在途');
  const 前 = fs.readdirSync(root).sort();
  store.双态(root);
  assert.deepEqual(fs.readdirSync(root).sort(), 前);
});

t('.claiming 抢占中间态不算双态：move 的原子占位不是第二份单', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'T-7' });
  fs.writeFileSync(store.ticketPath(root, '在途', 'T-7') + '.claiming', 'x', 'utf8');
  assert.deepEqual(store.双态(root), []);
});

t('熔断即发急件 + 落 journal（急件带单号，摘要说得清怎么恢复）', () => {
  const root = makeRoot();
  造双态(root, 'T-6', '在途', '核查');
  const r = sentinel.熔断(root);
  assert.equal(r.熔断, true);
  assert.equal(r.签名, 'T-6@在途+核查');
  const 件 = inbox.list(root).filter((e) => e.类型 === '同号双态');
  assert.equal(件.length, 1);
  assert.equal(件[0].级别, '急');
  assert.equal(件[0].单号, 'T-6');
  assert.ok(件[0].摘要.includes('T-6@在途+核查'));
  const log = fs.readFileSync(path.join(root, 'journal',
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}.log`), 'utf8');
  assert.ok(log.includes('Q20 同号双态'));
});

t('同一组冲突只喊一次：15 秒一拍的派发循环不许把呼叫队列刷爆', () => {
  const root = makeRoot();
  造双态(root, 'T-5', '在途', '完成');
  for (let i = 0; i < 5; i++) sentinel.熔断(root);
  assert.equal(inbox.list(root).filter((e) => e.类型 === '同号双态').length, 1);
});

t('冲突变了要重喊：又多一张幻影单是新事实，不许被去重吞掉', () => {
  const root = makeRoot();
  造双态(root, 'T-4a', '在途', '完成');
  sentinel.熔断(root);
  造双态(root, 'T-4b', '待派', '挂起');
  sentinel.熔断(root);
  assert.equal(inbox.list(root).filter((e) => e.类型 === '同号双态').length, 2);
});

t('静默档只判不喊：UI/自检这类高频只读调用不该产生急件', () => {
  const root = makeRoot();
  造双态(root, 'T-3', '在途', '完成');
  assert.equal(sentinel.熔断(root, { 静默: true }).熔断, true);
  assert.equal(inbox.list(root).length, 0);
});

t('熔断堵派发制：就绪队列直接清空——哪怕单子已放行、依赖已齐', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'T-2a', 放行: true });
  assert.equal(dispatch.readySet(root, new Set()).length, 1, '前置：本来是派得出去的');
  造双态(root, 'T-2b', '在途', '完成');
  assert.deepEqual(dispatch.readySet(root, new Set()), [], '同号双态时一张都不许派');
});

t('熔断阻止派发：就绪盘点直接为空（同号双态不得进入派发链）', async () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'T-1a', 职能: '策划', 放行: true });
  造双态(root, 'T-1b', '在途', '完成');
  assert.deepEqual(dispatch.readySet(root, new Set()), []);
});

t('删掉多余那份即自动恢复派发（人工修完不必重启值守）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'R-1', 放行: true });
  造双态(root, 'R-2', '在途', '完成');
  assert.deepEqual(dispatch.readySet(root, new Set()), []);
  fs.unlinkSync(store.ticketPath(root, '完成', 'R-2'));
  assert.equal(sentinel.熔断(root).熔断, false);
  assert.deepEqual(dispatch.readySet(root, new Set()).map((r) => r.id), ['R-1']);
});

t('哨兵扫不动不误熔断：根本不存在的仓返回不熔断，而不是把产线拖停', () => {
  const r = sentinel.熔断(path.join(__dirname, '不存在的仓-' + Date.now()));
  assert.equal(r.熔断, false);
});

// ── #71 的正身：非熔断态才真正走到额度闸 ───────────────────────────
// 上面那一例（熔断堵拉取制）在 lib/pool.js:80 就返回了，canPull 压根没跑到——
// 「本套不外呼」是那条早返回的副作用，不是纪律。这一例把闸走完：哨兵不熔断 → canPull →
// gates.poolLock → quota.getRateLimits/getClaudeUsage。桩子在，闸 fail-open，单领得到；
// 桩子一撤，走的就是 execFile('curl', … api.anthropic.com) + spawn('codex') + 读真实凭据。
t('非熔断态派发决策读取额度闸：可选择就绪单（quota 桩真正上场）', async () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'Q-1', 职能: '策划', 优先级: 'P1', 放行: true });
  assert.equal(sentinel.熔断(root).熔断, false, '前置：这一例必须是非熔断态，否则 canPull 根本跑不到');
  const locks = await gates.allLocks(CFG);
  const picks = dispatch.pickNext(CFG, dispatch.readySet(root, new Set()), {}, locks, { claude: 1, codex: 1 });
  assert.deepEqual(picks.map((p) => p.id), ['Q-1'], '额度桩返 null → 门闸 fail-open → 该单进入派发选择：' + JSON.stringify(picks));
});

// ── 收口：全程零真实外呼 ────────────────────────────────────────────
// 这一条是 #71 的判据本体。它验的是**行为**（有没有真去起进程/发请求），
// 不是「源码里有没有 getRateLimits 那七个字」——后者上一轮复核实测会把
// quota-接线.test.js / recommend.test.js / setup.test.js 三个无辜套件打红。
// 变异：把上面 quota.getRateLimits/getClaudeUsage 两行注释掉 → 非熔断态那一例
// 走真 quota → 绊线记账并抛 → 本条红（且那一例自己也红）。
t('全程零真实外呼：测试进程里不许出现 spawn/execFile/https.request', () => {
  assert.deepEqual(外呼记录, [], '外呼渗入测试：' + 外呼记录.join(' | '));
});

(async () => {
  for (const [n, f] of 队) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
