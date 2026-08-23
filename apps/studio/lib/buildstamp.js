// buildstamp.js — 活体码印：跑着的这份代码，和源码树现在的样子，是不是同一份。
//
// 案源（2026-08-21 一天四犯）：
//   ① 改了 /api/pm/draft 的项目透传 → 立刻发委托 → 回执里没有新字段，单落成 TK-183（该是 TF）。
//   ② 给待办加了 项目 字段 → 回填 122 条 → **122 条全拒**，台账白添 122 行拒绝事件。
//   ③ 改了 specials 的收口自检 → S-3 复工 20 秒后又被推回收口。
//   ④ 更早那次：脚本打印了「成功」，文件其实一个字没改。
// 四次的共同形状：**源码改了，跑着的进程还是旧的，而没有任何东西会提醒。**
// 它比「起不来」更坏——界面能开、接口能通、测试全绿，只是跑的不是你以为的那份代码。
//
// 治法不是「记得重启」（四次都记得，四次都忘），是让这件事**机器可判**：
//   活体自己算一遍「我这份代码长什么样」，再算一遍「源码树现在长什么样」，两个指纹一比。
//   不同 → 立成一笔欠债（G15，归总监），走 /api/attn 与超时升格，跟别的债一个待遇。
//
// 三条设计取舍：
//   · **只哈希会影响行为的文件**（lib/**.js + server.js + public/app.js + public/style.css）。
//     把 node_modules、测试、文档算进去，等于每改一行注释就报一次警，警报就废了。
//   · **源码路径缺省即关闭**。别人拿这套系统去部署时机器上根本没有源码树，
//     那种情况下「找不到源码」是正常态，不是欠债——查不到就静默返 null，绝不虚报。
//   · **开发态自然免疫**：从源码直接 node server.js 跑时两边是同一个目录，指纹恒等，零告警。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 参与指纹的文件集。顺序无关（先排序），内容变即指纹变。
// 补齐出货文件（2026-08-22 体检 #0）：原样漏了 main.js / preload.js / public/index.html，
// 三者都在 package.json 的 build.files 里、都随包出货、改了都会改变活体行为——
// 而 G15 看不见它们。「只改了 main.js 的单实例锁就重打了包」这一类，原样一个字都报不出来。
// 判据：真造两棵只差 main.js 的树，比对必须判不一致（test/buildstamp.test.js）。
const 收录 = [
  { 目录: 'lib', 递归: true, 后缀: ['.js'] },
  { 文件: 'server.js' },
  { 文件: 'main.js' },
  { 文件: 'preload.js' },
  { 文件: path.join('public', 'app.js') },
  { 文件: path.join('public', 'index.html') },
  { 文件: path.join('public', 'style.css') },
];

function 列文件(根) {
  const out = [];
  for (const 项 of 收录) {
    if (项.文件) {
      const p = path.join(根, 项.文件);
      if (fs.existsSync(p)) out.push(项.文件);
      continue;
    }
    const 走 = (rel) => {
      let ents;
      try { ents = fs.readdirSync(path.join(根, rel), { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const r = path.join(rel, e.name);
        if (e.isDirectory()) { if (项.递归) 走(r); continue; }
        if (项.后缀.some((s) => e.name.endsWith(s))) out.push(r);
      }
    };
    走(项.目录);
  }
  return out.sort();
}

/**
 * 指纹(根) —— 该目录下这份代码的内容摘要。目录不可读或一个文件都收不到 → null（不拿空串冒充）。
 * 返回 { 指纹, 文件数 }；指纹是 sha1 前 12 位（够分辨，短到能塞进一行日志）。
 */
function 指纹(根) {
  if (!根) return null;
  let files;
  try { files = 列文件(根); } catch { return null; }
  if (!files.length) return null;
  const h = crypto.createHash('sha1');
  for (const rel of files) {
    let buf;
    try { buf = fs.readFileSync(path.join(根, rel)); } catch { return null; } // 读不全就不给数：残缺指纹比没有更危险
    // 归一换行：同一份代码在 CRLF/LF 之间来回并不改变行为，不该报成漂移
    h.update(rel.replace(/\\/g, '/')).update('\0').update(buf.toString('utf8').replace(/\r\n/g, '\n')).update('\0');
  }
  return { 指纹: h.digest('hex').slice(0, 12), 文件数: files.length };
}

/** 活体指纹：跑着的这份（本模块所在目录的上一级 = apps/studio）。 */
function 活体(dirOverride) { return 指纹(dirOverride || path.join(__dirname, '..')); }

/** 源码指纹：cfg.源码路径 指向的那份。没配即 null（部署方没有源码树是正常态）。 */
function 源码(cfg) {
  const p = cfg && cfg.源码路径;
  if (!p) return null;
  return 指纹(String(p));
}

/**
 * 比对(cfg) → { 一致, 活体, 源码, 因 }
 *   一致 === true  两边同码，或无从判断（没配源码路径 / 源码树不可读）——**无从判断一律不报债**
 *   一致 === false 确实不同：跑着的不是源码树现在的样子
 */
function 比对(cfg, dirOverride) {
  const a = 活体(dirOverride);
  const b = 源码(cfg);
  if (!a) return { 一致: true, 活体: null, 源码: b, 因: '活体自身不可指纹（异常，但不据此报债）' };
  if (!b) return { 一致: true, 活体: a, 源码: null, 因: '未配 源码路径 或源码树不可读——部署方无源码是正常态' };
  if (a.指纹 === b.指纹) return { 一致: true, 活体: a, 源码: b, 因: '同码' };
  return { 一致: false, 活体: a, 源码: b, 因: `活体 ${a.指纹}（${a.文件数} 件） ≠ 源码 ${b.指纹}（${b.文件数} 件）` };
}

/** 归一后的文件内容（读不到返 null）。换行符不算差异，同 指纹() 的口径。 */
function 读一(p) {
  try { return fs.readFileSync(p).toString('utf8').replace(/\r\n/g, '\n'); } catch { return null; }
}

/**
 * 源码改动时刻(cfg, dirOverride) —— 「这笔债是什么时候开始欠的」。
 *
 * 取的是**内容与活体不同的那批文件里最早的 mtime**，不是全树最新 mtime。
 * 案源（2026-08-22 体检 #0）：原样取全树最新 mtime，于是每改一个无关文件、
 * 甚至每重新保存一次，停摆自就往前跳一次——**债龄被自己刷新回零**。
 * 而 G15 的整个升格链（逾期阈值 T 小时 → 人闸升格）都挂在债龄上：
 * 一条永远不满一小时的债，永远不会升格，等于报了跟没报一样。
 * 取「最早」才答得出那个真问题：跑着的这份代码，最久已经落后源码多久了。
 *
 * 取 mtime 而不是 git 提交时刻：没提交的改动同样让活体过时，而那恰恰是最常见的形态。
 */
function 源码改动时刻(cfg, dirOverride) {
  const 根 = cfg && cfg.源码路径;
  if (!根) return null;
  const 活根 = dirOverride || path.join(__dirname, '..');
  let 最早 = 0; let 最新 = 0;
  try {
    for (const rel of 列文件(String(根))) {
      const p = path.join(String(根), rel);
      const m = fs.statSync(p).mtimeMs;
      if (m > 最新) 最新 = m;
      if (读一(p) === 读一(path.join(活根, rel))) continue; // 内容一致 = 这一件没漂移
      if (!最早 || m < 最早) 最早 = m;
    }
  } catch { return null; }
  // 兜底：源码侧每一件都与活体同内容，但指纹仍不等（活体多出/少了文件）——
  // 这时没有「哪一件先漂的」可言，退回全树最新，至少给得出一个时刻而不是 null。
  if (!最早) return 最新 ? new Date(最新).toISOString() : null;
  return new Date(最早).toISOString();
}

module.exports = { 指纹, 活体, 源码, 比对, 源码改动时刻, 收录 };
