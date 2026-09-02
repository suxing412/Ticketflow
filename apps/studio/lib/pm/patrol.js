// pm/patrol.js — 巡检告警（H81 常开单闸制）：零派发看门狗。
// 案源 2026-08-06：换装后全局暂停闸漏开，四张放行单滞留 9.5 小时零派发零告警。
// 判据（全确定性，零 token）：就绪队列非空（已放行 + 依赖就绪的待投单）
//   且 零执行中 且 自上一巡检周期无新派发 → 连续计数 +1；连续 ≥2 个周期 → 呼叫信箱告警一条。
// 任一条件不成立（有单派出去了 / 有会话在跑 / 队列本来就空）→ 计数归零。
const dispatch = require('./dispatch');
const pool = require('../pool');
const ledger = require('./ledger');
const inbox = require('../inbox');
const journal = require('../journal');
const progress = require('../progress');

const 门槛 = 2;      // 连续几个巡检周期零派发才报
const 复报间隔 = 4;  // 报过之后每隔几个周期再提醒一次（防信箱刷屏，也防报一次就沉默）
const 停滞分钟 = 20; // 打点停滞判据（施工令-004）：最后打点超过这么久没前进才提醒

// 按仓记忆（一个进程只服务一个仓；测试各用各的临时仓，天然隔离）
const 记忆 = new Map();
const 打点记忆 = new Map(); // root → Map(单号 → { 打点, 打点时, 尾, 尾时, 已报 })

function 派发累计(root) {
  try { return ledger.events(root, 2000).filter((e) => e.类型 === '派发').length; } catch { return 0; }
}
function 执行中数(root) {
  try { return [...require('../runner').running.values()].filter((e) => e.kind === '执行').length; }
  catch { return 0; } // 取不到在跑表时按 0 计：宁可多报一次，不可漏报（案源就是漏报）
}

// 到点却无单可派：**就绪队列为空时该不该报**的判据（议程第 34 条，2026-08-28）。
//
// 盲区案源（2026-08-27 整夜）：排程把十一粒排到点，而十一张待派单全部 放行=false
// （九张是总监故意停靠、其余等项管开闸）。于是就绪队列**恰恰是空的**，
// 零派发狗第一条就判「队列本来就空」计数归零，整夜零告警。
// 它的原始案源（2026-08-06）盯的是「**已放行**单滞留」，看不见「排期到点却从未放行」这个变种。
//
// 补法：队列空时再问一句——**有没有粒已经到点、而它的单进不了就绪面**？
// 有就是真空转，只是堵在放行侧不在派发侧；停靠单不算（那是人故意摁住的，不是遗忘）。
function 到点无单(root) {
  try {
    const S = require('./schedule');
    const store = require('../core/store');
    const now = Date.now();
    const 到点 = S.现态(root).filter((g) => g.状态 === '已成单' && g.计划开始
      && S.计划毫秒(g.计划开始) <= now);
    const 卡住 = [];
    for (const g of 到点) {
      if (!g.单号) continue;
      let t = null;
      try { t = store.find(root, String(g.单号)); } catch { t = null; }
      if (!t) continue;
      // 停靠＝人故意摁住的，不是遗忘，不算空转（议程第 33 条已给它 G26 这个住址）
      if (t.fm && t.fm.停靠 === true) continue;
      if (['待派', '待重派'].includes(t.state) && t.fm.放行 !== true) {
        卡住.push({ 单: t.id, 粒: String(g.粒ID || '').slice(0, 8), 计划开始: g.计划开始 });
      }
    }
    return 卡住;
  } catch { return []; }   // 探不动就当没有——宁可漏这一路，不可让巡检因它抛异常整体停摆
}

// 复判判出「不是排期的锅」时的升格口（议程第 35 条，2026-08-28）。
//
// 复判自己诊断得没错（2026-08-27 00:07 原话「空转属派发侧未拉起而非排期偏差」），
// 但它只往 journal 写一行，15 分钟一轮连报四次，整夜无人知。**能诊断而交不出去，等于没诊断。**
// 这里给它一个出口：进急件、进台账，且同一因由只升一次——复判是循环触发的，
// 不去重的话会把这条升格变成新的刷屏源，那就从「漏报」翻到另一头去了。
//
// 去重键必须取**结构**，不能取措辞（2026-08-28 15:2x 实测修）。原样把 因 的前 80 字当键，
// 而 因 是复判会话现写的散文——同一个局面每轮换一种说法，键永远不重样，去重形同虚设：
//   06:39「停靠粒挪不动、待派粒卡在放行侧，且全表实起实完为 null，无偏差证据」
//   06:54「无实起实完可读，偏差不可断言；停靠粒等裁决、放行=false待派粒卡在放行侧，均非排期问题」
// 十五分钟两封急件，讲的是同一件事。**上面那句「不去重会变成新的刷屏源」的自我告诫，
// 写下了但没兑现**——键选错了，防线就只是一句注释。
//
// 现在键 = 命中的因类，排序后拼接。措辞怎么变都无所谓，只要说的还是同一类堵点就不再喊；
// 堵点真换了一类（停靠 → 无单可派）才重喊一次，那本就该喊。
const 空转因类 = ['派发侧', '未拉起', '放行', '停靠', '无单可派'];
/** 命中的非排期因类（排序、去重）。空数组＝这不是非排期空转，调用方据此决定升不升。 */
function 非排期空转类(因) {
  const s = String(因 || '');
  return 空转因类.filter((w) => s.includes(w)).sort();
}

// 记忆仍是进程内的：换装重启后同一堵点会再喊一次。**这是知情的取舍**——
// 落盘去重要多一个状态文件与它自己的损坏/清理问题，而重启后重报一次的代价是一封急件，
// 远小于原样这个每轮一封的量级。若日后换装变得频繁到这一封也嫌吵，再谈落盘。
const 升格记忆 = new Map();
function 升格非排期空转(root, 因) {
  const 类 = 非排期空转类(因);
  if (!类.length) return { 升: false, 因: '未命中任何非排期因类，不升格' };
  const 键 = 类.join('|');
  const m = 升格记忆.get(root);
  if (m === 键) return { 升: false, 因: '同一因类已升过，不重复' };
  升格记忆.set(root, 键);
  const 文 = `产线空转非排期所致（复判判定）：${键}——排期没问题，堵在别处；`
    + `复判只会重排，解不了这一类，需人看一眼（议程第 35 条）`;
  try { inbox.post(root, '急', '空转非排期', 文.slice(0, 300)); } catch { /* 信箱失败不阻塞留痕 */ }
  try { journal.append(root, 文); } catch { /* 留痕失败不阻塞 */ }
  try { ledger.event(root, '空转非排期', { 因: 键 }); } catch { /* 记账失败不阻塞 */ }
  return { 升: true, 文 };
}

function 零派发告警(root, cfg, opts = {}) {
  const ready = dispatch.readySet(root, pool.criticalSet(root));
  const 在跑 = opts.执行中 != null ? opts.执行中 : 执行中数(root);
  const 派发数 = opts.派发累计 != null ? opts.派发累计 : 派发累计(root);
  const m = 记忆.get(root) || { 派发数: null, 连续零: 0 };
  const 有新派发 = m.派发数 != null && 派发数 > m.派发数;

  // 队列空、零在跑、且有到点粒卡在放行侧 → 这是另一种零派发，得单独报（第 34 条）
  const 卡放行 = (!ready.length && 在跑 === 0)
    ? (opts.到点无单 != null ? opts.到点无单 : 到点无单(root))
    : [];
  if (卡放行.length) {
    const 键 = 卡放行.map((x) => x.单).sort().join(',');
    const 上 = m.卡放行键;
    m.卡放行键 = 键;
    // 同一批单只在**集合变化时**报一次：15 分钟一拍重复喊同一句，喊三十遍就没人看了
    if (键 !== 上) {
      const 文 = `到点无单可派：${卡放行.length} 粒已过计划开始却卡在放行侧（单 ${卡放行.slice(0, 8).map((x) => x.单).join('、')}${卡放行.length > 8 ? ' 等' : ''}）`
        + `——就绪队列为空不代表没事，零派发狗的原判据看不见这一路（议程第 34 条）`;
      try { inbox.post(root, '急', '到点无单', 文.slice(0, 300)); } catch { /* 信箱失败不阻塞留痕 */ }
      try { journal.append(root, 文); } catch { /* 留痕失败不阻塞 */ }
      try { ledger.event(root, '到点无单', { 卡住: 卡放行.slice(0, 20) }); } catch { /* 记账失败不阻塞 */ }
      m.派发数 = 派发数; 记忆.set(root, m);
      return { 就绪: [], 连续零: m.连续零, 告警: 文, 卡放行 };
    }
  } else { m.卡放行键 = null; }

  let 告警 = null;
  if (!ready.length || 在跑 > 0 || 有新派发) m.连续零 = 0;
  else {
    m.连续零 += 1;
    if (m.连续零 >= 门槛 && (m.连续零 - 门槛) % 复报间隔 === 0) {
      const ids = ready.map((r) => r.id);
      告警 = `零派发告警：就绪 ${ids.length} 单已连续 ${m.连续零} 个巡检周期零派发、零执行中——滞留单 ${ids.slice(0, 20).join('、')}${ids.length > 20 ? ' 等' : ''}`;
      inbox.post(root, '急', '零派发', 告警.slice(0, 300), ids.length === 1 ? { 单号: ids[0] } : undefined);
      try { journal.append(root, 告警); } catch { /* 留痕失败不阻塞告警 */ }
      try { ledger.event(root, '零派发', { 就绪: ids.slice(0, 20), 连续: m.连续零 }); } catch { /* 记账失败不阻塞 */ }
    }
  }
  m.派发数 = 派发数;
  记忆.set(root, m);
  void cfg; // 判据只用就绪队列与在跑表；留 cfg 参保持巡检调用签名一致
  return { 就绪: ready.map((r) => r.id), 连续零: m.连续零, 告警 };
}

// ---- 打点停滞看门狗（施工令-004 追加范围）----
// 施工令-049 / H100 起打点退出进度计算（进度改吃预算时间），本狗成了 progress.解析打点 的
// **唯一消费者**——打点从「进度来源」降级为纯活性信号：还打不打点都不影响百分比，
// 但打过点又不动了仍是卡死的强征兆，这条看门狗照旧值守。
// 打点是软契约：缺失不告警不判罚。本条只管「曾经打过点、然后不动了」——
// 判据：在跑执行会话 且 曾出现打点 且 最后打点 >20 分钟未前进 且 tail 无新输出 → 信箱普通级一条。
// 无打点的单不适用（它压根没签这份软契约，缺席不是过错）。
// 一次停滞只报一次：打点或 tail 任一前进即解除并重新计时。
function 打点停滞(root, cfg, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const 在跑 = opts.执行中 != null ? opts.执行中 : 执行中表(root);
  const mem = 打点记忆.get(root) || new Map();
  const 活着 = new Set();
  const 告警 = [];
  for (const e of 在跑) {
    if (!e || e.kind !== '执行' || !e.id) continue;
    if (挂起中(root, e.id)) continue; // 施工令-021：冻结单不盯（连记忆都不留，解挂后从零重新计时）
    活着.add(e.id);
    const 尾 = e.tail || '';
    const 点 = progress.解析打点(尾);
    const 点串 = 点 ? `${点.k}/${点.n}` : null;
    const m = mem.get(e.id) || { 打点: null, 打点时: now, 尾: null, 尾时: now, 已报: false };
    if (点串 && 点串 !== m.打点) { m.打点 = 点串; m.打点时 = now; m.已报 = false; } // 打点前进：解除并重计时
    if (尾 !== m.尾) { m.尾 = 尾; m.尾时 = now; m.已报 = false; }                   // 还有新输出：不算停滞
    mem.set(e.id, m);
    if (!m.打点) continue;                                                          // 从没打过点：本条不适用
    const 停 = now - m.打点时; const 静 = now - m.尾时;
    if (停 > 停滞分钟 * 60000 && 静 > 停滞分钟 * 60000 && !m.已报) {
      m.已报 = true;
      const 文 = `打点停滞：${e.id} 最后打点 ${m.打点} 已 ${Math.round(停 / 60000)} 分钟未前进，tail 同期无新输出——盯一眼是不是卡住了`;
      inbox.post(root, '常', '打点停滞', 文.slice(0, 300), { 单号: e.id });
      try { journal.append(root, 文); } catch { /* 留痕失败不阻塞告警 */ }
      try { ledger.event(root, '打点停滞', { 单: e.id, 打点: m.打点, 停滞分: Math.round(停 / 60000) }); } catch { /* 记账失败不阻塞 */ }
      告警.push(文);
    }
  }
  for (const id of [...mem.keys()]) if (!活着.has(id)) mem.delete(id); // 会话收场即忘，不留幽灵
  打点记忆.set(root, mem);
  void cfg; // 判据只用在跑表；留 cfg 参保持巡检调用签名一致
  return { 盯守: [...mem.keys()], 告警 };
}

// ---- 零输出看门狗（施工令-010，制作人 2026-08-06 23:59 批准）----
// 案源 TK-102：codex 执行会话拉起后 tail 恒空、挂死 48 分钟无人察觉（2026-08-07 00:06 制作人亲自问出）。
// 既有三只狗全不适用：零派发狗看的是「零在跑」（这里在跑数 >0）；打点停滞狗只管「打过点又不动了」
// （这会话一个字都没吐过）；软超时验尸要等 30 分钟闸到点才验。零输出是独立病征，得独立一只狗。
// 判据（确定性，零 token）：执行会话拉起 ≥ config.并发.零输出分钟（默认 8）且**全程零输出** → 信箱急件一条。
// 「零输出」= tail 空 **且** 收字节为 0（施工令-010 第 5 条：活性 = stdout∪stderr 任一有新字节）——
// codex 的过程行全在 stderr，只看 stdout 会把每一个正常跑着的 codex 会话都报成挂死。
// 同一会话只报一次（键 = 单号@拉起时间：同单重投是新会话，看门狗重新武装）；会话收场即忘。
const 零输出记忆 = new Map(); // root → Set(会话键)
function 零输出(root, cfg, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const 在跑 = opts.执行中 != null ? opts.执行中 : 执行中表(root);
  const 门分 = require('../concurrency').零输出分钟(cfg);
  const 报过 = 零输出记忆.get(root) || new Set();
  const 活着 = new Set();
  const 告警 = [];
  for (const e of 在跑) {
    if (!e || e.kind !== '执行' || !e.id) continue;
    if (挂起中(root, e.id)) continue; // 施工令-021：冻结单不盯
    const 起 = Date.parse(e.startedAt || '');
    if (!Number.isFinite(起)) continue;                 // 无拉起时间戳：不臆测历时，本条不适用
    const key = `${e.id}@${e.startedAt}`;
    活着.add(key);
    if (String(e.tail || '').trim() || Number(e.收字节) > 0) continue; // 吐过字节（任一路）：不是零输出（后来停了那是打点停滞狗的活）
    const 历时 = now - 起;
    if (历时 < 门分 * 60000 || 报过.has(key)) continue;
    报过.add(key);
    const 分 = Math.round(历时 / 60000);
    const 文 = `零输出告警：${e.id} 会话已拉起 ${分} 分钟（池 ${e.池 || '—'}）仍零输出——会话疑似挂死，去看一眼`;
    try { inbox.post(root, '急', '零输出', 文.slice(0, 300), { 单号: e.id }); } catch { /* 信箱失败不阻塞留痕 */ }
    try { journal.append(root, 文); } catch { /* 留痕失败不阻塞告警 */ }
    try { ledger.event(root, '零输出', { 单: e.id, 池: e.池 || '', 已历时分: 分, 门槛分: 门分 }); } catch { /* 记账失败不阻塞 */ }
    告警.push(文);
  }
  for (const k of [...报过]) if (!活着.has(k)) 报过.delete(k); // 会话收场即忘，不留幽灵
  零输出记忆.set(root, 报过);
  return { 盯守: [...活着], 告警 };
}

function 执行中表(root) {
  try { return [...require('../runner').running.values()].filter((e) => e.kind === '执行'); }
  catch { return []; } // 取不到在跑表：本条静默跳过（软契约不因探测失败而误报）
}

// 挂起单一律不进任何看门狗的视野（施工令-021）。零派发狗走 dispatch.readySet 已天然过滤；
// 打点停滞狗与零输出狗看的是在跑表——挂起时会话本该已被掐（server 侧 killTicket），
// 这道判断是防残留会话：制作人明明按下了冻结，还收到该单「卡住了」的告警是自相矛盾的噪声。
function 挂起中(root, id) {
  try { const t = require('../core/store').find(root, id); return !!(t && t.fm.挂起); }
  catch { return false; } // 读不到就当没挂：宁可多报一次，不可漏报（沿用本模块一贯口径）
}

function 重置(root) {
  if (root) { 记忆.delete(root); 打点记忆.delete(root); 零输出记忆.delete(root); 升格记忆.delete(root); }
  else { 记忆.clear(); 打点记忆.clear(); 零输出记忆.clear(); 升格记忆.clear(); }
}

// 非排期空转类 与 空转因类 一并导出：调用侧（runner.js 的复判收官回调）原本自带一份
// 正则 /派发侧|未拉起|放行|停靠|无单可派/ 判「要不要升格」，与这里的去重词表是**两把尺**——
// 改一处漏一处的老病（白名单吞字段家族）。现在两边同读这一份。
module.exports = { 零派发告警, 到点无单, 升格非排期空转, 非排期空转类, 空转因类, 打点停滞, 零输出, 重置, 门槛, 复报间隔, 停滞分钟 };
