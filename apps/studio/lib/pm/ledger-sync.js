// pm/ledger-sync.js — 工单台账自动对齐（H102 · 施工令-052）
// 案源：2026-08-12 编辑器专项 11 张子单，排程台账里只见 5 粒——156~161 六张总监忘了登。
// 决议：台账粒 ↔ 工单实况的对齐全权归项管，机器盯；总监手工登粒废止。
//
// 三条口径（改一处就是改协议）：
//   ① 探测是**纯函数**：输入 = 工单库快照 + 台账粒清单，输出 = 差量动作列表。不读盘不写盘不看表——
//      对齐逻辑必须能被逐分支拷问，混进 I/O 就只能靠跑真库来验，而真库是不可控的。
//   ② 只前进不倒退：差量只提状态机允许的**前向**动作。粒已终态、或工单退回上游（H65 返修同号回草稿），
//      一律不动——台账是账，账不倒着写；真要回滚由人走 API。
//   ③ 孤粒不自动删：粒指的单不存在 → 报异常交人裁。删粒是毁账，机器没这个权。
const fs = require('fs');
const path = require('path');
const store = require('../core/store');
const S = require('./schedule');
const ledger = require('./ledger');
const journal = require('../journal');

const 战役类 = ['战役', '专项'];
const 操作者 = '系统·台账对齐';
const 去抖毫秒 = 30 * 1000;
const 例行毫秒 = 5 * 60 * 1000;

// ---- 状态映射（工单九态 → 粒四态）----
// 待投 仍算「起草中」：派发钩子（schedule.挂钩派发）落在 待投→在途 那一刻，
// 这里若把 待投 也认成已成单，同一张单会被两条路各成一次单，口径就分叉了。
const 单态到粒态 = {
  草稿: '起草中', 待投: '起草中',
  池: '已成单', 在途: '已成单', 质检: '已成单', 待验收: '已成单', 待定夺: '已成单', 执行失败: '已成单',
  完成: '完成',
};
// 已归档单列：**无因归档 = 正常交付后的整理性归档**（沿用 dispatch.depsDone / chain 的落袋口径），
// 带 归档原因（废弃/验收打回/定夺打回/返工替代/推翻替代）的一律不算交付 → 撤销。
function 目标状态(t) {
  if (!t) return null;
  if (t.state === '已归档') return (t.fm || {}).归档原因 ? '撤销' : '完成';
  return 单态到粒态[t.state] || null;
}

// 走法：从粒现态到目标态的**最短合法路径**（状态机唯一实现在 schedule.转移表，这里只查表不另判）。
// 已成单→撤销 是状态机明令禁止的（单已发出去，撤粒不撤单＝账对不上）——按 TK-144 先例改走
// 完成 + 说明「废弃闭合」：账面收口，理由写清楚，工单那边该废弃照样废弃。
function 走法(从, 到) {
  if (!从 || !到 || 从 === 到) return null;
  if (从 === '已成单' && 到 === '撤销') {
    return { 路径: ['完成'], 终: '完成', 说明: '废弃闭合（已成单不可直撤，沿用 TK-144 先例：走完成+说明）' };
  }
  const 前 = new Map([[从, null]]);
  const q = [从];
  while (q.length) {
    const c = q.shift();
    if (c === 到) break;
    for (const n of S.转移表[c] || []) if (!前.has(n)) { 前.set(n, c); q.push(n); }
  }
  if (!前.has(到)) return null;
  const p = [];
  for (let c = 到; c && c !== 从; c = 前.get(c)) p.unshift(c);
  return { 路径: p, 终: 到 };
}

const 序号 = (id) => { const m = /(\d+)\s*$/.exec(String(id || '')); return m ? Math.min(Number(m[1]), 1e9) : 0; };

// 依赖照 fm：工单依赖是「全部落袋才就绪」（dispatch.depsDone），映到粒依赖就是 全部完成。
function 依赖照单(fm) {
  const d = (fm || {}).依赖;
  if (!d) return [];
  const ids = (Array.isArray(d) ? d.map(String) : String(d).split(/[，,\s]+/)).filter(Boolean);
  return ids.map((ref) => ({ ref: String(ref).trim().slice(0, 80), 规则: '全部完成' })).filter((x) => x.ref);
}

// ---- ① 差量探测（纯函数）----
// 快照 = store.snapshot(root) 形状 { 状态: [单…] }；粒们 = schedule.现态(root)；
// 专项们 = specials.list(root)（施工令-058，可缺——缺了就只剩战役父单那条老路）。
// 回 { 动作: [...], 异常: [...] }，一个字节都不写盘。
//
// 专项实体化后的挂粒口径（要件3）：**子单挂粒规则一个字没改**，只是「归谁」多了一条正路——
// 老路 = 父单是 战役/专项 类的工单（存量战役号不迁移，这条得留着）；
// 新路 = 子单 frontmatter 写着 `专项: S-n` 且注册表认得这个号。批名一律取容器名
// （专项批名 = 专项名），与老路取父单 title 是同一个意思：批 = 这批活的容器叫什么。
// 专项实体压根不在 快照 里（它不住工单目录），所以「容器不是活粒」这件事新路上不用判——
// 判不到的东西不会被登粒，这正是实体分立换来的便宜。
function 差量(快照, 粒们, 专项们) {
  const 单们 = [];
  for (const s of Object.keys(快照 || {})) for (const t of 快照[s] || []) 单们.push({ ...t, state: t.state || s, fm: t.fm || {} });
  const 按号 = new Map(单们.map((t) => [String(t.id), t]));

  const 粒按ID = new Map();
  const 粒按单号 = new Map();
  for (const g of 粒们 || []) {
    if (!g || !g.粒ID) continue;
    粒按ID.set(String(g.粒ID), g);
    if (!g.单号) continue;
    const k = String(g.单号);
    const 旧 = 粒按单号.get(k);
    // 同号多粒（返工/推翻会造第二粒）：认活的那条——终态粒不该再被状态随单推着走
    if (!旧 || (S.终态.includes(旧.状态) && !S.终态.includes(g.状态))) 粒按单号.set(k, g);
  }

  const 专项按号 = new Map();
  for (const s of 专项们 || []) if (s && s.id) 专项按号.set(String(s.id), s);

  const 动作 = [];
  const 已配 = new Set();
  for (const t of 单们) {
    if (战役类.includes(t.fm.父单类型)) continue; // 专项/战役父单是容器，不是活粒
    if (t.fm.迁移至专项) continue;                // 迁移后的伪单（施工令-058）：纸面留档，更不是活粒
    const 父 = t.fm.父单 ? 按号.get(String(t.fm.父单)) : null;
    // 归属两路，新路优先：显式 专项 章 → 注册表容器；否则回落战役父单老路。
    const 专 = t.fm.专项 ? 专项按号.get(String(t.fm.专项)) : null;
    const 容器 = 专 ? { id: 专.id, 批名: (专.fm || {}).名称 || 专.id } // 专项批名 = 专项名
      : (父 && 战役类.includes((父.fm || {}).父单类型)) ? { id: 父.id, 批名: (父.fm || {}).title || 父.id }
        : null;
    let g = t.fm.粒ID ? 粒按ID.get(String(t.fm.粒ID)) : null;
    if (!g) g = 粒按单号.get(String(t.id)) || null;

    if (!g) {
      // 新单挂粒：只管专项/战役子单（含返工/推翻新号）。散单不归排程台账，不凭空造粒。
      if (容器) 动作.push(登粒动作(t, 容器, 粒按单号));
      continue;
    }
    已配.add(String(g.粒ID));
    // 状态随单：认单不认归属——迁移来的粒、手工登的粒，只要挂上了单号就一并随单走。
    if (S.终态.includes(g.状态)) continue;
    const 到 = 目标状态(t);
    if (!到 || g.状态 === 到) continue;
    const w = 走法(g.状态, 到);
    if (!w) continue; // 不可达＝要往回走（返修同号回草稿等）：只前进不倒退
    动作.push({
      动作: '转移', 粒ID: g.粒ID, 单号: t.id, 题: g.题 || t.fm.title || t.id,
      从: g.状态, 到: w.终, 路径: w.路径,
      说明: w.说明 || `随单对齐：工单 ${t.id} 现处「${t.state}」${t.fm.归档原因 ? `（${t.fm.归档原因}）` : ''}`,
      因: `粒停在「${g.状态}」，单已走到「${t.state}」`,
    });
  }

  // ---- 孤粒：粒指的单不存在 → 报异常，绝不自动删（人裁）----
  const 异常 = [];
  for (const g of 粒们 || []) {
    if (!g || !g.单号 || 按号.has(String(g.单号))) continue;
    异常.push({
      类型: '孤粒', 粒ID: g.粒ID, 单号: g.单号, 题: g.题 || '', 批: g.批 || '', 状态: g.状态,
      说明: `粒「${g.题 || g.粒ID}」挂着工单 ${g.单号}，但全库找不到这张单——不自动删粒，请人裁（改挂单号 / 撤粒）`,
    });
  }
  // 定序（前缀 → 号）：快照来自目录扫描，天然按状态目录分组，直接抛出去的清单是乱的。
  // 差量是纯函数，同一份输入就该给同一份**可读**输出——回执里的动作清单和执行顺序都指着它。
  const 排 = (a, b) => String(a.单号 || '').replace(/\d+\s*$/, '').localeCompare(String(b.单号 || '').replace(/\d+\s*$/, ''))
    || 序号(a.单号) - 序号(b.单号) || String(a.单号 || '').localeCompare(String(b.单号 || ''));
  动作.sort(排); 异常.sort(排);
  return { 动作, 异常 };
}

// 登粒：批名 = 容器名（专项名 / 战役父单题），返工/推翻新号则**承袭原粒的批**
// （不然同一条活会在两个批里各出现一次）。容器形参是 {id, 批名} 而非一张工单——
// 施工令-058 起容器可能压根不是工单，登粒只需要这两个字段，多要一格就得多认一种形。
function 登粒动作(t, 容器, 粒按单号) {
  const 原 = t.fm.返工自 ? 粒按单号.get(String(t.fm.返工自)) : null;
  const 批 = String((原 && 原.批) || 容器.批名 || 容器.id).slice(0, 40);
  const 状态 = 目标状态(t) || '计划';
  return {
    动作: '登粒', 单号: t.id, 父单: 容器.id,
    批, 序: 序号(t.id), 题: String(t.fm.title || t.id).slice(0, 120), 状态,
    依赖: 依赖照单(t.fm),
    管线: t.fm.职能 || null,
    来源: `工单库对齐 · ${容器.id}/${t.id}`,
    因: 原 ? `返工自 ${t.fm.返工自}，承袭原粒批「${批}」` : `${容器.id}「${批}」子单在台账里无粒`,
  };
}

// ---- ② 执行器：差量动作走 schedule 既有 CAS 通道逐条落 ----
// 逐条而不是整批：登记是「一条不合法则整批不写」的口径，全量回填几十条时一条脏数据能把
// 整次对齐废掉。逐条落，坏的那条自己失败，其余照常补齐。
function 落一条(root, a) {
  try {
    if (a.动作 === '登粒') {
      const r = S.登记(root, [{
        批: a.批, 序: a.序, 题: a.题, 状态: a.状态, 单号: a.单号,
        依赖: a.依赖, 管线: a.管线, 来源: a.来源,
      }], '项管');
      if (!r.ok) return { ok: false, error: r.error };
      if (!r.新增.length) return { ok: true, 幂等: true, 粒ID: (r.跳过[0] || {}).已有粒ID || null };
      return { ok: true, 粒ID: r.新增[0].粒ID };
    }
    if (a.动作 === '转移') {
      let 粒ID = a.粒ID;
      for (let i = 0; i < a.路径.length; i++) {
        const 步 = a.路径[i];
        const g = S.取(root, 粒ID);
        if (!g) return { ok: false, error: `计划粒不存在：${粒ID}` };
        if (g.状态 === 步) continue; // 别人已经推过这一步：幂等跳过，不刷拒绝痕
        const r = S.转移(root, {
          粒ID, 目标: 步, 预期版本: g.版本号, 操作者,
          单号: a.单号,
          说明: i === a.路径.length - 1 ? a.说明 : `台账对齐补链（${g.状态} → ${步}）`,
        });
        if (!r.ok) return { ok: false, error: r.error };
      }
      return { ok: true, 粒ID };
    }
    return { ok: false, error: `未知动作类型：${a.动作}` };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 120) }; }
}

// 失败重试一轮（CAS 冲突是最常见的失败因，重读现态再来一次通常就过了），仍败则入信箱告警。
function 执行(root, 动作们) {
  const 成 = []; let 待 = [];
  for (const a of 动作们 || []) {
    const r = 落一条(root, a);
    if (r.ok) 成.push({ ...a, 粒ID: r.粒ID || a.粒ID, 幂等: !!r.幂等 }); else 待.push({ 动作: a, error: r.error });
  }
  const 败 = [];
  for (const f of 待) {
    const r = 落一条(root, f.动作);
    if (r.ok) 成.push({ ...f.动作, 粒ID: r.粒ID || f.动作.粒ID, 重试: true });
    else 败.push({ 动作: f.动作, error: r.error, 首错: f.error });
  }
  待 = null;
  return { 成, 败 };
}

// ---- 台账里的对齐状态（光标 / 去抖旗 / 孤粒已报）----
function 读状态(root) {
  const l = ledger.read(root);
  return { 光标: null, 待同步起: 0, 末次同步: 0, 已报孤粒: {}, ...(l.台账对齐 || {}) };
}
function 记状态(root, fn) {
  let out = null;
  ledger.update(root, (l) => {
    l.台账对齐 = { 光标: null, 待同步起: 0, 末次同步: 0, 已报孤粒: {}, ...(l.台账对齐 || {}) };
    fn(l.台账对齐);
    out = l.台账对齐;
  });
  return out;
}

// ---- ③a 事件驱动：扫 journal 增量 ----
// 光标按**字节偏移**推进，且只推到最后一个完整行末——半行不入账（UTF-8 多字节被切开会乱码）。
// 首扫不回放历史：上线那一拍本来就要全量对齐，把半个月旧行当"新事件"只会白跑一次。
const 关键词 = ['成单', '派发', '归档', '废弃', '推翻'];
function 扫事件(root, st) {
  const 空 = { 命中: [], 光标: (st && st.光标) || null };
  const dir = path.join(root, 'journal');
  let files;
  try { files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.log$/.test(f)).sort(); } catch { return 空; }
  if (!files.length) return 空;
  const 末 = files[files.length - 1];
  const 文件 = path.join(dir, 末);
  let 大小;
  try { 大小 = fs.statSync(文件).size; } catch { return 空; }
  // 首扫只把光标钉到当前末尾，不回放历史：上线那一拍本就要全量对齐，
  // 把半个月的旧行当"新事件"读一遍，除了白跑一次没有任何收益。
  if (!st || !st.光标) return { 命中: [], 光标: { 文件: 末, 偏移: 大小 } };
  let 旧 = st.光标.文件 === 末 ? Number(st.光标.偏移) || 0 : 0; // 换月：新文件从头读
  if (旧 > 大小) 旧 = 0; // 被截断/重建
  if (旧 === 大小) return { 命中: [], 光标: { 文件: 末, 偏移: 大小 } };
  // 只读增量那一段（30s 一拍，整月日志整读是纯浪费）
  let 增 = Buffer.alloc(0); let fd = null;
  try {
    fd = fs.openSync(文件, 'r');
    const b = Buffer.alloc(大小 - 旧);
    const n = fs.readSync(fd, b, 0, b.length, 旧);
    增 = b.subarray(0, n);
  } catch { return 空; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* 关不上不阻塞 */ } } }
  // 光标只推到最后一个**完整行**末尾：半行不入账（UTF-8 多字节被切开会乱码）
  const 末换行 = 增.lastIndexOf(0x0a);
  const 新偏移 = 末换行 >= 0 ? 旧 + 末换行 + 1 : 旧;
  const 命中 = 增.subarray(0, 末换行 >= 0 ? 末换行 + 1 : 0).toString('utf8').split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.includes(操作者)) // 自产行不自触发（否则一次对齐会自激出第二拍空跑）
    .filter((l) => 关键词.some((k) => l.includes(k)));
  return { 命中, 光标: { 文件: 末, 偏移: 新偏移 } };
}

// ---- ③b 拍频判定（纯函数）----
// 首跑 = 从没同步过 → 立刻全量对齐（要件4）；
// 事件 = 去抖：从**第一条未服务事件**起满 30s 才落地，连发合并成一次；
// 例行 = 5 分钟兜底，事件线漏了也总会被这一拍捞回来。
function 应同步(现在, st) {
  const 上次 = Number((st || {}).末次同步) || 0;
  if (!上次) return { 触发: '首跑' };
  const 起 = Number((st || {}).待同步起) || 0;
  if (起 && 现在 - 起 >= 去抖毫秒) return { 触发: '事件' };
  if (现在 - 上次 >= 例行毫秒) return { 触发: '例行' };
  return { 触发: null };
}

// ---- 同步一次（全量对齐）----
// 每次同步都是全量比对：差量函数拿的是整份快照 + 整份粒账，所以"首跑回填"不是另一条代码路径，
// 它就是第一次跑而已——少一条特判路径，就少一条只在上线那天走过一次、从此无人再验的代码。
function 同步(root, opts = {}) {
  const 现在 = opts.现在 != null ? Number(opts.现在) : Date.now();
  const 快照 = opts.快照 || store.snapshot(root);
  const 粒们 = opts.粒们 || S.现态(root);
  // 专项注册表读盘失败不拦对齐：读不到就只剩战役老路，少登几粒总好过整拍崩掉（同 checkCloseouts 待遇）。
  let 专项们 = opts.专项们;
  if (!专项们) { try { 专项们 = require('../specials').list(root); } catch { 专项们 = []; } }
  const { 动作, 异常 } = 差量(快照, 粒们, 专项们);
  if (opts.演练) return { 演练: true, 触发: opts.触发 || '演练', 动作, 异常 };

  const r = 动作.length ? 执行(root, 动作) : { 成: [], 败: [] };
  const 登 = r.成.filter((x) => x.动作 === '登粒');
  const 转 = r.成.filter((x) => x.动作 === '转移');
  const 新报 = 报孤粒(root, 异常);

  // 每次同步落一条台账事件（要件2）：动作数为 0 也落——"这一拍查过了、没差量"本身就是账。
  ledger.event(root, '台账对齐', {
    触发: opts.触发 || '例行', 动作数: 动作.length, 登粒: 登.length, 转移: 转.length,
    异常: 异常.length, 失败: r.败.length,
  });
  if (动作.length || 新报.length) {
    journal.append(root, `台账对齐（${opts.触发 || '例行'}）：登粒 ${登.length} · 状态随单 ${转.length}`
      + `${r.败.length ? ` · 失败 ${r.败.length}` : ''}${新报.length ? ` · 孤粒 ${新报.length}` : ''}`
      + `${登.length ? `（补登：${登.map((x) => x.单号).join('、')}）` : ''}`);
  }
  if (r.败.length) {
    try {
      require('../inbox').post(root, '常', '台账对齐失败',
        `${r.败.length} 条动作重试后仍失败：${r.败.map((f) => `${f.动作.动作} ${f.动作.单号}（${f.error}）`).join('；')}`.slice(0, 300));
    } catch { /* 信箱失败不阻塞对齐 */ }
  }
  记状态(root, (s) => { s.末次同步 = 现在; s.待同步起 = 0; });
  return { 触发: opts.触发 || '例行', 动作, 异常, 成: r.成, 败: r.败, 新报孤粒: 新报 };
}

// 孤粒告警按粒去重：不然一条挂错单号的粒能每 5 分钟往信箱里丢一次，人裁没来之前先把信箱淹了。
function 报孤粒(root, 异常) {
  const st = 读状态(root);
  const 新 = (异常 || []).filter((x) => !st.已报孤粒[x.粒ID]);
  if (!新.length) return [];
  记状态(root, (s) => { for (const x of 新) s.已报孤粒[x.粒ID] = new Date().toISOString(); });
  for (const x of 新) ledger.event(root, '台账孤粒', { 粒ID: x.粒ID, 单号: x.单号, 题: x.题, 状态: x.状态 });
  try {
    require('../inbox').post(root, '常', '台账孤粒',
      新.map((x) => x.说明).join('；').slice(0, 300));
  } catch { /* 信箱失败不阻塞对齐 */ }
  return 新;
}

// ---- ③ 挂拍入口（由 wake.台账对齐拍 转调，不另起线程）----
function 拍(root, opts = {}) {
  const 现在 = opts.现在 != null ? Number(opts.现在) : Date.now();
  let st = 读状态(root);
  const 扫 = 扫事件(root, st);
  const 光标变 = JSON.stringify(扫.光标) !== JSON.stringify(st.光标);
  if (光标变 || 扫.命中.length) {
    st = 记状态(root, (s) => {
      s.光标 = 扫.光标;
      if (扫.命中.length && !s.待同步起) s.待同步起 = 现在; // 去抖锚在**第一条**事件上
    });
  }
  const 决 = 应同步(现在, st);
  if (!决.触发) return { 触发: null, 命中: 扫.命中.length, 待同步起: st.待同步起 || 0 };
  return 同步(root, { ...opts, 现在, 触发: 决.触发 });
}

module.exports = {
  差量, 目标状态, 走法, 依赖照单, 序号, 执行, 落一条, 同步, 拍,
  扫事件, 应同步, 读状态, 记状态, 报孤粒,
  单态到粒态, 战役类, 操作者, 去抖毫秒, 例行毫秒, 关键词,
};
