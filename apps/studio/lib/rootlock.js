// rootlock.js — 数据根单写者锁。
// Electron 的单实例锁只管外壳；锁必须落在数据根，才能覆盖 node server.js 通道。
const fs = require('fs');
const path = require('path');

const 陈旧秒默认 = 600;

function 锁文件(root) {
  return path.join(root, '.studio.lock');
}

function 读锁(root) {
  try {
    const raw = fs.readFileSync(锁文件(root), 'utf8');
    const lock = JSON.parse(raw);
    return lock && typeof lock === 'object' && !Array.isArray(lock) ? lock : null;
  } catch {
    // 缺锁、半写锁和人为损坏锁都不能把定时任务锁死。
    return null;
  }
}

function 活着(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // 无权限探测的进程仍然在岗；找不到才是确切的死亡证据。
    return !!(e && e.code === 'EPERM');
  }
}

function 陈旧秒(opts = {}) {
  const 秒 = Number(opts.陈旧秒);
  return Number.isFinite(秒) && 秒 >= 0 ? 秒 : 陈旧秒默认;
}

function 有效锁(lock) {
  if (!lock || typeof lock !== 'object') return false;
  if (!Number.isInteger(lock.pid) || lock.pid <= 0) return false;
  if (typeof lock.续于 !== 'string' || !lock.续于) return false;
  return Number.isFinite(Date.parse(lock.续于));
}

function 锁可抢(lock, opts = {}) {
  if (!有效锁(lock)) return true;
  if (lock.pid === process.pid) return true;
  if (!活着(lock.pid)) return true;
  return Date.now() - Date.parse(lock.续于) > 陈旧秒(opts) * 1000;
}

function 可抢(root, opts = {}) {
  const file = 锁文件(root);
  if (!fs.existsSync(file)) return true;
  // 读锁返回 null 时可能是坏 JSON，也可能是读取过程中的竞争；两者都宁可漏锁一次。
  return 锁可抢(读锁(root), opts);
}

function 我的锁(root) {
  const now = new Date().toISOString();
  return { pid: process.pid, 根: root, 起于: now, 续于: now };
}

function 原子新建(file, lock) {
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify(lock), 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function 占(root, opts = {}) {
  const file = 锁文件(root);
  // 初占使用 wx；两个空根进程同时到达时只能有一个成功创建文件。
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      原子新建(file, 我的锁(root));
      return { 得: true, 因: '已取得数据根单写者锁' };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { 得: false, 因: '创建数据根锁失败：' + String((e && e.message) || e) };
    }

    let 原文 = null;
    try { 原文 = fs.readFileSync(file, 'utf8'); } catch { continue; }
    let lock = null;
    try { lock = JSON.parse(原文); } catch { /* 坏锁照常可抢 */ }
    if (!锁可抢(lock, opts)) {
      // 新鲜的别家锁只报告，绝不删除、改写或续期。
      return { 得: false, 因: `数据根正由进程 ${lock && lock.pid ? lock.pid : '未知'} 单写` };
    }

    // 先原子改名旧锁，再核对搬走的字节仍是刚判为可抢的那一份，最后才用 wx 新建。
    // 如果别的竞争者已换入新锁，字节对不上就用 hard link 无覆盖地原样归位，绝不碰
    // 那份新锁；这堵住了「先读到陈旧锁、后改名了别人刚写的新锁」的竞争窗口。
    const 暂存 = `${file}.reclaim-${process.pid}-${Date.now()}-${attempt}`;
    try {
      fs.renameSync(file, 暂存);
    } catch (e) {
      if (e && (e.code === 'ENOENT' || e.code === 'EEXIST')) continue;
      return { 得: false, 因: '回收可抢锁失败：' + String((e && e.message) || e) };
    }

    try {
      let 搬入原文 = null;
      try { 搬入原文 = fs.readFileSync(暂存, 'utf8'); } catch { continue; }
      if (搬入原文 !== 原文) {
        // linkSync 仅在 .studio.lock 仍缺席时成功，因而不会覆盖真正持有者的新锁。
        try { fs.linkSync(暂存, file); } catch { /* 新锁已出现或文件系统拒绝链接，均不覆盖 */ }
        continue;
      }
      原子新建(file, 我的锁(root));
      return { 得: true, 因: '已接管可抢的数据根锁' };
    } catch (e) {
      // 有别的竞争者先占到时，下一轮会读到它的新鲜锁；不碰 .studio.lock。
      if (!e || e.code !== 'EEXIST') return { 得: false, 因: '接管数据根锁失败：' + String((e && e.message) || e) };
    } finally {
      try { fs.unlinkSync(暂存); } catch { /* 仅清理本次改名出的旧锁 */ }
    }
  }
  return { 得: false, 因: '数据根锁竞争过于频繁，未取得写权' };
}

function 续期(root) {
  const lock = 读锁(root);
  if (!lock || lock.pid !== process.pid) return false;
  try {
    lock.续于 = new Date().toISOString();
    fs.writeFileSync(锁文件(root), JSON.stringify(lock), 'utf8');
    return true;
  } catch {
    return false;
  }
}

function 放(root) {
  const lock = 读锁(root);
  if (!lock || lock.pid !== process.pid) return false;
  try {
    fs.unlinkSync(锁文件(root));
    return !fs.existsSync(锁文件(root));
  } catch {
    return false;
  }
}

module.exports = { 占, 续期, 放, 锁文件, 读锁, 可抢, 活着, 陈旧秒默认 };
