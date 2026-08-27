// 接线契约测试 — 钉住「lib/ 里的模块有没有真的接到接口上」。
//
// 为什么单开一份：公用件契约测试管的是「我们消费 packages/ 的那一面」，
// 这份管的是「本仓自己的模块有没有被用起来」。2026-08-10 清点发现 lib/ 下六个模块
// 全是孤儿——写好了、测过了、一个都没接线，server.js 从头到尾只 require 了 4 个东西。
// 孤儿模块不会报错，只会安静地不存在，所以必须有断言盯着。
'use strict';
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const ta = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('接线契约测试');

const 平台根 = path.resolve(__dirname, '..');
const 源 = fs.readFileSync(path.join(平台根, 'server.js'), 'utf8');

// 令牌由服务开机时落盘，测试从同一处读——不另起一套真相。
// 必须**每次现读**：服务是子进程起的，文件可能在本测试加载之后才生成。
const 门禁令牌 = () => JSON.parse(fs.readFileSync(path.join(平台根, 'config', '接口令牌.local.json'), 'utf8')).令牌;

// ---- 这条是本文件的核心：桩模式的物理保证 ----
// server.js 声称「本文件不引入 child_process，任何路径都发不起真实 CLI 进程，零计费」。
// 这个承诺不能只靠自觉——接线时随手 require 一个带 child_process 的模块就破了，
// 而且破了不会有任何报错，只会在某天真的把钱花出去。故做**传递闭包**检查。
t('桩模式物理保证：server.js 的依赖闭包里没有 child_process', () => {
  const 已看 = new Set();
  const 违规 = [];
  const 走 = (文件) => {
    if (已看.has(文件)) return;
    已看.add(文件);
    let src;
    try { src = fs.readFileSync(文件, 'utf8'); } catch { return; }
    // 只认真正的 require，注释里提到这个词不算
    for (const m of src.matchAll(/require\(\s*'([^']+)'\s*\)/g)) {
      const 目标 = m[1];
      if (目标 === 'child_process' || 目标 === 'node:child_process') {
        违规.push(`  ${path.relative(平台根, 文件)} 引入了 ${目标}`);
        continue;
      }
      if (!目标.startsWith('.')) continue;                 // 其余内置/三方模块不追
      const 解析 = path.resolve(path.dirname(文件), 目标);
      走(fs.existsSync(解析 + '.js') ? 解析 + '.js' : 解析);
    }
  };
  走(path.join(平台根, 'server.js'));
  assert.deepEqual(违规, [], '桩模式已被破坏——server.js 现在能起真实进程了：\n' + 违规.join('\n'));
});

// ---- 隔离是否成立 ----
// 接 worktree 的方案不是「给断言开例外」，而是把 git 能力挪出 server 的进程。
// 所以上面那条断言一个字都没改，依旧要求 server.js 闭包零 child_process。
// 这两条守的是隔离本身：worktree 必须只被隔离进程持有，且隔离进程必须真的隔离。
t('worktree 只被隔离进程持有，server.js 碰不到它', () => {
  assert.ok(!/require\([^)]*workspace\/worktree/.test(源.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')),
    'server.js 不得直接 require worktree——它引 child_process，读 git 状态一样要 spawn，'
    + '「只接只读函数」绕不开这条。走 http 转发给 scripts/工作区服务.js。');
  const 服务源 = fs.readFileSync(path.join(平台根, 'scripts', '工作区服务.js'), 'utf8');
  assert.ok(/workspace['\\/]+worktree/.test(服务源), '隔离进程应当是持有 worktree 的那一个');
});

t('驾驶舱脚本语法必须合法（坏了整页只显示「读取中」）', () => {
  // 2026-08-11 踩到：用脚本改 HTML 时把 '\n' 写成了真换行，字符串断在半路。
  // 后果特别隐蔽——页面**照常渲染**，只是所有数据永远停在「读取中…」，
  // 因为整段脚本根本没执行。不看控制台就以为是后端没响应。
  //
  // 2026-08-12 起脚本外置成 public/app.js（内联脚本正是上面那个坑的温床），
  // 断言跟着搬家。
  const 脚本 = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  assert.doesNotThrow(() => new Function(脚本), 'app.js 语法错——整页会静默停在「读取中」');
});

t('首页引用的静态资源必须真的存在（404 的 css 不会报错，只会让页面变丑）', () => {
  // 漏发一个 css/js 不会有任何报错：浏览器静默 404，页面照常渲染，只是没有样式。
  // 这类问题肉眼看「好像哪里不对」但说不出所以然，所以让断言去数。
  const 页 = fs.readFileSync(path.join(平台根, 'public', 'index.html'), 'utf8');
  const 引用 = [...页.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    .filter((u) => !/^https?:|^data:|^#/.test(u));
  assert.ok(引用.length >= 2, '至少该引用 style.css 与 app.js');
  for (const u of 引用) {
    assert.ok(fs.existsSync(path.join(平台根, 'public', u)), `首页引用了不存在的资源：${u}`);
  }
});

t('每个刷新函数都真的被调用（写好了没人调，整页停在「读取中」）', () => {
  // 2026-08-12 协-007 踩到：开机段被一次整块剪切的正则改动抹掉了七个刷新调用，
  // 只剩 刷项目 + 切页。页面语法完全合法、接口全通、控制台没有任何报错——
  // 就是所有区块永远停在「读取中…」。人会去查服务端、端口、门禁，全都对。
  //
  // 这跟 lib 的孤儿模块是同一个病：**写好了，但没有任何代码路径走得到**。
  // 只是这次孤儿是个函数，而且症状比报错更隐蔽——它长得像「还在加载」。
  const 脚本 = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  // 剥注释：解释「原先这里调用 刷X()」的文档注释不该算数
  const 代码 = 脚本.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const 定义 = [...代码.matchAll(/(?:async\s+)?function\s+(刷[\w一-龥]+)\s*\(/g)].map((m) => m[1]);
  assert.ok(定义.length >= 5, '应当有一批 刷X 函数，实得 ' + 定义.length);
  const 没人调 = 定义.filter((名) => {
    // 调用位置：刷X( … ) 或作为回调传参（setInterval(刷X, …)、$('x').onchange = 刷X）
    // `(?<!function\s)` 已经把定义那一行排除掉了，所以命中一次就算被调用过。
    // 第一版在这之外又减了一次「自身定义」，等于要求调用两次以上——
    // 只被调一次的 刷providers / 刷知识分区 当场被误报。
    // 假阳性比漏报更糟：满屏噪音的断言，人只会学会无视它。
    const 调 = new RegExp(`(?<!function\\s)(?<![\\w一-龥])${名}\\s*[(,;)\\n]`, 'g');
    return (代码.match(调) || []).length === 0;
  });
  assert.deepEqual(没人调, [],
    '这些刷新函数没有任何调用点——页面会永远停在「读取中」，且不报任何错：\n  ' + 没人调.join('\n  '));

  // 开机段必须在文件最后：上面用到的模块级 const/let 不会像函数声明那样提升，
  // 放在它们前面会撞暂时性死区，抛 ReferenceError 又被各自的 catch 吞成「接口不可达」。
  const 开机位 = 代码.lastIndexOf('(async () => {');
  const 末常量 = Math.max(代码.lastIndexOf('\nconst '), 代码.lastIndexOf('\nlet '));
  assert.ok(开机位 > 末常量,
    '开机段必须排在所有模块级 const/let 之后（暂时性死区），现在它在前面');
});

t('页面里用到的类名，样式表里必须真的定义过（类名对不上不会报错，只会看着不像能点）', () => {
  // 2026-08-12 实测踩到：样式层是从 studio 抄的，它的 reset 把 button 剥光
  // （background:none;border:none），再靠 class="btn" 补回外观。而本产品 index.html 里
  // **7 个按钮一个都没写 btn**，动态生成的那批倒是写了。结果整页按钮渲染成纯文字：
  // 能点，但看不出能点。token 一个没错，错在标记用的类和样式认的类不是一套。
  //
  // 抄样式最容易漏的就是这个，而它不产生任何错误信号——只能靠断言去对。
  const 页 = fs.readFileSync(path.join(平台根, 'public', 'index.html'), 'utf8');
  const 脚 = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  const 样 = fs.readFileSync(path.join(平台根, 'public', 'style.css'), 'utf8');
  const 用到 = new Set();
  for (const 源 of [页, 脚]) {
    for (const m of 源.matchAll(/class=\\?["']([^"'\\]+)/g)) {
      for (const c of m[1].split(/\s+/)) if (c) 用到.add(c);
    }
  }
  // 用边界匹配，不能用 includes：`.数` 会被样式表里的 `.数卡` 蒙混过关——
  // 而 `.数` 其实只在 `.数卡` 后代选择器里生效，标记里根本没有 `.数卡`，等于没定义。
  // 这个假阴性是当场撞见的，写在这里免得有人图省事再改回 includes。
  const 缺 = [...用到].filter((c) => {
    const 词 = new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w一-龥-])');
    return !词.test(样);
  });
  assert.deepEqual(缺, [], '这些类名在页面里用了，样式表里却没有——写了等于没写：\n  ' + 缺.join('\n  '));

  // 反过来守一道：裸 <button> 必须也能长成按钮。
  // 光查类名存在还不够——index.html 里写的就是裸 button，一个类都没有，
  // 上面那条查不出来。这条盯的是「有没有人管没写类的按钮」。
  assert.ok(/button:not\(\.gear\)|^button\s*\{[^}]*border\s*:\s*1px/m.test(样),
    '样式表把 button 给 reset 了，却没有任何规则让裸 <button> 恢复成按钮外观。'
    + `index.html 里现在有 ${(页.match(/<button(?![^>]*class=)/g) || []).length} 个裸 button，它们会渲染成纯文字。`);
});

t('令牌生成必须原子：三个进程同时首启，只能有一个令牌', () => {
  // 首次安装是三个进程**同时**启动的（开机.js 一起拉起 server/工作区/执行器）。
  // 原先它们都发现文件不存在，各自生成、各自写盘，最后落盘的覆盖前面的，
  // 而每个进程内存里还捧着自己那份。
  //
  // 实测（打包件首次安装，2026-08-13）：磁盘上的令牌对 4371、4372 有效，
  // **唯独对 4370 无效**——界面能打开（首页令牌是发页时注入的），
  // 但任何命令行调用一律 401，而 config 里那份看上去完全正常。
  const 门禁 = require(path.join(平台根, 'lib', '门禁.js'));
  const os = require('os');
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  try {
    // 同一个根连取三次 = 模拟三个进程抢同一个文件。第一次建，后两次必须让位。
    const a = 门禁.取令牌(根);
    const b = 门禁.取令牌(根);
    const c = 门禁.取令牌(根);
    assert.equal(a.新建, true, '第一次该是新建');
    assert.equal(b.令牌, a.令牌, '第二个进程拿到了不同的令牌——它会对不上另外两个');
    assert.equal(c.令牌, a.令牌, '第三个进程同上');
    // 明文副本也要是同一个值：命令行调用读的正是它
    const 明文 = fs.readFileSync(path.join(根, 'config', 'api-token.txt'), 'utf8').trim();
    assert.equal(明文, a.令牌, '明文副本与生效令牌不一致——命令行调用会 401');
  } finally { fs.rmSync(根, { recursive: true, force: true }); }

  // 写盘用的必须是 wx（独占创建）。用默认的 w 就是「后写的覆盖先写的」，
  // 那正是这个 bug 的成因。
  const 源 = fs.readFileSync(path.join(平台根, 'lib', '门禁.js'), 'utf8');
  assert.ok(/flag: 'wx'/.test(源), "令牌写盘必须用 flag:'wx'——默认的 w 会互相覆盖");
  assert.ok(/EEXIST/.test(源), '抢输的进程要读赢家写的那份，不能用自己的');
});

t('不许用原生 alert / confirm（阻塞整页，且长得像浏览器报错）', () => {
  // 原生弹窗有四个硬伤，每一个都在削弱「这是个软件」的感觉：
  //   ① 阻塞整个页面，后台刷新全停；
  //   ② 长得跟浏览器报错一模一样，成功提示也像出事了；
  //   ③ 标题栏写着「127.0.0.1 显示」——像个网页脚本；
  //   ④ **不能排版**。而本产品的确认文案里有「订阅额度 / 会计费」这种
  //      必须一眼分得清的信息，挤成一坨纯文本等于没写。
  const 脚 = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  // 剔注释：讲这条规矩的注释本身会提到这两个词
  const 码 = 脚.split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const 坏 of ['alert(', 'confirm(']) {
    assert.ok(!码.includes(坏), `app.js 里还有原生 ${坏}——改用 吐() / 问()`);
  }
  assert.ok(/function 吐\(/.test(脚) && /function 问\(/.test(脚), '替代品要在：吐() 与 问()');
});

t('危险色只给真会多花钱的确认框（红色泛滥就不再是信号）', () => {
  const 脚 = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  // 402 计费同意：全站唯一真正要问钱的地方，必须是危险样式
  const 计费段 = (脚.match(/需同意计费[\s\S]{0,600}/) || [''])[0];
  assert.ok(/危险: true/.test(计费段), '「改用 API 计费」那个确认框必须是危险样式');
  assert.ok(/不花这笔钱/.test(计费段), '取消键的字面要说清后果，不能只写「取消」');
  // 批量投出不花钱，不该标红
  const 投出段 = (脚.match(/把这 ' \+ 单\.length \+ ' 张草稿投出[\s\S]{0,400}/) || [''])[0];
  assert.ok(!/危险: true/.test(投出段), '批量投出只是流转，不该走危险样式');
  assert.ok(/不调用任何 AI/.test(投出段), '要明说它不花钱，否则人会以为批量=批量花钱');
});

t('增量刷新的临时容器必须是 <template>（div 会把表格标签吃掉）', () => {
  // 往 <div> 里塞 `<tr>…</tr>`，HTML 解析器**直接把表格标签丢掉**，只留里面的
  // a/span/button——这是规范行为（表格元素只在表格上下文里合法），**不报任何错**。
  // 于是 tbody 被填成一堆散节点，整张表塌成流式文本。
  // 实测在窄屏截图上看到：工单表变成一坨挤在一起的胶囊，而 DOM 里一个 <tr> 都没有。
  const 脚 = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  const 段 = (脚.match(/function 换\(目标, html\)[\s\S]*?\n\}/) || [''])[0];
  assert.ok(段, '找不到增量刷新函数');
  assert.ok(/createElement\('template'\)/.test(段),
    '临时容器不是 <template>——渲染 <tr> 时表格标签会被静默吃掉');
  assert.ok(!/createElement\('div'\)/.test(段), '用 div 当临时容器会把表拆平');
  assert.ok(/临\.content/.test(段), '要把 template.content 交给比对，不是 template 本身');
});

t('空态要给下一步，不能只说「没有」', () => {
  // 空态是**第一次打开时唯一看得见的东西**。一句「还没有工单」把这个位置浪费掉了——
  // 那一刻人最需要知道的是「那我该干什么」。
  const 脚 = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  assert.ok(/function 空态\(/.test(脚), '要有空态卡助手');
  const 段 = (脚.match(/空态\('还没有工单'[\s\S]{0,600}/) || [''])[0];
  assert.ok(段, '看板空态还在用一句干巴巴的文字');
  assert.ok(/建第一张单/.test(段), '空态要给一个能点的下一步');
});

t('每条向外发的请求都得把 body 送到（少一手就静默丢 body）', () => {
  // 2026-08-10 实测踩到：/api/workspace/* 那条写的是裸 代理.end()，**请求体被整个丢掉**，
  // 于是经 server 调任何 /write/* 都收到空 body，报「项目(空)不在注册表里」。
  // 之前没暴露，是因为执行器直连 4371 绕过了 server——这条路径压根没人走过。
  //
  // 送到的方式有两种，都算数：透传（把进来的请求 pipe 过去）、
  // 自组装（本进程自己攒一份 body 再 write，比如遗留回收要先读工单库）。
  // 只认 pipe 会把后一种误判成漏 body——而真正要守的是**body 到没到**。
  const 转发块 = 源.split('http.request(').slice(1);
  assert.ok(转发块.length >= 2, '应有工作区与执行器两条转发');
  for (const 块 of 转发块) {
    const 片 = 块.slice(0, 1400);
    // GET 探针没有 body 可送（协-019 的 /api/ready 要探另外两个进程的 /health）。
    // 要守的是「**该送的 body 送到没有**」，不是「每个 http.request 都得写一次 write」——
    // 把一个天生无体的 GET 判成漏 body，会逼人为了过测试去发一个空 body，那才是坏事。
    // 判据收得很紧：显式 method:'GET' 且整块里根本没有组装过 body。
    if (/method:\s*'GET'/.test(片) && !/Content-Length|JSON\.stringify\(体/.test(片)) continue;
    assert.ok(/req\.pipe\(代理\)/.test(片) || /代理\.write\(/.test(片),
      '向外发请求必须把 body 送过去（透传用 req.pipe，自组装用 代理.write）；'
      + '裸的 代理.end() 会静默丢掉请求体：\n' + 片.slice(0, 260));
  }
});

t('隔离进程自己要有门禁与路径闸（它是唯一能起 git 的地方）', () => {
  const 服务源 = fs.readFileSync(path.join(平台根, 'scripts', '工作区服务.js'), 'utf8');
  assert.ok(/门禁\.校验/.test(服务源), '隔离进程必须自己校验令牌——不能靠「只有 server 会调它」这种假设');
  assert.ok(/路径越界/.test(服务源), '必须有路径闸：否则带令牌的调用方可以拿 dir 把本机 git 仓库探个遍');
  assert.ok(/允许写/.test(服务源), '写操作必须有独立开关，不随服务启动一起获得');
});

t('lib/ 下的模块要么被接线，要么在 server.js 里写明为何不接', () => {
  const 模块 = [];
  const 扫 = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { 扫(p); continue; }
      if (d.name.endsWith('.js')) 模块.push(path.relative(path.join(平台根, 'lib'), p).replace(/\\/g, '/'));
    }
  };
  扫(path.join(平台根, 'lib'));

  const 漏网 = [];
  for (const m of 模块) {
    const 无后缀 = m.replace(/\.js$/, '');
    const 短名 = 无后缀.split('/').pop();
    const 接线了 = 源.includes(`./lib/${无后缀}`);
    // 没直接接线的，必须是下面两种**正当状态**之一，否则就是"忘了"而不是"决定"：
    //   · 在 server.js 头部被点名交代为何不接
    //   · 被挪进隔离进程持有（worktree 走的就是这条：它引 child_process，
    //     只能靠进程隔离，不能靠给断言开例外）
    const 交代了 = new RegExp(`(${短名}|${无后缀})[^\\n]*不接`).test(源);
    // 「被某个隔离进程持有」是正当归宿。原先这里把隔离进程写死成工作区服务一个，
    // 加了执行器之后就不成立了——改成扫 scripts/ 下全部进程，谁持有都算。
    const 被隔离进程持有 = fs.readdirSync(path.join(平台根, 'scripts'))
      .filter((f) => f.endsWith('.js'))
      .some((f) => fs.readFileSync(path.join(平台根, 'scripts', f), 'utf8').includes(短名));
    const 隔离了 = new RegExp(`(${短名}|${无后缀})[^\\n]*(独立进程|隔离)`).test(源) && 被隔离进程持有;
    // 被另一个 lib 模块引用同样是正经接线。这条原先没有，于是
    // lib/配置位置.js 一加进来就被判成孤儿——它被 门禁/本地覆盖/工单库 三家引着，
    // 只是不被 server.js 直接引。「只认 server.js 直接引」把底层工具模块全判成孤儿了。
    // 真正的可达性由 test/资产接线.test.js 的入口闭包守，那条不看引用形式，看能不能走到。
    const 被别的库引 = fs.readdirSync(path.join(平台根, 'lib'), { recursive: true })
      .filter((f) => String(f).endsWith('.js') && !String(f).endsWith(m.replace(/\//g, path.sep)))
      .some((f) => fs.readFileSync(path.join(平台根, 'lib', String(f)), 'utf8').includes(短名));
    if (!接线了 && !交代了 && !隔离了 && !被别的库引) 漏网.push(`  lib/${m}`);
  }
  assert.deepEqual(漏网, [], '这些模块既没接线，也没写明为何不接（孤儿模块不会报错，只会安静地不存在）：\n' + 漏网.join('\n'));
});

// ---- 接口实跑 ----
// 只断言字段契约，不断言具体数值——分数会随配置和历史变，钉死数值等于给自己挖回归坑。
// server.js 打印的是**配置里的**端口，不是实际监听到的端口——所以 PORT=0 那招行不通
// （它会老实打印 127.0.0.1:0）。先自己探一个空闲端口，再显式传给它。
const 探空闲端口 = () => new Promise((resolve, reject) => {
  const probe = require('net').createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const p = probe.address().port;
    probe.close(() => resolve(p));
  });
});

const 起服务 = async () => {
  const port = await 探空闲端口();
  // 转发目标指向**确定空闲**的端口，而不是配置里的默认值——否则本机恰好跑着
  // 工作区服务/执行器时，「未拉起时优雅降级」那两条就会失效（实际红过一次）。
  // 测试要自带隔离，不能取决于跑测试的人当时开着什么。
  const 空闲工作区 = await 探空闲端口();
  const 空闲执行器 = await 探空闲端口();
  const env = {
    ...process.env, PORT: String(port),
    WORKSPACE_PORT: String(空闲工作区), EXECUTOR_PORT: String(空闲执行器),
    PLATFORM_NO_LOCAL: '1',
  };
  delete env.TICKETFLOW_PACKAGES;
  const srv = require('child_process').spawn(process.execPath, [path.join(平台根, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const 超时 = setTimeout(() => reject(new Error('server 起不来（10s 无开机日志）')), 10000);
    srv.stdout.on('data', (d) => {
      if (String(d).includes('开机')) { clearTimeout(超时); resolve(); }
    });
    srv.on('error', reject);
  });
  return { srv, port };
};

// 默认带令牌——绝大多数断言测的是业务行为，不该被门禁噪音淹掉。
// 门禁本身的行为另有专门几条，用 选项.免令牌 / 选项.头 显式绕开默认。
const 取 = (port, 路径, 选项 = {}) => new Promise((resolve, reject) => {
  const 头 = { ...(选项.体 ? { 'Content-Type': 'application/json' } : {}), ...(选项.头 || {}) };
  if (!选项.免令牌 && !头.Authorization) 头.Authorization = 'Bearer ' + 门禁令牌();
  const req = http.request({ host: '127.0.0.1', port, path: 路径, method: 选项.method || 'GET', headers: 头 }, (res) => {
    let s = ''; res.on('data', (d) => s += d);
    res.on('end', () => { try { resolve({ 码: res.statusCode, 体: JSON.parse(s) }); } catch (e) { reject(new Error('非 JSON 响应：' + s.slice(0, 200))); } });
  });
  req.on('error', reject);
  if (选项.体) req.write(JSON.stringify(选项.体));
  req.end();
});

// ---------- 交付皮：裸 clone 装得起来吗（协-036） ----------
//
// 2026-08-27 实测：`git archive HEAD` 解出来的那份（＝别人 clone 到的样子）自检报**未就绪**，
// 而七个 .local.json 里只有三个有 .示例。缺模板的那几个里，`workspace.local.json` 的形状
// 我自己就写错了——写成 { "workspace": {...} }，而**文件名即段名、内容就是段体**。
// 有 .示例 的那三个一次就对。所以模板不是文档美化，是防错件。
t('自检点名的每个 .local.json 都要有 .示例（缺模板的那个就是会被写错的那个）', () => {
  const 自检源 = fs.readFileSync(path.join(平台根, 'lib', '自检.js'), 'utf8');
  const 点名 = [...new Set([...自检源.matchAll(/config\/([^\s`'"）)]+?\.local\.json)/g)].map((m) => m[1]))];
  assert.ok(点名.length >= 4, `自检里应点名若干 .local.json，实得 ${点名.length}`);
  for (const 名 of 点名) {
    // 接口令牌是**开机自动生成**的（lib/门禁.js 用 'wx' 独占创建定胜负），
    // 给它配模板反而会诱导人手写一个固定令牌——那是往仓里塞凭据。
    if (名.includes('接口令牌')) continue;
    assert.ok(fs.existsSync(path.join(平台根, 'config', `${名}.示例`)),
      `config/${名} 没有 .示例——没模板的配置就是会被写错形状的那个`);
  }
});

t('.示例 的内容是**段体**，不许再套一层段名（我就是这么写错的）', () => {
  const 目录 = path.join(平台根, 'config');
  for (const 文件 of fs.readdirSync(目录).filter((f) => f.endsWith('.local.json.示例'))) {
    const 段 = 文件.replace('.local.json.示例', '');
    const 内容 = JSON.parse(fs.readFileSync(path.join(目录, 文件), 'utf8'));   // 顺带钉住：必须是合法 JSON
    assert.ok(!Object.prototype.hasOwnProperty.call(内容, 段),
      `${文件} 顶层出现了 "${段}" 键——文件名即段名，内容应当直接是段体，套一层会整段失效且不报错`);
  }
});

t('首装脚本走产品自己的落位函数，不在别处再拼一遍配置（协-036）', () => {
  const s = fs.readFileSync(path.join(平台根, 'scripts', '首装.js'), 'utf8');
  assert.match(s, /工单库\.落位\(/, '工单库根目录要走 工单库.落位');
  assert.match(s, /项目\.落位\(/, '项目注册要走 项目.落位');
  // 配置长什么样只该有一处知道。安装脚本自己 JSON.stringify 一份出来，
  // 主配置一演进它就悄悄过期——而过期的安装脚本装出来的机器是坏的。
  assert.ok(!/JSON\.stringify\(\s*\{\s*根目录/.test(s), '别在安装脚本里手拼工单库配置');
  assert.match(s, /自检\.查\(/, '装完必须打一遍自检——就绪与否由产品自己说，不由安装脚本说');
});

// ---------- 打包件也得拿得到配置模板（协-036） ----------
//
// 翻 2026-08-16 那次真打包留下的 dist/config/：只有 api-token.txt、接口令牌.local.json
// （都是开机自动生成的）和 工单库.local.json（界面上那个输入框配的）。
// **四个要手配的一个都没有**，而且不可能有——`.示例` 全锁在只读的 app.asar 里。
// 源码用户有模板所以一次写对；打包用户连模板都看不见。
t('打包态第一次开机要把 .示例 播到 exe 同级 config/（协-036）', () => {
  const os = require('os');
  const 位置 = require(path.join(平台根, 'lib', '配置位置.js'));
  // 造一个**两层**的临时结构：<exe目录>/config。
  // 直接拿 mkdtemp 出来的目录当 config 的话，「exe 目录」就成了 %TEMP% 本身——
  // 那是共享的，上一轮播下的 SETUP.md 会让这一轮跳过，测试之间互相污染。
  const exe目录 = fs.mkdtempSync(path.join(os.tmpdir(), '播种-'));
  const 靶 = path.join(exe目录, 'config');
  const 原 = process.env.PLATFORM_CONFIG;
  process.env.PLATFORM_CONFIG = 靶;                     // 模拟「可写配置在别处」
  try {
    const r = 位置.播种示例(平台根);
    assert.ok(r.播.length >= 4, `该播的模板没播够，实得 ${r.播.length}`);
    assert.ok(r.播.every((n) => n.endsWith('.示例') || n === 'SETUP.md'), '只许播模板与说明书');
    // 说明书也得播，而且落在 **exe 同级**（配置目录的上一级）。
    // `extraFiles` 对 portable 目标不管用：它放进 win-unpacked/，而 portable 又把整个
    // win-unpacked 打成一个自解压 exe——用户拿到的目录里只有那个 exe。实测确认过。
    assert.ok(r.播.includes('SETUP.md'), '拿到 exe 的人手边得有安装说明');
    assert.ok(fs.existsSync(path.join(path.dirname(靶), 'SETUP.md')),
      'SETUP.md 要落在 exe 同级，不是 config/ 里');
    // 纪律①：绝不播出一份真配置——那等于替人决定业务数据落哪、要不要花钱，
    // 而那正是自检明说自己不做的事。
    assert.deepEqual(fs.readdirSync(靶).filter((f) => f.endsWith('.local.json')), [],
      '播出了真配置——播种只该给模板，不该替人做决定');
    // 纪律②：绝不覆盖。用户改过的模板必须原样留着。
    const 一个 = path.join(靶, r.播[0]);
    fs.writeFileSync(一个, '用户改过的内容');
    assert.equal(位置.播种示例(平台根).播.length, 0, '第二次不该再播');
    assert.equal(fs.readFileSync(一个, 'utf8'), '用户改过的内容', '把用户改过的模板覆盖了');
  } finally {
    if (原 === undefined) delete process.env.PLATFORM_CONFIG; else process.env.PLATFORM_CONFIG = 原;
    fs.rmSync(exe目录, { recursive: true, force: true });
  }
});

t('打包态自检要去可写配置目录找令牌，别报假红（协-036 实测）', () => {
  // 真打包件开机后：config\api-token.txt 明明在、令牌也真的能用，
  // 自检却把「命令行调接口」标红——因为它拿 平台根（asar 内）去拼路径找。
  // **诊断工具报假红比不报更坏**：人会跑去修一个根本没坏的东西。
  const os = require('os');
  const 自检 = require(path.join(平台根, 'lib', '自检.js'));
  const exe目录 = fs.mkdtempSync(path.join(os.tmpdir(), '自检-'));
  const 原 = process.env.PLATFORM_CONFIG;
  process.env.PLATFORM_CONFIG = path.join(exe目录, 'config');
  try {
    const 找 = () => (自检.查(平台根, {}, null).find((c) => c.能力 === '命令行调接口') || {}).就绪;
    assert.equal(找(), false, '可写目录里没有令牌时应当是红的');
    fs.mkdirSync(path.join(exe目录, 'config'), { recursive: true });
    fs.writeFileSync(path.join(exe目录, 'config', 'api-token.txt'), 'a'.repeat(64));
    assert.equal(找(), true, '令牌就在可写目录里，自检还报红 = 假红');
  } finally {
    if (原 === undefined) delete process.env.PLATFORM_CONFIG; else process.env.PLATFORM_CONFIG = 原;
    fs.rmSync(exe目录, { recursive: true, force: true });
  }
});

t('开发态播种是 no-op（源和靶同一个目录，播了就是自己覆盖自己）', () => {
  const 位置 = require(path.join(平台根, 'lib', '配置位置.js'));
  const 原 = process.env.PLATFORM_CONFIG;
  delete process.env.PLATFORM_CONFIG;
  try {
    const r = 位置.播种示例(平台根);
    assert.deepEqual(r.播, [], '开发态不该播任何东西');
  } finally { if (原 !== undefined) process.env.PLATFORM_CONFIG = 原; }
});

t('server 在读配置之前播种，且把播了什么说出来（协-036）', () => {
  const s = fs.readFileSync(path.join(平台根, 'server.js'), 'utf8');
  const 播 = s.indexOf('播种示例(仓根)');
  const 读 = s.indexOf('本地覆盖.应用(仓根');
  assert.ok(播 > 0 && 读 > 播, '播种要排在配置解析之前，免得以后被挪进某个懒加载分支');
  // 播了不说等于没播：打包态用户手边没有 README，这行日志是他唯一的入口。
  assert.match(s, /已把 \$\{播种结果\.播\.length\} 个配置模板放到/, '播了要在开机日志里说清放哪了');
});

t('打包配置：SETUP.md 跟着 exe 走，本机配置一个都不许进包（协-036）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(平台根, 'package.json'), 'utf8'));
  const extra = JSON.stringify(pkg.build.extraFiles || []);
  assert.match(extra, /SETUP\.md/, '拿到 exe 的人手边要有安装说明——README 在 asar 里他打不开');
  // 回归守：2026-08-13 实测那份 exe 里带着开发机的令牌与私仓绝对路径。
  const files = pkg.build.files || [];
  assert.ok(files.includes('!config/*.local.json'), '本机配置不许跟着二进制走');
  assert.ok(files.includes('!config/api-token.txt'), 'API 令牌不许跟着二进制走');
  // 模板反过来**必须**进包——播种就是从包里往外拷的。
  assert.ok(files.some((f) => f.startsWith('config/')), 'config/ 要进包，否则没有模板可播');
});

t('交付皮三件套齐全：部署入口、首装脚本、安装指南（协-036）', () => {
  for (const f of ['部署.bat', 'SETUP.md', path.join('scripts', '首装.js')]) {
    assert.ok(fs.existsSync(path.join(平台根, f)), `缺 ${f}`);
  }
  const bat = fs.readFileSync(path.join(平台根, '部署.bat'), 'utf8');
  assert.match(bat, /首装\.js/, '部署.bat 得把活交给 首装.js，而不是自己在批处理里配');
  assert.match(bat, /where node/, '先验 node——本产品零第三方依赖，但它本身是 node 程序');
});

(async () => {
  const { srv, port } = await 起服务();
  try {
    await ta('GET /api/routing/rank 返回排名与理由', async () => {
      const r = await 取(port, '/api/routing/rank?role=generalist');
      assert.equal(r.码, 200);
      assert.equal(r.体.ok, true);
      assert.ok(Array.isArray(r.体.排名), '排名必须是数组');
      assert.ok(r.体.排名.length >= 1, `应至少排出一个候选（实得 ${r.体.排名.length}）`);
      for (const 项 of r.体.排名) {
        assert.equal(typeof 项.名称, 'string');
        assert.equal(typeof 项.分数, 'number');
        assert.ok(Array.isArray(项.理由) && 项.理由.length, '每个候选都要给出理由——不透明的排名没人敢信');
      }
      assert.equal(r.体.选中, r.体.排名[0].名称, '选中的必须是排第一的');
      assert.equal(typeof r.体.有区分度, 'boolean');
      // 全平局必须自曝：把「字母序第一」当成「评估最优」比没有排名更危险
      if (!r.体.有区分度) {
        assert.ok(/无区分度/.test(r.体.说明), '平局时说明里要写明无区分度：' + r.体.说明);
        assert.ok(/scores|prefer|战绩/.test(r.体.说明), '要告诉人怎么让排名变得有信号：' + r.体.说明);
      }
    });

    await ta('GET /api/routing/history 无记录时也给出账本路径与说明', async () => {
      const r = await 取(port, '/api/routing/history');
      assert.equal(r.码, 200);
      assert.equal(r.体.ok, true);
      assert.ok(r.体.账本.endsWith(path.join('journal', 'provider-runs.jsonl')));
      assert.ok(Array.isArray(r.体.记录));
      if (!r.体.记录.length) assert.ok(r.体.说明, '空账本要说明为什么空，否则看起来像坏了');
    });

    await ta('GET /api/toolchain 报告就位与否，并给出注入指引', async () => {
      const r = await 取(port, '/api/toolchain');
      assert.equal(r.码, 200);
      assert.equal(typeof r.体.就位, 'boolean');
      assert.ok(Array.isArray(r.体.候选路径));
      assert.ok(r.体.注入指引.length > 0, '不论就位与否都要给 Agent 一段人话指引');
    });

    await ta('POST /api/review/parse 把 Markdown 评审归一成字段', async () => {
      const 报告 = ['结论：不过', '', '## 阻断问题', '- 空指针未处理', '- 缺回滚路径', '', '## 验收证据', '- 复现步骤见附件'].join('\n');
      const r = await 取(port, '/api/review/parse', { method: 'POST', 体: { 文本: 报告 } });
      assert.equal(r.码, 200);
      assert.equal(r.体.ok, true);
      // 字段是中文键（结论/问题/风险/证据），这是 review-opinion.js 的既有契约，勿按英文猜
      assert.equal(r.体.结论, '不过', '「结论：不过」必须解析成不过');
      assert.ok(r.体.问题.length >= 2, `阻断问题应解析出 2 条（实得 ${r.体.问题.length}）`);
      assert.ok(r.体.证据.length >= 1, '验收证据节应被解析出来');
      assert.equal(typeof r.体.原文, 'string', '要保留原文供人工复核');
    });

    await ta('POST /api/review/parse 缺字段时报人话错误', async () => {
      const r = await 取(port, '/api/review/parse', { method: 'POST', 体: { 没有文本: 1 } });
      assert.equal(r.码, 400);
      assert.ok(r.体.error.includes('文本'), '错误里要写清缺什么：' + r.体.error);
    });

    await ta('POST /api/plan/validate 把 Orchestrator 输出解析成 DAG', async () => {
      const 输出 = ['我建议这样拆：', '```json', JSON.stringify({
        summary: '两步走',
        tasks: [
          { key: 'a', title: '写接口', role: 'backend', acceptance: ['接口返回 200'] },
          { key: 'b', title: '评审', role: 'reviewer', dependsOn: ['a'], acceptance: ['无阻断问题'] },
        ],
      }), '```'].join('\n');
      const r = await 取(port, '/api/plan/validate', { method: 'POST', 体: { 输出 } });
      assert.equal(r.码, 200);
      assert.equal(r.体.合规, true, '合法计划应通过校验：' + (r.体.原因 || ''));
      assert.equal(r.体.任务数, 2);
      assert.equal(r.体.任务[1].依赖[0], 'a', '依赖关系要保留');
    });

    await ta('POST /api/plan/validate 对不合规计划给 200 + 合规:false（不是 5xx）', async () => {
      const r = await 取(port, '/api/plan/validate', { method: 'POST', 体: { 输出: '我觉得先干这个再干那个' } });
      assert.equal(r.码, 200, '校验不通过是业务结果，不是服务故障');
      assert.equal(r.体.合规, false);
      assert.ok(r.体.原因 && r.体.原因.length, '要说明哪里不合规');
    });

    t('materialize 缺注入 store 时明确报错，不静默降级', () => {
      const 计划 = require(path.join(平台根, 'lib', 'orchestration', 'plan.js'));
      assert.throws(
        () => 计划.materialize('/tmp', {}, { id: 'T-1', fm: {} }, { tasks: [] }),
        (e) => {
          assert.ok(e.message.includes('store'), '错误里要点名缺的是 store：' + e.message);
          return true;
        },
        '缺 store 必须抛错——悄悄什么都不写比直接失败难查得多',
      );
    });

    await ta('原有四条接口未被新接线打断', async () => {
      for (const p of ['/api/health', '/api/watchtower', '/api/providers']) {
        const r = await 取(port, p);
        assert.equal(r.码, 200, p + ' 应仍为 200');
        assert.equal(r.体.ok, true, p + ' 应仍 ok');
      }
      const h = await 取(port, '/api/health');
      assert.equal(h.体.桩模式, true, '桩模式标记不能因接线而改变');
    });

    // ---- 门禁三道闸 ----
    // 挡的是「你随手打开的网页往 127.0.0.1 发请求」。绑 127.0.0.1 挡不住这个：
    // 浏览器就在 localhost 上。实测确认过这条路真的通（2026-08-10）。
    await ta('门禁①：无令牌被拒，且未知路径不泄露存在性', async () => {
      const r = await 取(port, '/api/providers', { 免令牌: true });
      assert.equal(r.码, 401);
      assert.ok(/Bearer/.test(r.体.error), '要告诉人怎么带令牌：' + r.体.error);
      // 未授权时「不存在的接口」也必须是 401 而不是 404——
      // 否则未授权者可以靠状态码差异枚举出有哪些接口。
      const 未知 = await 取(port, encodeURI('/api/根本没有这条'), { 免令牌: true });
      assert.equal(未知.码, 401, '未授权时不得用 404 泄露接口是否存在');
    });

    await ta('门禁②：跨站 Origin 被拒（模拟恶意网页）', async () => {
      const r = await 取(port, '/api/providers', { 头: { Origin: 'https://evil.example' } });
      assert.equal(r.码, 403);
      assert.ok(/跨站|来源/.test(r.体.error), r.体.error);
      // 同源必须放行，否则自家 UI 就废了
      const 同源 = await 取(port, '/api/providers', { 头: { Origin: `http://127.0.0.1:${port}` } });
      assert.equal(同源.码, 200, '同源页面必须放行');
    });

    await ta('门禁③：POST 的 Content-Type 卡死成 application/json', async () => {
      const r = await 取(port, '/api/review/parse', {
        method: 'POST', 头: { 'Content-Type': 'text/plain' }, 体: { 文本: '结论：通过' },
      });
      assert.equal(r.码, 415, 'text/plain 是跨域简单请求，不触发预检，必须挡掉');
      assert.ok(/预检|application\/json/.test(r.体.error), r.体.error);
    });

    await ta('门禁例外：/api/health 免令牌（瞭望塔心跳要探它）', async () => {
      const r = await 取(port, '/api/health', { 免令牌: true });
      assert.equal(r.码, 200, '守护住在 packages/（双签共建），没法单方面让它带令牌');
      // 例外只此一条，多一条都要显式决定
      const 门禁 = require(path.join(平台根, 'lib', '门禁.js'));
      assert.deepEqual([...门禁.免令牌], ['/api/health'], '免令牌名单变动必须是显式决定');
    });

    t('令牌比较是定长的（避免按前缀提前返回）', () => {
      const 门禁 = require(path.join(平台根, 'lib', '门禁.js'));
      assert.equal(门禁.等值('abc', 'abc'), true);
      assert.equal(门禁.等值('abc', 'abd'), false);
      assert.equal(门禁.等值('abc', 'ab'), false, '长度不等也要安全返回 false，不能抛');
      assert.equal(门禁.等值('', ''), true);
    });

    t('令牌文件被 gitignore 挡住（不能入库）', () => {
      const 忽略 = fs.readFileSync(path.join(平台根, '.gitignore'), 'utf8');
      assert.ok(/\*\.local\.json/.test(忽略), '.gitignore 必须挡住 *.local.json，否则令牌会进版本库');
    });

    await ta('工作区未拉起时优雅降级，且说明可操作', async () => {
      // 用一个**确定没人监听**的端口来验降级，而不是「假定本机没跑工作区服务」。
      // 后者会让测试结果取决于跑测试的人当时开着什么——2026-08-10 就这么红过一次：
      // 我为了验提交链把工作区服务跑起来了，这条立刻从 503 变成 200。
      const r = await 取(port, '/api/workspace/worktrees?repository=.');
      assert.equal(r.码, 503, '转发失败应是 503（依赖的服务不在），不是 500');
      assert.ok(/npm run workspace/.test(r.体.error), '要告诉人怎么拉起来：' + r.体.error);
      assert.ok(/child_process/.test(r.体.error), '要交代清楚为什么它是独立进程：' + r.体.error);
    });

    await ta('工作区转发同样受门禁保护', async () => {
      const r = await 取(port, '/api/workspace/worktrees?repository=.', { 免令牌: true });
      assert.equal(r.码, 401, '转发路径不能绕过门禁');
    });

    await ta('查询串解析不影响未知 API 的 404', async () => {
      // http.request 不接受未编码的非 ASCII 路径，这是客户端的规矩，得自己编
      const r = await 取(port, encodeURI('/api/不存在') + '?role=x');
      assert.equal(r.码, 404);
      assert.ok(!r.体.error.includes('?'), '404 回显的路径不应带查询串：' + r.体.error);
      assert.ok(r.体.error.startsWith('未知 API：/api/'), '404 要回显路径：' + r.体.error);
    });

    console.log(`全部通过：${passed} 项`);
  } finally {
    srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
