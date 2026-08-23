// single-instance.test.js — Electron 单实例锁的**行为**判据（2026-08-22 体检 #20/#63）
//
// 案源三重：
//   ① 08-20 22:16–23:16 三封 OAuth 急件每封发两遍、相隔 4.7 秒。哨兵只有一个调用点、
//      同态 30 分钟至多一封——单实例产生不出 4.7 秒的重复对，只能是两个进程各跑各的 15 分钟拍。
//   ② 项管台账三份 `台账.json.损毁-*`，是同一份文件被并发存了三遍。
//   ③ 坑档案里那条完工判据白纸黑字写着「Electron 单实例锁挡住重复拉起」，
//      而全库 grep requestSingleInstanceLock **零命中**——判据自称有的东西，代码里没有。
//
// **本套件存在的理由**：锁补上之后，判据仍然是 test/wiring-fixes.test.js 里五条 assert.match
// 源码文本。2026-08-22 复核实测：**把锁整块拆掉，那五条断言仍全绿**。
// 这里改成：桩掉 electron 与 ./server，把真的 main.js require 一遍，看它到底干了什么。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { spawn } = require('child_process');
const { 收尾 } = require('./helper');

let passed = 0;
const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('单实例锁行为测试');

const MAIN = require.resolve('../main.js');
const SERVER = path.resolve(__dirname, '..', 'server.js');

// 跑一遍真的 main.js，把 electron 与 ./server 换成桩，返回它干过的事
async function 跑main({ 拿到锁 }) {
  const 记 = {
    起服务次数: 0, server被require: 0, quit次数: 0, 监听: {}, 流水: [], 窗动作: [],
    whenReady调用: 0, requestLock调用: 0,
  };
  const 窗 = {
    isMinimized: () => true,
    restore: () => 记.窗动作.push('restore'),
    show: () => 记.窗动作.push('show'),
    focus: () => 记.窗动作.push('focus'),
    isFocused: () => true,
    webContents: {
      session: { clearCache: async () => {}, flushStorageData: () => {} },
      setWindowOpenHandler: () => {},
      capturePage: async () => ({ toPNG: () => Buffer.alloc(0) }),
    },
    loadURL: () => {}, on: () => {}, setBackgroundColor: () => {},
  };
  const 桩electron = {
    app: {
      requestSingleInstanceLock: () => { 记.requestLock调用 += 1; return 拿到锁; },
      quit: () => { 记.quit次数 += 1; },
      on: (名, fn) => { (记.监听[名] = 记.监听[名] || []).push(fn); },
      // 立即 resolve：真 Electron 里 whenReady 也是必然会到的。
      // 「app.quit() 抢在 whenReady 前面」是赛跑不是闸——这里把赛跑结果固定在最坏那一侧。
      whenReady: () => { 记.whenReady调用 += 1; return Promise.resolve(); },
    },
    BrowserWindow: Object.assign(function () { return 窗; }, { getAllWindows: () => [窗] }),
    shell: { openExternal: () => {} },
    dialog: { showSaveDialog: async () => ({ canceled: true }) },
    ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
    Notification: Object.assign(function () { return { on: () => {}, show: () => {} }; }, { isSupported: () => false }),
  };
  const 桩server = { start: async () => { 记.起服务次数 += 1; return { port: 4270, initError: null }; } };
  const 桩journal = { append: (root, 文) => 记.流水.push(文) };
  const 桩config = { resolveRoot: () => 'D:/假数据根', load: () => ({}) };

  const 原load = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === 'electron') return 桩electron;
    if (parent && parent.filename === MAIN) {
      if (req === './server') { 记.server被require += 1; return 桩server; }
      if (req === './lib/journal') return 桩journal;
      if (req === './lib/core/config') return 桩config;
    }
    return 原load.call(this, req, parent, isMain);
  };
  try {
    delete require.cache[MAIN];
    require(MAIN);
    // whenReady().then(createWindow) 是微任务：不把事件循环转几拍，起服务那一步还没发生
    // 就把桩撤了——而撤了桩之后 createWindow 里的 require('./server') 会去加载**真的**
    // server.js（它顶层就 config.load + ensureDirs 动数据根）。第一版就是这么假红的。
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
  } finally {
    Module._load = 原load;
    delete require.cache[MAIN];
    delete require.cache[SERVER]; // 绝不让真 server.js 留在缓存里被下一轮拿走
  }
  return 记;
}

(async () => {
  await t('拿不到锁的那一份：不起服务、退出、不注册 second-instance', async () => {
    const r = await 跑main({ 拿到锁: false });
    assert.equal(r.requestLock调用, 1, '锁得真的去抢一次');
    assert.equal(r.起服务次数, 0,
      '第二份不许起服务——抢 4270、抢台账、跑自己的 15 分钟拍全从这一步开始。'
      + `实测起了 ${r.起服务次数} 次（whenReady 被调 ${r.whenReady调用} 次）`);
    assert.equal(r.quit次数, 1, '第二份必须退出，实际 quit ' + r.quit次数 + ' 次');
    assert.ok(!r.监听['second-instance'],
      '没拿到锁的那份不该注册 second-instance（它自己就是那个 second instance）');
    assert.equal(r.whenReady调用, 0, 'whenReady 都不该挂——挂了就是把「退不退得成」交给赛跑');
  });

  await t('拿不到锁时连 server 模块都不许被 require（模块作用域就在动数据根）', async () => {
    // server.js 顶层就跑 config.resolveRoot() / config.load(ROOT) / store.ensureDirs(ROOT)。
    // 顶层 require 意味着「马上要退出的那一份」先对数据根动过一次手——锁在下面，副作用在上面。
    const r = await 跑main({ 拿到锁: false });
    assert.equal(r.server被require, 0,
      'server 在退出分支上被 require 了 ' + r.server被require + ' 次——数据根的副作用发生在闸之前');
    const 好 = await 跑main({ 拿到锁: true });
    assert.equal(好.server被require, 1, '拿到锁的那份当然要 require——否则上一条断言什么也没证明');
  });

  await t('拿不到锁时把「已有实例在跑」写进流水（console 在 GUI 进程里没人看得见）', async () => {
    const r = await 跑main({ 拿到锁: false });
    assert.equal(r.流水.length, 1, '要留一条痕，实际 ' + r.流水.length + ' 条');
    assert.match(r.流水[0], /已有实例在跑/, '留痕内容：' + r.流水[0]);
    assert.match(r.流水[0], /单实例锁/, '要说清是被哪道闸挡的：' + r.流水[0]);
  });

  await t('拿到锁的那一份：照常起服务，并注册 second-instance', async () => {
    const r = await 跑main({ 拿到锁: true });
    assert.equal(r.quit次数, 0, '拿到锁的不该退出');
    assert.equal(r.whenReady调用, 1, '拿到锁的要挂 whenReady');
    assert.equal(r.起服务次数, 1, '正常那一份必须真起服务，实际 ' + r.起服务次数 + ' 次');
    assert.ok(r.监听['second-instance'] && r.监听['second-instance'].length === 1, '要注册且只注册一次');
    assert.deepEqual(r.流水, [], '正常启动不该往流水里写「已有实例在跑」');
  });

  await t('第二次双击 → 把已在跑的那扇窗拉到前台（restore/show/focus 真被调到）', async () => {
    const r = await 跑main({ 拿到锁: true });
    r.监听['second-instance'][0]();
    assert.deepEqual(r.窗动作, ['restore', 'show', 'focus'],
      '静默无反应会让人以为双击坏了、再点几下——那正是并发实例的来源。实测：' + r.窗动作.join('、'));
  });

  // ══════════ #63 数据根单写者锁：contract 判据（真占真放真探活）══════════
  // 上面五格锁住的是 **Electron 外壳**这一侧。而 08-20 那三对 4.7 秒重复急件的根因
  // 是「两个进程各跑各的 15 分钟拍」——`node server.js` 这条通道 Electron 的锁管不着，
  // 定时拍（滞留巡检 / 自动记账 / 项管在途巡检 / 执行器派发）全是**写**数据根的动作。
  //
  // 本组判据的被测对象是 lib/rootlock.js。**它此刻还没落地**（补丁已交需协调，
  // 因为要连着动 server.js 与 main.js，两者都不在本组名下）。这里不写形状备注、
  // 不写占位——写的是**可直接激活的真行为判据**：模块路径可用 ROOTLOCK_MODULE 注入，
  // 文件一落地这一组立刻真跑，落地方不必回来补判据。
  // 自证能红的做法（本轮实测过，见收工汇报）：把参考实现拷到临时文件，逐条改坏
  // （探活改成恒 true / 抢不到时顺手删别人的锁 / 坏锁判成不可抢），每一条都当场转红。
  const 锁模块 = process.env.ROOTLOCK_MODULE || path.resolve(__dirname, '..', 'lib', 'rootlock.js');
  if (!fs.existsSync(锁模块)) {
    console.log('  · #63 数据根单写者锁尚未落地（' + 锁模块 + ' 不在）——精确补丁已交需协调；');
    console.log('    本组是**待激活判据**：该文件一出现即自动生效，无需回头补。');
  } else {
    const RL = require(锁模块);
    const 新根 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rlock-'));
    // 造一个**别人家的**活进程：pid 必须既不是自己、又真的在跑。
    // unref + 统一登记收尸：不 unref 时子进程句柄会把本进程的事件循环钉住，套件跑完不退
    // （实测第一版就这么挂了 2 分钟）；不登记则会漏下永远不死的孤儿 node。
    const 活儿 = [];
    const 起活进程 = () => {
      const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      c.unref(); 活儿.push(c); return c;
    };
    const 收尸 = () => { for (const c of 活儿) { try { c.kill(); } catch { /* 已经死了最好 */ } } };
    process.on('exit', 收尸);
    const 写锁 = (root, o) => fs.writeFileSync(RL.锁文件(root), JSON.stringify(o), 'utf8');
    const 现在 = () => new Date().toISOString();
    const 早 = (秒) => new Date(Date.now() - 秒 * 1000).toISOString();

    await t('#63 空根：占得到，锁文件真落在 <根>/.studio.lock 且写的是本进程 pid', async () => {
      const root = 新根();
      const r = RL.占(root);
      assert.equal(r.得, true, '空根都占不到就没法用：' + r.因);
      const f = RL.锁文件(root);
      assert.ok(fs.existsSync(f), '锁得真落盘——只在内存里的锁跨不了进程，而跨进程正是这条闸的全部意义');
      assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).pid, process.pid);
    });

    await t('#63 别人在岗且新鲜：占不到，而且**一个字节都不许动它的锁**', async () => {
      const root = 新根();
      const 他 = 起活进程();
      try {
        写锁(root, { pid: 他.pid, 根: root, 起于: 现在(), 续于: 现在() });
        const 原文 = fs.readFileSync(RL.锁文件(root), 'utf8');
        const r = RL.占(root);
        assert.equal(r.得, false, '别人活着且刚续过期，还能占到 = 这把锁根本不锁');
        assert.equal(fs.readFileSync(RL.锁文件(root), 'utf8'), 原文,
          '抢不到就该原地退开——顺手改写别人的锁会把在岗那份挤成「不是自己的锁」，两边一起失效');
        assert.ok(String(r.因 || '').includes(String(他.pid)), '说清是被谁挡的：' + r.因);
      } finally { 收尸(); }
    });

    await t('#63 持有者已死：可抢（强杀不走 before-quit，锁必然留在原地）', async () => {
      const root = 新根();
      const 尸 = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
      await new Promise((r) => 尸.on('exit', r));
      写锁(root, { pid: 尸.pid, 根: root, 起于: 现在(), 续于: 现在() });   // 时间戳很新，只有 pid 死了
      const r = RL.占(root);
      assert.equal(r.得, true, '换装.ps1 的 Stop-Process -Force 之后就是这个态——抢不到就等于换装后执行器永远不开工');
      assert.equal(RL.读锁(root).pid, process.pid, '抢到就要改写成自己的 pid');
    });

    await t('#63 活着但久未续期：过了陈旧窗照样可抢（pid 复用兜底）', async () => {
      const root = 新根();
      const 他 = 起活进程();
      try {
        写锁(root, { pid: 他.pid, 根: root, 起于: 早(9999), 续于: 早(9999) });
        assert.equal(RL.占(root, { 陈旧秒: 120 }).得, true, '停更 9999 秒还占着 = 死锁，必须能抢');
        写锁(root, { pid: 他.pid, 根: root, 起于: 现在(), 续于: 现在() });
        assert.equal(RL.占(root, { 陈旧秒: 120 }).得, false, '刚续过的不许抢——否则陈旧窗形同虚设');
      } finally { 收尸(); }
    });

    await t('#63 续期只续自己的；放只放自己的（别人的锁删不动）', async () => {
      const root = 新根();
      assert.equal(RL.占(root).得, true);
      const t0 = RL.读锁(root).续于;
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(RL.续期(root), true);
      assert.notEqual(RL.读锁(root).续于, t0, '续期要真的把时间戳往前推，否则自己会被陈旧窗判死');
      const 他 = 起活进程();
      try {
        写锁(root, { pid: 他.pid, 根: root, 起于: 现在(), 续于: 现在() });
        assert.equal(RL.续期(root), false, '不是自己的锁不许续');
        assert.equal(RL.放(root), false, '不是自己的锁不许放');
        assert.ok(fs.existsSync(RL.锁文件(root)), '别人的锁文件必须还在');
      } finally { 收尸(); }
    });

    await t('#63 放掉之后别人能占（正常退出后不留死锁）', async () => {
      const root = 新根();
      assert.equal(RL.占(root).得, true);
      assert.equal(RL.放(root), true);
      assert.ok(!fs.existsSync(RL.锁文件(root)), '放 = 锁文件真消失');
      写锁(root, { pid: 起活进程().pid, 根: root, 起于: 现在(), 续于: 现在() });   // 别人随即占上
      assert.equal(RL.占(root).得, false);
    });

    await t('#63 锁文件坏了 → 判可抢、不抛（宁可漏锁一次，不可让计划任务永久拒启）', async () => {
      const root = 新根();
      fs.writeFileSync(RL.锁文件(root), '这不是 JSON{{{', 'utf8');
      assert.equal(RL.占(root).得, true, '一把会把自己锁死的锁比没有锁更坏——人只会学会删锁文件，然后连锁一起忘掉');
      const root2 = 新根();
      写锁(root2, { pid: 起活进程().pid, 根: root2 });                        // 有活 pid 但没时间戳
      assert.equal(RL.占(root2).得, true, '没时间戳也算坏锁');
    });

    await t('#63 两个数据根互不干涉（桩台/实弹台/测试临时根同时跑不许互锁）', async () => {
      const a = 新根(); const b = 新根();
      assert.equal(RL.占(a).得, true);
      assert.equal(RL.占(b).得, true, '锁是按根发的，不是全局唯一——否则 makeRoot 的每个套件都要排队');
      assert.notEqual(RL.锁文件(a), RL.锁文件(b));
    });
  }

  /* 口径提醒（2026-08-22 实测踩过，留给下一个人）：
     真机上验这把锁**不许数「叫监制台的进程有几个」**。Electron 一个实例天然有 5 个进程
     （主 + renderer/GPU/network/utility），portable 外壳自解压后还会再常驻一个——
     按进程数判，第一次实测就误判成「锁没生效」。真机唯一口径是「谁在听 4270」。
     而 Electron 这把锁只锁 Electron 外壳：`node server.js` 那条通道它管不着，
     要堵得把锁挪到数据根（体检 #63 的 rootlock 方案，动 server.js，已作为待协调项交回）。 */

  收尾('单实例锁行为', passed);
})().catch((e) => { console.error('  ✗ ' + (e && e.message)); process.exitCode = 1; });
