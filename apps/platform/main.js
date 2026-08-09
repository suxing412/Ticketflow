// Electron 观览壳（可选件）：双击即开桌面窗口，内嵌自带 server（127.0.0.1:4370，桩模式）。
// 打包运行时 __dirname 在 asar 内，并排克隆约定失效——未设 TICKETFLOW_HOME 时按本机默认仓位兜底。
const { app, BrowserWindow } = require('electron');

if (!process.env.TICKETFLOW_HOME) process.env.TICKETFLOW_HOME = 'D:\\GitHub\\Ticketflow';
require('./server.js');

function 开窗() {
  const 窗 = new BrowserWindow({ width: 1280, height: 860, title: 'AI-DevPlatform', autoHideMenuBar: true });
  窗.webContents.on('did-fail-load', () => setTimeout(() => 窗.loadURL('http://127.0.0.1:4370'), 300));
  窗.loadURL('http://127.0.0.1:4370');
}

app.whenReady().then(开窗);
app.on('window-all-closed', () => app.quit());
