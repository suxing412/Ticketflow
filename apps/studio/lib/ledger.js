// ledger.js — 监制台自动记账（D35）：工单流转/回执/journal 定期 git commit 落袋。
// 只 commit 不 push（推送仍由制作人层决定）；无变更不产生空提交。
// 教训来源：TK 流水线产出曾 36 个文件躺工作区数日未入库（08 复盘 R-1）。
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const DIRS = ['草稿', '待投', '池', '在途', '质检', '待验收', '待定夺', '执行失败', '完成', '已归档', '回执', 'journal', '风格库', '岗位协议', '阶段标准.md'];

function commitStudio(root, cb) {
  const done = (ok, note) => { if (cb) cb(ok, note); };
  // 仓库根让 git 自己找（--show-toplevel）：不再假定"工作区上一级是仓库根"——
  // 套件部署布局（工作区自身即仓库根）曾让记账静默跳过（另会话实测）
  execFile('git', ['-C', root, 'rev-parse', '--show-toplevel'], { windowsHide: true, timeout: 30000 }, (e0, topOut) => {
    if (e0) return done(false, '不在 git 仓库内');
    const repo = String(topOut).trim();
    const rel = path.relative(repo, path.resolve(root)).replace(/\\/g, '/');
    // 只 add 实际存在的目录：git add 对不存在的 pathspec 直接报错
    const targets = DIRS.filter((d) => fs.existsSync(path.join(root, d))).map((d) => (rel ? `${rel}/${d}` : d));
    if (!targets.length) return done(false, '无可记账目录');
    const g = (args, next) => execFile('git', ['-C', repo, ...args], { windowsHide: true, timeout: 30000 }, next);
    g(['add', '--', ...targets], (e2) => {
      if (e2) return done(false, 'add 失败');
      g(['diff', '--cached', '--quiet'], (e3) => {
        if (!e3) return done(false, '无变更'); // diff --quiet 退出 0 = 无暂存变更
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const msg = `监制台自动记账 ${stamp}\n\n工单流转/回执/journal 定期落袋（D35，只 commit 不 push）\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>`;
        g(['commit', '-m', msg], (e4) => done(!e4, e4 ? 'commit 失败' : '已记账'));
      });
    });
  });
}

module.exports = { commitStudio };
