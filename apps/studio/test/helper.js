// test/helper.js — 造一个临时监制台仓库 + 配置 + 建单工具
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../lib/core/store');

const CFG = {
  职能: ['策划', '程序', '美术', 'QA'],
  优先级: ['P0', 'P1', 'P2', 'P3'],
  执行池: {
    codex: { 职能: ['程序'], 阈值: 70, 周阈值: 90 },
    claude: { 职能: ['策划', '美术', 'QA'], 阈值: 70, 周阈值: 90 },
  },
  // 闸值 与 lib/setup.js 模板配置().闸值 同形（2026-08-22 体检 #70/#37）：
  // 原夹具带 全局在途上限/每职能在途上限——0.23.11 拉取制退役时就没人读了（全仓 grep 只剩注释），
  // 却让「参数页画哪几张卡 ↔ 写口收哪几个键」的两表对拍判据拿到一份陈旧的实盘形状。
  // 夹具跟模板走，键集分叉由 test/测试口径.test.js 看住。
  闸值: { 待验收积压闸: 8, QA自修上限: 2, 滞留超时小时: 4, 人闸超时小时: 24 },
  // 施工令-031 起初检是机判（进程内纯代码，零池零凭据），不再靠「有没有 deepseek 池」当开关。
  // 基础 CFG 显式关两检，让既有 ④b 核查用例保持原语义（它们的被测对象是核查，不是初检）；
  // 要测初检的用例自己开（见 runner.test.js / precheck.test.js）。
  // 派发制显式 false（2026-08-21）：此前这一格是**缺的**，靠 runner 的旧缺省
  // 「缺键＝拉取制」把整条测试基线钉在拉取制上。今日 H49 缺省反转为「缺键＝派发制」后
  // 这些用例集体转向，才暴露出它们一直隐式依赖一个已被决议废止的路。
  // 这里写死 false 不是维持旧制，是**把隐式依赖变成显式声明**：
  // 用例要测拉取制就得自己说出来，别再靠缺省替它选。
  // 想测派发制的用例照旧 `{...CFG, 执行器:{派发制:true}}` 显式开（既有写法不变）。
  执行器: { 两检: { 开: false }, 派发制: true },
  agents: [
    { id: '策划-A', 职能: '策划', 执行池: 'claude' },
    { id: '程序-A', 职能: '程序', 执行池: 'codex' },
    { id: 'QA-A', 职能: 'QA', 执行池: 'claude' },
  ],
};


// ── 临时根自清理（2026-08-22 体检 #49）─────────────────────────────
// 原样零回收：每个用例 mkdtemp 一个 studio-* 根，跑完谁也不删，%TEMP% 曾积到十万量级，
// 连 Get-ChildItem 枚举都要三秒。存量清扫治不了本，缺的是机制。
// 只清**本进程自己造的**那些根（记在 临时根 里），绝不按通配符扫 %TEMP% —— 同机可能有
// 别的测试进程正在用它自己的 studio-*，误删就是把别人的用例炸掉。
// 带重试：spawn 过子进程的用例在 Windows 上 rmSync 会 EBUSY，单发 + catch{} 等于静默失败。
const 临时根 = new Set();
const 同步睡 = (ms) => { const sab = new SharedArrayBuffer(4); Atomics.wait(new Int32Array(sab), 0, 0, ms); };
function 回收临时根() {
  if (process.env.KEEP_TMP) return; // 逃生阀：用例炸了要留现场排障
  for (let i = 0; i <= 3; i++) {
    for (const d of [...临时根]) {
      try { fs.rmSync(d, { recursive: true, force: true }); 临时根.delete(d); } catch { /* 还占着，下轮再来 */ }
    }
    if (!临时根.size) return;
    同步睡(800);
  }
}
process.on('exit', 回收临时根);

// test/ 里另有几十处直接 fs.mkdtempSync 的调用点，统一改走这里就一并纳入回收。
function 临时目录(前缀 = 'studio-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 前缀));
  临时根.add(d);
  return d;
}

// 收尾行口径归一（2026-08-22 体检 #60）：跑测试.js 靠尾行正则数「断言 M」。
// 仓里曾有四种写法（`全部通过：N 项` / `xxx: N 项通过` / `—— N 项通过` / `✓ xxx 全部 N 项通过`），
// 少收一种就静默吞掉上百项。新套件一律调这个函数，别再自创格式。
function 收尾(名, 项数) {
  console.log(名 ? 名 + " 全部通过：" + 项数 + " 项" : "全部通过：" + 项数 + " 项");
  return 项数;
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  临时根.add(root);
  store.ensureDirs(root);
  fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify(CFG), 'utf8');
  return root;
}

let seq = 0;
// 直接在某状态目录建单（跳过流转，用于铺测试初态）
function seed(root, state, opts = {}) {
  const id = opts.id || `P-${String(++seq).padStart(2, '0')}`;
  const fm = {
    id, title: opts.title || `单${id}`, 职能: opts.职能 || '策划',
    产出物类型: opts.产出物类型 || '文档', 优先级: opts.优先级 || 'P1',
    规模: opts.规模 || '单兵', QA: opts.QA || '关', 验收方式: opts.验收方式 || '保留',
    创建时间: opts.创建时间 || '2026-07-08', 更新时间: '2026-07-08',
  };
  if (opts.父单) fm.父单 = opts.父单;
  if (opts.依赖) fm.依赖 = opts.依赖;
  if (opts.依据) fm.依据 = opts.依据;
  if (opts.主办) fm.主办 = opts.主办;
  if (opts.领单时间) fm.领单时间 = opts.领单时间;
  // 其余字段透传（代裁/自修次数/预计时间/阶段/执行池…）——白名单曾吞掉新字段导致测试假阳
  for (const k of Object.keys(opts)) if (!(k in fm) && k !== 'body' && opts[k] !== undefined) fm[k] = opts[k];
  fs.writeFileSync(store.ticketPath(root, state, id), store.serialize(fm, opts.body || '## 范围\n做 ' + id), 'utf8');
  return id;
}

// 等到(判, 上限ms, 名) —— 等一个条件成立，而不是等一段墙钟。
//
// 案源（2026-08-21）：runner.test.js 用 `await sleep(40)` 等一个 spawn 子进程写两行 stderr，
// 实测本机连跑 10 次 10 红（观测值 "codex"＝只到了第一条）。这一格坐在 deploy-ritual 换装闸
// 与完工判据制的**唯一机器出口**上——一条靠运气的断言，会让「全绿」这句话整体不可信。
// 外部协作方 2026-08-08 已诊断过同一条（「时序假设写死，不可移植」），我方书面认领「本周修」，
// 13 天未落；今日一并了结。
//
// 两条纪律：
//   ① 条件必须**单调可达**——会自己变回不成立的条件不许用轮询等，那是把偶发红换成必然挂死。
//   ② 超时要**指名道姓**地失败，不许静默返回让后面的断言去背锅。
async function 等到(判, 上限ms = 5000, 名 = '条件') {
  const 止 = Date.now() + 上限ms;
  for (;;) {
    let ok = false;
    try { ok = !!(await 判()); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() > 止) throw new Error(`等待超时（${上限ms}ms）：${名} 始终不成立`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

module.exports = { CFG, makeRoot, seed, 等到, 临时目录, 收尾, 回收临时根 };
