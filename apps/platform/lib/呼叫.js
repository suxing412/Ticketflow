// 呼叫 —— 平台侧的机器信道（协-019）。
//
// 需要人知晓或介入的事件，全部结构化落 `呼叫/inbox.jsonl`，一行一笔。
// journal 是人读流水（给排查用），信箱是**机器信道**：无人值守时它是唯一的出口，
// 谁来取（会话 tail / 瞭望塔 / 早上翻一眼）是另一件事，本模块只负责有人写。
//
// 出厂到协-019 之前，这个文件是 **0 字节**——信道从来没有人往里写过。
// 那等于「产品会在你不知道的时候停下来」，而无人值守正是靠这条信道成立的。
//
// ============ 去重：直接抄 studio 2026-08-20 的实证教训 ============
// 他们的品味锁把同一个池切换拒了 265 次（08-11→08-20，每 15 分钟一次），
// 台账 271 条里 265 条是它，而界面只显示最近 5 条——于是**九天的死循环，
// 表现为一条一动不动的红标**。轮询式的巡检必然长出同款：同一张卡死的单，
// 每轮都值得报一次，报到第 100 次时这条信道就没人看了。
//
// 判据：同**指纹**（类型 + 关键字段）在静默窗内已记过就不再记，只在状态变化时落新的一笔。
// **去重的是记账不是判断**——该告警还是告警，只是不再重复喊。
// 不同指纹互不压制：把两条不同的问题合并成一条，比重复喊更糟。
'use strict';

const fs = require('fs');
const path = require('path');

const 文件 = (根) => path.join(根, '呼叫', 'inbox.jsonl');
const 游标 = (根) => path.join(根, '呼叫', 'cursor.json');
const 静默盘 = (根) => path.join(根, '呼叫', '静默.json');

const 默认静默秒 = 6 * 3600;      // 6 小时。同一条卡死的单一天最多喊四次，够了

function 读JSON(p, 缺省) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 缺省; } }

// 指纹 = 类型 + 调用方点名的那几个字段。默认拿 单/池 当键——
// 「TK-3 卡死」和「TK-9 卡死」是两回事，「同一张单卡了一整天」是一回事。
function 指纹(类型, extra) {
  const e = extra || {};
  const 键 = e.指纹 || [类型, e.单 || '', e.池 || '', e.闸 || ''].join('|');
  return String(键);
}

/**
 * 发一笔呼叫。
 * @param {string} 级别 '急'（需要行动）| '常'（知会即可）
 * @param {string} 类型 机器可分类的短词，如 '执行失败' / '在途超时' / '进程重启'
 * @param {string} 摘要 人读的一句话
 * @param {object} extra 额外字段。可带：单 / 池 / 闸 / 指纹（覆盖默认指纹）/ 静默秒（覆盖窗口）
 *   · 静默秒 = 0 显式关掉去重（那些「每一次都必须留痕」的事件，如进程重启）
 * @returns {{ok:boolean, 落:boolean, 因?:string}} 落=false 表示被静默窗吃掉了（不是失败）
 */
function 发(根, 级别, 类型, 摘要, extra) {
  const e = { ...(extra || {}) };
  const 窗秒 = e.静默秒 != null ? Number(e.静默秒) : 默认静默秒;
  delete e.静默秒;
  const fp = 指纹(类型, e);
  const 现在 = Date.now();
  try {
    fs.mkdirSync(path.dirname(文件(根)), { recursive: true });
    if (窗秒 > 0) {
      const 盘 = 读JSON(静默盘(根), {}) || {};
      const 上次 = 盘[fp];
      // 摘要变了 = 状态变了（「在途 31 分钟」→「在途 240 分钟」不算变；调用方要压住这种
      // 就把变动的数字从摘要里挪走或自定指纹）。级别升格一律放行——常升急是新消息。
      const 同 = 上次 && 上次.摘要 === String(摘要) && 上次.级别 === 级别;
      if (同 && 现在 - (上次.t || 0) < 窗秒 * 1000) {
        盘[fp] = { ...上次, 压制次数: (上次.压制次数 || 0) + 1 };
        try { fs.writeFileSync(静默盘(根), JSON.stringify(盘), 'utf8'); } catch { /* 静默盘写不了不该把告警吃掉 */ }
        return { ok: true, 落: false, 因: `静默窗内已记过（${窗秒}s，累计压制 ${盘[fp].压制次数} 次）` };
      }
      // 落一笔就顺带把「上一轮被压了多少次」写进这一笔——不写的话，
      // 一条报了 265 次的告警和一条只报过一次的，在信箱里长得一模一样。
      if (上次 && 上次.压制次数) e.同因压制 = 上次.压制次数;
      盘[fp] = { t: 现在, 摘要: String(摘要), 级别, 压制次数: 0 };
      try { fs.writeFileSync(静默盘(根), JSON.stringify(盘), 'utf8'); } catch { /* 同上 */ }
    }
    const 条 = { t: new Date(现在).toISOString(), 级别, 类型, 摘要: String(摘要).slice(0, 400), ...e };
    // 信箱也会长。轮转在**写之前**问一句：转的动作是 rename，转完原文件不在，
    // 下面这行 append 自己会新建——所以轮转不需要调用方配合做任何事。
    try { require('./轮转').转(文件(根), { 上限字节: 4 * 1024 * 1024, 保留: 3 }); } catch { /* 转不动就让它继续长 */ }
    fs.appendFileSync(文件(根), JSON.stringify(条) + '\n', 'utf8');
    return { ok: true, 落: true };
  } catch (err) {
    // 信道写不进去是**真事故**（无人值守时等于全聋），但不该反过来打断正在跑的活。
    // 控制台是最后一道留痕。
    process.stderr.write(`[呼叫] 写不进信箱：${err.message}\n`);
    return { ok: false, 落: false, 因: err.message };
  }
}

const 急 = (根, 类型, 摘要, extra) => 发(根, '急', 类型, 摘要, extra);
const 常 = (根, 类型, 摘要, extra) => 发(根, '常', 类型, 摘要, extra);

function 列(根, 上限) {
  const raw = (() => { try { return fs.readFileSync(文件(根), 'utf8'); } catch { return ''; } })();
  const 行 = raw.split('\n').filter((l) => l.trim());
  return 行.slice(-(上限 || 100)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// 已读水位走游标，不改写历史行——append-only 纪律：信箱是账本，不是待办清单。
function 未读(根, 上限) {
  const at = (读JSON(游标(根), {}) || {}).at || '';
  return 列(根, 上限 || 500).filter((x) => x.t > at);
}

function 标记已读(根) {
  try {
    fs.mkdirSync(path.dirname(游标(根)), { recursive: true });
    fs.writeFileSync(游标(根), JSON.stringify({ at: new Date().toISOString() }), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { 文件, 游标, 静默盘, 发, 急, 常, 列, 未读, 标记已读, 指纹, 默认静默秒 };
