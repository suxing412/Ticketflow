// core/config.js — studio.config.json 的唯一加载点。
// 仓库根 = 监制台仓库（含状态目录 + studio.config.json + _app）。
const fs = require('fs');
const path = require('path');

function resolveRoot(from) {
  if (process.env.STUDIO_ROOT) return path.resolve(process.env.STUDIO_ROOT);
  let dir = from || process.env.PORTABLE_EXECUTABLE_DIR || path.resolve(__dirname, '..', '..', '..');
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'studio.config.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function load(root) {
  // 容忍 UTF-8 BOM（﻿）：PowerShell 5.1 的 -Encoding UTF8 与记事本都会写 BOM，
  // 直接 JSON.parse 会炸——0.8.1 套件 E2E 实测：部署脚本改完配置，exe 启动即崩。
  const raw = fs.readFileSync(path.join(root, 'studio.config.json'), 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
}

module.exports = { load, resolveRoot };
