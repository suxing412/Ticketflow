// frontend-sandbox.js — 在 node 里真跑 public/app.js 的渲染函数（2026-08-22 体检）。
//
// 立这个夹具的直接理由写在体检里：**「防复发判据只 grep 源码文本不验行为」**。
// 前端判据一路都是 assert.match(app源码, /正则/)——那种断言证明的只是「某几个字还在」，
// 改名、挪位、被外层 if 绕过、拿到的数据形状不对，它一概照绿。08-22 我自己又犯了一次。
//
// 这里换一条路：给 app.js 兜一层最小 DOM 桩，vm.runInContext 装进来，然后**直接调那个函数**，
// 拿它真吐出来的 HTML 做断言。渲染函数是纯的（入参 → 字符串），这一层桩就够。
// 摸网络的走 api()/loadBoard()——由用例自己按需覆盖，桩里不猜。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function 装载前端() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const noop = () => {};
  // 万能桩：读什么都给得出，避免为了跑一个渲染函数去补几十个 DOM API
  const mk = (o = {}) => new Proxy({ ...o }, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'symbol' ? undefined : noop)),
    has: () => true,
  });
  const el = mk({ style: {}, classList: mk(), children: [], dataset: {}, innerHTML: '', querySelectorAll: () => [] });
  const doc = mk({
    getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
    createElement: () => el, body: el, documentElement: el, head: el,
  });
  const ctx = {
    console: { log: noop, warn: noop, error: noop },
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    requestAnimationFrame: noop,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    document: doc,
    // 真存储：projActive() 读 studio-proj，用例要能把「此刻身处哪个项目」摆进去
    localStorage: (() => { const m = new Map(); return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; })(),
    location: { hash: '', href: '', search: '' },
    navigator: mk(), history: mk(),
    matchMedia: () => mk({ matches: false }),
    CustomEvent: function () {}, Notification: function () {},
  };
  ctx.window = new Proxy(ctx, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; },
    has: () => true,
  });
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'app.js' });
  return ctx;
}

/**
 * 把沙盒置于「身处某项目」的状态：projActive() 要求①注册表里≥2 个项目 ②localStorage 选中。
 * 传 null 即回到「不过滤」（单项目/未选）。
 */
function 设项目(ctx, 名, 注册 = { TK: {}, Ticketflow: {} }) {
  ctx.localStorage.setItem('studio-proj', 名 || '');
  const 原 = ctx.fetch;
  ctx.fetch = async (u) => (String(u).startsWith('/api/config')
    ? { ok: true, json: async () => ({ 项目: { 注册, 默认: 'TK' } }) }
    : 原(u));
  return ctx.loadCfg().then(() => { ctx.fetch = 原; });
}

module.exports = { 装载前端, 设项目 };
