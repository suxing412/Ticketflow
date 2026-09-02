// 工单实例页契约（协-028）—— 一张单**竖着看**。
//
// 两块新地基各测各的：
//   · 运行流水：每次真跑的字节留没留下、增量读对不对、渲染有没有把人要看的东西挑出来；
//   · 阶段轴：frontmatter 上那些散点，排成阶段之后每一格的判定对不对。
// 端点那一格照 studio 0.26.16 立的规矩，真起服务打一遍（在 test/在线契约 里那套夹具）。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const 流水 = require('../lib/运行流水');
const { 阶段轴 } = require('../lib/阶段轴');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('工单实例页契约测试');

const 平台根 = path.resolve(__dirname, '..');
const 临根 = () => fs.mkdtempSync(path.join(os.tmpdir(), '实例-'));
const 单 = (state, fm) => ({ id: 'T-1', state, fm: { title: 'T-1', ...fm } });
const 格 = (轴, 键) => 轴.find((x) => x.键 === 键);

// ---------- 运行流水 ----------
t('一次运行落两个文件：原始流 + 元数据', () => {
  const 根 = 临根();
  const 号 = 流水.开始(根, { 单: 'T-1', 类别: '执行', 池: 'claude', 格式: 'claude-stream-json' });
  assert.ok(号 && 号.includes('执行'));
  流水.落(根, 'T-1', 号, 'hello');
  流水.收尾(根, 'T-1', 号, { 退出码: 0 });
  const 列 = 流水.列(根, 'T-1');
  assert.equal(列.length, 1);
  assert.equal(列[0].退出码, 0);
  assert.equal(列[0].格式, 'claude-stream-json', '格式必须记下来——渲染是在读的时候做的，那时早没有调用对象了');
  assert.ok(列[0].讫于, '收尾要写讫于，界面靠它分「跑着」和「跑完了」');
  assert.equal(流水.读(根, 'T-1', 号).内容, 'hello');
  fs.rmSync(根, { recursive: true, force: true });
});

t('增量读按**字节**续，不按行——轮询时半行会让行号错位', () => {
  const 根 = 临根();
  const 号 = 流水.开始(根, { 单: 'T-1', 类别: '执行' });
  流水.落(根, 'T-1', 号, 'abc');
  const 一 = 流水.读(根, 'T-1', 号, 0);
  assert.equal(一.内容, 'abc'); assert.equal(一.讫, 3);
  流水.落(根, 'T-1', 号, 'de');
  const 二 = 流水.读(根, 'T-1', 号, 一.讫);
  assert.equal(二.内容, 'de', '只该拿到新增那截');
  assert.equal(流水.读(根, 'T-1', 号, 二.讫).内容, '', '没有新内容就返回空，不是重发一遍');
  fs.rmSync(根, { recursive: true, force: true });
});

t('落盘失败绝不抛——证据是好东西，但不能反过来把活弄挂', () => {
  // 拿一个**文件**当账本根：往文件底下建目录必然失败，且跨平台都失败。
  // （原先写的是一个「不存在的路径」，可 mkdir recursive 会把它建出来——
  //  测试反而在 D 盘根上留了个垃圾目录。想验失败就得挑一个真的会失败的姿势。）
  const 根 = 临根();
  const 假根 = path.join(根, '我是文件');
  fs.writeFileSync(假根, 'x');
  assert.equal(流水.开始(假根, { 单: 'T-1' }), null, '开不了就返回 null，调用方照跑');
  assert.doesNotThrow(() => 流水.落(假根, 'T-1', '某号', 'x'));
  assert.doesNotThrow(() => 流水.收尾(假根, 'T-1', '某号', {}));
  assert.deepEqual(流水.列(假根, 'T-1'), []);
  fs.rmSync(根, { recursive: true, force: true });
});

t('单号里的 ../ 不许落到文件系统上（工单编号是人取的）', () => {
  // 要守的性质是**跳不出去**，不是「字面上没有两个点」：剥掉分隔符之后
  // `.._.._etc_passwd` 只是个难看的文件名，而 `..` 本身才是真能上跳一级的那个。
  for (const 坏 of ['../../etc/passwd', 'a/b\\c', 'x\0y']) {
    const 名 = 流水.安全名(坏);
    assert.ok(!名.includes('/') && !名.includes('\\'), '不许留下路径分隔符：' + 名);
    assert.equal(path.basename(path.join('根', 名)), 名, '拼进目录之后必须还在那个目录里：' + 名);
  }
  assert.equal(流水.安全名('..'), '_', '纯点号的名字没有正常用途，而它是唯一一个「看着安全」却仍能逃出去的形状');
  assert.equal(流水.安全名(''), '_');
  assert.equal(流水.安全名('HW-4'), 'HW-4', '正常单号一个字都不该被改');
  assert.equal(流水.安全名('海投王-1'), '海投王-1', '中文单号是这个仓的常态，不能被剥空');
});

t('渲染把人要看的挑出来：agent 的话原样、工具调用压成一行', () => {
  const 流 = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '我先看一眼现状' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a/b.ts' } }] } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { partial_json: '{"co' } } }),
    JSON.stringify({ type: 'result', is_error: true, num_turns: 20, stop_reason: 'stop_sequence' }),
  ].join('\n');
  const 出 = 流水.渲染(流, 'claude-stream-json');
  assert.match(出, /我先看一眼现状/);
  assert.match(出, /▸ Read\(a\/b\.ts\)/);
  assert.ok(!出.includes('partial_json'),
    '逐字符的碎片占了流里 95%，全摆出来人就找不到自己要看的东西了');
  assert.match(出, /20 轮/, '收尾那条要把 num_turns 说出来——协-024 治的正是「退出码 1 不是原因」');
});

t('半行跳过（正读到一半），不是报错也不是乱码', () => {
  const 出 = 流水.渲染('{"type":"assistant","message":{"content":[{"type":"text","text":"完整"}]}}\n{"type":"assis', 'claude-stream-json');
  assert.equal(出, '完整', '下一次轮询会把那半行补齐');
});

t('非 JSON 行原样留（stderr 就是这么进来的，出事时最该看的就是它）', () => {
  assert.match(流水.渲染('[stderr] boom\n', 'claude-stream-json'), /\[stderr\] boom/);
});

// ---------- 阶段轴 ----------
t('不带项目的单，「进主线」是**跳过**不是未到', () => {
  // 「未到」会让人一直等一个永远不会发生的事。
  const 轴 = 阶段轴(单('完成', { 项目: '' }));
  assert.equal(格(轴, '发布').态, '跳过');
  assert.match(格(轴, '发布').说, /只跑不提交/);
});

t('三种坏结局各自分开：失败 / 空转 / 中断', () => {
  const 失 = 格(阶段轴(单('待投', { 执行失败: { 原因: '跑到回合数上限被截断' } })), '执行');
  assert.equal(失.态, '阻'); assert.match(失.说, /回合数上限/);
  const 空 = 格(阶段轴(单('待投', { 空转: { 说: '执行成功但没有任何文件改动' } })), '执行');
  assert.equal(空.态, '阻'); assert.match(空.该谁, /还是 agent 没动手/);
  const 断 = 格(阶段轴(单('在途', { 中断: '服务停机中断了执行' })), '执行');
  assert.equal(断.态, '阻'); assert.match(断.该谁, /重投是安全的/);
});

t('未进主线要在阶段上标红并说清去合哪个分支', () => {
  const g = 格(阶段轴(单('质检', { 项目: 'X', 检查点: 'abc', 待集成: { 说: '主工作区有未提交改动', 分支: 'platform/x/A' } })), '发布');
  assert.equal(g.态, '阻');
  assert.ok(g.说.includes('platform/x/A'));
  assert.match(g.该谁, /integrator/);
});

t('质检：通过是成、不过是阻、免检是跳过——三者不能混成一个「判过了」', () => {
  assert.equal(格(阶段轴(单('完成', { 质检结论: '通过', 质检判官: 'codex' })), '质检').态, '成');
  const 不过 = 格(阶段轴(单('待投', { 质检结论: '不过', 质检判官: 'codex' })), '质检');
  assert.equal(不过.态, '阻'); assert.match(不过.该谁, /返工/);
  const 免 = 格(阶段轴(单('完成', { 免检原因: '只读单：产出是判定本身' })), '质检');
  assert.equal(免.态, '跳过');
  assert.match(免.说, /免检/, '免检要说出理由——不然它和「判过了」在界面上长得一样');
});

t('每一格都能回答「接下来该谁动」，而且没轮到的不许瞎催', () => {
  const 轴 = 阶段轴(单('草稿', {}));
  assert.match(格(轴, '投出').该谁, /你/);
  assert.equal(格(轴, '派活').该谁, null, '还在草稿里，派活那格不该催人');
  assert.equal(格(轴, '质检').该谁, null);
});

t('阶段轴是纯函数：不读盘、不看时钟，同输入恒同输出', () => {
  const t1 = 单('质检', { 项目: 'X', 检查点: 'abc', 质检结论: '不过' });
  assert.deepEqual(阶段轴(t1), 阶段轴(t1));
});



// ---------- 交付回执与「验不了」（协-029）----------
const 质检 = require('../lib/质检');

t('「验不了」是第三种结论，不是「不过」的子类', () => {
  // 判不过 → 回待投让人返工；验不了 → 留在质检，该修的是环境。
  // 把后者当前者的后果实测过：HW-4 因为工作区没装依赖被判不过两轮，
  // 每轮都把单打回重做，而代码根本没问题——返工修不好一个跑不动命令的工作区。
  const r = 质检.判定(0, '结论：验不了\n\n## 阻断问题\n- npm ci 跑不起来，缺 node_modules');
  assert.equal(r.结论, '验不了');
  assert.equal(r.下一步, null, '不流转——这张单没毛病');
  assert.match(r.说明, /不打回/);
  assert.ok(r.意见, '意见照样要解析出来，不然人不知道缺的是什么');
});

t('通过 / 不过 两条老路一个字没变', () => {
  assert.equal(质检.判定(0, '结论：通过').下一步, '完成');
  assert.equal(质检.判定(0, '结论：不过\n## 阻断问题\n- 少了接线').下一步, '待投');
});

t('判官自己崩了仍然是「判官失败」，不许被「验不了」吃掉', () => {
  // 加固② 的老规矩：判官失败 ≠ 被评审方不合格，工单维持原状待重判。
  // 退出码非 0 时就算输出里有「验不了」字样也不算数——那多半是崩在半路的残句。
  const r = 质检.判定(2, '结论：验不了');
  assert.equal(r.结论, '判官失败');
});

t('质检提示词把「验不了」的用法讲清楚，并且劝阻滥用', () => {
  const p = 质检.质检提示词({ id: 'T-1', fm: {}, body: '' }, ['a.ts'], { 审阅区: true });
  assert.match(p, /结论：验不了/);
  assert.match(p, /不过 = 活不对，验不了 = 我没法判/, '两者的下一步完全不同，得说破');
  assert.match(p, /判得了就别用它/, '不写这句它就会变成「拿不准」的中间档');
});

t('交付回执要摆给判官，但要标明「需要你核对」而不是结论', () => {
  const 无 = 质检.质检提示词({ id: 'T-1', fm: {}, body: '' }, ['a.ts'], { 审阅区: true });
  assert.ok(!无.includes('执行方交付回执'), '没有回执时不该凭空多出一节');
  const 有 = 质检.质检提示词({ id: 'T-1', fm: {}, body: '' }, ['a.ts'], { 审阅区: true, 回执: '我跑了 npm test，退出码 0' });
  assert.match(有, /执行方交付回执/);
  assert.match(有, /需要你核对/, '不标的话它就成了「我已完成」那类自述，会把判官带偏');
  assert.match(有, /npm test/);
});

t('执行器：回执落进工单、并在质检时从工单正文取回来', () => {
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.match(源, /fm2\.回执落于/, '代码单的回执此前只在那一次 HTTP 响应里活着');
  assert.match(源, /## 交付回执 /, '落进工单正文，跟只读单的报告同一个去处');
  assert.match(源, /lastIndexOf\('## 交付回执'\)/, '质检取材要把它捞回来——判官只拿 diff 是不够的');
});

t('只读单跑完也要收工（它永远走不到发布那条路）', () => {
  // 收工此前只挂在发布成功那一条路上。只读单没有检查点 → 不发布 → 不收工，
  // 于是 HW-3 完成之后 worktree 和分支一直躺着，而且会一张张攒下去。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('完成（只读单：报告已落进工单）');
  assert.ok(i > 0);
  const 段 = 源.slice(i, i + 1400);
  assert.match(段, /'\/write\/收工'/, '只读单零改动，那条分支上没有独一份的提交，扔了不丢东西');
  assert.match(段, /不该反过来把一次成功的交付说成失败/, '收不掉不算完成失败');
});

t('检查点被拒也是一种结局，得有归宿（协-030）', () => {
  // 实测（HW-4）：agent 为了交回执自己建了 RECEIPT.md，写入范围闸当场拒了检查点。
  // 于是活干完了、改动还在工作区里、工单却**静默留在在途**——半小时后巡检报
  // 「在途超时，执行器可能已挂」，又一次归错因。同一个坑这个文件里已经写过三遍。
  const g = 格(阶段轴(单('待投', { 检查点被拒: { 因: '改动超出工单允许的写入范围：RECEIPT.md' } })), '执行');
  assert.equal(g.态, '阻');
  assert.match(g.说, /写入范围/);
  assert.match(g.该谁, /改动没丢/, '不说这句人会以为白跑一趟，转头重派——而重派会在同一个工作区上再干一遍');

  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('检查点被拒也是一种结局');
  assert.ok(i > 0, '检查点分支的 else 此前是空的');
  const 段 = 源.slice(i, i + 1800);
  assert.match(段, /'在途', '待投'/, '退回待投：它已经不在跑了，留着白占并发额度');
  assert.match(段, /呼叫\.急/, '无人值守时信箱是唯一有人会看见的地方');
  assert.match(段, /改动没丢/);
});

t('角色协议要说清回执交到哪里——不说 agent 就会自己建文件', () => {
  // 协-029 让平台**捕获** agent 的最终发言当回执，却从没**告诉 agent** 回执是这么交的。
  // 于是它自己发明了一套（写 RECEIPT.md），而那超出了写入范围，整次交付卡住。
  const 协议 = fs.readFileSync(path.join(平台根, '角色协议模板', 'common.md'), 'utf8');
  assert.match(协议, /你的最后一条消息就是回执/);
  assert.match(协议, /不要为了交回执去新建文件/);
  assert.match(协议, /RECEIPT\.md/, '把踩过的那个具体文件名写进去——泛泛说「不要建文件」挡不住');
  assert.match(协议, /产出物类型: 文档/, '要留出口子：工单真要一份文档时那是交付物，不是回执');
});

t('空转也要留回执——那时它是这一趟唯一的产出（协-031）', () => {
  // 2026-08-25 HW-4 实测：agent 完整照协-030 的规矩交了回执（没建文件、写在最后一条
  // 消息里、逐条复核了验收标准、说清「上一轮被判不过的唯一阻断点是回执缺失，本轮补齐」）
  // ——而平台把这段话原样扔了，因为回执捕获只挂在成功分支上。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('空转也要留回执');
  assert.ok(i > 0, '空转分支此前不捕获回执');
  const 段 = 源.slice(i, i + 2600);
  assert.match(段, /fm2\.回执落于/);
  assert.match(段, /本轮零改动/, '回执标题要说清这一趟没改东西，别让人以为它对应某次改动');
});

t('已有检查点的空转送质检，没有检查点的照旧退回待投（协-031）', () => {
  // 协-020 当时的顾虑没错：「活本来就做完了」和「agent 没动手」平台判不出。
  // 但那是在没有其它证据的前提下说的。有检查点（有东西可判）+ 有回执（agent 确实看过并交代了）
  // 这两条一起成立时，退回待投就是把它送进死循环——重跑执行永远是空转。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('已有检查点的空转');
  assert.ok(i > 0);
  const 段 = 源.slice(i, i + 2000);
  assert.match(段, /const 有活可判 = .*检查点 \|\| .*发布提交.*&&.*空回执/s, '两条证据缺一不可');
  assert.match(段, /'在途', 到/, '送质检（或免检直接完成），不是退回待投');
  assert.match(段, /重跑执行永远还是空转/, '要说清为什么不退回——不然人会以为平台乱改流转');
  assert.ok(段.indexOf("'在途', '待投'") > 段.indexOf('const 有活可判'),
    '没有检查点那一支必须还在，且排在后面当兜底');
});

t('「验不了」在阶段轴上跟「不过」分得开，出路也不同（协-031 实测）', () => {
  // 2026-08-25 HW-4 实测：判官那台机器缺 codex-windows-sandbox-setup.exe，
  // 连 Get-Location 都跑不起来，于是它明说「该故障属于评审环境问题，不能据此判定交付不过」。
  // 若按「不过」处置，就是第五次把一张没毛病的单踢回去重做。
  const g = 格(阶段轴(单('质检', { 质检验不了: { 判官: 'codex', 时刻: 'x' } })), '质检');
  assert.equal(g.态, '阻');
  assert.match(g.说, /验不了/);
  assert.match(g.该谁, /修.*环境/);
  // 断言要钉的是「别叫人去返工」，而不是「别出现返工两个字」——
  // 这句出路里恰恰要写「返工修不好它」，那是在解释为什么不返工。
  assert.ok(!格(阶段轴(单('质检', { 质检验不了: { 判官: 'codex' } })), '质检').该谁.includes('照判词返工'),
    '返工修不好一台缺组件的机器——出路指错了比不指更坏');
});

t('没流转时回执要说清是「判官失败」还是「验不了」', () => {
  // 第一次出现验不了时，回执上照旧印着「判官失败」——而判官好好的，
  // 是它明说了自己没法判。两者的下一步完全不同：重判 vs 先修环境。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('工单状态: 流转');
  assert.ok(i > 0);
  const 段 = 源.slice(i, i + 500);
  assert.match(段, /判\.结论 === '验不了'/, '两种「没流转」得分开印');
  assert.match(段, /判官失败/, '另一种照旧');
});

// ---------- spawn 拉不起来是一种结局，不是一场事故（协-032）----------
t('spawn 必须被包起来——它是同步抛的，抛出去就掀掉整个执行器', () => {
  // 2026-08-25 实测：npm 装了 codex 之后适配器解析到 %APPDATA%\npm\codex.cmd，
  // 而 Node ≥20 在 Windows 上拒绝 spawn 一个 .cmd 而不带 shell（CVE-2024-27980 的修复）。
  // `spawn EINVAL` 同步抛 → 连 p.on('error') 都进不去 → 未捕获异常掀了执行器进程。
  // 调用方拿到的是 ECONNRESET——最难查的那种：看着像网络问题，其实是进程没了。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('function 拉起(');
  const 段 = 源.slice(i, i + 3000);
  assert.match(段, /try \{\s*\n\s*p = spawn\(/, 'spawn 必须在 try 里——它同步抛，p.on(error) 拦不住');
  assert.match(段, /回调\(\{ 退出码: -2/, '拉不起来要走回调，跟退出码非 0 一个待遇：进回执、落工单');
  assert.match(段, /\/\\\.\(cmd\|bat\)\$\/i/, '.cmd/.bat 要认出来');
  assert.match(段, /shell: true/, '这类包装脚本本来就得靠 cmd.exe 解释');
});

t('走 shell 前要挡住参数里的 shell 元字符（--model 来自请求体）', () => {
  // shell 模式下 args 是拼接不转义的（Node 自己发 DEP0190 警告）。
  // 而 `--model <体.model>` 来自请求体：一个叫 `x & calc` 的模型名就是任意命令执行。
  // 服务绑 127.0.0.1 且有令牌，但「带令牌的调用方能执行任意命令」不是这个产品要给的能力。
  const 源 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 源.indexOf('if (是脚本) {');
  assert.ok(i > 0, '走 shell 之前要有这道闸');
  const 段 = 源.slice(i, i + 900);
  assert.match(段, /拒跑/, '见到元字符是拒跑，不是转义——不猜');
  assert.match(段, /任意命令执行/, '要说清后果，不然下一个人会觉得这道闸多余');
  // 判据本身也验一遍：常规 flag 放行，元字符拦下。
  const 判 = (a) => /^[A-Za-z0-9_.,:@=\/\\+-]+$/.test(a);
  for (const 好 of ['--model', 'sonnet', '--output-format', 'stream-json', 'D:\\path\\x.exe', 'claude-opus-4.5']) {
    assert.ok(判(好), '正常参数不该被误拦：' + 好);
  }
  for (const 坏 of ['x & calc', 'a;b', '$(whoami)', 'a|b', 'a>b', '`id`']) {
    assert.ok(!判(坏), '这个该拦下：' + 坏);
  }
});

t('判官的审阅区也要装依赖，否则命令型验收永远「验不了」（协-033）', () => {
  // 协-026 只补了**执行**工作区；审阅区是另一条 prepare 路径，没跟上。
  // 2026-08-26 HW-4 实测：判官把能静态核对的全核对了（接口、两个 store、service 注入、
  // 8 对迁移、参数化 SQL 全对），然后卡在同一句话上——「三项命令型验收均受环境阻断」。
  const 源 = fs.readFileSync(path.join(平台根, 'lib', 'workspace', 'worktree.js'), 'utf8');
  const i = 源.indexOf('function 审阅区(');
  assert.ok(i > 0);
  const 段 = 源.slice(i, i + 1600);
  assert.match(段, /装依赖\(path\.resolve\(target\), 工单/, '装什么由被审那张单说了算，不由判官猜');
  assert.match(段, /依赖失败/, '装不上要把因由带回去');
  assert.ok(!/throw/.test(段.slice(段.indexOf('装依赖('))),
    '装不上**不该拦着判**——判官照样能静态核对，得出「验不了」是个诚实的结论');
  // 依赖是**平台替它装的**，不是判官自己写的——协-034 把判官在区内放成可写之后，
  // 这句话更要留着：它说明「审阅区能跑」不依赖于判官有没有写权。
  assert.match(源.slice(i - 1400, i), /依赖是平台替它装的/);
});

t('审阅区的工单要从执行器一路递到工作区服务（协-033）', () => {
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const 服 = fs.readFileSync(path.join(平台根, 'scripts', '工作区服务.js'), 'utf8');
  assert.match(执, /单据: \{ id, fm: t\.fm \}/, '执行器要把被审工单本体递过去');
  assert.match(服, /体\.单据 \|\| null/, '工作区服务要接住并传给 审阅区');
  // 字段名不叫「工单」：那个名字在这条请求里已经被单号占了，改它会动到既有契约。
  assert.match(执, /工单: id, commit: 检查点sha/, '既有的 工单=单号 契约一个字没动');
});

// ---------- 判官的写权与篡改检查（协-034） ----------
//
// 协-033 把依赖装进了审阅区，HW-4 第四轮仍然「验不了」——因为剩下两条命令
// 挂的不是依赖，是 --sandbox read-only：tsc 要写 dist、vitest 要写 .vite-temp。
// 只读沙箱下**凡验收标准要跑构建/跑测试的单，判官永远判不动**。
const 派单 = require('../lib/派单');
const 质检模块 = require('../lib/质检');

t('有审阅区时判官在区内可写——否则 tsc / vitest 一步都跑不完（协-034）', () => {
  const 权 = 派单.判官参数({}, 'codex-cli', { 审阅区: true });
  assert.equal(权.判官模式, '区内可写');
  assert.deepEqual(权.参数, ['--sandbox', 'workspace-write', '--skip-git-repo-check']);
  // workspace-write 的语义正是「cwd 之内可写、之外写不了」，而 cwd 就是那个一次性审阅区。
  assert.ok(!权.参数.includes('read-only'));
});

t('没有审阅区就没有「区内」可言——退回只读（协-034）', () => {
  // 没项目 / 没检查点 / 审阅区建不起来：判官会跑在一个跟被审代码无关的临时目录里。
  // 那种情况下给写权既没用，也没有任何边界可言。
  const 权 = 派单.判官参数({}, 'codex-cli', { 审阅区: false });
  assert.equal(权.判官模式, '只读');
  assert.deepEqual(权.参数, ['--sandbox', 'read-only', '--skip-git-repo-check']);
});

t('表达不出「只在区内可写」的适配器一律退回只读，不许拿全盘放开顶替（协-034）', () => {
  // claude-cli 只有 --dangerously-skip-permissions 这一档能让命令真跑起来，
  // 而那是**全盘**的、不是工作区内的。缺配置即最严这条不为了让某张单过而破例。
  const 权 = 派单.判官参数({}, 'claude-cli', { 审阅区: true });
  assert.equal(权.判官模式, '只读');
  assert.ok(!JSON.stringify(权.参数).includes('dangerously'), '不许把全盘放开当成区内可写');
  assert.match(权.警告 || '', /验不了/, '要说清后果：命令型验收在它手里仍然判不动');
  assert.match(权.警告 || '', /codex/, '要给出路，不是只说「不行」');
  // 真要配也得显式配一套，且平台不替它猜。
  const 配了 = 派单.判官参数(
    { 执行: { 权限: { 判官区内可写: { 'claude-cli': ['--sandbox', 'workspace'] } } } },
    'claude-cli', { 审阅区: true },
  );
  assert.equal(配了.判官模式, '区内可写');
});

t('判官改了它正在判的东西 → 判词作废，按判官失败待重判，不是判不过（协-034）', () => {
  const 原 = { 结论: '通过', 下一步: '完成', 说明: '质检通过', 意见: { 结论: '通过' } };
  const 废 = 质检模块.作废(原, ['services/api/src/profile.service.ts']);
  assert.equal(废.结论, '判官失败');
  assert.equal(废.下一步, null, '维持原状待重判——作废的是这次质检，不是这张单');
  assert.notEqual(废.下一步, '待投', '**不是判不过**：被评审方没有任何过错，不该被打回返工');
  assert.equal(废.原结论, '通过', '它原本判了什么要留着，人得看得见');
  assert.ok(废.意见, '意见留着：要判断是恶意还是手滑，得看它到底判了什么');
  // 没动过就原样放行，别在干净的路径上加戏。
  const 净 = 质检模块.作废(原, []);
  assert.equal(净.结论, '通过');
  assert.equal(净.下一步, '完成');
});

t('篡改只认受管改动——构建产物不算作弊（协-034）', () => {
  // 判官在区内跑 build / test 是我们**要它跑的**，dist 与临时目录是那件事的正常副产品。
  // 拿合并清单去判的话，.gitignore 恰好没盖住 dist 的项目会让每一次跑得动的质检
  // 都自判作弊——**一条正确的通过永远出不来**。
  const w = fs.readFileSync(path.join(平台根, 'lib', 'workspace', 'worktree.js'), 'utf8');
  assert.match(w, /function 变更分类\(dir\)/, '受管与新增要分得开');
  const 服 = fs.readFileSync(path.join(平台根, 'scripts', '工作区服务.js'), 'utf8');
  assert.match(服, /受管: 分\.受管, 新增: 分\.新增/, '/changes 要把两类分开报');
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.match(执, /作废\(判, c\.体\.受管/, '执行器只拿受管改动去作废');
});

t('篡改检查必须排在收工之前，且查不成不许反过来冤枉判官（协-034）', () => {
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const 查 = 执.indexOf("工作区请求('/changes'");
  const 收 = 执.indexOf("工作区请求('/write/收工', { 项目: 项目名, 工作区: { path: 审阅区.路径 } })");
  assert.ok(查 > 0 && 收 > 查, '审阅区一 --force 收掉，判官动没动过就永远查不出来了');
  // 查不成 ≠ 作弊：把「工作区服务没起来」判成「判官篡改」是冤枉，比放过一次更糟。
  assert.match(执, /篡改查不了/, '查不成要如实说出来，而不是当没查过');
  assert.match(执, /篡改未查/, '一个「通过」有没有经过篡改检查，是两种分量的结论');
});

t('审阅区没建起来时，权限要当场退回只读（协-034）', () => {
  // 预期会有审阅区、结果没建起来——参数得跟着改，不能带着「区内可写」跑进临时目录。
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 执.indexOf('工作目录 = 工作.目录;');
  assert.ok(i > 0);
  const 段 = 执.slice(i, i + 600);
  assert.match(段, /判官参数\(配置, 派\.adapter, \{ 审阅区: false \}\)/, '退回只读要真的重算一次');
  assert.match(段, /共同\.调用 = 调用/, '回执里印的必须是真正注进去的那套参数');
});

t('判官权限要上回执——否则两轮「验不了」在人眼里长得一模一样（协-034）', () => {
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.match(执, /判官权限: 权/, '这次判官是只读还是区内可写，直接决定命令型验收判不判得动');
  assert.match(执, /判词作废/, '作废要在工单状态上跟「判官失败」分得开');
});

// ---------- 漏声明的依赖要在派活前说出来（协-035） ----------
//
// 协-034 让判官跑得动命令之后，HW-4 第一次真判**还是**「验不了」：
// 单子上 `需要依赖: ["tooling","services/api"]`——只列了这张单改到的目录，
// 而那个仓的 typecheck/unit 扫全部 workspace，apps/agent 没装依赖。
// 这个错要烧掉一整轮判官真跑（3.5 分钟 + token）才看得见，而一次目录扫描就能说出来。
const 工作区 = require('../lib/workspace/worktree');

const 造仓 = (布局) => {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), '缺依赖-'));
  for (const [相对, 有nm] of Object.entries(布局)) {
    const d = path.join(根, 相对);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{}');
    if (有nm) fs.mkdirSync(path.join(d, 'node_modules'), { recursive: true });
  }
  return 根;
};

t('扫出「有 package.json 但没 node_modules」的包——把猜变成答案（协-035）', () => {
  const 根 = 造仓({
    'tooling': true, 'services/api': true,
    'apps/agent': false, 'apps/local-agent': false, 'apps/web': false,
  });
  const 缺 = 工作区.缺依赖目录(根, { fm: { 需要依赖: ['tooling', 'services/api'] } });
  // 正是 HW-4 那三个。顺序无关，按内容比。
  assert.deepEqual([...缺].sort(), ['apps/agent', 'apps/local-agent', 'apps/web']);
});

t('没声明 需要依赖 的单一个字都不报——绝大多数单都是这一类（协-035）', () => {
  // 纪律①：什么都没声明的单不打算跑命令，对它报「这十个包没装」纯属噪音。
  const 根 = 造仓({ 'apps/agent': false, 'services/api': false });
  assert.deepEqual(工作区.缺依赖目录(根, { fm: {} }), []);
  assert.deepEqual(工作区.缺依赖目录(根, {}), []);
});

t('不递归进 node_modules，也不把工作区自己算进去（协-035）', () => {
  const 根 = 造仓({ 'tooling': true });
  // node_modules 里全是带 package.json 的目录，扫进去既慢又全是废话。
  fs.mkdirSync(path.join(根, 'tooling', 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(根, 'tooling', 'node_modules', 'left-pad', 'package.json'), '{}');
  // 仓根自己有 package.json 也不报——它不是「漏装的包」，而且 需要依赖:true 指的就是它。
  fs.writeFileSync(path.join(根, 'package.json'), '{}');
  assert.deepEqual(工作区.缺依赖目录(根, { fm: { 需要依赖: ['tooling'] } }), []);
});

t('漏装的包要顶进「验不了」的喊人消息里，而不是让人猜（协-035）', () => {
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  const i = 执.indexOf("呼叫.急(账本根, '质检验不了'");
  assert.ok(i > 0);
  // 起点锚在「取扫描结果」那一行，不用固定字节数往前数：中间还会长出别的分叉
  // （协-036 的写权阻断就长在这里），按字节数量的窗口会被挤爆，而它挤爆时
  // 报的是「结果没端出来」——一句与事实相反的话。
  const j = 执.lastIndexOf('审阅区.可能缺依赖', i);
  assert.ok(j > 0 && j < i, '审阅区扫过的结果要端出来，且要在喊人之前就取好');
  const 段 = 执.slice(j, i + 1200);
  assert.match(段, /没有 node_modules/, '要指名道姓说是哪些包');
  assert.match(段, /需要依赖 要列全/, '扫全仓的验收命令是这个坑的成因，要一起说破');
  // 扫不出来也不能装作有答案——那会把人引去改一个没问题的地方。
  assert.match(段, /也可能是缺配置、缺服务或取材失败/);
});

t('写不了要走自己那一档，不许被「缺依赖」的话术吃掉（协-036）', () => {
  // HW-2：判官写不动审阅区，平台却告诉人「多半是工单要声明 需要依赖」。
  // 包一个不缺，补依赖对它零作用——这句猜测唯一的作用是把人送去查错方向。
  const 执 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  // 协-036 原断言钉的是路径参数；协-040 合法追加了 outputFormat 第三参。
  // 这里只允许路径之后继续传参，不是为了变绿而降低「必须传审阅区路径」的要求。
  assert.match(执, /抽写权阻断\(r\.输出, 审阅区 && 审阅区\.路径[,)]/, '判据要带上审阅区路径：区内区外的处置不同');
  const i = 执.indexOf("呼叫.急(账本根, '质检验不了'");
  const j = 执.indexOf("呼叫.急(账本根, '判官写不动审阅区");
  assert.ok(j > 0 && j < i, '写权阻断这一档必须排在泛泛的「验不了」之前，否则永远轮不到它');
  // 建审阅区时预授过一次；没授上就是最该先看的那一行。
  const w = fs.readFileSync(path.join(平台根, 'lib', 'workspace', 'worktree.js'), 'utf8');
  const 授 = w.indexOf('预授沙箱写权(path.resolve(target)');
  const 装 = w.indexOf('装依赖(path.resolve(target)');
  assert.ok(装 > 0 && 授 > 装, '要授的正是 npm 刚铺出来的那几万个文件，先授后装等于白授');
});

t('两条 prepare 路径都要扫——执行侧和判官侧各有一条（协-035）', () => {
  // 协-033 的教训：审阅区是**另一条 prepare 路径**，协-026 补了执行侧没补它。
  const w = fs.readFileSync(path.join(平台根, 'lib', 'workspace', 'worktree.js'), 'utf8');
  const 次数 = (w.match(/缺依赖目录\(/g) || []).length;
  assert.ok(次数 >= 3, `声明 1 次 + 两条路径各调 1 次，实得 ${次数}`);
  assert.match(w, /可能缺依赖 = 缺/, '结果要带回给调用方');
});

console.log('全部通过：' + passed + ' 项');
