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
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/完成单', a, 'master']);
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/在办单', b, 'master']);
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/没这单', c, 'master']);
    // 遗留判定按目录名认单号（worktree 的目录名就是单号），这里直接用临时目录名当单号
    const 全 = [
      { id: path.basename(a), state: '完成' },
      { id: path.basename(b), state: '待投' },
    ];
    const 出 = 工作区.遗留工作区(null, {}, { path: 仓 }, 全).待收;
    const 单 = 出.map((x) => x.单).sort();
    assert.ok(单.includes(path.basename(a)), '已完成的该报');
    assert.ok(单.includes(path.basename(c)), '工单库里没有的该报');
    assert.ok(!单.includes(path.basename(b)), '在办的单不该被当成遗留——收掉它等于把正在跑的活铲了');
    assert.ok(!出.some((x) => path.resolve(x.路径) === path.resolve(仓)), '主工作区不该出现在遗留里');
  } finally { 清(仓, a, b, c); }
});

t('**别人建的工作区不许列进待收**——那是另一个产品正在用的', () => {
  // 两个产品往同一个仓写是常态，分支前缀这套机制就是为此造的，而这里没用上：
  // 判定按 basename 去**我们的**工单库里找单，对面建的当然找不到，
  // 于是整整齐齐列成「查无此单，该收」。
  // 实测（海投王）：23 条 studio/project/0-* 全被列进待收，
  // 人点一下「收」就把对面正在用的工作区和分支删了。
  const 仓 = 建仓();
  const 我 = path.join(os.tmpdir(), 'wt-mine-' + process.pid);
  const 他 = path.join(os.tmpdir(), 'wt-theirs-' + process.pid);
  try {
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/M-1', 我, 'master']);
    git(仓, ['worktree', 'add', '-q', '-b', 'studio/project/0-7', 他, 'master']);
    const r = 工作区.遗留工作区(null, {}, { path: 仓 }, []);      // 工单库全空 = 两个都「查无此单」
    assert.deepEqual(r.待收.map((x) => x.单), [path.basename(我)], '只该收自己建的');
    assert.deepEqual(r.别人的.map((x) => x.分支), ['studio/project/0-7'],
      '别人的也要报出来——闷掉的话人看到「干净」会以为仓里真没东西');
    // 换个前缀，归属跟着换：这条前缀是可配的，判定不能写死 'platform'
    const 换 = 工作区.遗留工作区(null, { workspace: { branchPrefix: 'studio' } }, { path: 仓 }, []);
    assert.deepEqual(换.待收.map((x) => x.分支), ['studio/project/0-7']);
  } finally { 清(仓, 我, 他); }
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

t('依赖检查点兼容旧单：workspace.commit 缺失时回退到一致的顶层字段', () => {
  const 仓 = 建仓();
  try {
    git(仓, ['checkout', '-q', '-b', '上游']);
    fs.writeFileSync(path.join(仓, 'upstream.txt'), '上游产出\n');
    git(仓, ['add', '-A']);
    git(仓, ['commit', '-q', '--no-gpg-sign', '-m', '上游检查点']);
    const sha = git(仓, ['rev-parse', 'HEAD']);
    git(仓, ['checkout', '-q', 'master']);

    const r = 工作区.integrate({ path: 仓 }, [{
      id: 'OLD-1', fm: { 产出物类型: '代码', 检查点: sha, 发布提交: sha, workspace: {} },
    }]);
    assert.equal(r.merged.length, 1, JSON.stringify(r));
    assert.equal(r.merged[0].commit, sha);
    assert.equal(r.merged[0].检查点来源, '顶层 检查点');
    assert.equal(fs.readFileSync(path.join(仓, 'upstream.txt'), 'utf8').replace(/\r\n/g, '\n'), '上游产出\n');
  } finally { 清(仓); }
});

t('依赖检查点不猜：顶层两个字段不一致时把三个字段值说清', () => {
  const a = 'a'.repeat(40); const b = 'b'.repeat(40);
  const r = 工作区.依赖检查点({ id: 'BAD-1', fm: { 检查点: a, 发布提交: b, workspace: {} } });
  assert.equal(r.commit, null);
  assert.match(r.reason, /workspace\.commit 缺失/);
  assert.match(r.reason, new RegExp(`检查点 = ${a}`));
  assert.match(r.reason, new RegExp(`发布提交 = ${b}`));
  assert.match(r.reason, /不一致/);
  const 仓 = 建仓();
  try {
    assert.throws(() => 工作区.integrate({ path: 仓 }, [{
      id: 'BAD-1', fm: { 产出物类型: '代码', 检查点: a, 发布提交: b, workspace: {} },
    }]), /BAD-1.*workspace\.commit 缺失.*两者不一致/);
  } finally { 清(仓); }
});

// 造一个**真的**处在冲突中途的仓。冲突这件事假不出来：
// 「git add 之后 U 态就没了」正是这一组要盯的行为，模拟对象不会有这个性质。
function 建冲突仓() {
  const d = 建仓();
  git(d, ['checkout', '-q', '-b', '甲']);
  fs.writeFileSync(path.join(d, 'a.txt'), '甲的改法\n');
  fs.writeFileSync(path.join(d, '甲带来的.txt'), '新文件\n');
  git(d, ['add', '-A']);
  git(d, ['commit', '-q', '--no-gpg-sign', '-m', '甲']);
  git(d, ['checkout', '-q', 'master']);
  git(d, ['checkout', '-q', '-b', '乙']);
  fs.writeFileSync(path.join(d, 'a.txt'), '乙的改法\n');
  git(d, ['commit', '-q', '--no-gpg-sign', '-am', '乙']);
  try { git(d, ['merge', '--no-edit', '--no-gpg-sign', '甲']); } catch { /* 冲突就是要的 */ }
  return d;
}

t('中文文件名不许在写入范围上被误判成越界', () => {
  // Git 默认把非 ASCII 路径转义成 "\350\207\252..." 再输出，那串东西流进 changedFiles，
  // 拿去比 glob 就永远匹配不上——中文命名的文件一律被判越界，而报错里印的也是八进制，
  // 人对着看不出是哪个文件。中文文件名在这个仓里是常态。
  const 仓 = 建仓();
  try {
    fs.writeFileSync(path.join(仓, '说明文档.md'), 'x\n');
    assert.deepEqual(工作区.changedFiles(仓), ['说明文档.md'], 'git 的路径转义没解开');
    const 单 = { id: 'T-20', fm: { write_scope: ['*.md'] }, body: '' };
    assert.deepEqual(工作区.enforceWriteScope(单, 仓), ['*.md'], '中文名文件被 *.md 挡住了');
    // 报错里也要印出人认得的名字
    fs.writeFileSync(path.join(仓, '范围外的.txt'), 'x\n');
    assert.throws(() => 工作区.enforceWriteScope(单, 仓), /范围外的\.txt/);
  } finally { 清(仓); }
});

t('冲突标记不许进检查点——`git add` 洗掉了「未解决」，标记还在', () => {
  // Git 只在**索引**里记未解决，解冲突的习惯动作恰恰是编辑完顺手 add，
  // 于是 unresolved() 那道闸形同虚设：标记跟着检查点进用户的仓，
  // 再被 publish 的 --ff-only 送上 main。2026-08-14 真跑 integrator 之前验出来的。
  const 仓 = 建冲突仓();
  try {
    const 配 = { workspace: { mode: 'worktree' } };
    const w = { mode: 'worktree', isolated: true, path: 仓, branch: '乙' };
    git(仓, ['add', '-A']);
    assert.equal(git(仓, ['diff', '--name-only', '--diff-filter=U']), '',
      'add 之后 Git 已经不认为有未解决冲突了——这正是这道闸存在的理由');
    assert.throws(() => 工作区.checkpoint(配, w, { id: 'INT-1', fm: { role: 'integrator' }, body: '' }),
      /冲突标记/);
    assert.ok(!git(仓, ['log', '-1', '--format=%s']).includes('INT-1'), '拦下了就不许偷偷提交');
  } finally { 清(仓); }
});

t('确实要留冲突标记的，在单子上声明', () => {
  // 写冲突相关的测试样例是正当需求。没有逃生口的闸，人会去绕整道闸。
  const 仓 = 建冲突仓();
  try {
    git(仓, ['add', '-A']);
    const r = 工作区.checkpoint({ workspace: { mode: 'worktree' } },
      { mode: 'worktree', isolated: true, path: 仓, branch: '乙' },
      { id: 'INT-2', fm: { role: 'integrator', 允许冲突标记: true }, body: '' });
    assert.equal(r.committed, true, JSON.stringify(r));
  } finally { 清(仓); }
});

t('不误伤：单独一行 ======= 是 markdown 下划线，不是冲突', () => {
  // 误报一次，人下次就学会绕过这道闸了，那还不如没有。
  const 仓 = 建仓();
  try {
    fs.writeFileSync(path.join(仓, 'README.md'), '标题\n=======\n\n正文\n');
    fs.writeFileSync(path.join(仓, 'art.txt'), '<<<<<<< 这是画的框\n');
    assert.deepEqual(工作区.冲突残留(仓, 工作区.changedFiles(仓)), [], '两头都在才算冲突');
  } finally { 清(仓); }
});

t('integrator 声明了写入范围就得算数', () => {
  // 原先这里对 integrator 无条件 return []，人写在单子上的范围是装饰品。
  // 「写了没人看」这类失败最难查，因为每一处都显示成功。
  const 仓 = 建仓();
  try {
    fs.writeFileSync(path.join(仓, '范围外的.txt'), 'x\n');
    assert.throws(() => 工作区.enforceWriteScope({ id: 'INT-3', fm: { role: 'integrator', write_scope: ['docs/**'] }, body: '' }, 仓),
      /超出工单允许的写入范围/);
    // 但**没声明**时仍然放开：它要动哪些文件由冲突决定，事先列不出来。
    assert.deepEqual(工作区.enforceWriteScope({ id: 'INT-4', fm: { role: 'integrator' }, body: '' }, 仓), []);
  } finally { 清(仓); }
});

t('合并带进来的文件不算 integrator 越界', () => {
  // 冲突还没提交的时候，依赖改过的每个文件都摊在工作树上。
  // 拿它们去比写入范围会把人冤枉了——而且冤枉得莫名其妙：它根本没碰过那个文件。
  const 仓 = 建冲突仓();
  try {
    const 单 = { id: 'INT-5', fm: { role: 'integrator', write_scope: ['a.txt'] }, body: '' };
    assert.ok(fs.existsSync(path.join(仓, '甲带来的.txt')), '合并把这个文件带进了工作树');
    assert.deepEqual(工作区.enforceWriteScope(单, 仓), ['a.txt']);
    fs.writeFileSync(path.join(仓, '自己加的.txt'), 'x\n');
    assert.throws(() => 工作区.enforceWriteScope(单, 仓), /自己加的/, '它自己写的还是要管');
  } finally { 清(仓); }
});

t('agent 自己 commit 过的，不许当成「没干活」', () => {
  // 它看得见 git log 里的落款格式，自然会照着提交一把——这不是异常路径，是常态。
  // 原先检查点只看工作树脏不脏：干净就报「没有改动」，执行器据此判空转、退回待投，
  // 而分支上明明躺着一个提交，谁也不认它，重跑还会再干一遍。
  // 实测：首个 integrator 真跑的重放就是这样被判空转的。
  const 仓 = 建仓();
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-self-'));
  try {
    const 配 = { workspace: { mode: 'worktree', root: 根, branchPrefix: 'platform' } };
    const 单 = { id: 'T-30', fm: {}, body: '' };
    const w = 工作区.prepare(根, 配, 单, { name: 'p', path: 仓 });
    // agent 干活并自己提交，工作树因此是干净的
    fs.writeFileSync(path.join(w.path, 'n.txt'), 'x\n');
    git(w.path, ['add', '-A']);
    git(w.path, ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--no-gpg-sign', '-m', 'agent 自己提交的']);
    const r = 工作区.checkpoint(配, w, 单);
    assert.equal(r.自提交, true, '分支比起点前进了，就是确凿地干过活');
    assert.equal(r.changed, true, 'changed=false 会让执行器判成空转');
    assert.notEqual(r.commit, w.commit, '要认下 agent 那个提交当检查点');
    // 变更清单必须从 起点..HEAD 算——工作树是干净的，changedFiles 只会给空清单，
    // 而质检唯一的客观材料就是这份清单（喂空清单会让判官把成功的活判成不过）。
    assert.deepEqual(r.变更文件, ['n.txt']);
  } finally { 清(仓, 根); }
});

t('真没干活的，还是要如实报没干活', () => {
  // 上一条不能把「压根没动手」也一起放行——那是两回事，处置也不同。
  const 仓 = 建仓();
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-noop-'));
  try {
    const 配 = { workspace: { mode: 'worktree', root: 根 } };
    const 单 = { id: 'T-31', fm: {}, body: '' };
    const w = 工作区.prepare(根, 配, 单, { name: 'p', path: 仓 });
    const r = 工作区.checkpoint(配, w, 单);
    assert.equal(r.changed, false);
    assert.ok(!r.自提交);
  } finally { 清(仓, 根); }
});

t('自提交的改动同样要过写入范围和冲突标记两道闸', () => {
  // 「agent 自己提交」不该成为绕开检查的后门——那样只要 commit 一下就什么都能写。
  const 仓 = 建仓();
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-self2-'));
  try {
    const 配 = { workspace: { mode: 'worktree', root: 根 } };
    const 单 = { id: 'T-32', fm: { write_scope: ['docs/**'] }, body: '' };
    const w = 工作区.prepare(根, 配, 单, { name: 'p', path: 仓 });
    fs.writeFileSync(path.join(w.path, '范围外的.txt'), 'x\n');
    git(w.path, ['add', '-A']);
    git(w.path, ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '--no-gpg-sign', '-m', 'x']);
    assert.throws(() => 工作区.checkpoint(配, w, 单), /超出工单允许的写入范围/);
  } finally { 清(仓, 根); }
});

t('含有：判「进没进主线」只认 git 的祖先关系', () => {
  // 销「待集成」戳的判据。别拿 integrate 的集成报告代替——冲突被 integrator
  // 手工解掉时，那张依赖单落在 failedDependency 上，既不在 merged 也不在 already，
  // 而它正是最该销戳的那张（实测就这么漏过一次）。
  const 仓 = 建仓();
  try {
    const 老 = git(仓, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(仓, 'b.txt'), 'x\n');
    git(仓, ['add', '-A']);
    git(仓, ['commit', '-q', '--no-gpg-sign', '-m', '新']);
    const 新 = git(仓, ['rev-parse', 'HEAD']);
    assert.deepEqual(工作区.含有(仓, [老, 新]), [老, 新], '祖先和自身都算进了');
    // 不在这个仓里的 sha 不许算数，也不许抛
    assert.deepEqual(工作区.含有(仓, ['0'.repeat(40)]), []);
    assert.deepEqual(工作区.含有(仓, ['不是sha', '', null]), []);
    // 另起一条不相干的分支：没合进来就不算进主线
    git(仓, ['checkout', '-q', '-b', '旁支', 老]);
    fs.writeFileSync(path.join(仓, 'c.txt'), 'y\n');
    git(仓, ['add', '-A']);
    git(仓, ['commit', '-q', '--no-gpg-sign', '-m', '旁支']);
    const 旁 = git(仓, ['rev-parse', 'HEAD']);
    git(仓, ['checkout', '-q', 'master']);
    assert.deepEqual(工作区.含有(仓, [旁]), [], '没合进 HEAD 就不该算已进主线');
  } finally { 清(仓); }
});

t('带「待集成」的工单，工作区不许被当陈账收掉', () => {
  // 那个分支是下游 integrator 唯一的原料。收掉等于把要合的东西先扔了，
  // 而报出来的是一条「已完成，该收」——看上去一切正常。
  const 仓 = 建仓();
  // 目录名必须是工单号：遗留工作区按 basename 认单。
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-keep-')), 'K-1');
  try {
    git(仓, ['worktree', 'add', '-q', '-b', 'platform/p/K-1', wt, 'master']);
    const 单 = { id: 'K-1', state: '完成', fm: { 待集成: { 说: '基线已前进' } } };
    assert.deepEqual(工作区.遗留工作区(null, {}, { path: 仓 }, [单]).待收, [], '待集成的不许收');
    delete 单.fm.待集成;
    assert.equal(工作区.遗留工作区(null, {}, { path: 仓 }, [单]).待收.length, 1, '戳销了就该收了');
  } finally { 清(仓, wt); }
});

// ——— 沙箱写权预授（协-036）———
//
// 案源：2026-08-28 HW-2 真跑质检。判官已经是 workspace-write 了，仍然
//   EPERM: operation not permitted, mkdir '…\审阅-HW-2\tooling\node_modules\.vite-temp'
// 探针复现出来的机制是：codex 在 Windows 上靠 ACL 实现 workspace-write，
// **一棵此前没授过权的大目录树第一次进沙箱时授权落不上**（连 workdir 根都写不了），
// 第二次跑同一个目录就好了。审阅区每次都是新建的，所以判官每次都是「第一次」。
t('默认要预授一个沙箱组——不配置也得有，缺配置不能等于不授', () => {
  assert.equal(工作区.configOf({}).沙箱写权组, 'CodexSandboxUsers');
  assert.ok(工作区.configOf({}).沙箱写权超时毫秒 > 0);
});

t('空组名 = 显式关掉（换了别家沙箱的机器不该被强按一次 icacls）', () => {
  assert.equal(工作区.configOf({ 工作区: { 沙箱写权组: '' } }).沙箱写权组, '');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-acl-off-'));
  try { assert.equal(工作区.预授沙箱写权(d, '', 5000), null); } finally { 清(d); }
});

t('授不上要把因由带回来，不许抛——授权失败不该拦着判官静态核对', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-acl-'));
  try {
    // 这台机器上没有这个组（也不该有）。最常见的真实形态就是这个：
    // 没装过 codex、或换了别家沙箱，那时不该报成故障，只该把话留下。
    const r = 工作区.预授沙箱写权(d, 'NoSuchSandboxGroup-协036', 30000);
    if (process.platform !== 'win32') {
      assert.equal(r, null, 'ACL 是 Windows 的事，别的平台不该动手');
      return;
    }
    assert.equal(r.ok, false);
    assert.ok(r.因 && r.因.length, '「授不上」三个字没用，人要知道是哪一步、为什么');
  } finally { 清(d); }
});

if (process.platform === 'win32') {
  t('授得上时，返回里要留下耗时——这笔账从判官的真跑挪到了平台这一侧', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-acl-ok-'));
    try {
      // BUILTIN\Users（S-1-5-32-545）本机一定存在，且它本来就有读权——
      // 拿它验的是「这条 icacls 走得通」，不是去放宽谁的权限。
      const r = 工作区.预授沙箱写权(d, '*S-1-5-32-545', 60000);
      assert.equal(r.ok, true, r && r.因);
      assert.ok(typeof r.耗时毫秒 === 'number');
    } finally { 清(d); }
  });
}

console.log(`全部通过：${passed} 项`);
