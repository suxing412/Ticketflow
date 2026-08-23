// gates-recommend-retire.test.js — 推荐在途（D28）退役后的残余摘除（2026-08-22 体检 #58）
//
// 病灶：前端 0.23.11 制度改版 + 0.24.7 视图清仓早把「推荐在途」这张卡撤了
//（public/app.js:1579 `const recCards = '';` 是它自己的墓碑），可**服务端两处还在跑**：
//   · /api/gates 每次都算一整套 recommend()——它要 countDecisions 读 journal（活体 2.4MB），
//     而前端 5 秒轮询一次这个端点。算出来的数没有任何人显示。
//   · POST /api/config/recommend 是那张卡的写口，卡没了端点还活着——前端唯一调用方
//     window.rStep 是个孤儿（它找的 .paramcard[data-rkey] 全库不存在，点了必静默失败）。
//
// 判据一条不验源码文本：真起服务、真打端点、真看返回体。
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { makeRoot, 收尾 } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('推荐在途退役测试（#58）');

const 起 = (root, port, 打法) => {
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js').replace(/\\/g, '/'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const G = async (u) => { const r = await fetch(B + u); let j = null; try { j = await r.json(); } catch { j = {}; } return [r.status, j]; };
      const P = async (u, body) => { const r = await fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { j = {}; } return [r.status, j]; };
      const out = ${打法};
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close(); process.exit(0);
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  return JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
};

t('甲：/api/gates 不再下发已退役的 推荐（前端 5 秒一发，算的是没人看的数）', () => {
  const root = makeRoot();
  const o = 起(root, 4954, `await G('/api/gates')`);
  assert.equal(o[0], 200, '端点本身要照常活着——摘的是一格字段，不是整条路');
  assert.ok(!('推荐' in o[1]), '返回体不许再有这一格，实测键：' + Object.keys(o[1]).join(','));
  // 同批摘掉的还有 /api/config 的同族残余（那张卡已随 0.23.11 撤掉，参数页零处渲染）
  const c = 起(root, 4956, `await G('/api/config')`);
  assert.equal(c[0], 200);
  assert.ok(!('推荐' in c[1]), '/api/config 也不许再下发 推荐，实测键：' + Object.keys(c[1]).join(','));
  // 反向：这条路该有的东西一样不许少（别把「摘一格」做成「摘一片」）
  for (const k of ['paused', 'locks', '护城河', 'OAuth']) assert.ok(k in o[1], `${k} 不许跟着一起没了`);
});

t('乙：POST /api/config/recommend 已摘除（卡都没了，写口还活着就是死端点）', () => {
  const root = makeRoot();
  const o = 起(root, 4955, `await P('/api/config/recommend', { key: '速度窗口小时', value: 3 })`);
  assert.equal(o[0], 404, '死端点还能 200 就是没摘干净');
  // 同一台上别的 /api/config/* 写口不许被误伤
  const 活 = 起(root, 4957, `await P('/api/config/model', { key: '不存在的键', value: 1 })`);
  assert.ok(活[0] !== 404, '/api/config/ 下别的写口该在的还得在（实测 ' + 活[0] + '）');
});

收尾('', passed);
