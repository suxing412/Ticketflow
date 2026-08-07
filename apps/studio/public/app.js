// app.js — 监制台前端：一比一复刻 Figma 定稿（P1–P10 + P9b）
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// 内联 onclick 里的 JS 字符串字面量转义（esc 不管单引号；文档路径来自项目仓，撇号是可能的）
const qesc = (s) => esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const api = async (p, opt) => (await fetch(p, opt)).json();
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const FN = { 策划: 'var(--fn-plan)', 程序: 'var(--fn-code)', 美术: 'var(--fn-art)', QA: 'var(--fn-qa)', 装配: 'var(--fn-asm)' };
// 职能色走 CSS 变量：主题切换（暖纸/玻璃）时内联色自动跟随令牌，不写死 hex
const FNHEX = { 策划: 'var(--fn-plan)', 程序: 'var(--fn-code)', 美术: 'var(--fn-art)', QA: 'var(--fn-qa)', 装配: 'var(--fn-asm)' };
const FNCLS = { 策划: 'fn-plan', 程序: 'fn-code', 美术: 'fn-art', QA: 'fn-qa', 装配: 'fn-asm' };
const STCLS = { 在途: 'st-doing', 质检: 'st-review', 待验收: 'st-accept', 完成: 'st-done', 待定夺: 'st-escal', 执行失败: 'st-escal', 草稿: 'mut', 已归档: 'mut', 待投: '', 池: '' };
const STPCT = { 草稿: 0, 待投: 0, 池: 0, 在途: 60, 质检: 85, 待定夺: 70, 执行失败: 60, 待验收: 90, 完成: 100, 已归档: 0 };
// 施工令-015：wiki 升格唯一知识入口（四分区），风格库导航退役——美术标杆并入 Wiki 页签
const NAV = [['总览', ''], ['想法', 'ideas'], ['工单', 'board'], ['流程', 'flow'], ['树形', 'tree'], ['在途', 'agents'], ['决策台', 'decisions'], ['Wiki', 'wiki'], ['项管', 'relay'], ['报表', 'report']]; // 参数入口只走 ⚙
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
        <h1>监制台${p ? ` · ${esc(p)}` : ''}</h1><p class="tagline">工单 · 审检 · 决策台——制作人的驾驶舱：你拍板与放行，系统派发执行（H49）</p></div></div>
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
    // H-2 零值灰显 / H-3 键盘可达（2026-08-06 UI 评审 hub 页）
    return `<div class="hubcard card r16" onclick="enterProj('${esc(n)}')" tabindex="0" role="button" aria-label="进入项目 ${esc(n)}"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();enterProj('${esc(n)}')}">
      <div class="hn"><b>${esc(n)}</b>${n === def ? '<span class="pill sm mut">默认</span>' : ''}
        ${eng ? `<span class="pill sm mut" title="引擎档案（探针按此自检）">${esc(eng.类型)}${eng.版本 ? ' ' + esc(eng.版本) : ''}</span>` : ''}
        ${need ? `<span class="pill sm red">需处理 ${need}</span>` : '<span class="pill sm ok">安好</span>'}</div>
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
    paintGate(g.paused); // H81 单闸：胶囊 + 停/开按钮 + 合闸时的常驻醒目提示
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
  // 工程队状态卡（施工令-002）：只读外部状态文件，无文件/坏文件 → 整卡不渲染（占位 div 保持空）
  setTimeout(async () => { try {
    const c = (await api('/api/crew')).卡; const el = $('hub-crew');
    if (!el || !c) return;
    const cls = c.状态 === '完工' ? 'ok' : c.状态 === '待验收' ? 'red' : 'mut';
    const 更新 = c.更新时间 ? new Date(c.更新时间) : null;
    const 时 = 更新 && !isNaN(更新) ? 更新.toLocaleString('zh-CN', { hour12: false }).slice(5) : esc(c.更新时间 || '');
    el.innerHTML = `<div class="crewcard card r14">
      <b style="font-size:13px">工程队</b><span class="pill sm ${cls}">${esc(c.状态 || '—')}</span>
      <span class="cwo mono">施工令 ${esc(c.施工令 || '—')}</span>
      <span class="cwn clamp2" title="${esc(c.名称 || '')}">${esc(c.名称 || '')}</span>
      <span class="spacer"></span><span class="subnote">${esc(时)} 更新 · 只读</span></div>`;
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
      <div class="spacer"></div><span class="subnote">需你处理的项目卡会亮红胶囊 · 编辑器锁在决策台</span></div>
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
  const [{ all, board }, jn, ag] = await Promise.all([loadBoard(), api('/api/journal').catch(() => ({})), api('/api/agents').catch(() => ({}))]);
  const n = (s) => (board[s] || []).length;
  const groups = [['在途', n('在途') + n('质检'), ''], ['待验收', n('待验收'), ''], ['待定夺', n('待定夺'), n('待定夺') ? 'err' : ''], ['在池', n('池'), ''], ['待投', n('待投'), '']];
  const strip = groups.map(([l, v, c], i) => `${i ? '<div class="vdiv"></div>' : ''}<div class="grp"><span class="lbl">${l}</span><span class="num ${c}">${v}</span></div>`).join('');
  const inbox = [
    ...(board['待验收'] || []).map((t) => ({ ...t, k: '待验收', note: t.验收方式 === '保留' ? '保留 · 待品味终审' : '委托 · 核查可代签' })),
    ...(board['待定夺'] || []).map((t) => ({ ...t, k: '待定夺', note: 'QA 未过，四件套已备' })),
  ];
  const inboxHtml = inbox.map((r) => `<div class="inbox-row card" onclick="location.hash='#/t/${r.id}'" tabindex="0" role="button"
      onkeydown="if(event.key==='Enter'){location.hash='#/t/${r.id}'}">
      <span class="rid">${esc(r.id)}</span><span class="rt clamp2" title="${esc(r.title)}">${esc(r.title)}</span><span class="rnote">${esc(r.note)}</span>
      ${stPill(r.k)}</div>`).join('')
    || `<p class="dim">收件箱空——没有需要你决定的${n('待投') ? `；<a href="#/board" style="color:var(--accent-ink)">待投区还有 ${n('待投')} 张可放行 →</a>` : ''}</p>`;
  // 池首投放建议已随拉取制退役（0.24.7 视图清仓）
  const lines = (jn.lines || []).slice(-5).reverse();
  const logHtml = lines.map((l) => { const m = String(l).match(/^\[([\d-]+ )?([\d:]{5})[^\]]*\]\s*(.*)$/); const tm = m ? m[2] : ''; const tx = m ? m[3] : String(l);
    const cls = /锁|超|告警|打回/.test(tx) ? 'err' : /通过|完成|验收/.test(tx) ? 'okc' : ''; return `<div class="logrow"><time>${esc(tm)}</time><span class="${cls}" title="${esc(tx)}">${esc(tx.slice(0, 56))}</span></div>`; }).join('') || '<p class="dim">无动态</p>';
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
      <div class="sec-h" style="margin-top:28px"><span class="subnote" style="font-weight:500">派发窗（H49）</span></div>
      ${ovRunHtml(ag)}
      <div class="suggest card">${n('待投') ? `<div style="font-size:13px">待投区 <b>${n('待投')}</b> 单——依赖就绪且已放行的会被自动派发</div>
        <div class="subnote" style="margin:6px 0 12px">未放行的在工单池逐张放行；合闸时全部原地待命</div>
        <a class="btn accent h32" href="#/board">去工单池</a>` : '<span class="dim">待投区空——想法拍板或派单委托产生新单</span>'}</div>
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
    <div class="backlog" style="margin-left:24px"><span class="glbl">待验收积压</span><br/><b id="backlogN">— / —</b></div></div>`; // 推荐在途已随拉取制退役（0.24.7 视图清仓）
}
// H81 常开单闸制：唯一总闸，一个停/开按钮
window.togglePause = async (v) => { await post('/api/gate/pause', { value: v }); gateCache = null; route(); };
// hub 闸位：状态胶囊 + 停/开按钮；合闸时顶部挂常驻红条（醒目，不埋角落）
function paintGate(paused) {
  const el = $('hub-gate');
  if (el) el.innerHTML = `<span class="pill sm ${paused ? 'red' : 'ok'}" style="font-weight:700">${paused ? '已合闸' : '开闸中'}</span>`
    + `<button class="btn h32" style="height:26px;margin-left:8px" onclick="togglePause(${!paused})">${paused ? '开' : '停'}</button>`;
  const b = $('gate-banner');
  if (b) b.innerHTML = paused ? `<div class="gatealert" role="alert"><i class="dot err breathe-err"></i>
      <b>全链路已合闸 · 放行单一律不派发</b>
      <span class="subnote">跑是常态、停是例外（H81）——不是有意停工就立刻开闸</span>
      <button class="btn h32 primary" style="margin-left:auto" onclick="togglePause(false)">开闸</button></div>` : '';
}
// D43 批量投池：当前项目语境的待投整批释放（人闸=这一次确认）
window.releaseAll = async () => {
  const { board } = await loadBoard();
  const items = board['待投'] || [];
  if (!items.length) return toast('待投区空');
  if (!await ask(`整批放行 ${items.length} 张待投单？放行后按依赖+优先级自动派发。`)) return;
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
        ? `<h4>${s}<button class="newdraft" title="整批放行（H49 派发制：放行后依赖就绪即自动派发；人闸就是这一下）" onclick="releaseAll()">⇧ 全放行 ${items.length}</button></h4>`
        : s === '已归档' && (window._hiddenCnt || window._showHidden)
          ? `<h4>${s}<span class="cnt">${items.length}</span><button class="newdraft" title="隐藏归档：制作人湮灭的废案，默认不渲染" onclick="window._showHidden=!window._showHidden;route()">${window._showHidden ? '藏起' : `显隐藏 ${window._hiddenCnt}`}</button></h4>`
          : `<h4>${s}<span class="cnt">${items.length}</span></h4>`;
    const cards = items.map((t) => `<div class="bcard2" data-tid="${esc(t.id)}" onclick="location.hash='#/t/${t.id}'">
        <span class="cid">${esc(t.id)}</span>
        <span class="cpri ${t.优先级 === 'P0' ? 'p0' : ''}">${esc(t.优先级 || '')}</span>
        <div class="ct clamp2" title="${esc(t.title)}">${esc(t.title)}</div>${fnPill(t.职能)}</div>`).join('');
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
  // 签字位常驻（施工令-006）：折叠判据 = 组内**全部**为 完成/已归档，且要连容器单一起数。
  // 旧判据只数叶子节点，而专项/阶段父单不出节点——「子单全完成、专项父单还挂在待验收」
  // 的组于是被整道折进历史，制作人的签字队列凭空消失（2026-08-06 实拍病灶）。
  const SIGN = new Set(['待验收', '待定夺']); // 等制作人落笔的两态
  // 容器单归到它当家的那条道：根专项归自己那道，中间层父单归其根专项那道（与叶子的 laneKey 同构）
  const laneKeyOfBox = (t) => { const pid = pipeOf(t); const spec = rootOf(t); return pid ? `${pid}::${spec.id}` : `::${spec.id}`; };
  const laneBoxes = {};
  for (const t of all) if (hasKids.has(t.id)) { const k = laneKeyOfBox(t); (laneBoxes[k] = laneBoxes[k] || []).push(t); }
  const laneDone = {};
  for (const n of nsAll) { (laneDone[n.lane] = laneDone[n.lane] || []).push(DONE.has(n.t.state)); }
  const laneSign = {}; // 泳道 → 等签字的单（叶子 + 容器一起收）
  const pushSign = (k, t) => { if (SIGN.has(t.state)) (laneSign[k] = laneSign[k] || []).push(t); };
  for (const n of nsAll) pushSign(n.lane, n.t);
  for (const k in laneBoxes) for (const t of laneBoxes[k]) pushSign(k, t);
  const laneAllDone = (k) => (laneDone[k] || []).every(Boolean) && (laneBoxes[k] || []).every((t) => DONE.has(t.state));
  const foldedLanes = new Set(Object.keys(laneDone).filter(laneAllDone));
  const foldedByPipe = {};
  if (foldHist) for (const k of foldedLanes) { const pid = k.split('::')[0]; foldedByPipe[pid] = (foldedByPipe[pid] || 0) + 1; }
  const ns = foldHist ? nsAll.filter((n) => !foldedLanes.has(n.lane)) : nsAll;
  if (!ns.length) {
    const fN = foldHist ? foldedLanes.size : 0;
    // 死胡同修复：文案让点「显示历史」，按钮本体就得在卡里——空态时主工具条整条不渲染，
    // 光有文案没有钮 = 指路指到墙上（2026-08-06 实拍病灶）。
    return `<div class="emptycard" style="margin-top:30px"><h5>流程空${fN ? `（${fN} 组已完成的历史被折叠）` : ''}</h5>
      <p>起草工单（选阶段、填依赖/父单）后，这里按 管线×专项 铺出项目流动。${fN ? '待验收/待定夺的组不会被折——签字位常驻。' : ''}</p>
      ${fN ? `<div class="emptyact"><button class="btn h32 on" id="fl-fold-btn" onclick="flFold(this)">显示历史（${fN} 组）</button></div>` : ''}</div>`;
  }
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
    // 签字标记：叶子 + 容器单一起数（专项父单挂待验收也算这道在等你落笔）
    const signs = laneSign[ln] || [];
    const signTip = signs.map((t) => `${t.id} ${t.state}${t.验收方式 === '保留' ? '（保留 · 只你能签）' : ''}`).join('\n');
    const allDone = laneAllDone(ln);
    return `<div class="fl-lane" style="top:${L.top}px"></div>
      <div class="fl-lab" style="top:${L.top}px">${esc(title)}${allDone ? '<span class="lst" style="opacity:.6">已完成</span>' : `<span class="lst ${lag ? 'lag' : lead ? 'lead' : ''}">${esc(ls)}${lag ? ' 滞后' : lead ? ' 超前' : ''}</span>`}${signs.length ? `<span class="lst sign" title="${esc(signTip)}">✍ 等制作人签字${signs.length > 1 ? ' ×' + signs.length : ''}</span>` : ''}</div>`;
  }).join('');
  const nodeHtml = ns.map((n) => `<div class="fl-node ${flCls(n)}${crit.has(n.id) ? ' crit' : ''}" id="fl-${esc(n.id)}"
      style="left:${n.x}px;top:${n.y}px;--fn:${FNHEX[n.t.职能] || 'var(--ink3)'}" data-nid="${esc(n.id)}"
      onclick="location.hash='#/t/${encodeURIComponent(n.id)}'" onmouseenter="flChain('${esc(n.id)}')" onmouseleave="flChain(null)">
      <span class="nid">${esc(n.id)}</span><span class="nst">${n.cyc ? '⚠环' : esc(n.t.state)}</span>
      <div class="nt">${esc(n.t.title)}</div><span class="nh">${n.h}h</span></div>`).join('');
  window._flData = { ns: ns.map((n) => ({ id: n.id, deps: n.deps })), done: ns.filter((n) => DONE.has(n.t.state)).map((n) => n.id) };
  // 现在/接下来摘要条（2026-08-06 制作人用例：「主要看现在在做什么、后面还有什么」——答案端上面，不用进图里找）
  // 节点是包装对象（真单在 .t）——2026-08-06 02:49 制作人实拍抓包：曾拿包装层查 state 双误报「无」
  const doing = nsAll.filter((n) => ['在途', '质检'].includes(n.t.state));
  const ready2 = nsAll.filter((n) => n.t.state === '待投' && n.deps.every((d) => DONE.has((byId[d] || {}).state)));
  const blocked2 = nsAll.filter((n) => n.t.state === '待投' && !n.deps.every((d) => DONE.has((byId[d] || {}).state)));
  const chipRow = (arr, cap) => arr.slice(0, 6).map((n) => `<a class="pill sm mono" href="#/t/${esc(n.id)}" title="${esc(n.t.title)}">${esc(n.id)}</a>`).join(' ') + (arr.length > 6 ? `<span class="dim"> +${arr.length - 6}</span>` : '') || `<span class="dim">${cap}</span>`;
  const nowNext = `<div class="card r14" style="padding:12px 18px;margin-bottom:12px;display:flex;gap:26px;flex-wrap:wrap;align-items:baseline">
      <span><b style="font-size:12.5px">现在在做</b> ${chipRow(doing, '无')}</span>
      <span><b style="font-size:12.5px">下一步（就绪）</b> ${chipRow(ready2, '无')}</span>
      <span class="dim" style="font-size:12px">还压着 ${blocked2.length} 张等前置</span></div>`;
  return nowNext + `<div class="fl-bar">
      <span class="subnote">横轴=阶段 · 泳道=系统 · 红=关键路径（预计时间加权）· 虚线=升阶链 · 点卡进详情</span>
      <span class="sp"></span>
      ${cp.len ? `<span class="fl-cp">关键路径 ${Math.round(cp.len * 10) / 10}h · ${cp.path.length} 单</span>` : ''}
      <button class="btn h32 ${foldHist ? 'on' : ''}" id="fl-fold-btn" onclick="flFold(this)">${foldHist ? `显示历史${foldedLanes.size ? `（${foldedLanes.size} 组）` : ''}` : '折叠已完成'}</button></div>
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
      : '<span class="twist2 none">·</span>'; // 叶子一律「·」——▸ 只留给真能开合的父行（2026-08-06 交互全测：同形箭头误导可点）
    return `<div class="trow2 ${isParent ? 'parent' : 'leaf'} ${lv ? 'lv' + Math.min(lv, 3) : ''} ${acceptN ? 'hasaccept' : ''}" onclick="location.hash='#/t/${t.id}'">
      ${twist}<span class="tid2">${esc(t.id)}</span><span class="tt2 clamp2" title="${esc(t.title)}">${esc(t.title)}</span>
      ${isParent ? `<span class="kids">${chn.length} 子单${t.阶段 ? ' · ' + esc(t.阶段) : ''}</span>` : ''}
      <span class="mid">${isParent ? '' : fnPill(t.职能)}${stPill(t.state)}${isParent && t.state === '待验收' ? `<span class="pill signq" title="${esc(t.验收方式 === '保留' ? '保留 · 只你能签' : '委托 · 核查可代签，仍在你队列')}">✍ 等你签字</span>` : ''}</span>
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
  if (!await ask(`批量验收 ${pid} 下 ${ch.length} 张待验收子单？`)) return;
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
/* ===== 在途 · 派发制视图（H49）：执行者因单而生、完成即销毁，常备的只有审检 ===== */
// 进度渲染三件套（施工令-004）：口径全在服务端 lib/progress.js 算好，这里只负责画。
const 进度态 = (p) => (p && p.超时 ? 'warn' : p && p.判官 ? 'judge' : '');
function segbarHtml(p, id) {
  const cls = 进度态(p);
  return `<div class="segbar"${id ? ` id="${esc(id)}"` : ''}>${((p && p.段) || []).map((s) => `<div class="seg ${s.态}${s.态 === 'cur' && cls ? ' ' + cls : ''}">
      <i>${s.态 === 'cur' ? `<em style="--fill:${Math.round((s.填充 || 0) * 100)}%"></em>` : ''}</i><span>${esc(s.名)}</span></div>`).join('')}</div>`;
}
// 计时：判官阶段报「本步 · 全程」，执行阶段报「已跑 / 预估」（超时转红，一眼可捞）
function 计时Html(p, 环节起时, 领单时间) {
  const tm = (iso, over) => iso && !Number.isNaN(Date.parse(iso))
    ? `<span class="tm${over ? ' over' : ''}" data-since="${esc(iso)}">${fmtElapsed(Date.now() - Date.parse(iso))}</span>` : '<span>--:--</span>';
  if (p && p.判官) return `${tm(环节起时)} 本步${领单时间 ? ` · ${tm(领单时间)} 全程` : ''}`;
  const est = p && p.预估分钟 ? fmtElapsed(p.预估分钟 * 60000) : null;
  return `${tm(环节起时 || 领单时间, !!(p && p.超时))}${est ? ` / 预估 ${est}` : ' · 无预估（阶段内不插值）'}`;
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
    return `<div class="pct">${p.百分比 != null ? p.百分比 : '—'}<small>%</small></div>
      <div class="ar-stage nosess"><span class="dot"></span>无执行会话</div>
      <div class="ar-timer nosess">${n == null ? '未起会话' : `已等 ${n} 分钟未起会话`}</div>`;
  }
  return `<div class="pct">${p.百分比 != null ? p.百分比 : '—'}<small>%</small></div>
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
    if ((nd.在跑 || []).length !== 在跑数) { route(); return; }
    for (const r of (nd.在跑 || [])) {
      const pe = $('agp-' + r.id); if (pe) pe.innerHTML = pctHtml(r);
      const se = $('ags-' + r.id); if (se) se.outerHTML = segbarHtml(r.进度 || {}, 'ags-' + r.id);
      const ce = $('agc-' + r.id); if (ce) ce.classList.toggle('noagent', r.有会话 === false); // 会话起来了就退出「卡住」形态
    }
  });
  const busyBanner = (d.编辑器占用||[]).length ? `<div class="r14" style="padding:10px 16px;margin-top:16px;background:var(--gatebg);border:1px solid var(--gateln);color:var(--gatetx)"><b>编辑器锁已关（验收中）</b> · 项目 ${d.编辑器占用.map(esc).join('、')} 派发挂起——制作人用完关闭编辑器即自动开锁（H64），或在决策台手动开锁</div>` : '';
  return busyBanner + `<div class="sec-h" style="margin-top:26px"><h3 class="h17">在跑执行者</h3>
      <span class="subnote">派发制 · 因单而生、完成即销毁 · 并发 codex ≤${lim.codex != null ? lim.codex : '—'} / claude ≤${lim.claude != null ? lim.claude : '—'}（项管调配 · 代码硬顶 3）</span></div>
    <div id="ag-cards">${cards}</div>
    <div class="sec-h" style="margin-top:26px"><h3 class="h17">审检三席</h3><span class="subnote">质检 / 核查 / 仲裁 · 唯一常驻岗（H68）</span></div>
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
async function viewDecisions() {
  const d = await api('/api/decisions');
  // D42：决策台按当前项目过滤（积压计数是全局闸，保持全局读数）
  const p = projActive();
  if (p) { await loadCfg(); d.待验收 = d.待验收.filter((t) => projOf(t) === p); d.待定夺 = d.待定夺.filter((t) => projOf(t) === p); }
  const cur = dTab === 'accept' ? (d.待验收[0] || null) : (d.待定夺[0] || null);
  let main = `<div class="dmain card r16"><p class="dim">没有待你处理的签字项——一切安好。</p>
    <p class="subnote" style="margin-top:8px">要开新活：<a href="#/ideas" style="color:var(--accent-ink)">想法池拍板</a> · 要放行：<a href="#/board" style="color:var(--accent-ink)">工单池待投区</a> · 要验收 Unity：先关上面的编辑器锁</p></div>`;
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
      ${dTab === 'accept' ? `<div class="dsign"><span>${isKeep ? '保留单 · 品味终审' : '委托单 · 可核项由核查代签'}</span>
        <div class="btns"><button class="btn primary h36" onclick="dAct('验收','${esc(cur.id)}',true)">通过入库</button>
        <button class="btn h36" onclick="dReject('${esc(cur.id)}')">打回</button></div></div>`
      : `<div class="dsign"><span>QA 修不好 · 呈你我裁决</span><div class="btns">
        <button class="btn h36" onclick="dAct('定夺','${esc(cur.id)}',null,'接受')">接受</button>
        <button class="btn h36" onclick="dAct('定夺','${esc(cur.id)}',null,'给方向')">给方向</button>
        <button class="btn danger-o h36" onclick="dAct('定夺','${esc(cur.id)}',null,'打回')">打回</button></div></div>`}</div>`;
  }
  const q1 = d.待验收.map((t) => `<div class="qitem" onclick="dTab='accept';route()"><span class="qi mono">${esc(t.id)}</span><div class="qn2 clamp2" title="${esc(t.title)}">${esc(t.title)} · ${esc(t.验收方式 || '保留')}</div></div>`).join('') || '<p class="dim" style="margin-top:12px">无</p>';
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
      <span class="tab ${dTab === 'escal' ? 'active' : ''}" onclick="dTab='escal';route()">待定夺 ${d.待定夺.length ? `<span class="badge">${d.待定夺.length}</span>` : ''}</span>
      <span class="backlog2">待验收积压 ${d.积压} / ${d.积压闸}</span></div>
    <div class="dgrid">${main}<div><div class="dside card r16"><h3>待验收队列</h3>${q1}</div>
      <div class="dside card r16"><h3 class="${d.待定夺.length ? 'err' : ''}">待定夺 · ${d.待定夺.length}</h3>
        ${d.待定夺.map((t) => `<div class="qitem" onclick="dTab='escal';route()"><span class="qi mono">${esc(t.id)}</span><div class="qn2 clamp2" title="${esc(t.title)}">${esc(t.title)} · QA 未过</div></div>`).join('') || '<p class="dim" style="margin-top:12px">无</p>'}</div></div></div>`;
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
  return '<div class="rp-card card r14"><h4>项目管理台账<span class="subnote" style="margin-left:10px">管理费 '
    + Number(fee.token合计 || 0).toLocaleString() + ' tk · ' + (fee.次数 || 0) + ' 次 · 并发 ' + caps + '</span></h4>'
    + '<table class="rp-t"><tr><th>专项成本归集</th><th style="text-align:right">tokens</th></tr>' + costRows + '</table></div>';
}
async function viewReport() {
  const [d, , pl, sc] = await Promise.all([api('/api/report'), loadCfg(), api('/api/pm/ledger').catch(() => null), api('/api/scores').catch(() => null)]);
  const dispatch = !!(_cfg && _cfg.执行器 && _cfg.执行器.派发制);
  const p = projActive();
  // D42 项目语境：明细/分组按项目过滤（服务端全量，客户端切片——报表数据量小）
  const rows = p ? d.明细.filter((r) => (r.项目 || projDefault()) === p) : d.明细;
  const o = d.总览;
  const stat = (l, v, c) => `<div class="grp"><span class="lbl">${l}</span><span class="num ${c || ''}">${v}</span></div>`;
  const strip = [
    stat('完成', o.完成), stat('归档', o.已归档), stat('实际工时', o.实际h合计 + 'h'),
    stat('实耗/预估', o.预估偏差pct == null ? '—' : o.预估偏差pct + '%', o.预估偏差pct > 150 ? 'err' : o.预估偏差pct != null && o.预估偏差pct <= 110 ? 'okc' : ''), // 100=踩点 <100=省 >150=严重超（旧名「预估偏差」误导）
    stat('自修轮次', o.自修总轮, o.自修总轮 ? 'warnc' : ''),
    stat('核查 过/不过', o.代核通过 + '/' + o.代核不过),
    stat('仲裁 向/呈', o.代裁给方向 + '/' + o.代裁上呈),
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
      <div>${gtable('按职能', dispatch && pl && pl.台账 ? [...d.按职能, { 名: '项目管理', 单数: (pl.台账.管理费 || {}).次数 || 0, 实际h合计: '—', 平均h: ((pl.台账.管理费 || {}).token合计 || 0).toLocaleString() + ' tk', 自修合计: 0 }] : d.按职能)}${dispatch ? costRankTable(rows) : gtable('按主办', d.按主办)}${dispatch && pl && pl.台账 ? pmLedgerCard(pl.台账) : ''}${gtable('按执行池', d.按池, '订阅额度去向')}${scoreCard(sc)}</div>
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
  间隔秒: '每 N 秒扫一轮（派发+起执行）', 执行超时分钟: 'N 分钟到点先验尸：仍在进展续命，停滞才树杀（硬顶 3N，H63）', 记账间隔分钟: '每 N 分钟自动 git 落袋（0=关）',
  额度刷新秒: '两次额度请求最小间隔 N 秒（防限流硬保证）' };
// 模型档空值文案：不是所有档留空都等于「CLI 默认」——代裁留空是跟核查档走
// （runner.modelOf：代裁 → 仲裁 || 代裁 || 核查 || 代核 || claude默认）。下拉与旁注必须同一口径（施工令-006）
const MEMPTY = { 代裁: '跟核查档' };
const mEmptyLbl = (key) => MEMPTY[key] || 'CLI 默认';
const P6NAMES = { 滞留超时小时: '滞留超时', 速度窗口小时: '速度窗口', 每档处理数: '每档处理数',
  间隔秒: '扫池间隔', 执行超时分钟: '执行超时', 记账间隔分钟: '记账间隔', 额度刷新秒: '额度刷新间隔' };
// 额度双池卡。口径纪律（施工令-006）：每个窗口只跟管得着它的那根杆并排——
// 旧版把「5h X% · 周 Y% · 阈值 Z%」串成一行，读起来像周窗也归 阈值 管（周 61% > 阈值 70%？
// 其实周窗归 周阈值 90% 管），凭空造出违规错觉。现在一窗一行，各挂各的杆。
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
  return `<div class="pr"><h4>${name} 池</h4><span class="pstat ${hot ? 'err' : 'dim'}">${l ? (hot ? '●锁 ' + esc(l.resetAt || '') + ' 解冻' : '正常') : '查询中…'}</span></div>
    ${rows}
    ${moatHtml}`;
}
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
      <p class="pmeta mono" style="word-break:break-all">${esc(v.兼容.base || '')}<br/>模型 ${esc(v.兼容.模型 || 'CLI 默认')} · 密钥 ${esc(v.兼容.key || '未设')} · 职能 ${(v.职能 || []).join('/') || '（评测中·单张盖章）'}</p>
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
  
  const params = Object.entries(c.闸值 || {}).map(([k, v]) => `<div class="paramcard card" data-key="${esc(k)}"><h4>${esc(P6NAMES[k] || k)}</h4><p class="pmeta">${esc((P6META[k] || '').replace('N', v))}</p>
      <div class="stepper"><button onclick="pStep('${k}',-1)">−</button><span class="val">${v}</span><button onclick="pStep('${k}',1)">＋</button></div></div>`).join('');
  const recCards = ''; // 精力档/推荐在途（D28）已随拉取制退役（0.23.11）
  void staffCards; void capCard; void recCards; // 退役占位，仅为注释留痕
  // 额度不阻塞首屏：先占位骨架，数据回来原地填（footprint 不变），随后 5s 活体轮询
  let lastPoolJson = '';
  const fillPools = async () => {
    const g = await api('/api/gates');
    const key = JSON.stringify([g.locks.codex, g.locks.claude, g.护城河]);
    if (key === lastPoolJson) return;
    lastPoolJson = key;
    const pc = $('pool-codex'); if (pc) pc.innerHTML = poolCardHtml('codex', g.locks.codex, c.执行池 && c.执行池.codex, g.护城河);
    const pl = $('pool-claude'); if (pl) pl.innerHTML = poolCardHtml('claude', g.locks.claude, c.执行池 && c.执行池.claude, g.护城河);
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
  return `<div class="p6grid"><div>
      <div class="sec-h"><h3 class="h17">执行器</h3><span class="subnote">派发调度循环 · 开 exe 即开工厂</span></div>${runCards}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">参数闸值</h3><span class="subnote">监制台可调</span></div>${params}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">模型档</h3><span class="subnote">贵裁判 · 贱体力（D38）</span></div>${modelCards}${compatCards}</div>
    <div><div class="sec-h"><h3 class="h17">环境探针</h3><span class="subnote">实弹前置检查</span></div>${envCard}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">项目注册</h3><span class="subnote">执行 agent 的目标仓库（D32）</span></div>${projCard}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">执行池阈值</h3><span class="subnote">额度锁的杆（D26）</span></div>${poolCards}
      <div class="sec-h" style="margin-top:26px"><h3 class="h17">额度双池</h3></div>
      <div class="poolcard card" id="pool-codex">${poolCardHtml('codex', null, c.执行池 && c.执行池.codex)}</div>
      <div class="poolcard card" id="pool-claude">${poolCardHtml('claude', null, c.执行池 && c.执行池.claude)}</div></div></div>`;
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
      <div class="p7foot"><button class="btn h44" onclick="dSave(false)">存为待投</button>
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
  if (!r2.ok && !/待投/.test(r2.error || '')) return toast('已建草稿，但定稿失败：' + (r2.error || ''));
  const w = r2.警示 ? ' · 警示：' + r2.警示[0] : ''; // H83 短题制预检警示，不拦截只提醒
  if (release) { const r3 = await post('/api/act/投池', { id: payload.id }); if (!r3.ok) return toast('已入待投，投池失败：' + (r3.error || '')); toast('已投池' + w); }
  else toast('已存为待投' + w);
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
// 回执最新一轮：多轮回执按「## 第 N 轮回执」或「# 完工报告」切，取最后一段（旧单单轮原样返回）
function 回执最新轮(raw) {
  const s = String(raw || '');
  const rounds = s.split(/^(?=##\s*第\s*\d+\s*轮回执)/m).filter((x) => x.trim());
  if (rounds.length > 1) return { 段: rounds[rounds.length - 1], 轮: `第 ${rounds.length} 轮（最新）` };
  const reports = s.split(/^(?=#\s+完工报告)/m).filter((x) => x.trim());
  if (reports.length > 1) return { 段: reports[reports.length - 1], 轮: `最新一份（共 ${reports.length} 份）` };
  return { 段: s, 轮: '' };
}
// 正文/回执中最后一个 QA 章的结论摘要（≤10 行）：优先结论/不过项行，无则取章首几行
function 最新QA摘要(raw, body) {
  const pick = (src) => {
    const secs = String(src || '').split(/^##+\s*/m).filter((p) => /^(QA|质检|核验|QA\s*核验)/i.test(p.trim()));
    if (!secs.length) return '';
    const 章 = secs[secs.length - 1];
    const lines = 章.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
    const hit = lines.filter((l) => /结论|不过|未过|失败|缺|问题|原因|建议/.test(l));
    return (hit.length ? hit : lines).slice(0, 10).join('\n');
  };
  return pick(raw) || pick(body) || '';
}
/* 待定夺卷宗「上呈原因」取数（施工令-012 / 巡礼 P2-3）。
   ① fm.上呈原因 是事实源——lifecycle 在流转进待定夺时就落库（优化-D 通则）。
   ② 只有没有该字段的老单才退回 grep 流水，且先剔噪声行：滞留检查每 30 分钟给滞留单追加一条
      「滞留告警 X（待定夺 停留 7h…）」，旧的二级正则 /上呈|待定夺/ 正好命中它，把卷宗最重要的
      一栏顶成误导信息；「待定夺裁决」是裁决结果不是上呈原因，同样排除。
   ③ 二级兜底收紧为「上呈」或明确的「→ 待定夺」转移行，不再见「待定夺」三字就收。
   纯函数，无 DOM 依赖——test/escalation.test.js 按下面的标记原样抽出来跑。 */
// @testable-begin escalReason
function escalReason(fm, lines, id) {
  const f = fm || {};
  const 字段 = String(f.上呈原因 || '').trim();
  if (字段) return 字段;
  const 噪声 = /滞留告警|滞留检查|巡检|待定夺裁决|心跳/;
  const rev = (lines || []).filter((l) => String(l).includes(id) && !噪声.test(l)).reverse();
  const 上呈行 = rev.find((l) => /修不好|失败分诊|评估回呈|仲裁/.test(l))
    || rev.find((l) => /上呈|→\s*待定夺/.test(l)) || '';
  return 上呈行
    || (f.自修次数 ? `QA 自修 ${f.自修次数} 轮未过 → 三振上呈` : '')
    || (f.失败原因 ? `执行失败上呈：${String(f.失败原因).slice(0, 120)}` : '')
    || '（流水与工单里都没记到上呈原因）';
}
// @testable-end escalReason

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
      const judge = fm.验收方式 === '委托' ? '核查' : '你验收';
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
  // ---- 待定夺卷宗（TK-97 案：待定夺时详情页看不到发生了什么）----
  let escalHtml = '';
  if (d.state === '待定夺') {
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
      <b style="font-size:13px">待定夺卷宗</b>
      <span class="subnote" style="margin-left:8px">为什么呈到你手上 · 判官说了什么 · 之前给过什么方向</span>
      ${fm.自修次数 ? `<span class="pill sm red" style="margin-left:8px">自修 ${esc(fm.自修次数)} 轮</span>` : ''}${arb}
      <div class="rsec"><div class="rl">上呈原因</div><div class="rv" style="white-space:pre-line">${esc(原因)}</div></div>
      <div class="rsec"><div class="rl">最新 QA 结论</div><div class="rv" style="white-space:pre-line">${esc(qa || '（回执与正文里都没找到 QA 章）')}</div></div>
      ${dirHtml}</div>`;
  }
  const chainRow = (k, v, cls) => `<div class="crow"><span class="ck">${k}</span><span class="cv ${cls || ''}">${v || '—'}</span></div>`;
  const kidsTxt = (c.父子.子 || []).map((x) => `<a href="#/t/${x.id}" style="color:var(--accent-ink)">${esc(x.id)}</a>(${esc(x.state)})`).join('、');
  let rsecs = '';
  if (d.回执) {
    // 多轮回执只解析最新一轮（返修/自修追加在同一文件里，旧轮章节会盖住新轮）
    const { 段, 轮 } = 回执最新轮(d.回执.raw);
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
    if (标准) {
      rsecs = (轮 ? `<div class="subnote" style="margin:8px 0 2px">${esc(轮)}</div>` : '') + 章节Html(Object.entries(secs));
    } else {
      const tail = 段.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-8).join('\n');
      rsecs = `<div class="subnote" style="margin:8px 0 2px">非标回执（未见「做了什么」章）${轮 ? ' · ' + esc(轮) : ''} · 附末尾 8 行原文</div>
        ${章节Html(有货)}
        <div class="rsec"><div class="rl">回执原文</div><div class="rv mono" style="white-space:pre-line">${esc(tail || '（回执为空文件）')}</div></div>`;
    }
  }
  const ops = [];
  if (['池', '待投'].includes(d.state)) ops.push(['撤回', '回草稿（仅在池 / 待投）', `act2('撤回','${id}')`]);
  if (d.state === '在途') ops.push(['收回', '从执行方取回在途单', `act2('收回','${id}')`]);
  if (fm.待复核) ops.push(['解除复核', `上游 ${esc(fm.待复核.锚号 || '')} 已核对新版`, `act2('解除复核','${id}')`]); // D36
  if (d.state === '执行失败') { // D31 分诊三出路（废弃在下方通用项）+ H65 返修
    ops.push(['重投', `清执行痕迹回池重领${fm.失败原因 ? '（' + esc(String(fm.失败原因).slice(0, 24)) + '）' : ''}`, `act3('失败分诊','${id}','重投')`]);
    ops.push(['返修', `同号回草稿改写（第 ${(fm.返修轮 || 0) + 1} 轮，计数保留，H65）`, `act2('返修','${id}')`]);
    ops.push(['上呈', '转待定夺，由你拍板', `act3('失败分诊','${id}','上呈')`]);
  }
  if (d.state === '待定夺') { // D10 裁决三出路，与决策台等价（走同一 /api/act/定夺）
    ops.push(['接受', 'QA 说不过但你认了 → 待验收', `act3('定夺','${id}','接受')`]);
    ops.push(['给方向', '写清怎么改 → 回在途重做（自修计数清零）', `dirModal('${id}')`]);
    ops.push(['打回', '这活不成立 → 归档（返工另开新单）', `askDecide('${id}','打回','打回将归档本单，需另开新单重走流程。确认？')`]);
  }
  if (d.state === '待验收') ops.push(['返修', `不过关但同一件活：同号回草稿改写（第 ${(fm.返修轮 || 0) + 1} 轮，H65）`, `act2('返修','${id}')`]);
  if (d.state === '草稿') ops.push(['定稿', '草稿 → 待投', `act2('定稿','${id}')`]);
  if (d.state === '待投') ops.push(['投池', '释放进池（人闸）', `act2('投池','${id}')`]);
  if (!['完成', '已归档'].includes(d.state)) ops.push(['废弃', '归档（非终态皆可）', `askAct2('废弃','${id}','废弃并归档？')`]);
  if (d.state === '草稿') ops.push(['编辑', '打开起草页修改', `location.hash='#/draft?edit=${id}'`]);
  if (d.state === '完成') { // 审批点④：入库（D12 精选制，唯一写者=制作人层）
    if (fm.职能 === '策划') ops.push(['入标杆', '提炼进设计公理（审批点④）', `axModal('${id}')`]);
    if (fm.职能 === '美术' || fm.职能 === '装配') ops.push(['入美术库', '产出精选进风格库（审批点④）', `artModal('${id}')`]);
  }
  if (['完成', '已归档'].includes(d.state)) ops.push(['推翻重做', '翻案：归档旧单+自动开返工草稿（须写理由）', `overturnModal('${id}')`]);
  if (d.state === '已归档') ops.push([fm.隐藏 ? '取消隐藏' : '隐藏归档', fm.隐藏 ? '重新出现在归档列表' : '从一切默认视图湮灭（纸面仍可考）', `toggleHide('${id}',${fm.隐藏 ? 'false' : 'true'})`]);
  return `${engHtml}${liveHtml}<div class="p8grid"><div>
      <div class="p8main card r16"><h2>${esc(id)} · ${esc(fm.title)}</h2>
        <div class="chipsrow">${fnPill(fm.职能)}<span class="pill mut">${esc(fm.产出物类型 || '')}</span>
          <span class="pill ${fm.验收方式 === '委托' ? 'mut' : 'ok'}">${esc(fm.验收方式 || '保留')}</span><span class="pill mut">${esc(fm.规模 || '')}</span>
          ${fm.待复核 ? `<span class="pill red" title="${esc(fm.待复核.说明 || '')}">待复核 · ${esc(fm.待复核.锚号 || '')}</span>` : ''}
          ${fm.代核 ? `<span class="pill ${fm.代核.结论 === '通过' ? 'ok' : 'red'}">核查${esc(fm.代核.结论)}</span>` : ''}</div>
        <div class="chain"><div class="clbl">追溯链</div>
          ${chainRow('父单', c.父子.父 ? `<a href="#/t/${c.父子.父}" style="color:var(--accent-ink)">${esc(c.父子.父)}</a>` : null)}
          ${chainRow('子单', kidsTxt)}
          ${chainRow('返工自', c.返工自 ? esc(c.返工自) : null)}
          ${chainRow('依据', c.依据 ? `<span style="color:var(--accent-ink)">${esc(c.依据)}</span>` : null)}
          ${chainRow('依赖', (c.依赖 || []).map((x) => `${esc(x.id)}(${esc(x.state)})`).join('、'), 'okc')}</div></div>
      ${escalHtml}
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
// 预检警示（H83 短题制）：动作照常完成，只把提醒端到眼前
window.act2 = async (name, id) => { const r = await post('/api/act/' + name, { id }); toast(r.ok ? (r.警示 ? '完成 · 警示：' + r.警示[0] : '完成') : (r.error || '失败')); route(); };
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

/* ===== 路由 ===== */
/* ===== P16 Wiki（0.20，H52 第三类实体）：设计事实源——分类树 + 词条双链 + 信息栏 + 待审人闸 + 关系图 ===== */
// 施工令-015：wiki = 唯一知识入口，四分区页签（设计事实/策划案/技术方案/美术标杆）
const WK_TABS = [['设计事实', '🧩'], ['策划案', '📘'], ['技术方案', '🛠'], ['美术标杆', '🎨']];
const wkState = { entry: '', mode: 'read', q: '', cat: '', tab: '设计事实', doc: '', dq: '' };
window.wkTab = (n) => { if (wkState.tab === n) return; wkState.tab = n; wkState.doc = ''; wkState.dq = ''; route(); };
// 极简 markdown 渲染（词条正文专用）：标题/加粗/行内码/列表/段落/[[双链]]。不引库，XSS 经 esc 全量转义。
function wkMd(src, byName) {
  src = String(src || '').replace(/<!--[\s\S]*?-->/g, ''); // HTML 注释不渲染（2026-08-06 UI 评审：入库回填注释块曾显形为正文）
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
// 四分区页签壳：页签常驻，分区内容各自渲染（页签栏复用决策台 .dtabs）
async function viewWiki() {
  const proj = curProj() || projDefault();
  if (!WK_TABS.some(([n]) => n === wkState.tab)) wkState.tab = '设计事实';
  const bar = `<div class="dtabs" style="margin-top:22px">${WK_TABS.map(([n, i]) =>
    `<div class="tab ${wkState.tab === n ? 'active' : ''}" onclick="wkTab('${n}')">${i} ${esc(n)}</div>`).join('')}
    <span class="backlog2">${esc(proj)} · 知识总库</span></div>`;
  let body;
  try {
    if (wkState.tab === '策划案' || wkState.tab === '技术方案') body = await wkDocZone(proj, wkState.tab);
    else if (wkState.tab === '美术标杆') body = await wkArtRef();
    else body = await wkFacts(proj);
  } catch (e) { body = `<div class="emptycard" style="margin-top:20px"><h5>分区加载失败</h5><p>${esc(e.message || String(e))}</p></div>`; }
  return bar + body;
}

/* --- 文档分区（策划案 / 技术方案）：视图聚合制，只读；缺目录容错 --- */
// 溯源索引：两分区全量文档缓存一份，供词条 源文档 字段解析成可点链接
let _docIdx = null, _docIdxProj = '';
async function docIndex(proj) {
  if (_docIdx && _docIdxProj === proj) return _docIdx;
  const out = [];
  for (const z of ['策划案', '技术方案']) {
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
window.wkOpenDoc = (zone, rel) => { wkState.tab = zone; wkState.doc = rel; wkState.dq = ''; route(); };
window.wkDocPick = (rel) => { wkState.doc = rel; route(); };

async function wkDocZone(proj, zone) {
  const d = await api('/api/docs?项目=' + encodeURIComponent(proj) + '&区=' + encodeURIComponent(zone)).catch((e) => ({ error: String(e) }));
  if (d.error) return `<div class="emptycard" style="margin-top:20px"><h5>${esc(zone)}未就绪</h5><p>${esc(d.error)}</p></div>`;
  const all = d.文档 || [];
  if (wkState.doc && !all.some((x) => x.rel === wkState.doc)) wkState.doc = ''; // 换分区/文件已删 → 回分区主页
  const q = wkState.dq.trim();
  const hit = (x) => !q || x.标题.includes(q) || x.文件名.includes(q) || x.子目录.includes(q);
  const TAGI = { 设计: '📐', 调研: '🔍', 方案: '🛠' };
  // 左栏：按根分组（策划案两根 = 设计/调研），根内再按子目录分层
  const tree = (d.根 || []).map((r) => {
    const mine = all.filter((x) => x.根 === r.根);
    const shown = mine.filter(hit);
    if (q && !shown.length) return '';
    const head = `<p class="wk-cat" title="${esc(r.根)}">${TAGI[r.标签] || '📄'} ${esc(r.标签)} <span class="dim">· ${r.存在 ? `${shown.length}` : '目录未建'}</span></p>`;
    if (!r.存在) return head + '<p class="wk-it dim" style="cursor:default">（项目仓无此目录，建了自动出现）</p>';
    if (!shown.length) return head + '<p class="wk-it dim" style="cursor:default">（空）</p>';
    const subs = [...new Set(shown.map((x) => x.子目录))].sort();
    return head + subs.map((s) => (s ? `<p class="wk-it dim" style="margin-left:8px;cursor:default">${esc(s)}/</p>` : '')
      + shown.filter((x) => x.子目录 === s).map((x) =>
        `<p class="wk-it ${x.rel === wkState.doc ? 'cur' : ''}" style="${s ? 'margin-left:26px' : ''}" title="${esc(x.rel)}" onclick="wkDocPick('${qesc(x.rel)}')">${esc(x.标题)}</p>`).join('')).join('');
  }).join('');
  // 右栏：选中即读；未选则分区主页（根概览 + 最近更新）
  let article, info = '';
  const cur = all.find((x) => x.rel === wkState.doc);
  if (cur) {
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
        ${cur.子目录 ? `<tr><td class="dim">子目录</td><td style="text-align:right">${esc(cur.子目录)}</td></tr>` : ''}
        <tr><td class="dim">字数</td><td style="text-align:right">${cur.字数}</td></tr>
        ${cur.更新时间 ? `<tr><td class="dim">更新</td><td style="text-align:right">${esc(cur.更新时间)}</td></tr>` : ''}
      </table>
      <p class="subnote mono" style="margin:10px 0 0;word-break:break-all">${esc(cur.rel)}</p>
      <p class="subnote" style="margin:8px 0 0">只读展示——改稿回项目仓改文件，刷新即变</p></div>`;
  } else {
    const recent = [...all].filter((x) => x.更新时间).sort((a, b) => String(b.更新时间).localeCompare(String(a.更新时间))).slice(0, 8);
    const cards = (d.根 || []).map((r) => `<div class="card r14" style="padding:14px 16px">
        <b style="font-size:14px">${TAGI[r.标签] || '📄'} ${esc(r.标签)}</b><span class="dim" style="margin-left:8px">${r.存在 ? `${r.数量} 篇` : '目录未建'}</span>
        <p class="subnote mono" style="margin:8px 0 0;word-break:break-all">${esc(r.根)}</p></div>`).join('');
    article = `<h2 style="margin:0 0 4px">${esc(proj)} ${esc(zone)}</h2>
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
      // 溯源链（施工令-015）：frontmatter.源文档 → 策划案/技术方案分区里的那一篇，可点直达
      const srcs = e.源文档 || [];
      const idx = srcs.length ? await docIndex(proj) : [];
      const srcHtml = srcs.length ? `<p class="wk-src">📎 源文档 ${srcs.map((s) => {
        const m = docMatch(idx, s);
        return m ? `<a class="wk-l" title="${esc(m.区)} · ${esc(m.rel)}" onclick="wkOpenDoc('${qesc(m.区)}','${qesc(m.rel)}')">${esc(m.标题)}</a>`
          : `<span class="dim" title="未在策划案/技术方案分区找到这篇">${esc(s)}</span>`;
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
// 开词条一律回「设计事实」页签——策划案/技术方案正文里的 [[双链]] 点了要能跳过来（施工令-015）
window.wkOpen = (name) => { wkState.tab = '设计事实'; wkState.entry = name; wkState.mode = 'read'; route(); };
window.wkApprove = async (f) => { const r = await post('/api/wiki/approve', { 文件: f, 项目: curProj() || projDefault() }); toast(r.ok ? `已入册「${r.名称}」` : (r.error || '失败')); route(); };
window.wkReject = async (f) => { if (!await ask('退回将删除该待审稿（agent 提案不入史）。确认？')) return; const r = await post('/api/wiki/reject', { 文件: f, 项目: curProj() || projDefault() }); toast(r.ok ? '已退回' : (r.error || '失败')); route(); };
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

// 施工令-015：stylelib 路由退役（内容并入 wiki 美术标杆页签），旧书签在 route() 里转向
const ROUTES = { '': viewOverview, ideas: viewIdeas, board: viewBoard, flow: viewFlow, tree: viewTree, agents: viewAgents, decisions: viewDecisions, wiki: viewWiki, relay: viewRelay, report: viewReport };
const WK_ALIAS = ['style', 'stylelib', '风格库']; // 旧书签不死：一律落 wiki 美术标杆

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
  if (动作 === '放弃' && !await ask('放弃这个想法？')) return;
  const r = await post('/api/ideas', { 动作, id });
  if (!r.ok) return toast(r.error || '失败');
  if (动作 === '拍板') { toast(`父单 ${r.父单} 已建——去补齐边界与验收标准`); location.hash = '#/draft?edit=' + encodeURIComponent(r.父单); return; }
  route();
};

/* ===== P13 项管信道（0.18.6，前身遥控传令板）：制作人 ↔ 项管问答 + 汇报流 ===== */
function pmEventLine(e) {
  // e.t 是 UTC ISO 串，必须转本地时区再显示（用户实测：00:16 曾显示成 16:16）
  // 当日事件只显 HH:MM（跨日才带月-日，窄列不折行——2026-08-06 UI 评审项管页）
  const d0 = new Date(e.t); const p2 = (n) => String(n).padStart(2, '0');
  const sameDay = !isNaN(d0) && d0.toDateString() === new Date().toDateString();
  const t = isNaN(d0) ? String(e.t || '').slice(5, 16).replace('T', ' ')
    : sameDay ? `${p2(d0.getHours())}:${p2(d0.getMinutes())}`
    : `${p2(d0.getMonth() + 1)}-${p2(d0.getDate())} ${p2(d0.getHours())}:${p2(d0.getMinutes())}`;
  if (e.类型 === '待审') return { t, txt: e.单 ? `受托起草：${e.单}（草稿待总监审）` : `拆单完成：${e.父单} → ${(e.子单 || []).join('、')}，简报呈 Claude 审批`, hot: true };
  if (e.类型 === '切单启动') return { t, txt: `开始拆单：${e.父单}（仓况盘点中）`, hot: true };
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
async function viewRelay() {
  // 0.23.9 信息架构定案（用户裁定）：只留三项——状态 / 关键汇报 / 详细流水。
  // 台账与对话区退出 UI（机制层 API 保留：制作人层通道走 /api/relay，台账走 /api/pm/ledger）。
  // H85 追加第四项：编制快照（只读）——用工权归项管后，编制现况在项管页看。
  const [d, pl, rs] = await Promise.all([
    api('/api/relay').catch(() => ({ 消息: [] })),
    api('/api/pm/ledger').catch(() => ({ 事件: [], 台账: {} })),
    api('/api/pm/roster').catch(() => ({ 编制: [] })),
  ]);
  const 模型档 = (_cfg && _cfg.模型 && _cfg.模型.项管) || '—';
  const L = pl.台账 || {};
  const KEY = new Set(['切单启动', '待审', '收口报告', '收口', '上呈', '额度报警', '切单失败', '派单委托', '定稿放行', '评估回呈', '裁决']);
  const evAll = pl.事件 || [];
  const line = (e) => { const v = pmEventLine(e);
    if (!v) return ''; // null=不占流水（无异常巡检心跳）
    return `<div class="logrow"><time>${esc(v.t)}</time><span${v.hot ? ' style="color:var(--accent-ink);font-weight:600"' : ''}>${esc(v.txt)}</span></div>`; };
  const feedKey = evAll.filter((e) => KEY.has(e.类型)).slice(-12).reverse().map(line).join('')
    || '<p class="dim">暂无关键事件。</p>';
  const feedFlow = evAll.filter((e) => !KEY.has(e.类型)).slice(-50).reverse().map(line).join('')
    || '<p class="dim">暂无流水。</p>';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cnt = {};
  for (const e of evAll.filter((x) => new Date(x.t) >= today && x.类型 !== '巡检')) cnt[e.类型] = (cnt[e.类型] || 0) + 1; // 巡检心跳不入今日概括
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
    <div class="logcard card r14" style="margin-bottom:16px"><b style="font-size:13px">编制快照</b>
      <span class="subnote" style="margin-left:8px">每职能一行 · 池序即路由优先级 · 只读（调整走 /api/pm/roster）</span>
      <div style="margin-top:12px">${rosterSnapHtml(rs.编制)}</div></div>
    <div class="logcard card r14" style="margin-bottom:16px"><b style="font-size:13px">关键汇报</b>
      <span class="subnote" style="margin-left:8px">拆单 / 待审 / 收口 / 上呈 / 报警</span>
      <div style="margin-top:12px">${feedKey}</div></div>
    <div class="logcard card r14"><b style="font-size:13px">详细流水</b>
      <span class="subnote" style="margin-left:8px">近 50 条 · 它都做了什么</span>
      <div style="margin-top:12px;max-height:46vh;overflow-y:auto">${feedFlow}</div></div>
  </div>`;
}
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

// H64 编辑器锁开关（默认项目）
window.editorLock = async (关) => {
  const r = await post('/api/editor-lock', { 关 });
  if (!r.ok) return toast(r.error || '失败');
  toast(关 ? '已关锁：派发挂起，放心开 Unity 验收' : '已开锁：派发恢复');
  route();
};
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
    // 风格库退役（施工令-015）：#/style · #/stylelib 旧书签 301 到 wiki 美术标杆页签
    if (WK_ALIAS.includes(decodeURIComponent(h))) { wkState.tab = '美术标杆'; wkState.doc = ''; location.replace('#/wiki'); return; }
    if (h === 'hub') { app.innerHTML = await viewHub(); markIn('hub'); return; }
    if (h === 'params') { app.innerHTML = bshell('参数与额度', '<span class="pill sm mut">全局配置</span>', await viewParams(), '#/hub'); markIn('params'); return; }
    if (h === 'proj-new') { app.innerHTML = bshell('注册新项目', '<span class="pill sm mut">全局 · 项目注册</span>', viewProjNew(), '#/hub'); markIn('proj-new'); return; }
    if ((m = h.match(/^t\/(.+)$/))) {
      const id = decodeURIComponent(m[1]);
      const d = await api('/api/ticket?id=' + encodeURIComponent(id)).catch(() => ({}));
      let stBadge = d.state ? stPill(d.state) : '';
      if (['待验收', '待定夺'].includes(d.state)) { // 目录态≠现场态：审检会话在跑时头部按会话报（制作人 03:18 指正）
        const run = await api('/api/runner').catch(() => ({}));
        const live = (run.执行中 || []).find((x) => x.id === id);
        if (live) stBadge = `<span class="pill st-review">${esc(({ 初检: '初检中', 代核: '核查中', 核查: '核查中', 仲裁: '仲裁中' })[live.kind] || live.kind + '中')}</span>`;
      }
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
