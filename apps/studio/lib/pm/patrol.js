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

function 零派发告警(root, cfg, opts = {}) {
  const ready = dispatch.readySet(root, pool.criticalSet(root));
  const 在跑 = opts.执行中 != null ? opts.执行中 : 执行中数(root);
  const 派发数 = opts.派发累计 != null ? opts.派发累计 : 派发累计(root);
  const m = 记忆.get(root) || { 派发数: null, 连续零: 0 };
  const 有新派发 = m.派发数 != null && 派发数 > m.派发数;

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
  if (root) { 记忆.delete(root); 打点记忆.delete(root); 零输出记忆.delete(root); }
  else { 记忆.clear(); 打点记忆.clear(); 零输出记忆.clear(); }
}

module.exports = { 零派发告警, 打点停滞, 零输出, 重置, 门槛, 复报间隔, 停滞分钟 };
