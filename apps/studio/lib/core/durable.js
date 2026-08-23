// core/durable.js — 落盘写（写 → fsync → 改名）。
//
// 案源（2026-08-21 查实）：项管台账主档 台账.json 被写成 **21918 字节全 NUL**，
// 且大小正好等于损坏前那一版。事件流里救不回来（管理费只活在主档里，事件不带 token），
// 08-21 之前的项管开销记账实际丢失。同一目录下留着两份 `.损毁-*.json`，相隔 4 秒。
//
// **不是逻辑错**：写路径本来就是 temp + rename，NTFS 上 rename 是原子的。
// 病根在一层之下——`fs.writeFileSync` 只把数据交给页缓存，**不落盘**。于是：
//     写 tmp（元数据已提交：文件大小 21918；数据还在内存）
//     rename（原子，成功）
//     ← 此刻断电 →
//     重启后：文件在、大小对、内容全是 NUL
// 原子改名保证的是「要么旧要么新」，保证不了「新的那份真在盘上」。这台机器两天内
// 非正常断电三次（08-20 断电 + 08-21 两次重启），于是这个洞被踩中了。
//
// 治法是教科书式的：**fsync 之后再 rename**。多一次系统调用（这些文件都是 KB 量级，
// 代价可忽略），换的是「rename 成功 ⇒ 数据已在盘上」这条本来就该成立的保证。
//
// 目录 fsync（让改名本身也落盘）在 Windows 上打不开目录 fd，做不到；
// 那一层的残余风险是「改名丢失、旧档仍在」——**旧档完好，是可接受的降级**，
// 与本案要治的「新档变 NUL」不是一个量级。POSIX 上顺带做掉。
const fs = require('fs');
const path = require('path');

/**
 * 写(目标路径, 内容) —— 落盘写。
 * 保证：调用返回后，目标要么是改动前的旧内容，要么是完整的新内容；**不会是半截或 NUL**。
 * 抛错即写失败（调用方自己决定是重试还是留痕），不静默吞——静默吞正是这类事故最爱的温床。
 */
function 写(目标, 内容) {
  const tmp = String(目标) + '.tmp';
  fs.mkdirSync(path.dirname(String(目标)), { recursive: true });
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, 内容, 'utf8');
    fs.fsyncSync(fd); // ← 本文件存在的全部理由
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, 目标);
  同步目录(path.dirname(String(目标)));
}

// 目录项落盘：POSIX 上能开目录 fd，Windows 上不能（EPERM/EISDIR）——打不开就跳过。
// 跳过的后果只是「改名可能没落盘」，而那种情况下旧档完好，属可接受降级。
function 同步目录(dir) {
  let fd;
  try { fd = fs.openSync(dir, 'r'); } catch { return false; }
  try { fs.fsyncSync(fd); return true; } catch { return false; } finally { try { fs.closeSync(fd); } catch { /* 已关 */ } }
}

/**
 * 写JSON(目标路径, 对象, 缩进) —— 上面那条的 JSON 便利式。
 * 序列化失败会在写盘**之前**抛（循环引用之类），不会留下半截 tmp。
 */
function 写JSON(目标, 对象, 缩进 = 2) {
  const s = JSON.stringify(对象, null, 缩进);
  if (typeof s !== 'string') throw new Error('写JSON：序列化结果不是字符串（对象里可能全是 undefined）');
  写(目标, s);
}

module.exports = { 写, 写JSON, 同步目录 };
