// quota-timeline.test.js — 额度线 P0 批次（落实表-状态机与排期-2026-08-24）
// P0-1 额度读数时序账：queryClaudeUsage 成功读数逐窗追加 {t,池,窗,utilization,resets_at}
//       到 生产根/瞭望塔/额度读数.jsonl（只追加，appendFileSync，不整文件重写）。
// P0-2 resets_at 原样透出：packages/quota 窗口对象与 poolbalance 明细并列加 resetAtISO
//       （机器可读、Date.parse 得动、字符串原值原样），fmtReset 的人读串照留。
// 判据全走真行为：真调 queryClaudeUsage（注入 oauth/fetch，零凭据零外呼）、真读落盘 jsonl、
// 真调 归一读数/采集 看明细——不 grep 源码。
// 外呼绊线必须排在任何 lib/ 之前：lib/quota.js 加载那一刻就把 child_process 解构走了（体检 #71）
const 绊线 = require('./外呼绊线'); 绊线.装绊线();
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const quota = require('../lib/quota');
const 包 = require('../../../packages/quota/quota.js');
const PB = require('../lib/pm/poolbalance');
const { CFG, makeRoot, 收尾 } = require('./helper');

let passed = 0; const 队 = [];
const t = (n, f) => 队.push(async () => { await f(); passed++; console.log('  ✓ ' + n); });
console.log('额度线：时序账 + resetAtISO 透出');

const 账本 = (root) => path.join(root, '瞭望塔', '额度读数.jsonl');
const 行们 = (root) => (fs.existsSync(账本(root))
  ? fs.readFileSync(账本(root), 'utf8').split('\n').filter(Boolean) : []);

const ISO五 = '2026-08-24T15:00:00.000Z';       // OAuth 常见形态：ISO 字符串
const 秒周 = 1756191600;                         // 数值时间戳（秒）形态
const 查 = (root, data) => quota.queryClaudeUsage(root, { oauth: { accessToken: 'tok' }, fetch: async () => data });

let 根1 = null; let 首行 = null; // 用例 1↔2 共用：验「追加」而不是「重写」

t('P0-1 一次成功读数（单窗）→ jsonl 恰多一行；resets_at 可 parse 且等于 OAuth 原值', async () => {
  根1 = makeRoot();
  const r = await 查(根1, { fiveHour: { utilization: 42.5, resets_at: ISO五 } });
  assert.ok(r && r.fiveHour, '查询返回体不受时序账影响');
  const 行 = 行们(根1);
  assert.equal(行.length, 1, '恰多一行，实得 ' + 行.length);
  const o = JSON.parse(行[0]);
  assert.equal(o.池, 'claude');
  assert.equal(o.窗, '5小时');
  assert.equal(o.utilization, 42.5, 'utilization 存原值不四舍五入');
  assert.ok(Number.isFinite(Date.parse(o.resets_at)), 'resets_at 必须 Date.parse 得动');
  assert.equal(o.resets_at, ISO五, '字符串原值原样透出');
  assert.ok(Number.isFinite(Date.parse(o.t)), 't 必须 Date.parse 得动');
  首行 = 行[0];
});

t('P0-1 再读一次（双窗，周窗给秒时间戳）→ 追加两行共三行；旧行一字不动（追加非重写）', async () => {
  await 查(根1, { fiveHour: { utilization: 43, resets_at: ISO五 }, sevenDay: { utilization: 7.2, resets_at: 秒周 } });
  const 行 = 行们(根1);
  assert.equal(行.length, 3, '两窗各一行，累计三行，实得 ' + 行.length);
  assert.equal(行[0], 首行, '第一行必须原封不动——整文件重写会把它抹了重排');
  const 周 = JSON.parse(行[2]);
  assert.equal(周.窗, '周');
  assert.equal(Date.parse(周.resets_at), 秒周 * 1000, '秒时间戳归成同一时刻的可 parse ISO');
});

t('P0-1 失败读数与无凭据都不落账：jsonl 行数不变', async () => {
  const before = 行们(根1).length;
  assert.equal(await 查(根1, null), null, 'fetch 失败照旧返回 null');
  const r = await quota.queryClaudeUsage(根1, { oauth: null, fetch: async () => { throw new Error('不该走到'); } });
  assert.equal(r, null, '无凭据照旧返回 null');
  assert.equal(行们(根1).length, before, '失败不记账——时序账只认成功读数');
});

t('P0-1 写口自身守边界：无 root / 无数据返回 0 且不炸（旁账绝不打断主业）', () => {
  assert.equal(quota.记读数(null, 'claude', { fiveHour: { utilization: 1, resets_at: ISO五 } }), 0);
  assert.equal(quota.记读数(makeRoot(), 'claude', null), 0);
  assert.equal(quota.记读数(makeRoot(), 'claude', {}), 0, '无任何窗读数就没有行可追加');
});

t('P0-2 包层：claudeWindows/windowsOf 并列出 resetAtISO，人读串照留', () => {
  const ws = 包.claudeWindows({ fiveHour: { utilization: 81, resets_at: ISO五 }, sevenDay: { utilization: 3, resets_at: 秒周 } });
  assert.equal(ws.length, 2);
  assert.equal(ws[0].resetAtISO, ISO五, '字符串原值原样');
  assert.equal(Date.parse(ws[1].resetAtISO), 秒周 * 1000, '秒时间戳归 ISO 后仍是同一时刻');
  assert.match(ws[0].reset, /^\d{2}-\d{2} \d{2}:\d{2}$/, '显示串格式未动（无年无秒——那是给人看的，机器看 resetAtISO）');
  const cw = 包.windowsOf({ primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 秒周 } });
  assert.equal(Date.parse(cw[0].resetAtISO), 秒周 * 1000, 'codex 窗同样带 resetAtISO');
  assert.equal(包.resetISO('看不懂的串'), null, '解不出就 null，绝不编一个像样的时间');
});

t('P0-2 poolbalance 明细：gates 窗口条目带 resetAtISO 时原样透出且可 parse', () => {
  const locks = { claude: { locked: false, 更新于: Date.now(), 窗口: [{ label: '5小时', pct: 40, 阈值: 70, resetAtISO: ISO五 }] } };
  const 读 = PB.归一读数(CFG, { locks, 余额: {}, 时刻: new Date().toISOString(), claude凭据: true });
  assert.equal(读.claude.盲区, false);
  assert.equal(读.claude.明细[0].resetAtISO, ISO五);
  assert.ok(Number.isFinite(Date.parse(读.claude.明细[0].resetAtISO)));
});

t('P0-2 poolbalance 明细：窗口条目没带时从 allLocks 捎回的原始快照现算（cu/rl 两路）', () => {
  const locks = {
    claude: { locked: false, 更新于: Date.now(), 窗口: [{ label: '5小时', pct: 40, 阈值: 70 }, { label: '周', pct: 3, 阈值: 90 }] },
    codex: { locked: false, 窗口: [{ label: '周', pct: 55, 阈值: 90 }] },
    cu: { fiveHour: { utilization: 40, resets_at: ISO五 }, sevenDay: { utilization: 3, resets_at: 秒周 } },
    rl: { primary: { usedPercent: 55, windowDurationMins: 10080, resetsAt: 秒周 } },
  };
  const 读 = PB.归一读数(CFG, { locks, 余额: {}, 时刻: new Date().toISOString(), claude凭据: true });
  assert.equal(读.claude.明细[0].resetAtISO, ISO五, '5小时窗＝OAuth 原值');
  assert.equal(Date.parse(读.claude.明细[1].resetAtISO), 秒周 * 1000, '周窗自 cu 原始快照现算');
  assert.equal(Date.parse(读.codex.明细[0].resetAtISO), 秒周 * 1000, 'codex 自 rl 原始快照现算');
});

t('P0-2 采集口（/api/pm/poolbalance 的数据源头）：注入快照走完整管线，明细带可 parse 的 resetAtISO', async () => {
  const locks = {
    claude: { locked: false, 更新于: Date.now(), 窗口: [{ label: '5小时', pct: 40, 阈值: 70 }] },
    cu: { fiveHour: { utilization: 40, resets_at: ISO五 } },
  };
  const 读 = await PB.采集(makeRoot(), CFG, { locks, 余额: {}, claude凭据: true });
  assert.equal(读.claude.明细[0].resetAtISO, ISO五);
  assert.ok(Number.isFinite(Date.parse(读.claude.明细[0].resetAtISO)));
});

(async () => {
  for (const f of 队) await f();
  绊线.断言无外呼(assert);
  收尾('额度线时序账', passed);
})().catch((e) => { console.error('  ✗ ' + (e && (e.stack || e.message))); process.exitCode = 1; });
