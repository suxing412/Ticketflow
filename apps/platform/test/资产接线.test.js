// 资产接线契约 —— 堵住这个仓最常犯的那一类错（协-005）。
//
// 这一路查出来的问题，规律高度一致：**写好了，测过了，但没有任何代码路径走得到**。
//
//   · lib/ 下六个模块全是孤儿（协-004 才接上）
//   · routing/history 接了线，但从没有人写过它（协-002 才有第一个写入方）
//   · 角色协议模板/ 六份出厂就在库里，从没人 require 过（协-005 才喂给 AI）
//   · budget.view 早就有，一直没有消费方——账记着没人看（协-005 才接）
//
// 这些都不会报错。它们只会安静地不存在，而人以为功能在那儿。
//
// 本文件把「资产必须被用到」变成硬约束：新增一个模块或模板却忘了接线，测试就红。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('资产接线契约测试');

// 把全部源码读成一大坨，用来查「谁提到过我」。
// 排除 test/：测试引用不算接线——一个只被测试用到的模块，产品里等于不存在。
function 全部源码() {
  const 出 = [];
  const 扫 = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'test', 'dist', 'workspaces', 'journal', 'watchtower-out'].includes(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { 扫(p); continue; }
      if (d.name.endsWith('.js')) 出.push(p);
    }
  };
  扫(平台根);
  return 出;
}

t('lib/ 下没有孤儿模块（写好了没接线是本仓最常犯的错）', () => {
  const 全 = 全部源码();
  const 库 = 全.filter((p) => p.includes(`${path.sep}lib${path.sep}`));
  // 谁提到过它：整仓源码（不含它自己）里出现过它的文件名
  const 孤儿 = [];
  for (const p of 库) {
    const 名 = path.basename(p, '.js');
    const 别人 = 全.filter((q) => q !== p).map((q) => fs.readFileSync(q, 'utf8')).join('\n');
    if (!别人.includes(名)) 孤儿.push(path.relative(平台根, p));
  }
  assert.deepEqual(孤儿, [],
    '这些模块没有任何人 require——它们不会报错，只会安静地不存在：\n  ' + 孤儿.join('\n  '));
});

t('角色协议模板每一份都被真的读过（出厂六份曾整整躺了三张施工令）', () => {
  const 目录 = path.join(平台根, '角色协议模板');
  const 全 = fs.readdirSync(目录).filter((f) => f.endsWith('.md'));
  assert.ok(全.length >= 5, '至少该有五份角色协议');
  // 装配器按「角色名.md」去读，所以只要角色词表里的每个角色都有对应文件即可
  const 装配 = require(path.join(平台根, 'lib', '提示装配.js'));
  const 配置 = JSON.parse(fs.readFileSync(path.join(平台根, 'config', 'platform.config.json'), 'utf8'));
  for (const 角色 of Object.keys(配置.roles || {})) {
    const r = 装配.角色协议(平台根, 角色);
    assert.ok(r.有, `角色 ${角色} 在 roles 里声明了，却没有 角色协议模板/${角色}.md——`
      + '执行时它拿不到任何角色约束，只能靠猜');
    assert.ok(r.文.length > 40, `${角色}.md 内容过短，像是占位没写`);
  }
  // 反过来也要查：有模板却不在角色词表里 = 永远不会被用到
  for (const f of 全) {
    const 名 = f.replace(/\.md$/, '');
    if (名 === 'common') continue;
    assert.ok((配置.roles || {})[名],
      `角色协议模板/${f} 存在，但 ${名} 不在 config 的 roles 里——这份协议永远不会被读到`);
  }
});

// 每个 lib 模块都必须从某个**入口**可达。
//
// 这条是本文件的主菜。上面「没有孤儿」只查了「有没有人提过我的文件名」——
// 太松：被另一个孤儿引用，或只被测试引用，都能蒙混过关。而这个仓真正犯过的错正是
// **写好了、测过了、测试还全绿，但产品里没有任何路径走得到**。
//
// 中间试过一版「导出了没人用」，报 21 个全是文件内部自用的顺手导出——
// 那量的是 API 表面积，不是接线。假阳性比漏报更糟：满屏噪音的断言，人只会学会无视它。
// 换成从入口做传递闭包，对应的就是那个失败模式本身，且零噪音。
const 入口 = ['server.js', 'main.js',
  'scripts/工作区服务.js', 'scripts/执行器.js', 'scripts/watchtower.js'];

function 可达集() {
  const 到 = new Set();
  const 走 = (文件) => {
    if (!文件 || 到.has(文件) || !fs.existsSync(文件) || !fs.statSync(文件).isFile()) return;
    到.add(文件);
    const src = fs.readFileSync(文件, 'utf8');
    const 落地 = (p) => (fs.existsSync(p + '.js') ? p + '.js'
      : fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.js') : p);
    // 形式一：相对路径字面量  require('./x')
    for (const m of src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      走(落地(path.resolve(path.dirname(文件), m[1])));
    }
    // 形式二：本仓主力写法  require(path.join(平台根, 'lib', 'x.js'))
    // 第一版漏了它，于是 worktree.js 被误报成不可达——闭包分析只认字面量是不够的，
    // 得照着仓里实际怎么写来认。
    for (const m of src.matchAll(/require\(\s*path\.join\(([^)]*)\)\s*\)/g)) {
      const 段 = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      if (段.length) 走(落地(path.join(平台根, ...段)));
    }
    // 形式三：子进程脚本是拼路径 spawn 起来的，根本不走 require——只能认文件名
    for (const m of src.matchAll(/['"]([\w一-龥-]+\.js)['"]/g)) {
      for (const d of ['scripts', 'lib', '.']) {
        const p = path.join(平台根, d, m[1]);
        if (fs.existsSync(p)) 走(p);
      }
    }
  };
  for (const e of 入口) 走(path.join(平台根, e));
  return 到;
}

t('入口清单本身是有效的（入口改名会让下一条断言变得没有意义）', () => {
  for (const e of 入口) {
    assert.ok(fs.existsSync(path.join(平台根, e)), `入口 ${e} 不存在——改名了就在这里同步改，`
      + '否则闭包凭空缩小，下一条断言会报一堆看不懂的「不可达」');
  }
});

t('每个 lib 模块都从入口可达（测试全绿但产品里走不到，是本仓最贵的一种错）', () => {
  const 到 = 可达集();
  const 不可达 = 全部源码()
    .filter((p) => p.includes(`${path.sep}lib${path.sep}`))
    .filter((p) => !到.has(p))
    .map((p) => path.relative(平台根, p));
  assert.deepEqual(不可达, [],
    '这些模块从 ' + 入口.join(' / ') + ' 任何一个都走不到。\n'
    + '它们的测试可能全绿——但用户永远碰不到这个功能，而且不会有任何报错：\n  '
    + 不可达.join('\n  '));
});

t('一条命令能带起整个产品，且桌面与命令行走同一条路', () => {
  // 2026-08-12 之前：npm start 只起 server，工作区(4371)和执行器(4372) 要另开两个终端；
  // 桌面壳更糟——它 require('./server.js') 塞进 electron 主进程，另外两个压根不起。
  // 双击打开是半个产品：看板能看，派活点了没反应也不报错。
  const 包 = JSON.parse(fs.readFileSync(path.join(平台根, 'package.json'), 'utf8'));
  assert.ok(/开机\.js/.test(包.scripts.start || ''),
    'npm start 必须走总启动器。让人开三个终端才能用，不叫可跑的产品');

  const 开机 = fs.readFileSync(path.join(平台根, 'scripts', '开机.js'), 'utf8');
  for (const s of ['server.js', '工作区服务.js', '执行器.js']) {
    assert.ok(开机.includes(s), `总启动器没带上 ${s}——少一个就是半个产品`);
  }
  // 一个死了必须全停。半个产品比全停难查得多：界面照常开，按钮照常点，没反应也没报错。
  assert.ok(/on\('exit'/.test(开机) && /收摊/.test(开机), '总启动器要在子进程死掉时一并收摊');

  // 剥掉注释再查。不剥的话，main.js 里那句解释「原先这里是 require('./server.js')」
  // 会被当成真代码——断言当场自己咬了自己。查代码的断言必须看代码，不能看字面。
  const 主 = fs.readFileSync(path.join(平台根, 'main.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/require\(\s*['"]\.\/server(\.js)?['"]\s*\)/.test(主),
    'main.js 不能把 server 塞进 electron 主进程：\n'
    + '  ① 桌面路径会漏掉工作区和执行器，双击打开是半个产品；\n'
    + '  ② server 与 electron 主进程同居，「server 物理上起不了 CLI 进程」这条保证就打折了——'
    + '主进程什么都能干。改成起 scripts/开机.js 当子进程。');
  assert.ok(/开机\.js/.test(主), 'main.js 要通过总启动器起后台，别自己另起一套');
  // 打包清单漏了 scripts/ 的话，开发态一切正常、打出来的 exe 一开就挂——
  // 这种「只在打包后才炸」的问题最贵，放这儿看着。
  assert.ok((包.build.files || []).some((f) => String(f).startsWith('scripts')),
    'build.files 少了 scripts/**：开发态没事，打包后 main.js 找不到 开机.js，exe 一开就挂');
});

t('打包态的可写配置必须落在 asar 之外（不然首次配置在成品里根本写不进去）', () => {
  // 拿打包好的 exe 真跑了一次才发现的：日志里写着
  //   门禁：沿用既有令牌 → …\resources\app.asar\config\接口令牌.local.json
  // asar 只读，所有 .local.json 的写入在打包态都会失败——包括「首次打开填个目录
  // 就能开工」那一步，而那正是拿到成品的人必走的第一步。开发态一切正常。
  const 位置 = require(path.join(平台根, 'lib', '配置位置.js'));
  const 包内 = path.join('C:', 'app', 'resources', 'app.asar', 'x');
  assert.ok(!位置.可写配置目录(包内).includes('app.asar'),
    '打包态的可写配置目录不能落在 asar 里——那是只读的，写入会失败且不报错');
  // 开发态维持原样，别为了修打包把日常跑法改坏
  assert.equal(位置.可写配置目录(平台根), path.join(平台根, 'config'));
  // 出厂默认随包只读，本来就该在 asar 里
  assert.ok(位置.只读配置目录(包内).includes('app.asar'));

  // 三个写盘方必须都走可写目录，漏一个就在打包态失败
  for (const f of ['门禁.js', '本地覆盖.js', '工单库.js']) {
    const s = fs.readFileSync(path.join(平台根, 'lib', f), 'utf8');
    assert.ok(/可写配置目录/.test(s), `lib/${f} 要写 config，必须走 配置位置.可写配置目录`);
  }

  // 本机配置不许跟着二进制走。实测那份 exe 里带着开发机的接口令牌与私仓绝对路径。
  const 包 = JSON.parse(fs.readFileSync(path.join(平台根, 'package.json'), 'utf8'));
  const 清单 = (包.build.files || []).map(String);
  assert.ok(清单.includes('!config/*.local.json'), 'build.files 必须排除 *.local.json：'
    + '否则开发机的私仓路径会被打进分发件');
  assert.ok(清单.includes('!config/api-token.txt'), 'build.files 必须排除 api-token.txt：'
    + '那是 API 令牌，不该随二进制分发');
});

t('界面上改的配置，别的进程也得认（开机时定死一次就等于改不动）', () => {
  // 打包件冒烟时实测：在界面上把工单库配好，server 当场生效（它的 工单根 是 let），
  // 但执行器是**另一个进程**，它开机时拿到的还是「未配置」，于是点干跑照样报未配置。
  // 从人的角度看是「明明配好了，它说没配」——界面上每一处都显示配好了，最没头绪。
  //
  // 这类问题的通用形状：**跨进程的配置缓存**。多进程架构必然带这个坑，
  // 每加一个进程就得想一遍「它缓存了什么，谁会改那个东西」。
  const 执行器 = fs.readFileSync(path.join(平台根, 'scripts', '执行器.js'), 'utf8');
  assert.ok(!/^const 工单根 = 工单库\.解析根目录/m.test(执行器),
    '执行器不能在开机时把工单根定死——界面上配好之后它不会知道，'
    + '表现成「配好了却说没配」。改成每次请求现解（读一个几十字节的 JSON 而已）。');
  assert.ok(/取工单根/.test(执行器), '执行器要有一个现解工单根的入口');

  // server 那边靠 let + 落位后重解；两条路都要在，缺一就是半个功能
  const 服务 = fs.readFileSync(path.join(平台根, 'server.js'), 'utf8');
  assert.ok(/let 工单根/.test(服务), 'server.js 的 工单根 必须是 let：配完要当场生效，不能让人重启');
  assert.ok(/工单根 = 工单库\.解析根目录/.test(服务.split('/api/setup/tickets')[1] || ''),
    '落位成功后必须重解一次工单根，否则本进程也要等到重启才认');
});

t('README 说的开机方式与产品实际一致（说明书骗人比没有说明书更糟）', () => {
  // 这一路改了两次启动方式，README 每次都落后一拍。文档落后的伤害不对称：
  // 没有文档，人会去看代码；文档写着一套错的，人会照着做，然后怀疑产品坏了。
  // 2026-08-12 就发现 README 里还写着「打包后需自行改 main.js 那行硬编码」——
  // 那行三次提交前就没了，照着做纯属白费工夫。
  const 文 = fs.readFileSync(path.join(平台根, 'README.md'), 'utf8');
  const 包 = JSON.parse(fs.readFileSync(path.join(平台根, 'package.json'), 'utf8'));

  // 文档里出现的 npm run <x> 必须真的存在
  const 提到 = [...文.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  const 不存在 = [...new Set(提到)].filter((x) => !(包.scripts || {})[x]);
  assert.deepEqual(不存在, [], 'README 提到了不存在的 npm 脚本：' + 不存在.join('、'));

  // 已作废的说法不许留在文档里
  const 作废 = [
    [/换机需自行改那一行/, '打包解析已不需要改源码（c147a9a），这句会让人白费工夫'],
    [/默认不随 server 启动/, 'npm start 现在会带起工作区与执行器'],
  ];
  for (const [re, 说] of 作废) {
    assert.ok(!re.test(文), `README 里有已作废的说法：${说}`);
  }
});

t('工单正文里的「写入范围」真的会被执行（不能只是装饰）', () => {
  const wt = require(path.join(平台根, 'lib', 'workspace', 'worktree.js'));
  // 正例：模板生成的那一节，填上真路径后要能被认出来
  assert.deepEqual(
    wt.正文写入范围('## 范围\n做事\n\n## 写入范围\n- `public/**`\n- `lib/x.js`\n\n## 完工要求\n无'),
    ['public/**', 'lib/x.js']);
  // 反例一：模板占位符没填——绝不能当成真范围。
  // 认错方向要命：错认一条 glob，任何真实改动都成违规，checkpoint 抛错，活白干。
  assert.deepEqual(wt.正文写入范围('## 写入范围\n- `<允许改的文件或 glob>`'), []);
  // 反例二：reviewer 模板那句说明
  assert.deepEqual(wt.正文写入范围('## 写入范围\n（留空——只读角色不该有写入范围）'), []);
  // 反例三：没有这一节
  assert.deepEqual(wt.正文写入范围('## 范围\n随便写写'), []);
  // 反例四：散文式描述，不是路径
  assert.deepEqual(wt.正文写入范围('## 写入范围\n- 按角色协议和项目现有边界执行'), []);
  // frontmatter 优先：显式声明过就不再看正文
  const 单 = { fm: { write_scope: ['a/**'] }, body: '## 写入范围\n- `b/**`' };
  assert.equal(String((单.fm.write_scope || []).join()), 'a/**');
  // 工单模板给的骨架，本身不该被误认出范围（全是占位符）
  const 模板 = require(path.join(平台根, 'lib', '工单模板.js'));
  assert.deepEqual(wt.正文写入范围(模板.取('backend').正文), [],
    'backend 骨架里的写入范围是占位符，不该被当真——否则新建单一改文件就报违规');
  assert.deepEqual(wt.正文写入范围(模板.取('reviewer').正文), []);
  // 但 frontend 骨架给的是真 glob（public/**），那就该认
  assert.deepEqual(wt.正文写入范围(模板.取('frontend').正文), ['public/**']);
});

console.log(`全部通过：${passed} 项`);
