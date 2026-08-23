// buildstamp.test.js — 活体码印 + G15「活体落后源码」（2026-08-21 立，当天四犯之后）
// 案源：一天之内四次「源码改了、跑着的还是旧的」，而没有任何东西提醒——
//   ① draft 项目透传改完即发委托 → 单落成 TK-183（该是 TF）
//   ② 待办加项目字段 → 回填 122 条 **全拒**，台账白添 122 行拒绝事件
//   ③ specials 收口自检改完 → S-3 复工 20 秒后又被推回收口
//   ④ 更早：脚本打印「成功」，文件其实一个字没改
// 它比「起不来」更坏：界面能开、接口能通、测试全绿，只是跑的不是你以为的那份代码。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const bs = require('../lib/buildstamp');
const gr = require('../lib/gatereg');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('活体码印 + G15 测试');

// 造一份「代码树」：只放参与指纹的那几类文件
const 造码树 = (o = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'code-'));
  fs.mkdirSync(path.join(d, 'lib', 'pm'), { recursive: true });
  fs.mkdirSync(path.join(d, 'public'), { recursive: true });
  fs.writeFileSync(path.join(d, 'server.js'), o.server || 'a', 'utf8');
  fs.writeFileSync(path.join(d, 'lib', 'x.js'), o.libx || 'b', 'utf8');
  fs.writeFileSync(path.join(d, 'lib', 'pm', 'y.js'), o.liby || 'c', 'utf8');
  fs.writeFileSync(path.join(d, 'public', 'app.js'), o.app || 'd', 'utf8');
  fs.writeFileSync(path.join(d, 'public', 'style.css'), o.css || 'e', 'utf8');
  // 出货文件（2026-08-22 补进收录）：三者都在 package.json 的 build.files 里
  fs.writeFileSync(path.join(d, 'main.js'), o.main || 'm', 'utf8');
  fs.writeFileSync(path.join(d, 'preload.js'), o.preload || 'p', 'utf8');
  fs.writeFileSync(path.join(d, 'public', 'index.html'), o.html || 'h', 'utf8');
  fs.writeFileSync(path.join(d, 'README.md'), o.readme || '文档随便改', 'utf8'); // 不参与指纹
  fs.mkdirSync(path.join(d, 'node_modules', 'junk'), { recursive: true });
  fs.writeFileSync(path.join(d, 'node_modules', 'junk', 'z.js'), 'noise', 'utf8'); // 不参与指纹
  return d;
};

t('同内容同指纹；改一个字节即变（这是整条判据的地基）', () => {
  const a = 造码树(); const b = 造码树();
  assert.equal(bs.指纹(a).指纹, bs.指纹(b).指纹, '两棵内容相同的树必须同指纹');
  fs.writeFileSync(path.join(b, 'lib', 'pm', 'y.js'), 'c2', 'utf8');
  assert.notEqual(bs.指纹(a).指纹, bs.指纹(b).指纹, '深层目录里改一个字节也要变');
});

t('只收会影响行为的文件：改文档/改 node_modules 不算漂移', () => {
  const a = 造码树();
  const 前 = bs.指纹(a).指纹;
  fs.writeFileSync(path.join(a, 'README.md'), '改了一大段文档', 'utf8');
  fs.writeFileSync(path.join(a, 'node_modules', 'junk', 'z.js'), 'noise2', 'utf8');
  assert.equal(bs.指纹(a).指纹, 前, '每改一行注释就报一次警，警报就废了');
});

t('CRLF/LF 差异不算漂移（同一份代码，换行符不改变行为）', () => {
  const a = 造码树({ server: 'x\ny\nz' });
  const b = 造码树({ server: 'x\r\ny\r\nz' });
  assert.equal(bs.指纹(a).指纹, bs.指纹(b).指纹);
});

t('无从判断一律不报债：没配源码路径 / 源码树不可读', () => {
  assert.equal(bs.比对({}).一致, true, '部署方没有源码树是正常态，不是欠债');
  assert.equal(bs.比对({ 源码路径: path.join(os.tmpdir(), '根本不存在的树-' + Date.now()) }).一致, true);
  assert.equal(bs.指纹(path.join(os.tmpdir(), '不存在-' + Date.now())), null, '收不到文件返 null，不拿空串冒充');
});

t('真打红的那一格：活体旧、源码新 → 判不一致并报出两枚指纹', () => {
  const 活 = 造码树();
  const 源 = 造码树();
  fs.writeFileSync(path.join(源, 'lib', 'x.js'), 'b-改过了', 'utf8'); // 源码往前走了一步
  const r = bs.比对({ 源码路径: 源 }, 活);
  assert.equal(r.一致, false, '这一格红不了，整条判据就是摆设');
  assert.match(r.因, /活体 [0-9a-f]{12}.*≠ 源码 [0-9a-f]{12}/, '因里要带两枚指纹，一眼看得出差在哪边');
  assert.equal(bs.比对({ 源码路径: 活 }, 活).一致, true, '同码即一致（开发态从源码直跑，天然免疫）');
});

t('源码改动时刻取 mtime 不取 git 提交时刻（没提交的改动同样让活体过时）', () => {
  const 源 = 造码树();
  const iso = bs.源码改动时刻({ 源码路径: 源 });
  assert.ok(iso && !Number.isNaN(Date.parse(iso)));
  assert.equal(bs.源码改动时刻({}), null, '没配即 null');
});

/* ────────────────────────────────────────────────────────────────────────
   2026-08-22 体检 #0/#2/#8/#10/#39：G15 这条闸自己没上过活体。
   下面三格分别盯：收录面（漏了出货文件 = 那类改动报不出来）、
   债龄（停摆自取最新 mtime = 债龄被自己刷新回零，永远升不了格）、
   生产接线（deps默认 一个桩都不注地真跑一遍 等我()）。
   ──────────────────────────────────────────────────────────────────────── */

t('收录覆盖全部出货文件：只改 main.js / preload.js / index.html 也要判不一致', () => {
  // 案源：原样收录只有 lib/**.js + server.js + public/app.js + public/style.css。
  // 而 package.json 的 build.files 里还有 main.js、preload.js、public/**——
  // 「只改了 main.js 的单实例锁就重打包」这一类，G15 原样一个字都报不出来。
  const 出货 = require('../package.json').build.files;
  for (const [名, 改] of [['main.js', { main: 'm2' }], ['preload.js', { preload: 'p2' }],
    ['public/index.html', { html: 'h2' }]]) {
    const 活 = 造码树(); const 源 = 造码树(改);
    assert.equal(bs.比对({ 源码路径: 源 }, 活).一致, false, `只差 ${名} 也必须判不一致——它随包出货，改了就改行为`);
  }
  // 收录里的每一项都得真在出货清单的射程里，别收一个根本不进包的文件
  const 收录文件 = bs.收录.filter((x) => x.文件).map((x) => String(x.文件).replace(/\\/g, '/'));
  for (const f of 收录文件) {
    const 命中 = 出货.some((g) => g === f || (g.endsWith('/**') && f.startsWith(g.slice(0, -3) + '/')));
    assert.ok(命中, `收录了 ${f}，但它不在 package.json build.files 里——包里没有的文件不该参与码印`);
  }
  assert.ok(收录文件.includes('main.js') && 收录文件.includes('preload.js') && 收录文件.includes('public/index.html'),
    '三件出货文件都要在收录里，实测：' + 收录文件.join('、'));
});

t('停摆自 = 最早漂移那一件的时刻，不是全树最新（取最新＝债龄被自己刷新回零）', () => {
  // 案源：G15 的升格链整条挂在债龄上（逾期阈值 T 小时 → 人闸升格）。
  // 原样取全树最新 mtime：源码里随便再动一个无关文件，停摆自就往前跳一次，
  // 于是这条债**永远不满一小时**，永远升不了格——报了跟没报一样。
  const 活 = 造码树();
  const 源 = 造码树();
  const 老 = new Date('2026-08-01T00:00:00Z');
  const 新 = new Date('2026-08-22T00:00:00Z');
  // 老文件真漂移（内容与活体不同），新文件只是后改了 mtime、内容仍与活体一致
  fs.writeFileSync(path.join(源, 'lib', 'x.js'), 'b-八月一号就改了', 'utf8');
  fs.utimesSync(path.join(源, 'lib', 'x.js'), 老, 老);
  fs.utimesSync(path.join(源, 'server.js'), 新, 新);      // 内容没变，只是被 touch 了
  fs.utimesSync(path.join(源, 'public', 'app.js'), 新, 新);
  // **两侧都要造反例**：再放一件内容与活体一致、但 mtime 比真漂移那件**还早**的文件。
  // 少了它，「只取最早、不筛漂移」这种半吊子改法照样能蒙混过关（本判据第一版就漏了这个）。
  const 更早 = new Date('2026-07-01T00:00:00Z');
  fs.utimesSync(path.join(源, 'public', 'style.css'), 更早, 更早);

  const iso = bs.源码改动时刻({ 源码路径: 源 }, 活);
  assert.equal(iso, 老.toISOString(),
    '停摆自要指向最早那件真漂移（' + 老.toISOString() + '），实测 ' + iso
    + '——取全树最新会指到 ' + 新.toISOString() + '，债龄当场归零');
  // 内容一致的文件被 touch 一百次也不许影响债龄
  fs.utimesSync(path.join(源, 'lib', 'pm', 'y.js'), new Date('2026-08-23T00:00:00Z'), new Date('2026-08-23T00:00:00Z'));
  assert.equal(bs.源码改动时刻({ 源码路径: 源 }, 活), 老.toISOString(), '再 touch 一件无关文件，债龄不许跟着跳');
});

t('G15 生产接线：deps默认（一个桩都不注）跑 等我()，G15 不许进失败名单', () => {
  // 案源：G15 的逻辑判据全都靠注桩（deps.码印 注进去），于是
  // **deps默认 里那一行 `码印: require('./buildstamp')` 掉了也没人知道**——
  // 判据自己把它替掉了。复核实测：删掉那整行，26 项判据全绿。
  // 这一格什么都不注，让 等我() 走生产那条路，判据抛异常就会落进 失败 名单。
  const root = makeRoot();
  const r = gr.等我(root);
  assert.deepEqual(r.失败.filter((f) => f.闸号 === 'G15'), [],
    'G15 判据在生产接线下抛异常＝哨兵静默死（等我() 把异常吞进 失败 名单，界面上一点看不出来）');
  assert.deepEqual(r.失败, [], '顺带：一条闸都不许在生产接线下抛异常，实测失败名单：' + JSON.stringify(r.失败));
  assert.ok(r.注册.some((g) => g.闸号 === 'G15'), 'G15 要在注册表里');
});

t('应用之外的对拍：工具/换装核验.js 的 对拍() 真喂数能红（不许拿 G15 自证）', () => {
  // G15 装在活体里，活体旧的时候它必然缺席——缺席不报错、只静默。
  // 自举缺陷靠自己补不上，故留一条住在包外的对拍（源码闸数 vs 活体 /api/attn 注册数）。
  const { 对拍 } = require('../工具/换装核验');
  assert.equal(对拍(18, 15).一致, false, '18 ≠ 15 必须判不一致——这就是「活体少了三条闸」的样子');
  assert.match(对拍(18, 15).因, /源码 18 ≠ 活体 15/, '因里要把两个数都报出来：' + 对拍(18, 15).因);
  assert.equal(对拍(18, 18).一致, true, '相等才算过');
  // 取不到数一律判不一致：静默当成通过，等于这条兜底自己也变成瞎的
  for (const 坏 of [NaN, 0, null, undefined, '不是数']) {
    assert.equal(对拍(18, 坏).一致, false, `活体闸数取不到（${String(坏)}）时不许当成通过`);
    assert.equal(对拍(坏, 18).一致, false, `源码闸数取不到（${String(坏)}）时不许当成通过`);
  }
  // 它盯的必须是**真**注册表的条数，不是一个抄下来的常数
  assert.equal(对拍(gr.缺省注册表.length, gr.缺省注册表.length).一致, true);
  assert.equal(对拍(gr.缺省注册表.length, gr.缺省注册表.length - 1).一致, false, '少一条闸就该红');
});

t('G15 接进闸注册表：不一致才成债，归属总监不占制作人版面', () => {
  const root = makeRoot();
  const 活 = 造码树(); const 源 = 造码树();
  const 空 = { specials: { list: () => [] }, ideas: { list: () => [] }, schedule: { 现态: () => [] },
    wiki: { pending: () => [] }, 值守: { 班档目录: (r) => path.join(r, '__无__'), 瞭望塔目录: (r) => path.join(r, '__无__') } };
  const 注 = (源路径) => ({ ...空, 配置: () => ({ 源码路径: 源路径 }),
    码印: { 比对: (cfg) => bs.比对(cfg, 活), 源码改动时刻: bs.源码改动时刻 } });

  assert.ok(gr.缺省注册表.some((g) => g.闸号 === 'G15'), 'G15 在册');
  assert.equal(gr.等我(root, { deps: 注(活) }).债.filter((d) => d.闸号 === 'G15').length, 0, '同码零债');

  fs.writeFileSync(path.join(源, 'server.js'), 'a-改过了', 'utf8');
  const r = gr.等我(root, { deps: 注(源) });
  const g15 = r.债.find((d) => d.闸号 === 'G15');
  assert.ok(g15, '源码走在前面就该成债');
  assert.equal(g15.归属, '总监', '换装是总监的活，不占制作人版面');
  assert.match(g15.title, /活体落后源码/);
  assert.equal(gr.等我(root, { deps: 注(源), 归属: '制作人' }).债.filter((d) => d.闸号 === 'G15').length, 0);
});

console.log('全部通过：' + passed + ' 项');
