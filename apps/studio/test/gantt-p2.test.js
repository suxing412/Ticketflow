// gantt-p2.test.js — 四层树甘特 P2 写口交互端到端判据（施工令 #10/#11/#12 · 2026-08-24）
//
// 判据基座同 gantt-p0/p1（CX-11）：同一份 test/fixtures/甘特合成台账.js（台账已带 环三角/
// 跨项目外部/悬空/冲突边/越线两分支）、同一套 vm 沙箱装载（补岛DOM/装岛 照抄成例）。
// 全程 H104：每条判据附变异自证（拨数据断言必须跟着翻），没有一条 grep 源码。
//
// P2 程序口约定（岛侧 public/gantt.js）：
//   GanttIsland.试拖(粒ID, 模式, dx像素) —— 鼠标松手（收拖）分流的同一条产线：
//     可拖判(#11 只读) → 拖几何(15 分钟吸附) → 拖分流(#10 两路：普通→tqReplan 预填、
//     越线→tqStance 预填 决定=重排)；判据②③直调不模拟鼠标。
//   _测 新增纯函数面：吸附/像素毫/毫钟面/拖几何/贝塞尔/锚点集/线HTML/刻毫（判据①④⑤）。
// DOM 判据抓手（P2 新增，前缀 gt2 同约定）：
//   端点手柄  .gt2h l / .gt2h r（可拖条内；只读态＝停表或终态不出，#11）
//   依赖线    svg.gt2deps 内 <g class="gtedge[ conflict][ cyc][ ext]" data-边=i data-from data-to>
//             ——conflict 当且仅当服务端 边[i].冲突===true（判据④锁死只画不判）
//   冲突角标  .gt2cbadge data-数="<n>"（n=服务端 边统计.冲突；0 时 hidden，判据⑥）
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const schedule = require('../lib/pm/schedule');
const { 造台账, 现在 } = require('./fixtures/甘特合成台账');

let passed = 0;
const 待 = [];
const t = (n, f) => 待.push([n, f]);
console.log('gantt-p2 写口交互端到端判据（#10 拖拽两路分流 / #11 只读态 / #12 贝塞尔依赖线）');

// ---- 沙盒与工具（照抄 gantt-p0/p1 成例；上限即契约：这里没有的 API 岛不许依赖）----
const 造存储 = () => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };

function 补岛DOM() {
  const { El } = require('./minidom');
  if (El.prototype._gt2补) return El;
  El.prototype._gt2补 = true;
  const 驼峰转 = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const 单配 = (el, s) => {
    let ok = true; let rest = s.trim();
    const tag = /^[a-zA-Z][\w-]*/.exec(rest);
    if (tag) { ok = ok && el.tagName === tag[0].toUpperCase(); rest = rest.slice(tag[0].length); }
    const re = /([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g; let p;
    while ((p = re.exec(rest))) {
      if (p[1] === '.') ok = ok && (' ' + (el.getAttribute('class') || '') + ' ').includes(' ' + p[2] + ' ');
      else if (p[1] === '#') ok = ok && el.getAttribute('id') === p[2];
      else if (p[3]) ok = ok && (p[4] !== undefined ? el.getAttribute(p[3]) === p[4] : el.hasAttribute(p[3]));
    }
    return ok;
  };
  const 匹配 = (el, sel) => String(sel).split(',').some((s) => s.trim() && 单配(el, s));
  const 收 = (el, sel, out) => {
    for (const c of el.childNodes || []) {
      if (c.nodeType === 1) { if (匹配(c, sel)) out.push(c); 收(c, sel, out); }
    }
    return out;
  };
  Object.assign(El.prototype, {
    querySelector(sel) { return 收(this, sel, [])[0] || null; },
    querySelectorAll(sel) { return 收(this, sel, []); },
    matches(sel) { return 匹配(this, sel); },
    closest(sel) { let n = this; while (n && n.nodeType === 1) { if (匹配(n, sel)) return n; n = n.parentNode; } return null; },
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    replaceWith(nw) { if (this.parentNode) this.parentNode.replaceChild(nw, this); },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
  });
  Object.defineProperties(El.prototype, {
    firstElementChild: { get() { return (this.childNodes || []).find((c) => c.nodeType === 1) || null; } },
    children: { get() { return (this.childNodes || []).filter((c) => c.nodeType === 1); } },
    className: { get() { return this.getAttribute('class') || ''; }, set(v) { this.setAttribute('class', String(v)); } },
    hidden: { get() { return this.hasAttribute('hidden'); },
      set(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); } },
    textContent: { get() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); },
      set(v) { this.childNodes = []; if (v != null && v !== '') this.appendChild(new (require('./minidom').Txt)(String(v))); } },
    isConnected: { get() { return true; } },
    content: { get() { return this; } },
    scrollTop: { get() { return this._st || 0; }, set(v) { this._st = Number(v) || 0; } },
    scrollLeft: { get() { return this._sl || 0; }, set(v) { this._sl = Number(v) || 0; } },
    clientHeight: { get() { return 0; } }, clientWidth: { get() { return 0; } },
    offsetWidth: { get() { return 0; } }, offsetHeight: { get() { return 0; } },
    dataset: { get() {
      if (!this._ds) {
        const el = this;
        this._ds = new Proxy({}, {
          get: (t2, k) => { const v = el.getAttribute('data-' + 驼峰转(String(k))); return v == null ? undefined : v; },
          set: (t2, k, v) => { el.setAttribute('data-' + 驼峰转(String(k)), String(v)); return true; },
          has: (t2, k) => el.hasAttribute('data-' + 驼峰转(String(k))),
        });
      }
      return this._ds;
    } },
    style: { get() {
      if (!this._styleP) {
        const el = this; const bag = {};
        this._styleP = new Proxy(bag, {
          get: (t2, k) => (k in t2 ? t2[k] : ''),
          set: (t2, k, v) => {
            t2[k] = String(v);
            el.setAttribute('style', Object.keys(t2).map((a) => `${驼峰转(a)}:${t2[a]}`).join(';'));
            return true;
          },
        });
      }
      return this._styleP;
    } },
  });
  return El;
}

function 装岛(存储) {
  const 岛路径 = path.join(__dirname, '..', 'public', 'gantt.js');
  const src = fs.readFileSync(岛路径, 'utf8');
  const El = 补岛DOM();
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop },
    setTimeout: noop, clearTimeout: noop, clearInterval: noop, setInterval: noop, requestAnimationFrame: noop,
    localStorage: 存储 || 造存储(),
    location: { hash: '' },
    innerWidth: 1280, innerHeight: 800,
    addEventListener: noop, removeEventListener: noop,
    document: { createElement: (tag) => new El(tag), getElementById: () => null, activeElement: null },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'gantt.js' });
  assert.ok(ctx.GanttIsland && typeof ctx.GanttIsland.render === 'function', 'gantt.js 装载后必须挂出 window.GanttIsland.render');
  return ctx;
}

const 画 = (数据, 选项 = {}, 存储) => {
  const ctx = 装岛(存储);
  const { El } = require('./minidom');
  const 容器 = new El('div');
  ctx.GanttIsland.render(容器, 数据, { 现在, 视口: { 滚过行: 0, 行数: 200 }, ...选项 });
  return { ctx, 容器, html: 容器.innerHTML };
};
const 变体 = (数据) => JSON.parse(JSON.stringify(数据));
const 块 = (html, key) => {
  const i = html.indexOf(key);
  assert.ok(i >= 0, `页面里找不到 ${key}`);
  const 起 = Math.max(0, html.lastIndexOf('<div', i));
  const 下行 = /<div\b[^>]*class="[^"]*\bgt2row\b/g;
  下行.lastIndex = 起 + 10;
  const 界m = 下行.exec(html);
  return html.slice(起, 界m ? 界m.index : html.length);
};
// 行几何：行顶（style top，虚拟化的绝对行位）+ 实条 left/width（固定 px 轴）
const 行几何 = (html, gid) => {
  const 行块 = 块(html, `data-gid="${gid}"`);
  const 开 = 行块.slice(0, 行块.indexOf('>') + 1);
  const top = /top:([\d.]+)px/.exec(开);
  const bar = /class="gt2bar[^"]*"[^>]*style="left:([\d.]+)px;width:([\d.]+)px"/.exec(行块);
  assert.ok(top && bar, `行 ${gid} 的几何抓不全（top/条）`);
  return { top: +top[1], 行: Math.round(+top[1] / 30), left: +bar[1], width: +bar[2] };
};
// 依赖线组：class / 边序 / 端点键 / title 词 / path d（含首末坐标）
const 组们 = (html) => [...html.matchAll(
  /<g class="(gtedge[^"]*)" data-边="(\d+)" data-from="([^"]*)" data-to="([^"]*)"><title>([^<]*)<\/title><path class="ln" d="([^"]*)"/g,
)].map((m) => {
  const nums = (m[6].match(/-?[\d.]+/g) || []).map(Number);
  return { 类: m[1], i: +m[2], from: m[3], to: m[4], 词: m[5], d: m[6],
    x1: nums[0], y1: nums[1], x2: nums[nums.length - 2], y2: nums[nums.length - 1], 组文: m[0] };
});
const 近 = (a, b, 差 = 0.15) => Math.abs(a - b) < 差;

/* ═══ ① 钟面往返（#10/CX-13）：像素→时间→像素恒等，吸附恒 00/15/30/45，产串与服务端同语义 ═══
 * 变异自证点（实现侧）：吸附 round 改 floor → 恒等/刻钟断言红；毫钟面 改本地 getters → 往返断裂。 */
t('① 钟面往返：像素↔时间恒等（含 23:45/跨日/纯日期存量起点）；吸附恒刻钟；产串=服务端 规范计划时刻 原样收下', () => {
  const T = 装岛().GanttIsland._测;
  const 界 = T.段('2026-08-20T00:00', '2026-08-31T00:00');
  const 窗 = T.算窗([界.起, 界.讫]);
  const 像素 = (ms) => ((ms - 窗.t0) / 3600000) * T.HW;
  for (const 串 of ['2026-08-24T23:45', '2026-08-25T00:00', '2026-08-24T00:15', '2026-08-23']) {
    const ms = T.段(串, null).起;
    const px = 像素(ms);
    const ms2 = T.吸附(窗.t0 + T.像素毫(px));
    assert.equal(ms2, ms, `${串}：像素反算+吸附须还原原毫（px=${px}）`);
    const 面 = T.毫钟面(ms2);
    assert.equal(面, /T/.test(串) ? 串 : 串 + 'T00:00',
      `${串}：钟面串往返恒等（纯日期存量起点 → 当日 00:00 刻钟形）`);
    assert.equal(像素(T.段(面, null).起), px, `${串}：像素→时间→像素恒等`);
    // 与 lib/pm/schedule 同语义（串即契约）：服务端 规范计划时刻 一字不改收下、计划毫秒 可解析
    assert.equal(schedule.规范计划时刻(面).值, 面, `${面}：服务端刻钟闸必须原样收下（15 分对齐）`);
    assert.ok(schedule.计划毫秒(面) != null, `${面}：服务端 计划毫秒 必须可解析`);
  }
  for (const px of [1, 6.7, 13.3, 99.9, 1234.5]) {
    assert.match(T.毫钟面(T.吸附(窗.t0 + T.像素毫(px))), /T\d{2}:(00|15|30|45)$/,
      `任意像素（${px}）反算的分钟只许落刻钟 00/15/30/45`);
  }
  // 吸附=就近刻钟（不是截断也不是进位）：8min 进 15、7min 退 00——floor/ceil 冒充 round 在这必红
  assert.equal(T.吸附(窗.t0 + 8 * 60000), 窗.t0 + 15 * 60000, '8min 须就近吸附到 :15（floor 冒充必红）');
  assert.equal(T.吸附(窗.t0 + 7 * 60000), 窗.t0, '7min 须就近吸附到 :00（ceil 冒充必红）');
  // 拖几何三模式（跨日样本 23:45→01:00）：移=平移工期不变、左=讫不动、右=起不动、最窄一刻钟
  const s = T.段('2026-08-24T23:45', '2026-08-25T01:00');
  const 移 = T.拖几何(s, '移', 20); // 20px = 1h
  assert.equal(T.毫钟面(移.起), '2026-08-25T00:45', '平移 +1h 跨日：起点须跨到次日 00:45');
  assert.equal(移.讫 - 移.起, s.真讫 - s.起, '拖条身=整体平移，工期不变');
  const 左 = T.拖几何(s, '左', -20);
  assert.equal(T.毫钟面(左.起), '2026-08-24T22:45', '拉左端点：起点 -1h');
  assert.equal(左.讫, s.真讫, '拉左端点：讫点不动');
  const 右 = T.拖几何(s, '右', 20);
  assert.equal(右.起, s.起, '拉右端点：起点不动');
  assert.equal(T.毫钟面(右.讫), '2026-08-25T02:00', '拉右端点：讫点 +1h');
  assert.equal(T.拖几何(s, '左', 99999).起, s.真讫 - T.刻毫, '左端点拖过讫：钳在 讫−15min（最窄一刻钟）');
});

/* ═══ ② 拖拽两路分流（#10）＋只读不启动（#11）═══
 * 程序口 试拖＝鼠标松手（收拖）分流的同一条产线。沙箱断回调与预填参数。
 * 变异自证点：g-越A 拨成已成单（不再越线）→ 分流从表态口翻到重排口。 */
t('② 拖拽分流：普通条→tqReplan 预填、越线条→tqStance 预填(决定=重排)；吸附落预填；终态/停表不启动、手柄不出', () => {
  const 数据 = 造台账();
  const 首 = 画(数据);
  const 记 = { 重排: [], 表态: [] };
  首.ctx.tqReplan = (id, 预填) => 记.重排.push([id, 预填]);
  首.ctx.tqStance = (id, 预填) => 记.表态.push([id, 预填]);
  // 普通条平移 +2h（40px）：工期不变，预填=吸附后钟面
  const r1 = 首.ctx.GanttIsland.试拖('g-c01', '移', 40);
  assert.deepEqual([r1.启动, r1.变, r1.口], [true, true, '重排'], '普通条松手须走重排口');
  assert.deepEqual(记.重排[0], ['g-c01', { 计划开始: '2026-08-24T16:00', 计划完成: '2026-08-24T18:00', 拖拽: true }],
    '平移 +2h：tqReplan 预填=新计划两格（14:00→16:00 平移为 16:00→18:00，工期 2h 不变）');
  // 拉右端点 +30min（10px）：起点不动
  首.ctx.GanttIsland.试拖('g-c01', '右', 10);
  assert.deepEqual(记.重排[1][1], { 计划开始: '2026-08-24T14:00', 计划完成: '2026-08-24T16:30', 拖拽: true },
    '拉右端点 +30min：起点不动、讫点 16:30——两路里的端点路改工期');
  // 非刻钟位移（7px=21min）→ 预填必须已吸附（15 分钟格）
  首.ctx.GanttIsland.试拖('g-c01', '移', 7);
  assert.deepEqual(记.重排[2][1], { 计划开始: '2026-08-24T14:15', 计划完成: '2026-08-24T16:15', 拖拽: true },
    '21min 位移吸附到 14:15——提交的只能是刻钟串');
  // 越线待重判条 → 表态口预填（决定=重排+新计划），不走普通重排
  const r2 = 首.ctx.GanttIsland.试拖('g-越A', '移', 20);
  assert.equal(r2.口, '表态', '越线条松手须分流到表态口（强制二选一不许绕）');
  assert.deepEqual(记.表态[0], ['g-越A', { 决定: '重排', 新计划开始: '2026-08-24T11:00', 新计划完成: '2026-08-24T16:00', 拖拽: true }],
    '越线条 +1h：tqStance 预填 决定=重排+新计划两格');
  assert.equal(记.重排.length, 3, '越线条不许落进重排口');
  // 原地松手（吸附后没挪）＝取消：不弹任何口
  const r0 = 首.ctx.GanttIsland.试拖('g-c01', '移', 2);
  assert.deepEqual([r0.启动, r0.变], [true, false], '2px（6min）吸附回原位：变=false');
  assert.equal(记.重排.length + 记.表态.length, 4, '没挪就不弹窗');
  // 终态条不启动（#11 只读之一）
  const r3 = 首.ctx.GanttIsland.试拖('g-完1', '移', 40);
  assert.deepEqual([r3.启动, r3.因], [false, '终态只读'], '终态条拖拽不启动');
  // 手柄（.gt2h）：可拖条有、终态条无
  assert.ok(/gt2h l/.test(块(首.html, 'data-gid="g-c01"')) && /gt2h r/.test(块(首.html, 'data-gid="g-c01"')),
    '可拖条须带左右端点手柄（6px 热区）');
  assert.ok(!/class="gt2h [lr]"/.test(块(首.html, 'data-gid="g-完1"')), '终态条不出端点手柄（#11）');
  // 停表（/api/gates paused）＝整图只读：手柄全不出、拖不启动、悬停详情照常
  const 停 = 画({ ...数据, 停表: true });
  停.ctx.tqReplan = (id, 预填) => 记.重排.push([id, 预填]);
  const r4 = 停.ctx.GanttIsland.试拖('g-c01', '移', 40);
  assert.deepEqual([r4.启动, r4.因], [false, '停表只读'], '停表时拖拽不启动');
  assert.ok(!/class="gt2h [lr]"/.test(停.html), '停表时整图不出端点手柄');
  assert.ok(停.ctx.GanttIsland.悬浮卡Html('g-c01').includes('并发件1'), '只读态悬停详情照常（#11）');
  assert.equal(记.重排.length, 3, '停表下没有一笔分流落口');
  // 变异自证：g-越A 拨成已成单（不再越线）→ 分流翻到重排口
  const 变 = 变体(数据); 变.粒.find((g) => g.粒ID === 'g-越A').状态 = '已成单';
  const 二 = 画(变);
  const 记2 = { 重排: [], 表态: [] };
  二.ctx.tqReplan = (id, 预填) => 记2.重排.push([id, 预填]);
  二.ctx.tqStance = (id, 预填) => 记2.表态.push([id, 预填]);
  assert.equal(二.ctx.GanttIsland.试拖('g-越A', '移', 20).口, '重排',
    '拨成已成单后同一条须翻到重排口——分流从数据推导，不是写死名单');
  assert.equal(记2.表态.length, 0, '不越线就没有表态口');
});

/* ═══ ③ 原位回滚（#10）：确认框取消后岛数据与 DOM 与拖前一致（签名对比）═══
 * 岛的回滚契约＝岛数据从头不动：分流只递预填给壳层弹窗，取消（回调不写账）后重绘即回滚。
 * 变异自证点（实现侧）：拖分流 里若乐观改写 n.粒.计划开始 → 签名对比断言红。 */
t('③ 回滚：拖拽分流（=弹窗预填后取消）不动岛数据——DOM 签名逐字节一致，同数据重绘仍一致', () => {
  const 数据 = 造台账();
  const 首 = 画(数据);
  首.ctx.tqReplan = () => {}; 首.ctx.tqStance = () => {}; // 取消：弹窗回调不写账
  const 前html = 首.容器.innerHTML;
  const 前几何 = 行几何(前html, 'g-c01');
  首.ctx.GanttIsland.试拖('g-c01', '移', 40);
  首.ctx.GanttIsland.试拖('g-越A', '右', 20);
  assert.equal(首.容器.innerHTML, 前html, '分流后 DOM 与拖前逐字节一致——岛数据不许被乐观改写');
  首.ctx.GanttIsland.更新(数据); // 同数据重绘（=收拖后的回滚重绘路）：还是那张图
  assert.equal(首.容器.innerHTML, 前html, '同数据重绘后仍逐字节一致——岛数据不变重绘即回滚');
  assert.deepEqual(行几何(首.容器.innerHTML, 'g-c01'), 前几何, '条几何原位（left/width/top 全不动）');
});

/* ═══ ④ 依赖线只画不判（#12/CX-3/DS-1）：conflict 类当且仅当服务端 冲突:true；环带环记号；外部半截线 ═══
 * 变异自证点（长驻）：逐边翻转 冲突 字段（粒的日期一字不动）→ 线类跟着全翻——锁死不前端私算。 */
t('④ 依赖线：全边入图（6 条）；conflict⇔服务端 冲突:true；环边虚线+环组 title；悬空外部=半截线+空心端点符', () => {
  const 数据 = 造台账();
  const 首 = 画(数据);
  首.ctx.GanttIsland.切折叠('S-2'); // 依赖花样全在 S-2（默认折叠），展开后端点行全可见
  const html = 首.容器.innerHTML;
  const 组 = 组们(html);
  assert.equal(组.length, 数据.边.length, `服务端下发 ${数据.边.length} 条边须全数入图（实得 ${组.length}）`);
  for (const e of 数据.边) {
    const g = 组.find((x) => x.i === 数据.边.indexOf(e));
    assert.ok(g, `边 ${e.from.键}→${e.to.键} 没画`);
    assert.equal(/\bconflict\b/.test(g.类), e.冲突 === true,
      `边 ${e.from.键}→${e.to.键}：conflict 类当且仅当服务端 冲突:true（下发 ${e.冲突}）`);
    assert.equal(/\bcyc\b/.test(g.类), !!e.环, `边 ${e.from.键}→${e.to.键}：环记号只认服务端 环 字段`);
  }
  assert.equal(组.filter((g) => /\bconflict\b/.test(g.类)).length, 3, '台账冲突边恰 3 条（环甲乙两段+冲A冲B）');
  const 环组 = 组.filter((g) => /\bcyc\b/.test(g.类));
  assert.equal(环组.length, 3, '环三角三条边全带环记号');
  assert.ok(环组.some((g) => g.词.includes('环组')), '环边 title 带环组号（独立记号，非红色冒充）');
  const 悬 = 组.find((g) => g.from === '外:GHOST-404');
  assert.ok(悬 && /\bext\b/.test(悬.类), '悬空前置（外:GHOST-404）边带 ext（服务端 外部:true）');
  assert.ok(/hollow/.test(块级(html, '外:GHOST-404')), '悬空外部端点＝半截线+空心端点符（hollow）');
  const 外 = 组.find((g) => g.from === '单:TF-3');
  assert.ok(外 && /\bext\b/.test(外.类), '跨项目前置（单:TF-3）边带 ext（服务端 外部:true）');
  // 变异自证（判据核心）：逐边翻转 冲突 字段，粒的日期一字不动 → 线类必须全翻
  const 变 = 变体(数据);
  for (const e of 变.边) e.冲突 = !e.冲突;
  const 二 = 画(变);
  二.ctx.GanttIsland.切折叠('S-2');
  const 组2 = 组们(二.容器.innerHTML);
  for (let i = 0; i < 变.边.length; i++) {
    const g = 组2.find((x) => x.i === i);
    assert.ok(g, `翻转后边 ${i} 仍须在图上`);
    assert.equal(/\bconflict\b/.test(g.类), 变.边[i].冲突 === true,
      `翻转下发字段后边 ${i} 的线类必须跟着变——前端若私算冲突（几何没变）此断言必红`);
  }
});
// 从整页里切出含某关键串的 <g> 组（依赖线组不在 gt2row 界内，另备小刀）
function 块级(html, key) {
  const i = html.indexOf(key);
  assert.ok(i >= 0, `页面里找不到 ${key}`);
  const 起 = html.lastIndexOf('<g ', i);
  const 止 = html.indexOf('</g>', i);
  return html.slice(Math.max(0, 起), 止 < 0 ? html.length : 止);
}

/* ═══ ⑤ 锚点同步（#12/DS-11）：线端点坐标与行几何一致；换窗后仍一致；离屏端点画到可视区边缘+方向箭头 ═══
 * 变异自证点（长驻）：前置计划完成 +1h → 出点 x 右移 20px（HW）——锚点真从数据几何推导。 */
t('⑤ 锚点同步：两条边对账（出点=条右端中点、入点=条左端中点）；滚动换窗后坐标不漂；离屏端点截可视缘+箭头', () => {
  const 数据 = 造台账();
  const 存 = 造存储();
  const 首 = 画(数据, {}, 存);
  首.ctx.GanttIsland.切折叠('S-2');
  const html = 首.容器.innerHTML;
  const 对账 = (h, fromGid, toGid, fromKey, toKey) => {
    const A = 行几何(h, fromGid), B = 行几何(h, toGid);
    const g = 组们(h).find((x) => x.from === (fromKey || fromGid) && x.to === (toKey || toGid));
    assert.ok(g, `找不到边 ${fromGid}→${toGid}`);
    assert.ok(近(g.x1, A.left + A.width) && 近(g.y1, A.top + 15),
      `边 ${fromGid}→${toGid} 出点须=前置条右端中点（期 ${A.left + A.width},${A.top + 15} 实 ${g.x1},${g.y1}）`);
    assert.ok(近(g.x2, B.left) && 近(g.y2, B.top + 15),
      `边 ${fromGid}→${toGid} 入点须=后继条左端中点（期 ${B.left},${B.top + 15} 实 ${g.x2},${g.y2}）`);
    return g;
  };
  const 甲 = 对账(html, 'g-冲A', 'g-冲B');
  对账(html, 'g-环3', 'g-环2');   // 抽 2 条对账（判据⑤原文）
  assert.ok(/ C/.test(甲.d), '异行边须是三次贝塞尔（C 指令），非折线');
  // 换窗（虚拟滚动）：行几何是绝对行位（top 不随窗漂），可见线端点仍与行几何一致
  const idxA = 行几何(html, 'g-冲A').行;
  首.ctx.GanttIsland.render(首.容器, 数据, { 现在, 视口: { 滚过行: 12, 行数: idxA } }); // 窗=[2, idxA+22)，两粒仍在窗内
  对账(首.容器.innerHTML, 'g-冲A', 'g-冲B');
  // 离屏端点（#15 聚合桩语义）：窗收到 g-冲B 恰好出窗 → 线画到可视区下缘+方向箭头
  首.ctx.GanttIsland.render(首.容器, 数据, { 现在, 视口: { 滚过行: 0, 行数: idxA - 9 } }); // b=idxA+1：冲A 在窗、冲B 出窗
  const h3 = 首.容器.innerHTML;
  const 组3 = 组们(h3).find((x) => x.from === 'g-冲A' && x.to === 'g-冲B');
  assert.ok(组3, '单端离屏的边仍须画（另一端在窗内）');
  assert.ok(近(组3.y2, (idxA + 1) * 30 - 3), `离屏入点须截在可视区下缘（期 ${(idxA + 1) * 30 - 3} 实 ${组3.y2}）`);
  assert.ok(/offarw/.test(块级(h3, 'data-from="g-冲A"')), '离屏端须带方向箭头（offarw）');
  // 变异自证：前置 g-冲A 计划完成 +1h → 出点 x 右移一格（20px/h）
  const 变 = 变体(数据);
  变.粒.find((g) => g.粒ID === 'g-冲A').计划完成 = '2026-08-27T18:00';
  const 二 = 画(变, {}, 造存储());
  二.ctx.GanttIsland.切折叠('S-2');
  const 乙 = 组们(二.容器.innerHTML).find((x) => x.from === 'g-冲A' && x.to === 'g-冲B');
  assert.ok(近(乙.x1, 甲.x1 + 20), `前置完成 +1h 出点须右移 20px（期 ${甲.x1 + 20} 实 ${乙.x1}）——锚点真从数据推导`);
});

/* ═══ ⑥ 冲突角标（#12/DS-7）＝服务端 边统计.冲突 值（不数边、不自算）═══
 * 变异自证点（长驻）：边一字不动只拨 边统计.冲突 → 角标跟统计字段走——字段权威锁死。 */
t('⑥ 冲突角标：台账 边统计.冲突=3 → 角标数=3；拨统计字段（边不动）角标跟走；0 时隐藏', () => {
  const 数据 = 造台账();
  assert.equal(数据.边统计.冲突, 3, '前提自证：服务端（schedule-edges 真调）统计冲突=3');
  const { html } = 画(数据);
  const 标 = /<button[^>]*gt2cbadge[^>]*>[^<]*/.exec(html);
  assert.ok(标, '工具栏必须挂冲突角标（gt2cbadge）');
  assert.ok(/data-数="3"/.test(标[0]) && 标[0].includes('冲突 3'), `角标须=边统计.冲突（3），实得 ${标[0]}`);
  assert.ok(!/ hidden/.test(标[0]), '有冲突时角标不许藏');
  // 变异自证 a：只拨统计（边与粒一字不动）→ 角标跟统计字段走（角标读的是 边统计.冲突，不是数线）
  const 变 = 变体(数据); 变.边统计 = { ...变.边统计, 冲突: 9 };
  assert.ok(/data-数="9"/.test(/<button[^>]*gt2cbadge[^>]*>/.exec(画(变).html)[0]),
    '拨 边统计.冲突=9（边未动）角标须显 9——统计字段是唯一读数源');
  // 变异自证 b：拨 0 → 隐藏
  const 变2 = 变体(数据); 变2.边统计 = { ...变2.边统计, 冲突: 0 };
  assert.ok(/ hidden/.test(/<button[^>]*gt2cbadge[^>]*>/.exec(画(变2).html)[0]),
    '冲突 0 时角标必须藏——不许挂个 0 在那儿唬人');
});

(async () => {
  for (const [n, f] of 待) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => {
  console.error('  不通过：' + (e && e.message));
  console.error(e && e.stack);
  process.exit(1);
});
/* 变异自证（H104 施工中实跑，改坏→红→复原绿，证据在回执）：
   数据侧（长驻在判据里，每轮都跑）：②越线翻状态→分流口翻；④逐边翻 冲突 字段→线类全翻；
   ⑤前置完成+1h→出点右移 20px；⑥拨 边统计.冲突（边不动）→角标跟走。
   实现侧（施工期两轮实测）：
   r1a 吸附 round 改 floor → ① 红（恒等/刻钟断言炸）；
   r1b 拖分流 越线分支删掉（越线也走重排）→ ② 红；
   r2a 线HTML conflict 类改前端私算（比 起/讫 毫）→ ④ 红（翻字段线不动）；
   r2b 锚点集 y 写死 0 → ⑤ 红（行几何对账炸）；
   r2c 重排 冲突角标改数 边 里 冲突===true 的条数 → ⑥ 红（拨统计字段角标不动）。 */
