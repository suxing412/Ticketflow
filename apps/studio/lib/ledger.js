// ledger.js — 监制台自动记账（D35）：工单流转/回执/journal 定期 git commit 落袋。
// 只 commit 不 push（推送仍由制作人层决定）；无变更不产生空提交。
// 教训来源：TK 流水线产出曾 36 个文件躺工作区数日未入库（08 复盘 R-1）。
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// 记账范围（2026-08-21 体检改为**排除法**）。
//
// 原样是枚举白名单，实测漏掉一半活数据目录：专项/特性/排程台账/项管台账/呼叫/瞭望塔/遥控
// 一个都不在册——昨日新建的「特性」与「待办队列」两类实体全落在这些目录，**建了就不记账**。
// 而本文件头注记的正是这个教训（36 个文件躺工作区数日）：**教训记了，名单没跟着长**。
//
// 枚举必漏，因为它要求每加一类实体就有人记得回来改这一行——这次是第二次漏。
// 改为排除法：**默认整个工作区都记账**，只排除明确不该入库的几类。
// 漏一条排除项的后果是「多记了一个文件」（看得见、可补排除）；
// 漏一条白名单的后果是「那类改动永远不入库」（看不见、只能靠事故发现）。两者不对称，故取排除法。
const 排除 = [
  '_app',          // 打包产物落点
  'node_modules',
  '.git',
];
const 排除后缀 = ['.exe', '.tmp', '.lock', '.bak'];
const 排除名 = [
  '.studio-state.json',  // 运行态：进程每动一次就产生一次版本噪声（体检另有一条）
  '凭据.json',            // **密钥**：.gitignore 排着它，但 `git add <显式路径>` 会绕过 ignore ——
                          // 排除法必须自己把它挡住。2026-08-21 刚把远程令牌搬进这个文件。
  '兼容池配置',           // 同上：内含各池 key
];

/** 本次要记账的顶层条目（存在即收，除非命中排除）。 */
function 记账目标(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .map((e) => e.name)
    .filter((n) => !排除.includes(n))
    .filter((n) => !排除名.includes(n))
    .filter((n) => !排除后缀.some((x) => n.endsWith(x)))
    .filter((n) => !n.startsWith('.'));   // 点开头的一律不碰（.git/.claude/.studio-*）
}

/**
 * 记账前的安全自检：目标里**绝不许**出现被 .gitignore 排掉的东西。
 * `git add <显式路径>` 会绕过 ignore，而排除法是按「默认全收」工作的——
 * 两者相遇，一次疏忽就能把密钥推进仓库。故落一道机器闸，不靠记性。
 */
function 越界目标(repo, targets) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('git', ['-C', repo, 'check-ignore', '--', ...targets],
      { encoding: 'utf8', windowsHide: true });
    return out.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean);
  } catch { return []; } // check-ignore 无命中时退出码 1，属正常
}


function commitStudio(root, cb) {
  const done = (ok, note) => { if (cb) cb(ok, note); };
  // 仓库根让 git 自己找（--show-toplevel）：不再假定"工作区上一级是仓库根"——
  // 套件部署布局（工作区自身即仓库根）曾让记账静默跳过（另会话实测）
  execFile('git', ['-C', root, 'rev-parse', '--show-toplevel'], { windowsHide: true, timeout: 30000 }, (e0, topOut) => {
    if (e0) return done(false, '不在 git 仓库内');
    const repo = String(topOut).trim();
    const rel = path.relative(repo, path.resolve(root)).replace(/\\/g, '/');
    // 只 add 实际存在的目录：git add 对不存在的 pathspec 直接报错
    const targets = 记账目标(root).map((d) => (rel ? `${rel}/${d}` : d));
    // 安全闸：目标里若含被 .gitignore 排掉的东西，**整次记账中止**。
    // `git add <显式路径>` 会绕过 ignore，而本模块按「默认全收」工作——两者相遇，
    // 一次疏忽就能把密钥推进仓库（凭据.json 里此刻正躺着远程访问令牌）。
    const 越 = 越界目标(repo, targets);
    if (越.length) return done(false, '目标含被 ignore 的路径，已中止：' + 越.slice(0, 5).join('、'));
    if (!targets.length) return done(false, '无可记账目录');
    const g = (args, next) => execFile('git', ['-C', repo, ...args], { windowsHide: true, timeout: 30000 }, next);
    g(['add', '--', ...targets], (e2) => {
      if (e2) return done(false, 'add 失败');
      g(['diff', '--cached', '--quiet'], (e3) => {
        if (!e3) return done(false, '无变更'); // diff --quiet 退出 0 = 无暂存变更
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const msg = `监制台自动记账 ${stamp}\n\n工单流转/回执/journal 定期落袋（D35，只 commit 不 push）\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;
        // 失败要带**原因**：原样只回一句 'commit 失败'，而 git 的 stderr 里写着到底为什么
        //（钩子拒了？没配 user.email？索引锁着？）——不带原因就只能靠人去复现。
        g(['commit', '-m', msg], (e4, so, se) => done(!e4, e4 ? 'commit 失败：' + String((se || e4.message) || '').trim().slice(0, 160) : '已记账'));
      });
    });
  });
}

/**
 * 记账回调(root, deps) —— commitStudio 的收尾处置：成功打屏、「无变更」静默、其余失败一律进 journal。
 *
 * 案源（2026-08-21/22 体检）：原样写在 server.js 的匿名回调里，形如 `if (ok) console.log(...)`——
 * 四条失败分支（不在 git 仓库内 / 无可记账目录 / add 失败 / commit 失败）**全部静默**。
 * 于是「记账悄悄坏了一周」不会留下任何痕迹，而本模块头注记的正是同族教训（36 个文件躺工作区数日）。
 *
 * 抽成工厂不是为了好看，是为了**可被测**：写在 server.js 的匿名闭包里，除了 grep 源码文本
 * 没有第二种验法，而 grep 既漏真病（换个写法照样静默）又误伤重构。
 * deps 只在判据里注（journal/log 两处），生产调用一个参数都不用传。
 */
function 记账回调(root, deps = {}) {
  const j = deps.journal || require('./journal');
  const log = deps.log || console.log;
  return (ok, note) => {
    if (ok) { log('自动记账：' + note); return; }
    if (String(note || '').includes('无变更')) return; // 常态（多数拍都无变更），刷屏会把真失败埋掉
    try { j.append(root, '自动记账未成：' + String(note || '未注明').slice(0, 160)); }
    catch { /* 留痕失败不阻塞下一拍 */ }
  };
}

module.exports = { 越界目标, 记账目标, commitStudio, 记账回调 };
