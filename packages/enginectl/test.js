#!/usr/bin/env node
// test.js — enginectl 包自测（施工令-056）
// 用法：node test.js
//
// 重心是「结果新鲜度自校」三分支（陈旧 / 新鲜 / 挪件失败），案源 TK-144（2026-08-11 22:05）：
// 上一轮遗留的 results.xml 被收尾读成本轮成绩，523 全绿是假的。
//
// 纪律：
//   · 一律在系统临时目录里造【假工程】，真工程一个字节不碰；
//   · 端到端不碰真 Unity——起一个【假监听器】（本地 TCP，照 TK-103 协议应答 accepted+final），
//     enginectl 走的是它自己的 attach 正路，只是对面不是编辑器。旧件挪没挪、数字报没报，全看真输出；
//   · 探测通道走真 CLI，证明既有行为零回归。
'use strict';

const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const E = require('./enginectl.js'); // 被 require 时不许跑主流程（require.main 闸），跑了这行就会自己退出
const CLI = path.join(__dirname, 'enginectl.js');

let 过 = 0; const 挂 = [];
function ok(名, 真, 详) {
  if (真) { 过++; console.log(`  ✓ ${名}`); } else { 挂.push(名 + (详 ? ` —— ${详}` : '')); console.log(`  ✗ ${名}${详 ? ` —— ${详}` : ''}`); }
}
const t = (名, f) => { try { f(); 过++; console.log(`  ✓ ${名}`); } catch (e) { 挂.push(`${名} —— ${e.message}`); console.log(`  ✗ ${名} —— ${e.message}`); } };
const 章 = (s) => console.log(`\n【${s}】`);

const 新工程 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'enginectl-'));
const XML = (passed, failed, total) => `<?xml version="1.0"?><test-run total="${total}" passed="${passed}" failed="${failed}" />`;
const 写件 = (f, s, mtimeMs) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); if (mtimeMs) { const s2 = mtimeMs / 1000; fs.utimesSync(f, s2, s2); } };
const 挪件目录 = (proj) => { try { return fs.readdirSync(path.join(proj, E.BASELINE_DIR)).filter((f) => f.startsWith(E.STALE_PREFIX)); } catch { return []; } };

console.log('enginectl 包自测（施工令-056 结果新鲜度自校）');

// ════════════════════════════ 单元：算子三分支 ════════════════════════════
章('U1 statMtimeMs');
t('文件不存在 → null（不抛）', () => {
  const p = 新工程();
  assert.equal(E.statMtimeMs(path.join(p, '没这个.xml')), null);
  写件(path.join(p, '有.xml'), 'x', Date.parse('2026-08-11T14:05:00Z'));
  assert.equal(E.statMtimeMs(path.join(p, '有.xml')), Date.parse('2026-08-11T14:05:00Z'));
});

章('U2 起跑净场：挪件');
t('净场（无旧件）→ 不挪也不报错', () => {
  const p = 新工程();
  const r = E.stashStaleResults(p, path.join(p, 'enginectl-results.xml'));
  assert.deepEqual(r, { stashed: null });
  assert.equal(fs.existsSync(path.join(p, E.BASELINE_DIR)), false, '净场不该凭空建归档目录');
});
t('旧件在位 → 挪进 enginectl-baselines/，原位空出，内容一字不差', () => {
  const p = 新工程(); const xml = path.join(p, 'enginectl-results.xml');
  const 旧 = Date.parse('2026-08-11T14:05:00Z');
  写件(xml, XML(523, 0, 523), 旧);
  const r = E.stashStaleResults(p, xml);
  assert.equal(r.err, undefined, String(r.err));
  assert.equal(fs.existsSync(xml), false, '原位必须空出来（是挪不是拷）');
  assert.equal(fs.readFileSync(r.stashed, 'utf8'), XML(523, 0, 523));
  assert.equal(path.basename(r.stashed), `${E.STALE_PREFIX}20260811T140500000Z.xml`, '文件名带旧件自己的 mtime 时间戳');
  assert.equal(r.mtimeMs, 旧);
});
t('挪件失败（归档目录位置被一个同名文件占着）→ 报错且旧件留在原位，绝不静默', () => {
  const p = 新工程(); const xml = path.join(p, 'enginectl-results.xml');
  写件(xml, XML(1, 0, 1));
  fs.writeFileSync(path.join(p, E.BASELINE_DIR), '我是文件不是目录'); // 注入：mkdir 必失败
  const r = E.stashStaleResults(p, xml);
  assert.ok(r.err && /挪走上一轮/.test(r.err), `期望报错，得 ${JSON.stringify(r)}`);
  assert.equal(r.stashed, undefined);
  assert.ok(fs.existsSync(xml), '挪不动时旧件必须还在原位（供人工处置）');
});

章('U3 收尾闸：新鲜度');
t('陈旧（mtime 早于起跑时刻）→ stale，error 带 stale_results，附旧件 mtime 供复核', () => {
  const p = 新工程(); const xml = path.join(p, 'enginectl-results.xml');
  写件(xml, XML(523, 0, 523), Date.parse('2026-08-11T14:05:00Z'));
  const g = E.freshnessGate(xml, Date.parse('2026-08-11T22:05:00Z'));
  assert.equal(g.stale, true);
  assert.ok(/stale_results/.test(g.error), g.error);
  assert.equal(g.resultsMtime, '2026-08-11T14:05:00.000Z');
});
t('新鲜（mtime 晚于起跑时刻）→ 放行，resultsMtime 为该件 mtime', () => {
  const p = 新工程(); const xml = path.join(p, 'enginectl-results.xml');
  写件(xml, XML(523, 0, 523), Date.parse('2026-08-11T22:07:00Z'));
  const g = E.freshnessGate(xml, Date.parse('2026-08-11T22:05:00Z'));
  assert.equal(g.stale, false);
  assert.equal(g.error, undefined);
  assert.equal(g.resultsMtime, '2026-08-11T22:07:00.000Z');
});
t('边界：mtime 与起跑时刻同刻 → 放行（判据是 ≥）', () => {
  const p = 新工程(); const xml = path.join(p, 'enginectl-results.xml');
  const 同 = Date.parse('2026-08-11T22:05:00Z');
  写件(xml, XML(1, 0, 1), 同);
  assert.equal(E.freshnessGate(xml, 同).stale, false);
});
t('结果文件根本不存在 → 同样拦下（无 mtime 可核 = 不许报数），resultsMtime 为 null', () => {
  const p = 新工程();
  const g = E.freshnessGate(path.join(p, 'enginectl-results.xml'), Date.now());
  assert.equal(g.stale, true);
  assert.equal(g.resultsMtime, null);
  assert.ok(/stale_results/.test(g.error), g.error);
});

// ════════════════════════════ 端到端：真 CLI + 假监听器 ════════════════════════════
// 假监听器照 TK-103 协议：收一行请求 → 回 accepted → （按剧本动手脚）→ 回 final。
function 起假监听器(proj, 剧本) {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let buf = '';
      sock.setEncoding('utf8');
      sock.on('data', (d) => {
        buf += d;
        const i = buf.indexOf('\n'); if (i < 0) return;
        const req = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        sock.write(JSON.stringify({ event: 'accepted', id: req.id, queued: 0 }) + '\n');
        const final = 剧本(req, proj) || {};
        sock.write(JSON.stringify({ event: 'final', id: req.id, status: 'passed', logPath: 'enginectl-test.log', durationMs: 4321, ...final }) + '\n');
      });
      sock.on('error', () => { /* 对面先挂断，无所谓 */ });
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      // 发现文件：pid 用本测试进程（活着，过得了 discoverAttach 的存活校验）
      fs.writeFileSync(path.join(proj, '.enginectl-attach.json'), JSON.stringify({ port, pid: process.pid, projectPath: proj }));
      resolve({ srv, port, 关: () => new Promise((r) => srv.close(r)) });
    });
  });
}
// 必须异步起 CLI：spawnSync 会把本进程的事件循环堵死，假监听器就永远应答不了（握手超时）。
const 跑CLI = (argv) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...argv], { encoding: 'utf8' });
  let so = '', se = '';
  c.stdout.on('data', (d) => { so += d; });
  c.stderr.on('data', (d) => { se += d; });
  c.on('close', (code) => {
    let json = null; try { json = JSON.parse(so.trim().split('\n').pop()); } catch { /* 交给断言去骂 */ }
    resolve({ code, json: json || {}, stdout: so, stderr: se });
  });
});

(async () => {
  章('E1 探测通道零回归');
  {
    const r = await 跑CLI(['探测']);
    ok('探测仍出单行 JSON、ok:true、通道清单在', r.code === 0 && r.json && r.json.ok === true && Array.isArray(r.json.通道), JSON.stringify(r.json));
    ok('require 本模块不触发主流程（算子可单独取用）', typeof E.freshnessGate === 'function' && typeof E.stashStaleResults === 'function');
  }

  章('E2 unity-test 新鲜路（监听器真落了本轮新件）');
  {
    const proj = 新工程();
    写件(path.join(proj, 'enginectl-results.xml'), XML(1, 1, 2), Date.parse('2026-08-11T14:05:00Z')); // 上一轮的旧件在位
    const L = await 起假监听器(proj, (req, p) => { 写件(path.join(p, 'enginectl-results.xml'), XML(523, 0, 523)); return {}; });
    const r = await 跑CLI(['unity-test', '--project', proj]);
    await L.关();
    ok('ok:true 且报的是本轮数字 523/0/523', r.code === 0 && r.json.ok === true && r.json.passed === '523' && r.json.failed === '0' && r.json.total === '523', JSON.stringify(r.json));
    ok('输出带 resultsMtime（新件时刻，供外部复核）', !!r.json.resultsMtime && Date.parse(r.json.resultsMtime) > Date.parse('2026-08-11T14:05:00Z'), String(r.json.resultsMtime));
    ok('起跑时把旧件挪走了（enginectl-baselines/results-stale-*.xml 各一份）', 挪件目录(proj).length === 1, JSON.stringify(挪件目录(proj)));
    ok('全量绿仍照旧归档基线（baseline 字段在）', !!r.json.baseline && fs.existsSync(r.json.baseline), String(r.json.baseline));
  }

  章('E3 unity-test 陈旧路（监听器把一份旧件当结果交出来）');
  {
    const proj = 新工程();
    const 旧 = path.join(proj, 'old-results.xml');
    写件(旧, XML(523, 0, 523), Date.parse('2026-08-11T14:05:00Z')); // 一份「全绿」的上一轮旧件
    const L = await 起假监听器(proj, () => ({ resultsPath: 'old-results.xml' }));
    const r = await 跑CLI(['unity-test', '--project', proj]);
    await L.关();
    ok('ok:false 且退出码 1', r.code === 1 && r.json.ok === false, JSON.stringify(r.json));
    ok('status=error，error 为 stale_results', r.json.status === 'error' && /^stale_results/.test(r.json.error || ''), JSON.stringify(r.json));
    ok('绝不报数：passed/failed/total 一个字段都不出现', !('passed' in r.json) && !('failed' in r.json) && !('total' in r.json), JSON.stringify(r.json));
    ok('留 listenerStatus=passed 存证（监听器说绿，但我们不认这份数）', r.json.listenerStatus === 'passed', JSON.stringify(r.json));
    ok('resultsMtime 报出旧件时刻', r.json.resultsMtime === '2026-08-11T14:05:00.000Z', String(r.json.resultsMtime));
  }

  章('E4 unity-test 无件路（监听器报绿但没落盘）');
  {
    const proj = 新工程();
    const L = await 起假监听器(proj, () => ({}));
    const r = await 跑CLI(['unity-test', '--project', proj]);
    await L.关();
    ok('同样拦下：ok:false / status=error / stale_results / resultsMtime=null', r.code === 1 && r.json.ok === false && r.json.status === 'error' && /^stale_results/.test(r.json.error || '') && r.json.resultsMtime === null, JSON.stringify(r.json));
    ok('绝不报数', !('passed' in r.json), JSON.stringify(r.json));
  }

  章('E5 unity-test 挪件失败路（起跑就停手）');
  {
    const proj = 新工程();
    写件(path.join(proj, 'enginectl-results.xml'), XML(523, 0, 523), Date.parse('2026-08-11T14:05:00Z'));
    fs.writeFileSync(path.join(proj, E.BASELINE_DIR), '占位文件');
    const L = await 起假监听器(proj, () => ({})); // 起着，用来证明「压根没投递」
    const r = await 跑CLI(['unity-test', '--project', proj]);
    await L.关();
    ok('ok:false 且错在挪件，不是别的', r.code === 1 && r.json.ok === false && /挪走上一轮/.test(r.json.error || ''), JSON.stringify(r.json));
    ok('停在投递之前（输出无 port/status，说明没去碰监听器）', !('port' in r.json) && !('status' in r.json), JSON.stringify(r.json));
    ok('旧件仍在原位，等人工处置', fs.existsSync(path.join(proj, 'enginectl-results.xml')));
  }

  章('E6 零回归：unity-run 与参数校验不受新闸影响');
  {
    const proj = 新工程();
    写件(path.join(proj, 'enginectl-results.xml'), XML(523, 0, 523), Date.parse('2026-08-11T14:05:00Z'));
    const r = await 跑CLI(['unity-run', '--project', proj, '--method', 'Foo.Bar']); // 无监听器 → 照旧走可见拉起 → 非 Unity 工程报错
    ok('unity-run 照旧报「不是 Unity 工程」（拉起路径没被动过）', r.code === 1 && /不是 Unity 工程/.test(r.json.error || ''), JSON.stringify(r.json));
    ok('unity-run 全程不碰 results.xml（不挪件——它本就不产这文件）', fs.existsSync(path.join(proj, 'enginectl-results.xml')) && 挪件目录(proj).length === 0);

    const r2 = await 跑CLI(['unity-test', '--project', proj, '--filter']);
    ok('参数错（--filter 缺值）仍先于挪件拦下：旧件没被动', r2.code === 1 && /--filter 需要值/.test(r2.json.error || '') && fs.existsSync(path.join(proj, 'enginectl-results.xml')), JSON.stringify(r2.json));

    const r3 = await 跑CLI(['unity-run', '--project', proj]);
    ok('unity-run 缺 --method 仍原样报错', r3.code === 1 && /必填 --method/.test(r3.json.error || ''), JSON.stringify(r3.json));

    const r4 = await 跑CLI(['没这个通道', '--project', proj]);
    ok('未知通道文案原样', r4.code === 1 && /未知通道/.test(r4.json.error || ''), JSON.stringify(r4.json));

    const r5 = await 跑CLI(['unity-test', '--project', proj, '--no-attach']);
    ok('--no-attach 退役文案原样', r5.code === 1 && /--no-attach 已退役/.test(r5.json.error || ''), JSON.stringify(r5.json));
  }

  console.log(挂.length ? `\n挂 ${挂.length} 项：\n  · ${挂.join('\n  · ')}` : `\n全部通过：${过} 项`);
  process.exit(挂.length ? 1 : 0);
})();
