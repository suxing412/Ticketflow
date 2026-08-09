// 公用件解析 —— 本产品消费 `packages/*` 的**唯一入口**。
//
// 拓扑（2026-08-09「拓扑正音」后）：**两产品一仓**。
//   Ticketflow/
//     apps/studio     游戏工作流产线（suxin 全权）
//     apps/platform   本产品（robinwang2 全权）   ← 我们在这里
//     packages/       公用件唯一家（双签共建）
//
// 早前的「两仓并排克隆 + TICKETFLOW_HOME 指向兄弟仓」已随一仓合并作废：
// 那套算法从 apps/platform 往上一级找名叫 Ticketflow 的兄弟目录，一仓之后解析成
// `<仓根>/apps/Ticketflow`——不存在，于是 providers/watchtower 全部加载失败。
//
// 为什么消费点必须收在这一处（今天的教训）：
//   交壳时以为本模块已收敛全部消费，实际 server.js 与 scripts/watchtower.js
//   各自抄了一份同样的解析逻辑。改一仓时只改了这里，那两处继续按旧算法跑，
//   结果是「壳能起、providers 表报错、路由与瞭望塔全废」的半死状态。
//   **同一个约定写三遍，就会漏改两遍。**
//
// 环境变量 TICKETFLOW_PACKAGES 仍然认（换布局/做实验时顶一下），正常路径不需要。

const path = require('path');

// apps/platform/lib → apps/platform → apps → 仓根
const 仓根 = path.resolve(__dirname, '..', '..', '..');
const PACKAGES = process.env.TICKETFLOW_PACKAGES || path.join(仓根, 'packages');

// 拼一个公用件路径（不碰磁盘）
function 解析(包名, ...段) {
  return path.join(PACKAGES, 包名, ...段);
}

// 载入公用件。失败时抛人话错误——公用件缺位是部署问题，报错必须直接给出修法，
// 不能只留一句 Cannot find module 让人去猜。
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
