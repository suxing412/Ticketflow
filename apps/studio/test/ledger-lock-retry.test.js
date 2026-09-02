// ledger-lock-retry.test.js — 自动记账遇索引锁的重试（议程第 39 条，2026-08-28）
//
// 案源：共树里同时有别的 git 在跑（执行会话提交／总监手工提交／另一次记账），
// `.git/index.lock` 被占，输的那方直接失败——而记账是 10 分钟一拍，
// **一次毫秒级的争用换来十分钟的账不落**。2026-08-27 一天碰撞六次。
//
// 两条要守死：① 锁错要重试 ② **非锁错一次都不许重试**——
// 盲目重试会把「一次明确失败」变成「拖长的明确失败」，还盖住真因。
const assert = require('node:assert');
const ledger = require('../lib/ledger');

let passed = 0;
const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('ledger-lock-retry 记账索引锁重试（议程第 39 条）');

// 假 execFile：按脚本回放结果，并记录每次调用
function 假git(脚本) {
  const 记 = [];
  const fn = (bin, args, opt, cb) => {
    const 子 = args.filter((a) => !a.startsWith('-') && a !== '--').slice(1);
    const 动作 = args.find((a) => ['add', 'commit', 'diff', 'rev-parse'].includes(a)) || args[2];
    记.push(动作);
    const r = 脚本(动作, 记.filter((x) => x === 动作).length);
    setImmediate(() => cb(r.e || null, r.so || '', r.se || ''));
    void 子; void bin; void opt;
    return { on() {} };
  };
  return { fn, 记 };
}

(async () => {
  await t('锁错判定：只认锁，其余一律不认', () => {
    const 锁 = [
      "fatal: Unable to create 'D:/repo/.git/index.lock': File exists.",
      'Another git process seems to be running in this repository',
      '资源被占用，请稍后重试',
      'error: index.lock 已存在',
    ];
    for (const s of 锁) assert.equal(ledger.锁错(null, s), true, '该认作锁错：' + s.slice(0, 40));

    const 非锁 = [
      'pre-commit hook failed',
      '*** Please tell me who you are.  Run git config --global user.email',
      "pathspec '不存在' did not match any files",
      'Permission denied',
      'nothing to commit, working tree clean',
    ];
    for (const s of 非锁) assert.equal(ledger.锁错(null, s), false,
      '不该认作锁错（重试一百次也一样，还会盖住真因）：' + s.slice(0, 40));
  });

  await t('退避递增：120/240/480/960ms，合计约 1.8s——比等下一拍（10 分钟）好三个数量级', () => {
    assert.equal(ledger.重试次数, 4);
    const 表 = [4, 3, 2, 1].map(ledger.退避毫秒);
    assert.deepEqual(表, [120, 240, 480, 960]);
    assert.ok(表.reduce((a, b) => a + b, 0) < 2000, '总退避应在两秒内——真死锁时不空转太久');
  });

  await t('锁错真会重试，且最终成功（第三次放开锁）', async () => {
    const { fn, 记 } = 假git((动作, 第几次) => {
      if (动作 === 'rev-parse') return { so: process.cwd() };
      if (动作 === 'add') {
        // 前两次撞锁，第三次成功
        if (第几次 <= 2) return { e: new Error('exit 128'), se: "fatal: Unable to create '.git/index.lock': File exists." };
        return {};
      }
      if (动作 === 'diff') return { e: new Error('exit 1') };   // 有暂存变更
      return {};                                                // commit 成功
    });
    const 果 = await new Promise((res) => ledger.commitStudio(process.cwd(), (ok, note) => res({ ok, note }), { execFile: fn }));
    assert.equal(果.ok, true, '重试后应成功：' + 果.note);
    assert.equal(记.filter((x) => x === 'add').length, 3, 'add 该被试三次（两次撞锁+一次成功）');
  });

  await t('**非锁错一次都不重试**——这是本条最要紧的一半', async () => {
    const { fn, 记 } = 假git((动作) => {
      if (动作 === 'rev-parse') return { so: process.cwd() };
      if (动作 === 'add') return { e: new Error('exit 128'), se: 'pre-commit hook failed' };
      return {};
    });
    const 果 = await new Promise((res) => ledger.commitStudio(process.cwd(), (ok, note) => res({ ok, note }), { execFile: fn }));
    assert.equal(果.ok, false);
    assert.equal(记.filter((x) => x === 'add').length, 1, '钩子拒绝不该重试，实际试了 ' + 记.filter((x) => x === 'add').length + ' 次');
    assert.match(果.note, /hook failed/, '**失败要带原因**——只回一句「add 失败」查不出是锁、是 pathspec 还是钩子');
  });

  await t('重试次数用尽仍失败 → 如实回报，不假装成功', async () => {
    const { fn, 记 } = 假git((动作) => {
      if (动作 === 'rev-parse') return { so: process.cwd() };
      if (动作 === 'add') return { e: new Error('exit 128'), se: "Unable to create '.git/index.lock'" };
      return {};
    });
    const 果 = await new Promise((res) => ledger.commitStudio(process.cwd(), (ok, note) => res({ ok, note }), { execFile: fn }));
    assert.equal(果.ok, false, '试满仍失败就要报失败');
    assert.equal(记.filter((x) => x === 'add').length, ledger.重试次数 + 1, '首发 + 四次重试 = 五次');
    assert.match(果.note, /index\.lock/, '原因要带出来');
  });

  console.log('  ' + passed + ' 项通过');
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
