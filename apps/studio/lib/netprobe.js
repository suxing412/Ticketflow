// netprobe.js — 网络活性探针（2026-08-08 死代理案）。
//
// 案源：config 模板带一个游戏项目环境遗留的 网络.代理默认 = http://127.0.0.1:7890。
// 那台机器上根本没有代理在跑，但 injectProxy 照样把它注进监制台自身进程环境，
// 所有子进程（codex / claude CLI / curl）统统继承 ⇒ 执行会话开局即
// 「API Error: Unable to connect to API (ConnectionRefused)」，单进执行失败。
// 而 /api/env 把这一项报成**绿灯**——因为旧探针只验「解析到了一个值」，不验「这个值连得上」。
// 总灯显示降级，唯一致命的那一项反而是绿的，制作人照着黄灯排查永远查不到真凶。
//
// 本模块的纪律：**探针标准 = 实弹标准**。实弹会经过代理去访问 API，探针就必须真的
// 经过同一个代理去访问同一个 API。级别语义与 /api/env 一致：红=阻断，黄=降级，绿=就绪。
//
// 网络 I/O 走 curl（与 quota.js 同一口径：Windows 10+ 自带，且不吃 node 的代理配置差异）；
// 判据翻译是纯函数（verdict），不碰网络，可单测。

const { execFile } = require('child_process');

// 探活地址：任何 HTTP 响应都算「连得通」——401/403/404 都证明 TLS 握手与路由是好的。
// 只有 curl 拿不到响应（code 000 / 非零退出）才算不通。不带凭据、不发正文。
const PING_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 15000;

// 单次探活。proxy 传空串/null = 显式直连（--noproxy '*' 压掉环境变量里的代理，
// 否则父进程注入的 HTTPS_PROXY 会让「直连对照组」偷偷也走代理，测了个寂寞）。
function httpProbe(url, proxy, opts = {}) {
  const run = opts.execFile || execFile;
  return new Promise((resolve) => {
    const args = ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null',
      '-w', '%{http_code}', '--max-time', String(Math.round((opts.timeoutMs || TIMEOUT_MS) / 1000) - 3)];
    if (proxy) args.push('-x', proxy); else args.push('--noproxy', '*');
    args.push(url || PING_URL);
    run('curl', args, { windowsHide: true, timeout: opts.timeoutMs || TIMEOUT_MS }, (err, stdout) => {
      const code = Number(String(stdout || '').trim());
      if (err || !Number.isFinite(code) || code <= 0) return resolve({ ok: false, code: 0 });
      resolve({ ok: true, code });
    });
  });
}

// ---- 判据翻译（纯函数，可单测）----
// 入参：proxy=生效代理地址（空=直连）、来源=解析来源记号、直连/经代理={ok,code}|null
// 出参：{ 级别, note }
//
// 判定表：
//   有代理 · 经代理通            → 绿（顺带标出直连是否也通，便于制作人决定要不要摘代理）
//   有代理 · 经代理不通 · 直连通 → **红**：一行字告诉他把 网络.代理默认 置空即可
//   有代理 · 经代理不通 · 直连也不通 → **红**：网络整体不可达
//   无代理 · 直连通              → 绿
//   无代理 · 直连不通            → **红**
// 为什么是红不是黄：代理坏掉时**每一张执行单都必死**，这不是「能力受限」，是核心不可用。
function verdict({ proxy, 来源, 直连, 经代理 }) {
  const 直通 = !!(直连 && 直连.ok);
  const src = 来源 ? `${来源} · ` : '';
  if (proxy) {
    if (经代理 && 经代理.ok) {
      return { 级别: '绿', note: `${proxy}（${src}实连 HTTP ${经代理.code}）${直通 ? ' · 直连亦可用' : ''}` };
    }
    return {
      级别: '红',
      note: `${proxy}（${src}连不上）——所有子进程都继承它，执行会话开局即 ConnectionRefused。`
        + (直通
          ? `实测直连可用：把 网络.代理默认 置空即可恢复（参数页·网络）`
          : `直连也不通：先确认本机网络/防火墙`),
    };
  }
  if (直通) return { 级别: '绿', note: `直连可用（HTTP ${直连.code}，未配代理）` };
  return { 级别: '红', note: '未配代理且直连不通——执行会话无法访问 API（配 网络.代理默认 或修本机网络）' };
}

// 一次跑完两组对照（有代理时才跑经代理那组；直连组永远跑，它是给红灯配修法的依据）
async function 探(proxy, opts = {}) {
  const [直连, 经代理] = await Promise.all([
    httpProbe(opts.url, null, opts),
    proxy ? httpProbe(opts.url, proxy, opts) : Promise.resolve(null),
  ]);
  return { 直连, 经代理 };
}

module.exports = { PING_URL, httpProbe, verdict, 探 };
