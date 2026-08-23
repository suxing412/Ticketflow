// retire.js — 打包产物留存策略（2026-08-22 体检 #52/#61）。
//
// 案源：换装脚本**只拷不删**，dist 与部署目录只进不出。08-21 实测 dist 积到 134 个 exe、
// 部署目录 72 个，合计 14.2 GB，而 D: 盘当时只剩 45 GB 且全仓没有任何磁盘余量监控——
// 打满即全 studio 停摆，没有任何东西会先叫一声。存量后来被手工清了，**机制没补**，
// 不加策略就会原样长回去（存量清了 ≠ 病治了，这正是本条从「已修」被打回的理由）。
//
// 三条硬约束，每一条都有案源：
//   ① **按 mtime 排，不按文件名**。dist 里同时躺着 `监制台 0.17.1.exe` 与 `监制台 0.17.10.exe`，
//      字典序会把 0.17.10 排到 0.17.9 前面 —— 按名字剪，剪掉的就是新版留下的是旧版。
//   ② **必保集一个都不许动**。`启动监制台.vbs` 里写死着 exe 文件名（换装.ps1:58-66 负责跟版），
//      被剪掉的后果是断电重启后开机脚本静默指向一个不存在的文件，人只会看到「双击没反应」。
//   ③ **只认 `监制台 *.exe`**。同目录下别人的东西一个字节都不碰。
//
// 放在 node 而不是 PowerShell 里，是因为本项目 ps1 没有测试位——写在 ps1 里的策略
// 只能靠读脚本文本来「验」，那不算判据（本项目已明令）。这里的每一条都能真喂文件真跑。
const fs = require('fs');
const path = require('path');

const 件名 = /^监制台 (.+)\.exe$/;

/** 归一必保项：既收整文件名（`监制台 0.27.3.exe`）也收裸版本号（`0.27.3`）。 */
function 必保集(必保) {
  const s = new Set();
  for (const x of [].concat(必保 || []).filter(Boolean).map(String)) {
    const k = x.trim();
    if (!k) continue;
    s.add(k);
    const m = k.match(件名);
    if (m) s.add(m[1]); else s.add(`监制台 ${k}.exe`);
  }
  return s;
}

/**
 * 该删(件列表, 保留N, 必保) —— 纯函数，不碰磁盘，判据的主战场。
 * @param {Array<{名:string, mtime:number}>} 件列表 目录里的**全部**条目（含非监制台文件）
 * @returns {string[]} 要删掉的文件名
 */
function 该删(件列表, 保留 = 6, 必保 = []) {
  const 保 = 必保集(必保);
  const N = Math.max(0, Number(保留) || 0);
  const 候选 = (件列表 || [])
    .filter((x) => x && 件名.test(String(x.名)))
    .map((x) => ({ 名: String(x.名), t: Number(x.mtime) || 0 }))
    .sort((a, b) => b.t - a.t);              // ① mtime 降序，不是文件名序
  const 删 = [];
  let 留数 = 0;
  for (const x of 候选) {
    if (保.has(x.名)) continue;              // ② 必保集不占保留额度，也绝不入删名单
    if (留数 < N) { 留数 += 1; continue; }
    删.push(x.名);
  }
  return 删;
}

/**
 * 剪(dir, opts) —— 真动磁盘。删不动的（被占用/权限）**不抛**：换装脚本里
 * $ErrorActionPreference='Stop'，清理撞上占用文件若中断脚本，此时新版已在跑，
 * 换装实际成功却报失败退出。故失败计入 失手 返回，由调用方决定要不要在意。
 */
function 剪(dir, { 保留 = 6, 必保 = [], 干跑 = false } = {}) {
  const d = String(dir || '');
  if (!d || !fs.existsSync(d)) return { 删: [], 留: [], 失手: [], 因: '目录不存在：' + d };
  const 条目 = fs.readdirSync(d).map((名) => {
    let t = 0;
    try { t = fs.statSync(path.join(d, 名)).mtimeMs; } catch { t = 0; }
    return { 名, mtime: t };
  });
  const 删名 = 该删(条目, 保留, 必保);
  const 删 = []; const 失手 = [];
  if (!干跑) {
    for (const f of 删名) {
      try { fs.rmSync(path.join(d, f), { force: true }); } catch { /* 见上：占用不许中断换装 */ }
      if (fs.existsSync(path.join(d, f))) 失手.push(f); else 删.push(f);
    }
  }
  const 留 = fs.readdirSync(d).filter((f) => 件名.test(f));
  return { 删: 干跑 ? 删名 : 删, 留, 失手 };
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const 取 = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const dir = 取('--剪');
  const r = 剪(dir, {
    保留: Number(取('--保留') || 6),
    必保: String(取('--必保') || '').split(',').filter(Boolean),
    干跑: a.includes('--干跑'),
  });
  if (r.因) { console.log('产物留存 ' + dir + '：' + r.因); process.exit(0); }
  console.log(`产物留存 ${dir}：留 ${r.留.length} 删 ${r.删.length}`
    + (r.删.length ? '（' + r.删.join('、') + '）' : '')
    + (r.失手.length ? ` · 删不动 ${r.失手.length}（占用中，下次换装再清）` : ''));
}

module.exports = { 剪, 该删, 必保集 };
