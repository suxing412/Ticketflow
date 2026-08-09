// 公用件解析（并排克隆约定 + TICKETFLOW_HOME 覆盖）——**跨仓消费的唯一入口**。
//
// 背景：公用件（packages/*）的正本住在 Ticketflow 仓，本仓以文件路径消费，不复制、不打包。
// 约定见《仓库总说明书》第一章：两仓必须并排（如 D:\X\Ticketflow + D:\X\AI-DevPlatform），
// 环境变量 TICKETFLOW_HOME 可覆盖。
//
// 为什么要收成一处：交壳时 server.js 用的是 TICKETFLOW_HOME 解法，而
// lib/routing/router.js 里还留着搬家前的相对路径（`../../../../packages/...`，
// 从本仓 lib/routing 上溯四级已经跑出盘符，必然 MODULE_NOT_FOUND）。
// 同一个约定写两遍就会漂——这里是唯一事实源，新增消费点一律走这里。
//
// 注意：本仓对 Ticketflow 的**全部代码级依赖**就两个包——
//   providers（本仓主笔，寄放在对方仓）与 watchtower（对方主笔，信道守护要用）。
// 依赖面窄是好事，别让它无意中变宽。

const path = require('path');

const 仓根 = path.resolve(__dirname, '..');
const TICKETFLOW_HOME = process.env.TICKETFLOW_HOME || path.resolve(仓根, '..', 'Ticketflow');

// 拼一个公用件路径（不碰磁盘）
function 解析(包名, ...段) {
  return path.join(TICKETFLOW_HOME, 'packages', 包名, ...段);
}

// 载入公用件。失败时抛人话错误——公用件缺位是部署问题，报错必须直接给出修法，
// 不能只留一句 Cannot find module 让人去猜。
function 载入(包名, 文件) {
  try {
    return require(解析(包名, 文件));
  } catch (e) {
    const err = new Error(
      `公用件加载失败 ${包名}/${文件}：${e.message}\n`
      + `请确认两仓并排克隆（Ticketflow 与本仓同级），`
      + `或设环境变量 TICKETFLOW_HOME 指向 Ticketflow 仓根。\n`
      + `当前解析：${解析(包名, 文件)}`,
    );
    err.cause = e;
    throw err;
  }
}

module.exports = { 仓根, TICKETFLOW_HOME, 解析, 载入 };
