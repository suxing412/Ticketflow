// app.js — 监制台前端：一比一复刻 Figma 定稿（P1–P10 + P9b）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = async (p, opt) => (await fetch(p, opt)).json();
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const FN = { 策划: 'var(--fn-plan)', 程序: 'var(--fn-code)', 美术: 'var(--fn-art)', QA: 'var(--fn-qa)', 装配: 'var(--fn-asm)' };
// 职能色走 CSS 变量：主题切换（暖纸/玻璃）时内联色自动跟随令牌，不写死 hex
const FNHEX = { 策划: 'var(--fn-plan)', 程序: 'var(--fn-code)', 美术: 'var(--fn-art)', QA: 'var(--fn-qa)', 装配: 'var(--fn-asm)' };
const FNCLS = { 策划: 'fn-plan', 程序: 'fn-code', 美术: 'fn-art', QA: 'fn-qa', 装配: 'fn-asm' };
const STCLS = { 在途: 'st-doing', 质检: 'st-review', 待验收: 'st-accept', 完成: 'st-done', 待定夺: 'st-escal', 执行失败: 'st-escal', 草稿: 'mut', 已归档: 'mut', 待投: '', 池: '' };
const STPCT = { 草稿: 0, 待投: 0, 池: 0, 在途: 60, 质检: 85, 待定夺: 70, 执行失败: 60, 待验收: 90, 完成: 100, 已归档: 0 };
const NAV = [['总览', ''], ['想法', 'ideas'], ['工单', 'board'], ['流程', 'flow'], ['树形', 'tree'], ['在途', 'agents'], ['决策台', 'decisions'], ['Wiki', 'wiki'], ['项管', 'relay'], ['风格库', 'stylelib'], ['报表', 'report']]; // 参数入口只走 ⚙
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1900); }
// 数值跳字确认（步进器改完后调用）：重触发 animation
function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
// 视图内活体轮询：guard 元素还在页上就每 ms 跑一次 fn，离开视图自动停
function pollLoop(guardId, ms, fn) {
  setTimeout(async function loop() {
    if (!$(guardId)) return;
    try { await fn(); } catch { /* 下轮再试 */ }
    if ($(guardId)) setTimeout(loop, ms);
  }, ms);
}
// 执行器状态灯：绿呼吸=试跑运行中；红呼吸=实弹上膛（传状态非装饰）
function dotCls(r) { return 'dot ' + (r.运行 ? ('on' + (r.试跑 ? '' : ' live')) : 'off'); }
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
        <h1>监制台${p ? ` · ${esc(p)}` : ''}</h1><p class="tagline">布告栏 · 工单池 · 审批台——制作人的驾驶舱：你投池与拍板，agent 拉取执行</p></div></div>
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
async function loadBoard() {
  const [d] = await Promise.all([api('/api/board' + (window._showHidden ? '?含隐藏=1' : '')), loadCfg()]);
  window._hiddenCnt = d.隐藏数 || 0;
  const raw = []; for (const s of d.states) for (const t of d.board[s]) raw.push({ ...t, state: s });
  const p = projActive();
  if (!p) return { states: d.states, board: d.board, all: raw, raw };
  const board = {}; for (const s of d.states) board[s] = (d.board[s] || []).filter((t) => projOf(t) === p);
  return { states: d.states, board, all: raw.filter((t) => projOf(t) === p), raw };
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
  const d = await api('/api/board');
  const raw = []; for (const s of d.states) for (const t of d.board[s]) raw.push({ ...t, state: s });
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  const def = projDefault();
  const cnt = (arr, ...sts) => arr.filter((t) => sts.includes(t.state)).length;
  const cards = names.map((n) => {
    const a = raw.filter((t) => projOf(t) === n);
    const need = cnt(a, '待验收') + cnt(a, '待定夺');
    const counts = [['在途', cnt(a, '在途', '质检'), ''], ['在池', cnt(a, '池'), ''], ['待验收', cnt(a, '待验收'), ''],
      ['待定夺', cnt(a, '待定夺'), 'err'], ['失败', cnt(a, '执行失败'), 'err']];
    const eng = reg[n] && reg[n].引擎;
    return `<div class="hubcard card r16" onclick="enterProj('${esc(n)}')">
      <div class="hn"><b>${esc(n)}</b>${n === def ? '<span class="pill sm mut">默认</span>' : ''}
        ${eng ? `<span class="pill sm mut" title="引擎档案（探针按此自检）">${esc(eng.类型)}${eng.版本 ? ' ' + esc(eng.版本) : ''}</span>` : ''}
        ${need ? `<span class="pill sm red">需处理 ${need}</span>` : '<span class="pill sm ok">安好</span>'}</div>
      <div class="hpath mono" title="${esc((reg[n] && reg[n].路径) || '')}">${esc((reg[n] && reg[n].路径) || '')}</div>
      ${reg[n] && reg[n].说明 ? `<div class="hnote">${esc(reg[n].说明)}</div>` : ''}
      <div class="hcounts">${counts.map(([l, v, c]) => `<span class="hc"><i class="${v && c ? c : ''}">${v}</i>${l}</span>`).join('')}</div></div>`;
  }).join('');
  // 全局横幅数据后到、原地填（视图保持渲染铁律）
  setTimeout(async () => { try {
    const [run, g] = await Promise.all([api('/api/runner'), api('/api/gates')]);
    const el = $('hub-run');
    if (el) el.innerHTML = `<i class="${dotCls(run)}"></i><span style="font-size:14px;font-weight:500">${run.运行 ? (run.试跑 ? '试跑运行中' : '实弹运行中') : '已停'}</span>`;
    setNum($('hub-cx'), g.locks.codex.fivePct != null ? g.locks.codex.fivePct + '%' : '—', 'num ' + (g.locks.codex.locked ? 'err' : 'okc'));
    setNum($('hub-cl'), g.locks.claude.fivePct != null ? g.locks.claude.fivePct + '%' : '—', 'num ' + (g.locks.claude.locked ? 'err' : 'dim'));
  } catch { /* 保持占位 */ } }, 0);
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
    <div class="stat-strip card r14" style="margin-top:26px">
      <div class="grp"><span class="lbl">执行器</span><span class="num" id="hub-run" style="font-size:14px">—</span></div><div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">codex 池</span><span class="num dim" id="hub-cx">—</span></div><div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">claude 池</span><span class="num dim" id="hub-cl">—</span></div><div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">环境</span><span class="num dim" id="hub-env" title="全链路自检">—</span></div>
      <div class="spacer"></div><span class="subnote">需你处理的项目卡会亮红胶囊</span></div>
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
        <p>· <b>共享资源不用重配</b>：执行器、agent 编制、额度双闸、岗位协议全局一套，新项目即刻可用。</p>
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
async function viewOverview() {
  const [{ all, board }, jn] = await Promise.all([loadBoard(), api('/api/journal').catch(() => ({}))]);
  const n = (s) => (board[s] || []).length;
  const groups = [['在途', n('在途') + n('质检'), ''], ['待验收', n('待验收'), ''], ['待定夺', n('待定夺'), n('待定夺') ? 'err' : ''], ['在池', n('池'), ''], ['待投', n('待投'), '']];
  const strip = groups.map(([l, v, c], i) => `${i ? '<div class="vdiv"></div>' : ''}<div class="grp"><span class="lbl">${l}</span><span class="num ${c}">${v}</span></div>`).join('');
  const inbox = [
    ...(board['待验收'] || []).map((t) => ({ ...t, k: '待验收', note: t.验收方式 === '保留' ? '保留 · 待品味终审' : '委托 · Claude 可代核' })),
    ...(board['待定夺'] || []).map((t) => ({ ...t, k: '待定夺', note: 'QA 未过，四件套已备' })),
  ];
  const inboxHtml = inbox.map((r) => `<div class="inbox-row card" onclick="location.hash='#/t/${r.id}'">
      <span class="rid">${esc(r.id)}</span><span class="rt">${esc(r.title)}</span><span class="rnote">${esc(r.note)}</span>
      ${stPill(r.k)}</div>`).join('') || '<p class="dim">收件箱空——没有需要你决定的</p>';
  const pool = (board['池'] || []);
  const sug = pool.length ? pool[0] : null;
  const lines = (jn.lines || []).slice(-5).reverse();
  const logHtml = lines.map((l) => { const m = String(l).match(/^\[([\d-]+ )?([\d:]{5})[^\]]*\]\s*(.*)$/); const tm = m ? m[2] : ''; const tx = m ? m[3] : String(l);
    const cls = /锁|超|告警|打回/.test(tx) ? 'err' : /通过|完成|验收/.test(tx) ? 'okc' : ''; return `<div class="logrow"><time>${esc(tm)}</time><span class="${cls}">${esc(tx.slice(0, 40))}</span></div>`; }).join('') || '<p class="dim">无动态</p>';
  // 额度卡双杆：5h + 周（周额度烧穿是灾难级，必须可见）；陈旧读数带时间戳
  const qbarLine = (lbl, pct, hot) => `<div class="qrow2"><span class="qn">${lbl}</span><div class="qbar"><i class="${hot ? 'hot' : ''}" style="width:${pct || 0}%"></i></div>
      <span class="qp ${hot ? 'err' : ''}">${pct == null ? '—' : pct + '%'}</span></div>`;
  const qrow = (name, l) => {
    const hot = l && l.locked;
    const staleTag = l && l.陈旧 && l.更新于 ? `（${new Date(l.更新于).toTimeString().slice(0, 5)} 读数）` : '';
    return `<div class="qgrp"><div class="qhead">${name}${hot ? ` <span class="err" style="font-size:10.5px">●锁${l.resetAt ? ' ' + esc(l.resetAt) + ' 解冻' : ''}</span>` : ''}<span class="qstale">${staleTag}</span></div>
      ${qbarLine('5h', l ? l.fivePct : null, hot)}
      ${qbarLine('周', l ? l.weekPct : null, hot && l.weekPct != null && l.weekPct >= 90)}</div>`;
  };
  // 框架即时渲染，数据原地填；之后 5s 活体轮询本地缓存（查询频率另有纪律，显示不受限）
  const qskel = (name) => `<div class="qgrp"><div class="qhead">${name}</div>
      <div class="qrow2"><span class="qn">5h</span><div class="qbar"><i class="ghosting" style="width:0%"></i></div><span class="qp dim">—</span></div>
      <div class="qrow2"><span class="qn">周</span><div class="qbar"><i class="ghosting" style="width:0%"></i></div><span class="qp dim">—</span></div></div>`;
  let lastGatesJson = '';
  const fillGates = async () => {
    const g = await api('/api/gates');
    const rec2 = g.推荐;
    const recEl = $('ov-rec');
    if (recEl) { setNum(recEl, rec2 ? String(rec2.推荐) : '—', 'num ' + (rec2 && rec2.当前 > rec2.推荐 ? 'err' : 'okc')); const grp = recEl.closest('.grp'); if (grp && rec2) grp.title = rec2.原因.join('；'); }
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
  return `<div class="stat-strip card r14">${strip}
      <div class="vdiv"></div>
      <div class="grp"><span class="lbl">推荐在途</span><span class="num dim" id="ov-rec">—</span></div>
      <div class="spacer"></div>
      <div class="grp pool"><span class="lbl">codex 池</span><span class="num dim" id="ov-cx">—</span></div>
      <div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">claude 池</span><span class="num dim" id="ov-cl">—</span></div>
      <div class="vdiv"></div>
      <div class="grp pool"><span class="lbl">环境</span><span class="num dim" id="ov-env" title="全链路自检">—</span></div></div>
    <div class="p1-grid"><div>
      <div class="sec-h"><h3 class="h17">需你处理</h3><span class="subnote">${inbox.length} 项待你决定</span></div>
      ${inboxHtml}
      <div class="sec-h" style="margin-top:28px"><span class="subnote" style="font-weight:500">投放建议</span></div>
      <div class="suggest card">${sug ? `<div style="font-size:13px">池首 <b class="mono" style="font-size:12px">${esc(sug.id)}</b> ${esc(sug.title)} · ${esc(sug.职能)}</div>
        <div class="subnote" style="margin:6px 0 12px">待投区 ${n('待投')} 单可释放；按钮在工单池</div>
        <a class="btn accent h32" href="#/board">去工单池</a>` : '<span class="dim">池空——去起草或释放待投</span>'}</div>
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
  const paused = g && g.paused.global;
  const lockNote = g && (g.locks.codex.locked || g.locks.claude.locked)
    ? `<span class="err" style="font-size:11px;font-weight:500">●锁${esc((g.locks.codex.locked ? g.locks.codex : g.locks.claude).resetAt || '')} 解冻</span>` : '';
  return `<div class="gatebar2 card">
    <div class="gsec"><span class="glbl">暂停闸门</span><span class="gv"><span class="dot" style="${paused ? 'background:var(--danger)' : ''}"></span>
      <b style="font-size:13px">${g ? (paused ? '已暂停' : '运行中') : '查询中'}</b>
      <button class="btn h32" style="height:28px" onclick="togglePause(${g ? !g.paused.global : true})" ${g ? '' : 'disabled'}>${paused ? '恢复' : '暂停'}</button></span></div>
    <div class="vdiv"></div>
    <div class="gsec"><span class="glbl">额度锁</span><span class="gv"><span class="mono" style="font-size:11px;color:var(--ink2)">codex</span> ${mini(g && g.locks.codex)}
      <span class="mono" style="font-size:11px;color:var(--ink2);margin-left:10px">claude</span> ${mini(g && g.locks.claude)} ${lockNote}</span></div>
    <div class="backlog" title="${g && g.推荐 ? esc(g.推荐.原因.join('；')) : ''}"><span class="glbl">推荐在途</span><br/><b>${g && g.推荐 ? `${g.推荐.当前} / 推荐 ${g.推荐.推荐}` : '— / —'}</b></div>
    <div class="backlog" style="margin-left:24px"><span class="glbl">待验收积压</span><br/><b id="backlogN">— / —</b></div></div>`;
}
window.togglePause = async (v) => { await post('/api/gate/pause', { scope: 'global', value: v }); gateCache = null; route(); };
// D43 批量投池：当前项目语境的待投整批释放（人闸=这一次确认）
window.releaseAll = async () => {
  const { board } = await loadBoard();
  const items = board['待投'] || [];
  if (!items.length) return toast('待投区空');
  if (!confirm(`整批投池 ${items.length} 张待投单？投池后执行器按依赖+优先级自动流转。`)) return;
  let ok = 0, fail = 0;
  for (const t of items) { const r = await post('/api/act/投池', { id: t.id }); r.ok ? ok++ : fail++; }
  toast(`已投池 ${ok} 张${fail ? ` · 失败 ${fail} 张（看 journal）` : ''}`);
  route();
};
async function viewBoard() {
  const { states, board } = await loadBoard();
  const conf = await api('/api/config').catch(() => ({ 闸值: {} }));
  const widths = { 池: 'w168', 在途: 'w168', 待验收: 'w168', 执行失败: 'w128', 完成: 'w128', 已归档: 'w128' };
  const cols = states.map((s) => {
    const items = board[s] || [];
    const hot = s === '待验收' || s === '待定夺' || s === '执行失败';
    const head = s === '草稿'
      ? `<h4>${s}<a class="newdraft" href="#/draft">＋ 起草</a></h4>`
      : s === '待投' && items.length
        ? `<h4>${s}<button class="newdraft" title="整批投池（D43：拆完一批不用一张张点，人闸就是这一下）" onclick="releaseAll()">⇧ 全投 ${items.length}</button></h4>`
        : s === '已归档' && (window._hiddenCnt || window._showHidden)
          ? `<h4>${s}<span class="cnt">${items.length}</span><button class="newdraft" title="隐藏归档：制作人湮灭的废案，默认不渲染" onclick="window._showHidden=!window._showHidden;route()">${window._showHidden ? '藏起' : `显隐藏 ${window._hiddenCnt}`}</button></h4>`
          : `<h4>${s}<span class="cnt">${items.length}</span></h4>`;
    const cards = items.map((t) => `<div class="bcard2" data-tid="${esc(t.id)}" onclick="location.hash='#/t/${t.id}'">
        <span class="cid">${esc(t.id)}</span>
        <span class="cpri ${t.优先级 === 'P0' ? 'p0' : ''}">${esc(t.优先级 || '')}</span>
        <div class="ct">${esc(t.title)}</div>${fnPill(t.职能)}</div>`).join('');
    return `<div class="bcol2 ${widths[s] || ''} ${hot ? 'hot' : ''}">${head}${cards}</div>`;
  }).join('');
  const fillBar = async () => {
    const g = await api('/api/gates'); gateCache = g;
    const gb = $('gatebar-slot');
    if (gb) { const key = JSON.stringify([g.paused, g.locks.codex, g.locks.claude, g.推荐 && g.推荐.推荐]);
      if (gb.dataset.k !== key) { gb.dataset.k = key; gb.innerHTML = gatebarHtml(g); } }
    const bn = $('backlogN'); if (bn) bn.textContent = `${(board['待验收'] || []).length} / ${conf.闸值?.待验收积压闸 ?? 8}`;
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
  return `<div id="gatebar-slot">${gatebarHtml(gateCache)}</div><div class="board2" id="board2">${cols}</div>
    <div class="hsync" id="hsync"><div id="hsync-w" style="height:1px"></div></div>`;
}

/* ===== P12 流程（D43）：横轴=阶段 · 阶段内拓扑子列 · 泳道=系统（根祖先）· 红=关键路径 =====
   兼任投池前排版台：草稿/待投也显示。父单（组织容器）不出节点，只当泳道。 */
async function viewFlow() {
  const [{ all }, stg, pls] = await Promise.all([loadBoard(), api('/api/stages?项目=' + encodeURIComponent(curProj())).catch(() => ({ 阶段: [], 标准: {} })), api('/api/pipelines').catch(() => ({ 管线: [] }))]);
  const STG = (stg.阶段 && stg.阶段.length) ? stg.阶段 : [{ 代号: 'L0', 名称: '原型' }, { 代号: 'L1', 名称: '正式化' }, { 代号: 'L2', 名称: '打磨' }];
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  const pById = Object.fromEntries((pls.管线 || []).map((p) => [p.id, p]));
  const hasKids = new Set(all.filter((t) => t.父单 && byId[t.父单]).map((t) => t.父单));
  const depsOf = (t) => t.依赖 ? (Array.isArray(t.依赖) ? t.依赖 : String(t.依赖).split(/[，,\s]+/)).filter((d) => byId[d]) : [];
  const rootOf = (t) => { let c = t, g = 0; while (c.父单 && byId[c.父单] && g++ < 10) c = byId[c.父单]; return c; };
  // H51 管线章解析：显式字段优先，否则沿父链上溯（子单继承专项父单的线）
  const pipeOf = (t) => { let c = t, g = 0; while (c && g++ < 10) { if (c.管线 && pById[c.管线]) return c.管线; c = c.父单 ? byId[c.父单] : null; } return null; };
  const DONE = new Set(['完成', '已归档']);
  // 节点=非容器单；无阶段章的旧单归第一阶段
  // 泳道两级分组（0.23.4，用户裁定「管线下按父单分组」）：管线 → 专项子泳道；散单归「散单」道
  let nsAll = all.filter((t) => !hasKids.has(t.id)).map((t) => {
    const pid = pipeOf(t);
    const spec = rootOf(t);
    const laneKey = pid
      ? `${pid}::${spec.id !== t.id ? spec.id : '_misc'}`
      : (spec.id === t.id ? '::未归属' : `::${spec.id}`);
    const laneTitle = pid
      ? (spec.id !== t.id ? `${spec.id} ${String(spec.title || '').replace(/^专项：|^战役：/, '').slice(0, 24)}` : '散单')
      : (spec.id === t.id ? '未归属' : (spec.title || spec.id));
    return {
      t, id: t.id, deps: depsOf(t), stg: STG.some((s) => s.代号 === t.阶段) ? t.阶段 : STG[0].代号,
      h: parseFloat(t.预计时间) || 1, pid, lane: laneKey, laneTitle,
    };
  });
  // 历史折叠进布局（不再 display:none 留空白）：全完成的子泳道整体不排，头行计数提示
  const foldHist = (() => { try { return (localStorage.getItem('fl_fold') || 'on') !== 'off'; } catch { return true; } })();
  const laneDone = {};
  for (const n of nsAll) { (laneDone[n.lane] = laneDone[n.lane] || []).push(DONE.has(n.t.state)); }
  const foldedLanes = new Set(Object.entries(laneDone).filter(([, arr]) => arr.every(Boolean)).map(([k]) => k));
  const foldedByPipe = {};
  if (foldHist) for (const k of foldedLanes) { const pid = k.split('::')[0]; foldedByPipe[pid] = (foldedByPipe[pid] || 0) + 1; }
  const ns = foldHist ? nsAll.filter((n) => !foldedLanes.has(n.lane)) : nsAll;
  if (!ns.length) return `<div class="emptycard" style="margin-top:30px"><h5>流程空${foldHist && foldedLanes.size ? `（${foldedLanes.size} 组历史已折叠）` : ''}</h5><p>起草工单（选阶段、填依赖/父单）后，这里按 管线×专项 铺出项目流动。${foldHist && foldedLanes.size ? '点「显示历史」看完成组。' : ''}</p></div>`;
  const nById = Object.fromEntries(ns.map((n) => [n.id, n]));
  ns.forEach((n) => { n.deps = n.deps.filter((d) => nById[d]); });
  const SIDX = Object.fromEntries(STG.map((s, i) => [s.代号, i]));
  // 环检测
  ns.forEach((n) => { n.cyc = false; });
  { const st2 = {};
    const visit = (id, stack) => {
      if (st2[id] === 2) return false;
      if (stack.has(id)) return true;
      stack.add(id); let inC = false;
      for (const d of nById[id].deps) if (visit(d, stack)) inC = true;
      stack.delete(id); st2[id] = 2;
      if (inC) nById[id].cyc = true;
      return inC;
    };
    ns.forEach((n) => visit(n.id, new Set())); }
  // 阶段内拓扑子深度（全阶段统一：同阶段依赖只向右，跨泳道不倒退）
  ns.forEach((n) => { n.sub = 0; });
  { let chg = true, g = 0;
    while (chg && g++ < 120) { chg = false;
      for (const n of ns) { if (n.cyc) continue;
        const w = Math.max(0, ...n.deps.map((d) => nById[d]).filter((u) => u.stg === n.stg && !u.cyc).map((u) => u.sub + 1));
        if (w !== n.sub) { n.sub = w; chg = true; } } } }
  // 关键路径：未完成 · 预计时间加权
  const memo = {};
  const longest = (id) => {
    if (memo[id]) return memo[id];
    const n = nById[id];
    if (!n || DONE.has(n.t.state) || n.cyc) return memo[id] = { len: 0, path: [] };
    let best = { len: 0, path: [] };
    for (const d of n.deps) { const r = longest(d); if (r.len > best.len) best = r; }
    return memo[id] = { len: best.len + n.h, path: [...best.path, id] };
  };
  let cp = { len: 0, path: [] };
  ns.forEach((n) => { const r = longest(n.id); if (r.len > cp.len) cp = r; });
  const crit = new Set(cp.path);
  const flCls = (n) => {
    if (n.cyc) return 'cyc';
    if (DONE.has(n.t.state)) return 'done';
    if (n.t.state === '在途') return 'doing';
    if (n.t.state === '质检') return 'review';
    if (n.t.state === '待验收') return 'accept';
    if (n.t.state === '执行失败') return 'failed';
    if (n.t.state === '草稿' || n.t.state === '待投') return 'pre';
    return n.deps.some((d) => !DONE.has(nById[d].t.state)) ? 'blocked' : 'ready';
  };
  // 主阶段 / 泳道阶段
  const actCnt = {};
  ns.forEach((n) => { if (!DONE.has(n.t.state)) actCnt[n.stg] = (actCnt[n.stg] || 0) + 1; });
  const mainStage = (Object.entries(actCnt).sort((a, b) => b[1] - a[1])[0] || [STG[0].代号])[0];
  // 布局
  const NW = 146, NHh = 54, VG = 12, HGap = 22, X0 = 110, CELLPAD = 26;
  const subMax = STG.map((s) => Math.max(0, ...ns.filter((n) => n.stg === s.代号).map((n) => n.sub)) + 1);
  const stageX = []; let xa = X0;
  STG.forEach((s, i) => { stageX[i] = xa; xa += CELLPAD + subMax[i] * (NW + HGap); });
  // 泳道排序：按管线聚簇（有活单的专项在前，散单垫底，无线组殿后）；组首插管线头行
  const laneAct = {};
  for (const n of ns) if (!DONE.has(n.t.state)) laneAct[n.lane] = (laneAct[n.lane] || 0) + 1;
  const laneNames = [...new Set(ns.map((n) => n.lane))].sort((a, b) => {
    const [pa, sa] = a.split('::'), [pb, sb] = b.split('::');
    if (pa !== pb) return (pa === '') - (pb === '') || String(pa).localeCompare(String(pb));
    if ((sa === '_misc') !== (sb === '_misc')) return (sa === '_misc') - (sb === '_misc');
    return (laneAct[b] || 0) - (laneAct[a] || 0) || String(sb).localeCompare(String(sa));
  });
  let yy = 30; const lanes = {}; const pipeHeads = []; let lastPipe = null;
  for (const ln of laneNames) {
    const pid = ln.split('::')[0];
    if (pid && pid !== lastPipe) { // 管线头行（区块标题，占 34px）
      pipeHeads.push({ top: yy, pid, 名称: (pById[pid] || {}).名称 || pid, folded: foldedByPipe[pid] || 0 });
      yy += 34; lastPipe = pid;
    }
    const mine = ns.filter((n) => n.lane === ln);
    const stacks = {}; let depth = 0;
    for (const n of mine) { const k = n.stg + '/' + n.sub; stacks[k] = stacks[k] || 0; n.row = stacks[k]++; depth = Math.max(depth, stacks[k]); }
    lanes[ln] = { top: yy, mine }; yy += 42 + depth * (NHh + VG);
  }
  ns.forEach((n) => { n.x = stageX[SIDX[n.stg]] + n.sub * (NW + HGap); n.y = lanes[n.lane].top + 36 + n.row * (NHh + VG); });
  const laneStage = (mine) => {
    const act = mine.filter((n) => !DONE.has(n.t.state));
    if (act.length) return act.reduce((m, n) => SIDX[n.stg] < SIDX[m] ? n.stg : m, act[0].stg);
    return mine.reduce((m, n) => SIDX[n.stg] > SIDX[m] ? n.stg : m, mine[0].stg);
  };
  // 边：扇形锚点
  const inE = {}, outE = {};
  ns.forEach((n) => n.deps.forEach((d) => { (inE[n.id] = inE[n.id] || []).push(d); (outE[d] = outE[d] || []).push(n.id); }));
  for (const k in inE) inE[k].sort((a, b) => nById[a].y - nById[b].y);
  for (const k in outE) outE[k].sort((a, b) => nById[a].y - nById[b].y);
  const aY = (n, list, o) => n.y + NHh * ((list.indexOf(o) + 1) / (list.length + 1));
  // 连线保持贝塞尔（用户裁定：横穿无妨，曲线更好看）；已满足依赖退淡影
  let paths = '';
  ns.forEach((n) => n.deps.forEach((d) => {
    const u = nById[d];
    const x1 = u.x + NW, y1 = aY(u, outE[u.id], n.id), x2 = n.x, y2 = aY(n, inE[n.id], u.id);
    const dseg = x2 > x1
      ? `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1 + 30} ${Math.max(u.y, n.y) + NHh + 16}, ${x2 - 30} ${Math.max(u.y, n.y) + NHh + 16}, ${x2} ${y2}`;
    const faded = DONE.has(u.t.state) && !(crit.has(n.id) && crit.has(u.id));
    paths += `<path class="fl-e${u.stg !== n.stg ? ' up' : ''}${crit.has(n.id) && crit.has(u.id) ? ' crit' : ''}${faded ? ' faded' : ''}" data-f="${esc(u.id)}" data-t="${esc(n.id)}" d="${dseg}"/>`;
  }));
  const heads = STG.map((s, i) => `<div class="fl-head" style="left:${stageX[i]}px;width:${subMax[i] * (NW + HGap)}px" title="阶段验收标准（${esc(s.代号)} ${esc(s.名称)}）&#10;${esc(Object.entries(stg.标准[s.代号] || {}).map(([f, v]) => f + '：' + v).join('\n'))}">
      <b>${esc(s.代号)} ${esc(s.名称)}</b><span class="sn">${s.代号 === mainStage ? '项目主阶段 · ' : ''}悬停看验收标准 ⓘ</span></div>`
    + (i ? `<div class="fl-col" style="left:${stageX[i] - CELLPAD / 2}px"></div>` : '')).join('');
  const pipeHeadHtml = pipeHeads.map((h) => `<div class="fl-pipehead" style="top:${h.top}px">
      <span class="lst" style="background:var(--accentbg);color:var(--accent-ink);border-color:transparent">管线</span>
      <b>${esc(h.名称)}</b>${(pById[h.pid] || {}).状态 === '封存' ? '<span class="lst lag">已封存</span>' : ''}
      ${h.folded ? `<span class="dim" style="font-size:11px">· ${h.folded} 个已完成专项已折叠</span>` : ''}</div>`).join('');
  const laneHtml = laneNames.map((ln) => {
    const L = lanes[ln]; const ls = laneStage(L.mine); const misc = ln === '::未归属';
    const title = (L.mine[0] || {}).laneTitle || ln.split('::')[1] || ln;
    const lag = !misc && SIDX[ls] < SIDX[mainStage] && L.mine.some((n) => !DONE.has(n.t.state));
    const lead = !misc && SIDX[ls] > SIDX[mainStage];
    const wait = L.mine.some((n) => n.t.state === '待验收' && n.t.验收方式 === '保留');
    const allDone = L.mine.every((n) => DONE.has(n.t.state));
    return `<div class="fl-lane" style="top:${L.top}px"></div>
      <div class="fl-lab" style="top:${L.top}px">${esc(title)}${allDone ? '<span class="lst" style="opacity:.6">已完成</span>' : `<span class="lst ${lag ? 'lag' : lead ? 'lead' : ''}">${esc(ls)}${lag ? ' 滞后' : lead ? ' 超前' : ''}</span>`}${wait ? '<span class="lst lag" style="background:var(--dangerbg);color:var(--danger);border-color:transparent">待你验收</span>' : ''}</div>`;
  }).join('');
  const nodeHtml = ns.map((n) => `<div class="fl-node ${flCls(n)}${crit.has(n.id) ? ' crit' : ''}" id="fl-${esc(n.id)}"
      style="left:${n.x}px;top:${n.y}px;--fn:${FNHEX[n.t.职能] || 'var(--ink3)'}" data-nid="${esc(n.id)}"
      onclick="location.hash='#/t/${encodeURIComponent(n.id)}'" onmouseenter="flChain('${esc(n.id)}')" onmouseleave="flChain(null)">
      <span class="nid">${esc(n.id)}</span><span class="nst">${n.cyc ? '⚠环' : esc(n.t.state)}</span>
      <div class="nt">${esc(n.t.title)}</div><span class="nh">${n.h}h</span></div>`).join('');
  window._flData = { ns: ns.map((n) => ({ id: n.id, deps: n.deps })), done: ns.filter((n) => DONE.has(n.t.state)).map((n) => n.id) };
  return `<div class="fl-bar">
      <span class="subnote">横轴=阶段 · 泳道=系统 · 红=关键路径（预计时间加权）· 虚线=升阶链 · 点卡进详情</span>
      <span class="sp"></span>
      ${cp.len ? `<span class="fl-cp">关键路径 ${Math.round(cp.len * 10) / 10}h · ${cp.path.length} 单</span>` : ''}
      <button class="btn h32 ${foldHist ? 'on' : ''}" id="fl-fold-btn" onclick="flFold(this)">${foldHist ? '显示历史' : '折叠已完成'}</button></div>
    <div class="fl-wrap"><div class="fl-stage" style="width:${xa + 20}px;height:${yy + 16}px">
      <svg class="fl-svg" width="${xa + 20}" height="${yy + 16}">${paths}</svg>
      ${heads}${pipeHeadHtml}${laneHtml}${nodeHtml}</div></div>`;
}
window.flChain = (id) => {
  const d = window._flData; if (!d) return;
  let rel = null;
  if (id) {
    const upM = {}, dnM = {};
    d.ns.forEach((n) => n.deps.forEach((x) => { (upM[n.id] = upM[n.id] || []).push(x); (dnM[x] = dnM[x] || []).push(n.id); }));
    rel = new Set([id]);
    const walk = (m, i) => (m[i] || []).forEach((x) => { if (!rel.has(x)) { rel.add(x); walk(m, x); } });
    walk(upM, id); walk(dnM, id);
  }
  // 高亮类名 onchain：不准叫 chain——详情页追溯链的通用 .chain{margin-top:18px} 会把绝对定位卡片顶下沉 18px（0.17.3 连环误诊的真凶）
  d.ns.forEach((n) => { const el = $('fl-' + n.id); if (!el) return;
    el.classList.toggle('dimmed', !!rel && !rel.has(n.id));
    el.classList.toggle('onchain', !!rel && rel.has(n.id) && n.id !== id); });
  document.querySelectorAll('path.fl-e').forEach((p) => {
    const on = rel && rel.has(p.dataset.f) && rel.has(p.dataset.t);
    p.classList.toggle('dimmed', !!rel && !on);
    p.classList.toggle('onchain', !!on && !p.classList.contains('crit')); });
};
window.flFold = (btn) => {
  // 0.23.4：折叠进布局——切偏好后整页重排，完成组整泳道退出排版（旧 display:none 留空白已废）
  const fold = !btn.classList.contains('on');
  try { localStorage.setItem('fl_fold', fold ? 'on' : 'off'); } catch { /* 无痕模式不阻塞 */ }
  route();
};
// 默认折叠历史（用户裁定：三代同堂淹没活单）——偏好跨会话保持，显式点开才看历史
window.flAutoFold = () => { /* 0.23.4：折叠进布局，此钩子退役 */ };

/* ===== P10 树形 ===== */
let tState = { collapsed: new Set(JSON.parse(localStorage.getItem('studio.tree.collapsed') || '[]')), fn: '', st: 'active', expandAll: false };
function saveCollapsed() { localStorage.setItem('studio.tree.collapsed', JSON.stringify([...tState.collapsed])); }
async function viewTree() {
  const [{ all }, pls] = await Promise.all([loadBoard(), api('/api/pipelines').catch(() => ({ 管线: [] }))]);
  const { byId, kids, parents, topLeaves } = buildTree(all);
  const pById = Object.fromEntries((pls.管线 || []).map((p) => [p.id, p]));
  const pipeOf = (t) => { let c = t, g = 0; while (c && g++ < 10) { if (c.管线 && pById[c.管线]) return c.管线; c = c.父单 ? byId[c.父单] : null; } return null; };
  const parentSet = new Set(parents.map((p) => p.id));
  const stOk = (t) => tState.st === 'active' ? !['完成', '已归档'].includes(t.state) : true;
  const fnOk = (t) => !tState.fn || t.职能 === tState.fn;
  // D43 三层结构（总单→阶段父单→碎单）：树递归渲染，父单进度=后代叶子均值（逐层聚合，不再被容器子单拉成 0%）
  const pctOf = (t) => { const ch = kids[t.id]; if (!ch || !ch.length) return STPCT[t.state] ?? 0;
    return Math.round(ch.reduce((a, c) => a + pctOf(c), 0) / ch.length); };
  const anyVisible = (t) => (kids[t.id] || []).some((c) => parentSet.has(c.id) ? anyVisible(c) : (stOk(c) && fnOk(c)));
  const rowHtml = (t, lv, isParent, chn) => {
    const pct = isParent ? pctOf(t) : (STPCT[t.state] ?? 0);
    const acceptN = isParent ? chn.filter((c) => c.state === '待验收').length : 0;
    const collapsed = tState.collapsed.has(t.id);
    const twist = isParent ? `<span class="twist2" onclick="event.stopPropagation();tToggle('${esc(t.id)}')">${collapsed ? '▸' : '▾'}</span>`
      : (lv === 0 ? '<span class="twist2 none">▸</span>' : '<span class="twist2 none">·</span>');
    return `<div class="trow2 ${isParent ? 'parent' : 'leaf'} ${lv ? 'lv' + Math.min(lv, 3) : ''} ${acceptN ? 'hasaccept' : ''}" onclick="location.hash='#/t/${t.id}'">
      ${twist}<span class="tid2">${esc(t.id)}</span><span class="tt2">${esc(t.title)}</span>
      ${isParent ? `<span class="kids">${chn.length} 子单${t.阶段 ? ' · ' + esc(t.阶段) : ''}</span>` : ''}
      <span class="mid">${!isParent ? fnPill(t.职能) + stPill(t.state) : ''}</span>
      <div class="prog"><span class="bar"><i style="width:${pct}%"></i></span><span class="pv">${pct}%</span></div>
      ${acceptN ? `<button class="accept-mini" onclick="event.stopPropagation();tAcceptAll('${esc(t.id)}')">✓ 验收子单×${acceptN}</button>` : ''}
      ${!isParent ? `<div class="acts"><a class="mini3" href="#/t/${t.id}" onclick="event.stopPropagation()">详情</a><a class="mini3" href="#/draft?parent=${t.id}" onclick="event.stopPropagation()">＋ 子单</a></div>` : ''}
    </div>`;
  };
  let html = ''; let count = 0, treeN = 0;
  const renderSub = (p, lv) => {
    const chAll = kids[p.id] || [];
    count++;
    html += rowHtml(p, lv, true, chAll);
    if (tState.collapsed.has(p.id)) return;
    for (const c of chAll) {
      if (parentSet.has(c.id)) { if (anyVisible(c) || stOk(c)) renderSub(c, lv + 1); }
      else if (stOk(c) && fnOk(c)) { count++; html += rowHtml(c, lv + 1, false, []); }
    }
  };
  // 只有根父单（自己没有在场父亲的）开树；中间层父单在递归里渲染——D42 前的单层写法曾把 TK-15 重复画成两棵树
  // H51 管线分区：根与散单按管线章分组渲染，管线是区块头不是工单卡（实体分立律 H52）
  const roots = parents.filter((p) => !(p.父单 && byId[p.父单]));
  const leaves = topLeaves.filter((t) => stOk(t) && fnOk(t));
  const pipeHead = (p) => `<div class="trow2 parent" style="background:var(--accentbg);border-radius:8px">
    <span class="twist2 none">⛓</span><span class="tid2">${esc(p.id)}</span><span class="tt2"><b>${esc(p.名称)}</b>（管线）</span>
    <span class="kids">${esc(p.阶段 || '')}${p.状态 === '封存' ? ' · 已封存' : ''}</span></div>`;
  const grouped = new Set();
  for (const p of (pls.管线 || [])) {
    const myRoots = roots.filter((r) => pipeOf(r) === p.id);
    const myLeaves = leaves.filter((t) => pipeOf(t) === p.id);
    if (!myRoots.length && !myLeaves.length) continue;
    html += pipeHead(p);
    myRoots.forEach((r) => { grouped.add(r.id); if (!anyVisible(r) && !stOk(r)) return; treeN++; renderSub(r, 1); });
    myLeaves.forEach((t) => { grouped.add(t.id); count++; html += rowHtml(t, 1, false, []); });
  }
  roots.filter((r) => !grouped.has(r.id)).forEach((p) => {
    if (!anyVisible(p) && !stOk(p)) return;
    treeN++; renderSub(p, 0);
  });
  leaves.filter((t) => !grouped.has(t.id)).forEach((t) => { count++; html += rowHtml(t, 0, false, []); });
  const fns = ['', '策划', '程序', '美术', 'QA'];
  return `<div class="ttools">
      <button class="btn h32" onclick="tExpandAll()">${tState.collapsed.size ? '⌄ 全部展开' : '⌃ 全部折叠'}</button>
      <select class="btn h32" style="padding:0 12px" onchange="tState.fn=this.value;route()">${fns.map((f) => `<option value="${f}" ${tState.fn === f ? 'selected' : ''}>${f ? '职能：' + f : '筛选：全部职能'}</option>`).join('')}</select>
      <select class="btn h32" style="padding:0 12px" onchange="tState.st=this.value;route()">
        <option value="active" ${tState.st === 'active' ? 'selected' : ''}>状态：进行中的</option>
        <option value="all" ${tState.st === 'all' ? 'selected' : ''}>状态：全部</option></select>
      <span class="cnt">${count} 单 · ${treeN} 棵树</span></div>
    <div class="tree2">${html || '<p class="dim">没有匹配的工单</p>'}</div>
    <div class="tree-note">▾/▸ 折叠状态跨会话保持 · 父单进度=子单均值 · 父单不进池（组织容器）· 「✓ 验收子单」批量通过该父下全部待验收</div>`;
}
window.tToggle = (id) => { if (tState.collapsed.has(id)) tState.collapsed.delete(id); else tState.collapsed.add(id); saveCollapsed(); route(); };
window.tExpandAll = () => { if (tState.collapsed.size) tState.collapsed.clear(); else { loadBoard().then(({ all }) => { buildTree(all).parents.forEach((p) => tState.collapsed.add(p.id)); saveCollapsed(); route(); }); return; } saveCollapsed(); route(); };
window.tAcceptAll = async (pid) => {
  const { all } = await loadBoard(); const ch = all.filter((t) => t.父单 === pid && t.state === '待验收');
  if (!confirm(`批量验收 ${pid} 下 ${ch.length} 张待验收子单？`)) return;
  for (const c of ch) await post('/api/act/验收', { id: c.id, 通过: true });
  toast(`已验收 ${ch.length} 张`); route();
};

/* ===== P3 在途 · 时间轴（甘特并入：回放真实执行，无计划日期）===== */
function timelineHtml(agents, all, opts) {
  const now = Date.now(); const HOURS = 48; const t0 = now - HOURS * 3600000; const pxh = 26; const W = HOURS * pxh;
  const byFn = !!(opts && opts.byFn); // 派发制：按职能分泳道——一次性主办不占行，行数恒定
  const online = byFn ? [] : agents.filter((a) => a.上线 !== false).map((a) => a.id);
  const withSegs = all.filter((t) => t.主办 && t.领单时间);
  const laneOf = (t) => byFn ? (t.职能 || '其他') : t.主办;
  const FN_ORDER = ['策划', '程序', '美术', '装配', 'QA', '其他'];
  const ids = byFn
    ? FN_ORDER.filter((fn) => withSegs.some((t) => (t.职能 || '其他') === fn))
    : [...new Set([...online, ...withSegs.map((t) => t.主办)])];
  const segs = {}; let any = false;
  for (const t of withSegs) {
    const s = Date.parse(t.领单时间); if (Number.isNaN(s)) continue;
    const inflight = ['在途', '质检', '待定夺'].includes(t.state);
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
    return `<span class="tlseg ${g.inflight ? 'on' : ''}" style="--i:${si++};left:${x}px;width:${w}px;background:${c}${byFn ? `;top:${3 + (g.lv || 0) * 30}px` : ''}" title="${esc(g.t.id)} ${esc(g.t.title)}（${g.inflight ? '进行中' : '已交付'}）" onclick="location.hash='#/t/${esc(g.t.id)}'">${label}</span>`;
  }).join('')}</div>`).join('');
  const colH = ids.reduce((a, id) => a + rowH(id), 0);
  setTimeout(() => { const el = $('tlscroll'); if (el) el.scrollLeft = el.scrollWidth; }, 0);
  return `<div class="tlcard card r14">${head}
    <div class="tlflex"><div class="tlwhocol"><div class="tlsp"></div>${ids.map((id) => `<div class="tlwho" style="height:${rowH(id)}px">${esc(id)}</div>`).join('')}</div>
    <div class="tlscroll" id="tlscroll"><div style="position:relative;width:${W + 20}px">
      <div class="tlaxis">${ticks}</div>${lanes}
      <div class="tlnow" style="left:${W - 1}px;height:${20 + colH}px"></div>
    </div></div></div></div>`;
}
/* ===== 在途 · 派发制视图（H49）：执行者因单而生、完成即销毁，常备的只有判官 ===== */
function viewAgentsDispatch(d, all) {
  const lim = d.并发上限 || {};
  const cards = (d.在跑 || []).map((r) => {
    const since = r.环节起时 || r.领单时间 || '';
    const elapsed = since ? Date.now() - Date.parse(since) : 0;
    return `<div class="arow2 card r14">
      <div class="av" style="background:${FNHEX[r.职能] || 'var(--ink3)'}">${esc((r.职能 || '').slice(0, 2))}</div>
      <div class="who">${esc(r.主办)}</div>
      <span class="poolp pill sm fn ${r.池 === 'claude' ? 'pool-claude' : 'pool-codex'}">${esc(r.池 || '?')} 池</span>
      <div class="mid2"><span class="aid"><a href="#/t/${esc(r.id)}" style="color:inherit">${esc(r.id)}</a></span>
        <div class="at">${esc(r.title || '')}${r.尾 ? ` <span class="dim2">· ${esc(String(r.尾).slice(-60))}</span>` : ''}</div></div>
      <div class="chips">${fnPill(r.职能)}${stPill(r.state)}</div>
      <div class="rgt"><span class="lbl">${r.环节 ? esc(r.环节) + '中' : '衔接中'}</span><br/>
        <span class="tm" data-since="${esc(since)}">${fmtElapsed(elapsed)}</span>
        <div class="bar"><i style="width:${Math.min(1, elapsed / (4 * 3600000)) * 100}%"></i></div><div class="cap">滞留阈值 4h</div></div>
    </div>`;
  }).join('') || '<p class="dim" style="margin:26px 0;text-align:center">当前无在跑执行者 —— 派发制下没有常备军，就绪单一到即拉起，完成即销毁。</p>';
  const judges = (d.判官 || []).map((j) => `<span class="pill sm ${j.忙 ? 'ok' : 'mut'}">${esc(j.id)}${j.忙 ? ' · 审 ' + esc(j.当前 || '') : ' · 待命'}</span>`).join(' ') || '<span class="dim">（未配置）</span>';
  const ready = (d.就绪队列 || []).map((q) => `<span class="pill sm mut mono">${esc(q.id || q)}</span>`).join(' ') || '<span class="dim">空 —— 无就绪待派单</span>';
  // 已跑计时秒级跳动（与领单视图同款：离开视图自动停）
  setTimeout(function tickTm() {
    const els = document.querySelectorAll('.tm[data-since]');
    if (!els.length) return;
    els.forEach((el) => { const t = Date.parse(el.dataset.since); if (!isNaN(t)) el.textContent = fmtElapsed(Date.now() - t); });
    setTimeout(tickTm, 1000);
  }, 1000);
  const busyBanner = (d.编辑器占用||[]).length ? `<div class="card r14" style="padding:10px 16px;margin-top:16px;border-left:3px solid var(--warn);border-radius:0 12px 12px 0"><b>编辑器占用中</b> · 项目 ${d.编辑器占用.map(esc).join("、")} 的派发已挂起——关闭 Unity 编辑器后自动恢复</div>` : '';
  return busyBanner + `<div class="sec-h" style="margin-top:26px"><h3 class="h17">在跑执行者</h3>
      <span class="subnote">派发制 · 因单而生、完成即销毁 · 并发 codex ≤${lim.codex != null ? lim.codex : '—'} / claude ≤${lim.claude != null ? lim.claude : '—'}（项管调配 · 代码硬顶 3）</span></div>
    ${cards}
    <div class="sec-h" style="margin-top:26px"><h3 class="h17">判官编制</h3><span class="subnote">质检 / 代核 / 代裁 · 唯一常驻岗</span></div>
    <div class="card r14" style="padding:14px 16px;display:flex;gap:8px;flex-wrap:wrap">${judges}</div>
    <div class="sec-h" style="margin-top:26px"><h3 class="h17">就绪队列</h3><span class="subnote">依赖已齐、等槽位或额度（项管台账）</span></div>
    <div class="card r14" style="padding:14px 16px;display:flex;gap:8px;flex-wrap:wrap">${ready}</div>
    ${timelineHtml([], all, { byFn: true })}`;
}

async function viewAgents() {
  const [d, { all }] = await Promise.all([api('/api/agents'), loadBoard()]);
  // 0.23：拉取制视图退役——派发制是唯一现实（H49/H56 清仓）
  return viewAgentsDispatch(d, all);
}

/* ===== P4 决策台 ===== */
let dTab = 'accept';
async function viewDecisions() {
  const d = await api('/api/decisions');
  // D42：决策台按当前项目过滤（积压计数是全局闸，保持全局读数）
  const p = projActive();
  if (p) { await loadCfg(); d.待验收 = d.待验收.filter((t) => projOf(t) === p); d.待定夺 = d.待定夺.filter((t) => projOf(t) === p); }
  const cur = dTab === 'accept' ? (d.待验收[0] || null) : (d.待定夺[0] || null);
  let main = '<div class="dmain card r16"><p class="dim">没有待处理项</p></div>';
  if (cur) {
    const tk = await api('/api/ticket?id=' + encodeURIComponent(cur.id));
    const preview = tk.回执 ? tk.回执.raw : tk.body || '';
    const pvLines = preview.split('\n').filter((l) => l.trim()).slice(0, 8)
      .map((l) => `<div class="doc-line ${l.startsWith('#') ? 'hd' : ''}">${esc(l.replace(/^#+\s*/, l.startsWith('#') ? '## ' : ''))}</div>`).join('');
    const std = (tk.body || '').split(/^## /m).find((s) => s.startsWith('验收标准')) || '';
    const stdLines = std.split('\n').slice(1).filter((l) => l.trim()).slice(0, 6).map((l) => `<div class="doc-line">${esc(l)}</div>`).join('') || '<div class="doc-line dim">（工单未写验收标准）</div>';
    const isKeep = cur.验收方式 === '保留';
    main = `<div class="dmain card r16"><h2>${esc(cur.id)} · ${esc(cur.title)}</h2>
      <div class="chipsrow">${fnPill(cur.职能)}<span class="pill mut">${esc(cur.验收方式 || '保留')}${isKeep ? ' · 只你能签' : ''}</span>${cur.自修次数 ? `<span class="pill red">QA 未过 · 自修 ${cur.自修次数}</span>` : ''}</div>
      <div class="dpanes"><div class="dpane"><div class="ph">${tk.回执 ? '产出预览 · 回执' : '工单正文'}</div>${pvLines || '<div class="doc-line dim">（空）</div>'}</div>
      <div class="dpane"><div class="ph">${dTab === 'accept' ? '验收标准（委托核查范围）' : '四件套'}</div>${dTab === 'accept' ? stdLines
        : `<div class="doc-line">结论：QA 未通过（自修 ${cur.自修次数 || 0} 轮）</div><div class="doc-line">问题/原因/解法：见回执异议与 QA 章节</div>`}
        ${isKeep && dTab === 'accept' ? '<div class="taste">待你品味：产出对不对味，只有你能签。</div>' : ''}</div></div>
      ${dTab === 'accept' ? `<div class="dsign"><span>${isKeep ? '保留单 · 品味终审' : '委托单 · 可核项由 Claude 代核'}</span>
        <div class="btns"><button class="btn primary h36" onclick="dAct('验收','${esc(cur.id)}',true)">通过入库</button>
        <button class="btn h36" onclick="dReject('${esc(cur.id)}')">打回</button></div></div>`
      : `<div class="dsign"><span>QA 修不好 · 呈你我裁决</span><div class="btns">
        <button class="btn h36" onclick="dAct('定夺','${esc(cur.id)}',null,'接受')">接受</button>
        <button class="btn h36" onclick="dAct('定夺','${esc(cur.id)}',null,'给方向')">给方向</button>
        <button class="btn danger-o h36" onclick="dAct('定夺','${esc(cur.id)}',null,'打回')">打回</button></div></div>`}</div>`;
  }
  const q1 = d.待验收.map((t) => `<div class="qitem" onclick="dTab='accept';route()"><span class="qi mono">${esc(t.id)}</span><div class="qn2">${esc(t.title)} · ${esc(t.验收方式 || '保留')}</div></div>`).join('') || '<p class="dim" style="margin-top:12px">无</p>';
  return `<div class="dtabs">
      <span class="tab ${dTab === 'accept' ? 'active' : ''}" onclick="dTab='accept';route()">验收签字</span>
      <span class="tab ${dTab === 'escal' ? 'active' : ''}" onclick="dTab='escal';route()">待定夺 ${d.待定夺.length ? `<span class="badge">${d.待定夺.length}</span>` : ''}</span>
      <span class="backlog2">待验收积压 ${d.积压} / ${d.积压闸}</span></div>
    <div class="dgrid">${main}<div><div class="dside card r16"><h3>待验收队列</h3>${q1}</div>
      <div class="dside card r16"><h3 class="err">待定夺 · ${d.待定夺.length}</h3>
        ${d.待定夺.map((t) => `<div class="qitem" onclick="dTab='escal';route()"><span class="qi mono">${esc(t.id)}</span><div class="qn2">${esc(t.title)} · QA 未过</div></div>`).join('') || '<p class="dim" style="margin-top:12px">无</p>'}</div></div></div>`;
}
window.dAct = async (name, id, 通过, 决定) => { const r = await post('/api/act/' + name, { id, 通过, 决定 }); toast(r.ok ? '已处理' : (r.error || '失败')); route(); };
window.dReject = (id) => { if (confirm('打回将归档旧单，需另开新单重走流程。确认？')) dAct('验收', id, false); };

/* ===== P5 风格库 ===== */
async function viewStyleLib() {
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
  return `<div class="p5grid"><div>
      <div class="sec-h"><h3 class="h17">策划标杆</h3><span class="subnote">提炼式 · 设计公理 · 来源可溯</span></div>${ax}</div>
    <div><div class="sec-h"><h3 class="h17">美术库</h3><span class="subnote">精选范例 · 只进精品</span></div>
      ${art ? `<div class="artgrid">${art}</div>` : `<div class="emptycard"><h5>范本库空</h5>
        <p>完成态的美术/装配单详情页有「入美术库」——把产出文件精选进来，agent 领单前先看这里对齐风格。</p></div>`}</div></div>`;
}
window.axRemove = async (标题) => {
  if (!confirm(`把「${标题}」移出标杆？`)) return;
  const r = await post('/api/stylelib/axiom-remove', { 标题 });
  toast(r.ok ? '已移出' : (r.error || '失败')); if (r.ok) route();
};
window.artRemove = async (name) => {
  if (!confirm(`把 ${name} 移出美术库？（文件会删除，来源仓库里的原件不受影响）`)) return;
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
function pmLedgerCard(L) {
  const fee = L.管理费 || { token合计: 0, 次数: 0 };
  const caps = Object.entries(L.并发上限 || {}).map(([k, v]) => esc(k) + ' ≤' + v).join(' · ') || '—';
  const costRows = Object.entries(L.父单成本 || {}).slice(-6).map(([pid, c]) => {
    const tk = typeof c === 'object' ? (c.token合计 ?? c.tokens ?? 0) : c;
    return '<tr><td class="mono">' + esc(pid) + '</td><td style="text-align:right">' + Number(tk).toLocaleString() + '</td></tr>';
  }).join('') || '<tr><td colspan="2" class="dim">暂无归集</td></tr>';
  return '<div class="rp-card card r14"><h4>项目管理台账<span class="subnote" style="margin-left:10px">管理费 '
    + Number(fee.token合计 || 0).toLocaleString() + ' tk · ' + (fee.次数 || 0) + ' 次 · 并发 ' + caps + '</span></h4>'
    + '<table class="rp-t"><tr><th>专项成本归集</th><th style="text-align:right">tokens</th></tr>' + costRows + '</table></div>';
}
async function viewReport() {
  const [d, , pl] = await Promise.all([api('/api/report'), loadCfg(), api('/api/pm/ledger').catch(() => null)]);
  const dispatch = !!(_cfg && _cfg.执行器 && _cfg.执行器.派发制);
  const p = projActive();
  // D42 项目语境：明细/分组按项目过滤（服务端全量，客户端切片——报表数据量小）
  const rows = p ? d.明细.filter((r) => (r.项目 || projDefault()) === p) : d.明细;
  const o = d.总览;
  const stat = (l, v, c) => `<div class="grp"><span class="lbl">${l}</span><span class="num ${c || ''}">${v}</span></div>`;
  const strip = [
    stat('完成', o.完成), stat('归档', o.已归档), stat('实际工时', o.实际h合计 + 'h'),
    stat('预估偏差', o.预估偏差pct == null ? '—' : o.预估偏差pct + '%', o.预估偏差pct > 150 ? 'err' : o.预估偏差pct != null && o.预估偏差pct <= 110 ? 'okc' : ''),
    stat('自修轮次', o.自修总轮, o.自修总轮 ? 'warnc' : ''),
    stat('代核 过/不过', o.代核通过 + '/' + o.代核不过),
    stat('代裁 向/呈', o.代裁给方向 + '/' + o.代裁上呈),
    stat('token(agent自报)', o.token估计合计 ? o.token估计合计.toLocaleString() : '—'),
    ...(dispatch && pl && pl.台账 && pl.台账.管理费 ? [stat('管理费(项管)', (pl.台账.管理费.token合计 || 0).toLocaleString() + ' tk·' + (pl.台账.管理费.次数 || 0) + '次')] : []),
  ].join('<div class="vdiv"></div>');
  const gtable = (title, rows2, note) => `<div class="rp-card card r14"><h4>${title}<span class="subnote" style="margin-left:10px">${note || ''}</span></h4>
    <table class="rp-t"><tr><th></th><th>单数</th><th>合计h</th><th>均h</th><th>自修</th></tr>
    ${rows2.map((g) => `<tr><td>${esc(g.名)}</td><td>${g.单数}</td><td>${g.实际h合计}</td><td>${g.平均h}</td><td class="${g.自修合计 ? 'warnc' : 'dim'}">${g.自修合计}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">无数据</td></tr>'}</table></div>`;
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
      <div>${gtable('按职能', dispatch && pl && pl.台账 ? [...d.按职能, { 名: '项目管理', 单数: (pl.台账.管理费 || {}).次数 || 0, 实际h合计: '—', 平均h: ((pl.台账.管理费 || {}).token合计 || 0).toLocaleString() + ' tk', 自修合计: 0 }] : d.按职能)}${dispatch ? costRankTable(rows) : gtable('按主办', d.按主办)}${dispatch && pl && pl.台账 ? pmLedgerCard(pl.台账) : ''}${gtable('按执行池', d.按池, '订阅额度去向')}</div>
      <div><div class="rp-card card r14"><h4>每日交付<span class="subnote" style="margin-left:10px">近 14 天</span></h4>
        <div class="rp-days">${daysHtml}</div></div>
        ${gtable('按项目', d.按项目)}</div>
    </div>
    <div class="rp-card card r14" style="margin-top:20px"><h4>工单明细${p ? `<span class="subnote" style="margin-left:10px">项目 ${esc(p)}</span>` : ''}</h4>
      <table class="rp-t"><tr><th>编号</th><th>职能</th><th>阶段</th><th>预计</th><th>实际</th><th>偏差</th><th>自修</th><th>agent 自报消耗</th></tr>${detail || '<tr><td colspan="8" class="dim">无数据</td></tr>'}</table>
      <p class="subnote" style="margin-top:10px">实际=交付-领单的墙钟时长 · token 为 agent 回执自报（参考值）· 点行进详情</p></div>`;
}

/* ===== P6 参数与额度 =====
   铁律：视图保持渲染——首屏立即画（额度先占位后原地填），调参只原地改数字，绝不整页重载 */
const P6META = { 全局在途上限: '同时最多 N 张在途', 待验收积压闸: '≥N 停止建议投放', QA自修上限: '轮，超则上交四件套', 滞留超时小时: '小时，超则告警（不自动撤回）',
  速度窗口小时: '统计处理速度的回看窗口 N 小时', 每档处理数: '窗口内每处理 N 项决策，推荐 +1',
  间隔秒: '每 N 秒扫一轮池（领单+起执行）', 执行超时分钟: '实弹单超 N 分钟树杀 → 执行失败', 记账间隔分钟: '每 N 分钟自动 git 落袋（0=关）',
  额度刷新秒: '两次额度请求最小间隔 N 秒（防限流硬保证）' };
const P6NAMES = { 滞留超时小时: '滞留超时', 速度窗口小时: '速度窗口', 每档处理数: '每档处理数',
  间隔秒: '扫池间隔', 执行超时分钟: '执行超时', 记账间隔分钟: '记账间隔', 额度刷新秒: '额度刷新间隔' };
function poolCardHtml(name, l, cfg2) {
  const pct = l && l.fivePct != null ? l.fivePct : null; const hot = l && l.locked;
  return `<div class="pr"><h4>${name} 池</h4><span class="pstat ${hot ? 'err' : 'dim'}">${l ? (hot ? '●锁 ' + esc(l.resetAt || '') + ' 解冻' : '正常') : '查询中…'}</span></div>
    <div class="meta">5h ${pct == null ? '··' : pct + '%'} · 周 ${l && l.weekPct != null ? l.weekPct + '%' : '··'} · 阈值 ${cfg2 ? cfg2.阈值 : '—'}%</div>
    <div class="pbar"><i class="${hot ? 'hot' : ''}" style="width:${pct || 0}%"></i></div>`;
}
function teamRowsHtml(agents) {
  // D38：模型档可选——下拉 = 池默认 + 监测/配置的可选项（window._models 由参数页加载）
  const m = (window._p6cfg && window._p6cfg.模型) || {};
  const av = window._models || {};
  const pools = Object.keys((window._p6cfg && window._p6cfg.执行池) || { codex: 1, claude: 1 });
  return (agents || []).map((a) => {
    const pool = a.执行池 || 'claude';
    const poolDefault = m[pool + '默认'] || '';
    const opts = ((av[pool] && av[pool].可选) || []);
    const sel = `<select class="mselect mono" title="模型档：个体覆盖 > 池默认 > CLI 默认" onchange="aModel('${esc(a.id)}', this.value)">
        <option value="" ${!a.模型 ? 'selected' : ''}>池默认${poolDefault ? '·' + esc(poolDefault) : ''}</option>
        ${opts.map((o) => `<option value="${esc(o)}" ${a.模型 === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
        ${a.模型 && !opts.includes(a.模型) ? `<option value="${esc(a.模型)}" selected>${esc(a.模型)}</option>` : ''}
      </select>`;
    const psel = `<select class="mselect mono" title="执行池：决定 CLI 归属与额度闸；切池清模型覆盖，下一单生效" onchange="aPool('${esc(a.id)}', this.value)">
        ${pools.map((p) => `<option value="${esc(p)}" ${pool === p ? 'selected' : ''}>${esc(p)} 池</option>`).join('')}
      </select>`;
    return `<div class="teamrow card" style="border-left-color:${FNHEX[a.职能] || 'var(--line)'}">
      <b>${esc(a.id)}</b>${fnPill(a.职能)}${psel}${sel}
      <span class="stpill pill sm ${a.上线 === false ? 'mut' : 'ok'}">${a.上线 === false ? '退役待归' : '在岗'}</span></div>`;
  }).join('');
}
// 模型档切换：POST 后原地重画编制表，不重载
window.aModel = async (id, v) => {
  const r = await post('/api/agent-model', { id, 模型: v });
  if (!r.ok) return toast(r.error || '失败');
  if (window._p6cfg) window._p6cfg.agents = r.agents;
  const tl = $('team-list'); if (tl) tl.innerHTML = teamRowsHtml(r.agents);
  toast(`${id} 模型档 → ${v || '池默认'}`);
};
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

// 执行池切换：切池清模型覆盖（服务端保证），重画后模型下拉自动换成新池的可选清单
window.aPool = async (id, v) => {
  const r = await post('/api/agent-pool', { id, 池: v });
  if (!r.ok) return toast(r.error || '失败');
  if (window._p6cfg) window._p6cfg.agents = r.agents;
  const tl = $('team-list'); if (tl) tl.innerHTML = teamRowsHtml(r.agents);
  toast(`${id} → ${v} 池 · 模型回池默认（下一单生效）`);
};
async function viewParams() {
  const [c, run, models] = await Promise.all([api('/api/config'), api('/api/runner'), api('/api/models').catch(() => ({}))]);
  window._p6cfg = c;
  window._models = models;
  // 执行器：派发调度循环的仪表与开关（H49）
  const rcfg = c.执行器 || {};
  const runCards = `<div class="paramcard card" id="run-card"><h4><i class="${dotCls(run)}" id="run-dot"></i>执行器 <span id="run-state">${run.运行 ? '运行中' : '已停'}</span></h4>
      <p class="pmeta" id="run-meta">${run.试跑 ? '试跑模式：模拟执行 · 零额度' : '实弹模式'}${run.执行中 && run.执行中.length ? ` · 执行中 ${run.执行中.map((x) => x.id).join(' / ')}` : ''}</p>
      <div class="runbtn"><button class="btn h32 ${run.运行 ? '' : 'primary'}" id="run-toggle" onclick="runToggle()">${run.运行 ? '停止' : '启动'}</button></div></div>
    <div class="paramcard card"><h4>执行模式</h4><p class="pmeta">试跑=零额度走全流程；实弹须先解锁</p>
      <div class="egtoggle"><button class="egbtn ${run.试跑 ? 'on' : ''}" data-rm="试跑" onclick="runMode(true)">试跑</button><button class="egbtn ${run.试跑 ? '' : 'on'}" data-rm="实弹" onclick="runMode(false)">实弹</button></div></div>
    <div class="paramcard card"><h4>实弹解锁</h4><p class="pmeta">权力开关：解锁=授权 agent 烧额度；上锁自动退回试跑</p>
      <div class="egtoggle"><button class="egbtn ${run.实弹解锁 ? '' : 'on'}" data-lv="锁定" onclick="liveSet(false)">锁定</button><button class="egbtn ${run.实弹解锁 ? 'on' : ''}" data-lv="解锁" onclick="liveSet(true)">解锁</button></div></div>
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
      <p class="pmeta mono" style="word-break:break-all">${esc(v.兼容.base || '')}<br/>模型 ${esc(v.兼容.模型 || 'CLI 默认')} · 密钥 ${esc(v.兼容.key || '未设')} · 职能 ${(v.职能 || []).join('/') || '（评测中·单张盖章）'}</p>
      <div class="runbtn"><button class="btn h32" onclick="compatEdit('${esc(name)}')">更新密钥/模型</button></div></div>`).join('')
    + `<div class="paramcard card"><h4>＋ 新增兼容池</h4><p class="pmeta">任何 Anthropic 兼容厂商（Kimi/GLM/MiniMax…）：池名+端点+密钥即接入 · 密钥只存本机 config，界面与远程只显尾四位</p>
      <div class="runbtn"><button class="btn h32 accent" onclick="compatEdit('')">配置</button></div></div>`;
  // 模型档：池默认 + 裁判档（选项来自 /api/models 监测 + config 增补）
  const mOpt = (pool, cur) => { const list = ((models[pool] && models[pool].可选) || []);
    return `<option value="" ${!cur ? 'selected' : ''}>CLI 默认</option>` + list.map((o) => `<option value="${esc(o)}" ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')
      + (cur && !list.includes(cur) ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : ''); };
  const mc = c.模型 || {};
  const modelCards = [['claude默认', 'claude', 'claude 池体力档'], ['codex默认', 'codex', 'codex 池体力档'], ['质检', 'claude', 'QA 复核裁判档'], ['代核', 'claude', '委托代核裁判档'], ['代裁', 'claude', '待定夺代裁裁判档（D43，空=跟代核档）'], ['项管', 'claude', '项目管理切单/收口/答话档（H49，现值 fable）']]
    .map(([k, pool, note]) => `<div class="paramcard card"><h4>${k}</h4><p class="pmeta">${note}</p>
      <div class="runbtn"><select class="mselect mono" onchange="mSet('${k}', this.value)">${mOpt(pool, mc[k] || '')}</select></div></div>`).join('')
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
  
  const params = Object.entries(c.闸值 || {}).map(([k, v]) => `<div class="paramcard card" data-key="${esc(k)}"><h4>${esc(P6NAMES[k] || k)}</h4><p class="pmeta">${esc((P6META[k] || '').replace('N', v))}</p>
      <div class="stepper"><button onclick="pStep('${k}',-1)">−</button><span class="val">${v}</span><button onclick="pStep('${k}',1)">＋</button></div></div>`).join('');
  const recCards = ''; // 精力档/推荐在途（D28）已随拉取制退役（0.23.11）
  void staffCards; void capCard; void recCards; // 退役占位，仅为注释留痕
  const team = teamRowsHtml(c.agents);
  // 额度不阻塞首屏：先占位骨架，数据回来原地填（footprint 不变），随后 5s 活体轮询
  let lastPoolJson = '';
  const fillPools = async () => {
    const g = await api('/api/gates');
    const key = JSON.stringify([g.locks.codex, g.locks.claude]);
    if (key === lastPoolJson) return;
    lastPoolJson = key;
    const pc = $('pool-codex'); if (pc) pc.innerHTML = poolCardHtml('codex', g.locks.codex, c.执行池 && c.执行池.codex);
    const pl = $('pool-claude'); if (pl) pl.innerHTML = poolCardHtml('claude', g.locks.claude, c.执行池 && c.执行池.claude);
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
        const meta = $('run-meta'); if (meta) meta.textContent = (r.试跑 ? '试跑模式：模拟执行 · 零额度' : '实弹模式') + (r.执行中 && r.执行中.length ? ` · 执行中 ${r.执行中.map((x) => x.id).join(' / ')}` : '');
      } catch { /* 下轮再试 */ }
      pollRun();
    }, 5000);
  }, 0);
  // 全链路自检进页自动跑（服务端 60s 缓存，便宜）；按钮=强制复检
  setTimeout(() => { if ($('env-card')) window.envProbe(null); }, 0);
  return `<div class="p6grid"><div>
      <div class="sec-h"><h3 class="h17">执行器</h3><span class="subnote">派发调度循环 · 开 exe 即开工厂</span></div>${runCards}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">参数闸值</h3><span class="subnote">监制台可调</span></div>${params}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">模型档</h3><span class="subnote">贵裁判 · 贱体力（D38）</span></div>${modelCards}${compatCards}</div>
    <div><div class="sec-h"><h3 class="h17">环境探针</h3><span class="subnote">实弹前置检查</span></div>${envCard}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">项目注册</h3><span class="subnote">执行 agent 的目标仓库（D32）</span></div>${projCard}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">执行池阈值</h3><span class="subnote">额度锁的杆（D26）</span></div>${poolCards}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">额度双池</h3></div>
      <div class="poolcard card" id="pool-codex">${poolCardHtml('codex', null, c.执行池 && c.执行池.codex)}</div>
      <div class="poolcard card" id="pool-claude">${poolCardHtml('claude', null, c.执行池 && c.执行池.claude)}</div>
      <div class="sec-h" style="margin-top:26px"><h3 style="font-size:15px;margin:0;font-weight:700">agent 编制 · 执行池</h3></div><div id="team-list">${team}</div></div></div>`;
}
// 编制步进：POST 后原地更新该职能人数、在途上限推导值、右侧编制表——视图保持渲染，不整页重载
// sStep（编制步进）已随拉取制退役（0.23.11）

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
  const meta = $('run-meta'); if (meta) meta.textContent = (r.试跑 ? '试跑模式：模拟执行 · 零额度' : '实弹模式') + (r.执行中 && r.执行中.length ? ` · 执行中 ${r.执行中.map((x) => x.id).join(' / ')}` : '');
  toast(r.运行 ? '执行器已启动（试跑）' : '执行器已停（执行中的单跑完为止）');
};
// 执行模式切换：实弹会被服务端拒绝（通道未接入），高亮保持试跑
window.runMode = async (dry) => {
  const r = await post('/api/runner/mode', { 试跑: dry });
  if (!r.ok) return toast(r.error || '失败');
  document.querySelectorAll('.egbtn[data-rm]').forEach((b) => b.classList.toggle('on', (b.dataset.rm === '试跑') === !!r.试跑));
  toast('执行模式 → ' + (r.试跑 ? '试跑' : '实弹'));
};
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
  const tl = $('team-list'); if (tl && window._p6cfg) tl.innerHTML = teamRowsHtml(window._p6cfg.agents); // 池默认变了编制表跟着变
  toast(`${key} → ${v || 'CLI 默认'}`);
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
// 实弹解锁开关（权力开关：解锁要求二次确认）
window.liveSet = async (v) => {
  if (v && !confirm('解锁实弹 = 授权 agent 真调 CLI 烧额度。确认解锁？')) return;
  const r = await post('/api/config/live', { 解锁: v });
  if (!r.ok) return toast(r.error || '失败');
  document.querySelectorAll('.egbtn[data-lv]').forEach((b) => b.classList.toggle('on', (b.dataset.lv === '解锁') === !!r.实弹解锁));
  toast(r.实弹解锁 ? '⚠ 实弹已解锁（执行模式仍需在上方切实弹）' : '已上锁并退回试跑');
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
  if (!confirm(`删除项目注册「${name}」？（有未完成单引用时会被拒绝）`)) return;
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

// 推荐速度参数步进：POST 后只原地更新该卡片，视图保持渲染
window.rStep = async (k, delta) => {
  const card = document.querySelector(`.paramcard[data-rkey="${k}"]`); if (!card) return;
  const valEl = card.querySelector('.val');
  const next = Number(valEl.textContent) + delta;
  const r = await post('/api/config/recommend', { key: k, value: next });
  if (!r.ok) return toast(r.error || '失败');
  valEl.textContent = String(next); bump(valEl);
  const pm = card.querySelector('.pmeta'); if (pm) pm.textContent = (P6META[k] || '').replace('N', next);
  if (window._p6cfg) window._p6cfg.推荐 = r.推荐;
  toast(`${P6NAMES[k] || k} → ${next}`);
};

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
  const sec = parseSections(t ? t.body : '');
  const opts = (arr, cur) => arr.map((x) => `<option ${x === cur ? 'selected' : ''}>${x}</option>`).join('');
  return `<div class="p7grid">
    <div class="formcard card r16"><h3>工单属性</h3>
      <div class="f-field"><label>编号</label><input id="d-id" class="mono" value="${esc(fm.id || '')}" placeholder="${esc(dProj ? dProj + '-22' : 'P-22')}" ${editId ? 'readonly' : ''}/></div>
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
      <div class="p7foot"><button class="btn h44" onclick="dSave(false)">存为待投</button>
        <button class="btn accent h44" onclick="dSave(true)">投池（释放）</button></div></div></div>`;
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
  if (!r2.ok && !/待投/.test(r2.error || '')) return toast('已建草稿，但定稿失败：' + (r2.error || ''));
  if (release) { const r3 = await post('/api/act/投池', { id: payload.id }); if (!r3.ok) return toast('已入待投，投池失败：' + (r3.error || '')); toast('已投池'); }
  else toast('已存为待投');
  location.hash = '#/board';
};

/* ===== P8 详情 ===== */
async function viewDetail(id) {
  const d = await api('/api/ticket?id=' + encodeURIComponent(id));
  if (d.error) return `<p class="err" style="margin-top:30px">${esc(d.error)}</p>`;
  const fm = d.fm, c = d.链 || { 父子: { 父: null, 子: [] }, 依赖: [] };
  // ---- 在途细粒度进度（用户定稿：详情页最上层=进度条+步骤详情+秒级走表）----
  let liveHtml = '';
  if (['在途', '质检', '待验收', '待定夺'].includes(d.state)) {
    const run = await api('/api/runner').catch(() => ({}));
    const live = (run.执行中 || []).find((x) => x.id === id) || null;
    if (live || d.state === '在途' || d.state === '质检') {
      const qaOn = fm.QA !== '关';
      const judge = fm.验收方式 === '委托' ? '代核' : '你验收';
      const names = ['领单', '执行'].concat(qaOn ? ['质检'] : []).concat([judge, '落袋']);
      const doneUpto = { 在途: '领单', 质检: '执行', 待验收: qaOn ? '质检' : '执行', 待定夺: qaOn ? '质检' : '执行' }[d.state];
      const curName = live ? (live.kind === '执行' ? '执行' : live.kind === '质检' ? '质检' : judge)
        : (d.state === '在途' ? '执行' : d.state === '质检' ? '质检' : null);
      const di = names.indexOf(doneUpto);
      const segs = names.map((k, i) => [k, k === curName ? (live ? 'cur' : 'wait') : i <= di ? 'done' : 'todo']);
      liveHtml = `<div class="livecard card r16" id="lvcard">
        <div class="lv-top"><b style="font-size:13px">执行进度</b>
          <span class="pill sm ${live ? 'ok' : 'mut'}" id="lv-who">${live ? esc(live.agent) + ' · ' + esc(live.kind) : '等待执行器衔接（间隔 ' + (run.间隔秒 || 15) + 's）'}</span>
          <span class="sp"></span>
          <span class="lv-t mono" id="lv-step-t">--:--</span><span class="subnote">本步</span>
          <span class="lv-t mono" id="lv-all-t">--:--</span><span class="subnote">全程</span></div>
        <div class="lv-bar">${segs.map(([k, s]) => `<div class="lv-seg ${s}"><i></i><span>${esc(k)}</span></div>`).join('')}</div>
        <div class="lv-tail mono" id="lv-tail">${live && live.tail ? esc(live.tail) : '（尚无输出）'}</div></div>`;
      setTimeout(() => lvStart(id, live ? live.startedAt : null, fm.领单时间 || fm.更新时间 || null, live ? live.kind : null), 0);
    }
  }
  const chainRow = (k, v, cls) => `<div class="crow"><span class="ck">${k}</span><span class="cv ${cls || ''}">${v || '—'}</span></div>`;
  const kidsTxt = (c.父子.子 || []).map((x) => `<a href="#/t/${x.id}" style="color:var(--accent-ink)">${esc(x.id)}</a>(${esc(x.state)})`).join('、');
  let rsecs = '';
  if (d.回执) {
    const secs = { 验收步骤: '', 做了什么: '', 'QA 章节': '', 实际消耗: '', 异议: '' };
    const SECLN = { 验收步骤: 8, 做了什么: 4 }; // 验收步骤给足行数——制作人按此动手（用户定稿）
    d.回执.raw.split(/^## /m).forEach((p) => { const nl = p.indexOf('\n'); const h = p.slice(0, nl < 0 ? undefined : nl).trim();
      for (const k of Object.keys(secs)) if (h.startsWith(k) || (k === 'QA 章节' && /QA/.test(h))) secs[k] = (nl < 0 ? '' : p.slice(nl + 1)).trim().split('\n').slice(0, SECLN[k] || 1).join('\n'); });
    if (!secs.验收步骤) delete secs.验收步骤; // 委托单免写，不占位
    rsecs = Object.entries(secs).map(([k, v]) => `<div class="rsec"><div class="rl">${k}</div><div class="rv" style="white-space:pre-line">${esc(v || '—')}</div></div>`).join('');
  }
  const ops = [];
  if (['池', '待投'].includes(d.state)) ops.push(['撤回', '回草稿（仅在池 / 待投）', `act2('撤回','${id}')`]);
  if (d.state === '在途') ops.push(['收回', '从执行方取回在途单', `act2('收回','${id}')`]);
  if (fm.待复核) ops.push(['解除复核', `上游 ${esc(fm.待复核.锚号 || '')} 已核对新版`, `act2('解除复核','${id}')`]); // D36
  if (d.state === '执行失败') { // D31 分诊三出路（废弃在下方通用项）
    ops.push(['重投', `清执行痕迹回池重领${fm.失败原因 ? '（' + esc(String(fm.失败原因).slice(0, 24)) + '）' : ''}`, `act3('失败分诊','${id}','重投')`]);
    ops.push(['上呈', '转待定夺，由你拍板', `act3('失败分诊','${id}','上呈')`]);
  }
  if (d.state === '草稿') ops.push(['定稿', '草稿 → 待投', `act2('定稿','${id}')`]);
  if (d.state === '待投') ops.push(['投池', '释放进池（人闸）', `act2('投池','${id}')`]);
  if (!['完成', '已归档'].includes(d.state)) ops.push(['废弃', '归档（非终态皆可）', `if(confirm('废弃并归档？'))act2('废弃','${id}')`]);
  if (d.state === '草稿') ops.push(['编辑', '打开起草页修改', `location.hash='#/draft?edit=${id}'`]);
  if (d.state === '完成') { // 审批点④：入库（D12 精选制，唯一写者=制作人层）
    if (fm.职能 === '策划') ops.push(['入标杆', '提炼进设计公理（审批点④）', `axModal('${id}')`]);
    if (fm.职能 === '美术' || fm.职能 === '装配') ops.push(['入美术库', '产出精选进风格库（审批点④）', `artModal('${id}')`]);
  }
  if (['完成', '已归档'].includes(d.state)) ops.push(['推翻重做', '翻案：归档旧单+自动开返工草稿（须写理由）', `overturnModal('${id}')`]);
  if (d.state === '已归档') ops.push([fm.隐藏 ? '取消隐藏' : '隐藏归档', fm.隐藏 ? '重新出现在归档列表' : '从一切默认视图湮灭（纸面仍可考）', `toggleHide('${id}',${fm.隐藏 ? 'false' : 'true'})`]);
  return `${liveHtml}<div class="p8grid"><div>
      <div class="p8main card r16"><h2>${esc(id)} · ${esc(fm.title)}</h2>
        <div class="chipsrow">${fnPill(fm.职能)}<span class="pill mut">${esc(fm.产出物类型 || '')}</span>
          <span class="pill ${fm.验收方式 === '委托' ? 'mut' : 'ok'}">${esc(fm.验收方式 || '保留')}</span><span class="pill mut">${esc(fm.规模 || '')}</span>
          ${fm.待复核 ? `<span class="pill red" title="${esc(fm.待复核.说明 || '')}">待复核 · ${esc(fm.待复核.锚号 || '')}</span>` : ''}
          ${fm.代核 ? `<span class="pill ${fm.代核.结论 === '通过' ? 'ok' : 'red'}">代核${esc(fm.代核.结论)}</span>` : ''}</div>
        <div class="chain"><div class="clbl">追溯链</div>
          ${chainRow('父单', c.父子.父 ? `<a href="#/t/${c.父子.父}" style="color:var(--accent-ink)">${esc(c.父子.父)}</a>` : null)}
          ${chainRow('子单', kidsTxt)}
          ${chainRow('返工自', c.返工自 ? esc(c.返工自) : null)}
          ${chainRow('依据', c.依据 ? `<span style="color:var(--accent-ink)">${esc(c.依据)}</span>` : null)}
          ${chainRow('依赖', (c.依赖 || []).map((x) => `${esc(x.id)}(${esc(x.state)})`).join('、'), 'okc')}</div></div>
      ${d.产出 && d.产出.产出.length ? `<div class="p8main card r16"><b style="font-size:13px">产出速览</b>
        <span class="subnote" style="margin-left:8px">${d.产出.来源 === '结构化' ? '回执产出章节' : '从回执正文解析'} · 点击调起本机查看</span>
        ${d.产出.产出.map((a) => `<div class="prow" style="margin-top:8px">
          <span class="pv mono" style="flex:1" title="${esc(a.路径)}">${esc(a.路径)}</span>
          ${a.存在 ? `<span class="pill sm ok">${a.大小 > 1048576 ? (a.大小 / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(a.大小 / 1024)) + ' KB'}</span>
            <button class="btn h32" style="height:26px;padding:0 12px;font-size:11px" onclick="openArt('${esc(id)}','${esc(a.路径)}','文件')">打开</button>
            <button class="btn h32" style="height:26px;padding:0 10px;font-size:11px" onclick="openArt('${esc(id)}','${esc(a.路径)}','文件夹')">文件夹</button>`
    : '<span class="pill sm red" title="回执声称的产出在项目仓找不到">缺失</span>'}</div>`).join('')}</div>` : ''}
      <div class="p8main card r16"><b style="font-size:13px">正文</b><div class="doc2">${d.html || '<p class="dim">无正文</p>'}</div></div>
    </div><div>
      <div class="rside card r16"><h3>回执 · 完工报告</h3>${rsecs || '<p class="dim" style="margin-top:10px">尚无回执（完工后生成）</p>'}</div>
      <div class="rside card r16"><h3>操作</h3>
        ${ops.map(([b, s, fn]) => `<button class="oprow2" onclick="${fn}"><b>${b}</b><span>${s}</span></button>`).join('')}
        <div class="subnote" style="margin-top:14px">预计 ${esc(fm.预计时间 || '—')} · ${esc(fm.预计token || '—')} · 状态 ${esc(d.state)}</div></div></div></div>`;
}
window.act2 = async (name, id) => { const r = await post('/api/act/' + name, { id }); toast(r.ok ? '完成' : (r.error || '失败')); route(); };
window.overturnModal = (id) => showModal(`<h3>推翻重做 ${esc(id)}</h3>
  <p class="subnote" style="margin-top:6px">归档旧单 + 自动编号开返工草稿（带返工链），下游依赖自动接续。理由必填，进新单正文与流水。</p>
  <textarea id="ov-r" style="width:100%;height:90px;margin-top:12px" placeholder="为什么翻案：哪里完全不行、新的要求方向是什么"></textarea>
  <div class="p7foot" style="margin-top:14px"><button class="btn h32" onclick="this.closest('.mwrap').remove()">取消</button>
  <button class="btn accent h32" onclick="doOverturn('${esc(id)}',this)">推翻并开草稿</button></div>`);
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
  clearInterval(window._lv || 0);
  let n = 0, had = !!stepIso, step = stepIso;
  const fmt = (ms) => { if (ms == null || ms < 0) return '--:--'; const s = Math.floor(ms / 1000);
    return (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  window._lv = setInterval(async () => {
    const el = $('lv-step-t');
    if (!el) { clearInterval(window._lv); return; } // 已离开详情页
    el.textContent = step ? fmt(Date.now() - Date.parse(step)) : '--:--';
    const at = $('lv-all-t'); if (at && allIso) at.textContent = fmt(Date.now() - Date.parse(allIso));
    if (++n % 3 !== 0) return;
    try {
      const run = await api('/api/runner');
      const e = (run.执行中 || []).find((x) => x.id === id);
      if (e) { had = true; step = e.startedAt;
        if (e.kind !== kind) { route(); return; } // 换步骤 → 重渲进度条
        const tl = $('lv-tail'); if (tl && e.tail) tl.textContent = e.tail;
        const who = $('lv-who'); if (who) { who.textContent = e.agent + ' · ' + e.kind; who.className = 'pill sm ok'; }
      } else if (had) { route(); return; } // 本步收线（流转/落袋）→ 重渲拿新状态
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
window.axModal = (id) => {
  const w = showModal(`<h3>入标杆 · 来源 <span class="mono">${esc(id)}</span><span class="x" onclick="this.closest('.mwrap').remove()">×</span></h3>
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
};
window.artModal = (id) => {
  const w = showModal(`<h3>入美术库 · 来源 <span class="mono">${esc(id)}</span><span class="x" onclick="this.closest('.mwrap').remove()">×</span></h3>
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
};
window.act3 = async (name, id, 决定) => { const r = await post('/api/act/' + name, { id, 决定 }); toast(r.ok ? `${决定} 完成` : (r.error || '失败')); route(); };

/* ===== 路由 ===== */
/* ===== P16 Wiki（0.20，H52 第三类实体）：设计事实源——分类树 + 词条双链 + 信息栏 + 待审人闸 + 关系图 ===== */
const wkState = { entry: '', mode: 'read', q: '', cat: '' };
// 极简 markdown 渲染（词条正文专用）：标题/加粗/行内码/列表/段落/[[双链]]。不引库，XSS 经 esc 全量转义。
function wkMd(src, byName) {
  const link = (s) => s.replace(/\[\[([^\]|#]+?)(?:\|([^\]]*))?\]\]/g, (m, name, alias) => {
    const n = esc(name.trim());
    const exists = byName && byName[name.trim()];
    return `<a class="wk-l ${exists ? '' : 'ghost'}" onclick="wkOpen('${n}')" title="${exists ? '' : '条目未建——点击可从此名开稿'}">${esc(alias || name.trim())}</a>`;
  });
  const inline = (s) => link(esc(s)).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const out = []; let list = null, para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = null; } };
  for (const raw of String(src).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushP(); flushL(); out.push(`<h${h[1].length + 2} class="wk-h">${inline(h[2])}</h${h[1].length + 2}>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { flushP(); (list = list || []).push(li[1]); continue; }
    if (line.match(/^\s*\|.*\|\s*$/)) { flushP(); flushL(); out.push(`<p class="mono" style="font-size:12px">${inline(line)}</p>`); continue; }
    if (!line.trim()) { flushP(); flushL(); continue; }
    flushL(); para.push(line);
  }
  flushP(); flushL();
  return out.join('\n');
}
async function viewWiki() {
  const proj = curProj() || projDefault();
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
      article = `<p class="dim" style="font-size:12px;margin:0">${esc(e.分类)} › 词条</p>
        <h2 style="margin:2px 0 14px">${esc(e.名称)}</h2>
        <div class="wk-body">${wkMd(e.body, byName)}</div>
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
window.wkOpen = (name) => { wkState.entry = name; wkState.mode = 'read'; route(); };
window.wkApprove = async (f) => { const r = await post('/api/wiki/approve', { 文件: f, 项目: curProj() || projDefault() }); toast(r.ok ? `已入册「${r.名称}」` : (r.error || '失败')); route(); };
window.wkReject = async (f) => { if (!confirm('退回将删除该待审稿（agent 提案不入史）。确认？')) return; const r = await post('/api/wiki/reject', { 文件: f, 项目: curProj() || projDefault() }); toast(r.ok ? '已退回' : (r.error || '失败')); route(); };
// 力导向关系图：手写迭代（斥力+弹簧+向心），无外部库；拖拽节点、点击进词条。
async function wkGraph(proj) {
  const cv = $('wk-g'); if (!cv) return;
  const g = await api('/api/wiki/graph?项目=' + encodeURIComponent(proj)).catch(() => null); if (!g) return;
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

const ROUTES = { '': viewOverview, ideas: viewIdeas, board: viewBoard, flow: viewFlow, tree: viewTree, agents: viewAgents, decisions: viewDecisions, wiki: viewWiki, relay: viewRelay, stylelib: viewStyleLib, report: viewReport };

/* ===== P14 想法池（H49 双域·制作人层域）===== */
async function viewIdeas() {
  const d = await api('/api/ideas').catch(() => ({ 想法: [] }));
  const cards = (d.想法 || []).map((x) => `<div class="idea card r14">
      <div class="it">${esc(x.文本)}</div>
      ${x.备注 ? `<div class="in2">${esc(x.备注)}</div>` : ''}
      <div class="ia"><span class="subnote">${esc(String(x.t).slice(5, 10))}</span><span class="sp"></span>
        <button class="btn h32" onclick="ideaAct('放弃','${esc(x.id)}')">放弃</button>
        <button class="btn accent h32" onclick="ideaAct('拍板','${esc(x.id)}')">拍板 → 父单</button></div></div>`).join('')
    || '<p class="dim" style="text-align:center;margin-top:40px">想法池空。灵感随手扔进来——没有验收标准、没有排期压力，拍板那一刻才进项目组域。</p>';
  return `<div class="rl-wrap" style="height:auto">
    <div class="rl-head"><b style="font-size:15px">想法池 · 制作人层域</b>
      <span class="subnote">随聊随记（手机也行）→ 拍板成父单（补边界+验收标准）→ 项管切单派发。拍板是唯一人闸。</span></div>
    <div class="rl-input" style="margin:0 0 18px"><textarea id="idea-t" placeholder="一句话想法…（Ctrl+Enter 入池）" onkeydown="if(event.ctrlKey&&event.key==='Enter')ideaAdd()"></textarea>
      <button class="btn accent h44" onclick="ideaAdd()">入池</button></div>
    <div class="ideagrid">${cards}</div></div>`;
}
window.ideaAdd = async () => {
  const t = $('idea-t').value.trim(); if (!t) return;
  const r = await post('/api/ideas', { 文本: t });
  if (!r.ok) return toast(r.error || '失败');
  $('idea-t').value = ''; route();
};
window.ideaAct = async (动作, id) => {
  if (动作 === '放弃' && !confirm('放弃这个想法？')) return;
  const r = await post('/api/ideas', { 动作, id });
  if (!r.ok) return toast(r.error || '失败');
  if (动作 === '拍板') { toast(`父单 ${r.父单} 已建——去补齐边界与验收标准`); location.hash = '#/draft?edit=' + encodeURIComponent(r.父单); return; }
  route();
};

/* ===== P13 项管信道（0.18.6，前身遥控传令板）：制作人 ↔ 项管问答 + 汇报流 ===== */
function pmEventLine(e) {
  // e.t 是 UTC ISO 串，必须转本地时区再显示（用户实测：00:16 曾显示成 16:16）
  const d0 = new Date(e.t); const p2 = (n) => String(n).padStart(2, '0');
  const t = isNaN(d0) ? String(e.t || '').slice(5, 16).replace('T', ' ')
    : `${p2(d0.getMonth() + 1)}-${p2(d0.getDate())} ${p2(d0.getHours())}:${p2(d0.getMinutes())}`;
  if (e.类型 === '待审') return { t, txt: `拆单完成：${e.父单} → ${(e.子单 || []).join('、')}，简报呈 Claude 审批`, hot: true };
  if (e.类型 === '切单启动') return { t, txt: `开始拆单：${e.父单}（仓况盘点中）`, hot: true };
  if (e.类型 === '派发') return { t, txt: `派发 ${e.id} → ${e.池} 池` };
  if (e.类型 === '收口') return { t, txt: `专项收口：${e.父单}，收口报告已出`, hot: true };
  if (e.类型 === '上呈') return { t, txt: `上呈制作人：${e.原因 || e.父单 || ''}`, hot: true };
  if (e.类型 === '额度报警') return { t, txt: `额度报警：${e.详情 || ''}`, hot: true };
  return { t, txt: `${e.类型}：${e.id || e.父单 || ''}` };
}
async function viewRelay() {
  // 0.23.9 信息架构定案（用户裁定）：只留三项——状态 / 关键汇报 / 详细流水。
  // 台账与对话区退出 UI（机制层 API 保留：制作人层通道走 /api/relay，台账走 /api/pm/ledger）。
  const [d, pl] = await Promise.all([
    api('/api/relay').catch(() => ({ 消息: [] })),
    api('/api/pm/ledger').catch(() => ({ 事件: [], 台账: {} })),
  ]);
  const 模型档 = (_cfg && _cfg.模型 && _cfg.模型.项管) || '—';
  const L = pl.台账 || {};
  const KEY = new Set(['切单启动', '待审', '收口报告', '收口', '上呈', '额度报警', '切单失败', '派单委托', '定稿放行']);
  const evAll = pl.事件 || [];
  const line = (e) => { const v = pmEventLine(e);
    return `<div class="logrow"><time>${esc(v.t)}</time><span${v.hot ? ' style="color:var(--accent-ink);font-weight:600"' : ''}>${esc(v.txt)}</span></div>`; };
  const feedKey = evAll.filter((e) => KEY.has(e.类型)).slice(-12).reverse().map(line).join('')
    || '<p class="dim">暂无关键事件。</p>';
  const feedFlow = evAll.filter((e) => !KEY.has(e.类型)).slice(-50).reverse().map(line).join('')
    || '<p class="dim">暂无流水。</p>';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cnt = {};
  for (const e of evAll.filter((x) => new Date(x.t) >= today)) cnt[e.类型] = (cnt[e.类型] || 0) + 1;
  const digest = Object.entries(cnt).map(([k, v]) => k + ' ' + v).join(' · ') || '今日无动作';
  const working = d.作业;
  const on = !!d.值守;
  const stateColor = working ? 'var(--warn)' : (on ? 'var(--ok)' : 'var(--ink3)');
  const stateText = working ? `作业中 · ${esc(working.用途)}${working.对象 ? ' ' + esc(working.对象) : ''}` : (on ? '在线值守' : '离线（执行器停）');
  return `<div style="max-width:860px;margin:24px auto 0">
    <div class="card r16" style="padding:18px 22px;display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <span style="width:12px;height:12px;border-radius:50%;background:${stateColor};${on && !working ? 'animation:breathe 2.4s var(--ease-out) infinite;' : ''}${working ? 'animation:breathe-warn 1.6s var(--ease-out) infinite;' : ''}"></span>
      <div style="flex:1"><b style="font-size:16px">${stateText}</b>
        <p class="dim" style="margin:4px 0 0;font-size:12.5px">项管 ${esc(模型档)} · 在跑 ${Object.keys(L.在跑 || {}).length} 项 · 就绪 ${(L.就绪队列 || []).length} 单 · 今日：${esc(digest)}</p></div>
    </div>
    <div class="logcard card r14" style="margin-bottom:16px"><b style="font-size:13px">关键汇报</b>
      <span class="subnote" style="margin-left:8px">拆单 / 待审 / 收口 / 上呈 / 报警</span>
      <div style="margin-top:12px">${feedKey}</div></div>
    <div class="logcard card r14"><b style="font-size:13px">详细流水</b>
      <span class="subnote" style="margin-left:8px">近 50 条 · 它都做了什么</span>
      <div style="margin-top:12px;max-height:46vh;overflow-y:auto">${feedFlow}</div></div>
  </div>`;
}
const markIn = (key) => { if (window._lastViewKey !== key) { const v = $('view') || $('app').firstElementChild; if (v) v.classList.add('vin'); } window._lastViewKey = key; };
async function route() {
  const h = location.hash.replace(/^#\//, '');
  const app = $('app');
  let m;
  try {
    await loadCfg();
    // D42 项目语境守卫：多项目时，被删项目的残留选择作废；未选项目 → 落启动页；单项目自动进语境
    if (projMulti() && curProj() && !projNames().includes(curProj())) setProj('');
    if (!projMulti()) setProj(projNames()[0] || '');
    if (h === 'hub') { app.innerHTML = await viewHub(); markIn('hub'); return; }
    if (h === 'params') { app.innerHTML = bshell('参数与额度', '<span class="pill sm mut">全局配置</span>', await viewParams(), '#/hub'); markIn('params'); return; }
    if (h === 'proj-new') { app.innerHTML = bshell('注册新项目', '<span class="pill sm mut">全局 · 项目注册</span>', viewProjNew(), '#/hub'); markIn('proj-new'); return; }
    if ((m = h.match(/^t\/(.+)$/))) {
      const id = decodeURIComponent(m[1]);
      const d = await api('/api/ticket?id=' + encodeURIComponent(id)).catch(() => ({}));
      app.innerHTML = bshell(`${id} · ${d.fm ? d.fm.title : ''}`, d.state ? stPill(d.state) : '', await viewDetail(id));
      if (window._lastViewKey !== h) { const v = $('view'); if (v) v.classList.add('vin'); }
      window._lastViewKey = h;
      return;
    }
    if (h.startsWith('draft')) {
      const q = new URLSearchParams(h.split('?')[1] || '');
      app.innerHTML = bshell('起草 · 编辑工单', '<span class="pill ok sm">Claude 已预填草稿 · 你可手改</span>', await viewDraft(q.get('edit'), q.get('parent')));
      if (window._lastViewKey !== h) { const v = $('view'); if (v) v.classList.add('vin'); }
      window._lastViewKey = h;
      return;
    }
    // 多项目且尚未选定项目：驾驶舱视图一律先落启动页（详情/起草按编号直达不拦）
    if (projMulti() && !curProj()) { location.hash = '#/hub'; return; }
    const key = ROUTES[h] ? h : '';
    // 不显示"加载中"：数据在后台取，旧版面保持到新版面整体就绪才一次换入（版面不因加载变动）
    const inner = await ROUTES[key]();
    // FLIP 捕捉：同在工单池时记住每张卡的旧位置，重渲染后滑到新位置（看得见"单子挪列"）
    const flipOld = {};
    if (key === 'board' && window._lastViewKey === 'board' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.bcard2[data-tid]').forEach((el) => { flipOld[el.dataset.tid] = el.getBoundingClientRect(); });
    }
    app.innerHTML = shell(key, inner);
    if (key === 'flow') flAutoFold(); // 默认折叠历史（偏好跨会话）
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
// 3s 变更令牌轮询：数据动了才刷新；起草页/弹窗打开时不打扰
let lastPulse = null;
setInterval(async () => {
  if (location.hash.startsWith('#/draft') || location.hash.startsWith('#/proj-new')) return;
  if (document.querySelector('.modal2')) return;
  try { const d = await api('/api/pulse'); if (lastPulse && d.token !== lastPulse) route(); lastPulse = d.token; } catch { /* offline */ }
}, 3000);

/* 兼容池编辑（0.22.1）：轻量三问式，密钥留空=保留旧值；仅本机端点会拒远程 */
window.compatEdit = async (name) => {
  const 池名 = name || (prompt('池名（小写英文标识，如 kimi / glm / minimax）：') || '').trim();
  if (!池名) return;
  const base = (prompt('Anthropic 兼容端点 base URL：', name ? '' : 'https://') || '').trim();
  const key = (prompt('API 密钥（更新时留空=保留旧值）：') || '').trim();
  const 模型 = (prompt('模型名（厂商侧模型 ID，留空=CLI 默认）：') || '').trim();
  const body = { 池名 };
  if (base && base !== 'https://') body.base = base;
  if (key) body.key = key;
  if (模型) body.模型 = 模型;
  const r = await post('/api/config/compat-pool', body);
  toast(r.ok ? `兼容池 ${池名} 已保存` : (r.error || '失败'));
  if (r.ok) { _cfg = null; route(); }
};
