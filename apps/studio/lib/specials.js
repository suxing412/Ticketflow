// specials.js — 专项注册表（H103 · 施工令-058）：**专项是容器，不是工单**。
//
// 案源（制作人 2026-08-13 18:21 裁决）：TK-146/150 以工单身份混在 待验收，占 TK 号、
// 带 QA/验收方式字段、被状态机与机判骚扰——组织容器被塞进执行者的模子里，每一格都别扭。
// 实体分立律（H52，管线注册表立的先例）照搬：容器与工单的生命周期/不变量/状态机全然不同，
// 故独立实体——独立目录（专项/）、独立 schema、独立状态机、独立操作。
//
// 与管线注册表（lib/pipelines.js）的形制对齐处：目录即注册表、一实体一 .md、frontmatter 即 schema、
// 顺序派号、状态受限枚举、人闸单点。不同处只有一条：管线是常青树永不完工，专项有终点——
// 立项 → 进行 → 收口 → 关账，**唯一人闸 = 关账签字**（前三跳都是机器按实况推的）。
//
// 三条硬纪律（改一处就是改协议）：
//   ① 不进工单目录：专项文件住 专项/，store.STATES 扫不到它，故天然不参与机判/QA/派发/预检。
//      「隔离」不是靠在十几处判断里加 if，而是靠它压根不在那些代码看得见的地方。
//   ② 子单清单不手维护：由子单 frontmatter 的 `专项: S-n` **反向聚合**。容器里手抄一份子单号
//      就是给自己造第二个事实源——两处一分叉，谁也说不清哪份是真的。
//   ③ 关账是人闸：机器可以把专项推到 收口 并备好收口报告，但 关账 只认签字人。
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const DIR = (root) => path.join(root, '专项');
const STATES = ['立项', '进行', '收口', '关账'];
// 转移表：主链是单向的（立项→进行→收口→关账）。
// 唯一的回头路是 收口→进行「复工」：H65 返修让子单同号回草稿，容器若卡死在「收口」就是
// 在说一句假话（明明还有活在跑）。复工不是新语义，是让状态诚实映射实况的必要退路。
const 转移表 = { 立项: ['进行'], 进行: ['收口'], 收口: ['进行', '关账'], 关账: [] };
// 类型（制作人 2026-08-20 09:43 要求「专项应该明确边界和范围，明确是调研、是重构、还是等等其它类型」）。
// 类型不只是标签：它决定验收形态——调研型免人闸（H95）、重构型必须说清「改好之前的什么」、
// 建设型必须说清「建成什么」。判不出类型说明这批活的边界本身没想清楚。
const TYPES = ['调研', '建设', '重构', '修缮', '迁移'];
const 终态 = ['关账'];

function ensure(root) { fs.mkdirSync(DIR(root), { recursive: true }); }

const 是专项号 = (id) => /^S-\d+$/.test(String(id || ''));

function list(root) {
  ensure(root);
  return fs.readdirSync(DIR(root)).filter((f) => /^S-\d+\.md$/.test(f)).map((f) => {
    const g = matter(fs.readFileSync(path.join(DIR(root), f), 'utf8'));
    return { id: f.replace(/\.md$/, ''), fm: g.data, body: g.content };
  }).sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
}

function find(root, id) {
  if (!是专项号(id)) return null;
  const file = path.join(DIR(root), `${id}.md`);
  if (!fs.existsSync(file)) return null;
  const g = matter(fs.readFileSync(file, 'utf8'));
  return { id, file, fm: g.data, body: g.content };
}

function 写盘(root, id, fm, body) {
  ensure(root);
  fs.writeFileSync(path.join(DIR(root), `${id}.md`), matter.stringify(String(body || ''), fm), 'utf8');
}

// 立项（专项的诞生式）：名称必填，其余可后补。状态一律从 立项 起步——
// 「进行」由首子单派发推、「收口」由全子单落袋推，没有第二个入口手工指定初态。
function 立项(root, opts = {}) {
  const 名称 = String(opts.名称 || '').trim();
  if (!名称) return { ok: false, error: '专项名称必填' };
  ensure(root);
  const mx = list(root).reduce((m, s) => Math.max(m, Number(s.id.slice(2))), 0);
  const id = `S-${mx + 1}`;
  const now = opts.现在 || new Date().toISOString();
  const fm = {
    id, 名称, 目标: String(opts.目标 || '').trim(),
    // 类型与完成定义（2026-08-20 补，案源见下方 关账 的注释）：完成定义是关账签字时的**对照物**。
    // 立项时可空（存量专项与迁移来的容器都没有），但关账那一刻必须有——见 关账()。
    类型: TYPES.includes(String(opts.类型 || '')) ? String(opts.类型) : null,
    完成定义: String(opts.完成定义 || '').trim() || null,
    管线: opts.管线 || null, 特性: opts.特性 || null, 项目: opts.项目 || null,
    单号前缀: String(opts.单号前缀 || 'TK'),   // 切单派号用：专项号是 S-n，子单号照旧走项目前缀
    状态: '立项',
    别名: [].concat(opts.别名 || []).map(String).filter(Boolean), // 迁移前的伪单号（TK-146…）
    立项时间: now, 更新时间: now,
    履历: [{ t: now, 从: null, 到: '立项', 因: String(opts.因 || '立项'), 操作者: String(opts.操作者 || '制作人') }],
  };
  写盘(root, id, fm, opts.正文 || 正文模板(opts));
  return { ok: true, id, fm };
}

function 正文模板(opts) {
  return `## 专项目标\n${opts.目标 || '（补齐）'}\n\n## 系统边界（写区圈定 + 不要做）\n（补齐）\n\n## 验收标准（可判定条目 + 标注保留项）\n（补齐）\n`;
}

function update(root, id, mut) {
  const s = find(root, id);
  if (!s) return { ok: false, error: '专项不存在：' + id };
  const r = mut(s.fm, s);
  if (s.fm.状态 && !STATES.includes(s.fm.状态)) return { ok: false, error: '非法状态：' + s.fm.状态 };
  s.fm.更新时间 = new Date().toISOString();
  写盘(root, id, s.fm, (r && typeof r.body === 'string') ? r.body : s.body);
  return { ok: true, id, fm: s.fm };
}

// 状态转移：查表，非法一律拒；每跳都往 履历 里记一笔（基线变迁的一半来源就是它）。
// 幂等：到已在的态返回 ok + 幂等标，不刷履历——巡检拍会反复调它，每拍一条痕就是把履历刷成噪声。
function 转移(root, id, 到, opts = {}) {
  const s = find(root, id);
  if (!s) return { ok: false, error: '专项不存在：' + id };
  const 从 = s.fm.状态 || '立项';
  if (从 === 到) return { ok: true, id, 幂等: true, 状态: 到 };
  if (!(转移表[从] || []).includes(到)) return { ok: false, error: `不合法的转移：${从} → ${到}` };
  if (到 === '关账' && !String(opts.操作者 || '').trim()) return { ok: false, error: '关账是人闸：必须署签字人' };
  const now = opts.现在 || new Date().toISOString();
  return update(root, id, (fm) => {
    fm.状态 = 到;
    fm.履历 = [...(fm.履历 || []), { t: now, 从, 到, 因: String(opts.因 || ''), 操作者: String(opts.操作者 || '系统') }];
    if (到 === '收口') { fm.收口时间 = now; if (opts.收口报告) fm.收口报告 = opts.收口报告; }
    if (到 === '进行' && 从 === '收口') { fm.收口时间 = null; fm.复工时间 = now; }
    if (到 === '关账') { fm.关账时间 = now; fm.关账签字 = String(opts.操作者); }
  });
}

// 关账（唯一人闸）：只从 收口 出发，必须署名。机器永远调不到这里——它没有签字人。
// 完成定义补写（2026-08-20）：存量专项没有这一格，关账前得能补上。
function 定完成定义(root, id, 文, 操作者) {
  const v = String(文 || '').trim();
  if (!v) return { ok: false, error: '完成定义不能为空——一句可判定的话：做到什么程度算完' };
  const s = find(root, id);
  if (!s) return { ok: false, error: '专项不存在：' + id };
  const 旧 = s.fm.完成定义;
  const now = new Date().toISOString();
  return update(root, id, (fm) => {
    fm.完成定义 = v;
    fm.履历 = [...(fm.履历 || []), { t: now, 从: fm.状态, 到: fm.状态,
      因: 旧 ? `完成定义改写：${String(旧).slice(0, 40)} → ${v.slice(0, 40)}` : `补完成定义：${v.slice(0, 60)}`,
      操作者: String(操作者 || '制作人') }];
  });
}

/**
 * 关账（唯一人闸）。
 *
 * **两次踩同一个坑之后加的那道闸（2026-08-20）**：状态机把「全子单落袋」判成「收口」，
 * 于是专项一批活跑完就催签字——可「没活在跑」不等于「做完了」。
 * S-1 地图手修编辑器：22 张子单全落袋被推收口，而编辑器交互层正被 S-3 重构中，制作人当场质问
 * 「S-1 没做完啊？为什么要签字关账？」；S-3 自己隔天又犯同一条——它是交互层重构专项，
 * 实际一行重构没写，只因那份调研需求单验收了就被推去收口。
 *
 * 治法不是改状态机（「没活在跑」这个判断本身没错，机器也只能判到这一步），
 * 而是**给签字一个对照物**：完成定义。签的是「这句话达成了」，不是「没活在跑了」。
 * 故关账强制要求完成定义在位；没有就先补（定完成定义），补的过程本身就是逼人把边界说清。
 */
function 关账(root, id, 签字人, 说明) {
  const 人 = String(签字人 || '').trim();
  if (!人) return { ok: false, error: '关账必须署签字人（唯一人闸）' };
  const s = find(root, id);
  if (!s) return { ok: false, error: '专项不存在：' + id };
  if (s.fm.状态 !== '收口') return { ok: false, error: `只有「收口」态可关账（当前 ${s.fm.状态 || '立项'}）` };
  if (!String(s.fm.完成定义 || '').trim()) {
    return { ok: false, 缺完成定义: true,
      error: `${id} 还没有完成定义——关账签的是「这句话达成了」，不是「没活在跑了」。`
        + `机器只判得出全子单落袋，判不出这批活的目的达没达成（S-1/S-3 两次误催签字即此）。请先补一句可判定的完成定义。` };
  }
  const r = 转移(root, id, '关账', { 操作者: 人, 因: String(说明 || `制作人关账签字（对照完成定义：${String(s.fm.完成定义).slice(0, 60)}）`) });
  if (!r.ok) return r;
  return { ...r, 级联: 级联归档(root, id, 人) };
}

/**
 * 关账级联归档（H110 · 外审 CX-2）：专项验收（关账签字）即子单的专项级验收——
 * 名下「完成」态子单在这一刻批量 完成→归档。执行点只此一处：关账成功之后、同一调用内。
 *
 * 三条纪律：
 *   ① 只动**本专项名下**的「完成」态子单（归属判据 = 子单()：专项章 + 别名兜底）。
 *      散单/保留单/别家专项的单一张不碰——级联的射程由归属判据圈死，不靠调用方自觉。
 *   ② 逐张 journal 留痕：归档是「落袋」这一账目口径的落笔时刻，每一笔都要能在流水里指认。
 *   ③ 任一张失败**不回滚已移的**：已归档的子单是既成事实（验收确实过了），
 *      回滚只会造出「签了字却没落袋」的假账。失败清单如实回报，由人补刀。
 *   注意：级联归档**不写 归档原因**——带因归档在全库口径里是「撤销/出基线」（ledger-sync 同判），
 *   验收过的正常落袋必须是无因归档；追溯走 fm.归档来源 + journal。
 */
function 级联归档(root, id, 签字人) {
  const store = require('./core/store');
  const 完成子单 = 子单(root, id).filter((k) => k.state === '完成');
  const now = new Date().toISOString();
  const 归档 = []; const 失败 = [];
  for (const k of 完成子单) {
    const mv = store.move(root, k.id, '完成', '归档', (fm) => {
      fm.归档来源 = `专项关账级联（${id}，签字：${签字人}）`;
    }, now);
    if (mv && mv.ok) {
      归档.push(k.id);
      try { require('./journal').append(root, `级联归档 ${k.id}：专项 ${id} 关账（签字：${签字人}，H110）`); } catch { /* 留痕失败不阻塞 */ }
    } else {
      失败.push({ 单号: k.id, error: (mv && mv.error) || '未知' });
      try { require('./journal').append(root, `级联归档失败 ${k.id}：专项 ${id} 关账（${(mv && mv.error) || '未知'}）——不回滚已移的，候人补刀`); } catch { /* 同上 */ }
    }
  }
  return { 应归档: 完成子单.map((k) => k.id), 归档, 失败 };
}

/**
 * 验收打回（DS-1 补边）：专项级验收**不过**的返回边——关账签字的反面。
 * 专项回「进行」，点名子单 完成→待重派（带返修因）。
 *
 * 约束：
 *   · 只从「收口」出发（验收发生在收口候签阶段；关账已签的没有回头路，转移表里就没这条边）。
 *   · 必须点名子单：不点名的打回等于全盘否定，那是废弃/重立项的事，不是这条边。
 *   · 点名单必须是本专项名下的「完成」态子单——点错名整单拒、一张不动（打回不做半截）：
 *     级联半途失败尚可由人补刀（既成事实不可逆），打回半途停下则会留下一个「说不清打回没打回」的专项。
 *   · 子单计数不丢：打回的子单还挂在专项链上（专项章一字不动），聚合总数不变。
 */
function 验收打回(root, sid, { 子单清单, 因, 操作者 } = {}) {
  const 人 = String(操作者 || '制作人').trim();
  const 单们 = [].concat(子单清单 || []).map(String).filter(Boolean);
  if (!单们.length) return { ok: false, error: '验收打回必须点名子单——不点名的打回是全盘否定，走废弃不走这条边' };
  const s = find(root, sid);
  if (!s) return { ok: false, error: '专项不存在：' + sid };
  if (s.fm.状态 !== '收口') return { ok: false, error: `只有「收口」态可验收打回（当前 ${s.fm.状态 || '立项'}）——关账已签的没有回头路` };
  const store = require('./core/store');
  const 名下 = new Map(子单(root, s).map((k) => [k.id, k]));
  for (const id of 单们) {
    const k = 名下.get(id);
    if (!k) return { ok: false, error: `${id} 不是 ${sid} 名下子单——打回的射程由归属判据圈死，不误伤别家单` };
    if (k.state !== '完成') return { ok: false, error: `${id} 现处「${k.state}」，验收打回只回「完成」态子单` };
  }
  const 打回因 = String(因 || `专项 ${sid} 验收打回`).trim();
  const now = new Date().toISOString();
  // 容器先回「进行」（人闸动作，操作者=人：收口自检的人手复工闸因此生效，
  // 机器不会在打回的下一拍就把它推回收口——打回子单重派领单后 领单时间 变新，届时自然放行）。
  const 回 = 转移(root, sid, '进行', { 因: `验收打回：${打回因}（点名 ${单们.join('、')}）`, 操作者: 人, 现在: now });
  if (!回.ok) return 回;
  const 打回 = []; const 失败 = [];
  for (const id of 单们) {
    const mv = store.move(root, id, '完成', '待重派', (fm) => { fm.返修因 = 打回因; delete fm.执行池; }, now); // 运行章随会话销毁（2026-08-26 TK-201 案）
    if (mv && mv.ok) {
      打回.push(id);
      try { require('./journal').append(root, `验收打回 ${id}：专项 ${sid} 验收不过 → 待重派（${打回因}，操作者：${人}）`); } catch { /* 留痕失败不阻塞 */ }
    } else 失败.push({ 单号: id, error: (mv && mv.error) || '未知' });
  }
  return { ok: true, 专项: sid, 状态: '进行', 打回, 失败 };
}

/* ================= 子单反向聚合 ================= */

// 归属判定：显式 `专项: S-n` 为正路；`别名` 命中 父单 是迁移兼容路——
// 迁移把子单的 专项 章补上，但**不动它的 父单**（追溯链保真）。万一某张子单的补章漏了
// （手写单、迁移中途中断），别名这条路还认得出它是谁的活，聚合不会凭空少一张。
function 属于(s, fm) {
  if (!s || !fm) return false;
  if (fm.专项 && String(fm.专项) === String(s.id)) return true;
  const 别名 = [].concat(s.fm.别名 || []).map(String);
  return !!(fm.父单 && 别名.includes(String(fm.父单)));
}

const 序号 = (id) => { const m = /(\d+)\s*$/.exec(String(id || '')); return m ? Number(m[1]) : 0; };

// 子单清单：扫全部状态目录反向聚合。快照可注入（聚合/差量共用一份，免得一次渲染扫两遍盘）。
function 子单(root, id, 快照) {
  const s = typeof id === 'object' ? id : find(root, id);
  if (!s) return [];
  const snap = 快照 || require('./core/store').snapshot(root);
  const out = [];
  for (const st of Object.keys(snap)) {
    for (const t of snap[st] || []) {
      const fm = t.fm || {};
      if (!属于(s, fm)) continue;
      // 容器伪单自己不算子单（迁移后它以 已归档 身份留在纸面上，fm.专项 指着新号）
      if (fm.迁移至专项) continue;
      out.push({ ...t, state: t.state || st, fm });
    }
  }
  return out.sort((a, b) => 序号(a.id) - 序号(b.id) || String(a.id).localeCompare(String(b.id)));
}

// 三大态状态机（H108，2026-08-24）下的专项内部口径：
//   落袋态：完成 + 归档。专项内部「做完等关账」（完成）与「已验收归档」（归档）都算落袋——
//           全局口径是「归档=落袋」，但专项级验收正是关账那一签，签之前子单只能停在 完成，
//           不把 完成 算进来，专项进度会永远停在 0% 直到关账那一秒跳 100%，那是说假话。
//   终结态：落袋态 + 废弃。收口判据用它：全子单 ∈ {完成,归档,废弃} 才可收口。
//           **挂起不在此列**——挂起的子单算未完，专项不能带着挂起单收口（要么先复活要么先废弃）。
//   未起态：待审 / 待派（原 草稿 / 待投）。待处理/待重派 是回炉活，算在办不算未起。
const 落袋态 = new Set(['完成', '归档']);
const 终结态 = new Set(['完成', '归档', '废弃']);
const 未起态 = new Set(['待审', '待派']);
const h = (a, b) => {
  const x = Date.parse(a || ''); const y = Date.parse(b || '');
  return (Number.isFinite(x) && Number.isFinite(y) && y > x) ? (y - x) / 3600000 : null;
};

/**
 * 聚合视图（要件1）：一个专项的全部读数，一次算齐。
 * 三段：进度（子单落袋比）· 预算（预计 vs 实耗）· 基线（容器履历 + 子单增删变迁）。
 * 纯读：不写一个字节。取数口径与既有实现同源——实耗 h 走 领单→交付（同 report.aggregate 那一列），
 * 实耗 token 走回执解析（同 report.parseReceipt），不另立一把尺。
 */
function 聚合(root, id, opts = {}) {
  const s = typeof id === 'object' ? id : find(root, id);
  if (!s) return null;
  const kids = opts.子单 || 子单(root, s, opts.快照);
  const 落袋 = kids.filter((k) => 落袋态.has(k.state));
  const 归档 = kids.filter((k) => k.state === '归档');   // 落袋的子集（信息位，不是第五段）
  const 废弃 = kids.filter((k) => k.state === '废弃');   // 出基线的那一段（原「归档原因:废弃」的独立态）
  const 未起 = kids.filter((k) => 未起态.has(k.state));
  // 在办 = 其余全部，含 挂起：挂起单算未完（挡收口），进度上不许把它藏进「做完了」那一侧
  const 在办 = kids.filter((k) => !终结态.has(k.state) && !未起态.has(k.state));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const 报表 = opts.报表 || require('./report');

  let 预计h = 0, 实耗h = 0, 预计token = 0, 实耗token = 0;
  const 明细 = kids.map((k) => {
    const fm = k.fm || {};
    const 实 = h(fm.领单时间, fm.交付时间);
    let tok = null;
    try { tok = 报表.parseReceipt(root, k.id).token估计; } catch { tok = null; }
    预计h += num(fm.预计时间); 实耗h += 实 || 0;
    预计token += num(fm.预计token); 实耗token += tok || 0;
    return {
      id: k.id, title: fm.title || k.id, state: k.state, 职能: fm.职能 || null, 单型: fm.单型 || null,
      优先级: fm.优先级 || null, 管线: fm.管线 || null, 依赖: fm.依赖 || null,
      预计时间: fm.预计时间 || null, 预计token: fm.预计token || null,
      实耗h: 实 != null ? Math.round(实 * 100) / 100 : null, 实耗token: tok,
      // 挂起已从 fm 标记升级为目录态（H108）：新形态认 state；fm.挂起 是旧标记的读口，
      // 存量数据迁移（总控）落完即可拆——写口在本文件已一处不剩。
      落袋: 落袋态.has(k.state), 挂起: k.state === '挂起' ? true : (fm.挂起 || null),
      返工自: fm.返工自 || null, 推翻自: fm.推翻自 || null, 归档原因: fm.归档原因 || null,
    };
  });

  return {
    id: s.id, 名称: s.fm.名称 || s.id, 目标: s.fm.目标 || '', 状态: s.fm.状态 || '立项',
    管线: s.fm.管线 || null, 特性: s.fm.特性 || null, 项目: s.fm.项目 || null, 单号前缀: s.fm.单号前缀 || 'TK',
    类型: s.fm.类型 || null, 完成定义: s.fm.完成定义 || null,
    别名: [].concat(s.fm.别名 || []), 立项时间: s.fm.立项时间 || null,
    收口时间: s.fm.收口时间 || null, 收口报告: s.fm.收口报告 || null,
    关账时间: s.fm.关账时间 || null, 关账签字: s.fm.关账签字 || null,
    子单: 明细,
    进度: {
      // 归档 是 落袋 的子集（新口径：完成+归档 都算落袋）；分段渲染请用互斥四段 落袋/在办/未起/废弃。
      总数: kids.length, 落袋: 落袋.length, 归档: 归档.length, 废弃: 废弃.length, 在办: 在办.length, 未起: 未起.length,
      // 百分比 = 落袋 ÷ 总数。废弃单**留在分母里**：一张被废的子单不该让整条专项的完成度凭空变好看。
      // 零子单 = 0%，不是 100%——切单还没出结果的专项不许显示「做完了」（诚实纪律，同 progress.js）。
      百分比: kids.length ? Math.round(落袋.length / kids.length * 100) : 0,
    },
    预算: {
      预计h: Math.round(预计h * 100) / 100, 实耗h: Math.round(实耗h * 100) / 100,
      预计token, 实耗token,
      偏差pct: 预计h > 0 ? Math.round(实耗h / 预计h * 100) : null, // 100=踩点，>100=超预计
    },
    基线: 基线变迁(s, 明细),
  };
}

// 基线变迁：容器自己的状态履历 + 子单集合的增删事实，按时间铺成一条线。
// 「基线」在这里就是**当初商定要做的那批活**——它变过几次、怎么变的，是收口时最该讲清楚的账。
function 基线变迁(s, 明细) {
  const out = [];
  for (const e of (s.fm.履历 || [])) {
    out.push({ t: e.t, 类型: '容器', 说明: `${e.从 ? e.从 + ' → ' : ''}${e.到}${e.因 ? '（' + e.因 + '）' : ''}`, 操作者: e.操作者 || null });
  }
  for (const k of 明细) {
    if (k.返工自) out.push({ t: null, 类型: '返工', 单号: k.id, 说明: `${k.id} 返工自 ${k.返工自}（同活换号，基线不增）` });
    if (k.推翻自) out.push({ t: null, 类型: '推翻', 单号: k.id, 说明: `${k.id} 推翻重做自 ${k.推翻自}` });
    if (k.归档原因) out.push({ t: null, 类型: '撤销', 单号: k.id, 说明: `${k.id} 出基线（${k.归档原因}）` });
  }
  return out;
}

/* ================= 机器侧推手（两跳，都不是人闸） ================= */

// 首子单派发 → 立项转进行（状态诚实映射，同 H53 在工单侧立的规矩）
function 首派(root, 专项号) {
  if (!是专项号(专项号)) return { ok: false, 跳过: true };
  const s = find(root, 专项号);
  if (!s || s.fm.状态 !== '立项') return { ok: false, 跳过: true };
  const r = 转移(root, 专项号, '进行', { 因: '首子单派发', 操作者: '系统' });
  if (r.ok && !r.幂等) {
    try { require('./journal').append(root, `专项启动 ${专项号}（首子单派发 → 进行）`); } catch { /* 留痕失败不阻塞 */ }
  }
  return r;
}

// 全子单落袋 → 进行转收口（收口报告由 pm/brain.closeout 另行生成，报告没出也照样转态：
// 报告是材料，收口是事实，让事实等材料只会让容器一直说假话）。
// 反向：收口态下又有子单活了（H65 返修同号回草稿）→ 复工回 进行。
function 收口自检(root, 专项号, opts = {}) {
  const s = find(root, 专项号);
  if (!s) return { ok: false, error: '专项不存在：' + 专项号 };
  const kids = 子单(root, s, opts.快照);
  // 收口判据（H108 新态）：全子单 ∈ {完成,归档,废弃}，且至少一张真落袋（完成/归档）——
  // 全是废弃的专项没有「做完」可言，轮不到收口。
  const 全落 = kids.length > 0 && kids.every((k) => 终结态.has(k.state)) && kids.some((k) => 落袋态.has(k.state));
  // 挂起挡收口：挂起的子单算未完——专项不能带着挂起单收口，要么先复活（挂起→待重派）要么先废弃。
  // 单独指认出来（而不是让它默默落进「有活没干完」）：不指认的话，人只会看到专项迟迟不收口，
  // 查不出是哪张单以挂起身份把闸门顶住了。
  const 挂起单 = kids.filter((k) => k.state === '挂起').map((k) => k.id);
  if (s.fm.状态 === '进行' && kids.length > 0 && 挂起单.length
      && kids.every((k) => 终结态.has(k.state) || k.state === '挂起')) {
    return { ok: true, 动作: null, 子单数: kids.length, 挂起单,
      挂起挡收口: `挂起子单算未完：${挂起单.join('、')}——复活或废弃之前不收口` };
  }
  // 人闸复工优先于机器自检（2026-08-21 实测：S-3 复工后 **10 秒**就被自检推回收口，
  // 因由「全部子单落袋（2 张）」——那两张正是复工时判定「不够」的那两张）。
  // 病根：自检的判据是「子单有没有活」，而**复工是人说「这事没完」**。两者说的不是一件事，
  // 于是「收口→进行」这条被注释称为「让状态诚实映射实况的必要退路」的路，在结构上走不通：
  // 迈出去半步就被推回来，而且推回来的痕迹长得跟正常收口一模一样，事后根本看不出发生过复工。
  // 判据改为：人手复工之后，**必须有新子单出现**才允许机器再次收口。
  // 「新」的口径＝子单创建时间晚于复工时刻；这样既不误伤正常流程（新单一派发就自然满足），
  // 也不让机器有权推翻人刚下的判断。机器不许替人宣布「做完了」——那正是三次假收口的共同病根。
  // 只拦**人手**复工。系统自己的复工（「子单又活了」）说的是另一件事——那种情况下子单再落袋，
  // 机器本就该收回收口权，拦它会让返修后出不了第二版收口报告（既有用例实测打红，正是这一条）。
  // 判「谁复的工」走履历末条 收口→进行 的操作者：系统方一律以「系统」起头（同 转移 的既有口径）。
  const 末复工 = [...(s.fm.履历 || [])].reverse().find((h) => h && h.从 === '收口' && h.到 === '进行');
  const 人手复工 = !!(末复工 && !String(末复工.操作者 || '').startsWith('系统'));
  const 复工时刻 = 人手复工 && s.fm.复工时间 ? Date.parse(s.fm.复工时间) : 0;
  const 复工后有新单 = !复工时刻 || kids.some((k) => {
    const t = Date.parse((k.fm && (k.fm.创建时间 || k.fm.领单时间)) || '');
    return Number.isFinite(t) && t > 复工时刻;
  });
  if (s.fm.状态 === '进行' && 全落 && !复工后有新单) {
    return { ok: true, 动作: null, 子单数: kids.length, 挂起自检: '人手复工后尚无新子单——机器不得替人宣布做完' };
  }
  if (s.fm.状态 === '进行' && 全落) {
    const r = 转移(root, 专项号, '收口', { 因: `全部子单落袋（${kids.length} 张）`, 操作者: '系统', ...opts });
    return { ...r, 动作: '收口', 子单数: kids.length };
  }
  if (s.fm.状态 === '收口' && kids.length && !全落) {
    const 活 = kids.filter((k) => !终结态.has(k.state)).map((k) => k.id);
    const r = 转移(root, 专项号, '进行', { 因: `复工：${活.join('、')} 又起活了`, 操作者: '系统' });
    return { ...r, 动作: '复工', 活单: 活 };
  }
  return { ok: true, 动作: null, 子单数: kids.length };
}

/* ================= 迁移（要件4） ================= */

// 默认计划 = 令面点名的两张。参数化而非写死：本仓够不着真工单库（工单住项目仓），
// 迁移必须能对着任意一份仓库跑、能演练、能重跑——写死两个号就只有上线那天能用一次。
const 默认迁移计划 = [{ 单号: 'TK-146' }, { 单号: 'TK-150' }];

/**
 * 伪单 → 专项容器迁移。**幂等可重跑**：认 别名 当钥匙，跑过的原样返回不再造新号。
 * @param {string} root 监制台仓库根
 * @param {Array<{单号:string,名称?:string,管线?:string,项目?:string}>} 计划 缺省用 默认迁移计划
 * @param {{演练?:boolean,操作者?:string}} opts 演练=只算不写（本仓够不着真库时的排练口径）
 * @returns {{ok:boolean,演练:boolean,专项:string[],动作:Array,跳过:Array}}
 *
 * 每张伪单四步走，缺一步都算没迁完：
 *   ① 建容器：名称/目标/管线/项目 从伪单 frontmatter 与正文原样搬，别名记原 TK 号；
 *   ② 子单挂链：`专项: S-n` 补进每张子单的 frontmatter，**父单章原样不动**（追溯链保真）；
 *   ③ 容器停在 收口：立项→进行→收口 三跳全走一遍并留履历，因写「迁移」——
 *      不许直接把 状态 字段写成「收口」，那是绕过状态机给自己开后门；
 *   ④ 伪单归档不删：待验收 → 已归档 + 归档原因 + 迁移至专项 章。**归档不是删除**，
 *      令面明写「其待验收文件归档不删」——纸面可考，工单板从此看不见它。
 */
function 迁移(root, 计划, opts = {}) {
  const store = require('./core/store');
  const 演练 = !!opts.演练;
  const 项 = (计划 && 计划.length ? 计划 : 默认迁移计划);
  const 动作 = []; const 跳过 = []; const 专项号们 = [];
  const 已有 = list(root);

  for (const p of 项) {
    const 单号 = String((p && p.单号) || p || '').trim();
    if (!单号) { 跳过.push({ 单号: '', 因: '计划项缺单号' }); continue; }

    // 幂等钥匙 = 别名。跑过一次就认得出，第二次跑只补做没做完的步（子单挂链/归档），不再造号。
    let s = 已有.find((x) => [].concat(x.fm.别名 || []).map(String).includes(单号)) || null;
    const t = store.find(root, 单号);
    if (!s && !t) { 跳过.push({ 单号, 因: '伪单不在本库（工单库不可达或已迁走）——不凭空造容器' }); continue; }

    // ① 建容器
    if (!s) {
      const fm = (t.fm || {});
      const 名称 = String(p.名称 || fm.title || 单号).trim();
      const args = {
        名称, 目标: 首段(t.body) || 名称,
        管线: p.管线 || fm.管线 || null, 项目: p.项目 || fm.项目 || null,
        单号前缀: (String(单号).match(/^(.+)-\d+$/) || [])[1] || 'TK',
        别名: [单号], 因: `迁移自 ${单号}（施工令-058）`, 操作者: opts.操作者 || '施工令-058',
        正文: 迁移正文(单号, t),
      };
      if (演练) {
        s = { id: `S-?（新号，${名称}）`, fm: { ...args, 状态: '立项', 别名: [单号] }, body: '' };
        动作.push({ 动作: '建容器', 单号, 专项: s.id, 名称, 管线: args.管线 });
      } else {
        const r = 立项(root, args);
        if (!r.ok) { 跳过.push({ 单号, 因: '建容器失败：' + r.error }); continue; }
        s = find(root, r.id);
        动作.push({ 动作: '建容器', 单号, 专项: s.id, 名称, 管线: args.管线 });
      }
    } else {
      动作.push({ 动作: '容器已在', 单号, 专项: s.id, 名称: s.fm.名称 });
    }
    专项号们.push(s.id);

    // ② 子单挂链（父单章不动）
    for (const st of store.STATES) {
      for (const k of store.list(root, st)) {
        const kfm = k.fm || {};
        if (String(kfm.父单 || '') !== 单号) continue;
        if (String(kfm.专项 || '') === s.id) { 动作.push({ 动作: '子单已挂', 单号: k.id, 专项: s.id }); continue; }
        动作.push({ 动作: '子单挂链', 单号: k.id, 专项: s.id, 态: st });
        if (!演练) store.update(root, k.id, (fm) => { fm.专项 = s.id; });
      }
    }

    // ③ 容器推到 收口（三跳留履历），候制作人关账签字
    const 现态 = (s.fm || {}).状态 || '立项';
    if (现态 === '立项' || 现态 === '进行') {
      动作.push({ 动作: '推收口', 专项: s.id, 从: 现态 });
      if (!演练) {
        if ((find(root, s.id).fm.状态) === '立项') 转移(root, s.id, '进行', { 因: '迁移：原伪单已开工', 操作者: opts.操作者 || '施工令-058' });
        const 报告 = 收口报告路径(root, 单号);
        转移(root, s.id, '收口', { 因: `迁移自 ${单号}，停在收口候制作人关账签字`, 操作者: opts.操作者 || '施工令-058', ...(报告 ? { 收口报告: 报告 } : {}) });
      }
    } else {
      动作.push({ 动作: '状态已到位', 专项: s.id, 状态: 现态 });
    }

    // ④ 伪单归档不删（H108 后目录态叫「归档」；历史注释里的「已归档」即今「归档」）
    if (t && t.state !== '归档') {
      const 可 = store.isLegal(t.state, '归档');
      if (!可) 跳过.push({ 单号, 因: `伪单现处「${t.state}」，到归档不是合法转移——原位留着，请人裁` });
      else {
        动作.push({ 动作: '伪单归档', 单号, 从: t.state, 专项: s.id });
        if (!演练) {
          store.move(root, 单号, t.state, '归档', (fm) => {
            fm.归档原因 = `专项实体化迁移 → ${s.id}（施工令-058）`;
            fm.迁移至专项 = s.id;   // 工单板据此认出伪单并不再渲染（要件5）
            fm.专项 = s.id;         // 追溯链：从纸面这一张也点得回容器
          }, new Date().toISOString());
        }
      }
    } else if (t) {
      动作.push({ 动作: '伪单已归档', 单号, 专项: s.id });
      if (!演练 && !t.fm.迁移至专项) store.update(root, 单号, (fm) => { fm.迁移至专项 = s.id; fm.专项 = s.id; });
    }
  }

  if (!演练 && 动作.length) {
    try {
      require('./journal').append(root, `专项实体化迁移（施工令-058）：${专项号们.join('、') || '无'}`
        + `——建容器 ${动作.filter((a) => a.动作 === '建容器').length} · 子单挂链 ${动作.filter((a) => a.动作 === '子单挂链').length}`
        + ` · 伪单归档 ${动作.filter((a) => a.动作 === '伪单归档').length}${跳过.length ? ` · 跳过 ${跳过.length}` : ''}`);
    } catch { /* 留痕失败不阻塞迁移 */ }
  }
  return { ok: true, 演练, 专项: 专项号们, 动作, 跳过 };
}

// 收口报告路径：伪单时代的报告落在 项管台账/收口报告-<单号>.md，迁移后原样指过去（不搬文件）。
function 收口报告路径(root, 单号) {
  const p = path.join(root, '项管台账', `收口报告-${单号}.md`);
  return fs.existsSync(p) ? p : null;
}

const 首段 = (body) => String(body || '').split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))[0] || '';

function 迁移正文(单号, t) {
  const 追溯 = `> 追溯链：本专项由伪工单 **${单号}** 迁移而来（施工令-058 · H103「专项是容器不是工单」）。\n`
    + `> 原单以 已归档 身份留在纸面上（归档不删），子单的 父单 章一律未动。\n`;
  return `${追溯}\n${(t && t.body) || '（原伪单无正文）'}\n`;
}

/* ================= 对外查询小工具 ================= */

// 一张单归哪个专项：显式章优先，别名兜底。给 ledger-sync / UI / 切单共用一份判据。
function 专项of(fm, 专项们) {
  for (const s of 专项们 || []) if (属于(s, fm)) return s;
  return null;
}

module.exports = {
  DIR, STATES, 转移表, 终态, 是专项号, ensure,
  list, find, 立项, update, 转移, 关账, 定完成定义, 验收打回, TYPES,
  属于, 子单, 聚合, 基线变迁, 专项of,
  首派, 收口自检,
  迁移, 默认迁移计划, 收口报告路径,
};
