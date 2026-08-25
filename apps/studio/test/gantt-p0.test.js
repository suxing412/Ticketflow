// gantt-p0.test.js（暂名 .pending）— 四层树甘特 P0 端到端判据（CX-11 判据基座 · 2026-08-24）
//
// 【已注册】P0 整合（2026-08-24）改名 gantt-p0.test.js 入聚合器。三处口径按整合裁决对齐：
//   a) 条定位断言一律按**固定 px 轴**读（HW=20px/h，施工令 #5），不断百分比；宽度比断言单位无关保留；
//   b) 判据① 未归属伪组＝**根级尾部**（排在所有管线节点之后），岛已照此落实，判据锁死；
//   c) 判据⑨ 缩为「未排期粒（无计划开始）不进树行」——壳层欠账区归 viewRelay 层 relay-scope 判据管辖。
// 台账：test/fixtures/甘特合成台账.js（四口 API 真实响应形，覆盖清单见彼处头注）。
// 全程 H104：每条判据附变异自证（数据/时钟/存储拨一下，断言必须跟着翻），没有一条 grep 源码。
//
// ═══════════════ 岛接口约定（供 P0 岛工程对齐；改约定=改判据，两边必须同步落笔）═══════════════
// 【装载】public/gantt.js 以 <script> 挂 window.GanttIsland（无模块系统，同 app.js 范式）。
//   判据在 node 里用 vm 装载：环境给 window(=全局自身)/localStorage/location.hash/document.createElement，
//   元素是 test/minidom.js 的 El 加判据侧补丁（见下方 补岛DOM：class/style/hidden/dataset 存取、
//   firstElementChild、简单选择器 querySelector(All)（tag/.类/#id/[attr] 与逗号列表，无后代组合子）、
//   template.content、replaceWith/remove/contains/closest、addEventListener 空转、clientHeight/scrollTop 恒 0）。
//   **headless 没有真实布局量测**：可视窗一律以 选项.视口 为准（clientHeight/scrollTop 只是不炸的哑座），
//   靠真量测取行数的实现在判据⑩必红。render 首绘须同步完成，不得等 rAF/事件。
// 【入口】window.GanttIsland.render(容器, 数据, 选项) —— 同步完成首绘，返回后 容器.innerHTML 即可断言。
// 【数据】{管线, 特性, 专项, 粒, 边, 判定, board单} —— 四口 API 真实响应形的前端拼装（P0-0 裁决②）：
//   管线    = GET /api/pipelines 的 管线 数组
//   特性    = GET /api/features 的 特性 数组（聚合形，含 管线 归属与 专项 摘要）
//   专项    = GET /api/specials 的 专项 数组（聚合形；**不作树的工单行数据源**——工单行数据源
//             只有 粒(计划/判定) + board单(状态)，专项.子单 是聚合快照，两处都读必有一处旧）
//   粒      = GET /api/schedule 的 粒 数组（现态形 + 判定 嵌入，见 lib/pm/schedule.规范粒/工期判定）
//   边      = /api/schedule 增发的已解析边集（P0-0 裁决④ 冻结形，P2 消费，P0 只须收下不炸）：
//             [{从:{类:'粒'|'单',id}, 到:{类,id}, 规则, 外部:bool, 状态:'正常'|'环'|'冲突', 因}]
//   判定    = {粒ID → 判定对象}，与 粒[i].判定 同源（服务端 工期判定 下发值的索引）。
//             **前端一个判定字段都不许自算**（只画不判，DS-1）：悬浮卡判据⑦ 拿它当唯一真值锁。
//   board单 = GET /api/board 的 board（state→数组；fm.特性 已补格，server.js:279）
// 【选项】{ 现在:'YYYY-MM-DDTHH:mm'（今时线与默认展开的时钟注入，判据必传，实现缺省真钟），
//          视口:{滚过行:number, 行数:number}（#15 虚拟化底座的可视窗，缺省 {0,40}） }
// 【折叠存储】localStorage 键 **gt2-fold**，语义 = 与默认展开策略的**差异集**（fancytree 模式，#3）。
//   值编码不钉死（映射/数组对皆可），判据只断行为五条：①没记录的节点走默认 ②偏离默认的节点落存值
//   ③回到默认态的节点从存值里**消失**（差异集不许长成全量快照）④清键整树回默认
//   ⑤同一存值换会话重装载，覆盖态还原。默认策略（#4/DS-15）：管线恒展；其余节点展开 ⇔ 子树内
//   存在活跃工单（状态非 完成/撤销 ∧ 计划开始≤选项.现在）；即默认展开到特性层+活跃分支到底。
// 【程序口】（事件处理器的落点实体，判据直接调，不模拟点击）：
//   GanttIsland.切折叠(id)       —— 折叠三角 onclick 的落点；翻转该节点折叠态，按差异集语义写回 gt2-fold 并就地重绘
//   GanttIsland.悬浮卡Html(粒ID) —— 悬浮详情卡内容纯函数（#18 事件委托层调它）；末次 render 的数据为准。
//     工单卡至少含：状态、计划起止（刻钟时刻）、基线、判定区。判定区文案形：「延期 {判定.延期天} 天」/
//     「超期 {判定.超期天} 天」（对应判定为假则该词整个不出现）；超长条（>24h）附「超长异常」与真实区间。
// 【DOM 判据抓手】（类名前缀 gt2；判据只认下列标记，其余结构随实现自便）：
//   行      <div class="gt2row ..." data-层="管线|特性|专项|工单|伪组" data-gid="<id>" data-缩进="0|1|2|3">
//           文档序=树序；直挂特性的工单 缩进=2（专项层缺位不补假层）；无父工单入「未归属」伪组
//           （data-gid="未归属"，data-层="伪组"，挂树尾）——孤儿契约（P0-0 裁决⑤）：原生接受不修数据
//   折叠三角 .gt2tri，带 aria-expanded="true|false"（#14 可达性最小集）
//   表头    .gt2hd：上行日期格 .gt2hd-日（一天一格）；下行 .gt2hd-时（每 4 小时一格，
//           文本=两位小时+:00，00:00/04:00/…/20:00 循环）——固定小时档，无缩放（#5）
//   条      .gt2bar，style 含 left:Xpx;width:Ypx（**固定 px 轴 HW=20px/h**，整合裁决 a）；
//           超长（>24h）截到 24h 处并挂截断标记 .gt2cut（#5 乙案兜底）
//   rollup  折叠行显影（#17）：迷你条 .gt2mini data-gid=子单id data-道="0|1|2"（≤3 道；越线单恒道 0 置顶）；
//           超出聚成密度块 .gt2dense，文本含未显影张数（如「+18」）；显影数+密度数=子孙已排期总数
//   欠账区  归壳层（viewRelay 的 .gtun，relay-scope 判据管辖）；岛内只锁「未排期粒不进树行」（裁决 c）
//   成链    名称过单号闸 /^[A-Za-z]+-\d+$/ 才发 #/t/<单号>（P0-0 裁决③）；自由文本单号显示但不成链
//   总行数  容器内某元素带 data-总行数="<n>"（当前可见树行全量——虚拟滚动条高度的依据，#15）
// ═══════════════════════════════════════════════════════════════════════════════════════════
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { 造台账, 现在 } = require('./fixtures/甘特合成台账');

let passed = 0;
const 待 = [];
const t = (n, f) => 待.push([n, f]);
console.log('gantt-p0 四层树甘特端到端判据（CX-11 基座）');

// ---- 沙盒与工具 ----
const 造存储 = () => { const m = new Map(); return {
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };

// 补岛DOM：给 minidom 的 El 打判据侧补丁，凑齐一个「像样但 headless」的渲染环境。
// 上限即契约：这里没有的 API，岛的首绘就不许依赖（真量测类一律走 选项.视口 注入）。
// 属性型状态（class/style/hidden/dataset）一律落回 setAttribute——minidom 的 outerHTML 只序列化
// 属性表，不落属性表的状态在 innerHTML 断言面前就是不存在。
function 补岛DOM() {
  const { El } = require('./minidom');
  if (El.prototype._gt2补) return El;
  El.prototype._gt2补 = true;
  const 驼峰转 = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  // 简单选择器匹配：tag/.类/#id/[attr]/[attr="v"] 的复合 + 逗号列表；无后代组合子
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
    isConnected: { get() { return true; } },  // 岛的重用分支只拿它判「壳还在不在」，沙箱里恒在
    content: { get() { return this; } },       // <template>.content 的哑座：直接在自身上取 firstElementChild
    scrollTop: { get() { return this._st || 0; }, set(v) { this._st = Number(v) || 0; } },
    scrollLeft: { get() { return this._sl || 0; }, set(v) { this._sl = Number(v) || 0; } },
    clientHeight: { get() { return 0; } }, clientWidth: { get() { return 0; } },
    offsetWidth: { get() { return 0; } }, offsetHeight: { get() { return 0; } },
    dataset: { get() {
      if (!this._ds) {
        const el = this;
        this._ds = new Proxy({}, {
          get: (t, k) => { const v = el.getAttribute('data-' + 驼峰转(String(k))); return v == null ? undefined : v; },
          set: (t, k, v) => { el.setAttribute('data-' + 驼峰转(String(k)), String(v)); return true; },
          has: (t, k) => el.hasAttribute('data-' + 驼峰转(String(k))),
        });
      }
      return this._ds;
    } },
    style: { get() {
      if (!this._styleP) {
        const el = this; const bag = {};
        this._styleP = new Proxy(bag, {
          get: (t, k) => (k in t ? t[k] : ''),
          set: (t, k, v) => {
            t[k] = String(v);
            el.setAttribute('style', Object.keys(t).map((a) => `${驼峰转(a)}:${t[a]}`).join(';'));
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
  if (!fs.existsSync(岛路径)) {
    throw new Error('public/gantt.js 未落地——CX-11 判据先行于实现，岛落地前本套件预期红（这不是测试坏了，是活还没干）');
  }
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
  assert.ok(ctx.GanttIsland && typeof ctx.GanttIsland.render === 'function',
    'gantt.js 装载后必须挂出 window.GanttIsland.render');
  return ctx;
}

// 判据默认给大视口（200 行）关掉窗口裁剪——虚拟化本身只在判据⑩里被测
const 画 = (数据, 选项 = {}, 存储) => {
  const ctx = 装岛(存储);
  const { El } = require('./minidom');
  const 容器 = new El('div');
  ctx.GanttIsland.render(容器, 数据, { 现在, 视口: { 滚过行: 0, 行数: 200 }, ...选项 });
  return { ctx, 容器, html: 容器.innerHTML };
};
const 变体 = (数据) => JSON.parse(JSON.stringify(数据)); // 台账全 JSON 安全，克隆后拨字段做变异

// 行表：按 DOM 抓手收树行（文档序）。属性逐个抽取，不押注属性书写顺序；
// gt2row 认类**词元**不认起始位（岛的 class="gt2r gt2row lvN" 并挂内部类，判据不钉岛的内部命名）。
const 行表 = (html) => [...html.matchAll(/<div\b[^>]*class="[^"]*\bgt2row\b[^>]*>/g)].map((m) => {
  const 取 = (n) => { const r = new RegExp(n + '="([^"]*)"').exec(m[0]); return r ? r[1] : null; };
  return { 层: 取('data-层'), gid: 取('data-gid'), 缩进: Number(取('data-缩进')), 起: m.index };
});
// 从整页切出一行（到下一个树行为止）——断言只打在自己那一行上（同 gantt-h112 的成例）
const 块 = (html, key) => {
  const i = html.indexOf(key);
  assert.ok(i >= 0, `页面里找不到 ${key}`);
  const 起 = Math.max(0, html.lastIndexOf('<div', i));
  const 下行 = /<div\b[^>]*class="[^"]*\bgt2row\b/g;
  下行.lastIndex = 起 + 10;
  const 界m = 下行.exec(html);
  return html.slice(起, 界m ? 界m.index : html.length);
};
// 条定位按固定 px 轴读（整合裁决 a：HW=20px/h，施工令 #5——不断百分比）
const 条几何 = (行块) => {
  const m = /class="gt2bar[^"]*"[^>]*style="[^"]*left:([\d.]+)px;width:([\d.]+)px/.exec(行块);
  assert.ok(m, '这一行没画出时间条（gt2bar，px 轴）：' + 行块.slice(0, 160));
  return { left: +m[1], width: +m[2] };
};

/* ═══ ① 四层树结构与缩进层级 ═══
 * 变异自证点：把 g-直 的 上级 从 F-2 拨到 S-1 → 缩进 2→3 且移位到 S-1 之后；拨成 null → 落未归属伪组。
 * 层级若是写死的（不从数据推导），拨了数据行不动，本条必红。 */
t('① 四层树：管线0/特性1/专项2/工单3 逐层缩进，文档序=树序；直挂特性缩进2；无父孤儿入未归属伪组', () => {
  const 数据 = 造台账();
  const 行 = 行表(画(数据).html);
  const 序 = (gid) => 行.findIndex((r) => r.gid === gid);
  const 拿 = (gid) => { const r = 行.find((x) => x.gid === gid); assert.ok(r, `树里找不到行 ${gid}`); return r; };
  assert.deepEqual([拿('P-1').层, 拿('P-1').缩进], ['管线', 0], '管线行 层/缩进');
  assert.deepEqual([拿('F-1').层, 拿('F-1').缩进], ['特性', 1], '特性行 层/缩进');
  assert.deepEqual([拿('S-1').层, 拿('S-1').缩进], ['专项', 2], '专项行 层/缩进');
  assert.deepEqual([拿('g-c01').层, 拿('g-c01').缩进], ['工单', 3], '工单行 层/缩进');
  assert.ok(序('P-1') < 序('F-1') && 序('F-1') < 序('S-1') && 序('S-1') < 序('g-c01') && 序('g-c01') < 序('P-2'),
    '文档序必须=树序：P-1 → F-1 → S-1 → 其子单，全落在 P-2 之前');
  assert.ok(序('P-2') < 序('F-3'), '管线归属：F-3 属 P-2，须排在 P-2 之后（不许把别家特性画进 P-1）');
  assert.deepEqual([拿('g-直').层, 拿('g-直').缩进], ['工单', 2],
    '直挂特性的工单缩进=2：专项层缺位不补假层（P0-0 孤儿契约，渲染期不修数据）');
  assert.equal(拿('未归属').层, '伪组', '无父工单的容身处是未归属伪组');
  assert.ok(序('未归属') > 序('P-2') && 序('g-孤1') > 序('未归属') && 序('g-孤2') > 序('未归属'),
    '未归属伪组挂树尾，两张孤儿单都在其下——孤儿原生接受，一张不许丢');
  // 变异自证 a：g-直 改挂 S-1 → 缩进 3、移到 S-1 之后
  const 变 = 变体(数据); 变.粒.find((g) => g.粒ID === 'g-直').上级 = 'S-1';
  const 行2 = 行表(画(变).html);
  const r2 = 行2.find((x) => x.gid === 'g-直');
  assert.ok(r2 && r2.缩进 === 3, '改挂 S-1 后 g-直 缩进应变 3——层级必须从数据推导');
  assert.ok(行2.findIndex((x) => x.gid === 'g-直') > 行2.findIndex((x) => x.gid === 'S-1'), '且落在 S-1 之后');
  // 变异自证 b：g-直 拨成**真无父**（上级与 board 归属格一并拨空）→ 落未归属伪组。
  // 只拨上级不算孤儿：board 的 fm.特性 是回落认亲口（P0-0 裁决②补格的意义所在），它还认得 F-2。
  const 变b = 变体(数据); 变b.粒.find((g) => g.粒ID === 'g-直').上级 = null;
  for (const s of Object.keys(变b.board单)) for (const t of 变b.board单[s]) {
    if (t.id === 'TK-350') { t.特性 = null; t.专项 = null; t.管线 = null; }
  }
  const 行3 = 行表(画(变b).html);
  assert.ok(行3.findIndex((x) => x.gid === 'g-直') > 行3.findIndex((x) => x.gid === '未归属'),
    '拨成无父后 g-直 应落未归属伪组之下');
});

/* ═══ ② 折叠差异集持久化（localStorage 桩，键 gt2-fold；编码不钉死，断五条行为）═══
 * 变异自证点：清掉存储 → 全部回默认。差异集若是全量快照（回默认不消痕），「消失」断言必红。 */
t('② 折叠差异集：切折叠偏离默认即入存值、跨会话还原；回默认即从存值消失；清存储全回默认', () => {
  const 数据 = 造台账();
  const 存 = 造存储();
  const 首 = 画(数据, {}, 存);
  assert.ok(!行表(首.html).some((r) => r.gid === 'g-环1'), '前提：默认下 S-2（纯未来分支）折叠');
  assert.ok(行表(首.html).some((r) => r.gid === 'g-c01'), '前提：默认下 S-1（活跃分支）展开');
  // 程序口双向翻转（都偏离默认 → 入差异集），切折叠须就地重绘
  首.ctx.GanttIsland.切折叠('S-2');
  首.ctx.GanttIsland.切折叠('S-1');
  const h1 = 首.容器.innerHTML;
  assert.ok(行表(h1).some((r) => r.gid === 'g-环1'), '切折叠(S-2) 就地重绘后 S-2 应展开');
  assert.ok(!行表(h1).some((r) => r.gid === 'g-c01'), '切折叠(S-1) 就地重绘后 S-1 应折起');
  const 值 = String(存.getItem('gt2-fold') || '');
  assert.ok(值.includes('S-2') && 值.includes('S-1'), '偏离默认的两个节点必须落进 gt2-fold 存值');
  assert.ok(!值.includes('S-3'), '没动过的 S-3 不许入存值——差异集不是全量快照');
  // 跨会话持久：同一份 localStorage，新沙箱重装载 → 覆盖态还原、没动过的仍走默认
  const 再 = 画(数据, {}, 存);
  assert.ok(行表(再.html).some((r) => r.gid === 'g-环1') && !行表(再.html).some((r) => r.gid === 'g-c01'),
    '换个会话（同一存值重装载）折叠覆盖必须还原——这才叫持久化');
  assert.ok(行表(再.html).some((r) => r.gid === 'g-长'), '没进差异集的 S-3 仍走默认（展开）');
  // 回默认消痕：再切一次回默认 → 存值里不许再提这两个节点
  再.ctx.GanttIsland.切折叠('S-2');
  再.ctx.GanttIsland.切折叠('S-1');
  const 值2 = String(存.getItem('gt2-fold') || '');
  assert.ok(!值2.includes('S-2') && !值2.includes('S-1'),
    '回到默认态的节点必须从差异集消失——否则差异集迟早长成全量快照（fancytree 模式，#3）');
  // 变异自证：清掉存储 → 全回默认
  存.removeItem('gt2-fold');
  const 回 = 画(数据, {}, 存);
  assert.ok(!行表(回.html).some((r) => r.gid === 'g-环1') && 行表(回.html).some((r) => r.gid === 'g-c01'),
    '清存储后必须整树回默认——持久化的是差异，不是状态本体');
});

/* ═══ ③ 默认展开策略：特性层 + 活跃分支（存在 未完成∧计划开始≤今 的工单）到底（#4/DS-15 量化）═══
 * 变异自证点 a：时钟拨回 08-20（一切开始之前）→ 无活跃分支，专项/工单行全折；
 * 变异自证点 b：S-1 子单全改完成 → 日期虽已过线，分支不再活跃，S-1 折回。两半条件各锁一半。 */
t('③ 默认展开：管线/特性恒可见；活跃分支到底；纯未来分支折在特性层；全完成分支不算活跃', () => {
  const 数据 = 造台账();
  const 行 = 行表(画(数据).html);
  const 有 = (gid) => 行.some((r) => r.gid === gid);
  assert.ok(有('P-1') && 有('P-2') && 有('F-1') && 有('F-4'), '管线与特性层默认全可见（展开到特性层）');
  assert.ok(有('S-1') && 有('g-越A'), '活跃分支到底：S-1 含 g-越A（计划态·10:00≤现在12:00），子单行须可见');
  assert.ok(有('S-3') && 有('g-长'), '活跃分支到底：S-3 含在途已开始的 g-长');
  assert.ok(有('S-2') && !有('g-环1'), 'S-2 行可见（F-1 已展）但自身折叠：子树全是未来单，不活跃');
  assert.ok(!有('S-4') && !有('g-远1'), '纯未来分支 F-4 折在特性层：S-4 行都不可见');
  // 变异自证 a：时钟拨回一切计划开始之前 → 活跃判据整体失效
  const 早 = 行表(画(数据, { 现在: '2026-08-20T08:00' }).html);
  assert.ok(早.some((r) => r.gid === 'F-1'), '特性层是可见性底线，不随活跃度消失');
  assert.ok(!早.some((r) => r.层 === '工单') && !早.some((r) => r.gid === 'S-1'),
    '时钟在计划开始之前：无活跃分支，工单行/专项行一概折叠——展开策略必须真读 计划开始≤现在');
  // 变异自证 b：未完成才算活跃——S-1 子单全改完成（日期不动）→ S-1 折回
  const 变 = 变体(数据);
  for (const g of 变.粒) if (g.上级 === 'S-1') { g.状态 = '完成'; if (!g.单号) g.单号 = 'TK-888'; }
  assert.ok(!行表(画(变).html).some((r) => r.gid === 'g-c01'),
    '全完成的分支不算活跃：日期过线也得折回——活跃=未完成∧已开始，两个条件缺一不可');
});

/* ═══ ④ rollup 折叠显影：21 张同窗子单 → 微型泳道≤3 道 + 密度块补数 + 越线单钉最上道（#17/CX-8）═══
 * 变异自证点：展开 S-1 → 迷你条与密度块整体退场、子单回归整行。显影若不随折叠态走，本条必红。 */
t('④ rollup：折叠 S-1 后 21 张并发子单显影为≤3 道迷你条+密度块，总数守恒，越线单在道 0', () => {
  const 数据 = 造台账();
  const 首 = 画(数据);
  首.ctx.GanttIsland.切折叠('S-1'); // 程序口折起（不手写存值——差异集编码不钉死）
  const html = 首.容器.innerHTML;
  assert.ok(!行表(html).some((r) => r.gid === 'g-c01'), '折叠后子单不再占整行');
  const S1块 = 块(html, 'data-gid="S-1"');
  const 迷你 = [...S1块.matchAll(/<[a-z]+\b[^>]*class="gt2mini[^>]*>/g)].map((m) => m[0]);
  assert.ok(迷你.length >= 1, '折叠行必须有子孙显影（gt2mini）——折叠不是藏账');
  const 道 = (tag) => { const r = /data-道="(\d+)"/.exec(tag); return r ? +r[1] : null; };
  for (const m of 迷你) assert.ok(道(m) != null && 道(m) <= 2, '微型泳道上限 3 道：data-道 只能 0/1/2（CX-8）');
  const 越 = 迷你.find((m) => /data-gid="g-越A"/.test(m));
  assert.ok(越, '越线单必须显影，不许被密度块吞掉（越线单永远置顶显影）');
  assert.equal(道(越), 0, '越线单钉最上道（道 0）');
  const 密 = /<[a-z]+\b[^>]*class="[^"]*\bgt2dense\b[^>]*>[^<]*?\+?(\d+)/.exec(S1块);
  assert.ok(密, '超出 3 道的并发子单须聚成密度块（gt2dense，数字角标）');
  assert.equal(迷你.length + Number(密[1]), 21,
    `显影数(${迷你.length})+密度数(${密[1]})必须=21——一张子单都不许静默蒸发`);
  // 变异自证：展开 → 显影退场、整行回归
  const 开 = 画(数据).html;
  assert.ok(!/gt2mini|gt2dense/.test(块(开, 'data-gid="S-1"')), '展开后迷你条/密度块必须整体退场');
  assert.ok(行表(开).some((r) => r.gid === 'g-c01'), '展开后子单恢复整行');
});

/* ═══ ⑤ 固定小时轴表头：上行日期、下行每 4 小时，无缩放档（#5，2026-08-24 制作人拍板）═══
 * 变异自证点：把窗撑长一天 → 上行+1 格、下行+6 格。表头若是写死的常量网格，拨数据不动，本条必红。 */
t('⑤ 表头双行：上行一天一格、下行每天固定 6 格（00/04/08/12/16/20 循环）、随数据窗伸缩', () => {
  const 数据 = 造台账();
  const { html } = 画(数据);
  const 日数 = (h) => (h.match(/gt2hd-日/g) || []).length;
  const 时格 = (h) => [...h.matchAll(/gt2hd-时[^>]*>(\d{2}):00</g)].map((m) => m[1]);
  const 日 = 日数(html); const 时 = 时格(html);
  assert.ok(日 >= 2, `时间窗至少跨两天（台账 08-22..08-30），实得 ${日} 格`);
  assert.equal(时.length, 日 * 6, '下行=每天 6 格（24h÷4h）——固定小时档，无日/周/月档可切');
  assert.deepEqual(时.slice(0, 6), ['00', '04', '08', '12', '16', '20'], '4 小时刻度从 00 起');
  assert.deepEqual(时.slice(6, 12), ['00', '04', '08', '12', '16', '20'], '每一天重复同一套刻度（整日循环）');
  // 变异自证：g-远2 完成日 +1 天 → 数据窗多一天，两行表头同步伸长
  const 变 = 变体(数据); 变.粒.find((x) => x.粒ID === 'g-远2').计划完成 = '2026-08-31T16:00';
  const h2 = 画(变).html;
  assert.equal(日数(h2), 日 + 1, '窗撑长一天：上行日期格须 +1');
  assert.equal(时格(h2).length, 时.length + 6, '窗撑长一天：下行 4 小时格须 +6——表头真跟着数据窗走');
});

/* ═══ ⑥ 超长条截断（#5 乙案图端兜底）：>24h 截到 24h+截断标记，悬浮卡显真实区间+超长异常 ═══
 * 变异自证点：同粒工期缩到 18h → 截断标记消失、宽度比回真实时长比。截断若无条件挂，本条必红。 */
t('⑥ 超长 30h 条：图上截到 24h（宽度比对照 6h 条=4）+gt2cut 标记；悬浮卡显真实区间并标超长', () => {
  const 数据 = 造台账();
  const { ctx, html } = 画(数据);
  const 长块 = 块(html, 'data-gid="g-长"');
  assert.ok(/gt2cut/.test(长块), '30h 条必须挂截断标记 gt2cut（折断符号）');
  const 比 = 条几何(长块).width / 条几何(块(html, 'data-gid="g-完1"')).width;
  assert.ok(Math.abs(比 - 4) < 0.25,
    `超长条应截到 24h：对 6h 对照条宽度比≈4，实得 ${比.toFixed(2)}（≈5 即没截，图被 30h 条撑爆）`);
  const 卡 = ctx.GanttIsland.悬浮卡Html('g-长');
  // 刻钟时刻显示形＝岛的 时点文（MM-DD HH:mm）；断真实讫点 14:00 在卡上（截断讫点是 08:00，混不了）
  assert.ok(卡.includes('08-23 08:00') && 卡.includes('08-24 14:00'),
    '悬浮卡必须显真实区间——截断只截图，不截事实');
  assert.ok(/超长/.test(卡), '悬浮卡须标「超长异常」：写口不加闸，图先把异常点名，制度靠人闸');
  // 变异自证：缩到 18h → 无截断，宽度比回 3
  const 变 = 变体(数据); 变.粒.find((x) => x.粒ID === 'g-长').计划完成 = '2026-08-24T02:00';
  const h2 = 画(变).html;
  assert.ok(!/gt2cut/.test(块(h2, 'data-gid="g-长"')), '≤24h 的条不许乱挂截断标');
  const 比2 = 条几何(块(h2, 'data-gid="g-长"')).width / 条几何(块(h2, 'data-gid="g-完1"')).width;
  assert.ok(Math.abs(比2 - 3) < 0.25, `18h 条宽度比应回真实时长比 3，实得 ${比2.toFixed(2)}`);
});

/* ═══ ⑦ 悬浮卡判定字段=服务端下发值（#18/DS-1 只画不判）═══
 * 台账 g-判锁 的服务端判定与私算故意分叉：延期天 服务端5/私算2，超期 服务端false/私算true。
 * 变异自证点：翻转服务端判定 → 卡与行跟着翻。锁死「读的是判定字段，不是自己拿 e−基线 算的」。 */
t('⑦ 悬浮卡判定=服务端：延期显 5 不显私算 2；服务端说不超期就不许标超期；翻转判定即翻转', () => {
  const 数据 = 造台账();
  const { ctx, html } = 画(数据);
  const 卡 = ctx.GanttIsland.悬浮卡Html('g-判锁');
  assert.ok(/延期\D*5/.test(卡), '卡上延期天必须=服务端 判定.延期天(5)（案外知情，前端无从推得）');
  assert.ok(!/延期\D*2/.test(卡), '出现 2（=计划完成−基线完成 的私算值）即前端在自算 e−基线——只画不判被破');
  assert.ok(!/超期/.test(卡), '服务端 判定.超期=false：今日虽已过计划完成，卡上不许自判超期');
  assert.ok(!/gt2od|该重排/.test(块(html, 'data-gid="g-判锁"')), '行上的超期红标同样只认服务端判定');
  // 变异自证：翻转服务端判定 → 卡与行都得跟着走
  const 变 = 变体(数据);
  const g = 变.粒.find((x) => x.粒ID === 'g-判锁');
  g.判定 = { ...g.判定, 超期: true, 超期天: 3, 需重排: true };
  变.判定[g.粒ID] = g.判定;
  const 翻 = 画(变);
  assert.ok(/超期\D*3/.test(翻.ctx.GanttIsland.悬浮卡Html('g-判锁')), '服务端改判超期 3 天，卡就得显超期 3 天');
  assert.ok(/gt2od|该重排/.test(块(翻.html, 'data-gid="g-判锁"')), '行上红标随服务端判定出现——证明读的真是这一格');
});

/* ═══ ⑧ 单号正则闸（P0-0 裁决③）：/^[A-Za-z]+-\d+$/ 过闸才成链 ═══
 * 变异自证点：同一粒换成规整单号 → 链出现。闸若不存在（全成链），死链断言必红。 */
t('⑧ 单号闸：TK-401 成链 #/t/TK-401；自由文本「（无单·直接落码）」显示但不成链', () => {
  const 数据 = 造台账();
  const { html } = 画(数据);
  assert.ok(块(html, 'data-gid="g-完1"').includes('#/t/TK-401'), '规整单号的名称须接 #/t/ 工单详情链');
  const 文块 = 块(html, 'data-gid="g-文"');
  assert.ok(文块.includes('（无单·直接落码）'), '自由文本单号照样显示——不成链不等于不显示');
  assert.ok(!/#\/t\//.test(文块), '自由文本单号不过闸：不许拼出 #/t/（无单·直接落码） 这种死链（库里实证形）');
  // 变异自证：换成规整单号 → 链出现
  const 变 = 变体(数据); 变.粒.find((x) => x.粒ID === 'g-文').单号 = 'TK-777';
  assert.ok(块(画(变).html, 'data-gid="g-文"').includes('#/t/TK-777'), '过闸单号必须成链——闸是筛子不是墙');
});

/* ═══ ⑨ 未排期粒不进树行（DS-15，按整合裁决 c 缩围：壳层欠账区归 viewRelay 层，
 * relay-scope 判据已锁；岛内只答「无计划开始的粒不许混进时间轴树行」）═══
 * 变异自证点：给它排上期 → 进树。排没排期若不影响进树，本条必红。 */
t('⑨ 未排期粒（无计划开始）不进树行；排上期即进树', () => {
  const 数据 = 造台账();
  const { html } = 画(数据);
  assert.ok(!行表(html).some((r) => r.gid === 'g-欠'), '未排期粒（无计划开始）不许混进时间轴树行');
  // 变异自证：排上期 → 进树
  const 变 = 变体(数据); const g = 变.粒.find((x) => x.粒ID === 'g-欠');
  g.计划开始 = '2026-08-24T09:00'; g.计划完成 = '2026-08-24T10:00';
  assert.ok(行表(画(变).html).some((r) => r.gid === 'g-欠'), '排了期就该进树');
});

/* ═══ ⑩ 虚拟化底座（#15 前置）：500 行台账只渲染可视行，窗口随视口走，总行数如实上报 ═══
 * 变异自证点：视口放大到 999 行 → 全量行回来——证明「只画 40 行」是视口选择的结果，不是写死砍行。 */
t('⑩ 虚拟化：500 行档视口 40 行时渲染≤60 行；滚过 300 行换窗；data-总行数≥500；视口放大即全画', () => {
  const 数据 = 造台账(500);
  assert.ok(数据.统计.树行估 >= 500, `规模档自证：500 档全展开树行估须≥500，实得 ${数据.统计.树行估}`);
  assert.ok(造台账(80).统计.树行估 >= 80 && 造台账(200).统计.树行估 >= 200, '80/200 档同理（判据基座三档全备）');
  const A = 画(数据, { 视口: { 滚过行: 0, 行数: 40 } });
  const 行A = 行表(A.html);
  assert.ok(行A.length > 0 && 行A.length <= 60,
    `视口 40 行时渲染行数须≤60（40+缓冲），实得 ${行A.length}——500 行全画即虚拟化名存实亡`);
  const 总 = /data-总行数="(\d+)"/.exec(A.html);
  assert.ok(总 && Number(总[1]) >= 500, `须如实上报 data-总行数（滚动条高度依据）≥500，实得 ${总 && 总[1]}`);
  const B = 画(数据, { 视口: { 滚过行: 300, 行数: 40 } });
  const 甲集 = new Set(行A.map((r) => r.gid));
  const 乙 = 行表(B.html).map((r) => r.gid);
  assert.ok(乙.length > 0 && 乙.every((g) => !甲集.has(g)),
    '滚过 300 行后渲染的应是另一窗的行（与首窗零交集）——窗口不随滚动挪就是假虚拟化');
  // 变异自证：视口放大 → 全量渲染回来
  const 全 = 行表(画(数据, { 视口: { 滚过行: 0, 行数: 999 } }).html);
  assert.ok(全.length >= 450, `视口 999 行须画出全部可见行（≥450），实得 ${全.length}——可视行选择器必须真由视口驱动`);
});

/* ═══ ⑪ 悬浮卡依赖区（终审 T6/T7）：结构化依赖 {ref,规则} 按 ref 解析渲染 ═══
 * 病例（codex 终审实测）：对整对象 String() 显 [object Object]，且原三套判据把依赖区整段删除照绿。
 * 本条把该变异固化为必红：粒ID引用/单号引用/悬空引用三样都断到字面，块一删三断言全炸。
 * 转义断言（DS-9 同族）：依赖对端的题名带 HTML 也只能以实体形上卡。 */
t('⑪ 悬浮卡依赖：粒ID引用→对端单号+题名+规则；单号引用同解析；悬空引用如实标；题名转义；无 [object Object]', () => {
  const 数据 = 造台账();
  const 变 = 变体(数据);
  // 单号引用样本：g-c02 依赖 TK-301（=g-c01 的单号）——卡不读边集，改依赖不必重算 边
  变.粒.find((g) => g.粒ID === 'g-c02').依赖 = [{ ref: 'TK-301', 规则: '任一完成' }];
  // 转义样本：依赖对端 g-环2 的题名带 HTML
  变.粒.find((g) => g.粒ID === 'g-环2').题 = '环乙<b>x</b>';
  const { ctx } = 画(变);
  const 卡1 = ctx.GanttIsland.悬浮卡Html('g-环1'); // 依赖 [{ref:'g-环2',规则:'全部完成'}]（粒ID 引用）
  assert.ok(!/\[object Object\]/.test(卡1), '结构化依赖不许整对象字符串化（[object Object] 病例）');
  assert.ok(卡1.includes('TK-332'), '粒ID 引用须解析出对端单号（g-环2 → TK-332）');
  assert.ok(卡1.includes('环乙') && 卡1.includes('全部完成'), '对端题名与规则都得上卡（施工令 #18「依赖（单号+名）」）');
  assert.ok(卡1.includes('环乙&lt;b&gt;x&lt;/b&gt;') && !卡1.includes('<b>x</b>'), '题名须转义——依赖区不是 XSS 旁门');
  const 卡2 = ctx.GanttIsland.悬浮卡Html('g-c02'); // 单号引用
  assert.ok(卡2.includes('TK-301') && 卡2.includes('并发件1') && 卡2.includes('任一完成'),
    '单号引用须解析出对端题名与规则（TK-301＝并发件1）');
  const 卡3 = ctx.GanttIsland.悬浮卡Html('g-悬'); // 悬空引用（GHOST-404 哪个册都查不到）
  assert.ok(卡3.includes('GHOST-404') && /悬空/.test(卡3), '悬空引用如实标（不冒充可解析，不静默吞行）');
  assert.ok(!/\[object Object\]/.test(卡2 + 卡3), '三形一律不许出现 [object Object]');
});

t('⑫ 今时线：body 竖线在时间区坐标（树宽 280 之后）与表头徽章同刻对位；分钟自走挪线换徽', () => {
  // 病例（2026-08-24 制作人验收）：body 线漏加树宽画进树列假时刻位；今线不进轮询签名冻在末次渲染时刻
  const 数据 = 造台账();
  const { ctx, 容器 } = 画(数据);
  const 岛 = 容器._gt2;                                // render 把岛实例挂在传入容器上
  assert.ok(岛 && 岛.st, '岛实例可达（容器._gt2）');
  const 线 = 岛.body.querySelectorAll('.gt2now').find ? 岛.body.querySelectorAll('.gt2now')[0] : null;
  const 徽 = 岛.head.querySelectorAll('.gt2now')[0] || null;
  assert.ok(线 && !线.hidden && 徽, '今在窗内：body 线与表头徽章都得在');
  // 沙箱里 JS 写的 style.left 可读，innerHTML 静态解析的要从 style 属性抽——两路都认
  const 时x = (el) => { const v = el.style && el.style.left; if (v) return parseFloat(v);
    const m = /left:\s*([\d.]+)px/.exec(el.getAttribute('style') || ''); return m ? parseFloat(m[1]) : NaN; };
  // 同刻对位：body 线（.gt2body 从 0 起）＝ 280 ＋ 徽章（.gt2hx 自带 left:280px 故不加）
  assert.equal(Math.round(时x(线)), Math.round(280 + 时x(徽)),
    'body 线须加树宽 280——两根线必须指同一时刻（漏加即画进树列的假位置）');
  // 分钟自走（注入假钟走同一条生产路）：st/数据 的今更新＋线位右移＋徽章换文
  const 原x = 时x(线);
  ctx.GanttIsland._测.走今(岛, '2026-08-24T13:00');    // 台账统一时钟 12:00 → 拨快 1h
  assert.equal(岛.st.数据.今, '2026-08-24T13:00', '走今 须更新 st.数据.今');
  assert.ok(Math.abs(时x(线) - 原x - 20) < 0.6, '拨快 1h 线右移 20px（HW=20px/h）');
  assert.ok(徽.textContent.includes('13:00'), '徽章文字跟着换刻');
});

t('⑬ 窗宽下限＝铺满视口：数据窄时按整日扩窗、刻度画满；不注入宽小时则不扩', () => {
  // 病例（2026-08-25 制作人所指）：13 张全未排期时窗缩到一天 480px，宽屏右侧大片无刻度死白、
  // 表头深色半途截止像断裂。修法＝窗宽下限铺满可用视口（选项.视口.宽小时 注入/真浏览器量 wrap）。
  const 数据 = 造台账();
  const 窄 = 变体(数据);
  窄.粒 = 窄.粒.filter((g) => g.粒ID === 'g-c01');       // 只留一张当天的单 → 天然窄窗
  const 只 = (宽小时) => {
    const ctx = 装岛();
    const { El } = require('./minidom');
    const 容器 = new El('div');
    ctx.GanttIsland.render(容器, 窄, { 现在, 视口: { 滚过行: 0, 行数: 200, ...(宽小时 ? { 宽小时 } : {}) } });
    return 容器._gt2.st.窗;
  };
  const 基 = 只(null);
  const 扩 = 只(72);
  assert.ok(基.小时 < 72, '前提：窄数据的自然窗须小于 72h（不然本判据白测）——实得 ' + 基.小时);
  assert.ok(扩.小时 >= 72, '注入 宽小时:72 后窗须扩到 ≥72h（铺满视口）——实得 ' + 扩.小时);
  assert.equal(扩.小时 % 24, 0, '扩窗按整日走（表头日界不许出现半日）');
  assert.equal(基.t0, 扩.t0, '扩的是右缘 t1，不许动窗起点');
});

(async () => {
  for (const [n, f] of 待) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => {
  console.error('  不通过：' + (e && e.message));
  console.error(e && e.stack);
  process.exit(1);
});
