// core/config.js — studio.config.json 的唯一加载点。
// 仓库根 = 监制台仓库（含状态目录 + studio.config.json + _app）。
const fs = require('fs');
const path = require('path');

const 事件流存档默认 = Object.freeze({
  开: true,
  根路径: '事件流存档',
  保留天数: 30,
  总体积上限字节: 1024 * 1024 * 1024,
});

function 补事件流存档默认(cfg) {
  const old = (cfg.事件流存档 && typeof cfg.事件流存档 === 'object') ? cfg.事件流存档 : {};
  const next = { ...事件流存档默认, ...old };
  const changed = !cfg.事件流存档 || Object.keys(事件流存档默认).some((key) => !(key in old));
  if (changed) cfg.事件流存档 = next;
  return changed;
}

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
  const cfg = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
  // 编制去岗位化迁移（H85 补章）：旧 config.agents（程序-A/程序-B 岗位册）→ 新 config.编制
  // （每职能一行 + 池序）。读盘即迁移、迁移即落盘——生产配置的实际改形由运行时完成，不手改。
  // 幂等：已是新形态则 migrate 返回 false，不产生多余写盘。写失败不拦启动（内存态已是新形态）。
  try {
    const rosterChanged = require('../roster').migrate(cfg);
    const archiveChanged = 补事件流存档默认(cfg);
    if (rosterChanged || archiveChanged) save(root, cfg);
  } catch { /* 只读盘/权限不足：本次内存迁移照常生效 */ }
  return cfg;
}

// 配置落盘的唯一实现（server 的 saveCfg 也走这里）：JSON 2 空格 + 末尾换行，无 BOM。
function save(root, cfg) {
  fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

module.exports = { load, save, resolveRoot, 事件流存档默认, 补事件流存档默认 };
