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
    return out({ ok: true, godot: findGodot(), unity: findUnityEditors().map((e) => e.版本), unreal: findUnreal(), 通道: ['godot-import', 'godot-test', 'godot-export', 'unity-test', 'unity-build(占位)', 'unreal-*(未装/预留)'] });
  }
  const proj = args.project && path.resolve(args.project);
  if (!proj || !fs.existsSync(proj)) return out({ ok: false, error: '必填 --project <工程目录>' });

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
    const xml = path.join(proj, 'enginectl-results.xml');
    const r = run(u.exe, ['-batchmode', '-nographics', '-projectPath', proj, '-runTests', '-testPlatform', String(args.platform || 'EditMode'), '-testResults', xml, '-logFile', path.join(proj, 'enginectl-test.log')], Number(args['timeout-min'] ?? 40));
    let passed = null, failed = null;
    try { const x = fs.readFileSync(xml, 'utf8'); passed = (x.match(/passed="(\d+)"/) || [])[1]; failed = (x.match(/failed="(\d+)"/) || [])[1]; } catch { /* 无结果文件 */ }
    return out({ ok: r.code === 0 && failed === '0', channel, code: r.code, passed, failed, 版本: u.版本, results: xml });
  }

  if (channel === 'unity-build') return out({ ok: false, error: '占位通道：构建脚本按项目落地后启用（需工程内 static 构建方法）' });
  if (channel && channel.startsWith('unreal')) return out({ ok: false, error: '预留通道：本机未装 UE；装后按 RunUAT/BuildCookRun 补实现（见 引擎适配调研报告）' });
  return out({ ok: false, error: '未知通道。可用：探测 / godot-import / godot-test / godot-export / unity-test' });
})();
