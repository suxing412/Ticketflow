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
// 播种示例 要拷文件才引 fs。注意下面 在包内 判定**故意不用 fs**——
// electron 给 fs 打过补丁，asar 内部路径在 statSync 眼里是正经目录，问它得到的是错答案。
const fs = require('fs');

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

// 把 .示例 播到可写配置目录（协-036）。
//
// 起因：翻 2026-08-16 那次真打包留下的 dist/config/，里面只有三个文件——
//   api-token.txt、接口令牌.local.json（都是开机自动生成的）
//   工单库.local.json（界面上那个输入框配的）
// **四个要手配的一个都没有**，而且不可能有：`.示例` 全躺在 app.asar 里，
// 而 asar 是只读的、在文件管理器里也打不开。于是拿到 exe 的人处境是——
// 工单库能在界面上配，真跑 / 预算 / 写权 / 项目注册**无路可走**：
// 既没有模板可改名，也没有地方放改好的文件。
//
// 源码用户有 `.示例` 就一次写对，打包用户连模板都看不见（协-036 那轮我自己就因为
// 没模板把 workspace.local.json 的形状写错了）。所以第一次开机把模板播出来：
// **exe 旁边的 config/ 里躺着一排 .示例，改个名就生效**——这才叫拿得到。
//
// 三条纪律：
//   ① **只播 .示例，绝不播 .local.json**。播出一份真配置等于替人决定业务数据落哪、
//      要不要花钱——那正是自检拒绝做的事；
//   ② **绝不覆盖**。已经在那儿的（哪怕是用户改过的模板）原样留着；
//   ③ **绝不抛**。播种失败最多是「少了几个模板」，不该反过来让产品起不来。
function 播种示例(平台根) {
  const 源 = 只读配置目录(平台根);
  const 靶 = 可写配置目录(平台根);
  // 开发态两者同一个目录，没什么可播的——也不能播，源和靶同名会自己覆盖自己。
  if (path.resolve(源) === path.resolve(靶)) return { 播: [], 因: '开发态：可写配置就是随包那份' };
  const 播 = [];
  try {
    fs.mkdirSync(靶, { recursive: true });
    for (const 名 of fs.readdirSync(源)) {
      if (!名.endsWith('.示例')) continue;                 // 纪律①
      const 到 = path.join(靶, 名);
      if (fs.existsSync(到)) continue;                     // 纪律②
      fs.copyFileSync(path.join(源, 名), 到);
      播.push(名);
    }
    // 说明书也得播（协-036）。
    //
    // `extraFiles` 对 **portable 目标不管用**：实测它把 SETUP.md 放进 dist/win-unpacked/，
    // 而 portable 再把整个 win-unpacked 打成一个自解压 exe——用户拿到的 dist/ 里
    // 只有那个 exe，说明书跟 asar 里的东西一样够不着。
    // 所以走和模板同一条路：开机时放到 **exe 同级**（配置目录的上一级）。
    const 说明书 = path.join(path.dirname(靶), 'SETUP.md');
    const 随包说明书 = path.join(path.dirname(源), 'SETUP.md');
    if (!fs.existsSync(说明书) && fs.existsSync(随包说明书)) {
      fs.copyFileSync(随包说明书, 说明书);
      播.push('SETUP.md');
    }
  } catch (e) { return { 播, 错: String(e && e.message) }; }  // 纪律③
  return { 播, 目录: 靶 };
}

module.exports = { 只读配置目录, 可写配置目录, 在包内, 播种示例 };
