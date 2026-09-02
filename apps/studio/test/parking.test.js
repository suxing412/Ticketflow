// parking.test.js — 停靠（议程第 33 条，2026-08-27）
//
// 「停靠」＝故意把一张单摁住等人的决定，与「还没轮到放行」是两回事。在此之前它只是流水散文里的
// 人工语义，代码里不存在，一个缺失的标记派生出四个方向相反的症状。本套件逐个症状立判据：
//   ① 项管裁决把停靠单重新开闸（TK-187 16:51/16:52、TK-207 18:17/18:18 两次同分钟对冲）
//   ② 排期把停靠单的粒照排（08-27 今夜十一粒里九粒挂在停靠单上，复判五轮来回挪 15~330 分钟）
//   ③ G1 把停靠单算成项管欠债并逾期误报（01:57 TK-184、02:01 TK-210 各一次）
//   ④ 摘出 G1 后必须有地方接（G26），否则「不误报」退化成「藏起来」——那比误报更坏
//
// H104：每条判据都验行为（调函数看返回/看落盘），不 grep 源码文本。
const assert = require('node:assert');
const life = require('../lib/lifecycle');
const store = require('../lib/core/store');
const gatereg = require('../lib/gatereg');
const brain = require('../lib/pm/brain');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('parking 停靠测试');

const 备待派 = (root, id) => { seed(root, '待审', { id }); life.审过(root, id); return store.find(root, id); };

t('停靠落 fm 三件套且必然撤放行：停靠与放行同时为真是自相矛盾', () => {
  const root = makeRoot();
  备待派(root, 'K-01');
  assert.equal(life.放行(root, 'K-01').ok, true);
  assert.equal(store.find(root, 'K-01').fm.放行, true);

  assert.equal(life.停靠(root, 'K-01', '项目错配，候制作人定夺废弃').ok, true);
  const fm = store.find(root, 'K-01').fm;
  assert.equal(fm.停靠, true, '停靠旗竖起');
  assert.equal(fm.放行, false, '停靠必然含撤放行');
  assert.match(fm.停靠因, /项目错配/, '因由落盘');
  assert.ok(fm.停靠自, '停靠时刻落盘（G26 用它起算停摆，不用建单时刻）');
  assert.equal(store.find(root, 'K-01').state, '待派', '停靠不搬家，单还在队列里看得见');
});

t('因由必填：停不明不白的单等于把单藏起来', () => {
  const root = makeRoot();
  备待派(root, 'K-02');
  assert.ok(!life.停靠(root, 'K-02', '').ok, '空因由拒');
  assert.ok(!life.停靠(root, 'K-02', '   ').ok, '纯空白拒');
  assert.notEqual(store.find(root, 'K-02').fm.停靠, true, '拒了就不许落旗');
  assert.equal(life.停靠(root, 'K-02', '前置人闸未决').ok, true);
});

t('症状①：停靠单不许放行，须先显式解除——堵住职权同分钟对冲', () => {
  const root = makeRoot();
  备待派(root, 'K-03');
  life.停靠(root, 'K-03', '前置人闸 TK-180 未决');
  const r = life.放行(root, 'K-03');
  assert.equal(r.ok, false, '停靠单放行必须被拒');
  assert.match(r.error, /停靠/, '拒因说得出是因为停靠');
  assert.equal(store.find(root, 'K-03').fm.放行, false, '拒了就不许落 放行=true');

  assert.equal(life.解除停靠(root, 'K-03').ok, true);
  const fm = store.find(root, 'K-03').fm;
  assert.equal(fm.停靠, undefined, '解除后旗与因由一并清掉');
  assert.equal(fm.停靠因, undefined);
  assert.equal(fm.放行, false, '解除停靠≠放行：放行仍是 G1 另一道手续');
  assert.equal(life.放行(root, 'K-03').ok, true, '解除后才放得行');
});

t('症状③：G1「待派候放行」不再把停靠单算成项管欠债', () => {
  const root = makeRoot();
  备待派(root, 'K-04');   // 未放行、未停靠 → 真·候项管
  备待派(root, 'K-05');   // 停靠 → 不该进 G1
  life.停靠(root, 'K-05', '项目错配候定夺');

  const g1 = gatereg.判据表.待派候放行(root, { store });
  const ids = g1.map((x) => x.id);
  assert.ok(ids.includes('K-04'), '真候放行的单仍在 G1');
  assert.ok(!ids.includes('K-05'), '停靠单不进 G1——开闸恰恰是错的，算成项管欠债就是误报');
});

t('症状④：摘出 G1 的停靠单落 G26，归属制作人——不误报≠藏起来', () => {
  const root = makeRoot();
  备待派(root, 'K-06');
  life.停靠(root, 'K-06', '等废弃裁决');

  const g26 = gatereg.判据表.停靠候裁(root, { store });
  const hit = g26.find((x) => x.id === 'K-06');
  assert.ok(hit, '停靠单必须在 G26 现身');
  assert.match(hit.因, /废弃裁决/, 'G26 带出因由，人一眼看得出在等什么');
  assert.equal(hit.停摆自, store.find(root, 'K-06').fm.停靠自, '停摆自取停靠时刻');

  const 闸 = gatereg.缺省注册表.find((x) => x.闸号 === 'G26');
  assert.ok(闸, 'G26 已注册');
  assert.equal(闸.归属, '制作人', '停靠的定义就是等一个人的决定');
  assert.equal(闸.判据, '停靠候裁');
});

t('症状②：停靠单的粒不进重排集——排到几点都跑不了，挪它是纯无用功', () => {
  const root = makeRoot();
  备待派(root, 'K-09');   // 正常待派 → 可排
  备待派(root, 'K-10');   // 停靠 → 不可排
  life.停靠(root, 'K-10', '候废弃裁决');

  const 粒 = [
    { 粒ID: 'g-09', 单号: 'K-09', 状态: '已成单', 计划开始: '2026-08-27T01:00' },
    { 粒ID: 'g-10', 单号: 'K-10', 状态: '已成单', 计划开始: '2026-08-27T02:00' },
  ];
  const 集 = brain._重排集(root, { 含已排: true }, 粒).map((g) => g.粒ID);
  assert.ok(集.includes('g-09'), '正常待派单的粒仍可重排');
  assert.ok(!集.includes('g-10'), '停靠单的粒必须排除——08-27 今夜九粒挂停靠单被来回挪 15~330 分钟');
});

t('判读严判 === true：脏值一律当没停靠（宁可多推一张，不可静默藏单）', () => {
  const root = makeRoot();
  备待派(root, 'K-07');
  store.update(root, 'K-07', (fm) => { fm.停靠 = 'true'; }, new Date().toISOString());
  assert.equal(life.已停靠(store.find(root, 'K-07')), false, '字符串 true 不算停靠');

  const g1 = gatereg.判据表.待派候放行(root, { store }).map((x) => x.id);
  assert.ok(g1.includes('K-07'), '脏值单仍留在 G1，不被静默摘走');
  const g26 = gatereg.判据表.停靠候裁(root, { store }).map((x) => x.id);
  assert.ok(!g26.includes('K-07'), '脏值单也不冒充 G26');
});

t('守卫：非待派不可停靠、重复停靠拒、未停靠不可解除', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'K-08' });
  assert.ok(!life.停靠(root, 'K-08', '因').ok, '待审不可停靠');
  life.审过(root, 'K-08');
  assert.equal(life.停靠(root, 'K-08', '因').ok, true);
  assert.ok(!life.停靠(root, 'K-08', '因').ok, '重复停靠拒');
  assert.equal(life.解除停靠(root, 'K-08').ok, true);
  assert.ok(!life.解除停靠(root, 'K-08').ok, '未停靠不可解除');
});

t('因随债下发：G26 不说在等什么，就跟没有这条闸一样', () => {
  // 0.35.1 实测缺陷：判据算得出 因，但 等我() 用固定字段表组装债对象，把它丢了。
  // 活体上九张停靠单只显示单号、因由全空——闸在册却读不出所以然。
  const root = makeRoot();
  备待派(root, 'K-11');
  life.停靠(root, 'K-11', '项目错配第五例，替代单已转 TF 号段，候制作人定夺废弃');

  const r = gatereg.等我(root, { 现在: new Date().toISOString(), deps: { store } });
  const d = (r.债 || []).find((x) => x.闸号 === 'G26' && x.id === 'K-11');
  assert.ok(d, 'G26 债没出来');
  assert.match(String(d.因 || ''), /项目错配/, '因由必须随债下发到消费端，不能只活在判据里');
  assert.ok(String(d.因).length <= 200, '因由限长 200，防止判据往债里塞长文');
});

t('动作口在册且操作域正确：闸上宣告的按钮后面必须真有接口', () => {
  // G26 闸表写着按钮「解除停靠/废弃」。一个点了没反应的按钮比没有这个闸更坏——
  // 人会以为自己已经处置过了。故把「口在不在」立成判据，而不是靠记得去接。
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const 段 = src.slice(src.indexOf('const ACTIONS'), src.indexOf('const ACTIONS') + 12000);
  // 这里查的是**动作注册表里有没有这一格**，不是 grep 源码文本证明功能——
  // 功能由上面七格行为判据管，这一格只管「接线没漏」。
  assert.ok(/\n\s*停靠:\s*\(b\)\s*=>/.test(段), 'ACTIONS 里没有 停靠 动作，G26 的按钮点了没反应');
  assert.ok(/\n\s*解除停靠:\s*\(b\)\s*=>/.test(段), 'ACTIONS 里没有 解除停靠 动作');
  // 操作域：项管不在内——让自动化自己决定何时不受自动化管，是循环
  // 切片终点要从起点之后再找，否则 indexOf('放行: (b)') 会命中更靠前的「实证放行: (b)」，切出空串
  const 起 = 段.indexOf('停靠: (b)');
  const 停段 = 段.slice(起, 段.indexOf('放行: (b)', 起));
  assert.ok(停段.length > 100, '切片没取到停靠动作体（长度 ' + 停段.length + '）——锚点漂了，下面几格等于没验');
  assert.ok(/\['总监', '制作人'\]/.test(停段), '停靠/解除停靠 的操作域必须是 总监/制作人，项管不在内');
  assert.ok(!/'项管'/.test(停段), '项管出现在停靠操作域里——那等于让自动化自己决定何时停自己');
});

t('/api/board 真下发停靠三件——看板画得出钮，全靠这一格', () => {
  // 自证能红时抓出的缺口：gate-buttons 直调 bcard() 传手造对象，**没走 /api/board**，
  // 于是服务端停止下发 停靠因 时它照样绿——卡片画得出钮、却说不出在等什么，而没有判据会红。
  // 端点接线要有端点自己的判据（gatereg.test.js:396 同一教训：谓词有单测 ≠ 端点跑得起来）。
  const { execFileSync } = require('child_process');
  const path = require('path');
  const root = makeRoot();
  备待派(root, 'K-20');
  life.停靠(root, 'K-20', '项目错配候定夺废弃');
  备待派(root, 'K-21');   // 未停靠的对照
  const port = 4937;
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
      const r = await fetch('http://127.0.0.1:${port}/api/board');
      const j = await r.json();
      const 待派 = (j.board && j.board['待派']) || [];
      const g = (id) => 待派.find((x) => x.id === id) || null;
      process.stdout.write('@@' + JSON.stringify({ 码: r.status, 停: g('K-20'), 常: g('K-21') }) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });
  `;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const out = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  assert.equal(out.码, 200, '/api/board 必须 200：' + JSON.stringify(out).slice(0, 160));
  assert.ok(out.停, '停靠单要在待派列里下发');
  assert.equal(out.停.停靠, true, '停靠旗要下发');
  assert.match(String(out.停.停靠因 || ''), /项目错配/, '**因由必须下发**——只给布尔的话界面只能说「它停着」，说不出在等什么');
  assert.ok(out.停.停靠自, '停靠时刻要下发（G26 用它起算停摆）');
  assert.ok(out.常, '未停靠单照常下发');
  assert.equal(out.常.停靠, false, '未停靠的要明确为 false，不是 undefined');
});

console.log('  ' + passed + ' 项通过');
