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

const 门槛 = 2;      // 连续几个巡检周期零派发才报
const 复报间隔 = 4;  // 报过之后每隔几个周期再提醒一次（防信箱刷屏，也防报一次就沉默）

// 按仓记忆（一个进程只服务一个仓；测试各用各的临时仓，天然隔离）
const 记忆 = new Map();

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

function 重置(root) { if (root) 记忆.delete(root); else 记忆.clear(); }

module.exports = { 零派发告警, 重置, 门槛, 复报间隔 };
