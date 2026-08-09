// 公用件解析 —— 本仓消费 `packages/*` 的唯一入口。
//
// 拓扑（2026-08-09「拓扑正音」后）：**两产品一仓**。
//   Ticketflow/
//     apps/studio     游戏工作流产线（suxin 全权）
//     apps/platform   本产品（robinwang2 全权）  ← 我们在这里
//     packages/       公用件唯一家（双签共建）
//
// 早前的「两仓并排克隆 + TICKETFLOW_HOME」已随一仓合并作废，本模块相应改为按仓根解析。
// 环境变量仍然认（换布局/做实验时能顶一下），但正常路径不需要它。
//
// 为什么还留着这一层（一仓之后相对路径其实能直接写）：
//   ① 消费点集中一处——将来 packages 若发成 npm 包，只改这里；
//   ② 失败时报人话错误并打印实际解析路径，而不是一句 Cannot find module；
//   ③ 依赖面看得见——本仓消费了哪些公用件，`npm test` 有断言盯着，变宽即红。

const path = require('path');

// apps/platform/lib → apps/platform → apps → 仓根
const 仓根 = path.resolve(__dirname, '..', '..', '..');
const PACKAGES = process.env.TICKETFLOW_PACKAGES || path.join(仓根, 'packages');

function 解析(包名, ...段) {
  return path.join(PACKAGES, 包名, ...段);
}

function 载入(包名, 文件) {
  try {
    return require(解析(包名, 文件));
  } catch (e) {
    const err = new Error(
      `公用件加载失败 ${包名}/${文件}：${e.message}\n`
      + `公用件唯一家是仓根的 packages/；换布局时可用 TICKETFLOW_PACKAGES 指向它。\n`
      + `当前解析：${解析(包名, 文件)}`,
    );
    err.cause = e;
    throw err;
  }
}

module.exports = { 仓根, PACKAGES, 解析, 载入 };
