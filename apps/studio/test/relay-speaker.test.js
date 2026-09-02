// relay-speaker.test.js — 信道写口按请求发言人如实落盘
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const relay = require('../lib/relay');
const { makeRoot, 收尾 } = require('./helper');

let passed = 0; const t = (name, f) => { f(); passed++; console.log('  ✓ ' + name); };
console.log('relay 信道发言人写口测试（TF-16）');

const 起 = (root, port, 打法) => {
  const code = `
    const studio = require(${JSON.stringify(path.join(__dirname, '..', 'server.js').replace(/\\\\/g, '/'))});
    // 桩台的 answer 会同步追加「项管」回帖；本判据只验本次 POST 自己写入的末条，故关掉该副作用。
    require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'pm', 'brain.js').replace(/\\\\/g, '/'))}).answer = () => {};
    studio.start().then(async ({ server: srv }) => {
      const base = 'http://127.0.0.1:${port}';
      const P = async (url, body) => {
        const r = await fetch(base + url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        let json = {};
        try { json = await r.json(); } catch { /* 响应必须仍可报告状态 */ }
        return [r.status, json];
      };
      try {
        const out = ${打法};
        process.stdout.write('@@' + JSON.stringify(out) + '@@');
      } finally {
        srv.close();
      }
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const out = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  if (out.起服务失败) throw new Error('起服务失败：' + out.起服务失败);
  return out;
};

const 全部原始行 = (root) => {
  try { return fs.readFileSync(relay.FILE(root), 'utf8').split(/\r?\n/).filter(Boolean); } catch { return []; }
};

const 本月日志 = (root) => {
  const now = new Date();
  const file = path.join(root, 'journal', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.log`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

t('带发言人按该身份落盘：总监写入后从真服务回读', () => {
  const root = makeRoot();
  const out = 起(root, 4971, `({ 写入: await P('/api/relay', { text: 'x', 发言人: '总监' }) })`);
  assert.equal(out.写入[0], 200);
  const last = relay.list(root).at(-1);
  assert.equal(last.from, '总监');
  assert.equal(last.text, 'x');
  assert.match(本月日志(root), /项管信道·总监：x/, 'journal 操作者必须随实际发言人落盘');
});

t('缺省发言人仍为制作人：请求体不带发言人键', () => {
  const root = makeRoot();
  const out = 起(root, 4972, `({ 写入: await P('/api/relay', { text: 'y' }) })`);
  assert.equal(out.写入[0], 200);
  const last = relay.list(root).at(-1);
  assert.equal(last.from, '制作人');
  assert.equal(last.text, 'y');
});

t('白名单外署名 400 拒收：不落盘且绝不改写成制作人', () => {
  const root = makeRoot();
  assert.ok(relay.append(root, 'Claude', '既有消息').ok);
  const before = relay.list(root);
  const n0 = before.length;
  const out = 起(root, 4973, `({ 拒收: await P('/api/relay', { text: 'z', 发言人: '路人' }) })`);
  assert.equal(out.拒收[0], 400);
  assert.ok(typeof out.拒收[1].error === 'string' && out.拒收[1].error.length > 0, '400 必须带拒收缘由');
  const after = relay.list(root);
  assert.equal(after.length, n0, '拒收不能新增 thread 条目');
  assert.notEqual(after.at(-1).from, '制作人', '不得静默改写为制作人');
  assert.ok(!after.some((entry) => entry.text === 'z'), '被拒正文不得进入 thread');
});

t('历史条目逐行字节不变：真写只在末尾追加一行', () => {
  const root = makeRoot();
  const history = [
    { t: '2026-08-28T00:00:00.000Z', from: '制作人', text: '旧一' },
    { t: '2026-08-28T00:01:00.000Z', from: 'Claude', text: '旧二' },
    { t: '2026-08-28T00:02:00.000Z', from: '项管', text: '旧三' },
  ].map((entry) => JSON.stringify(entry));
  fs.mkdirSync(path.dirname(relay.FILE(root)), { recursive: true });
  fs.writeFileSync(relay.FILE(root), history.join('\n') + '\n', 'utf8');
  const before = 全部原始行(root);
  const out = 起(root, 4974, `({ 写入: await P('/api/relay', { text: '新消息', 发言人: '总监' }) })`);
  assert.equal(out.写入[0], 200);
  const after = 全部原始行(root);
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.slice(0, before.length), before, '既有每一行必须字节全等');
  const added = JSON.parse(after.at(-1));
  assert.equal(added.from, '总监');
  assert.equal(added.text, '新消息');
});

t('白名单为单一事实源：服务端与直接写口均随导出常量同步', () => {
  const root = makeRoot();
  const { 发言人白名单 } = relay;
  assert.equal(发言人白名单.length, 5);
  assert.ok(发言人白名单.includes('助理'));
  assert.ok(发言人白名单.includes('总监'));
  const requests = 发言人白名单.map((发言人, index) => ({ text: `HTTP-${index}`, 发言人 }));
  const out = 起(root, 4975, `({ 合法: await Promise.all(${JSON.stringify(requests)}.map((body) => P('/api/relay', body))), 非法: await P('/api/relay', { text: '外部', 发言人: '路人' }) })`);
  for (const [index, 发言人] of 发言人白名单.entries()) {
    assert.equal(out.合法[index][0], 200, `${发言人} 必须能经服务端写入`);
    const entry = relay.list(root).find((item) => item.text === `HTTP-${index}`);
    assert.equal(entry && entry.from, 发言人, `${发言人} 必须原样落盘`);
    assert.ok(relay.append(root, 发言人, `直接-${index}`).ok, `${发言人} 必须能直接 append`);
  }
  assert.equal(out.非法[0], 400, '常量外署名必须被服务端拒绝');
  assert.equal(relay.append(root, '路人', '直接外部').ok, false, '常量外署名必须被 append 拒绝');
});

收尾('', passed);
