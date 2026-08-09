// scripts/watchtower.js — 瞭望塔启动器（施工令-025 出厂）
// 瞭望塔正本只有一份，住在 Ticketflow packages/watchtower（公用件唯一家）；
// 本脚本按并排克隆约定找到它并代为拉起，附上平台侧配置。
//
// 用法（均在仓根跑，npm 保证运行目录）：
//   npm run watchtower                 前台起守护
//   npm run watchtower:install         注册登录自启计划任务（任务名 AI-DevPlatform瞭望塔）
//   npm run watchtower:status          看在岗状态
//   npm run watchtower -- --unread     其余参数原样透传 watchtower.js
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const 仓根 = path.resolve(__dirname, '..');
const TICKETFLOW_HOME = process.env.TICKETFLOW_HOME || path.resolve(仓根, '..', 'Ticketflow');
const 瞭望塔 = path.join(TICKETFLOW_HOME, 'packages', 'watchtower', 'watchtower.js');

if (!fs.existsSync(瞭望塔)) {
  process.stderr.write(
    `[启动器] 找不到瞭望塔正本：${瞭望塔}\n` +
    '请确认两仓并排克隆（Ticketflow 与本仓同级），或设环境变量 TICKETFLOW_HOME 指向 Ticketflow 仓根。\n'
  );
  process.exit(1);
}

const 透传 = process.argv.slice(2);
const 参数 = [];

// 平台侧配置：未显式给 --config 时补上正本
if (!透传.includes('--config')) 参数.push('--config', path.join(仓根, 'config', '瞭望塔.config.json'));

// 计划任务名默认带平台前缀，避免与同机其他瞭望塔任务（如监制台侧）撞名互踩
if ((透传.includes('--install') || 透传.includes('--uninstall')) && !透传.includes('--task-name')) {
  参数.push('--task-name', 'AI-DevPlatform瞭望塔');
}

const r = spawnSync(process.execPath, [瞭望塔, ...参数, ...透传], { stdio: 'inherit', cwd: 仓根 });
process.exit(r.status == null ? 1 : r.status);
