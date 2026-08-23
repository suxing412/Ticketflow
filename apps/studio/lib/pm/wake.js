// pm/wake.js — 项管事件唤醒接线（H49：判断才唤醒，规则不唤醒）
// 三根线：①战役父单定稿→自动切单 ②战役全落袋→收口报告 ③连环失败→上呈事件
// LLM 调用全部异步火后不理；事件与去重标记落台账（透明化+崩溃安全）。
const store = require('../core/store');
const ledger = require('./ledger');
const journal = require('../journal');

// H108 终态集合按语义逐个判：收口问的是「子单还欠不欠工」。专项内部子单到「完成」即算
// 做完等关账（在途大态出口驻留位）；归档=落袋；废弃=判死不欠工（旧制废弃走 已归档 也算 DONE，
// 目录独立后要显式列入，否则一张废弃子单会把整个专项的收口卡死）。挂起可逆、仍欠工，不算。
const DONE = new Set(['完成', '归档', '废弃']);

function isCampaign(t) { return t && t.fm && ['战役','专项'].includes(t.fm.父单类型); }

// 子单盘点：两条挂链一起认（施工令-058）——`专项: S-n` 是新路，`父单: TK-n` 是存量战役老路。
// 收口/连环检测/收口报告全走这一份，判据只此一处：两处各写一份判据，迟早有一处漏认一条挂链。
function childrenOf(root, parentId) {
  const specials = require('../specials');
  // 专项号走注册表那份归属判据（显式 专项 章 + 别名兜底），不在这里另写一套。
  if (specials.是专项号(parentId)) return specials.子单(root, parentId);
  const out = [];
  for (const s of store.STATES) for (const t of store.list(root, s)) {
    if (t.fm.父单 === parentId && !t.fm.迁移至专项) out.push({ ...t, state: s });
  }
  return out;
}

// 切单结果落账（施工令-054 · TK-146 案）：切单有**三个**出口，不是两个。
//   切成 → 子单已建，简报待审（brain.cut 里已落 待审 事件）
//   拒切候期 → 模型判「现在不该切」（承重方案未落袋/前置在途/需求含糊）。这是判断力的产出：
//              记「切单候期」事件存判语全文、父单原位不动等复切，**不记失败**——TK-146 就是
//              判语被当坏输出吞了，父单纪律明写候期而机器记了一笔失败，还没人看得到理由。
//   真失败 → 空输出/格式坏到既无 ticket 块又无判语块，照旧记「切单失败」。
// 抽成导出函数而非留在回调里：三分支的落账口径必须能单测，而回调在 opts.test 下根本不跑。
// 两条调用链（定稿自动唤醒 / server.js 手工切单 API）共用这一份，免得出口在一边合法在另一边失败。
function onCutResult(root, parentId, r = {}) {
  if (r.ok) {
    journal.append(root, `项管切单完成：${parentId} → ${(r.子单 || []).join('、')}（简报待审）`);
    return { 出口: '切成' };
  }
  if (r.候期) {
    const 理由 = String(r.理由 || '').trim();
    const 时机 = String(r.复切时机 || '').trim();
    ledger.event(root, '切单候期', { 父单: parentId, 理由, 复切时机: 时机, 判语: r.判语 || '' });
    journal.append(root, `项管拒切候期：${parentId}——${理由 || '未述理由'}；建议复切时机：${时机 || '未述'}（父单原位不动，等条件齐了复切）`);
    // 存档不等于呈报：判语落了台账还得让制作人看见，否则等于换个地方吞（TK-146 的下半截病）。
    // relay 单条硬顶 4000 字且超限是**静默拒收**（返 ok:false 不抛），所以这里先自剪——
    // 宁可信道上是节选（全文在台账事件里），也不要整条呈报凭空消失。
    try {
      const 头 = `拒切候期：${parentId}（父单原位不动，未记失败）\n\n理由：${理由 || '（未述）'}\n建议复切时机：${时机 || '（未述）'}\n\n`;
      const 余 = 3900 - 头.length;
      const 正 = String(r.判语 || '（无判语正文）');
      require('../relay').append(root, '项管', 头 + (正.length > 余 ? 正.slice(0, 余) + '…（判语全文见台账事件「切单候期」）' : 正));
    } catch { /* 信道失败不阻塞落账 */ }
    return { 出口: '候期', 理由, 复切时机: 时机 };
  }
  const err = r.error || '未知错误';
  journal.append(root, `项管切单失败：${parentId}（${err}）`);
  ledger.event(root, '切单失败', { 父单: parentId, error: err });
  return { 出口: '失败', error: err };
}

// ①-旧 存量战役父单定稿 → 自动切单（拍板的下半步）
// 施工令-058 起这条只服务**存量战役号**：专项已实体化，它的切单挂钩迁到「立项」那一刻（见 ①-新）。
// 老路不拆是因为战役号明写「不迁移」（pm/ideas.js 命名分层注），拆了那批单就没人给它切了。
function onCampaignFinalized(root, cfg, t, projPath, opts = {}) {
  if (!isCampaign(t)) return { woke: false };
  ledger.event(root, '切单启动', { 父单: t.id, 触发: '定稿自动' });
  journal.append(root, `项管唤醒：${t.id} 战役父单定稿 → 自动切单（fable）`);
  if (!opts.test) {
    require('./brain').cut(root, cfg, t.id, projPath, (r) => onCutResult(root, t.id, r));
  }
  return { woke: true };
}

// ①-新 专项立项 → 自动切单（施工令-058 要件2：H49 的挂钩从「定稿」迁到「立项」）
// 为什么挂在立项而不是别处：专项已经不是工单，它没有「定稿」这一态可挂——注册表条目一旦成立，
// 该做的事就已经写在里头了，再等一个仪式性动作只是让人多点一次。候期切单（054 三出口）
// 语义原样保留：onCutResult 是同一份，拒切候期照旧不记失败、容器原位不动等复切。
function on专项立项(root, cfg, s, projPath, opts = {}) {
  if (!s || !s.id) return { woke: false };
  ledger.event(root, '切单启动', { 父单: s.id, 专项: s.id, 触发: '立项自动' });
  journal.append(root, `项管唤醒：${s.id}「${(s.fm || {}).名称 || ''}」专项立项 → 自动切单（fable）`);
  if (!opts.test) {
    require('./brain').cut(root, cfg, s.id, projPath, (r) => onCutResult(root, s.id, r));
  }
  return { woke: true };
}

// ② 战役全落袋 → 收口报告（每 tick 巡一遍，台账标记去重）
// 父单状态诚实映射（H53 案 · H108 改道）：首个子单派发 → 父单 在途（战役开打）；
// 全部子单做完+收口 → 父单 完成（出口驻留位=战役签字位，验收过再归档）。
function onChildDispatched(root, parentId, 专项号) {
  // 施工令-058：专项子单的容器不在工单目录里，走注册表那条推手（立项 → 进行）。
  if (专项号) { try { require('../specials').首派(root, 专项号); } catch { /* 注册表读写失败不阻塞派发 */ } }
  if (!parentId) return;
  const p = store.find(root, parentId);
  if (!p || !isCampaign(p) || p.state !== '待派') return; // H108：待投/池并入 待派
  const r = store.move(root, parentId, '待派', '在途', (fm) => { fm.主办 = '专项'; fm.领单时间 = fm.领单时间 || new Date().toISOString(); }, new Date().toISOString());
  if (r.ok) journal.append(root, `专项启动 ${parentId}（首子单派发 → 父单在途，H53 状态诚实映射）`);
}

function checkCloseouts(root, cfg, opts = {}) {
  const woke = [];
  const l = ledger.read(root);
  l.已收口 = l.已收口 || {};
  for (const s of ['在途', '待派', '待审']) { // H108：待投→待派、草稿→待审
    for (const p of store.list(root, s)) {
      if (!isCampaign(p) || l.已收口[p.id]) continue;
      const kids = childrenOf(root, p.id);
      if (!kids.length) continue;
      if (!kids.every((k) => DONE.has(k.state))) continue;
      if (!kids.some((k) => k.state === '完成' || k.state === '归档')) continue; // 至少一张真做成（完成=等关账/归档=落袋），全废弃不叫收口
      // 定点更新防丢账（2026-08-05）：不整写外层旧快照——长窗口内 billFee 等并发写会被覆盖
      let 首标 = false;
      ledger.update(root, (f) => { f.已收口 = f.已收口 || {}; if (!f.已收口[p.id]) { f.已收口[p.id] = true; 首标 = true; } });
      if (!首标) continue;
      ledger.event(root, '收口待验', { 父单: p.id, 子单数: kids.length });
      journal.append(root, `项管唤醒：${p.id} 专项全部完成 → 收口报告生成中`);
      woke.push(p.id);
      const lift = () => { // 收口后父单上「完成」：H108 出口驻留位=战役唯一签字位（保留签字上移，H53）
        const cur = store.find(root, p.id);
        if (cur && ['在途', '待派'].includes(cur.state)) {
          const iso = new Date().toISOString();
          // 待派没有直达完成的边（边表封闭性）：先过 在途 再落 完成，两步都走状态机不抄近路
          if (cur.state === '待派') store.move(root, p.id, '待派', '在途', (fm) => { fm.主办 = fm.主办 || '专项'; }, iso);
          const mv = store.move(root, p.id, '在途', '完成', (fm) => { fm.交付时间 = iso; }, iso);
          if (mv.ok) { journal.append(root, `专项收口 ${p.id} → 完成（父单=唯一签字位，H53/H108 验收闸前驻留）`); require('../inbox').post(root, '急', '专项待签', `${p.id} 收口完毕，待制作人签字`, { 单号: p.id }); }
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

// ②-新 专项收口巡检（施工令-058）：注册表实体版的 checkCloseouts。
// 与工单版的三处不同，都是实体分立带来的：
//   ① 容器不换目录——「收口」是注册表里的状态字段，不是搬一次文件；
//   ② 签字位不是 待验收 而是 关账（唯一人闸），所以这里只把容器推到 收口 并叫人，绝不代签；
//   ③ 收口后子单又活了会自动复工回 进行（specials.收口自检 一处判完）——工单版做不到这件事，
//      因为父单一旦挪进 待验收 就得靠人再挪回去。
function check专项收口(root, cfg, opts = {}) {
  const specials = require('../specials');
  const woke = [];
  let 表;
  try { 表 = specials.list(root); } catch { return woke; } // 注册表读不到＝这一拍没专项可巡，不是故障
  const l = ledger.read(root);
  l.已收口 = l.已收口 || {};
  const 快照 = opts.快照 || store.snapshot(root);
  for (const s of 表) {
    const r = specials.收口自检(root, s.id, { 快照 });
    if (!r || r.动作 !== '收口') continue;
    // 去重旗与工单版共用一本账（同名字段、同一份台账）：一个专项只生成一次收口报告。
    // 复工会把旗抹掉——不然复工后再落袋就再也出不了第二版报告，人只能对着旧报告签字。
    let 首标 = false;
    ledger.update(root, (f) => { f.已收口 = f.已收口 || {}; if (!f.已收口[s.id]) { f.已收口[s.id] = true; 首标 = true; } });
    if (!首标) continue;
    ledger.event(root, '收口待验', { 父单: s.id, 专项: s.id, 子单数: r.子单数 });
    journal.append(root, `项管唤醒：${s.id}「${s.fm.名称 || ''}」全部子单落袋 → 收口报告生成中（候关账签字）`);
    woke.push(s.id);
    const 叫人 = (报告) => {
      if (报告) specials.update(root, s.id, (fm) => { fm.收口报告 = 报告; });
      try { require('../inbox').post(root, '急', '专项待关账', `${s.id}「${s.fm.名称 || ''}」收口完毕，待制作人关账签字`, { 单号: s.id }); } catch { /* 信箱失败不阻塞 */ }
    };
    if (!opts.test) {
      require('./brain').closeout(root, cfg, s.id, (rr) => {
        journal.append(root, rr.ok ? `收口报告就绪：${s.id}（${rr.报告}）` : `收口报告失败：${s.id}（${rr.error}）`);
        叫人(rr.ok ? rr.报告 : null);
      });
    } else 叫人(null);
  }
  // 复工把去重旗抹掉：单独走一遍，免得跟上面那圈的 continue 纠缠。
  for (const s of 表) {
    const cur = specials.find(root, s.id);
    if (cur && cur.fm.状态 === '进行' && (ledger.read(root).已收口 || {})[s.id]) {
      ledger.update(root, (f) => { if (f.已收口) delete f.已收口[s.id]; });
      journal.append(root, `专项复工 ${s.id}：收口旗已撤，全部子单再落袋时会重出收口报告`);
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
  for (const s of ['待处理']) { // H108：执行失败/待定夺（三振落点）都并入 待处理，一处扫全
    for (const t of store.list(root, s)) {
      const p = t.fm.父单 || '（无父单）';
      (byParent[p] = byParent[p] || []).push(t.id);
    }
  }
  for (const [p, ids] of Object.entries(byParent)) {
    if (ids.length >= 2 && !l.已上呈连环[p]) {
      // 定点更新防丢账（2026-08-05）：同 checkCloseouts
      let 首呈 = false;
      ledger.update(root, (f) => { f.已上呈连环 = f.已上呈连环 || {}; if (!f.已上呈连环[p]) { f.已上呈连环[p] = true; 首呈 = true; } });
      if (!首呈) continue;
      ledger.event(root, '上呈', { 父单: p, 异常单: ids, 因: '连环失败/三振 ≥2' });
      journal.append(root, `项管上呈：${p} 连环异常（${ids.join('、')}）——需制作人层跟进`);
      alerts.push(p);
    }
  }
  return alerts;
}

// ④ 池衡巡检（H99 · 施工令-045）：读三池额度 → 决策 → 受限动作落配置。
// 挂在这儿而不是 runner.tick 里，是因为它**不是派发路径的一环**：一次外呼（额度/余额）+ 一次判断，
// 15 分钟一拍足矣；塞进 tick（默认 30s 一轮）只会把外呼频次抬高 30 倍，换不来任何实时性。
// 判断力全在 poolbalance 的纯函数里，这里只做编排：取数 → 巡检 → 回一份摘要给调用方留痕。
// 任何一步失败都只回结果不抛：池衡是**优化面**，它挂了不该把 15 分钟巡检的其余项带崩。
async function 池衡巡检(root, cfg, opts = {}) {
  const pb = require('./poolbalance');
  const 参 = pb.参数(cfg);
  if (!参.开) return { 开: false, 说明: '池衡自动平衡已关（studio.config.json · 池衡.开）' };
  let 读数 = null;
  try { 读数 = opts.读数 || await pb.采集(root, cfg, opts); } catch (e) { return { 开: true, error: '读数采集失败：' + String(e.message).slice(0, 80) }; }
  let r;
  try { r = pb.巡检(root, cfg, 读数, opts); } catch (e) { return { 开: true, error: '池衡巡检异常：' + String(e.message).slice(0, 80) }; }
  const 动 = r.切.length + r.回退.length;
  if (动) {
    journal.append(root, `池衡巡检：切换 ${r.切.length} 处 · 回退 ${r.回退.length} 处`
      + `（${[...r.切, ...r.回退].map((d) => `${d.位} ${d.从}→${d.到}`).join('；')}）——只影响此后新派发的会话`);
  }
  return { 开: true, 读数, ...r };
}

// ⑤ 台账对齐拍（H102 · 施工令-052）：工单实况 ↔ 排程台账粒的差量对齐。
// 案源：编辑器专项 11 张子单，台账只见 5 粒——156~161 六张总监忘登。手工登粒废止，改由机器盯。
// 挂在 runner.tick 这条**既有**巡检环上（30s 一轮），判频由 ledger-sync 自己决（事件去抖 30s
// + 5 分钟例行兜底）。不另起 setInterval：多一根定时器就多一处崩溃恢复要管，而这活对实时性
// 的要求（分钟级）远低于 tick 本身的频率，蹭现成的环足矣。
// 一律只回结果不抛：对齐是账，账记不上不该把派发主干带崩（同 checkCloseouts 待遇）。
function 台账对齐拍(root, opts = {}) {
  try {
    return require('./ledger-sync').拍(root, opts);
  } catch (e) {
    journal.append(root, `台账对齐拍异常：${String(e.message).slice(0, 80)}`);
    return { 触发: null, error: String(e.message).slice(0, 80) };
  }
}

module.exports = { onCampaignFinalized, on专项立项, onCutResult, onChildDispatched,
  checkCloseouts, check专项收口, checkChainFailures, isCampaign, childrenOf, 池衡巡检, 台账对齐拍 };
