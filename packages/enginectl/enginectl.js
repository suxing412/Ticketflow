#!/usr/bin/env node
// enginectl — 引擎通道注册表（Ticketflow 通用件）
// 用法：node enginectl.js <通道> --project <工程目录> [--out <产物>] [--preset <导出预设>] [--script <测试脚本>]
//      node enginectl.js 探测            ← 列出本机可用引擎
//      unity-test [--filter 类名1,类名2] ← 只跑点名测试类的子集
//      unity-test/unity-run [--fresh]   ← 净室：请求活编辑器排空队列后自退，重新可见拉起再投递（重启后首跑）
//      unity-* [--boot-timeout-min N]   ← 可见编辑器拉起后等监听器上线的上限（默认 5min，首次导入可调大）
// 施工令-011「编辑器绝对可见化」：Unity 侧只允许存在带可见窗口的编辑器，无头 batchmode 整族退役，无例外旗标。
//   无活监听器 → 可见拉起 Unity.exe -projectPath <工程>（不带任何无头/无图形旗标）→ 等监听器上线 → 投递。
//   拉不起/等不到 → 人话报错，绝不回落无头。已在跑的可见编辑器永不被杀死或抢占（--fresh 也只是礼貌请求自退）。
// 通道只认名字，换引擎不换协议（宪法·模块化）。每通道：定位→版本校验→执行→退出码语义。
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

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

// —— 工程级互斥（TK-55/57 撞锁案）：同一工程同时只允许一个 enginectl 会话进「拉起编辑器/冷跑」临界区。
// mkdir 原子抢锁；等待方轮询（默认上限 30min）。锁目录带 pid 文件，宿主进程死了视为孤儿锁可夺。
// 注意（施工令-011）：Unity 侧只在「可见拉起」这一小段持锁（防两个会话同时开两个编辑器），
// 监听器一上线立刻释放——任务本身由编辑器内监听器串行排队，不该占满整场测试把别人饿死。
function acquireProjectLock(proj, waitMin) {
  const lockDir = path.join(proj, '.enginectl-lock');
  const pidFile = path.join(lockDir, 'pid');
  const deadline = Date.now() + (waitMin || 30) * 60000;
  for (;;) {
    try {
      fs.mkdirSync(lockDir); fs.writeFileSync(pidFile, String(process.pid));
      process.on('exit', () => { try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch { /* 尽力而为 */ } });
      return lockDir;
    } catch { /* 已被占 */ }
    try { // 孤儿锁检测：持锁 pid 已死则夺锁
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      if (pid) { try { process.kill(pid, 0); } catch { fs.rmSync(lockDir, { recursive: true, force: true }); continue; } }
    } catch { /* pid 文件缺失，按占用等待 */ }
    if (Date.now() > deadline) return null;
    const sab = new SharedArrayBuffer(4); Atomics.wait(new Int32Array(sab), 0, 0, 3000); // 同步睡 3s
  }
}
function releaseLock(lockDir) { try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch { /* 进程退出兜底 */ } }
function unityProcessAlive() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Unity.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
  return /Unity\.exe/i.test(r.stdout || '');
}
// 工程是否已被一个活编辑器占着（UnityLockfile 是工程级的，比发现文件可靠——
// 编辑器还在导入/编译时监听器尚未上线，发现文件可能缺失或陈旧）。
function projectHeldByEditor(proj) {
  return fs.existsSync(path.join(proj, 'Temp', 'UnityLockfile')) && unityProcessAlive();
}
// 孤儿 UnityLockfile 自愈：文件在但本机无 Unity 进程 = 上次运行被杀的尸体，安全清除。
function clearOrphanUnityLock(proj) {
  const f = path.join(proj, 'Temp', 'UnityLockfile');
  if (!fs.existsSync(f)) return false;
  if (unityProcessAlive()) return false; // 真有编辑器在跑，不动
  try { fs.unlinkSync(f); return true; } catch { return false; }
}

// ——————————————————————————————————————————————————————————
// attach 模式（可见长驻编辑器 + 任务投递）——接收端见 TK-103「编辑器内驻任务监听器」
// 纪律（施工令-011）：探测不到监听器 = 去可见拉起一个编辑器，不存在无头回落路径。
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
  // restart：--fresh 的净室动作——请求监听器「排空队列后自退出」。TK-103 侧返修实装前，
  // 协议只认 test/invoke/status，会回 final.status=error（code=unsupported_type）→ 走人话报错容错路径。
  buildRestart: (id) => ({ type: 'restart', id }),
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

// —— --filter 子集：类名清单原样交给监听器（协议按测试夹具类名匹配，正则转义在 TK-103 侧）。
// 无头退役后不再需要 -testFilter 正则拼装（原 testFilterRegex 随冷路一并移除）。
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
const STALE_PREFIX = 'results-stale-'; // 挪走的旧件也叫 results-*.xml，一并吃 keep-10 的清理，不会无限堆
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

// ——————————————————————————————————————————————————————————
// 结果新鲜度自校（施工令-056）——案源 TK-144（2026-08-11 22:05）：上一轮遗留的 results.xml
// 被收尾读成本轮成绩，523 全绿是假的。总监当时的手工三步（杀净/挪件/核 mtime）在此机器化：
//   一、起跑前记时刻，并把在位的旧 results.xml 挪进 enginectl-baselines/（挪不动就停手报错，绝不带旧件开跑）；
//   二、收尾核 mtime ≥ 起跑时刻，不达标 status=error（stale_results），一个数字都不报；
//   三、输出 resultsMtime 供外部复核。
// 归档是附加品可以失败，新鲜度不是：宁可红着停，也不端出一份来路不明的绿。
// ——————————————————————————————————————————————————————————
function statMtimeMs(f) { try { return fs.statSync(f).mtimeMs; } catch { return null; } } // 不存在/读不到 → null
const 时戳 = (ms) => new Date(ms).toISOString();

// 起跑净场：旧件在位就挪走（改名，不是复制——原位必须空出来）。返回 { stashed } 或 { err }。
// 时间戳取旧件自己的 mtime：文件名直接说明「这是哪一轮的成绩」。
function stashStaleResults(proj, xml) {
  const mtimeMs = statMtimeMs(xml);
  if (mtimeMs === null) return { stashed: null }; // 本就没有旧件 = 已是净场
  try {
    const dir = path.join(proj, BASELINE_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${STALE_PREFIX}${时戳(mtimeMs).replace(/[-:.]/g, '')}.xml`);
    fs.renameSync(xml, dest);
    if (fs.existsSync(xml)) return { err: `起跑前挪走上一轮 ${path.basename(xml)} 后它仍在原位（${xml}）——拒绝带着旧件开跑` };
    return { stashed: dest, mtimeMs };
  } catch (e) {
    return { err: `起跑前挪走上一轮 ${path.basename(xml)} 失败：${e.message}——旧件还在原位（${xml}），继续开跑就可能把上一轮成绩读成本轮的（TK-144 案）。请手动移走该文件、或修好 ${BASELINE_DIR}/ 的目录权限后重跑` };
  }
}

// 收尾闸：放行返回 { stale:false, resultsMtime }，拦下返回 { stale:true, error, resultsMtime }。
// 无容差——起跑时刻在挪件之前取，本轮真跑出来的文件 mtime 必晚于它；早于它只有一种解释：不是本轮的。
function freshnessGate(results, startedAtMs) {
  const mtimeMs = statMtimeMs(results);
  if (mtimeMs === null) {
    return { stale: true, resultsMtime: null, error: `stale_results：收尾读不到结果文件（${results}）——没有可核的 mtime，绝不报数；请看编辑器内「SLG/任务监听器」窗口是否真跑完了本轮任务` };
  }
  if (mtimeMs < startedAtMs) {
    return { stale: true, resultsMtime: 时戳(mtimeMs), error: `stale_results：结果文件 mtime（${时戳(mtimeMs)}）早于本轮起跑时刻（${时戳(startedAtMs)}）——这是上一轮的旧件，本轮没落盘新结果，绝不报数（TK-144 案）；请看编辑器内「SLG/任务监听器」窗口是否真跑了本轮任务` };
  }
  return { stale: false, resultsMtime: 时戳(mtimeMs), mtimeMs };
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

// —— Unity.exe 三级发现（施工令-011）：env 覆盖 → ProjectVersion 拼 Hub 路径 → 找不到即人话报错。
// 版本纪律：走第二级时工程版本必须与编辑器一致（版本不匹配会静默升级工程）；
// env 覆盖是人工指定，视为已知情，只校验文件在不在。
function findUnityExe(project) {
  const envExe = process.env.ENGINECTL_UNITY_EXE;
  if (envExe) {
    if (!fs.existsSync(envExe)) return { err: `ENGINECTL_UNITY_EXE 指向的文件不存在：${envExe}——请指向 Unity.exe 绝对路径，或清空该环境变量改走工程版本发现` };
    return { exe: envExe, 版本: 'env 指定', 发现: 'env(ENGINECTL_UNITY_EXE)' };
  }
  const pv = path.join(project, 'ProjectSettings', 'ProjectVersion.txt');
  if (!fs.existsSync(pv)) return { err: `不是 Unity 工程（缺 ${pv}）——无法推断编辑器版本；确需指定可设 ENGINECTL_UNITY_EXE` };
  const want = (fs.readFileSync(pv, 'utf8').match(/m_EditorVersion:\s*(\S+)/) || [])[1];
  if (!want) return { err: `ProjectVersion.txt 里读不出 m_EditorVersion：${pv}` };
  const 装有 = findUnityEditors().map((e) => e.版本);
  const hit = findUnityEditors().find((e) => e.版本 === want);
  if (!hit) return { err: `找不到工程要求的 Unity ${want}：Hub 目录（${process.env.ENGINECTL_UNITY_HUB || cfg.unityHub || 'C:/Program Files/Unity/Hub/Editor'}）装有 [${装有.join(', ') || '空'}]——请用 Unity Hub 装 ${want}，或设 ENGINECTL_UNITY_EXE 指向对应 Unity.exe；版本不匹配时开工程会静默升级，故拒开` };
  return { exe: hit.exe, 版本: want, 发现: 'ProjectVersion.txt→UnityHub' };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 可见拉起：spawn 一个带窗口的编辑器（detached，父进程退出后它照活），轮询等监听器写发现文件。
// 启动参数只有 -projectPath，不带任何无头/无图形旗标；等不到只报错不回落无头（「灾难场景的答案是修显示器」）。
async function bootVisibleEditor(proj, bootMin, lockWaitMin) {
  const u = findUnityExe(proj);
  if (u.err) return { err: u.err };
  const lock = acquireProjectLock(proj, lockWaitMin);
  if (!lock) return { err: `工程互斥锁等待超时（${lockWaitMin}min）——同工程另一 enginectl 会话正在拉起编辑器且未释放` };
  try {
    const again = discoverAttach(proj); // 排队等锁期间，别人可能已经把编辑器拉起来了
    if (again) return { hit: again, launched: false, exe: u.exe, 发现: u.发现, 版本: u.版本 };
    if (clearOrphanUnityLock(proj)) console.error('[enginectl] 孤儿 UnityLockfile 已自愈清除（无 Unity 进程存活）');
    const t0 = Date.now();
    // 「永不抢占」闸门：工程已被一个活编辑器占着（只是监听器还没上线——还在导入/编译，或没点启动），
    // 绝不另开第二个编辑器（会双开撞工程占用），只等它上线。
    if (projectHeldByEditor(proj)) {
      console.error(`[enginectl] 工程已被一个可见编辑器打开、但监听器还没上线，等它上线（上限 ${bootMin}min；绝不另开第二个编辑器）…`);
      const dl = Date.now() + bootMin * 60000;
      for (;;) {
        const h = discoverAttach(proj);
        if (h) return { hit: h, launched: false, waitedMs: Date.now() - t0, exe: u.exe, 发现: u.发现, 版本: u.版本 };
        if (Date.now() > dl) return { err: `工程已被一个可见 Unity 编辑器占着（Temp/UnityLockfile 在、Unity.exe 活着），但 ${bootMin}min 内它的监听器没上线（工程根没有有效的 ${ATTACH_FILE}）——enginectl 绝不另开第二个编辑器抢占工程。请到那个编辑器里打开菜单「SLG/任务监听器」点启动，或礼貌关掉它后重跑；工程首次导入/编译很慢时可加 --boot-timeout-min <分钟>` };
        if (!projectHeldByEditor(proj)) break; // 编辑器中途关掉了 → 回到正常拉起路径
        await sleep(3000);
      }
    }
    let child;
    try { child = spawn(u.exe, ['-projectPath', proj], { detached: true, stdio: 'ignore' }); child.unref(); } catch (e) { return { err: `可见编辑器拉起失败：${u.exe} —— ${e.message}` }; }
    const pid = child.pid;
    if (!pid) return { err: `可见编辑器拉起失败：${u.exe} 未返回进程号` };
    console.error(`[enginectl] 已可见拉起 Unity ${u.版本}（pid ${pid}，来源 ${u.发现}），等监听器上线（上限 ${bootMin}min）…`);
    const deadline = Date.now() + bootMin * 60000;
    for (;;) {
      await sleep(3000);
      const h = discoverAttach(proj);
      if (h) return { hit: h, launched: true, editorPid: pid, exe: u.exe, 发现: u.发现, 版本: u.版本, bootMs: Date.now() - t0 };
      try { process.kill(pid, 0); } catch (e) {
        if (e.code !== 'EPERM') return { err: `可见编辑器进程已退出（pid ${pid}）却没等到监听器——多半是工程被别的编辑器占用或启动即崩；请手动双击打开工程看报错` };
      }
      if (Date.now() > deadline) return { err: `可见编辑器已拉起（pid ${pid}，窗口保留未被杀）但 ${bootMin}min 内监听器没上线（工程根始终没出现 ${ATTACH_FILE}）——首次导入/编译可能更久，可加 --boot-timeout-min <分钟>；也可到该编辑器窗口菜单「SLG/任务监听器」点启动。绝不回落无头` };
    }
  } finally { releaseLock(lock); }
}

// --fresh 净室：礼貌请求活编辑器「排空队列后自退出」，再等它真的退出（发现文件消失）。
// 监听器不支持 restart（TK-103 未返修）→ 人话报错，绝不强杀活编辑器。
async function requestEditorRestart(proj, hit, probeMs, waitMin) {
  const id = `enginectl-fresh-${process.pid}-${Date.now()}`;
  const r = await attachSend(hit.port, ATTACH.buildRestart(id), probeMs, 5);
  if (r.fallback) return { err: `--fresh 请求没被受理（端口 ${hit.port}：${r.why}）——活编辑器状态不明，enginectl 不强杀；请手动关闭编辑器后重跑` };
  if (r.error) return { err: `--fresh 请求失败：${r.error}` };
  const err = ATTACH.errOf(r.final);
  if (err || !ATTACH.okOf(r.final)) {
    return { err: `--fresh 不可用：活编辑器的监听器不支持 restart 动作（应答：${err || r.final.status}）——TK-103 侧返修实装前，请手动关闭编辑器窗口再重跑本命令（届时无活编辑器，enginectl 会可见拉起新编辑器，即为「重启后首跑」净室）。enginectl 绝不强杀活编辑器` };
  }
  const deadline = Date.now() + waitMin * 60000;
  for (;;) {
    if (!discoverAttach(proj)) return { ok: true };
    if (Date.now() > deadline) return { err: `--fresh 已被受理但编辑器 ${waitMin}min 内没退出（${ATTACH_FILE} 仍在）——可能仍在排空队列；请稍后重跑或手动关闭编辑器` };
    await sleep(3000);
  }
}

async function main() {
  if (channel === '探测' || channel === 'probe') {
    return out({ ok: true, godot: findGodot(), unity: findUnityEditors().map((e) => e.版本), unreal: findUnreal(), 通道: ['godot-import', 'godot-test', 'godot-export', 'unity-test', 'unity-run', 'unity-build(占位)', 'unreal-*(未装/预留)'] });
  }
  const proj = args.project && path.resolve(args.project);
  if (!proj || !fs.existsSync(proj)) return out({ ok: false, error: '必填 --project <工程目录>' });

  if (args['no-attach']) return out({ ok: false, error: '--no-attach 已退役（施工令-011：无头 batchmode 编辑器整族退役，无例外旗标）——净室请改用 --fresh：请求活编辑器排空队列后自退，重新可见拉起再投递，「重启后首跑」即净室' });

  // —— Unity 通道：只走「可见编辑器 + 任务投递」，无冷 batch 回落路径 ——
  if (channel === 'unity-test' || channel === 'unity-run' || channel === 'unity-build') {
    if (channel === 'unity-build') return out({ ok: false, error: '占位通道：构建脚本按项目落地后启用（需工程内 static 构建方法，经监听器 invoke 白名单走可见编辑器）' });
    const isTest = channel === 'unity-test';
    // 参数先校验再拉编辑器——别为一条写错的命令开一个 Unity
    const filters = isTest ? parseFilters(args.filter) : [];
    if (filters === null) return out({ ok: false, error: '--filter 需要值：--filter 类名1,类名2' });
    if (!isTest && !args.method) return out({ ok: false, error: '必填 --method <类.静态无参方法>' });
    const probeMs = Number(args['attach-probe-ms'] || 2000);
    const bootMin = Number(args['boot-timeout-min'] ?? 5);
    const lockWaitMin = Number(args['lock-wait-min'] || 30);

    const xml = path.join(proj, 'enginectl-results.xml');
    // 起跑时刻 + 净场（施工令-056）：只对 unity-test——unity-run 不产结果文件，此段整体不进，行为零变化。
    // 位置讲究：在拉编辑器之前。挪不动旧件就当场停手，别为一场注定读不准的测试开一个 Unity。
    let startedAtMs = null;
    if (isTest) {
      startedAtMs = Date.now();
      const st = stashStaleResults(proj, xml);
      if (st.err) return out({ ok: false, channel, mode: 'visible', error: st.err });
      if (st.stashed) console.error(`[enginectl] 上一轮遗留的结果文件已挪走：${st.stashed}（mtime ${时戳(st.mtimeMs)}）`);
    }

    let hit = discoverAttach(proj);
    let boot = null;
    if (hit && args.fresh) { // 净室：礼貌请求自退 → 等它退干净 → 下面重新可见拉起
      const fr = await requestEditorRestart(proj, hit, probeMs, bootMin);
      if (fr.err) return out({ ok: false, channel, mode: 'visible', port: hit.port, error: fr.err });
      hit = null;
    }
    if (!hit) { // 无活监听器 → 可见拉起（--fresh 且本就没编辑器时，新开的编辑器天然就是「重启后首跑」）
      boot = await bootVisibleEditor(proj, bootMin, lockWaitMin);
      if (boot.err) return out({ ok: false, channel, mode: 'visible', error: boot.err });
      hit = boot.hit;
    }
    const 编辑器 = { port: hit.port, editorPid: hit.pid, ...(boot && boot.launched ? { launched: true, bootMs: boot.bootMs, 版本: boot.版本, 发现: boot.发现 } : { launched: false }), ...(args.fresh ? { fresh: true } : {}) };

    const runLog = path.join(proj, 'enginectl-run.log');
    const testLog = path.join(proj, 'enginectl-test.log');
    const id = `enginectl-${process.pid}-${Date.now()}`;
    const payload = isTest ? ATTACH.buildTest(id, filters) : ATTACH.buildInvoke(id, String(args.method));
    const waitMin = Number(args['timeout-min'] ?? (isTest ? 40 : 20));
    const r = await attachSend(hit.port, payload, probeMs, waitMin);
    if (r.fallback) { // 曾经在这里静默回落冷 batch；无头退役后只如实报错，绝不另起无头
      return out({ ok: false, channel, mode: 'visible', ...编辑器, error: `任务投递失败（${r.why}）——活编辑器窗口保留未被杀；请看编辑器内「SLG/任务监听器」窗口状态，或关闭编辑器后重跑。绝不回落无头` });
    }
    if (r.error) return out({ ok: false, channel, mode: 'visible', ...编辑器, error: r.error });
    const m = r.final;
    const err = ATTACH.errOf(m);
    if (!isTest) {
      return out({ ok: ATTACH.okOf(m), channel, mode: 'visible', ...编辑器, status: m.status, method: String(args.method), log: ATTACH.pathOf(proj, m.logPath, runLog), durationMs: m.durationMs, ...(m.summary ? { summary: m.summary } : {}), ...(err ? { error: err } : {}) });
    }
    const results = ATTACH.pathOf(proj, m.resultsPath, xml);
    // 新鲜度闸（施工令-056）：过不了闸就 status=error，passed/failed/total 一个都不出现在输出里——
    // 「没有数字」比「有一组来路不明的数字」安全得多。listenerStatus 留着，供人对照监听器自己怎么说。
    const 新鲜 = freshnessGate(results, startedAtMs);
    if (新鲜.stale) {
      return out({ ok: false, channel, mode: 'visible', ...编辑器, status: 'error', listenerStatus: m.status, ...(filters.length ? { filter: filters } : {}), results, resultsMtime: 新鲜.resultsMtime, log: ATTACH.pathOf(proj, m.logPath, testLog), durationMs: m.durationMs, error: [新鲜.error, err].filter(Boolean).join('；另：') });
    }
    const c = readCounts(results); // 数字以落盘 XML 为准（口径唯一，禁 tail 截尾推数），summary 只作旁证
    const baseline = (filters.length === 0 && c.passed !== null) ? archiveBaseline(proj, results) : null;
    return out({ ok: ATTACH.okOf(m) && c.failed === '0', channel, mode: 'visible', ...编辑器, status: m.status, passed: c.passed, failed: c.failed, total: c.total, ...(filters.length ? { filter: filters } : {}), results, resultsMtime: 新鲜.resultsMtime, log: ATTACH.pathOf(proj, m.logPath, testLog), durationMs: m.durationMs, ...(baseline ? { baseline } : {}), ...(err ? { error: err } : {}) });
  }

  // 互斥 + 自愈（godot 通道）：抢不到锁=有同工程会话在跑，排队等待而非撞锁三振
  const lock = acquireProjectLock(proj, Number(args['lock-wait-min'] || 30));
  if (!lock) return out({ ok: false, error: '工程互斥锁等待超时（' + (args['lock-wait-min'] || 30) + 'min）——同工程另一 enginectl 会话未释放' });
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

  if (channel && channel.startsWith('unreal')) return out({ ok: false, error: '预留通道：本机未装 UE；装后按 RunUAT/BuildCookRun 补实现（见 引擎适配调研报告）' });
  return out({ ok: false, error: '未知通道。可用：探测 / godot-import / godot-test / godot-export / unity-test / unity-run' });
}

// 命令行照旧直接跑；被 require 时只交出算子（test.js 拿去实测新鲜度三分支），一行都不执行。
module.exports = { readCounts, archiveBaseline, statMtimeMs, stashStaleResults, freshnessGate, BASELINE_DIR, BASELINE_KEEP, STALE_PREFIX };
if (require.main === module) main();
