// Electron 观览壳（可选件）：双击即开桌面窗口，内嵌自带 server（127.0.0.1:4370，桩模式）。
//
// 唯一一处允许在 lib/公用件 之外碰公用件路径的地方，原因是物理的：打包后 __dirname 落在
// asar 内，公用件那句「从 apps/platform/lib 上溯三级得仓根」不成立，而它在 require server
// 的瞬间就读环境变量定死了 PACKAGES——所以兜底必须赶在下面这行 require 之前。
// 开发态（npm run desktop）路径真实，走常规解析，不用兜底那行。
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

if (!process.env.TICKETFLOW_PACKAGES) {
  const 常规 = path.resolve(__dirname, '..', '..', 'packages');
  // 换机自改这一行（打包态没有别的信息可推断仓位）
  process.env.TICKETFLOW_PACKAGES = fs.existsSync(常规) ? 常规 : 'D:\\Ticketflow\\packages';
}
require('./server.js');

function 开窗() {
  const 窗 = new BrowserWindow({ width: 1280, height: 860, title: 'AI-DevPlatform', autoHideMenuBar: true });
  窗.webContents.on('did-fail-load', () => setTimeout(() => 窗.loadURL('http://127.0.0.1:4370'), 300));
  窗.loadURL('http://127.0.0.1:4370');
}

app.whenReady().then(开窗);
app.on('window-all-closed', () => app.quit());
