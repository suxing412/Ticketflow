// server-obs-api.test.js — 服务端「看得见」那三条的机判（2026-08-22 体检 #51 / #67② / #68② / #25 / #50）
//
// 五件事各自的病灶：
//   #51 关闭升格（人闸超时小时=0）时 /api/attn 仍下发 逾期阈值小时:24 —— 前端拿这个数**自己重算**
//       标记（public/app.js:167-168 / :328），于是「关了升格」的界面照样全红。只清 逾期 数组不够。
//   #67② /api/env 的「监制台目录」note 把态数写成中文「九态」，而 store.STATES 早已 10 态——
//       自检面每加一态就腐一次，如实报的是一个过期的数。
//   #68② 瞭望塔死了没有任何出口。加下岗行不算收口：塔死要有个能被机器读的位。
//   #25  升格环此前挂在 runner 的产线环里，stop() 一按整条掐死——人欠的债跟着产线一起停摆。
//   #50  自动记账的收尾处置是写在 server.js 里的匿名闭包，与 lib/ledger.js 的工厂是两份抄本。
//
// 判据一条不验源码文本：真起服务、真打端点、真读它吐出来的 JSON。
// STUDIO_STUB=1 的桩闸把 runner.start/stop/startLoop/tick **整个空转**（server.js:41-45），
// 于是本文件里凡是观测到的升格，只可能来自开机处那条独立的升格环——这正是 #25 要证的事。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeRoot, seed, 收尾 } = require('./helper');
const store = require('../lib/core/store');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('服务端可观测面测试（#51 / #67② / #68② / #25 / #50）');

const SERVER = path.join(__dirname, '..', 'server.js').replace(/\\/g, '/');

// 起(root, port, 打法, 前置) —— 真起一次服务，在子进程里跑 打法（可多次打端点、可动文件），回带结果。
// 前置 在 require(server.js) **之前**执行：要看「开机那一刻接了什么线」只能在这儿下手。
function 起(root, port, 打法, 前置 = '') {
  const code = `
    const fs = require('fs'); const path = require('path');
    const 记录 = {};
    ${前置}
    require(${JSON.stringify(SERVER)}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const ROOT = ${JSON.stringify(root.replace(/\\/g, '/'))};
      const G = async (u) => { const r = await fetch(B + u); let j = null; try { j = await r.json(); } catch { j = {}; } return [r.status, j]; };
      const P = async (u, body) => { const r = await fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { j = {}; } return [r.status, j]; };
      let out;
      try { out = await (async () => { ${打法} })(); }
      catch (e) { out = { 打法抛错: String((e && e.stack) || e) }; }
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      try { srv.close(); } catch { /* 关不上也不影响取数 */ }
      process.exit(0);
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });`;
  // 子进程退出时 libuv 偶发 `UV_HANDLE_CLOSING` 断言（Windows，srv.close 与 exit 竞速）——
  // 那是收摊阶段的噪声，与被测行为无关。结果已经写进 stdout 了，认标记不认退出码。
  let raw = '';
  try {
    raw = execFileSync(process.execPath, ['-e', code], {
      encoding: 'utf8', timeout: 40000,
      env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
    });
  } catch (e) {
    raw = String((e && e.stdout) || '');
    assert.ok(raw.includes('@@'), '子进程死在出结果之前：' + String((e && e.stderr) || e).slice(0, 400));
  }
  const o = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  assert.ok(!o.起服务失败, '服务没起来：' + o.起服务失败);
  assert.ok(!o.打法抛错, '子进程打法抛错：' + o.打法抛错);
  return o;
}

// ── #51：T<=0 = 关闭升格，阈值那一格必须下发 null ────────────────────────────
t('#51 关闭升格后 /api/attn 的 逾期阈值小时 下发 null、逾期 下发空表（不是留个 0 让前端自己重算成全红）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'P-51a', 验收方式: '保留' }); // H108：原 待验收→完成（G3 完成候终审）；更新时间 2026-07-08，停摆远超 24h
  const o = 起(root, 4971, `
    const 开 = await G('/api/attn');
    const 改 = await P('/api/config/gate', { key: '人闸超时小时', value: 0 });
    const 关 = await G('/api/attn');
    const 复 = await P('/api/config/gate', { key: '人闸超时小时', value: 24 });
    const 再开 = await G('/api/attn');
    return { 开, 改, 关, 复, 再开 };`);

  assert.equal(o.开[0], 200, '/api/attn 本身要活着');
  assert.equal(o.开[1].逾期阈值小时, 24, 'T=24 时阈值照常下发，实测：' + JSON.stringify(o.开[1].逾期阈值小时));
  assert.ok(o.开[1].逾期.some((x) => x.id === 'P-51a'), '造的这笔债本来就该逾期，否则本条测的是空气：' + JSON.stringify(o.开[1].逾期.map((x) => x.id)));

  assert.equal(o.改[0], 200, '写口没收下 人闸超时小时=0：' + JSON.stringify(o.改[1]));
  assert.equal(o.关[1].逾期阈值小时, null, '关闭升格后阈值必须是 null——留个 0 前端照样按 0 小时判全红，实测：' + JSON.stringify(o.关[1].逾期阈值小时));
  assert.deepEqual(o.关[1].逾期, [], '关闭升格后逾期表必须为空，实测：' + JSON.stringify(o.关[1].逾期));
  // 反向：债本身不许跟着消失——关的是「升格」，不是「欠债」
  assert.ok(o.关[1].债.some((x) => x.id === 'P-51a'), '关升格不等于销账，债表里那笔必须还在：' + JSON.stringify((o.关[1].债 || []).map((x) => x.id)));

  // 再开回 24 要能原样回来（证明上一格测的是「T 的判定」，不是「写口把数据写坏了」）
  assert.equal(o.再开[1].逾期阈值小时, 24, '改回 24 应恢复，实测：' + JSON.stringify(o.再开[1].逾期阈值小时));
  assert.ok(o.再开[1].逾期.some((x) => x.id === 'P-51a'), '改回 24 那笔债应重新逾期');
});

// ── #67②：/api/env 报的态数活读 store.STATES ────────────────────────────────
t('#67② /api/env「监制台目录」报的态数 = store.STATES.length（不是写死的中文数字）', () => {
  const root = makeRoot();
  const o = 起(root, 4972, `return await G('/api/env');`);
  assert.equal(o[0], 200, '/api/env 要 200');
  const 组 = (o[1].组 || {})['项目与目录'] || [];
  const 项 = 组.find((x) => x.名称 === '监制台目录');
  assert.ok(项, '/api/env 没有「监制台目录」这一项，实测项名：' + 组.map((x) => x.名称).join('/'));
  assert.equal(项.级别, '绿', '临时根应当可写，实测：' + JSON.stringify(项));
  const m = /^(\d+) 态目录/.exec(String(项.note));
  assert.ok(m, '态数必须是活读出来的阿拉伯数字，实测 note：' + JSON.stringify(项.note));
  assert.equal(Number(m[1]), store.STATES.length,
    `自检面报 ${m[1]} 态、store.STATES 实为 ${store.STATES.length} 态（${store.STATES.join('/')}）——两个数一分叉，自检就在说过期的话`);
  assert.ok(!/[一二三四五六七八九十]态/.test(String(项.note)), '不许再把态数写成中文数字（写死一次就腐一次）：' + JSON.stringify(项.note));
});

// ── #68②：瞭望塔心跳三态 ────────────────────────────────────────────────────
t('#68② /api/watchtower 三态：无塔=null 不假红 / 新戳=在岗 / 陈旧戳=塔死', () => {
  const root = makeRoot();
  const o = 起(root, 4973, `
    const 塔 = path.join(ROOT, '瞭望塔'); const f = path.join(塔, '心跳.txt');
    fs.mkdirSync(塔, { recursive: true });
    const 无塔 = await G('/api/watchtower');                      // 目录在、文件不在
    fs.writeFileSync(f, new Date(Date.now() - 10000).toISOString(), 'utf8');
    const 在岗 = await G('/api/watchtower');                      // 10s 前的戳
    fs.writeFileSync(f, new Date(Date.now() - 300000).toISOString(), 'utf8');
    const 塔死 = await G('/api/watchtower');                      // 300s 前的戳（远超 90s＝三个心跳周期）
    fs.writeFileSync(f, '这不是时刻', 'utf8');
    const 坏戳 = await G('/api/watchtower');
    return { 无塔, 在岗, 塔死, 坏戳 };`);

  assert.equal(o.无塔[0], 200, '端点要 200');
  assert.strictEqual(o.无塔[1].在岗, null, '没装塔必须是 null（不立债不假红）——报 false 会把每一台没装塔的机器打满红：' + JSON.stringify(o.无塔[1]));
  assert.match(String(o.无塔[1].说明), /未装瞭望塔/, '无塔要说人话：' + JSON.stringify(o.无塔[1]));

  assert.strictEqual(o.在岗[1].在岗, true, '10 秒前的戳必须判在岗（守护 30s 一跳，阈值 90s＝三拍）：' + JSON.stringify(o.在岗[1]));
  assert.ok(o.在岗[1].秒龄 >= 0 && o.在岗[1].秒龄 <= 90, '秒龄要如实：' + JSON.stringify(o.在岗[1]));
  assert.equal(o.在岗[1].阈值秒, 90, '阈值必须与 G20 闸判据同一把尺（lib/gatereg.js:265 的 90 秒＝三个心跳周期）；两处各写一个数就是两把尺');

  assert.strictEqual(o.塔死[1].在岗, false, '300 秒前的戳必须判塔死——阈值形同虚设的话这一格是绿的：' + JSON.stringify(o.塔死[1]));
  assert.ok(o.塔死[1].秒龄 > 90, '塔死那格要把秒龄摆出来（多久没跳了）：' + JSON.stringify(o.塔死[1]));

  assert.strictEqual(o.坏戳[1].在岗, null, '戳读不出来是「判不出」不是「塔死」：' + JSON.stringify(o.坏戳[1]));
  assert.match(String(o.坏戳[1].说明), /读不出/, '坏戳要把原文摘给人看：' + JSON.stringify(o.坏戳[1]));
});

// ── #25：升格环与执行器开关解耦，挂在开机处 ─────────────────────────────────
t('#25 产线整条空转（桩台把 runner.start/stop/startLoop/tick 全哑掉）时，人闸升格照样落账', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'P-25a', 验收方式: '保留' }); // H108：原 待验收→完成；停摆远超 24h 的一笔真债
  const o = 起(root, 4974, `
    const 拦 = await G('/api/runner');
    let st = {};
    try { st = JSON.parse(fs.readFileSync(path.join(ROOT, '.studio-state.json'), 'utf8')); } catch { st = {}; } // 一次升格都没发生时这个文件根本不存在
    const jd = path.join(ROOT, 'journal');
    const 流水 = fs.readdirSync(jd).map((f) => fs.readFileSync(path.join(jd, f), 'utf8')).join('')
      .split(String.fromCharCode(10)).filter((l) => l.indexOf('人闸') >= 0);
    return { 拦, 升格: st.人闸升格 || null, 流水 };`);

  // 前置：确认这一台的产线**确实是死的**——否则升格可能是 tick() 顺手跑出来的，本条就白测了
  assert.equal(o.拦[0], 200);
  const 拦截 = JSON.stringify(o.拦[1]);
  assert.ok(/桩台|stub|STUB/i.test(拦截) || o.拦[1].桩台拦截, '本条要求产线被桩闸掐死，/api/runner 没给出桩台位：' + 拦截.slice(0, 200));

  assert.ok(o.升格 && Object.keys(o.升格).length > 0,
    '产线停摆时一笔逾期都没升格——升格环没挂在开机处（或又被绑回 runner 的产线环上）。实测 state.人闸升格 = ' + JSON.stringify(o.升格));
  assert.ok(Object.keys(o.升格).some((k) => k.endsWith(':P-25a')),
    '升格账里没有那笔真债，账对不上：' + JSON.stringify(Object.keys(o.升格)));
  assert.ok(o.流水.some((l) => l.includes('人闸超时升格')), '升格要在流水里留痕，实测人闸相关行：' + JSON.stringify(o.流水));
});

// ── #50：自动记账的收尾处置走 lib/ledger.js 的具名工厂，不是 server.js 里的匿名闭包 ──────
t('#50 开机接的自动记账回调就是 ledger.记账回调(ROOT) 那一份（不是 server.js 里另抄的一份）', () => {
  const root = makeRoot();
  // 记账拍间隔调到 0.01 分钟（600ms），才等得到一次真拍；生产缺省是 10 分钟。
  const cp = path.join(root, 'studio.config.json');
  const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
  c.执行器 = { ...(c.执行器 || {}), 记账间隔分钟: 0.01 };
  fs.writeFileSync(cp, JSON.stringify(c), 'utf8');

  const o = 起(root, 4975, `
    await new Promise((r) => setTimeout(r, 1500)); // 等两拍
    return 记录;`, `
    // 在 server.js 之前把 lib/ledger 的两个口都罩住：commitStudio 不真跑 git，只记下它收到了什么。
    const L = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'ledger.js').replace(/\\/g, '/'))});
    const 真工厂 = L.记账回调;
    记录.工厂调用 = 0; 记录.拍数 = 0; 记录.同一份 = null; 记录.失败留痕 = [];
    let 最近工厂产物 = null;
    L.记账回调 = (r, deps) => { 记录.工厂调用 += 1; 记录.工厂收到根 = r; 最近工厂产物 = 真工厂(r, deps); return 最近工厂产物; };
    L.commitStudio = (r, done) => {
      记录.拍数 += 1;
      记录.同一份 = (done === 最近工厂产物); // 接进去的必须就是工厂吐出来的那一个
      try { done(false, 'add 失败'); } catch (e) { 记录.回调抛错 = String(e.message); }
    };`);

  assert.ok(o.拍数 >= 1, '一拍都没跑到，本条什么也没测到（记账间隔没吃进去？）：' + JSON.stringify(o));
  assert.ok(o.工厂调用 >= 1,
    'server.js 从头到尾没调过 ledger.记账回调()——它还在用自己那份内联匿名闭包（#50 未落）。实测：' + JSON.stringify(o));
  assert.equal(o.同一份, true, '接进 commitStudio 的回调不是工厂吐出来的那一个：' + JSON.stringify(o));
  assert.equal(String(o.工厂收到根 || '').replace(/\\/g, '/'), root.replace(/\\/g, '/'), '工厂拿到的根不对：' + JSON.stringify(o.工厂收到根));
  assert.ok(!o.回调抛错, '回调吃到失败时抛了：' + o.回调抛错);
});

收尾('', passed);
