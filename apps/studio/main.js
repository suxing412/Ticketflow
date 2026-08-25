// main.js — Electron 桌面壳：内嵌 server，打开原生窗口
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, dialog, ipcMain, Notification } = require('electron');
// server 延迟到真要开窗时才 require（2026-08-22 体检 #63）：
// server.js 在**模块作用域**就跑 config.resolveRoot() / config.load(ROOT) / store.ensureDirs(ROOT)，
// 都是对数据根的实际动作。顶层 require 意味着「抢不到单实例锁、马上要退出的那一份」
// 也照样先对数据根动过一次手——锁写在下面，而副作用发生在上面。
const start = (...a) => require('./server').start(...a);

// Win11 Fluent 滚条不吃 ::-webkit-scrollbar 自定义（0.30.6 案：细滚条样式在壳里从未生效过，
// 页面上永远是带箭头的原生粗条）——关掉该特性，滚条外观交还给样式表。
if (app && app.commandLine) app.commandLine.appendSwitch('disable-features', 'FluentScrollbar,FluentOverlayScrollbar'); // 测试桩的 app 无此面

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

  // 桌面通知（D37）：制作人名下的人闸出现新的一笔就弹；窗口在前台不打扰，点通知拉起窗口。
  //
  // **换轴（2026-08-21 体检）**：原先读 /api/attention，那条端点的判据轴是「哪些**工单**处于
  // 待验收∪待定夺∪执行失败」——正是 gatereg 立模块时判定必须换掉的那条轴。后果是
  // 投池放行、专项关账、值守断更这些真人闸**结构上永不弹窗**：当日实测同一分钟
  // /api/attention 报 {待验收:0,待定夺:0,执行失败:0,滞留告警:0}，而 /api/attn 报 计数 5。
  // 桌面通知是这套系统唯一会主动打断人的出口，它盯错了轴，等于这个出口对多数人闸失灵。
  //
  // 改读 /api/attn?归属=制作人（全系统唯一谓词 等我()），并按 **gateKey 集合比新增**
  // 而不是按计数上涨——计数法在「签掉一笔、又来一笔」时净值不变，会整笔漏报；
  // gateKey 本身就是幂等键（同闸同实体只算一笔），拿它做集合差是天然正确的。
  const NL = String.fromCharCode(10); // 字面换行经不住本项目的编辑管道（当日四犯），用码点写
  let lastKeys = null;
  setInterval(async () => {
    try {
      const d = await (await fetch(`http://127.0.0.1:${port}/api/attn?${encodeURIComponent('归属')}=${encodeURIComponent('制作人')}`)).json();
      const 债 = Array.isArray(d && d.债) ? d.债 : [];
      const keys = new Set(债.map((x) => String(x.gateKey || x.id)));
      if (lastKeys && win && !win.isFocused() && Notification.isSupported()) {
        const 新 = 债.filter((x) => !lastKeys.has(String(x.gateKey || x.id)));
        if (新.length) {
          const n = new Notification({
            title: 新.length === 1 ? `监制台需要你 · ${新[0].闸名 || ''}` : `监制台需要你（${新.length} 笔）`,
            body: 新.slice(0, 3).map((x) => `${x.闸名 || ''}：${String(x.title || x.id).slice(0, 40)}`).join(NL)
              + (新.length > 3 ? NL + `…另 ${新.length - 3} 笔` : ''),
          });
          n.on('click', () => { if (win) { win.show(); win.focus(); } });
          n.show();
        }
      }
      lastKeys = keys;
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

// 单实例锁（2026-08-21 体检 + 08-22 亲历）。**两份监制台同时跑会各写各的账**：
//   · 实证一：08-20 22:16–23:16 三封 OAuth 急件每封发两遍、相隔 4.7 秒。源码里哨兵只有一个
//     调用点、节流键是「态」且同态 30 分钟至多一封——单实例产生不出 4.7 秒的重复对，
//     只能是两个进程各跑各的 15 分钟拍（启动相隔约 4.7 秒）。
//   · 实证二：项管台账 三份 `台账.json.损毁-*` 是同一份文件被并发存了三遍。
//   · 实证三：坑档案里那条完工判据白纸黑字写着「Electron 单实例锁挡住重复拉起」——
//     而全库 grep `requestSingleInstanceLock` **零命中**。**判据自称有的东西，代码里根本没有。**
// 第二份直接退出，并把「已有实例在跑」写进流水——静默退出会让人以为双击没反应而再点几下。
//
// **拿不到锁的那一份，除了退出什么都不许做（2026-08-22 体检 #20/#63）**：
// 原样把 `app.whenReady().then(createWindow)` 挂在 if/else **外面**——第二份照样 whenReady、
// 照样 createWindow、照样 start() 起服务抢 4270 与台账，全靠 app.quit() 抢在前面。
// 那是一场赛跑，不是一道闸；而「三封急件各发两遍、相隔 4.7 秒」正是这场赛跑输掉的样子。
// 现在起服务这条路整个搬进 else 分支：拿不到锁 = 起服务次数恒 0。
// 行为判据见 test/single-instance.test.js（桩掉 electron 与 ./server 真 require 一遍 main.js）。
if (!app.requestSingleInstanceLock()) {
  // 落盘留痕：console 在 GUI 进程里没人看得见，而「双击没反应」的现场只剩流水可查
  try {
    const r0 = require('./lib/core/config').resolveRoot();
    if (r0) require('./lib/journal').append(r0, '已有实例在跑，本次启动退出（单实例锁）');
  } catch { /* 写不进流水不拦退出——退出本身才是这条分支的正事 */ }
  console.error('[监制台] 已有实例在跑，本次启动退出（单实例锁）');
  app.quit();
} else {
  // 第二次双击 → 把已在跑的那扇窗拉到前台，而不是新开一个
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
  });

  app.whenReady().then(createWindow).catch((e) => {
    console.error('启动失败：', e.message);
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit()); // 关窗即退出
// 兜底：点叉后强制退出进程，即使内嵌服务/监听器还有活动句柄也不挂起
// （延迟从 300ms 放宽到 800ms，给存储落盘留时间；flushStorageData 已在 close 时触发）
app.on('before-quit', () => { setTimeout(() => process.exit(0), 800); });
