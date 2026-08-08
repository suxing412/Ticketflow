// main.js — Electron 桌面壳：内嵌 server，打开原生窗口
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, dialog, ipcMain, Notification } = require('electron');
const { start } = require('./server');

let win = null;

async function createWindow() {
  const { port, initError } = await start();
  // 未就绪不再是死局（2026-08-08 首次运行向导）：旧样在这里 showErrorBox + quit，
  // 可**加项目/建工作区的 UI 就在这个被关掉的窗口里**，新用户于是只能先手写 JSON。
  // 现在照常开窗，前端读 /api/setup/state 落向导页，建完就地重挂、无需重启。
  if (initError) console.log('未就绪，将进入首次运行向导：' + initError);
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    title: '监制台 · AI 工作室',
    icon: path.join(__dirname, 'public', 'favicon.ico'), // 标题栏/任务栏图标（覆盖 Electron 默认原子）
    autoHideMenuBar: true,
    backgroundColor: '#FAFAF8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // 只暴露截图导出一个能力
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 换版必清缓存：asar 文件 mtime 恒定 + Chromium 磁盘缓存跨重启持久 → 旧 UI 借尸还魂（0.17.2 实测）
  try { await win.webContents.session.clearCache(); } catch { /* 清不掉也照常启动 */ }
  win.loadURL(`http://127.0.0.1:${port}`);
  // 外部链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // 关窗前强制把 localStorage 刷进磁盘——下面的硬退出会掐掉 Chromium 的异步落盘
  win.on('close', () => {
    try { win.webContents.session.flushStorageData(); } catch { /* 尽力而为 */ }
  });
  win.on('closed', () => { win = null; });

  // 主题底色同步：渲染层切主题时更新窗口原生底色（暗色下启动/缩放不闪白）
  ipcMain.removeAllListeners('theme:bg');
  ipcMain.on('theme:bg', (e, color) => {
    if (win && typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)) win.setBackgroundColor(color);
  });

  // 桌面通知（D37）：待验收/待定夺/执行失败/滞留告警 计数上涨时弹系统通知；
  // 窗口在前台不打扰，点通知拉起窗口。30s 轮询本机 API，失败静默。
  let lastAtt = null;
  setInterval(async () => {
    try {
      const d = await (await fetch(`http://127.0.0.1:${port}/api/attention`)).json();
      if (lastAtt && win && !win.isFocused() && Notification.isSupported()) {
        const ups = Object.keys(d).filter((k) => d[k] > (lastAtt[k] || 0));
        if (ups.length) {
          const n = new Notification({
            title: '监制台需要你',
            body: ups.map((k) => `${k} ${lastAtt[k] || 0}→${d[k]}`).join(' · '),
          });
          n.on('click', () => { if (win) { win.show(); win.focus(); } });
          n.show();
        }
      }
      lastAtt = d;
    } catch { /* 服务未就绪/查询失败，静默 */ }
  }, 30000).unref();
}

// P9 甘特 📷：整页截图导 PNG（借鉴 schedule-gantt 的 page:capture）
ipcMain.handle('page:capture', async () => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出甘特图截图', defaultPath: `甘特图_${new Date().toISOString().slice(0, 10)}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    const image = await win.webContents.capturePage();
    fs.writeFileSync(filePath, image.toPNG());
    return { ok: true, filePath };
  } catch (e) { return { ok: false, error: String(e) }; }
});

app.whenReady().then(createWindow).catch((e) => {
  console.error('启动失败：', e.message);
  app.quit();
});
app.on('window-all-closed', () => app.quit()); // 关窗即退出
// 兜底：点叉后强制退出进程，即使内嵌服务/监听器还有活动句柄也不挂起
// （延迟从 300ms 放宽到 800ms，给存储落盘留时间；flushStorageData 已在 close 时触发）
app.on('before-quit', () => { setTimeout(() => process.exit(0), 800); });
