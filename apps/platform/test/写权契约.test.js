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
  assert.match(冻.挡.codex, /盲区原因：.*还没有额度读数/, '要说清是取数失败、读数过旧还是从未取到');
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


// ---------- 一条命令都没跑起来 ≠ 跑过了（2026-08-28 HW-9 实测）----------
//
// codex 的沙箱 helper 在这台机器上给每一次 exec 都判了拒绝：进程创建阶段就失败，
// PowerShell / cmd.exe / Git Bash 三种壳全中。agent 读不到文件、跑不了命令，
// 却照样输出了一段完整的判词，而 **CLI 退出码是 0**。
// 这一趟判官恰好说的是「验不了」所以没出事；说「不过」就是白白打回一张好单，
// 说「通过」就是放行一个没验过的东西——而平台此前看不出区别。
const 质检 = require('../lib/质检');
const 拒行 = (exe, 参 = '-Command Get-Location') => '[stderr] 2026-08-28T12:12:25.850793Z ERROR codex_core::tools::router: '
  + `error=exec_command failed for \`"${exe}" ${参}\`: CreateProcess { message: "Rejected(\\"Failed to create unified `
  + 'exec process: helper_unknown_error: apply deny-read ACLs\\")" }';
const 跑过 = (id, 码) => JSON.stringify({
  type: 'item.completed',
  item: { id, type: 'command_execution', command: 'git status --short', aggregated_output: 'M a.ts', exit_code: 码, status: 码 === 0 ? 'completed' : 'failed' },
});

t('起不来的命令要从 stderr 里读出来（那一路连 item 都没建）', () => {
  const 故 = 提.抽进程故障('{"type":"turn.started"}', [
    拒行('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
    拒行('C:\\WINDOWS\\system32\\cmd.exe', '/c cd'),
    拒行('C:\\Program Files\\Git\\usr\\bin\\bash.exe', '-c pwd'),
  ].join('\n'));
  assert.equal(故.起不来, 3);
  assert.equal(故.跑起来了, 0);
  assert.equal(故.全灭, true, '一条都没跑起来 = 这一趟的结论建立在零证据上');
  assert.match(故.死因, /helper_unknown_error: apply deny-read ACLs/);
  assert.doesNotMatch(故.死因, /[\\"]$/, 'Rust 那串转义的收尾不是死因的一部分');
  assert.match(提.进程故障说因(故), /退出码仍是 0/, '光看退出码会把它当成一次成功——这句必须说出来');
  assert.match(提.进程故障说因(故), /改沙箱档位没用/, '失败在进程创建，不在写权限');
});

t('JSONL 里 helper 失败的 command_execution 同样算起不来', () => {
  const 流 = [
    JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'powershell -NoProfile -Command Get-Location', aggregated_output: 'execution error: Io(Custom { kind: Other, error: "windows sandbox: orchestrator_helper_launch_failed: setup refresh failed to launch helper" })', exit_code: -1, status: 'failed' } }),
  ].join('\n');
  const 故 = 提.抽进程故障(流, '');
  assert.equal(故.全灭, true);
  assert.match(故.死因, /orchestrator_helper_launch_failed|windows sandbox/);
});

t('agent 自己引用这句错误**不算**故障（判词里天天写它）', () => {
  // HW-9 的判词第一条就原样引用了这段错误。拿 agent 说的话当判据，
  // 等于「谁提到这个错谁就算故障」——那会把一次正常的运行判成环境坏了。
  const 流 = JSON.stringify({
    type: 'item.completed',
    item: { id: 'i2', type: 'agent_message', text: '结论：验不了\n沙箱无法创建进程：Failed to create unified exec process: helper_unknown_error: apply deny-read ACLs' },
  });
  assert.equal(提.抽进程故障(流, ''), null, '只认 command_execution 与 codex router 的 stderr 行');
});

t('偶发一条起不来不作废——跑起来过就有证据', () => {
  const 故 = 提.抽进程故障([跑过('i1', 0), 跑过('i2', 1)].join('\n'), 拒行('C:\\WINDOWS\\system32\\cmd.exe', '/c cd'));
  assert.equal(故.全灭, false);
  assert.equal(故.跑起来了, 2, '退出码非 0 也算跑过——那是命令自己的事，不是环境的事');
  assert.match(提.进程故障说因(故), /⚠/);
  const 判 = { 结论: '通过', 下一步: '完成' };
  assert.equal(质检.零证据作废(判, 故, 'x'), 判, '一次瞬时失败不许推翻一句站得住的判词');
});

t('全灭时判词一律作废，归「验不了」而不是「不过」', () => {
  const 故 = 提.抽进程故障('', 拒行('C:\\WINDOWS\\system32\\cmd.exe', '/c cd'));
  for (const 原 of ['通过', '不过', '验不了']) {
    const 判 = 质检.零证据作废({ 结论: 原, 下一步: 原 === '通过' ? '完成' : '待投', 意见: { x: 1 } }, 故, '（说因）');
    assert.equal(判.结论, '验不了', '被评审方没有任何过错，打回去返工是冤枉它');
    assert.equal(判.下一步, null, '不流转：工单留在质检，要修的是机器');
    assert.equal(判.原结论, 原, '它当时说了什么要留着——说「通过」和说「验不了」，事后复盘分量不同');
    assert.ok(判.进程故障, '证据要跟着判词走');
  }
  assert.equal(质检.零证据作废({ 结论: '通过' }, null, null).结论, '通过', '没故障就别动判词');
});

t('执行侧同样不许把零证据的空跑记成功', () => {
  // 退出码 0 + 输出不空 → 加固.成败判定 的两条判据都过得去，
  // 于是一次什么都没跑起来的空跑会被记成功：工单往下走、路由还给这个池记一笔虚假战绩。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.match(源, /const 判 = \(进程故障 && 进程故障\.全灭\)\s*\n\s*\? \{ 成: false/,
    '成败判定 之前要先问一句「有没有一条命令真跑起来过」');
  assert.match(源, /const 进程故障 = 输出提取\.抽进程故障\(r\.输出, r\.错出, 调用\.outputFormat\);[\s\S]{0,700}?质检\.零证据作废\(判, 进程故障, 进程故障说\)/,
    '质检侧也要作废——判官说什么不作数，判据只看流水');
  assert.match(源, /呼叫\.急\(账本根, '判官跑不动（沙箱起不了子进程）'/,
    '不能走「可能缺依赖」那条话术：补依赖一百遍也修不好一台起不了子进程的机器');
});

t('自检要在开跑之前就看出 codex 沙箱坏了（零成本，不必先烧一趟真跑）', () => {
  // 断电那次把 deny_read_acl_state.json 变成了 22 个 \0（健康时它正好也是 22 字节）。
  // codex 从此拒绝创建任何子进程，而退出码仍是 0——零证据闸能接住，但那要先花掉一趟真跑。
  const os = require('os');
  const 真 = os.homedir;
  const 家 = fs.mkdtempSync(path.join(os.tmpdir(), 'codex家-'));
  const 沙 = path.join(家, '.codex', '.sandbox');
  fs.mkdirSync(沙, { recursive: true });
  try {
    os.homedir = () => 家;
    const 名 = 'codex 沙箱';
    const 查 = () => 自检.查(平台根, {}, { ok: false }).find((x) => x.能力.startsWith(名));
    assert.equal(查().就绪, true, '没有状态文件是正常的——codex 首次施加 ACL 时才建');

    fs.writeFileSync(path.join(沙, 'deny_read_acl_state.json'), Buffer.alloc(22));
    const 坏 = 查();
    assert.equal(坏.就绪, false);
    assert.match(坏.后果, /起不了任何子进程/);
    assert.match(坏.后果, /退出码仍是 0/, '最坏的那种：照常出话、照常 0，只是读不到任何文件');
    assert.match(坏.补法, /改沙箱档位.*没用|没用/, '失败在进程创建，不在写权限');

    fs.writeFileSync(path.join(沙, 'deny_read_acl_state.json'), '{ "principals": {} }');
    assert.equal(查().就绪, true, '重建之后就该恢复——自检只报事实，不替人删别人产品的状态文件');
  } finally {
    os.homedir = 真;
    fs.rmSync(家, { recursive: true, force: true });
  }
});

// ——— 「写不了」不许再被说成「缺依赖」（协-036）———
//
// 2026-08-28 HW-2 真跑：判官说「验不了」，平台给的话术是「多半是工单要声明 需要依赖」。
// 而实际病因是审阅区里写不动——包一个不缺。补依赖补一百遍也没用，
// 这句猜测唯一的作用是把人送去查错方向，再烧一轮真跑撞同一堵墙。
const 输出提取 = require('../lib/输出提取');

const 区 = 'D:\\Ticketflow\\apps\\platform\\workspaces\\project-f359de02\\审阅-HW-2';
// HW-2 那条的形状：命令跑起来了（有 command_execution），是跑到一半写不动。
const 写不动行 = JSON.stringify({
  type: 'item.completed',
  item: {
    type: 'command_execution',
    status: 'failed',
    exit_code: 1,
    command: "powershell.exe -NoProfile -Command 'npm.cmd --prefix tooling run unit'",
    aggregated_output: "failed to load config\nError: EPERM: operation not permitted, mkdir "
      + `'${区}\\tooling\\node_modules\\.vite-temp'\n    at async Object.mkdir`,
  },
});

t('HW-2 那条：EPERM 认得出来，现场路径也要留下', () => {
  const r = 输出提取.抽写权阻断(写不动行, 区);
  assert.ok(r, '这正是被说成「缺依赖」的那一条');
  assert.equal(r.次数, 1);
  assert.equal(r.区内, 1, '落在审阅区里 —— 这是「不是被评审方的问题」的判据');
  assert.match(r.例[0].路径, /\.vite-temp$/);
  assert.match(r.例[0].命令, /run unit/, '要说得出是哪条命令撞的墙');
});

t('判词里引用一句 EPERM 不算数——判据只看流水，不看它说了什么', () => {
  const 引用 = JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: `我看到 EPERM: operation not permitted, mkdir '${区}\\x'` },
  });
  assert.equal(输出提取.抽写权阻断(引用, 区), null, '谁提到这个错谁就算故障，那是把话当证据');
});

t('光出现 EPERM 三个字母、没有权限动作的行不算', () => {
  const 行 = JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', status: 'completed', command: 'rg EPERM', aggregated_output: 'EPERM 在 3 个文件里出现过' },
  });
  assert.equal(输出提取.抽写权阻断(行, 区), null);
});

t('说因必须把人指向权限，且**明说补依赖没用**', () => {
  const 说 = 输出提取.写权阻断说因(输出提取.抽写权阻断(写不动行, 区));
  assert.match(说, /写不了，不是缺依赖/);
  assert.match(说, /需要依赖.*(毫无作用|没用)/, '不点破这句，人还是会去补依赖');
  assert.match(说, /沙箱写权|判官模式/, '要给出下一步该看哪里，不能只下判词');
});

t('没有写权阻断时不许无中生有', () => {
  const 好 = JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', status: 'completed', command: 'npm test', aggregated_output: '175 passed' },
  });
  assert.equal(输出提取.抽写权阻断(好, 区), null);
  assert.equal(输出提取.写权阻断说因(null), null);
});

console.log('全部通过：' + passed + ' 项');
