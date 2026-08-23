// liveproof.test.js — 活体自证：版本 · 码印 · 闸表（2026-08-22 体检 #0/#10/#39/#56）
//
// 案源：G15/码印这条闸专治「源码改了、跑着的还是旧的」，而**它自己就装在被审计的产物里**。
// 08-22 实测跑着的 0.27.0 里根本没有 G15，而当天的判据是 `grep -c G15 ≥1` 与
// `assert.match(server.js, /package.json.version/)` ——两条 grep 的都是**源码**，源码里当然有。
// 复核实测：把 server.js 的 `版本: require('./package.json').version` 改成写死的 '0.27.0'，
// 那五条断言仍全绿。一条只会绿的判据，比没有判据更坏。
//
// 本套件真起一次服务、真打接口，把回来的数跟本进程算出来的真值比：
//   · /api/version 的 版本 必须等于 package.json 的真版本号（写死一个常量就红）
//   · /api/version 的 码印 必须等于 lib/buildstamp.活体().指纹（buildstamp 掉了就红）
//   · /api/attn 的 注册 闸号清单必须与 gatereg.缺省注册表 一字不差（少一条闸就红）
//   · /api/attn 的 失败 必须为空（哪条闸的判据在生产接线下抛异常，这里立刻看得见）
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const bs = require('../lib/buildstamp');
const gr = require('../lib/gatereg');
const { makeRoot, 收尾 } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('活体自证测试');

// 真起一次服务，打几个端点，把结果原样带回来（照 gatereg.test.js「端点实跑」那一格的起法）
const 实跑 = (() => {
  const root = makeRoot();
  const port = 4941;
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const G = async (u) => { const r = await fetch(B + u); let j = null; try { j = await r.json(); } catch { j = { __非JSON: true }; } return [r.status, j]; };
      const out = {};
      let [s, j] = await G('/api/version');
      out.version = [s, j];
      [s, j] = await G('/api/attn');
      out.attn = [s, { 注册: j.注册, 失败: j.失败 }];
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });
  `;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const out = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  assert.ok(!out.起服务失败, '服务都起不来，后面没一格算数：' + out.起服务失败);
  return out;
})();

t('/api/version 报的是**真**版本号（写死一个常量照样能骗过 grep 源码的判据）', () => {
  const [s, j] = 实跑.version;
  assert.equal(s, 200, '/api/version 必须 200（它不看 ready()：服务半死时更需要知道跑的是哪一版）');
  assert.equal(j.版本, require('../package.json').version,
    `活体自报 ${j.版本}，package.json 是 ${require('../package.json').version}——换装断言就靠这个数，它一撒谎旧版就能冒充新版过关`);
  assert.ok(j.起于 && !Number.isNaN(Date.parse(j.起于)), '起于要给得出，配合版本号才判得出是不是刚换的那一份');
});

t('/api/version 报的是**真**码印（buildstamp 没进包/加载失败时它只会静默变 null）', () => {
  const [, j] = 实跑.version;
  const 真 = bs.活体();
  assert.equal(typeof j.码印, 'string', '码印不许是 null——null 正是「lib/buildstamp 没进包」的样子，而版本号照样对得上');
  assert.equal(j.码印, 真.指纹, `活体自报码印 ${j.码印}，本进程算出来是 ${真.指纹}——两边跑的是同一棵源码树，不等就是接线接错了`);
  assert.equal(j.文件数, 真.文件数, `文件数 ${j.文件数} vs ${真.文件数}——收录面被悄悄改小时这一格先红`);
  assert.ok(j.文件数 > 0);
});

t('/api/attn 的闸表与源码注册表一字不差（少一条闸 = 那类欠债从此静默）', () => {
  const [s, j] = 实跑.attn;
  assert.equal(s, 200, '/api/attn 必须 200');
  const 活闸 = (j.注册 || []).map((g) => g.闸号);
  const 源闸 = gr.缺省注册表.map((g) => g.闸号);
  assert.deepEqual(活闸, 源闸,
    '闸表是清单的定义域，少一条 = 那类欠债从此静默。活体：' + 活闸.join(',') + ' / 源码：' + 源闸.join(','));
  assert.ok(活闸.includes('G15'), 'G15 必须在活体闸表里——它掉出去时不会报错，只会静默缺席');
});

t('/api/attn 每条闸都带路由，且没有一条闸的判据在生产接线下抛异常', () => {
  const [, j] = 实跑.attn;
  assert.deepEqual((j.注册 || []).filter((g) => !g.路由).map((g) => g.闸号), [], '每条闸都要有路由（否则点进去是死链）');
  assert.deepEqual(j.失败 || [], [],
    '判据抛异常会被 等我() 吞进 失败 名单，界面上一点看不出来——G15 的 deps默认 少一行就是这样死的。实测：' + JSON.stringify(j.失败));
});

收尾('活体自证', passed);
