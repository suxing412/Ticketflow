// gen-icon.js — 监制台图标：深墨圆角磁贴 + 三根白色竖条（工单池看板列）+ 一点功能红。
// 零外部依赖：光栅化 256x256 PNG → 封装 .ico。用法：node build-assets/gen-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 256; const SS = 3; // 3x 超采样抗锯齿
const INK = [26, 29, 33], WHITE = [255, 255, 255], GRAY = [138, 146, 158], RED = [180, 35, 31];

function inRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.max(x + r, Math.min(px, x + w - r));
  const cy = Math.max(y + r, Math.min(py, y + h - r));
  const dx = px - cx, dy = py - cy;
  return dx * dx + dy * dy <= r * r || (px >= x + r && px <= x + w - r) || (py >= y + r && py <= y + h - r);
}
function inCircle(px, py, cx, cy, r) { const dx = px - cx, dy = py - cy; return dx * dx + dy * dy <= r * r; }

// 三根看板竖条：[x, 顶y]，统一宽 34、底 y=196、圆角 10；高矮不一暗示工单池各列
const BARS = [[64, 128, WHITE], [111, 96, WHITE], [158, 148, GRAY]];

function sample(px, py) {
  if (!inRoundRect(px, py, 0, 0, 256, 256, 56)) return [0, 0, 0, 0]; // 磁贴外透明
  let c = INK;
  for (const [bx, ty, col] of BARS) if (inRoundRect(px, py, bx, ty, 34, 196 - ty, 10)) c = col;
  // 功能红：右上角小圆点（投池/需你处理的信号）
  if (inCircle(px, py, 192, 84, 15)) c = RED;
  return [c[0], c[1], c[2], 255];
}

// 渲染 + 超采样
const img = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
  let r = 0, g = 0, b = 0, a = 0;
  for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
    const [pr, pg, pb, pa] = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
    r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
  }
  const n = SS * SS; const o = (y * S + x) * 4;
  img[o] = a ? Math.round(r / a) : 0; img[o + 1] = a ? Math.round(g / a) : 0;
  img[o + 2] = a ? Math.round(b / a) : 0; img[o + 3] = Math.round(a / n);
}

// PNG 编码
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; img.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 0; ico[7] = 0; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
const out = Buffer.concat([ico, png]);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), out);
fs.writeFileSync(path.join(__dirname, '..', 'public', 'favicon.ico'), out);
console.log(`监制台 icon.ico 生成完毕：${out.length} 字节`);
