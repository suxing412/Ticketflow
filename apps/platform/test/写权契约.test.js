// 写权契约测试（协-020）—— 「这张单要落盘，可它写不了」这条矛盾。
//
// 案源是一次真跑，不是想出来的：2026-08-23 HW-3（海投王，reviewer，产出物=文档）
// 跑了 7 分 21 秒、退出码 0、**一个文件都没改**，被空转闸接住退回待投。
// 它从派出去的那一刻就注定空转——受限模式对 claude-cli 就是 `--permission-mode plan`，
// plan 模式下写不了文件。平台是烧完额度之后才说这句话的。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const 派单 = require('../lib/派单');
const 自检 = require('../lib/自检');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('写权契约测试');

const 平台根 = path.resolve(__dirname, '..');
const 单 = (fm) => ({ id: 'T-1', fm: { title: 'T-1', ...fm } });
const 受限 = (adapter) => 派单.权限参数({}, 'reviewer', adapter);
const 放开 = () => 派单.权限参数({ 执行: { 权限: { 放开: ['backend'] } } }, 'backend', 'claude-cli');

t('前提：白名单空时 claude 拿的是 plan 模式（这就是写不了的原因）', () => {
  const 权 = 受限('claude-cli');
  assert.equal(权.模式, '受限');
  assert.deepEqual(权.参数, ['--permission-mode', 'plan']);
  assert.equal(派单.受限即只读(权), true);
});

t('codex 的受限是只读沙箱，同样写不了', () => {
  assert.equal(派单.受限即只读(受限('codex-cli')), true);
});

t('HW-3 那张单的形状：受限 + 产出物类型「文档」→ 判为矛盾', () => {
  const r = 派单.写权矛盾(单({ role: 'reviewer', 产出物类型: '文档' }), 受限('claude-cli'));
  assert.ok(r, '这正是白烧了 7 分 21 秒的那一张');
  assert.match(r.因, /一个文件都写不了/);
  assert.equal(r.出路.length, 2, '拦下来必须给出路——只说「矛盾」等于把问题原样丢回去');
  assert.match(r.出路.join(''), /执行\.权限\.放开/, '出路之一要指到那个开关');
});

t('声明了 write_scope 同样算「要落盘」（类型没写也拦得住）', () => {
  assert.ok(派单.写权矛盾(单({ role: 'backend', write_scope: ['src/**'] }), 受限('claude-cli')));
  assert.ok(派单.写权矛盾(单({ role: 'backend', 写入范围: 'src/a.js' }), 受限('claude-cli')));
});

t('不落盘的单（问答/判定）受限没问题，不许误拦', () => {
  assert.equal(派单.写权矛盾(单({ role: 'reviewer' }), 受限('claude-cli')), null);
  assert.equal(派单.写权矛盾(单({ role: 'reviewer', 产出物类型: '结论' }), 受限('claude-cli')), null);
  assert.equal(派单.写权矛盾(单({ role: 'reviewer', write_scope: [] }), 受限('claude-cli')), null);
});

t('角色在放开白名单里就不是矛盾（它真的能写）', () => {
  assert.equal(派单.写权矛盾(单({ role: 'backend', 产出物类型: '代码' }), 放开()), null);
});

t('受限参数被自定过、不是只读那一套时，不替它下结论', () => {
  // 有人把 受限参数 配成别的东西（比如只限模型不限写），平台没资格断言它写不了。
  // 宁可不拦：误拦会让人转头把整道闸关掉，而一道会误报的闸最后一定被绕过去。
  const 权 = 派单.权限参数({ 执行: { 权限: { 受限参数: { 'claude-cli': ['--model', 'sonnet'] } } } }, 'backend', 'claude-cli');
  assert.equal(权.模式, '受限');
  assert.equal(派单.写权矛盾(单({ role: 'backend', 产出物类型: '代码' }), 权), null);
});

t('未知适配器（受限形同虚设）不算矛盾', () => {
  assert.equal(派单.写权矛盾(单({ role: 'backend', 产出物类型: '代码' }), 受限('某新厂-cli')), null);
});

t('执行器在**拉起进程之前**拒派，不是跑完再说', () => {
  // 这条守的是位置。判据零成本（只读配置与 frontmatter），放在 spawn 之后
  // 就等于「先花七分钟再告诉你不行」——那正是 HW-3 那次的实况。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const 拒 = 源.indexOf('if (写权) {');
  const 许可 = 源.indexOf('const 许 = 真跑许可(派.选中, { 同意计费', 拒);
  assert.ok(拒 > 0, '执行器要接上这道闸');
  assert.ok(许可 > 拒, '拒派要排在真跑许可之前');
  const 干跑返回 = 源.indexOf("干跑：全链路走完但未拉起任何进程");
  assert.ok(干跑返回 > 0 && 干跑返回 < 拒,
    '干跑要照旧放行——干跑的价值正是「零成本地看见这条路走不通」，在那儿拦住等于把诊断也关掉');
});

t('自检把「写权白名单空」的后果说出来（不是等到跑完才发现）', () => {
  const 条 = 自检.查(平台根, { 执行: {} }, { ok: true, 根: 'X' });
  const 写权 = 条.find((x) => String(x.能力).startsWith('写权'));
  assert.ok(写权, '自检要有这一条');
  assert.equal(写权.就绪, false);
  assert.match(写权.后果, /空转/);
  assert.match(写权.补法, /授予写权限|这是授予写权限/, '要说清那是给写权限，不是随手打开的开关');
  const 有名单 = 自检.查(平台根, { 执行: { 权限: { 放开: ['backend'] } } }, { ok: true, 根: 'X' })
    .find((x) => String(x.能力).startsWith('写权'));
  assert.equal(有名单.就绪, true);
});

t('自检的总结论不因这一条变红（只跑评审的机器，白名单空是对的）', () => {
  // 「不就绪」在这里是**后果**不是错误。把它算进致命项，会让一台故意只跑
  // 评审/问答的机器永远红着——红久了就没人看了。
  const 结 = 自检.结论(自检.查(平台根, {
    执行: { 允许真跑: true }, 预算: { 池: { claude: { 日token: 1 } } },
    workspace: { 允许写: true }, 项目: { 注册: { X: {} } },
  }, { ok: true, 根: 'X' }));
  assert.equal(结.级别, '全链路就绪');
});

// ---------- 只读产出：零改动是**正确结果**，不是空转 ----------
t('判定类的单，交付物本来就不是文件', () => {
  assert.equal(派单.只读产出(单({ 产出物类型: '评审意见' })), true);
  assert.equal(派单.只读产出(单({ 产出物类型: '结论' })), true);
  assert.equal(派单.只读产出(单({ 产出物类型: '代码' })), false);
  assert.equal(派单.只读产出(单({ 产出物类型: '文档' })), false, '文档要落盘，那是 integrator 的活');
});

t('声明了 write_scope 就是打算写——一票否决（不许把失败洗成成功）', () => {
  // 宁可漏判成普通单（顶多退回待投让人看一眼），也不能把一个真该写代码却什么都没写的单
  // 说成「它本来就不用写」。
  assert.equal(派单.只读产出(单({ 产出物类型: '评审意见', write_scope: ['src/**'] })), false);
});

t('产出物类型没写时不猜（角色是 reviewer 也不猜）', () => {
  assert.equal(派单.只读产出(单({ role: 'reviewer' })), false);
});

t('执行器把「只读单零改动」判成完成，而不是退回待投', () => {
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const 分叉 = 源.indexOf('if (派单.只读产出(t))');
  assert.ok(分叉 > 0, '空转分支里要先分出只读单这一类');
  const 段 = 源.slice(分叉, 分叉 + 3000);
  assert.match(段, /'在途', '完成'/, '只读单零改动应当流转到完成');
  assert.match(段, /报告落于/, '报告必须落进工单——只读单的全部产出就是那段文字');
  assert.match(段, /免检原因/, '不送质检要留下明确的免检原因，不能假装它被自动验过');
  assert.ok(!/'在途', '质检'/.test(段),
    '别送质检：判官取材靠 fm.变更文件，只读单没有改动可给它看，送过去只会被判不过');
});

t('reviewer 子任务不再被造成「产出物类型: 文档」', () => {
  // 源头改对了：plan.js 一边禁止 reviewer 声明 writeScope，一边给它标一份要落盘的产出，
  // 那是平台自己制造矛盾。reviewer 的产出是判定，类型跟着改成不落盘的。
  const 源 = fs.readFileSync(path.join(平台根, 'lib', 'orchestration', 'plan.js'), 'utf8');
  assert.ok(!/reviewer' \? '文档'/.test(源), 'plan.js 不该再给 reviewer 标「文档」');
  assert.match(源, /reviewer' \? '评审意见'/);
  const 类型 = (源.match(/reviewer' \? '([^']+)'/) || [])[1];
  assert.equal(派单.只读产出(单({ 产出物类型: 类型 })), true,
    'plan.js 造出来的 reviewer 单，必须被只读产出认得——否则它照样永远做不完');
});



// ---------- 订阅池的 token 上限：警戒线，不是刹车（协-022）----------
// 案源同样是实测：HW-4 派不出去，因为 codex 被冻结——「日用量 1439944 token ≥ 上限 200000」。
// 而 codex 是订阅池，它的周窗口当时只用了 19%。拦住它的是一个跟真实风险无关的数字，
// 而那个数字的来历是 预算.local.json 自己的注释：「配上限只是为了过第三道闸」。
const 假公用件 = (超的池) => ({
  载入: () => ({
    冻结池: () => Object.fromEntries(超的池.map((池) => [池, { locked: true, reason: `${池} 池预算已用尽：日用量 999 token ≥ 上限 1`, 预算: true }])),
    并入: (g, f) => ({ ...(g || {}), ...f }),
    账本: () => path.join(平台根, '不存在的账本.jsonl'),
  }),
});
const 订阅配置 = () => ({
  providers: { codex: { adapter: 'codex-cli' }, 'claude-key': { adapter: 'claude-cli' } },
  计费: { codex: { 模式: '订阅' }, 'claude-key': { 模式: 'api' } },
  quota: { gatePercent: 80, costBufferPercent: 30 },
});

t('订阅池：额度闸有读数时，token 上限只警戒不冻结', () => {
  const 临 = fs.mkdtempSync(path.join(require('os').tmpdir(), '协022-'));
  fs.mkdirSync(path.join(临, 'journal'), { recursive: true });
  fs.writeFileSync(path.join(临, 'journal', '额度快照.json'), JSON.stringify({
    更新于: new Date().toISOString(),
    池: { codex: { 形态: 'codex', 取于: new Date().toISOString(),
      rl: { primary: { usedPercent: 19, windowDurationMins: 10080, resetsAt: new Date(Date.now() + 864e5).toISOString() } } } },
  }));
  const 冻 = 派单.冻结情况(假公用件(['codex']), 订阅配置(), 临);
  assert.ok(!冻.挡.codex, '周窗口才 19%，不该被一个跟风险无关的 token 数拦住');
  assert.equal((冻.警戒 || []).length, 1, '不冻结不等于不吭声——超了要进警戒');
  assert.match(冻.警戒[0].说, /订阅池不按 token 刹车/);
  fs.rmSync(临, { recursive: true, force: true });
});

t('订阅池：额度闸是盲区时，token 上限照旧兜底冻结（没读数时宁可误刹）', () => {
  const 临 = fs.mkdtempSync(path.join(require('os').tmpdir(), '协022-'));
  const 冻 = 派单.冻结情况(假公用件(['codex']), 订阅配置(), 临);   // 没有快照 = 盲区
  assert.ok(冻.挡.codex, '读不到窗口时，唯一还剩的刹车就是它，不能一起松掉');
  assert.match(冻.挡.codex, /兜底冻结/, '要说清这是兜底，不然人会以为 token 上限一直是刹车');
  assert.equal((冻.警戒 || []).length, 0);
  fs.rmSync(临, { recursive: true, force: true });
});

t('api 池不受影响：token 上限守的正是钱包，那是刹车', () => {
  const 临 = fs.mkdtempSync(path.join(require('os').tmpdir(), '协022-'));
  const 冻 = 派单.冻结情况(假公用件(['claude-key']), 订阅配置(), 临);
  assert.ok(冻.挡['claude-key'], 'api 池按 token 计费，超了就是超了');
  assert.ok(!/兜底/.test(冻.挡['claude-key']), 'api 池的冻结不是兜底，别给它贴订阅池的说辞');
  fs.rmSync(临, { recursive: true, force: true });
});



// ---------- 只读依赖没有检查点是正常的（协-023）----------
t('只读依赖不算「缺检查点」，下游不该等一个按设计不会出现的东西', () => {
  // 案源：HW-4 真跑秒失败——「建隔离工作区失败：依赖缺少 Git 检查点：HW-3」。
  // HW-3 是评审单，跑完零改动、报告落在工单里，它**永远不会有**检查点。
  // 而这道拦截原本是对的：协-016 治的正是「检查点 sha 不落盘导致 DAG 静默断链」。
  // 所以不能把它整个拆掉，只能把两种「没有」分开。
  const 源 = fs.readFileSync(path.join(平台根, 'lib', 'workspace', 'worktree.js'), 'utf8');
  assert.match(源, /require\('\.\.\/产出'\)/, '判据要与派单共用一份，别在这儿再抄一遍');
  assert.match(源, /const 真缺 = result\.integration\.skipped\.filter/, '只对真该有却没有的顶错误');
  assert.match(源, /只读: 只读|只读,/, 'skipped 里要标出哪条是只读——不是静默跳过，看得见才叫留痕');
});

t('判据只有一份：派单与工作区问的是同一个函数', () => {
  const 产出 = require('../lib/产出');
  const 派 = require('../lib/派单');
  assert.equal(派.只读产出, 产出.只读产出, '两处各写一遍就会漏改一遍（公用件解析那次的教训）');
  assert.equal(产出.只读产出({ fm: { 产出物类型: '评审意见' } }), true);
  assert.equal(产出.要落盘({ fm: { 产出物类型: '文档' } }), true);
  assert.equal(产出.要落盘({ fm: { write_scope: ['a'] } }), true, 'write_scope 是证据，比类型更硬');
});



// ---------- 失败要有归宿、失败原因要有内容（协-024）----------
// 案源：HW-4 连挂两次（codex 22 分钟、claude 6 分钟），回执里只有一句「退出码 1」，
// 工单原地留在「在途」等巡检误报「执行器可能已挂」。而真相就写在输出的最后一行。
const 提 = require('../lib/输出提取');
const 收尾行 = (o) => JSON.stringify({ type: 'result', ...o });

t('CLI 自报的收尾事件要被读出来（「退出码 1」把三件事说成了一件）', () => {
  const 收 = 提.抽收尾('噪声\n' + 收尾行({ is_error: true, subtype: 'success', stop_reason: 'stop_sequence', num_turns: 20, duration_api_ms: 360633, total_cost_usd: 0.718 }), 'claude-stream-json');
  assert.equal(收.是错, true);
  assert.equal(收.回合数, 20);
  assert.equal(收.停因, 'stop_sequence');
  assert.match(提.收尾说因(收), /回合数上限/, '截断、崩溃、限流三者处置南辕北辙，不能都叫「退出码 1」');
});

// 认证失败长得跟「回合数用光」一模一样：都是 is_error + stop_sequence + 有 num_turns。
// 只看后两个就会教人去调大回合上限——而回合上限调到 800 也还是四秒挂掉。
t('API 错的三个字段优先级高于回合数（认证失败不许说成「回合数上限」）', () => {
  const 收 = 提.抽收尾(收尾行({
    is_error: true, stop_reason: 'stop_sequence', num_turns: 1, duration_api_ms: 4000,
    is_api_error_message: true, error: 'authentication_failed', terminal_reason: 'api_error',
  }), 'claude-stream-json');
  assert.equal(收.是api错, true);
  assert.equal(收.错名, 'authentication_failed');
  assert.equal(收.终因, 'api_error');
  const 因 = 提.收尾说因(收);
  assert.match(因, /认证失败/);
  assert.doesNotMatch(因, /回合数上限|拆小/, '照这话去做，回合上限调到 800 也还是四秒挂掉');
});

t('限流与其它 API 错各归各的，别都塞进「活干砸了」', () => {
  const 说 = (o) => 提.收尾说因(提.抽收尾(收尾行({ is_error: true, stop_reason: 'stop_sequence', num_turns: 1, ...o }), 'claude-stream-json'));
  assert.match(说({ terminal_reason: 'api_error', api_error_status: 429 }), /限流|额度/);
  // error 有时是 {type,message} 不是字符串——两种形状都要认出来。
  assert.match(说({ terminal_reason: 'api_error', error: { type: 'overloaded_error', message: 'x' } }), /限流|额度/);
  assert.match(说({ terminal_reason: 'api_error', error: 'invalid_request_error' }), /API 出错收场/);
});

t('num_turns=1 不叫「回合数用光」——它连第二轮都没开始', () => {
  const 因 = 提.收尾说因(提.抽收尾(收尾行({
    is_error: true, stop_reason: 'stop_sequence', num_turns: 1, duration_api_ms: 4000,
  }), 'claude-stream-json'));
  assert.doesNotMatch(因, /回合数上限/, '开头就死了，硬套上限会把人送到错误的方向上去');
  assert.match(因, /1 轮/);
});

t('翻不出来就不猜——猜错原因比不说原因更坏', () => {
  assert.equal(提.抽收尾('随便什么东西', 'claude-stream-json'), null);
  assert.equal(提.抽收尾(收尾行({ is_error: true }), 'codex-jsonl'), null, '只认已知形状，不替别的厂商猜');
  assert.equal(提.收尾说因(提.抽收尾(收尾行({ is_error: false, num_turns: 3 }), 'claude-stream-json')), null, '没出错就没有失败原因');
});

t('执行失败有归宿：退回待投 + 证据进工单 + 进呼叫信箱，且不自动重派', () => {
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('if (!判.成) {');
  assert.ok(i > 0, '失败分支必须存在——此前它整个是空的，工单就留在「在途」等巡检归错因');
  const 段 = 源.slice(i, i + 2200);
  assert.match(段, /'在途', '待投'/, '在途的意思是「AI 正在干」，它已经不在干了');
  assert.match(段, /fm\.执行失败 = \{/, '证据要落进工单，不能只在那一次的 HTTP 回执里');
  assert.match(段, /尾巴/, '光一句「退出码 1」等于没说');
  assert.match(段, /呼叫\.急/, '无人值守时信箱是唯一有人会看见的地方');
  assert.match(段, /不会自动重派/, '重派要花额度，那是人的决定');
});

t('回合上限可配，且缺省不注入（与协-024 之前逐字节相同）', () => {
  const a = require('../../../packages/providers/claude-cli').create({});
  assert.ok(!a.buildInvocation({}).args.includes('--max-turns'), '缺省不注入——公用件的既有行为不许被顺手改掉');
  const 带 = a.buildInvocation({ maxTurns: 60 }).args;
  assert.equal(带[带.indexOf('--max-turns') + 1], '60');
  assert.ok(!a.buildInvocation({ maxTurns: 0 }).args.includes('--max-turns'), '0 与非法值一律当没配');
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.match(源, /fm\.回合上限 \|\| t\.fm\.maxTurns \|\| \(配置\.执行 && 配置\.执行\.回合上限\)/,
    '工单能自己声明（大单要多几轮），否则走配置');
});

t('跑通了就把上一趟的失败戳摘掉（陈旧告警看几次就没人信）', () => {
  // HW-4 实测：前两轮被回合数上限截断留下 执行失败，第三轮跑通落了检查点，
  // 而那个戳还挂在单上——一张既有成功检查点又标着「执行失败」的单，谁看都得愣一下。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('const 目标 = 检.要');
  assert.ok(i > 0);
  const 段 = 源.slice(i, i + 1600);
  assert.match(段, /delete fm.执行失败/, '成功流转时要摘掉失败戳');
  assert.match(段, /delete fm.空转/, '空转戳同理');
});



// ---------- 隔离工作区里跑不动任何命令（协-026）----------
// 案源：HW-4 第二次被判不过，理由不是活干错了，是三条必验命令一条都跑不起来——
// worktree 是一次干净 checkout，从来没人在里面装过依赖。
const 工作区件 = require('../lib/workspace/worktree');
const os = require('os');

t('默认不装依赖（大多数单不需要，npm ci 在 monorepo 上动辄几分钟）', () => {
  assert.equal(工作区件.装依赖(os.tmpdir(), { fm: {} }), null);
  assert.equal(工作区件.装依赖(os.tmpdir(), { fm: { 需要依赖: false } }), null);
});

t('工单声明才装，认 true / 字符串 / 数组三种写法', () => {
  assert.deepEqual(工作区件.依赖目录表({ fm: { 需要依赖: true } }), ['.']);
  assert.deepEqual(工作区件.依赖目录表({ fm: { 需要依赖: 'tooling' } }), ['tooling']);
  assert.deepEqual(工作区件.依赖目录表({ fm: { 需要依赖: ['tooling', 'services/api'] } }), ['tooling', 'services/api']);
  assert.deepEqual(工作区件.依赖目录表({ fm: { needDeps: true } }), ['.'], 'ASCII 别名同样认');
});

t('目录不许逃出工作区（frontmatter 是 agent 改得动的）', () => {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), '协026-'));
  assert.throws(() => 工作区件.装依赖(临, { fm: { 需要依赖: ['../别的仓'] } }), /逃出了工作区/);
  fs.rmSync(临, { recursive: true, force: true });
});

t('指的目录里没有 package.json 就当场抛（别等跑完才发现装了个寂寞）', () => {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), '协026-'));
  assert.throws(() => 工作区件.装依赖(临, { fm: { 需要依赖: true } }), /没有 package\.json/);
  fs.rmSync(临, { recursive: true, force: true });
});

t('已经装过就不重装（返工会复用同一个工作区）', () => {
  const 临 = fs.mkdtempSync(path.join(os.tmpdir(), '协026-'));
  fs.writeFileSync(path.join(临, 'package.json'), '{"name":"x"}');
  fs.mkdirSync(path.join(临, 'node_modules'));
  const 记 = 工作区件.装依赖(临, { fm: { 需要依赖: true } });
  assert.equal(记.length, 1);
  assert.equal(记[0].跳过, '已装过', '每轮重装几分钟纯属浪费');
  assert.equal(记[0].耗时毫秒, 0);
  fs.rmSync(临, { recursive: true, force: true });
});

t('装依赖排在依赖集成**之后**（上游可能带进 lockfile 改动）', () => {
  const 源 = fs.readFileSync(path.join(平台根, 'lib', 'workspace', 'worktree.js'), 'utf8');
  const 集成 = 源.indexOf('result.integration = integrate(');
  const 装 = 源.indexOf('const 装 = 装依赖(');
  assert.ok(集成 > 0 && 装 > 集成, '先装再合的话，装的是旧的那一份');
});

t('装不上就抛——抛在 prepare 里零成本，一个 token 都没花', () => {
  // 这条守的是**位置**：prepare 发生在拉起 agent 之前。若改成「记下失败继续跑」，
  // 就又回到「花几分钟跑出一个注定验不了的结果」，正是本单要治的病。
  const 源 = fs.readFileSync(path.join(平台根, 'lib', 'workspace', 'worktree.js'), 'utf8');
  const i = 源.indexOf('function 装依赖(');
  const 段 = 源.slice(i, i + 2000);
  assert.match(段, /throw new Error\(`装依赖失败/);
  assert.match(段, /slice\(-8\)/, '要带 npm 的尾巴，不然又是一句「装失败了」等于没说');
});

console.log('全部通过：' + passed + ' 项');
