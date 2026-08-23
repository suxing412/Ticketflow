// draft-proj.test.js — 派单委托的项目透传（2026-08-21 对账补）
// 病灶：施工令-061 让 Ticketflow 自立为第二项目（前缀 TF），brain.draftTicket 也早认 opts.项目，
// **唯独 /api/pm/draft 这条委托路没把它传下去**——于是监制台自维护的活会被编进游戏的号段。
// 这一格只有真起服务才验得出来（lib 层没断，断的是端点接线），故本套件全走端点实跑。
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('派单委托 · 项目透传测试');

const 起 = (root, port, 打法) => {
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const P = async (u, body) => { const r = await fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { j = {}; } return [r.status, j]; };
      const out = ${打法};
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  return JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
};
// 双项目注册（生产形状）：TK 默认，Ticketflow 前缀 TF
const 双项目 = (root) => {
  const f = path.join(root, 'studio.config.json');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.项目 = { 默认: 'TK', 注册: { TK: { 路径: root, 单号前缀: 'TK' }, Ticketflow: { 路径: root, 单号前缀: 'TF' } } };
  fs.writeFileSync(f, JSON.stringify(c), 'utf8');
};

t('未注册的项目名整条拒，不静默落回默认项目', () => {
  const root = makeRoot(); 双项目(root);
  const o = 起(root, 4941, `await P('/api/pm/draft', { 需求: '测试', 项目: '不存在的项目' })`);
  assert.equal(o[0], 400, '不认的项目名必须 400');
  assert.match(String(o[1].error), /未注册的项目/);
  assert.match(String(o[1].error), /Ticketflow/, '错误里要列出可选项，不然人不知道该填什么');
});

t('带项目 → 回执如实报该项目；不带 → 回落项目默认（老调用方行为不变）', () => {
  const root = makeRoot(); 双项目(root);
  const o = 起(root, 4942, `{ 带: await P('/api/pm/draft', { 需求: '监制台自维护的活', 项目: 'Ticketflow' }), 不带: await P('/api/pm/draft', { 需求: '游戏侧的活' }) }`);
  assert.equal(o.带[0], 200);
  assert.equal(o.带[1].项目, 'Ticketflow', '带了就得按带的走——这一格漏传正是本条病灶');
  assert.equal(o.不带[0], 200);
  assert.equal(o.不带[1].项目, 'TK', '不带即项目默认，缺省行为一字不变');
});

t('接线判据：项目真传进了 draftTicket 的 opts（传了不用等于没传）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const seg = src.slice(src.indexOf("app.post('/api/pm/draft'"), src.indexOf("app.post('/api/pm/draft'") + 2000);
  assert.match(seg, /draftTicket\(ROOT, cfg, 需求, projPath,/, '调用点还在');
  assert.match(seg, /项目: name \|\| null/, 'opts 里必须带项目——brain 据它选号段');
});

console.log('全部通过：' + passed + ' 项');
