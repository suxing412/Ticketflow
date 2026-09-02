#!/usr/bin/env node
// test.js — enginectl 包自测（施工令-056 + TK-204）
// 用法：node test.js　｜　node enginectl.js 自测（同一套，走通道注册表入口）
//
// 重心一：「结果新鲜度自校」三分支（陈旧 / 新鲜 / 挪件失败），案源 TK-144（2026-08-11 22:05）：
// 上一轮遗留的 results.xml 被收尾读成本轮成绩，523 全绿是假的。
// 重心二（TK-204）：「取证归档双写分件」五条断言——两条链同时跑测，后写者覆盖前写者，
// 两边都拿不到自己那轮的数字；且 stale 件挤空了基线归档池。见 T1/T2/T3 三章。
//
// 纪律：
//   · 一律在系统临时目录里造【假工程】，真工程一个字节不碰；
//   · 端到端不碰真 Unity——起一个【假监听器】（本地 TCP，照 TK-103 协议应答 accepted+final），
//     enginectl 走的是它自己的 attach 正路，只是对面不是编辑器。旧件挪没挪、数字报没报，全看真输出；
//   · 探测通道走真 CLI，证明既有行为零回归。
'use strict';

const assert = require('node:assert');
const crypto = require('crypto');
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
// TK-204 分家后：陈旧件在 enginectl-runs/stale/，基线归档件才在 enginectl-baselines/
const 陈旧池 = (proj) => { try { return fs.readdirSync(path.join(proj, E.RUNS_DIR, E.STALE_SUBDIR)).filter((f) => f.startsWith(E.STALE_PREFIX)); } catch { return []; } };
const 基线池 = (proj) => { try { return fs.readdirSync(path.join(proj, E.BASELINE_DIR)); } catch { return []; } };
const 独立件 = (proj) => { try { return fs.readdirSync(path.join(proj, E.RUNS_DIR), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(); } catch { return []; } };
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const 成对份数 = (名单) => new Set(名单.map((f) => f.replace(/\.(xml|log)$/, ''))).size;

console.log('enginectl 包自测（施工令-056 结果新鲜度自校 + TK-204 取证归档双写分件）');

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
t('旧件在位 → 挪进 enginectl-runs/stale/（TK-204 分家），原位空出，内容一字不差', () => {
  const p = 新工程(); const xml = path.join(p, 'enginectl-results.xml');
  const 旧 = Date.parse('2026-08-11T14:05:00Z');
  写件(xml, XML(523, 0, 523), 旧);
  const r = E.stashStaleResults(p, xml);
  assert.equal(r.err, undefined, String(r.err));
  assert.equal(fs.existsSync(xml), false, '原位必须空出来（是挪不是拷）');
  assert.equal(fs.readFileSync(r.stashed, 'utf8'), XML(523, 0, 523));
  assert.equal(path.basename(r.stashed), `${E.STALE_PREFIX}20260811T140500000Z.xml`, '文件名带旧件自己的 mtime 时间戳');
  assert.equal(path.dirname(r.stashed), path.join(p, E.RUNS_DIR, E.STALE_SUBDIR), '陈旧件不许再落进基线归档池');
  assert.equal(基线池(p).length, 0, '挪陈旧件不该在基线池里留下任何东西');
  assert.equal(r.mtimeMs, 旧);
});
t('挪件失败（陈旧池位置被一个同名文件占着）→ 报错且旧件留在原位，绝不静默', () => {
  const p = 新工程(); const xml = path.join(p, 'enginectl-results.xml');
  写件(xml, XML(1, 0, 1));
  fs.writeFileSync(path.join(p, E.RUNS_DIR), '我是文件不是目录'); // 注入：mkdir 必失败
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
    ok('起跑时把旧件挪走了（enginectl-runs/stale/results-stale-*.xml 一份）', 陈旧池(proj).length === 1, JSON.stringify(陈旧池(proj)));
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
    fs.writeFileSync(path.join(proj, E.RUNS_DIR), '占位文件');
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
    ok('unity-run 全程不碰 results.xml（不挪件——它本就不产这文件）', fs.existsSync(path.join(proj, 'enginectl-results.xml')) && 陈旧池(proj).length === 0);

    const r2 = await 跑CLI(['unity-test', '--project', proj, '--filter']);
    ok('参数错（--filter 缺值）仍先于挪件拦下：旧件没被动', r2.code === 1 && /--filter 需要值/.test(r2.json.error || '') && fs.existsSync(path.join(proj, 'enginectl-results.xml')), JSON.stringify(r2.json));

    const r3 = await 跑CLI(['unity-run', '--project', proj]);
    ok('unity-run 缺 --method 仍原样报错', r3.code === 1 && /必填 --method/.test(r3.json.error || ''), JSON.stringify(r3.json));

    const r4 = await 跑CLI(['没这个通道', '--project', proj]);
    ok('未知通道文案原样', r4.code === 1 && /未知通道/.test(r4.json.error || ''), JSON.stringify(r4.json));

    const r5 = await 跑CLI(['unity-test', '--project', proj, '--no-attach']);
    ok('--no-attach 退役文案原样', r5.code === 1 && /--no-attach 已退役/.test(r5.json.error || ''), JSON.stringify(r5.json));
  }

  // ══════════════════ TK-204 取证归档双写分件（范围⑦ 五条断言 a–e）══════════════════
  章('T0 --tag 归一化：缺省绝不报错中断');
  {
    ok('T0 不给 --tag → untagged', E.normalizeTag(undefined) === E.TAG_DEFAULT && E.TAG_DEFAULT === 'untagged', E.normalizeTag(undefined));
    ok('T0 给了 --tag 却没跟值（解析成 true）→ untagged，不抛不报错', E.normalizeTag(true) === 'untagged', E.normalizeTag(true));
    ok('T0 单号原样保留', E.normalizeTag('TK-204') === 'TK-204', E.normalizeTag('TK-204'));
    ok('T0 路径分隔符等不安全字符折成 -（文件名安全）', E.normalizeTag('a/b\\c:d*e') === 'a-b-c-d-e', E.normalizeTag('a/b\\c:d*e'));
    ok('T0 全是不安全字符 → 回退 untagged（绝不产出空文件名）', E.normalizeTag('///') === 'untagged', E.normalizeTag('///'));
  }

  章('T1 断言 a/b/c：两个 tag 各跑一轮（真 CLI + 假监听器）');
  {
    const proj = 新工程();
    const 固xml = path.join(proj, 'enginectl-results.xml');
    const 固log = path.join(proj, 'enginectl-test.log');
    const 剧本 = (xml, log) => (req, p) => { 写件(path.join(p, 'enginectl-results.xml'), xml); 写件(path.join(p, 'enginectl-test.log'), log); return {}; };

    const LA = await 起假监听器(proj, 剧本(XML(11, 0, 11), 'A 轮日志'));
    const rA = await 跑CLI(['unity-test', '--project', proj, '--tag', 'TK-204-a']);
    await LA.关();
    const A = { xml: rA.json.resultsFile, log: rA.json.logFile };
    ok('T1 A 轮出口带 resultsFile/logFile 绝对路径，tag 回显正确', rA.json.ok === true && rA.json.tag === 'TK-204-a' && path.isAbsolute(String(A.xml)) && path.isAbsolute(String(A.log)), JSON.stringify(rA.json));
    ok('T1 A 轮独立件名为 <tag>-<UTC>.xml|.log', /^TK-204-a-\d{8}T\d+Z(-\d+)?\.xml$/.test(path.basename(String(A.xml))) && /^TK-204-a-\d{8}T\d+Z(-\d+)?\.log$/.test(path.basename(String(A.log))), `${A.xml} ｜ ${A.log}`);
    ok('T1 【断言 c·A 轮】独立件与同轮固定名件 sha256 相等（xml 与 log 各一对）',
      sha256(A.xml) === sha256(固xml) && sha256(A.log) === sha256(固log), `${sha256(A.xml)} vs ${sha256(固xml)}`);
    const A原xml = fs.readFileSync(A.xml, 'utf8'); const A原log = fs.readFileSync(A.log, 'utf8');

    const LB = await 起假监听器(proj, 剧本(XML(22, 0, 22), 'B 轮日志'));
    const rB = await 跑CLI(['unity-test', '--project', proj, '--tag', 'TK-204-b']);
    await LB.关();
    const B = { xml: rB.json.resultsFile, log: rB.json.logFile };
    ok('T1 B 轮出口带 resultsFile/logFile，tag 回显正确', rB.json.ok === true && rB.json.tag === 'TK-204-b' && !!B.xml && !!B.log, JSON.stringify(rB.json));
    ok('T1 【断言 a】两组独立件并存、互不覆盖：4 件都在，A 轮内容一字未变',
      [A.xml, A.log, B.xml, B.log].every((f) => fs.existsSync(f)) && 成对份数(独立件(proj)) === 2
      && fs.readFileSync(A.xml, 'utf8') === A原xml && fs.readFileSync(A.log, 'utf8') === A原log
      && fs.readFileSync(B.xml, 'utf8') === XML(22, 0, 22),
      JSON.stringify(独立件(proj)));
    ok('T1 【断言 b】固定名件被后轮覆盖 = 预期行为（现在装的是 B 轮内容）',
      fs.readFileSync(固xml, 'utf8') === XML(22, 0, 22) && fs.readFileSync(固log, 'utf8') === 'B 轮日志',
      fs.readFileSync(固xml, 'utf8'));
    ok('T1 【断言 c·B 轮】独立件与同轮固定名件 sha256 相等',
      sha256(B.xml) === sha256(固xml) && sha256(B.log) === sha256(固log), `${sha256(B.xml)} vs ${sha256(固xml)}`);
    ok('T1 A 轮数字 11、B 轮数字 22 各归各（并发互毁已解）', rA.json.total === '11' && rB.json.total === '22', `${rA.json.total} / ${rB.json.total}`);

    // 兼容性：不带 --tag 照跑，落 untagged-<UTC> 件（验收 B3 的离线对应）
    const LC = await 起假监听器(proj, 剧本(XML(33, 0, 33), 'C 轮日志'));
    const rC = await 跑CLI(['unity-test', '--project', proj]);
    await LC.关();
    ok('T1 不带 --tag 原样可跑，独立件为 untagged-<UTC> 形态，failed=0',
      rC.json.ok === true && rC.json.failed === '0' && /^untagged-\d{8}T\d+Z(-\d+)?\.xml$/.test(path.basename(String(rC.json.resultsFile))),
      `${rC.json.resultsFile} ｜ ${JSON.stringify(rC.json.failed)}`);
  }

  章('T2 断言 d：独立件池保留最近 30 份（xml+log 成对计一份，按 mtime 旧→新删）');
  {
    const proj = 新工程();
    const runs = path.join(proj, E.RUNS_DIR);
    const 基 = Date.parse('2026-08-01T00:00:00Z');
    const stem = (i) => `旧单-${String(i).padStart(2, '0')}-20260801T000000000Z`;
    for (let i = 0; i < 35; i++) { // 越小越旧
      写件(path.join(runs, `${stem(i)}.xml`), XML(i, 0, i), 基 + i * 60000);
      写件(path.join(runs, `${stem(i)}.log`), `日志 ${i}`, 基 + i * 60000);
    }
    写件(path.join(proj, E.RUNS_DIR, E.STALE_SUBDIR, `${E.STALE_PREFIX}20260801T010000000Z.xml`), XML(1, 0, 1), 基);
    const 新件 = path.join(proj, 'enginectl-results.xml'); 写件(新件, XML(99, 0, 99));
    const 新日志 = path.join(proj, 'enginectl-test.log'); 写件(新日志, '本轮日志');
    const r = E.archiveRun(proj, 'TK-204-新', { results: 新件, log: 新日志 }); // 第 36 份进池 → 触发清理

    const 名单 = 独立件(proj);
    ok('T2 【断言 d】36 份进池后只剩 30 份（成对计一份，文件数 60）', 成对份数(名单) === 30 && 名单.length === 60, `份数 ${成对份数(名单)} / 文件 ${名单.length}`);
    ok('T2 删的是最旧的 6 份（旧单-00…旧单-05 全灭，含 xml 与 log）',
      [0, 1, 2, 3, 4, 5].every((i) => !名单.includes(`${stem(i)}.xml`) && !名单.includes(`${stem(i)}.log`)), JSON.stringify(名单.slice(0, 4)));
    ok('T2 留的是次新的 29 份 + 本轮新件（旧单-06…旧单-34 全在）',
      [6, 20, 34].every((i) => 名单.includes(`${stem(i)}.xml`) && 名单.includes(`${stem(i)}.log`))
      && 名单.includes(path.basename(String(r.resultsFile))) && 名单.includes(path.basename(String(r.logFile))), JSON.stringify(r));
    ok('T2 清理独立件池不碰 stale 子池（子目录不参与成对计数）', 陈旧池(proj).length === 1, JSON.stringify(陈旧池(proj)));
  }

  章('T3 断言 e：三池互不驱逐 + 归档池分家自愈（背景 3 现场复刻）');
  {
    const proj = 新工程();
    const bl = path.join(proj, E.BASELINE_DIR);
    for (let i = 0; i < 10; i++) 写件(path.join(bl, `${E.STALE_PREFIX}2026081${i}T120000000Z.xml`), XML(i, 0, i)); // 背景 3：池里 10 个全是 stale
    ok('T3 复刻现场：基线池 10 件全是 stale，基线归档件一份不剩', 基线池(proj).length === 10 && 基线池(proj).every((f) => f.startsWith(E.STALE_PREFIX)), JSON.stringify(基线池(proj)));

    const 迁 = E.migrateStalePool(proj);
    ok('T3 分家自愈：10 个 stale 件全数迁入 enginectl-runs/stale/，基线池腾空', 迁 === 10 && 陈旧池(proj).length === 10 && 基线池(proj).length === 0, `迁 ${迁} ｜ 陈旧 ${陈旧池(proj).length} ｜ 基线 ${基线池(proj).length}`);

    for (let i = 0; i < 12; i++) { // 基线池连归 12 份 → 自清到 10，全程不该动 stale 池
      const 件 = path.join(proj, 'enginectl-results.xml'); 写件(件, XML(500 + i, 0, 500 + i));
      E.archiveBaseline(proj, 件);
    }
    const 新陈旧 = [];
    for (let i = 0; i < 5; i++) { // 陈旧池再进 5 件（mtime 各不相同 → 文件名各不相同）→ 自清到 10，全程不该动基线池
      const 件 = path.join(proj, 'enginectl-results.xml'); 写件(件, XML(i, 0, i), Date.parse('2026-08-20T12:00:00Z') + i * 3600000);
      const st = E.stashStaleResults(proj, 件);
      if (st.stashed) 新陈旧.push(path.basename(st.stashed));
    }
    ok('T3 陈旧池确实进了 5 个新件（否则下面的「恰 10 份」是假绿）', 新陈旧.length === 5 && new Set(新陈旧).size === 5, JSON.stringify(新陈旧));
    const 基 = 基线池(proj); const 陈 = 陈旧池(proj);
    ok('T3 【断言 e】基线池：恰 10 份，全为 results-<UTC>.xml，零个 results-stale-*',
      基.length === 10 && 基.every((f) => /^results-\d{8}T\d+Z(-\d+)?\.xml$/.test(f)) && 基.filter((f) => f.startsWith(E.STALE_PREFIX)).length === 0, JSON.stringify(基));
    ok('T3 【断言 e】陈旧池：恰 10 份，全为 results-stale-*.xml——两池各清各的，互不驱逐',
      陈.length === 10 && 陈.every((f) => f.startsWith(E.STALE_PREFIX)), JSON.stringify(陈));
  }

  console.log(挂.length ? `\n挂 ${挂.length} 项：\n  · ${挂.join('\n  · ')}` : `\n全部通过：${过} 项`);
  process.exit(挂.length ? 1 : 0);
})();
