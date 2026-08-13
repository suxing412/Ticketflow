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
    // 2026-08-12 改：默认从 'studio' 改成 'platform'。
    // 这个前缀会出现在**用户自己的仓**里（分支名 <前缀>/<项目>/<单号>），
    // 而建它的是 platform 不是 studio——两个产品都往同一个仓写的时候，
    // 光看分支名分不清是谁建的。已存在的 studio/* 分支不受影响：
    // 清理时读的是工单 frontmatter 里记下的那个名字，不是现算的。
    branchPrefix: value.branchPrefix || value.分支前缀 || 'platform',
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
// 目录名/分支名里的一段。要既安全又**唯一**——原先只做到了安全。
//
// ⚠ 实测（2026-08-13，海投王首次真跑）：中文项目名会被整段剥空。
// 「海投王」→ 非 ASCII 全被替换 → 空串 → 落回兜底值 'project'。
// 于是**所有中文名项目共用同一个工作区目录**：靶仓和海投王都是 workspaces/project/，
// 两边只要出现同名工单就直接撞车，而且撞得很难查——目录名上看不出是谁的。
//
// 中文名在这个仓里是常态（靶仓、海投王、平台自己），不是边角情况。
//
// 改法：ASCII 部分照旧保留（可读），剥空时用**内容哈希**兜底而不是固定字符串。
// 哈希只在必要时出现，所以英文名项目的目录一个字都不变。
function safePart(value, fallback) {
  const 原 = String(value || '').trim();
  const clean = 原.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);
  if (clean) return clean;
  // 剥空了：拿原文算个短哈希。不同的名字必得不同的目录，而同一个名字每次都一样。
  if (原) return fallback + '-' + crypto.createHash('sha1').update(原).digest('hex').slice(0, 8);
  return fallback;
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

// 从正文的「## 写入范围」一节里捡出真的 glob（协-005）。
//
// 为什么要有这个兜底：write_scope 原本只认 frontmatter，而只有 orchestrator
// 拆出来的子单会写 frontmatter（plan.js:157）。人手建的单——工单模板给的正是
// 「## 写入范围」这一节——写在**正文**里，于是这一节形同虚设：单子上白纸黑字
// 写着只许改 public/**，AI 改遍全仓也没有任何东西拦。这是典型的安静的失败。
//
// 解析必须偏保守。方向性很重要：**多认一条 glob 只是放宽，错认一条占位符
// 却会让每次改动都判违规、checkpoint 抛错、活白干**。所以只收明确像路径的行，
// 占位符 `<...>`、说明性括号、以及不含路径特征的散文一律跳过。
function 正文写入范围(body) {
  const 段 = (String(body || '').match(/##\s*写入范围\s*\r?\n([\s\S]*?)(?=\r?\n##|$)/) || [])[1] || '';
  const 出 = [];
  for (const 行 of 段.split(/\r?\n/)) {
    let s = 行.trim().replace(/^[-*]\s*/, '').replace(/^`|`$/g, '').trim();
    if (!s) continue;
    if (/^[（(]/.test(s)) continue;               // 「（留空——只读角色…）」这类说明
    if (/[<>]/.test(s)) continue;                 // 「<允许改的文件或 glob>」占位符
    if (/\s/.test(s)) continue;                   // 带空格的是散文，不是路径
    if (!/[\/.*]/.test(s)) continue;              // 连 / . * 都没有，不像路径
    出.push(s);
  }
  return 出;
}

function enforceWriteScope(ticket, dir) {
  const role = ticket && ticket.fm && (ticket.fm.role || ticket.fm.角色 || ticket.fm.职能);
  if (role === 'integrator') return [];
  const scopes = toArr(ticket && ticket.fm && (ticket.fm.write_scope || ticket.fm.writeScope || ticket.fm.写入范围));
  let 出处 = 'frontmatter 的 write_scope';
  if (!scopes.length) {
    scopes.push(...正文写入范围(ticket && ticket.body));
    出处 = '正文的「## 写入范围」一节';
  }
  if (!scopes.length) return [];
  const patterns = scopes.map(globRegex);
  const violations = changedFiles(dir).filter((file) => !patterns.some((pattern) => pattern.test(file)));
  // 出处要说清楚。人手建的单，范围是从**正文**读出来的——不讲的话，
  // 他对着 frontmatter 找半天也找不到这条约束是哪来的。
  if (violations.length) {
    throw new Error(
      `改动超出工单允许的写入范围：${violations.join('、')}。\n`
      + `允许范围 ${scopes.join('、')}，来自${出处}。\n`
      + '改动还在工作区里没丢，只是没打检查点。要么收窄改动，要么改这张单的写入范围。');
  }
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
  // 分支名：**工单自己记着的那个优先**，配置只用于新建。
  //
  // 不这么做的话，改一次 branchPrefix 就会让所有在途的单静默换轨：
  // prepare 按新前缀算出一个不存在的分支名，于是从 baseRef 另起一条，
  // 而老分支上那些没合回去的提交就此搁浅——没有报错，只是活不见了。
  // 2026-08-12 把默认前缀从 studio 改成 platform 时当场发现这条（DEP-2 上有未合并提交）。
  const 记着的 = ticket.fm && ticket.fm.workspace && ticket.fm.workspace.branch;
  const branch = 记着的 && /^[\w./-]+$/.test(记着的)
    ? String(记着的)
    : `${prefix}/${projectPart}/${ticketPart}`;
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
    // 提交信息的前缀与分支前缀同源：这条提交进的是**用户自己的仓**，
    // 落款写着 studio 而实际是 platform 干的，git log 上就分不清谁改了什么。
    // 协-009 改分支前缀时漏了这一处，首次真跑的提交上看到才发现（[studio] E2E-1 …）。
    'commit', '--no-gpg-sign', '-m', `[${wc.branchPrefix}] ${ticket.id}${title ? ` ${title}` : ''}`,
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

// 审阅区 —— 给判官一份**只读**的代码视图（协-011）。
//
// 此前质检跑在 取工作目录() 现建的空临时目录里，跟被评审的代码毫无关系：
// 判官被告知「改了 util.js」，然后去读，得到 ENOENT。它做的判断没错——
// 「工作区中不存在 util.js」是它眼前的事实——错的是我们没给它代码。
// 实测：QA-VERIFY 的实现已经合进 master 且功能正确，仍被判不过。
//
// 为什么不直接把项目主仓当 cwd：施工令决定 3「不给『直接在主工作区跑』这个选项」。
// 那条决定是对着**写**立的，但给一个无头 agent 递上主工作区的路径，
// 指望它因为几个 CLI flag 就不写，是把架构保证降级成自觉。
//
// 所以另开一个 detached worktree 落在该单的检查点上。判官看到的正是它要判的那份代码，
// 而且是历史上那个点的样子——就算主线之后又往前走了，判的也还是这张单交付的东西。
function 审阅区(monitorRoot, cfg, project, 单号, commit) {
  const wc = configOf(cfg);
  const repository = repoTop(path.resolve(project.path));
  const sha = String(commit || '').trim();
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return { ok: false, 错误: `没有可审阅的检查点（实得 ${sha || '空'}）` };
  git(repository, ['cat-file', '-e', `${sha}^{commit}`]);

  const root = workspaceRoot(monitorRoot, wc.root, repository);
  const target = path.join(root, safePart(project.name, 'project'), '审阅-' + safePart(单号, 'ticket'));
  // 上一次判官留下的残留：直接摘掉重开，不复用。
  // 复用的话，判官可能看到上一轮遗留的文件，而那正是「看到的不是要判的东西」。
  if (fs.existsSync(target) || worktreeList(repository).some((w) => path.resolve(w.path) === path.resolve(target))) {
    git(repository, ['worktree', 'remove', '--force', target], [0, 1, 128]);
    git(repository, ['worktree', 'prune'], [0, 1]);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // --detach：不建分支。判官不该拥有一条分支——它没有要交付的东西。
  git(repository, ['worktree', 'add', '--detach', target, sha]);
  return { ok: true, 路径: path.resolve(target), commit: sha, 仓库: repository };
}

// 收工 —— 一张单干完之后把它的隔离工作区和分支收掉（协-009）。
//
// 原先 publish 只做 merge --ff-only 就返回，**全仓没有一行清理代码**。
// 于是每跑一张单，就在用户自己的仓里永久留下一个 worktree 目录和一个分支。
// 实测：靶仓跑了 5 张单，5 个 worktree、5 个分支全在，其中 3 张早已完成。
// 跑一百张就是一百个——`git worktree list` 和 `git branch` 会越来越长，
// 这是往用户的仓里堆垃圾，而且没有任何一处会提醒他。
//
// 安全边界写死在实现里，不做成选项：
//   ① 分支用 `git branch -d`（小写），**不用 -D**。小写的会拒绝删除未合并的分支——
//      这正是我们想要的判据：活没合进去就别删。想删得动就先合。
//   ② 先摘 worktree 再删分支。反过来 git 会拒绝：分支正被某个 worktree 检出。
//   ③ worktree remove 不加 --force。有未提交改动时它会拒绝，那说明这里还有活的东西，
//      宁可留着让人来看。
//   ④ 每一步都单独报结果。「清理失败」四个字没用，人要知道是哪一步、为什么。
function 收工(project, workspace, { 分支 } = {}) {
  const 出 = { 工作区: null, 分支: null };
  const repo = repoTop(project.path);
  const 路径 = workspace && workspace.path;
  const 支 = 分支 || (workspace && workspace.branch);

  if (!路径 && !支) return { ok: false, 错误: '没有可收的工作区（工单里没记 workspace.path 与 branch）' };

  // ——— 摘 worktree ———
  if (路径) {
    if (!fs.existsSync(路径)) {
      // 目录已经不在了（人手删过、或换过机器）。git 那边可能还留着登记，
      // prune 一下把陈账清掉——不 prune 的话 `git worktree list` 会一直显示它。
      git(repo, ['worktree', 'prune'], [0, 1]);
      出.工作区 = { 已清: true, 说: '目录本来就不在，已 prune 掉 git 里的陈账' };
    } else {
      const r = git(repo, ['worktree', 'remove', 路径], [0, 1, 128]);
      出.工作区 = r.code === 0
        ? { 已清: true, 说: `已摘除 ${路径}` }
        : { 已清: false, 说: `摘不掉：${r.stderr || r.stdout || '未知原因'}。`
            + '多半是里面还有未提交的改动——那说明这里还有活的东西，先去看一眼再说。' };
      if (r.code !== 0) return { ok: false, ...出, 错误: 出.工作区.说 };
    }
  }

  // ——— 删分支 ———
  if (支) {
    const 有 = git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${支}`], [0, 1]);
    if (有.code !== 0) {
      出.分支 = { 已清: true, 说: `分支 ${支} 已不存在` };
    } else {
      const r = git(repo, ['branch', '-d', 支], [0, 1, 128]);
      出.分支 = r.code === 0
        ? { 已清: true, 说: `已删分支 ${支}` }
        : { 已清: false, 说: `留着分支 ${支}：git 说它还没合进当前分支。`
            + '这是有意的——用的是 -d 不是 -D，活没合回去就不删，那些提交是这台机器上唯一的一份。' };
    }
  }
  return { ok: true, ...出 };
}

// 找出「已经没人认领」的工作区：目录还在，但对应的工单已完成或压根不存在。
// 纯读，不动任何东西——要不要收由调用方决定。
function 遗留工作区(monitorRoot, cfg, project, 工单表) {
  const repo = repoTop(project.path);
  const 表 = new Map((工单表 || []).map((t) => [String(t.id), t]));
  const 出 = [];
  for (const w of worktreeList(repo)) {
    const 名 = path.basename(w.path || '');
    if (!名 || path.resolve(w.path) === path.resolve(repo)) continue;   // 主工作区不算
    const t = 表.get(名);
    if (!t) { 出.push({ 单: 名, 路径: w.path, 分支: w.branch, 因: '工单库里找不到这张单' }); continue; }
    // 已归档的单同样该收：它已经退出产线，工作区留着没有任何用处。
    if (t.state === '完成' || t.state === '已归档') {
      出.push({ 单: 名, 路径: w.path, 分支: w.branch, 因: `工单已${t.state === '完成' ? '完成' : '归档'}` });
    }
  }
  return 出;
}

module.exports = {
  收工, 遗留工作区, 审阅区,
  configOf, isGitRepo, repoTop, workspaceRoot, worktreeList,
  prepare, integrate, checkpoint, dependencyTickets, publish, changedFiles, enforceWriteScope,
  正文写入范围,
};
