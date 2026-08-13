// 工作区契约测试 —— 隔离、收工与分支归属（协-009）。
//
// 这一套跑**真的 git**：收工是删除操作，用假对象测等于什么都没测。
// 每个用例自己建一个临时仓，跑完删掉，不碰任何真实项目。
'use strict';
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
const 工作区 = require(path.join(平台根, 'lib', 'workspace', 'worktree.js'));

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('工作区契约测试');

const git = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();

// 造一个有一次提交的仓。工作区那套全靠 git 的真实行为兜底
// （-d 拒删未合并、worktree remove 拒绝带脏改动的目录），假不出来。
function 建仓() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
  git(d, ['init', '-q', '-b', 'master']);
  git(d, ['config', 'user.email', 'test@local']);
  git(d, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello\n');
  git(d, ['add', '-A']);
  git(d, ['commit', '-q', '--no-gpg-sign', '-m', 'init']);
  return d;
}
const 清 = (...ds) => ds.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 已清 */ } });

t('收工：已合并的分支连同工作区一起收掉', () => {
  const 仓 = 建仓();
  const wt = path.join(os.tmpdir(), 'wt-a-' + process.pid);
  try {
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/T-1', wt, 'master']);
    assert.ok(fs.existsSync(wt));
    const r = 工作区.收工({ path: 仓 }, { path: wt, branch: 'platform/p/T-1' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.工作区.已清, true);
    assert.equal(r.分支.已清, true);
    assert.ok(!fs.existsSync(wt), '目录该没了');
    assert.ok(!git(仓, ['branch', '--list', 'platform/p/T-1']), '分支该没了');
    // git 自己的登记也要干净，否则 `git worktree list` 会一直显示一条陈账
    assert.ok(!git(仓, ['worktree', 'list', '--porcelain']).includes('wt-a-'), 'git 里还留着 worktree 登记');
  } finally { 清(仓, wt); }
});

t('收工：**未合并的分支删不掉**——那些提交是这台机器上唯一的一份', () => {
  // 这条是整个模块最重要的一条。用 -d 不用 -D 是有意的：
  // 活没合回去就不删。删错了没有任何补救——worktree 也一起摘了，人手里什么都不剩。
  const 仓 = 建仓();
  const wt = path.join(os.tmpdir(), 'wt-b-' + process.pid);
  try {
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/T-2', wt, 'master']);
    fs.writeFileSync(path.join(wt, 'b.txt'), 'work\n');
    git(wt, ['add', '-A']);
    git(wt, ['-c', 'user.email=t@l', '-c', 'user.name=t', 'commit', '-q', '--no-gpg-sign', '-m', '没合回去的活']);

    const r = 工作区.收工({ path: 仓 }, { path: wt, branch: 'platform/p/T-2' });
    assert.equal(r.工作区.已清, true, '工作区可以摘——提交还在分支上，不会丢');
    assert.equal(r.分支.已清, false, '未合并的分支被删了！那些提交没有第二份');
    assert.ok(git(仓, ['branch', '--list', 'platform/p/T-2']), '分支必须还在');
    assert.ok(/-d 不是 -D|没合/.test(r.分支.说), '要说清为什么留着：' + r.分支.说);
  } finally { 清(仓, wt); }
});

t('收工：工作区里有未提交改动时拒绝摘，且不去动分支', () => {
  // 有脏改动说明这儿还有活的东西。宁可留着让人来看——
  // 而且这时候绝不能顺手把分支删了：那等于把人正在改的东西连根拔掉。
  const 仓 = 建仓();
  const wt = path.join(os.tmpdir(), 'wt-c-' + process.pid);
  try {
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/T-3', wt, 'master']);
    fs.writeFileSync(path.join(wt, 'a.txt'), '改了没提交\n');
    const r = 工作区.收工({ path: 仓 }, { path: wt, branch: 'platform/p/T-3' });
    assert.equal(r.ok, false);
    assert.equal(r.工作区.已清, false);
    assert.equal(r.分支, null, '摘不掉工作区就该停在这儿，不许继续去删分支');
    assert.ok(fs.existsSync(wt));
    assert.ok(git(仓, ['branch', '--list', 'platform/p/T-3']));
  } finally { 清(仓, wt); }
});

t('收工：目录早就没了也能收干净（prune 掉 git 里的陈账）', () => {
  const 仓 = 建仓();
  const wt = path.join(os.tmpdir(), 'wt-d-' + process.pid);
  try {
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/T-4', wt, 'master']);
    fs.rmSync(wt, { recursive: true, force: true });        // 人手删了目录
    const r = 工作区.收工({ path: 仓 }, { path: wt, branch: 'platform/p/T-4' });
    assert.equal(r.ok, true);
    assert.equal(r.工作区.已清, true);
    assert.ok(!git(仓, ['worktree', 'list', '--porcelain']).includes('wt-d-'),
      '目录没了但 git 还登记着——不 prune 的话 worktree list 会一直显示它');
  } finally { 清(仓, wt); }
});

t('遗留工作区：只挑已完成或已不存在的单，在办的不碰', () => {
  const 仓 = 建仓();
  const a = path.join(os.tmpdir(), 'wt-e1-' + process.pid);
  const b = path.join(os.tmpdir(), 'wt-e2-' + process.pid);
  const c = path.join(os.tmpdir(), 'wt-e3-' + process.pid);
  try {
    git(仓, ['worktree', 'add', '-q', '-b', 'p/完成单', a, 'master']);
    git(仓, ['worktree', 'add', '-q', '-b', 'p/在办单', b, 'master']);
    git(仓, ['worktree', 'add', '-q', '-b', 'p/没这单', c, 'master']);
    // 遗留判定按目录名认单号（worktree 的目录名就是单号），这里直接用临时目录名当单号
    const 全 = [
      { id: path.basename(a), state: '完成' },
      { id: path.basename(b), state: '待投' },
    ];
    const 出 = 工作区.遗留工作区(null, {}, { path: 仓 }, 全);
    const 单 = 出.map((x) => x.单).sort();
    assert.ok(单.includes(path.basename(a)), '已完成的该报');
    assert.ok(单.includes(path.basename(c)), '工单库里没有的该报');
    assert.ok(!单.includes(path.basename(b)), '在办的单不该被当成遗留——收掉它等于把正在跑的活铲了');
    assert.ok(!出.some((x) => path.resolve(x.路径) === path.resolve(仓)), '主工作区不该出现在遗留里');
  } finally { 清(仓, a, b, c); }
});

// ---- 分支归属 ----
t('分支名以工单记着的为准，配置前缀只用于新建', () => {
  // 不这么做的话，改一次 branchPrefix 就让所有在途的单静默换轨：
  // 按新前缀算出一个不存在的分支，从 baseRef 另起一条，
  // 老分支上没合回去的提交就此搁浅——没有报错，只是活不见了。
  // 2026-08-12 把默认前缀从 studio 改成 platform 时当场撞到（DEP-2 上有未合并提交）。
  const 仓 = 建仓();
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-root-'));
  try {
    const 配 = { workspace: { mode: 'worktree', root: 根, branchPrefix: 'platform' } };
    const 老单 = { id: 'T-9', fm: { workspace: { branch: 'studio/project/T-9' } } };
    const r = 工作区.prepare(根, 配, 老单, { name: 'project', path: 仓 });
    assert.equal(r.branch, 'studio/project/T-9', '工单记着的分支被配置前缀顶掉了——在途的活会搁浅');
    // 新单才按配置前缀走
    const 新 = 工作区.prepare(根, 配, { id: 'T-10', fm: {} }, { name: 'project', path: 仓 });
    assert.equal(新.branch, 'platform/project/T-10');
  } finally { 清(仓, 根); }
});

t('检查点的提交信息用同一个前缀，不写死 studio', () => {
  // 这条提交进的是**用户自己的仓**，落款写着 studio 而实际是 platform 干的，
  // git log 上就分不清谁改了什么。协-009 改分支前缀时漏了这一处，
  // 首次真跑之后在靶仓的提交上看到才发现（`[studio] E2E-1 …`）。
  const 仓 = 建仓();
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cp-'));
  try {
    const 配 = { workspace: { mode: 'worktree', root: 根, branchPrefix: 'platform' } };
    const 单 = { id: 'T-11', fm: { title: '加个函数' } };
    const w = 工作区.prepare(根, 配, 单, { name: 'p', path: 仓 });
    fs.writeFileSync(path.join(w.path, 'n.txt'), 'x\n');
    工作区.checkpoint(配, w, 单);
    const 信 = git(仓, ['log', '-1', '--format=%s', 'platform/p/T-11']);
    assert.ok(信.startsWith('[platform]'), '提交信息前缀不对：' + 信);
    assert.ok(!/\[studio\]/.test(信), '还写着 [studio]');
  } finally { 清(仓, 根); }
});

t('中文项目名不许塌成同一个目录（本仓的项目名基本都是中文）', () => {
  // 实测（海投王首次真跑）：safePart 把非 ASCII 整段剥掉，「海投王」剩空串，
  // 落回兜底值 'project'。于是**所有中文名项目共用同一个工作区目录**——
  // 靶仓和海投王都是 workspaces/project/，两边只要出现同名工单就直接撞车，
  // 而且撞得很难查：目录名上看不出是谁的。
  // 中文名在这个仓里是常态（靶仓、海投王、平台自己），不是边角情况。
  const 仓 = 建仓();
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cn-'));
  try {
    const 配 = { workspace: { mode: 'worktree', root: 根, branchPrefix: 'platform' } };
    const a = 工作区.prepare(根, 配, { id: 'T-1', fm: {} }, { name: '海投王', path: 仓 });
    const b = 工作区.prepare(根, 配, { id: 'T-2', fm: {} }, { name: '靶仓', path: 仓 });
    assert.notEqual(path.dirname(a.path), path.dirname(b.path),
      '两个中文名项目落进了同一个目录——同名工单会互相覆盖');
    assert.notEqual(a.branch.split('/')[1], b.branch.split('/')[1], '分支名同样要分得开');
    // 英文名一个字都不该变——可读性不能为了修这个 bug 让路
    const c = 工作区.prepare(根, 配, { id: 'T-3', fm: {} }, { name: 'my-repo', path: 仓 });
    assert.equal(c.branch, 'platform/my-repo/T-3');
    // 幂等：同一个名字每次都得到同一个目录，否则下次跑找不到上次的工作区
    const d = 工作区.prepare(根, 配, { id: 'T-1', fm: {} }, { name: '海投王', path: 仓 });
    assert.equal(d.path, a.path, '同一个项目两次算出不同目录——工作区复用会失效');
  } finally { 清(仓, 根); }
});

t('默认分支前缀是 platform，不是 studio', () => {
  // 这个前缀出现在**用户自己的仓**里。建它的是 platform 不是 studio——
  // 两个产品都往同一个仓写的时候，光看分支名分不清是谁建的。
  assert.equal(工作区.configOf({}).branchPrefix, 'platform');
  assert.equal(工作区.configOf({ workspace: { branchPrefix: '自定义' } }).branchPrefix, '自定义');
});

console.log(`全部通过：${passed} 项`);
