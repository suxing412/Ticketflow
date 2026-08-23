// deploy-verify.test.js — 换装脚本的「验活」块，拿原文对着桩服务真跑（2026-08-22 体检 #0/#2/#8/#10/#56）
//
// 案源：G15/码印这条闸专治「源码改了、跑着的还是旧的」，而**它自己就装在被审计的产物里**——
// 漏打进包时不会报错、只会静默缺席。08-22 实测跑着的 0.27.0 里根本没有 G15，
// 而当时的收工判据是 `grep -c G15 ≥1`：它 grep 的是**源码**，源码里当然有。
// 一条只会绿的判据，比没有判据更坏。
//
// 本套件不 grep 换装.ps1，而是把 `# @验活-begin … # @验活-end` 之间的**原文**抽出来，
// 拼上四个变量的赋值，指向一个由本进程起的桩 HTTP 服务真跑一遍，看退出码。
// 桩服务想回什么就回什么——「活体没有 G15」「活体不报码印」「活体版本不对」这些
// 在真机上要重打一次包才能复现的态，在这里一行代码就造得出来。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { 临时目录, 收尾 } = require('./helper');

let passed = 0;
const ta = async (n, f) => { await f(); passed += 1; console.log('  ✓ ' + n); };
console.log('换装验活块测试');

const 根 = path.join(__dirname, '..');
const PS1 = fs.readFileSync(path.join(根, '换装.ps1'), 'utf8');
const NL = String.fromCharCode(13) + String.fromCharCode(10);

// ---- 抽出验活块原文（抽不到就是标记被挪走了，直接判红：判据与被测对象脱钩比红更危险）----
const 验活块 = (() => {
  const a = PS1.indexOf('# @验活-begin');
  const b = PS1.indexOf('# @验活-end');
  assert.ok(a >= 0 && b > a, '换装.ps1 里的 @验活-begin/@验活-end 标记丢了——判据与被测对象已脱钩');
  return PS1.slice(a, b);
})();

// ---- 桩活体：/api/version、/api/attn、/api/config 三个端点，想回什么回什么 ----
function 起桩(回) {
  const srv = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    const body = Object.prototype.hasOwnProperty.call(回, u) ? 回[u] : null;
    if (body === undefined || body === null) { res.statusCode = 404; res.end('{}'); return; }
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

// ---- 把原文块包成一个可跑的脚本并执行，返回退出码与输出 ----
// **必须异步 spawn**：桩服务跑在本进程的事件循环里，用 spawnSync 会把事件循环整个卡住，
// 于是桩永远答不上话、脚本必然走「无应答」分支——第一版就这么假红了一次（实测 exit 3）。
function 跑验活({ port, 版本, srcDir, deployDir }) {
  const d = 临时目录('deployv-');
  const q = (x) => String(x).replace(/'/g, "''");
  const 脚本 = ['$ErrorActionPreference = \'Stop\'',
    // 输出编码钉成 UTF-8：PS5.1 默认按系统 ANSI 码页写 stdout，中文断言会全落在乱码上
    // （第一版实测：脚本明明打印了「换装完成」，正则却匹配不上一堆问号）
    'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }',
    `$Port = ${port}`,
    `$Version = '${q(版本)}'`,
    `$SrcDir = '${q(srcDir)}'`,
    `$DeployDir = '${q(deployDir || d)}'`,
    验活块, ''].join(NL);
  const p = path.join(d, '验活.ps1');
  fs.writeFileSync(p, '﻿' + 脚本, 'utf8');
  return new Promise((res) => {
    const ch = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', p],
      { windowsHide: true });
    let out = '';
    const 收 = (b) => { out += b.toString('utf8'); };
    ch.stdout.on('data', 收); ch.stderr.on('data', 收);
    const 闹 = setTimeout(() => { try { ch.kill(); } catch { /* 已退 */ } }, 60000);
    ch.on('close', (code) => { clearTimeout(闹); res({ code, out }); });
  });
}

const 好闸表 = { 注册: [{ 闸号: 'G1' }, { 闸号: 'G15' }], 债: [] };
const 好配置 = { 模型: { 项管: 'opus', 代核: 'opus' } };
// 真码印：桩活体自报的码印就取本源码树的真值，于是 3c 那道对拍走的是真比对
const 真码印 = require('../lib/buildstamp').活体().指纹;
const 真版本 = require('../package.json').version;

(async () => {
  await ta('全绿路：版本对上 + 码印对上 + G15 在册且零债 → exit 0 并打印「换装完成」', async () => {
    const { srv, port } = await 起桩({
      '/api/version': { 版本: 真版本, 码印: 真码印, 文件数: 200 },
      '/api/attn': 好闸表, '/api/config': 好配置,
    });
    const r = await 跑验活({ port, 版本: 真版本, srcDir: 根 });
    srv.close();
    assert.equal(r.code, 0, '一切正常时不许报错。实测退出 ' + r.code + '：' + r.out);
    assert.match(r.out, /换装完成/, '输出：' + r.out);
    assert.match(r.out, /G15 在册且零债/, '收工那行要把三条自证都写出来：' + r.out);
  });

  await ta('活体版本对不上 → exit 5（旧进程没停掉/拷到别的目录）', async () => {
    const { srv, port } = await 起桩({
      '/api/version': { 版本: '0.0.1', 码印: 真码印 }, '/api/attn': 好闸表, '/api/config': 好配置,
    });
    const r = await 跑验活({ port, 版本: 真版本, srcDir: 根 });
    srv.close();
    assert.equal(r.code, 5, '版本不符必须 exit 5，实测 ' + r.code + '：' + r.out);
    assert.match(r.out, /换装未生效/);
  });

  await ta('活体闸表里没有 G15 → exit 6（码印闸没进包，这条线是瞎的）', async () => {
    // 这就是 08-22 的真实态：跑着的 0.27.0 里没有 G15，而 grep 源码的判据全绿。
    const { srv, port } = await 起桩({
      '/api/version': { 版本: 真版本, 码印: 真码印 },
      '/api/attn': { 注册: [{ 闸号: 'G1' }, { 闸号: 'G14' }], 债: [] }, '/api/config': 好配置,
    });
    const r = await 跑验活({ port, 版本: 真版本, srcDir: 根 });
    srv.close();
    assert.equal(r.code, 6, 'G15 缺席必须 exit 6，实测 ' + r.code + '：' + r.out);
    assert.match(r.out, /没有 G15/);
  });

  await ta('活体不报码印 → exit 6（buildstamp 没进包或加载失败）', async () => {
    // 关键：版本号照样对得上。/api/version 在 buildstamp 加载失败时仍回 版本、只是 码印=null，
    // 所以「版本对上了」这一条**证明不了**闸在包里——这一格盯的正是那个缝。
    const { srv, port } = await 起桩({
      '/api/version': { 版本: 真版本, 码印: null }, '/api/attn': 好闸表, '/api/config': 好配置,
    });
    const r = await 跑验活({ port, 版本: 真版本, srcDir: 根 });
    srv.close();
    assert.equal(r.code, 6, '不报码印必须 exit 6，实测 ' + r.code + '：' + r.out);
    assert.match(r.out, /不报码印/);
  });

  await ta('G15 已经成债（活体落后源码）→ exit 6，不许打印「换装完成」', async () => {
    const { srv, port } = await 起桩({
      '/api/version': { 版本: 真版本, 码印: 真码印 },
      '/api/attn': { 注册: [{ 闸号: 'G15' }], 债: [{ 闸号: 'G15', title: '活体落后源码：活体 aaa ≠ 源码 bbb' }] },
      '/api/config': 好配置,
    });
    const r = await 跑验活({ port, 版本: 真版本, srcDir: 根 });
    srv.close();
    assert.equal(r.code, 6, '活体仍落后源码必须 exit 6，实测 ' + r.code + '：' + r.out);
    assert.ok(!/换装完成/.test(r.out), '这一格原样正是「打印换装完成了事」，不许回来：' + r.out);
  });

  await ta('码印对拍：活体码印 ≠ 源码码印 → exit 6（打包时源码树又往前走了）', async () => {
    // 独立于 G15：活体那份 config 有没有配 源码路径 都不影响这一道。
    const { srv, port } = await 起桩({
      '/api/version': { 版本: 真版本, 码印: 'deadbeef0000' }, '/api/attn': 好闸表, '/api/config': 好配置,
    });
    const r = await 跑验活({ port, 版本: 真版本, srcDir: 根 });
    srv.close();
    assert.equal(r.code, 6, '码印对不上必须 exit 6，实测 ' + r.code + '：' + r.out);
    assert.match(r.out, /≠ 源码码印/, '要把两枚码印都报出来：' + r.out);
  });

  await ta('没有源码树时跳过对拍而不是判红（部署方无源码是正常态）', async () => {
    const 空 = 临时目录('nosrc-');
    const { srv, port } = await 起桩({
      '/api/version': { 版本: 真版本, 码印: 'deadbeef0000' }, '/api/attn': 好闸表, '/api/config': 好配置,
    });
    const r = await 跑验活({ port, 版本: 真版本, srcDir: 空 });
    srv.close();
    assert.equal(r.code, 0, '无源码树该放行（否则别人的机器上永远换装不成），实测 ' + r.code + '：' + r.out);
    assert.match(r.out, /跳过码印对拍/);
  });

  await ta('服务压根没应答 → exit 3（与「版本不对」分开诊断）', async () => {
    // 起一个桩再立刻关掉，拿到一个确定没人听的端口
    const { srv, port } = await 起桩({});
    await new Promise((r) => srv.close(r));
    const r = await 跑验活({ port, 版本: 真版本, srcDir: 根 });
    assert.equal(r.code, 3, '无应答必须 exit 3，实测 ' + r.code + '：' + r.out);
    assert.match(r.out, /无应答|不报版本/);
  });

  收尾('换装验活块', passed);
})().catch((e) => { console.error('  ✗ ' + (e && e.message)); process.exitCode = 1; });
