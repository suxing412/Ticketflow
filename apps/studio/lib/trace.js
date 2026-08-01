// trace.js — 四追溯链（D15）：父子 / 返工 / 依据 / 依赖。
const store = require('./core/store');

function toArr(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : String(v).split(/[，,\s]+/).filter(Boolean);
}

function chains(root, id) {
  const t = store.find(root, id);
  if (!t) return null;
  const fm = t.fm;
  const 子 = [];
  for (const s of store.STATES) {
    for (const c of store.list(root, s)) {
      if (c.fm.父单 === id) 子.push({ id: c.id, state: c.state, title: c.fm.title });
    }
  }
  return {
    父子: { 父: fm.父单 || null, 子 },
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

module.exports = { chains, affectedByRef, toArr, migrateAnchor };
