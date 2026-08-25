// watchpulse.test.js — 值守心跳节拍器 + 三振判亡（TK-210）
//
// 被测的全是**运行期行为**：seq 跨进程不回退、第 1/2 拍闭嘴第 3 拍才喊、一次阵亡只喊一次、
// 无变更静默。这些没有一条能靠 `assert.match(源码, /某串字/)` 验——那种判据本项目已明令不算数
//（patroltick #24/#28 判例：既漏真病，又误伤重构）。故本套件一条文本判据不留：
// 真跑拍、真读盘上的 state、真跑 gatereg 消费端。
//
// 「重启」怎么造：造心跳拍() 的 restart 标记按定义只有进程内存知道（它问的就是「本进程刚起来没」），
// 而 seq 全在盘上。于是**丢掉旧闭包、对同一个 root 再造一个拍**，就是一次重启的忠实模型——
// 新闭包首拍 restart=1，seq 却必须接着盘上那个数往下走。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRoot, 收尾 } = require('./helper');
const wp = require('../lib/pm/watchpulse');
const gr = require('../lib/gatereg');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('值守心跳测试');

// 台：真盘 state + journal/inbox 收集桩 + 可拨的钟
function 台(root, opts = {}) {
  const 痕 = []; const 急 = [];
  let 钟 = Date.parse(opts.起 || '2026-08-26T00:00:00Z');
  const deps = {
    journal: { append: (_r, s) => 痕.push(s) },
    inbox: { post: (_r, 级, 类, 摘) => 急.push({ 级, 类, 摘 }) },
    now: () => 钟,
  };
  return {
    痕, 急, deps,
    走(分) { 钟 += 分 * 60000; },
    造拍: () => wp.造心跳拍(() => root, () => ({}), { deps }),
    回执: (seq, 已挂 = 7, 补挂 = []) => wp.记在位(root, { seq, 已挂, 补挂 }, deps),
  };
}
const 心跳数 = (痕) => 痕.filter((l) => l.startsWith(wp.心跳关键词)).length;
const ack数 = (痕) => 痕.filter((l) => l.startsWith('值守在位')).length;

// ── ① 协议常量：三个数各只有一处 ───────────────────────────────
t('协议三项写死：周期 5 分钟、三振阈值 3、应有 7 项', () => {
  assert.equal(wp.周期毫秒, 5 * 60000, '心跳周期必须是 5 分钟');
  assert.equal(wp.三振阈值, 3, '阈值就是 3——不许提前也不许拖后');
  assert.equal(wp.应有项数, 7, '值守清单 6 项 + 瞭望塔自己 = 7');
  assert.equal(wp.心跳关键词, '值守心跳', 'Monitor 的过滤词就是心跳行的行首标记');
});

t('窗口报文行照工单格式，且只有它一处拼这句话', () => {
  assert.equal(
    wp.窗口行({ 次数: 3, 已挂: 7, 补挂: ['流水关键事件监视'] }),
    '瞭望塔第 3 次静默阵亡，已自动重挂 7/7（缺 流水关键事件监视 已补）');
  assert.equal(wp.心跳行({ seq: 12 }), '值守心跳 seq=12 应有=7 周期=5m');
  assert.equal(wp.心跳行({ seq: 1, restart: true }), '值守心跳 seq=1 应有=7 周期=5m restart=1');
});

// ── ② seq 单调 + 重启不回退 ────────────────────────────────────
t('连续三拍 seq 逐拍 +1，state 落盘', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  const r = [拍(), (s.走(5), 拍()), (s.走(5), 拍())];
  assert.deepEqual(r.map((x) => x.seq), [1, 2, 3]);
  assert.deepEqual(s.痕.filter((l) => l.startsWith(wp.心跳关键词)), [
    '值守心跳 seq=1 应有=7 周期=5m restart=1',
    '值守心跳 seq=2 应有=7 周期=5m',
    '值守心跳 seq=3 应有=7 周期=5m',
  ], '只有本进程首拍带 restart=1');
  const 盘 = JSON.parse(fs.readFileSync(path.join(root, wp.STATE_FILE), 'utf8'));
  assert.equal(盘.seq, 3, 'seq 必须在盘上，不能只活在闭包里');
  assert.ok(盘.上次心跳, '上次心跳时刻要落盘');
});

t('重启后 seq 不回退，且首拍带 restart=1', () => {
  const root = makeRoot(); const s = 台(root);
  const 拍A = s.造拍(); 拍A(); s.走(5); 拍A(); s.走(5); 拍A();       // 旧进程跑到 seq=3
  s.回执(3);   // 塔在位（不回执的话 seq=4 恰好三振判亡，阵亡行会盖掉本格要看的心跳行——三振归 ③ 专测）
  const 拍B = s.造拍();                                              // ← 重启：新闭包，同一个 root
  s.走(5); const r = 拍B();
  assert.equal(r.seq, 4, '重启后必须接着 4，不许回到 1');
  assert.equal(r.restart, true);
  assert.equal(s.痕[s.痕.length - 1], '值守心跳 seq=4 应有=7 周期=5m restart=1');
  s.走(5); assert.equal(拍B().restart, false, 'restart 只标首拍，第二拍不许再带');
});

// ── ③ 三振：第 1、2 拍闭嘴，第 3 拍才喊 ────────────────────────
t('无回执第 1、2 拍绝不告警，第 3 拍判亡并发急件（含缺失 seq 区间）', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  拍(); s.回执(1);                       // seq=1 有 ack，水位=1
  s.走(5); const r2 = 拍();               // seq=2：待对账区间 [2,1] 空
  assert.equal(r2.无回执, 0);
  s.走(5); const r3 = 拍();               // seq=3：缺 2 → 1 拍
  assert.equal(r3.无回执, 1); assert.equal(r3.阵亡, false);
  assert.equal(s.急.length, 0, '第 1 拍无回执不许告警');
  s.走(5); const r4 = 拍();               // seq=4：缺 2,3 → 2 拍
  assert.equal(r4.无回执, 2); assert.equal(r4.阵亡, false);
  assert.equal(s.急.length, 0, '★第 2 拍无回执仍不许告警——阈值确为 3 的实证');
  s.走(5); const r5 = 拍();               // seq=5：缺 2,3,4 → 3 拍，判亡
  assert.equal(r5.无回执, 3); assert.equal(r5.阵亡, true); assert.equal(r5.判亡本拍, true);
  assert.equal(s.急.length, 1, '第 3 拍才发急件');
  assert.equal(s.急[0].级, '急');
  assert.equal(s.急[0].类, '值守塔阵亡');
  assert.equal(s.急[0].摘, '值守瞭望塔静默阵亡：连续 3 拍无在位回执（缺失 seq 2~4）');
  assert.ok(!require('../lib/inbox').噪声类型.has('值守塔阵亡'),
    '塔死了要人去重挂——类型名落进噪声表就等于把急件静音了');
});

t('一次阵亡只喊一次：第 4、5 拍不再重复发急件', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  拍(); s.回执(1);
  for (let i = 0; i < 4; i++) { s.走(5); 拍(); }   // seq=5 判亡
  assert.equal(s.急.length, 1);
  s.走(5); 拍(); s.走(5); 拍();
  assert.equal(s.急.length, 1, '每拍再喊一遍就是把急件变噪声（inbox 377 条案）');
});

t('塔回来了即复位，再次阵亡照喊——不是喊过一次就永久闭嘴', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  拍(); s.回执(1);
  for (let i = 0; i < 4; i++) { s.走(5); 拍(); }   // seq=5 判亡，急件 1
  assert.equal(s.急.length, 1);
  s.回执(5); s.走(5); const 复 = 拍();             // seq=6：水位追到 5，区间 [6,5] 空
  assert.equal(复.阵亡, false, '收到 ack 即复位');
  assert.ok(s.痕.some((l) => l.startsWith('值守瞭望塔已恢复在位')), '恢复也要留痕');
  for (let i = 0; i < 3; i++) { s.走(5); 拍(); }   // 再死三拍
  assert.equal(s.急.length, 2, '第二次阵亡必须再喊一封');
});

// ── ④ 在位回执与自愈留痕 ───────────────────────────────────────
t('无变更回执：写 ack 行、不产窗口报文', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  拍();
  const r = s.回执(1, 7, []);
  assert.equal(r.ok, true);
  assert.equal(r.窗口行, '', '无变更静默是协议，不是实现细节');
  assert.equal(s.痕[s.痕.length - 1], '值守在位 seq=1 值守=7/7');
});

t('有补挂：自愈次数递增、journal 留痕含补挂项名、窗口报文照格式', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  拍();
  const r = s.回执(1, 7, ['流水关键事件监视']);
  assert.equal(r.窗口行, '瞭望塔第 1 次静默阵亡，已自动重挂 7/7（缺 流水关键事件监视 已补）');
  assert.ok(s.痕.includes('值守瞭望塔自愈 seq=1 第1次 已挂=7/7 补挂=流水关键事件监视'),
    '自愈留痕必须含 seq 与补挂项名');
  s.走(5); 拍();
  const r2 = s.回执(2, 7, ['呼叫信箱监视', '产线事件流监视']);
  assert.equal(r2.窗口行, '瞭望塔第 2 次静默阵亡，已自动重挂 7/7（缺 呼叫信箱监视、产线事件流监视 已补）');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, wp.STATE_FILE), 'utf8')).自愈次数, 2);
});

t('回执只许前进：乱序/重放不许把水位拽回去', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  拍(); s.走(5); 拍(); s.走(5); 拍();
  s.回执(3);
  s.回执(1);   // 迟到的旧回执
  assert.equal(wp.读态(root).在位.seq, 3, '水位被旧回执拽回去，就会凭空造出一次假阵亡');
});

t('seq 非法一律拒收，不许静默当成收到了', () => {
  const root = makeRoot(); const s = 台(root);
  // true 在列：CLI 把「--seq 后面漏了值」解析成 true，而 Number(true)===1。
  // 不挡就会把写错的调用静默记成「seq 1 已在位」——假在位会把三振对账整个骗过去。
  for (const bad of [0, -1, 'abc', undefined, null, true]) {
    const r = wp.记在位(root, { seq: bad, 已挂: 7 }, s.deps);
    assert.equal(r.ok, false, `seq=${bad} 该被拒`);
  }
  assert.equal(wp.读态(root).在位.seq, 0);
});

// ── ⑤ 静默正确性：全员在位期间零窗口报文 ──────────────────────
t('连续 6 拍全在位：窗口报文 0 行，心跳行与 ack 行成对', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  const 报 = [];
  for (let i = 1; i <= 6; i++) {
    const r = 拍();
    const a = s.回执(r.seq, 7, []);      // 塔每拍跑完 watch-rearm，无缺项
    if (a.窗口行) 报.push(a.窗口行);
    s.走(5);
  }
  assert.equal(报.length, 0, '全员在位期间窗口必须一行不刷');
  assert.equal(s.急.length, 0, '也不许有急件');
  assert.equal(心跳数(s.痕), 6);
  assert.equal(ack数(s.痕), 6, '心跳行与 ack 行成对');
  assert.equal(wp.读态(root).无回执, 0);
});

// ── ⑥ 拍体自己炸不许静默 ───────────────────────────────────────
t('journal 写不动时留痕降级，不把定时器整条掀翻', () => {
  const root = makeRoot(); const 兜 = [];
  let 炸 = true;
  const deps = {
    journal: { append: (_r, s) => { if (炸) { 炸 = false; throw new Error('盘满'); } 兜.push(s); } },
    inbox: { post: () => {} }, now: () => Date.parse('2026-08-26T00:00:00Z'),
  };
  const 拍 = wp.造心跳拍(() => root, () => ({}), { deps });
  const r = 拍();
  assert.equal(r.seq, null); assert.ok(r.异常, '异常要报出来，不许吞');
  assert.ok(兜.some((l) => l.startsWith('值守心跳拍异常')), '「不阻塞」的代价不该是「不知道」');
  assert.equal(wp.读态(root).seq, 0, '心跳没写进 journal 就不许烧掉一个 seq——塔根本没见过那一拍');
});

// ── ⑦ 消费端 gatereg G25 ──────────────────────────────────────
const G25 = (root) => gr.等我(root, { deps: {
  store: { list: () => [] }, specials: { list: () => [] }, ideas: { list: () => [] },
  schedule: { 读: () => ({ 粒: [] }) }, wiki: { 待审: () => [] }, features: { list: () => [] },
  值守: { 班档目录: (r) => path.join(r, '__无__'), 瞭望塔目录: (r) => path.join(r, '__无__') },
  台账: { 事件流体检: () => ({ 坏行: [], 含NUL: false, 无类型: [], 总行: 0 }) },
  台账目录: (r) => path.join(r, '__无__'),
  码印: { 比对: () => ({ 一致: true }), 源码改动时刻: () => null },
} }).债.filter((x) => x.闸号 === 'G25');

t('G25：注册表在册、归总监、响应型', () => {
  const g = gr.缺省注册表.find((x) => x.闸号 === 'G25');
  assert.ok(g, 'G25 必须在缺省注册表里');
  assert.equal(g.归属, '总监');
  assert.equal(g.型, '响应');
  assert.equal(g.判据, '值守塔阵亡');
  assert.equal(new Set(gr.缺省注册表.map((x) => x.闸号)).size, gr.缺省注册表.length, '闸号不许重');
  assert.notEqual(g.名称, gr.缺省注册表.find((x) => x.闸号 === 'G20').名称,
    '两个「瞭望塔」是两件事，闸名不许撞（G20 盯常驻守护，G25 盯值守会话第 7 项）');
});

t('G25：没起过节拍器＝零债（「不知道」不许冒充「有事」）', () => {
  assert.equal(G25(makeRoot()).length, 0);
});

t('G25：第 2 拍无回执时零债，判亡后才立债且带缺失区间', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  拍(); s.回执(1);
  s.走(5); 拍(); s.走(5); 拍(); s.走(5); 拍();          // seq=4：缺 2 拍
  assert.equal(G25(root).length, 0, '★第 2 拍看板也必须干净——两侧同一把尺');
  s.走(5); 拍();                                        // seq=5：三振
  const 债 = G25(root);
  assert.equal(债.length, 1);
  assert.match(债[0].title, /连续 3 拍无在位回执（缺失 seq 2~4）/);
  assert.equal(债[0].gateKey, 'G25:值守瞭望塔');
  assert.ok(债[0].停摆自, '停摆自要能算出欠了多久');
});

t('G25：塔恢复在位后当场销债（不许是恒真闸）', () => {
  const root = makeRoot(); const s = 台(root); const 拍 = s.造拍();
  拍(); s.回执(1);
  for (let i = 0; i < 4; i++) { s.走(5); 拍(); }
  assert.equal(G25(root).length, 1);
  s.回执(5); s.走(5); 拍();
  assert.equal(G25(root).length, 0, 'G14 恒真闸的教训：判据要盯「现场还在不在」');
});

// ── ⑧ CLI 接缝 ─────────────────────────────────────────────────
t('值守在位.js 参数解析：--k v 与 --k=v 两式都收', () => {
  const { 取参 } = require('../scripts/值守在位');
  const o = 取参(['node', 'x', '--seq', '42', '--已挂=7', '--补挂', 'a,b']);
  assert.equal(o.seq, '42'); assert.equal(o.已挂, '7'); assert.equal(o.补挂, 'a,b');
});

t('值守在位.js 端到端：有补挂打一行、无补挂一个字不打', () => {
  const { execFileSync } = require('child_process');
  const root = makeRoot(); const s = 台(root); s.造拍()();
  const 跑 = (args) => execFileSync(process.execPath,
    [path.join(__dirname, '..', 'scripts', '值守在位.js'), '--root', root, ...args],
    { encoding: 'utf8' });
  assert.equal(跑(['--seq', '1', '--已挂', '7']).trim(), '', '无变更静默');
  assert.equal(跑(['--seq', '2', '--已挂', '7', '--补挂', '流水关键事件监视']).trim(),
    '瞭望塔第 1 次静默阵亡，已自动重挂 7/7（缺 流水关键事件监视 已补）');
  assert.equal(wp.读态(root).在位.seq, 2, 'CLI 写的回执要能被拍体读到——跨进程这一段才是真接缝');
});

收尾('值守心跳', passed);
