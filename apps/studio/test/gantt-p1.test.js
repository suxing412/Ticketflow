// gantt-p1.test.js — 四层树甘特 P1 交互层端到端判据（施工令 #8/#9/#19/#20 · 2026-08-24）
//
// 判据基座同 gantt-p0（CX-11）：同一份 test/fixtures/甘特合成台账.js、同一套 vm 沙箱装载
// （补岛DOM/装岛 从 gantt-p0.test.js 的成例照抄——El.prototype._gt2补 有守卫，双份补丁不叠加）。
// 全程 H104：每条判据附变异自证（拨数据断言必须跟着翻），没有一条 grep 源码。
//
// P1 程序口约定（岛侧 public/gantt.js，事件处理器的落点实体，判据直调不模拟右键/点击）：
//   GanttIsland.菜单Html(种类, id) —— contextmenu 处理器造菜单的同一条产线；种类∈{'行','条','空白'}
//   GanttIsland.聚焦(id) / 退出聚焦() —— 右键「聚焦此分支」与面包屑 ✕ 的落点，就地重绘，不持久化
// DOM 判据抓手（P1 新增，前缀 gt2 同 P0 约定）：
//   面包屑    .gt2crumb（聚焦态可见，含节点名与「退出聚焦」）
//   越线角标  .gt2xbadge data-数="<n>"（红底数字；n=0 时 hidden）
//   状态色点  .gt2dot <状态类>（工单行树列；聚合行没有）
//   工期徽章  .gt2dur（Nh，真实工期——超长条也显真 30h；聚合行没有）
//   表态口    越线条 data-x="1" 分流 + 待重判标记 data-act="stance"（点击 → window.tqStance）
// 表态弹窗（app.js tqStance）的**写口行为**在判据③以 STUDIO_STUB 真服务实测（弹窗提交的正是这口）。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { makeRoot } = require('./helper');
const { 造台账, 现在, 标待表态 } = require('./fixtures/甘特合成台账');

let passed = 0;
const 待 = [];
const t = (n, f) => 待.push([n, f]);
console.log('gantt-p1 交互层端到端判据（#8 右键菜单 / #9 聚焦 / #19 越线处置 / #20 树列字段）');

// ---- 沙盒与工具（照抄 gantt-p0 成例；上限即契约：这里没有的 API 岛的首绘不许依赖）----
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
const 行表 = (html) => [...html.matchAll(/<div\b[^>]*class="[^"]*\bgt2row\b[^>]*>/g)].map((m) => {
  const 取 = (n) => { const r = new RegExp(n + '="([^"]*)"').exec(m[0]); return r ? r[1] : null; };
  return { 层: 取('data-层'), gid: 取('data-gid'), 缩进: Number(取('data-缩进')), 起: m.index };
});
const 块 = (html, key) => {
  const i = html.indexOf(key);
  assert.ok(i >= 0, `页面里找不到 ${key}`);
  const 起 = Math.max(0, html.lastIndexOf('<div', i));
  const 下行 = /<div\b[^>]*class="[^"]*\bgt2row\b/g;
  下行.lastIndex = 起 + 10;
  const 界m = 下行.exec(html);
  return html.slice(起, 界m ? 界m.index : html.length);
};

/* ═══ ① 右键两区菜单（#8）：菜单项按上下文出现 ═══
 * 判据面＝程序口 菜单Html（contextmenu 处理器造菜单的同一条产线，不模拟右键）。
 * 变异自证点：g-越A 拨成 已成单（不再越线）→ 条菜单从「表态」翻成「重排」。
 * 上下文若是写死的（不从数据推导），拨了数据菜单不动，本条必红。 */
t('① 菜单上下文：行上含聚焦/折到1-4；叶子行无「折叠此支」；越线条=表态、普通条=重排、终态条无写口；空白=全展/全折/回今', () => {
  const 数据 = 造台账();
  const { ctx } = 画(数据);
  const M = (种类, id) => ctx.GanttIsland.菜单Html(种类, id);
  const 行菜 = M('行', 'P-1');
  assert.ok(行菜.includes('折叠此支'), '有子分支的行菜单须含「折叠此支」');
  assert.ok(行菜.includes('聚焦此分支'), '行菜单须含「聚焦此分支」');
  assert.ok(行菜.includes('折到') && ['1', '2', '3', '4'].every((lv) => 行菜.includes(`data-lv="${lv}"`)),
    '行菜单须含 折到 1-4 层（MS Project Outline 标杆，同数字键）');
  assert.ok(行菜.includes('m-goto') && 行菜.includes('#/tickets/P-1'), '行菜单跳详情走四层路由（P0-0 裁决③）');
  const 叶菜 = M('行', 'g-c01');
  assert.ok(!叶菜.includes('折叠此支') && !叶菜.includes('展开此支'), '叶子行没有可折的支——「折叠此支」不许出现');
  assert.ok(叶菜.includes('聚焦此分支') && 叶菜.includes('m-replan'), '叶子行仍有聚焦与改期');
  const 越菜 = M('条', 'g-越A');
  assert.ok(越菜.includes('m-stance') && 越菜.includes('表态'), '越线待重判条的菜单＝表态（派发/重排二选一）');
  assert.ok(!越菜.includes('m-replan'), '越线条不给普通重排口——二选一不许从菜单绕掉');
  const 普菜 = M('条', 'g-c01');
  assert.ok(普菜.includes('m-replan') && 普菜.includes('重排'), '普通条的菜单＝重排（复用 tqReplan 弹窗）');
  assert.ok(!普菜.includes('m-stance'), '普通条没有表态口——表态是越线债的专用写口');
  const 完菜 = M('条', 'g-完1');
  assert.ok(!完菜.includes('m-replan') && !完菜.includes('m-stance'), '终态条无写口（做完的活不改计划），只留跳详情');
  const 空菜 = M('空白', null);
  assert.ok(空菜.includes('全部展开') && 空菜.includes('全部折叠') && 空菜.includes('回到今天'), '空白区菜单＝全展/全折/回到今天');
  // 变异自证：越线翻成不越线 → 服务端重判（标待表态＝同一份谓词重打下发字段）→ 菜单跟着翻
  const 变 = 变体(数据); 变.粒.find((g) => g.粒ID === 'g-越A').状态 = '已成单';
  标待表态(变.粒);
  const 菜2 = 画(变).ctx.GanttIsland.菜单Html('条', 'g-越A');
  assert.ok(菜2.includes('m-replan') && !菜2.includes('m-stance'),
    '拨成已成单（不再越线）后菜单必须从表态翻成重排——上下文从数据推导，不是写死名单');
});

/* ═══ ② 聚焦模式（#9）：投影＝祖先链+子孙，面包屑在，Esc/✕ 退出全量恢复 ═══
 * 变异自证点：g-悬 改挂 S-1 → 聚焦集合含 g-悬（投影从数据推导，不是写死名单）。 */
t('② 聚焦投影：聚焦 S-1 可见行集合=祖先链+子孙（集合相等）；面包屑在；折叠支里的叶子祖先链强制展开；退出全量恢复', () => {
  const 数据 = 造台账();
  const 首 = 画(数据);
  const 全集 = 行表(首.html).map((r) => r.gid).sort();
  首.ctx.GanttIsland.聚焦('S-1');
  const h1 = 首.容器.innerHTML;
  const 期 = ['P-1', 'F-1', 'S-1', 'g-越A'].concat(Array.from({ length: 20 }, (_, i) => `g-c${String(i + 1).padStart(2, '0')}`)).sort();
  assert.deepEqual(行表(h1).map((r) => r.gid).sort(), 期,
    '聚焦 S-1 后可见行必须恰是 祖先链(P-1/F-1)+S-1+全部子孙——旁支一行不许漏显');
  assert.ok(/gt2crumb/.test(h1) && h1.includes('并发泳道样本') && h1.includes('退出聚焦'),
    '聚焦态岛壳顶部须出面包屑（全部 › 节点名 ✕退出）');
  首.ctx.GanttIsland.退出聚焦();
  const h2 = 首.容器.innerHTML;
  assert.deepEqual(行表(h2).map((r) => r.gid).sort(), 全集, '退出聚焦后全量恢复（聚焦是投影不是删树）');
  assert.ok(!h2.includes('退出聚焦'), '退出后面包屑消失');
  // [hidden] 有主（2026-08-25 紫边空条案）：.gt2crumb 作者样式 display:flex 会盖掉 UA 的
  // [hidden]{display:none}，空面包屑显示成一根空条——样式表必须有 [hidden] 补丁规则兜住。
  const css25 = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.ok(/\.gt2crumb\[hidden\]/.test(css25),
    'style.css 须有 .gt2crumb[hidden]{display:none} 补丁——display:flex 盖 hidden 的病不许复发');
  // 滚条现制（0.30.6 案）：壳禁 Fluent（Fluent 不吃 ::-webkit-scrollbar，细滚条在壳里全失效、
  // 页面是带箭头原生粗条）+ 纵 8px 细条 + 横 0（中键平移）。改制须过制作人。
  const main25 = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/disable-features[^)]*FluentScrollbar/.test(main25),
    'main.js 须禁 Fluent 滚条——不禁则样式表对滚条完全失权（0.30.6 案）');
  assert.ok(/\.gt2wrap::-webkit-scrollbar \{ width:8px; height:0/.test(css25),
    '甘特滚条现制：纵 8px 细条+横 0');
  // 折叠正交：聚焦默认折叠支（S-2）里的叶子——祖先链强制展开、旁支兄弟不显、折叠集不被聚焦改写
  const 三 = 画(数据);
  三.ctx.GanttIsland.聚焦('g-环1');
  assert.deepEqual(行表(三.容器.innerHTML).map((r) => r.gid).sort(), ['F-1', 'P-1', 'S-2', 'g-环1'],
    '聚焦折叠支内的叶子：祖先链（含默认折叠的 S-2）强制展开到它，兄弟 g-环2/g-环3 不显');
  三.ctx.GanttIsland.退出聚焦();
  assert.ok(!行表(三.容器.innerHTML).some((r) => r.gid === 'g-环1'),
    '退出后 S-2 仍按原折叠态藏起 g-环1——聚焦态与折叠态正交，聚焦不许写折叠集');
  // 变异自证：g-悬 改挂 S-1 → 聚焦集合跟着长
  const 变 = 变体(数据); 变.粒.find((g) => g.粒ID === 'g-悬').上级 = 'S-1';
  const 二 = 画(变);
  二.ctx.GanttIsland.聚焦('S-1');
  assert.ok(行表(二.容器.innerHTML).some((r) => r.gid === 'g-悬'),
    '改挂 S-1 的粒必须进聚焦集合——投影从数据推导');
});

/* ═══ ③ 表态写口实测（#19 弹窗提交的目标行为；STUDIO_STUB 真服务）═══
 * app.js tqStance 弹窗提交的就是 POST /api/schedule/表态 这一口（触发源=今时线）：
 * 重排落账（含版本推进与新计划）、越线源「无需调整」400 拒（强制二选一）、CAS 旧版本 409 冲突
 * ——409 响应带 冲突:true+现态，前端 排程写 以此走「版本冲突」提示路径。
 * 变异自证点（实现侧，施工中实跑）：lib/pm/schedule.表态 去掉越线二选一分支 → 400 断言红。 */
t('③ 表态写口：重排+类别+新计划落账；缺类别 400；越线源无需调整 400（二选一）；旧版本 409 冲突提示路径', () => {
  const root = makeRoot();
  const ev = (粒ID, 字段变更) => JSON.stringify({ 粒ID, 事件类型: '登记', 字段变更, 版本号: 1, 时刻: '2026-08-24T11:00:00Z', 操作者: '总监' });
  fs.mkdirSync(path.join(root, '排程台账'), { recursive: true });
  fs.writeFileSync(path.join(root, '排程台账', '排程账.jsonl'),
    ev('GX', { 批: '批A', 序: 1, 题: '越线样本', 状态: '计划', 项目: 'TK', 计划开始: '2026-08-24T08:00', 计划完成: '2026-08-24T10:00' }) + '\n', 'utf8');
  const port = 4972;
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js').replace(/\\/g, '/'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const 表态口 = B + '/api/schedule/' + encodeURIComponent('表态');
      const P = async (body) => { const r = await fetch(表态口, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
      const out = {};
      out.重排 = await P({ 粒ID: 'GX', 预期版本: 1, 触发源: '今时线', 决定: '重排', 类别: '额度不够', 新计划开始: '2026-08-25T09:00', 新计划完成: '2026-08-25T12:00', 因: '额度周转不开，后挪一天', 操作者: '总监' });
      out.账 = await (await fetch(B + '/api/schedule')).json();
      out.缺类别 = await P({ 粒ID: 'GX', 预期版本: 2, 触发源: '今时线', 决定: '重排', 新计划完成: '2026-08-26T12:00', 因: '再挪', 操作者: '总监' });
      out.无需 = await P({ 粒ID: 'GX', 预期版本: 2, 触发源: '今时线', 决定: '无需调整', 因: '看着不用动', 操作者: '总监' });
      out.旧版本 = await P({ 粒ID: 'GX', 预期版本: 1, 触发源: '今时线', 决定: '重排', 类别: '并发满', 新计划完成: '2026-08-26T12:00', 因: '并发满再挪', 操作者: '总监' });
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e && e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const o = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  if (o.起服务失败) throw new Error('起服务失败：' + o.起服务失败);
  assert.equal(o.重排.status, 200, '决定=重排+类别+新计划+因 必须过闸');
  assert.deepEqual({ ok: o.重排.body.ok, 动作: o.重排.body.动作, 版本: o.重排.body.粒.版本号 },
    { ok: true, 动作: '重排', 版本: 2 }, '重排表态：ok+动作+CAS 版本推进');
  const g = (o.账.粒 || []).find((x) => x.粒ID === 'GX');
  assert.ok(g && g.计划开始 === '2026-08-25T09:00' && g.计划完成 === '2026-08-25T12:00' && g.版本号 === 2,
    '重排必须落账——重读 /api/schedule 新计划与版本号都得在（弹窗提交后 30s 脉冲读的就是这口）');
  assert.equal(g.推迟次数, 1, 'H112 推迟次数累计进现态（≥3 升格总监的分子）');
  assert.equal(o.缺类别.status, 400, '决定=重排 缺类别必须 400（H113 五类是必填归档轴）');
  assert.match(String(o.缺类别.body.error), /类别/, '缺类别的拒因要点名类别');
  assert.equal(o.无需.status, 400, '越线源（今时线）决定=无需调整 必须 400——强制二选一，第三值不存在');
  assert.match(String(o.无需.body.error), /二选一/, '拒因要把二选一说出口');
  assert.equal(o.旧版本.status, 409, '拿旧版本写必须 409（CAS）');
  assert.ok(o.旧版本.body.冲突 === true && o.旧版本.body.现态 && o.旧版本.body.现态.版本号 === 2,
    '409 响应带 冲突:true+现态——前端 排程写 读这两格走「版本冲突」提示与重绘路径');
});

/* ═══ ④ 树列轻量字段（#20/DS-5）：工单行状态色点+工期徽章；聚合行只有子单计数 ═══
 * 变异自证点：g-完1 完成时刻 +2h、状态拨 已成单 → 徽章 6h→8h、色点 done→made。
 * 徽章/色点若是写死的，拨数据不动，本条必红。 */
t('④ 树列字段：工单行含状态色点（按状态着色）+工期徽章（真实 Nh）；聚合行不含、子单计数照旧', () => {
  const 数据 = 造台账();
  const { ctx, html } = 画(数据);
  const 完块 = 块(html, 'data-gid="g-完1"');
  assert.ok(/gt2dot done/.test(完块), '完成单的状态色点＝done 类（用现有语义色）');
  assert.ok(完块.includes('class="gt2dur">6h<'), '6 小时工单的工期徽章＝6h');
  assert.ok(/gt2dot made/.test(块(html, 'data-gid="g-直"')), '已成单的状态色点＝made 类——色点真按状态分类');
  const 长块 = 块(html, 'data-gid="g-长"');
  assert.ok(长块.includes('class="gt2dur">30h<'), '超长条徽章显真实 30h——截断只截图，不截事实');
  const 越块 = 块(html, 'data-gid="g-越A"');
  assert.ok(/gt2dot [^"]*xline/.test(越块), '越线待重判单的色点挂 xline（红点，色盲可达性同条上纪律）');
  // 越线色点语义一致（DS 终审 #5）：树列色点与悬浮卡徽章是两套视觉系统，词得是同一个——
  // T2 后越线=服务端 待表态 字段（夹具 标待表态 已打标），两处都从它推导，一把尺
  assert.ok(/class="gt2dot [^"]*xline" title="越线待重判"/.test(越块),
    '越线粒树列色点 title=「越线待重判」（DS#5：与悬浮卡徽章同语义词）');
  assert.ok(ctx.GanttIsland.悬浮卡Html('g-越A').includes('越线待重判'),
    '悬浮卡徽章同词「越线待重判」——色点 title 与徽章两处不许各说各话');
  const 聚块 = 块(html, 'data-gid="S-3"');
  assert.ok(!/gt2dur|gt2dot/.test(聚块), '聚合行（专项）不挂工期徽章/状态色点——区间归括号条与悬浮卡');
  assert.ok(/\d+ 单/.test(聚块), '聚合行已有的子单计数不动');
  assert.ok(!/gt2dur|gt2dot/.test(块(html, 'data-gid="F-1"')), '特性聚合行同理不挂');
  // 变异自证：完成时刻 +2h + 状态拨已成单 → 徽章与色点都得跟着翻
  const 变 = 变体(数据);
  const g = 变.粒.find((x) => x.粒ID === 'g-完1');
  g.计划完成 = '2026-08-23T16:00'; g.状态 = '已成单';
  const 块2 = 块(画(变).html, 'data-gid="g-完1"');
  assert.ok(块2.includes('class="gt2dur">8h<'), '完成时刻 +2h 徽章须变 8h——工期从数据算，不是写死');
  assert.ok(/gt2dot made/.test(块2) && !/gt2dot done/.test(块2), '状态拨已成单色点须翻 made——色点真读状态');
  // esc 撇号（DS 终审 #8）：含单引号的题名进双引号包裹的属性值（aria-label）不许裸奔——esc 须转 &#39;
  const 撇 = 变体(数据); 撇.粒.find((x) => x.粒ID === 'g-c01').题 = "带'撇'号样本";
  const 撇块 = 块(画(撇).html, 'data-gid="g-c01"');
  assert.ok(撇块.includes('&#39;'), "含单引号的题名渲染后单引号须转义成 &#39;（DS#8）");
  assert.ok(!/aria-label="[^"]*'/.test(撇块), "题名里的 ' 不许裸进属性值——esc 白名单缺 ' 此断言必红");
});

/* ═══ ⑤ 越线角标（#19）：红底计数=全图越线张数；越线条/待重判标记带表态口抓手 ═══
 * 变异自证点：拨掉一张越线 → 角标 2→1；两张全拨掉 → 角标隐藏。计数若写死必红。 */
t('⑤ 越线角标：台账 2 张越线 → 角标数=2；越线条 data-x 分流+待重判标记可点（表态口）；拨数据角标跟走', () => {
  const 数据 = 造台账();
  const { html } = 画(数据);
  const 标 = /<button[^>]*gt2xbadge[^>]*>/.exec(html);
  assert.ok(标, '工具栏必须挂越线计数角标');
  assert.ok(/data-数="2"/.test(标[0]), `合成台账两张越线（g-越A/g-越B）→ 角标数须=2，实得 ${标[0]}`);
  assert.ok(!/ hidden/.test(标[0]), '有越线时角标不许藏');
  assert.ok(html.includes('越线 2'), '角标文本如实报数');
  const 越块 = 块(html, 'data-gid="g-越A"');
  assert.ok(/gt2bar[^"]*xline[^>]*data-x="1"/.test(越块), '越线条本体带 data-x 分流——点击走表态不走普通重排（#19）');
  assert.ok(/gt2flag rejudge[^>]*data-act="stance"[^>]*data-g="g-越A"/.test(越块),
    '「待重判」标记可点（data-act=stance）——处置不出甘特页（DS-3）');
  assert.ok(!/data-x="1"/.test(块(html, 'data-gid="g-c01"')), '普通条不带 data-x——重排口不受影响');
  // 变异自证 a：g-越B 拨成已成单 → 服务端重判（同一份谓词重打 待表态）→ 角标 1
  const 变 = 变体(数据); 变.粒.find((g) => g.粒ID === 'g-越B').状态 = '已成单';
  标待表态(变.粒);
  assert.ok(/data-数="1"/.test(画(变).html), '一张回到不越线，角标须跟着走——计数从数据推导');
  // 变异自证 b：g-越A 计划开始拨到未来 → 服务端重判 0 张，角标隐藏
  const 变2 = 变体(变); 变2.粒.find((g) => g.粒ID === 'g-越A').计划开始 = '2026-08-25T10:00';
  标待表态(变2.粒);
  const 标2 = /<button[^>]*gt2xbadge[^>]*>/.exec(画(变2).html);
  assert.ok(标2 && / hidden/.test(标2[0]), '零越线时角标必须藏——不许挂个 0 在那儿唬人');
});

/* ═══ ⑥ 越线判定服务端化（终审 T2）：岛只读 /api/schedule 下发的 待表态 字段，私判已删 ═══
 * 病例正身：「计划态 ∧ 计划开始≤今」但对应工单已在途——G23 数据层不欠（单派出去了），
 * 旧岛却按本地私判标「待重判」，两把尺。服务端谓词（schedule.越线待表态判）对这种粒不下发
 * 待表态，岛就不许标。翻转下发字段（数据其余一字不动），越线视觉/角标/菜单/拖拽分流全跟走。 */
t('⑥ 服务端化：计划态+已越线但单已在途（无 待表态）不显待重判；翻转 待表态 字段岛全跟走', () => {
  const 数据 = 造台账();
  const 变 = 变体(数据);
  // 病例粒：计划态、计划开始 09:00 ≤ 现在 12:00、单号 TK-500 已在途 ⇒ 服务端不下发 待表态
  变.粒.push({ 粒ID: 'g-在途', 批: '', 序: 99, 题: '计划态但单已在途', 状态: '计划', 型: '工单',
    上级: 'S-1', 项目: 'TK', 管线: null, 依赖: [], 池衡建议: null, 预估单元: null,
    计划开始: '2026-08-24T09:00', 计划完成: '2026-08-24T10:00', 工期天: null,
    基线开始: '2026-08-24T09:00', 基线完成: '2026-08-24T10:00', 就绪: false,
    来源: '合成台账', 单号: 'TK-500', 版本号: 1, 登记时刻: '2026-08-20T09:00:00.000Z',
    更新时刻: '2026-08-23T09:00:00.000Z', 末次操作者: '项管' });
  标待表态(变.粒); // 服务端同一份谓词打标：可派集不含 TK-500（在途）⇒ 该粒不得 待表态
  assert.ok(!变.粒.find((g) => g.粒ID === 'g-在途').待表态, '前提自证：服务端谓词对「单已在途」不下发 待表态');
  const 首 = 画(变);
  const 途块 = 块(首.html, 'data-gid="g-在途"');
  assert.ok(!/xline/.test(途块) && !/data-x="1"/.test(途块) && !/待重判/.test(途块),
    '两把尺病例正身：计划态+开始≤今 但单已在途 ⇒ 岛不许标越线（斜纹/data-x/待重判 一样都不出）——岛若还留本地私判，此断言必红');
  assert.ok(/data-数="2"/.test(首.html), '角标仍=2（g-越A/g-越B）：在途粒不计入越线数');
  assert.ok(!首.ctx.GanttIsland.菜单Html('条', 'g-在途').includes('m-stance'),
    '在途粒的条菜单不给表态口（走普通重排）');
  // 翻转下发字段（数据其余一字不动）→ 岛全跟走：视觉/角标/菜单/拖拽分流
  const 翻 = 变体(变);
  翻.粒.find((g) => g.粒ID === 'g-在途').待表态 = true;
  const 二 = 画(翻);
  const 记 = { 表态: [] };
  二.ctx.tqStance = (id, 预填) => 记.表态.push([id, 预填]);
  const 翻块 = 块(二.容器.innerHTML, 'data-gid="g-在途"');
  assert.ok(/xline/.test(翻块) && /data-x="1"/.test(翻块) && /待重判/.test(翻块),
    '翻转 待表态=true：斜纹+data-x+待重判标记全出——岛读的真是下发字段');
  assert.ok(/data-数="3"/.test(二.容器.innerHTML), '角标跟着 +1 → 3');
  assert.ok(二.ctx.GanttIsland.菜单Html('条', 'g-在途').includes('m-stance'), '条菜单翻成表态口');
  assert.equal(二.ctx.GanttIsland.试拖('g-在途', '移', 20).口, '表态', '拖拽松手分流跟着走表态口');
  // 反向翻转：把 g-越A 的 待表态 摘掉（数据其余不动）→ 越线视觉整套退场
  const 摘 = 变体(数据);
  delete 摘.粒.find((g) => g.粒ID === 'g-越A').待表态;
  const 三 = 画(摘);
  assert.ok(!/xline|待重判/.test(块(三.html, 'data-gid="g-越A"')),
    '摘掉下发字段（状态/日期都没动）越线视觉必须退场——只画不判是双向的');
  assert.ok(/data-数="1"/.test(三.html), '角标跟着 -1 → 1');
});

(async () => {
  for (const [n, f] of 待) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => {
  console.error('  不通过：' + (e && e.message));
  console.error(e && e.stack);
  process.exit(1);
});
/* 变异自证（H104 施工中实跑，改坏→红→复原绿，证据在工单回执）：
   数据侧（长驻在判据里，每轮都跑）：①越线翻状态→菜单翻；②改挂上级→聚焦集合长；④拨完成时刻/状态→徽章色点翻；⑤拨掉越线→角标跟走。
   实现侧（施工期两轮实测）：
   r1a 造菜单 叶子守卫删掉（恒出「折叠此支」）→ ① 红；
   r1b 建状态 聚焦准许集放全树 → ② 红（集合相等断言炸）；
   r2a 行HTML 工期徽章删掉 → ④ 红；
   r2b 重排() 角标计数写死 0 → ⑤ 红；
   r2c lib/pm/schedule.表态 越线二选一分支删掉 → ③ 红（400 变 200）。
   r3（DS 终审二轮 2026-08-24）：esc 撤掉 ' 转义 → ④ 红（裸撇号进 aria-label 属性值）。 */
