// ledger.test.js — 自动记账 D35：双布局（工作区=仓库根 / 工作区在仓库子目录）都能落袋
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { commitStudio } = require('../lib/ledger');

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('ledger 自动记账测试');
const commit = (root) => new Promise((res) => commitStudio(root, (ok, note) => res({ ok, note })));
const gitInit = (dir) => {
  execFileSync('git', ['-C', dir, 'init', '-q'], { windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { windowsHide: true });
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'], { windowsHide: true });
};

(async () => {
  await t('布局一：工作区自身就是仓库根（套件部署布局，曾静默跳过）', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledg-'));
    gitInit(root);
    fs.mkdirSync(path.join(root, '池'), { recursive: true });
    fs.writeFileSync(path.join(root, '池', 'X-1.md'), 'x', 'utf8');
    const r = await commit(root);
    assert.ok(r.ok, '应记账成功，实际：' + r.note);
    const log = execFileSync('git', ['-C', root, 'log', '--oneline'], { windowsHide: true, encoding: 'utf8' });
    assert.ok(log.includes('自动记账'));
  });

  await t('布局二：工作区是仓库子目录（本工作室布局）', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ledg-'));
    gitInit(repo);
    const root = path.join(repo, '监制台');
    fs.mkdirSync(path.join(root, 'journal'), { recursive: true });
    fs.writeFileSync(path.join(root, 'journal', '2026-07.log'), 'line', 'utf8');
    const r = await commit(root);
    assert.ok(r.ok, '应记账成功，实际：' + r.note);
  });

  await t('无变更不空提交；不在 git 仓库内报因', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledg-'));
    gitInit(root);
    fs.mkdirSync(path.join(root, '池'), { recursive: true });
    fs.writeFileSync(path.join(root, '池', 'X.md'), 'x', 'utf8');
    await commit(root);
    const r2 = await commit(root);
    assert.equal(r2.note, '无变更');
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ledg-'));
    const r3 = await commit(bare);
    assert.equal(r3.note, '不在 git 仓库内');
  });

  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
