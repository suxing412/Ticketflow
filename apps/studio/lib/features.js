// features.js — 特性注册表（四层架构第二层；制作人 2026-08-20 10:12–11:16 拍板）
//
// 案源：S-1「地图手修编辑器专项」被机器推到「收口」并催制作人关账，可编辑器交互层正被 S-3 重构。
// 制作人指认根因——**「特性」这一层缺失**，导致常驻工件（编辑器）被硬塞进有始有终的容器（专项）。
// 四层：管线 P-n（系统）→ 特性 F-n（系统下的功能/规则）→ 专项 S-n（一段活）→ 工单（最小单元）。
//
// 与相邻两层的分界（制作人原话与 H52 实体分立律共同定的）：
//   · 对上（管线）：管线有「阶段 L0/L1/L2」这一生产阶段概念，特性没有；**开线是制作人人闸，
//     开特性下放项管**（生成方式不同即生命周期不同）。若合为一体，制作人得为「地图系统里
//     有『水体』这么一块」这种事签字——那是把他拖回项管的活里。
//   · 对下（专项）：**专项是「一段活」所以有终点**（立项→进行→收口→关账）；
//     **特性是「一个东西」所以只有在不在册**。特性不会「完成」，只会「不再维护」。
//
// 状态只有三个，判据是「**只存推导不出来的**」（制作人 11:15 定）：
//   待审 —— 项管提请、总监未审。这是个**审批事实**，任何子层数据都反映不出来。行为差别：挂不了单。
//   活跃 —— 正常态，可挂单。
//   封存 —— 不再接新活（被取代或方向废弃）。**封存 ≠ 做完，更 ≠ 删除**：历史照常在树里可查，
//           只是灰掉、排最后、不接新单——「这个功能当初怎么做的、后来为什么被取代」本身就是要查的东西。
// **进度字段一个不存**：做到几成/在不在做/做完没有，全从子专项与子单推导。存了就是第二个事实源，
// 而那正是 08-19 审计查出 148 条账实分叉的病根。
//
// 禁预规划（制作人 11:12 定）：**特性是被活撑出来的，不是设计出来的**。提请必须附至少一个
// 「现在就要挂进来」的对象（一个专项或一组单号），附不出即拒——否则会造出一堆空特性。
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const DIR = (root) => path.join(root, '特性');
const STATES = ['待审', '活跃', '封存'];
// 转移表：待审→活跃（总监审过）或 →封存（审不过就地封，留痕不删）；活跃↔封存 可来回
// （封存是「不再接新活」不是终点：路线回摆时该能复活，而不是另开一个同名特性把历史劈成两半）。
const 转移表 = { 待审: ['活跃', '封存'], 活跃: ['封存'], 封存: ['活跃'] };
const 散单名 = (管线名) => `${管线名}散单`;

function ensure(root) { fs.mkdirSync(DIR(root), { recursive: true }); }
const 是特性号 = (id) => /^F-\d+$/.test(String(id || ''));

function list(root) {
  ensure(root);
  return fs.readdirSync(DIR(root)).filter((f) => /^F-\d+\.md$/.test(f)).map((f) => {
    const g = matter(fs.readFileSync(path.join(DIR(root), f), 'utf8'));
    return { id: f.replace(/\.md$/, ''), fm: g.data, body: g.content };
  }).sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
}

function find(root, id) {
  if (!是特性号(id)) return null;
  const file = path.join(DIR(root), `${id}.md`);
  if (!fs.existsSync(file)) return null;
  const g = matter(fs.readFileSync(file, 'utf8'));
  return { id, file, fm: g.data, body: g.content };
}

function 写盘(root, id, fm, body) {
  ensure(root);
  fs.writeFileSync(path.join(DIR(root), `${id}.md`), matter.stringify(String(body || ''), fm), 'utf8');
}

function 下一号(root) {
  const mx = list(root).reduce((m, f) => Math.max(m, Number(f.id.slice(2))), 0);
  return `F-${mx + 1}`;
}

/**
 * 提请（项管的动作）。落 待审 态，候总监审。
 * @param opts.挂载 至少一个「现在就要挂进来」的对象：{专项:[S-n...]} 或 {工单:[TK-n...]}。
 *   **这是禁预规划的机器闸**——附不出对象就说明是在规划而不是在收活，拒。
 */
function 提请(root, opts = {}) {
  const 名称 = String(opts.名称 || '').trim();
  const 管线 = String(opts.管线 || '').trim();
  const 边界 = String(opts.边界 || '').trim();
  if (!名称) return { ok: false, error: '特性名称必填' };
  if (!管线) return { ok: false, error: '必须指明所属管线（特性是系统下的功能/规则，不能悬空）' };
  if (!边界) return { ok: false, error: '边界必填：一句话说清这个特性管什么、不管什么' };

  const 挂载 = opts.挂载 || {};
  const 专项们 = [].concat(挂载.专项 || []).map(String).filter(Boolean);
  const 工单们 = [].concat(挂载.工单 || []).map(String).filter(Boolean);
  if (!opts.系统 && !专项们.length && !工单们.length) {
    return { ok: false, 禁预规划: true,
      error: '开特性必须附至少一个「现在就要挂进来」的对象（专项号或单号）——特性是被活撑出来的，不是设计出来的' };
  }
  // 同管线内重名即拒：两个同名特性会让归位在两处之间摇摆，且推导上级时无从判断
  const 重 = list(root).find((f) => f.fm.名称 === 名称 && f.fm.管线 === 管线 && f.fm.状态 !== '封存');
  if (重) return { ok: false, error: `${管线} 下已有同名特性 ${重.id}（封存态不算冲突）` };

  const id = 下一号(root);
  const now = opts.现在 || new Date().toISOString();
  const 人 = String(opts.提请人 || '项管').trim();
  // 散单特性由系统建，直接活跃无需审：它不是「谁提议要做的功能」，是结构上的兜底位
  const 初态 = opts.系统 ? '活跃' : '待审';
  const fm = {
    id, 名称, 管线, 边界, 状态: 初态, 系统: !!opts.系统,
    提请人: 人, 提请时间: now, 更新时间: now,
    审核人: opts.系统 ? '系统' : null, 审核时间: opts.系统 ? now : null,
    挂载凭据: { 专项: 专项们, 工单: 工单们 },   // 留痕：当初是拿什么活撑起来的
    履历: [{ t: now, 从: null, 到: 初态, 因: String(opts.因 || (opts.系统 ? '系统建散单位' : '项管提请')), 操作者: 人 }],
  };
  写盘(root, id, fm, 正文模板(fm));
  return { ok: true, id, fm };
}

function 正文模板(fm) {
  return `## 边界\n${fm.边界}\n\n## 常驻工件\n（这个特性对应仓里的哪些文件/目录/出件——补齐）\n\n`
    + `## 挂载凭据\n提请时附的活：${[...(fm.挂载凭据.专项 || []), ...(fm.挂载凭据.工单 || [])].join('、') || '（系统位）'}\n`;
}

function update(root, id, mut) {
  const f = find(root, id);
  if (!f) return { ok: false, error: '特性不存在：' + id };
  const r = mut(f.fm, f);
  if (f.fm.状态 && !STATES.includes(f.fm.状态)) return { ok: false, error: '非法状态：' + f.fm.状态 };
  f.fm.更新时间 = new Date().toISOString();
  写盘(root, id, f.fm, (r && typeof r.body === 'string') ? r.body : f.body);
  return { ok: true, id, fm: f.fm };
}

function 转移(root, id, 到, opts = {}) {
  const f = find(root, id);
  if (!f) return { ok: false, error: '特性不存在：' + id };
  const 从 = f.fm.状态 || '待审';
  if (从 === 到) return { ok: true, id, 幂等: true, 状态: 到 };
  if (!(转移表[从] || []).includes(到)) return { ok: false, error: `不合法的转移：${从} → ${到}` };
  const now = opts.现在 || new Date().toISOString();
  return update(root, id, (fm) => {
    fm.状态 = 到;
    fm.履历 = [...(fm.履历 || []), { t: now, 从, 到, 因: String(opts.因 || ''), 操作者: String(opts.操作者 || '系统') }];
    if (到 === '活跃' && 从 === '待审') { fm.审核人 = String(opts.操作者 || ''); fm.审核时间 = now; }
    if (到 === '封存') { fm.封存时间 = now; fm.封存因 = String(opts.因 || ''); }
    if (到 === '活跃' && 从 === '封存') { fm.封存时间 = null; fm.复活时间 = now; }
  });
}

/**
 * 改名 / 改边界（制作人 11:23 要的双击就地编辑的后端口）。
 * 安全性来自 ID 挂链：工单与专项记的是 `特性: F-n` 这个号、不是名字，
 * 所以改名纯粹是改显示——底下挂着几十张单也一张都不用动。
 * 但改名是**真事件**（半年后翻账要知道「地理底图」以前叫什么），故记履历不静默改。
 */
function 编辑(root, id, { 名称, 边界, 操作者 } = {}) {
  const f = find(root, id);
  if (!f) return { ok: false, error: '特性不存在：' + id };
  const 新名 = 名称 == null ? null : String(名称).trim();
  const 新界 = 边界 == null ? null : String(边界).trim();
  if (新名 === '') return { ok: false, error: '名称不能改成空' };
  if (新界 === '') return { ok: false, error: '边界不能改成空' };
  if (新名 && 新名 !== f.fm.名称) {
    const 重 = list(root).find((x) => x.id !== id && x.fm.名称 === 新名 && x.fm.管线 === f.fm.管线 && x.fm.状态 !== '封存');
    if (重) return { ok: false, error: `${f.fm.管线} 下已有同名特性 ${重.id}` };
  }
  const 变 = [];
  if (新名 && 新名 !== f.fm.名称) 变.push(`名称 ${f.fm.名称} → ${新名}`);
  if (新界 && 新界 !== f.fm.边界) 变.push('边界改写');
  if (!变.length) return { ok: true, id, fm: f.fm, 幂等: true };
  const now = new Date().toISOString();
  return update(root, id, (fm) => {
    if (新名) fm.名称 = 新名;
    if (新界) fm.边界 = 新界;
    fm.履历 = [...(fm.履历 || []), { t: now, 从: fm.状态, 到: fm.状态, 因: 变.join('；'), 操作者: String(操作者 || '制作人') }];
    return { body: 新界 ? f.body.replace(/^## 边界\n[\s\S]*?(?=\n## |$)/, `## 边界\n${新界}\n`) : f.body };
  });
}

/** 审核（总监的动作，制作人 11:12 定）：过 → 活跃；不过 → 就地封存留痕，不删。 */
function 审核(root, id, { 通过, 审核人, 说明 } = {}) {
  const 人 = String(审核人 || '').trim();
  if (!人) return { ok: false, error: '审核必须署审核人' };
  const f = find(root, id);
  if (!f) return { ok: false, error: '特性不存在：' + id };
  if (f.fm.状态 !== '待审') return { ok: false, error: `只有「待审」态可审核（当前 ${f.fm.状态}）` };
  return 转移(root, id, 通过 ? '活跃' : '封存', { 操作者: 人, 因: String(说明 || (通过 ? '总监审核通过' : '总监审核不过')) });
}

/**
 * 散单特性兜底（制作人 10:18 细则②）：每条管线自带一个，故树永远整齐四层、无例外分支。
 * 幂等——已有即返回，不重建。系统位不走审核（它不是「谁提议要做的功能」，是结构上的兜底位）。
 */
function 确保散单位(root, 管线, 管线名) {
  const 名 = 散单名(String(管线名 || 管线));
  const 有 = list(root).find((f) => f.fm.管线 === 管线 && f.fm.系统 === true);
  if (有) return { ok: true, id: 有.id, fm: 有.fm, 幂等: true };
  return 提请(root, {
    名称: 名, 管线, 系统: true,
    边界: `不属于 ${管线} 下任何专项、也不落在任何具名特性上的单，一律挂这里——树因此永远是整齐的四层。`,
    因: '系统建散单兜底位',
  });
}

/* ================= 反向聚合（只记直接上级 → 上级不存子清单）=================
 * 制作人 10:18 细则①：工单记专项、专项记特性、特性记管线，往上推导，**不多处记同一事实**。
 * 故特性文件里没有子专项清单——那会是第二个事实源。要清单就在这儿现算。 */

function 子专项(root, id, 专项表) {
  const all = 专项表 || require('./specials').list(root);
  return all.filter((s) => String(s.fm.特性 || '') === String(id));
}

/** 直挂工单：不经专项、直接挂本特性的单（散单位上的单全是这一类）。 */
function 直挂单(root, id, 快照) {
  const snap = 快照 || require('./core/store').snapshot(root);
  const out = [];
  for (const st of Object.keys(snap)) {
    for (const t of snap[st] || []) {
      const fm = t.fm || {};
      if (String(fm.特性 || '') !== String(id)) continue;
      if (fm.专项) continue;               // 有专项的走专项那条路，别在这儿数第二遍
      out.push({ ...t, state: t.state || st, fm });
    }
  }
  return out;
}

/**
 * 聚合视图：现算进度，不落盘。
 * 「做到几成」= 直挂单 + 各子专项的子单，一起数落袋比例。
 */
function 聚合(root, f, opts = {}) {
  const 特 = typeof f === 'object' ? f : find(root, f);
  if (!特) return null;
  const specials = require('./specials');
  const snap = opts.快照 || require('./core/store').snapshot(root);
  const 专项们 = 子专项(root, 特.id, opts.专项表);
  const 直挂 = 直挂单(root, 特.id, snap);
  let 单表 = [...直挂];
  for (const s of 专项们) 单表 = 单表.concat(specials.子单(root, s, snap));
  // H108 落袋口径与 specials.落袋态 同判：完成（做完等关账）+ 归档（已验收落袋）。
  // 废弃不算落袋——出基线的单不该把特性的完成度撑好看（分母里照旧留着）。
  const 终态 = ['完成', '归档'];
  const 落袋 = 单表.filter((t) => 终态.includes(t.state)).length;
  return {
    id: 特.id, ...特.fm,
    专项数: 专项们.length, 专项: 专项们.map((s) => ({ id: s.id, 名称: s.fm.名称, 状态: s.fm.状态 })),
    直挂单数: 直挂.length, 单数: 单表.length, 落袋,
    百分比: 单表.length ? Math.round(100 * 落袋 / 单表.length) : 0,
  };
}

/** 挂单闸：待审特性挂不了单（行为差别正是「待审」这个状态存在的理由）。 */
function 可挂单(root, id) {
  const f = find(root, id);
  if (!f) return { ok: false, error: '特性不存在：' + id };
  if (f.fm.状态 === '待审') return { ok: false, error: `${id} 尚在待审（项管提请、总监未审）——审过才能挂单` };
  if (f.fm.状态 === '封存') return { ok: false, error: `${id} 已封存（${f.fm.封存因 || '不再接新活'}）——历史可查，不接新单` };
  return { ok: true };
}

/**
 * 四层归位迁移（丙-2）。**默认演练**——真跑要显式 {执行:true}。
 * 照 specials.迁移 的先例：改的是一百多张单的 frontmatter，一个手滑得靠 git 捞，
 * 所以默认那一档永远是「只算给你看」。
 *
 * @param 计划 { 特性册:[{名称,管线,边界,单:[],专项:[]}], 散单位管线:[[管线,名]], 散单归属:{管线:[单号]},
 *              转TF:[单号], 容器单:[{id,因}] }
 *
 * 四步，每步都幂等（跑过一次再跑只补没做完的）：
 *   ① 建特性册（按名称+管线判重，已有即复用）
 *   ② 单挂特性——**只写直挂单**：已有 专项 章的单不写 特性，它的特性由专项推导（只记直接上级）
 *   ③ 专项挂特性
 *   ④ 转项目 / 容器单归档
 */
function 迁移(root, 计划, opts = {}) {
  const store = require('./core/store');
  const specials = require('./specials');
  const 演练 = !opts.执行;
  const 人 = String(opts.操作者 || '总监').trim();
  const 动作 = []; const 跳过 = []; const 错 = [];
  const 号Of = new Map();   // 名称@管线 → F-n

  const 建 = (名称, 管线, 边界, 挂载, 系统) => {
    const 键 = `${名称}@${管线}`;
    if (号Of.has(键)) return 号Of.get(键);
    const 有 = list(root).find((f) => f.fm.名称 === 名称 && f.fm.管线 === 管线 && f.fm.状态 !== '封存');
    if (有) { 号Of.set(键, 有.id); 动作.push({ 步: '建特性', 名称, 管线, 号: 有.id, 已有: true }); return 有.id; }
    if (演练) { const 假号 = `F-?（${名称}）`; 号Of.set(键, 假号); 动作.push({ 步: '建特性', 名称, 管线, 号: 假号, 系统: !!系统 }); return 假号; }
    const r = 提请(root, { 名称, 管线, 边界, 挂载, 系统, 提请人: 人, 因: '四层归位迁移' });
    if (!r.ok) { 错.push(`建特性「${名称}」失败：${r.error}`); return null; }
    // 迁移建的具名特性直接审过——归位方案本身已经过制作人过目，不必再走一遍待审
    if (!系统) 转移(root, r.id, '活跃', { 操作者: 人, 因: '四层归位迁移（方案已过制作人目）' });
    号Of.set(键, r.id); 动作.push({ 步: '建特性', 名称, 管线, 号: r.id, 系统: !!系统 });
    return r.id;
  };

  // ① 具名特性
  for (const f of (计划.特性册 || [])) {
    建(f.名称, f.管线, f.边界, { 工单: (f.单 || []).slice(0, 3), 专项: f.专项 || [] }, false);
  }
  // ①b 散单兜底位
  for (const [线, 名] of (计划.散单位管线 || [])) {
    const 号 = 演练 ? `F-?（${散单名(名)}）` : (确保散单位(root, 线, 名).id);
    号Of.set(`${散单名(名)}@${线}`, 号);
    动作.push({ 步: '建散单位', 管线: 线, 号 });
  }

  // ② 单挂特性（只写直挂单）
  const 挂 = (id, 号, 来自) => {
    const t = store.find(root, id);
    if (!t) { 跳过.push({ 单: id, 因: '不在库' }); return; }
    if (t.fm.专项) { 跳过.push({ 单: id, 因: `已挂专项 ${t.fm.专项}，特性由专项推导（只记直接上级）` }); return; }
    if (String(t.fm.特性 || '') === String(号)) { 跳过.push({ 单: id, 因: '已挂同一特性' }); return; }
    动作.push({ 步: '单挂特性', 单: id, 特性: 号, 来自 });
    if (!演练) store.update(root, id, (fm) => { fm.特性 = 号; });
  };
  for (const f of (计划.特性册 || [])) {
    const 号 = 号Of.get(`${f.名称}@${f.管线}`);
    if (!号) continue;
    for (const id of (f.单 || [])) 挂(id, 号, f.名称);
  }
  for (const [线, ids] of Object.entries(计划.散单归属 || {})) {
    const 名 = (计划.散单位管线 || []).find((x) => x[0] === 线);
    const 号 = 名 && 号Of.get(`${散单名(名[1])}@${线}`);
    if (号) for (const id of ids) 挂(id, 号, '散单位');
  }

  // ③ 专项挂特性
  for (const f of (计划.特性册 || [])) {
    const 号 = 号Of.get(`${f.名称}@${f.管线}`);
    for (const s of (f.专项 || [])) {
      const cur = specials.find(root, s);
      if (!cur) { 跳过.push({ 专项: s, 因: '不存在' }); continue; }
      if (String(cur.fm.特性 || '') === String(号)) { 跳过.push({ 专项: s, 因: '已挂同一特性' }); continue; }
      动作.push({ 步: '专项挂特性', 专项: s, 特性: 号, 来自: f.名称 });
      if (!演练) specials.update(root, s, (fm) => { fm.特性 = 号; });
    }
  }

  // ④ 转项目（乙类：四条管线都装不下 → TF；TF 无管线故无特性，只有专项+工单两层）
  for (const id of (计划.转TF || [])) {
    const t = store.find(root, id);
    if (!t) { 跳过.push({ 单: id, 因: '不在库' }); continue; }
    if (t.fm.项目 === 'Ticketflow') { 跳过.push({ 单: id, 因: '已在 TF' }); continue; }
    动作.push({ 步: '转项目', 单: id, 从: t.fm.项目 || '(空)', 到: 'Ticketflow' });
    if (!演练) store.update(root, id, (fm) => { fm.项目 = 'Ticketflow'; fm.管线 = null; });
  }

  // ⑤ 容器单归档废弃（按四层它们不是工单，其组织职能已由管线/特性/专项接管）
  for (const c of (计划.容器单 || [])) {
    const t = store.find(root, c.id);
    if (!t) { 跳过.push({ 单: c.id, 因: '不在库' }); continue; }
    if (t.state === '归档') {
      if (t.fm.容器退役) { 跳过.push({ 单: c.id, 因: '已标退役' }); continue; }
      动作.push({ 步: '容器标退役', 单: c.id, 态: t.state, 因: c.因 });
      if (!演练) store.update(root, c.id, (fm) => { fm.容器退役 = true; fm.容器退役因 = c.因; });
      continue;
    }
    动作.push({ 步: '容器归档', 单: c.id, 从: t.state, 因: c.因 });
    if (!演练) {
      const r = store.move(root, c.id, t.state, '归档', (fm) => {
        fm.归档原因 = `四层归位：容器单退役——${c.因}`; fm.容器退役 = true; fm.容器退役因 = c.因;
      }, new Date().toISOString());
      if (!r.ok) 错.push(`容器 ${c.id} 归档失败：${r.error}`);
    }
  }

  return { ok: !错.length, 演练, 动作, 跳过, 错, 计数: 统计(动作) };
}
function 统计(动作) {
  const c = {};
  for (const a of 动作) c[a.步] = (c[a.步] || 0) + 1;
  return c;
}

module.exports = {
  DIR, STATES, 转移表, 是特性号, ensure, 散单名,
  list, find, 提请, 审核, 编辑, 转移, update, 下一号,
  子专项, 直挂单, 聚合, 可挂单, 确保散单位, 迁移,
};
