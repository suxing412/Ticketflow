// patrol-tick.test.js — 15 分钟巡检拍：一只狗炸掉不许拖死后面的（2026-08-21 立案，08-22 重写）
//
// 案源：六个动作串在同一个 try 里，catch 体是 `{ /* 巡检失败不阻塞 */ }` —— 零 journal、零 inbox。
// 任一步同步抛出，后面几只当拍全不执行，而外面看不出任何异样。
// 被掐掉的里头就有 OAuth 续命哨兵，而 08-21 早晨 06:40 那次 token 过期正是它该管的。
//
// 08-22 体检两条判决，本套件同时了结：
//   #24「其实仍在」——逐狗助手在位，但**第①步在途扫描仍裸在逐狗之外**，先炸的仍会把后面掐掉。
//   #28「判据不足」——连炸立债的消费端（gatereg G16）有判据，**生产端一条没有**：把生产端
//                     整套拆掉，全仓测试照样绿。
// 首版判据全是 `assert.match(server.js 源码, /某串字/)`，本项目已明令不算数——既漏真病
//（换个写法照样有病），又误伤重构（改个变量名就假红）。故本套件**一条文本判据不留**：
// 拍体已搬进 lib/pm/patroltick.js，这里真注桩、真跑拍、真读 state、真跑 gatereg 消费端。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeRoot, 收尾 } = require('./helper');
const { 造巡检拍 } = require('../lib/pm/patroltick');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('巡检拍测试');

// 造一套全绿的桩 + 调用计数器。炸哪只由 opts.炸 指定（狗名数组）。
function 台(root, opts = {}) {
  const 炸 = new Set(opts.炸 || []);
  const 计 = { 在途扫描: 0, 巡检记账: 0, 巡检告警: 0, 零派发看门狗: 0, 打点停滞巡检: 0, 零输出看门狗: 0, 'OAuth 哨兵': 0, 池衡巡检: 0 };
  const 痕 = []; const 信箱 = [];
  const 关 = (名, 值) => { 计[名]++; if (炸.has(名)) throw new Error(名 + '故意炸'); return 值; };
  const deps = {
    journal: { append: (_r, s) => 痕.push(s) },
    store: { list: () => 关('在途扫描', opts.在途 || []) },
    runner: { running: new Map(opts.会话 || []) },
    pmLedger: { event: (_r, _t, p) => 关('巡检记账', 记账参数.push(p)) },
    patrol: {
      零派发告警: () => 关('零派发看门狗'),
      打点停滞: () => 关('打点停滞巡检'),
      零输出: () => 关('零输出看门狗'),
    },
    oauth: { 哨兵: async () => 关('OAuth 哨兵') },
    wake: { 池衡巡检: async () => 关('池衡巡检') },
    inbox: { post: (_r, 级, 题, 摘) => 信箱.push({ 级, 题, 摘 }) },
    // state 走真盘：G16 消费端要从 .studio-state.json 里读回来，注内存桩就把两端的接线断了
    state: require('../lib/core/state'),
    now: () => opts.现在 || Date.parse('2026-08-22T10:00:00Z'),
  };
  const 记账参数 = [];
  // 告警那只（journal + inbox 各一发）单独包：它的炸法与其余不同
  if (炸.has('巡检告警')) {
    const 原 = deps.inbox.post;
    deps.inbox.post = (r, 级, 题, 摘) => { if (题 === '巡检异常') { 计.巡检告警++; throw new Error('巡检告警故意炸'); } return 原(r, 级, 题, 摘); };
  }
  return { 拍: 造巡检拍(() => root, () => (opts.cfg || {}), { deps }), 计, 痕, 信箱, 记账参数 };
}

t('全绿一拍：七只狗全跑到，本拍全好，state 不留异常账', () => {
  const root = makeRoot();
  const s = 台(root);
  const r = s.拍();
  assert.equal(r.本拍全好, true);
  for (const 名 of ['在途扫描', '巡检记账', '零派发看门狗', '打点停滞巡检', '零输出看门狗', 'OAuth 哨兵', '池衡巡检']) {
    assert.equal(s.计[名], 1, `${名} 该跑一次，实测 ${s.计[名]} 次`);
  }
  assert.deepEqual(s.痕, [], '全绿不该留异常痕');
  assert.equal(require('../lib/core/state').read(root).巡检异常拍 || 0, 0);
});

t('#24 第①步在途扫描炸掉，后面六只照跑（先炸的不许把后面掐掉）', () => {
  const root = makeRoot();
  const s = 台(root, { 炸: ['在途扫描'] });
  const r = s.拍();
  assert.equal(s.计.在途扫描, 1, '①确实被调了');
  for (const 名 of ['零派发看门狗', '打点停滞巡检', '零输出看门狗', 'OAuth 哨兵', '池衡巡检']) {
    assert.equal(s.计[名], 1, `①炸了，${名} 仍必须跑——串成同生共死正是本条要治的病（实测 ${s.计[名]} 次）`);
  }
  assert.match(s.痕.join(''), /在途扫描 异常：在途扫描故意炸/, '炸了要留痕，且指名道姓是谁炸的');
  assert.equal(s.计.巡检记账, 0, '扫不到就别记账——拿「在途 0」冒充真读数，比缺一拍心跳更坏');
  assert.equal(r.本拍全好, false, '①炸了本拍不算好，连炸计数才数得对');
});

t('一只中段的狗炸掉，其后各只照跑；痕里点名，返回值汇总成假', () => {
  const root = makeRoot();
  const s = 台(root, { 炸: ['零派发看门狗'] });
  const r = s.拍();
  assert.equal(s.计.零派发看门狗, 1);
  assert.equal(s.计.打点停滞巡检, 1, '零派发炸了，打点停滞照跑');
  assert.equal(s.计.零输出看门狗, 1);
  assert.equal(s.计['OAuth 哨兵'], 1, 'OAuth 续命哨兵不许被前面的狗掐掉——08-21 那次 token 过期正因此漏管');
  assert.equal(s.计.池衡巡检, 1);
  assert.match(s.痕.join(''), /零派发看门狗 异常：/);
  assert.equal(r.本拍全好, false);
});

t('在途扫描能扫出异常并告警；告警那只炸了也不拖死后面', () => {
  const root = makeRoot();
  const 单 = [{ id: 'TK-1', fm: { 父单类型: null, 预计时间: '0.5' } }];
  const 好 = 台(root, { 在途: 单 });
  好.拍();
  assert.deepEqual(好.记账参数[0], { 在途: 1, 异常: 1 }, '在途 1 张、无执行会话即 1 条异常——记账数要真是扫出来的');
  assert.ok(好.信箱.find((m) => m.题 === '巡检异常' && /TK-1 在途但无执行会话/.test(m.摘)), '异常要进信箱');

  const 坏 = 台(root, { 在途: 单, 炸: ['巡检告警'] });
  const r = 坏.拍();
  assert.equal(坏.计.巡检告警, 1);
  assert.equal(坏.计.池衡巡检, 1, '告警炸了，后面的池衡巡检照跑');
  assert.equal(r.本拍全好, false);
});

t('#28 生产端：连炸三拍才立债，第三拍发急件，且消费端 G16 真捞得到（两端接一次线）', () => {
  const root = makeRoot();
  const st = require('../lib/core/state');
  const gr = require('../lib/gatereg');
  const G16 = (r) => gr.等我(r, {}).债.filter((d) => d.闸号 === 'G16');
  const s = 台(root, { 炸: ['零派发看门狗'] });

  s.拍();
  assert.equal(st.read(root).巡检异常拍, 1, '第一拍：记数');
  assert.ok(st.read(root).巡检异常起, '第一拍要记下起点——G16 据它算欠了多久');
  assert.equal(G16(root).length, 0, '一拍不立债：一次异常可能只是瞬时的');
  const 起 = st.read(root).巡检异常起;

  s.拍();
  assert.equal(st.read(root).巡检异常拍, 2, '第二拍：累加');
  assert.equal(G16(root).length, 0, '两拍还不算——阈值 3 拍 = 45 分钟');
  assert.equal(st.read(root).巡检异常起, 起, '起点不许被后续拍覆盖，否则停摆时长永远算成刚发生');

  s.拍();
  assert.equal(st.read(root).巡检异常拍, 3, '第三拍：连炸计数到位');
  const 急 = s.信箱.find((m) => m.级 === '急' && m.题 === '巡检连炸');
  assert.ok(急, '三拍必须发急件——坏了没人知道正是本条要治的病');
  assert.match(急.摘, /连续 3 拍/);
  const 债 = G16(root);
  assert.equal(债.length, 1, '生产端写的数，消费端 G16 要真能立成债');
  assert.equal(债[0].id, '巡检');
  assert.ok(债[0].停摆小时 != null, '停摆小时算得出来——靠的是第一拍写下的 巡检异常起');

  s.拍();
  assert.equal(st.read(root).巡检异常拍, 4, '还在炸就继续累加');
  assert.equal(s.信箱.filter((m) => m.题 === '巡检连炸').length, 1, '急件只在恰好第三拍发一封，不每拍刷屏');
});

t('#28 生产端：好了即清零，债当场消失', () => {
  const root = makeRoot();
  const st = require('../lib/core/state');
  const gr = require('../lib/gatereg');
  const 炸台 = 台(root, { 炸: ['零输出看门狗'] });
  炸台.拍(); 炸台.拍(); 炸台.拍();
  assert.equal(st.read(root).巡检异常拍, 3);
  assert.equal(gr.等我(root, {}).债.filter((d) => d.闸号 === 'G16').length, 1);

  // 同一台修好了：桩恢复正常，再跑一拍
  const 好台 = 台(root);
  好台.拍();
  const s2 = st.read(root);
  assert.equal(s2.巡检异常拍, 0, '好了即清零');
  assert.equal(s2.巡检异常起, null, '起点也要清——不清就会把下一次的停摆时长算成从上次算起');
  assert.equal(gr.等我(root, {}).债.filter((d) => d.闸号 === 'G16').length, 0, '债当场消失');
});

t('连炸记账自己坏了，不许反过来把巡检拍打断（末段兜底）', () => {
  const root = makeRoot();
  const 跑过 = [];
  const 拍 = 造巡检拍(() => root, () => ({}), {
    deps: {
      journal: { append: () => {} },
      store: { list: () => [] },
      runner: { running: new Map() },
      pmLedger: { event: () => {} },
      patrol: { 零派发告警: () => 跑过.push('零派发'), 打点停滞: () => 跑过.push('打点'), 零输出: () => 跑过.push('零输出') },
      oauth: { 哨兵: async () => {} },
      wake: { 池衡巡检: async () => 跑过.push('池衡') },
      inbox: { post: () => {} },
      state: { read: () => { throw new Error('state 盘坏了'); }, update: () => { throw new Error('state 盘坏了'); } },
    },
  });
  const r = 拍();
  assert.equal(r.本拍全好, true, '七只狗都好，本拍就是好的——state 写不下去不该反过来污染判定');
  assert.deepEqual(跑过, ['零派发', '打点', '零输出', '池衡'], '狗照跑完，异常没往外抛');
  assert.doesNotThrow(() => 拍(), '下一拍照常起得来，不会被上一拍的记账异常带走');
});

t('接线判据：server.js 真的把拍体挂上了（搬走却没接回去＝巡检整体消失，无人察觉）', () => {
  const root = makeRoot();
  const code = `
    const m = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'pm', 'patroltick.js').replace(/\\/g, '/'))});
    const 见 = [];
    m.造巡检拍 = (取ROOT, 取cfg, opts) => { 见.push([typeof 取ROOT, typeof 取cfg, typeof (opts || {}).保存]); return () => {}; };
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js').replace(/\\/g, '/'))}).start().then(({ server: srv }) => {
      process.stdout.write('@@' + JSON.stringify(见) + '@@');
      srv.close(); process.exit(0);
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: '4958', STUDIO_STUB: '1' },
  });
  const 见 = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || 'null');
  assert.deepEqual(见, [['function', 'function', 'function']],
    'server 起服务时必须造出且仅造出一个巡检拍，ROOT/cfg 传取值函数（向导会就地重挂），并把 saveCfg 交下去');
});

收尾('', passed);
