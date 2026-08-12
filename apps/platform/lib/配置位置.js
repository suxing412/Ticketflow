// 配置放哪 —— 把「随包的出厂默认」和「本机的覆盖与令牌」分开（协-005）。
//
// 起因是拿打包好的 exe 真跑了一次，日志里赫然写着：
//   门禁：沿用既有令牌 → …\resources\app.asar\config\接口令牌.local.json
// 两个问题一起冒出来：
//
// ① **asar 是只读的**。所有 .local.json 的写入在打包态都会失败——
//    包括刚做的「首次打开填个目录就能开工」，而那正是拿到成品的人必走的第一步。
//    开发态一切正常，只有打包后才炸，且表现是「点了没反应」。
//
// ② **本机配置被打进了分发件**。实测那份 exe 里带着开发机的
//    接口令牌.local.json（API 令牌）、工单库.local.json（指向私仓的绝对路径）、
//    项目.local.json、预算.local.json。这些是本机的东西，不该跟着二进制走。
//
// 分法正好落在既有的区分上，不用新造概念：
//   · 出厂默认（platform.config.json / 规则.json / 瞭望塔.config.json）——随包，只读，留在 asar
//   · 本机覆盖（*.local.json / api-token.txt）——可写，必须在 asar 外
'use strict';
const path = require('path');

// 是否跑在 asar 归档里。
// 不用 fs 判断：electron 给 fs 打过补丁，asar 内部路径在 statSync 眼里就是正经目录，
// 问 fs 得到的答案是错的（这个坑在 scripts/开机.js 里踩过一次，那次是 cwd）。
// 看路径字面量反而可靠。
const 在包内 = (p) => String(p).includes('app.asar');

// 出厂默认：跟着代码走，只读就够。
function 只读配置目录(平台根) {
  return path.join(平台根, 'config');
}

// 本机覆盖与令牌：要能写。
//   ① PLATFORM_CONFIG 环境变量 —— 显式指定，最高优先级（测试与多实例靠它隔离）
//   ② 打包态 → exe 同级的 config/
//      用 PORTABLE_EXECUTABLE_DIR 而不是 execPath：portable 目标每次把自己解到
//      %TEMP%\<随机>\ 再启动，execPath 指向那个临时目录，配置写进去下次就没了，
//      而且不报错——表现成「每次打开都要重新配一遍」。
//   ③ 开发态 → 仓内 config/，与今天的行为一致
function 可写配置目录(平台根) {
  const 指定 = String(process.env.PLATFORM_CONFIG || '').trim();
  if (指定) return path.resolve(指定);
  if (在包内(平台根)) {
    const exe目录 = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
    return path.join(exe目录, 'config');
  }
  return path.join(平台根, 'config');
}

module.exports = { 只读配置目录, 可写配置目录, 在包内 };
