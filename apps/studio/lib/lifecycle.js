// lifecycle.js — 高层生命周期动作（D5/D6/D8/D10/D13）。每个动作 = 一次合法状态转移 + 记账。
// 只做控制流；产出资产由执行 agent 写进项目仓库，回执写进 回执/。
const fs = require('fs');
const path = require('path');
const store = require('./core/store');
const journal = require('./journal');
const inbox = require('./inbox');

const nowIso = () => new Date().toISOString();

function 定稿(root, id) { // 草稿→待投（写好了，攥在手里）
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '草稿') return { ok: false, error: `只有草稿可定稿（当前 ${t.state}）` };
  const r = store.move(root, id, '草稿', '待投', null, nowIso());
  if (r.ok) journal.append(root, `定稿 ${id}（草稿→待投）`);
  return r;
}

function 投池(root, id) { // 待投→池（人闸释放，D2）
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待投') return { ok: false, error: `只有待投单可投池（当前 ${t.state}）` };
  const r = store.move(root, id, '待投', '池', null, nowIso());
  if (r.ok) journal.append(root, `投池 ${id}（待投→池 · 人闸）`);
  return r;
}

// 交产出：执行完工。在途→质检(QA开)/待验收(QA关)。回执写入 回执/<id>.md（含 QA 章节，若开）。
function 交产出(root, id, 回执body) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '在途') return { ok: false, error: `只有在途单可交产出（当前 ${t.state}）` };
  if (t.fm.待复核) return { ok: false, error: `待复核未解除（上游 ${t.fm.待复核.锚号 || ''} 已改版），核对新版后先解除标记（D36）` };
  if (回执body) {
    fs.mkdirSync(path.join(root, '回执'), { recursive: true });
    fs.writeFileSync(path.join(root, '回执', `${id}.md`), 回执body, 'utf8');
  }
  const qaOn = String(t.fm.QA || '').trim() !== '关'; // fail-closed（2026-08-05 TK-84 案：非标 QA 串被判「关」直达验收，空壳回执绕过判官）
  const to = qaOn ? '质检' : '待验收';
  const r = store.move(root, id, '在途', to, (fm) => { fm.交付时间 = nowIso(); }, nowIso()); // 交付时刻：执行时间轴的段终点
  if (r.ok) journal.append(root, `交产出 ${id}（在途→${to}${qaOn ? '' : ' · QA关直达验收'}）`);
  return r;
}

// QA 裁定（D10）：通过→待验收；不过且未超自修上限→在途(自修+1)；不过且超上限→待定夺。
function QA裁定(root, cfg, id, 通过) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '质检') return { ok: false, error: `只有质检中单可 QA 裁定（当前 ${t.state}）` };
  if (通过) {
    const r = store.move(root, id, '质检', '待验收', null, nowIso());
    if (r.ok) journal.append(root, `QA 通过 ${id}（质检→待验收）`);
    return r;
  }
  const 上限 = (cfg.闸值 || {}).QA自修上限 ?? 2;
  const c = (Number(t.fm.自修次数) || 0) + 1;
  if (c <= 上限) {
    const r = store.move(root, id, '质检', '在途', (fm) => { fm.自修次数 = c; }, nowIso());
    if (r.ok) journal.append(root, `QA 不过自修 ${id} 第 ${c}/${上限} 轮（质检→在途）`);
    return r;
  }
  const r = store.move(root, id, '质检', '待定夺', (fm) => { fm.自修次数 = c; }, nowIso());
  if (r.ok) { journal.append(root, `QA 修不好 ${id} → 待定夺（四件套呈你我）`); inbox.post(root, '急', '三振上呈', `${id} QA 修不好，四件套待裁`, { 单号: id }); }
  return r;
}

// 待定夺裁决（D10）：接受→待验收；给方向→在途(单未死，不违 D6)；打回→已归档(+新单另调 返工)。
// D43③ 扩展：给方向可附方向文本（追加进工单正文，主办 agent 重执行时能读到）+ 裁决人署名。
function 定夺(root, id, 决定, 方向, 裁决人) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待定夺') return { ok: false, error: `当前不在待定夺（${t.state}）` };
  const map = { 接受: '待验收', 给方向: '在途', 打回: '已归档' };
  const to = map[决定];
  if (!to) return { ok: false, error: `未知决定：${决定}` };
  const r = store.move(root, id, '待定夺', to, 决定 === '打回' ? (fm) => { fm.归档原因 = '定夺打回'; } : null, nowIso()); // 归档来路补全（夜班推演 #4）
  if (r.ok) {
    if (决定 === '给方向' && 方向) {
      store.update(root, id, (fm, t2) => ({ body: (t2.body || '') + `\n\n## 定夺方向（${裁决人 || '制作人'} · ${nowIso().slice(0, 10)}）\n${String(方向).slice(0, 2000)}\n` }));
    }
    journal.append(root, `待定夺裁决 ${id}：${决定}（待定夺→${to}${裁决人 ? ' · ' + 裁决人 : ''}）`);
  }
  return r;
}

// 验收（D11）：通过→完成；不过→已归档（返工另开新单）。
function 验收(root, id, 通过) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '待验收') return { ok: false, error: `只有待验收单可验收（当前 ${t.state}）` };
  const to = 通过 ? '完成' : '已归档';
  const r = store.move(root, id, '待验收', to, (fm) => { if (!通过) fm.归档原因 = '验收打回'; }, nowIso());
  if (r.ok) journal.append(root, `验收 ${id}：${通过 ? '通过→完成' : '打回→已归档'}`);
  return r;
}

// 撤回：在池/待投→草稿（还没人领，无副作用）。
function 撤回(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '池' && t.state !== '待投') return { ok: false, error: `只有在池/待投可撤回（当前 ${t.state}）` };
  const r = store.move(root, id, t.state, '草稿', null, nowIso());
  if (r.ok) journal.append(root, `撤回 ${id}（${t.state}→草稿）`);
  return r;
}

// 废弃：任意非终态→已归档（制作人拉闸权）。
function 废弃(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (store.TERMINAL.includes(t.state)) return { ok: false, error: '终态单不可废弃' };
  if (!store.isLegal(t.state, '已归档')) return { ok: false, error: `${t.state} 不可直接归档` };
  // 依赖悬空扫描（夜班推演 #5）：废弃前查未完成单里还挂着本单依赖的——不阻断，呼叫+留痕，防静默死锁
  const 悬空 = [];
  for (const s of ['草稿', '待投', '池', '在途', '质检', '待验收', '待定夺', '执行失败']) {
    for (const x of store.list(root, s)) {
      const d = x.fm.依赖; if (!d) continue;
      const arr = Array.isArray(d) ? d.map(String) : String(d).split(/[，,\s]+/).filter(Boolean);
      if (arr.includes(String(id))) 悬空.push(x.id);
    }
  }
  const r = store.move(root, id, t.state, '已归档', (fm) => { fm.归档原因 = '废弃'; }, nowIso());
  if (r.ok) {
    journal.append(root, `废弃 ${id}（${t.state}→已归档）${悬空.length ? ` · 依赖悬空：${悬空.join('、')} 需改挂` : ''}`);
    if (悬空.length) { try { require('./inbox').post(root, '急', '依赖悬空', `${id} 被废弃，${悬空.join('、')} 的依赖需改挂接棒单`, { 单号: id }); } catch { /* 信箱失败不阻塞 */ } }
  }
  return r;
}

// 收回：在途→池（清主办，退回布告栏，不算复活）。
function 收回(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '在途') return { ok: false, error: `只有在途单可收回（当前 ${t.state}）` };
  const r = store.move(root, id, '在途', '池', (fm) => { delete fm.主办; delete fm.领单时间; fm.放行 = false; }, nowIso()); // 收回=收权：撤放行旗（2026-08-05 语义分家：收回待重放行，重投带放行）
  if (r.ok) journal.append(root, `收回 ${id}（在途→池 · 清主办 · 撤放行）`);
  return r;
}

// 滞留检查（R3，用户修正：超时不自动撤回，改为诊断 + 告警）。
// 覆盖 执行中/质检/待定夺 三态：超时的单不移动，只标 滞留告警=true + 记账提醒，
// 由制作人在收件箱/在途面板看到后决定收回/等待/废弃。绝不自动改状态。
function 滞留检查(root, cfg, nowMs) {
  const 超时h = (cfg.闸值 || {}).滞留超时小时 ?? 4;
  const now = nowMs || Date.now();
  const 告警 = [];
  for (const state of ['在途', '质检', '待定夺']) {
    for (const t of store.list(root, state)) {
      if (['战役','专项'].includes(t.fm.父单类型) || ['战役','专项'].includes(t.fm.主办)) continue; // H53：父单在途=专项进行中的状态章，不适用执行滞留阈值
      const 基准 = Date.parse(t.fm.领单时间 || t.fm.更新时间 || '');
      if (Number.isNaN(基准)) continue;
      const 停留h = (now - 基准) / 3600000;
      if (停留h > 超时h) {
        if (!t.fm.滞留告警) { // 只记一次，不刷屏
          store.update(root, t.id, (fm) => { fm.滞留告警 = true; fm.滞留时长h = Math.round(停留h); }, new Date(now).toISOString());
          journal.append(root, `滞留告警 ${t.id}（${state} 停留 ${Math.round(停留h)}h，超 ${超时h}h）——请人工检查，未自动撤回`);
          inbox.post(root, '急', '滞留告警', `${t.id} ${state} 停留 ${Math.round(停留h)}h`, { 单号: t.id });
        }
        告警.push({ id: t.id, state, 停留h: Math.round(停留h) });
      }
    }
  }
  return { 告警 };
}

// 执行失败入位（D31）：纯本地目录改名，零网络依赖——执行器在 CLI 崩溃/超时/非零退出时调用。
// 不清主办（留作诊断线索）；执行失败不占在途口径，agent 自动空出。
function 执行失败(root, id, 原因) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '在途' && t.state !== '质检') return { ok: false, error: `当前不可标执行失败（${t.state}）` };
  const r = store.move(root, id, t.state, '执行失败', (fm) => {
    fm.失败原因 = String(原因 || '未知').slice(0, 200);
    fm.失败次数 = (Number(fm.失败次数) || 0) + 1;
    fm.失败时间 = nowIso();
  }, nowIso());
  if (r.ok) { journal.append(root, `执行失败 ${id}（${t.state}→执行失败 · ${String(原因 || '').slice(0, 60)}）——待 Claude 分诊`); inbox.post(root, '急', '执行失败', `${id} ${String(原因 || '').slice(0, 80)}`, { 单号: id }); }
  return r;
}

// 失败分诊（D31 三出路，Claude/用户操作）：重投（清执行痕迹回池）/ 上呈（待定夺给用户）/ 废弃走通用 废弃()。
function 失败分诊(root, id, 决定) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '执行失败') return { ok: false, error: `当前不在执行失败（${t.state}）` };
  if (决定 === '重投') {
    const r = store.move(root, id, '执行失败', '池', (fm) => { delete fm.主办; delete fm.领单时间; delete fm.交付时间; fm.放行 = true; }, nowIso()); // 重投=明确指令：带放行旗过迁移（2026-08-05）
    if (r.ok) journal.append(root, `失败分诊 ${id}：重投（执行失败→池 · 清主办 · 带放行重新可派）`);
    return r;
  }
  if (决定 === '上呈') {
    const r = store.move(root, id, '执行失败', '待定夺', null, nowIso());
    if (r.ok) journal.append(root, `失败分诊 ${id}：上呈（执行失败→待定夺 · 需用户拍板）`);
    return r;
  }
  return { ok: false, error: `未知决定：${决定}（重投/上呈，废弃走通用废弃）` };
}

// 上游改动标记（复查#8 = D36）：策划案锚号改版 → 引用它的未完成单全部标待复核。
// 被标记的单：池中不可领、在途不起新执行、交产出被拒——直到核对新版后解除。
function 标记待复核(root, 锚号, 说明) {
  const trace = require('./trace');
  const hits = trace.affectedByRef(root, 锚号);
  const now = nowIso();
  for (const h of hits) store.update(root, h.id, (fm) => { fm.待复核 = { 锚号, 说明: String(说明 || '').slice(0, 120), 标记时间: now }; }, now);
  journal.append(root, `上游改动标记 ${锚号}：${hits.length} 张未完成单标待复核（${hits.map((h) => h.id).join('、') || '无命中'}）`);
  return { ok: true, 命中: hits };
}
function 解除待复核(root, id, 确认说明) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (!t.fm.待复核) return { ok: false, error: '该单没有待复核标记' };
  const 锚 = t.fm.待复核.锚号;
  store.update(root, id, (fm) => { delete fm.待复核; fm.复核确认 = { 锚号: 锚, 时间: nowIso(), 说明: String(确认说明 || '已核对新版') }; }, nowIso());
  journal.append(root, `解除待复核 ${id}（${锚} 已核对新版）`);
  return { ok: true };
}

// 返工（D6）：归档旧单 + 建新草稿（带返工自回链）。旧单永不复活。
// 下游依赖自动接续：引用旧单的未终态单，依赖改指新单——否则它们会永远等一张已归档的单
// （地图 L0 实战教训：TK-19 返工后 TK-21 卡死，当时靠手工 撤回→改→重投 解救）。
function 返工(root, oldId, newId, fm, body) {
  const old = store.find(root, oldId);
  if (!old) return { ok: false, error: '旧单不存在' };
  if (store.isLegal(old.state, '已归档')) {
    store.move(root, oldId, old.state, '已归档', (f) => { f.归档原因 = '返工替代'; }, nowIso());
  }
  const nfm = { ...fm, 返工自: oldId, 创建时间: fm.创建时间 || nowIso().slice(0, 10), 更新时间: nowIso() };
  const r = store.create(root, newId, nfm, body);
  if (!r.ok) return r;
  const 接续 = [];
  for (const s of store.STATES) {
    if (store.TERMINAL.includes(s)) continue;
    for (const t of store.list(root, s)) {
      const deps = t.fm.依赖;
      if (!deps) continue;
      const arr = Array.isArray(deps) ? deps.map(String) : String(deps).split(/[，,\s]+/).filter(Boolean);
      if (!arr.includes(oldId)) continue;
      const next = arr.map((d) => (d === oldId ? newId : d)).join('，');
      store.update(root, t.id, (f) => { f.依赖 = next; });
      接续.push(t.id);
    }
  }
  journal.append(root, `返工 ${oldId} → 新单 ${newId}（归档旧 + 开新草稿${接续.length ? ` · 下游依赖接续：${接续.join('/')}` : ''}）`);
  return { ...r, 依赖接续: 接续 };
}

// ---- 推翻重做（制作人专权·审批点）：完成/已归档单翻案 = 自动编号返工 ----
// D6 一脉：旧单归档不复活，新草稿带返工链与打回理由，制作人补充要求后再定稿投池。
function 推翻(root, id, 理由) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (!['完成', '已归档'].includes(t.state)) return { ok: false, error: `推翻只针对完成/已归档单（当前 ${t.state}，用打回/废弃）` };
  if (!String(理由 || '').trim()) return { ok: false, error: '推翻必须写理由（历史要能回答"为什么翻案"）' };
  const m = String(id).match(/^(.+)-(\d+)$/);
  if (!m) return { ok: false, error: '编号不含序号，无法自动派新号' };
  let mx = 0;
  for (const s of store.STATES) for (const x of store.list(root, s)) {
    const mm = String(x.id).match(/^(.+)-(\d+)$/);
    if (mm && mm[1] === m[1]) mx = Math.max(mx, Number(mm[2]));
  }
  const newId = `${m[1]}-${mx + 1}`;
  const fm = {
    id: newId, title: `${t.fm.title}（推翻重做）`, 职能: t.fm.职能, 产出物类型: t.fm.产出物类型,
    优先级: t.fm.优先级 || 'P1', 规模: t.fm.规模 || '单兵', QA: t.fm.QA || '开',
    验收方式: t.fm.验收方式 || '保留', 预计时间: t.fm.预计时间 || '', 预计token: '',
    项目: t.fm.项目, ...(t.fm.阶段 ? { 阶段: t.fm.阶段 } : {}), ...(t.fm.父单 ? { 父单: t.fm.父单 } : {}),
    ...(t.fm.依赖 ? { 依赖: t.fm.依赖 } : {}),
  };
  const body = `## 推翻理由（制作人）\n${String(理由).trim()}\n\n${t.body || ''}`;
  // 完成→已归档 不在常规状态机里（完成=成功终态）——翻案是制作人特权，此处强制归档
  if (t.state === '完成') store.move(root, id, '完成', '已归档', (f) => { f.归档原因 = '推翻替代（制作人翻案）'; }, nowIso());
  const r = 返工(root, id, newId, fm, body);
  if (r.ok) journal.append(root, `推翻重做 ${id} → ${newId}（制作人翻案：${String(理由).trim().slice(0, 60)}）`);
  return r.ok ? { ...r, 新单: newId } : r;
}

// ---- 隐藏归档（制作人专权）：已归档单从一切默认视图湮灭，纸面仍在可考 ----
function 隐藏(root, id, 值) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '已归档') return { ok: false, error: `只有已归档单可隐藏（当前 ${t.state}）` };
  const on = 值 !== false;
  const r = store.update(root, id, (fm) => { if (on) fm.隐藏 = true; else delete fm.隐藏; });
  if (r.ok) journal.append(root, `隐藏归档 ${id} → ${on ? '隐藏（默认视图不再渲染）' : '取消隐藏'}`);
  return r;
}

module.exports = {
  定稿, 投池, 交产出, QA裁定, 定夺, 验收, 撤回, 废弃, 收回, 滞留检查, 返工, 执行失败, 失败分诊,
  标记待复核, 解除待复核, 推翻, 隐藏,
};
