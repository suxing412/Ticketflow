// trace.js — 四追溯链（D15）：父子 / 返工 / 依据 / 依赖。
const store = require('./core/store');

function toArr(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : String(v).split(/[，,\s]+/).filter(Boolean);
}

// 状态→完成度：与前端 STPCT 逐值同表（前端表归 C 组同步，两表分叉即 bug）。
// H108 三大态改造后的对照（逐态溯源旧值，别无脑替换）：
//   待审0(原草稿) · 待派0(原待投/池) · 待重派0(回队重排，与原 池 同档) ·
//   待处理60(原 执行失败60/待定夺70 合并，取执行档——活还在) · 在途60 · 初检85(原质检) ·
//   核查90/仲裁90(原待验收档：判官链末段) · 完成100(专项内部「做完等关账」即算做完) ·
//   归档100(H108 归档=落袋，验收过的账；原 已归档0 是「打回/废弃混居」的旧口径，语义已分家) ·
//   挂起0(冻结不产出) · 废弃0
const STPCT = { 待审: 0, 待派: 0, 待处理: 60, 待重派: 0, 在途: 60, 初检: 85, 核查: 90, 仲裁: 90, 完成: 100, 归档: 100, 挂起: 0, 废弃: 0 };

function chains(root, id) {
  const t = store.find(root, id);
  if (!t) return null;
  const fm = t.fm;
  // 全库快照建一次索引：原实现本就在扫全状态找子单，这里顺带把父子表建出来给进度递归用。
  const all = [];
  for (const s of store.STATES) for (const c of store.list(root, s)) all.push(c);
  const kids = {};
  for (const c of all) if (c.fm.父单) (kids[c.fm.父单] = kids[c.fm.父单] || []).push(c);
  // 进度递归口径与退役前的树形逐字一致：叶子取状态完成度，父单取直系子单进度均值（逐层聚合，
  // 不被"容器子单"拉成 0%）。depth 上限是成环兜底——父子字段是人写的，环不是不可能。
  const pctOf = (tk, depth) => {
    const ch = kids[tk.id];
    if (!ch || !ch.length || depth > 10) return STPCT[tk.state] ?? 0;
    return Math.round(ch.reduce((a, c) => a + pctOf(c, depth + 1), 0) / ch.length);
  };
  const 子 = (kids[id] || []).map((c) => ({
    id: c.id, state: c.state, title: c.fm.title,
    职能: c.fm.职能 || null, 执行池: c.fm.执行池 || null,
    进度: pctOf(c, 0), 子数: (kids[c.id] || []).length,
  }));
  // 专项归属（H103 · 施工令-058）：容器已实体化，子单的容器不再是一张能点进去的工单。
  // 不随行这一格，专项子单的详情页就成了孤儿——「这张单属于哪批活」在页面上无处可读。
  let 专项 = null;
  if (fm.专项) {
    try {
      const s = require('./specials').find(root, String(fm.专项));
      专项 = { id: String(fm.专项), 名称: s ? (s.fm.名称 || s.id) : null, 状态: s ? (s.fm.状态 || null) : null, 在册: !!s };
    } catch { 专项 = { id: String(fm.专项), 名称: null, 状态: null, 在册: false }; }
  }
  return {
    // 待验收：批量验收子单的射程清单。H108 后「待验收」态并入「完成」（完成=判官过、停验收闸前），
    // 键名保留（射程语义没变：等制作人/总监验收的直系子单），过滤条件改认 完成。
    // 摆进链里是为了**前端不再自己推一遍规则**——同一条过滤条件写两处，迟早有一处漏改。
    父子: { 父: fm.父单 || null, 子, 待验收: 子.filter((x) => x.state === '完成').map((x) => x.id) },
    专项,
    返工自: fm.返工自 || null,
    依据: fm.依据 || null,
    依赖: toArr(fm.依赖).map((d) => { const x = store.find(root, d); return { id: d, state: x ? x.state : '缺失' }; }),
  };
}

// 改上游联动（D15 人工制）：给定被改的依据锚（如 "战斗系统#战斗-03"），
// 扫描所有未完成单里 依据 命中该锚的，列出受影响清单交你我定夺。机器只提示不自动改。
function affectedByRef(root, refKey) {
  const hits = [];
  // H108 未落账态全集 = STATES − TERMINAL(归档/废弃)：含 完成（判官过而已，未验收，上游改版仍须复核）
  // 与 挂起（会复活，复活后依据同样过期）。原表 ['草稿','待投','池','在途','质检','待验收','待定夺']。
  const active = store.STATES.filter((s) => !store.TERMINAL.includes(s));
  for (const s of active) {
    for (const t of store.list(root, s)) {
      if (t.fm.依据 && String(t.fm.依据).includes(refKey)) hits.push({ id: t.id, state: s, 依据: t.fm.依据, title: t.fm.title });
    }
  }
  return hits;
}

// 锚号迁移（R5）：改编号 = 主动广播。声明 旧锚号→新锚号，扫全库所有 依据 引用旧锚号的
// 未完成工单，逐个把 依据 更新为新锚号 + 记账。返回受影响清单（= 全局通知）。
// docKey 可选：限定只迁某文档的锚（如 '战斗系统'）；不传则全匹配旧锚字符串。
function migrateAnchor(root, oldRef, newRef, docKey) {
  const store = require('./core/store');
  const journal = require('./journal');
  const active = store.STATES.filter((s) => !store.TERMINAL.includes(s)); // 口径同 affectedByRef（H108）
  const 命中 = [];
  const key = docKey ? `${docKey}#${oldRef}` : oldRef;
  const now = new Date().toISOString();
  for (const s of active) {
    for (const t of store.list(root, s)) {
      if (t.fm.依据 && String(t.fm.依据).includes(oldRef)) {
        const 新值 = String(t.fm.依据).split(oldRef).join(newRef);
        store.update(root, t.id, (fm) => { fm.依据 = 新值; }, now);
        journal.append(root, `锚号迁移：${t.id} 依据 ${key} → ${newRef}`);
        命中.push({ id: t.id, state: s, 旧: t.fm.依据, 新: 新值 });
      }
    }
  }
  journal.append(root, `锚号迁移广播完成：${oldRef} → ${newRef}，更新 ${命中.length} 张工单`);
  return { oldRef, newRef, 更新数: 命中.length, 清单: 命中 };
}

module.exports = { chains, affectedByRef, toArr, migrateAnchor, STPCT };
