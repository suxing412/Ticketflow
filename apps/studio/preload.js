// preload.js — 只暴露两个能力（整页截图导出 + 主题底色同步），保持 contextIsolation
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  capturePage: () => ipcRenderer.invoke('page:capture'),
  // 主题切换时把窗口原生底色同步过去，避免暗色主题下启动/缩放闪白
  setThemeBg: (color) => ipcRenderer.send('theme:bg', color),
});
