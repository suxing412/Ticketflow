// app.js — 监制台前端：一比一复刻 Figma 定稿（P1–P10 + P9b）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 内联 onclick 里的 JS 字符串字面量转义（esc 不管单引号；文档路径来自项目仓，撇号是可能的）
const qesc = (s) => esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const api = async (p, opt) => (await fetch(p, opt)).json();
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
// 技术策划入三表（施工令-028 范围 5 / 027 报备件）：H88 加了这个职能，色表却没跟上，
// 它的胶囊在流程/工单/在途各处一直是无色的（走 fnPill 的默认分支）。
const FN = { 策划: 'var(--fn-plan)', 技术策划: 'var(--fn-tplan)', 程序: 'var(--fn-code)', 美术: 'var(--fn-art)', QA: 'var(--fn-qa)', 装配: 'var(--fn-asm)' };
// 职能色走 CSS 变量：主题切换（暖纸/玻璃）时内联色自动跟随令牌，不写死 hex
const FNHEX = { 策划: 'var(--fn-plan)', 技术策划: 'var(--fn-tplan)', 程序: 'var(--fn-code)', 美术: 'var(--fn-art)', QA: 'var(--fn-qa)', 装配: 'var(--fn-asm)' };
const FNCLS = { 策划: 'fn-plan', 技术策划: 'fn-tplan', 程序: 'fn-code', 美术: 'fn-art', QA: 'fn-qa', 装配: 'fn-asm' };
// 三大态状态机（H108，2026-08-24）：12 目录态。权威表在 lib/core/store.js，
// /api/board 随行下发 大态 分组；下面这份兜底表只在服务端没给时用（口径抄 store，不许自创）。
const STCLS = { 在途: 'st-doing', 初检: 'st-review', 核查: 'st-review', 仲裁: 'st-review', 完成: 'st-done',
  待处理: 'st-escal', 待重派: 'st-escal', 待审: 'mut', 待派: '', 归档: 'mut', 挂起: 'mut', 废弃: 'mut' };
const STPCT = { 待审: 0, 待派: 0, 待重派: 0, 待处理: 60, 在途: 60, 初检: 75, 核查: 85, 仲裁: 85, 完成: 100, 归档: 0, 挂起: 0, 废弃: 0 };
const 大态兜底 = {
  待办: ['待审', '待派', '待处理', '待重派'],
  在途: ['在途', '初检', '核查', '仲裁', '完成'],
  结束: ['归档', '挂起', '废弃'],
};
// 施工令-015：wiki 升格唯一知识入口（施工令-020 起五分区），风格库导航退役——美术标杆并入 Wiki 页签
// NAV（2026-08-20 四层架构改版）：工单页＝归属结构面（管线→特性→专项→工单三级钻取），
// 看板＝流转面（谁在哪一态）。制作人定的分工原话：「工单页管归属，看板页管流转」。
// 专项页并入工单页第三层，旧书签在 route() 里转向。
//
// NAV 11→8（2026-08-20 制作人页签定案）：撤 想法/流程/队列 三页，内容并入项管页。
// 理由是页签数量本身已经成了负担——十一个页签里有三个回答的是同一个问题的三个切面
// （想法＝还没拍板的活、队列＝拍板了还没成单的活、流程页的计划粒段＝同一批活按管线切片），
// 制作人每次都得先想「这件事该去哪一页找」。合成一页之后，项管页＝**未来面**：
// 想法在池 → 待办队列 → 甘特排期，一条从灵感到落地的线，配上项管自己的行为流水。
// 旧书签 #/ideas · #/flow · #/queue 在 route() 里 location.replace 转向 #/relay，不留死链。
const NAV = [['总览', ''], ['工单', 'tickets'], ['看板', 'board'], ['在途', 'agents'], ['Wiki', 'wiki'], ['项管', 'relay'], ['报表', 'report']]; // 参数入口只走 ⚙；树形页签随施工令-028 退役
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1900); }
// 数值跳字确认（步进器改完后调用）：重触发 animation
function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
// 视图内活体轮询：guard 元素还在页上就每 ms 跑一次 fn，离开视图自动停
// 施工令-048：同一 guardId 只留最新一条。旧样只认「元素还在」，而原地重绘（repaint）会把
// 视图函数再跑一遍、再挂一条同名轮询——morph 之下 guard 元素恰恰一直在，于是每重绘一次就
// 多一条在跑，十分钟后十条 fetch 抢着刷同一块地方（viewQueue 早就自己发号躲过这坑，这里收归公用）。
const _loopGen = {};
function pollLoop(guardId, ms, fn) {
  const gen = _loopGen[guardId] = (_loopGen[guardId] || 0) + 1;
  const 活 = () => $(guardId) && _loopGen[guardId] === gen;
  setTimeout(async function loop() {
    if (!活()) return;
    try { await fn(); } catch { /* 下轮再试 */ }
    if (活()) setTimeout(loop, ms);
  }, ms);
}
// 执行器状态灯：红呼吸=实弹运行中（H81：运行即实弹）；灰=已停（传状态非装饰）
function dotCls(r) { return 'dot ' + (r.运行 ? 'on live' : 'off'); }
// 执行器副标题：运行即实弹（H81），只补一句执行中清单
// 施工令-012：逐单号清单长度随并发无上界增长，会把参数卡撑破（巡礼 P2-2）——超 3 张收敛成「+N」，
// 全量清单挂 title 悬停可查（runMetaFull）。
function runIds(r) { return ((r && r.执行中) || []).map((x) => x.id); }
function runMeta(r) {
  const ids = runIds(r);
  const 清单 = ids.length > 3 ? `${ids.slice(0, 3).join(' / ')} +${ids.length - 3}` : ids.join(' / ');
  return (r.运行 ? '实弹：运行即真调 CLI · 停手闸在单闸' : '已停：不再拉新单')
    + (清单 ? ` · 执行中 ${清单}` : '');
}
function runMetaFull(r) { const ids = runIds(r); return ids.length ? `执行中 ${ids.length} 张：${ids.join(' / ')}` : ''; }
// 文本变了才写并跳字（轮询下防无谓闪动）
function setNum(el, text, cls) {
  if (!el) return;
  if (cls != null && el.className !== cls) el.className = cls;
  if (el.textContent !== text) { el.textContent = text; bump(el); }
}
// 已领时长：秒级颗粒（<1h 显示 分:秒，≥1h 显示 时:分:秒）——分钟级会让分钟内的活看着像冻住
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return s < 3600 ? `${p(Math.floor(s / 60))}:${p(s % 60)}` : `${Math.floor(s / 3600)}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
}
const fnPill = (fn) => fn ? `<span class="pill sm fn ${FNCLS[fn] || ''}">${esc(fn)}</span>` : '';
const stPill = (st) => `<span class="pill ${STCLS[st] || ''}">${esc(st)}</span>`;
/* ===== 挂起可视三件套（施工令-021）=====
   三处渲染（工单池卡 / 流程节点 / 在途时间轴段）共用同一组：置灰靠 .susp 类，
   ❄ 徽标靠 snowB()，鼠标悬停的解释靠 suspTip()。新视图挂上同样三件即自动同款——
   各视图各画一套是「同一个事实在五个地方长得不一样」的开端。
   取值一律 t.挂起（/api/board 与 /api/decisions 已随行透出），缺字段=未挂（老单零迁移）。
   H108 后挂起升目录态：state=挂起 也算挂（fm.挂起 是老标记形态的存量，迁移由总控做，两种都认）。 */
const suspOf = (t) => (t && (t.挂起 || (t.state === '挂起' ? { 操作者: '制作人' } : null))) || null;
const suspCls = (t) => (suspOf(t) ? ' susp' : '');
const suspTip = (t) => { const s = suspOf(t); return s ? `已挂起 · ${s.操作者 || '制作人'} · ${String(s.时间 || '').slice(0, 16).replace('T', ' ')}${s.理由 ? '\n' + s.理由 : ''}${s.连带自 ? '\n（随父单 ' + s.连带自 + ' 全树挂起）' : ''}` : ''; };
const snowB = (t) => (suspOf(t) ? `<span class="snowb" title="${esc(suspTip(t))}">❄</span>` : '');

/* ===== 多项目视界（v0.12 = D42）=====
   启动页选项目 → 进入该项目的驾驶舱，全部视图按项目过滤。
   单项目/零项目直通驾驶舱（不设滤镜）；池/编制/额度/执行器是账号级共享资源，永远全局。 */
let _cfg = null, _cfgAt = 0;
async function loadCfg(force) {
  if (!force && _cfg && Date.now() - _cfgAt < 30000) return _cfg;
  _cfg = await api('/api/config'); _cfgAt = Date.now(); return _cfg;
}
const projNames = () => Object.keys((_cfg && _cfg.项目 && _cfg.项目.注册) || {});
const projMulti = () => projNames().length >= 2;
const curProj = () => localStorage.getItem('studio-proj') || '';
const setProj = (p) => localStorage.setItem('studio-proj', p || '');
const projDefault = () => (_cfg && _cfg.项目 && _cfg.项目.默认) || '';
const projOf = (t) => t.项目 || projDefault(); // 无章的单归默认项目（与执行器口径一致）
const projActive = () => (projMulti() && curProj()) ? curProj() : ''; // 空 = 不过滤

/* ===== 壳 ===== */
function shell(active, inner) {
  const tabs = NAV.map(([n, h]) => `<a href="#/${h}" class="${active === h ? 'active' : ''}">${n}</a>`).join('');
  const p = projActive();
  return `<div class="topbar">
      <div class="tleft"><a class="logohome" href="#/hub" title="回项目启动页"><img class="logo" src="favicon.ico" alt="监制台"/></a><div>
        <h1>监制台${p ? ` · ${esc(p)}` : ''}</h1><p class="tagline">工单 · 审检 · 验收——制作人的驾驶舱：你拍板与放行，系统派发执行（H49）</p></div></div>
      <div class="tright"><div class="searchbox"><input id="gsearch" placeholder="搜索工单 编号 / 标题" autocomplete="off" oninput="gSearch(this.value)" onfocus="gSearch(this.value)" onkeydown="gEnter(event)"/><div id="gsr" class="gsr"></div></div>
        <a class="gear" href="#/params" title="全局参数与额度（单项目不经启动页也能到）">⚙</a></div></div>
    <nav class="snav">${tabs}</nav>
    <div id="view">${inner}</div>`;
}
function bshell(crumb, pillHtml, inner, home) {
  return `<div class="bhead"><button class="backbtn" onclick="history.back()" title="返回">←</button>
    <a class="bc1" href="${home || '#/board'}">监制台</a><span class="sep">/</span><span class="bc2">${esc(crumb)}</span>${pillHtml || ''}</div>
    <div id="view">${inner}</div>`;
}

/* ===== 数据装配 ===== */
// 专项伪单摘除（施工令-058 要件5）：迁移把容器伪单归档留在纸面上，但它不该再占盘面上任何一格——
// 它不是活，工单板上每多一条这种单，制作人就要多问一次「这个我是不是该处理」。
// 判据只认 迁移至专项 这一印：没迁的存量战役父单照旧显示（那些还是真在用的容器单）。
const 是专项伪单 = (t) => !!(t && t.迁移至专项);

async function loadBoard() {
  const [d] = await Promise.all([api('/api/board' + (window._showHidden ? '?含隐藏=1' : '')), loadCfg()]);
  window._hiddenCnt = d.隐藏数 || 0;
  for (const s of d.states) d.board[s] = (d.board[s] || []).filter((t) => !是专项伪单(t));
  const raw = []; for (const s of d.states) for (const t of d.board[s]) raw.push({ ...t, state: s });
  // 大态分组表：服务端（/api/board）下发为准，读不到回落前端兜底（三大态改造 2026-08-24）
  const 大态 = d.大态 && Object.keys(d.大态).length ? d.大态 : 大态兜底;
  const p = projActive();
  if (!p) return { states: d.states, board: d.board, all: raw, raw, 大态 };
  const board = {}; for (const s of d.states) board[s] = (d.board[s] || []).filter((t) => projOf(t) === p);
  return { states: d.states, board, all: raw.filter((t) => projOf(t) === p), raw, 大态 };
}
function buildTree(all) {
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  const kids = {}; for (const t of all) if (t.父单 && byId[t.父单]) (kids[t.父单] = kids[t.父单] || []).push(t);
  const parents = all.filter((t) => kids[t.id]);
  const topLeaves = all.filter((t) => !kids[t.id] && (!t.父单 || !byId[t.父单]));
  return { byId, kids, parents, topLeaves };
}

/* ===== P0 项目启动页（D42 多项目视界）=====
   全项目监控台：一张卡一个项目（计数+需处理红点），点卡进驾驶舱；
   全局横幅 = 执行器/双池/环境（账号级共享，不属于任何项目）；⚙ 全局参数入口在此。 */
async function viewHub() {
  const cfg = await loadCfg(true);
  const names = projNames();
  // 债的判据只有一处：等我()（/api/attn）。**不许在这里按工单状态另算一遍**——
  // 那正是 08-21 撤决策台时判死的那条轴：专项关账、投池放行、值守断更都不是工单状态，
  // 它结构上看不见。实测同一时刻本页两张卡都写「安好」，而 /api/attn 报 5 笔债、3 笔逾期
  // （含一笔停 47.9 小时）。取不到就退化成「读数中」，**不许拿旧轴顶上冒充安好**。
  const [d, attn] = await Promise.all([api('/api/board'), api('/api/attn').catch(() => null)]);
  const raw = []; for (const s of d.states) for (const t of d.board[s]) raw.push({ ...t, state: s });
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  const def = projDefault();
  const cnt = (arr, ...sts) => arr.filter((t) => sts.includes(t.state)).length;
  // 债的 id → 项目：工单号带前缀（TK-9 / TF-1），照注册表的 单号前缀 反查；查不到即非本类实体
  const 前缀表 = Object.entries(reg).map(([名, v]) => [String((v && v.单号前缀) || 名), 名]);
  const 归项目 = (id) => { const m = String(id).match(/^([A-Za-z]+)-/); if (!m) return null;
    const hit = 前缀表.find(([px]) => px === m[1]); return hit ? hit[1] : null; };
  const cards = names.map((n) => {
    const a = raw.filter((t) => projOf(t) === n);
    // 债按项目归：工单号带项目前缀（TK-n / TF-n），非工单实体（专项 S-n、待办 uuid、值守）
    // 走它自己的 项目 字段；两者都判不出的算全局，不摊到任一项目头上（宁可少报也不错报到别人账上）。
    const 本项目债 = attn && Array.isArray(attn.债)
      ? attn.债.filter((x) => (x.项目 ? String(x.项目) === n : 归项目(String(x.id)) === n))
      : null;
    const need = 本项目债 ? 本项目债.length : null;
    const 逾 = 本项目债 && attn.逾期阈值小时 != null
      ? 本项目债.filter((x) => x.停摆小时 != null && x.停摆小时 >= attn.逾期阈值小时).length : 0;
    // 待派这一栏 2026-08-22 补（原「待投」，三大态改造改名）：G1「项管闸放行」的落点就是它，
    // 卡上没有这个数，「需处理 N」里那笔放行债在项目卡上就找不到对应的去处。
    const counts = [['在途', cnt(a, '在途', '初检', '核查', '仲裁'), ''], ['待派', cnt(a, '待派'), ''], ['待重派', cnt(a, '待重派'), ''],
      ['完成', cnt(a, '完成'), ''], ['待处理', cnt(a, '待处理'), 'err']];
    const eng = reg[n] && reg[n].引擎;
    // H-2 零值灰显 / H-3 键盘可达（2026-08-06 UI 评审 hub 页）
    return `<div class="hubcard card r16" onclick="enterProj('${esc(n)}')" tabindex="0" role="button" aria-label="进入项目 ${esc(n)}"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();enterProj('${esc(n)}')}">
      <div class="hn"><b>${esc(n)}</b>${n === def ? '<span class="pill sm mut">默认</span>' : ''}
        ${eng ? `<span class="pill sm mut" title="引擎档案（探针按此自检）">${esc(eng.类型)}${eng.版本 ? ' ' + esc(eng.版本) : ''}</span>` : ''}
        ${need == null ? '<span class="pill sm mut">债读数中</span>'
          : (need ? `<span class="pill sm red">需处理 ${need}${逾 ? ` · 逾期 ${逾}` : ''}</span>` : '<span class="pill sm ok">安好</span>')}</div>
      <div class="hpath mono" title="${esc((reg[n] && reg[n].路径) || '')}">${esc((reg[n] && reg[n].路径) || '')}</div>
      ${reg[n] && reg[n].说明 ? `<div class="hnote">${esc(reg[n].说明)}</div>` : ''}
      <div class="hcounts">${counts.map(([l, v, c]) => `<span class="hc"><i class="${v ? (c || '') : 'z'}">${v}</i>${l}</span>`).join('')}</div>
      <div class="hlast dim" id="hlast-${esc(n)}"></div></div>`;
  }).join('');
  // 全局横幅数据后到、原地填（视图保持渲染铁律）
  setTimeout(async () => { try {
    const [run, g] = await Promise.all([api('/api/runner'), api('/api/gates')]);
    const el = $('hub-run');
    if (el) el.innerHTML = `<i class="${dotCls(run)}"></i><span style="font-size:14px;font-weight:500">${run.运行 ? '实弹运行中' : '已停'}</span>`;
    paintGate(g.paused, g.OAuth); // H81 单闸：胶囊 + 停/开按钮 + 合闸时的常驻醒目提示（施工令-055：OAuth 死了也挂条）
    // H64 编辑器锁已迁决策台（2026-08-05 制作人指正：锁属验收流程，不落首页）
    setNum($('hub-cx'), g.locks.codex.fivePct != null ? g.locks.codex.fivePct + '%' : '—', 'num ' + (g.locks.codex.locked ? 'err' : 'okc'));
    setNum($('hub-cl'), g.locks.claude.fivePct != null ? g.locks.claude.fivePct + '%' : '—', 'num ' + (g.locks.claude.locked ? 'err' : 'dim'));
  } catch { /* 保持占位 */ } }, 0);
  // H-1 项目卡最近动态行（2026-08-06 UI 评审）：journal 该项目最后一条，启动页有实时判断力
  setTimeout(async () => { try {
    const jn = await api('/api/journal'); const lines = jn.lines || [];
    for (const n of names) {
      const el = document.getElementById('hlast-' + n); if (!el) continue;
      const hit = [...lines].reverse().find((l) => l.includes(n + '-') || l.includes('项目 ' + n));
      if (hit) { const m = String(hit).match(/^\[[^\]]*?([\d:]{5})[^\]]*\]\s*(.*)$/); el.textContent = (m ? m[1] + ' · ' + m[2] : hit).slice(0, 56); }
    }
  } catch { /* 无动态不补 */ } }, 0);
  // 工程队卡（施工令-002 立卡，041 §五 改直读）：服务端直读 工程队/ 目录实况算出四字段，
  // 无目录/无施工令文件 → 整卡不渲染（占位 div 保持空）。卡上不再有任何要人手维护的字段。
  // 施工令-042 §二：状态卡扩成**队列卡**——当前施工令（041 直读逻辑原样保留）之下，
  // 列出监制台自己排着的活（Q 队列 = 无管线的待办计划粒）。制作人开机第一眼要看见的
  // 不只是「工程队在干什么」，还有「干完这个轮到什么」。队列取不到就退回单行卡，不让整卡消失。
  setTimeout(async () => { try {
    const [cr, q] = await Promise.all([api('/api/crew'), api('/api/schedule/工程队').catch(() => null)]);
    const c = cr.卡; const el = $('hub-crew');
    if (!el || !c) return;
    const cls = c.状态 === '完工' ? 'ok' : c.状态 === '待验收' ? 'red' : 'mut';
    const 更新 = c.更新时间 ? new Date(c.更新时间) : null;
    const 时 = 更新 && !isNaN(更新) ? 更新.toLocaleString('zh-CN', { hour12: false }).slice(5) : esc(c.更新时间 || '');
    const 行 = (q && Array.isArray(q.行)) ? q.行 : null; // 老服务端回的是 {error}：整段队列区不出，卡退回 041 单行样
    const 队列Html = !行 ? ''
      : 行.length
        ? `<div class="crewq">
            <div class="cqh">↓ 其后队列 <b>${q.总数}</b> 项${q.预估合计 ? ` · 预估 ${q.预估合计} 单元` : ''}
              <span class="sp"></span><a href="#/relay" class="cqmore">全部队列 →</a></div>
            ${行.map((x) => `<div class="cqrow${x.置灰 ? ' blocked' : ''}" title="${esc(x.提示)}">
              <span class="cqs mono">${esc(x.批)}${x.序 ? '·' + x.序 : ''}</span>
              <span class="cqb">${esc(x.徽章)}</span>
              <span class="cqt">${esc(x.题)}</span>
              ${x.候 ? `<span class="cqw">候：${esc(x.候)}</span>` : ''}
              <span class="cqe mono">${x.预估单元 != null ? esc(x.预估单元 + ' 单元') : ''}</span></div>`).join('')}
            ${q.余数 ? `<div class="cqmoreline">…另有 ${q.余数} 项，<a href="#/relay">去项管页看全</a></div>` : ''}</div>`
        : '<div class="crewq"><div class="cqempty">其后队列空——批次拍板后由总监/项管登记</div></div>';
    el.innerHTML = `<div class="crewcard card r14">
      <div class="cwtop"><b style="font-size:13px">工程队</b><span class="pill sm ${cls}">${esc(c.状态 || '—')}</span>
        <span class="cwo mono">施工令 ${esc(c.施工令 || '—')}</span>
        <span class="cwn clamp2" title="${esc(c.名称 || '')}">${esc(c.名称 || '')}</span>
        <span class="spacer"></span><span class="subnote">${esc(时)} 更新 · 直读工程队目录</span></div>
      ${队列Html}</div>`;
  } catch { /* 无状态文件不渲染 */ } }, 0);
  setTimeout(async () => { try {
    const e2 = await api('/api/env'); const el = $('hub-env'); if (!el) return;
    el.title = e2.结论.join('\n');
    el.innerHTML = e2.总灯 === '就绪' ? '就绪'
      : `<i class="dot ${e2.总灯 === '降级' ? 'warn breathe-warn' : 'err breathe-err'}"></i><span class="pill sm ${e2.总灯 === '降级' ? 'warn' : 'red'}" style="font-weight:700">${e2.总灯}</span>`;
    el.className = 'num ' + (e2.总灯 === '就绪' ? 'okc' : '');
  } catch { /* 保持占位 */ } }, 0);
  return `<div class="topbar">
      <div class="tleft"><img class="logo" src="favicon.ico" alt="监制台"/><div>
        <h1>监制台</h1><p class="tagline">项目启动页——选项目进驾驶舱；执行器与额度是全局共享资源</p></div></div>
      <div class="tright"><a class="gear" href="#/params" title="全局参数与额度">⚙</a></div></div>
    <div id="gate-banner"></div>
    <div class="stat-strip card r14" style="margin-top:26px">
      <div class="grp"><span class="lbl">执行器</span><span class="num" id="hub-run" style="font-size:14px">—</span></div><div class="vdiv"></div>
      <div class="grp"><span class="lbl">单闸</span><span class="num" id="hub-gate" style="font-size:14px">—</span></div><div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">codex 池</span><span class="num dim" id="hub-cx">—</span></div><div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">claude 池</span><span class="num dim" id="hub-cl">—</span></div><div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">环境</span><span class="num dim" id="hub-env" title="全链路自检">—</span></div>
      <div class="spacer"></div><span class="subnote">需你处理的项目卡会亮红胶囊 · 编辑器锁在在途页</span></div>
    <div id="hub-crew"></div>
    <div class="hubgrid">${cards}
      <a class="hubcard add card r16" href="#/proj-new"><span>＋ 注册新项目</span><span class="subnote">一份监制台管所有项目——注册即接管</span></a></div>`;
}

/* ===== P0b 注册新项目（D42 追加：注册是进门仪式，不进参数大杂烩）===== */
function viewProjNew() {
  return `<div class="p7grid">
    <div class="formcard card r16"><h3>项目信息</h3>
      <div class="f-field"><label>项目名（中文/字母数字，≤24 位——它会成为工单编号前缀，如 TK-13）</label>
        <input id="pn-name" placeholder="如 TK / 甲游戏" autocomplete="off"/></div>
      <div class="f-field"><label>仓库绝对路径（执行 agent 的目标仓库，目录必须已存在）</label>
        <input id="pn-path" class="mono" placeholder="D:\\GitHub\\MYGAME"/></div>
      <div class="f-field"><label>说明（可选，≤60 字）</label><input id="pn-note" placeholder="一句话说明这是什么项目"/></div>
      <div class="f-field"><label>引擎（可选——游戏项目声明后，探针会自检引擎在位与版本匹配）</label>
        <div style="display:flex;gap:8px"><select id="pn-eng" style="flex:0 0 130px">
          <option value="">无 / 非游戏</option><option value="godot">godot</option>
          <option value="unity">unity</option><option value="unreal">unreal</option></select>
        <input id="pn-engv" class="mono" placeholder="版本（可选，如 4.7.1 / 6000.3.10f1）" style="flex:1"/></div></div>
      <div class="f-field"><label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="pn-def" style="width:16px;height:16px;padding:0"/> 设为默认项目（未盖项目章的工单归它）</label></div>
      <div class="p7foot"><a class="btn h44" href="#/hub">取消</a>
        <button class="btn accent h44" onclick="projNewSave(this)">注册并回启动页</button></div></div>
    <div class="formcard card r16"><h3>注册即接管</h3>
      <div class="doc2">
        <p>· <b>一份监制台管所有项目</b>——注册后启动页多一张监控卡，点卡进入该项目的驾驶舱，工单按项目隔离。</p>
        <p>· <b>执行 agent 会写入这个仓库</b>：领到盖着该项目章的工单后，codex/claude 在此仓库内产出代码与文档（写权限见岗位协议）。</p>
        <p>· <b>共享资源不用重配</b>：执行器、职能编制、额度双闸、岗位协议全局一套，新项目即刻可用。</p>
        <p>· 起草工单时在「项目」下拉里选它；编号建议按 <span class="mono">项目名-序号</span> 起，防跨项目撞号。</p>
        <p class="dim">改名/删除/换默认在 启动页 ⚙ → 项目注册。</p></div></div></div>`;
}
window.projNewSave = async (btn) => {
  const name = $('pn-name').value.trim(), p = $('pn-path').value.trim(), note = $('pn-note').value.trim();
  if (!name || !p) return toast('项目名与仓库路径不能为空');
  btn.disabled = true;
  const engT = $('pn-eng').value, engV = $('pn-engv').value.trim();
  const r = await post('/api/config/project', { 动作: '注册', 名称: name, 路径: p, 说明: note,
    ...(engT ? { 引擎: { 类型: engT, ...(engV ? { 版本: engV } : {}) } } : {}) });
  if (!r.ok) { btn.disabled = false; return toast(r.error || '注册失败'); }
  if ($('pn-def').checked) await post('/api/config/project', { 动作: '设默认', 名称: name });
  _cfg = null; // 项目表变了，语境缓存作废
  toast('已注册：' + name);
  location.hash = '#/hub';
};
window.enterProj = (n) => { setProj(n); if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/'; };

/* ===== P1 总览 ===== */
// 总览在跑摘要（施工令-004 第 4 条，规格从简）：数字 + 阶段名，点进在途页看全貌
function ovRunHtml(ag) {
  const rows = (ag && ag.在跑) || [];
  if (!rows.length) return '';
  return `<div class="card r14 ovrun">${rows.map((r) => {
    const p = r.进度 || {};
    return `<a class="ovrun-row" href="#/t/${esc(r.id)}"><span class="mono rid">${esc(r.id)}</span>
      <span class="rt">${esc(r.title || '')}</span>
      <b class="mono pct ${p.超时 ? 'over' : ''}">${p.百分比 != null ? p.百分比 : '—'}%</b>
      <span class="st">${esc(p.阶段名 || (r.环节 ? r.环节 + '中' : '衔接中'))}</span></a>`;
  }).join('')}</div>`;
}
async function viewOverview() {
  const [{ all, board }, jn, ag, attn] = await Promise.all([loadBoard(), api('/api/journal').catch(() => null), api('/api/agents').catch(() => ({})), api('/api/attn').catch(() => null)]);
  const n = (s) => (board[s] || []).length;
  const groups = [['在途', n('在途') + n('初检') + n('核查') + n('仲裁'), ''], ['完成', n('完成'), ''], ['待处理', n('待处理'), n('待处理') ? 'err' : ''], ['待派', n('待派'), ''], ['待重派', n('待重派'), '']];
  const strip = groups.map(([l, v, c], i) => `${i ? '<div class="vdiv"></div>' : ''}<div class="grp"><span class="lbl">${l}</span><span class="num ${c}">${v}</span></div>`).join('');
  // 收件箱换轴（2026-08-20，施工令-061 二·4）：原先是「待验收 ∪ 待定夺」两态拼接——
  // 判据轴是**工单状态**，于是「专项关账」这类非工单实体的人闸结构上就看不见
  // （08-20 实测欠 3 笔而页面报 1 笔）。现改吃服务端唯一谓词 等我()：定义域是**闸**不是状态，
  // 按停摆时长降序（催办的天然序），每行带闸名与已停多久，点击按注册表落点直达。
  // 降级：/api/attn 不可达时回落两态拼接的老路——收件箱是开机第一屏，宁可退化也不许空白。
  const inbox = (attn && Array.isArray(attn.债))
    ? attn.债.filter((x) => x.归属 !== '总监').map((x) => ({
        id: x.id, title: x.title, k: x.闸名,
        note: x.停摆小时 == null ? x.落点 : `已停 ${x.停摆小时 < 24 ? x.停摆小时 + ' 小时' : Math.round(x.停摆小时 / 24 * 10) / 10 + ' 天'} · ${x.落点}`,
        逾期: attn.逾期阈值小时 != null && x.停摆小时 != null && x.停摆小时 >= attn.逾期阈值小时,
        // 读注册表下发的**路由**，不按 id 形状猜（2026-08-21 体检）。
        // 原样是 `/^[A-Z]-\d+$/.test(id) ? '#/tickets' : '#/t/'+id` —— 想法（I-xxx）、
        // 待办（uuid）、wiki（名称）全都不匹配，一律跳 `#/t/<非工单号>`，服务端明确回「工单不存在」。
        // 而同一段注释上面就写着「点击按注册表落点直达」——注册表逐闸写好的落点从没参与过路由。
        // 现网那几条恰好空队列，属潜伏未爆：**空队列不是没病，是还没轮到它**。
        到: x.路由 || (/^[A-Z]+-\d+$/.test(String(x.id)) ? `#/t/${x.id}` : '#/'),
      }))
    : [
      ...(board['完成'] || []).map((t) => ({ ...t, k: '完成', note: t.验收方式 === '保留' ? '保留 · 待品味终审' : '判官已过 · 候专项级验收', 到: `#/t/${t.id}` })),
      ...(board['待处理'] || []).map((t) => ({ ...t, k: '待处理', note: '执行失败/判官上呈，候分诊', 到: `#/t/${t.id}` })),
    ];
  // 值守区（2026-08-22 体检 #9/#31）：闸注册表 G13/G14/G15/G16/G17 五条的落点都写着「总览 · 值守」，
  // 而总览从来没有这块区，这几笔又被上面那道「归属 !== 总监」滤掉——**注册表指着一个不存在的门牌**。
  // 实测停最久的两笔（G14 停 274h、G13 停 243h）在七个页签里一个像素都没有。
  // 这里把门牌兑现，同时守住老纪律：总监的债折叠着放在制作人的收件箱**之下**，不抢第一屏。
  // 上面那道 归属 !== '总监' 保持不动：两块互补、不重不漏，「需你处理 N」永远只数制作人的。
  const 值守停文 = (h) => (h == null ? '' : h < 24 ? h + ' 小时' : Math.round(h / 24 * 10) / 10 + ' 天');
  const 值守逾 = (x) => !!(attn && attn.逾期阈值小时 != null && x.停摆小时 != null && x.停摆小时 >= attn.逾期阈值小时);
  const 值守债 = (attn && Array.isArray(attn.债)) ? attn.债.filter((x) => x.归属 === '总监') : [];
  const 值守逾数 = 值守债.filter(值守逾).length;
  const 值守Html = !值守债.length ? '' : `<div class="sec-h" style="margin-top:28px"><h3 class="h17">值守</h3>
      <span class="subnote">${值守债.length} 项归总监${值守逾数 ? ` · 逾期 ${值守逾数}` : ''}——不占你的版面，但不许消失</span></div>
    <details class="ovwatch card r14"${值守逾数 ? ' open' : ''}>
      <summary>总监自己的债 ${值守债.length} 笔${值守逾数 ? `（逾期 ${值守逾数}）` : ''} · 点开看</summary>
      ${值守债.map((x) => `<div class="inbox-row card${值守逾(x) ? ' od' : ''}" onclick="location.hash='${esc(x.路由 || '#/')}'" tabindex="0" role="button"
        onkeydown="if(event.key==='Enter'){location.hash='${esc(x.路由 || '#/')}'}">
        <span class="rid">${esc(x.id)}</span><span class="rt clamp2" title="${esc(x.title)}">${esc(x.title)}</span>
        <span class="rnote">${esc((值守停文(x.停摆小时) ? '已停 ' + 值守停文(x.停摆小时) + ' · ' : '') + (x.按钮 || x.落点 || ''))}</span>
        ${stPill(x.闸名)}</div>`).join('')}</details>`;
  const inboxHtml = inbox.map((r) => `<div class="inbox-row card${r.逾期 ? ' od' : ''}" onclick="location.hash='${esc(r.到)}'" tabindex="0" role="button"
      onkeydown="if(event.key==='Enter'){location.hash='${esc(r.到)}'}">
      <span class="rid">${esc(r.id)}</span><span class="rt clamp2" title="${esc(r.title)}">${esc(r.title)}</span><span class="rnote">${esc(r.note)}</span>
      ${stPill(r.k)}</div>`).join('')
    || `<p class="dim">你不欠任何签字——改造后这句话第一次是可证的（服务端逐闸扫过）${n('待派') ? `；<a href="#/board" style="color:var(--accent-ink)">待派列还有 ${n('待派')} 张候放行 →</a>` : ''}</p>`;
  // 池首投放建议已随拉取制退役（0.24.7 视图清仓）
  // 判**正形**不判 null（2026-08-22 体检 #66）：api() 不看 res.ok，ready() 的 500 也带合法 JSON 体，
  // catch 压根不触发——只把兜底换成 null 会落成一个跑绿却漏一半的假修。
  const 动态可读 = !!(jn && Array.isArray(jn.lines));
  const lines = (动态可读 ? jn.lines : []).slice(-5).reverse();
  const logHtml = lines.map((l) => { const m = String(l).match(/^\[([\d-]+ )?([\d:]{5})[^\]]*\]\s*(.*)$/); const tm = m ? m[2] : ''; const tx = m ? m[3] : String(l);
    const cls = /锁|超|告警|打回/.test(tx) ? 'err' : /通过|完成|验收/.test(tx) ? 'okc' : ''; return `<div class="logrow"><time>${esc(tm)}</time><span class="${cls}" title="${esc(tx)}">${esc(tx.slice(0, 56))}</span></div>`; }).join('') || (动态可读 ? '<p class="dim">无动态</p>' : '<p class="dim">读不到 journal（/api/journal 不可达或返回异常）——这不是「没有动态」</p>');
  // 额度卡按池实际窗口画杆（施工令-010）：窗口清单由 /api/gates 直供（lib/gates.poolLock.窗口），
  // claude 双窗画 5小时+周，codex 现实只有周窗就只画一条周条——旧样写死两杆，codex 那条空的
  // 「5h ··」既误导又占版面。周额度烧穿是灾难级，周条永远在。陈旧读数带时间戳。
  const qbarLine = (lbl, pct, hot) => `<div class="qrow2"><span class="qn">${lbl}</span><div class="qbar"><i class="${hot ? 'hot' : ''}" style="width:${pct || 0}%"></i></div>
      <span class="qp ${hot ? 'err' : ''}">${pct == null ? '—' : pct + '%'}</span></div>`;
  const qrow = (name, l) => {
    const hot = l && l.locked;
    const staleTag = l && l.陈旧 && l.更新于 ? `（${new Date(l.更新于).toTimeString().slice(0, 5)} 读数）` : '';
    const wins = l && Array.isArray(l.窗口) ? l.窗口 : null;
    const bars = wins
      ? (wins.length ? wins.map((w) => qbarLine(esc(w.label), w.pct, !!w.已越)).join('') : qbarLine('窗口', null, false))
      : `${qbarLine('5h', l ? l.fivePct : null, hot)}${qbarLine('周', l ? l.weekPct : null, hot && l.weekPct != null && l.weekPct >= 90)}`;
    return `<div class="qgrp"><div class="qhead">${name}${hot ? ` <span class="err" style="font-size:10.5px">●锁${l.resetAt ? ' ' + esc(l.resetAt) + ' 解冻' : ''}</span>` : ''}<span class="qstale">${staleTag}</span></div>
      ${bars}</div>`;
  };
  // 框架即时渲染，数据原地填；之后 5s 活体轮询本地缓存（查询频率另有纪律，显示不受限）
  // 骨架不预设窗口名：各池窗口构成不同（codex 只有周窗），预写「5h」会先闪一帧假标签
  const qskel = (name) => `<div class="qgrp"><div class="qhead">${name}</div>
      <div class="qrow2"><span class="qn">窗口</span><div class="qbar"><i class="ghosting" style="width:0%"></i></div><span class="qp dim">—</span></div></div>`;
  let lastGatesJson = '';
  const fillGates = async () => {
    const g = await api('/api/gates');
    // 「推荐在途」已随精力档/拉取制退役（0.23.11 制度、0.24.7 视图清仓）——派发制的并发上限在项管台账
    const pauseEl = $('ov-pause');
    if (pauseEl) pauseEl.innerHTML = g.paused ? '<span class="pill sm red" style="font-weight:700">已合闸 · 不派单</span>' : '<span class="okc">开</span>';
    setNum($('ov-cx'), g.locks.codex.fivePct != null ? g.locks.codex.fivePct + '%' : '—', 'num ' + (g.locks.codex.locked ? 'err' : 'okc'));
    setNum($('ov-cl'), g.locks.claude.fivePct != null ? g.locks.claude.fivePct + '%' : '—', 'num ' + (g.locks.claude.locked ? 'err' : 'dim'));
    const key = JSON.stringify([g.locks.codex, g.locks.claude]);
    if (key !== lastGatesJson) { lastGatesJson = key; const qc = $('ov-quota'); if (qc) qc.innerHTML = qrow('codex', g.locks.codex) + qrow('claude', g.locks.claude); }
  };
  setTimeout(() => { fillGates().catch(() => { /* 保持占位 */ }); }, 0);
  pollLoop('ov-quota', 5000, fillGates);
  // 就绪灯：就绪=安静文字；降级/阻断=色底胶囊+同色呼吸灯（A 方案，呼吸=需要注意的既有灯语）
  const fillEnv = async () => {
    const d = await api('/api/env');
    const el = $('ov-env'); if (!el) return;
    el.title = d.结论.join('\n');
    if (d.总灯 === '就绪') {
      if (el.dataset.st !== '就绪') { el.dataset.st = '就绪'; el.className = 'num okc'; el.innerHTML = '就绪'; }
    } else if (el.dataset.st !== d.总灯) {
      el.dataset.st = d.总灯;
      const warn = d.总灯 === '降级';
      el.className = 'num';
      el.innerHTML = `<i class="dot ${warn ? 'warn breathe-warn' : 'err breathe-err'}"></i><span class="pill sm ${warn ? 'warn' : 'red'}" style="font-weight:700">${d.总灯}</span>`;
    }
  };
  setTimeout(() => { fillEnv().catch(() => { /* 保持占位 */ }); }, 0);
  pollLoop('ov-env', 60000, fillEnv);
  // 今日排程横幅（施工令-041 §二）：一行话答三问——现在在做什么、接下来是什么、几件等我。
  // 口径在服务端 lib/pm/schedule-view.摘要 算好（runner 执行中 + 排程待办 + 决策台待签），
  // 前端只画：三个数各算各的，正是「流程页说 6 项、总览说 4 项」那类打架的来源。
  const fillSched = async () => {
    const s = await api('/api/schedule/摘要');
    const el = $('ov-sched'); if (!el || !s || s.文 == null) return;
    el.innerHTML = `<div class="ovsched card r14" onclick="location.hash='#/relay'" tabindex="0" role="button"
        onkeydown="if(event.key==='Enter'){location.hash='#/relay'}" title="点击进项管页看甘特与待办队列（流程页已随 11→8 页签定案摘牌）">
        <span class="osk">今日排程</span>
        <span class="ost"><b>${s.在做}</b> 在做${s.首条题 ? `（${esc(s.首条题)}）` : ''}</span><i class="osa">→</i>
        <span class="ost"><b>${s.接下来}</b> 项接下来${s.下一项题 ? `（${esc(s.下一项题)}）` : ''}</span><i class="osa">→</i>
        <span class="ost s"><b>${s.等你}</b> 项等你</span>
        <span class="spacer"></span><span class="subnote">进项管页 →</span></div>`;
  };
  setTimeout(() => { fillSched().catch(() => { /* 排程台账不在（老部署）→ 横幅不出，不占版面 */ }); }, 0);
  pollLoop('ov-sched', 30000, fillSched);
  return `<div class="stat-strip card r14">${strip}
      <div class="vdiv"></div>
      <div class="grp"><span class="lbl">派发闸</span><span class="num dim" id="ov-pause">—</span></div>
      <div class="spacer"></div>
      <div class="grp pool"><span class="lbl">codex 池</span><span class="num dim" id="ov-cx">—</span></div>
      <div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">claude 池</span><span class="num dim" id="ov-cl">—</span></div>
      <div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">环境</span><span class="num dim" id="ov-env" title="全链路自检">—</span></div></div>
    <div class="p1-grid"><div>
      <div class="sec-h"><h3 class="h17">需你处理</h3><span class="subnote">${inbox.length} 项待你决定</span></div>
      ${inboxHtml}
      <div id="ov-sched"></div>
      ${值守Html}
      <div class="sec-h" style="margin-top:28px"><span class="subnote" style="font-weight:500">派发窗（H49）</span></div>
      ${ovRunHtml(ag)}
      <div class="suggest card">${n('待派') ? `<div style="font-size:13px">待派列 <b>${n('待派')}</b> 单——依赖就绪且项管放行的会被自动派发</div>
        <div class="subnote" style="margin:6px 0 12px">未放行的在看板逐张放行（项管闸）；合闸时全部原地待命</div>
        <a class="btn accent h32" href="#/board">去看板</a>` : '<span class="dim">待派列空——想法拍板或派单委托产生新单</span>'}</div>
    </div><div>
      <div class="sec-h"><h3 class="h17">动态日志</h3>${projActive() ? '<span class="subnote">全局动态（journal 不分项目）</span>' : ''}</div>${logHtml}
      <div class="quota-card card r14"><b style="font-size:13px">额度双池</b>
        <div id="ov-quota">${qskel('codex')}${qskel('claude')}</div></div>
    </div></div>`;
}

/* ===== P2 工单池 ===== */
let gateCache = null;
function gatebarHtml(g) {
  const mini = (l) => { const p = l && l.fivePct != null ? l.fivePct : 0; const hot = l && l.locked;
    return `<span class="minibar"><i class="${hot ? 'hot' : ''}" style="width:${p}%"></i></span> <b class="mono" style="font-size:12px;${hot ? 'color:var(--danger)' : ''}">${l && l.fivePct != null ? l.fivePct + '%' : '··%'}</b>`; };
  const paused = !!(g && g.paused);
  const lockNote = g && (g.locks.codex.locked || g.locks.claude.locked)
    ? `<span class="err" style="font-size:11px;font-weight:500">●锁${esc((g.locks.codex.locked ? g.locks.codex : g.locks.claude).resetAt || '')} 解冻</span>` : '';
  return `<div class="gatebar2 card">
    <div class="gsec"><span class="glbl">派发闸</span><span class="gv"><span class="dot" style="${paused ? 'background:var(--danger)' : ''}"></span>
      <b style="font-size:13px">${g ? (paused ? '已合闸 · 不派新单' : '开闸派发中') : '查询中'}</b>
      <button class="btn h32" style="height:28px" onclick="togglePause(${!paused})" ${g ? '' : 'disabled'}>${paused ? '开' : '停'}</button></span></div>
    <div class="vdiv"></div>
    <div class="gsec"><span class="glbl">额度锁</span><span class="gv"><span class="mono" style="font-size:11px;color:var(--ink2)">codex</span> ${mini(g && g.locks.codex)}
      <span class="mono" style="font-size:11px;color:var(--ink2);margin-left:10px">claude</span> ${mini(g && g.locks.claude)} ${lockNote}</span></div>
    <div class="backlog" style="margin-left:24px"><span class="glbl">验收积压（完成候验）</span><br/><b id="backlogN">— / —</b></div></div>`; // 推荐在途已随拉取制退役（0.24.7 视图清仓）
}
// H81 常开单闸制：唯一总闸，一个停/开按钮
window.togglePause = async (v) => { await post('/api/gate/pause', { value: v }); gateCache = null; route(); };
// hub 闸位：状态胶囊 + 停/开按钮；合闸时顶部挂常驻红条（醒目，不埋角落）
function paintGate(paused, oauth) {
  const el = $('hub-gate');
  if (el) el.innerHTML = `<span class="pill sm ${paused ? 'red' : 'ok'}" style="font-weight:700">${paused ? '已合闸' : '开闸中'}</span>`
    + `<button class="btn h32" style="height:26px;margin-left:8px" onclick="togglePause(${!paused})">${paused ? '开' : '停'}</button>`;
  const b = $('gate-banner');
  // 施工令-055：OAuth 过期/未登录也是一道闸——claude 池（含判官三席）此刻拉一个死一个（401）。
  // 与合闸红条同一位置、可并存：两件事都成立时制作人要一眼看见两件事，不是二选一。
  const oa = oauth ? `<div class="gatealert" role="alert"><i class="dot err breathe-err"></i>
      <b>OAuth ${oauth.态 === '未登录' ? '未登录' : '已过期'} · claude 池会话一律 401</b>
      <span class="subnote">${esc(oauth.文案 || '')}——重登后自动恢复，无需改配置</span>
      <code class="mono" style="margin-left:auto;font-size:11.5px" title="复制到 cmd 跑">${esc(oauth.配方 || '')}</code></div>` : '';
  if (b) b.innerHTML = (paused ? `<div class="gatealert" role="alert"><i class="dot err breathe-err"></i>
      <b>全链路已合闸 · 放行单一律不派发</b>
      <span class="subnote">跑是常态、停是例外（H81）——不是有意停工就立刻开闸</span>
      <button class="btn h32 primary" style="margin-left:auto" onclick="togglePause(false)">开闸</button></div>` : '') + oa;
}
// D43 批量放行：当前项目语境的待派整批放行（项管闸 H109；fm.放行 标记，不再是目录跳变）
window.releaseAll = async () => {
  const { board } = await loadBoard();
  const items = board['待派'] || [];
  if (!items.length) return toast('待派列空');
  if (!await ask(`整批放行 ${items.length} 张待派单？放行后按依赖+优先级自动派发。`)) return;
  let ok = 0, fail = 0;
  for (const t of items) { const r = await post('/api/act/放行', { id: t.id }); r.ok ? ok++ : fail++; }
  toast(`已放行 ${ok} 张${fail ? ` · 失败 ${fail} 张（看 journal）` : ''}`);
  route();
};
// 看板 = **流转面**（谁在哪一态）。三大态改造（2026-08-24）：12 态按 大态 分三段呈现——
// 待办｜在途｜结束。「完成/归档」列照旧不进看板（2026-08-20 制作人裁定的落袋离场纪律：
// 「已完成堆了一百多单，真的找起来也很麻烦」——完成是在途大态的出口驻留位，只增不减，
// 铺卡就是堆积），结束段整段只给计数入口。分组表读 /api/board 下发的 大态，读不到回落本地兜底。
// 归属结构去工单页看（管线→特性→专项→工单），两页分工不重叠。
const BOARD_OUT = new Set(['完成', '归档']);
async function viewBoard() {
  const { states: 全态, board, raw, 大态 } = await loadBoard();
  const conf = await api('/api/config').catch(() => ({ 闸值: {} }));
  const widths = { 在途: 'w168', 核查: 'w128', 仲裁: 'w128' };
  const 列 = (s) => {
    const items = board[s] || [];
    const hot = s === '待处理' || s === '待重派';
    const head = s === '待审'
      ? `<h4>${s}<span class="cnt">${items.length}</span><a class="newdraft" href="#/draft">＋ 起草</a></h4>`
      : s === '待派' && items.length
        ? `<h4>${s}<button class="newdraft" title="整批放行（H109 项管闸：放行落 fm.放行 标记，依赖就绪即自动派发；闸就是这一下）" onclick="releaseAll()">⇧ 全放行 ${items.length}</button></h4>`
        : `<h4>${s}<span class="cnt">${items.length}</span></h4>`;
    const cards = items.map((t) => `<div class="bcard2${suspCls(t)}" data-tid="${esc(t.id)}" onclick="location.hash='#/t/${t.id}'"${suspOf(t) ? ` title="${esc(suspTip(t))}"` : ''}>
        <span class="cid">${snowB(t)}${esc(t.id)}</span>
        <span class="cpri ${t.优先级 === 'P0' ? 'p0' : ''}">${esc(t.优先级 || '')}</span>
        <div class="ct clamp2" title="${esc(t.title)}">${esc(t.title)}</div>${fnPill(t.职能)}</div>`).join('');
    return `<div class="bcol2 ${widths[s] || ''} ${hot ? 'hot' : ''}">${head}${cards}</div>`;
  };
  // 待办/在途 两段铺列（列序照 大态 分组表，完成 摘出）；结束段只给计数入口，不铺一张卡。
  const 段 = (g) => {
    const ss = (大态[g] || []).filter((s) => 全态.includes(s) && !BOARD_OUT.has(s));
    const n = ss.reduce((a, s) => a + (board[s] || []).length, 0);
    return `<div class="bgroup" data-bg="${esc(g)}"><div class="bghead"><b>${esc(g)}</b><span class="cnt">${n}</span></div>
      <div class="bgcols">${ss.map(列).join('')}</div></div>`;
  };
  const cols = ['待办', '在途'].map(段).join('');
  // 结束段计数入口（含被摘出的 完成）：落袋离场，这一页永不堆积；明细去报表/详情。
  const 终数 = (s) => (board[s] || []).length;
  const 隐藏钮 = (window._hiddenCnt || window._showHidden)
    ? `<button class="newdraft" title="隐藏归档：制作人湮灭的废案，默认不计入" onclick="window._showHidden=!window._showHidden;route()">${window._showHidden ? '藏起' : `显隐藏 ${window._hiddenCnt}`}</button>` : '';
  const endCols = `<div class="bgroup bend" data-bg="结束"><div class="bghead"><b>结束</b><span class="cnt">${(大态['结束'] || []).reduce((a, s) => a + 终数(s), 0)}</span></div>
      <div class="bendbody">
        <div class="berow"><span class="bek">完成</span><b class="mono">${终数('完成')}</b><span class="subnote">判官已过 · 候专项级验收（在途大态出口驻留位，不占执行槽）</span></div>
        ${(大态['结束'] || []).filter((s) => 全态.includes(s)).map((s) => `<div class="berow"><span class="bek">${esc(s)}</span><b class="mono">${终数(s)}</b><span class="subnote">${s === '归档' ? '落袋=归档' : s === '挂起' ? '原位冻结 · 解挂回待重派' : '留档不删（R2）'}</span></div>`).join('')}
        <div class="berow"><a href="#/report">明细去报表 →</a>${隐藏钮}</div>
      </div></div>`;
  const fillBar = async () => {
    const g = await api('/api/gates'); gateCache = g;
    const gb = $('gatebar-slot');
    if (gb) { const key = JSON.stringify([g.paused, g.locks.codex, g.locks.claude]); // 推荐 已随 D28 退役，服务端不再下发
      if (gb.dataset.k !== key) { gb.dataset.k = key; gb.innerHTML = gatebarHtml(g); } }
    // 分子分母同尺（2026-08-22 体检 #65）：闸按**全局**数（lib/recommend），这里不许拿项目过滤后的
    // board 去比它——TK 显 3/8 而实况 7/8，读数系统性低估离闸距离。
    // 不改成「都按项目」：config 没有 per-project 闸值，UI 项目化会与真正生效的闸彻底两套尺。
    // 三大态改造：积压态=完成（原 待验收 并入完成；判官已过、候验收的都停这儿）。闸值键沿用配置现名。
    const bn = $('backlogN'); if (bn) bn.textContent = `${raw.filter((t) => t.state === '完成').length} / ${conf.闸值?.待验收积压闸 ?? 8}`;
  };
  setTimeout(() => { fillBar().catch(() => { const gb = $('gatebar-slot'); if (gb && gateCache) gb.innerHTML = gatebarHtml(gateCache); }); }, 0);
  pollLoop('gatebar-slot', 5000, fillBar); // 额度/闸门读数活体刷新（变了才重画）
  // 粘性横向滑块：列超出视口时钉在窗口底边随时可拖，滚到底后自然贴住栏目底边。
  // 同步走 scroll 事件（真窗口里逐帧触发=同帧跟手）；相等性检查天然断回声环。
  // 另留 300ms 低频对账兜底（窗口隐藏时事件冻结的漂移校正）——教训：33ms 定时器
  // 当主通道是 30fps 卡顿的根源，定时器只配当备胎。
  setTimeout(() => {
    const b = $('board2'), hs = $('hsync'), w = $('hsync-w');
    if (!b || !hs || !w) return;
    w.style.width = b.scrollWidth + 'px';
    hs.style.display = b.scrollWidth > b.clientWidth ? '' : 'none';
    // 施工令-048：原地重绘不换节点，接线只能挂一次——否则每 3s 多两条 scroll 监听，
    // 挂几百条之后横向拖动会明显发涩。记号写在节点属性上（morph 只管 HTML 属性，碰不到它）。
    if (b.__hsLinked) return;
    b.__hsLinked = hs.__hsLinked = true;
    const token = (window.__hsT = (window.__hsT || 0) + 1);
    const link = (src, dst) => src.addEventListener('scroll', () => {
      if (dst.scrollLeft !== src.scrollLeft) dst.scrollLeft = src.scrollLeft;
    }, { passive: true });
    link(hs, b); link(b, hs);
    const iv = setInterval(() => {
      if (window.__hsT !== token || !document.body.contains(b)) return clearInterval(iv);
      if (hs.scrollLeft !== b.scrollLeft) b.scrollLeft = hs.scrollLeft;
    }, 300);
  }, 0);
  // 落袋去向条：完成/归档不铺卡后，单一收工就从卡面消失——不写清去哪找，就是把人晾在原地。
  return `<div id="gatebar-slot">${gatebarHtml(gateCache)}</div><div class="board2" id="board2">${cols}${endCols}</div>
    <div class="hsync" id="hsync"><div id="hsync-w" style="height:1px"></div></div>
    <div class="bdone subnote">看板只留活态——完成即出列、归档即落袋，这一页永不堆积。
      完成 ${(board['完成'] || []).length} · 归档 ${(board['归档'] || []).length} 去 <a href="#/report">报表</a> 查明细与消耗；
      要看归属结构（管线→特性→专项）去 <a href="#/tickets">工单</a>。</div>`;
}

/* ===== P12 流程页 · 已摘牌（2026-08-20 制作人页签定案 11→8）=====
   页签撤了，**函数体原样留着且不挂路由**（ROUTES 里已无 flow 键，#/flow 转向 #/relay）。
   为什么留而不删——与同日一并退役的 viewQueue 待遇不同，理由是「内容有没有接班人」：
     · 计划粒那一半（planBar / 维护队列）已被项管页接走：甘特图 + 待办队列是它的升级版，
       留着就是同一份账两处画，那正是本仓最忌的两把尺；
     · **管线现在线那一半（沉淀｜现在｜接下来 三段横切）没有接班人**——项管页是未来面，
       答的是「后面排了什么」；「每条管线此刻在做什么」这个问题今天没有第二张脸回答它
       （看板答的是「谁在哪一态」，在途答的是「哪几个会话在跑」，都不按管线横切）。
       删掉等于把一份还没有替代品的能力连同 300 行调好的判据一起扔了，要回来得重写。
   所以按「摘牌封存」处置：不挂路由、不占页签、代码不动，等制作人决定它是复挂到别处还是真删
   （见交付 pending）。同族先例：viewSpecials 今日随四层架构改版摘牌，函数体同样留着。
   下述注释是它当年的设计说明，原样保留以备复挂时对照。
   ---- 原 P12 流程（施工令-022 重构）：现在线 · 管线甘特 ----
   魂：一条「现在线」把每条管线横切成 沉淀｜现在｜接下来 三段——制作人 3 秒回答
   「在做什么、接下来什么、卡在哪」。行=管线（/api/pipelines 注册）+「散单」特殊行（无管线归属的活动单）。
   D43 的阶段横轴 / 泳道甘特 / 关键路径 / 显示历史机制整体退役；施工令-006 的签字位常驻语义并入本结构。
   进度口径不另立一套：吃服务端随 /api/agents 下发的 进度 字段（lib/progress.js 算好，与 /api/runner 同源），
   15s 活体刷新复用在途页那条 pollLoop。挂起（施工令-021）不进现在/接下来两段，直接落沉淀抽屉的 ❄ 类。 */
const FG_DOING = new Set(['在途', '初检', '核查', '仲裁']); // 现在区：实心条 + 实时百分比（审检链目录化后判官态也是「现在」）
const FG_STUCK = new Set(['待处理']);             // 现在区：卡住的也算「现在」（三问之一就是「卡在哪」）
const FG_QUEUE = new Set(['待派', '待重派', '待审']); // 接下来区：按依赖拓扑排
const FG_DONE = new Set(['完成', '归档']);        // 依赖口径：完成=做完等关账（专项内部口径），归档=落袋
const FG_SIGN = new Set(['完成', '待处理']);      // 等制作人落笔（006 签字位；完成=候专项级验收）
// 沉淀四分类（制作人追加重点）：完成 / ❄挂起 / 废弃 / 推翻——计数分开列，点哪类只展哪类
const FG_CATS = [['done', '完成'], ['susp', '❄挂起'], ['drop', '废弃'], ['over', '推翻']];
// 分类判据：挂起优先（原位冻结，目录态化后 state=挂起 也算）；归档按 归档原因 分流；
// 废弃 目录态直接归「废弃」类。归档原因缺失的老单归「废弃」——归档且没有成功记录，按丢弃计比冒充完成诚实。
const fgCat = (t) => {
  if (suspOf(t)) return 'susp';
  if (t.state === '完成') return 'done';
  if (t.state === '废弃') return 'drop';
  if (t.state !== '归档') return null;
  const why = String(t.归档原因 || '');
  if (why.includes('推翻') || why.includes('返工')) return 'over';
  if (why.includes('废弃')) return 'drop'; // 历史「归档原因:废弃」留在归档不重分类（不改史）
  return 'done'; // 归档=落袋：正常走完链条的归档单是成品
};
let fgOpen = {}; // 沉淀抽屉展开态：laneKey -> 类别 key。空 = 全折——**默认全折叠，页面上只活人说话**
async function viewFlow() {
  const [{ all }, pls, agRaw, sched] = await Promise.all([
    loadBoard(),
    api('/api/pipelines').catch(() => ({ 管线: [] })),
    api('/api/agents').catch(() => ({ 在跑: [] })),
    // 计划粒（施工令-041 §一）：还没成单的活。取不到就当没有——排程台账是新实体，
    // 老部署/桩台环境下这个接口可能压根不在，整页不能因为它 404 就白屏。
    api('/api/schedule/流程').catch(() => ({ 管线行: {}, 维护队列: [] })),
  ]);
  const 计划行 = (sched && sched.管线行) || {};
  const 维护队列 = (sched && sched.维护队列) || [];
  const ag = agentsScoped(agRaw, all); // 与在途页同一道项目闸，百分比才对得上号
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  const pById = Object.fromEntries((pls.管线 || []).map((p) => [p.id, p]));
  const hasKids = new Set(all.filter((t) => t.父单 && byId[t.父单]).map((t) => t.父单));
  // 组织容器（专项/战役父单）不占普通条位——只在它自己等签字时以里程碑旗出场
  const isBox = (t) => hasKids.has(t.id) || ['战役', '专项'].includes(t.父单类型) || ['战役', '专项'].includes(t.主办);
  const depsOf = (t) => (t.依赖 ? (Array.isArray(t.依赖) ? t.依赖.map(String) : String(t.依赖).split(/[，,、\s]+/)) : []).filter((d) => byId[d]);
  // H51 管线章：显式字段优先，否则沿父链上溯（子单继承专项父单的线）
  const pipeOf = (t) => { let c = t, g = 0; while (c && g++ < 10) { if (c.管线 && pById[c.管线]) return c.管线; c = c.父单 ? byId[c.父单] : null; } return null; };
  const 进度By = Object.fromEntries((ag.在跑 || []).map((r) => [r.id, r]));

  // ---- 依赖深度（拓扑序）：先占位再回填，天然断环，不会因为一条环边把整页算死 ----
  const 深 = {};
  const deep = (id, g) => {
    if (深[id] != null) return 深[id];
    深[id] = 0;
    const t = byId[id];
    if (!t || g > 30) return 0;
    const ds = depsOf(t);
    深[id] = ds.length ? Math.max(0, ...ds.map((d) => deep(d, g + 1) + 1)) : 0;
    return 深[id];
  };
  all.forEach((t) => deep(t.id, 0));
  // 死结：依赖挂在一张被冻结/废弃的单上——这就是「卡在哪」的答案，红字直说
  const 死结 = (t) => depsOf(t).filter((d) => suspOf(byId[d]) || byId[d].state === '废弃');

  // ---- 分行：注册管线 + 散单特殊行 ----
  const MISC = '_misc';
  const lanes = {};
  const lane = (k) => (lanes[k] = lanes[k] || { key: k, items: [] });
  for (const t of all) lane(pipeOf(t) || MISC).items.push(t);
  for (const p of (pls.管线 || [])) if (p.状态 !== '封存') lane(p.id); // 注册即有行：新开的线空着也要占位（不然看不见"该派活了"）
  // 只有计划粒、还没有任何工单的管线也要占一行（施工令-041 §一，本令渲染冒烟实测抓到）：
  // 行由「有单」或「已注册」生成的话，一条刚排上计划、单还没起的线整条隐身——
  // 而那恰恰是最需要被看见的状态：接下来要干的活，一张单都还没开。
  for (const k of Object.keys(计划行)) lane(k);
  const laneKeys = Object.keys(lanes).sort((a, b) => {
    if ((a === MISC) !== (b === MISC)) return a === MISC ? 1 : -1; // 散单垫底
    const na = Number(String(a).slice(2)), nb = Number(String(b).slice(2));
    return (Number.isNaN(na) || Number.isNaN(nb)) ? String(a).localeCompare(String(b)) : na - nb;
  });
  if (!laneKeys.length) {
    return `<div class="emptycard" style="margin-top:30px"><h5>还没有管线，也没有工单</h5>
      <p>先在 <a href="#/params" style="color:var(--accent-ink)">⚙ 参数</a> 开一条管线（H51 人闸），或直接 <a href="#/draft" style="color:var(--accent-ink)">起草工单</a>——
      有单之后这里按「沉淀｜现在｜接下来」三段铺出每条管线的现在线。</p></div>`;
  }

  // ---- 分段判据（施工令-038）：现在区认**现场**，不认目录状态 ----
  // 案源：TK-117 挂着核查会话（在途页 82% · 核查中·深检），流程页却按目录态把它塞进
  // 「接下来·等你签字」绿框。三大态改造后审检链目录化（初检/核查/仲裁），FG_DOING 已收全；
  // 凡 /api/agents 报了活跃会话（执行/初检/核查/仲裁 任一 kind），这单就是**现在正在被处理**，
  // 一律入现在区，阶段标签走既有进度口径（含 kind，如「核查中 · 深检」）。
  const liveOf = (t) => { const r = 进度By[t.id]; return (r && r.有会话) ? r : null; };
  // 真停人闸的三种（绿框唯一出场条件，且必须**无任何活跃会话**）：
  //   待处理 = 等你分诊；完成·保留 = 你亲验；完成·候引擎实证 = H97 门禁停闸（等实证或你直收）。
  const 人闸 = (t) => t.state === '待处理'
    || (t.state === '完成' && (t.验收方式 === '保留' || !!t.待引擎实证));

  // ---- 单条渲染：五型（doing 实心带百分比 / sign 绿框 / stuck 红 / queue 虚框 / wait 待判官接手）----
  const go = (id) => `location.hash='#/t/${encodeURIComponent(id)}'`;
  const idShort = (dep, self) => {
    const a = String(dep).match(/^(.+)-(\d+)$/), b = String(self).match(/^(.+)-(\d+)$/);
    return (a && b && a[1] === b[1]) ? a[2] : dep;
  };
  // 首屏与 15s 轮询必须同一个口径函数，否则会出现「刚进页面写 质检中，15 秒后自己改口 无执行会话」
  // 这种同一事实两种说法的抖动（2026-08-08 实机抓到：首屏 阶段名 优先级压过了无会话判据）。
  const 活体 = (r, fallbackState) => ({
    百分比: (r && r.进度 && r.进度.百分比 != null) ? r.进度.百分比 : (STPCT[fallbackState] ?? null),
    // 出处随行（施工令-041 §四）：与在途页同一句话——两页的这个数同源，连解释都不许各写各的
    提示: (r && r.进度) ? pctTitle(r.进度) : `按状态锚点估算（${fallbackState || '—'}，无执行会话数据）`,
    // 无会话优先：单还挂在在途/质检但没有执行会话 = 卡住，这时报阶段名等于替它掩护
    阶段名: (r && r.有会话 === false) ? '无执行会话' : ((r && r.进度 && r.进度.阶段名) || fallbackState),
    无会话: !!(r && r.有会话 === false),
  });
  const pctOfLive = (t) => 活体(进度By[t.id], t.state);
  const bar = (t, cls, right, extra) => `<div class="fgbar ${cls}" onclick="${go(t.id)}" tabindex="0" role="button"
      onkeydown="if(event.key==='Enter'){${go(t.id)}}" title="${esc(t.id + ' · ' + (t.title || '') + (t.职能 ? ' · ' + t.职能 : ''))}">
      <span class="id">${esc(t.id)}</span><span class="t">${esc(t.title || '')}</span>${extra || ''}${right}</div>`;
  const doingBar = (t) => {
    const p = pctOfLive(t);
    return bar(t, 'doing' + (p.无会话 ? ' nosess' : ''),
      `<span class="pp" id="fgp-${esc(t.id)}" title="${esc(p.提示)}">${p.百分比 == null ? '—' : p.百分比}<small>%</small></span><span class="st" id="fgs-${esc(t.id)}">${esc(p.阶段名)}</span>`);
  };
  const signBar = (t) => {
    const 保留 = t.验收方式 === '保留';
    const 里程碑 = isBox(t); // 专项/战役终审 = 里程碑旗
    const 词 = t.state === '待处理' ? '待你分诊' : (t.待引擎实证 ? '候引擎实证' : (保留 ? '你（保留）' : '你'));
    return bar(t, 'sign', `<span class="st">✍ ${esc(词)}</span>${里程碑 ? '<span class="mile">⚑ 里程碑</span>' : ''}`);
  };
  // 委托单停在审检链、判官会话还没起：如实说「待判官接手」——不冒充等你签字，也不假装在做。
  // 用闸门色的 .st（与 doing.nosess 同源语义：会话没起来），虚框表明它在排队等判官。
  const waitBar = (t) => bar(t, 'queue wait', '<span class="st">待判官接手</span>');
  const stuckBar = (t) => bar(t, 'stuck', `<span class="st">${esc(t.state)}${t.自修次数 ? ' ×' + t.自修次数 : ''}</span>`);
  const queueBar = (t) => {
    const ds = depsOf(t);
    const 断 = 死结(t);
    const 就绪 = !断.length && ds.every((d) => FG_DONE.has(byId[d].state)) && t.state !== '待审';
    const depTag = ds.length ? `<span class="deps" title="${esc('依赖：' + ds.join('、'))}">←${ds.map((d) => esc(idShort(d, t.id))).join('·')}</span>` : '';
    const st = 断.length ? `依赖冻结 ←${esc(idShort(断[0], t.id))}` : (就绪 ? '就绪' : t.state);
    const cls = 'queue' + (断.length ? ' blocked' : (就绪 ? ' ready' : ''));
    return bar(t, cls, `<span class="st">${esc(st)}</span>`, depTag);
  };
  // 计划粒条（施工令-041 §一）：第六型。虚框与排队条同族（都是"还没开始"），但更淡且不带单号——
  // 它还没有工单，点它跳详情会 404。点/悬浮给的是制作人真正会问的两件事：这条哪来的、要多久。
  const 计划点击 = (c) => `planTip('${qesc(c.粒ID || '')}')`; // 全局 window.planTip，见本视图末
  const planBar = (c) => `<div class="fgbar queue plan" onclick="${计划点击(c)}" tabindex="0" role="button"
      onkeydown="if(event.key==='Enter'){${计划点击(c)}}" title="${esc(c.提示)}"
      aria-label="计划粒 ${esc(c.题)}（尚未成单）">
      <span class="id">${esc(上级名(c.上级))}${c.序 ? '·' + c.序 : ''}</span><span class="t">${esc(c.题)}</span>
      <span class="plb">${esc(c.徽章)}</span>
      <span class="st">${c.预估单元 != null ? esc(c.预估单元 + ' 单元') : '无预估'}</span></div>`;
  window._fgPlan = {};
  for (const c of [...Object.values(计划行).flat(), ...维护队列]) window._fgPlan[c.粒ID] = c;

  // ---- 逐行装配 ----
  const sed = {}; // 沉淀数据（抽屉懒渲染用），只带展示要的几个字段
  let 总在做 = 0, 总签字 = 0, 总接下来 = 0, 总计划 = 0, 闲置数 = 0;
  const laneHtml = laneKeys.map((k) => {
    const L = lanes[k];
    const P = pById[k];
    const 名称 = k === MISC ? '散单' : `${k} ${(P && P.名称) || ''}`.trim();
    const 活 = L.items.filter((t) => !suspOf(t) && !FG_DONE.has(t.state));
    const 可见 = (t) => !isBox(t) || FG_SIGN.has(t.state);
    // 现在区：有活跃会话（任一 kind）一律入；目录态在做/卡住的照旧入（会话没起也要看得见「卡在哪」）
    const now = 活.filter((t) => 可见(t) && (liveOf(t) || FG_DOING.has(t.state) || FG_STUCK.has(t.state)));
    // 接下来·签字位：会话在跑的已被现在区收走，这里只剩没会话的完成（候专项级验收，排序口径不动）
    const nextSign = L.items.filter((t) => !suspOf(t) && 可见(t) && !liveOf(t) && t.state === '完成')
      .sort((a, b) => (b.验收方式 === '保留') - (a.验收方式 === '保留') || String(a.id).localeCompare(String(b.id)));
    const nextQ = 活.filter((t) => 可见(t) && FG_QUEUE.has(t.state))
      .sort((a, b) => (深[a.id] - 深[b.id]) || String(a.id).localeCompare(String(b.id)));
    总在做 += now.filter((t) => liveOf(t) || FG_DOING.has(t.state)).length;
    // 「等你签字」只数真停人闸的（完成·保留/候引擎实证 + 无会话的待处理）
    总签字 += nextSign.filter(人闸).length + now.filter((t) => !liveOf(t) && t.state === '待处理').length;
    总接下来 += nextQ.length;
    // 本管线的计划粒（施工令-041 §一）：续在已建单队列之后，同一条「接下来」里排到底
    const plans = 计划行[k] || [];
    总计划 += plans.length;
    // 沉淀四类
    const cats = { done: [], susp: [], drop: [], over: [] };
    for (const t of L.items) { const c = fgCat(t); if (c) cats[c].push(t); }
    for (const c in cats) cats[c].sort((a, b) => String(b.更新时间 || '').localeCompare(String(a.更新时间 || '')));
    sed[k] = {}; for (const c in cats) sed[k][c] = cats[c].map((t) => ({ id: t.id, title: t.title, state: t.state, why: String(t.归档原因 || ''), susp: suspTip(t) }));
    const 沉淀数 = Object.values(cats).reduce((a, x) => a + x.length, 0);
    // 管线头：落袋读数（容器单不计——它是组织单位，不是活）
    const 叶 = L.items.filter((t) => !isBox(t));
    const 落袋 = 叶.filter((t) => FG_DONE.has(t.state)).length; // 完成=做完等关账（专项内部口径）+ 归档=落袋
    const 专项数 = L.items.filter((t) => isBox(t)).length;
    // 闲置直书：现在区空 → 取本管线最近一次事件时间差
    const 最近 = L.items.reduce((m, t) => {
      const cs = [t.更新时间, t.交付时间, t.领单时间].map((x) => Date.parse(x || '')).filter((x) => !Number.isNaN(x));
      return cs.length ? Math.max(m, ...cs) : m;
    }, 0);
    const 闲置天 = 最近 ? Math.floor((Date.now() - 最近) / 86400000) : null;
    if (!now.length) 闲置数++;
    const foldInner = 沉淀数
      ? `<div class="fgfold"><span class="fgfk">▸ 沉淀</span>${FG_CATS.filter(([c]) => cats[c].length)
        .map(([c, n]) => `<button class="fgcat ${c}" data-fglane="${esc(k)}" data-fgcat="${c}" onclick="fgDrawer('${qesc(k)}','${c}')" title="点开只看这一类">${esc(n)} <b>${cats[c].length}</b></button>`)
        .join('<i class="fgdot">·</i>')}</div>`
      : '';
    const 头 = `<div class="fghead">
          <b>${esc(名称)}</b>${P && P.状态 === '封存' ? '<span class="lst lag">已封存</span>' : ''}
          <div class="sub">${k === MISC ? '无管线归属的活动单' : `${专项数 ? 专项数 + ' 个专项 · ' : ''}阶段 ${esc((P && P.阶段) || '—')}`}</div>
          <div class="pct">■ 落袋 ${落袋}/${叶.length}</div>
        </div>`;
    // 空态收敛（施工令-041 §一 · 巡礼 F6）：整条管线既无在做也无排队也无计划时，
    // 旧样两格各说一句「现在无在做」「接下来没有排队的单」——同一件事在同一行说两遍，
    // 十几条闲置管线铺下来就是二十几行废话。收成横跨两格的一行。
    const 空行 = !now.length && !nextSign.length && !nextQ.length && !plans.length;
    if (空行) {
      return `<div class="fglane">
      <div class="fgrow">${头}
        <div class="fgzone empty">${`<div class="fgidle">— 本管线无在做 · 无排队 · 无计划（${最近 ? `闲置 ${闲置天} 天` : '暂无活动记录'}）—</div>`}${foldInner}</div>
      </div>
      <div class="fgdrawer" id="fgd-${esc(k)}"></div></div>`;
    }
    const nowInner = now.length
      ? now.map((t) => ((liveOf(t) || FG_DOING.has(t.state)) ? doingBar(t) : t.state === '待处理' ? signBar(t) : stuckBar(t))).join('')
      : `<div class="fgidle">— 本管线现在无在做（${最近 ? `闲置 ${闲置天} 天` : '暂无活动记录'}）—</div>`;
    const nextInner = (nextSign.map((t) => (人闸(t) ? signBar(t) : waitBar(t))).join('') + nextQ.map(queueBar).join('')
      + plans.map(planBar).join(''))
      || '<div class="fgidle q">— 接下来没有排队的单 —</div>';
    return `<div class="fglane">
      <div class="fgrow">${头}
        <div class="fgzone now">${nowInner}${foldInner}</div>
        <div class="fgzone next">${nextInner}</div>
      </div>
      <div class="fgdrawer" id="fgd-${esc(k)}"></div></div>`;
  }).join('');
  window._fgSed = sed;
  fgOpen = {}; // 每次进视图回到全折（制作人追加：默认全折叠）

  // ---- 15s 活体：只换百分比与阶段名，不整页重画；在跑名册变了才 route（同在途页口径）----
  // 签名带上「有没有会话」（施工令-038）：分段判据改吃现场后，起/收一条判官会话就要换段——
  // 光比 id:state 看不出来（核查会话起落时单一直停在 待验收，状态一个字没变，条却该从绿框迁进现在区）。
  // 参照 022 的 nosess 同步先例：首屏与轮询同一口径，谁都不许自己改口。
  const sig = (d) => (d.在跑 || []).map((r) => r.id + ':' + r.state + ':' + (r.有会话 ? 1 : 0)).sort().join(',');
  const sig0 = sig(ag);
  pollLoop('fg-board', 15000, async () => {
    const nd = agentsScoped(await api('/api/agents'), all);
    if (sig(nd) !== sig0) { repaint('在跑名册变'); return; } // 派发/收工 = 条位要换，原地重排本视图（施工令-048：不再整页）
    for (const r of (nd.在跑 || [])) {
      const v = 活体(r, r.state);
      const pe = $('fgp-' + r.id); if (pe) { pe.innerHTML = `${v.百分比 == null ? '—' : v.百分比}<small>%</small>`; pe.title = v.提示; }
      const se = $('fgs-' + r.id); if (se) se.textContent = v.阶段名;
      // 会话起来了就把「卡住」形态撤掉（同在途页 noagent 的处理）——只改类，不重画条
      const be = pe && pe.closest('.fgbar'); if (be) be.classList.toggle('nosess', v.无会话);
    }
  });

  // 监制台维护队列（施工令-041 §一）：批字段无管线的 Q 队列粒——监制台自己的活。
  // 不塞进任何一条产品管线（那会让那条线的「接下来」凭空多出不属于它的活），但也不能不显示：
  // 制作人要的「看得到后续队列工作」本来就包含这一类。空则整行不出。
  const 维护Html = 维护队列.length ? `<div class="fglane qlane">
      <div class="fgrow">
        <div class="fghead">
          <b>监制台维护队列</b>
          <div class="sub">无管线归属的计划粒（Q 队列）</div>
          <div class="pct">◇ 计划 ${维护队列.length}</div>
        </div>
        <div class="fgzone now"><div class="fgidle">— 未成单，不占执行位 —</div></div>
        <div class="fgzone next">${维护队列.map(planBar).join('')}</div>
      </div></div>` : '';

  const top = `<div class="fgtop">
      <span class="subnote">一条现在线切三段：沉淀（折叠）｜<b class="nowh">现在</b>｜接下来（依赖序 → 计划粒）· 行=管线 · 点任何条进详情</span>
      <span class="sp"></span>
      <span class="fgsum">在做 <b>${总在做}</b> · 等你签字 <b class="s">${总签字}</b> · 排队 <b>${总接下来}</b> · 计划 <b>${总计划 + 维护队列.length}</b>${闲置数 ? ` · 闲置管线 <b>${闲置数}</b>` : ''}</span></div>`;
  const legend = `<div class="fglegend">
      <span><i class="lg-doing"></i>实心=在做（有活跃会话即在做，含判官环节；百分比接执行进度卡口径）</span>
      <span><i class="lg-queue"></i>虚框=排队（依赖序，←标依赖）· 待判官接手=判官会话还没起</span>
      <span><i class="lg-sign"></i>绿框=等你签字/拍板（无会话且真停人闸）</span>
      <span><i class="lg-stuck"></i>红=卡住（待处理）</span>
      <span><i class="lg-plan"></i>淡虚框+「计划」=排程台账里还没成单的计划粒（点看来源与预估）</span>
      <span class="nowh">◉ 橙区=现在（管线闲置直书「闲置 N 天」）</span>
      <span>⚑=里程碑 · ❄=挂起 · 沉淀默认全折</span></div>`;
  return top + `<div class="fgboard" id="fg-board">
      <div class="fgcols"><div>管线</div><div class="nowh">◉ 现在在做</div><div>→ 接下来（依赖序 → 计划）</div></div>
      ${laneHtml}${维护Html}</div>` + legend;
}
// 计划粒点开：它还没有工单，跳详情只会 404——如实把「来源与预估」摊在面上（悬浮同文，见 title）。
window.planTip = (id) => {
  const c = (window._fgPlan || {})[id];
  if (!c) return toast('这条计划粒已不在现态（可能刚成单或被撤销）');
  toast(c.提示.replace(/\n/g, ' · '));
};
// 沉淀抽屉：点某一类只展开该类（置灰列表，点条进详情）；再点同一类收起。
// 不走 route() 重画——整页重取四个接口只为展一个抽屉太贵，且会把 15s 活体轮询打断重挂。
window.fgDrawer = (key, cat) => {
  const box = $('fgd-' + key); if (!box) return;
  const cur = fgOpen[key] === cat ? null : cat;
  fgOpen[key] = cur;
  document.querySelectorAll(`.fgcat[data-fglane="${CSS.escape(key)}"]`).forEach((el) => el.classList.toggle('on', el.dataset.fgcat === cur));
  if (!cur) { box.innerHTML = ''; box.className = 'fgdrawer'; return; }
  const list = ((window._fgSed || {})[key] || {})[cur] || [];
  const 名 = (FG_CATS.find(([c]) => c === cur) || [, cur])[1];
  const rows = list.slice(0, 60).map((t) => `<a class="fgsi ${cur}" href="#/t/${encodeURIComponent(t.id)}" title="${esc(t.susp || (t.why ? '归档原因：' + t.why : t.state))}">
      <span class="id">${cur === 'susp' ? '❄' : ''}${esc(t.id)}</span><span class="t">${esc(t.title || '')}</span>
      <span class="why">${esc(cur === 'susp' ? '挂起 · 原位冻结' : (t.why || t.state))}</span></a>`).join('')
    + (list.length > 60 ? `<span class="dim" style="font-size:11px;padding:4px 10px">…还有 ${list.length - 60} 单</span>` : '');
  box.className = 'fgdrawer open ' + cur;
  box.innerHTML = `<div class="fgdh">${esc(名)} · ${list.length} 单${cur === 'susp' ? '（挂起=原位冻结，全链路跳过；解挂在工单详情页）' : ''}</div><div class="fgdl">${rows}</div>`;
};

/* ===== 批分组折叠（原 P12b 队列页 · 施工令-042 §一 → 2026-08-20 并入项管页「待办队列」）=====
   案由：制作人 2026-08-11 02:38「我现在完全看不到后续的队列里排了什么东西」。按 批→序 铺全量五态，
   已完成的那几件也要在场，否则「还剩几件」这句话没有分母。判据全在服务端
   lib/pm/schedule-view.队列页（纯函数、可单测），前端只画。
   2026-08-20 页签定案 11→8：本页整体并入项管页，**viewQueue / qRow 已删**——
   项管页的 tqRow 是它的超集（同一份服务端判据 + 就绪打勾 + 重排），留着旧版就是同一份账两处画，
   而两份画法迟早对不上（这正是本仓「两把尺」病的成因）。折叠机件（qOpen/qFold）与 .qbatch 一族 CSS
   仍在服役：项管页的批分组原样复用它们，视觉与交互一次定死，不再各画各的。 */
let qOpen = {}; // 批名 → 用户是否手动展开/折叠（3s 脉冲重画会重进视图函数，不记住的话折叠状态每 3 秒被打回原形）
const QCLS = { 计划: 'plan', 起草中: 'draft', 已成单: 'made', 完成: 'done', 撤销: 'drop' };
// 批折叠：只切类不重画——重画要重取两个接口，还会把用户滚动位置打回顶部。
window.qFold = (批) => {
  const heads = [...document.querySelectorAll('.qbatch')];
  const box = heads.find((el) => (el.querySelector('.qbh b') || {}).textContent === 批);
  if (!box) return;
  const 折 = !box.classList.contains('fold');
  box.classList.toggle('fold', 折);
  const h = box.querySelector('.qbh'); if (h) h.setAttribute('aria-expanded', String(!折));
  qOpen[批] = !折; // 记住用户的选择，扛住 3s 脉冲重画
};

/* ===== P10 树形 · 已退役（施工令-028，制作人 2026-08-09 03:00 裁决）=====
   层级只有两层，树状铺陈形式大于信息。两项不可替代能力已迁走，整族（viewTree / tState /
   saveCollapsed / tToggle / tExpandAll / tAcceptAll / 专属 CSS / 折叠存储键）随之删除：
     · 批量验收子单 → 父单详情页 ops 区「✓ 批量验收子单」（window.acceptKids）
     · 子单层级一览 → 父单详情页子单表格（进度口径由 lib/trace 服务端算，与本页原口径同尺）
   旧书签 #/tree 在 route() 里转向（2026-08-20 起落 #/relay：流程页同日摘牌），不留死链。 */
// 折叠存储键随视图一起退场：不清的话每台已用过树形的机器，localStorage 里会永远躺着一份
// 没有任何代码会读的 studio.tree.collapsed。开机清一次即可，幂等。
try { localStorage.removeItem('studio.tree.collapsed'); } catch { /* 隐私模式拿不到就算了 */ }

/* ===== P3 在途 · 时间轴（甘特并入：回放真实执行，无计划日期）===== */
function timelineHtml(agents, all, opts) {
  const now = Date.now(); const HOURS = 48; const t0 = now - HOURS * 3600000; const pxh = 26; const W = HOURS * pxh;
  const byFn = !!(opts && opts.byFn); // 派发制：按职能分泳道——一次性主办不占行，行数恒定
  const online = byFn ? [] : agents.filter((a) => a.上线 !== false).map((a) => a.id);
  const withSegs = all.filter((t) => t.主办 && t.领单时间);
  const laneOf = (t) => byFn ? (t.职能 || '其他') : t.主办;
  // 泳道 = 数据里真实出现的职能（施工令-027）：FN_ORDER 只当"排序偏好"，不当"白名单"——
  // 写死六项的年代，新增职能（技术策划）的在途单泳道会被 filter 直接滤掉，人在时间轴上凭空消失。
  const FN_ORDER = ['策划', '技术策划', '程序', '美术', '装配', 'QA', '其他'];
  const 出现的职能 = [...new Set(withSegs.map((t) => t.职能 || '其他'))];
  const ids = byFn
    ? [...FN_ORDER.filter((fn) => 出现的职能.includes(fn)), ...出现的职能.filter((fn) => !FN_ORDER.includes(fn)).sort()]
    : [...new Set([...online, ...withSegs.map((t) => t.主办)])];
  const segs = {}; let any = false;
  for (const t of withSegs) {
    const s = Date.parse(t.领单时间); if (Number.isNaN(s)) continue;
    const inflight = ['在途', '初检', '核查', '仲裁', '待处理'].includes(t.state);
    const e = t.交付时间 ? Date.parse(t.交付时间) : (inflight ? now : null);
    if (e == null || e < t0) continue;
    any = true;
    const lane = laneOf(t);
    (segs[lane] = segs[lane] || []).push({ s: Math.max(s, t0), e: Math.min(e, now), t, inflight });
  }
  const head = `<b style="font-size:13px">执行时间轴</b><span class="subnote" style="margin-left:12px">最近 48 小时 · 右缘=现在 · 段=领单→交付</span>`;
  if (!any) return `<div class="tlcard card r14">${head}
    <div class="emptycard" style="margin-top:14px"><h5>还没有执行记录</h5>
    <p>agent 领单执行后，这里按人回放每一段真实执行（领单 → 交付），瓶颈自己浮出来。</p></div></div>`;
  let ticks = '';
  for (let h = 0; h <= HOURS; h += 6) { const x = W - h * pxh; const d = new Date(now - h * 3600000);
    ticks += `<span class="tltick" style="left:${x}px">${String(d.getHours()).padStart(2, '0')}:00</span>`; }
  let si = 0; // 段序号：入场按序生长（左→右错峰 40ms，封顶 12 档）
  const laneLevels = {}; // 职能泳道内并行段堆叠：贪心装层，防重叠
  if (byFn) {
    for (const id of ids) {
      const arr = (segs[id] || []).sort((a, b) => a.s - b.s);
      const levelEnds = [];
      for (const g of arr) {
        let lv = levelEnds.findIndex((end) => end <= g.s);
        if (lv < 0) { lv = levelEnds.length; levelEnds.push(0); }
        levelEnds[lv] = g.e + 60000; g.lv = lv;
      }
      laneLevels[id] = Math.max(1, levelEnds.length);
    }
  }
  const rowH = (id) => byFn ? (laneLevels[id] || 1) * 30 : 30; // 整行占位（含 8px 外边距）
  const laneH = (id) => rowH(id) - 8;
  const lanes = ids.map((id) => `<div class="tllane" style="height:${laneH(id)}px">${(segs[id] || []).map((g) => {
    const x = (g.s - t0) / 3600000 * pxh; const w = Math.max(6, (g.e - g.s) / 3600000 * pxh);
    const c = FNHEX[g.t.职能] || 'var(--ink3)';
    const label = byFn && w >= 44 ? `<i class="tlseglb">${esc(g.t.id.replace(/^TK-/, ''))}</i>` : '';
    // 在途 ❄（施工令-021）：冻结段既不是「进行中」也不是「已交付」，标题里如实说第三种
    return `<span class="tlseg ${g.inflight ? 'on' : ''}${suspCls(g.t)}" style="--i:${si++};left:${x}px;width:${w}px;background:${c}${byFn ? `;top:${3 + (g.lv || 0) * 30}px` : ''}" title="${esc(g.t.id)} ${esc(g.t.title)}（${suspOf(g.t) ? '已挂起' : g.inflight ? '进行中' : '已交付'}）${suspOf(g.t) ? '\n' + esc(suspTip(g.t)) : ''}" onclick="location.hash='#/t/${esc(g.t.id)}'">${suspOf(g.t) ? '<i class="tlseglb snowb">❄</i>' : label}</span>`;
  }).join('')}</div>`).join('');
  const colH = ids.reduce((a, id) => a + rowH(id), 0);
  // 首次落地时钉到最右（最新时间在右端）；此后原地重绘不再抢方向盘——
  // 施工令-048：不加这道记号的话，制作人往左看历史，每 3s 就被脉冲弹回最右。
  setTimeout(() => { const el = $('tlscroll'); if (el && !el.__tlHomed) { el.__tlHomed = true; el.scrollLeft = el.scrollWidth; } }, 0);
  return `<div class="tlcard card r14">${head}
    <div class="tlflex"><div class="tlwhocol"><div class="tlsp"></div>${ids.map((id) => `<div class="tlwho" style="height:${rowH(id)}px">${esc(id)}</div>`).join('')}</div>
    <div class="tlscroll" id="tlscroll"><div style="position:relative;width:${W + 20}px">
      <div class="tlaxis">${ticks}</div>${lanes}
      <div class="tlnow" style="left:${W - 1}px;height:${20 + colH}px"></div>
    </div></div></div></div>`;
}
/* ===== 在途 · 派发制视图（H49）：执行者因单而生、完成即销毁，常备的只有审检 ===== */
// 进度渲染三件套（施工令-004 结构 · 049 改口径）：口径全在服务端 lib/progress.js 算好，这里只负责画。
const 进度态 = (p) => (p && p.超时 ? 'warn' : p && p.判官 ? 'judge' : '');
// 当前段标签（施工令-049 要件③）：超预期时段名后缀「· 超预期 X%」，配合警示色——
// 条子停在段上限不装满，超了多少由这行字说，不由长度说（长度一旦装满就成了谎）。
const 段名Html = (s) => esc(s.名 + (s.超期pct ? ` · 超预期 ${s.超期pct}%` : ''));
function segbarHtml(p, id) {
  const cls = 进度态(p);
  return `<div class="segbar"${id ? ` id="${esc(id)}"` : ''}>${((p && p.段) || []).map((s) => `<div class="seg ${s.态}${s.态 === 'cur' && cls ? ' ' + cls : ''}">
      <i>${s.态 === 'cur' ? `<em style="--fill:${Math.round((s.填充 || 0) * 100)}%"></em>` : ''}</i><span>${段名Html(s)}</span></div>`).join('')}</div>`;
}
// 计时：判官阶段报「本步 · 全程」，执行阶段报「已跑 · 预期」（超预期转红，一眼可捞）
// 施工令-041 §四：这一行是**时长**，不是进度。原样式写「已跑 24分 / 预估 50分」，那道斜杠
// 被当成分数读（巡礼 F2：同一张单头上 28%、这行读出 49%），改成「·」分隔并直书「时长」二字。
// 施工令-049：预算时间制下这两个数与卡头百分比同源同分母（百分比就是它俩的商），
// 读出来必然一致——041 §四那道「同一张单两个百分比」的病从根上没了。
function 计时Html(p, 环节起时, 领单时间) {
  const tm = (iso, over) => iso && !Number.isNaN(Date.parse(iso))
    ? `<span class="tm${over ? ' over' : ''}" data-since="${esc(iso)}">${fmtElapsed(Date.now() - Date.parse(iso))}</span>` : '<span>--:--</span>';
  const bud = p && p.预期分钟 ? fmtElapsed(p.预期分钟 * 60000) : null;
  const 超 = !!(p && p.超时);
  if (p && p.判官) {
    return `${tm(环节起时, 超)} 本步${bud ? ` · 预期 ${bud}` : ''}${领单时间 ? ` · ${tm(领单时间)} 全程` : ''}`;
  }
  return `已跑 ${tm(环节起时 || 领单时间, 超)}${bud ? ` · 预期 ${bud}<span class="tmnote">（时长）</span>` : '<span class="tmnote">（无时长数据 · 停锚点）</span>'}`;
}
// 百分比的出处（施工令-041 §四立规矩，049 换口径）：预算时间制下这个数 = 本阶段已耗时 ÷ 预期时长，
// 悬浮把三级取数中的哪一级说清楚——「按 5 单滚动均时推的」和「按手配缺省表推的」信任度天差地别。
const 取数名 = { 滚动均时: '滚动均时', 配置均时: '配置 阶段均时 表', 工单预计: '工单 预计时间' };
function pctTitle(p) {
  const q = p || {};
  if (q.来源 === '时间' && q.预期分钟) {
    const 源 = (取数名[q.时长来源] || q.时长来源 || '—') + (q.样本数 ? ` ${q.样本数} 单中位` : '');
    return `${q.阶段名 || ''} · 预算时间制：本阶段已跑 ${fmtElapsed((q.耗时分钟 || 0) * 60000)}`
      + ` / 预期 ${fmtElapsed(q.预期分钟 * 60000)}（取数：${源}）`
      + (q.超时 ? ` · 超预期 ${q.超期pct}%，条子停在段上限不装满` : '');
  }
  return `${q.阶段名 || ''} · 阶段锚点${q.锚点 != null ? ' ' + q.锚点 + '%' : ''}（本阶段无会话起时或无时长数据，不编进度）`;
}
// 无会话已等时长（建设性①）：基准取「进本状态的时刻」= 更新时间，回落领单时间。
// 用更新时间而非领单时间，是因为质检态无会话时领单时间早已过期，报出来的分钟数会失真。
function 无会话分钟(r) {
  const t = Date.parse(r.更新时间 || r.领单时间 || '');
  return Number.isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000));
}
// 右列内容（百分比+阶段名+计时）：整块可原地重画，活体轮询只换这一块
function pctHtml(r) {
  const p = r.进度 || {};
  // 建设性①（施工令-012）：「卡住的单」和「正在跑的单」原先视觉完全同形，只有阶段名一处小字写着
  // 「衔接中」，制作人得逐张读小字才分得出。无会话态改成一眼自证：阶段名直说、计时行直写已等多久。
  if (r.有会话 === false) {
    const n = 无会话分钟(r);
    return `<div class="pct" title="${esc(pctTitle(p))}">${p.百分比 != null ? p.百分比 : '—'}<small>%</small></div>
      <div class="ar-stage nosess"><span class="dot"></span>无执行会话</div>
      <div class="ar-timer nosess">${n == null ? '未起会话' : `已等 ${n} 分钟未起会话`}</div>`;
  }
  return `<div class="pct" title="${esc(pctTitle(p))}">${p.百分比 != null ? p.百分比 : '—'}<small>%</small></div>
    <div class="ar-stage ${进度态(p)}"><span class="dot"></span>${esc(p.阶段名 || (r.环节 ? r.环节 + '中' : '衔接中'))}</div>
    <div class="ar-timer">${计时Html(p, r.环节起时, r.领单时间)}</div>`;
}
function viewAgentsDispatch(d, all) {
  const lim = d.并发上限 || {};
  const cards = (d.在跑 || []).map((r) => {
    const p = r.进度 || {};
    const 判官 = !!p.判官;
    const avc = 判官 ? 'var(--fn-qa)' : (FNHEX[r.职能] || 'var(--ink3)');
    // 施工令-005：展开区与卡片本体信息重复，已删；整卡点击直达该单详情页（Enter 同效）
    const go = `location.hash='#/t/${esc(r.id)}'`;
    const 无会话 = r.有会话 === false; // 建设性①：降饱和 + 虚线边，与真在跑的实心卡一眼可分
    return `<div class="arow2 card r14${无会话 ? ' noagent' : ''}" id="agc-${esc(r.id)}" onclick="${go}" tabindex="0" role="button"
      aria-label="打开工单 ${esc(r.id)} 详情${无会话 ? '（在途但无执行会话）' : ''}"
      onkeydown="if(event.key==='Enter'){${go}}" title="${无会话 ? '在途但无执行会话——点击查看工单详情' : '点击查看工单详情'}">
      <div class="ar-row">
        <div class="av" style="background:color-mix(in srgb, ${avc} 15%, transparent);color:${avc}">${esc(判官 ? p.阶段 : (r.职能 || '').slice(0, 2))}</div>
        <div class="ar-id">
          <div class="ar-idline"><span class="aid"><a href="#/t/${esc(r.id)}" style="color:inherit" onclick="event.stopPropagation()">${esc(r.id)}</a></span>
            <span class="poolp pill sm fn ${r.池 === 'claude' ? 'pool-claude' : 'pool-codex'}">${esc(r.池 || '?')} 池</span>
            ${engJobPill((d.引擎作业 || {})[r.项目])}<span class="ar-who">${esc(r.主办 || '')}</span></div>
          <div class="at" title="${esc(r.title || '')}">${esc(r.title || '')}</div>
        </div>
        <div class="ar-pct" id="agp-${esc(r.id)}">${pctHtml(r)}</div>
      </div>
      ${segbarHtml(p, 'ags-' + r.id)}
      ${r.尾 ? `<div class="ar-tail"><b>›</b> ${esc(String(r.尾).slice(-160))}</div>` : ''}
    </div>`;
  }).join('') || '<p class="dim" style="margin:26px 0;text-align:center">当前无在跑执行者 —— 派发制下没有常备军，就绪单一到即拉起，完成即销毁。</p>';
  // 外项目：席位账号级共享，本项目语境下不列他项目的单号，但也不谎称「待命」（施工令-012）
  const judges = (d.判官 || d.审检 || []).map((j) => `<span class="pill sm ${j.忙 ? 'ok' : 'mut'}">${esc(j.id)}${j.忙 ? ' · 审 ' + esc(j.当前 || '') : (j.外项目 ? ' · 忙于他项目单' : ' · 待命')}</span>`).join(' ') || '<span class="dim">（未配置）</span>';
  const ready = (d.就绪队列 || []).map((q) => `<span class="pill sm mut mono">${esc(q.id || q)}</span>`).join(' ') || '<span class="dim">空 —— 无就绪待派单</span>';
  // 已跑计时秒级跳动（与领单视图同款：离开视图自动停）
  setTimeout(function tickTm() {
    const els = document.querySelectorAll('.tm[data-since]');
    if (!els.length) return;
    els.forEach((el) => { const t = Date.parse(el.dataset.since); if (!isNaN(t)) el.textContent = fmtElapsed(Date.now() - t); });
    setTimeout(tickTm, 1000);
  }, 1000);
  // 百分比与分段条活体刷新（施工令-004）：只换右列与段条，不整页重画；
  // 在跑张数变了才整页重画（新单派发/收工），否则永远原地更新。
  const 在跑数 = (d.在跑 || []).length;
  pollLoop('ag-cards', 15000, async () => {
    const nd = agentsScoped(await api('/api/agents'), all); // 与首屏同一道项目闸，否则张数永远对不上→无限整页重画
    if ((nd.在跑 || []).length !== 在跑数) { repaint('在跑张数变'); return; }
    for (const r of (nd.在跑 || [])) {
      const pe = $('agp-' + r.id); if (pe) pe.innerHTML = pctHtml(r);
      const se = $('ags-' + r.id); if (se) se.outerHTML = segbarHtml(r.进度 || {}, 'ags-' + r.id);
      const ce = $('agc-' + r.id); if (ce) ce.classList.toggle('noagent', r.有会话 === false); // 会话起来了就退出「卡住」形态
    }
  });
  // 锁按项目过滤（2026-08-21 体检）：本页是按项目过滤的，横幅却报全部被锁项目——
  // 于是在 Ticketflow 视野里会看见「TK 派发挂起」，而 TK 的活这一页上一条也没有。
  // 本项目名下的锁才是这一页的事；别的项目被锁另起一行说明，不混进主横幅。
  const 本项目 = projActive() || projDefault();
  const 全锁 = d.编辑器占用 || [];
  const 本锁 = 全锁.filter((n) => n === 本项目);
  const 他锁 = 全锁.filter((n) => n !== 本项目);
  const busyBanner = (本锁.length ? `<div class="r14" style="padding:10px 16px;margin-top:16px;background:var(--gatebg);border:1px solid var(--gateln);color:var(--gatetx)"><b>编辑器锁已关（验收中）</b> · 项目 ${本锁.map(esc).join('、')} 派发挂起——用完关闭编辑器即自动开锁（H64），或在本页顶部开锁</div>` : '')
    + (他锁.length ? `<p class="subnote" style="margin-top:8px">另有项目 ${他锁.map(esc).join('、')} 的编辑器锁也关着（不影响本项目派发）</p>` : '');
  // H64 编辑器锁迁来在途页（2026-08-20，施工令-061 四·3 孤儿闸安家）。
  // 原落决策台（2026-08-05 制作人指正「锁属验收流程」），但决策台按定案要撤；
  // 且占用本就发生在这一页——原先在途页只有只读横幅写着「或在本页顶部开锁」，
  // 看见了却得跳一页才按得动，是白白多一跳。锁的语义没变，只是回到发生地。
  const 锁定 = 本锁.length > 0; // 按钮态看**本项目**的锁，不看别人的
  const lockCard = `<div class="card r14" style="padding:12px 16px;margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <b style="font-size:13px">编辑器锁</b>
      <button class="btn h32 ${锁定 ? 'accent' : 'primary'}" onclick="editorLock(${锁定 ? 'false' : 'true'})"
        title="开 Unity 前先关锁（派发挂起，免得 agent 的测试和你的编辑器抢同一个工程）；用完开锁恢复派发">
        ${锁定 ? '🔓 开锁 · 恢复派发' : '🔒 关锁 · 挂起派发'}</button>
      <span class="subnote">${锁定 ? '锁合中：该项目不派新活，你可以放心开 Unity' : '锁开着：派发照常。开 Unity 验收前先关锁'}</span></div>`;
  return busyBanner + lockCard + `<div class="sec-h" style="margin-top:26px"><h3 class="h17">在跑执行者</h3>
      <span class="subnote">派发制 · 因单而生、完成即销毁 · 并发 codex ≤${lim.codex != null ? lim.codex : '—'} / claude ≤${lim.claude != null ? lim.claude : '—'}（项管调配 · 代码硬顶 3）</span></div>
    <div id="ag-cards">${cards}</div>
    <div class="sec-h" style="margin-top:26px"><h3 class="h17">审检三席</h3><span class="subnote">初检 / 核查 / 仲裁 · 唯一常驻岗（H68）</span></div>
    <div class="card r14" style="padding:14px 16px;display:flex;gap:8px;flex-wrap:wrap">${judges}</div>
    <div class="sec-h" style="margin-top:26px"><h3 class="h17">就绪队列</h3><span class="subnote">依赖已齐、等槽位或额度（项管台账）</span></div>
    <div class="card r14" style="padding:14px 16px;display:flex;gap:8px;flex-wrap:wrap">${ready}</div>
    ${timelineHtml([], all, { byFn: true })}`;
}

/* D42 项目语境过滤（施工令-012 / 巡礼 P2-1）：在途页原先把 /api/agents 原样交给渲染，
   他项目工单混进驾驶舱，而同页下方的执行时间轴吃的是过滤后的 all——上半页有、下半页没有。
   口径与决策台/报表/风格库一致：在跑按单自带的项目章过滤，就绪队列/判官按「在不在本项目盘面」判，
   保证在途页上下半页同源。轮询回来的数据也走这道闸（否则张数对不上会无限整页重画）。 */
function agentsScoped(d, all) {
  const p = projActive();
  if (!p) return d;
  const ids = new Set((all || []).map((t) => t.id));
  const 判官 = (d.判官 || d.审检 || []).map((j) => (j.忙 && j.当前 && !ids.has(j.当前)
    ? { ...j, 忙: false, 当前: null, 环节: null, 外项目: true } : j));
  return { ...d,
    在跑: (d.在跑 || []).filter((r) => (r.项目 || projDefault()) === p),
    就绪队列: (d.就绪队列 || []).filter((q) => ids.has(q.id || q)),
    滞留告警: (d.滞留告警 || []).filter((x) => ids.has(x.id)),
    判官, 审检: undefined };
}
async function viewAgents() {
  const [d, { all }] = await Promise.all([api('/api/agents'), loadBoard()]);
  // 0.23：拉取制视图退役——派发制是唯一现实（H49/H56 清仓）
  return viewAgentsDispatch(agentsScoped(d, all), all);
}

/* ===== P4 决策台 ===== */
let dTab = 'accept';
/* 决策台裁决权按钮（施工令-021）：签字位上除了「通过 / 打回」，制作人还得有「先停下」和「不要了」。
   案源正是这两个在决策台压根没有——总监的土法是往文件里手写搁置令，机器读不到。
   专项/父单一视同仁：有子单就给全树选项，不因为它是容器就少一排按钮。 */
const dJudgeBtns = (cur, 有子) => `
  <button class="btn h36" onclick="suspAsk('${esc(cur.id)}',${cur.挂起 ? 'false' : 'true'},${有子 ? 'true' : 'false'})" title="${cur.挂起 ? '原位复活，重新进入调度' : '原位冻结：单不挪窝，全链路跳过'}">${cur.挂起 ? '❄ 解挂' : '❄ 挂起'}</button>
  <button class="btn danger-o h36" onclick="askAct2('废弃','${esc(cur.id)}','废弃 ${esc(cur.id)}？此单进废弃态不可逆（留档不删），返工需另开新单。')" title="终态判决：进废弃不可逆">废弃</button>`;
// 【已退役 2026-08-21】决策台撤除（异厂对抗审查裁决 + 制作人 08-20 02:34 拍板「看着这张单子的
// 详情签这张单子」）。撤它不是因为这活不该干，是因为「页面」这个容器装错了：
// 它按**工单状态**取队列（待验收∪待定夺），于是专项关账这类非工单闸结构上看不见——
// 08-20 实测欠 3 笔而它报 1 笔、页顶还写着「积压 1/8」。
// 三件职能各归各位（先建后删的次序闸，均已落地）：
//   聚合 → 服务端 等我()（lib/gatereg.js，按闸取不按状态取）
//   显示 → 总览收件箱（开机第一屏，按停摆时长降序，逾期标红）
//   签字 → 工单详情页（补齐通过入库/返修/打回三钮）+ 工单页专项卡（关账签字）
//   编辑器锁 → 在途页（占用发生地）
// 函数体原样留档：#/decisions 已转向总览，此函数不再挂路由。
async function viewDecisions() {
  const d = await api('/api/decisions');
  // D42：决策台按当前项目过滤（积压计数是全局闸，保持全局读数）
  const p = projActive();
  if (p) { await loadCfg(); d.待验收 = d.待验收.filter((t) => projOf(t) === p); d.待定夺 = d.待定夺.filter((t) => projOf(t) === p); }
  const cur = dTab === 'accept' ? (d.待验收[0] || null) : (d.待定夺[0] || null);
  let main = `<div class="dmain card r16"><p class="dim">没有待你处理的签字项——一切安好。</p>
    <p class="subnote" style="margin-top:8px">要开新活：<a class="glink" href="#/relay">项管页想法在池拍板</a> · 要放行：<a class="glink" href="#/board">看板待派列</a> · 要验收 Unity：先关上面的编辑器锁</p></div>`;
  if (cur) {
    const tk = await api('/api/ticket?id=' + encodeURIComponent(cur.id));
    const preview = tk.回执 ? tk.回执.raw : tk.body || '';
    const pvLines = preview.split('\n').filter((l) => l.trim()).slice(0, 8)
      .map((l) => `<div class="doc-line ${l.startsWith('#') ? 'hd' : ''}">${esc(l.replace(/^#+\s*/, l.startsWith('#') ? '## ' : ''))}</div>`).join('');
    const std = (tk.body || '').split(/^## /m).find((s) => s.startsWith('验收标准')) || '';
    const stdLines = std.split('\n').slice(1).filter((l) => l.trim()).slice(0, 6).map((l) => `<div class="doc-line">${esc(l)}</div>`).join('') || '<div class="doc-line dim">（工单未写验收标准）</div>';
    const isKeep = cur.验收方式 === '保留';
    // 挂起横幅进决策台（施工令-021）：签字位上摆一张冻结单而不说明，制作人只会点下去撞一鼻子灰
    const 有子 = ((tk.链 && tk.链.父子 && tk.链.父子.子) || []).length;
    const suspBar = cur.挂起 ? `<div class="suspbar" style="margin:12px 0 0">
        <span class="snowb" style="font-size:16px">❄</span><b>已挂起 · 原位冻结</b>
        <span class="sbwho">${esc(cur.挂起.操作者 || '制作人')} · ${esc(String(cur.挂起.时间 || '').slice(0, 16).replace('T', ' '))}</span>
        <span class="sp"></span>
        <button class="btn accent h32" onclick="suspAsk('${esc(cur.id)}',false,${有子 ? 'true' : 'false'})">解挂</button>
        ${cur.挂起.理由 ? `<span class="sbwhy">理由：${esc(cur.挂起.理由)}</span>` : ''}</div>` : '';
    main = `<div class="dmain card r16"><h2>${snowB(cur)}${esc(cur.id)} · ${esc(cur.title)}</h2>
      <div class="chipsrow">${fnPill(cur.职能)}<span class="pill mut">${esc(cur.验收方式 || '保留')}${isKeep ? ' · 只你能签' : ''}</span>${cur.自修次数 ? `<span class="pill red">QA 未过 · 自修 ${cur.自修次数}</span>` : ''}${cur.挂起 ? `<span class="pill susp-p" title="${esc(suspTip(cur))}">❄ 已挂起</span>` : ''}</div>${suspBar}
      <div class="dpanes"><div class="dpane"><div class="ph">${tk.回执 ? '产出预览 · 回执' : '工单正文'}</div>${pvLines || '<div class="doc-line dim">（空）</div>'}</div>
      <div class="dpane"><div class="ph">${dTab === 'accept' ? '验收标准（委托核查范围）' : '四件套'}</div>${dTab === 'accept' ? stdLines
        : `<div class="doc-line">结论：QA 未通过（自修 ${cur.自修次数 || 0} 轮）</div><div class="doc-line">问题/原因/解法：见回执异议与 QA 章节</div>`}
        ${isKeep && dTab === 'accept' ? '<div class="taste">待你品味：产出对不对味，只有你能签。</div>' : ''}</div></div>
      ${dTab === 'accept' ? `<div class="dsign"><span>${isKeep ? '保留单 · 品味终审' : '委托单 · 可核项由核查代签'}</span>
        <div class="btns"><button class="btn primary h36" onclick="dAct('验收','${esc(cur.id)}',true)">通过入库</button>
        <button class="btn h36" onclick="dReject('${esc(cur.id)}')">打回</button>${dJudgeBtns(cur, 有子)}</div></div>`
      : `<div class="dsign"><span>QA 修不好 · 呈你我裁决</span><div class="btns">
        <button class="btn h36" onclick="dAct('定夺','${esc(cur.id)}',null,'接受')">接受</button>
        <button class="btn h36" onclick="dAct('定夺','${esc(cur.id)}',null,'给方向')">给方向</button>
        <button class="btn danger-o h36" onclick="dAct('定夺','${esc(cur.id)}',null,'打回')">打回</button>${dJudgeBtns(cur, 有子)}</div></div>`}</div>`;
  }
  const q1 = d.待验收.map((t) => `<div class="qitem${suspCls(t)}" onclick="dTab='accept';route()"${suspOf(t) ? ` title="${esc(suspTip(t))}"` : ''}><span class="qi mono">${snowB(t)}${esc(t.id)}</span><div class="qn2 clamp2" title="${esc(t.title)}">${esc(t.title)} · ${esc(t.验收方式 || '保留')}</div></div>`).join('') || '<p class="dim" style="margin-top:12px">无</p>';
  // H64 编辑器锁（2026-08-05 制作人指正：锁属验收流程，落决策台不落首页）——数据后到原地填
  setTimeout(async () => { try {
    const run = await api('/api/runner');
    const el = $('dec-lock'); if (!el) return;
    const locked = run.编辑器占用 && run.编辑器占用.length;
    el.innerHTML = `<button class="btn h36 ${locked ? 'accent' : 'primary'}" onclick="editorLock(${locked ? 'false' : 'true'})" title="验收开 Unity 前先关锁（派发挂起）；用完关编辑器会自动开锁">${locked ? '🔒 验收锁已关 · 派发挂起中 · 点击手动开锁' : '🔓 要验收？先点我关锁再开 Unity'}</button>`;
  } catch { /* 保持占位 */ } }, 0);
  return `<div class="card r14" style="padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <b style="font-size:13px">编辑器锁</b><span id="dec-lock" class="dim">…</span>
      <span class="subnote">开 Unity 验收的第一步和最后一步都在这</span></div>
    <div class="dtabs">
      <span class="tab ${dTab === 'accept' ? 'active' : ''}" onclick="dTab='accept';route()">验收签字</span>
      <span class="tab ${dTab === 'escal' ? 'active' : ''}" onclick="dTab='escal';route()">待处理 ${d.待定夺.length ? `<span class="badge">${d.待定夺.length}</span>` : ''}</span>
      <span class="backlog2">验收积压 ${d.积压} / ${d.积压闸}</span></div>
    <div class="dgrid">${main}<div><div class="dside card r16"><h3>完成候验队列</h3>${q1}</div>
      <div class="dside card r16"><h3 class="${d.待定夺.length ? 'err' : ''}">待处理 · ${d.待定夺.length}</h3>
        ${d.待定夺.map((t) => `<div class="qitem${suspCls(t)}" onclick="dTab='escal';route()"${suspOf(t) ? ` title="${esc(suspTip(t))}"` : ''}><span class="qi mono">${snowB(t)}${esc(t.id)}</span><div class="qn2 clamp2" title="${esc(t.title)}">${esc(t.title)} · QA 未过</div></div>`).join('') || '<p class="dim" style="margin-top:12px">无</p>'}</div></div></div>`;
}
window.dAct = async (name, id, 通过, 决定) => { const r = await post('/api/act/' + name, { id, 通过, 决定 }); toast(r.ok ? '已处理' : (r.error || '失败')); route(); };
window.dReject = async (id) => { if (await ask('打回将归档旧单，需另开新单重走流程。确认？')) dAct('验收', id, false); };

/* ===== P5 风格库 → 施工令-015 迁为 Wiki「美术标杆」页签（数据零迁移，仅展示位并入） ===== */
async function wkArtRef() {
  const d = await api('/api/style-lib');
  // D42：风格库跟项目走——条目按落款/meta 的项目归属过滤，旧条目（无项目记号）归默认项目
  const p = projActive();
  if (p) { await loadCfg();
    d.标杆 = d.标杆.filter((e) => (e.项目 || projDefault()) === p);
    d.美术 = d.美术.filter((x) => ((x.来源 && x.来源.项目) || projDefault()) === p);
  }
  const ax = d.标杆.length ? d.标杆.map((e) => `<div class="axcard card"><h4>${esc(e.标题)}</h4><p title="${esc(e.正文)}">${esc(e.正文.slice(0, 80))}</p>
      <div class="axmeta">${e.源单 && e.源单 !== '手工' ? `<a class="pill sm fn mono" href="#/t/${esc(e.源单)}">${esc(e.源单)}</a>` : '<span class="pill sm mut">手工</span>'}
        ${e.日期 ? `<span class="axdate mono">${esc(e.日期)}</span>` : ''}
        <button class="axdel" title="移出标杆（精选制反向闸）" onclick="axRemove('${esc(e.标题)}')">×</button></div></div>`).join('')
    : '<div class="emptycard"><h5>标杆空</h5><p>完成态的策划单详情页有「入标杆」——由你提炼一句话进公理库（审批点④）。</p></div>';
  const art = d.美术.map((x) => `<div class="artcard card">
      ${x.isImage ? `<div class="thumb"><img src="/stylelib-files/美术库/${encodeURIComponent(x.name)}" loading="lazy" alt="${esc(x.name)}"/></div>`
    : `<div class="thumb ftype"><span class="mono">${esc(x.ext.replace('.', '').toUpperCase() || 'FILE')}</span></div>`}
      <div class="an" title="${esc(x.name)}">${esc(x.name.replace(/\.[^.]+$/, ''))}</div>
      <div class="ac">${x.来源 && x.来源.源单 ? `<a class="mono" style="color:var(--accent-ink)" href="#/t/${esc(x.来源.源单)}">${esc(x.来源.源单)}</a>` : '手工'}${x.来源 && x.来源.说明 ? ' · ' + esc(x.来源.说明.slice(0, 16)) : ''}
        <button class="axdel" title="移出美术库" onclick="artRemove('${esc(x.name)}')">×</button></div></div>`).join('');
  // D12 精选制入库按钮随迁本页签（API 不变；不填源单 = 手工入库，填了则仍走完成态校验）
  return `<div class="p5grid" style="margin-top:18px"><div>
      <div class="sec-h"><h3 class="h17">标杆公理</h3><span class="subnote">提炼式 · 设计公理 · 来源可溯</span>
        <button class="btn h32" style="margin-left:auto" onclick="axModal('')">＋ 入标杆</button></div>${ax}</div>
    <div><div class="sec-h"><h3 class="h17">美术图集</h3><span class="subnote">精选范例 · 只进精品</span>
        <button class="btn h32" style="margin-left:auto" onclick="artModal('')">＋ 入美术库</button></div>
      ${art ? `<div class="artgrid">${art}</div>` : `<div class="emptycard"><h5>范本库空</h5>
        <p>完成态的美术/装配单详情页有「入美术库」，或用上方按钮手工精选——agent 领单前先看这里对齐风格。</p></div>`}</div></div>`;
}
window.axRemove = async (标题) => {
  if (!await ask(`把「${标题}」移出标杆？`)) return;
  const r = await post('/api/stylelib/axiom-remove', { 标题 });
  toast(r.ok ? '已移出' : (r.error || '失败')); if (r.ok) route();
};
window.artRemove = async (name) => {
  if (!await ask(`把 ${name} 移出美术库？（文件会删除，来源仓库里的原件不受影响）`)) return;
  const r = await post('/api/stylelib/art-remove', { name });
  toast(r.ok ? '已移出' : (r.error || '失败')); if (r.ok) route();
};

/* ===== P13 消耗报表（停车场老待办落地）===== */
// 派发制报表：按主办已无意义（一次性主办恒单数=1）→ 单耗排行（实耗降序，直链工单）
function costRankTable(rows) {
  const top = rows.filter((r) => r.实际h != null).sort((a, b) => b.实际h - a.实际h).slice(0, 12);
  return `<div class="rp-card card r14"><h4>单耗排行<span class="subnote" style="margin-left:10px">实耗降序 · 前 12 · 点行进详情</span></h4>
    <table class="rp-t"><tr><th>单</th><th>职能</th><th>实际h</th><th>偏差</th><th>自修</th></tr>
    ${top.map((r) => `<tr onclick="location.hash='#/t/${encodeURIComponent(r.id)}'" style="cursor:pointer">
      <td class="mono">${esc(r.id)}</td><td>${fnPill(r.职能)}</td><td>${r.实际h}</td>
      <td class="${r.预计h && r.实际h > r.预计h * 1.5 ? 'err' : ''}">${r.预计h ? Math.round(r.实际h / r.预计h * 100) + '%' : '—'}</td>
      <td class="${r.自修次数 ? 'warnc' : 'dim'}">${r.自修次数 || ''}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">无数据</td></tr>'}</table></div>`;
}
// 项管台账卡（0.23.10：台账归报表——用户裁定）
// H69 评分仪表盘卡：岗位×模型矩阵（均分+n，n<5 灰显「样本不足」）。只读仪表——供路由决策，不接奖惩。
function scoreCard(sc) {
  if (!sc || !sc.rows || !sc.rows.length) return '';
  const rows = sc.rows.map((r) => `<tr class="${r.n < 5 ? 'dim' : ''}"><td>${esc(r.线)}</td><td>${esc(r.岗位)}</td><td class="mono">${esc(r.模型)}</td>
      <td style="text-align:right"><b>${r.均分}</b></td><td style="text-align:right">${r.n}${r.n < 5 ? ' <span class="subnote">样本不足</span>' : ''}</td></tr>`).join('');
  const 误 = sc.审检误判 || {};
  return `<div class="rp-card card r14"><h4>评分仪表盘<span class="subnote" style="margin-left:10px">H69 · 三线互评 · 只观测不奖惩</span></h4>
    <table class="rp-t"><tr><th>评分线</th><th>岗位</th><th>模型</th><th>均分</th><th>n</th></tr>${rows}</table>
    <p class="subnote" style="margin-top:8px">审检误判（客观事件）：漏判 ${误.漏判 || 0} · 误杀 ${误.误杀 || 0}</p></div>`;
}

function pmLedgerCard(L) {
  const fee = L.管理费 || { token合计: 0, 次数: 0 };
  const caps = Object.entries(L.并发上限 || {}).map(([k, v]) => esc(k) + ' ≤' + v).join(' · ') || '—';
  const costRows = Object.entries(L.父单成本 || {}).slice(-6).map(([pid, c]) => {
    const tk = typeof c === 'object' ? (c.token合计 ?? c.tokens ?? 0) : c;
    return '<tr><td class="mono">' + esc(pid) + '</td><td style="text-align:right">' + Number(tk).toLocaleString() + '</td></tr>';
  }).join('') || '<tr><td colspan="2" class="dim">暂无归集</td></tr>';
  return '<div class="rp-card card r14"><h4>项目管理台账 · 全工作室<span class="subnote" style="margin-left:10px">管理费 '
    + Number(fee.token合计 || 0).toLocaleString() + ' tk · ' + (fee.次数 || 0) + ' 次 · 并发 ' + caps + '</span></h4>'
    + '<table class="rp-t"><tr><th>专项成本归集</th><th style="text-align:right">tokens</th></tr>' + costRows + '</table></div>';
}
async function viewReport() {
  await loadCfg(); // 先拿配置，projActive() 依赖它（前端过滤已下放服务端，参数得先备好）
  const p0 = projActive();
  const [d, pl, sc] = await Promise.all([
    // 项目切分在**服务端**（2026-08-21 体检）：原样是服务端全量、前端只切明细一处，
    // 于是顶栏 8 个读数、按职能、按池、每日全是全工作室的，而页头写着「监制台 · Ticketflow」；
    // 同一段注释还自称「明细/分组按项目过滤」。切在源头，此后所有读数同源，不会再有两把尺。
    api('/api/report' + (p0 ? '?' + encodeURIComponent('项目') + '=' + encodeURIComponent(p0) : '')),
    api('/api/pm/ledger').catch(() => null), api('/api/scores').catch(() => null),
  ]);
  const dispatch = !!(_cfg && _cfg.执行器 && _cfg.执行器.派发制);
  const p = p0;
  const rows = d.明细;
  const o = d.总览;
  const stat = (l, v, c) => `<div class="grp"><span class="lbl">${l}</span><span class="num ${c || ''}">${v}</span></div>`;
  const strip = [
    stat('完成', o.完成), stat('归档', o.已归档), stat('实际工时', o.实际h合计 + 'h'),
    stat('实耗/预估', o.预估偏差pct == null ? '—' : o.预估偏差pct + '%', o.预估偏差pct > 150 ? 'err' : o.预估偏差pct != null && o.预估偏差pct <= 110 ? 'okc' : ''), // 100=踩点 <100=省 >150=严重超（旧名「预估偏差」误导）
    stat('自修轮次', o.自修总轮, o.自修总轮 ? 'warnc' : ''),
    stat('核查 过/不过', o.代核通过 + '/' + o.代核不过),
    stat('仲裁 向/呈', o.代裁给方向 + '/' + o.代裁上呈),
    stat('token(agent自报)', o.token估计合计 ? o.token估计合计.toLocaleString() : '—'),
    ...(dispatch && pl && pl.台账 && pl.台账.管理费 ? [stat('管理费(项管·全工作室)', (pl.台账.管理费.token合计 || 0).toLocaleString() + ' tk·' + (pl.台账.管理费.次数 || 0) + '次')] : []),
  ].join('<div class="vdiv"></div>');
  // 报表口径混排修（施工令-044 F4 · 巡礼）：「按职能」表的项管行原先把 token 数塞进「均 h」列
  // （"1,385,033 tk" 与同列的 "2.4"（小时）同列而居），一列两种量纲，读表的人得逐格辨认单位。
  // 时间列只放时间：项管行不计工时 → 合计h/均h 一律「—」，token 归它自己的去处（项目管理台账卡 +
  // 顶栏「管理费(项管)」读数），悬浮里把数报全，不靠混排凑信息量。
  const 项管行 = (L) => {
    const f = L.管理费 || {};
    const tk = (f.token合计 || 0).toLocaleString();
    return { 名: '项目管理（全工作室）', 单数: f.次数 || 0, 实际h合计: '—', 平均h: '—', 自修合计: 0,
      提示: `项目管理（项管自身开销 · **全工作室口径，未按项目切**）：${f.次数 || 0} 次 · ${tk} tokens —— 按次计，不产生工时。明细见「项目管理台账」卡。` };
  };
  const gtable = (title, rows2, note) => `<div class="rp-card card r14"><h4>${title}<span class="subnote" style="margin-left:10px">${note || ''}</span></h4>
    <table class="rp-t"><tr><th></th><th>单数</th><th>合计h</th><th>均h</th><th>自修</th></tr>
    ${rows2.map((g) => `<tr${g.提示 ? ` title="${esc(g.提示)}"` : ''}><td>${esc(g.名)}</td><td>${g.单数}</td><td>${g.实际h合计}</td><td${g.平均h === '—' ? ' class="dim"' : ''}>${g.平均h}</td><td class="${g.自修合计 ? 'warnc' : 'dim'}">${g.自修合计}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">无数据</td></tr>'}</table></div>`;
  const dayMax = Math.max(1, ...d.每日.map((x) => x.交付));
  const daysHtml = d.每日.map((x) => `<div class="rp-day" title="${esc(x.日)} · 交付 ${x.交付} 单 · ${x.实际h}h">
      <i style="height:${Math.round(x.交付 / dayMax * 46) + 4}px"></i><span>${esc(x.日.slice(5))}</span></div>`).join('') || '<p class="dim">暂无交付</p>';
  const detail = rows.slice(0, 40).map((r) => `<tr onclick="location.hash='#/t/${encodeURIComponent(r.id)}'" style="cursor:pointer">
      <td class="mono">${esc(r.id)}</td><td>${fnPill(r.职能)}</td><td>${esc(r.阶段 || '—')}</td>
      <td>${r.预计h == null ? '—' : r.预计h + 'h'}</td><td>${r.实际h == null ? '—' : r.实际h + 'h'}</td>
      <td class="${r.预计h && r.实际h > r.预计h * 1.5 ? 'err' : ''}">${r.预计h && r.实际h != null ? Math.round(r.实际h / r.预计h * 100) + '%' : '—'}</td>
      <td class="${r.自修次数 ? 'warnc' : 'dim'}">${r.自修次数 || ''}</td>
      <td class="dim" title="${esc(r.实际消耗 || '')}">${esc((r.实际消耗 || '—').slice(0, 26))}</td></tr>`).join('');
  return `<div class="stat-strip card r14">${strip}</div>
    <div class="rp-grid">
      <div>${gtable('按职能', dispatch && pl && pl.台账 ? [...d.按职能, 项管行(pl.台账)] : d.按职能,
    dispatch && pl && pl.台账 ? '项目管理行按次计，不计工时——它的 token 归项目管理台账' : '')}${dispatch ? costRankTable(rows) : gtable('按主办', d.按主办)}${dispatch && pl && pl.台账 ? pmLedgerCard(pl.台账) : ''}${gtable('按执行池', d.按池, '订阅额度去向')}${scoreCard(sc)}</div>
      <div><div class="rp-card card r14"><h4>每日交付<span class="subnote" style="margin-left:10px">近 14 天</span></h4>
        <div class="rp-days">${daysHtml}</div></div>
        ${gtable(p ? `按项目（当前语境：${p}）` : '按项目（全工作室）', d.按项目)}</div>
    </div>
    <div class="rp-card card r14" style="margin-top:20px"><h4>工单明细${p ? `<span class="subnote" style="margin-left:10px">项目 ${esc(p)}</span>` : ''}</h4>
      <div class="rp-scroll"><table class="rp-t"><tr><th>编号</th><th>职能</th><th>阶段</th><th>预计</th><th>实际</th><th>偏差</th><th>自修</th><th>agent 自报消耗</th></tr>${detail || '<tr><td colspan="8" class="dim">无数据</td></tr>'}</table></div>
      <p class="subnote" style="margin-top:10px">本表 ${Math.min(40, rows.length)} 行${
        rows.length > 40 ? `（明细共 ${rows.length} 条，只画最近 40 条）` : ''}${
        d.明细满 ? ' · 服务端上限 100 条，更早的未取' : ''} · 实际=交付-领单的墙钟时长 · token 为 agent 回执自报（参考值）· 点行进详情</p></div>`;
}

/* ===== P6 参数与额度 =====
   铁律：视图保持渲染——首屏立即画（额度先占位后原地填），调参只原地改数字，绝不整页重载 */
// P6META 是**说明表**，不是闸门（2026-08-22 体检 #70）：它天然是写口白名单的超集
// （执行器/额度那几格根本不走 /api/config/gate）。三格死键同批清掉：
// 全局在途上限＝0.23.11 拉取制退役、速度窗口小时/每档处理数＝D28 推荐在途退役（#58）。
const P6META = { 待验收积压闸: '≥N 停止建议投放', QA自修上限: '轮，超则上交四件套', 滞留超时小时: '小时，超则告警（不自动撤回）',
  人闸超时小时: '小时，人闸停摆超 N 小时即标逾期并升格急件（0=关闭升格）',
  间隔秒: '每 N 秒扫一轮（派发+起执行）', 执行超时分钟: 'N 分钟到点先验尸：仍在进展续命，停滞才树杀（硬顶 3N，H63）', 记账间隔分钟: '每 N 分钟自动 git 落袋（0=关）',
  额度刷新秒: '两次额度请求最小间隔 N 秒（防限流硬保证）' };
// 模型档空值文案：不是所有档留空都等于「CLI 默认」——代裁留空是跟核查档走
// （runner.modelOf：代裁 → 仲裁 || 代裁 || 核查 || 代核 || claude默认）。下拉与旁注必须同一口径（施工令-006）
const MEMPTY = { 代裁: '跟核查档' };
const mEmptyLbl = (key) => MEMPTY[key] || 'CLI 默认';
const P6NAMES = { 滞留超时小时: '滞留超时', 人闸超时小时: '人闸超时',
  间隔秒: '扫池间隔', 执行超时分钟: '执行超时', 记账间隔分钟: '记账间隔', 额度刷新秒: '额度刷新间隔' };
// 额度双池卡。口径纪律（施工令-006）：每个窗口只跟管得着它的那根杆并排——
// 旧版把「5h X% · 周 Y% · 阈值 Z%」串成一行，读起来像周窗也归 阈值 管（周 61% > 阈值 70%？
// 其实周窗归 周阈值 90% 管），凭空造出违规错觉。现在一窗一行，各挂各的杆。
// @testable-begin poolCardHtml
function poolCardHtml(name, l, cfg2, moat) {
  const pct = l && l.fivePct != null ? l.fivePct : null;
  const wpct = l && l.weekPct != null ? l.weekPct : null;
  const hot = l && l.locked;
  const th = cfg2 && cfg2.阈值 != null ? cfg2.阈值 : 70;
  const wth = cfg2 && cfg2.周阈值 != null ? cfg2.周阈值 : 90;
  const row = (lbl, v, gate, note, over) => `<div class="qline"><span class="ql">${lbl}</span>
      <b class="qv mono ${over ? 'err' : ''}">${v == null ? '··' : v + '%'}</b>
      <span class="pbar"><i class="${over ? 'hot' : ''}" style="width:${v || 0}%"></i></span>
      <span class="qgate">${gate}<span class="qwin">（${note}）</span></span></div>`;
  // 沟通护城河（dispatch.moatBlocked 的真实行为，读数由 /api/gates 直供）：只管 claude 池、
  // 只看 5h 窗余量——余量 ≤ 保留线就停拉 claude 生产单，把额度留给对话。未越线不出提示。
  const moatHtml = (moat && moat.已越 && name === moat.池)
    ? `<div class="moat" title="lib/pm/dispatch.js · moatBlocked：claude 池 5h 余量 ≤ 沟通保留线即停拉生产单，对话与项管不受影响">
        ${moat.窗口} 余 ${moat.余量}% · 沟通保留线 ${moat.保留线}% 已越 — claude 生产单停拉（额度留给对话）</div>` : '';
  // 一窗一行的「窗」由服务端如实给（施工令-010 · gates.poolLock.窗口）：codex 现实只有周窗，
  // 旧样硬摆一行「5h ··」，制作人看见的是个永远读不出数的假窗。读数拿不到时也不假造窗名。
  const wins = l && Array.isArray(l.窗口) ? l.窗口 : null;
  const rows = wins
    ? (wins.length ? wins.map((w) => row(esc(w.label), w.pct, `阈值 ${w.阈值}%`, `管${esc(w.label)}窗`, !!w.已越)).join('')
      : row('窗口', null, '阈值 —', '额度读数不可用', false))
    : `${row('5h', pct, `阈值 ${th}%`, '管 5h 窗', pct != null && pct >= th)}
    ${row('周', wpct, `周阈值 ${wth}%`, '管周窗', wpct != null && wpct >= wth)}`;
  // 不计量池标注（施工令-047 · robinwang2 2026-08-11 信 §六）：codex CLI 走纯文本流，
  // 会话收线拿不到 usage——预算账里永远不会有 codex 的行。这不是故障（对比上方 .budgetdead 红标是故障），
  // 是这条通道的事实，所以走静音灰标；同「池衡盲区不编数」纪律：宁可明写测不到，绝不摆个估算数充数。
  const 计量Html = name === 'codex'
    ? `<div class="nometer" title="codex CLI 的输出是纯文本流（不是 --output-format stream-json），会话结束取不到 usage 字段；它本身又是订阅计费池，按量预算闸本就不针对它。监制台因此显式不为 codex 记账，也不臆造数字——同「池衡盲区不编数」纪律。claude 家族（含各 *-key 按量池）走 stream-json，每次会话如实回灌进预算账。">不计量池——消耗不入预算账</div>`
    : '';
  return `<div class="pr"><h4>${name} 池</h4><span class="pstat ${hot ? 'err' : 'dim'}">${l ? (hot ? '●锁 ' + esc(l.resetAt || '') + ' 解冻' : '正常') : '查询中…'}</span></div>
    ${rows}
    ${计量Html}
    ${moatHtml}`;
}
// @testable-end poolCardHtml
/* ---- 预算闸失效红标（施工令-046）----
   lib/budget 三候选全失守时落的是空实现：不落账、不冻结，按量池烧多少都不会自己停，
   而界面上一点症状都没有——静默失效比报错危险得多。这是故障不是设定内行为（对比 .moat 走警示色），
   故走危险红且挂在额度双池正上方；悬停给三候选各自的失败因，照着改就能修。*/
function budgetDeadHtml(g) {
  if (!g || !g.budget失效) return '';
  const 因 = (g.budget失败因 || []).map((f) => `${f.候选}：${f.因}`).join('\n');
  return `<div class="budgetdead" title="${esc(因 || '（服务端未给失败因）')}">
    <b>⚠ 预算闸失效 — 不落账不冻结</b>
    <span>按量池（API key）没有 5h/周 窗口，全靠这道闸刹车；它现在是空转的。
      悬停看三候选失败因，修 <code>studio.config.json · packages路径</code> 或 <code>TICKETFLOW_PACKAGES</code> 后重启。</span></div>`;
}
/* ---- 池位矩阵卡（H99 · 施工令-045 要件 9）----
   一张卡回答三个问题：①三池现在各剩多少（读不到就明写盲区，绝不摆一个好看的数）
   ②每个会话位当前落在哪个池的哪个档、有没有被品味锁/人工覆盖钉住 ③项管最近动过什么手。
   编辑面只留「人工覆盖 / 解除覆盖」——那是**人**的入口；项管的自动切换走 /api/pm/poolbalance，
   参数页不提供代项管切换的按钮（那等于绕开迟滞与台账，把审计面开了个后门）。*/
function pbPoolPill(p) {
  if (!p) return '';
  if (p.盲区) return `<span class="pill sm mut" title="${esc(p.源 || '')}｜${esc(p.因 || '')}">${esc(p.池)} · 盲区</span>`;
  const cls = p.冻结 ? 'err' : p.可用度 >= 50 ? 'ok' : 'warn';
  const 冷 = p.冷却至 ? ` · 冷却至 ${esc(String(p.冷却至).slice(11, 16))}` : '';
  const 明 = (p.明细 || []).map((d) => (d.余额 != null ? `余额 ${d.余额}${d.币种 || ''}/满额 ${d.满额}` : `${d.窗} ${d.已用}%/闸 ${d.阈值}%`)).join(' · ');
  return `<span class="pill sm ${cls}" title="${esc(p.源 || '')}｜${esc(明)}｜取数 ${esc(p.读数时刻 || '未知')}">${esc(p.池)} 可用 ${p.可用度}%${冷}</span>`;
}
function pbHtml(m) {
  if (!m || !m.位) return '<p class="dim">池衡读取失败</p>';
  const 池行 = (m.池 || []).map(pbPoolPill).join(' ') || '<span class="dim">（无池）</span>';
  const 位行 = m.位.map((b) => {
    const 判官 = b.类型 !== '执行';
    const 池签 = `<span class="poolp pill sm fn ${b.当前池 === 'claude' ? 'pool-claude' : 'pool-codex'}" title="${判官 ? 'QA/核查 会话由 runner 定死走 claude，可切的是模型档' : esc(b.摘 || '')}">${esc(b.当前池 || '未挂池')}${b.档 ? ' · ' + esc(b.档) : ''}</span>`;
    const 读 = b.读数 ? (b.读数.盲区 ? '<span class="pill sm mut">读数盲区</span>' : `<span class="pill sm ${b.读数.可用度 >= 50 ? 'ok' : 'warn'}">可用 ${b.读数.可用度}%</span>`) : '';
    const 锁 = b.锁 ? `<span class="pill sm warn" title="${esc(b.锁.因)}">品味锁 · 应为 ${esc(b.锁.应为)}${b.锁.合规 ? '' : '（当前不合锁）'}</span>` : '';
    const 覆 = b.覆盖 ? `<span class="pill sm err" title="${esc(b.覆盖.理由 || '')}｜${esc(b.覆盖.时刻 || '')}">人工覆盖 · ${esc(b.覆盖.由 || '人')} · 自动已冻</span>` : '';
    const 最近 = b.最近切换 ? `<span class="dim mono" style="font-size:11px">最近 ${esc(String(b.最近切换).slice(5, 16).replace('T', ' '))}</span>` : '';
    return `<div class="pbrow" data-pos="${esc(b.位)}"><b>${esc(b.位)}</b>${池签}${读}${锁}${覆}${最近}
      <span class="pbacts">${b.覆盖 ? `<button class="btn h32" onclick="pbRelease('${esc(b.位)}')">解除覆盖</button>`
        : `<button class="btn h32" onclick="pbOverride('${esc(b.位)}',${判官 ? 1 : 0})">人工覆盖</button>`}</span></div>`;
  }).join('');
  const 事件 = (m.事件 || []).map((e) => `<div class="pbev"><span class="pill sm ${e.类型 === '池衡拒绝' || e.类型 === '池衡越权' ? 'warn' : 'mut'}">${esc(e.类型.replace('池衡', ''))}</span>
    <span class="mono dim">${esc(String(e.t || '').slice(5, 16).replace('T', ' '))}</span>
    <span>${esc(e.位 || e.动作 || '')}${e.从 ? ` ${esc(e.从)}→${esc(e.到 || '')}` : ''}</span>
    <span class="dim" title="${esc(e.因 || e.理由 || '')}">${esc(String(e.由 || '')) }${e.因类 ? ' · ' + esc(e.因类) : ''}</span></div>`).join('')
    || '<p class="dim" style="margin:6px 0 0">（还没有池衡事件）</p>';
  const p = m.参数 || {};
  return `<div class="pbhead"><span class="pill sm ${m.开 ? 'ok' : 'mut'}">自动平衡 ${m.开 ? '开' : '关'}</span>
      <span class="dim mono" style="font-size:11px" title="CAS 版本：写前先读、按现态重试">v${esc(m.版本 || '')}</span>
      <button class="btn h32" style="margin-left:auto" onclick="pbToggle(${m.开 ? 0 : 1})">${m.开 ? '关闭自动平衡' : '开启自动平衡'}</button></div>
    <p class="pmeta">项管每 15 分钟读三池额度、按可用度差调整池位；品味锁位与人工覆盖位不动。切换只影响此后新派发的会话。</p>
    <div class="pbpools">${池行}</div>
    <div class="pbrows">${位行}</div>
    <div class="pbparams">${[['最小间隔分钟', 5], ['阈值差', 5], ['冷却分钟', 15], ['失败回退次数', 1]].map(([k, st]) =>
      `<span class="pbp" data-pbk="${k}">${k} <button onclick="pbStep('${k}',-${st})">−</button><b class="val">${p[k]}</b><button onclick="pbStep('${k}',${st})">＋</button></span>`).join('')}</div>
    <div class="sec-h" style="margin-top:14px"><h3 class="h17" style="font-size:13px">最近 5 条池衡事件</h3></div>${事件}`;
}
window.pbLoad = async () => {
  const box = $('pb-card'); if (!box) return;
  try { const m = await api('/api/pm/poolbalance'); window._pb = m; box.innerHTML = pbHtml(m); }
  catch { box.innerHTML = '<p class="dim">池衡读取失败（服务未就绪？）</p>'; }
};
// 人工覆盖：总监/制作人的入口。原生 prompt 在 exe 壳里是哑弹（施工令-012），一律走 askInput。
window.pbOverride = async (位, 判官) => {
  const m = window._pb || {}; const b = (m.位 || []).find((x) => x.位 === 位) || {};
  const 池表 = (m.池 || []).map((p) => p.池).join(' / ');
  const 值 = await askInput(判官 ? `人工覆盖 ${位}：模型档` : `人工覆盖 ${位}：目标池`, 判官 ? (b.档 || '') : (b.当前池 || ''),
    { note: 判官 ? 'QA/核查 会话由 runner 定死走 claude，这里切的是模型档（留空=CLI 默认）' : `可选池：${池表}` });
  if (值 == null) return;
  const 理由 = await askInput('理由（进台账，晨报可对账）', '', { note: '人工覆盖会冻结项管的自动切换，直至你解除' });
  if (理由 == null) return;
  const r = await post('/api/pm/poolbalance/人工覆盖', { 位, ...(判官 ? { 档: 值 } : { 池: 值 }), 预期版本: m.版本, 操作者: '制作人', 理由 });
  toast(r.ok ? `已覆盖：${位} → ${r.到}（自动切换已冻结）` : (r.error || '失败'));
  pbLoad();
};
window.pbRelease = async (位) => {
  if (!await ask(`解除 ${位} 的人工覆盖？解除后项管的自动平衡会重新接管这一位。`)) return;
  const m = window._pb || {};
  const r = await post('/api/pm/poolbalance/解除覆盖', { 位, 预期版本: m.版本, 操作者: '制作人', 理由: '参数页解除' });
  toast(r.ok ? `${位} 覆盖已解除，自动平衡恢复` : (r.error || '失败'));
  pbLoad();
};
window.pbToggle = async (on) => {
  const r = await post('/api/config/poolbalance', { key: '开', value: !!on });
  if (!r.ok) return toast(r.error || '失败');
  toast(on ? '池衡自动平衡已开' : '池衡自动平衡已关（读数与人工覆盖照常）');
  pbLoad();
};
window.pbStep = async (k, delta) => {
  const el = document.querySelector(`.pbp[data-pbk="${k}"] .val`); if (!el) return;
  const next = Number(el.textContent) + delta;
  const r = await post('/api/config/poolbalance', { key: k, value: next });
  if (!r.ok) return toast(r.error || '失败');
  el.textContent = String(next); bump(el);
  if (window._pb && window._pb.参数) window._pb.参数[k] = next;
  if (window._pb) window._pb.版本 = r.版本 || window._pb.版本; // 参数也在 CAS 切片里：改完必须换新版本，否则下一手覆盖必 409
  toast(`池衡 ${k} → ${next}`);
};
// H85 编制权下放项管（2026-08-06 制作人裁决）：参数页的「agent 编制 · 执行池」管理区已整体拆除
// （下拉框/在岗徽章/交互面）。编制是项管所辖数据，只在项管页以只读快照呈现（rosterSnapHtml），
// 调整走 /api/pm/roster（项管调用 + 总监代劳），监制台不再提供编辑界面。
// 主题 C：双主题切换——令牌层在 style.css，这里只负责钉 data-theme + 本机记忆 + 同步窗口底色
const THEME_BG = { paper: '#FAFAF8', glass: '#0B0D10' };
window.curTheme = () => (document.documentElement.dataset.theme === 'glass' ? 'glass' : 'paper');
window.themeSet = (v) => {
  document.documentElement.dataset.theme = v;
  try { localStorage.setItem('studio-theme', v); } catch { /* 隐私模式等拿不到就算了 */ }
  if (window.studio && window.studio.setThemeBg) window.studio.setThemeBg(THEME_BG[v] || THEME_BG.paper);
  document.querySelectorAll('[data-th]').forEach((b) => b.classList.toggle('on', b.dataset.th === v));
  toast(v === 'glass' ? '已入夜 · 暗色玻璃' : '已回昼 · 暖纸面 2.0');
};
if (window.studio && window.studio.setThemeBg) window.studio.setThemeBg(THEME_BG[window.curTheme()]);

async function viewParams() {
  const [c, run, models] = await Promise.all([api('/api/config'), api('/api/runner'), api('/api/models').catch(() => ({}))]);
  window._p6cfg = c;
  window._models = models;
  // 执行器：派发调度循环的仪表与开关（H49）
  const rcfg = c.执行器 || {};
  const runCards = `<div class="paramcard card" id="run-card"><h4><i class="${dotCls(run)}" id="run-dot"></i>执行器 <span id="run-state">${run.运行 ? '运行中' : '已停'}</span></h4>
      <p class="pmeta" id="run-meta" title="${esc(runMetaFull(run))}">${esc(runMeta(run))}</p>
      <div class="runbtn"><button class="btn h32 ${run.运行 ? '' : 'primary'}" id="run-toggle" onclick="runToggle()">${run.运行 ? '停止' : '启动'}</button></div></div>
    ${[['间隔秒', run.间隔秒, 5], ['执行超时分钟', rcfg.执行超时分钟 ?? 30, 5], ['记账间隔分钟', rcfg.记账间隔分钟 ?? 10, 5]].map(([k, v, st]) => `<div class="paramcard card" data-runkey="${k}"><h4>${P6NAMES[k]}</h4><p class="pmeta">${esc(P6META[k].replace('N', v))}</p>
      <div class="stepper"><button onclick="rrStep('${k}',-${st})">−</button><span class="val">${v}</span><button onclick="rrStep('${k}',${st})">＋</button></div></div>`).join('')}
    <div class="paramcard card" data-qk><h4>${P6NAMES.额度刷新秒}</h4><p class="pmeta">${esc(P6META.额度刷新秒.replace('N', (c.quota && c.quota.claudeMinIntervalSeconds) || 300))}</p>
      <div class="stepper"><button onclick="qtStep(-60)">−</button><span class="val">${(c.quota && c.quota.claudeMinIntervalSeconds) || 300}</span><button onclick="qtStep(60)">＋</button></div></div>
    <div class="paramcard card"><h4>服务端口</h4><p class="pmeta">重启监制台后生效</p>
      <div class="runbtn"><input id="port-in" class="mono" style="width:84px;height:32px;padding:0 10px;font-size:12px" value="${(c.server && c.server.port) || 4270}"/>
      <button class="btn h32" style="margin-left:8px" onclick="portSave()">保存</button></div></div>
    <div class="paramcard card"><h4>远程访问</h4><p class="pmeta">手机/其它设备访问监制台（令牌把门 · 重启生效监听）· 只能在本机改</p>
      <div class="runbtn"><button class="btn h32 ${(c.网络 && c.网络.远程 && c.网络.远程.开) ? 'accent' : ''}" onclick="remoteToggle(${!(c.网络 && c.网络.远程 && c.网络.远程.开)})">${(c.网络 && c.网络.远程 && c.网络.远程.开) ? '已开启 · 点击关闭' : '已关闭 · 点击开启'}</button>
      <button class="btn h32" style="margin-left:8px" onclick="remoteToggle(null,true)">重生成令牌</button></div>
      ${(c.网络 && c.网络.远程 && c.网络.远程.令牌) ? `<p class="pmeta mono" style="margin-top:8px;word-break:break-all">手机访问：http://本机IP:${(c.server && c.server.port) || 4270}/?t=${esc(c.网络.远程.令牌)}</p>` : ''}</div>
    <div class="paramcard card" data-theme-card><h4>外观主题</h4><p class="pmeta">暖纸=日间纸感；玻璃=夜间暗色 · 即点即切，本机记忆</p>
      <div class="egtoggle"><button class="egbtn ${curTheme() === 'glass' ? '' : 'on'}" data-th="paper" onclick="themeSet('paper')">暖纸</button><button class="egbtn ${curTheme() === 'glass' ? 'on' : ''}" data-th="glass" onclick="themeSet('glass')">玻璃</button></div></div>`;
  // 兼容池（0.22.1）：Anthropic 兼容厂商——异厂对抗第三池的密钥与模型管理（仅本机可改）
  const compatPools = Object.entries(c.执行池 || {}).filter(([, v]) => v.兼容);
  const compatCards = compatPools.map(([name, v]) => `<div class="paramcard card"><h4>兼容池 · ${esc(name)}</h4>
      <p class="pmeta mono" style="word-break:break-all">${esc(v.兼容.base || '')}<br/>模型 ${esc(v.兼容.模型 || 'CLI 默认')} · 密钥 ${v.兼容.托管 ? ('已迁 DPAPI 托管' + (v.兼容.key ? ' · config 兜底 ' + esc(v.兼容.key) : '')) : esc(v.兼容.key || '未设')} · 职能 ${(v.职能 || []).join('/') || '（评测中·单张盖章）'}</p>
      <div class="runbtn"><button class="btn h32" onclick="compatEdit('${esc(name)}')">更新密钥/模型</button></div></div>`).join('')
    + `<div class="paramcard card"><h4>＋ 新增兼容池</h4><p class="pmeta">任何 Anthropic 兼容厂商（Kimi/GLM/MiniMax…）：池名+端点+密钥即接入 · 密钥只存本机 config，界面与远程只显尾四位</p>
      <div class="runbtn"><button class="btn h32 accent" onclick="compatEdit('')">配置</button></div></div>`;
  // 模型档：池默认 + 裁判档（选项来自 /api/models 监测 + config 增补）
  const mOpt = (pool, cur, key) => { const list = ((models[pool] && models[pool].可选) || []);
    return `<option value="" ${!cur ? 'selected' : ''}>${esc(mEmptyLbl(key))}</option>` + list.map((o) => `<option value="${esc(o)}" ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')
      + (cur && !list.includes(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''); };
  const mc = c.模型 || {};
  const modelCards = [['claude默认', 'claude', 'claude 池体力档'], ['codex默认', 'codex', 'codex 池体力档'], ['质检', 'claude', 'QA 复核档（审检三席）'], ['代核', 'claude', '核查档（原代核·两检深检，H68）'], ['代裁', 'claude', '仲裁档（原代裁，空=跟核查档）'], ['项管', 'claude', '项目管理切单/收口/裁决/答话档（现值 opus，H49 后 2026-08-04 调）']]
    .map(([k, pool, note]) => `<div class="paramcard card"><h4>${k}</h4><p class="pmeta">${note}</p>
      <div class="runbtn"><select class="mselect mono" onchange="mSet('${k}', this.value)">${mOpt(pool, mc[k] || '', k)}</select></div></div>`).join('')
    + `<div class="paramcard card"><h4>可选模型增补</h4><p class="pmeta">监测之外手动补（写进 config.模型.可选）</p>
      <div class="runbtn"><input id="madd-codex" class="mono" placeholder="codex" style="width:90px;height:30px;padding:0 8px;font-size:11px"/><button class="btn h32" style="height:30px;margin:0 6px" onclick="mAdd('codex')">＋</button>
      <input id="madd-claude" class="mono" placeholder="claude" style="width:90px;height:30px;padding:0 8px;font-size:11px"/><button class="btn h32" style="height:30px;margin-left:6px" onclick="mAdd('claude')">＋</button></div></div>`;
  // 执行池阈值（额度锁的杆）
  const poolCards = ['codex', 'claude'].flatMap((pool) => [['阈值', '5h 用量 ≥N% 冻结派发'], ['周阈值', '周用量 ≥N% 冻结派发']].map(([k, note]) => {
    const v = (c.执行池 && c.执行池[pool] && c.执行池[pool][k]) || (k === '阈值' ? 70 : 90);
    return `<div class="paramcard card" data-pl="${pool}.${k}"><h4>${pool} ${k}</h4><p class="pmeta">${note.replace('N', v)}</p>
      <div class="stepper"><button onclick="plStep('${pool}','${k}',-5)">−</button><span class="val">${v}</span><button onclick="plStep('${pool}','${k}',5)">＋</button></div></div>`;
  })).join('');
  const projCard = `<div class="envcard card"><div id="proj-rows">${projRowsHtml(c.项目)}</div>
    <div class="paddrow"><input id="pj-name" class="mono" placeholder="名称" style="width:80px"/><input id="pj-path" class="mono" placeholder="仓库绝对路径" style="flex:1"/>
      <input id="pj-note" placeholder="说明" style="width:100px"/><button class="btn h32" onclick="projAdd()">注册</button></div></div>`;
  const envCard = `<div class="envcard card" id="env-card">
      <div class="eg-head"><span id="env-light" class="pill sm mut">自检中…</span><button class="btn h32" style="margin-left:auto;height:28px" onclick="envProbe(this)">重新自检</button></div>
      <div id="env-body"><p class="dim" style="margin:10px 0 4px">全链路自检运行中…</p></div></div>`;
  const staffCards = ''; const capCard = ''; // 编制/在途上限（D17）已随拉取制退役：派发制并发上限在项管台账（0.23.11）
  
  // 闸门＝**管写的那张表**（2026-08-22 体检 #70/#37）：上一版拿 P6META（说明表）当闸门，
  // 而它是写口白名单的超集——闸值里冒出 全局在途上限 就照样长出一张点一下必 400 的卡。
  // 现在优先认服务端随 /api/config 下发的 闸值白名单（＝ /api/config/gate 的 ALLOW 同一份），
  // 服务端还没下发这一格时回落旧口径（有说明才画），不至于把整个参数区画空。
  // 说明栏保持 (P6META[k] || '') 兜底：白名单里有、说明还没写的，卡照出但不带说明。
  const 闸门 = (k) => (c.闸值白名单 ? c.闸值白名单[k] != null : P6META[k] != null);
  const params = Object.entries(c.闸值 || {}).filter(([k]) => 闸门(k)).map(([k, v]) => `<div class="paramcard card" data-key="${esc(k)}"><h4>${esc(P6NAMES[k] || k)}</h4><p class="pmeta">${esc((P6META[k] || '').replace('N', v))}</p>
      <div class="stepper"><button onclick="pStep('${k}',-1)">−</button><span class="val">${v}</span><button onclick="pStep('${k}',1)">＋</button></div></div>`).join('');
  const recCards = ''; // 精力档/推荐在途（D28）已随拉取制退役（0.23.11）
  void staffCards; void capCard; void recCards; // 退役占位，仅为注释留痕
  // 额度不阻塞首屏：先占位骨架，数据回来原地填（footprint 不变），随后 5s 活体轮询
  let lastPoolJson = '';
  const fillPools = async () => {
    const g = await api('/api/gates');
    const key = JSON.stringify([g.locks.codex, g.locks.claude, g.护城河, g.budget失效, g.budget失败因]);
    if (key === lastPoolJson) return;
    lastPoolJson = key;
    const pc = $('pool-codex'); if (pc) pc.innerHTML = poolCardHtml('codex', g.locks.codex, c.执行池 && c.执行池.codex, g.护城河);
    const pl = $('pool-claude'); if (pl) pl.innerHTML = poolCardHtml('claude', g.locks.claude, c.执行池 && c.执行池.claude, g.护城河);
    const bd = $('budget-dead'); if (bd) bd.innerHTML = budgetDeadHtml(g); // 失效才出，正常时这块是零高度空 div
  };
  setTimeout(() => { fillPools().catch(() => { /* 保持占位，不清空 */ }); }, 0);
  pollLoop('pool-codex', 5000, fillPools);
  // 执行器活体轮询：留在参数页时每 5s 原地刷状态灯/执行中清单，离开视图自动停
  setTimeout(function pollRun() {
    if (!$('run-card')) return;
    setTimeout(async () => {
      if (!$('run-card')) return;
      try {
        const r = await api('/api/runner');
        const dot = $('run-dot'); if (dot) dot.className = dotCls(r);
        const st = $('run-state'); if (st) st.textContent = r.运行 ? '运行中' : '已停';
        const bt = $('run-toggle'); if (bt) { bt.textContent = r.运行 ? '停止' : '启动'; bt.className = 'btn h32' + (r.运行 ? '' : ' primary'); }
        const meta = $('run-meta'); if (meta) { meta.textContent = runMeta(r); meta.title = runMetaFull(r); }
      } catch { /* 下轮再试 */ }
      pollRun();
    }, 5000);
  }, 0);
  // 全链路自检进页自动跑（服务端 60s 缓存，便宜）；按钮=强制复检
  setTimeout(() => { if ($('env-card')) window.envProbe(null); }, 0);
  setTimeout(() => { if ($('creds-card')) window.credsLoad(); }, 0);
  setTimeout(() => { if ($('pb-card')) window.pbLoad(); }, 0); // 池衡矩阵：外呼一次额度/余额，不阻塞首屏
  return `<div class="p6grid"><div>
      <div class="sec-h"><h3 class="h17">执行器</h3><span class="subnote">派发调度循环 · 开 exe 即开工厂</span></div>${runCards}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">参数闸值</h3><span class="subnote">监制台可调</span></div>${params}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">模型档</h3><span class="subnote">贵裁判 · 贱体力（D38）</span></div>${modelCards}${compatCards}</div>
    <div><div class="sec-h"><h3 class="h17">环境探针</h3><span class="subnote">实弹前置检查</span></div>${envCard}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">凭据</h3></div><div id="creds-card" class="card credcard"><p class="dim">读取中…</p></div>
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">项目注册</h3><span class="subnote">执行 agent 的目标仓库（D32）</span></div>${projCard}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">执行池阈值</h3><span class="subnote">额度锁的杆（D26）</span></div>${poolCards}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">额度双池</h3></div>
      <div id="budget-dead"></div>
      <div class="poolcard card" id="pool-codex">${poolCardHtml('codex', null, c.执行池 && c.执行池.codex)}</div>
      <div class="poolcard card" id="pool-claude">${poolCardHtml('claude', null, c.执行池 && c.执行池.claude)}</div>
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">池位矩阵</h3><span class="subnote">H99 项管池衡 · 职能×池×档</span></div>
      <div class="card pbcard" id="pb-card"><p class="dim">读取中…</p></div></div></div>`;
}
// 编制步进：POST 后原地更新该职能人数、在途上限推导值、右侧编制表——视图保持渲染，不整页重载
// sStep（编制步进）已随拉取制退役（0.23.11）；编制管理区整体归项管（H85）

// 调参：POST 后只原地更新该卡片的数字与说明，视图保持渲染、不重载
window.pStep = async (k, delta) => {
  const card = document.querySelector(`.paramcard[data-key="${k}"]`); if (!card) return;
  const valEl = card.querySelector('.val');
  const cur = Number(valEl.textContent);
  const next = cur + delta;
  const r = await post('/api/config/gate', { key: k, value: next });
  if (!r.ok) return toast(r.error || '失败');
  valEl.textContent = String(next); bump(valEl);
  const pm = card.querySelector('.pmeta'); if (pm) pm.textContent = (P6META[k] || '').replace('N', next);
  if (window._p6cfg) window._p6cfg.闸值[k] = next;
  toast(`${P6NAMES[k] || k} → ${next}`);
};
// 执行器启停（D30）：POST 后原地更新状态灯/按钮/说明，不重载
window.runToggle = async () => {
  const on = $('run-state') && $('run-state').textContent === '运行中';
  const r = await post(on ? '/api/runner/stop' : '/api/runner/start', {});
  if (!r.ok) return toast(r.error || '失败');
  const dot = $('run-dot'); if (dot) dot.className = dotCls(r);
  const st = $('run-state'); if (st) st.textContent = r.运行 ? '运行中' : '已停';
  const bt = $('run-toggle'); if (bt) { bt.textContent = r.运行 ? '停止' : '启动'; bt.className = 'btn h32' + (r.运行 ? '' : ' primary'); }
  const meta = $('run-meta'); if (meta) meta.textContent = runMeta(r);
  toast(r.运行 ? '执行器已启动（实弹）' : '执行器已停（执行中的单跑完为止）');
};
// 执行模式开关（试跑/实弹）与实弹解锁已随 H81 常开单闸制拆除：运行即实弹
// 执行器数值参数步进（间隔/超时/记账，通用）
window.rrStep = async (k, delta) => {
  const card = document.querySelector(`.paramcard[data-runkey="${k}"]`); if (!card) return;
  const valEl = card.querySelector('.val');
  const next = Number(valEl.textContent) + delta;
  const r = await post('/api/config/runner', { key: k, value: next });
  if (!r.ok) return toast(r.error || '失败');
  valEl.textContent = String(next); bump(valEl);
  const pm = card.querySelector('.pmeta'); if (pm) pm.textContent = (P6META[k] || '').replace('N', next);
  toast(`${P6NAMES[k] || k} → ${next}`);
};
// 执行池阈值步进（额度锁的杆）
window.plStep = async (pool, key, delta) => {
  const card = document.querySelector(`.paramcard[data-pl="${pool}.${key}"]`); if (!card) return;
  const valEl = card.querySelector('.val');
  const next = Number(valEl.textContent) + delta;
  const r = await post('/api/config/pool', { pool, key, value: next });
  if (!r.ok) return toast(r.error || '失败');
  valEl.textContent = String(next); bump(valEl);
  toast(`${pool} ${key} → ${next}%`);
};
// 额度刷新间隔步进（±60s）
window.qtStep = async (delta) => {
  const card = document.querySelector('.paramcard[data-qk]'); if (!card) return;
  const valEl = card.querySelector('.val');
  const next = Number(valEl.textContent) + delta;
  const r = await post('/api/config/quota', { value: next });
  if (!r.ok) return toast(r.error || '失败');
  valEl.textContent = String(next); bump(valEl);
  const pm = card.querySelector('.pmeta'); if (pm) pm.textContent = P6META.额度刷新秒.replace('N', next);
  toast(`额度刷新间隔 → ${next}s`);
};
// 模型档设置（池默认/裁判档）
window.mSet = async (key, v) => {
  const r = await post('/api/config/model', { key, value: v });
  if (!r.ok) return toast(r.error || '失败');
  if (window._p6cfg) window._p6cfg.模型 = r.模型;
  toast(`${key} → ${v || mEmptyLbl(key)}`);
};
// 可选模型增补
window.mAdd = async (pool) => {
  const inp = $('madd-' + pool); if (!inp || !inp.value.trim()) return;
  const r = await post('/api/config/model-add', { pool, name: inp.value.trim() });
  if (!r.ok) return toast(r.error || '失败');
  if (window._models && window._models[pool]) window._models[pool].可选 = r.可选[pool];
  inp.value = '';
  toast(`${pool} 可选模型 +1（重进本页下拉生效）`);
};
// 项目注册 / 设默认
window.projAdd = async () => {
  const g = (id) => ($(id) ? $(id).value.trim() : '');
  const r = await post('/api/config/project', { 动作: '注册', 名称: g('pj-name'), 路径: g('pj-path'), 说明: g('pj-note') });
  if (!r.ok) return toast(r.error || '失败');
  if (window._p6cfg) window._p6cfg.项目 = r.项目;
  const pc = $('proj-rows'); if (pc) pc.innerHTML = projRowsHtml(r.项目);
  ['pj-name', 'pj-path', 'pj-note'].forEach((i) => { if ($(i)) $(i).value = ''; });
  toast('项目已注册');
};
window.projSet = async (name) => {
  const r = await post('/api/config/project', { 动作: '设默认', 名称: name });
  if (!r.ok) return toast(r.error || '失败');
  if (window._p6cfg) window._p6cfg.项目 = r.项目;
  const pc = $('proj-rows'); if (pc) pc.innerHTML = projRowsHtml(r.项目);
  toast(`默认项目 → ${name}`);
};
function projRowsHtml(项目) {
  const reg = (项目 && 项目.注册) || {}; const def = 项目 && 项目.默认;
  return Object.entries(reg).map(([n, p]) => `<div class="prow"><b class="mono">${esc(n)}</b>
      <span class="pv" title="${esc(p.路径)}">${esc(p.路径)}</span><span class="pn">${esc(p.说明 || '')}</span>
      ${p.引擎 ? `<span class="pill sm mut" title="引擎档案">${esc(p.引擎.类型)}${p.引擎.版本 ? ' ' + esc(p.引擎.版本) : ''}</span>` : ''}
      ${n === def ? '<span class="pill sm ok">默认</span>' : `<button class="btn h32" style="height:26px;padding:0 12px;font-size:11px" onclick="projSet('${esc(n)}')">设默认</button>`}
      <button class="btn danger-o h32" style="height:26px;padding:0 10px;font-size:11px" onclick="projDel('${esc(n)}')">删</button></div>`).join('')
    || '<p class="dim">尚无注册项目</p>';
}
window.projDel = async (name) => {
  if (!await ask(`删除项目注册「${name}」？（有未完成单引用时会被拒绝）`)) return;
  const r = await post('/api/config/project', { 动作: '删除', 名称: name });
  if (!r.ok) return toast(r.error || '失败');
  if (window._p6cfg) window._p6cfg.项目 = r.项目;
  const pc = $('proj-rows'); if (pc) pc.innerHTML = projRowsHtml(r.项目);
  toast(`已删除 ${name}`);
};
// 服务端口（重启生效）
window.portSave = async () => {
  const v = Number($('port-in') && $('port-in').value);
  const r = await post('/api/config/port', { value: v });
  toast(r.ok ? `端口 → ${v}（重启监制台生效）` : (r.error || '失败'));
};
// 环境探针 = 全链路自检（全绿 ⇒ 整个 app 可用）：分组渲染 + 总灯
function envDot(级别) { return 'dot ' + (级别 === '绿' ? 'on' : 级别 === '黄' ? 'warn' : 'err'); }
function envBodyHtml(d) {
  return Object.entries(d.组).map(([g, items]) => `<div class="envgrp"><div class="eg-t">${esc(g)}</div>`
    + items.map((it) => `<div class="envrow"><i class="${envDot(it.级别)}"></i><span class="ek">${esc(it.名称)}</span><span class="ev ${it.级别 === '红' ? 'err' : ''}" title="${esc(it.note)}">${esc(it.note)}</span></div>`).join('')
    + '</div>').join('');
}
window.envProbe = async (btn) => {
  if (btn) { btn.disabled = true; btn.textContent = '自检中…'; }
  try {
    const d = await api('/api/env' + (btn ? '?force=1' : ''));
    const body = $('env-body'); if (body) body.innerHTML = envBodyHtml(d);
    const light = $('env-light');
    if (light) { light.textContent = d.总灯; light.className = 'pill sm ' + (d.总灯 === '就绪' ? 'ok' : d.总灯 === '降级' ? 'warn' : 'red'); light.title = d.结论.join('\n'); }
  } catch { toast('自检失败'); }
  if (btn) { btn.disabled = false; btn.textContent = '重新自检'; }
};
// 精力档切换已随拉取制退役（0.23.11）

// 推荐速度参数步进 window.rStep 已摘（2026-08-22 体检 #58）：它找的 .paramcard[data-rkey] 全库不存在，
// 打的 POST /api/config/recommend 端点也随 D28「推荐在途」退役一并撤了——点了必静默失败。

/* ===== P7 起草 ===== */
function parseSections(body) {
  const out = { 范围: '', 不要做: '', 验收标准: '', 完工要求: '' };
  const parts = String(body || '').split(/^## /m);
  for (const p of parts) { const nl = p.indexOf('\n'); const h = p.slice(0, nl < 0 ? undefined : nl).trim(); const b = nl < 0 ? '' : p.slice(nl + 1).trim();
    for (const k of Object.keys(out)) if (h.startsWith(k)) out[k] = b; }
  return out;
}
async function viewDraft(editId, parent) {
  let t = null;
  const cfgP = api('/api/config').catch(() => ({}));
  if (editId) { const d = await api('/api/ticket?id=' + encodeURIComponent(editId)); if (!d.error) t = d; }
  const cfg = await cfgP;
  const names = Object.keys((cfg.项目 && cfg.项目.注册) || {});
  const dProj = curProj() || (cfg.项目 && cfg.项目.默认) || names[0] || ''; // 起草默认归当前项目语境
  // D43 阶段字典+标准（选阶段自动带入该职能的验收标准）
  const stg = await api('/api/stages?项目=' + encodeURIComponent(dProj)).catch(() => ({ 阶段: [], 标准: {} }));
  window._dStd = stg.标准 || {};
  const fm = t ? t.fm : {};
  // 2026-08-06 UI 评审：新草稿实算下一号预填（占位例「-22」在编号过百的仓里误导）
  let nextId = '';
  if (!editId && dProj) { try { const { all } = await loadBoard(); let mx = 0;
    for (const x of all) { const m = String(x.id).match(/^(.+)-(\d+)$/); if (m && m[1] === dProj) mx = Math.max(mx, Number(m[2])); }
    nextId = `${dProj}-${mx + 1}`; } catch { /* 留占位 */ } }
  const sec = parseSections(t ? t.body : '');
  const opts = (arr, cur) => arr.map((x) => `<option ${x === cur ? 'selected' : ''}>${x}</option>`).join('');
  return `<div class="p7grid">
    <div class="formcard card r16"><h3>工单属性</h3>
      <div class="f-field"><label>编号${nextId ? '（已按仓况预填下一号）' : ''}</label><input id="d-id" class="mono" value="${esc(fm.id || nextId)}" placeholder="${esc(dProj ? dProj + '-#' : 'P-#')}" ${editId ? 'readonly' : ''}/></div>
      <div class="f-field"><label>标题</label><input id="d-title" value="${esc(fm.title || '')}" placeholder="工单标题"/></div>
      <div class="f-2col">
        <div class="f-field"><label>职能</label><select id="d-fn">${opts(cfg.职能 && cfg.职能.length ? cfg.职能 : ['策划', '程序', '美术', 'QA'], fm.职能 || '策划')}</select></div>
        <div class="f-field"><label>产出物</label><select id="d-out">${opts(['文档', '代码', '资产', '规格'], fm.产出物类型 || '文档')}</select></div>
        <div class="f-field"><label>规模</label><select id="d-sc">${opts(['单兵', '小队'], fm.规模 || '单兵')}</select></div>
        <div class="f-field"><label>QA</label><select id="d-qa">${opts(['关', '开'], String(fm.QA || '关'))}</select></div>
        <div class="f-field"><label>验收方式</label><select id="d-acc">${opts(['保留', '委托'], fm.验收方式 || '保留')}</select></div>
        <div class="f-field"><label>优先级</label><select id="d-pri">${opts(['P0', 'P1', 'P2', 'P3'], fm.优先级 || 'P1')}</select></div>
        <div class="f-field"><label>预计时间</label><input id="d-est" value="${esc(fm.预计时间 || '')}" placeholder="1.5h"/></div>
        <div class="f-field"><label>预计token</label><input id="d-tok" value="${esc(fm.预计token || '')}" placeholder="8万"/></div>
        <div class="f-field"><label>项目</label><select id="d-proj">${opts(names.length ? names : [dProj || '未注册'], fm.项目 || dProj)}</select></div>
        <div class="f-field"><label>阶段（D43）</label><select id="d-stg" onchange="dStgFill()">
          <option value="" ${!fm.阶段 ? 'selected' : ''}>不分阶</option>
          ${(stg.阶段 || []).map((s) => `<option value="${esc(s.代号)}" ${fm.阶段 === s.代号 ? 'selected' : ''}>${esc(s.代号)} ${esc(s.名称)}</option>`).join('')}</select></div></div>
      <div class="f-field"><label>依据链 · 策划案#锚号</label><input id="d-ref" class="mono" value="${esc(fm.依据 || '')}" placeholder="战斗系统#战斗-03"/></div>
      <div class="f-field"><label>父单 / 依赖</label><input id="d-par" class="mono" value="${esc(fm.父单 || parent || '')}" placeholder="父单编号"/></div>
    </div>
    <div class="formcard card r16"><h3>工单正文</h3>
      <div class="f-sec"><div class="sh">范围</div><textarea id="d-s1" rows="4">${esc(sec.范围)}</textarea></div>
      <div class="f-sec"><div class="sh">不要做</div><textarea id="d-s2" rows="2">${esc(sec.不要做)}</textarea></div>
      <div class="f-sec"><div class="sh">验收标准 · 要点清单</div><textarea id="d-s3" rows="3" placeholder="□ 要点一　□ 要点二">${esc(sec.验收标准)}</textarea></div>
      <div class="f-sec"><div class="sh">完工要求</div><textarea id="d-s4" rows="2">${esc(sec.完工要求)}</textarea></div>
      <div class="p7foot"><button class="btn h44" onclick="dSave(false)">存为待派</button>
        <button class="btn accent h44" onclick="dSave(true)">定稿并放行</button></div></div></div>`;
}
// D43：选阶段时，验收标准为空则自动带入 阶段标准.md 里该职能该阶段的口径
window.dStgFill = () => {
  const stgK = $('d-stg') ? $('d-stg').value : '';
  const ta = $('d-s3'); if (!ta || !stgK) return;
  const std = (window._dStd && window._dStd[stgK]) || {};
  const fn = $('d-fn') ? $('d-fn').value : '';
  if (!ta.value.trim() && std[fn]) { ta.value = `□ 【${stgK}·${fn}】${std[fn]}`; toast('已带入阶段标准，可增改'); }
};
window.dSave = async (release) => {
  const g = (id) => $(id).value.trim();
  const body = `## 范围\n${$('d-s1').value.trim()}\n\n## 不要做\n${$('d-s2').value.trim()}\n\n## 验收标准 · 要点清单\n${$('d-s3').value.trim()}\n\n## 完工要求\n${$('d-s4').value.trim()}\n`;
  const payload = { id: g('d-id'), title: g('d-title'), 职能: g('d-fn'), 产出物类型: g('d-out'), 规模: g('d-sc'), QA: g('d-qa'), 验收方式: g('d-acc'), 优先级: g('d-pri'), 预计时间: g('d-est'), 预计token: g('d-tok'), 项目: g('d-proj'), 阶段: g('d-stg'), 依据: g('d-ref'), 父单: g('d-par'), body };
  const r = await post('/api/draft', payload);
  if (!r.ok) return toast(r.error || '失败');
  const r2 = await post('/api/act/定稿', { id: payload.id });
  if (!r2.ok && !/待派|待投/.test(r2.error || '')) return toast('已建待审稿，但定稿失败：' + (r2.error || ''));
  const w = r2.警示 ? ' · 警示：' + r2.警示[0] : ''; // H83 短题制预检警示，不拦截只提醒
  if (release) { const r3 = await post('/api/act/放行', { id: payload.id }); if (!r3.ok) return toast('已入待派，放行失败：' + (r3.error || '')); toast('已放行' + w); }
  else toast('已存为待派' + w);
  location.hash = '#/board';
};

/* ===== P8 详情 ===== */
// 引擎作业行（TK-97 案：会话前台等引擎测试，界面上看不出在跑还是卡死）。
// 无锁 → 空串不出行；log 停更 >7 分钟 → 告警色。数据源 /api/ticket.引擎作业 与 /api/runner.引擎作业。
function engJobHtml(j) {
  if (!j) return '';
  const 秒 = j.log秒 == null ? '未见 enginectl-test.log' : `log ${j.log秒} 秒前更新`;
  return `<span class="pill sm ${j.停滞 ? 'red' : 'ok'}">引擎作业在跑</span>
    <span class="mono subnote">pid ${esc(j.pid)}</span>
    <span class="${j.停滞 ? 'err' : 'dim'}" style="font-size:12px">${esc(秒)}${j.停滞 ? ' · 已停更 >7 分钟，疑似卡死' : ''}</span>`;
}
function engJobPill(j) {
  if (!j) return '';
  return `<span class="pill sm ${j.停滞 ? 'red' : 'ok'}" title="引擎作业持锁 pid ${esc(j.pid)}${j.log秒 == null ? '（未见测试日志）' : ` · log ${j.log秒} 秒前更新`}">引擎${j.停滞 ? '停更' : '在跑'}</span>`;
}
// 回执分轮（施工令-034）：多轮回执按「## 第 N 轮回执」或「# 完工报告」切成**全部**段落。
// 返回 [{ 段, 轮, 签 }, …]，末项恒为最新一轮；单轮回执返回长度 1 且 轮/签 为空——
// 调用方据此决定「出不出页签」，单轮单因此一个像素都不变。
//
// 轮号一律按**段序**数，不认标题里自称的号：TK-114 真数据里两个小节都写着「## 第 2 轮回执」
// （返修时照抄了上一轮的标题），信标题就会出现两个「第 2 轮」页签、点了不知道点中哪个。
// 段序是文件里的物理先后，永远唯一、永远单调，这是这里唯一可信的排序依据。
function 回执分轮(raw) {
  const s = String(raw || '');
  const 切 = (re, 名) => {
    const 段s = s.split(re).filter((x) => x.trim());
    if (段s.length <= 1) return null;
    return 段s.map((段, i) => ({ 段, 轮: `${名(i + 1, 段s.length)}`, 签: i === 段s.length - 1 ? '最新' : `第 ${i + 1} 轮` }));
  };
  return 切(/^(?=##\s*第\s*\d+\s*轮回执)/m, (i, n) => (i === n ? `第 ${i} 轮（最新）` : `第 ${i} 轮`))
    || 切(/^(?=#\s+完工报告)/m, (i, n) => (i === n ? `第 ${i} 份（最新，共 ${n} 份）` : `第 ${i} 份`))
    || [{ 段: s, 轮: '', 签: '' }];
}
// 正文/回执中最后一个 QA 章的结论摘要（≤10 行）：优先结论/不过项行，无则取章首几行
function 最新QA摘要(raw, body) {
  const pick = (src) => {
    const secs = String(src || '').split(/^##+\s*/m).filter((p) => /^(QA|质检|初检|核验|QA\s*核验)/i.test(p.trim()));
    if (!secs.length) return '';
    const 章 = secs[secs.length - 1];
    const lines = 章.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    const hit = lines.filter((l) => /结论|不过|未过|失败|缺|问题|原因|建议/.test(l));
    return (hit.length ? hit : lines).slice(0, 10).join('\n');
  };
  return pick(raw) || pick(body) || '';
}
/* 待处理卷宗「上呈原因」取数（施工令-012 / 巡礼 P2-3；原「待定夺」，三大态改造并入 待处理）。
   ① fm.上呈原因 是事实源——lifecycle 在流转进待处理时就落库（优化-D 通则）。
   ② 只有没有该字段的老单才退回 grep 流水，且先剔噪声行：滞留检查每 30 分钟给滞留单追加一条
      「滞留告警 X（待处理 停留 7h…）」，旧的二级正则宽匹配正好命中它，把卷宗最重要的
      一栏顶成误导信息；「裁决」行是裁决结果不是上呈原因，同样排除。
   ③ 二级兜底收紧为「上呈」或明确的「→ 待处理/待定夺」转移行（旧词兼容历史流水），不再见字就收。
   纯函数，无 DOM 依赖——test/escalation.test.js 按下面的标记原样抽出来跑。 */
// @testable-begin escalReason
function escalReason(fm, lines, id) {
  const f = fm || {};
  const 字段 = String(f.上呈原因 || '').trim();
  if (字段) return 字段;
  const 噪声 = /滞留告警|滞留检查|巡检|待定夺裁决|待处理裁决|心跳/;
  const rev = (lines || []).filter((l) => String(l).includes(id) && !噪声.test(l)).reverse();
  const 上呈行 = rev.find((l) => /修不好|失败分诊|评估回呈|仲裁/.test(l))
    || rev.find((l) => /上呈|→\s*(待定夺|待处理)/.test(l)) || '';
  return 上呈行
    || (f.自修次数 ? `QA 自修 ${f.自修次数} 轮未过 → 三振上呈` : '')
    || (f.失败原因 ? `执行失败上呈：${String(f.失败原因).slice(0, 120)}` : '')
    || '（流水与工单里都没记到上呈原因）';
}
// @testable-end escalReason

// @testable-begin artifactsPanel
// 产出速览（施工令-051）：解析出真路径才列表；一条都没有时给中性占位，绝不出红「缺失」。
// 案源 TK-160：菜单路径与「2.21/2.46 km」被当交付文件去磁盘找，满屏假红把真缺失淹了——
// 红色是「回执声称交了、仓里却没有」的专用信号，声称本身不成立时它没有资格出现。
function artifactsPanel(id, 产出) {
  if (!产出) return '';                                  // 无回执 / 无所属项目：整块不出
  const 行 = 产出.产出 || [];
  const 头 = '<div class="p8main card r16"><b style="font-size:13px">产出速览</b>';
  if (!行.length) {
    return `${头}<span class="subnote" style="margin-left:8px">无产出物声明 · 回执未写明仓内文件路径</span></div>`;
  }
  return `${头}
        <span class="subnote" style="margin-left:8px">${产出.来源 === '结构化' ? '回执产出章节' : '从回执正文解析'} · 点击调起本机查看</span>
        ${行.map((a) => `<div class="prow" style="margin-top:8px">
          <span class="pv mono" style="flex:1" title="${esc(a.路径)}">${esc(a.路径)}</span>
          ${a.存在 ? `<span class="pill sm ok">${a.大小 > 1048576 ? (a.大小 / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(a.大小 / 1024)) + ' KB'}</span>
            <button class="btn h32" style="height:26px;padding:0 12px;font-size:11px" onclick="openArt('${esc(id)}','${esc(a.路径)}','文件')">打开</button>
            <button class="btn h32" style="height:26px;padding:0 10px;font-size:11px" onclick="openArt('${esc(id)}','${esc(a.路径)}','文件夹')">文件夹</button>`
    : '<span class="pill sm red" title="回执声称的产出在项目仓找不到">缺失</span>'}</div>`).join('')}</div>`;
}
// @testable-end artifactsPanel

async function viewDetail(id) {
  const d = await api('/api/ticket?id=' + encodeURIComponent(id));
  if (d.error) return `<p class="err" style="margin-top:30px">${esc(d.error)}</p>`;
  const fm = d.fm, c = d.链 || { 父子: { 父: null, 子: [] }, 依赖: [] };
  // ---- 在途细粒度进度（用户定稿：详情页最上层=进度条+步骤详情+秒级走表）----
  let liveHtml = '';
  if (['在途', '初检', '核查', '仲裁', '完成', '待处理'].includes(d.state)) {
    const run = await api('/api/runner').catch(() => ({}));
    const live = (run.执行中 || []).find((x) => x.id === id) || null;
    if (live || ['在途', '初检', '核查', '仲裁'].includes(d.state)) {
      // 审检链目录化（H108）：执行完 QA开→初检→核查→(争议)仲裁→完成；QA关→核查（简检）→完成；
      // 免检保留单→直接完成。阶段序列以 lib/progress.js 随会话下发的 进度.段 为准，
      // 下面这套按状态硬排的段名只当无会话时的兜底，两处不许各画各的（施工令-049 同源纪律）。
      const qaOn = fm.QA !== '关';
      const 免检 = fm.验收方式 === '保留'; // 免检保留单：不走审检链，执行完直接完成
      const KIND名 = { 执行: '执行', 质检: '初检', 初检: '初检', 代核: '核查', 核查: '核查', 代裁: '仲裁', 仲裁: '仲裁' };
      const 有争议 = d.state === '仲裁' || !!(live && KIND名[live.kind] === '仲裁');
      const names = ['领单', '执行']
        .concat(免检 ? [] : [...(qaOn ? ['初检'] : []), '核查', ...(有争议 ? ['仲裁'] : [])])
        .concat(['完成']);
      const doneUpto = { 在途: '领单', 初检: '执行', 核查: (qaOn && !免检) ? '初检' : '执行', 仲裁: '核查' }[d.state] || '领单';
      const curName = live ? (KIND名[live.kind] || live.kind)
        : ({ 在途: '执行', 初检: '初检', 核查: '核查', 仲裁: '仲裁' }[d.state] || null);
      const di = names.indexOf(doneUpto);
      // 段与填充口径同源（施工令-049）：有会话时直接吃 /api/runner 随行下发的 进度.段——
      // 详情页自己那套按状态硬排的段名只当无会话时的兜底，两处不许各画各的。
      const pg = (live && live.进度) || null;
      const segs = pg && pg.段 && pg.段.length
        ? pg.段.map((s) => [s.名, s.态, s.态 === 'cur' ? (s.填充 || 0) : (s.态 === 'done' ? 1 : 0), s.超期pct || 0])
        : names.map((k, i) => [k, k === curName ? (live ? 'cur' : 'wait') : i <= di ? 'done' : 'todo', 0, 0]);
      liveHtml = `<div class="livecard card r16" id="lvcard">
        <div class="lv-top"><b style="font-size:13px">执行进度</b>
          <span class="pill sm ${live ? 'ok' : 'mut'}" id="lv-who">${live ? esc(live.agent) + ' · ' + esc(live.kind) : '等待执行器衔接（间隔 ' + (run.间隔秒 || 15) + 's）'}</span>
          ${pg ? `<span class="lv-pct mono" title="${esc(pctTitle(pg))}">${pg.百分比}%</span>` : ''}
          <span class="sp"></span>
          <span class="lv-t mono" id="lv-step-t" data-live>--:--</span><span class="subnote">本步</span>
          <span class="lv-t mono" id="lv-all-t" data-live>--:--</span><span class="subnote">全程</span></div>
        <div class="lv-bar">${segs.map(([k, s, f, over]) => `<div class="lv-seg ${s}${s === 'cur' && over ? ' warn' : ''}">
          <i>${s === 'cur' ? `<em style="--fill:${Math.round(f * 100)}%"></em>` : ''}</i>
          <span>${esc(k + (over ? ` · 超预期 ${over}%` : ''))}</span></div>`).join('')}</div>
        <div class="lv-tail mono" id="lv-tail">${live && live.tail ? esc(live.tail) : '（尚无输出）'}</div></div>`;
      setTimeout(() => lvStart(id, live ? live.startedAt : null, fm.领单时间 || fm.更新时间 || null, live ? live.kind : null), 0);
    }
  }
  // ---- 引擎作业（有锁才出行）：会话在前台等 Unity/Godot 测试时，界面得看得见它在跑 ----
  let engHtml = '';
  if (d.引擎作业) {
    engHtml = `<div class="card r14" id="engjob" style="padding:10px 16px;margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <b style="font-size:13px">引擎作业</b>${engJobHtml(d.引擎作业)}
      <span class="subnote">项目 ${esc(fm.项目 || '—')} · 锁 .enginectl-lock</span></div>`;
    // 心跳原地刷新：离开详情页自动停（pollLoop 以元素存在为守卫）
    pollLoop('engjob', 5000, async () => {
      const r = await api('/api/runner');
      const j = (r.引擎作业 || {})[fm.项目];
      const el = $('engjob');
      if (!el) return;
      if (!j) { el.remove(); return; } // 锁没了＝作业收工，行自行消失
      el.innerHTML = `<b style="font-size:13px">引擎作业</b>${engJobHtml(j)}<span class="subnote">项目 ${esc(fm.项目 || '—')} · 锁 .enginectl-lock</span>`;
    });
  }
  // ---- 待处理卷宗（TK-97 案：上呈时详情页看不到发生了什么；原「待定夺」并入 待处理）----
  let escalHtml = '';
  if (d.state === '待处理') {
    const jl = await api('/api/journal').catch(() => ({ lines: [] }));
    const 原因 = escalReason(fm, jl.lines || [], id);
    const qa = 最新QA摘要(d.回执 ? d.回执.raw : '', d.body);
    const dirs = String(d.body || '').split(/^## /m).filter((p) => p.startsWith('定夺方向')).reverse();
    const arb = fm.代裁 ? `<span class="pill sm ${fm.代裁.结论 === '给方向' ? 'ok' : 'mut'}">代裁 · ${esc(fm.代裁.结论)}</span>` : '';
    const dirHtml = dirs.length ? dirs.map((p) => {
      const nl = p.indexOf('\n');
      return `<div class="rsec"><div class="rl">${esc((nl < 0 ? p : p.slice(0, nl)).replace(/^定夺方向/, '定夺方向 '))}</div>
        <div class="rv" style="white-space:pre-line">${esc((nl < 0 ? '' : p.slice(nl + 1)).trim().split('\n').slice(0, 12).join('\n'))}</div></div>`;
    }).join('') : '<div class="rsec"><div class="rl">历史定夺方向</div><div class="rv dim">（尚未给过方向——这是第一次上呈）</div></div>';
    escalHtml = `<div class="p8main card r16" style="border-color:var(--gateln)">
      <b style="font-size:13px">待处理卷宗</b>
      <span class="subnote" style="margin-left:8px">为什么呈到你手上 · 判官说了什么 · 之前给过什么方向</span>
      ${fm.自修次数 ? `<span class="pill sm red" style="margin-left:8px">自修 ${esc(fm.自修次数)} 轮</span>` : ''}${arb}
      <div class="rsec"><div class="rl">上呈原因</div><div class="rv" style="white-space:pre-line">${esc(原因)}</div></div>
      <div class="rsec"><div class="rl">最新 QA 结论</div><div class="rv" style="white-space:pre-line">${esc(qa || '（回执与正文里都没找到 QA 章）')}</div></div>
      ${dirHtml}</div>`;
  }
  const chainRow = (k, v, cls) => `<div class="crow"><span class="ck">${k}</span><span class="cv ${cls || ''}">${v || '—'}</span></div>`;
  const kidsTxt = (c.父子.子 || []).map((x) => `<a href="#/t/${x.id}" style="color:var(--accent-ink)">${esc(x.id)}</a>(${esc(x.state)})`).join('、');
  // ---- 子单层级一览（施工令-028：树形退役，这张表是它唯一不可替代的那半）----
  // 进度列由 lib/trace 服务端算，口径与退役前树形逐字同一把尺（叶子取状态完成度、父单取子单均值）。
  const 子单 = c.父子.子 || [];
  // 候验清单：lib/trace 下发（三大态改造后该键该指「完成候验」的子单；旧键名兼容读，收口对齐见 need_coord）
  const 候验单 = c.父子.候验 || c.父子.完成候验 || c.父子.待验收 || [];
  const 候验数 = 候验单.length;
  const kidsTable = 子单.length ? `<div class="p8main card r16"><b style="font-size:13px">子单 ${子单.length}</b>
      <span class="subnote" style="margin-left:8px">点行进详情 · 进度=叶子按状态、父单按子单均值${候验数 ? ` · ${候验数} 张候验收` : ''}</span>
      <div class="kidtbl-wrap"><table class="kidtbl"><thead><tr>
        <th>子单号</th><th>标题</th><th>状态</th><th>进度</th><th>池</th></tr></thead><tbody>
        ${子单.map((x) => `<tr onclick="location.hash='#/t/${encodeURIComponent(x.id)}'" title="${esc(x.title || '')}">
          <td class="mono kid-id">${esc(x.id)}${x.子数 ? `<span class="pill sm mut" style="margin-left:6px">${x.子数} 子</span>` : ''}</td>
          <td class="kid-t">${esc(x.title || '')}</td>
          <td>${stPill(x.state)}</td>
          <td class="kid-p"><span class="bar"><i style="width:${Number(x.进度) || 0}%"></i></span><span class="pv">${Number(x.进度) || 0}%</span></td>
          <td class="mono kid-pool">${esc(x.执行池 || '—')}</td></tr>`).join('')}
      </tbody></table></div></div>` : '';
  let rsecs = '';
  if (d.回执) {
    // 一轮回执 → 一屏四件套。解析口径与改版前一字未动，只是从「只解析最新一轮」
    // 改成「每轮各解析一份」，好让下面按轮出页签。
    const 轮Html = ({ 段, 轮 }) => {
      const secs = { 验收步骤: '', 做了什么: '', 'QA 章节': '', 实际消耗: '', 异议: '' };
      const SECLN = { 验收步骤: 8, 做了什么: 4 }; // 验收步骤给足行数——制作人按此动手（用户定稿）
      段.split(/^## /m).forEach((p) => { const nl = p.indexOf('\n'); const h = p.slice(0, nl < 0 ? undefined : nl).trim();
        for (const k of Object.keys(secs)) if (h.startsWith(k) || (k === 'QA 章节' && /QA/.test(h))) secs[k] = (nl < 0 ? '' : p.slice(nl + 1)).trim().split('\n').slice(0, SECLN[k] || 1).join('\n'); });
      if (!secs.验收步骤) delete secs.验收步骤; // 委托单免写，不占位
      // 判「标准回执」以 做了什么 为准：这章都没有的，四件套摆出来就是一排「—」的空壳（TK-97 案），
      // 一律补末尾 8 行原文——宁可给制作人原文，也不给他一屏破折号。
      const 标准 = !!(secs.做了什么 && secs.做了什么.trim());
      const 有货 = Object.entries(secs).filter(([, v]) => v && v.trim());
      const 章节Html = (list) => list.map(([k, v]) => `<div class="rsec"><div class="rl">${k}</div><div class="rv" style="white-space:pre-line">${esc(v || '—')}</div></div>`).join('');
      if (标准) return (轮 ? `<div class="subnote" style="margin:8px 0 2px">${esc(轮)}</div>` : '') + 章节Html(Object.entries(secs));
      const tail = 段.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-8).join('\n');
      return `<div class="subnote" style="margin:8px 0 2px">非标回执（未见「做了什么」章）${轮 ? ' · ' + esc(轮) : ''} · 附末尾 8 行原文</div>
        ${章节Html(有货)}
        <div class="rsec"><div class="rl">回执原文</div><div class="rv mono" style="white-space:pre-line">${esc(tail || '（回执为空文件）')}</div></div>`;
    };
    const 轮s = 回执分轮(d.回执.raw);
    if (轮s.length <= 1) {
      rsecs = 轮Html(轮s[0]); // 单轮回执：无页签、无容器，与改版前逐字节一致
    } else {
      // 多轮：页签 + 每轮一个 pane。全部轮次一次性渲染进 DOM，切换只改 class——
      // 详情页是整页字符串渲染的，若切页签要走 route() 重渲染，就会把滚动位置和展开态一起丢掉。
      const 默认 = 轮s.length - 1; // 默认落最新一轮
      const tabs = 轮s.map((r, i) => `<button class="rtab${i === 默认 ? ' on' : ''}" data-rtab="${i}"
        onclick="rcvRound(this,${i})">${esc(r.签)}</button>`).join('');
      const panes = 轮s.map((r, i) => `<div class="rtab-pane${i === 默认 ? ' on' : ''}" data-rpane="${i}">${轮Html(r)}</div>`).join('');
      rsecs = `<div class="rtabs" role="tablist">${tabs}</div>${panes}`;
    }
  }
  // ---- 已挂起横幅（施工令-021）：顶在最上层，挂起人/时间/理由/解挂按钮一屏交代完 ----
  // 放在 engHtml/liveHtml 之前——制作人打开一张冻结单，第一眼要看到的是「它被你按停了」，
  // 而不是一条还在走表的进度条。
  let suspHtml = '';
  const 已挂 = d.state === '挂起' || !!fm.挂起; // 挂起已升目录态；fm.挂起 是老标记形态的存量（迁移由总控做），两种都认
  if (已挂) {
    const s = fm.挂起 || {};
    const 子挂 = (c.父子.子 || []).length; // 有子单的父单：解挂时问一句要不要连子单一起放
    suspHtml = `<div class="suspbar" id="suspbar">
      <span class="snowb" style="font-size:16px">❄</span><b>已挂起 · 冻结</b>
      <span class="sbwho">${esc(s.操作者 || '制作人')} · ${esc(String(s.时间 || '').slice(0, 16).replace('T', ' '))}${s.挂起时状态 ? ' · 挂起于「' + esc(s.挂起时状态) + '」' : ''}${s.连带自 ? ' · 随父单 ' + esc(s.连带自) + ' 全树挂起' : ''}</span>
      <span class="sp"></span>
      <button class="btn accent h32" onclick="suspAsk('${esc(id)}',false,${子挂 ? 'true' : 'false'})">解挂 · 回待重派</button>
      <span class="sbwhy">派发 / 领单 / 初检 / 核查 / 仲裁 / 巡检告警全部跳过本单；挂起是唯一可逆终态（H108），解挂后转「待重派」重新排队。${s.理由 ? '<br>理由：' + esc(s.理由) : ''}</span></div>`;
  }
  const ops = [];
  // 挂起/解挂（施工令-021 → H108 目录态化）：挂起入口只在状态机允许的边上出
  //（TRANSITIONS：待派/待重派/在途 → 挂起；挂起 → 待重派 唯一可逆）。
  // 位置放在操作栏最前：这是「先停下」的闸，它比任何往前推的动作都优先。
  const 有子 = (c.父子.子 || []).length;
  if (已挂) ops.push(['解挂', `转「待重派」重新排队（挂起是唯一可逆终态，H108）${有子 ? '（可连带子单）' : ''}`, `suspAsk('${id}',false,${有子 ? 'true' : 'false'})`]);
  else if (['待派', '待重派', '在途'].includes(d.state)) ops.push(['挂起', `冻结进「挂起」目录态：全链路跳过${有子 ? `（可连带 ${有子} 张子单全树挂起）` : ''}`, `suspAsk('${id}',true,${有子 ? 'true' : 'false'})`]);
  if (d.state === '待派') ops.push(['撤回', '回待审（撤下排队）', `act2('撤回','${id}')`]);
  if (d.state === '在途') ops.push(['收回', '从执行方取回在途单', `act2('收回','${id}')`]);
  if (fm.待复核) ops.push(['解除复核', `上游 ${esc(fm.待复核.锚号 || '')} 已核对新版`, `act2('解除复核','${id}')`]); // D36
  if (d.state === '待处理') { // 分诊三出路（原 执行失败/待定夺 两态并入 待处理；废弃在下方通用项）+ H65 返修
    ops.push(['重投', `清执行痕迹转待重派重领${fm.失败原因 ? '（' + esc(String(fm.失败原因).slice(0, 24)) + '）' : ''}`, `act3('失败分诊','${id}','重投')`]);
    ops.push(['返修', `同号回待审改写（第 ${(fm.返修轮 || 0) + 1} 轮，计数保留，H65）`, `act2('返修','${id}')`]);
    ops.push(['给方向', '写清怎么改 → 回炉重做（自修计数清零）', `dirModal('${id}')`]);
  }
  if (d.state === '完成') { // 三大态改造：完成=判官已过、候验收的驻留位。散单/保留单单独走验收闸（H110）
    ops.push(['验收归档', '验收通过 → 归档落袋（保留单品味终审不可代签，H11；成批的等专项关账级联归档）', `askAccept('${id}',true)`]);
    ops.push(['返修', `不过关但同一件活：同号回待审改写（第 ${(fm.返修轮 || 0) + 1} 轮，H65）`, `act2('返修','${id}')`]);
  }
  if (d.state === '待审') ops.push(['定稿', '审过 → 待派（总监审核闸）', `act2('定稿','${id}')`]);
  if (d.state === '待派') ops.push(['放行', '项管闸放行（落 fm.放行 标记，依赖就绪即自动派发，H109）', `act2('放行','${id}')`]);
  // 废弃（带因）：按状态机允许的边出（终态与 完成/挂起 不可废弃；历史废弃单留在归档不改史）
  if (['待审', '待派', '待处理', '待重派', '在途', '初检', '核查', '仲裁'].includes(d.state))
    ops.push(['废弃', '进废弃态（留档不删，R2；返工另开新单）', `dropModal('${id}')`]);
  if (d.state === '待审') ops.push(['编辑', '打开起草页修改', `location.hash='#/draft?edit=${id}'`]);
  if (['完成', '归档'].includes(d.state)) { // 审批点④：入库（D12 精选制，唯一写者=制作人层）
    if (fm.职能 === '策划') ops.push(['入标杆', '提炼进设计公理（审批点④）', `axModal('${id}')`]);
    if (fm.职能 === '美术' || fm.职能 === '装配') ops.push(['入美术库', '产出精选进风格库（审批点④）', `artModal('${id}')`]);
  }
  // 批量验收子单（施工令-028 从树形迁入）：只在真有候验子单时出按钮——与退役前
  // 「acceptN ? 出按钮 : 不出」同款条件，不给一个点了没反应的钮。带确认门，行为不扩权。
  if (候验数) ops.push([`✓ 批量验收子单 ×${候验数}`, `该父单下 ${候验数} 张完成候验子单一次性验收归档（只动完成态，孙单不连带）`, `acceptKids('${id}')`]);
  if (['完成', '归档'].includes(d.state)) ops.push(['推翻重做', '翻案：旧单落档+自动开返工新单（落待审，须写理由）', `overturnModal('${id}')`]);
  if (d.state === '归档') ops.push([fm.隐藏 ? '取消隐藏' : '隐藏归档', fm.隐藏 ? '重新出现在归档列表' : '从一切默认视图湮灭（纸面仍可考）', `toggleHide('${id}',${fm.隐藏 ? 'false' : 'true'})`]);
  return `${suspHtml}${engHtml}${liveHtml}<div class="p8grid"><div>
      <div class="p8main card r16"><h2>${esc(id)} · ${esc(fm.title)}</h2>
        <div class="chipsrow">${fnPill(fm.职能)}<span class="pill mut">${esc(fm.产出物类型 || '')}</span>
          <span class="pill ${fm.验收方式 === '委托' ? 'mut' : 'ok'}">${esc(fm.验收方式 || '保留')}</span><span class="pill mut">${esc(fm.规模 || '')}</span>
          ${已挂 ? `<span class="pill susp-p" title="${esc(suspTip({ 挂起: fm.挂起 || { 操作者: '制作人' } }))}">❄ 已挂起</span>` : ''}
          ${fm.待复核 ? `<span class="pill red" title="${esc(fm.待复核.说明 || '')}">待复核 · ${esc(fm.待复核.锚号 || '')}</span>` : ''}
          ${fm.代核 ? `<span class="pill ${fm.代核.结论 === '通过' ? 'ok' : 'red'}">核查${esc(fm.代核.结论)}</span>` : ''}</div>
        <div class="chain"><div class="clbl">追溯链</div>
          ${chainRow('父单', c.父子.父 ? `<a href="#/t/${c.父子.父}" style="color:var(--accent-ink)">${esc(c.父子.父)}</a>` : null)}
          ${/* 专项归属（施工令-058）：容器不是工单，点过去是专项页而不是某张单的详情 */ ''}
          ${chainRow('专项', c.专项 ? `<a href="#/specials" style="color:var(--accent-ink)">${esc(c.专项.id)}</a>`
    + (c.专项.名称 ? ` <span class="dim">${esc(c.专项.名称)}${c.专项.状态 ? ' · ' + esc(c.专项.状态) : ''}</span>`
      : ' <span class="dim">（注册表里查无此号——挂链写错了？）</span>') : null)}
          ${chainRow('子单', kidsTxt)}
          ${chainRow('返工自', c.返工自 ? esc(c.返工自) : null)}
          ${chainRow('依据', c.依据 ? `<span style="color:var(--accent-ink)">${esc(c.依据)}</span>` : null)}
          ${chainRow('依赖', (c.依赖 || []).map((x) => `${esc(x.id)}(${esc(x.state)})`).join('、'), 'okc')}</div></div>
      ${kidsTable}
      ${escalHtml}
      ${artifactsPanel(id, d.产出)}
      <div class="p8main card r16"><b style="font-size:13px">正文</b><div class="doc2">${d.html || '<p class="dim">无正文</p>'}</div></div>
    </div><div>
      <div class="rside card r16"><h3>回执 · 完工报告</h3>${rsecs || '<p class="dim" style="margin-top:10px">尚无回执（完工后生成）</p>'}</div>
      <div class="rside card r16"><h3>操作</h3>
        ${ops.map(([b, s, fn]) => `<button class="oprow2" onclick="${fn}"><b>${b}</b><span>${s}</span></button>`).join('')}
        <div class="subnote" style="margin-top:14px">预计 ${esc(fm.预计时间 || '—')} · ${esc(fm.预计token || '—')} · 状态 ${esc(d.state)}</div></div></div></div>`;
}
// 回执轮页签切换（施工令-034）：纯 DOM class 开关，不重渲染、不重取数——
// 详情页整页是字符串拼出来的，走 route() 会连滚动位置一起丢。作用域锁在本卡片内，
// 一页上若将来出现第二处轮页签也互不干扰。
window.rcvRound = (btn, i) => {
  const card = btn.closest('.rside') || document;
  card.querySelectorAll('[data-rtab]').forEach((b) => b.classList.toggle('on', Number(b.dataset.rtab) === i));
  card.querySelectorAll('[data-rpane]').forEach((p) => p.classList.toggle('on', Number(p.dataset.rpane) === i));
};
// 预检警示（H83 短题制）：动作照常完成，只把提醒端到眼前
window.act2 = async (name, id) => { const r = await post('/api/act/' + name, { id }); toast(r.ok ? (r.警示 ? '完成 · 警示：' + r.警示[0] : '完成') : (r.error || '失败')); route(); };
// 批量验收子单（施工令-028：原树形 tAcceptAll 迁入父单详情页）。
// 与原实现的差别只有两处，都是为了更稳，不是为了更强：
//   ① 射程清单**开火前重取**（/api/ticket 的 链.父子 候验清单，规则在 lib/trace 一处定义）——
//      详情页可能开着好一会儿，拿渲染时的旧名单去批量改状态是在赌；
//   ② 重取后为空时只吐一句提示、一个请求都不发（原实现会弹一个「批量验收 0 张？」的确认门）。
// 过滤条件本身一字未动：只动该父单**直系**子单里停在「完成」候验的那些，孙单不连带。
window.acceptKids = async (pid) => {
  const d = await api('/api/ticket?id=' + encodeURIComponent(pid)).catch(() => null);
  const fz = (d && d.链 && d.链.父子) || {};
  const ids = fz.候验 || fz.完成候验 || fz.待验收 || []; // 旧键名兼容读（trace 收口对齐见 need_coord）
  if (!ids.length) return toast('没有完成候验的子单（可能刚被验收过）');
  if (!await ask(`批量验收 ${pid} 下 ${ids.length} 张完成候验子单？`)) return;
  let ok = 0; const 失败 = [];
  for (const cid of ids) {
    const r = await post('/api/act/验收', { id: cid, 通过: true });
    if (r && r.ok) ok++; else 失败.push(cid);
  }
  toast(失败.length ? `已验收 ${ok} 张，${失败.length} 张失败：${失败.slice(0, 3).join('、')}` : `已验收 ${ok} 张`);
  route();
};
window.overturnModal = (id) => showModal(`<h3>推翻重做 ${esc(id)}</h3>
  <p class="subnote" style="margin-top:6px">旧单落档 + 自动编号开返工新单（落待审，带返工链），下游依赖自动接续。理由必填，进新单正文与流水。</p>
  <textarea id="ov-r" style="width:100%;height:90px;margin-top:12px" placeholder="为什么翻案：哪里完全不行、新的要求方向是什么"></textarea>
  <div class="p7foot" style="margin-top:14px"><button class="btn h32" onclick="this.closest('.mwrap').remove()">取消</button>
  <button class="btn accent h32" onclick="doOverturn('${esc(id)}',this)">推翻并开返工单</button></div>`);
window.doOverturn = async (id, btn) => {
  const 理由 = $('ov-r').value.trim();
  if (!理由) return toast('理由必填');
  btn.disabled = true;
  const r = await post('/api/act/推翻', { id, 理由 });
  if (!r.ok) { btn.disabled = false; return toast(r.error || '失败'); }
  btn.closest('.mwrap').remove();
  toast(`已推翻 → 新单 ${r.新单}`);
  location.hash = '#/draft?edit=' + encodeURIComponent(r.新单);
};
window.toggleHide = async (id, on) => { const r = await post('/api/act/隐藏', { id, 值: on }); toast(r.ok ? (on ? '已湮灭出视野' : '已恢复可见') : (r.error || '失败')); if (r.ok) location.hash = on ? '#/board' : location.hash, route(); };
window.remoteToggle = async (开, regen) => {
  const body = regen ? { 重生成令牌: true } : { 开 };
  const r = await post('/api/config/remote', body);
  if (!r.ok) return toast(r.error || '失败');
  toast(regen ? '令牌已重生成' : (r.远程.开 ? '远程已开（重启监制台生效）' : '远程已关（重启生效）'));
  window._p6cfg = null; route();
};
window.openArt = async (id, p, mode) => { const r = await post('/api/open', { id, 路径: p, 方式: mode }); if (!r.ok) toast(r.error || '调起失败'); };
// 秒级走表：1s 本地跳字，每 3s 拉一次 runner 刷活尾巴；步骤切换/落袋整页重渲；离开详情自动熄火
window.lvStart = (id, stepIso, allIso, kind) => {
  // 施工令-048 要件3：脉冲原地重绘会把 viewDetail 再跑一遍、再叫一次 lvStart。
  // 同一条走表（单号/步骤/起时都没变）就让它继续走——重开表会把 n 计数清零（3s 那次
  // runner 对账永远轮不到），两个 data-live 格子也会被新表从 --:-- 重新起跳，看着就是闪。
  const key = [id, stepIso, allIso, kind].join('|');
  if (window._lv && window._lvKey === key && $('lv-step-t')) return;
  window._lvKey = key;
  clearInterval(window._lv || 0);
  let n = 0, had = !!stepIso, step = stepIso;
  const fmt = (ms) => { if (ms == null || ms < 0) return '--:--'; const s = Math.floor(ms / 1000);
    return (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  window._lv = setInterval(async () => {
    const el = $('lv-step-t');
    if (!el) { clearInterval(window._lv); window._lv = 0; window._lvKey = ''; return; } // 已离开详情页
    el.textContent = step ? fmt(Date.now() - Date.parse(step)) : '--:--';
    const at = $('lv-all-t'); if (at && allIso) at.textContent = fmt(Date.now() - Date.parse(allIso));
    if (++n % 3 !== 0) return;
    try {
      const run = await api('/api/runner');
      const e = (run.执行中 || []).find((x) => x.id === id);
      if (e) { had = true; step = e.startedAt;
        if (e.kind !== kind) { repaint('换步骤'); return; } // 换步骤 → 重渲进度条（原地，不整页）
        const tl = $('lv-tail'); if (tl && e.tail) tl.textContent = e.tail;
        const who = $('lv-who'); if (who) { who.textContent = e.agent + ' · ' + e.kind; who.className = 'pill sm ok'; }
      } else if (had) { repaint('本步收线'); return; } // 本步收线（流转/落袋）→ 重渲拿新状态
    } catch { /* 单次失败下轮再试 */ }
  }, 1000);
};
// 入库弹窗（审批点④）
function showModal(inner) {
  const w = document.createElement('div'); w.className = 'mwrap';
  w.innerHTML = `<div class="mback"></div><div class="modal2 card r16">${inner}</div>`;
  w.querySelector('.mback').onclick = () => w.remove();
  document.body.appendChild(w);
  return w;
}
// id 可空 = 手工入库（施工令-015：按钮随迁 Wiki 美术标杆页签，无源单语境）
window.axModal = (id) => {
  const w = showModal(`<h3>入标杆 · 来源 ${id ? `<span class="mono">${esc(id)}</span>` : '<span class="pill sm mut">手工</span>'}<span class="x" onclick="this.closest('.mwrap').remove()">×</span></h3>
    <div class="f-field"><label>条目标题（≤40 字）</label><input id="ax-t" placeholder="如：忠诚多向"/></div>
    <div class="f-field"><label>提炼一句话（≤300 字）</label><textarea id="ax-b" rows="3" placeholder="精选制的精髓是人工提炼，不是摘录"></textarea></div>
    <div class="note">写入 策划标杆.md（明文唯一事实源），来源单号与日期自动落款</div>
    <div class="mfoot"><div class="rgt2"><button class="btn h36" onclick="this.closest('.mwrap').remove()">取消</button>
      <button class="btn accent h36" onclick="axSubmit('${esc(id)}', this)">入标杆</button></div></div>`);
  const t = w.querySelector('#ax-t'); if (t) t.focus();
};
window.axSubmit = async (id, btn) => {
  btn.disabled = true;
  const r = await post('/api/stylelib/axiom', { 源单: id, 标题: $('ax-t').value, 正文: $('ax-b').value });
  btn.disabled = false;
  if (!r.ok) return toast(r.error || '失败');
  const m = document.querySelector('.mwrap'); if (m) m.remove();
  toast('已入标杆：' + r.标题);
  if (location.hash.startsWith('#/wiki')) route(); // 在美术标杆页签入库 → 就地刷新看见新条目
};
window.artModal = (id) => {
  const w = showModal(`<h3>入美术库 · 来源 ${id ? `<span class="mono">${esc(id)}</span>` : '<span class="pill sm mut">手工</span>'}<span class="x" onclick="this.closest('.mwrap').remove()">×</span></h3>
    <div class="f-field"><label>产出文件路径（相对项目仓库，或绝对路径）</label><input id="art-p" class="mono" placeholder="相对项目仓库的产出路径"/></div>
    <div class="f-field"><label>说明（可选，≤100 字）</label><input id="art-n" placeholder="为什么值得当范本"/></div>
    <div class="note">文件复制进 风格库/美术库/（原件不动），旁存来源记录；仅项目仓库内文件可入</div>
    <div class="mfoot"><div class="rgt2"><button class="btn h36" onclick="this.closest('.mwrap').remove()">取消</button>
      <button class="btn accent h36" onclick="artSubmit('${esc(id)}', this)">入美术库</button></div></div>`);
  const p = w.querySelector('#art-p'); if (p) p.focus();
};
window.artSubmit = async (id, btn) => {
  btn.disabled = true;
  const r = await post('/api/stylelib/art', { 源单: id, 源路径: $('art-p').value, 说明: $('art-n').value });
  btn.disabled = false;
  if (!r.ok) return toast(r.error || '失败');
  const m = document.querySelector('.mwrap'); if (m) m.remove();
  toast('已入美术库：' + r.name);
  if (location.hash.startsWith('#/wiki')) route();
};
window.act3 = async (name, id, 决定) => { const r = await post('/api/act/' + name, { id, 决定 }); toast(r.ok ? `${决定} 完成` : (r.error || '失败')); route(); };
window.askDecide = async (id, 决定, msg) => { if (await ask(msg)) act3('定夺', id, 决定); };
// 验收（审批点③ · H110 验收闸）：走 /api/act/验收。三大态改造后 通过=完成→归档（落袋），
// 打回一路已并入 废弃（带因，dropModal）——两件事量级不同，确认语分开。
window.askAccept = async (id, 通过) => {
  if (!通过) return dropModal(id); // 旧调用点兼容：不通过=废弃（带因）
  const msg = `验收归档 ${id}？

这是验收闸（保留单品味终审 H11 不可代签），签完即归档落袋。`;
  if (!await ask(msg)) return;
  const r = await post('/api/act/验收', { id, 通过: true });
  if (!r.ok) return toast(r.error || '验收失败');
  toast(`${id} 已归档落袋`); route();
};
// 废弃（带因，H108：废弃=独立目录终态，留档不删 R2）。
// 新写口形状 POST /api/tickets/废弃 {id, 理由, 操作者}——A 组 lifecycle 落成后收口对齐（need_coord）。
window.dropModal = (id) => showModal(`<h3>废弃 ${esc(id)}</h3>
  <p class="subnote" style="margin-top:6px">进「废弃」目录态：不可逆（留档不删，R2）；返工需另开新单。理由进 frontmatter 与流水。</p>
  <textarea id="drop-r" style="width:100%;height:80px;margin-top:12px" placeholder="为什么废弃（选填但强烈建议：事后回答得出「当时为什么不要了」）"></textarea>
  <div class="p7foot" style="margin-top:14px"><button class="btn h32" onclick="this.closest('.mwrap').remove()">取消</button>
  <button class="btn danger-o h32" onclick="doDrop('${esc(id)}',this)">确认废弃</button></div>`);
window.doDrop = async (id, btn) => {
  const body = { id, 操作者: '制作人' };
  const r0 = $('drop-r'); if (r0 && r0.value.trim()) body.理由 = r0.value.trim();
  btn.disabled = true;
  // 先走新写口；旧服务端没有这条路由时回落 /api/act/废弃（并行期兼容，收口后删兜底）
  let r = await post('/api/tickets/' + encodeURIComponent('废弃'), body).catch(() => null);
  if (!r || r.ok !== true) { const r2 = await post('/api/act/' + encodeURIComponent('废弃'), body); r = r2; }
  if (!r.ok) { btn.disabled = false; return toast(r.error || '废弃失败'); }
  btn.closest('.mwrap').remove();
  toast(`${id} 已废弃（留档）`); route();
};
// 给方向弹框（D43③）：方向文本随裁决落进工单正文，重执行的会话能读到；自修计数由 lifecycle 清零
window.dirModal = (id) => showModal(`<h3>给方向 ${esc(id)}</h3>
  <p class="subnote" style="margin-top:6px">写清「哪里不行 + 要往哪改」。文本追加进工单正文（## 定夺方向），单回在途重做，自修次数清零重新计。</p>
  <textarea id="dir-t" style="width:100%;height:110px;margin-top:12px" placeholder="如：核心循环没问题，但数值曲线太陡——把 3-8 关的经验需求压到现在的 60%，其余不动"></textarea>
  <div class="p7foot" style="margin-top:14px"><button class="btn h32" onclick="this.closest('.mwrap').remove()">取消</button>
  <button class="btn accent h32" onclick="doGiveDir('${esc(id)}',this)">回炉重做</button></div>`);
window.doGiveDir = async (id, btn) => {
  const 方向 = $('dir-t').value.trim();
  if (!方向) return toast('方向必填——不写方向的回炉等于让它再猜一遍');
  btn.disabled = true;
  const r = await post('/api/act/定夺', { id, 决定: '给方向', 方向, 裁决人: '制作人' });
  if (!r.ok) { btn.disabled = false; return toast(r.error || '失败'); }
  btn.closest('.mwrap').remove();
  toast('已给方向 → 回在途重做');
  route();
};

/* ===== 挂起 / 解挂弹窗（施工令-021 · 制作人裁决权 → H108 目录态化）=====
   带确认是硬要求：挂起会让一张单从全链路里消失，无声按下去和无声跑起来一样危险。
   父单（有子单的单）额外给「仅父单 / 全树」两选——只冻父单而子单照跑，是把专项冻了个寂寞。
   写口走 lifecycle 新形状 POST /api/tickets/挂起｜解挂（A 组落成后收口对齐，need_coord）；
   并行期旧服务端没有该路由时回落 /api/act/*。 */
window.suspAsk = (id, 挂, 有子) => {
  const 动 = 挂 ? '挂起' : '解挂';
  const 树注 = 挂
    ? '全树挂起 = 连带本单全部子孙一起冻结（终态子单与已单独挂起的子单跳过）。'
    : '全树解挂 = 连带「随本单全树挂起」的子孙一起放行；单独挂过的子单保持挂起，不代你改主意。';
  showModal(`<h3>${动} ${esc(id)}</h3>
    <p class="subnote" style="margin-top:6px">${挂
    ? '挂起 = <b>冻结进「挂起」目录态</b>（H108 唯一可逆终态）：派发 / 领单 / 初检 / 核查 / 仲裁 / 巡检告警全部跳过它，在途会话会被掐掉。这不是废弃——随时可解挂，解挂后转「待重派」重新排队。'
    : '解挂 = <b>转「待重派」</b>：重新进入排队，等派发引擎按依赖与优先级拉起。'}</p>
    ${挂 ? `<textarea id="susp-r" style="width:100%;height:80px;margin-top:12px" placeholder="为什么冻它（选填，进 frontmatter 与流水，事后回答得出「当时为什么停」）"></textarea>` : ''}
    ${有子 ? `<label class="subnote" style="display:flex;align-items:center;gap:8px;margin-top:12px;cursor:pointer">
      <input type="checkbox" id="susp-tree" checked> 全树${动}（连带子单）</label>
      <p class="subnote" style="margin-top:6px">${树注}</p>` : ''}
    <div class="p7foot" style="margin-top:14px"><button class="btn h32" onclick="this.closest('.mwrap').remove()">取消</button>
    <button class="btn accent h32" onclick="doSusp('${esc(id)}',${挂},this)">确认${动}</button></div>`);
};
window.doSusp = async (id, 挂, btn) => {
  const box = $('susp-tree');
  const body = { id, 操作者: '制作人', 全树: !!(box && box.checked) };
  if (挂) { const r0 = $('susp-r'); if (r0 && r0.value.trim()) body.理由 = r0.value.trim(); }
  btn.disabled = true;
  // 先走 lifecycle 新写口；旧服务端 404/无 ok 时回落 /api/act/*（并行期兼容，收口后删兜底）
  let r = await post('/api/tickets/' + encodeURIComponent(挂 ? '挂起' : '解挂'), body).catch(() => null);
  if (!r || r.ok !== true) r = await post('/api/act/' + (挂 ? '挂起' : '解挂'), body);
  if (!r.ok) { btn.disabled = false; return toast(r.error || '失败'); }
  btn.closest('.mwrap').remove();
  const n = ((挂 ? r.挂起 : r.解挂) || []).length;
  toast(挂 ? `已挂起${n > 1 ? ` · 连带 ${n - 1} 张子单` : ''}` : `已解挂 · 转待重派${n > 1 ? ` · 连带 ${n - 1} 张子单` : ''}`);
  route();
};

/* ===== 路由 ===== */
/* ===== P16 Wiki（0.20，H52 第三类实体）：设计事实源——分类树 + 词条双链 + 信息栏 + 待审人闸 + 关系图 ===== */
// 施工令-015：wiki = 唯一知识入口。施工令-020（H92 配套）：四分区扩为五分区——调研从策划案分家自立一区。
// 第三项是页签描述：写清「谁的产出、给谁看」，鼠标悬停出提示，进分区主页也印在标题下。
const WK_TABS = [
  ['设计事实', '🧩', '全库事实源·词条化的唯一口径，落地即词条'],
  ['策划案', '📘', '策划产出·设计正文，按定案/草案分层'],
  ['调研方案', '🔬', '策划产出·给制作人与总监看'],
  ['技术方案', '🛠', '技术策划产出·程序与装配的施工图'],
  ['美术标杆', '🎨', '美术参考·风格标杆图库'],
];
const WK_TAB_DESC = Object.fromEntries(WK_TABS.map(([n, , d]) => [n, d || '']));
// 文档型分区（走 /api/docs 视图聚合）——设计事实与美术标杆各有各的数据源，不在此列
const WK_DOC_TABS = ['策划案', '调研方案', '技术方案'];
const wkState = { entry: '', mode: 'read', q: '', cat: '', tab: '设计事实', doc: '', dq: '', cdEdit: false, cdNew: '' };
window.wkTab = (n) => { if (wkState.tab === n) return; wkState.tab = n; wkState.doc = ''; wkState.dq = ''; cdReset(); route(); };
// 换文档就退出编辑态：别把 A 篇的草稿框带到 B 篇上
const cdReset = () => { wkState.cdEdit = false; wkState.cdNew = ''; };
// 极简 markdown 渲染（词条正文专用）：标题/加粗/行内码/列表/段落/[[双链]]。不引库，XSS 经 esc 全量转义。
function wkMd(src, byName) {
  src = String(src || '').replace(/<!--[\s\S]*?-->/g, ''); // HTML 注释不渲染（2026-08-06 UI 评审：入库回填注释块曾显形为正文）
  const link = (s) => s.replace(/\[\[([^\]|#]+?)(?:\|([^\]]*))?\]\]/g, (m, name, alias) => {
    const n = esc(name.trim());
    const exists = byName && byName[name.trim()];
    return `<a class="wk-l ${exists ? '' : 'ghost'}" onclick="wkOpen('${n}')" title="${exists ? '' : '条目未建——点击可从此名开稿'}">${esc(alias || name.trim())}</a>`;
  });
  const inline = (s) => link(esc(s)).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const out = []; let list = null, para = [], tbl = null;
  const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = null; } };
  // 表格（施工令-017）：连续的 | 行攒成一张真表——首行当表头，|---| 分隔行丢弃。
  // 旧版把每行原样吐成 mono 段落，13 行的系统框架表就是 13 条竖线流水；攒成表才读得下去。
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const isSep = (cs) => cs.length > 0 && cs.every((c) => /^:?-{2,}:?$/.test(c));
  const flushT = () => {
    if (!tbl) return;
    const rows = tbl.filter((cs) => !isSep(cs));
    if (rows.length) {
      const [head, ...body] = rows;
      out.push(`<div class="wk-tw"><table class="wk-t"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    }
    tbl = null;
  };
  for (const raw of String(src).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushP(); flushL(); flushT(); out.push(`<h${h[1].length + 2} class="wk-h">${inline(h[2])}</h${h[1].length + 2}>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { flushP(); flushT(); (list = list || []).push(li[1]); continue; }
    if (line.match(/^\s*\|.*\|\s*$/)) { flushP(); flushL(); (tbl = tbl || []).push(cells(line)); continue; }
    if (!line.trim()) { flushP(); flushL(); flushT(); continue; }
    flushL(); flushT(); para.push(line);
  }
  flushP(); flushL(); flushT();
  return out.join('\n');
}
// 五分区页签壳：页签常驻，分区内容各自渲染（页签栏复用决策台 .dtabs）
async function viewWiki() {
  const proj = curProj() || projDefault();
  if (!WK_TABS.some(([n]) => n === wkState.tab)) wkState.tab = '设计事实';
  const bar = `<div class="dtabs" style="margin-top:22px">${WK_TABS.map(([n, i, d]) =>
    `<div class="tab ${wkState.tab === n ? 'active' : ''}" title="${esc(d || '')}" onclick="wkTab('${n}')">${i} ${esc(n)}</div>`).join('')}
    <span class="backlog2">${esc(proj)} · 知识总库</span></div>`;
  let body;
  try {
    if (WK_DOC_TABS.includes(wkState.tab)) body = await wkDocZone(proj, wkState.tab);
    else if (wkState.tab === '美术标杆') body = await wkArtRef();
    else body = await wkFacts(proj);
  } catch (e) { body = `<div class="emptycard" style="margin-top:20px"><h5>分区加载失败</h5><p>${esc(e.message || String(e))}</p></div>`; }
  return bar + body;
}

/* --- 文档分区（策划案 / 调研方案 / 技术方案）：视图聚合制，只读；缺目录容错 --- */
// 溯源索引：全部文档型分区各扫一遍缓存一份，供词条 源文档 字段解析成可点链接
let _docIdx = null, _docIdxProj = '';
async function docIndex(proj) {
  if (_docIdx && _docIdxProj === proj) return _docIdx;
  const out = [];
  for (const z of WK_DOC_TABS) {
    const d = await api('/api/docs?项目=' + encodeURIComponent(proj) + '&区=' + encodeURIComponent(z)).catch(() => null);
    if (d && d.文档) out.push(...d.文档.map((x) => ({ ...x, 区: z })));
  }
  _docIdx = out; _docIdxProj = proj;
  return out;
}
// 源文档写法宽松：整路径 / 尾部路径 / 纯文件名（可省 .md）/ 标题——依次匹配，都不中就当纯文本
function docMatch(idx, s) {
  const k = String(s).replace(/^\.\//, '').toLowerCase();
  return idx.find((d) => d.rel.toLowerCase() === k)
    || idx.find((d) => d.rel.toLowerCase().endsWith('/' + k))
    || idx.find((d) => d.文件名.toLowerCase() === k || d.文件名.toLowerCase() === k + '.md')
    || idx.find((d) => String(d.标题 || '').toLowerCase() === k) || null;
}
window.wkOpenDoc = (zone, rel) => { wkState.tab = zone; wkState.doc = rel; wkState.dq = ''; cdReset(); route(); };
window.wkDocPick = (rel) => { if (rel !== wkState.doc) cdReset(); wkState.doc = rel; route(); };

/* --- 协同策划文档 codoc（施工令-017）：块级就地编辑 + 作者可视 --- */
// UI 是唯一写者，作者一律 制作人（总监/策划改文件或走 API）——所以前端不给作者选择器。
const CD_AUTHORS = ['制作人', '总监', '策划', '未知'];
const cdIs = (rel) => /\.codoc\.md$/i.test(String(rel || ''));
const cdWhen = (s) => { const d = s && new Date(s); return d && !isNaN(d) ? d.toISOString().slice(0, 16).replace('T', ' ') : '未记时'; };
window.wkCdEdit = () => { wkState.cdEdit = !wkState.cdEdit; wkState.cdNew = ''; route(); };
window.wkCdNew = (锚) => { wkState.cdNew = 锚 || '尾'; route(); };
window.wkCdCancel = () => { wkState.cdNew = ''; route(); };
async function cdPost(body) {
  const r = await post('/api/codoc', { 项目: curProj() || projDefault(), 区: wkState.tab, rel: wkState.doc, ...body });
  if (!r.ok) { toast(r.error || '保存失败'); return null; }
  // git 是页史不是保存本身：失败只降级成警示，内容已经落盘
  toast(r.警示 ? '已存盘，但' + r.警示 : r.无变更 ? '内容未变，未落新页史' : r.提交 ? '已保存 · git ' + r.提交 : '已保存');
  return r;
}
window.wkCdSave = async (id) => {
  const ta = document.getElementById('cd-ta-' + id);
  if (!ta) return;
  if (await cdPost({ 动作: '改', id, 文本: ta.value })) route();
};
window.wkCdAdd = async () => {
  const ta = document.getElementById('cd-ta-new');
  if (!ta) return;
  const 锚 = wkState.cdNew === '尾' ? '' : wkState.cdNew;
  if (await cdPost({ 动作: '增', 锚, 位: '后', 文本: ta.value })) { wkState.cdNew = ''; route(); }
};
window.wkCdDel = async (id) => {
  if (!await ask('删掉这一块？删除同样落 git 页史，事后可从项目仓 git 找回。')) return;
  if (await cdPost({ 动作: '删', id })) route();
};
window.wkCdMove = async (id, 方向) => { if (await cdPost({ 动作: '移', id, 方向 })) route(); };

// 渲染一篇 codoc：返回 { article, info }。只读态与编辑态共用同一套色带，差别只在多不多一层 textarea。
async function wkCodoc(proj, zone, cur) {
  const f = await api('/api/codoc?项目=' + encodeURIComponent(proj) + '&区=' + encodeURIComponent(zone)
    + '&rel=' + encodeURIComponent(cur.rel)).catch(() => null);
  if (!f || f.error) {
    return { article: `<div class="emptycard"><h5>读不到这篇协同文档</h5><p>${esc((f && f.error) || '未知错误')}</p></div>`, info: '' };
  }
  const w = await api('/api/wiki?项目=' + encodeURIComponent(proj)).catch(() => ({ 条目: [] }));
  const byName = Object.fromEntries((w.条目 || []).map((e) => [e.名称, e]));
  const ed = !!wkState.cdEdit;
  const 块 = f.块 || [];
  const 计 = Object.fromEntries(CD_AUTHORS.map((a) => [a, 块.filter((b) => b.作者 === a).length]));
  const 图例 = `<div class="cd-lg"><b style="color:var(--ink)">作者</b>${CD_AUTHORS
    .filter((a) => a !== '未知' || 计['未知']).map((a) => `<span data-a="${a}"><i></i>${a}${计[a] ? ' · ' + 计[a] : ''}</span>`).join('')}
    <span style="margin-left:auto">${ed ? '编辑态 · 你的改动一律记作「制作人」' : '只读态 · 点「编辑」开写'}</span></div>`;
  const 草稿 = (锚) => (wkState.cdNew === 锚 ? `<div class="cd-blk ed" data-a="制作人">
      <textarea class="cd-ta" id="cd-ta-new" placeholder="新一块的 markdown 正文…"></textarea>
      <div class="cd-ops"><button class="btn h32" onclick="wkCdAdd()">保存新块</button>
        <button class="btn h32" onclick="wkCdCancel()">取消</button><span class="cd-sig">将记作 制作人</span></div></div>` : '');
  const 加钮 = (锚) => (ed && wkState.cdNew !== 锚 ? `<button class="btn h32 cd-add" onclick="wkCdNew('${qesc(锚)}')">＋ 加一块</button>` : '');
  const 体 = 块.map((b) => {
    const 签 = `${b.作者} · ${cdWhen(b.时)}`;
    const 芯 = ed
      ? `<textarea class="cd-ta" id="cd-ta-${esc(b.id)}">${esc(b.文本)}</textarea>
         <div class="cd-ops"><button class="btn h32" onclick="wkCdSave('${qesc(b.id)}')">保存</button>
           <button class="btn h32" onclick="wkCdMove('${qesc(b.id)}','上')" title="上移">↑</button>
           <button class="btn h32" onclick="wkCdMove('${qesc(b.id)}','下')" title="下移">↓</button>
           <button class="btn h32" onclick="wkCdDel('${qesc(b.id)}')" title="删块">删</button>
           <span class="cd-sig">${esc(签)}</span></div>`
      : `<div class="wk-body">${wkMd(b.文本, byName)}</div>`;
    return `<div class="cd-blk${ed ? ' ed' : ''}" data-a="${esc(b.作者)}" data-id="${esc(b.id)}" title="${esc(签)}">${芯}</div>`
      + 草稿(b.id) + 加钮(b.id);
  }).join('');
  const article = `<p class="dim" style="font-size:12px;margin:0">${esc(zone)} › ${esc(cur.标签)}${cur.子目录 ? ' › ' + esc(cur.子目录) : ''} › 协同文档</p>
    <div style="display:flex;align-items:center;gap:10px;margin:2px 0 12px">
      <h2 style="margin:0">${esc(f.标题)}</h2>
      <button class="btn h32" style="margin-left:auto" onclick="wkCdEdit()">${ed ? '完成编辑' : '编辑'}</button>
    </div>${图例}
    ${块.length ? 体 : `<div class="emptycard"><h5>这篇还没有内容块</h5><p>${ed ? '点下面「＋ 加一块」开写。' : '点右上「编辑」再加块。'}</p></div>`}
    ${wkState.cdNew === '尾' ? 草稿('尾') : ''}${ed ? 加钮('尾') : ''}`;
  const info = `<div class="card r14" style="padding:14px"><b style="font-size:13px">信息栏</b>
    <table class="rp-t" style="margin-top:8px;font-size:12.5px">
      <tr><td class="dim">分区</td><td style="text-align:right">${esc(zone)}</td></tr>
      <tr><td class="dim">形态</td><td style="text-align:right">协同文档</td></tr>
      <tr><td class="dim">块数</td><td style="text-align:right">${块.length}</td></tr>
      <tr><td class="dim">字数</td><td style="text-align:right">${f.字数}</td></tr>
      ${f.更新时间 ? `<tr><td class="dim">更新</td><td style="text-align:right">${esc(f.更新时间)}</td></tr>` : ''}
    </table>
    <p class="subnote mono" style="margin:10px 0 0;word-break:break-all">${esc(f.rel)}</p>
    <p class="subnote" style="margin:8px 0 0">保存即项目仓 git 提交（一次一笔，只含这个文件）——改错了从 git 找回</p></div>`;
  return { article, info };
}

async function wkDocZone(proj, zone) {
  const d = await api('/api/docs?项目=' + encodeURIComponent(proj) + '&区=' + encodeURIComponent(zone)).catch((e) => ({ error: String(e) }));
  if (d.error) return `<div class="emptycard" style="margin-top:20px"><h5>${esc(zone)}未就绪</h5><p>${esc(d.error)}</p></div>`;
  const all = d.文档 || [];
  if (wkState.doc && !all.some((x) => x.rel === wkState.doc)) wkState.doc = ''; // 换分区/文件已删 → 回分区主页
  const q = wkState.dq.trim();
  const hit = (x) => !q || x.标题.includes(q) || x.文件名.includes(q) || x.子目录.includes(q);
  const TAGI = { 设计: '📐', 调研: '🔍', 竞品: '⚖', 方案: '🛠' };
  // 左栏：默认按根分组（如调研方案两根 = 调研/竞品），根内再按子目录分层
  const treeByRoot = () => (d.根 || []).map((r) => {
    const mine = all.filter((x) => x.根 === r.根);
    const shown = mine.filter(hit);
    if (q && !shown.length) return '';
    const head = `<p class="wk-cat" title="${esc(r.根)}">${TAGI[r.标签] || '📄'} ${esc(r.标签)} <span class="dim">· ${r.存在 ? `${shown.length}` : '目录未建'}</span></p>`;
    if (!r.存在) return head + '<p class="wk-it dim" style="cursor:default">（项目仓无此目录，建了自动出现）</p>';
    if (!shown.length) return head + '<p class="wk-it dim" style="cursor:default">（空）</p>';
    const subs = [...new Set(shown.map((x) => x.子目录))].sort();
    return head + subs.map((s) => (s ? `<p class="wk-it dim" style="margin-left:8px;cursor:default">${esc(s)}/</p>` : '')
      + shown.filter((x) => x.子目录 === s).map((x) =>
        `<p class="wk-it ${x.rel === wkState.doc ? 'cur' : ''}" style="${s ? 'margin-left:26px' : ''}" title="${esc(x.rel)}${cdIs(x.rel) ? ' · 协同文档（可编辑）' : ''}" onclick="wkDocPick('${qesc(x.rel)}')">${cdIs(x.rel) ? '✍ ' : ''}${esc(x.标题)}</p>`).join('')).join('');
  }).join('');
  // 策划案专属：定案分层（施工令-020）——组由后端 docs.js 定（doc.组），前端只按组画。
  // 定案/草案（无状态标注默认归此）/决策记录 三组常驻，空组也留头显示 0，让「还没有定案」一眼可见。
  const GRP = [['定案', '📗', '已拍板，可作为下游依据'], ['草案', '📝', '在写或未标状态——不得当依据用'], ['决策记录', '🗳', '怎么定的：访谈/评审/裁决留痕']];
  const treeByGroup = () => GRP.map(([g, ico, tip]) => {
    const shown = all.filter((x) => (x.组 || '草案') === g).filter(hit);
    if (q && !shown.length) return '';
    const head = `<p class="wk-cat" title="${esc(tip)}">${ico} ${esc(g)} <span class="dim">· ${shown.length}</span></p>`;
    if (!shown.length) return head + '<p class="wk-it dim" style="cursor:default">（空）</p>';
    return head + shown.map((x) => {
      const 位 = g === '决策记录' ? '' : x.子目录;
      return `<p class="wk-it ${x.rel === wkState.doc ? 'cur' : ''}" title="${esc(x.rel)}${x.状态 ? ' · 状态：' + esc(x.状态) : ''}${cdIs(x.rel) ? ' · 协同文档（可编辑）' : ''}" onclick="wkDocPick('${qesc(x.rel)}')">${cdIs(x.rel) ? '✍ ' : ''}${esc(x.标题)}${位 ? ` <span class="dim">· ${esc(位)}</span>` : ''}</p>`;
    }).join('');
  }).join('');
  const tree = zone === '策划案' ? treeByGroup() : treeByRoot();
  // 右栏：选中即读；未选则分区主页（根概览 + 最近更新）
  let article, info = '';
  const cur = all.find((x) => x.rel === wkState.doc);
  if (cur && cdIs(cur.rel)) {
    const r = await wkCodoc(proj, zone, cur); // 协同文档走块级渲染（可编辑），其余仍只读
    article = r.article; info = r.info;
  } else if (cur) {
    const f = await api('/api/docs/file?项目=' + encodeURIComponent(proj) + '&区=' + encodeURIComponent(zone)
      + '&rel=' + encodeURIComponent(cur.rel)).catch(() => null);
    if (!f || f.error) article = `<div class="emptycard"><h5>读不到这篇</h5><p>${esc((f && f.error) || '未知错误')}</p></div>`;
    else {
      const w = await api('/api/wiki?项目=' + encodeURIComponent(proj)).catch(() => ({ 条目: [] }));
      const byName = Object.fromEntries((w.条目 || []).map((e) => [e.名称, e]));
      article = `<p class="dim" style="font-size:12px;margin:0">${esc(zone)} › ${esc(cur.标签)}${cur.子目录 ? ' › ' + esc(cur.子目录) : ''}</p>
        <h2 style="margin:2px 0 14px">${esc(f.标题)}</h2>
        <div class="wk-body">${wkMd(f.body, byName)}</div>`;
    }
    info = `<div class="card r14" style="padding:14px"><b style="font-size:13px">信息栏</b>
      <table class="rp-t" style="margin-top:8px;font-size:12.5px">
        <tr><td class="dim">分区</td><td style="text-align:right">${esc(zone)}</td></tr>
        <tr><td class="dim">类别</td><td style="text-align:right">${esc(cur.标签)}</td></tr>
        ${cur.组 ? `<tr><td class="dim">分层</td><td style="text-align:right" class="${cur.组 === '定案' ? 'okc' : cur.组 === '草案' ? 'warnc' : ''}">${esc(cur.组)}${cur.状态 ? `<span class="dim"> · 状态 ${esc(cur.状态)}</span>` : cur.组 === '草案' ? '<span class="dim"> · 未标状态</span>' : ''}</td></tr>` : ''}
        ${cur.子目录 ? `<tr><td class="dim">子目录</td><td style="text-align:right">${esc(cur.子目录)}</td></tr>` : ''}
        <tr><td class="dim">字数</td><td style="text-align:right">${cur.字数}</td></tr>
        ${cur.更新时间 ? `<tr><td class="dim">更新</td><td style="text-align:right">${esc(cur.更新时间)}</td></tr>` : ''}
      </table>
      <p class="subnote mono" style="margin:10px 0 0;word-break:break-all">${esc(cur.rel)}</p>
      <p class="subnote" style="margin:8px 0 0">只读展示——改稿回项目仓改文件，刷新即变</p></div>`;
  } else {
    const recent = [...all].filter((x) => x.更新时间).sort((a, b) => String(b.更新时间).localeCompare(String(a.更新时间))).slice(0, 8);
    // 策划案主页看分层账（定案几篇/草案几篇），其余分区看来源目录账
    const cards = zone === '策划案'
      ? GRP.map(([g, ico, tip]) => `<div class="card r14" style="padding:14px 16px" title="${esc(tip)}">
        <b style="font-size:14px">${ico} ${esc(g)}</b><span class="dim" style="margin-left:8px">${all.filter((x) => (x.组 || '草案') === g).length} 篇</span>
        <p class="subnote" style="margin:8px 0 0">${esc(tip)}</p></div>`).join('')
      : (d.根 || []).map((r) => `<div class="card r14" style="padding:14px 16px">
        <b style="font-size:14px">${TAGI[r.标签] || '📄'} ${esc(r.标签)}</b><span class="dim" style="margin-left:8px">${r.存在 ? `${r.数量} 篇` : '目录未建'}</span>
        <p class="subnote mono" style="margin:8px 0 0;word-break:break-all">${esc(r.根)}</p></div>`).join('');
    article = `<h2 style="margin:0 0 4px">${esc(proj)} ${esc(zone)}</h2>
      ${WK_TAB_DESC[zone] ? `<p class="dim" style="margin:0 0 6px;font-size:13px">${esc(WK_TAB_DESC[zone])}</p>` : ''}
      <p class="dim" style="margin:0 0 16px;font-size:13px">${all.length} 篇 · ${(d.根 || []).length} 个来源目录 · 只读聚合（文件仍在项目仓，零迁移）</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:18px">${cards}</div>
      ${all.length ? `<p class="dim" style="font-size:12px;margin:0 0 6px;border-top:0.5px solid var(--line);padding-top:10px">最近更新</p>`
      + recent.map((x) => `<p style="margin:0 0 5px"><a class="wk-l" onclick="wkDocPick('${qesc(x.rel)}')">${esc(x.标题)}</a> <span class="dim">${esc(x.更新时间)} · ${esc(x.标签)}${x.子目录 ? ' · ' + esc(x.子目录) : ''}</span></p>`).join('')
      : '<div class="emptycard"><h5>本区还没有文档</h5><p>在项目仓对应目录下写 .md，刷新即出现——本页只读展示，不做编辑。</p></div>'}`;
  }
  return `<div class="wk-tools">
      <input class="btn h32" style="padding:0 12px;width:200px" placeholder="搜索文档…" value="${esc(wkState.dq)}" oninput="wkState.dq=this.value;route()"/>
      <span class="cnt">${all.length} 篇</span></div>
    <div class="wk-grid">
      <div class="wk-tree">${tree || '<p class="dim">无匹配</p>'}</div>
      <div class="wk-art card r16" style="padding:20px 24px">${article}</div>
      <div>${info}</div>
    </div>`;
}

async function wkFacts(proj) {
  const d = await api('/api/wiki?项目=' + encodeURIComponent(proj)).catch((e) => ({ error: String(e) }));
  if (d.error) return `<div class="emptycard" style="margin-top:30px"><h5>Wiki 未就绪</h5><p>${esc(d.error)}</p></div>`;
  const byName = Object.fromEntries((d.条目 || []).map((e) => [e.名称, e]));
  const q = wkState.q.trim();
  const match = (e) => !q || e.名称.includes(q) || e.分类.includes(q);
  const cats = [...new Set((d.条目 || []).map((e) => e.分类))].sort();
  const CATICON = { 世界观: '🌏', 地图: '🗺', 势力: '⚔', 系统: '⚙', 数值: '🧮' };
  if (wkState.entry && !byName[wkState.entry]) wkState.entry = ''; // 条目已不存在 → 回主页；空 = 主页
  const homeLink = `<p class="wk-it ${!wkState.entry && wkState.mode !== 'graph' ? 'cur' : ''}" style="margin-left:0;font-weight:600" onclick="wkOpen('')">🏠 主页</p>`;
  const tree = cats.map((c) => {
    const mine = d.条目.filter((e) => e.分类 === c && match(e));
    if (q && !mine.length) return '';
    return `<p class="wk-cat">${CATICON[c] || '📄'} ${esc(c)} <span class="dim">· ${mine.length}</span></p>` +
      mine.map((e) => `<p class="wk-it ${e.名称 === wkState.entry ? 'cur' : ''}" onclick="wkOpen('${esc(e.名称)}')">${esc(e.名称)}</p>`).join('');
  }).join('');
  const pend = (d.待审 || []).map((w) => `<div class="wk-pend card r14">
      <b>${esc(w.名称)}</b><span class="pill sm mut">${esc(w.分类)}</span>${w.来源工单 ? `<span class="pill sm mut mono">${esc(w.来源工单)}</span>` : ''}<span class="dim" style="font-size:12px">${w.字数} 字</span>
      <span style="margin-left:auto"><button class="btn h32 accent" onclick="wkApprove('${esc(w.文件)}')">入册</button>
      <button class="btn h32" onclick="wkReject('${esc(w.文件)}')">退回</button></span></div>`).join('');
  let article = '<div class="emptycard"><h5>还没有词条</h5><p>策划单产出会先落待审区；你也可以直接在项目仓 Docs/wiki/&lt;分类&gt;/ 下手写 .md（frontmatter 写 名称/分类/锚号），刷新即入册。</p></div>';
  if (wkState.mode === 'graph') {
    article = `<div style="position:relative"><canvas id="wk-g" width="760" height="520" style="width:100%;border:0.5px solid var(--line);border-radius:12px"></canvas>
      <p class="subnote" style="margin-top:8px">节点=词条（按分类着色，灰=被引用但未建）· 边=双链 · 拖拽节点 · 点击进词条</p></div>`;
    setTimeout(() => wkGraph(proj), 0);
  } else if (!wkState.entry) {
    const g = await api('/api/wiki/graph?项目=' + encodeURIComponent(proj)).catch(() => ({ nodes: [], edges: [] }));
    const ghosts = (g.nodes || []).filter((n) => n.分类 === '未建');
    const hubs = [...(d.条目 || [])].sort((x, y) => (y.backlinks || []).length - (x.backlinks || []).length).slice(0, 5).filter((e) => (e.backlinks || []).length);
    const recent = [...(d.条目 || [])].filter((e) => e.更新时间).sort((x, y) => String(y.更新时间).localeCompare(String(x.更新时间))).slice(0, 5);
    const CATI = { 世界观: '🌏', 地图: '🗺', 势力: '⚔', 系统: '⚙', 数值: '🧮' };
    const links = (d.条目 || []).reduce((s, e) => s + (e.links || []).length, 0);
    const catCards = cats.map((c) => { const mine = d.条目.filter((e) => e.分类 === c);
      return `<div class="card r14" style="padding:14px 16px;cursor:pointer" onclick="wkOpen('${esc((mine[0] || {}).名称 || '')}')">
        <b style="font-size:14px">${CATI[c] || '📄'} ${esc(c)}</b><span class="dim" style="margin-left:8px">${mine.length} 词条</span>
        <p class="dim" style="margin:8px 0 0;font-size:12.5px">${mine.slice(0, 3).map((e) => esc(e.名称)).join(' · ')}${mine.length > 3 ? ' …' : ''}</p></div>`; }).join('');
    article = `<h2 style="margin:0 0 4px">${esc(proj)} 设计 Wiki</h2>
      <p class="dim" style="margin:0 0 16px;font-size:13px">${(d.条目 || []).length} 词条 · ${cats.length} 分类 · ${links} 条双链${d.待审.length ? ` · <span class="warnc">${d.待审.length} 篇待审</span>` : ''}</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:18px">${catCards || '<p class="dim">还没有分类</p>'}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div><p class="dim" style="font-size:12px;margin:0 0 6px">枢纽词条（被引最多）</p>${hubs.map((e) => `<p style="margin:0 0 6px"><a class="wk-l" onclick="wkOpen('${esc(e.名称)}')">${esc(e.名称)}</a> <span class="dim">← ${(e.backlinks || []).length}</span></p>`).join('') || '<p class="dim">暂无</p>'}</div>
        <div><p class="dim" style="font-size:12px;margin:0 0 6px">待建词条（被引用但未落笔——设计待办）</p>${ghosts.map((n) => `<p style="margin:0 0 6px"><a class="wk-l ghost">${esc(n.id)}</a></p>`).join('') || '<p class="dim">无——链接网是闭合的</p>'}</div>
      </div>
      ${recent.length ? `<p class="dim" style="font-size:12px;margin:16px 0 6px;border-top:0.5px solid var(--line);padding-top:10px">最近更新</p>` + recent.map((e) => `<p style="margin:0 0 5px"><a class="wk-l" onclick="wkOpen('${esc(e.名称)}')">${esc(e.名称)}</a> <span class="dim">${esc(String(e.更新时间).slice(0, 10))} · ${esc(e.分类)}</span></p>`).join('') : ''}`;
  } else if (wkState.entry && byName[wkState.entry]) {
    const e = await api('/api/wiki/entry?项目=' + encodeURIComponent(proj) + '&名称=' + encodeURIComponent(wkState.entry)).catch(() => null);
    if (e) {
      // 溯源链（施工令-015）：frontmatter.源文档 → 策划案/调研方案/技术方案分区里的那一篇，可点直达
      const srcs = e.源文档 || [];
      const idx = srcs.length ? await docIndex(proj) : [];
      const srcHtml = srcs.length ? `<p class="wk-src">📎 源文档 ${srcs.map((s) => {
        const m = docMatch(idx, s);
        return m ? `<a class="wk-l" title="${esc(m.区)} · ${esc(m.rel)}" onclick="wkOpenDoc('${qesc(m.区)}','${qesc(m.rel)}')">${esc(m.标题)}</a>`
          : `<span class="dim" title="未在策划案/调研方案/技术方案分区找到这篇">${esc(s)}</span>`;
      }).join(' · ')}</p>` : '';
      article = `<p class="dim" style="font-size:12px;margin:0">${esc(e.分类)} › 词条</p>
        <h2 style="margin:2px 0 6px">${esc(e.名称)}</h2>
        ${srcHtml}
        <div class="wk-body" style="margin-top:14px">${wkMd(e.body, byName)}</div>
        <div class="wk-back"><p class="dim" style="font-size:12px;margin:0 0 4px">被引用（反向链接）</p>
        ${(e.backlinks || []).length ? e.backlinks.map((b) => `<a class="wk-l" onclick="wkOpen('${esc(b)}')">${esc(b)}</a>`).join(' · ') : '<span class="dim">暂无</span>'}</div>`;
    }
  }
  const cur = byName[wkState.entry];
  const info = cur ? `<div class="card r14" style="padding:14px">
      <b style="font-size:13px">信息栏</b>
      <table class="rp-t" style="margin-top:8px;font-size:12.5px">
        <tr><td class="dim">分类</td><td style="text-align:right">${esc(cur.分类)}</td></tr>
        <tr><td class="dim">状态</td><td style="text-align:right" class="${cur.状态 === '正式' ? 'okc' : 'warnc'}">${esc(cur.状态)}</td></tr>
        ${cur.锚号 ? `<tr><td class="dim">锚号</td><td style="text-align:right" class="mono">${esc(cur.锚号)}</td></tr>` : ''}
        ${cur.来源工单 ? `<tr><td class="dim">来源工单</td><td style="text-align:right" class="mono">${esc(String(cur.来源工单))}</td></tr>` : ''}
        ${(cur.源文档 || []).length ? `<tr><td class="dim">源文档</td><td style="text-align:right">${(cur.源文档 || []).length} 篇</td></tr>` : ''}
        <tr><td class="dim">被引用</td><td style="text-align:right">${(cur.backlinks || []).length} 条目</td></tr>
        ${cur.更新时间 ? `<tr><td class="dim">更新</td><td style="text-align:right">${esc(String(cur.更新时间).slice(0, 10))}</td></tr>` : ''}
      </table></div>` : '';
  return `<div class="wk-tools">
      <input class="btn h32" style="padding:0 12px;width:200px" placeholder="搜索词条…" value="${esc(wkState.q)}" oninput="wkState.q=this.value;route()"/>
      <button class="btn h32 ${wkState.mode === 'graph' ? 'accent' : ''}" onclick="wkState.mode=wkState.mode==='graph'?'read':'graph';route()">◉ 关系图</button>
      <span class="cnt">${(d.条目 || []).length} 词条${d.待审.length ? ` · <span class="warnc">待审 ${d.待审.length}</span>` : ''}</span></div>
    ${d.待审.length ? `<div style="margin-bottom:14px">${pend}</div>` : ''}
    <div class="wk-grid">
      <div class="wk-tree">${homeLink}${tree || '<p class="dim">无词条</p>'}</div>
      <div class="wk-art card r16" style="padding:20px 24px">${article}</div>
      <div>${info}</div>
    </div>`;
}
// 开词条一律回「设计事实」页签——文档分区正文里的 [[双链]] 点了要能跳过来（施工令-015）
window.wkOpen = (name) => { wkState.tab = '设计事实'; wkState.entry = name; wkState.mode = 'read'; route(); };
window.wkApprove = async (f) => { const r = await post('/api/wiki/approve', { 文件: f, 项目: curProj() || projDefault() }); toast(r.ok ? `已入册「${r.名称}」` : (r.error || '失败')); route(); };
window.wkReject = async (f) => { if (!await ask('退回将删除该待审稿（agent 提案不入史）。确认？')) return; const r = await post('/api/wiki/reject', { 文件: f, 项目: curProj() || projDefault() }); toast(r.ok ? '已退回' : (r.error || '失败')); route(); };
// 力导向关系图：手写迭代（斥力+弹簧+向心），无外部库；拖拽节点、点击进词条。
async function wkGraph(proj) {
  const cv = $('wk-g'); if (!cv) return;
  const g = await api('/api/wiki/graph?项目=' + encodeURIComponent(proj)).catch(() => null); if (!g) return;
  // 施工令-048：图谱是力导向物理模拟，重跑=重新从环形起点弹一遍。原地重绘保留同一张画布，
  // 图没变就别再弹（否则脉冲每 3s 把已经站定的图重新抖散——这正是频闪最刺眼的一处）。
  const 签 = JSON.stringify([g.nodes.map((n) => n.id + n.分类), g.edges]);
  if (cv.__g签 === 签) return;
  cv.__g签 = 签;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const CAT = { 世界观: '#7f77dd', 地图: '#1d9e75', 势力: '#d85a30', 系统: '#378add', 数值: '#ba7517', 未建: '#6b7280' };
  const ns = g.nodes.map((n, i) => ({ ...n, x: W / 2 + Math.cos(i * 2.4) * (80 + i * 7), y: H / 2 + Math.sin(i * 2.4) * (60 + i * 5), vx: 0, vy: 0 }));
  const byId = Object.fromEntries(ns.map((n) => [n.id, n]));
  const es = g.edges.filter((e) => byId[e.from] && byId[e.to]);
  let drag = null;
  const step = () => {
    for (const a of ns) { a.fx = (W / 2 - a.x) * 0.002; a.fy = (H / 2 - a.y) * 0.002; }
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i], b = ns[j];
      let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 40;
      const f = 1800 / d2; const d = Math.sqrt(d2);
      dx /= d; dy /= d; a.fx += dx * f; a.fy += dy * f; b.fx -= dx * f; b.fy -= dy * f;
    }
    for (const e of es) {
      const a = byId[e.from], b = byId[e.to];
      let dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 110) * 0.004; dx /= d; dy /= d;
      a.fx += dx * f * d * 0.02; a.fy += dy * f * d * 0.02; b.fx -= dx * f * d * 0.02; b.fy -= dy * f * d * 0.02;
    }
    for (const a of ns) { if (a === drag) continue; a.vx = (a.vx + a.fx) * 0.82; a.vy = (a.vy + a.fy) * 0.82; a.x += a.vx; a.y += a.vy; a.x = Math.max(30, Math.min(W - 30, a.x)); a.y = Math.max(24, Math.min(H - 24, a.y)); }
  };
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(128,136,148,.35)'; ctx.lineWidth = 1;
    for (const e of es) { const a = byId[e.from], b = byId[e.to]; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    for (const n of ns) {
      const r = 5 + Math.min(9, n.度 * 1.5);
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fillStyle = CAT[n.分类] || '#888'; ctx.fill();
      ctx.fillStyle = getComputedStyle(document.body).color; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(n.id, n.x, n.y - r - 5);
    }
  };
  let ticks = 0;
  const loop = () => { if (!document.contains(cv)) return; step(); draw(); if (++ticks < 600 || drag) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const pos = (ev) => { const b = cv.getBoundingClientRect(); return { x: (ev.clientX - b.left) * W / b.width, y: (ev.clientY - b.top) * H / b.height }; };
  const hit = (p) => ns.find((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < 220);
  cv.onmousedown = (ev) => { drag = hit(pos(ev)); if (drag) { ticks = 0; requestAnimationFrame(loop); } };
  cv.onmousemove = (ev) => { if (drag) { const p = pos(ev); drag.x = p.x; drag.y = p.y; ticks = 0; } };
  cv.onmouseup = (ev) => { if (drag) { const p = pos(ev); const n = hit(p); if (n === drag && Math.abs(drag.vx) < 1) { /* 点击语义留 click */ } } drag = null; };
  cv.onclick = (ev) => { const n = hit(pos(ev)); if (n && n.分类 !== '未建') wkOpen(n.id); };
}

// 施工令-015：stylelib 路由退役（内容并入 wiki 美术标杆页签），旧书签在 route() 里转向
const ROUTES = { '': viewOverview, tickets: viewTickets, specials: viewTickets, board: viewBoard, agents: viewAgents, wiki: viewWiki, relay: viewRelay, report: viewReport };
const WK_ALIAS = ['style', 'stylelib', '风格库']; // 旧书签不死：一律落 wiki 美术标杆
/* 退役页转向表（2026-08-20 页签定案 11→8）：键=旧 hash 段，值=新落点。
   一律 location.replace 不用 assign——assign 会让退役页占一格历史，用户按返回又被弹回来一次
   （WK_ALIAS 与 #/tree 早有此先例，此处收归一张表，免得每退一页就在 route() 里多长一个 if）。
   #/tree 的落点随之改判：028 当初把它转去 #/flow，而流程页本身今天退役，
   于是**传递解析**到 #/relay——留在 flow 上只会转两跳，中间那跳还是一张不存在的页。 */
const 退役页 = { ideas: 'relay', flow: 'relay', queue: 'relay', tree: 'relay', decisions: '' };

/* ===== P15 专项（H103 · 施工令-058）：容器不是工单 =====
   一张卡 = 一个专项容器。四态、进度聚合条、子单树、收口报告直达、关账按钮（唯一人闸）。
   与工单板的分工是硬的：**这里没有一张工单能被操作**——点子单只跳详情页，容器自己既不派发
   也不验收，它只有一个可按的钮，就是关账。容器页要是也长出一排工单动作，H103 就白裁了。 */

// @testable-begin spAgg
// 聚合条分段（纯函数，与服务端 specials.聚合 的 进度 段同口径，不另算一遍）：
// 落袋 / 在办 / 未起 / 归档 四段按数量分宽度，零子单回一条空槽。
// 抽成可测函数是因为「百分比怎么来的」在页面上是一句无声的断言——它错了没人看得出来。
function spAgg(进度) {
  const p = 进度 || {};
  const 总 = Number(p.总数) || 0;
  const seg = (n) => (总 ? Math.round((Number(n) || 0) / 总 * 1000) / 10 : 0);
  return {
    总数: 总, 百分比: 总 ? Number(p.百分比) || 0 : 0,
    段: [
      { 名: '落袋', 类: 'done', 数: Number(p.落袋) || 0, 宽: seg(p.落袋) },
      { 名: '在办', 类: 'doing', 数: Number(p.在办) || 0, 宽: seg(p.在办) },
      { 名: '未起', 类: 'todo', 数: Number(p.未起) || 0, 宽: seg(p.未起) },
      { 名: '归档', 类: 'drop', 数: Number(p.归档) || 0, 宽: seg(p.归档) },
    ].filter((s) => s.数 > 0),
    空: 总 === 0,
  };
}
// 四态一句话（状态本身不解释就是四个名词，制作人得猜哪个在等他）
const SP_态释 = {
  立项: '已立项，等项管切单',
  进行: '子单在跑',
  收口: '全部落袋 · 等你关账签字',
  关账: '已关账收档',
};
// @testable-end spAgg

/* ===== P15 工单页 · 四层归属结构（制作人 2026-08-20 拍板）=====
 * 管线 P-n（系统）→ 特性 F-n（系统下的功能/规则）→ 专项 S-n（一段活）→ 工单（最小单元）。
 * 三级卡片钻取：点管线卡进特性层，点特性卡进专项层，点工单直达详情页。
 * 制作人对第一版「一行一实体的折叠树」的原话否决：「不要这样一行一行，给我放卡片，
 * 点击管线卡片之后给我进入到专项层级」；对旧专项页的评价是「看得这么丑」——丑因三条
 * （卡片高度参差、顺序非按编号、目标描述吃掉半张卡），本页逐条治：按号排、子单默认折叠、单行截断。
 * 层级位置记在 hash 里（#/tickets/P-1/F-3），刷新与前进后退都不丢。 */
function tkLevel() {
  const seg = (location.hash.replace(/^#\/?/, '').split('?')[0] || '').split('/').filter(Boolean);
  return { 管线: seg[1] || null, 特性: seg[2] || null };
}
window.tkGo = (h) => { location.hash = h; };

// G9 管线开线/封存（2026-08-22 体检 #14/#64）：注册表 lib/gatereg.js 写着「落点 工单页 · 管线层 /
// 按钮 开线」，服务端 POST /api/pipelines 与 /api/pipelines/status 也一直在位，唯独前端零调用——
// 五条发起型闸里只有它落空。顺带补上 window._showSealed 的写口（此前全库一处读、零处写，
// 封存的线在界面上永远调不出来）。状态取值只有 活跃/封存（lib/pipelines.js STATUSES）。
window.plOpen = async () => {
  const 名称 = await askInput('新管线的名称（管线＝项目里的一套系统，常驻、无终点；开线是制作人人闸 H51）', '', { placeholder: '例：地图管线' });
  if (名称 == null) return;
  if (!String(名称).trim()) return toast('名称不能为空，开线取消');
  const 阶段 = await askInput(`「${String(名称).trim()}」现在处在哪个阶段？（可留空，缺省 L0）`, '', { placeholder: '例：L0 / 原型' });
  if (阶段 == null) return;
  const r = await post('/api/pipelines', { 名称: String(名称).trim(), 阶段: String(阶段 || '').trim() }).catch((e) => ({ error: String((e && e.message) || e) }));
  if (!r || !r.ok) return toast('开线失败：' + ((r && r.error) || '未知'));
  toast(`已开线 ${r.id || ''}「${String(名称).trim()}」`);
  route();
};
window.plSeal = async (id, 状态) => {
  if (!await ask(状态 === '封存'
    ? `封存管线 ${id}？封存＝不再接新活；历史照常在树里可查，不是删除。`
    : `复线 ${id}？它将重新可以接新活。`)) return;
  const r = await post('/api/pipelines/status', { id, 状态 }).catch((e) => ({ error: String((e && e.message) || e) }));
  if (!r || !r.ok) return toast((r && r.error) || '失败');
  toast(`管线${状态} ${id}`);
  route();
};
window.plToggleSealed = () => { window._showSealed = !window._showSealed; route(); };

async function viewTickets() {
  const { 管线: pl, 特性: ft } = tkLevel();
  const [fd, sd, pls] = await Promise.all([
    api('/api/features').catch(() => ({ 特性: [] })),
    api('/api/specials').catch(() => ({ 专项: [] })),
    api('/api/pipelines').catch(() => ({ 管线: [] })),
  ]);
  const 特性们 = fd.特性 || []; const 专项们 = sd.专项 || []; const 管线们 = pls.管线 || pls || [];
  if (!pl) return tkL1(管线们, 特性们);
  // Ticketflow 没有管线也没有特性（H52 不同项目不同形状），走它自己的两层视图。
  // 原样落 tkL2('Ticketflow')，而 tkL2 按 f.管线 === 'Ticketflow' 过滤——18 条特性挂的
  // 全是 P-1..P-4，必空，于是页面写「这条管线下还没有特性」+ 面包屑「管线 / Ticketflow」，
  // 两处都在骗人：TF 压根不该有管线层。TF 的专项与工单在本页由此不可达（2026-08-21 体检）。
  if (pl === 'Ticketflow') return tkTF(专项们);
  if (!ft) return tkL2(pl, 管线们, 特性们);
  return tkL3(pl, ft, 特性们, 专项们);
}

// 面包屑：层级越深越要能一眼退回去。当前层不做成链接（点自己没有意义）。
function tkCrumb(parts) {
  return '<div class="tkcrumb">' + parts.map((p, i) => (i === parts.length - 1
    ? `<b>${esc(p.名)}</b>`
    : `<a href="${esc(p.到)}">${esc(p.名)}</a><span class="tksep">/</span>`)).join('') + '</div>';
}

// 进度条：落袋比例。空的不画条——「不编进度」是既有纪律（spCard 同款）。
function tkBar(v) {
  const 总 = v.单数 || 0;
  if (!总) return '<div class="spbar empty" title="还没有单——不编进度"></div>';
  const 落 = Math.round(100 * (v.落袋 || 0) / 总);
  return `<div class="spbar"><i class="sg-done" style="width:${落}%"></i></div>`;
}

/* ---- 第一层：管线卡片 ---- */
function tkL1(管线们, 特性们) {
  const p = projActive();
  // 项目边界（2026-08-21 制作人：「在一个项目里能看到另外一个项目的东西，这不对，不合理」）。
  // 此前这里只过滤封存、不过滤项目，于是页头写着「监制台 · TK」而卡片里混着别的项目。
  // 管线没有 项目 这一格（四条 P 线都是 TK 建的），故按 projOf 口径：无章者归项目默认。
  const 卡 = 管线们.filter((x) => x.状态 !== '封存' || window._showSealed)
    .filter((x) => !p || projOf(x) === p).map((x) => {
    const fs = 特性们.filter((f) => f.管线 === x.id);
    const 单数 = fs.reduce((n, f) => n + (f.单数 || 0), 0);
    const 落袋 = fs.reduce((n, f) => n + (f.落袋 || 0), 0);
    const 待审 = fs.filter((f) => f.状态 === '待审').length;
    const pct = 单数 ? Math.round(100 * 落袋 / 单数) : 0;
    const 到 = `#/tickets/${x.id}`;
    return `<div class="tkcard card r14" onclick="tkGo('${esc(到)}')" tabindex="0" role="button"
        onkeydown="if(event.key==='Enter')tkGo('${esc(到)}')" aria-label="进入 ${esc(x.名称 || x.id)} 的特性层">
      <div class="tkh"><span class="mono tkno">${esc(x.id)}</span><b class="tkname">${esc(x.名称 || '')}</b>
        ${x.阶段 ? `<span class="pill sm mut">${esc(x.阶段)}</span>` : ''}
        ${x.状态 === '封存' ? '<span class="pill sm mut">封存</span>' : ''}
        <button class="btn h32 tkseal" onclick="event.stopPropagation();plSeal('${qesc(x.id)}','${x.状态 === '封存' ? '活跃' : '封存'}')"
          title="G9 人闸：${x.状态 === '封存' ? '复线＝重新接新活' : '封存＝不再接新活，历史照常可查'}">${x.状态 === '封存' ? '复线' : '封存'}</button></div>
      <div class="tkmeta"><span class="sppct">${单数 ? pct + '%' : '—'}</span>
        <span class="subnote">${单数 ? `${落袋}/${单数} 落袋` : '还没有单'}</span></div>
      ${tkBar({ 单数, 落袋 })}
      <div class="tkfoot">特性 ${fs.length}${待审 ? ` · <b class="sp-wait">${待审} 待审</b>` : ''}</div></div>`;
  }).join('');
  // TF（监制台自维护）不挂管线：不同项目不同形状（H52）——它只有「专项+工单」两层，
  // 故在管线层给它一张独立入口卡，不硬塞进 P 序列里冒充一条管线。
  // **2026-08-21 方向修正**：这张卡原先的显示条件是 `!p || p === 'TK'`——即**看 TK 时露出 TF**，
  // 我当初把它当「通往另一个项目的入口」，方向正好反了：那恰恰就是制作人指出的越界。
  // 现在它只在**身处 Ticketflow 项目时**露出，作为该项目没有管线层的替代入口。
  // 换项目走启动页（#/hub，enterProj 写 localStorage），不在别人的地盘上开后门。
  const tf = `<div class="tkcard card r14" onclick="tkGo('#/tickets/Ticketflow')" tabindex="0" role="button"
      onkeydown="if(event.key==='Enter')tkGo('#/tickets/Ticketflow')" aria-label="进入 Ticketflow 项目">
    <div class="tkh"><span class="mono tkno">TF</span><b class="tkname">Ticketflow</b>
      <span class="pill sm mut" title="工作室自维护自优化：常驻服务，无终点故无管线（制作人 2026-08-20 定）">自维护</span></div>
    <div class="tkfoot">不挂管线——只有「专项 + 工单」两层</div></div>`;
  // 空态：过滤后一张卡都不剩时必须说话。原样直接吐空 tkgrid——白屏一片，
  // 看的人无从判断是「本项目确实没有管线」还是「页面挂了」（2026-08-21 体检）。
  const 身 = 卡 + (p === 'Ticketflow' ? tf : '');
  const 体 = 身 || `<div class="emptycard"><h5>${esc(p || '本项目')}名下还没有管线</h5>
      <p>管线是项目里的一套系统，由制作人立。没有管线不影响开单——单可以直挂专项。</p></div>`;
  return `<div class="sp-head"><b style="font-size:15px">工单 · 归属结构</b>
      <button class="btn accent h32" style="margin-left:auto" onclick="plOpen()" title="G9 人闸：开一条新管线（管线＝项目里的一套系统，由制作人立）">＋ 开线</button>
      <button class="btn h32" onclick="plToggleSealed()" title="封存＝不再接新活，不是删除——历史照常在树里可查">${window._showSealed ? '隐藏封存' : '显示封存'}</button>
      <span class="subnote">管线（系统）→ 特性（功能/规则）→ 专项（一段活）→ 工单。
      点卡进下一层；<b>看板</b>页管的是流转（谁在哪一态），这里管的是归属（谁属于谁）。</span></div>
    <div class="tkgrid">${体}</div>`;
}

/* ---- Ticketflow 专用层：专项 + 直挂工单（不经管线/特性）----
 * H52「不同项目不同形状」：TF 是工作室自维护的常驻服务，无终点故无管线，也没立过特性。
 * 它只有两层——专项与工单——所以这里不是「特性层的替身」，是本项目真正的第二层。
 * 建这个函数的直接理由：TF 卡点进去原先落 tkL2，按 f.管线 过滤必空，页面反倒宣称
 * 「这条管线下还没有特性」，把「本项目没有这一层」谎报成「这一层是空的」。*/
async function tkTF(专项们) {
  const sps = 专项们.filter((x) => x.项目 === 'Ticketflow')
    .sort((a, b) => Number(String(a.id).slice(2)) - Number(String(b.id).slice(2)));
  const 待签 = sps.filter((x) => x.状态 === '收口').length;
  const 卡 = sps.map(spCard).join('')
    || `<div class="emptycard"><h5>还没有专项</h5><p>成团的活开专项，孤的单独挂——散单见下方。</p></div>`;
  setTimeout(() => tkTFDirect(), 0);
  return tkCrumb([{ 名: '工单', 到: '#/tickets' }, { 名: 'Ticketflow' }])
    + `<div class="sp-head"><b style="font-size:15px">Ticketflow · 专项与散单</b>
      <span class="subnote">工作室自维护：常驻服务、无终点，故不设管线与特性层。
      成团的活开专项，孤的继续散着（制作人 2026-08-21 定）。${待签 ? ` <b class="sp-wait">${待签} 个等你关账</b>` : ''}</span></div>
    ${卡}<div id="tk-direct"></div>`;
}

// TF 散单：本项目下不挂任何专项的单。TF 没有特性层，故「无专项」即「散」——
// 不必再问「有没有特性」（features 全挂 P-1..P-4，与 TF 无涉）。
async function tkTFDirect() {
  const el = $('tk-direct'); if (!el) return;
  const d = await loadBoard().catch(() => null);
  if (!d || !$('tk-direct')) return;
  const 单 = (d.all || []).filter((t) => t.项目 === 'Ticketflow' && !t.专项);
  if (!单.length) { el.innerHTML = `<div class="emptycard"><h5>没有散单</h5><p>本项目的活此刻都在专项里。</p></div>`; return; }
  const 终 = new Set(['完成', '归档']); // 完成=做完等关账（专项内部口径）· 归档=落袋
  const 落 = 单.filter((t) => 终.has(t.state)).length;
  const 行 = 单.map((t) => `<a class="sprow${终.has(t.state) ? ' done' : ''}" href="#/t/${esc(t.id)}" title="${esc(t.title || '')}">
      <span class="mono spid">${esc(t.id)}</span><span class="spt">${esc(t.title || '')}</span>
      ${fnPill(t.职能)}${stPill(t.state)}</a>`).join('');
  el.innerHTML = `<details class="spcard card r14 tkdirect" open><summary>散单 ${单.length} 张 · 落袋 ${落}
      <span class="subnote">（不属任何专项）</span></summary><div class="spkids">${行}</div></details>`;
}

/* ---- 第二层：特性卡片（按编号升序——旧专项页乱序是制作人点名的丑因）---- */
function tkL2(pl, 管线们, 特性们) {
  const 线 = 管线们.find((x) => x.id === pl) || { id: pl, 名称: pl };  // TF 已改走 tkTF，此处不再需要它的回落名
  const fs = 特性们.filter((f) => f.管线 === pl)
    .sort((a, b) => Number(String(a.id).slice(2)) - Number(String(b.id).slice(2)));
  const 卡 = fs.map(tkFeatCard).join('')
    || `<div class="emptycard"><h5>这条管线下还没有特性</h5><p>特性是被活撑出来的，不是设计出来的——
      项管拆单时遇到挂不上的活才提请开一个，总监审过才生效。</p></div>`;
  return tkCrumb([{ 名: '管线', 到: '#/tickets' }, { 名: `${线.id} ${线.名称 || ''}` }])
    + `<div class="sp-head"><b style="font-size:15px">${esc(线.名称 || 线.id)} · 特性</b>
      <span class="subnote">系统下的功能/规则，常驻。<b>双击名字可改</b>——工单挂的是 F-n 号不是名字，改名不动挂链。</span></div>
    <div class="tkgrid">${卡}</div>`;
}

// 特性审核署名（2026-08-22 体检 #59）：审核是**总监的人闸**（lib/features 头注：开线是制作人人闸、
// 开特性下放项管、总监审），故与排期同口径显式署名，不吃服务端 FT_ACTIONS.审核 的缺省值。
const 特性审核署名 = '总监';
// 五个写口（提请/审核/编辑/封存/复活）里，前端此前只接了 编辑。「待审」是卡片上唯一画得出来的
// 审批事实，却既无按钮也无闸——项管提请完就躺在那儿，没有任何东西会催（本条只补 审核 这一动作，
// 封存/复活 仍未接线，见交单 note）。
window.ftAudit = async (id, 通过) => {
  if (!await ask(通过 ? `审核通过 ${id}？通过后它才挂得上单。` : `退回 ${id}？退回＝就地封存留痕（不删除），日后可复活。`)) return;
  const 说明 = await askInput(通过 ? '通过理由（可留空）' : '退回理由（写清为什么这个特性不该开）', '');
  if (说明 == null) return;
  const r = await post('/api/features/' + encodeURIComponent('审核'),
    { id, 通过: !!通过, 审核人: 特性审核署名, 说明: String(说明 || '') }).catch((e) => ({ error: String((e && e.message) || e) }));
  if (!r || r.ok === false) return toast((r && r.error) || '审核失败');
  toast(通过 ? `已通过 ${id}（活跃，可挂单）` : `已退回 ${id}（就地封存留痕）`);
  route();
};
function tkFeatCard(f) {
  const 待审 = f.状态 === '待审'; const 封 = f.状态 === '封存';
  const 态 = 待审 ? '<span class="pill sm warn" title="项管提请、总监未审——审过才能挂单">待审</span>'
    : 封 ? `<span class="pill sm mut" title="${esc(f.封存因 || '不再接新活')}">封存</span>` : '';
  const 到 = `#/tickets/${f.管线}/${f.id}`;
  return `<div class="tkcard card r14${封 ? ' tk-sealed' : ''}" onclick="tkGo('${esc(到)}')"
      tabindex="0" role="button" onkeydown="if(event.key==='Enter')tkGo('${esc(到)}')">
    <div class="tkh"><span class="mono tkno">${esc(f.id)}</span>
      <b class="tkname" ondblclick="event.stopPropagation();ftRename('${esc(f.id)}',this)"
         title="双击改名">${esc(f.名称)}</b>${态}
      ${f.系统 ? '<span class="pill sm mut" title="每条管线自带的兜底位：不属任何专项的单挂这里，树因此永远整齐四层">兜底</span>' : ''}</div>
    <div class="spgoal" title="${esc(f.边界 || '')}">${esc(f.边界 || '')}</div>
    <div class="tkmeta"><span class="sppct">${f.单数 ? f.百分比 + '%' : '—'}</span>
      <span class="subnote">${f.单数 ? `${f.落袋}/${f.单数} 落袋` : '还没有单'}</span></div>
    ${tkBar(f)}
    ${待审 ? `<div class="tkacts"><button class="btn accent h32" onclick="event.stopPropagation();ftAudit('${qesc(f.id)}',true)" title="总监人闸：审过才能挂单">审核通过</button>
      <button class="btn h32" onclick="event.stopPropagation();ftAudit('${qesc(f.id)}',false)" title="退回＝就地封存留痕，不是删除">退回</button></div>` : ''}
    <div class="tkfoot">专项 ${f.专项数 || 0} · 直挂单 ${f.直挂单数 || 0}</div></div>`;
}

/* ---- 第三层：专项卡片 + 直挂单 ---- */
function tkL3(pl, ft, 特性们, 专项们) {
  const f = 特性们.find((x) => x.id === ft);
  if (!f) return `<div class="emptycard"><h5>特性 ${esc(ft)} 不在册</h5></div>`;
  const sps = 专项们.filter((s) => s.特性 === ft)
    .sort((a, b) => Number(String(a.id).slice(2)) - Number(String(b.id).slice(2)));
  const 待签 = sps.filter((s) => s.状态 === '收口').length;
  const 卡 = sps.map(spCard).join('');
  setTimeout(() => tkFillDirect(ft), 0);
  return tkCrumb([{ 名: '管线', 到: '#/tickets' }, { 名: pl, 到: `#/tickets/${pl}` }, { 名: `${f.id} ${f.名称}` }])
    + `<div class="sp-head"><b style="font-size:15px">${esc(f.名称)} · 专项与直挂单</b>
      <span class="subnote">${esc(f.边界 || '')}${待签 ? ` <b class="sp-wait">${待签} 个等你关账</b>` : ''}</span></div>
    ${卡}<div id="tk-direct"></div>`;
}

// 直挂单（不经专项、直接挂本特性的单）：单独取一次，默认折叠成一行摘要——
// 旧专项页把子单全铺开正是「卡片高度参差、撑出滚动条」的根因。
async function tkFillDirect(ft) {
  const el = $('tk-direct'); if (!el) return;
  const d = await api('/api/features/' + encodeURIComponent(ft)).catch(() => null);
  if (!d || !$('tk-direct')) return;
  const 单 = d.直挂 || [];
  if (!单.length) { el.innerHTML = ''; return; }
  const 终 = new Set(['完成', '归档']); // 完成=做完等关账（专项内部口径）· 归档=落袋
  const 落 = 单.filter((t) => 终.has(t.state)).length;
  const 行 = 单.map((t) => `<a class="sprow${终.has(t.state) ? ' done' : ''}" href="#/t/${esc(t.id)}" title="${esc(t.fm && t.fm.title || '')}">
      <span class="mono spid">${esc(t.id)}</span><span class="spt">${esc((t.fm && t.fm.title) || '')}</span>
      ${fnPill(t.fm && t.fm.职能)}${stPill(t.state)}</a>`).join('');
  el.innerHTML = `<details class="spcard card r14 tkdirect"><summary>直挂单 ${单.length} 张 · 落袋 ${落}
      <span class="subnote">（不属任何专项，直接挂本特性）</span></summary><div class="spkids">${行}</div></details>`;
}

// 双击改名：就地变输入框，回车/失焦提交，Esc 取消。改名不动挂链（工单记的是 F-n 号不是名字）。
window.ftRename = (id, el) => {
  const 旧 = el.textContent;
  const inp = document.createElement('input');
  inp.className = 'tkrename'; inp.value = 旧; inp.setAttribute('aria-label', '特性名称');
  el.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const 收 = async (存) => {
    if (done) return; done = true;
    const 新 = inp.value.trim();
    if (!存 || !新 || 新 === 旧) { inp.replaceWith(el); return; }
    const r = await post('/api/features/编辑', { id, 名称: 新 });
    if (!r.ok) { toast(r.error || '改名失败'); inp.replaceWith(el); return; }
    toast(`${id} 已改名「${新}」`); route();
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') 收(true); if (e.key === 'Escape') 收(false); };
  inp.onblur = () => 收(true);
};

async function viewSpecials() {
  const d = await api('/api/specials').catch(() => ({ 专项: [] }));
  const p = projActive();
  const all = (d.专项 || []).filter((s) => !p || (s.项目 || projDefault()) === p);
  if (!all.length) {
    return `<div class="emptycard" style="margin-top:30px"><h5>还没有专项</h5>
      <p>专项是<b>容器</b>不是工单（H103）：它装的是一批活，自己不执行、不进审检链、不被派发。
      开一个的路子只有一条——去 <a href="#/relay" style="color:var(--accent-ink)">项管页的想法在池</a> 拍板，
      拍板那一刻落的就是这里的一条容器；立项后项管自动切单，子单才进
      <a href="#/board" style="color:var(--accent-ink)">工单板</a>。</p></div>`;
  }
  // 等签字的排最前（收口态），其余按号。制作人开页第一眼该看见的是「哪个在等我」。
  const 序 = { 收口: 0, 进行: 1, 立项: 2, 关账: 3 };
  const 卡 = [...all].sort((a, b) => (序[a.状态] ?? 9) - (序[b.状态] ?? 9)
    || Number(String(b.id).slice(2)) - Number(String(a.id).slice(2))).map(spCard).join('');
  const 待签 = all.filter((s) => s.状态 === '收口').length;
  return `<div class="sp-head"><b style="font-size:15px">专项 · 容器登记册</b>
      <span class="subnote">想法拍板 → <b>立项</b>（项管自动切单）→ 进行 → 收口 → <b>关账</b>（唯一人闸=你签字）。
      容器不进工单目录、不参与机判/QA/派发。${待签 ? `<b class="sp-wait">${待签} 个等你关账</b>` : ''}</span></div>
    <div class="spgrid">${卡}</div>`;
}

function spCard(s) {
  const a = spAgg(s.进度);
  const 条 = a.空
    ? '<div class="spbar empty" title="还没有子单——切单出结果前不显示任何完成度（不编进度）"></div>'
    : `<div class="spbar">${a.段.map((g) => `<i class="sg-${g.类}" style="width:${g.宽}%" title="${esc(g.名)} ${g.数} 张"></i>`).join('')}</div>`;
  const 子 = (s.子单 || []).map((k) => `<a class="sprow${k.落袋 ? ' done' : ''}" href="#/t/${esc(k.id)}" title="${esc(k.title)}">
      <span class="mono spid">${esc(k.id)}</span><span class="spt">${esc(k.title)}</span>
      ${fnPill(k.职能)}${stPill(k.state)}</a>`).join('')
    || '<div class="dim" style="padding:8px 2px;font-size:12px">还没有子单——项管切单出结果后自动挂进来（子单清单由子单的 <code>专项:</code> 章反向聚合，容器里不手维护）</div>';
  const 预 = s.预算 || {};
  const 账 = [
    `预计 ${预.预计h || 0}h`,
    `实耗 ${预.实耗h || 0}h`,
    预.偏差pct != null ? `偏差 ${预.偏差pct}%` : null,
    预.实耗token ? `${Math.round(预.实耗token / 1000)}k token` : null,
  ].filter(Boolean).join(' · ');
  const 基线 = (s.基线 || []).slice(-4).map((b) => `<div class="spbl"><span class="pill sm mut">${esc(b.类型)}</span>${esc(b.说明)}</div>`).join('');
  const 关账钮 = s.状态 === '收口'
    ? `<button class="btn accent h32" onclick="spClose('${esc(s.id)}')" title="唯一人闸：签字即收档，签完不再回头">✍ 关账签字</button>`
    : s.状态 === '关账'
      ? `<span class="pill sm ok" title="${esc(String(s.关账时间 || '').slice(0, 16).replace('T', ' '))}">已关账 · ${esc(s.关账签字 || '制作人')}</span>`
      : `<span class="dim" style="font-size:12px">关账要等收口（现在：${esc(SP_态释[s.状态] || s.状态)}）</span>`;
  const 报告 = s.收口报告 ? `<button class="btn h32" onclick="spReport('${esc(s.id)}')">📄 收口报告</button>` : '';
  return `<div class="spcard card r14 st-${esc(s.状态)}">
    <div class="sph"><span class="mono spno">${esc(s.id)}</span><b class="spname">${esc(s.名称)}</b>
      <span class="pill sm sp-st">${esc(s.状态)}</span>
      ${s.管线 ? `<span class="pill sm mut" title="管线归属（H51）">${esc(s.管线)}</span>` : ''}
      ${(s.别名 || []).length ? `<span class="pill sm mut" title="实体化前的伪工单号（施工令-058 迁移）">原 ${esc(s.别名.join('、'))}</span>` : ''}</div>
    <div class="spgoal">${esc(s.目标 || '')}</div>
    <div class="spmeta"><span class="sppct">${a.空 ? '—' : a.百分比 + '%'}</span>
      <span class="subnote">${a.空 ? '无子单' : `${s.进度.落袋}/${s.进度.总数} 落袋`} · ${esc(SP_态释[s.状态] || '')}</span></div>
    ${条}
    <div class="spacct">${esc(账)}</div>
    <div class="spkids">${子}</div>
    ${基线 ? `<details class="spbase"><summary>基线变迁 · 最近 ${Math.min(4, (s.基线 || []).length)} 条</summary>${基线}</details>` : ''}
    <div class="spops">${报告}${关账钮}</div></div>`;
}

window.spClose = async (id) => {
  // 先探一次：缺完成定义的就地补，补完再签（2026-08-20）。
  // 不做成「弹窗里顺手填一句」而是两步走——补完成定义本身就是一次判断：
  // 写不出「做到什么程度算完」，说明这批活的边界还没想清楚，那此刻就不该签字。
  // 案源：S-1（22 张子单全落袋被推收口，而编辑器交互层正被 S-3 重构）与 S-3（一行重构没写，
  // 只因调研需求单验收了就被推收口）两次误催签字——机器判得出「没活在跑」，判不出「做完了」。
  let sp = await api('/api/specials/' + encodeURIComponent(id)).catch(() => null);
  if (sp && !sp.完成定义) {
    const 文 = await askInput(`${id} 还没有完成定义——关账签的是「这句话达成了」，不是「没活在跑了」。先写一句可判定的：做到什么程度算这个专项完了？`,
      '', { placeholder: '例：制作人能在编辑器里顺手改图（手感过闸）' });
    if (文 == null) return;                       // 取消（Esc/点遮罩）：整条中止，不当成空串
    if (!文.trim()) return toast('完成定义不能为空，关账取消');
    const d = await post('/api/specials/定完成定义', { id, 文 });
    if (!d.ok) return toast(d.error || '补完成定义失败');
    sp = await api('/api/specials/' + encodeURIComponent(id)).catch(() => null);
  }
  const 对照 = sp && sp.完成定义 ? `

对照完成定义：
「${sp.完成定义}」

这句话达成了吗？` : '';
  if (!await ask(`关账 ${id}？${对照}

这是本专项唯一的人闸：签完即收档，容器从此不再收新子单。`)) return;
  const r = await post('/api/specials/关账', { id, 签字人: '制作人' });
  if (!r.ok) return toast(r.error || '关账失败');
  toast(`${id} 已关账`); route();
};
window.spReport = async (id) => {
  const s = await api('/api/specials/' + encodeURIComponent(id)).catch(() => null);
  if (!s || !s.收口报告) return toast('收口报告还没出');
  // 报告是明文文件，路径直接摊在弹层里（可复制）——不在页面里再造一个 markdown 阅读器。
  await ask(`收口报告 · ${id}\n\n${s.收口报告}\n\n（明文文件，本机双击即开）`);
};

/* ===== P14 想法池（H49 双域·制作人层域）=====
   2026-08-20 页签定案 11→8：想法页撤销，本区并入项管页第三块「想法在池」。
   viewIdeas 随之化成**片段函数** ideaPoolHtml（原实现逐字照搬，没有第二套渲染）：
   入池/拍板/放弃三个动作与它们的 window 全局（ideaAdd/ideaAct）一个字都不动——
   **拍板是制作人的唯一人闸**，按钮语义与去处（→ 专项页补边界与验收标准）不许随版面改动而改。 */
function ideaPoolHtml(想法) {
  const cards = (想法 || []).map((x) => `<div class="idea card r14">
      <div class="it">${esc(x.文本)}</div>
      ${x.备注 ? `<div class="in2">${esc(x.备注)}</div>` : ''}
      <div class="ia"><span class="subnote">${esc(String(x.t).slice(5, 10))}</span><span class="sp"></span>
        <button class="btn h32" onclick="ideaAct('放弃','${esc(x.id)}')">放弃</button>
        <button class="btn accent h32" onclick="ideaAct('拍板','${esc(x.id)}')">拍板 → 专项</button></div></div>`).join('')
    || '<p class="dim" style="text-align:center;margin:24px 0">想法池空。灵感随手扔进来——没有验收标准、没有排期压力，拍板那一刻才进项目组域。</p>';
  return `<div class="rl-input" style="margin:0 0 14px"><textarea id="idea-t" placeholder="一句话想法…（Ctrl+Enter 入池）" onkeydown="if(event.ctrlKey&&event.key==='Enter')ideaAdd()"></textarea>
      <button class="btn accent h44" onclick="ideaAdd()">入池</button></div>
    <div class="ideagrid">${cards}</div>`;
}
window.ideaAdd = async () => {
  const t = $('idea-t').value.trim(); if (!t) return;
  const r = await post('/api/ideas', { 文本: t });
  if (!r.ok) return toast(r.error || '失败');
  $('idea-t').value = ''; route();
};
window.ideaAct = async (动作, id) => {
  if (动作 === '放弃' && !await ask('放弃这个想法？')) return;
  const r = await post('/api/ideas', { 动作, id });
  if (!r.ok) return toast(r.error || '失败');
  // 施工令-058：拍板落的是专项容器，不再是伪工单。
  // **落点订正（2026-08-21 体检）**：原先跳 `#/specials`，而那一页已随四层架构改版摘牌，
  // 经 tkLevel() 解析后落到管线卡片层——制作人被告知「去补齐边界」，看到的却是管线网格，
  // 而新立的专项**不在其中**（它的 特性 恒为 null，全 UI 无处可寻）。
  // 现改跳工单页顶层并如实说明它还没归属；「立项时定归属」是改人闸流程的活，另列待办不在此处顺手做。
  if (动作 === '拍板') {
    toast(`专项 ${r.专项} 已立项 · 尚未挂到特性下，需先指定归属才在结构里找得到`);
    location.hash = '#/tickets';
    return;
  }
  route();
};

/* ===== P13 项管信道（0.18.6，前身遥控传令板）：制作人 ↔ 项管问答 + 汇报流 ===== */
// 台账时刻 → 本地时钟串。ISO 是 UTC，必须转本地时区再显示（用户实测：00:16 曾显示成 16:16）；
// 当日只显 HH:MM，跨日才带月-日（窄列不折行——2026-08-06 UI 评审项管页）。
// 施工令-037：事件链每一行的时间戳与流水共用这一把尺，两处显示不许各算各的。
function locHM(iso) {
  const d0 = new Date(iso); const p2 = (n) => String(n).padStart(2, '0');
  if (isNaN(d0)) return String(iso || '').slice(5, 16).replace('T', ' ');
  const sameDay = d0.toDateString() === new Date().toDateString();
  return sameDay ? `${p2(d0.getHours())}:${p2(d0.getMinutes())}`
    : `${p2(d0.getMonth() + 1)}-${p2(d0.getDate())} ${p2(d0.getHours())}:${p2(d0.getMinutes())}`;
}
function pmEventLine(e) {
  const t = locHM(e.t);
  if (e.类型 === '待审') return { t, txt: e.单 ? `受托起草：${e.单}（待审稿候总监审核）` : `拆单完成：${e.父单} → ${(e.子单 || []).join('、')}，简报呈 Claude 审批`, hot: true };
  if (e.类型 === '切单启动') return { t, txt: `开始拆单：${e.父单}（仓况盘点中）`, hot: true };
  // 施工令-054：拒切候期是合法出口，渲染上要与「切单失败」分得开——通用分支只画得出
  // 「切单候期：P-1」，而这条事件的信息全在理由与复切时机里，摊不开等于判语又被吞一次。
  if (e.类型 === '切单候期') return { t, txt: `拒切候期：${e.父单}——${e.理由 || '未述理由'}｜复切时机：${e.复切时机 || '未述'}`, hot: true };
  if (e.类型 === '派发') return { t, txt: `派发 ${e.id} → ${e.池} 池` };
  if (e.类型 === '收口') return { t, txt: `专项收口：${e.父单}，收口报告已出`, hot: true };
  if (e.类型 === '上呈') return { t, txt: `上呈制作人：${e.原因 || e.父单 || ''}${e.异常单 ? '（' + e.异常单.join('、') + '）' : ''}`, hot: true };
  if (e.类型 === '额度报警') return { t, txt: `额度报警：${e.详情 || ''}`, hot: true };
  // 2026-08-06 UI 评审：新事件类型补渲染分支（此前落通用分支渲染成空行）
  if (e.类型 === '裁决') return { t, txt: `评估回呈裁决 ${e.单 || ''}：${e.处置 || ''}`, hot: true };
  if (e.类型 === '评估回呈') return { t, txt: `评估回呈 ${e.单 || ''}（第 ${e.轮 || 1} 轮）：执行会话判做不了，项管裁决中`, hot: true };
  if (e.类型 === '宽限') return { t, txt: `软超时宽限 ${e.单 || ''}：仍在进展，续命（已跑 ${e.已跑分 || '?'} 分钟）` };
  if (e.类型 === '巡检') return e.异常 ? { t, txt: `巡检异常 ×${e.异常}（在途 ${e.在途 ?? '?'}）`, hot: true } : null; // 无异常心跳不占流水
  if (e.类型 === '派单委托') return { t, txt: `派单委托受理：${String(e.需求 || '').slice(0, 40)}…`, hot: true };
  if (e.类型 === '定稿放行') return { t, txt: `定稿放行 ${e.单 || ''}` };
  if (e.类型 === '收口待验') return { t, txt: `专项全落袋 ${e.父单 || ''}（子单 ${e.子单数 || '?'}）→ 收口报告生成中` };
  if (e.类型 === '迁移') return { t, txt: `归位 ${e.id || ''}（池→待投）` };
  // H101 · 施工令-050：估时校准留痕。通用分支只渲得出「估时校准：TK-x」，
  // 而这条事件的信息全在「校前→校后、系数、样本数」里——不摊开等于账落了却对不了。
  if (e.类型 === '估时校准') {
    const 段 = (n, x) => (!x || x.校前 == null ? `${n} 未校`
      : x.来源 === '无样本' ? `${n} ${x.校前} 不动（无样本）`
        : `${n} ${x.校前}→${x.校后}（×${x.系数}·${x.样本数} 样本）`);
    return { t, txt: `估时校准 ${e.单 || ''}：${段('时间', e.时间)}｜${段('token', e.token)}` };
  }
  /* 分桶明细补渲染（2026-08-20，项管行为块换吃 /api/pm/actions 之后）。
     案由：这几类此前从没进过窗口（尾 80 条全被巡检与台账对齐占满），于是也从没人发现
     通用分支把它们渲成「池衡拒绝：」「台账孤粒：」这样的空行——桶开出来了，桶里却是白的。
     一律只摊事件自带的字段，不在这里推断任何东西。 */
  if (/^池衡/.test(e.类型)) {
    const 走向 = e.从 || e.到 ? `${e.从 || '?'}→${e.到 || '?'}` : '';
    return { t, txt: `${e.类型}${e.位 ? ' ' + e.位 : ''}${走向 ? ' ' + 走向 : ''}${e.因类 ? ` · ${e.因类}` : ''}${e.因 ? '：' + String(e.因).slice(0, 60) : ''}`, hot: e.类型 === '池衡越权' };
  }
  if (/^排程/.test(e.类型)) {
    const 尾 = e.新增 != null ? `新增 ${e.新增}${e.跳过 ? ` · 判重跳过 ${e.跳过}` : ''}`
      : e.目标 ? `→ ${e.目标}${e.单号 ? ' · ' + e.单号 : ''}` : (e.粒ID ? String(e.粒ID).slice(0, 8) : '');
    return { t, txt: `${e.类型}（${e.操作者 || '未署名'}）${尾 ? '：' + 尾 : ''}` };
  }
  if (e.类型 === '台账孤粒') return { t, txt: `台账孤粒：${e.单号 || ''}「${String(e.题 || '').slice(0, 40)}」全库找不到对应单，待裁`, hot: true };
  if (/^OAuth/.test(e.类型)) return { t, txt: `${e.类型}${e.池 ? ' ' + e.池 : ''}${e.结果 ? '：' + e.结果 : (e.详情 ? '：' + String(e.详情).slice(0, 60) : '')}`, hot: e.类型 !== 'OAuth自续' };
  if (['零派发', '打点停滞', '零输出'].includes(e.类型)) return { t, txt: `${e.类型}：${e.详情 || e.id || e.单 || ''}`, hot: true };
  if (e.类型 === '收口报告') return { t, txt: `收口报告出：${e.父单 || ''}`, hot: true };
  if (e.类型 === '专项关账') return { t, txt: `专项关账 ${e.父单 || e.专项 || ''}（${e.操作者 || '制作人'}）`, hot: true };
  return { t, txt: `${e.类型}：${e.id || e.单 || e.父单 || ''}` };
}
// 编制快照（H85 补章「去岗位化」）：**每职能一行**——职能 / 池序（带优先级箭头 + 各池档位）/ 可用性。
// -A/-B 岗位号已随常驻岗位时代退役：派发制下执行者因单而生，编制记的是「这职能能在哪些池上干、按什么顺序」。
// 纯展示，无编辑控件（编制是项管所辖数据，调整走 /api/pm/roster）。可用性不在前端另算一套：
// 服务端用 dispatch.poolFrozen 实算后下发——首个可用池绿「在岗」、池序全冻黄「止派」，
// 案源 2026-08-06 美术编制唯一挂冻结池却全绿的假健康。
function rosterSnapHtml(编制) {
  if (!编制 || !编制.length) return '<p class="dim">（无编制数据）</p>';
  return 编制.map((r) => {
    const cls = r.可用 === true ? 'ok' : r.可用 === false ? 'warn' : 'mut';
    const 池序 = (r.池序 || []).map((p, i) => {
      const 冻 = p.冻结 === true;
      const 走 = p.池 === r.首个可用; // 当前实际会走的那个池：加粗描边，一眼看出优先级落点
      return `${i ? '<span class="dim" style="margin:0 4px">→</span>' : ''}<span class="poolp pill sm fn ${p.池 === 'claude' ? 'pool-claude' : 'pool-codex'}"`
        + `${冻 ? ' style="opacity:.45;text-decoration:line-through"' : (走 ? ' style="outline:1.5px solid var(--ok);outline-offset:1px"' : '')}`
        + ` title="${冻 ? '该池已冻结（额度锁/护城河）' : 走 ? '当前路由落点' : '备选池'}">${esc(p.池)}${p.档 ? ' · ' + esc(p.档) : ''}${p.默认 ? ' · 职能默认' : ''}</span>`;
    }).join('') || '<span class="pill sm mut">未挂池</span>';
    return `<div class="teamrow card" style="border-left-color:${FNHEX[r.职能] || 'var(--line)'}">
      <b>${esc(r.职能)}</b>${fnPill(r.职能)}
      <span style="display:inline-flex;align-items:center;flex-wrap:wrap">${池序}</span>
      <span class="stpill pill sm ${cls}">${esc(r.态 || '')}</span></div>`;
  }).join('');
}
/* ===== 关键汇报 · 一单一链（施工令-037，制作人 2026-08-09 18:34 批准设计稿）=====
   案源：平铺事件行每条都是断头账。制作人点名——「每一项都应该有回应：什么时候被委托起草/
   切单/送审/审过/派发、为什么派发、后续等待什么、状态怎么样」。
   数据全部由服务端 lib/pm/chain 算好下发（口径唯一、可单测），前端只画不判：
   徽章三档与「现在等什么」都读 c.档 / c.等，**绝不在这里另立一套状态推断**。 */
const KOPEN = 'studio.kchain.open'; // 展开态跨刷新保持：只存「制作人手动改过的那些单」
function kOpenMap() { try { return JSON.parse(localStorage.getItem(KOPEN) || '{}') || {}; } catch { return {}; } }
function kOpenSave(m) { try { localStorage.setItem(KOPEN, JSON.stringify(m)); } catch { /* 隐私模式拿不到就算了 */ } }
// 默认：活单展开、完成单折叠（设计稿定案）；手动改过的以 localStorage 为准。
const kIsOpen = (c, m) => (Object.prototype.hasOwnProperty.call(m, c.id) ? !!m[c.id] : !!c.活);
window.kToggle = (id) => {
  const el = document.querySelector(`.kitem[data-kid="${CSS.escape(id)}"]`);
  if (!el) return;
  const now = !el.classList.contains('open');
  el.classList.toggle('open', now);
  const arrow = el.querySelector('.karrow'); if (arrow) arrow.textContent = now ? '▾' : '▸';
  const m = kOpenMap(); m[id] = now; kOpenSave(m);
};
function kChainHtml(链) {
  if (!链 || !链.length) return '<p class="dim">暂无关键汇报。</p>';
  const m = kOpenMap();
  // 顺手剪枝：只留还在当前卡片里的键，不然这个 map 会永远长下去
  const 活键 = {}; for (const c of 链) if (Object.prototype.hasOwnProperty.call(m, c.id)) 活键[c.id] = m[c.id];
  if (JSON.stringify(活键) !== JSON.stringify(m)) kOpenSave(活键);
  return 链.map((c) => {
    const open = kIsOpen(c, 活键);
    const steps = (c.链 || []).map((s) => `<div class="kstep">
        <span class="kt">${esc(s.t ? locHM(s.t) : '·')}</span><span class="kx">${esc(s.文)}</span>${s.因 ? `<span class="kwhy"> · ${esc(s.因)}</span>` : ''}</div>`).join('')
      || '<div class="kstep kmiss"><span class="kt">·</span><span class="kx">台账窗内无该单事件、工单也没留下时间戳——缺站不补造</span></div>';
    // 尾端恒有一行：活单答「现在停在哪」+「在等谁」，终态单答「怎么收的」。
    const 尾 = c.等
      ? `<div class="kstep now"><span class="kt">现在</span><span class="kx">停在「${esc(c.态)}」${c.返修轮 ? ` · 第 ${c.返修轮 + 1} 轮` : ''}</span></div>`
      : `<div class="kstep fin"><span class="kt">终</span><span class="kx">${esc(c.徽)}</span></div>`;
    const foot = c.等
      ? `<div class="kfoot ${c.等.闸 === '人' ? 'human' : 'mach'}">⏳ 现在等：${esc(c.等.什么)}<b> —— 等${esc(c.等.谁)}</b></div>`
      : '';
    return `<div class="kitem${open ? ' open' : ''}" data-kid="${esc(c.id)}">
      <div class="khead" onclick="kToggle('${qesc(c.id)}')" title="点头行展开/收起（展开态跨刷新保持）">
        <span class="karrow">${open ? '▾' : '▸'}</span>
        <a class="kid" href="#/t/${encodeURIComponent(c.id)}" onclick="event.stopPropagation()">${esc(c.id)}</a>
        <span class="ktitle">${esc(c.title || '')}</span>
        ${c.职能 ? fnPill(c.职能) : ''}
        <span class="kst ${c.档}">${esc(c.徽)}</span>
      </div>
      <div class="kbody"><div class="kline">${steps}${尾}</div>${foot}</div>
    </div>`;
  }).join('');
}
const kSig = (链) => (链 || []).map((c) => `${c.id}|${c.态}|${c.徽}|${(c.链 || []).length}`).join(',');
/* ===== 项管页（#/relay）· 2026-08-20 制作人页签定案改造：待办队列 + 甘特 + 排期 =====
   案由（制作人原话两句）：
     「待办队列就像是一堆想法一堆块，项目管理分好了之后堆在那，总监和制作人按照工作节奏
       开始一堆一堆扔到工单队列里，这时候项管开始自行做排期推进落地」
     「项管责任很关键，一定要给足相对应的权力，并且**让它的行为可视化**」
   于是本页＝**未来面**（现在面归看板与在途），四块自上而下：
     ① 甘特图    排期的脸：一行一条待办，计划条 ＋ 基线影子，两条错位就是延期的可视证据
     ② 待办队列  承接原 #/queue：按 批→序 分组，带「就绪打勾」与「重排」——排期的手
     ③ 想法在池  承接原 #/ideas：入池/拍板/放弃三动作原样照搬，拍板仍是制作人唯一人闸
     ④ 项管行为  承接原「关键汇报＋详细流水」，流水改吃 /api/pm/actions 分桶
   页头保留只读的值守状态条与编制快照（可折叠）。

   【三条落地时踩定的口径，改一处就是改事实源】
   一· **不自己算延期/超期**。判定的唯一实现是 lib/pm/schedule.工期判定（服务端纯函数，已单测），
        前端复刻一遍＝同一件事两把尺，迟早出现「甘特图说超期 3 天、晨晚报说没超期」而无人判得清谁对。
        **2026-08-21 体检纠正**：服务端从 08-20 起已随每粒下发 判定（server.js 的 /api/schedule），
        而本页脚注还写着「不下发、故只画不判」——那句话把 3 条真延期藏了一整天。
        现在改为**读服务端判定**挂红条与徽标；纪律不变：只读不算。
   二· ~~本页跨项目，不随项目滤镜~~ —— **2026-08-21 制作人推翻**：「在一个项目里能看到另外一个
        项目的东西，这不对，不合理」。当时不过滤的理由是「滤镜会把 20 条 Q 队列整批判成未归属」，
        那是**待办没有 项目 这一格**时的症状；同日补了字段并回填 122 条，滤镜即恢复正常
        （实测 TK 13 / TF 24，未归属 0）。判据只许有服务端 项目视界() 一处。
   三· **写账署名「总监」**。后端 操作域.调整/重排 = ['项管','总监']，**制作人不在域内**
        （2026-08-20 随职责收窄：排期归项管主动维护）。页面上的手一律以总监代劳落账并在页面明说，
        不冒充项管——排程账是只追加的审计账，署错名比少一个按钮糟得多。 */
const 排期署名 = '总监';
const 排期终态 = ['完成', '撤销'];
let rlFold = { 编制: true };   // 页头编制快照默认折起（它是查证用的底账，不是每次开页都要读的东西）
window.rlToggle = (k) => {
  rlFold[k] = !rlFold[k];
  const box = $('rl-' + k); if (box) box.classList.toggle('fold', !!rlFold[k]);
};

// @testable-begin 甘特几何
/* 甘特几何（纯函数 · 零 DOM · 零 fetch，只做算术）：日期串 → 时间窗 → 百分比条。
   **这一层一个字都不判延期/超期**（见上「口径一」）：它只回答「这条日期该画在横轴哪一段」。
   算术抽成纯函数是为了能被问责——条画错位这种事，肉眼在一张 40 天宽的图上是看不出来的。 */
const 天毫 = 86400000;
// 日期串 → UTC 零点毫秒。接 'YYYY-MM-DD' 与完整 ISO 时刻串（取日部分），与 lib 的 规范日期 同口径。
// 认不出一律 null，不拿 0 或今天冒充：凭空补出来的日期会一路静默画成一条像模像样的条。
const 日毫 = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v == null ? '' : v)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const 毫日 = (ms) => (ms == null ? '' : new Date(ms).toISOString().slice(0, 10));
const 毫月日 = (ms) => (ms == null ? '' : 毫日(ms).slice(5));
// 一条待办在图上的四个端点。基线是系统在首次排期时立下的、此后不随重排变的那一份（040 定义），
// 现态里原样躺着，所以影子条是**读**出来的，不是算出来的。
function 甘特端点(g) {
  const x = g || {};
  const 计划起 = 日毫(x.计划开始), 计划讫 = 日毫(x.计划完成);
  const 基线起 = 日毫(x.基线开始), 基线讫 = 日毫(x.基线完成);
  return {
    计划起, 计划讫, 基线起, 基线讫,
    已排期: 计划起 != null || 计划讫 != null,
    有基线: 基线起 != null || 基线讫 != null,
    // 挪过 = 现计划与基线不是同一段。**它不是「延期」**：延期是有方向、有天数的判定，
    // 归 工期判定；这里只说「这两条不重合」，正是制作人要的那个「可视证据」。
    挪过: (基线起 != null || 基线讫 != null) && (计划起 !== 基线起 || 计划讫 !== 基线讫),
  };
}
// 时间窗：所有端点 ∪ 今日，前后各留 2 天余白（条贴着边框看不出头尾）。一个端点都没有 → 空窗。
function 甘特窗(粒们, 今日) {
  const 点 = [];
  for (const g of (粒们 || [])) {
    const e = 甘特端点(g);
    for (const v of [e.计划起, e.计划讫, e.基线起, e.基线讫]) if (v != null) 点.push(v);
  }
  const 今 = 日毫(今日);
  if (!点.length) return { 空: true, t0: null, t1: null, 天数: 0, 今 };
  if (今 != null) 点.push(今);
  const t0 = Math.min(...点) - 2 * 天毫;
  const t1 = Math.max(...点) + 2 * 天毫;
  return { 空: false, t0, t1, 天数: Math.round((t1 - t0) / 天毫) + 1, 今 };
}
// 端点 → 百分比条。**含尾日**：8/20→8/20 是一整天宽，不是零宽的一条线
// （半开区间画法会让所有单日任务从图上消失，而单日任务恰恰是待办队列里的多数）。
// 只有一端有日期时按那一天画一格并标记 单端——不替项管补另一端，补出来的边界会被当成他排的。
function 甘特段(起, 讫, 窗) {
  if (!窗 || 窗.空) return null;
  if (起 == null && 讫 == null) return null;
  const a = 起 == null ? 讫 : 起;
  const b = 讫 == null ? 起 : 讫;
  const 总 = 窗.天数 * 天毫;
  const left = Math.max(0, ((a - 窗.t0) / 总) * 100);
  const 宽 = ((b - a + 天毫) / 总) * 100;
  return { left, width: Math.max(0.6, Math.min(100 - left, 宽)), 单端: 起 == null || 讫 == null };
}
// 横轴刻度：目标 N 格，按天数取整步长（步长不足 1 天时退回 1 天——一天画两个刻度没有意义）。
function 甘特刻度(窗, 目标) {
  if (!窗 || 窗.空) return [];
  const 步 = Math.max(1, Math.ceil(窗.天数 / Math.max(1, Number(目标) || 8)));
  const out = [];
  for (let i = 0; i < 窗.天数; i += 步) out.push({ 日: 毫日(窗.t0 + i * 天毫), left: (i / 窗.天数) * 100 });
  return out;
}
// @testable-end 甘特几何

// 停摆时长：距最后一次事件多少天。**这不是延期判定**——它与计划日期无关（一条压根没排过期的
// 待办同样有停摆时长），回答的是「这条躺了多久没人碰」。同 流程页「闲置 N 天」的既有口径。
const 停摆天 = (g, now) => {
  const t = Date.parse((g && (g.更新时刻 || g.登记时刻)) || '');
  return Number.isNaN(t) ? null : Math.max(0, Math.floor(((now || Date.now()) - t) / 天毫));
};

/* ---- ① 甘特图 ---- */
// 上级名：F-10 这种裸号在界面上没意义，得显示「手修编辑器」。
// 名册由 /api/schedule 随现态下发（服务端合并特性册与专项册，前端不自己拼——两处各拼一遍就是两把尺）。
// 取不到就退化成裸号：**退化要看得见**，不许显示成空白让人以为这条没有归属。
let 名册 = {};
const 上级名 = (up) => (up ? (名册[up] ? `${up} ${名册[up]}` : up) : '散单');

function 甘特Html(粒们, 今日, 未归属 = []) {
  const 排了 = []; const 没排 = [];
  for (const g of (粒们 || [])) (甘特端点(g).已排期 || 甘特端点(g).有基线 ? 排了 : 没排).push(g);
  const 窗 = 甘特窗(排了, 今日);
  const 刻度 = 甘特刻度(窗, 9);
  const 今left = 窗.空 || 窗.今 == null ? null : ((窗.今 - 窗.t0) / (窗.天数 * 天毫)) * 100;
  const 行 = 排了.map((g) => {
    const e = 甘特端点(g);
    const 计划 = 甘特段(e.计划起, e.计划讫, 窗);
    const 基线 = 甘特段(e.基线起, e.基线讫, 窗);
    // 判定由服务端下发（lib/pm/schedule.工期判定），前端只读不算——两把尺是这本账最贵的病。
    const j = g.判定 || null;
    const 提 = [`${上级名(g.上级)}${g.序 ? '·' + g.序 : ''}　${g.题 || ''}`,
      `状态：${g.状态 || ''}`,
      `计划：${e.计划起 ? 毫日(e.计划起) : '未定'} → ${e.计划讫 ? 毫日(e.计划讫) : '未定'}`,
      `基线：${e.基线起 ? 毫日(e.基线起) : '未立'} → ${e.基线讫 ? 毫日(e.基线讫) : '未立'}`,
      g.工期天 == null ? '' : `工期 ${g.工期天} 天`,
      // 2026-08-21 体检纠正：原先这里写「延期天数待服务端下发」，而服务端从 08-20 起
      // 就随每粒下发 判定 了——**这句话把 3 条真延期藏了一整天**。
      j && j.延期 ? `延期 ${j.延期天} 天（现计划较基线累计往后挪了这么多）` : '',
      j && j.超期 ? `已超期 ${j.超期天} 天（说好的日子到了，活还在）` : '',
      j && !j.超期 && !排期终态.includes(g.状态) && j.余量天 != null ? `余量 ${j.余量天} 天` : '',
      j && j.超期完成 ? `超期完成 ${j.超期完成天} 天` : '',
      j && j.需重排 ? '★ 该重排了' : '',
      e.挪过 && !(j && j.延期) ? '计划较基线挪过（方向未判：缺基线或缺计划日）' : '',
      '点这一行改排期',
    ].filter(Boolean).join('\n');
    return `<div class="gtrow${e.挪过 ? ' moved' : ''}${j && j.超期 ? ' gt-od' : ''}${j && j.延期 ? ' gt-late' : ''}" data-gid="${esc(g.粒ID)}" title="${esc(提)}"
        tabindex="0" role="button" onclick="tqReplan('${qesc(g.粒ID)}')"
        onkeydown="if(event.key==='Enter'){tqReplan('${qesc(g.粒ID)}')}">
        <span class="gtlab"><i class="gts mono">${esc(上级名(g.上级))}${g.序 ? '·' + g.序 : ''}</i><b>${esc(g.题 || '')}</b>${
          j && j.需重排 ? '<em class="gtflag" title="超期未了结：该重排了">该重排</em>'
            : (j && j.延期 ? `<em class="gtflag late" title="现计划较基线累计挪了 ${j.延期天} 天">延 ${j.延期天}d</em>` : '')
        }</span>
        <span class="gttrack">
          ${基线 ? `<i class="gtbase" style="left:${基线.left.toFixed(3)}%;width:${基线.width.toFixed(3)}%"></i>` : ''}
          ${计划 ? `<i class="gtbar ${QCLS[g.状态] || ''}${计划.单端 ? ' half' : ''}" style="left:${计划.left.toFixed(3)}%;width:${计划.width.toFixed(3)}%"></i>` : ''}
        </span>
        <span class="gtwhen mono">${esc(e.计划讫 ? 毫月日(e.计划讫) : (e.计划起 ? 毫月日(e.计划起) + '→?' : '—'))}</span></div>`;
  }).join('');
  const 图 = 窗.空
    ? `<div class="gtempty">整张甘特图是空的——<b>${没排.length} 条待办没有一条排过日期</b>。
        （2026-08-20 盘账：排程账 200 条里「调整 0、项管转移 0」——项管只登记，从不排、从不推。）
        下面每条「排期 →」就是第一笔：填上计划起讫与因，条立刻出现在这里。</div>`
    : `<div class="gtwrap">
        <div class="gtaxis"><span class="gtlab"></span><span class="gttrack">
          ${刻度.map((k) => `<i class="gttick" style="left:${k.left.toFixed(3)}%"><em>${esc(k.日.slice(5))}</em></i>`).join('')}
          ${今left == null ? '' : `<i class="gttoday" style="left:${今left.toFixed(3)}%" title="今日 ${esc(今日)}"><em>今</em></i>`}
        </span><span class="gtwhen"></span></div>
        <div class="gtbody">${行}</div></div>`;
  const 未排 = 没排.length
    ? `<div class="gtun"><div class="gtunh">未排期 <b>${没排.length}</b> 条 —— 没有日期就画不出条，它们不在图上，但活还在
        <span class="subnote">点任一条排期（写账署名 ${esc(排期署名)}）</span></div>
      <div class="gtunl">${没排.map((g) => `<button class="gtunrow" onclick="tqReplan('${qesc(g.粒ID)}')"
        title="${esc(`${g.题 || ''}\n来源：${g.来源 || '（未注明）'}\n状态：${g.状态 || ''}`)}">
        <i class="gts mono">${esc(上级名(g.上级))}${g.序 ? '·' + g.序 : ''}</i><b>${esc(g.题 || '')}</b>
        <span class="qb ${QCLS[g.状态] || ''}">${esc(g.状态 || '')}</span><em>排期 →</em></button>`).join('')}</div></div>`
    : '';
  // 未归属：按项目过滤时，没有 项目 这一格的待办会**两个项目都看不见**——那是比越界更糟的漏账。
  // 故单列一行如实报出来，并给一键归属的入口。零条时整块不渲染（空态不占版面）。
  const 未归 = 未归属.length
    ? `<div class="gtun gtun-x"><div class="gtunh">未归属 <b>${未归属.length}</b> 条 —— 没写项目的待办不属于任何一个项目视图，
        <span class="subnote">按项目过滤时它们两边都看不见；点一条指定归属</span></div>
      <div class="gtunl">${未归属.map((g) => `<button class="gtunrow" onclick="tqSetProj('${qesc(g.粒ID)}')"
        title="${esc(`${g.题 || ''}
来源：${g.来源 || '（未注明）'}
状态：${g.状态 || ''}`)}">
        <i class="gts mono">${esc(上级名(g.上级))}${g.序 ? '·' + g.序 : ''}</i><b>${esc(g.题 || '')}</b>
        <span class="qb ${QCLS[g.状态] || ''}">${esc(g.状态 || '')}</span><em>归属 →</em></button>`).join('')}</div></div>`
    : '';
  return `<div class="rlcard card r14" id="rl-gantt">
    <div class="rlch"><b>甘特图</b>
      <span class="subnote">一行一条待办 · 实条＝现计划 · 淡底条＝基线（首次排期时立下，此后不随重排变）</span>
      <span class="sp"></span>
      <span class="rlnum mono">已排期 ${排了.length} · 未排期 ${没排.length}</span></div>
    ${图}${未排}${未归}
    <div class="fglegend gtlg">
      <span><i class="lg-gbar"></i>实条＝计划开始→计划完成</span>
      <span><i class="lg-gbase"></i>淡底条＝基线区间；两条错位（本行加左侧竖标）＝计划较基线挪过</span>
      <span><i class="lg-gtoday"></i>今日线</span>
      <span><i class="lg-gflag"></i>「延 Nd」＝现计划较基线累计后挪；「该重排」＝已超期未了结</span>
      <span class="subnote">延期/超期的判定只有一处实现：服务端 <span class="mono">lib/pm/schedule.工期判定</span>，
        随 <span class="mono">GET /api/schedule</span> 逐粒下发；本页只读不算（前端复刻一份就是两把尺）。</span></div>
  </div>`;
}

/* ---- ② 待办队列 ---- */
// 行 = 服务端队列卡（判据：批/序/徽章/依赖置灰/候谁，全在 lib/pm/schedule-view.队列页）
//    + 现态原件（就绪/版本号/计划日期/更新时刻，GET /api/schedule 下发）。
// 两份都要：判据不能在前端另立一套，而 CAS 要的版本号与 就绪 这面旗，队列卡里没有。
function tqRow(c, g, now) {
  const 终 = 排期终态.includes(c.状态);
  const 可排 = !!g && !终;                       // 终态待办不可重排（后端同判据，此处只是别把按钮画出来）
  const 可就绪 = !!g && g.状态 === '计划';        // 就绪旗只对计划态有意义：已过闸的粒再举旗只会污染 G8 清单
  const 链 = c.单号 ? `<a class="qtk mono" href="#/t/${encodeURIComponent(c.单号)}" title="进工单详情">${esc(c.单号)}</a>` : '';
  const 排期文 = g && (g.计划开始 || g.计划完成)
    ? `${g.计划开始 || '?'} → ${g.计划完成 || '?'}` : '未排期';
  const 停 = g && !终 ? 停摆天(g, now) : null;
  const 提 = c.提示 + (g ? `\n排期：${排期文}${g.基线完成 ? `（基线 ${g.基线开始 || '?'} → ${g.基线完成}）` : ''}`
    + (停 == null ? '' : `\n停摆 ${停} 天未动`) : '');
  return `<div class="qrow${c.置灰 ? ' blocked' : ''}${终 ? ' fin' : ''}" data-gid="${esc(c.粒ID || '')}" title="${esc(提)}">
      <span class="qs mono">${esc(上级名(c.上级))}${c.序 ? '·' + c.序 : ''}</span>
      <span class="qb ${QCLS[c.状态] || ''}">${esc(c.徽章)}</span>
      <span class="qt">${esc(c.题)}</span>${链}
      ${c.候 ? `<span class="qwait" title="${esc('未满足依赖：' + (c.未满足 || []).map((x) => x.名 + (x.态 ? '（' + x.态 + '）' : '')).join('、'))}">候：${esc(c.候)}</span>` : ''}
      ${c.池衡建议 ? `<span class="qpool" title="池衡建议">${esc(c.池衡建议)}</span>` : ''}
      <span class="qplan mono${g && (g.计划开始 || g.计划完成) ? '' : ' none'}" title="计划区间（基线见悬浮全文）">${esc(排期文)}</span>
      ${停 == null || 停 < 1 ? '' : `<span class="qidle" title="距最后一次事件 ${停} 天没人动过它——停摆时长与计划日期无关，不是延期判定">停摆 ${停}d</span>`}
      <span class="qest mono">${c.预估单元 != null ? esc(c.预估单元 + ' 单元') : '—'}</span>
      ${可就绪 ? `<button class="qrdy${g.就绪 ? ' on' : ''}" onclick="tqReady('${qesc(c.粒ID)}',${g.就绪 ? 'false' : 'true'},this)"
        title="${esc(g.就绪 ? '已就绪 · 候放行成单。再点撤旗' : '标就绪＝项管说「这批排完了、可以放了」。\n放行成单是人闸（总监＋制作人），不在本页')}">${g.就绪 ? '✓ 就绪' : '标就绪'}</button>` : ''}
      ${可排 ? `<button class="qplanbtn" onclick="tqReplan('${qesc(c.粒ID)}')" title="重排：改计划起讫/工期，必须带因（后端强制）">排期</button>` : ''}
      ${可排 ? `<button class="qplanbtn qdep" onclick="tqEditDeps('${qesc(c.粒ID)}')" title="编依赖：改这条待办的前置依赖（逗号分隔单号/粒ID，走 调整 留痕，CAS）">编依赖${Array.isArray(g.依赖) && g.依赖.length ? ' ' + g.依赖.length : ''}</button>` : ''}
    </div>`;
}
function 待办队列Html(q, 粒表, now) {
  if (!q || !q.摘要) {
    return `<div class="rlcard card r14"><div class="rlch"><b>待办队列</b></div>
      <div class="gtempty">读不到排程台账——这台监制台上还没有 <span class="mono">排程台账/排程账.jsonl</span>，
      或服务端版本尚未带 <span class="mono">/api/schedule/队列</span> 读口。</div></div>`;
  }
  const 就绪数 = Object.values(粒表).filter((g) => g.状态 === '计划' && g.就绪).length;
  const 批Html = (q.批们 || []).map((b) => {
    const 手动 = qOpen[b.批];
    const 折 = 手动 === undefined ? !!b.折叠 : !手动; // 默认按服务端判据（完结批折叠），用户点过就听用户的
    return `<div class="qbatch${折 ? ' fold' : ''}${b.完结 ? ' done' : ''}">
      <div class="qbh" onclick="qFold('${qesc(b.批)}')" tabindex="0" role="button" aria-expanded="${!折}"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();qFold('${qesc(b.批)}')}">
        <span class="qcar">▾</span><b>${esc(b.批)}</b>
        <span class="pill sm ${b.完结 ? 'ok' : 'mut'}">${b.完结 ? '本批已了' : b.计数.未完 + ' 项未完'}</span>
        <span class="qbn">共 ${b.计数.总} 项${b.计数.完 ? ` · 已了 ${b.计数.完}` : ''}</span>
        <span class="sp"></span>
        <span class="qbe mono">${b.预估 ? b.预估 + ' 单元' : '无预估'}</span></div>
      <div class="qrows">${b.粒.map((c) => tqRow(c, 粒表[c.粒ID], now)).join('')}</div></div>`;
  }).join('') || '<div class="gtempty">队列空——批次拍板后由总监/项管登记。</div>';
  return `<div class="rlcard card r14" id="rl-queue">
    <div class="rlch"><b>待办队列</b>
      <span class="subnote">按 批 → 序（口径同排程台账）· 点批头折叠 · 悬浮任一行看来源与基线全文</span>
      <span class="sp"></span>
      <span class="rlnum mono">${esc(q.摘要.文 || '')}</span></div>
    <div class="rlgate">已就绪 <b>${就绪数}</b> 条候放行${就绪数 ? ` <button class="qrdy on" onclick="tqRelease()" title="G8 人闸：把已就绪的待办整批放行进工单队列（转移 计划→起草中，署名 ${esc(排期署名)}）">⇧ 放行成单 ${就绪数}</button>` : ''}
      <span class="subnote">放行成单是<b>人闸</b>（总监＋制作人按产线节奏一堆一堆扔进工单队列）——
      本页排完、举旗，右边那颗钮就是那一闸（2026-08-22 体检 #64：注册表 G8 的 落点「项管页 · 待办队列」/ 按钮「放行成单」此前全前端零命中）。
      写账署名 ${esc(排期署名)}（调整/重排 操作域＝项管/总监；放行走 转移 计划→起草中，逐边操作域＝总监/制作人）。</span></div>
    <div class="qboard" id="q-board">${批Html}</div>
    <div class="fglegend" style="margin-top:10px">
      <span><i class="lg-plan"></i>计划＝还没起草的活 · 起草中＝待审稿在台上 · 已成单→点单号进详情</span>
      <span><i class="lg-stuck"></i>置灰＋「候：X」＝依赖未满足，这条现在开不了</span>
      <span>已了的批默认折叠 · 预估合计只数未完的活</span></div>
  </div>`;
}

/* ---- ④ 项管行为：/api/pm/actions 分桶 ---- */
// 案源（丙-4 令面原话）：/api/pm/ledger 只下发尾 80 条，而台账里 巡检 909 + 台账对齐 751
// 占了四分之三——项管真正的判断动作（估时校准、裁决、拒切、并发调配）全滚出窗口，干了等于没干。
// 故此处**不再画平铺流水**：心跳归一格只报计数，判断类各成一桶各留明细。
function 行为桶Html(b) {
  const 类型 = Object.entries(b.类型 || {}).sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `<span class="abt">${esc(k)} <b>${v}</b></span>`).join('');
  const 谁 = b.按操作者 ? Object.entries(b.按操作者).map(([k, v]) => `${k} ${v}`).join(' · ') : '';
  if (b.类 === '心跳') {
    return `<div class="abox beat"><div class="abh"><b>${esc(b.桶)}</b>
        <span class="pill sm mut">心跳</span><span class="abn mono">${b.计数}</span>
        <span class="sp"></span><span class="subnote">末次 ${esc(b.末次 ? locHM(b.末次) : '—')}</span></div>
      <div class="abts">${类型}</div>
      <div class="subnote">定时拍产物，逐条无信息量——只报计数。逐条列出去只会把下面那些判断动作再挤掉一次。</div></div>`;
  }
  const 明细 = (b.最近 || []).map((e) => {
    const v = pmEventLine(e);
    if (!v) return '';
    return `<div class="logrow"><time>${esc(v.t)}</time><span${v.hot ? ' style="color:var(--accent-ink);font-weight:600"' : ''}>${esc(v.txt)}</span></div>`;
  }).join('') || '<p class="dim" style="margin:6px 0 0;font-size:12px">窗内无明细。</p>';
  return `<div class="abox"><div class="abh"><b>${esc(b.桶)}</b>
      <span class="abn mono">${b.计数}</span>
      <span class="sp"></span><span class="subnote">${谁 ? esc(谁) + ' · ' : ''}末次 ${esc(b.末次 ? locHM(b.末次) : '—')}</span></div>
    <div class="abts">${类型}</div>
    <div class="ablist">${明细}</div></div>`;
}
function 项管行为Html(act, kc) {
  // 取数失败不许伪装成真空态（2026-08-22 体检 #66）：原样 (act && act.桶) || [] 把
  // 「/api/pm/actions 挂了」画成「台账窗内没有任何事件」——这两件事的处置完全相反。
  // 判**正形**不判 null：api() 不看 res.ok，500 带合法 JSON 体时 catch 根本不触发。
  const 桶 = act && Array.isArray(act.桶) ? act.桶 : null;
  const 判断 = (桶 || []).filter((b) => b.类 !== '心跳');
  const 判断数 = 判断.reduce((a, b) => a + b.计数, 0);
  const 窗 = (act && act.窗) || {};
  const 窗文 = 窗.起 ? `${String(窗.起).slice(0, 10)} → ${String(窗.讫).slice(0, 10)}` : '—';
  return `<div class="rlcard card r14" id="rl-acts">
    <div class="rlch"><b>项管行为</b>
      <span class="subnote">心跳归一格只报数 · 判断类各成一桶留明细（/api/pm/actions 分桶）</span>
      <span class="sp"></span>
      <span class="rlnum mono">判断 ${判断数} · 合计 ${act && act.合计 != null ? act.合计 : '—'} · 心跳占比 ${act && act.心跳占比 != null ? act.心跳占比 : '—'}%</span></div>
    <div class="rlsub subnote">行为窗 ${esc(窗文)}${(act && act.未归类 && act.未归类.length) ? ` · 未归类类型：${esc(act.未归类.join('、'))}` : ''}</div>
    <div class="rlsec"><b style="font-size:13px">关键汇报</b>
      <span class="subnote" style="margin-left:8px">一单一链 · 点头行展开 · 尾端永远回答「现在等什么」</span>
      <div class="kchain" id="kchain">${Array.isArray(kc && kc.链) ? kChainHtml(kc.链) : '<p class="dim">读不到关键汇报（/api/pm/chains 不可达或返回异常）——这不是「暂无关键汇报」。</p>'}</div></div>
    <div class="abgrid">${!桶 ? '<p class="dim">读不到项管台账（/api/pm/actions 不可达或返回异常）——这不是「窗内没有事件」。</p>' : (桶.map(行为桶Html).join('') || '<p class="dim">台账窗内没有任何事件。</p>')}</div>
  </div>`;
}

async function viewRelay() {
  // 数据七源。一律 catch 兜底：任何一个接口不在（老部署/桩台）都不许把整页拖白——
  // 本页是四块拼起来的，一块取不到就该只塌那一块。
  const [d, pl, rs, kc, sch, q, id, act] = await Promise.all([
    api('/api/relay').catch(() => ({ 消息: [] })),
    api('/api/pm/ledger').catch(() => ({ 台账: {} })),
    api('/api/pm/roster').catch(() => null),
    api('/api/pm/chains').catch(() => null),
    api('/api/schedule').catch(() => ({ 粒: [], 计数: {} })),
    // 队列卡也吃当前项目（2026-08-22 体检 #4）：页头写着「监制台 · TK」、甘特已按 g.项目 === p 切过，
    // 而这一口原样不带参数 ⇒ 后端 项目视界 拿不到项目、返回全量，于是页头 13 / 队列卡 34，两把尺。
    // 服务端 GET /api/schedule/:action 把 req.query 整个交给 scheduleView.队列页，认 项目 这一格。
    api('/api/schedule/' + encodeURIComponent('队列') + (projActive() ? '?' + encodeURIComponent('项目') + '=' + encodeURIComponent(projActive()) : '')).catch(() => null),
    api('/api/ideas').catch(() => null), // 兜底不许造出「0 条在池」这种假真空（2026-08-22 体检 #66）
    // 八口全并发（本页每次重绘都要取一遍，实测最慢那口 34ms；串成一列就是白等一个来回）
    api('/api/pm/actions').catch(() => null),
  ]);
  const now = Date.now();
  const 今日 = new Date(now - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); // 本地日，不拿 UTC 串切
  // 项目边界（2026-08-21 制作人：「在一个项目里能看到另外一个项目的东西，这不对，不合理」）。
  // 此前本页刻意**不**过滤，注释写着「项管是工作室级职能，跨项目」——那是总监的判断，被推翻了：
  // 页头写着「监制台 · TK」，内容却给的是全部，等于页头声称一个范围、内容给的是另一个范围。
  // 待办的 项目 这一格同日才加（此前数据层根本没有，物理上过滤不了），存量已回填。
  // **未归属的不许静默消失**：过滤会让它们两个项目都看不见，那是比越界更糟的漏账，故单列一行。
  const p = projActive();
  名册 = (sch && sch.名册) || {}; // 服务端下发，画之前先接住
  const 全粒 = (sch && sch.粒) || [];
  const 未归属 = p ? 全粒.filter((g) => !g.项目 && !排期终态.includes(g.状态)) : [];
  // 甘特与队列卡必须是**同一把尺**（2026-08-21 三把尺案：页头 13 / 队列卡 37 / 后端旧滤镜 2）。
  // 甘特吃 /api/schedule 的原始现态，队列卡吃 /api/schedule/队列（后端 项目视界 已筛）——
  // 两边都认同一个权威字段 g.项目，故数字必然一致。**前端不许再有第二套认亲逻辑**：
  // 后端那套「管线/单号/批传染」的推断术已在同批改动里降为「无 项目 字段时的回落」。
  const 粒们 = p ? 全粒.filter((g) => g.项目 === p) : 全粒;
  const 粒表 = Object.fromEntries(全粒.map((g) => [g.粒ID, g])); // 依赖可跨项目引用，查表用全量
  // 甘特只上未了结的（计划/起草中/已成单）：一张画满已完成条的图是报表，不是排期表。
  const 在排 = 粒们.filter((g) => !排期终态.includes(g.状态));
  const 了结数 = 粒们.length - 在排.length;
  const 模型档 = (_cfg && _cfg.模型 && _cfg.模型.项管) || '—';
  const L = (pl && pl.台账) || {};
  const working = d.作业;
  const on = !!d.值守;
  const stateColor = working ? 'var(--warn)' : (on ? 'var(--ok)' : 'var(--ink3)');
  const stateText = working ? `作业中 · ${esc(working.用途)}${working.对象 ? ' ' + esc(working.对象) : ''}` : (on ? '在线值守' : '离线（执行器停）');
  // 15s 活体（与在途页同一口径）：只在「卡片构成或态/徽/链长度变了」时重画关键汇报区，
  // 平稳期一个字都不动——每 15s 无脑重刷 innerHTML 会把文本选择和展开动画打断。
  let sig0 = kSig(kc && kc.链);
  pollLoop('kchain', 15000, async () => {
    const nd = await api('/api/pm/chains');
    const s = kSig(nd.链);
    if (s === sig0) return;
    sig0 = s;
    const box = $('kchain'); if (box) box.innerHTML = kChainHtml(nd.链);
  });
  // 30s 活体：排程账变了才原地重绘。3s 脉冲令牌只按工单目录 mtime 算，登记/重排一条待办
  // 一个字节都不会动到工单目录——不自己看着账，这页会一直停在打开那一刻的读数（同原队列页的处置）。
  const ssig = (x) => (x.粒 || []).map((g) => `${g.粒ID}|${g.状态}|${g.版本号}`).join(',');
  const ssig0 = ssig(sch);
  const 号 = window._rlSeq = (window._rlSeq || 0) + 1;
  pollLoop('rl-gantt', 30000, async () => {
    if (号 !== window._rlSeq) return;
    const nd = await api('/api/schedule').catch(() => null);
    if (号 === window._rlSeq && nd && nd.粒 && ssig(nd) !== ssig0) repaint('排程账变');
  });

  return `<div class="rlpage">
    <div class="card r16 rlstate">
      <span class="rldot" style="background:${stateColor};${on && !working ? 'animation:breathe 2.4s var(--ease-out) infinite;' : ''}${working ? 'animation:breathe-warn 1.6s var(--ease-out) infinite;' : ''}"></span>
      <div style="flex:1;min-width:0"><b style="font-size:16px">${stateText}</b>
        <p class="dim" style="margin:4px 0 0;font-size:12.5px">项管 ${esc(模型档)} · 在跑 ${Object.keys(L.在跑 || {}).length} 项 · 就绪队列 ${(L.就绪队列 || []).length} 单
          · 待办 ${在排.length} 条在排（另 ${了结数} 条已了结）</p></div>
      <button class="btn h32" onclick="rlToggle('编制')" title="编制快照：每职能一行，池序即路由优先级">编制快照</button>
    </div>
    <div class="rlroster${rlFold.编制 ? ' fold' : ''}" id="rl-编制">
      <div class="logcard card r14"><b style="font-size:13px">编制快照</b>
        <span class="subnote" style="margin-left:8px">每职能一行 · 池序即路由优先级 · 只读（调整走 /api/pm/roster）</span>
        <div style="margin-top:12px">${Array.isArray(rs && rs.编制) ? rosterSnapHtml(rs.编制) : '<p class="dim">读不到编制（/api/pm/roster 不可达或返回异常）——这不是「无编制数据」。</p>'}</div></div>
    </div>
    ${甘特Html(在排, 今日, 未归属)}
    ${待办队列Html(q, 粒表, now)}
    <div class="rlcard card r14" id="rl-ideas">
      <div class="rlch"><b>想法在池</b>
        <span class="subnote">随聊随记 → <b>拍板</b>成专项容器（补边界＋验收标准）→ 项管切单派发。拍板是制作人唯一人闸</span>
        <span class="sp"></span><span class="rlnum mono">${Array.isArray(id && id.想法) ? `${id.想法.length} 条在池` : '读不到想法池（/api/ideas 不可达或返回异常）'}</span></div>
      ${Array.isArray(id && id.想法) ? ideaPoolHtml(id.想法) : '<p class="dim" style="text-align:center;margin:24px 0">读不到想法池（/api/ideas 不可达或返回异常）——这不是「池是空的」。</p>'}
    </div>
    ${项管行为Html(act, kc)}
  </div>`;
}

/* ---- 排期的手：就绪打勾 / 重排。两口都走 CAS（预期版本取自本次渲染读到的现态）---- */
// 409 = 别的调用方（项管自己/另一个窗口）先写了一笔。不静默重试：静默重试等于拿旧意图覆盖新事实，
// 而这是一本只追加的审计账。如实说一句并原地重绘，制作人看着最新现态再点一次。
async function 排程写(动作, body, 成功文) {
  const r = await post('/api/schedule/' + encodeURIComponent(动作), { ...body, 操作者: 排期署名 });
  if (!r.ok) {
    toast(r.冲突 ? '版本冲突：这条刚被改过，已刷新，请照新现态再来一次' : (r.error || '失败'));
    if (r.冲突) repaint('排程 CAS 冲突');
    return null;
  }
  toast(成功文);
  repaint('排程' + 动作);
  return r;
}
window.tqReady = async (粒ID, 值, btn) => {
  const g = await 取待办(粒ID);
  if (!g) return toast('这条待办已不在现态（可能刚成单或被撤销）');
  if (btn) btn.disabled = true;
  // 就绪 原样透传布尔：省略键在后端是「这一格不动」，传 false 才是撤旗。
  await 排程写('调整', { 粒ID, 预期版本: g.版本号, 就绪: !!值 }, 值 ? '已标就绪，候放行成单' : '已撤就绪旗');
  if (btn) btn.disabled = false;
};
// G8 放行成单（2026-08-22 体检 #64）：走 转移 计划→起草中（lib/pm/schedule 逐边操作域＝总监/制作人），
// 逐粒 CAS、不并批、不吞错——一批里有一条冲突，其余照放，未过的逐条报出来。
// 版本号现读现取（同 tqReady/tqReplan 的纪律）：页面上那份读数可能已被项管改过。
window.tqRelease = async () => {
  const d = await api('/api/schedule').catch(() => null);
  const 待 = ((d && d.粒) || []).filter((g) => g.状态 === '计划' && g.就绪);
  if (!待.length) return toast('没有已就绪的待办可放行（就绪旗由项管在本页举）');
  if (!await ask(`放行 ${待.length} 条已就绪待办进工单队列？放行后归项管全权推进。`)) return;
  let 成 = 0; const 败 = [];
  for (const g of 待) {
    const r = await post('/api/schedule/' + encodeURIComponent('转移'),
      { 粒ID: g.粒ID, 预期版本: g.版本号, 目标: '起草中', 操作者: 排期署名, 说明: 'G8 放行成单' }).catch((e) => ({ error: String((e && e.message) || e) }));
    if (r && r.ok) 成++; else 败.push(`${g.题 || g.粒ID}：${(r && r.error) || '未知'}`);
  }
  toast(败.length ? `放行 ${成} 条，${败.length} 条未过：${败[0]}` : `已放行 ${成} 条成单`);
  repaint('G8 放行成单');
};
// 重排现读现态取版本号，不吃页面上那份可能已经过期的读数——CAS 的意义正在于此。
async function 取待办(粒ID) {
  const d = await api('/api/schedule').catch(() => null);
  return (d && d.粒 || []).find((x) => x.粒ID === 粒ID) || null;
}
// 归属（2026-08-21）：给未归属待办指派项目。终态粒也能改——归属是分类不是计划，
// 而存量里大半已是完成/撤销；一并拒掉的话历史账永远归不了属，按项目过滤就永久缺一块。
window.tqSetProj = async (粒ID) => {
  const g = await 取待办(粒ID);
  if (!g) return toast('这条待办已不在现态');
  const 可选 = projNames();
  if (!可选.length) return toast('配置里没有注册任何项目');
  const w = showModal(`<h3>指定归属 · <span class="mono">${esc(上级名(g.上级))}${g.序 ? '·' + g.序 : ''}</span>
      <span class="x" onclick="this.closest('.mwrap').remove()">×</span></h3>
    <p class="dim" style="margin:-4px 0 12px;font-size:12.5px">${esc(g.题 || '')}</p>
    <div class="f-field"><label>项目</label><select id="pj-v" class="mono">
      ${可选.map((n) => `<option value="${esc(n)}"${g.项目 === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
    </select></div>
    <div class="note">归属决定它出现在哪个项目的队列与甘特里。写账署名 <b>${esc(排期署名)}</b> · 版本 ${g.版本号}（CAS）</div>
    <div class="mfoot"><div class="rgt2"><button class="btn h36" onclick="this.closest('.mwrap').remove()">取消</button>
      <button class="btn accent h36" onclick="tqSetProjGo('${qesc(粒ID)}',${g.版本号},this)">归属</button></div></div>`);
  const v = w.querySelector('#pj-v'); if (v) v.focus();
};
window.tqSetProjGo = async (粒ID, 预期版本, btn) => {
  const 项目 = (($('pj-v') || {}).value || '').trim();
  if (!项目) return toast('要选一个项目');
  if (btn) btn.disabled = true;
  const r = await post('/api/schedule/' + encodeURIComponent('调整'),
    { 粒ID, 预期版本, 项目, 操作者: 排期署名, 说明: '指定归属' }).catch((e) => ({ error: String(e.message || e) }));
  if (btn) btn.disabled = false;
  if (!r || r.error) return toast('归属失败：' + ((r && r.error) || '未知'));
  const m = document.querySelector('.mwrap'); if (m) m.remove();
  toast(`已归属 ${项目}`);
  repaint('归属');
};
/* ---- 编依赖（落实表 P0-5 · 2026-08-24）----
   待办卡就地改前置依赖，走现成 POST /api/schedule/调整（后端早支持：规范依赖 校验形状、
   自引用拒、CAS 防两窗互踩），前端不另立判据。输入按逗号分隔 单号/粒ID；
   规则默认「全部完成」，原有依赖里已带规则的 ref 重提交时沿用原规则，不悄悄重置。
   CAS 冲突（409/冲突:true）：如实说一句，随后拿服务端回传的现态版本号**只重试一次**——
   依赖是整格覆盖写，按新版本重发同一份意图是安全的；再冲突就停手让人重看。 */
let 依赖原规则 = {}; // 打开弹窗那一刻的 ref→规则 快照，Go 时沿用（内联 onclick 传不了对象）
window.tqEditDeps = async (粒ID) => {
  const g = await 取待办(粒ID);
  if (!g) return toast('这条待办已不在现态（可能刚成单或被撤销）');
  if (排期终态.includes(g.状态)) return toast(`终态待办不可改依赖（当前 ${g.状态}）——活都做完了再改计划是改史`);
  const 现依 = Array.isArray(g.依赖) ? g.依赖 : [];
  依赖原规则 = Object.fromEntries(现依.map((x) => [x.ref, x.规则]));
  const w = showModal(`<h3>编依赖 · <span class="mono">${esc(上级名(g.上级))}${g.序 ? '·' + g.序 : ''}</span>
      <span class="x" onclick="this.closest('.mwrap').remove()">×</span></h3>
    <p class="dim" style="margin:-4px 0 12px;font-size:12.5px">${esc(g.题 || '')}</p>
    <div class="f-field"><label>前置依赖（逗号分隔 单号/粒ID，留空＝清空全部）</label>
      <input id="dep-v" class="mono" value="${esc(现依.map((x) => x.ref).join(', '))}" placeholder="如：TK-13, Q5"/></div>
    <div class="note">规则默认「全部完成」（已有规则的 ref 沿用原规则）。依赖决定队列置灰与派发顺序。
      写账署名 <b>${esc(排期署名)}</b> · 版本 ${g.版本号}（CAS）</div>
    <div class="mfoot"><div class="rgt2"><button class="btn h36" onclick="this.closest('.mwrap').remove()">取消</button>
      <button class="btn accent h36" onclick="tqEditDepsGo('${qesc(粒ID)}',${g.版本号},this)">保存依赖</button></div></div>`);
  const v = w.querySelector('#dep-v'); if (v) v.focus();
};
window.tqEditDepsGo = async (粒ID, 预期版本, btn) => {
  const 文 = String((($('dep-v') || {}).value || '')).trim();
  const refs = [...new Set(文.split(/[，,、\s]+/).map((s) => s.trim()).filter(Boolean))];
  if (refs.includes(粒ID)) return toast('依赖不能指向自己（后端同判据，这里先拦一道省一趟）');
  const 依赖 = refs.map((ref) => ({ ref, 规则: 依赖原规则[ref] || '全部完成' }));
  if (btn) btn.disabled = true;
  const 发 = (版) => post('/api/schedule/' + encodeURIComponent('调整'),
    { 粒ID, 预期版本: 版, 依赖, 操作者: 排期署名, 说明: '编依赖' }).catch((e) => ({ error: String((e && e.message) || e) }));
  let r = await 发(预期版本);
  if (r && r.冲突 && r.现态 && r.现态.版本号 != null) {
    toast(`版本冲突：这条刚被改过（现版本 ${r.现态.版本号}）——已按新版本重试一次`);
    r = await 发(r.现态.版本号);
  }
  if (btn) btn.disabled = false;
  if (!r || !r.ok) return toast('编依赖失败：' + ((r && r.error) || '未知') + (r && r.冲突 ? '（重试后仍冲突，请刷新后按新现态再改）' : ''));
  const m = document.querySelector('.mwrap'); if (m) m.remove();
  toast(refs.length ? `已更新依赖（${refs.length} 条）` : '已清空依赖');
  repaint('编依赖');
};
window.tqReplan = async (粒ID) => {
  const g = await 取待办(粒ID);
  if (!g) return toast('这条待办已不在现态（可能刚成单或被撤销）');
  if (排期终态.includes(g.状态)) return toast(`终态待办不可重排（当前 ${g.状态}）——要重排的是它后面还没做的那些`);
  const 基 = g.基线完成 || g.基线开始
    ? `<div class="note">基线 ${esc(g.基线开始 || '?')} → ${esc(g.基线完成 || '?')}（首次排期时立下，不随重排变；延期＝现计划较它挪了多少，由服务端判定）</div>`
    : '<div class="note">这条还没有基线——本次若填了计划完成，系统就以这一份作为基线（首次排期）</div>';
  const w = showModal(`<h3>重排 · <span class="mono">${esc(上级名(g.上级))}${g.序 ? '·' + g.序 : ''}</span>
      <span class="x" onclick="this.closest('.mwrap').remove()">×</span></h3>
    <p class="dim" style="margin:-4px 0 12px;font-size:12.5px">${esc(g.题 || '')}</p>
    <div class="f-row2">
      <div class="f-field"><label>计划开始（YYYY-MM-DD，留空＝清空）</label><input id="rp-s" class="mono" value="${esc(g.计划开始 || '')}" placeholder="2026-08-21"/></div>
      <div class="f-field"><label>计划完成（YYYY-MM-DD，留空＝清空）</label><input id="rp-e" class="mono" value="${esc(g.计划完成 || '')}" placeholder="2026-08-25"/></div>
    </div>
    <div class="f-field"><label>工期天（可选，非负数）</label><input id="rp-d" class="mono" value="${esc(g.工期天 == null ? '' : g.工期天)}" placeholder="3"/></div>
    <div class="f-field"><label>因（必填——后端强制，没有因的甘特图没人敢照着排产）</label><input id="rp-w" placeholder="如：依赖 Q5 未完，整批后挪一周"/></div>
    ${基}
    <div class="note">写账署名 <b>${esc(排期署名)}</b>（重排操作域＝项管/总监，制作人不在域内）· 版本 ${g.版本号}（CAS）</div>
    <div class="mfoot"><div class="rgt2"><button class="btn h36" onclick="this.closest('.mwrap').remove()">取消</button>
      <button class="btn accent h36" onclick="tqReplanGo('${qesc(粒ID)}',${g.版本号},this)">重排</button></div></div>`);
  const s = w.querySelector('#rp-s'); if (s) s.focus();
};
window.tqReplanGo = async (粒ID, 预期版本, btn) => {
  const 因 = ($('rp-w') || {}).value || '';
  if (!因.trim()) return toast('必须填因——排期每一次改动都要留下「为什么」，否则甘特图三周后没人答得上');
  // 三格原样透传：'' → null 是**清空**（后端认 null/'' 为清空、不传为不动），
  // 而这个弹层每次都把三格摆出来，所以三格都传——留空就是用户真的要清掉。
  const 数 = (v) => { const t = String(v == null ? '' : v).trim(); return t === '' ? null : Number(t); };
  btn.disabled = true;
  const r = await 排程写('重排', {
    粒ID, 预期版本,
    计划开始: (($('rp-s') || {}).value || '').trim() || null,
    计划完成: (($('rp-e') || {}).value || '').trim() || null,
    工期天: 数(($('rp-d') || {}).value),
    因: 因.trim(),
  }, '已重排');
  btn.disabled = false;
  if (r) { const m = document.querySelector('.mwrap'); if (m) m.remove(); }
};
// 应用内确认层（2026-08-06 制作人实测：Electron 壳内原生 confirm() 哑弹——放弃想法死按钮案，
// 同族十个确认门全部换装。自绘 overlay，浏览器与 exe 行为一致）
window.ask = (msg) => new Promise((res) => {
  const ov = document.createElement('div'); ov.className = 'ask-ov';
  ov.innerHTML = `<div class="ask-card card r16"><p>${esc(msg)}</p>
    <div class="btns" style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
    <button class="btn h36" data-no>取消</button><button class="btn primary h36" data-yes>确认</button></div></div>`;
  const done = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); res(v); };
  const onKey = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
  ov.addEventListener('click', (e) => { if (e.target === ov) done(false); });
  ov.querySelector('[data-yes]').onclick = () => done(true);
  ov.querySelector('[data-no]').onclick = () => done(false);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  ov.querySelector('[data-yes]').focus();
});
window.askAct2 = async (a, id, msg) => { if (await ask(msg)) act2(a, id); };
// 应用内输入层（施工令-012 / 巡礼 P1：Electron 壳内原生 prompt() 与 confirm() 同族哑弹——
// typeof window.prompt 是 "function"（假在位），真调抛 "prompt() is and will not be supported."，
// async 调用点里异常沉进 promise rejection，连报错都不给。与 ask() 同一视觉家族，浏览器与 exe 行为一致）
// 取消（按钮/Esc/点遮罩）一律返回 null，与「输入了空串」区分开，调用方据此中止整条流程。
window.askInput = (label, def, opts) => new Promise((res) => {
  const o = opts || {};
  const ov = document.createElement('div'); ov.className = 'ask-ov';
  ov.innerHTML = `<div class="ask-card card r16"><p>${esc(label)}</p>
    <input class="askin${o.password ? '' : ' mono'}" type="${o.password ? 'password' : 'text'}"
      value="${esc(def == null ? '' : def)}" placeholder="${esc(o.placeholder || '')}"/>
    ${o.note ? `<p class="asknote">${esc(o.note)}</p>` : ''}
    <div class="btns" style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
    <button class="btn h36" data-no>取消</button><button class="btn primary h36" data-yes>确认</button></div></div>`;
  const inp = ov.querySelector('.askin');
  const done = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); res(v); };
  const onKey = (e) => { if (e.key === 'Escape') done(null); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value); } });
  ov.addEventListener('click', (e) => { if (e.target === ov) done(null); });
  ov.querySelector('[data-yes]').onclick = () => done(inp.value);
  ov.querySelector('[data-no]').onclick = () => done(null);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  inp.focus(); inp.select();
});

// H64 编辑器锁开关
// **带项目**（2026-08-21 体检）：原先请求体不带 项目，服务端一律落项目默认（TK）；
// 而这颗按钮所在的在途页**是按项目过滤的**——于是在 Ticketflow 语境下按一下，
// 挂起的是 TK 的派发，而你在这一页上根本看不见 TK。锁错项目比锁不上更坏。
window.editorLock = async (关) => {
  const 项目 = projActive() || projDefault();
  const r = await post('/api/editor-lock', { 关, 项目 });
  if (!r.ok) return toast(r.error || '失败');
  toast(`${关 ? '已关锁' : '已开锁'} · ${项目}${关 ? '：派发挂起，放心开引擎验收' : '：派发恢复'}`);
  route();
};
const markIn = (key) => { if (window._lastViewKey !== key) { const v = $('view') || $('app').firstElementChild; if (v) v.classList.add('vin'); } window._lastViewKey = key; };
// 详情页面包屑上的状态胶囊：目录态≠现场态——审检会话在跑时按会话报（制作人 03:18 指正）。
// 施工令-048 抽出：首渲（route）与脉冲原地重绘（repaint）共用一份口径，不许两处各说各话。
async function 详情徽章(id, state) {
  if (state == null) { const d = await api('/api/ticket?id=' + encodeURIComponent(id)).catch(() => ({})); state = d.state; }
  if (!state) return '';
  if (['初检', '核查', '仲裁', '完成', '待处理'].includes(state)) {
    const run = await api('/api/runner').catch(() => ({}));
    const live = (run.执行中 || []).find((x) => x.id === id);
    if (live) return `<span class="pill st-review">${esc(({ 质检: '初检中', 初检: '初检中', 代核: '核查中', 核查: '核查中', 代裁: '仲裁中', 仲裁: '仲裁中' })[live.kind] || live.kind + '中')}</span>`;
  }
  return stPill(state);
}

/* ===== 脉冲刷新（施工令-048：频闪根治）=====
   病灶：3s 变更令牌轮询一见令牌变就 route() —— 整页推倒重建。管线繁忙期（QA 重试、
   journal 连环写）令牌逐拍皆变，于是整个界面每 3 秒重来一次：肉眼是频闪，实际是
   滚动位归零、折叠态复位、输入焦点丢失。制作人 08-11 晚、08-12 15:38 两次实报。
   修法三件：
     ① 决策归纯函数（pulsePlan / pulseTarget）：令牌事实 + 视图态 → 动作，可单测；
     ② 刷新归原地（repaint + morph）：只重算当前视图的数据区，逐节点对齐，
        没变的节点一个字节都不碰 —— 三态（滚动/展开/焦点）于是天然不动，而非事后补救；
     ③ 整页重建降为兜底：30s 一道闸，且用户手还在页面上就顺延。 */

// ---- 用户交互水位（要件2：整页重建要给操作让路）----
let _uxAt = 0, _整页At = 0, _脉冲待办 = false, _重绘中 = false;
for (const ev of ['pointerdown', 'wheel', 'scroll', 'keydown', 'input', 'touchstart'])
  window.addEventListener(ev, () => { _uxAt = Date.now(); }, { passive: true, capture: true });
// 「手还在页面上」的三种活口供：刚动过（4s 内）、焦点在输入框里、搜索下拉正挂着
function 交互中() {
  if (Date.now() - _uxAt < PULSE.交互静默) return true;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  const gs = $('gsr');
  return !!(gs && gs.style.display === 'block');
}
const 弹窗开着 = () => !!document.querySelector('.mwrap, .ask-ov');

// @testable-begin pulsePlan
/* 脉冲决策（要件1/2）：纯函数、零 DOM、零 fetch —— 喂状态取动作，测试直接驱动。
   入参 s：{ 变了, 待办, 免打扰, 可局部, 交互中, 现在, 上次整页 }
   出参：{ 动作, 因 }，四种动作——
     skip  令牌没动，什么都不做（脉冲的常态）
     patch 原地重绘当前视图数据区（要件1 的正路，绝大多数刷新走这里）
     hold  起草/参数页/弹窗开着：不打扰，但把这笔变更记成待办，等状态解除再补
     defer 整页重建被节流或被用户操作顶掉，同样记待办、下一拍再议
     full  兜底整页重建（未登记视图）*/
const PULSE = { 整页最小间隔: 30000, 交互静默: 4000 };
function pulsePlan(s) {
  if (!(s.变了 || s.待办)) return { 动作: 'skip', 因: '令牌未变' };
  if (s.免打扰) return { 动作: 'hold', 因: '起草/参数/弹窗中，不打扰（记待办）' };
  if (s.可局部) return { 动作: 'patch', 因: '原地重绘数据区' };
  const 距上次 = s.上次整页 ? s.现在 - s.上次整页 : Infinity;
  if (距上次 < PULSE.整页最小间隔)
    return { 动作: 'defer', 因: `整页节流：距上次 ${Math.round(距上次 / 1000)}s < ${PULSE.整页最小间隔 / 1000}s` };
  if (s.交互中) return { 动作: 'defer', 因: '用户正在操作，整页重建顺延' };
  return { 动作: 'full', 因: '兜底整页重建' };
}
// @testable-end pulsePlan

// @testable-begin pulseTarget
/* 视图 → 刷新目标（要件1「局部刷新选择」）：纯函数，只吃 hash 与已登记视图键。
   视图键由调用方给（app 传 Object.keys(ROUTES)），免得这里另抄一份路由表跟真表走散。 */
const PULSE_免打扰 = ['draft', 'proj-new', 'params'];
function pulseTarget(hash, 视图键) {
  const 头 = String(hash || '').replace(/^#\//, '').split('?')[0];
  const 键们 = 视图键 || [];
  if (PULSE_免打扰.includes(头)) return { 类: 'hold', 因: `${头} 页上有正在填的东西` };
  const m = 头.match(/^t\/(.+)$/);
  if (m) return { 类: 'patch', 视图: 'detail', id: decodeURIComponent(m[1]) };
  if (头 === 'hub') return { 类: 'patch', 视图: 'hub' };
  const 键 = 键们.includes(头) ? 头 : '';                      // 同 route()：认不出的 hash 落总览
  if (键们.includes(键)) return { 类: 'patch', 视图: 键 };
  return { 类: 'full', 因: `未登记视图 ${头}` };
}
// @testable-end pulseTarget

// @testable-begin morph
/* ---- 逐节点对齐（morph）：整块 innerHTML 覆写会重建每一个节点——滚动位归零、
   展开态复位、焦点丢失、图片重解码，这正是「频闪」的观感来源。改成拿新 HTML 与
   现有 DOM 一一比对：整枝没变就整枝跳过，变了的也只改那几个属性/那一段文字。
   三态（滚动/展开/焦点）不是事后补救回来的，是根本没被碰过。 ---- */
function morph(dst, html) {
  if (!dst) return;
  const 焦 = document.activeElement, 焦id = 焦 && 焦.id, 焦选 = [];
  if (焦 && /^(INPUT|TEXTAREA)$/.test(焦.tagName)) { try { 焦选.push(焦.selectionStart, 焦.selectionEnd); } catch { /* type 不支持选区 */ } }
  const y = window.scrollY;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  morphKids(dst, tmp);
  // 兜底：极端情况下（节点被整段替换）焦点/滚动位仍可能掉，按 id 认回来
  if (焦id && document.activeElement !== 焦) {
    const el = $(焦id);
    if (el && typeof el.focus === 'function') { el.focus(); if (焦选.length) try { el.setSelectionRange(焦选[0], 焦选[1]); } catch { /* 同上 */ } }
  }
  if (window.scrollY !== y) window.scrollTo(0, y);
}
function morphKids(dst, src) {
  const 旧 = [...dst.childNodes], 新 = [...src.childNodes];
  for (let i = 0; i < Math.max(旧.length, 新.length); i++) {
    const o = 旧[i], w = 新[i];
    if (!w) { dst.removeChild(o); continue; }
    if (!o) { dst.appendChild(w); continue; }
    morphNode(dst, o, w);
  }
}
function morphNode(parent, o, w) {
  if (o.nodeType !== w.nodeType || (o.nodeType === 1 && o.tagName !== w.tagName)) { parent.replaceChild(w, o); return; }
  if (o.nodeType !== 1) { if (o.nodeValue !== w.nodeValue) o.nodeValue = w.nodeValue; return; } // 文本/注释
  if (o.hasAttribute('data-live')) return;    // 活体格子归它自己的计时器管（要件3：秒表不许被脉冲拨回 --:--）
  if (o.tagName === 'CANVAS') return;         // 画布内容不在 HTML 里，重建即白屏
  if (o.outerHTML === w.outerHTML) return;    // 整枝一字未变：一个字节都不碰（morph 的全部价值在这一行）
  morphAttrs(o, w);
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(o.tagName)) {
    if (document.activeElement !== o && o.value !== w.value) o.value = w.value; // 正在敲的框不动它
    return;
  }
  morphKids(o, w);
}
function morphAttrs(o, w) {
  for (const a of [...w.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  for (const a of [...o.attributes]) if (!w.hasAttribute(a.name)) o.removeAttribute(a.name);
}
// @testable-end morph

/* ---- 原地重绘：重跑当前视图的渲染函数，morph 进原容器；骨架（顶栏/导航/搜索框/面包屑）
   一律不重建。取不到容器（首渲还没落地）才退回整页。 ---- */
const 脉冲日志 = window.__pulse日志 = [];
const 记刷新 = (动作, 因) => {
  脉冲日志.push({ t: new Date().toISOString().slice(11, 19), 动作, 因 });
  if (脉冲日志.length > 200) 脉冲日志.shift();
};
async function repaint(因) {
  if (_重绘中) return 'busy';
  _重绘中 = true;
  try {
    const tg = pulseTarget(location.hash, Object.keys(ROUTES));
    const box = $('view');
    if (tg.类 !== 'patch') { await route(); 记刷新('full', 因 + ' · ' + (tg.因 || tg.类)); return 'full'; }
    if (tg.视图 === 'hub') { morph($('app'), await viewHub()); 记刷新('patch', 因 + ' · hub'); return 'patch'; }
    if (!box) { await route(); 记刷新('full', 因 + ' · 无 #view 容器'); return 'full'; }
    if (tg.视图 === 'detail') {
      morph(box, await viewDetail(tg.id));
      // 面包屑那颗状态胶囊也得跟着走，否则单子都落袋了头上还挂着「在途」
      const 徽 = document.querySelector('.bhead .pill'), 新徽 = await 详情徽章(tg.id);
      const bc2 = document.querySelector('.bhead .bc2');
      if (新徽 && 徽) { if (徽.outerHTML !== 新徽) 徽.outerHTML = 新徽; }
      else if (新徽 && bc2) bc2.insertAdjacentHTML('afterend', 新徽);
      记刷新('patch', 因 + ' · ' + tg.id);
      return 'patch';
    }
    morph(box, await ROUTES[tg.视图]());
    记刷新('patch', 因 + ' · ' + (tg.视图 || '总览'));
    return 'patch';
  } catch (e) {
    记刷新('error', 因 + ' · ' + (e && e.message));   // 一次取数失败不留残页，下一拍再来
    return 'error';
  } finally { _重绘中 = false; }
}

async function route() {
  _整页At = Date.now();   // 任何整页重建都记账：脉冲兜底的 30s 闸按这个走
  const h = location.hash.replace(/^#\//, '');
  const app = $('app');
  let m;
  try {
    // 首次运行向导（2026-08-08）：没有工作区就先把 app 从死局里捞出来，别的都往后排。
    // 必须在 loadCfg 之前——/api/config 在未就绪时是 500，先它一步问 /api/setup/state。
    const su = await api('/api/setup/state').catch(() => null);
    if (su && su.需要向导) { app.innerHTML = viewSetup(su); return; }
    await loadCfg();
    // D42 项目语境守卫：多项目时，被删项目的残留选择作废；未选项目 → 落启动页；单项目自动进语境
    if (projMulti() && curProj() && !projNames().includes(curProj())) setProj('');
    if (!projMulti()) setProj(projNames()[0] || '');
    // 风格库退役（施工令-015）：#/style · #/stylelib 旧书签 301 到 wiki 美术标杆页签
    if (WK_ALIAS.includes(decodeURIComponent(h))) { wkState.tab = '美术标杆'; wkState.doc = ''; location.replace('#/wiki'); return; }
    // 退役页转向（#/tree 施工令-028；#/ideas · #/flow · #/queue 2026-08-20 页签定案 11→8）：
    // 用 replace 不用 assign——否则退役页会占一格历史，用户按返回又被弹回来一次（同 WK_ALIAS 的处理）。
    // 认首段而不是整串：#/queue?项目=TK 这类带参旧链接同样要落地，整串比对会让它漏进 ROUTES 查表。
    if (退役页[h.split('?')[0].split('/')[0]]) { location.replace('#/' + 退役页[h.split('?')[0].split('/')[0]]); return; }
    if (h === 'hub') { app.innerHTML = await viewHub(); markIn('hub'); return; }
    if (h === 'params') { app.innerHTML = bshell('参数与额度', '<span class="pill sm mut">全局配置</span>', await viewParams(), '#/hub'); markIn('params'); return; }
    if (h === 'proj-new') { app.innerHTML = bshell('注册新项目', '<span class="pill sm mut">全局 · 项目注册</span>', viewProjNew(), '#/hub'); markIn('proj-new'); return; }
    if ((m = h.match(/^t\/(.+)$/))) {
      const id = decodeURIComponent(m[1]);
      const d = await api('/api/ticket?id=' + encodeURIComponent(id)).catch(() => ({}));
      const stBadge = await 详情徽章(id, d.state);
      app.innerHTML = bshell(`${id} · ${d.fm ? d.fm.title : ''}`, stBadge, await viewDetail(id));
      if (window._lastViewKey !== h) { const v = $('view'); if (v) v.classList.add('vin'); }
      window._lastViewKey = h;
      return;
    }
    if (h.startsWith('draft')) {
      const q = new URLSearchParams(h.split('?')[1] || '');
      app.innerHTML = bshell('起草 · 编辑工单', '<span class="pill ok sm">正途走项管起草（H57）· 此页供手工起草与改稿</span>', await viewDraft(q.get('edit'), q.get('parent')));
      if (window._lastViewKey !== h) { const v = $('view'); if (v) v.classList.add('vin'); }
      window._lastViewKey = h;
      return;
    }
    // 多项目且尚未选定项目：驾驶舱视图一律先落启动页（详情/起草按编号直达不拦）
    if (projMulti() && !curProj()) { location.hash = '#/hub'; return; }
    // 首段匹配（2026-08-20）：工单页把层级位置写进 hash（#/tickets/P-1/F-3），刷新与前进后退都不丢。
    // 原先是整串精确匹配，多段 hash 查不到就静默落回总览——点管线卡会「跳回首页」。
    // 取首段查表，多出来的段由视图函数自己解析（tkLevel）。
    const 首段 = h.split('?')[0].split('/')[0];
    const key = ROUTES[h] ? h : (ROUTES[首段] ? 首段 : '');
    // 不显示"加载中"：数据在后台取，旧版面保持到新版面整体就绪才一次换入（版面不因加载变动）
    const inner = await ROUTES[key]();
    // FLIP 捕捉：同在工单池时记住每张卡的旧位置，重渲染后滑到新位置（看得见"单子挪列"）
    const flipOld = {};
    if (key === 'board' && window._lastViewKey === 'board' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.bcard2[data-tid]').forEach((el) => { flipOld[el.dataset.tid] = el.getBoundingClientRect(); });
    }
    app.innerHTML = shell(key, inner);
    if (Object.keys(flipOld).length) {
      requestAnimationFrame(() => {
        document.querySelectorAll('.bcard2[data-tid]').forEach((el) => {
          const o = flipOld[el.dataset.tid]; if (!o) return;
          const n = el.getBoundingClientRect();
          const dx = o.left - n.left, dy = o.top - n.top;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) el.animate(
            [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }],
            { duration: 260, easing: 'cubic-bezier(0.22,1,0.36,1)' });
        });
      });
    }
    // 视图淡入只在"换视图"时来一次；同视图的脉冲刷新原地换数据，不闪
    if (window._lastViewKey !== key) { const v = $('view'); if (v) v.classList.add('vin'); }
    window._lastViewKey = key;
  } catch (e) { app.innerHTML = shell('', `<p class="err" style="margin-top:30px">加载失败：${esc(e.message)}</p>`); }
}
// 项目语境搜索（编号/标题）：下拉即搜，点击进详情；多项目时只搜当前项目
let _gsCache = null, _gsAt = 0, _gsSeq = 0;
window.gSearch = async (q) => {
  const box = $('gsr'); if (!box) return;
  q = String(q || '').trim().toLowerCase();
  if (!q) { box.innerHTML = ''; box.style.display = 'none'; return; }
  const seq = ++_gsSeq;
  if (!_gsCache || Date.now() - _gsAt > 10000) {
    const d = await api('/api/board');
    _gsCache = []; for (const s of d.states) for (const t of d.board[s]) _gsCache.push({ ...t, state: s });
    _gsAt = Date.now();
  }
  if (seq !== _gsSeq) return; // 已有更新的输入
  const p = projActive();
  const hits = _gsCache.filter((t) => (!p || projOf(t) === p) && (t.id.toLowerCase().includes(q) || String(t.title || '').toLowerCase().includes(q))).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map((t) => `<div class="gsri" onmousedown="location.hash='#/t/${encodeURIComponent(t.id)}'"><span class="mono gid">${esc(t.id)}</span><span class="gt">${esc(t.title || '')}</span>${stPill(t.state)}</div>`).join('')
    : '<div class="gsri none">无匹配工单</div>';
  box.style.display = 'block';
};
document.addEventListener('click', (e) => { if (!e.target.closest('.searchbox')) { const b = $('gsr'); if (b) b.style.display = 'none'; } });
// 回车直达第一个命中；Esc 收起
window.gEnter = (e) => {
  if (e.key === 'Escape') { const b = $('gsr'); if (b) b.style.display = 'none'; e.target.blur(); return; }
  if (e.key !== 'Enter') return;
  const hit = document.querySelector('#gsr .gsri:not(.none)');
  if (hit) { hit.dispatchEvent(new MouseEvent('mousedown')); const b = $('gsr'); if (b) b.style.display = 'none'; e.target.blur(); }
};

window.addEventListener('hashchange', route);
route();
// 3s 变更令牌轮询：数据动了才刷新。动作由 pulsePlan 判，刷新由 repaint 原地做（施工令-048）——
// 令牌照旧每拍都收，但令牌变≠整页重来：绝大多数变化只换数据区的那几个节点。
let lastPulse = null;
setInterval(async () => {
  let 变了 = false;
  try { const d = await api('/api/pulse'); 变了 = !!(lastPulse && d.token !== lastPulse); lastPulse = d.token; }
  catch { return; } // 离线：版面维持原样，不拿空数据洗掉现场
  const tg = pulseTarget(location.hash, Object.keys(ROUTES));
  const p = pulsePlan({
    变了, 待办: _脉冲待办,
    免打扰: tg.类 === 'hold' || 弹窗开着(),
    可局部: tg.类 === 'patch',
    交互中: 交互中(),
    现在: Date.now(), 上次整页: _整页At,
  });
  if (p.动作 === 'skip') return;
  if (p.动作 === 'hold' || p.动作 === 'defer') { _脉冲待办 = true; 记刷新(p.动作, p.因); return; }
  _脉冲待办 = false;
  if (p.动作 === 'full') { await route(); 记刷新('full', p.因); return; }
  const r = await repaint('脉冲');
  if (r === 'busy' || r === 'error') _脉冲待办 = true; // 撞车或取数失败：这笔变更留到下一拍，不许无声吞掉
}, 3000);

/* 兼容池编辑（0.22.1）：轻量四问式，密钥留空=保留旧值；仅本机端点会拒远程
   施工令-012：四次原生 prompt() 换装成自绘 askInput()（巡礼 P1：exe 内彻底死按钮，
   浏览器预览却完全正常——「预览过、exe 死」的教科书复现）。任何一步取消即整条中止。 */
window.compatEdit = async (name) => {
  try {
    let 池名 = name;
    if (!池名) {
      const v = await askInput('新增兼容池 · 池名（小写英文标识，如 kimi / glm / minimax）：', '', { placeholder: 'kimi' });
      if (v === null) return;
      池名 = v.trim();
    }
    if (!池名) return toast('池名不能为空');
    const base = await askInput(`兼容池 ${池名} · Anthropic 兼容端点 base URL：`, name ? '' : 'https://', { placeholder: 'https://api.example.com' });
    if (base === null) return;
    const key = await askInput(`兼容池 ${池名} · API 密钥`, '', { password: true, note: '留空 = 保留旧值 · 只存本机 config，界面与远程只显尾四位' });
    if (key === null) return;
    const 模型 = await askInput(`兼容池 ${池名} · 模型名（厂商侧模型 ID）`, '', { note: '留空 = 用 CLI 默认模型' });
    if (模型 === null) return;
    const body = { 池名 };
    if (base.trim() && base.trim() !== 'https://') body.base = base.trim();
    if (key.trim()) body.key = key.trim();
    if (模型.trim()) body.模型 = 模型.trim();
    const r = await post('/api/config/compat-pool', body);
    toast(r.ok ? `兼容池 ${池名} 已保存` : (r.error || '失败'));
    if (r.ok) { _cfg = null; route(); }
  } catch (e) { toast((e && e.message) ? String(e.message).slice(0, 120) : '兼容池保存失败'); } // 兜底：异常不再沉进 promise rejection
};

/* ===== 凭据托管（2026-08-08，路 B：订阅归 CLI、key 归 app）=====
   订阅态一个字节都不存——按钮只负责「可见拉起官方登录命令 + 事后验收」，
   授权流程全程第一方，厂商改登录页与我们无关。key 才由 app 保管（DPAPI 密文）。 */
window.credsLoad = async () => {
  const el = $('creds-card'); if (!el) return;
  // no-store 是「重新检测」这个按钮的全部意义（施工令-027 自测抓到）：走默认缓存时
  // 浏览器会把上一次 /api/creds 原样端回来，登录完回来点它，卡片纹丝不动，按钮看着像坏的。
  let d; try { d = await api('/api/creds', { cache: 'no-store' }); } catch { el.innerHTML = '<p class="dim">凭据读取失败</p>'; return; }
  if (d.error) { el.innerHTML = `<p class="dim">${esc(d.error)}</p>`; return; }
  // 圆点四档（施工令-027），与 /api/creds 的 态 一一对应，两个厂商同一把尺：
  //   绿=可用（登录态实测有效）/ 黄=受限（过期但能自愈，不用人管）/ 红=失效（要人重登）/ 灰=未知（探不到，不假绿也不乱报红）
  // 旧样 codex 那一行是**写死**的 灯(false)+写死文案，灰点纯属巧合正确；claude 绿点则只看"有没有 token"。
  const 灯类 = { 可用: 'dot on', 受限: 'dot warn', 失效: 'dot err', 未知: 'dot' };
  // 三行一个体例（施工令-034 设计稿）：点 · 名 · 类型胶囊 · 状态一句话(+次要小字) · 右侧动作组。
  // 订阅行与托管行此前长相不同（一个粗名+说明、一个池名胶囊+等宽指纹），同一张卡里像两张表。
  const 行 = (态, 名, 类型, 状态Html, 动作Html) =>
    `<p class="credrow"><span class="${灯类[态] || 'dot'}"></span><span class="cr-name">${esc(名)}</span>
      <span class="cr-kind">${esc(类型)}</span><span class="cr-stat">${状态Html}</span>
      <span class="cr-act">${动作Html}</span></p>`;
  // 名称由 cr-name 出、状态由 note 出，两边都写厂商名就是 08-09 巡检抓到的「codex codex 登录态…」叠字。
  const 订阅行 = (厂商, s) => {
    const 态 = 灯类[s.态] ? s.态 : '未知';
    const 动作 = s.可登录
      ? `<button class="btn xs" title="${esc('拉起可见终端执行：' + (s.命令 || '') + '（授权在浏览器里由厂商完成，app 只等它退出后重探）')}"
          onclick="credsLogin('${厂商}')">${s.已登录 ? '重新登录' : '登录'}</button>`
      : `<span class="dim" title="${esc((s.命令 || '') + '：可执行体不在 PATH，按钮点了只会弹一个报错黑窗')}">CLI 未装</span>`;
    return 行(态, 厂商, '订阅', esc(s.note || ''), 动作);
  };
  // 托管行的圆点只敢说它敢说的：/api/creds 的脱敏清单不验证密文能不能解开（那要动数据面），
  // 所以「记录完好（有真指纹）」才给绿，指纹是占位符 ●●●●???? 的记录判未知（灰），
  // DPAPI 整体不可用时全部降未知——宁可说探不到，也不假绿。口径与订阅行的四档同一把尺。
  const 托管行 = (r) => {
    const 态 = !d.可加密 ? '未知' : (r.指纹 && !/\?{4}/.test(r.指纹) ? '可用' : '未知');
    const 迁入 = r.更新时间 ? String(r.更新时间).slice(5, 10).replace('-', '-') + ' 迁入' : '';
    const 小字 = [r.base, r.模型, 迁入].filter(Boolean).map(esc).join(' · ');
    const 状态 = `${esc(r.指纹 || '')}${小字 ? ` <small>· ${小字}</small>` : ''}`;
    // 「更换」= 复用添加流程、池名/端点/模型预填，存成功即覆写同名托管条目（轮换 key 一步到位，不必先删再加）
    return 行(态, r.池, 'key·托管', 状态,
      `<button class="btn xs" title="轮换这个池的 key：走添加流程、池名已预填，存成功即覆写当前条目"
         onclick="credsAdd('${qesc(r.池)}')">更换</button>
       <button class="btn xs" onclick="credsDel('${qesc(r.池)}')">删除</button>`);
  };
  // 「更换」要把旧端点/模型预填回去，而 askInput 是异步的、期间卡片可能已重渲染——
  // 存一份最近清单（脱敏，无 key）供 credsAdd 读，比从 DOM 里抠字符串可靠。
  window.__creds托管 = d.托管 || [];
  el.className = 'card credcard';
  el.innerHTML = `
    <p class="cred-sub">订阅登录归各 CLI 保管 · API key 由监制台加密托管，绝不入配置文件</p>
    ${订阅行('claude', d.订阅.claude)}
    ${订阅行('codex', d.订阅.codex)}
    ${d.托管.length ? d.托管.map(托管行).join('') : '<p class="cred-empty">尚未托管任何 key</p>'}
    <p class="cred-foot">
      <button class="btn xs" onclick="credsAdd()">＋ 添加 key</button>
      <button class="btn xs" onclick="credsLoad()">重新检测</button>
      ${d.可加密 ? '' : '<span class="err" style="font-size:12px">DPAPI 不可用，无法保存 key</span>'}
      <span class="grow"></span>
      <span class="credleg" tabindex="0"><span class="dot" style="width:7px;height:7px;margin-right:5px"></span>状态图例<span class="credtip"
        ><i class="lg-ok"></i>可用<br><i class="lg-warn"></i>受限 · 自愈中<br><i class="lg-err"></i>失效 · 需重登<br><i class="lg-unk"></i>未知 · 探不到</span></span>
    </p>`;
};
window.credsLogin = async (厂商) => {
  const r = await post('/api/auth/login', { 厂商 });
  toast(r.ok ? '已弹出登录终端，完成后回来点「重新检测」' : (r.error || '失败'));
};
window.credsDel = async (池) => {
  if (!await ask(`删除 ${池} 的托管 key？`)) return;
  const r = await post('/api/creds/remove', { 池 });
  toast(r.ok ? '已删除' : (r.error || '失败'));
  if (r.ok) window.credsLoad();
};
// 添加 / 更换 同一条流程（施工令-034）：带 预填池 就是「更换」——池名与端点/模型照抄现有条目、
// 只让人重敲那一把新 key，存成功即覆写同名条目（POST /api/creds 本就是覆写语义，不新开后端）。
// 不带参数就是原来的「添加」，四问式一字未动。
window.credsAdd = async (预填池) => {
  const 换 = !!预填池;
  const 旧 = 换 ? ((window.__creds托管 || []).find((x) => x.池 === 预填池) || {}) : {};
  const 池 = await askInput(换 ? `更换「${预填池}」的 key` : '池名（如 deepseek / claude-key）', 预填池 || '',
    { note: 换 ? '池名保持不变即为轮换；改名则会另存为一个新池' : '与 studio.config.json 的 执行池 键名一致' });
  if (池 === null || !池.trim()) return;
  const key = await askInput(`${池.trim()} 的${换 ? '新 ' : ' '}API key`, '',
    { password: true, note: '只在本机以 DPAPI 密文落盘，明文不入配置文件；输入框按密码处理' + (换 ? '。存成功即覆盖旧 key，旧值不可找回' : '') });
  if (key === null || !key.trim()) return;
  const base = await askInput('兼容端点 base（官方端点留空）', 旧.base || '', { note: '第三方兼容端点填 https://…；原生厂商留空' });
  if (base === null) return;
  const 模型 = await askInput('模型名（留空=CLI 默认）', 旧.模型 || '');
  if (模型 === null) return;
  const body = { 池: 池.trim(), key: key.trim() };
  if (base.trim()) body.base = base.trim();
  if (模型.trim()) body.模型 = 模型.trim();
  const r = await post('/api/creds', body);
  toast(r.ok ? `${换 && r.池 === 预填池 ? '已更换' : '已托管'} ${r.池}（${r.指纹}）` : (r.error || '失败'));
  if (r.ok) window.credsLoad();
};

/* ===== 首次运行向导（2026-08-08）=====
   旧样：没有 studio.config.json → main.js showErrorBox + quit，而加项目的 UI 就在
   那个被关掉的窗口里，于是新用户只能先手写 JSON。现在照常开窗，落这一页。 */
function viewSetup(su) {
  const 候选 = (su.候选目录 || []).map((p) =>
    `<p class="rowline"><code>${esc(p)}</code><button class="btn xs" onclick="doSetup('${qesc(p)}')">用这里</button></p>`).join('');
  return `<div class="wrap" style="max-width:720px;margin:60px auto">
    <h1 class="h17" style="font-size:22px">先建一个工作区</h1>
    <p class="dim">监制台把工单、回执、流水、岗位协议都放在一个「工作区」目录里。
      它<b>不是</b>你的项目仓库——项目仓库稍后单独注册，agent 才往那里写代码。</p>
    ${su.错误 ? `<p class="dim" style="margin-top:8px">当前状态：${esc(su.错误)}</p>` : ''}
    <div class="card" style="margin-top:18px">
      <p class="subnote">选一个位置（已存在的配置不会被覆盖）</p>
      ${候选}
      <p class="rowline" style="margin-top:12px">
        <button class="btn" onclick="doSetupAsk()">自己填一个路径…</button>
      </p>
    </div>
    <p class="dim" style="margin-top:14px">建好后会自动落：十态目录 + 回执/流水 + 六份岗位协议 + 风格库骨架，
      然后直接进参数页注册你的项目仓库。</p>
  </div>`;
}
window.doSetupAsk = async () => {
  const p = await askInput('工作区目录（绝对路径）', '', { note: '例：D:\AI工作室' });
  if (p === null || !p.trim()) return;
  window.doSetup(p.trim());
};
window.doSetup = async (目录) => {
  const r = await post('/api/setup', { 目录 });
  if (!r.ok) return toast(r.error || '建工作区失败');
  toast(`工作区就位：${r.root}`);
  _cfg = null;
  location.hash = '#/params';   // 直接落参数页——下一步就是注册项目仓库
  route();
};
