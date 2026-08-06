#!/usr/bin/env node
// enginectl — 引擎通道注册表（Ticketflow 通用件）
// 用法：node enginectl.js <通道> --project <工程目录> [--out <产物>] [--preset <导出预设>] [--script <测试脚本>]
//      node enginectl.js 探测            ← 列出本机可用引擎
//      unity-test [--filter 类名1,类名2] ← 只跑点名测试类的子集（冷热两路都支持）
//      unity-test/unity-run [--no-attach] ← 强制走冷 batchmode（审检全量定案用净室）
// attach：有活编辑器（工程根 .enginectl-attach.json）时把任务投给它执行；探测不通一律静默回落冷 batchmode。
// 通道只认名字，换引擎不换协议（宪法·模块化）。每通道：定位→版本校验→执行→退出码语义。
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');

// —— 引擎定位：env > 同目录 enginectl.config.json > 常见默认 ——
const CFG_FILE = path.join(__dirname, 'enginectl.config.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch { /* 走默认 */ }
function findGodot() {
  const c = process.env.ENGINECTL_GODOT || cfg.godot;
  if (c && fs.existsSync(c)) return c;
  const guess = ['D:/engines/godot', 'C:/engines/godot'];
  for (const dir of guess) {
    try { const f = fs.readdirSync(dir).find((x) => /console\.exe$/i.test(x)) || fs.readdirSync(dir).find((x) => /Godot.*\.exe$/i.test(x)); if (f) return path.join(dir, f); } catch { /* 下一个 */ }
  }
  return null;
}
function findUnityEditors() {
  const base = process.env.ENGINECTL_UNITY_HUB || cfg.unityHub || 'C:/Program Files/Unity/Hub/Editor';
  try { return fs.readdirSync(base).map((v) => ({ 版本: v, exe: path.join(base, v, 'Editor', 'Unity.exe') })).filter((e) => fs.existsSync(e.exe)); } catch { return []; }
}
function findUnreal() {
  const base = process.env.ENGINECTL_UE || cfg.unreal || 'C:/Program Files/Epic Games';
  try { const d = fs.readdirSync(base).find((x) => /^UE_/.test(x)); return d ? path.join(base, d) : null; } catch { return null; }
}

// —— 工程级互斥（TK-55/57 撞锁案）：同一 Unity 工程同时只允许一个 enginectl 会话。
// mkdir 原子抢锁；等待方轮询（默认上限 30min）。锁目录带 pid 文件，宿主进程死了视为孤儿锁可夺。
function acquireProjectLock(proj, waitMin) {
  const lockDir = path.join(proj, '.enginectl-lock');
  const pidFile = path.join(lockDir, 'pid');
  const deadline = Date.now() + (waitMin || 30) * 60000;
  for (;;) {
    try { fs.mkdirSync(lockDir); fs.writeFileSync(pidFile, String(process.pid)); return lockDir; } catch { /* 已被占 */ }
    try { // 孤儿锁检测：持锁 pid 已死则夺锁
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      if (pid) { try { process.kill(pid, 0); } catch { fs.rmSync(lockDir, { recursive: true, force: true }); continue; } }
    } catch { /* pid 文件缺失，按占用等待 */ }
    if (Date.now() > deadline) return null;
    const sab = new SharedArrayBuffer(4); Atomics.wait(new Int32Array(sab), 0, 0, 3000); // 同步睡 3s
  }
}
// 孤儿 UnityLockfile 自愈：文件在但本机无 Unity 进程 = 上次运行被杀的尸体，安全清除。
function clearOrphanUnityLock(proj) {
  const f = path.join(proj, 'Temp', 'UnityLockfile');
  if (!fs.existsSync(f)) return false;
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Unity.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
  if (/Unity\.exe/i.test(r.stdout || '')) return false; // 真有编辑器/批处理在跑，不动
  try { fs.unlinkSync(f); return true; } catch { return false; }
}

// ——————————————————————————————————————————————————————————
// attach 模式（长驻编辑器 + 任务投递）——接收端见 TK-103「编辑器内驻任务监听器」
// 纪律：探测失败一律静默回落冷 batchmode，零打扰（监听器未上线期间这是常态）。
// ——————————————————————————————————————————————————————————
const ATTACH_FILE = '.enginectl-attach.json'; // 端口发现文件（工程根）：{port, pid, projectPath}

// 【薄适配层】协议正本：TK 仓 Docs/SLG/技术方案/编辑器驻任务监听协议.md（TK-103 交付）。
// 协议若改，只动这一处。要点：应答用 event 区分 accepted/final（accepted 的 status 也是 "ok"，
// 只看 status 会把接收确认误判成结果）；请求里的路径必须是工程相对（绝对路径被判 invalid_path）；
// 应答回的 resultsPath/logPath 同样是工程相对路径，要按 projectPath 还原。
const ATTACH = {
  // 请求：NDJSON 一行一条，一条连接只发一个请求。路径字段省略即用协议默认值（正是既有落盘口径）
  buildTest: (id, filters) => ({ type: 'test', id, ...(filters.length ? { filters } : {}) }),
  buildInvoke: (id, method) => ({ type: 'invoke', id, method }),
  isAccepted: (m) => m.event === 'accepted' || (m.event === undefined && m.queued !== undefined), // 后半截：兼容无 event 的早期草稿
  isFinal: (m) => m.event === 'final' || (m.event === undefined && typeof m.status === 'string'),
  // final.status：passed/failed（test）、ok（invoke）、error（拒绝或执行失败）
  okOf: (m) => m.status === 'passed' || m.status === 'ok',
  errOf: (m) => (m && m.error ? (typeof m.error === 'string' ? m.error : `${m.error.code || 'error'}：${m.error.message || ''}`) : null),
  pathOf: (proj, p, dflt) => (p ? (path.isAbsolute(p) ? p : path.join(proj, p)) : dflt), // 应答给的是工程相对路径
};

// 端口发现：文件缺失/残缺/宿主进程已死/工程路径不符 → 一律 null（视为无活编辑器）
function discoverAttach(proj) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(proj, ATTACH_FILE), 'utf8')); } catch { return null; }
  const port = Number(j && j.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (j.projectPath) { try { if (path.resolve(String(j.projectPath)).toLowerCase() !== proj.toLowerCase()) return null; } catch { return null; } }
  if (j.pid) { // 陈旧发现文件（编辑器已退但没删）→ 不打扰，回落
    try { process.kill(Number(j.pid), 0); } catch (e) { if (e.code !== 'EPERM') return null; }
  }
  return { port, pid: j.pid };
}

// 投递：连上→发一行→等 accepted→等 final。accepted 之前任何异常都回落（fallback:true）；
// 一旦 accepted，任务已进编辑器队列，绝不再起冷 batch（会撞工程占用），只如实报错。
function attachSend(port, payload, probeMs, waitMin) {
  return new Promise((resolve) => {
    let done = false, accepted = false, buf = '', timer = null;
    const sock = net.createConnection({ host: '127.0.0.1', port });
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { sock.destroy(); } catch { /* 已断 */ } resolve(r); };
    timer = setTimeout(() => finish({ fallback: true, why: '握手超时' }), probeMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => finish(accepted ? { fallback: false, error: 'attach 连接中断：' + e.message } : { fallback: true, why: '连接失败' }));
    sock.on('connect', () => { try { sock.write(JSON.stringify(payload) + '\n'); } catch { finish({ fallback: true, why: '投递失败' }); } });
    sock.on('close', () => finish(accepted ? { fallback: false, error: 'attach 连接被提前关闭（收到 accepted 但无 final）' } : { fallback: true, why: '握手中断' }));
    sock.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; } // 噪声行忽略（薄适配：非本协议的招呼语不致命）
        if (ATTACH.isAccepted(m)) {
          if (m.id !== payload.id) return finish({ fallback: true, why: 'accepted 的 id 不符' }); // 尚未受理，回落安全
          accepted = true; clearTimeout(timer);
          timer = setTimeout(() => finish({ fallback: false, error: 'attach 等待结果超时（' + waitMin + 'min）——任务可能仍在编辑器里跑，勿另起冷 batch' }), waitMin * 60000);
          continue;
        }
        if (ATTACH.isFinal(m)) {
          if (m.id !== payload.id && m.status !== 'error') { // 只有请求被判非法时 id 才允许为空
            return finish(accepted ? { fallback: false, error: 'final 的 id 与请求不符（收到 ' + JSON.stringify(m.id) + '）' } : { fallback: true, why: 'final 的 id 不符' });
          }
          return finish({ fallback: false, final: m });
        }
      }
    });
  });
}

// —— --filter 子集：类名清单 → 单条正则（一条正则表全部点名类，绕开 -testFilter 分隔符方言）
// 纯标识符按「测试类名」处理，锚到类名边界（全名形如 Ns.Sub.类名.方法名）；带元字符的原样透传当正则。
function testFilterRegex(filters) {
  const parts = filters.map((f) => (/^[A-Za-z_]\w*$/.test(f) ? `(^|\\.)${f}\\.` : f));
  return parts.length === 1 ? parts[0] : `(${parts.join('|')})`;
}
function parseFilters(v) {
  if (v === undefined) return [];
  if (v === true) return null; // --filter 后没跟值
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

// —— 结果取数：冷热两路共用（口径唯一，禁 tail 截尾推数）
function readCounts(xml) {
  try { const x = fs.readFileSync(xml, 'utf8'); return { passed: (x.match(/passed="(\d+)"/) || [])[1] ?? null, failed: (x.match(/failed="(\d+)"/) || [])[1] ?? null, total: (x.match(/total="(\d+)"/) || [])[1] ?? null }; } catch { return { passed: null, failed: null, total: null }; }
}

// —— 基线归档：全量（无 --filter）结果落盘成功后存一份带 UTC 时间戳的副本，只留最近 10 份
const BASELINE_DIR = 'enginectl-baselines';
const BASELINE_KEEP = 10;
function archiveBaseline(proj, xml) {
  try {
    if (!fs.existsSync(xml)) return null;
    const dir = path.join(proj, BASELINE_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[-:.]/g, ''); // 20260807T001234567Z
    const dest = path.join(dir, `results-${ts}.xml`);
    fs.copyFileSync(xml, dest);
    const olds = fs.readdirSync(dir).filter((f) => /^results-.+\.xml$/.test(f)).sort().reverse(); // 文件名即时序
    for (const f of olds.slice(BASELINE_KEEP)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* 下次再清 */ } }
    return dest;
  } catch { return null; } // 归档是附加品，失败不影响测试结论
}

const args = {};
const pos = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[++i] : true;
  else pos.push(a);
}
const channel = pos[0];
const out = (o) => { console.log(JSON.stringify(o)); process.exit(o.ok ? 0 : 1); };
const run = (cmd, argv, timeoutMin) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: (timeoutMin ?? 30) * 60000, windowsHide: true });
  return { code: r.status, stdout: (r.stdout || '').slice(-4000), stderr: (r.stderr || '').slice(-2000), timedOut: r.error && r.error.code === 'ETIMEDOUT' };
};

// —— Unity 版本纪律：工程版本必须与所选编辑器一致，否则拒开（batchmode 会静默升级工程）——
function unityFor(project) {
  const pv = path.join(project, 'ProjectSettings', 'ProjectVersion.txt');
  if (!fs.existsSync(pv)) return { err: '不是 Unity 工程（缺 ProjectVersion.txt）' };
  const want = (fs.readFileSync(pv, 'utf8').match(/m_EditorVersion:\s*(\S+)/) || [])[1];
  const hit = findUnityEditors().find((e) => e.版本 === want);
  if (!hit) return { err: `版本纪律拒开：工程要 ${want}，本机装有 [${findUnityEditors().map((e) => e.版本).join(', ')}]——版本不匹配时 batchmode 会静默升级工程` };
  return { exe: hit.exe, 版本: want };
}

(async () => {
  if (channel === '探测' || channel === 'probe') {
    return out({ ok: true, godot: findGodot(), unity: findUnityEditors().map((e) => e.版本), unreal: findUnreal(), 通道: ['godot-import', 'godot-test', 'godot-export', 'unity-test', 'unity-run', 'unity-build(占位)', 'unreal-*(未装/预留)'] });
  }
  const proj = args.project && path.resolve(args.project);
  if (!proj || !fs.existsSync(proj)) return out({ ok: false, error: '必填 --project <工程目录>' });

  // —— attach 优先（且先于工程互斥锁）：活编辑器内的任务由监听器自己串行排队，
  // 不需要也不该去抢 batchmode 的工程锁（否则会被在跑的冷 batch 饿死 30min）。
  if ((channel === 'unity-test' || channel === 'unity-run') && !args['no-attach']) {
    const hit = discoverAttach(proj);
    if (hit) {
      const xml = path.join(proj, 'enginectl-results.xml');
      const runLog = path.join(proj, 'enginectl-run.log');
      const testLog = path.join(proj, 'enginectl-test.log');
      const id = `enginectl-${process.pid}-${Date.now()}`;
      const isTest = channel === 'unity-test';
      const filters = isTest ? parseFilters(args.filter) : [];
      if (filters === null) return out({ ok: false, error: '--filter 需要值：--filter 类名1,类名2' });
      if (!isTest && !args.method) return out({ ok: false, error: '必填 --method <类.静态无参方法>' });
      const payload = isTest ? ATTACH.buildTest(id, filters) : ATTACH.buildInvoke(id, String(args.method));
      const waitMin = Number(args['timeout-min'] ?? (isTest ? 40 : 20));
      const r = await attachSend(hit.port, payload, Number(args['attach-probe-ms'] || 2000), waitMin);
      if (!r.fallback) {
        if (r.error) return out({ ok: false, channel, mode: 'attach', port: hit.port, error: r.error });
        const m = r.final;
        const err = ATTACH.errOf(m);
        if (!isTest) {
          return out({ ok: ATTACH.okOf(m), channel, mode: 'attach', port: hit.port, status: m.status, method: String(args.method), log: ATTACH.pathOf(proj, m.logPath, runLog), durationMs: m.durationMs, ...(m.summary ? { summary: m.summary } : {}), ...(err ? { error: err } : {}) });
        }
        const results = ATTACH.pathOf(proj, m.resultsPath, xml);
        const c = readCounts(results); // 数字仍以落盘 XML 为准（与冷路同口径），summary 只作旁证
        const baseline = (filters.length === 0 && c.passed !== null) ? archiveBaseline(proj, results) : null;
        return out({ ok: ATTACH.okOf(m) && c.failed === '0', channel, mode: 'attach', port: hit.port, status: m.status, passed: c.passed, failed: c.failed, total: c.total, ...(filters.length ? { filter: filters } : {}), results, log: ATTACH.pathOf(proj, m.logPath, testLog), durationMs: m.durationMs, ...(baseline ? { baseline } : {}), ...(err ? { error: err } : {}) });
      }
      // r.fallback：探测/握手没成——静默回落冷路（ENGINECTL_DEBUG=1 才打一行诊断）
      if (process.env.ENGINECTL_DEBUG) console.error(`[enginectl] attach 回落冷路（端口 ${hit.port}：${r.why}）`);
    }
  }

  // 互斥 + 自愈（unity/godot 通道统一走）：抢不到锁=有同工程会话在跑，排队等待而非撞锁三振
  const lock = acquireProjectLock(proj, Number(args['lock-wait-min'] || 30));
  if (!lock) return out({ ok: false, error: '工程互斥锁等待超时（' + (args['lock-wait-min'] || 30) + 'min）——同工程另一 enginectl 会话未释放' });
  process.on('exit', () => { try { fs.rmSync(lock, { recursive: true, force: true }); } catch { /* 尽力而为 */ } });
  if (clearOrphanUnityLock(proj)) console.error('[enginectl] 孤儿 UnityLockfile 已自愈清除（无 Unity 进程存活）');

  if (channel === 'godot-import' || channel === 'godot-test' || channel === 'godot-export') {
    const g = findGodot();
    if (!g) return out({ ok: false, error: '未找到 Godot（ENGINECTL_GODOT / enginectl.config.json 可指定）' });
    if (channel === 'godot-import') {
      const r = run(g, ['--headless', '--path', proj, '--import'], 10);
      return out({ ok: r.code === 0, channel, code: r.code, tail: r.stdout.slice(-300) });
    }
    if (channel === 'godot-test') {
      if (!args.script) return out({ ok: false, error: '必填 --script res://xxx.gd（SceneTree 脚本，quit(0/1) 表结果）' });
      run(g, ['--headless', '--path', proj, '--import'], 10); // 导出/测试前显式导入（#69511 怪癖）
      const r = run(g, ['--headless', '--path', proj, '--script', String(args.script)], 20);
      return out({ ok: r.code === 0, channel, code: r.code, tail: r.stdout.slice(-400) });
    }
    // godot-export：需 export_presets.cfg 与已装导出模板
    if (!args.preset || !args.out) return out({ ok: false, error: '必填 --preset <预设名> 与 --out <产物路径>' });
    const dest = path.resolve(args.out);
    fs.mkdirSync(path.dirname(dest), { recursive: true }); // Godot 导出不建目录，缺目录静默失败
    run(g, ['--headless', '--path', proj, '--import'], 10);
    const r = run(g, ['--headless', '--path', proj, '--export-release', String(args.preset), dest], 30);
    const built = fs.existsSync(dest);
    return out({ ok: r.code === 0 && built, channel, code: r.code, 产物: built ? dest : null, tail: r.stdout.slice(-300), ...(r.code !== 0 ? { stderr: r.stderr.slice(-400) } : {}) });
  }

  if (channel === 'unity-test') {
    const u = unityFor(proj);
    if (u.err) return out({ ok: false, error: u.err });
    // 工程锁检测：编辑器开着同一工程时 batchmode 必败且报错难读——先给人话
    if (fs.existsSync(path.join(proj, 'Temp', 'UnityLockfile'))) {
      return out({ ok: false, error: '工程被 Unity 编辑器占用（Temp/UnityLockfile 存在）——请关闭编辑器后重试；此为环境占用非代码问题' });
    }
    const filters = parseFilters(args.filter);
    if (filters === null) return out({ ok: false, error: '--filter 需要值：--filter 类名1,类名2' });
    const xml = path.join(proj, 'enginectl-results.xml');
    const r = run(u.exe, ['-batchmode', '-nographics', '-projectPath', proj, '-runTests', '-testPlatform', String(args.platform || 'EditMode'),
      ...(filters.length ? ['-testFilter', testFilterRegex(filters)] : []),
      '-testResults', xml, '-logFile', path.join(proj, 'enginectl-test.log')], Number(args['timeout-min'] ?? 40));
    const { passed, failed, total } = readCounts(xml);
    // 全量（无 --filter）结果落盘成功 → 归档基线；子集结果不入基线（会污染回归对照线）
    const baseline = (filters.length === 0 && passed !== null) ? archiveBaseline(proj, xml) : null;
    return out({ ok: r.code === 0 && failed === '0', channel, mode: 'cold', code: r.code, passed, failed, total, ...(filters.length ? { filter: filters } : {}), 版本: u.版本, results: xml, ...(baseline ? { baseline } : {}) });
  }

  if (channel === 'unity-run') { // 通用 executeMethod：场景重建/烘焙等工程内 static 方法（TK-49 案增补）
    const u = unityFor(proj);
    if (u.err) return out({ ok: false, error: u.err });
    if (fs.existsSync(path.join(proj, 'Temp', 'UnityLockfile'))) {
      return out({ ok: false, error: '工程被 Unity 编辑器占用（Temp/UnityLockfile 存在）——请关闭编辑器后重试；此为环境占用非代码问题' });
    }
    if (!args.method) return out({ ok: false, error: '必填 --method <类.静态无参方法>' });
    const log = path.join(proj, 'enginectl-run.log');
    const r = run(u.exe, ['-batchmode', '-nographics', '-projectPath', proj, '-executeMethod', String(args.method), '-quit', '-logFile', log], Number(args['timeout-min'] ?? 20));
    return out({ ok: r.code === 0, channel, mode: 'cold', code: r.code, method: String(args.method), log, ...(r.code !== 0 ? { tail: (() => { try { return fs.readFileSync(log, 'utf8').slice(-400); } catch { return r.stderr.slice(-300); } })() } : {}) });
  }
  if (channel === 'unity-build') return out({ ok: false, error: '占位通道：构建脚本按项目落地后启用（需工程内 static 构建方法）' });
  if (channel && channel.startsWith('unreal')) return out({ ok: false, error: '预留通道：本机未装 UE；装后按 RunUAT/BuildCookRun 补实现（见 引擎适配调研报告）' });
  return out({ ok: false, error: '未知通道。可用：探测 / godot-import / godot-test / godot-export / unity-test / unity-run' });
})();
