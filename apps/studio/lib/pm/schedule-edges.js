// pm/schedule-edges.js — 依赖边服务端读口（甘特施工令 P0-0 裁决④ · 2026-08-24）
// 外审对齐：CX-3/DS-1「前端只画不判」——边解析/冲突/环全部服务端下发，前端只按下发状态着色。
//
// 【落点取舍】不追加进 schedule-view.js：schedule-view 是三消费呈现口径（5态×3消费断言钉着），
// 边集是图分析层，有自己的合成台账判据（test/schedule-edges.test.js）；且 P2 依赖线 /
// DS-7 冲突角标 / 队列页置灰升级都会消费它——混进 view 会让两份判据互相绊。
// **纯函数零 I/O**：路由层注入 粒们+单册（server.js GET /api/schedule），整片可单测。
//
// 【数据形状证据】
//  粒.依赖 = [{ref,规则}]，ref=粒ID(UUID)或单号，规则∈{全部完成,任一完成}——schedule.js:40,214-236,308
//  fm.依赖 = 数组或逗号/空白分隔串（裸单号，无规则）——dispatch.js:13-15、chain.js:265-267
//  端点终态口径（裁决④）＝ **dispatch.depsDone**（dispatch.js:12-39）：
//    单侧 了结 = 完成 ∨（归档 且无 归档原因）；废弃/带因归档 = 等不来但**账没了**——
//    这样的前置在 depsDone 眼里永不就绪，边保持在场（该红就红），不许标成外部旧账藏起来。
//    粒侧 终态 = schedule.js 终态（完成/撤销）。
//    spike C 发现的三消费方既有口径不一致（schedule-view 未查归档原因）记遗留，不在本工程修（无漂移）。
'use strict';

const schedule = require('./schedule'); // 计划毫秒＝两形态唯一比较轴（schedule.js:162），不许各解析各的

const 终态粒 = ['完成', '撤销'];          // 粒五态终态（schedule.js 终态）
const 刻钟形 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const 单号形 = /^[A-Z]{1,6}-\d+$/;
const 天毫 = 86400000;

// 完成毫：纯日期讫含尾一整天（+天毫），刻钟形取精确时刻——与 app.js 时段() 条几何同语义
// （app.js 讫 = 含时 ? ms : ms+天毫）。图上条尾画到哪，冲突就从哪起算，两把尺必须是一把。
function 完成毫(v) {
  const t = schedule.计划毫秒(v);
  return t == null ? null : t + (刻钟形.test(String(v).trim()) ? 0 : 天毫);
}

// —— ref 解析 ——
// 节点键：命中粒 → 粒ID；无粒的现存单 → '单:'+单号；解析不到 → '外:'+ref（悬空外部端点）
function 建索引(粒们) {
  const 粒表 = new Map(), 单号粒 = new Map();
  for (const g of 粒们 || []) {
    if (!g || !g.粒ID) continue;
    粒表.set(String(g.粒ID), g);
    if (g.单号) {
      const 旧 = 单号粒.get(g.单号);
      // 同单号多粒（收回重投史账，见 schedule.挂钩派发 的回查口径）：非终态优先，再按更新时刻取新
      const 换 = !旧
        || (终态粒.includes(旧.状态) && !终态粒.includes(g.状态))
        || (终态粒.includes(旧.状态) === 终态粒.includes(g.状态)
            && String(g.更新时刻 || '') > String(旧.更新时刻 || ''));
      if (换) 单号粒.set(g.单号, g);
    }
  }
  return { 粒表, 单号粒 };
}

// 单册（路由层注入，本模块不碰 fs）：{ 单号: { 态, 项目, 归档原因, 依赖 } }
function 解析端点(ref, 索, 单册) {
  const r = String(ref || '').trim();
  const 粒 = 索.粒表.get(r) || 索.单号粒.get(r) || null;
  if (粒) return { 键: 粒.粒ID, 粒ID: 粒.粒ID, 单号: 粒.单号 || null, 粒 };
  const 单 = (单册 || {})[r] || null;
  if (单) return { 键: '单:' + r, 粒ID: null, 单号: r, 单 };
  return { 键: '外:' + r, 粒ID: null, 单号: 单号形.test(r) ? r : null, 悬空: true };
}

// 单侧了结判（裁决④＝depsDone 口径）：完成 ∨ 归档且无归档原因。别的态一律「还欠着」。
const 单已了 = (单) => 单.态 === '完成' || (单.态 === '归档' && !单.归档原因);

// —— 外部判：悬空 ∨ 跨项目 ∨ 端点已终态/已了结。外部边不判冲突（终态前置的冲突是已了结的旧账）——
function 端外因(端, 侧, 项目) {
  if (端.悬空) return `${侧}解析不到`;
  if (端.粒) {
    if (终态粒.includes(端.粒.状态)) return `${侧}已终态(${端.粒.状态})`;
    if (项目 && 端.粒.项目 && 端.粒.项目 !== 项目) return `${侧}跨项目(${端.粒.项目})`;
  } else if (端.单) {
    if (单已了(端.单)) return `${侧}已了结(${端.单.态})`;
    if (项目 && 端.单.项目 && 端.单.项目 !== 项目) return `${侧}跨项目(${端.单.项目})`;
  }
  return null;
}

// —— 环：迭代 Tarjan（显式帧栈，无递归；百级数据毫秒完）。自环=size-1 SCC 带自边，单独补判 ——
function 强连通组(节点集, 邻接) {
  let idx = 0, 组号 = 0;
  const 序 = new Map(), 低 = new Map(), 在栈 = new Set(), 栈 = [], 属 = new Map();
  for (const 起 of 节点集) {
    if (序.has(起)) continue;
    const 帧栈 = [[起, 0]];
    while (帧栈.length) {
      const 帧 = 帧栈[帧栈.length - 1], v = 帧[0];
      if (帧[1] === 0) { 序.set(v, idx); 低.set(v, idx); idx++; 栈.push(v); 在栈.add(v); }
      const 邻 = 邻接.get(v) || [];
      let 下钻 = false;
      while (帧[1] < 邻.length) {
        const w = 邻[帧[1]++];
        if (!序.has(w)) { 帧栈.push([w, 0]); 下钻 = true; break; }
        if (在栈.has(w)) 低.set(v, Math.min(低.get(v), 序.get(w)));
      }
      if (下钻) continue;
      帧栈.pop();
      if (帧栈.length) { const p = 帧栈[帧栈.length - 1][0]; 低.set(p, Math.min(低.get(p), 低.get(v))); }
      if (低.get(v) === 序.get(v)) {
        const 组 = []; let w;
        do { w = 栈.pop(); 在栈.delete(w); 组.push(w); } while (w !== v);
        if (组.length > 1) { for (const x of 组) 属.set(x, 组号); 组号++; }
      }
    }
  }
  return { 属, 下个组号: () => 组号++ };
}

// ═══ 主函数：边集(粒们, 单册, opts) ═══
// 入参：粒们 = schedule.现态(ROOT) **全量不过滤**（跨项目前置是常态，过滤后判会把它判成悬空）；
//       单册 = 路由层从 store.snapshot 摊平；opts.项目 = 当前项目视界（缺省不判跨项目）。
// 出参：{ 边:[{from:{键,粒ID,单号}, to:{同}, 规则, 源, 外部, 外部因, 冲突, 冲突因, 环, 环组}],
//         统计:{总数,冲突,环,外部} } —— 前端只按 外部/冲突/环 着色，一律不自算。
function 边集(粒们, 单册, opts = {}) {
  const 索 = 建索引(粒们);
  const 项目 = String(opts.项目 || '').trim() || null;
  const 边 = []; const 去重 = new Set();
  const 收 = (to端, ref, 规则, 源) => {
    const from端 = 解析端点(ref, 索, 单册);
    const k = `${from端.键}→${to端.键}|${规则}`;
    if (去重.has(k)) return;                    // 粒依赖与其成单后 fm.依赖 撞同一条边时去重
    去重.add(k);
    边.push({ from: from端, to: to端, 规则, 源 });
  };
  // ① 粒.依赖（结构化，带规则）——方向：from=前置(ref 所指)，to=后继(依赖持有粒)
  for (const g of 粒们 || []) {
    if (!g || !Array.isArray(g.依赖) || !g.依赖.length) continue;
    const to端 = { 键: g.粒ID, 粒ID: g.粒ID, 单号: g.单号 || null, 粒: g };
    for (const d of g.依赖) if (d && d.ref) 收(to端, d.ref, d.规则 || '全部完成', '粒依赖');
  }
  // ② 单.fm.依赖（裸单号串/数组，规则一律 全部完成——depsDone 就是全量与，无任一语义）
  for (const [单号, t] of Object.entries(单册 || {})) {
    const d = t && t.依赖; if (!d) continue;
    const refs = (Array.isArray(d) ? d.map(String) : String(d).split(/[，,\s]+/)).filter(Boolean);
    const 自粒 = 索.单号粒.get(单号) || null;   // 单已挂粒 → 端点归一到粒节点（同一实体不双开节点）
    const to端 = 自粒 ? { 键: 自粒.粒ID, 粒ID: 自粒.粒ID, 单号, 粒: 自粒 }
                     : { 键: '单:' + 单号, 粒ID: null, 单号, 单: t };
    for (const ref of refs) 收(to端, ref, '全部完成', '单依赖');
  }
  // ③ 外部 + 冲突（外部边不判冲突；端点非粒或计划缺格 → 冲突不成立，不拿 null 冒充 0）
  for (const e of 边) {
    const 因 = 端外因(e.from, '前置', 项目) || 端外因(e.to, '后继', 项目);
    e.外部 = !!因; e.外部因 = 因 || null;
    e.冲突 = false; e.冲突因 = null;
    if (!e.外部 && e.from.粒 && e.to.粒) {
      const a = 完成毫(e.from.粒.计划完成), b = schedule.计划毫秒(e.to.粒.计划开始);
      if (a != null && b != null && b < a) {
        e.冲突 = true;
        e.冲突因 = `后继计划开始 ${e.to.粒.计划开始} 早于前置计划完成 ${e.from.粒.计划完成}`;
      }
    }
  }
  // ④ 环：节点=边端点全集，邻接 from→to；SCC>1 内的边 + 自环边 → 环:true
  const 节点集 = new Set(), 邻接 = new Map();
  for (const e of 边) {
    节点集.add(e.from.键); 节点集.add(e.to.键);
    if (!邻接.has(e.from.键)) 邻接.set(e.from.键, []);
    邻接.get(e.from.键).push(e.to.键);
  }
  const { 属, 下个组号 } = 强连通组(节点集, 邻接);
  const 自环组 = new Map();
  for (const e of 边) {
    if (e.from.键 === e.to.键) {                 // 自环（fm.依赖 可自指；粒侧 调整 已拦 schedule.js:449）
      if (!自环组.has(e.from.键)) 自环组.set(e.from.键, 下个组号());
      e.环 = true; e.环组 = 自环组.get(e.from.键);
    } else {
      const a = 属.get(e.from.键), b = 属.get(e.to.键);
      e.环 = a != null && a === b; e.环组 = e.环 ? a : null;
    }
  }
  // ⑤ 收形：剥掉内部实体引用，只下发契约字段（键 保留＝前端锚点缓存 DS-11 用）
  const 出边 = 边.map((e) => ({
    from: { 键: e.from.键, 粒ID: e.from.粒ID, 单号: e.from.单号 },
    to: { 键: e.to.键, 粒ID: e.to.粒ID, 单号: e.to.单号 },
    规则: e.规则, 源: e.源,
    外部: e.外部, 外部因: e.外部因,
    冲突: e.冲突, 冲突因: e.冲突因,
    环: e.环, 环组: e.环组,
  }));
  return {
    边: 出边,
    统计: {
      总数: 出边.length,
      冲突: 出边.filter((x) => x.冲突).length,   // DS-7 工具栏冲突角标直接读这格
      环: 出边.filter((x) => x.环).length,
      外部: 出边.filter((x) => x.外部).length,
    },
  };
}

module.exports = { 边集, 建索引, 解析端点, 完成毫, 计划毫秒: schedule.计划毫秒 };
