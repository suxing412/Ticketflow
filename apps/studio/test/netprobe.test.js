// netprobe.test.js — 网络活性探针（2026-08-08 死代理案）
// 这道自检的价值全在「死代理必须是红的」：旧探针把连不上的代理报成绿灯，
// 制作人照着黄灯排查了一圈，真凶始终亮着绿灯。判据翻译是纯函数，全部可离线测。
const assert = require('node:assert');
const np = require('../lib/netprobe');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const T = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };

const 通 = (code) => ({ ok: true, code });
const 断 = { ok: false, code: 0 };

(async () => {
  console.log('netprobe 网络活性探针测试（2026-08-08 死代理案）');

  t('死代理判红——不是黄：代理坏掉时每张执行单都必死，属核心不可用', () => {
    const v = np.verdict({ proxy: 'http://127.0.0.1:7890', 来源: 'config 默认', 直连: 通(403), 经代理: 断 });
    assert.equal(v.级别, '红', '这一条判黄就是本次事故的重演');
    assert.ok(v.note.includes('ConnectionRefused'), '要点名真实症状，制作人才能把日志对上号');
  });

  t('死代理 + 直连可用 → 红灯里直接给出修法（置空 网络.代理默认）', () => {
    const v = np.verdict({ proxy: 'http://127.0.0.1:7890', 来源: 'config 默认', 直连: 通(403), 经代理: 断 });
    assert.ok(v.note.includes('网络.代理默认'), '修法要写字段名，不能只说"检查代理"');
    assert.ok(v.note.includes('直连可用'));
  });

  t('死代理 + 直连也不通 → 红，但修法改口为查本机网络（别误导他去摘代理）', () => {
    const v = np.verdict({ proxy: 'http://127.0.0.1:7890', 来源: '环境变量', 直连: 断, 经代理: 断 });
    assert.equal(v.级别, '红');
    assert.ok(v.note.includes('直连也不通'));
    assert.ok(!v.note.includes('置空'), '直连都不通还劝他摘代理是错的');
  });

  t('活代理 → 绿，note 带实连状态码（证明真连过，不是解析到值就报绿）', () => {
    const v = np.verdict({ proxy: 'http://127.0.0.1:7890', 来源: '系统注册表', 直连: 断, 经代理: 通(401) });
    assert.equal(v.级别, '绿');
    assert.ok(v.note.includes('实连 HTTP 401'));
    assert.ok(v.note.includes('系统注册表'), '来源记号要留着——三级解析链出问题时全靠它定位');
  });

  t('活代理 + 直连也通 → 绿并标注，供制作人决定要不要摘代理', () => {
    const v = np.verdict({ proxy: 'http://127.0.0.1:7890', 来源: 'config 默认', 直连: 通(403), 经代理: 通(403) });
    assert.equal(v.级别, '绿');
    assert.ok(v.note.includes('直连亦可用'));
  });

  t('无代理 + 直连通 → 绿（今天这台机器的正确形态）', () => {
    const v = np.verdict({ proxy: '', 来源: '', 直连: 通(403), 经代理: null });
    assert.equal(v.级别, '绿');
    assert.ok(v.note.includes('未配代理'));
  });

  t('无代理 + 直连不通 → 红（无路可走，不许报降级）', () => {
    const v = np.verdict({ proxy: '', 来源: '', 直连: 断, 经代理: null });
    assert.equal(v.级别, '红');
    assert.ok(v.note.includes('网络.代理默认'), '给出配代理这条出路');
  });

  t('任何 HTTP 响应都算通：401/403/404 证明 TLS 与路由是好的', () => {
    for (const code of [200, 401, 403, 404, 429]) {
      assert.equal(np.verdict({ proxy: '', 来源: '', 直连: 通(code), 经代理: null }).级别, '绿', `HTTP ${code} 应判通`);
    }
  });

  // ---- httpProbe 的 curl 参数装配（注入假 execFile，不碰网络）----
  await T('直连探测显式 --noproxy *：否则父进程注入的 HTTPS_PROXY 会让对照组偷偷走代理', async () => {
    let got = null;
    const fake = (cmd, args, opts, cb) => { got = { cmd, args }; cb(null, '403'); };
    const r = await np.httpProbe(null, null, { execFile: fake });
    assert.equal(r.ok, true); assert.equal(r.code, 403);
    assert.equal(got.cmd, 'curl');
    assert.ok(got.args.includes('--noproxy'), '缺 --noproxy 的直连对照组等于没测');
    assert.ok(!got.args.includes('-x'));
    assert.ok(got.args.includes(np.PING_URL));
  });

  await T('带代理探测走 -x，且不带 --noproxy', async () => {
    let got = null;
    const fake = (cmd, args, opts, cb) => { got = args; cb(null, '000'); };
    await np.httpProbe(null, 'http://127.0.0.1:7890', { execFile: fake });
    assert.ok(got.includes('-x'));
    assert.equal(got[got.indexOf('-x') + 1], 'http://127.0.0.1:7890');
    assert.ok(!got.includes('--noproxy'));
  });

  await T('curl 吐 000 / 非零退出 / 空输出 一律判不通（不许当成"连上了"）', async () => {
    const 三种 = [
      (c, a, o, cb) => cb(null, '000'),
      (c, a, o, cb) => cb(new Error('curl: (7) Failed to connect'), ''),
      (c, a, o, cb) => cb(null, '   '),
    ];
    for (const fake of 三种) {
      const r = await np.httpProbe(null, null, { execFile: fake });
      assert.equal(r.ok, false); assert.equal(r.code, 0);
    }
  });

  await T('探()：无代理时不跑经代理那组，直连组永远跑（红灯修法要靠它）', async () => {
    let 次数 = 0;
    const fake = (c, a, o, cb) => { 次数++; cb(null, '403'); };
    const r1 = await np.探('', { execFile: fake });
    assert.equal(次数, 1); assert.equal(r1.经代理, null); assert.equal(r1.直连.ok, true);
    次数 = 0;
    const r2 = await np.探('http://127.0.0.1:7890', { execFile: fake });
    assert.equal(次数, 2); assert.equal(r2.经代理.ok, true);
  });

  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
