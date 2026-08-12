// pulse.test.js — 脉冲刷新决策（施工令-048：频闪根治）
// 被测的是 public/app.js 里生产那一份源码（@testable 标记原样抽出），不是抄本：
// 抄本会在下一次改前端时悄悄与实现走散，而这道测试的全部意义就是「界面还闪不闪」有人守着。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
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

// route() 那张真表的键（app.js 传 Object.keys(ROUTES)）
const 视图键 = ['', 'ideas', 'board', 'flow', 'queue', 'agents', 'decisions', 'wiki', 'relay', 'report'];
const 态 = (o) => Object.assign({ 变了: false, 待办: false, 免打扰: false, 可局部: true, 交互中: false, 现在: 0, 上次整页: 0 }, o);

/* ---- 一、局部刷新选择（要件1）---- */

t('登记过的视图一律走原地重绘，不整页', () => {
  for (const h of ['#/board', '#/flow', '#/queue', '#/agents', '#/report', '#/wiki']) {
    const r = pulseTarget(h, 视图键);
    assert.equal(r.类, 'patch', h + ' 应当能原地刷新');
    assert.equal(r.视图, h.replace('#/', ''));
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

t('脉冲轮询里不再直呼 route()（整页重建的旧路已封）', () => {
  const a = src.indexOf('let lastPulse = null;');
  assert.ok(a > 0, '脉冲轮询块找不到了');
  const 块 = src.slice(a, a + 1400);
  assert.ok(!/if \(lastPulse && d\.token !== lastPulse\) route\(\)/.test(块), '旧的「令牌一变就 route()」又回来了');
  assert.ok(块.includes('repaint('), '脉冲块里应当走 repaint 原地重绘');
});

t('详情页秒表格子挂着 data-live，morph 不许碰（要件3）', () => {
  assert.ok(/id="lv-step-t" data-live/.test(src), 'lv-step-t 的 data-live 记号没了，秒表会被脉冲拨回 --:--');
  assert.ok(/id="lv-all-t" data-live/.test(src), 'lv-all-t 的 data-live 记号没了');
  assert.ok(/hasAttribute\('data-live'\)/.test(src), 'morph 里认 data-live 的那道闸没了');
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

console.log(`  —— ${passed} 项通过`);
