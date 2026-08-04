// pm/wake.js — 项管事件唤醒接线（H49：判断才唤醒，规则不唤醒）
// 三根线：①战役父单定稿→自动切单 ②战役全落袋→收口报告 ③连环失败→上呈事件
// LLM 调用全部异步火后不理；事件与去重标记落台账（透明化+崩溃安全）。
const store = require('../core/store');
const ledger = require('./ledger');
const journal = require('../journal');

const DONE = new Set(['完成', '已归档']);

function isCampaign(t) { return t && t.fm && ['战役','专项'].includes(t.fm.父单类型); }

function childrenOf(root, parentId) {
  const out = [];
  for (const s of store.STATES) for (const t of store.list(root, s)) {
    if (t.fm.父单 === parentId) out.push({ ...t, state: s });
  }
  return out;
}

// ① 战役父单定稿 → 自动切单（拍板的下半步）
function onCampaignFinalized(root, cfg, t, projPath, opts = {}) {
  if (!isCampaign(t)) return { woke: false };
  ledger.event(root, '切单启动', { 父单: t.id, 触发: '定稿自动' });
  journal.append(root, `项管唤醒：${t.id} 专项定稿 → 自动切单（fable）`);
  if (!opts.test) {
    require('./brain').cut(root, cfg, t.id, projPath, (r) => {
      journal.append(root, r.ok ? `项管切单完成：${t.id} → ${r.子单.join('、')}（简报待审）` : `项管切单失败：${t.id}（${r.error}）`);
      if (!r.ok) ledger.event(root, '切单失败', { 父单: t.id, error: r.error });
    });
  }
  return { woke: true };
}

// ② 战役全落袋 → 收口报告（每 tick 巡一遍，台账标记去重）
// 父单状态诚实映射（H53 案：父单不该躺在待投/草稿装「待投」）：
// 首个子单派发 → 父单 在途（战役开打）；全落袋+收口 → 父单 待验收（战役签字位）。
function onChildDispatched(root, parentId) {
  if (!parentId) return;
  const p = store.find(root, parentId);
  if (!p || !isCampaign(p) || p.state !== '待投') return;
  const r = store.move(root, parentId, '待投', '在途', (fm) => { fm.主办 = '专项'; fm.领单时间 = fm.领单时间 || new Date().toISOString(); }, new Date().toISOString());
  if (r.ok) journal.append(root, `专项启动 ${parentId}（首子单派发 → 父单在途，H53 状态诚实映射）`);
}

function checkCloseouts(root, cfg, opts = {}) {
  const woke = [];
  const l = ledger.read(root);
  l.已收口 = l.已收口 || {};
  for (const s of ['在途', '待投', '草稿']) {
    for (const p of store.list(root, s)) {
      if (!isCampaign(p) || l.已收口[p.id]) continue;
      const kids = childrenOf(root, p.id);
      if (!kids.length) continue;
      if (!kids.every((k) => DONE.has(k.state))) continue;
      if (!kids.some((k) => k.state === '完成')) continue;
      l.已收口[p.id] = true;
      ledger.write(root, l);
      ledger.event(root, '收口待验', { 父单: p.id, 子单数: kids.length });
      journal.append(root, `项管唤醒：${p.id} 专项全部完成 → 收口报告生成中`);
      woke.push(p.id);
      const lift = () => { // 收口后父单上待验收：战役唯一签字位（保留签字上移，H53）
        const cur = store.find(root, p.id);
        if (cur && ['在途', '待投'].includes(cur.state)) {
          const mv = store.move(root, p.id, cur.state, '待验收', (fm) => { fm.交付时间 = new Date().toISOString(); }, new Date().toISOString());
          if (mv.ok) { journal.append(root, `专项收口 ${p.id} → 待验收（父单=唯一签字位，H53）`); require('../inbox').post(root, '急', '专项待签', `${p.id} 收口完毕，待制作人签字`, { 单号: p.id }); }
        }
      };
      if (!opts.test) {
        require('./brain').closeout(root, cfg, p.id, (r) => {
          journal.append(root, r.ok ? `收口报告就绪：${p.id}（${r.报告}）` : `收口报告失败：${p.id}（${r.error}）`);
          lift();
        });
      } else lift();
    }
  }
  return woke;
}

// ③ 连环失败 → 上呈事件（同战役 ≥2 次执行失败/三振；机械检测，归因由制作人层跟进）
function checkChainFailures(root, opts = {}) {
  const alerts = [];
  const l = ledger.read(root);
  l.已上呈连环 = l.已上呈连环 || {};
  const byParent = {};
  for (const s of ['执行失败', '待定夺']) {
    for (const t of store.list(root, s)) {
      const p = t.fm.父单 || '（无父单）';
      (byParent[p] = byParent[p] || []).push(t.id);
    }
  }
  for (const [p, ids] of Object.entries(byParent)) {
    if (ids.length >= 2 && !l.已上呈连环[p]) {
      l.已上呈连环[p] = true;
      ledger.write(root, l);
      ledger.event(root, '上呈', { 父单: p, 异常单: ids, 因: '连环失败/三振 ≥2' });
      journal.append(root, `项管上呈：${p} 连环异常（${ids.join('、')}）——需制作人层跟进`);
      alerts.push(p);
    }
  }
  return alerts;
}

module.exports = { onCampaignFinalized, onChildDispatched, checkCloseouts, checkChainFailures, isCampaign, childrenOf };
