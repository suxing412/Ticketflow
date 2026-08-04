#!/usr/bin/env node
// enginectl — 引擎通道注册表（Ticketflow 通用件）
// 用法：node enginectl.js <通道> --project <工程目录> [--out <产物>] [--preset <导出预设>] [--script <测试脚本>]
//      node enginectl.js 探测            ← 列出本机可用引擎
// 通道只认名字，换引擎不换协议（宪法·模块化）。每通道：定位→版本校验→执行→退出码语义。
const fs = require('fs');
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
    const xml = path.join(proj, 'enginectl-results.xml');
    const r = run(u.exe, ['-batchmode', '-nographics', '-projectPath', proj, '-runTests', '-testPlatform', String(args.platform || 'EditMode'), '-testResults', xml, '-logFile', path.join(proj, 'enginectl-test.log')], Number(args['timeout-min'] ?? 40));
    let passed = null, failed = null;
    try { const x = fs.readFileSync(xml, 'utf8'); passed = (x.match(/passed="(\d+)"/) || [])[1]; failed = (x.match(/failed="(\d+)"/) || [])[1]; } catch { /* 无结果文件 */ }
    return out({ ok: r.code === 0 && failed === '0', channel, code: r.code, passed, failed, 版本: u.版本, results: xml });
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
    return out({ ok: r.code === 0, channel, code: r.code, method: String(args.method), log, ...(r.code !== 0 ? { tail: (() => { try { return fs.readFileSync(log, 'utf8').slice(-400); } catch { return r.stderr.slice(-300); } })() } : {}) });
  }
  if (channel === 'unity-build') return out({ ok: false, error: '占位通道：构建脚本按项目落地后启用（需工程内 static 构建方法）' });
  if (channel && channel.startsWith('unreal')) return out({ ok: false, error: '预留通道：本机未装 UE；装后按 RunUAT/BuildCookRun 补实现（见 引擎适配调研报告）' });
  return out({ ok: false, error: '未知通道。可用：探测 / godot-import / godot-test / godot-export / unity-test / unity-run' });
})();
