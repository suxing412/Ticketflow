#!/usr/bin/env node
// scripts/test-all.js — 仓级测试聚合器（2026-08-22 体检 #48/#54）
//
// 案源：仓里有 9 个 package 各自带 scripts.test，合计两百多项断言，**没有任何入口把它们串起来**。
// apps/studio 的 跑测试.js 只扫 apps/studio/test/*.test.js，于是 packages/budget 的预算闸、
// packages/quota 的额度闸——两道闸的**本体**——长期无人跑；改坏了没有任何机器会喊。
//
// 三条纪律（照抄 跑测试.js 的家法）：
//   ① 逐个跑完再汇总：一个包红，别的照跑；最后按「有没有红」定退出码。
//   ② 原打印口径透传：各包自己的 ✓/✗ 原样出来，换装闸 grep 得到。
//   ③ 真实数字报出来：尾行「N 包 · M 套件 · 红 K」，不许手抄。
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// propcheck 的 scripts.test 指向 apps/studio/test/propcheck.test.js —— 那条已被 跑测试.js 收进去了。
// 不跳过就是同一套件数两遍，「N 包 M 套件」立刻变成假账。
const 跳过 = new Set(['propcheck']);

// watchtower 全量会起守护进程、跨分钟等时钟、git init --bare，跑好几分钟。
// 慢到没人愿意跑的判据等于没有判据 —— 一律走它自带的 --fast 口径。
const 额外参数 = { watchtower: '--fast' };

// 发现包(仓根) —— 扫 packages/*/package.json，收 scripts.test 非空者。
// 按后缀/字段收，不靠手抄名单：手抄的名单必然漏（新包进来没人记得改）。
function 发现包(仓根) {
  const 目录 = path.join(仓根, 'packages');
  if (!fs.existsSync(目录)) return [];
  return fs
    .readdirSync(目录, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const p = path.join(目录, e.name, 'package.json');
      if (!fs.existsSync(p)) return null;
      let j;
      try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
      const s = j.scripts && j.scripts.test;
      if (!s || !String(s).trim()) return null;
      return { 名: e.name, 目录: path.join(目录, e.name), 脚本: String(s) };
    })
    .filter(Boolean)
    .filter((x) => !跳过.has(x.名))
    .sort((a, b) => (a.名 < b.名 ? -1 : a.名 > b.名 ? 1 : 0));
}

function 主(仓根) {
  const 红 = [];
  let 包数 = 0;
  let 套件数 = 0;
  const t0 = Date.now();

  // ① apps/studio：它自己就是一整条链，交给 跑测试.js，套件数取它尾行的真实数。
  const studio = path.join(仓根, 'apps', 'studio', '跑测试.js');
  if (fs.existsSync(studio)) {
    包数++;
    console.log('');
    console.log('──── apps/studio ────');
    const r = spawnSync(process.execPath, [studio], { encoding: 'utf8', timeout: 900000 });
    const out = (r.stdout || '') + (r.stderr || '');
    process.stdout.write(out);
    const m = out.match(/══ 套件 (\d+)/);
    套件数 += m ? Number(m[1]) : 0;
    if (r.status !== 0) 红.push({ 名: 'apps/studio', 退出: r.status, 信号: r.signal || null });
  }

  // ② packages/*：跑各包自己的 scripts.test（跟 npm test 同一条 cmd 口径，少一层 npm 开销）。
  for (const p of 发现包(仓根)) {
    包数++;
    套件数++;
    const 命令 = p.脚本 + (额外参数[p.名] ? ' ' + 额外参数[p.名] : '');
    console.log('');
    console.log(`──── packages/${p.名} ────`);
    const r = spawnSync(命令, { cwd: p.目录, encoding: 'utf8', shell: true, timeout: 600000 });
    process.stdout.write((r.stdout || '') + (r.stderr || ''));
    // 超时（status===null 且有 signal）与非零退出一律算红，不许把「跑挂了」读成「跑过了」
    if (r.status !== 0) 红.push({ 名: 'packages/' + p.名, 退出: r.status, 信号: r.signal || null });
  }

  const 秒 = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`══ 包 ${包数} · 套件 ${套件数} · 耗时 ${秒}s · 红 ${红.length} ══`);
  for (const x of 红) console.log(`  ✗ ${x.名}（退出 ${x.退出}${x.信号 ? ' 信号 ' + x.信号 : ''}）`);
  return 红.length ? 1 : 0;
}

module.exports = { 发现包, 跳过, 额外参数, 主 };

if (require.main === module) {
  const 仓根 = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..');
  process.exit(主(仓根));
}
