const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const worktrees = require('../lib/workspace/worktree');

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return String(r.stdout || '').trim();
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-wt-'));
  const repo = path.join(root, 'project'); const monitor = path.join(root, 'monitor');
  fs.mkdirSync(repo); fs.mkdirSync(monitor);
  git(repo, ['init']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# base\n');
  git(repo, ['add', '.']);
  git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'base']);
  return { root, repo, monitor, cfg: { workspace: { mode: 'worktree', root: 'workspaces', branchPrefix: 'test', autoCommit: true, integrateDependencies: true } } };
}
function ticket(id, title = id, deps = []) { return { id, fm: { title, 依赖: deps } }; }

let passed = 0;
function test(name, fn) {
  const f = fixture();
  try { fn(f); passed++; console.log('  ✓ ' + name); }
  finally {
    try { for (const row of worktrees.worktreeList(f.repo).slice(1)) git(f.repo, ['worktree', 'remove', '--force', row.path]); } catch { /* 测试清理尽力 */ }
    fs.rmSync(f.root, { recursive: true, force: true });
  }
}

console.log('worktree 隔离与集成测试');
test('为工单创建独立分支和目录，重复准备会复用', ({ repo, monitor, cfg }) => {
  const t = ticket('BE-1'); const project = { name: 'Demo', path: repo };
  const one = worktrees.prepare(monitor, cfg, t, project, { role: 'backend' });
  assert.equal(one.isolated, true); assert.notEqual(one.path, repo); assert.ok(one.branch.endsWith('/BE-1'));
  t.fm.workspace = one;
  const two = worktrees.prepare(monitor, cfg, t, project, { role: 'backend' });
  assert.equal(two.path, one.path); assert.equal(two.created, false);
});

test('执行改动会形成检查点提交', ({ repo, monitor, cfg }) => {
  const t = ticket('BE-2', 'backend change');
  const ws = worktrees.prepare(monitor, cfg, t, { name: 'Demo', path: repo }, { role: 'backend' });
  fs.writeFileSync(path.join(ws.path, 'api.txt'), 'ok\n');
  const cp = worktrees.checkpoint(cfg, ws, t);
  assert.equal(cp.committed, true); assert.match(cp.commit, /^[0-9a-f]{40}$/);
  assert.equal(git(ws.path, ['status', '--porcelain']), '');
});

test('检查点拒绝 write_scope 之外的改动', ({ repo, monitor, cfg }) => {
  const t = ticket('BE-SCOPE'); t.fm.role = 'backend'; t.fm.write_scope = ['src/**'];
  const ws = worktrees.prepare(monitor, cfg, t, { name: 'Demo', path: repo }, { role: 'backend' });
  fs.writeFileSync(path.join(ws.path, 'outside.txt'), 'no\n');
  assert.throws(() => worktrees.checkpoint(cfg, ws, t), /write_scope.*outside\.txt/);
});

test('普通下游任务也会先纳入依赖检查点', ({ repo, monitor, cfg }) => {
  const project = { name: 'Demo', path: repo };
  const upstream = ticket('CONTRACT');
  const uws = worktrees.prepare(monitor, cfg, upstream, project, { role: 'backend' });
  fs.writeFileSync(path.join(uws.path, 'contract.json'), '{}\n');
  upstream.fm.workspace = { ...uws, ...worktrees.checkpoint(cfg, uws, upstream) };
  const downstream = ticket('FRONT', 'frontend', ['CONTRACT']);
  const dws = worktrees.prepare(monitor, cfg, downstream, project, { role: 'frontend', dependencies: [upstream] });
  assert.equal(dws.integration.pending, false);
  assert.ok(fs.existsSync(path.join(dws.path, 'contract.json')));
});

test('依赖缺少检查点时拒绝开始下游任务', ({ repo, monitor, cfg }) => {
  const downstream = ticket('DOWN', 'downstream', ['OLD']);
  const old = ticket('OLD');
  assert.throws(() => worktrees.prepare(monitor, cfg, downstream, { name: 'Demo', path: repo }, {
    role: 'backend', dependencies: [old],
  }), /依赖缺少 Git 检查点：OLD/);
});

test('非 Integrator 遇依赖冲突会中止冲突合并并拒绝执行', ({ repo, monitor, cfg }) => {
  const project = { name: 'Demo', path: repo };
  const left = ticket('LEFT'); const lws = worktrees.prepare(monitor, cfg, left, project, { role: 'backend' });
  fs.writeFileSync(path.join(lws.path, 'README.md'), '# left\n');
  left.fm.workspace = { ...lws, ...worktrees.checkpoint(cfg, lws, left) };
  const right = ticket('RIGHT'); const rws = worktrees.prepare(monitor, cfg, right, project, { role: 'frontend' });
  fs.writeFileSync(path.join(rws.path, 'README.md'), '# right\n');
  right.fm.workspace = { ...rws, ...worktrees.checkpoint(cfg, rws, right) };
  const downstream = ticket('CONSUMER', 'consumer', ['LEFT', 'RIGHT']);
  assert.throws(() => worktrees.prepare(monitor, cfg, downstream, project, {
    role: 'backend', dependencies: [left, right],
  }), /需要 Integrator 处理：README\.md/);
  const row = worktrees.worktreeList(repo).find((item) => item.branch && item.branch.endsWith('/CONSUMER'));
  assert.ok(row); assert.equal(git(row.path, ['diff', '--name-only', '--diff-filter=U']), '');
});

test('Integrator 合并依赖检查点，完成后可安全快进发布', ({ repo, monitor, cfg }) => {
  const project = { name: 'Demo', path: repo };
  const back = ticket('BE-3'); const bws = worktrees.prepare(monitor, cfg, back, project, { role: 'backend' });
  fs.writeFileSync(path.join(bws.path, 'backend.txt'), 'backend\n');
  back.fm.workspace = { ...bws, ...worktrees.checkpoint(cfg, bws, back) };
  const front = ticket('FE-3'); const fws = worktrees.prepare(monitor, cfg, front, project, { role: 'frontend' });
  fs.writeFileSync(path.join(fws.path, 'frontend.txt'), 'frontend\n');
  front.fm.workspace = { ...fws, ...worktrees.checkpoint(cfg, fws, front) };

  const integ = ticket('INT-3', 'integrate', ['BE-3', 'FE-3']);
  const iws = worktrees.prepare(monitor, cfg, integ, project, { role: 'integrator', dependencies: [back, front] });
  assert.equal(iws.integration.pending, false); assert.equal(iws.integration.merged.length, 2);
  assert.ok(fs.existsSync(path.join(iws.path, 'backend.txt')) && fs.existsSync(path.join(iws.path, 'frontend.txt')));
  integ.fm.workspace = { ...iws, ...worktrees.checkpoint(cfg, iws, integ) };
  const published = worktrees.publish(project, integ.fm.workspace);
  assert.equal(published.ok, true);
  assert.ok(fs.existsSync(path.join(repo, 'backend.txt')) && fs.existsSync(path.join(repo, 'frontend.txt')));
});

console.log(`全部通过：${passed} 项`);
