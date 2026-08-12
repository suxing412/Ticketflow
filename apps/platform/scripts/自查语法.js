// 语法自查 —— 扫出来，不手写清单（协-005）。
//
// 换掉的东西：原先 package.json 里的 check 是一串手写的
// `node --check a.js && node --check b.js && …`，24 个文件名一个个列。
// 这是本仓那类经典毛病的又一个实例：**新加一个文件，忘了加进清单，它就永远不被检查**，
// 而且不会有任何提示——清单照样全绿，只是少查了一个。
//
// 扫描没有这个问题：文件在那儿就一定被查到。
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
const 跳过 = new Set(['node_modules', '.git', 'dist', 'workspaces', 'journal', 'watchtower-out', 'release']);

function 扫(dir, 出 = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (跳过.has(d.name)) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) 扫(p, 出);
    else if (d.name.endsWith('.js')) 出.push(p);
  }
  return 出;
}

const 全 = 扫(平台根);
const 坏 = [];
for (const f of 全) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    坏.push({ 文件: path.relative(平台根, f), 说: String(e.stderr || e.message).trim().split('\n').slice(0, 3).join('\n    ') });
  }
}

if (坏.length) {
  process.stdout.write(`语法自查：${全.length} 个文件，${坏.length} 个有问题\n\n`);
  for (const b of 坏) process.stdout.write(`  ✗ ${b.文件}\n    ${b.说}\n\n`);
  process.exit(1);
}
process.stdout.write(`语法自查：${全.length} 个 .js 全部通过（扫描得来，不是手写清单——手写的会漏）\n`);
