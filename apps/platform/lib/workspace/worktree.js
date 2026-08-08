// workspace/worktree.js — 每张执行单一个 Git worktree；完成时形成可追溯检查点。
// 这里只提供并发隔离和确定性 Git 操作，不把 worktree 当安全沙箱，也不自动发布到主分支。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const toArr = (value) => Array.isArray(value) ? value : value == null || value === '' ? [] : String(value).split(/[，,\s]+/).filter(Boolean);

function git(cwd, args, allowed = [0]) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Git 不可用：${result.error.message}`);
  if (!allowed.includes(result.status)) {
    const detail = String(result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-3).join(' ');
    throw new Error(`Git ${args[0]} 失败${detail ? `：${detail}` : ''}`);
  }
  return { code: result.status, stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

function configOf(cfg) {
  const value = cfg.workspace || cfg.工作区 || {};
  return {
    mode: value.mode || value.模式 || 'direct',
    root: value.root || value.根目录 || 'workspaces',
    branchPrefix: value.branchPrefix || value.分支前缀 || 'studio',
    baseRef: value.baseRef || value.基线 || 'HEAD',
    autoCommit: value.autoCommit !== false && value.自动提交 !== false,
    integrateDependencies: value.integrateDependencies !== false && value.集成依赖 !== false,
    allowMissingDependencies: value.allowMissingDependencies === true || value.允许缺失依赖 === true,
    requireGit: value.requireGit === true || value.必须Git === true,
  };
}

function isGitRepo(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try { return git(dir, ['rev-parse', '--is-inside-work-tree']).stdout === 'true'; } catch { return false; }
}

function repoTop(dir) { return path.resolve(git(dir, ['rev-parse', '--show-toplevel']).stdout); }
function head(dir) { return git(dir, ['rev-parse', 'HEAD']).stdout; }
function safePart(value, fallback) {
  const clean = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);
  return clean || fallback;
}
function isWithin(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function workspaceRoot(monitorRoot, configured, repository) {
  let candidate = path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(monitorRoot, configured);
  // worktree 不能安全地嵌在被执行项目自身的工作树内；同仓部署时转入系统临时目录。
  if (isWithin(repository, candidate)) {
    const key = crypto.createHash('sha1').update(`${path.resolve(monitorRoot)}\0${repository}`).digest('hex').slice(0, 12);
    candidate = path.join(os.tmpdir(), 'aiworkflow-worktrees', key);
  }
  return candidate;
}

function worktreeList(repository) {
  const rows = []; let current = null;
  for (const line of git(repository, ['worktree', 'list', '--porcelain']).stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { current = { path: line.slice(9) }; rows.push(current); }
    else if (current && line.startsWith('branch refs/heads/')) current.branch = line.slice('branch refs/heads/'.length);
    else if (current && line === 'detached') current.detached = true;
  }
  return rows;
}

function existingWorkspace(repository, branch, storedPath) {
  const rows = worktreeList(repository);
  const found = rows.find((row) => row.branch === branch)
    || (storedPath && rows.find((row) => path.resolve(row.path) === path.resolve(storedPath)));
  if (found && fs.existsSync(found.path) && isGitRepo(found.path)) return path.resolve(found.path);
  return null;
}

function unresolved(dir) {
  const output = git(dir, ['diff', '--name-only', '--diff-filter=U']).stdout;
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function changedFiles(dir) {
  const values = [
    git(dir, ['diff', '--name-only', 'HEAD']).stdout,
    git(dir, ['diff', '--cached', '--name-only', 'HEAD']).stdout,
    git(dir, ['ls-files', '--others', '--exclude-standard']).stdout,
  ].flatMap((value) => value ? value.split(/\r?\n/) : []);
  return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))];
}

function globRegex(pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/').replace(/^\.\//, '');
  let source = '';
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === '*' && normalized[i + 1] === '*') {
      i++;
      if (normalized[i + 1] === '/') { i++; source += '(?:.*/)?'; } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

function enforceWriteScope(ticket, dir) {
  const role = ticket && ticket.fm && (ticket.fm.role || ticket.fm.角色 || ticket.fm.职能);
  if (role === 'integrator') return [];
  const scopes = toArr(ticket && ticket.fm && (ticket.fm.write_scope || ticket.fm.writeScope || ticket.fm.写入范围));
  if (!scopes.length) return [];
  const patterns = scopes.map(globRegex);
  const violations = changedFiles(dir).filter((file) => !patterns.some((pattern) => pattern.test(file)));
  if (violations.length) throw new Error(`改动超出工单 write_scope：${violations.join('、')}`);
  return scopes;
}

function integrate(workspace, dependencyTickets) {
  const merged = []; const already = []; const skipped = [];
  const initialConflicts = unresolved(workspace.path);
  if (initialConflicts.length) return { merged, already, skipped, conflicts: initialConflicts, pending: true };
  for (const ticket of dependencyTickets || []) {
    const commit = ticket && ticket.fm && ticket.fm.workspace && ticket.fm.workspace.commit;
    if (!commit || !/^[0-9a-f]{7,64}$/i.test(String(commit))) {
      skipped.push({ id: ticket && ticket.id || 'unknown', reason: '依赖单没有可集成的 Git 检查点' });
      continue;
    }
    const sha = String(commit);
    git(workspace.path, ['cat-file', '-e', `${sha}^{commit}`]);
    const ancestor = git(workspace.path, ['merge-base', '--is-ancestor', sha, 'HEAD'], [0, 1]);
    if (ancestor.code === 0) { already.push({ id: ticket.id, commit: sha }); continue; }
    const result = git(workspace.path, [
      '-c', 'user.name=AI Workflow Studio', '-c', 'user.email=noreply@local',
      'merge', '--no-ff', '--no-edit', '--no-gpg-sign', sha,
    ], [0, 1]);
    if (result.code === 0) { merged.push({ id: ticket.id, commit: sha }); continue; }
    const conflicts = unresolved(workspace.path);
    if (!conflicts.length) throw new Error(`集成依赖 ${ticket.id} 失败：${result.stderr || result.stdout || '未知错误'}`);
    return { merged, already, skipped, conflicts, failedDependency: ticket.id, pending: true };
  }
  return { merged, already, skipped, conflicts: [], pending: false };
}

function prepare(monitorRoot, cfg, ticket, project, options = {}) {
  const wc = configOf(cfg);
  const basePath = path.resolve(project.path);
  if (wc.mode !== 'worktree') return { mode: 'direct', isolated: false, path: basePath, basePath };
  if (!isGitRepo(basePath)) {
    if (wc.requireGit) throw new Error(`项目不是 Git 仓库，无法创建隔离工作区：${basePath}`);
    return { mode: 'direct', isolated: false, path: basePath, basePath, warning: '项目不是 Git 仓库，已退回直接目录模式' };
  }

  const repository = repoTop(basePath);
  const prefix = safePart(wc.branchPrefix, 'studio');
  const projectPart = safePart(project.name, 'project');
  const ticketPart = safePart(ticket.id, 'ticket');
  const branch = `${prefix}/${projectPart}/${ticketPart}`;
  const root = workspaceRoot(monitorRoot, wc.root, repository);
  const target = path.join(root, projectPart, ticketPart);
  const stored = ticket.fm && ticket.fm.workspace && ticket.fm.workspace.path;
  let workPath = existingWorkspace(repository, branch, stored);
  let created = false;

  if (!workPath) {
    if (fs.existsSync(target)) throw new Error(`工作区目录已存在但不是登记中的 Git worktree：${target}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const branchExists = git(repository, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], [0, 1]).code === 0;
    if (branchExists) git(repository, ['worktree', 'add', target, branch]);
    else {
      git(repository, ['rev-parse', '--verify', `${wc.baseRef}^{commit}`]);
      git(repository, ['worktree', 'add', '-b', branch, target, wc.baseRef]);
    }
    workPath = path.resolve(target); created = true;
  }

  const result = {
    mode: 'worktree', isolated: true, path: workPath, basePath: repository, branch,
    baseRef: wc.baseRef, created, commit: head(workPath), preparedAt: new Date().toISOString(),
  };
  if (wc.integrateDependencies && (options.dependencies || []).length) {
    result.integration = integrate(result, options.dependencies || []);
    if (result.integration.skipped.length && !wc.allowMissingDependencies)
      throw new Error(`依赖缺少 Git 检查点：${result.integration.skipped.map((item) => item.id).join('、')}`);
    if (result.integration.conflicts.length && options.role !== 'integrator') {
      try { git(workPath, ['merge', '--abort']); } catch { /* 保留原始错误；失败分诊会暴露工作区 */ }
      throw new Error(`依赖合并发生冲突，需要 Integrator 处理：${result.integration.conflicts.join('、')}`);
    }
    result.commit = head(workPath);
  }
  return result;
}

function checkpoint(cfg, workspace, ticket) {
  if (!workspace || !workspace.isolated) return { committed: false, commit: null, changed: false };
  const conflicts = unresolved(workspace.path);
  if (conflicts.length) throw new Error(`仍有未解决的集成冲突：${conflicts.join('、')}`);
  const wc = configOf(cfg);
  const dirty = git(workspace.path, ['status', '--porcelain']).stdout;
  if (!dirty) return { committed: false, commit: head(workspace.path), changed: false };
  enforceWriteScope(ticket, workspace.path);
  if (!wc.autoCommit) return { committed: false, commit: null, changed: true, warning: '自动检查点已关闭，改动尚未提交' };
  git(workspace.path, ['add', '-A']);
  const staged = git(workspace.path, ['diff', '--cached', '--quiet'], [0, 1]);
  if (staged.code === 0) return { committed: false, commit: head(workspace.path), changed: false };
  const title = String(ticket.fm && ticket.fm.title || '').replace(/[\r\n]+/g, ' ').slice(0, 80);
  git(workspace.path, [
    '-c', 'user.name=AI Workflow Studio', '-c', 'user.email=noreply@local',
    'commit', '--no-gpg-sign', '-m', `[studio] ${ticket.id}${title ? ` ${title}` : ''}`,
  ]);
  return { committed: true, commit: head(workspace.path), changed: true };
}

function dependencyTickets(root, ticket, store) {
  return toArr(ticket.fm && ticket.fm.依赖).map((id) => store.find(root, id)).filter(Boolean);
}

// 只允许无冲突的快进发布。基线有新提交时拒绝，要求重新跑 integrator，不在主目录制造冲突现场。
function publish(project, workspace) {
  if (!workspace || !workspace.isolated || !/^[0-9a-f]{7,64}$/i.test(String(workspace.commit || '')))
    throw new Error('工单没有可发布的隔离工作区检查点');
  const basePath = repoTop(project.path);
  if (git(basePath, ['status', '--porcelain']).stdout) throw new Error('项目主工作区有未提交改动，拒绝发布');
  const sha = String(workspace.commit);
  git(basePath, ['cat-file', '-e', `${sha}^{commit}`]);
  if (git(basePath, ['merge-base', '--is-ancestor', 'HEAD', sha], [0, 1]).code !== 0)
    throw new Error('项目基线已前进，不能快进发布；请创建新的 integrator 工单重新集成');
  git(basePath, ['merge', '--ff-only', sha]);
  return { ok: true, commit: head(basePath), path: basePath };
}

module.exports = {
  configOf, isGitRepo, repoTop, workspaceRoot, worktreeList,
  prepare, integrate, checkpoint, dependencyTickets, publish, changedFiles, enforceWriteScope,
};
