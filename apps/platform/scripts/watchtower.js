// scripts/watchtower.js — 瞭望塔启动器（施工令-025 出厂）
// 瞭望塔正本只有一份，住在仓根 packages/watchtower（公用件唯一家）；
// 本脚本经 lib/公用件 找到它并代为拉起，附上平台侧配置。
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

// 注意：这里的「平台根」是 apps/platform，不是仓根。此前这个变量就叫 仓根，与
// lib/公用件 里表示仓库根的同名变量撞了义——一仓合并时正是照着「仓根的兄弟目录」
// 抄出了 <仓根>/apps/Ticketflow 这条死路。同名不同义，改名钉死。
const 平台根 = path.resolve(__dirname, '..');
const 公用件 = require('../lib/公用件');
const 瞭望塔 = 公用件.解析('watchtower', 'watchtower.js');

if (!fs.existsSync(瞭望塔)) {
  process.stderr.write(
    `[启动器] 找不到瞭望塔正本：${瞭望塔}\n` +
    '公用件唯一家是仓根的 packages/；换布局时可用环境变量 TICKETFLOW_PACKAGES 指向它。\n'
  );
  process.exit(1);
}

const 透传 = process.argv.slice(2);
const 参数 = [];

// 平台侧配置：未显式给 --config 时补上正本
if (!透传.includes('--config')) 参数.push('--config', path.join(平台根, 'config', '瞭望塔.config.json'));

// 计划任务名默认带平台前缀，避免与同机其他瞭望塔任务（如监制台侧）撞名互踩
if ((透传.includes('--install') || 透传.includes('--uninstall')) && !透传.includes('--task-name')) {
  参数.push('--task-name', 'AI-DevPlatform瞭望塔');
}

const r = spawnSync(process.execPath, [瞭望塔, ...参数, ...透传], { stdio: 'inherit', cwd: 平台根 });
process.exit(r.status == null ? 1 : r.status);
