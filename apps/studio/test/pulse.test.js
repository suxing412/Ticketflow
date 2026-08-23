// pulse.test.js — 脉冲刷新决策（施工令-048：频闪根治）
// 被测的是 public/app.js 里生产那一份源码（@testable 标记原样抽出），不是抄本：
// 抄本会在下一次改前端时悄悄与实现走散，而这道测试的全部意义就是「界面还闪不闪」有人守着。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// 行为面夹具：在 node 里真装 public/app.js、真调它的函数（见 test/frontend-sandbox.js 抬头那段案由）。
// 2026-08-22 复核判掉 22 条「grep 源码文本」的假判据后，本文件里凡是能真跑的一律真跑。
const { 装载前端, 设项目 } = require('./frontend-sandbox');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
// 异步用例串行跑：几条行为面判据共用 test/minidom 的那一份 doc，并发交错会互相踩现场。
const 异步 = []; const at = (n, f) => 异步.push([n, f]);
console.log('pulse 脉冲刷新决策测试（施工令-048）');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const 抽 = (名, 出) => {
  const a = src.indexOf(`// @testable-begin ${名}`);
  const b = src.indexOf(`// @testable-end ${名}`);
  assert.ok(a >= 0 && b > a, `public/app.js 里的 ${名} 抽取标记丢了——测试与实现已脱钩`);
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(a, b) + `\nreturn ${出};`)();
};
const { pulsePlan, PULSE } = 抽('pulsePlan', '{ pulsePlan, PULSE }');
const pulseTarget = 抽('pulseTarget', 'pulseTarget');

/* route() 那张真表的键（app.js 传 Object.keys(ROUTES)）。
   **从源码现取，不再手抄**：2026-08-20 的 11→8 页签定案把 ideas/flow/queue 三个键撤了，
   而手抄的那份仍列着它们——pulseTarget 只是按给定名单查表，名单错了它照样全绿，
   于是这份「与 route() 同口径」的断言会静默变成对着一张不存在的表自说自话。 */
const ROUTES键 = (() => {
  const m = /const ROUTES = \{([^}]*)\}/.exec(src);
  assert.ok(m, 'app.js 里的 ROUTES 表找不到了');
  return m[1].split(',').map((s) => s.split(':')[0].trim().replace(/^'|'$/g, '')).filter((s) => s.length || s === '');
})();
const 视图键 = ROUTES键;
const 态 = (o) => Object.assign({ 变了: false, 待办: false, 免打扰: false, 可局部: true, 交互中: false, 现在: 0, 上次整页: 0 }, o);

/* ---- 一、局部刷新选择（要件1）---- */

t('登记过的视图一律走原地重绘，不整页', () => {
  for (const h of ['#/board', '#/tickets', '#/relay', '#/agents', '#/report', '#/wiki']) {
    const r = pulseTarget(h, 视图键);
    assert.equal(r.类, 'patch', h + ' 应当能原地刷新');
    assert.equal(r.视图, h.replace('#/', ''));
  }
});

/* ---- 一b、页签定案 11→8（2026-08-20 制作人裁定）：撤 想法/流程/队列 三页 ----
   这三条断言守的是「撤了就是真撤了」：路由表里没有、导航条上没有、旧书签不落死链。
   任缺一条，退役都会退成半截——最常见的半截是「页签没了但 hash 还能进」，
   于是一张没有入口、没人维护、数据早已由别处接管的页会继续被书签唤出来。 */
t('ROUTES 已无 ideas/flow/queue 三键，relay 仍在', () => {
  for (const k of ['ideas', 'flow', 'queue']) assert.ok(!视图键.includes(k), `ROUTES 里还留着退役键 ${k}`);
  for (const k of ['', 'tickets', 'board', 'agents', 'wiki', 'relay', 'report']) {
    assert.ok(视图键.includes(k), `ROUTES 缺了在役键 ${k || '(总览)'}`);
  }
});

t('NAV 恰好 8 项，顺序与页签定案一致', () => {
  const m = /const NAV = (\[.*?\]\];)/.exec(src);
  assert.ok(m, 'NAV 表找不到了');
  // eslint-disable-next-line no-new-func
  const NAV = new Function('return ' + m[1].replace(/;$/, ''))();
  assert.equal(NAV.length, 7, 'NAV 应是 7 项，实为 ' + NAV.length + '：' + NAV.map((x) => x[0]).join('/'));
  assert.deepEqual(NAV.map((x) => x[0]), ['总览', '工单', '看板', '在途', 'Wiki', '项管', '报表']);
  assert.deepEqual(NAV.map((x) => x[1]), ['', 'tickets', 'board', 'agents', 'wiki', 'relay', 'report']);
  // 导航条上的每一项都必须在 ROUTES 里查得到，否则点了就落总览（静默错页）
  for (const [名, h] of NAV) assert.ok(视图键.includes(h), `NAV「${名}」的 hash ${h} 不在 ROUTES 里`);
});

t('退役页转向表：ideas/flow/queue/tree 一律落 relay，且用 replace 不用 assign', () => {
  const m = /const 退役页 = (\{[^}]*\})/.exec(src);
  assert.ok(m, '退役页转向表找不到了');
  // eslint-disable-next-line no-new-func
  const 退役页 = new Function('return ' + m[1])();
  // decisions: '' → 落总览（2026-08-21 撤决策台：签字随对象走，聚合上收服务端 等我()）
  assert.deepEqual(退役页, { ideas: 'relay', flow: 'relay', queue: 'relay', tree: 'relay', decisions: '' });
});

/* 「用 replace 不用 assign」「带参旧书签也要落地」这两条原本 grep 转向那一行的源码文本
   （/location\.replace/、/h\.split\('\?'\)\[0\]…/）——同样的接线换个写法它就假红，
   而真正的病（转向压根没触发、或触发到别处去）它一个都拦不住。改成真跑 route() 看它把人送去哪。 */
at('退役页转向真把人送到 relay：用 replace 不用 assign，带参旧书签同样落地', async () => {
  const 走一趟 = async (旧hash) => {
    const ctx = 装载前端();
    const 换 = [];
    let hash = 旧hash;
    // location.hash 换成可观测的存取器：assign 语义（location.hash = x）会被记下来
    Object.defineProperty(ctx.location, 'hash', {
      get: () => hash, set: (v) => { 换.push(['hash=', v]); hash = v; }, configurable: true,
    });
    ctx.location.replace = (u) => 换.push(['replace', u]);
    ctx.location.assign = (u) => 换.push(['assign', u]);
    ctx.fetch = async (u) => {
      const url = String(u).split('?')[0];
      return { ok: true, json: async () => (url === '/api/setup/state' ? { 需要向导: false }
        : url === '/api/config' ? { 项目: { 注册: { TK: {} }, 默认: 'TK' }, 闸值: {} } : {}) };
    };
    await ctx.route();
    return 换;
  };
  for (const 旧 of ['#/ideas', '#/flow', '#/queue', '#/tree']) {
    assert.deepEqual(await 走一趟(旧), [['replace', '#/relay']],
      `${旧} 没被转向到 #/relay（或用了 assign/hash= —— 那会让退役页占一格历史，用户按返回又被弹回来）`);
  }
  assert.deepEqual(await 走一趟('#/queue?项目=TK'), [['replace', '#/relay']],
    '带参旧书签 #/queue?项目=TK 没落地——转向若按整串比对就会把它漏进 ROUTES 查表，落成一张空白页');
  assert.deepEqual(await 走一趟('#/board'), [], '在役页不许被转向');
});

t('四张退役页的视图函数不再挂路由：viewQueue/viewIdeas 运行时真的不存在，ideaPoolHtml 真出片段', () => {
  // 判据换面（2026-08-22）：原本四条 assert.ok(/function viewQueue/.test(src)) 之流——
  // 那只证明「源码里有没有这串字」。改名成 viewQueue2 它照绿，注释里提一句 viewQueue 它照红。
  // 这里真装一遍 app.js，函数在不在**以运行时为准**；片段函数还要真出片段，只剩个名字不算数。
  const ctx = 装载前端();
  assert.equal(typeof ctx.viewQueue, 'undefined', 'viewQueue 还在（项管页 tqRow 是它的超集，退役就该真的没有）');
  assert.equal(typeof ctx.viewIdeas, 'undefined', 'viewIdeas 应化成片段函数 ideaPoolHtml，不再是独立视图');
  assert.equal(typeof ctx.ideaPoolHtml, 'function', '想法在池的片段函数 ideaPoolHtml 不见了');
  const 片段 = ctx.ideaPoolHtml([{ id: 'I-1', 文本: '一条想法', t: '2026-08-01T10:00:00Z' }]);
  assert.ok(片段.includes('一条想法') && 片段.includes("ideaAct('拍板'"),
    'ideaPoolHtml 出不了带拍板钮的片段——想法并进项管页等于并了个空壳');
  assert.equal(typeof ctx.viewFlow, 'function', 'viewFlow 是摘牌留档，函数体应原样保留（管线现在线暂无接班人）');
});

/* ---- 一c、标语点名的页必须还活着（2026-08-22 体检 #67①）----
   案源：08-20 撤了决策台，页头标语却还写着「工单 · 审检 · 决策台」——制作人照着标语找页，找不到。
   判的是「标语里点的名字是不是一个已退役的页」，不判具体措辞：改叫法、换顺序、挪位置都不误伤。 */
t('页头标语不许点名任何一张已退役的页（#67①）', () => {
  const ctx = 装载前端();
  const 壳 = ctx.shell('board', '');
  const m = /<p class="tagline">([\s\S]*?)<\/p>/.exec(壳);
  assert.ok(m, '页头标语找不到了——它是制作人对这台机器是干什么的第一印象，不许悄悄拿掉');
  // 标语形如「工单 · 审检 · 验收——制作人的驾驶舱：…」，破折号前那截才是页名枚举
  const 页名们 = String(m[1]).split('——')[0].split('·').map((s) => s.trim()).filter(Boolean);
  assert.ok(页名们.length >= 2, '标语里没有可核对的页名枚举：' + m[1]);
  // 退役页中文名对照（键＝route() 的 退役页 表的键）
  const 退役名 = { decisions: '决策台', ideas: '想法', flow: '流程', queue: '队列', tree: '树' };
  const 表 = /const 退役页 = (\{[^}]*\})/.exec(src);
  assert.ok(表, '退役页转向表找不到了');
  // eslint-disable-next-line no-new-func
  for (const k of Object.keys(new Function('return ' + 表[1])())) {
    assert.ok(退役名[k], `退役页新增了 ${k}，本用例的中文名对照表没跟上——补一格再跑`);
  }
  for (const n of 页名们) {
    assert.ok(!Object.values(退役名).includes(n),
      `页头标语点名「${n}」，而这张页已退役——制作人会照着标语去找一张不存在的页。标语现为：${m[1]}`);
  }
});

t('总览是空键：裸 #/ 与认不出的 hash 都落总览（与 route() 同口径）', () => {
  assert.deepEqual(pulseTarget('#/', 视图键), { 类: 'patch', 视图: '' });
  assert.deepEqual(pulseTarget('', 视图键), { 类: 'patch', 视图: '' });
  assert.deepEqual(pulseTarget('#/不存在的页', 视图键), { 类: 'patch', 视图: '' });
});

t('详情页认出单号（含中文/编码单号），交给详情刷新', () => {
  assert.deepEqual(pulseTarget('#/t/E-99', 视图键), { 类: 'patch', 视图: 'detail', id: 'E-99' });
  assert.deepEqual(pulseTarget('#/t/' + encodeURIComponent('施工-01'), 视图键), { 类: 'patch', 视图: 'detail', id: '施工-01' });
});

t('起草/项目注册/参数三页免打扰：正在填的东西不许被脉冲冲掉', () => {
  for (const h of ['#/draft', '#/draft?edit=E-1', '#/proj-new', '#/params'])
    assert.equal(pulseTarget(h, 视图键).类, 'hold', h + ' 应免打扰');
});

t('启动页也能原地刷新（多项目计数会动）', () => {
  assert.equal(pulseTarget('#/hub', 视图键).视图, 'hub');
});

/* ---- 二、动作判定（要件1/2）---- */

t('令牌没变就什么都不做——脉冲的常态', () => {
  assert.equal(pulsePlan(态({})).动作, 'skip');
});

t('令牌变了、视图可局部 → patch，绝不 full（病灶本身）', () => {
  assert.equal(pulsePlan(态({ 变了: true })).动作, 'patch');
});

t('免打扰期间记待办：弹窗/起草页挡下的变更不会丢，解除后补上', () => {
  const 挡 = pulsePlan(态({ 变了: true, 免打扰: true }));
  assert.equal(挡.动作, 'hold');
  // 解除免打扰时令牌可能这一拍没再变，靠待办把补刷接上
  assert.equal(pulsePlan(态({ 变了: false, 待办: true })).动作, 'patch');
});

t('整页兜底：距上次整页不足 30s 一律顺延（忙时合并）', () => {
  const s = 态({ 变了: true, 可局部: false, 现在: 100000, 上次整页: 100000 - 29000 });
  const r = pulsePlan(s);
  assert.equal(r.动作, 'defer');
  assert.ok(r.因.includes('29s'), '顺延理由要说清距上次多久：' + r.因);
});

t('整页兜底：够 30s 且没人在操作，才真重建', () => {
  assert.equal(pulsePlan(态({ 变了: true, 可局部: false, 现在: 100000, 上次整页: 70000 })).动作, 'full');
});

t('交互顺延：够 30s 但用户正在滚动/输入 → 仍然顺延（要件2）', () => {
  const r = pulsePlan(态({ 变了: true, 可局部: false, 交互中: true, 现在: 100000, 上次整页: 60000 }));
  assert.equal(r.动作, 'defer');
  assert.ok(r.因.includes('用户'), r.因);
});

t('首次（从未整页过）不被节流卡住', () => {
  assert.equal(pulsePlan(态({ 变了: true, 可局部: false, 现在: 5000, 上次整页: 0 })).动作, 'full');
});

t('免打扰优先于一切：可局部也不许在弹窗上动手', () => {
  assert.equal(pulsePlan(态({ 变了: true, 可局部: true, 免打扰: true })).动作, 'hold');
});

/* ---- 三、繁忙模拟：脉冲每 3s 变，持续 2 分钟（验收条款）---- */

// 照 app.js 那条 setInterval 的口径跑一遍：动作 → 状态 → 下一拍
function 跑(分钟, opt = {}) {
  const 拍 = [];
  let 待办 = false, 上次整页 = opt.上次整页 === undefined ? 1 : opt.上次整页, 现在 = 0;
  for (let i = 0; i < (分钟 * 60000) / 3000; i++) {
    现在 += 3000;
    const p = pulsePlan({
      变了: opt.变了 === undefined ? true : opt.变了(i),
      待办, 免打扰: !!(opt.免打扰 && opt.免打扰(i)),
      可局部: opt.可局部 === undefined ? true : opt.可局部,
      交互中: !!(opt.交互中 && opt.交互中(i)),
      现在, 上次整页,
    });
    待办 = p.动作 === 'hold' || p.动作 === 'defer';
    if (p.动作 === 'full') 上次整页 = 现在;
    拍.push({ 秒: 现在 / 1000, 动作: p.动作, 因: p.因 });
  }
  return 拍;
}
const 计 = (拍, a) => 拍.filter((x) => x.动作 === a).length;

t('繁忙 2 分钟（每拍都变）· 常规视图：40 拍全 patch，整页重建 0 次', () => {
  const 拍 = 跑(2);
  assert.equal(拍.length, 40);
  assert.equal(计(拍, 'patch'), 40);
  assert.equal(计(拍, 'full'), 0, '整页重建次数必须 ≤4，实测 ' + 计(拍, 'full'));
});

t('繁忙 2 分钟 · 退到整页兜底：合并后整页重建 ≤4 次（验收阈）', () => {
  const 拍 = 跑(2, { 可局部: false, 上次整页: 0 });
  const n = 计(拍, 'full');
  assert.ok(n <= 4, '整页重建 ' + n + ' 次，超出验收阈 4');
  assert.equal(计(拍, 'defer') + n, 40, '非重建的拍都该是顺延，一拍都不许无声吞掉');
  // 两次重建之间至少隔 30s
  const ts = 拍.filter((x) => x.动作 === 'full').map((x) => x.秒);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= PULSE.整页最小间隔 / 1000, '两次整页重建间隔不足 30s：' + ts.join(','));
});

t('繁忙 2 分钟 · 用户全程在操作：整页重建 0 次，且待办一直挂着等他停手', () => {
  const 拍 = 跑(2, { 可局部: false, 上次整页: 0, 交互中: () => true });
  assert.equal(计(拍, 'full'), 0);
  assert.ok(拍.every((x) => x.动作 === 'defer'));
});

t('繁忙 2 分钟 · 弹窗全程开着：一次都不动版面（制作人手里的活不被打断）', () => {
  const 拍 = 跑(2, { 免打扰: () => true });
  assert.equal(计(拍, 'patch') + 计(拍, 'full'), 0);
  assert.ok(拍.every((x) => x.动作 === 'hold'));
});

t('弹窗关掉那一拍立刻补刷一次（合并成一次，不是补 40 次）', () => {
  const 拍 = 跑(2, { 免打扰: (i) => i < 20, 变了: (i) => i < 20 }); // 前一分钟连环变且挡着，后一分钟令牌不再变
  assert.equal(计(拍, 'hold'), 20);
  assert.equal(计(拍, 'patch'), 1, '挡下的 20 次变更应合并成一次补刷，实测 ' + 计(拍, 'patch'));
  assert.equal(拍[20].动作, 'patch');
});

/* ---- 四、防倒退：病灶写法不许回来 ---- */

/* 这两条原本是 `src.indexOf(...)` + 正则查源码块（「块里有没有 repaint(」「有没有 data-live 这串字」）。
   那种断言证明不了接线：repaint 这串字可能出现在注释里、data-live 可能挂错了元素、
   morph 的 data-live 闸可能被上面某个分支提前 return 绕过——它一概照绿。
   下面两条改成真跑那一段接线：把脉冲那一拍**真的打出去**，看它落在哪个函数上；
   把详情页**真的渲染出来**、真喂给 morph，看秒表上的实时值还在不在。 */

at('脉冲那一拍真落在 repaint 上，不是 route（整页重建的旧路已封）', async () => {
  // 把生产那一段 setInterval 接线原样搬进沙盒重跑：setInterval 换成收集器，
  // route/repaint 换成记录桩（两者都是顶层 function 声明，在 vm 全局上可覆盖）。
  const a = src.indexOf('let lastPulse = null;');
  const b = src.indexOf('}, 3000);', a);
  assert.ok(a > 0 && b > a, '脉冲轮询块找不到了——接线换了地方，这条判据已脱钩');
  const 块 = src.slice(a, b + '}, 3000);'.length).replace('let lastPulse = null;', 'lastPulse = null;');

  const ctx = 装载前端();
  let 拍 = null;
  ctx.setInterval = (fn, ms) => { 拍 = { fn, ms }; return 1; };
  const 记 = [];
  ctx.route = async () => { 记.push('route'); };
  ctx.repaint = async () => { 记.push('repaint'); return 'ok'; };
  // 弹窗开着() 是 const（覆不掉），它读 document.querySelector('.mwrap, .ask-ov')——从 document 这一侧关掉
  const 原doc = ctx.document;
  ctx.document = new Proxy(原doc, {
    get: (o, k) => (k === 'querySelector' ? ((s) => (/mwrap|ask-ov/.test(s) ? null : o.querySelector(s))) : o[k]),
  });
  let 令牌 = 't1';
  ctx.fetch = async (u) => ({ ok: true, json: async () => (String(u) === '/api/pulse' ? { token: 令牌 } : {}) });
  ctx.location.hash = '#/board';
  vm.runInContext(块, ctx, { filename: 'app.js#脉冲接线' });
  assert.ok(拍 && 拍.ms === 3000, '脉冲不是 3s 一拍：' + JSON.stringify(拍 && 拍.ms));

  await 拍.fn();
  assert.deepEqual(记, [], '第一拍只该建立令牌基线，一动都不许动版面');
  令牌 = 't2';
  await 拍.fn();
  assert.deepEqual(记, ['repaint'],
    '令牌变了该原地重绘。落在 route 上就是整页重建——施工令-048 治的频闪正是这一下。实测：' + JSON.stringify(记));

  ctx.location.hash = '#/draft'; 令牌 = 't3';
  await 拍.fn();
  assert.deepEqual(记, ['repaint'], '起草页免打扰：正在填的东西不许被脉冲冲掉');
  ctx.location.hash = '#/board';
  await 拍.fn(); // 令牌这一拍没再变，靠待办把补刷接上
  assert.deepEqual(记, ['repaint', 'repaint'], '免打扰期间挡下的那一笔要补刷回来，不许无声吞掉');
});

at('详情页秒表：真渲染 → 真走表 → 真 morph，实时值必须原样活下来（要件3）', async () => {
  const ctx = 装载前端();
  const J = (o) => ({ ok: true, json: async () => o });
  ctx.fetch = async (u) => {
    const url = decodeURIComponent(String(u)).split('?')[0];
    if (url === '/api/ticket') return J({ id: 'A-1', state: '在途', fm: { id: 'A-1', title: '活儿', 职能: '程序', 优先级: 'P1' }, 链: { 父子: { 父: null, 子: [] }, 依赖: [] }, body: '正文' });
    if (url === '/api/runner') return J({ 执行中: [{ id: 'A-1', agent: '程序-A', kind: '执行', startedAt: new Date().toISOString(), 进度: { 百分比: 60, 段: [] } }], 间隔秒: 15 });
    return J({});
  };
  const html = await ctx.viewDetail('A-1'); // 生产那一份详情页，不是抄本

  const box = 现场(html);
  for (const id of ['lv-step-t', 'lv-all-t']) {
    const 表 = doc.getElementById(id);
    assert.ok(表, `详情页没渲染出 ${id}——秒表格子不见了`);
    表.childNodes[0].nodeValue = '02:17';           // 1s 计时器写进去的实时值
    morph(box, html);                               // 服务端那份永远是占位 --:--
    assert.equal(doc.getElementById(id), 表, `${id} 被 morph 重建了`);
    assert.equal(表.childNodes[0].nodeValue, '02:17',
      `${id} 被脉冲拨回了占位值——正是要件3 要防的闪（记号丢了，或 morph 那道 data-live 闸失灵）`);
  }
});

/* ---- 五、morph 实弹：三态不丢是「根本没碰」，拿节点身份验（要件1）----
   在最小 DOM（test/minidom.js）上跑生产那一份 morph。判据一律是节点对象的身份（===）：
   只要节点没被换过，浏览器里挂在它身上的滚动位、展开态、焦点、动画就一个都不会掉。 */
const { El, doc, win } = require('./minidom');
const { morph } = (() => {
  const a = src.indexOf('// @testable-begin morph');
  const b = src.indexOf('// @testable-end morph');
  assert.ok(a >= 0 && b > a, 'public/app.js 里的 morph 抽取标记丢了');
  // eslint-disable-next-line no-new-func
  return new Function('document', 'window', '$', src.slice(a, b) + '\nreturn { morph };')(
    doc, win, (id) => doc.getElementById(id));
})();

// 造一块「现场」：把 html 渲成真节点树，返回容器
const 现场 = (html) => { const box = new El('div'); box.innerHTML = html; doc.body = box; doc.activeElement = null; return box; };
const 全节点 = (n, out = []) => { out.push(n); for (const c of n.childNodes || []) 全节点(c, out); return out; };

t('整枝没变：一个节点都不重建（滚动位/动画/展开态天然存活）', () => {
  const html = '<div class="card" id="c1"><p>阿</p><span class="pill">在途</span></div><div id="c2"><b>乙</b></div>';
  const box = 现场(html);
  const 旧 = 全节点(box).slice(1);
  const 滚动块 = doc.getElementById('c1'); 滚动块.scrollTop = 480;   // 浏览器里的滚动位就挂在节点上
  morph(box, html);
  assert.deepEqual(全节点(box).slice(1), 旧, '同样的 HTML 却换了节点——morph 的整枝跳过失灵了');
  assert.equal(doc.getElementById('c1').scrollTop, 480, '滚动位丢了');
});

t('只有一个数字变：只动那一个文本节点，其余身份不动', () => {
  const box = 现场('<div id="k"><span class="n">3</span><span class="t">在途</span></div>');
  const 壳 = doc.getElementById('k'), n = 壳.childNodes[0], txt = n.childNodes[0], t2 = 壳.childNodes[1];
  morph(box, '<div id="k"><span class="n">4</span><span class="t">在途</span></div>');
  assert.equal(doc.getElementById('k'), 壳, '外壳被重建了');
  assert.equal(壳.childNodes[0], n, '数字所在的 span 被重建了（本该只换里面的字）');
  assert.equal(txt.nodeValue, '4');
  assert.equal(壳.childNodes[1], t2, '隔壁没变的 span 被殃及');
});

t('data-live 元素原样不动：详情页秒表不被脉冲拨回 --:--（要件3）', () => {
  const box = 现场('<div id="lvcard"><span id="lv-step-t" data-live>--:--</span></div>');
  const 表 = doc.getElementById('lv-step-t');
  表.childNodes[0].nodeValue = '02:17';                       // 1s 计时器写进去的实时值
  morph(box, '<div id="lvcard"><span id="lv-step-t" data-live>--:--</span></div>');
  assert.equal(doc.getElementById('lv-step-t'), 表);
  assert.equal(表.childNodes[0].nodeValue, '02:17', '秒表被脉冲拨回了占位值——正是要件3 要防的闪');
});

t('正在敲的输入框：值与焦点都不许被新数据盖掉', () => {
  const box = 现场('<form id="f"><input id="q" value=""></form>');
  const inp = doc.getElementById('q');
  inp.focus(); inp.value = '我正在敲的字';
  morph(box, '<form id="f"><input id="q" value="服务端旧值"></form>');
  assert.equal(doc.activeElement, inp, '焦点丢了');
  assert.equal(inp.value, '我正在敲的字', '正在敲的内容被服务端值盖掉了');
});

t('没在敲的输入框：该同步的值照样同步（不是一律不管）', () => {
  const box = 现场('<form id="f"><input id="q" value="旧"></form>');
  const inp = doc.getElementById('q');
  morph(box, '<form id="f"><input id="q" value="新"></form>');
  assert.equal(doc.getElementById('q'), inp, '输入框不该被重建');
  assert.equal(inp.value, '新');
});

t('增删卡片：只增删该增删的，留下的兄弟身份不变（FLIP 与展开态都靠这个）', () => {
  const box = 现场('<div id="col"><div data-tid="A">甲</div><div data-tid="B">乙</div></div>');
  const col = doc.getElementById('col'), A = col.childNodes[0];
  morph(box, '<div id="col"><div data-tid="A">甲</div><div data-tid="B">乙</div><div data-tid="C">丙</div></div>');
  assert.equal(col.childNodes.length, 3);
  assert.equal(col.childNodes[0], A, '新增一张卡不该殃及原有的卡');
  morph(box, '<div id="col"><div data-tid="A">甲</div></div>');
  assert.equal(col.childNodes.length, 1);
  assert.equal(col.childNodes[0], A);
});

t('折叠态换了：改类不换节点（抽屉照旧是同一个抽屉）', () => {
  const box = 现场('<div id="d" class="fold"><p>内文</p></div>');
  const d = doc.getElementById('d'), p = d.childNodes[0];
  morph(box, '<div id="d" class="fold open"><p>内文</p></div>');
  assert.equal(doc.getElementById('d'), d);
  assert.equal(d.getAttribute('class'), 'fold open');
  assert.equal(d.childNodes[0], p);
});

t('画布不碰：wiki 图谱不会被脉冲擦成白板', () => {
  const box = 现场('<div id="g"><canvas id="wk-g" width="600"></canvas></div>');
  const cv = doc.getElementById('wk-g'); cv.__g签 = 'x';
  morph(box, '<div id="g"><canvas id="wk-g" width="800"></canvas></div>');
  assert.equal(doc.getElementById('wk-g'), cv);
  assert.equal(cv.__g签, 'x');
});

t('标签换了才真替换（span → div 这种结构变化不能糊过去）', () => {
  const box = 现场('<div id="w"><span>甲</span></div>');
  const w = doc.getElementById('w'), 旧 = w.childNodes[0];
  morph(box, '<div id="w"><div>甲</div></div>');
  assert.notEqual(w.childNodes[0], 旧);
  assert.equal(w.childNodes[0].tagName, 'DIV');
});

at('项目边界：一个项目里不许看见另一个项目的东西（2026-08-21 制作人指出）', async () => {
  // 案源：制作人截图——页头写着「监制台 · TK」，工单页却摆着 TF 卡，项管页甘特混着全部项目。
  // 病根有二：① tkL1 的 TF 卡条件写反了（看 TK 时露出 TF，总监当初当成「通往另一个项目的入口」）；
  // ② viewRelay 刻意不过滤，注释还写着「跨项目（口径二）」——那是总监的判断，被制作人推翻。
  // **判据换面（2026-08-22）**：这一组原本清一色 assert.ok(src.includes('某串字'))。
  // 当日给管线层补空态时把 `${p === 'Ticketflow' ? tf : ''}` 挪进了一个中间变量——
  // **行为一字未改，判据照红**；反过来，换个写法照样越界它也照绿。两头都不成立，故整组改真跑。
  const ctx = 装载前端();

  // ① TF 入口卡：只在身处 Ticketflow 时露出，不在别人的地盘上开后门
  await 设项目(ctx, 'Ticketflow');
  assert.match(ctx.tkL1([], []), /自维护/, '身处 Ticketflow 时 TF 卡要在');
  await 设项目(ctx, 'TK');
  assert.ok(!/自维护/.test(ctx.tkL1([], [])), 'TF 卡不许在 TK 视野里露出——那正是被指出的越界');

  // ② 管线卡按项目过滤，且无章者归项目默认（projOf 口径）——原为 grep '.filter((x) => !p || projOf(x) === p)'
  const 管线们 = [
    { id: 'P-1', 名称: 'TK主线', 状态: '活跃', 项目: 'TK' },
    { id: 'P-9', 名称: '别家管线', 状态: '活跃', 项目: 'Ticketflow' },
    { id: 'P-0', 名称: '无章老线', 状态: '活跃' }, // 没写项目 ⇒ 归默认项目（夹具默认 TK）
  ];
  const h = ctx.tkL1(管线们, []);
  assert.ok(h.includes('TK主线'), '本项目的管线卡没了');
  assert.ok(!h.includes('别家管线'), '别的项目的管线卡露在 TK 的管线层上——正是被指出的越界');
  assert.ok(h.includes('无章老线'),
    '没写项目的老管线被一并滤掉了：它在 TK 看不见、在 TF 也看不见，比越界更糟（漏账）');

  // ③ 项管页甘特/队列卡/未归属那一组，判据在 test/relay-scope.test.js（要连着 fetch 桩一起跑，
  //    单跑一个渲染函数量不出「传没传项目参数」这件事），此处不再留同款文本断言。
});

(async () => {
  for (const [名, f] of 异步) { await f(); passed++; console.log('  ✓ ' + 名); }
  require('./helper').收尾('pulse', passed);
})().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
