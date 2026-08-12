// Electron 观览壳（可选件）：双击即开桌面窗口，内嵌自带 server（127.0.0.1:4370）。
//
// 这是唯一一处允许在 lib/公用件 之外碰公用件路径的地方，原因是物理的：打包后
// __dirname 落在 asar 内，公用件那句「从 apps/platform/lib 上溯三级得仓根」不成立，
// 而它在 require server 的瞬间就读环境变量定死了 PACKAGES——兜底必须赶在那之前。
//
// 2026-08-12 改：原先第三候选是硬编码 'D:\Ticketflow\packages' 加一句注释
// 「换机自改这一行」。那是**交付缺陷**——拿到 exe 的人没有源码可改，
// 而失败的表现是 providers 加载不出来，看起来像产品坏了。
//
// 现在的解析序，全部**不需要改源码**：
//   ① TICKETFLOW_PACKAGES 环境变量        —— 显式指定，最高优先级
//   ② 仓内相对（开发态 npm run desktop）  —— 源码跑法，路径真实
//   ③ exe 同级目录下的 packages/          —— 便携分发：exe 与 packages 放一起即可
//   ④ exe 同级的 平台配置.json 里的 packages 路径 —— 装到别处时改这个 JSON，不动源码
// 四条都不中时**不静默继续**：弹窗说清楚缺什么、怎么补。
// 静默启动然后 providers 全空，比直接说「没找到公用件」难查得多。
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function 解析公用件() {
  if (process.env.TICKETFLOW_PACKAGES) {
    return { 路径: process.env.TICKETFLOW_PACKAGES, 来源: 'TICKETFLOW_PACKAGES 环境变量' };
  }
  // ⚠ portable 打包**不能用 process.execPath**：electron-builder 的 portable target
  // 会把整个 app 解压到 %TEMP%\<随机>\ 再从那里启动，execPath 指向那个临时目录，
  // 而不是用户双击的位置。实测踩到：把 exe 和 平台配置.json 放同一个目录，
  // 程序照样报「找不到公用件」——它压根没在那个目录里找。
  // electron-builder 为此提供了 PORTABLE_EXECUTABLE_DIR，指向**原始 exe 所在目录**。
  const exe目录 = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const 候选 = [
    { 路径: path.resolve(__dirname, '..', '..', 'packages'), 来源: '仓内相对（开发态）' },
    { 路径: path.join(exe目录, 'packages'), 来源: 'exe 同级 packages/' },
  ];
  // exe 同级的配置文件——装到别处时改它，不用碰源码
  const 配置文件 = path.join(exe目录, '平台配置.json');
  try {
    const v = String(JSON.parse(fs.readFileSync(配置文件, 'utf8')).packages || '').trim();
    if (v) 候选.push({ 路径: path.resolve(v), 来源: 配置文件 });
  } catch { /* 没有或坏了，跳过 */ }

  for (const c of 候选) {
    // 只认真的有内容的：存在但空目录同样会让 providers 加载失败，
    // 那种情况下继续往下找，比停在一个空壳上强。
    if (fs.existsSync(path.join(c.路径, 'providers'))) return c;
  }
  return { 路径: null, 来源: null, 候选: 候选.map((c) => c.路径), 配置文件 };
}

const 解析 = 解析公用件();
if (!解析.路径) {
  // 静默失败是这里最坏的选择：窗口照开、providers 空表，人会以为产品坏了。
  app.whenReady().then(() => {
    dialog.showErrorBox('找不到公用件（packages/）', [
      '本程序需要 packages/providers 才能工作，但下列位置都没找到：',
      '',
      ...(解析.候选 || []).map((p) => '  · ' + p),
      '',
      '三种补法（任选其一，都不需要改源码）：',
      `  ① 把 packages/ 目录放到 exe 同级：${path.dirname(process.execPath)}`,
      `  ② 在 exe 同级建 平台配置.json：{ "packages": "D:/你的仓/packages" }`,
      '  ③ 设环境变量 TICKETFLOW_PACKAGES 指向 packages/ 后重新启动',
    ].join('\n'));
    app.quit();
  });
} else {
  process.env.TICKETFLOW_PACKAGES = 解析.路径;
  process.stdout.write(`[观览壳] 公用件 ← ${解析.来源}：${解析.路径}\n`);
  require('./server.js');

  const 开窗 = () => {
    const 窗 = new BrowserWindow({ width: 1280, height: 860, title: 'AI-DevPlatform', autoHideMenuBar: true });
    窗.webContents.on('did-fail-load', () => setTimeout(() => 窗.loadURL('http://127.0.0.1:4370'), 300));
    窗.loadURL('http://127.0.0.1:4370');
  };
  app.whenReady().then(开窗);
  app.on('window-all-closed', () => app.quit());
}
