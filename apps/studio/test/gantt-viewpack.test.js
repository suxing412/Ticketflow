// gantt-viewpack.test.js — 甘特视图优化包判据（2026-08-26 制作人拍板五件：活条制/悬浮现状/三档已完/搜索定位/历史全量）
//
// 拍板原文锚：①「正在做的任务条应该随着今时线在甘特图上顺延，最后显示的是做完的时间」
// ②「覆盖上去只知道已成单，其它都不知道」③「三种形态：全保留/保留最近若干/不保留，默认最近24小时」
// ④「搜工单号和日期看在甘特图上的位置」⑤「从项目开始到现在所有的工单数据都补到甘特图上」＋
//    红线：缺真实时刻计数不画（为图造数红线）。
// 基座同 gantt-p0/p2：minidom + vm 沙箱装岛；全程 H104 行为判据，无一条 grep 源码。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('甘特视图优化包判据（活条/史条/三档/搜索/悬浮现状）');

const 造存储 = () => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };

// —— 补岛DOM：照抄 gantt-p0/p2 成例（上限即契约：这里没有的 API 岛不许依赖）——
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
    addEventListener(type, fn) { (this._听 || (this._听 = {}))[type] = (this._听[type] || []).concat([fn]); },
    removeEventListener() {},
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
    Date, // 活条骑今时线要真 Date.parse（实时毫）
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'gantt.js' });
  return ctx;
}

// —— 合成小台账：今=2026-08-25T12:00（本地）。史三张：近完（4h 前交付）/远完（3 天前交付）/缺时。
const 现在 = '2026-08-25T12:00';
const 今ms = new Date(2026, 7, 25, 12, 0).getTime();
const iso = (ms) => new Date(ms).toISOString();
const 时 = 3600000;
const 台账 = () => ({
  管线: [{ id: 'P-1', 名称: '地图' }],
  特性: [{ id: 'F-1', 名称: '底图', 管线: 'P-1' }],
  专项: [{ id: 'S-1', 名称: '城池', 特性: 'F-1' }],
  粒: [
    { 粒ID: 'g-活', 题: '活条单', 型: '工单', 状态: '已成单', 上级: 'S-1', 单号: 'TK-901',
      计划开始: '2026-08-25T09:00', 计划完成: '2026-08-25T11:00' },
    { 粒ID: 'g-普', 题: '普通计划单', 型: '工单', 状态: '已成单', 上级: 'S-1', 单号: 'TK-902',
      计划开始: '2026-08-25T14:00', 计划完成: '2026-08-25T16:00' },
  ],
  名册: { 'S-1': '城池', 'F-1': '底图', 'P-1': '地图' },
  板归属: {},
  单册: {
    'TK-901': { 态: '在途', 大态: '在途', 领单: iso(今ms - 3 * 时), 交付: null, 主办: '程序·TK-901', 执行池: 'claude' },
    'TK-903': { 态: '归档', 大态: '结束', 领单: iso(今ms - 8 * 时), 交付: iso(今ms - 4 * 时), 主办: null, 执行池: null },
  },
  史单: [
    { 单号: 'TK-903', 题: '近完史单', 领单: iso(今ms - 8 * 时), 交付: iso(今ms - 4 * 时), 专项: 'S-1', 态: '归档' },
    { 单号: 'TK-904', 题: '远完史单', 领单: iso(今ms - 80 * 时), 交付: iso(今ms - 72 * 时), 专项: 'S-1', 态: '归档' },
    { 单号: 'TK-905', 题: '缺时史单', 领单: null, 交付: null, 专项: 'S-1', 态: '归档' },
  ],
  今: 现在,
});
const 画 = (数据, 存储) => {
  const ctx = 装岛(存储);
  const { El } = require('./minidom');
  const 容器 = new El('div');
  ctx.GanttIsland.render(容器, 数据, { 现在, 视口: { 滚过行: 0, 行数: 200, 宽小时: 0 } });
  return { ctx, 容器, 岛: 容器._gt2 };
};

t('① 活条制：在途单主条骑今时线（右缘=X(今)），计划退幽灵框；单册不标在途则回计划条（变异自证）', () => {
  const { 岛 } = 画(台账());
  const html = 岛.body.innerHTML;
  assert.ok(/gt2bar run live/.test(html), '在途单必须出活条');
  assert.ok(/gt2plan-ghost/.test(html), '计划承诺退成幽灵框仍可见');
  const st = 岛.st;
  const n = st.键表.get('TK-901');
  assert.ok(n && n.实段 && n.实段.活, '活条节点必须带实段.活');
  assert.equal(n.实段.讫, st.今ms, '活条右缘＝今时线毫（骑线随拍长）');
  assert.equal(n.实段.起, Date.parse(台账().单册['TK-901'].领单), '活条左缘＝真实领单时刻（Date.parse 真毫，不走钟面正则）');
  // 变异：抽掉在途标记 → 活条消失、回普通计划条
  const d2 = 台账(); d2.单册['TK-901'].大态 = '结束';
  const { 岛: 岛2 } = 画(d2);
  assert.ok(!/gt2bar run live/.test(岛2.body.innerHTML), '不在途就没有活条——判据能红');
});

t('② 史条：真实区间入图（领单→交付）＋悬浮卡「实际/现状」；缺时单计数不画（为图造数红线）', () => {
  const { 岛, ctx } = 画(台账());
  const st = 岛.st;
  const n = st.键表.get('TK-903');
  assert.ok(n && n.史 && n.实段, '近完史单必须入树带实段');
  assert.equal(n.实段.起, 今ms - 8 * 时); assert.equal(n.实段.真讫, 今ms - 4 * 时);
  assert.ok(/gt2bar done hist/.test(岛.body.innerHTML), '史条画 done hist 只读条');
  assert.ok(!st.键表.get('TK-905'), '缺时史单不入树（不拿创建日冒充执行区间）');
  assert.deepEqual(st.史况.缺时, ['TK-905'], '缺时单挂账可指认');
  const 注 = 岛.根el.querySelector('.gt2histnote');
  assert.equal(注.getAttribute('data-缺时'), '1', '工具栏如实报缺时数');
  // 悬浮卡：史单显实际区间+现状；活条单显现状（态·主办·池）+实况
  const 卡史 = ctx.GanttIsland._测.卡HTML(n, st);
  assert.ok(/实际/.test(卡史) && /归档/.test(卡史), '史卡要有实际区间与现状态');
  const 卡活 = ctx.GanttIsland._测.卡HTML(st.键表.get('TK-901'), st);
  assert.ok(/现状/.test(卡活) && /在途/.test(卡活) && /claude/.test(卡活) && /实况/.test(卡活),
    '活单卡要报 现状（态·主办·池）与实况区间——制作人「覆盖上去什么都不知道」的修口');
});

t('③ 三档已完视野：默认近完24h 藏远完；切「全」全画；切「无」全藏；史过滤纯函数三档', () => {
  const { 岛 } = 画(台账());   // 默认档=近
  assert.equal(岛.st.史况.档, '近');
  assert.ok(岛.st.键表.get('TK-903') && !岛.st.键表.get('TK-904'), '近档：4h 前交付在图，72h 前交付藏');
  assert.equal(岛.st.史况.藏, 1);
  const 存 = 造存储(); 存.setItem('gt2-done', '全');
  const { 岛: 全岛 } = 画(台账(), 存);
  assert.ok(全岛.st.键表.get('TK-904'), '全档：远完史单也入图');
  存.setItem('gt2-done', '无');
  const { 岛: 无岛 } = 画(台账(), 存);
  assert.ok(!无岛.st.键表.get('TK-903') && !无岛.st.键表.get('TK-904'), '无档：史条全藏');
  const F = 装岛().GanttIsland._测.史过滤;
  const 史 = 台账().史单.slice(0, 2);
  assert.equal(F(史, '近', 今ms).length, 1);
  assert.equal(F(史, '全', 今ms).length, 2);
  assert.equal(F(史, '无', 今ms).length, 0);
});

t('④ 搜索定位：单号→展开滚到该行；日期→横滚到那天；无命中返 null 不静默假成功', () => {
  const 存 = 造存储(); 存.setItem('gt2-done', '全');
  const { 岛, ctx } = 画(台账(), 存);
  const r1 = ctx.GanttIsland._测.定位(岛, 'TK-904');
  assert.ok(r1 && r1.中 === '行', '史单号也能定位（历史全量的检索面）');
  const r2 = ctx.GanttIsland._测.定位(岛, 'TK-901');
  assert.ok(r2 && r2.中 === '行');
  const r3 = ctx.GanttIsland._测.定位(岛, '2026-08-25');
  assert.ok(r3 && r3.中 === '日', '窗内日期定位横滚');
  assert.equal(ctx.GanttIsland._测.定位(岛, 'TK-999'), null, '查无此单如实返 null');
  assert.equal(ctx.GanttIsland._测.定位(岛, '1999-01-01'), null, '窗外日期如实返 null');
});

t('⑤ 窗与聚合吃实段：史条端点撑窗（全档窗起 ≤ 72h 前）；折叠投影迷你条含史/活条', () => {
  const 存 = 造存储(); 存.setItem('gt2-done', '全');
  const { 岛 } = 画(台账(), 存);
  assert.ok(岛.st.窗.t0 <= 今ms - 80 * 时, '全档时窗必须罩住最早史条（历史全量接入的窗面）');
  // 折 S-1 后投影迷你条含史单与活条（不只计划段）——直接经 行HTML 判（折叠投影产 gt2mini）
  const 岛测 = 装岛().GanttIsland._测;
  const st2 = 岛测.建状态({ ...台账() }, null, 0);
  st2.折叠.add('S-1');
  const r = st2.行.find((x) => x.节点.键 === 'S-1');
  const mini = 岛测.行HTML(r, st2);
  assert.ok(/gt2mini done/.test(mini), '折叠投影里史单以完成迷你条显影');
});

t('⑥ 编依赖入口迁菜单（待办队列拆除随迁）：粒行菜单产 m-editdeps 项；史条/终态不产', () => {
  const 存 = 造存储(); 存.setItem('gt2-done', '全');
  const { 岛, ctx } = 画(台账(), 存);
  void 岛;
  const 菜活 = ctx.GanttIsland.菜单Html('行', 'TK-902');
  assert.ok(/m-editdeps/.test(菜活), '在排粒行的右键菜单必须有编依赖项（队列入口拆除后的唯一入口）');
  const 菜史 = ctx.GanttIsland.菜单Html('行', 'TK-904');
  assert.ok(!/m-editdeps/.test(菜史), '史条（已落袋伪粒）不给编依赖——改完活再改计划是改史');
});

console.log('全部通过：' + passed + ' 项');
