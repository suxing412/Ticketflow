// propcheck.test.js — 传播核查（H78 八站机判）接线测试
// 分工同 budget-接线：本包自己的形状在 packages/propcheck，这里盯**判据不许说谎**——
// 一个把「传播完全」判错的核查器，比没有核查器更坏（它会给漏传播发通行证）。
// 公用件走仓根 packages/（一仓拓扑）：apps/studio/test → 上三级到仓根
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../../../packages/propcheck/propcheck.js');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('propcheck 传播核查测试');

// 造一个微缩「全库」：三站，各一份文件
function 造库(内容表) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
  for (const [rel, text] of Object.entries(内容表)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
  return root;
}
const 站 = (root, ...names) => names.map((n) => ({ 站: n, 位置: [path.join(root, n)] }));

t('全库零活体命中：关键词哪一站都没有 → 判据通过', () => {
  const root = 造库({ '正本/a.md': '现行制度：派发制', '副本/b.md': '现行制度：派发制' });
  const r = P.扫描('拉取制', { 站: 站(root, '正本', '副本') });
  assert.equal(r.活体总数, 0);
  assert.equal(r.全库零活体命中, true);
  assert.equal(P.判据(r, '零命中').通过, true);
});

t('副本漏改就是不通过：正本干净、副本还留着旧词 → 判据打红并点名那一站', () => {
  const root = 造库({ '正本/a.md': '现行制度：派发制', '副本/b.md': '按拉取制领单' });
  const r = P.扫描('拉取制', { 站: 站(root, '正本', '副本') });
  assert.equal(r.全库零活体命中, false);
  assert.equal(r.活体总数, 1);
  const 判 = P.判据(r, '零命中');
  assert.equal(判.通过, false);
  assert.ok(判.说明.includes('副本'), '判词必须点名漏的是哪一站——这正是三次复发里每次缺的那句话');
});

t('退役标注不算活体：带删除线/已退役的行是留痕，不是留活', () => {
  const root = 造库({
    '正本/a.md': '- ~~拉取制~~（H49 退役）',
    '副本/b.md': '拉取制 已退役，保留此行仅为溯源',
  });
  const r = P.扫描('拉取制', { 站: 站(root, '正本', '副本') });
  assert.equal(r.活体总数, 0);
  assert.equal(r.标注总数, 2);
  assert.equal(P.判据(r, '零命中').通过, true);
});

t('--宽 档下退役标注照样算命中（要看原始面貌时不许被过滤蒙住）', () => {
  const root = 造库({ '正本/a.md': '~~拉取制~~ 已退役' });
  const r = P.扫描('拉取制', { 站: 站(root, '正本'), 宽: true });
  assert.equal(r.活体总数, 1);
});

t('全站命中判据：新决议号漏誊一站就打红', () => {
  const root = 造库({ '正本/a.md': 'H104 立宪', '副本/b.md': '（还没誊）' });
  const r = P.扫描('H104', { 站: 站(root, '正本', '副本') });
  assert.equal(P.判据(r, '全站命中').通过, false);
  assert.deepEqual(r.零命中站, ['副本']);
  fs.writeFileSync(path.join(root, '副本', 'b.md'), 'H104 已誊', 'utf8');
  assert.equal(P.判据(P.扫描('H104', { 站: 站(root, '正本', '副本') }), '全站命中').通过, true);
});

t('位置不存在的站不冒充零命中（路径写错不许伪造出满分答卷）', () => {
  const root = 造库({ '正本/a.md': 'H104' });
  const r = P.扫描('H104', { 站: [...站(root, '正本'), { 站: '幽灵站', 位置: [path.join(root, '压根没有')] }] });
  assert.deepEqual(r.缺站, ['幽灵站']);
  assert.deepEqual(r.零命中站, [], '不存在的站既不算命中也不算零命中——它是「没查到」，不是「查过了没有」');
  assert.equal(P.判据(r, '全站命中').通过, true);
});

t('命中带文件与行号：报告要能直接跳到那一行去改', () => {
  const root = 造库({ '副本/b.md': '第一行\n第二行 拉取制\n第三行' });
  const h = P.扫描('拉取制', { 站: 站(root, '副本') }).站[0].命中[0];
  assert.equal(h.line, 2);
  assert.ok(h.file.endsWith('b.md'));
  assert.ok(h.text.includes('拉取制'));
  assert.equal(h.活体, true);
});

t('多关键词取并集（一次核查一族措辞，别指望人记得挨个跑）', () => {
  const root = 造库({ '副本/b.md': 'billFee 与 fable 各一处' });
  const r = P.扫描(['billFee', 'fable'], { 站: 站(root, '副本') });
  assert.equal(r.活体总数, 2);
});

t('二进制/超范围扩展名不扫；node_modules 不进（否则依赖里的同名词能把判据淹了）', () => {
  const root = 造库({
    '副本/b.png': '拉取制',
    '副本/node_modules/x/y.md': '拉取制',
    '副本/c.md': '干净',
  });
  assert.equal(P.扫描('拉取制', { 站: 站(root, '副本') }).活体总数, 0);
});

t('空关键词直接拒（宁可报错，不可跑出一张「全库零命中」的假绿）', () => {
  assert.throws(() => P.扫描('', { 站: [] }), /至少给一个关键词/);
  assert.throws(() => P.扫描([], { 站: [] }), /至少给一个关键词/);
});

t('未知判据不当成通过', () => {
  const r = P.扫描('x', { 站: [] });
  assert.equal(P.判据(r, '差不多得了').通过, false);
});

t('默认站表就是 H78 八站，站名与那张表对得上', () => {
  const 表 = P.站表();
  // 不写死总数（2026-08-21）：站表从 8 拆成 9——白夜馆原挂在「8 汇报模板」下，
  // 而它是**史料**（历史班次报告里写过「决策台」是史实），模板却是现役，两者性质相反不能同站。
  // 写死的数字每拆一次就腐一次；改为断言 H78 那八站一个不少，拆出来的另计。
  assert.ok(表.length >= 8, '至少 H78 八站，实测 ' + 表.length);
  for (const n of ['1 决议史', '2 协议库正本', '3 岗位协议', '4 提示词接线', '5 技能舰队', '6 机制代码/config', '7 跨会话记忆', '8 汇报模板']) {
    assert.ok(表.some((s) => s.站 === n), `八站缺 ${n}`);
  }
  assert.ok(表.every((s) => s.位置.length), '每站都得有落点，空站等于漏站');
});

t('CLI：参数解析认得判据/明细/站覆盖，未知选项报错不硬跑', () => {
  const o = P.解析参数(['拉取制', '--要求', '零命中', '--明细', '3', '--站', '外站=/tmp/x']);
  assert.deepEqual(o.关键词, ['拉取制']);
  assert.equal(o.要求, '零命中');
  assert.equal(o.明细, 3);
  assert.deepEqual(o.站覆盖, ['外站=/tmp/x']);
  assert.equal(P.main(['--没这个选项']), 2);
  assert.equal(P.main([]), 2, '不给关键词要给用法，不许默默扫全库');
});

t('渲染出的报告带得走：站名、活体数、判据结论都在文本里', () => {
  const root = 造库({ '副本/b.md': '拉取制' });
  const r = P.扫描('拉取制', { 站: 站(root, '副本') });
  const 文 = P.渲染(r, P.判据(r, '零命中'), 8);
  assert.ok(文.includes('副本'));
  assert.ok(文.includes('全库零活体命中：否'));
  // 不依赖判据的具体措辞（它随分型演进改过一次名）：只认「零活体命中 → 不通过」这个语义
  assert.ok(文.includes('零活体命中') && 文.includes('不通过'),
    '判据不通过时要在报告里说出来（判据名随分型演进改过，故只认这两个语义片段）：' + 文.slice(0, 200));
});

t('站分型：史料站整站不参与「零命中」（永远红的判据等于没有判据）', () => {
  // 案源（2026-08-21 体检）：「拉取制」全库 38 条命中，逐条查完**只有一条是真漂移**。
  // 其余：决议史/白夜馆＝史实（H49 宣布拉取制退役那句话本身就含这三个字）、
  // 协议库＝改判记录、代码＝保留回退分支的正当注释（「拉取制这条路同样得堵」）。
  // 判据照红 → 人只会学会绕过它。故按**站的性质**豁免，而不是无限扩标记词
  // （扩到最后就是为了让判据变绿而放宽判据，那正是本次体检要治的病）。
  // 2026-08-22 #44 收窄：代码站**不再整站豁免**——豁免降到「命中落在注释里」那一层，
  // 由 扫一站() 判成非活体；到 判据() 这里代码站与现役站一视同仁。
  const 站 = [
    { 站: 'X 史料', 位置: [], 说明: '', 史料: true },
    { 站: 'Y 代码', 位置: [], 说明: '', 代码: true },
    { 站: 'Z 现役', 位置: [], 说明: '' },
  ];
  const 造 = (活体们) => ({ 站: 站.map((s, i) => ({ ...s, 活体数: 活体们[i], 标注数: 0, 注释数: 0, 命中: [], 存在: true })),
    活体总数: 活体们.reduce((a, b) => a + b, 0), 全库零活体命中: 活体们.every((n) => !n) });

  assert.equal(P.判据(造([3, 0, 0]), '零命中').通过, true, '只有史料站有命中 → 判据该过');
  assert.equal(P.判据(造([3, 0, 1]), '零命中').通过, false, '现役站有一条就不许过');
  assert.equal(P.判据(造([3, 5, 0]), '零命中').通过, false,
    '代码站的活体命中（= 已排除注释后仍露在文案/字符串里的）不许再被整站放行——这正是 app.js:104 逃了半个月的口子');
  assert.equal(P.判据(造([3, 0, 0]), '零命中', true).通过, false, '--含史料 把史料站算回来');
  assert.match(P.判据(造([3, 0, 0]), '零命中').说明, /豁免站另有 3 条/, '豁免掉的要如实报出来，不许假装没有');
});

t('站分型标要透传到结果里（本处同一个漏犯了两次）', () => {
  // 站表里标了、判据里读了，中间 扫一站() 那一层没带出去 → 豁免静默失效而判据照红。
  // 先漏 史料、修完再漏 代码——同一行同一个疏忽两次，故立此判据。
  const 表 = P.站表();
  const 有史料 = 表.filter((s) => s.史料).map((s) => s.站).sort();
  const 有代码 = 表.filter((s) => s.代码).map((s) => s.站).sort();
  // 豁免是**白名单**不是下限（2026-08-22 #44 复核实测）：原来写的是 `>= 2`，
  // 那句话拦不住豁免蔓延——把站表逐条标成史料，这一格照绿、零命中判据全线变绿。
  // 加站/改标必须显式改这一行，改不动就说明你正在偷偷放宽判据。
  assert.deepEqual(有史料, ['1 决议史', '7 跨会话记忆', '8b 班次归档'], '史料站白名单');
  assert.deepEqual(有代码, ['4 提示词接线', '6 机制代码/config'], '代码站白名单——豁免范围不许静默变宽');
  const r = P.扫描('拉取制', { 站: 表.filter((s) => s.史料 || s.代码) });
  assert.ok(r.站.every((s) => ('史料' in s) && ('代码' in s)), '结果里必须带着这两格标——不带就等于没标');
});

// ══════════ 代码站的注释豁免：真造 .js 文件，真跑分类 ══════════
// 都是行为判据：造出带注释/字符串/模板串的真文件，跑真扫描，看它判「注」还是「活」。
t('代码站：命中落在行注释里 → 记「注」不计活体（回退分支的注释本就该提旧制度名）', () => {
  const root = 造库({ 'C/x.js': "const a = 1; // 拉取制这条路同样得堵\nconst b = 2;\n" });
  const s = P.扫描('拉取制', { 站: [{ 站: 'C', 位置: [path.join(root, 'C')], 代码: true }] }).站[0];
  assert.equal(s.活体数, 0);
  assert.equal(s.注释数, 1);
  assert.equal(s.命中[0].注释, true);
});

t('代码站：命中落在块注释的**续行**里也算注释（只看单行标记的写法会误判 app.js:1123）', () => {
  const 文 = '/* D42 项目语境过滤：\n   口径与决策台/报表一致，保证上下半页同源。 */\nconst x = 1;\n';
  const root = 造库({ 'C/x.js': 文 });
  const s = P.扫描('决策台', { 站: [{ 站: 'C', 位置: [path.join(root, 'C')], 代码: true }] }).站[0];
  assert.equal(s.命中.length, 1);
  assert.equal(s.命中[0].line, 2, '就是那条行首没有任何注释标记的续行');
  assert.equal(s.活体数, 0, '续行仍在块注释里');
});

t('代码站：命中落在界面文案/字符串里 → 记「活」，照样进判据（app.js:104 那一族）', () => {
  const root = 造库({ 'C/app.js': "const h = `<p class=\"tagline\">工单 · 审检 · 决策台——驾驶舱</p>`;\n" });
  const r = P.扫描('决策台', { 站: [{ 站: 'C', 位置: [path.join(root, 'C')], 代码: true }] });
  assert.equal(r.站[0].活体数, 1, '模板串里的界面文案不是注释，不许豁免');
  assert.equal(P.判据(r, '零命中').通过, false, '代码站的活文案必须把判据打红');
});

t('代码站：字符串里的 // 不是注释开头（不许被 http:// 骗过去）', () => {
  const root = 造库({ 'C/x.js': "const u = 'http://x/拉取制';\n" });
  const s = P.扫描('拉取制', { 站: [{ 站: 'C', 位置: [path.join(root, 'C')], 代码: true }] }).站[0];
  assert.equal(s.活体数, 1, '这是字符串值不是注释——判错方向定死：宁可多报也不放行');
});

t('代码站：.json/.md 没有注释语法，里面的旧词就是活的', () => {
  const root = 造库({ 'C/cfg.json': '{ "口径": "决策台" }\n', 'C/说明.md': '// 决策台\n' });
  const s = P.扫描('决策台', { 站: [{ 站: 'C', 位置: [path.join(root, 'C')], 代码: true }] }).站[0];
  assert.equal(s.活体数, 2, 'md 里的 // 是正文不是注释；json 压根没注释语法');
});

t('注释豁免只给代码站：现役站的 .js 里写注释照样算活体', () => {
  const 文 = "const a = 1; // 拉取制\n";
  const root = 造库({ 'C/x.js': 文, 'Z/x.js': 文 });
  const r = P.扫描('拉取制', { 站: [
    { 站: 'C 代码', 位置: [path.join(root, 'C')], 代码: true },
    { 站: 'Z 现役', 位置: [path.join(root, 'Z')] },
  ] });
  assert.equal(r.站[0].活体数, 0);
  assert.equal(r.站[1].活体数, 1, '注释豁免是代码站的特权，不是全库通行证');
});

t('--含代码 / --宽 取消注释豁免（要看原始面貌时不许被过滤蒙住）', () => {
  const root = 造库({ 'C/x.js': "const a = 1; // 拉取制\n" });
  const 站 = [{ 站: 'C', 位置: [path.join(root, 'C')], 代码: true }];
  assert.equal(P.扫描('拉取制', { 站 }).活体总数, 0);
  assert.equal(P.扫描('拉取制', { 站, 含代码: true }).活体总数, 1);
  assert.equal(P.扫描('拉取制', { 站, 宽: true }).活体总数, 1);
  assert.deepEqual(P.解析参数(['x', '--含代码']).含代码, true, 'CLI 认这个开关');
});

// ══════════ #19 H49 派发制：现役站真扫描 ══════════
t('H49 立宪判据：拉取制在现役站零活体命中（含 lib/setup.js 那份打包兜底章程）', () => {
  const 判 = P.判据(P.扫描('拉取制'), '零命中');
  assert.equal(判.通过, true, '拉取制 现役站仍有活体命中：' + 判.说明);
});

t('这条判据真的盖到了发行面：站6 扫得进 lib/setup.js（内置章程 = exe 走的那份）', () => {
  // 为什么要单立这一格：上一条一旦因为路径写错而扫了个空目录，也会「通过」。
  // 拿一个 setup.js 里必然在场的词做在场证明——判据盖不到的地方不算被盯着。
  const 站6 = P.站表().find((s) => s.站 === '6 机制代码/config');
  const r = P.扫一站(站6, ['内置章程'], { 含代码: true });
  assert.ok(r.存在, '站6 位置不存在，判据是空的');
  assert.ok(r.命中.some((h) => h.file.replace(/\\/g, '/').endsWith('/lib/setup.js')),
    'lib/setup.js 没被站6 扫到——exe 里那份兜底章程等于没人盯：' + r.文件数 + ' 文件');
});

t('H49 立宪判据：岗位协议站与技能舰队站里 派发制 在场、拉取制 零命中', () => {
  const 表 = P.站表();
  for (const 名 of ['3 岗位协议', '5 技能舰队']) {
    const 站 = 表.find((s) => s.站 === 名);
    const 旧 = P.扫一站(站, ['拉取制']);
    if (!旧.存在) { console.log(`    · ${名} 位置不在本机，跳过（不假绿：上面 存在 已如实报 false）`); continue; }
    assert.equal(旧.活体数, 0, `${名} 还留着活的「拉取制」：`
      + 旧.命中.filter((h) => h.活体).map((h) => h.file + ':' + h.line).join('、'));
    const 新 = P.扫一站(站, ['派发制']);
    assert.ok(新.活体数 > 0, `${名} 一处都没提「派发制」——H49 没誊到这一站（改了正本忘了副本的老病）`);
  }
});

t('发行模板真在站5 的射程里：packages/role-protocol-templates/通用.md 被扫到且说派发制', () => {
  // 源码布局下装工作区抄的就是这份模板；它漂了，新建的每个工作区都跟着漂。
  const 站5 = P.站表().find((s) => s.站 === '5 技能舰队');
  const r = P.扫一站(站5, ['派发制']);
  const 命 = r.命中.filter((h) => h.file.replace(/\\/g, '/').endsWith('packages/role-protocol-templates/通用.md'));
  assert.ok(命.length > 0, '站5 没扫到发行模板 通用.md——这一站的判据盖不到发行面');
  assert.ok(命.some((h) => h.活体), '模板里的「派发制」被判成了退役标注，等于没在场');
});

// ══════════ 决策台：现役站活体命中受控 ══════════
// 「撤决策台」这一路还没传播干净：public/app.js:104（顶栏 tagline）与 :884（抽屉提示）
// 是两条**真在跑的界面文案**。它们本次不归本组改（public/app.js 是别人的独占文件），
// 精确补丁已交回总控（需协调）。这一格因此写成**欠账清单**而不是硬零：
//   · 命中出现在清单外的任何文件 → 红（新漂移一条都别想混进来）
//   · 命中条数超过已知的 2 条 → 红（同一文件里再多一条也算新漂移）
//   · 欠账清完 → 照绿（补丁落地不必回来改判据）
const 决策台欠账文件 = ['apps/studio/public/app.js'];
const 决策台欠账上限 = 2;
t('撤决策台判据：现役站活体命中不出已知欠账清单（清单外一条都不许有）', () => {
  const r = P.扫描('决策台');
  const 活 = [];
  for (const s of r.站) { if (s.史料) continue; for (const h of s.命中) if (h.活体) 活.push(h); }
  const 相对 = (f) => f.replace(/\\/g, '/').split('/Ticketflow/').pop();
  const 出清单 = 活.filter((h) => !决策台欠账文件.includes(相对(h.file)));
  assert.deepEqual(出清单.map((h) => 相对(h.file) + ':' + h.line), [],
    '欠账清单外冒出新的活体「决策台」——这才是真漂移');
  assert.ok(活.length <= 决策台欠账上限,
    `已知欠账 ${决策台欠账上限} 条，现在 ${活.length} 条：` + 活.map((h) => 相对(h.file) + ':' + h.line).join('、'));
  if (活.length) {
    console.log(`    · 待清欠账 ${活.length} 条（需协调补丁未落）：` + 活.map((h) => 相对(h.file) + ':' + h.line).join('、'));
  }
});

// ══════════ #55 仪式接线：H78 的收口动作要真去调 propcheck ══════════
t('仪式接线：protocol-sync 技能的收口清单里真写着调 propcheck（缺文件则跳过，不误伤换机）', () => {
  const 技 = path.join(os.homedir(), '.claude', 'skills', 'protocol-sync', 'SKILL.md');
  if (!fs.existsSync(技)) { console.log('    · 本机没装 protocol-sync 技能，跳过：' + 技); return; }
  const 文 = fs.readFileSync(技, 'utf8');
  assert.ok(/propcheck(\.js|\/propcheck)/.test(文),
    'protocol-sync 八站誊录完仍只有人肉 grep 收口——fable 文案三次不死案的成因原样留着：' + 技);
  assert.ok(/--要求\s*(零命中|全站命中)/.test(文), '光提名字不算接线，得写出可直接跑的判据调用');
});

// ══════════ #55 前置件二：记账口（传播核查.jsonl）══════════
// 案源：本模块原样**零写文件动作**——「传播核查」只是报告抬头的一句文案，跑完即散。
// 于是「这道核查上次是什么时候跑的」全库无人知道。G21「传播核查断更」要挂在这行流水上，
// 而**判据读一个没人写的文件 = 恒空假账**（G13/G14 无人消费正是这么来的）。
// 下面每一格都真写真读真解析，没有一条 assert.match 源码。
// 纪律六：一律用临时根，绝不碰生产工作区 D:/GitHub/AI-GameStudio/。
const 账根 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pcled-'));
const 读账 = (root) => fs.readFileSync(path.join(root, '瞭望塔', '传播核查.jsonl'), 'utf8')
  .split(String.fromCharCode(10)).filter((l) => l.trim()).map((l) => JSON.parse(l));

t('记账：跑一次追一行，{时间,关键词,判据,通过} 四格齐，且是可逐行解析的 JSON Lines', () => {
  const root = 造库({ '副本/b.md': '按拉取制领单' });
  const led = 账根();
  const r = P.扫描('拉取制', { 站: 站(root, '副本') });
  const 判 = P.判据(r, '零命中');
  const 账 = P.记账(r, 判, { 台账根: led });
  assert.equal(账.记, true, '没写进去：' + 账.因);
  const 行们 = 读账(led);
  assert.equal(行们.length, 1);
  assert.deepEqual(Object.keys(行们[0]).sort(), ['判据', '关键词', '时间', '通过'].sort(),
    '闸只认这四格，多一格少一格都算改契约：' + JSON.stringify(行们[0]));
  assert.deepEqual(行们[0].关键词, ['拉取制']);
  assert.equal(行们[0].通过, false, '判据红的那次也得如实记「没过」');
  assert.ok(!Number.isNaN(Date.parse(行们[0].时间)), '时间要能被 Date.parse 认出来（断更闸靠它算天数）：' + 行们[0].时间);
});

t('记账：是 append 不是覆盖，且 瞭望塔/ 目录不存在时自己建（首跑不许因缺目录静默失败）', () => {
  const root = 造库({ '副本/b.md': '干净' });
  const led = 账根();
  assert.ok(!fs.existsSync(path.join(led, '瞭望塔')), '前置：目录本来没有');
  const r = P.扫描('拉取制', { 站: 站(root, '副本') });
  for (let i = 0; i < 3; i += 1) assert.equal(P.记账(r, P.判据(r, '零命中'), { 台账根: led }).记, true);
  const 行们 = 读账(led);
  assert.equal(行们.length, 3, '三次运行三行——覆盖式写法会让断更闸永远只看得见最后一次，历史无从查');
  assert.ok(行们.every((x) => x.通过 === true));
});

t('记账：写不进去也不许炸（核查是本职，留痕是副产品）', () => {
  const root = 造库({ '副本/b.md': '干净' });
  const 坏 = 账根();
  fs.writeFileSync(path.join(坏, '占位'), 'x', 'utf8');       // 拿文件当根 → mkdir 必失败
  const r = P.扫描('拉取制', { 站: 站(root, '副本') });
  const 账 = P.记账(r, P.判据(r, '零命中'), { 台账根: path.join(坏, '占位') });
  assert.equal(账.记, false);
  assert.ok(账.因 && 账.因.length, '失败要说清为什么，别只回个 false：' + JSON.stringify(账));
  assert.ok(账.文件.replace(/\\/g, '/').endsWith('/瞭望塔/传播核查.jsonl'), '落点仍要报出来');
});

t('--不记账 真的不写；不给它就一定写（默认必须是「记」，否则断更闸天天误报）', () => {
  const root = 造库({ '副本/b.md': '干净' });
  const led = 账根();
  const r = P.扫描('拉取制', { 站: 站(root, '副本') });
  assert.equal(P.记账(r, P.判据(r, '零命中'), { 台账根: led, 不记账: true }).记, false);
  assert.ok(!fs.existsSync(path.join(led, '瞭望塔', '传播核查.jsonl')), '--不记账 档下一个字节都不许落地');
  assert.equal(P.记账(r, P.判据(r, '零命中'), { 台账根: led }).记, true);
  assert.equal(读账(led).length, 1);
  assert.deepEqual(P.解析参数(['x', '--不记账']).不记账, true, 'CLI 认这个开关');
  assert.equal(P.解析参数(['x', '--台账根', 'C:/t']).台账根, 'C:/t', 'CLI 认落点注入（测试靠它避开生产工作区）');
});

t('CLI 真跑一遍就有账：main() 走完 = jsonl 里多一行，且退出码与记的 通过 对得上', () => {
  // 这一格盯的是**接线**：记账函数写得再对，main() 不调它照样零流水。
  const 脏 = 造库({ '副本/b.md': '按拉取制领单' });
  const 净 = 造库({ '副本/b.md': '现行制度：派发制' });
  const led = 账根();
  const 跑 = (库) => P.main(['拉取制', '--站', '临时站=' + path.join(库, '副本'), '--只站', '临时站',
    '--台账根', led, '--要求', '零命中', '--明细', '0']);
  assert.equal(跑(脏), 1, '有活体命中 → 退出码 1');
  assert.equal(跑(净), 0, '零活体命中 → 退出码 0');
  const 行们 = 读账(led);
  assert.equal(行们.length, 2, 'main 跑两次就该有两行，实测 ' + 行们.length);
  assert.deepEqual(行们.map((x) => x.通过), [false, true], '记的「过没过」要跟退出码一致');
  assert.ok(行们.every((x) => x.判据.includes('零活体命中')), '判据名要记下来：' + JSON.stringify(行们.map((x) => x.判据)));
});

t('缺省落点是 <协议仓>/监制台/瞭望塔/传播核查.jsonl（只算路径不写盘）', () => {
  // 落点漂了，G21 就会去读一个永远空的文件而报「断更」——恒空假账的另一种长法。
  const p = P.台账路径().replace(/\\/g, '/');
  assert.ok(p.endsWith('/监制台/瞭望塔/传播核查.jsonl'), '落点不对：' + p);
  assert.equal(P.台账路径({ 台账根: 'C:/tmp/x' }).replace(/\\/g, '/'), 'C:/tmp/x/瞭望塔/传播核查.jsonl',
    '根必须可注入——不可注入就意味着测试只能往生产工作区写');
});

console.log(`全部通过：${passed} 项`);
