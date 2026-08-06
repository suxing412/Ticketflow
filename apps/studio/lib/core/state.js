// core/state.js — .studio-state.json 唯一属主：闸门状态 + 额度锁缓存。
// 工单状态是目录（store.js），不进这里；这里只存"不由目录表达"的全局开关：
//   paused: 暂停总闸（H81 常开单闸制：单一布尔，默认开＝不暂停），
//   quotaGate: 额度锁按池的缓存（locked/reason/resetAt）。
// 原子写 + mkdir 跨进程锁，沿用工单中台验证过的模式。
const fs = require('fs');
const path = require('path');

const STATE_FILE = '.studio-state.json';
const LOCK_DIR = '.studio-state.lock';

const DEFAULT = { paused: false, quotaGate: {}, 执行器: { 运行: false } };

// H81 迁移：旧盘上的 paused 三档 / 执行器.试跑 / 执行器.实弹解锁 读到即静默归形，不炸。
// 三档收总闸取"任一档合上即合闸"（保守：宁可读成停，也不把停读成跑）。
function migrate(s) {
  if (s.paused && typeof s.paused === 'object') s.paused = !!(s.paused.global || s.paused.codex || s.paused.claude);
  else s.paused = !!s.paused;
  if (s.执行器 && typeof s.执行器 === 'object') { delete s.执行器.试跑; delete s.执行器.实弹解锁; }
  return s;
}

function read(root) {
  try { return migrate({ ...DEFAULT, ...JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8')) }); }
  catch { return JSON.parse(JSON.stringify(DEFAULT)); }
}

function writeAtomic(root, state) {
  const p = path.join(root, STATE_FILE);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function withLock(root, fn) {
  const lockPath = path.join(root, LOCK_DIR);
  const deadline = Date.now() + 4000;
  const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* 忙等兜底 */ } };
  for (;;) {
    try { fs.mkdirSync(lockPath); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lockPath).mtimeMs > 15000) fs.rmdirSync(lockPath); } catch { /* 竞争回收忽略 */ }
      if (Date.now() > deadline) throw new Error('state 锁获取超时');
      sleep(20);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lockPath); } catch { /* 已释放 */ } }
}

function update(root, mutator) {
  return withLock(root, () => {
    const state = read(root);
    const result = mutator(state);
    writeAtomic(root, state);
    return result;
  });
}

module.exports = { read, writeAtomic, withLock, update };
