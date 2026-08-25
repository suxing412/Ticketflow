// escalate.test.js — 人闸超时升格（制作人 2026-08-21 拍板 T=24h）
// 病灶：等我()/逾期() 算得出欠债，但 08-21 全库 grep 实测 逾期() **零调用者**——
// 「系统会主动找你」这句此前只存在于口头描述里，机器上只有总览红条（被动，人不开页面就看不见）。
// 本套件盯四条缝：①真的会发急件 ②不会每拍重发 ③债清了会抹账 ④总监的债不占制作人版面。
// 外呼绊线必须排在任何 lib/ 之前：lib/quota.js 在加载那一刻就把 child_process 解构走了（体检 #71）
const 绊线 = require('./外呼绊线'); 绊线.装绊线();
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
// 额度打桩（2026-08-22 体检 #71 · 绊线实测抓到）：本套件真跑 runner.tick，而 tick 会走到
// lib/quota.js:250 的 `spawn('codex', ['app-server'])` —— **这套件每跑一遍就试图起 7 次真 codex 会话**。
// 它此前一直「绿」，是因为 tick 把 spawn 的异常咽了：装了绊线才看见这本账。
// 本套件测的是人闸升格，与真实额度无关，故一律打桩。
const quota = require('../lib/quota');
quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;
quota.queryRateLimits = async () => null; quota.queryClaudeUsage = async () => null;
quota.eagerRefresh = async () => null; quota.checkGate = async () => ({ ok: true });
const runner = require('../lib/runner');
const state = require('../lib/core/state');
const { makeRoot, seed } = require('./helper');

// harness 真 await（2026-08-22 体检 #42）：原样是 `const t = (n, f) => { f(); passed++; }`——
// f 是 async 时它拿到的是一个 Promise，用例还没跑完就先打了「✓」并计了数。实测：塞一条
// `assert.equal(1, 2)` 的 async 用例进去，照打 ✓、照打「全部通过：10 项」（退出码非零只是
// Node 的未处理拒绝兜底，报告那一行是**假的**）。改成排队顺序 await，红就是红。
let passed = 0; const 队 = [];
const t = (n, f) => 队.push(async () => { await f(); passed++; console.log('  ✓ ' + n); });
console.log('人闸超时升格测试');

const 信 = (root) => {
  const f = path.join(root, '呼叫', 'inbox.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
// 完成态保留单 = 制作人的闸（G3 保留单/散单终审，H108 后 待验收 并入 完成）。
// 停摆自 = 入完成时刻，靠 fm 上的时间戳。
const 老单 = (root, id, 小时) => {
  const iso = new Date(Date.now() - 小时 * 36e5).toISOString();
  seed(root, '完成', { id, 验收方式: '保留', 交付时间: iso }); // 停自() 首选 交付时间（更新时间被 seed 写死）
};
const cfg = { 闸值: { 人闸超时小时: 24 } };

t('停摆超 T 的制作人闸 → 收件箱急件（此前只有红条，红条是被动的）', () => {
  const root = makeRoot();
  老单(root, 'TK-1', 40);
  runner.人闸升格Tick(root, cfg);
  const 急 = 信(root).filter((x) => x.类型 === '人闸逾期');
  assert.equal(急.length, 1, '逾期 40h 必须发一条急件');
  assert.equal(急[0].级别, '急');
  assert.match(急[0].摘要, /停摆 40h/);
  assert.equal(急[0].单号, 'TK-1');
});

t('未到 T 的不响（差一小时也不响，阈值是硬线）', () => {
  const root = makeRoot();
  老单(root, 'TK-2', 23);
  runner.人闸升格Tick(root, cfg);
  assert.equal(信(root).filter((x) => x.类型 === '人闸逾期').length, 0);
});

t('幂等：连拍 20 次只响一次（池衡拒因刷 9 天 265 次的教训）', () => {
  const root = makeRoot();
  老单(root, 'TK-3', 40);
  for (let i = 0; i < 20; i++) runner.人闸升格Tick(root, cfg);
  assert.equal(信(root).filter((x) => x.类型 === '人闸逾期').length, 1, '15 秒一拍，忘了去重就是一夜 5760 条');
});

t('债清了抹账：同一笔将来再逾期还能再响（不是永久静音）', () => {
  const root = makeRoot();
  老单(root, 'TK-4', 40);
  runner.人闸升格Tick(root, cfg);
  assert.ok(state.read(root).人闸升格['G3:TK-4'], '升格已记账');
  fs.rmSync(require('../lib/core/store').ticketPath(root, '完成', 'TK-4'), { force: true }); // 签掉了
  runner.人闸升格Tick(root, cfg);
  assert.equal(state.read(root).人闸升格['G3:TK-4'], undefined, '债没了，账要抹——否则重犯时永久静音');
});

t('归属分流：总监的债进 journal 不进制作人收件箱', () => {
  const root = makeRoot();
  const iso = new Date(Date.now() - 40 * 36e5).toISOString();
  seed(root, '待处理', { id: 'TK-5', 交付时间: iso, 失败原因: 'CLI 超时' }); // G12 失败分诊 = 总监（H108：执行失败并入待处理）
  runner.人闸升格Tick(root, cfg);
  assert.equal(信(root).filter((x) => x.类型 === '人闸逾期').length, 0, '收件箱是制作人的第一屏，总监的欠账不占版面');
  const jf = path.join(root, 'journal');
  const txt = fs.existsSync(jf) ? fs.readdirSync(jf).map((f) => fs.readFileSync(path.join(jf, f), 'utf8')).join('') : '';
  assert.match(txt, /人闸逾期（总监）/, '但流水里要记——自己的账自己认');
});

t('新闸全覆盖升格（H108/H109）：G21 待审→总监 journal、G1 待派→项管 journal、G2 上呈→制作人收件箱', () => {
  // 任务书要求「全部人闸自动获得 T=24h 逾期升格」——机制是现成的（升格只订阅 等我() 的结论），
  // 但订阅现成 ≠ 新闸被覆盖：归属新增了「项管」一档，升格的分流线要实证走对。
  const root = makeRoot();
  const iso = new Date(Date.now() - 40 * 36e5).toISOString();
  seed(root, '待审', { id: 'TK-7', 交付时间: iso });                                   // G21 总监
  seed(root, '待派', { id: 'TK-8', 交付时间: iso });                                   // G1 项管（无放行旗）
  seed(root, '待处理', { id: 'TK-9', 交付时间: iso, 上呈原因: '三振上呈，四件套待裁' }); // G2 制作人
  runner.人闸升格Tick(root, cfg);
  const 急 = 信(root).filter((x) => x.类型 === '人闸逾期');
  assert.deepEqual(急.map((x) => x.单号), ['TK-9'], '只有制作人的 G2 那笔进收件箱——总监/项管的债不占他版面');
  const jf = path.join(root, 'journal');
  const txt = fs.existsSync(jf) ? fs.readdirSync(jf).map((f) => fs.readFileSync(path.join(jf, f), 'utf8')).join('') : '';
  assert.match(txt, /人闸逾期（总监）：切单待审：[^\n]*TK-7/, 'G21 的债在流水里记成总监的账');
  assert.match(txt, /人闸逾期（项管）：派发放行：[^\n]*TK-8/, 'G1 的债在流水里记成项管的账（H109 移交后不再进收件箱）');
  assert.ok(state.read(root).人闸升格['G21:TK-7'] && state.read(root).人闸升格['G1:TK-8'] && state.read(root).人闸升格['G2:TK-9'],
    '三笔都按 gateKey 记了账——幂等去重对新闸同样生效');
});

t('T<=0 视为关闭升格，不是「立刻全红」', () => {
  const root = makeRoot();
  老单(root, 'TK-6', 999);
  runner.人闸升格Tick(root, { 闸值: { 人闸超时小时: 0 } });
  assert.equal(信(root).filter((x) => x.类型 === '人闸逾期').length, 0);
});

// 原第 7 条是「抠源码字符序」的接线判据（比较 人闸升格Tick 与 isOn 早退谁在前）。
// 2026-08-22 体检 #42 判它不算数：它证明的只是几个字的先后，改个写法就假红、绕开就假绿。
// 下面两条是它的行为面替身——一条盯 tick 早退，一条盯 stop() 掐环，都真跑真看呼叫队列。
t('执行器停着照样升格（tick 早退拦不住它）', async () => {
  const root = makeRoot();
  老单(root, 'TK-STOP', 40);
  // 不置 运行:true → 执行器处于「未运行」，tick 会在 isOn 处早退
  const r = await runner.tick(root, cfg);
  assert.equal(r.skipped, true, '执行器确实没跑');
  assert.equal(信(root).filter((x) => x.类型 === '人闸逾期').length, 1, '债照样升格——这才是「不因产线停摆而消失」');
});

t('按下停止按钮也拦不住它：stop() 之后新逾期的债照样进呼叫队列（08-22 体检 #25 第二重）', async () => {
  // 一修只把 人闸升格Tick 挪到 isOn 早退之前，堵了第一重。第二重是 stop() → stopLoop()
  // 把整条 15 秒环 clearInterval 掉，tick 压根不再被调用——升格随产线一起被掐死。
  // 升格环必须是**另一条环**，stopLoop() 碰不到它。
  const root = makeRoot();
  const 快 = () => ({ ...cfg, 执行器: { ...(cfg.执行器 || {}), 升格间隔分钟: 0.005, 间隔秒: 0.05 } }); // 升格 0.3s 一拍
  runner.start升格环(root, 快);
  try {
    runner.start(root, 快);   // 产线跑起来
    runner.stop(root);        // 制作人按下「停止」
    assert.equal(runner.isOn(root), false, '产线确实停了');
    老单(root, 'TK-STOP2', 40); // 停之后才逾期的债
    const 到 = Date.now() + 4000;
    while (Date.now() < 到 && 信(root).filter((x) => x.类型 === '人闸逾期').length === 0) {
      await new Promise((r) => setTimeout(r, 60));
    }
    assert.equal(信(root).filter((x) => x.类型 === '人闸逾期').length, 1,
      '产线停着的时候，正是最该有人来看债的时候——停止按钮只管本次会话，不该把人欠的债一并静音');
  } finally { runner.stop升格环(); runner.stopLoop(); }
});

// ── 撤下：「派发制缺省反转」用例（2026-08-24 状态机改造 D 组）──────────────────────
// 它的可观测是「派发制会把单从 池 归位到 待投」。H108 把 池/待投 并入 待派、放行改为 fm 标记，
// **归位这个目录跳变在新状态机里不存在了**——夹具态（池）连目录都没有，seed 直接 ENOENT。
// 被测行为（runner 缺省走派发制）本身仍是 H49 立宪条款，但其新观测点长什么样取决于
// P1-3 组对 runner 派发路的改道（待派+放行→在途）；replacement 用例须与 runner 组对齐后
// 落在他们名下的套件里（runner.test.js），不能在这儿凭空猜一个观测点——猜错就是假判据。
// 协调项已在 D 组回执 need_coord 登记（连带撤了本套件对 CFG/store 的引用）。

(async () => { for (const f of 队) await f(); console.log('全部通过：' + passed + ' 项'); })()
  .catch((e) => { console.error('  ✗ ' + (e && e.message)); process.exit(1); });
