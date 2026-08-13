// trace.js — 四追溯链（D15）：父子 / 返工 / 依据 / 依赖。
const store = require('./core/store');

function toArr(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : String(v).split(/[，,\s]+/).filter(Boolean);
}

// 状态→完成度：与前端 STPCT 逐值同表。
// 施工令-028 树形退役后，子单层级一览搬进父单详情页，「进度」这把尺必须还是原来那把——
// 口径漂了，同一张父单在退役前后会给出两个数，那比没有进度条更糟。
const STPCT = { 草稿: 0, 待投: 0, 池: 0, 在途: 60, 质检: 85, 待定夺: 70, 执行失败: 60, 待验收: 90, 完成: 100, 已归档: 0 };

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
    // 待验收：批量验收子单的射程清单（规则见 待验收子单()）。摆进链里是为了**前端不再自己推一遍规则**——
    // 同一条过滤条件写两处，迟早有一处漏改，那是批量动作最不该出现的事。
    父子: { 父: fm.父单 || null, 子, 待验收: 子.filter((x) => x.state === '待验收').map((x) => x.id) },
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
  const active = ['草稿', '待投', '池', '在途', '质检', '待验收', '待定夺'];
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
  const active = ['草稿', '待投', '池', '在途', '质检', '待验收', '待定夺'];
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
