// lifecycle.js — 高层生命周期动作（D5/D6/D8/D10/D13）。每个动作 = 一次合法状态转移 + 记账。
// 只做控制流；产出资产由执行 agent 写进项目仓库，回执写进 回执/。
const fs = require('fs');
const path = require('path');
const store = require('./core/store');
const journal = require('./journal');

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
  const qaOn = String(t.fm.QA) === '开';
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
  if (r.ok) journal.append(root, `QA 修不好 ${id} → 待定夺（四件套呈你我）`);
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
  const r = store.move(root, id, '待定夺', to, null, nowIso());
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
  const r = store.move(root, id, t.state, '已归档', (fm) => { fm.归档原因 = '废弃'; }, nowIso());
  if (r.ok) journal.append(root, `废弃 ${id}（${t.state}→已归档）`);
  return r;
}

// 收回：在途→池（清主办，退回布告栏，不算复活）。
function 收回(root, id) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '在途') return { ok: false, error: `只有在途单可收回（当前 ${t.state}）` };
  const r = store.move(root, id, '在途', '池', (fm) => { delete fm.主办; delete fm.领单时间; }, nowIso());
  if (r.ok) journal.append(root, `收回 ${id}（在途→池 · 清主办）`);
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
      const 基准 = Date.parse(t.fm.领单时间 || t.fm.更新时间 || '');
      if (Number.isNaN(基准)) continue;
      const 停留h = (now - 基准) / 3600000;
      if (停留h > 超时h) {
        if (!t.fm.滞留告警) { // 只记一次，不刷屏
          store.update(root, t.id, (fm) => { fm.滞留告警 = true; fm.滞留时长h = Math.round(停留h); }, new Date(now).toISOString());
          journal.append(root, `滞留告警 ${t.id}（${state} 停留 ${Math.round(停留h)}h，超 ${超时h}h）——请人工检查，未自动撤回`);
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
  if (r.ok) journal.append(root, `执行失败 ${id}（${t.state}→执行失败 · ${String(原因 || '').slice(0, 60)}）——待 Claude 分诊`);
  return r;
}

// 失败分诊（D31 三出路，Claude/用户操作）：重投（清执行痕迹回池）/ 上呈（待定夺给用户）/ 废弃走通用 废弃()。
function 失败分诊(root, id, 决定) {
  const t = store.find(root, id);
  if (!t) return { ok: false, error: '不存在' };
  if (t.state !== '执行失败') return { ok: false, error: `当前不在执行失败（${t.state}）` };
  if (决定 === '重投') {
    const r = store.move(root, id, '执行失败', '池', (fm) => { delete fm.主办; delete fm.领单时间; delete fm.交付时间; }, nowIso());
    if (r.ok) journal.append(root, `失败分诊 ${id}：重投（执行失败→池 · 清主办重新可领）`);
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
function 返工(root, oldId, newId, fm, body) {
  const old = store.find(root, oldId);
  if (!old) return { ok: false, error: '旧单不存在' };
  if (store.isLegal(old.state, '已归档')) {
    store.move(root, oldId, old.state, '已归档', (f) => { f.归档原因 = '返工替代'; }, nowIso());
  }
  const nfm = { ...fm, 返工自: oldId, 创建时间: fm.创建时间 || nowIso().slice(0, 10), 更新时间: nowIso() };
  const r = store.create(root, newId, nfm, body);
  if (r.ok) journal.append(root, `返工 ${oldId} → 新单 ${newId}（归档旧 + 开新草稿）`);
  return r;
}

module.exports = {
  定稿, 投池, 交产出, QA裁定, 定夺, 验收, 撤回, 废弃, 收回, 滞留检查, 返工, 执行失败, 失败分诊,
  标记待复核, 解除待复核,
};
