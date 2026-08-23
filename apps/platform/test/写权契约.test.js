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

console.log('全部通过：' + passed + ' 项');
