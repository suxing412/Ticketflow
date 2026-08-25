// rootlock-wiring.test.js — 数据根单写者锁的 server 接线行为。
// 不读源码文本：每格都在子进程真起 server，记录运行时实际挂出的 setInterval。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { makeRoot, 收尾 } = require('./helper');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
console.log('数据根单写者锁 · server 接线测试');

const SERVER = path.join(__dirname, '..', 'server.js');
const 锁 = (root) => path.join(root, '.studio.lock');
const 必有拍 = [200000, 1800000, 600000, 900000, 300000, 60000];

// 子进程互不重用端口；同一套件内每次都等上一次 server.close 后再起下一次。
const 端口 = (seq) => 5200 + ((process.pid * 17 + seq) % 800);

function 真起(root, port) {
  const code = `
    const fs = require('fs');
    const path = require('path');
    const 间隔 = [];
    const 原setInterval = global.setInterval;
    global.setInterval = (fn, ms, ...args) => {
      间隔.push(Number(ms));
      return 原setInterval(fn, ms, ...args);
    };
    require(${JSON.stringify(SERVER)}).start().then(async ({ server: srv }) => {
      const root = process.env.STUDIO_ROOT;
      let 状态码 = null;
      try { 状态码 = (await fetch('http://127.0.0.1:' + process.env.STUDIO_PORT + '/')).status; } catch { /* 回传 null 让父进程判红 */ }
      let 锁原文 = null;
      try { 锁原文 = fs.readFileSync(path.join(root, '.studio.lock'), 'utf8'); } catch { /* 无锁即 null */ }
      let 日志 = '';
      try {
        const dir = path.join(root, 'journal');
        for (const f of fs.readdirSync(dir).sort()) 日志 += fs.readFileSync(path.join(dir, f), 'utf8');
      } catch { /* 没有流水目录也原样回传 */ }
      process.stdout.write('@@' + JSON.stringify({ pid: process.pid, 状态码, 间隔, 锁原文, 日志 }) + '@@');
      srv.close();
    }).catch((e) => {
      process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e && e.message) }) + '@@');
      process.exit(1);
    });
  `;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const out = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  assert.ok(!out.起服务失败, '子进程服务没起来：' + out.起服务失败 + '\n' + raw.slice(-1000));
  return out;
}

function 断言全拍挂上(间隔) {
  for (const ms of 必有拍) {
    assert.ok(间隔.includes(ms), `写者拿到锁却没挂 ${ms}ms 定时拍：${JSON.stringify(间隔)}`);
  }
}

t('空根真起：锁落盘为子进程 pid，续期与全部写拍均已挂上', () => {
  const root = makeRoot();
  const out = 真起(root, 端口(1));
  assert.equal(out.状态码, 200, '空根拿锁后服务仍须正常 listen');
  assert.ok(out.锁原文, '空根起服务后 .studio.lock 必须真落盘');
  assert.equal(JSON.parse(out.锁原文).pid, out.pid, '锁里的 pid 必须是实际 listen 的子进程');
  断言全拍挂上(out.间隔);
});

t('活 pid + 新鲜锁：仍 listen、留 journal，所有写拍与续期均不起且退出不改锁', () => {
  const root = makeRoot();
  const 原锁 = JSON.stringify({ pid: process.pid, 根: root, 起于: new Date().toISOString(), 续于: new Date().toISOString() });
  fs.writeFileSync(锁(root), 原锁, 'utf8');

  const out = 真起(root, 端口(2));
  assert.equal(out.状态码, 200, '被挡住的第二进程也必须提供只读服务');
  assert.equal(out.锁原文, 原锁, '第二进程运行中不得改动活锁');
  assert.match(out.日志, /数据根已有单写者，定时拍全部不起/, '第二进程没有留下只读降级的 journal 痕迹');
  for (const ms of 必有拍) {
    assert.ok(!out.间隔.includes(ms), `被挡住仍挂了 ${ms}ms 写拍：${JSON.stringify(out.间隔)}`);
  }
  assert.deepEqual(out.间隔, [], '被挡住时不应存在任何 server 启动定时拍：' + JSON.stringify(out.间隔));
  assert.equal(fs.readFileSync(锁(root), 'utf8'), 原锁, '第二进程退出时不得放掉或改写别人的锁');
});

t('坏锁真起：宁可漏锁一次也必须接管，全部写拍照常挂上', () => {
  const root = makeRoot();
  fs.writeFileSync(锁(root), '这不是 JSON{{{', 'utf8');
  const out = 真起(root, 端口(3));
  assert.equal(out.状态码, 200, '坏锁不能阻止服务 listen');
  assert.equal(JSON.parse(out.锁原文).pid, out.pid, '坏锁必须被接管为子进程自己的锁');
  断言全拍挂上(out.间隔);
});

t('死 pid 锁真起：接管遗留锁，全部写拍照常挂上', () => {
  const root = makeRoot();
  const dead = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
  assert.ok(Number.isInteger(dead.pid) && dead.pid > 0, '未取得可验证的已死子进程 pid');
  fs.writeFileSync(锁(root), JSON.stringify({ pid: dead.pid, 根: root, 起于: new Date().toISOString(), 续于: new Date().toISOString() }), 'utf8');

  const out = 真起(root, 端口(4));
  assert.equal(out.状态码, 200, '死 pid 遗留锁不能阻止服务 listen');
  assert.equal(JSON.parse(out.锁原文).pid, out.pid, '死 pid 锁必须被接管为子进程自己的锁');
  断言全拍挂上(out.间隔);
});

收尾('数据根单写者锁接线', passed);
