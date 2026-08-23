// tmpclean.test.js — 测试临时根必须自清理（2026-08-22 体检 #49）
//
// 案源：test/helper.js 的 makeRoot 每次 mkdtemp 一个 %TEMP%/studio-* 根，跑完谁也不删。
// 实测 %TEMP% 曾积到十万量级的 studio-* 根、十几万个目录条目，连枚举都要三秒。
// 存量清扫治不了本——清完两个多小时又长回几千个。缺的是机制。
//
// 判据一律**起真子进程、看盘上真实残留**，不许 grep helper.js 的源码：
// 源码里写没写 rmSync 不重要，跑完之后目录还在不在才重要。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('临时根回收测试');

const helper = path.join(__dirname, 'helper.js').replace(/\\/g, '/');

// 起一个子进程，让它用 helper 造几个临时根、把路径打出来、正常退出（触发 process.on('exit')）。
// 必须是**另一个进程**：本进程的 exit 钩子要等本进程死了才跑，在这儿断言等于什么都没验。
function 子进程造根(脚本, env) {
  const out = execFileSync(process.execPath, ['-e', 脚本], {
    encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}),
  });
  return out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && fs.existsSync(path.dirname(s)));
}

t('makeRoot 造的根，进程正常退出后必须自己消失', () => {
  const 路 = 子进程造根(`const h=require('${helper}');console.log(h.makeRoot());console.log(h.makeRoot());`);
  assert.equal(路.length, 2, '子进程应打出两个根，实测：' + JSON.stringify(路));
  const 残 = 路.filter((p) => fs.existsSync(p));
  assert.deepEqual(残, [], '进程退出后仍有残留根（零回收的原形）：' + 残.join(' | '));
});

t('临时目录() 造的根同样进回收账（否则只堵住 makeRoot 那一路）', () => {
  const 路 = 子进程造根(`const h=require('${helper}');console.log(h.临时目录('studio-tc-'));console.log(h.临时目录('studio-tc-'));`);
  assert.equal(路.length, 2, '子进程应打出两个根，实测：' + JSON.stringify(路));
  const 残 = 路.filter((p) => fs.existsSync(p));
  assert.deepEqual(残, [], 'test/ 里几十处直接 mkdtempSync 就是靠改走这个口子收编的，它漏了等于白改：' + 残.join(' | '));
});

t('用例炸了也要清（异常退出不是留垃圾的理由）', () => {
  let out = '';
  try {
    execFileSync(process.execPath, ['-e', `const h=require('${helper}');console.log(h.makeRoot());throw new Error('假装用例炸了');`],
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('子进程该以非零码退出');
  } catch (e) { out = String(e.stdout || ''); }
  const 路 = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  assert.equal(路.length, 1, '应打出一个根，实测：' + JSON.stringify(路));
  assert.equal(fs.existsSync(路[0]), false, '抛异常退出后残留：' + 路[0]);
});

t('KEEP_TMP 逃生阀：要留现场时必须真留得住', () => {
  // 两向都验。只验「会删」这一向，「干脆不建目录」这种退化实现也能骗过判据。
  const 路 = 子进程造根(`const h=require('${helper}');console.log(h.makeRoot());`, { KEEP_TMP: '1' });
  assert.equal(路.length, 1, '子进程应打出一个根，实测：' + JSON.stringify(路));
  assert.equal(fs.existsSync(路[0]), true, 'KEEP_TMP=1 时必须留现场，实测已被删：' + 路[0]);
  assert.ok(fs.existsSync(path.join(路[0], 'studio.config.json')), '留下的应是真造出来的仓，不是空壳');
  fs.rmSync(路[0], { recursive: true, force: true }); // 本用例自己收尾，不给 %TEMP% 添丁
});

t('全量计数：跑一轮 helper 之后，它的 %TEMP% 里必须一个条目都不剩', () => {
  // 给子进程一个**私有 %TEMP%**（os.tmpdir() 认 TEMP/TMP/TMPDIR），这样「全量计数」才算得准：
  // 直接去数真 %TEMP% 下的 studio-* 会被同机并跑的别的测试进程搅浑（实测同一条判据两次跑一绿一红，
  // 差值来自别人的根）。隔离之后这条判据是确定性的，且比只数 studio-* 更严——
  // 任何前缀的残留（tr-/agg-/别的用例自创前缀）都会被逮住。
  const 私 = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-隔离-'));
  try {
    子进程造根(`const h=require('${helper}');h.makeRoot();h.makeRoot();h.makeRoot();h.临时目录();h.临时目录('别的前缀-');console.log('done');`,
      { TEMP: 私, TMP: 私, TMPDIR: 私 });
    const 剩 = fs.readdirSync(私);
    assert.deepEqual(剩, [], '造了 5 个临时根，跑完还剩 ' + 剩.length + ' 个没回收：' + 剩.join(' | '));
  } finally {
    fs.rmSync(私, { recursive: true, force: true });
  }
});

console.log('全部通过：' + passed + ' 项');
