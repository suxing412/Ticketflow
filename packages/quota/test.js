// test.js — 额度解读件（施工令-059）· 包自测
//
// 本文件只测本包自己的契约，**零 app 依赖**——那是 packages/ 的入包条件。
// 「gates 拿这些窗口去锁池对不对」属于**消费方接线**，测在 apps/studio/test/quota-接线.test.js
// 与既有 gates.test.js：包证明自己的输出形状，消费方证明自己接得住，各测各的那一半。
//
// 迁移纪律（照 packages/budget 先例）：从 apps/studio/lib/quota.js 迁来的判定**一行没改**，
// 故此处的断言先把老行为逐条钉死（窗口正名、fail-open、双闸取严），再补包边界。
const assert = require('node:assert');
const Q = require('./quota');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('quota 额度解读件测试（包自测）');

/* ===================== 一、重置时刻 ===================== */

t('fmtReset：秒/毫秒时间戳与 ISO 串都吃，解不出就原样吐回，绝不编时间', () => {
  assert.equal(Q.fmtReset(null), '未知');
  assert.equal(Q.fmtReset(undefined), '未知');
  const 秒 = Q.fmtReset(1786243868);          // 秒级（<1e12）按秒解
  const 毫 = Q.fmtReset(1786243868000);       // 毫秒级（>1e12）按毫秒解
  assert.equal(秒, 毫, '同一时刻的秒/毫秒两种写法必须解成同一个显示');
  assert.match(秒, /^\d{2}-\d{2} \d{2}:\d{2}$/, '格式是 MM-DD HH:mm（本地时区）：' + 秒);
  assert.match(Q.fmtReset('2026-08-09T05:50:00Z'), /^\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(Q.fmtReset('坏时间'), '坏时间', '解不出就把原值吐回去——比编一个像样的时间诚实');
  assert.notEqual(Q.fmtReset(0), '未知', '0 是合法时间戳（1970-01-01），不该被当空值');
  assert.match(Q.fmtReset(0), /^\d{2}-\d{2} \d{2}:\d{2}$/);
});

/* ===================== 二、窗口 label（施工令-010 窗口正名）===================== */

t('windowLabel：按窗口自报的时长说话——≤6h 报小时、≥9000 分报周、之间报分钟', () => {
  assert.equal(Q.windowLabel({ windowDurationMins: 300 }), '5小时');
  assert.equal(Q.windowLabel({ windowDurationMins: 360 }), '6小时', '360 分是「小时」那一档的上边界');
  assert.equal(Q.windowLabel({ windowDurationMins: 361 }), '361分钟', '过了边界就老实报分钟，不四舍五入成 6 小时');
  assert.equal(Q.windowLabel({ windowDurationMins: 45 }), '1小时', '45 分入小时档，Math.round 成 1小时（老口径，原样保留）');
  assert.equal(Q.windowLabel({ windowDurationMins: 8999 }), '8999分钟');
  assert.equal(Q.windowLabel({ windowDurationMins: 9000 }), '周');
  assert.equal(Q.windowLabel({ windowDurationMins: 10080 }), '周', 'codex 实机就是这个值');
  assert.equal(Q.windowLabel(null), '窗口', '窗口不自报时长就叫「窗口」，不假设是 5 小时');
  assert.equal(Q.windowLabel({}), '窗口');
});

/* ===================== 三、窗口解析（codex / claude 两种快照形状）===================== */

t('windowsOf（codex 快照）：primary/secondary 各出一条，pct 取整、reset 人读化', () => {
  const rl = { primary: { usedPercent: 69.4, windowDurationMins: 300, resetsAt: 1786243868 },
    secondary: { usedPercent: 90, windowDurationMins: 10080, resetsAt: 1786243868 } };
  const ws = Q.windowsOf(rl);
  assert.equal(ws.length, 2);
  assert.deepEqual(ws.map((w) => w.label), ['5小时', '周']);
  assert.deepEqual(ws.map((w) => w.pct), [69, 90], '69.4 → 69（四舍五入，不抹零也不进位）');
  assert.equal(ws[0].reset, Q.fmtReset(1786243868));
});

t('单窗池（codex 实机）：只有 primary 周窗时只出一条——不摆一条空的 5h 条误导读数', () => {
  const rl = { primary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: 1786243868 }, secondary: null };
  assert.deepEqual(Q.windowsOf(rl).map((w) => w.label), ['周']);
  assert.equal(Q.windowsOf(rl).length, 1);
  // claude 侧的单窗：只有 5h 读数时同理只出一条，不假造周条
  assert.deepEqual(Q.claudeWindows({ fiveHour: { utilization: 88, resets_at: 0 } }).map((w) => w.label), ['5小时']);
  assert.deepEqual(Q.claudeWindows({ sevenDay: { utilization: 12, resets_at: 0 } }).map((w) => w.label), ['周'],
    '只有周读数时也只出周条（次窗独立成立，不依赖主窗）');
});

t('空快照 / 未知形状：一律空清单，绝不抛也绝不编数', () => {
  for (const 坏 of [null, undefined, {}, { primary: null }, { primary: {} }, { primary: { resetsAt: 0 } }]) {
    assert.deepEqual(Q.windowsOf(坏), [], 'windowsOf 见 ' + JSON.stringify(坏) + ' 该给空清单');
  }
  // 未知池（既不是 codex 也不是 claude 的快照形状）：字段对不上就当没读到
  assert.deepEqual(Q.windowsOf({ 五小时: { 已用: 88 }, limits: [] }), []);
  assert.deepEqual(Q.claudeWindows({ five_hour: { utilization: 88 } }), [],
    '蛇形原名不是本包的输入契约（取数方负责改写成 fiveHour/sevenDay），认不出就报空');
  for (const 坏 of [null, undefined, {}, { fiveHour: null }, { fiveHour: {} }]) {
    assert.deepEqual(Q.claudeWindows(坏), []);
  }
  assert.equal(Q.windowsOf({ primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 0 } })[0].pct, 0,
    '0% 是读数不是空值——不能被 usedPercent==null 那道门误伤');
});

/* ===================== 四、文本描述（CLI / 日志用）===================== */

t('describe / describeClaude：无读数给空数组，有读数逐窗一句，套餐挂尾', () => {
  assert.deepEqual(Q.describe(null), []);
  assert.deepEqual(Q.describeClaude(null), []);
  const parts = Q.describe({ primary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: 0 }, planType: 'pro' });
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^周 已用 77%（.+ 重置）$/);
  assert.equal(parts[1], '套餐 pro');
  // 百分比缺失时描述里出 ?，不是 0——「不知道」和「零」是两回事
  assert.match(Q.describe({ primary: { windowDurationMins: 300, resetsAt: 0 } })[0], /5小时 已用 \?%/);
  const cp = Q.describeClaude({ fiveHour: { utilization: 30, resets_at: 0 }, sevenDay: { utilization: 95, resets_at: 0 } });
  assert.equal(cp.length, 2);
  assert.match(cp[0], /^5小时 已用 30%/);
  assert.match(cp[1], /^周 已用 95%/);
  assert.deepEqual(Q.describeClaude({ fiveHour: { resets_at: 0 } }), [], 'utilization 缺失＝没读数，一句都不出');
});

/* ===================== 五、守门判定 gateOf（双闸 + 余量感知）===================== */

t('默认阈值：min(gatePercent 80, 100−costBuffer 30) = 70——单张余量与阈值取严', () => {
  const g = Q.gateOf({ primary: { usedPercent: 69, windowDurationMins: 300, resetsAt: 0 } }, {});
  assert.equal(g.allowed, true);
  assert.equal(g.threshold, 70, '不是 80——不留单张余量就会 79% 放行、一单烧 30% 冲破 100%（TK-11-10）');
  assert.equal(g.usedPercent, 69);
});

t('主窗越线即拦：文案报真窗口名（周就说周）+ 拦截线 + 重置时刻，resetAt 出 ISO', () => {
  const g = Q.gateOf({ primary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: 1786243868 } }, {});
  assert.equal(g.allowed, false);
  assert.equal(g.threshold, 70);
  assert.equal(g.usedPercent, 77);
  assert.match(g.reason, /^周窗口已用 77%（拦截线 70%＝阈值与单张余量取严）/, g.reason);
  assert.ok(!g.reason.includes('5小时'), '窗口正名（施工令-010）：不许写死 5小时');
  assert.equal(g.resetAt, new Date(1786243868 * 1000).toISOString());
  // 恰好等于阈值就拦（>=，不是 >）
  assert.equal(Q.gateOf({ primary: { usedPercent: 70, windowDurationMins: 300, resetsAt: 0 } }, {}).allowed, false);
});

t('周闸兜底：主窗没越但周窗 ≥90% 照拦——周额度烧穿会停摆数日', () => {
  const rl = { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 0 },
    secondary: { usedPercent: 90, windowDurationMins: 10080, resetsAt: '2026-08-20T05:50:00Z' } };
  const g = Q.gateOf(rl, {});
  assert.equal(g.allowed, false);
  assert.equal(g.threshold, 90, '拦在周闸上时 threshold 报的是周阀门');
  assert.equal(g.usedPercent, 90);
  assert.match(g.reason, /周窗口已用 90%（周阀门 90%）/);
  assert.match(g.reason, /停摆数日/);
  assert.equal(g.resetAt, '2026-08-20T05:50:00.000Z');
  // 89.5% 不拦（<90）；主窗越线时主窗优先，周窗不抢话
  assert.equal(Q.gateOf({ ...rl, secondary: { ...rl.secondary, usedPercent: 89.5 } }, {}).allowed, true);
  const 双越 = Q.gateOf({ primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 0 }, secondary: rl.secondary }, {});
  assert.match(双越.reason, /^5小时窗口已用 99%/, '两窗齐越时报主窗（先到先拦，口径不变）');
});

t('阈值可配：gatePercent / costBufferPercent / weeklyGatePercent 三项各自生效', () => {
  const cfg = { quota: { gatePercent: 60, costBufferPercent: 10, weeklyGatePercent: 80 } };
  const g = Q.gateOf({ primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: 0 } }, cfg);
  assert.equal(g.threshold, 60, 'min(60, 100−10)=60');
  assert.equal(g.allowed, true);
  assert.equal(Q.gateOf({ primary: { usedPercent: 60, windowDurationMins: 300, resetsAt: 0 } }, cfg).allowed, false);
  // costBuffer=0（不留余量）→ 阈值就是 gatePercent
  assert.equal(Q.gateOf({ primary: { usedPercent: 79, windowDurationMins: 300, resetsAt: 0 } },
    { quota: { costBufferPercent: 0 } }).threshold, 80);
  // 周阀门调严到 50
  assert.equal(Q.gateOf({ primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 0 },
    secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 0 } },
  { quota: { weeklyGatePercent: 50 } }).allowed, false);
});

t('gatePercent 显式设 0 = 关闭守门：恒放行、threshold 0，且不看快照一眼', () => {
  for (const rl of [null, { primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 0 } }]) {
    const g = Q.gateOf(rl, { quota: { gatePercent: 0 } });
    assert.deepEqual(g, { allowed: true, threshold: 0, reason: '额度守门已关闭' },
      '关闸的返回体三个字段，多一个都不行（调用方据此连查询都不必发起）');
  }
});

t('fail-open 是红线：快照为空/主窗缺失/百分比缺失，一律放行并说明原因', () => {
  for (const 坏 of [null, undefined, {}, { primary: null }, { primary: {} }, { primary: { windowDurationMins: 300 } }]) {
    const g = Q.gateOf(坏, {});
    assert.equal(g.allowed, true, '守门查不着就把管线卡死是更大的事故：' + JSON.stringify(坏));
    assert.equal(g.reason, '额度查询不可用，放行（fail-open）');
    assert.equal(g.threshold, 70, 'fail-open 时也报出该有的拦截线，便于界面显示');
    assert.equal(g.usedPercent, undefined);
  }
  // 主窗缺失但周窗有数：仍按 fail-open 放行（老口径原样保留——判定入口只认 primary）
  const g = Q.gateOf({ primary: {}, secondary: { usedPercent: 99, windowDurationMins: 10080, resetsAt: 0 } }, {});
  assert.equal(g.allowed, true);
});

t('快照原样回挂 snapshot：调用方（界面/日志）不必再取一次数', () => {
  const rl = { primary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 0 }, planType: 'pro' };
  assert.equal(Q.gateOf(rl, {}).snapshot, rl, '同一个对象引用，不复制不改写');
  assert.equal(Q.gateOf(rl, {}).resetAt, undefined, '放行时不出 resetAt（只有拦下来才需要说什么时候解冻）');
});

/* ===================== 六、包的红线：纯函数，不碰外面的世界 ===================== */

t('包内零 I/O：源码里不出现 require —— 不发请求、不读文件、不拉进程', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'quota.js'), 'utf8');
  const 代码 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, '');
  assert.ok(!/\brequire\s*\(/.test(代码), '包里出现了 require——取数归调用方，本包只解读');
  for (const 禁 of ['child_process', 'fs.', 'fetch(', 'execFile', 'spawn(', 'process.env']) {
    assert.ok(!代码.includes(禁), '包里出现了 ' + 禁 + '——纯函数的红线');
  }
});

t('同输入恒同输出：连调两次逐字节相同（无缓存、无时钟、无隐藏状态）', () => {
  const rl = { primary: { usedPercent: 77, windowDurationMins: 10080, resetsAt: 1786243868 } };
  const cu = { fiveHour: { utilization: 30, resets_at: 0 }, sevenDay: { utilization: 95, resets_at: 0 } };
  for (const 跑 of [() => Q.windowsOf(rl), () => Q.claudeWindows(cu), () => Q.gateOf(rl, {}), () => Q.describe(rl)]) {
    assert.equal(JSON.stringify(跑()), JSON.stringify(跑()));
  }
  // 输入对象不被就地改写（调用方还要拿它画界面）
  const 原 = JSON.stringify(rl);
  Q.gateOf(rl, {}); Q.windowsOf(rl); Q.describe(rl);
  assert.equal(JSON.stringify(rl), 原, '快照被本包改写了——纯函数不许有副作用');
});

t('导出面锁死：老七个 + P0 批次新增两个纯函数（壳的形状校验仍按老七个，兼容旧包）', () => {
  assert.deepEqual(Object.keys(Q).sort(),
    ['claudeUsageRows', 'claudeWindows', 'describe', 'describeClaude', 'fmtReset', 'gateOf', 'resetISO', 'windowLabel', 'windowsOf']);
});

// ---- P0 批次（落实表-状态机与排期-2026-08-24）：resetAtISO 透出 + 时序账行 ----
t('resetISO：字符串原值原样、数值时间戳归 ISO、解不出给 null——机器可读，不编时间', () => {
  assert.equal(Q.resetISO('2026-08-24T15:00:00.000Z'), '2026-08-24T15:00:00.000Z');
  assert.equal(Date.parse(Q.resetISO(1756191600)), 1756191600 * 1000);
  assert.equal(Q.resetISO('看不懂的串'), null);
  assert.equal(Q.resetISO(null), null);
});

t('窗口对象并列带 resetAtISO：人读 reset 照留，机器另拿一份可 parse 的', () => {
  const ws = Q.claudeWindows({ fiveHour: { utilization: 30, resets_at: '2026-08-24T15:00:00.000Z' } });
  assert.equal(ws[0].resetAtISO, '2026-08-24T15:00:00.000Z');
  assert.ok(Number.isFinite(Date.parse(ws[0].resetAtISO)));
  assert.ok(ws[0].reset && !ws[0].reset.includes('T'), '人读串还在，且没被 ISO 顶掉');
  const cw = Q.windowsOf({ primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1756191600 } });
  assert.equal(Date.parse(cw[0].resetAtISO), 1756191600 * 1000);
});

t('claudeUsageRows：逐窗行 {窗, utilization, resets_at}——原值不取整，resets_at 可 parse', () => {
  const rows = Q.claudeUsageRows({ fiveHour: { utilization: 42.5, resets_at: '2026-08-24T15:00:00.000Z' }, sevenDay: { utilization: 7.2, resets_at: 1756191600 } });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { 窗: '5小时', utilization: 42.5, resets_at: '2026-08-24T15:00:00.000Z' });
  assert.equal(rows[1].窗, '周');
  assert.equal(Date.parse(rows[1].resets_at), 1756191600 * 1000);
  assert.deepEqual(Q.claudeUsageRows(null), [], '无快照给空清单，不抛');
});

console.log(`全部通过：${passed} 项`);
