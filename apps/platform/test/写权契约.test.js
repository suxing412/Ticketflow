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

console.log('全部通过：' + passed + ' 项');
