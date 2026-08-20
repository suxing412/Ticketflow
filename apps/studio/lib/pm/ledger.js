// pm/ledger.js — 项目管理台账（H49）：职位常驻 = 台账常驻 + 事件唤醒
// 全明文落盘（透明化）：管理费 / 并发上限 / 事件流水 / 评分。
// 台账是唯一事实源；崩溃重启读盘续班。写入原子（temp+rename）。
//
// ⚠ 「台账里有的字段就是账」这句话不成立——同一份 JSON 里混着三种东西：**账**（真累加，
// 可直接当事实）、**快照**（每拍覆盖写，可能陈旧）、**派生**（读时现算，不落盘）。
// 谁是哪种，一律以本文件下方的 字段权威 表为准，别照 DEFAULT() 的形状猜（2026-08-20 丙-4）。
const fs = require('fs');
const path = require('path');

const DIR = (root) => path.join(root, '项管台账');
const STATE = (root) => path.join(DIR(root), '台账.json');
const EVENTS = (root) => path.join(DIR(root), '事件.jsonl');

// DEFAULT 只是**读盘兜底形状**，不是「这些字段都有账」的承诺。三个非账字段的真实身份见 字段权威：
//   就绪队列/在跑 = runner 派发拍的覆盖式快照（不是累加账，不跑拍就不刷新）
//   父单成本      = 零写入方；真值由 成本() 读时派生，视图() 下发时覆盖这里的空壳
const DEFAULT = () => ({
  就绪队列: [],       // 快照 · [{id, …}]（派发拍尾写；权威在 GET /api/agents）
  在跑: {},           // 快照 · id → {拉起时间, 池, agent}（死镜像，视图() 不下发；权威在 GET /api/agents）
  父单成本: {},       // 空壳 · 父单id → {token合计, 单数, 完成数}（真值走 成本() 派生）
  管理费: { token合计: 0, 次数: 0 },   // 账 · 真累加
  并发上限: { codex: 1, claude: 2 },   // 账 · 项管可调（保险丝以内）
  更新时间: null,
});

function read(root) {
  try {
    const s = JSON.parse(fs.readFileSync(STATE(root), 'utf8'));
    return { ...DEFAULT(), ...s };
  } catch (e1) {
    // 防清零（2026-08-05 管理费历史丢失案）：主档读失败不再静默退空账——
    // 先回退 .bak 副本；副本也不可用时把损毁现场留档再退空，全程 journal 留痕。
    try {
      const b = JSON.parse(fs.readFileSync(STATE(root) + '.bak', 'utf8'));
      try { journal(root, '台账主档读失败（' + e1.message + '），已用 .bak 副本回退'); } catch { /* 留痕失败不阻塞 */ }
      return { ...DEFAULT(), ...b };
    } catch {
      try {
        if (fs.existsSync(STATE(root))) {
          fs.copyFileSync(STATE(root), STATE(root) + '.损毁-' + Date.now() + '.json');
          journal(root, '台账主档与副本均不可读，退回空账（损毁现场已留档）');
        }
      } catch { /* 留痕失败不阻塞 */ }
      return DEFAULT();
    }
  }
}

function journal(root, msg) { try { require('../journal').append(root, msg); } catch { /* 无 journal 环境（测试）忽略 */ } }

function write(root, ledger) {
  fs.mkdirSync(DIR(root), { recursive: true });
  ledger.更新时间 = new Date().toISOString();
  const tmp = STATE(root) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
  // 写盘前留一份可解析的旧档做 .bak（600B 量级）；旧档已损毁则不覆盖现有 .bak
  try { JSON.parse(fs.readFileSync(STATE(root), 'utf8')); fs.copyFileSync(STATE(root), STATE(root) + '.bak'); } catch { /* 首写或旧档损毁：保留既有 .bak */ }
  fs.renameSync(tmp, STATE(root));
  return ledger;
}

function update(root, fn) {
  const l = read(root);
  fn(l);
  return write(root, l);
}

// 事件流水：只追加（派发/落袋/失败/切单/报警……）
const INBOX_TYPES = { 待审: '急', 上呈: '急', 收口报告: '急', 额度报警: '急' };
function event(root, 类型, data) {
  if (INBOX_TYPES[类型]) { try { require('../inbox').post(root, INBOX_TYPES[类型], 类型, JSON.stringify(data).slice(0, 200), data && data.父单 ? { 单号: data.父单 } : undefined); } catch { /* 信箱失败不阻塞记账 */ } }
  fs.mkdirSync(DIR(root), { recursive: true });
  const e = { t: new Date().toISOString(), 类型, ...(data || {}) };
  fs.appendFileSync(EVENTS(root), JSON.stringify(e) + '\n', 'utf8');
  return e;
}

function events(root, limit = 200) {
  try {
    const lines = fs.readFileSync(EVENTS(root), 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// H69 评分仪表盘：三线评分寄生采集，append-only jsonl。定位=路由决策仪表盘，不接任何自动奖惩。
const SCORES = (root) => path.join(DIR(root), '评分.jsonl');
function score(root, rec) {
  try {
    fs.mkdirSync(DIR(root), { recursive: true });
    fs.appendFileSync(SCORES(root), JSON.stringify({ t: new Date().toISOString(), ...rec }) + '\n', 'utf8');
  } catch { /* 评分失败不阻塞主流程 */ }
}
function scores(root, limit = 2000) {
  try {
    return fs.readFileSync(SCORES(root), 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/* ==================== 杀假读数（丙-4 · 2026-08-20）====================
   案源（grep 全仓 + 活体实测，不是推测）：DEFAULT() 里的 就绪队列/在跑/父单成本 三字段，
   read() 一律走 {...DEFAULT(), ...s} 兜底成 []/{}/{}。消费方拿到空值后照旧渲染——
   public/app.js 的 pmLedgerCard 就用 父单成本 画「专项成本归集」表，界面上永远写着
   「暂无归集」。那句话是假的：不是没成本，是**这个字段全仓没有任何写入方**。
   空值与未实现共用一个形状，界面必然报假数。

   逐字段核实结论（与调研简报有出入的地方以本表为准，证据在 写入方 一列）：
     就绪队列 —— **有**写入方（runner.js 派发拍尾覆盖写）。它是快照不是账：派发拍不跑
                （总闸合上 / 非派发制 / 进程没在转）就不刷新，可能陈旧但不是恒空。
     在跑     —— **有**写入方（同上一行），但**全仓零读取方**：/api/agents 的 在跑 是
                现算的，压根不看台账。写而不读 = 死镜像，留着只会与权威值分叉。
     父单成本 —— **真·零写入方**（grep 只命中本文件定义行），却真的在界面上被渲染。

   处置（制作人授「绝不许留着一个恒空字段让界面显示假数」）：
     父单成本 → 走 (a) 真接线，实现取「读时派生」而非「写时累加」，理由见 成本() 头注。
     在跑     → 走 (b)：从 视图() 下发面剔除，字段来源里明写权威在哪（read() 不动，
                持久值原样保留，runner 的写入方也不在本组写区）。
     就绪队列 → 值不动（有真写入方、有真读取方），只在 字段来源 里标明「快照·可能陈旧」。 */

const 终态 = ['完成', '已归档'];
const 容器类 = ['战役', '专项'];

// 字段权威表：每个字段一行，说清「值从哪来、谁说了算、能不能拿来当账」。
// 这张表本身就是接口的一部分——消费方据此分辨「真的是 0」与「这里根本没实现」。
const 字段权威 = {
  就绪队列: {
    来源: '快照', 写入方: 'lib/runner.js 派发拍（每拍覆盖写）', 权威: 'GET /api/agents',
    说明: '非累加账。派发拍不跑（总闸合上/非派发制/进程未转）就不刷新，读到的可能是上一拍的旧值。',
  },
  在跑: {
    来源: '快照', 写入方: 'lib/runner.js 派发拍（每拍覆盖写）', 权威: 'GET /api/agents（现算会话表）',
    已剔除: true,
    说明: '死镜像：全仓零读取方，且与 /api/agents 现算值会分叉。本接口不再下发，要在跑请读权威口。',
  },
  父单成本: {
    来源: '派生', 写入方: '无（每次读现算，不落盘）', 权威: 'ledger.成本()',
    说明: '按 专项/父单 归集子单回执自报 token（同 lib/report.parseReceipt 口径）。纯读工单库，对存量单追溯生效、不漂移。',
  },
  管理费: { 来源: '账', 写入方: 'lib/pm/brain.js 计费钩子', 权威: '本字段', 说明: '真累加账，可直接当钱看。' },
  并发上限: { 来源: '账', 写入方: 'server.js POST /api/pm/concurrency', 权威: '本字段', 说明: '项管可调（成本保险丝以内）。' },
};

/* 父单成本：读时派生。
   为什么不是「派发时写在跑、成单时写就绪队列、落袋时归集成本」那套写时累加：
     ① 落袋钩子全在本组写区之外（runner / wake / store.move），接不上；
     ② 更要紧的是——累加器必须**每一拍都不漏**才对得上账，而本仓已有两起漏拍前科白纸黑字
        记在注释里：server.js 的 记事件 曾 require 指错模块、被空 catch 吞了整整一个月零落盘；
        ledger-sync 的案源就是手工登粒漏了 6 张。漏拍的累加器不报错，只会永远歪着且不可自愈；
     ③ 派生是纯函数：对全库存量单追溯生效，口径要改重跑即可，零迁移零回填脚本。
   成本源＝回执明文里 agent 自报的 token，不另立一把尺（口径与 lib/report.parseReceipt 一致：
   取全文所有 "N token(s)" 里的最大值——回执里常同时出现分段计数与总计，最大值即总计）。 */
function 回执token(root, id) {
  try {
    const raw = fs.readFileSync(path.join(root, '回执', `${id}.md`), 'utf8');
    const tok = [...raw.matchAll(/([\d,]+)\s*tokens?/gi)]
      .map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => Number.isFinite(n));
    return tok.length ? Math.max(...tok) : null;
  } catch { return null; }
}

// 归集口径与 ledger-sync.差量 同源：容器（父单类型 战役/专项）与迁移伪单不是活单；
// 归属新路（fm.专项）优先、回落老路（fm.父单）；散单无容器不归集。
function 成本(root, opts = {}) {
  const 快照 = opts.快照 || require('../core/store').snapshot(root);
  const 取token = opts.取token || 回执token;
  const out = {};
  for (const s of Object.keys(快照 || {})) {
    for (const t of 快照[s] || []) {
      const fm = t.fm || {};
      if (容器类.includes(fm.父单类型)) continue; // 容器是壳，不是活单
      if (fm.迁移至专项) continue;                 // 迁移后的伪单：纸面留档，不重复计
      const 父 = fm.专项 || fm.父单;
      if (!父) continue;                            // 散单不归集（归集单位是容器）
      const k = String(父);
      const c = out[k] || (out[k] = { token合计: 0, 单数: 0, 完成数: 0, 有回执数: 0 });
      c.单数 += 1;
      if (终态.includes(t.state || s)) c.完成数 += 1;
      const tk = 取token(root, t.id);
      if (tk != null) { c.token合计 += tk; c.有回执数 += 1; }
    }
  }
  return out;
}

// 下发视图：read() 的账 + 派生字段真算 + 逐字段来源标注 - 已剔除字段。
// 成本算炸不许把整张台账带崩（同 pmLedger.event 待遇）：异常如实写进 字段来源，不假装为空。
function 视图(root, opts = {}) {
  const l = read(root);
  let 父单成本 = {}; let 异常 = null;
  try { 父单成本 = 成本(root, opts); } catch (e) { 异常 = String(e && e.message).slice(0, 160); }
  const 来源 = {};
  for (const [k, v] of Object.entries(字段权威)) 来源[k] = { ...v };
  if (异常) 来源.父单成本 = { ...来源.父单成本, 异常, 说明: '派生失败，下发空表——这是故障不是「无归集」：' + 异常 };
  const out = { ...l, 父单成本, 字段来源: 来源 };
  for (const [k, v] of Object.entries(字段权威)) if (v.已剔除) delete out[k];
  return out;
}

/* ==================== 行为分桶（丙-4 · 项管行为流水）====================
   案源：/api/pm/ledger 只下发尾 80 条，而活体台账 2577 条里 巡检 909 + 台账对齐 751 +
   池衡拒绝 271 占了 75%——全是机器心跳。真正的判断动作（估时校准 20、裁决 12、上呈 3、
   切单失败 1、并发调配 1）全被心跳挤出窗口：项管「做过判断」这件事在界面上等于不存在。
   治法：按类型分桶。心跳类**归一桶只报计数**（它们的全部信息量就是「跑没跑、跑了几拍」），
   判断类各成一桶各留明细——窗口再小也轮不到判断动作被心跳挤掉。 */
const 桶表 = {
  // —— 心跳：定时拍产物，逐条无信息量，归一桶只报计数 ——
  // 台账孤粒**不算心跳**：它是对齐拍撞见「粒指的单全库找不到」后交人裁的异常，去重后一粒只报一次。
  // 跟着 台账对齐 一起归心跳就等于把待裁事项埋进计数里——那是本接口要治的病，不是要犯的病。
  巡检: '机器心跳', 台账对齐: '机器心跳',
  // —— 判断：项管出主意 / 下结论的地方，各成一桶 ——
  派单委托: '起草', 待审: '起草', 起草失败: '起草',
  切单启动: '切单', 切单失败: '切单', 切单候期: '切单',
  排程登记: '排期', 排程转移: '排期', 排程调整: '排期',
  估时校准: '估时校准',
  池衡切换: '池衡', 池衡归位: '池衡', 池衡回退: '池衡', 池衡覆盖: '池衡',
  池衡解除覆盖: '池衡', 池衡拒绝: '池衡', 池衡越权: '池衡',
  派发: '派发', 迁移: '派发', 临时改池: '派发', 跨计费降级: '派发', 定稿放行: '派发',
  评估回呈: '定夺', 裁决: '定夺',
  上呈: '收口上呈', 收口待验: '收口上呈', 收口报告: '收口上呈', 专项关账: '收口上呈',
  编制调整: '编制并发', 并发调配: '编制并发',
  零派发: '告警', 打点停滞: '告警', 零输出: '告警', 额度报警: '告警', 台账孤粒: '告警',
  OAuth拒派: '凭据', OAuth告警: '凭据', OAuth自续: '凭据', OAuth续期: '凭据',
};
const 心跳桶 = '机器心跳';
const 其他桶 = '其他';
const 桶序 = ['起草', '切单', '排期', '估时校准', '定夺', '派发', '池衡', '收口上呈', '编制并发', '告警', '凭据', 其他桶, 心跳桶];

const 时刻 = (e) => { const n = Date.parse((e && e.t) || ''); return Number.isNaN(n) ? 0 : n; };

/* 桶内取样：先给桶里**每个类型**留一条最新的，再按时间补满余位。
   不这么做的话，同一个「心跳挤掉判断」的病会在桶内原样复发一次——池衡桶里 拒绝 271 条会把
   切换 4 条挤得一条不剩，而「项管想切池、被挡了 271 次」和「项管切成过 4 次」是两件事，
   都得看得见。保底一条 ≠ 报全，计数在 类型 一栏里是全的。 */
function 取样(行们, n) {
  const 降序 = [...行们].sort((a, b) => (时刻(b.e) - 时刻(a.e)) || (b.i - a.i));
  const 出 = []; const 见 = new Set();
  for (const r of 降序) { if (出.length >= n) break; if (见.has(r.e.类型)) continue; 见.add(r.e.类型); 出.push(r); }
  const 已取 = new Set(出.map((r) => r.i));
  for (const r of 降序) { if (出.length >= n) break; if (已取.has(r.i)) continue; 已取.add(r.i); 出.push(r); }
  return 出.sort((a, b) => (时刻(b.e) - 时刻(a.e)) || (b.i - a.i)).map((r) => r.e);
}

// 纯函数：事件数组 →（按桶聚合的）行为流水。不读盘不写盘，可整片单测。
function 分桶(事件们, opts = {}) {
  const 每桶 = Math.max(0, Number(opts.每桶) != null && Number.isFinite(Number(opts.每桶)) ? Number(opts.每桶) : 8);
  const 表 = { ...桶表, ...(opts.桶表 || {}) };
  const 行 = (事件们 || []).filter(Boolean).map((e, i) => ({ e, i }));
  const 分 = new Map(); const 未归类 = new Set();
  for (const r of 行) {
    const 类型 = String((r.e.类型 == null ? '' : r.e.类型)) || '（无类型）';
    const b = 表[类型] || (未归类.add(类型), 其他桶);
    if (!分.has(b)) 分.set(b, []);
    分.get(b).push(r);
  }
  const 桶 = [];
  for (const [名, 行们] of 分) {
    const 心跳 = 名 === 心跳桶;
    const 类型 = {}; const 按操作者 = {};
    for (const { e } of 行们) {
      const k = String(e.类型 == null ? '（无类型）' : e.类型);
      类型[k] = (类型[k] || 0) + 1;
      const 谁 = e.操作者 || e.由 || null;
      if (谁) 按操作者[String(谁)] = (按操作者[String(谁)] || 0) + 1;
    }
    const ts = 行们.map((r) => 时刻(r.e)).filter(Boolean).sort((a, b) => a - b);
    桶.push({
      桶: 名, 类: 心跳 ? '心跳' : '判断', 计数: 行们.length, 类型,
      按操作者: Object.keys(按操作者).length ? 按操作者 : null,
      首次: ts.length ? new Date(ts[0]).toISOString() : null,
      末次: ts.length ? new Date(ts[ts.length - 1]).toISOString() : null,
      // 心跳桶只报计数：逐条列出去只会把判断动作再挤一次，这正是本接口要治的病。
      最近: 心跳 ? [] : 取样(行们, 每桶),
    });
  }
  // 定序按 桶序 表（固定阅读顺序 > 按活跃度浮动：面板位置每次刷新都换位就没法用眼睛记住哪块是哪块），
  // 表外的桶垫在心跳桶之前，心跳永远最后一格。
  const 位 = (n) => { const i = 桶序.indexOf(n); return i < 0 ? 桶序.length - 1.5 : i; };
  桶.sort((a, b) => 位(a.桶) - 位(b.桶) || a.桶.localeCompare(b.桶));
  const 全时 = 行.map((r) => 时刻(r.e)).filter(Boolean).sort((a, b) => a - b);
  return {
    合计: 行.length,
    窗: {
      条数: 行.length,
      起: 全时.length ? new Date(全时[0]).toISOString() : null,
      讫: 全时.length ? new Date(全时[全时.length - 1]).toISOString() : null,
    },
    心跳占比: 行.length ? Math.round(100 * (分.get(心跳桶) || []).length / 行.length) : 0,
    桶,
    未归类: [...未归类].sort(),
  };
}

module.exports = {
  read, write, update, event, events, score, scores, DIR, DEFAULT,
  成本, 视图, 分桶, 回执token, 字段权威, 桶表, 桶序, 心跳桶, 其他桶, 终态, 容器类,
};
