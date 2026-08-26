// runner.js — 执行器（D30/D31/D32 · H108 三大态状态机 2026-08-24 改道）：内嵌 exe 的拉取循环。
// 每轮 tick 三种工作：
//   ① 自动领单：空闲在岗 agent 从 待派（fm.放行===true）拉单（双闸/额度锁/依赖/一人一张全在 claim 路径）
//   ② 执行：在途单起执行（真调 codex/claude 无头 CLI；H81 常开单闸制：运行即实弹，无解锁开关）
//   ③ 审检链目录化（H108）：质检会话跑「初检」目录 → 两检初检/核查会话跑「核查」目录 →
//      争议送「仲裁」目录由代裁会话裁。判官全过落「完成」（在途大态出口驻留位，等专项级验收）。
// 失败路径（D31/H108）：CLI 崩溃/超时/非零退出 → lifecycle.执行失败（纯本地目录改名 → 待处理），
// 由总监分诊（待重派/返修/废弃）。停止=不领新单，执行中跑完（同 D26 暂停语义）。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const store = require('./core/store');
const state = require('./core/state');
const pool = require('./pool');
const roster = require('./roster');
const lifecycle = require('./lifecycle');
const journal = require('./journal');
const inbox = require('./inbox');
const eventarchive = require('./eventarchive');

// 内存态：正在执行的工作（agentId → { id, kind, startedAt, timer, child }）。
// exe 重启即清空，tick 为"在途/质检有主办但无执行记录"的单重新拉起（断点恢复）。
const running = new Map();
let loopTimer = null;
let lastTick = null;
let 滞留拒签 = ''; // 派发滞留 journal 去重签（2026-08-26 TK-201 案：15 秒一拍不去重就是一夜刷屏）
const 孤儿失败已留痕 = new Set(); // 核查孤儿补链失败留痕去重（同上：失败态每拍重试但只喊一次）
// 核查孤儿判据面（纯读，2026-08-26 案）：代核不过章在、边没走、还赖在核查目录的单。
// 正常路径（代核 kind 处理）成功送仲裁后单已离目录，扫不到——只有断在缝上的孤儿会命中。
function 核查孤儿们(root) {
  return require('./core/store').list(root, '核查')
    .filter((x) => x.fm.代核 && x.fm.代核.结论 === '不过' && !x.fm.挂起);
}
// 仲裁孤儿（2026-08-26 第二现场）：代裁章在（给方向/上呈）却还赖在仲裁目录的单。
// 正常路成功仲裁定后单已离目录；「裁过」结论直落完成不经此形。
function 仲裁孤儿们(root) {
  return require('./core/store').list(root, '仲裁')
    .filter((x) => x.fm.代裁 && ['给方向', '上呈'].includes(x.fm.代裁.结论) && !x.fm.挂起);
}
let 滞留首见 = 0;  // 同签滞留的起点毫（评审补：流水一条单行不算「出声」，滞留超阈值要升急件）
let 滞留已急件 = false;
const 滞留急件阈毫 = 30 * 60000; // 同一滞留面挂 30 分钟未解 → inbox 急件（TK-201 案 7h 静默的止血线）

const busyTickets = () => new Set([...running.values()].map((e) => e.id));
function isOn(root) { return !!state.read(root).执行器?.运行; }
// 测试内部钩子（H81）：opts.durMs 存在 ⇒ 模拟执行（不拉 CLI，durMs 后/立即收线），
// 供测试套件做同步执行。生产路径（startLoop/server）永不传 durMs，因此永远是实弹。
function isSim(opts) { return opts && opts.durMs != null; }

// ---- 池凭据解析（2026-08-08 凭据托管，路 B）----
// 顺序：托管库（<root>/凭据.json，DPAPI 密文）> config 内联 兼容 段（旧路径，保兼容）。
// 订阅池永远返回 null——它们的凭据归 CLI 自己管，app 一个字节都不存（路 B 的核心红利）。
// 施工令-029 补章：兜底做到**字段粒度**，不是整块二选一。
// 迁移只搬 key（base/模型 仍留在 config 兼容段）时，旧写法会把 base 一并置空，
// 而「base 缺省 = 走 Anthropic 官方端点」——结果是拿 deepseek 的 key 去敲官方的门：
// 必然 401，且等于把第三方密钥递给了错误的收件人。端点因此单独兜底。
function 凭据Of(root, cfg, poolName) {
  // codex 实测定谳（2026-08-08，协-003 收尾验证）：codex CLI **完全无视**
  // ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN——注入垃圾令牌 + 非法 base 后
  // `codex exec` 仍退出 0 正常作答，走的是它自己的 ~/.codex 登录态。
  // 若这里为 codex 池返回凭据，runner 会照常注入、codex 照常忽略，后果是双重错误且完全静默：
  //   ① 用户以为在按量池上跑，实际在烧订阅；
  //   ② 预算闸因 codex 非 stream-json 取不到 usage，永远不累计、永不触发。
  // 故 codex 池一律不托管，并由 startWork 显式失败——宁可响亮地拒派，不要静默地跑错池。
  // 注：池名 'codex-key' 不走这条——resolveCli 只把**恰好叫 codex** 的池路由到 codex CLI，
  // 别的名字一律走 claude CLI（命名陷阱，改 resolveCli 前先读这段）。
  if (poolName === 'codex') return null;
  const c = (cfg.执行池 && cfg.执行池[poolName] && cfg.执行池[poolName].兼容) || null;
  try {
    const creds = require('./creds');
    if (creds.has(root, poolName)) {
      const k = creds.getKey(root, poolName);
      if (k) {
        const m = creds.meta(root, poolName) || {};
        const 端点自config = !m.base && !!(c && c.base);
        return {
          key: k,
          base: m.base || (c && c.base) || null,
          模型: m.模型 || (c && c.模型) || null,
          来源: 端点自config ? '托管(key)+config(端点)' : '托管',
        };
      }
    }
  } catch { /* 托管库不可用（DPAPI 挂了等）→ 回落内联，不阻塞派发 */ }
  if (c && c.key) return { key: c.key, base: c.base || null, 模型: c.模型 || null, 来源: '内联' };
  return null;
}

// ---- 项目定位（D32）：工单.项目 → config 注册表 → 仓库路径；完整注册向导属打包后首配 ----
function projectPath(cfg, t) {
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  const name = t.fm.项目 || (cfg.项目 && cfg.项目.默认);
  const p = name && reg[name] && reg[name].路径;
  return p && fs.existsSync(p) ? { name, path: p } : null;
}

// ---- 模型分级（D38 = 停车场 P-5 落地）：贵模型当裁判，便宜模型干体力 ----
// 解析顺序：编制档位(config.编制[].池序[].档) > 工种/池默认(config.模型) > CLI 自带默认(空)
// H85 补章：第一顺位由「agent 个体覆盖」改为「职能在该池上的档」——去岗位化后没有个体，
// 档挂在 职能×池 上（借调到别的池时自然换成那个池的档，不会把 codex 的模型名带去 claude）。
function pickModel(cfg, kind, 档, poolName, 职能) {
  const m = cfg.模型 || {};
  if (kind === '质检') return m.质检 || m.claude默认 || '';
  if (kind === '代核') return m.核查 || m.代核 || m.claude默认 || ''; // H68：新键 核查 优先，旧键兼容
  if (kind === '代裁') return m.仲裁 || m.代裁 || m.核查 || m.代核 || m.claude默认 || ''; // H68 新键优先
  // 职能覆盖（0.23.11：装配单事故率实证——装配上 opus）：config.模型.职能覆盖 = { 装配: 'opus', ... }
  const 个体 = (档 && typeof 档 === 'object') ? 档.模型 : 档; // 宽进：旧调用传 agentCfg 对象也认
  return 个体 || (m.职能覆盖 && 职能 && m.职能覆盖[职能]) || m[poolName + '默认'] || '';
}

// ---- 编辑器锁（H64，2026-08-05 制作人拍板）：自动探测误报家族退役（agent 自己的 batch 测试
// 曾反复触发占用挂起）。制作人开 Unity 前在监制台手动关锁=声明验收；不关锁一律视为编辑器未开。
// 探测仅服务「用完自动开锁」：锁关后见过编辑器、随后连续两拍探不到 → 自动开锁恢复派发。 ----
let editorProbeCache = { at: 0, busy: new Set() };
let editorSeenPrevTick = new Set();
function manualLockedProjects(root) {
  try { return new Set(Object.keys(require('./core/state').read(root).编辑器锁 || {})); } catch { return new Set(); }
}
function editorDetect(cfg) { // 非 batch 判定不可靠（CIM 竞态），此处只作开锁参考，不作挂起依据
  if (Date.now() - editorProbeCache.at < 5000) return editorProbeCache.busy;
  const busy = new Set();
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  const locks = Object.entries(reg).filter(([, v]) => v.路径 && fs.existsSync(path.join(v.路径, 'Temp', 'UnityLockfile')));
  if (locks.length) {
    const r = require('child_process').spawnSync('tasklist', ['/FI', 'IMAGENAME eq Unity.exe', '/NH'], { encoding: 'utf8', windowsHide: true });
    if (/Unity\.exe/i.test(r.stdout || '')) for (const [name] of locks) busy.add(name);
  }
  editorProbeCache = { at: Date.now(), busy };
  return busy;
}
function autoUnlockTick(root, cfg) {
  const state = require('./core/state');
  const locks = (state.read(root) || {}).编辑器锁 || {};
  const names = Object.keys(locks);
  if (!names.length) { editorSeenPrevTick = new Set(); return; }
  const seen = editorDetect(cfg);
  for (const name of names) {
    const L = locks[name] || {};
    if (seen.has(name)) {
      if (!L.见过编辑器) state.update(root, (st) => { if (st.编辑器锁 && st.编辑器锁[name]) st.编辑器锁[name].见过编辑器 = true; });
    } else if (L.见过编辑器 && !editorSeenPrevTick.has(name)) {
      state.update(root, (st) => { if (st.编辑器锁) delete st.编辑器锁[name]; });
      journal.append(root, `编辑器锁自动开锁 ${name}：编辑器已退出（H64），派发恢复`);
      inbox.post(root, '常', '编辑器锁', `${name} 验收结束自动开锁，派发恢复`);
    }
  }
  editorSeenPrevTick = seen;
}

// ---- 人闸超时升格（施工令-061 二·4；制作人 2026-08-21 00:23 拍板 T=24h）----
// 病灶：闸注册表**算得出**「这笔停摆 37 小时」，却没有任何东西会**主动**把它端到人跟前。
// 总览红条是被动的——人不开那一页就永远看不见，TK-180 在台上躺 26 小时无人吭声正是这么来的。
// 「主动」这两个字此前只存在于我的口头描述里：全库 grep，gatereg.逾期() 零调用者。本函数就是那半。
//
// 三条纪律，每条都有案源：
// ① **一笔债只升格一次**（按 gateKey 记账，债清了才抹账）。池衡拒因没这一条，
//    同一条理由在 journal 里刷了 9 天 265 次；15 秒一拍的循环里，忘了去重就是一夜 5760 条。
// ② **只把制作人的债送进收件箱**（归属 ∈ 制作人/双）。总监自己的债走 journal——
//    收件箱是制作人的第一屏，我的欠账不该占他的版面（归属分流在 等我() 里已经分好了，这里只是用它）。
// ③ **升格不改判据**。它不新造「谁欠债」的口径，只订阅 等我() 的结论；
//    两套口径必然有一套是旧的（甘特红条那次的教训：判定只许有一个实现）。
function 人闸升格Tick(root, cfg) {
  const T = require('./gatereg').逾期阈值(cfg); // 唯一取值口，见该函数头注（两处各写一遍就是口径分裂）
  if (!(T > 0)) return; // T<=0 视为关闭升格，不是「立刻全红」
  const gr = require('./gatereg');
  const 活跃 = new Set([...running.values()].filter((e) => e.kind === '执行' && e.id).map((e) => e.id));
  let 逾期;
  try { 逾期 = gr.逾期(root, T, { deps: { 活跃单: 活跃 } }); } catch (e) {
    journal.append(root, `人闸升格取数失败：${e.message}`); return; // 取不到数就闭嘴，不许假装零欠债
  }
  const 现存 = new Set(逾期.map((d) => d.gateKey));
  const state2 = require('./core/state');
  const 已报 = (state2.read(root) || {}).人闸升格 || {};
  const 新增 = 逾期.filter((d) => !已报[d.gateKey]);
  const 消解 = Object.keys(已报).filter((k) => !现存.has(k));
  if (!新增.length && !消解.length) return;
  for (const d of 新增) {
    const 归 = d.归属 || '制作人';
    const 摘 = `${d.闸名}：${d.title || d.id} 已停摆 ${Math.round(d.停摆小时)}h（超 ${T}h）`;
    if (归 === '制作人' || 归 === '双') inbox.post(root, '急', '人闸逾期', 摘, { 单号: d.id, 到: d.落点 || '' });
    else journal.append(root, `人闸逾期（${归}）：${摘}`); // 总监自己的账，记在流水里自己认
  }
  if (新增.length) journal.append(root, `人闸超时升格：新增 ${新增.length} 笔逾期（T=${T}h）`);
  if (消解.length) journal.append(root, `人闸逾期消解：${消解.length} 笔已了结`);
  state2.update(root, (st2) => {
    const m = st2.人闸升格 || {};
    for (const d of 新增) m[d.gateKey] = new Date().toISOString();
    for (const k of 消解) delete m[k]; // 债清了就抹账——同一笔债将来再逾期还能再响一次
    st2.人闸升格 = m;
  });
}

// ---- 实弹 CLI 定位：exe 的 GUI 进程 PATH 不全（探针实证），按候选绝对路径解析 ----
function resolveCli(poolName, model, allowedTools) {
  if (poolName === 'codex') {
    return { cmd: 'codex', args: ['exec', '--dangerously-bypass-approvals-and-sandbox', ...(model ? ['-m', model] : []), '-'] };
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
    path.join(home, '.local', 'bin', 'claude.exe'),
    'claude',
  ];
  const cmd = candidates.find((c) => c === 'claude' || fs.existsSync(c));
  // stream-json 全量捕获（TK-35 案终局）：-p 纯文本只吐最后一条消息——agent 写完报告
  // 再说句闲话/收个尾，真报告整条被吞（TK-31/33 静默死、TK-35 187 字节闲聊回执同源）。
  // 全量事件流落地后由 extractClaudeText 提取真报告。
  // 放行工具（TK-49 案）：acceptEdits 下 Bash 仍逐条要审批，无头会话无人可批——
  // 项目侧 settings.json 规则曾四种路径变体全落空，改由拉起参数直接放行（值在 config.执行器.放行工具）。
  const allow = Array.isArray(allowedTools) ? allowedTools.filter((s) => typeof s === 'string' && s.trim()) : [];
  // --include-partial-messages（施工令-047）：与 AI-DevPlatform 侧 providers/claude-cli.js 同起法
  // （robinwang2 2026-08-11 信 §一）。两处收益：①活尾巴能跟着字走，不必等整条消息吐完（旧样一条
  // 长消息期间尾巴纹丝不动，H63 验尸只能靠回执 mtime 判进展）；②与对方口径逐旗对齐，账才可对。
  // 代价是流量涨几倍——故 stdout 入口做行分拣：增量事件只喂尾巴、不进 out（见 流分拣器），
  // 于是 extractClaudeText / settleClose 读到的 out 与 047 前逐字节同形，800KB 上限也不被撑爆。
  return { cmd, args: ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', ...(allow.length ? ['--allowedTools', ...allow] : []), ...(model ? ['--model', model] : [])], stream: true };
}

// ---- stream-json 行分拣（施工令-047）----
// 一条 stdout 数据块进来分三路：
//   主  = 非增量事件的整行 → 拼进 out（extractClaudeText / settleClose 的读物，口径不变）
//   计量 = 含 usage 的整行 → 另存细流喂 budget.usageOf（out 被上限截头时也不会连带丢掉账）
//   增  = text_delta 的文本片 → 只更新活尾巴，一个字节都不留存
// 增量事件（type=stream_event）的 usage 挂在 e.event.usage 上，usageOf 只认 e.usage / e.message.usage
// ——不认它是对的（message_delta 报的是本条消息的累计输出，与随后的 assistant 整条重复），
// 故增量行不进细流：既不影响账，也不白占上限。
function 分派(行s) {
  let 主 = '', 计量 = '', 报告 = '';
  const 增 = [];
  for (const l of 行s) {
    // 判增量只认**解析出来的** e.type——不能用「行里出现 stream_event 字样」当判据：
    // agent 的回答里完全可能原样引一段事件 JSON（本仓的 agent 就在改这个文件），
    // 那样一行整段报告会被当成增量丢掉，回执直接蒸发。宁可多 parse 几行。
    if (l.includes('"stream_event"')) {
      let e = null;
      try { e = JSON.parse(l); } catch { /* 不是 JSON 就不是增量事件，落到下面当主流 */ }
      if (e && e.type === 'stream_event') {
        const d = e.event && e.event.delta;
        if (d && d.type === 'text_delta' && d.text) 增.push(d.text);
        continue;
      }
    }
    主 += l + '\n';
    if (l.includes('"usage"')) 计量 += l + '\n';
    // 报告细流（2026-08-26 截头案真根因）：out 满 800KB 即 slice(-400000) **丢头保尾**，
    // 且切在字节中间会把一行 JSON 腰斩、那条 assistant 消息整个解析失败——TK-204 的
    // 回执遂从半截 JSON 起头，前三章全灭（两轮下游修补都没治到这里）。
    // 照仓内既有成例（计量另存细流，注释见上方「out 被上限截头时也不会连带丢掉账」）：
    // assistant 文本另存一条只含正文的细流，密度远高于 JSON 包装，同样上限下装得下整份报告。
    if (l.includes('"type":"assistant"')) {
      try {
        const e = JSON.parse(l);
        if (e && e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
          for (const b of e.message.content) if (b.type === 'text' && b.text && b.text.trim()) 报告 += b.text.trim() + '\n\n';
        }
      } catch { /* 半行/非 JSON：主流里还有一份，extract 会兜 */ }
    }
  }
  return { 主, 计量, 增, 报告 };
}
// 有状态分拣器：数据块边界会把一行劈成两半，残段留到下一块再拼（不留残段就会丢 usage 行）。
function 流分拣器() {
  let 残 = '';
  return {
    收(chunk) {
      const 行 = (残 + String(chunk)).split('\n');
      残 = 行.pop();
      if (残.length > 400000) { 行.push(残); 残 = ''; } // 半行大到不像 JSONL：当整行放行，防内存爬升
      return 分派(行);
    },
    收尾() { const r = 分派(残 ? [残] : []); 残 = ''; return r; }, // 末行常常没有换行符
  };
}
// stream-json 活尾巴：最近一个**整块**文本 + 其后到达的增量片。
// 只扫 out 末 8KB——尾巴只要最后 300 字，每来一块就全量正则扫 800KB 是纯白工（O(n²)）。
function 流尾(out, 活片) {
  const 块 = [];
  for (const m of String(out).slice(-8000).matchAll(/"type":"text","text":"((?:[^"\\]|\\.)*)"/g)) {
    try { const s = JSON.parse('"' + m[1] + '"').replace(/\s+/g, ' ').trim(); if (s) 块.push(s); } catch { /* 窗口切半的行忽略 */ }
  }
  const 活 = String(活片 || '').replace(/\s+/g, ' ').trim();
  const tail = ((块.length ? 块[块.length - 1] : '') + (活 ? (块.length ? ' ' : '') + 活 : '')).slice(-300);
  const tail3 = 块.slice(-3).map((x) => x.slice(-200));
  return { tail: tail || null, tail3: tail3.length ? tail3 : (tail ? [tail] : null) };
}

// stream-json（JSONL 事件流）→ 报告文本：收集全部 assistant 文本块，
// 优先取最后一个像"报告"的（完工报告/QA 核验/结论行），否则整体拼接兜底；
// 解析不出一行 JSON（版本不支持等）则原文返回，行为退化为旧样。
function extractClaudeText(raw) {
  const texts = [];
  let sawJson = false;
  for (const line of String(raw).split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('{')) continue;
    try {
      const e = JSON.parse(s);
      sawJson = true;
      if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
        for (const b of e.message.content) if (b.type === 'text' && b.text && b.text.trim()) texts.push(b.text.trim());
      }
    } catch { /* 非 JSON 行忽略 */ }
  }
  if (!sawJson) return String(raw);
  // 回执保全（2026-08-26 截头四案：TK-185/190/204、TF-4 全倒在「缺自测结果章」）：
  // 旧样「取匹配关键词的最后一段」默认报告只占一条消息——长回执被会话切成多条时，
  // 只有含「结论：」的尾段幸存，头段（产出/做了什么/自测结果）整段丢弃，落盘的回执
  // 从代码块中段起头。现改：从**第一个**带报告语汇的段起拼到末尾——过程闲聊仍被剪，
  // 报告跨段不再截头；草稿+终稿场景宁冗勿缺（初检抓的是章存在性，多料不红）。
  // 保守剪裁（2026-08-26 二修，TK-204 复发案）：一修「从第一个带报告语汇的段起拼」仍会丢头——
  // 长回执被切成多条时首段常是报告开头（`# 完工报告` 在段内但被切在半途、或以正文续写起头），
  // 关键词命中落在后段，首段整个被丢：TK-204 落盘回执从半截 JSON `径见输出的…` 起头，
  // 前三章（做了什么/自测结果/实际消耗）全灭。定谳：**默认全留**，只剪两端可确证的闲聊——
  // 首段无任何 markdown 结构（无章头/围栏/列表/编号）且 < 200 字＝开场白；末段同判 < 80 字。
  // 宁可多留过程叙述（初检只查章存在性，多料不红），绝不再丢半份报告。
  return 剪闲聊(texts.join('\n\n'));
}

// 两端闲聊剪裁（2026-08-26 定谳，供 extractClaudeText 与报告细流共用一处口径）：
// **默认全留**，只剪两端可确证的闲聊——无 markdown 结构且首段 <200 字／末段 <80 字。
// 全无结构段（压根没有报告体）时一个字不剪。宁可多留过程叙述（初检只查章存在性，多料不红），
// 绝不再丢半份报告（TK-204/185/203/TF-4 四案的教训）。
function 剪闲聊(文本) {
  const 有结构 = (t) => /^#{1,6}\s|```|^\s*[-*]\s|^\s*\d+[.、)]/m.test(t || '');
  const 段 = String(文本 || '').split(/\n{2,}/).filter((x) => x.trim());
  if (!段.length) return String(文本 || '');
  if (!段.some(有结构)) return 段.join('\n\n');
  while (段.length > 1 && !有结构(段[0]) && 段[0].length < 200) 段.shift();
  while (段.length > 1 && !有结构(段[段.length - 1]) && 段[段.length - 1].length < 80
    && !/结论[:：]/.test(段[段.length - 1])) 段.pop();
  return 段.join('\n\n');
}

// ---- 活尾巴取样（施工令-010 第 5 条 · 总监 2026-08-07 00:23 实测定谳）----
// codex CLI 的**过程输出全走 stderr**，stdout 只在收尾吐最终答案（实测：过程行「codex」「tokens used」
// 在 stderr，stdout 仅 6 字节终答）。旧样 tail 只喂 stdout ⇒ codex 会话全程显示「尚无输出」，
// 看着像挂死：TK-102 挂死 48 分钟无人察觉是它，00:01 一次冤杀收回也是它（H63 软超时验尸拿 tail 判进展）。
// 现口径：stdout 有货优先（真报告永远比过程噪声值钱），stdout 还空就用 stderr 最近行兜底；
// 两路都先洗 ANSI 与裸控制符（codex 过程行带颜色码与光标序列，原样进 UI 是乱码）。
// 只服务「显示与活性判据」——settleClose 的收线裁决仍只认 stdout，判定逻辑一字不改。
// 正则用字符串构造（源码里不留裸控制字节，免得改文件的编辑器把它吃掉）
const CSI = new RegExp('\u001B\\[[0-9;?]*[ -/]*[@-~]', 'g');   // 颜色 / 光标 / 擦除
const ESCSEQ = new RegExp('\u001B[@-Z\\-_]', 'g');            // 其余 ESC 序列（含 OSC 起始）
const CTRL = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]', 'g'); // 裸控制符（保留 tab/换行/回车）
function stripAnsi(s) {
  return String(s).replace(CSI, '').replace(ESCSEQ, '').replace(CTRL, '');
}
function tailFrom(out, errout) {
  const src = stripAnsi(String(out || '').trim() ? out : (errout || ''));
  return {
    tail: src.replace(/\s+/g, ' ').trim().slice(-300),
    tail3: src.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).map((x) => x.slice(-200)),
  };
}

// 代理注入（中台验证过的坑：claude 无头调用必须带代理 env）。
// 服务启动时已按 环境→注册表→config默认 注入进程环境，这里兜底再补一层 config 默认。
function proxyEnv(cfg) {
  const env = { ...process.env };
  const p = env.HTTPS_PROXY || env.https_proxy || (cfg && cfg.网络 && cfg.网络.代理默认) || '';
  if (p) { env.HTTPS_PROXY = p; env.HTTP_PROXY = p; env.https_proxy = p; env.http_proxy = p; }
  return env;
}

// 岗位协议（用户定稿的 agent 章程）：通用 + 职能特化，组提示词时自动前置。
// 明文 .md 是唯一事实源——章程改了下一单立即生效，不用改代码。
function charter(root, 职能) {
  const dir = path.join(root, '岗位协议');
  const parts = [];
  for (const f of ['通用.md', `${职能}.md`]) {
    try { parts.push(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* 缺章程不阻塞执行 */ }
  }
  return parts.join('\n\n---\n\n');
}

// 工单 → 执行提示词（岗位协议 + 装配包 + 范围/不要做/验收标准；中文走 stdin 防 argv 乱码）
// H49 装配器：协议选段 + 坑档案 + 上游依赖回执随包注入（修 TK-29 上游盲区）
function buildPrompt(root, t, proj) {
  const ch = charter(root, t.fm.职能);
  let pack = '';
  try { pack = require('./assembler').assemble(root, t); } catch { /* 装配失败不阻塞执行 */ }
  return [
    ch ? `=== 岗位协议（必须遵守）===\n${ch}\n` : '',
    `你是「${t.fm.职能}」职能执行 agent，领到工单 ${t.id}：${t.fm.title}`,
    `工作目录（项目仓库）：${proj.path}`,
    '只做工单范围内的事，遵守「不要做」，产出满足全部验收标准。',
    pack ? '\n' + pack : '',
    '', '=== 工单正文 ===', t.body || '（无正文）',
    '', '完成后按通用章程的回执格式输出完工报告，它会作为回执存档。',
  ].filter(Boolean).join('\n');
}
// 总监代劳条款（施工令-043，案源 TK-138 死锁案 2026-08-11）：验收标准里写明「总监代跑」的条目
// 对执行者结构性不可得——判官照「全量数字缺」打回，执行方自修再多轮也补不上（TK-138 空转两轮
// 直到总监手术；同族时序摩擦当日再发两起）。质检与核查两卷同用一条规则，抽成常量防两处飘。
// 初检（precheck.js 机判）侧的豁免白名单已覆盖同一语义，此处只补 LLM 判官卷面。
const 代劳条款规则 = '【总监代劳条款豁免】验收标准中凡载明「总监代跑/代劳实测后誊入/不判失分」或指向 enginectl 引擎实测的条目，执行方标注「待代跑」即视为该条**应答完备**——不得以「数字缺/未跑」为由打回或列为缺陷；判词中该条记「待总监代跑」。若执行方对此类条目**冒填数字**（非引用已存在的总监誊入段），按回执失实处理。';

// 核查提示词（D34）：Claude 按验收标准逐条只读核验，结论行机器可读
function buildAuditPrompt(root, t, proj, receiptPath) {
  const receipt = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8') : '（无回执）';
  return [
    `你代制作人层核验委托验收单 ${t.id}（${t.fm.title}）。只读核验，不改任何文件。`,
    `项目仓库：${proj.path}`,
    '对照工单验收标准逐条核验产出与回执，输出核验报告；',
    代劳条款规则,
    '报告末尾输出一行「质量分：N」（N=1-5：验收标准达成度+回执诚实度+证据链质量，H69 仪表盘用，独立于结论）。',
    '最后单独一行输出机器可读结论：「结论：通过」或「结论：不过」。',
    '', '=== 工单正文 ===', t.body || '', '', '=== 主办回执 ===', receipt,
  ].join('\n');
}
// 仲裁提示词（D43③）：QA 三振上呈的单，裁判档裁「给方向/上呈」；打回级判断永远留给制作人
function buildArbPrompt(root, t, proj, receiptPath) {
  const receipt = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8') : '（无回执）';
  return [
    `你代制作人层裁决 QA 三振上呈的工单 ${t.id}（${t.fm.title}，自修 ${t.fm.自修次数 || 0} 轮未过）。只读分析，不改任何文件。`,
    `项目仓库：${proj.path}`,
    '结合工单验收标准、主办回执与 QA 章节判断：',
    '· 若失败原因明确、给出具体修复方向后主办有望修复 → 裁「给方向」，并写出可执行的方向（改什么、往哪改、以什么为准）；',
    '· 若属于需求含糊/方向存疑/该推倒重来等需要制作人裁量的情况 → 裁「上呈」（打回销毁工作量的判断只有制作人能做）。',
    '输出简短分析后，最后以机器可读格式结尾：',
    '「结论：给方向」+ 下一行「方向：<具体方向>」，或单独一行「结论：上呈」。',
    '', '=== 工单正文 ===', t.body || '', '', '=== 主办回执（含 QA 章节）===', receipt,
  ].join('\n');
}
function buildQaPrompt(root, t, proj, receiptPath) {
  const receipt = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8') : '（无回执）';
  const ch = charter(root, 'QA');
  return [
    ch ? `=== 岗位协议（必须遵守）===\n${ch}\n` : '',
    `你是 QA 复核 agent，对工单 ${t.id}（${t.fm.title}）做质检：只读复核，不改实现（D20）。`,
    `项目仓库：${proj.path}`,
    '对照工单验收标准逐条核验主办的产出与回执，按章程格式输出核验结论。',
    // 保留单三振案（TK-46）：判官对着签字项写不出通过/不过，结论散文化三轮判读失败
    '报告倒数第二行输出「质量分：N」（N=1-5：产出工艺+回执诚实度，H69 仪表盘用，独立于结论）。',
    '【质检结论体裁铁律】报告末尾必须单独一行输出且只能输出：`【质检结论】通过`、`【质检结论】不通过` 或 `【质检结论】待人工判`。',
    '【保留项豁免】标注【保留】的验收条目是制作人签字位，不在你的核验范围——跳过它们，只裁可核项；可核项全过即「通过」，保留项未签不构成不通过的理由。',
    代劳条款规则,
    '', '=== 工单正文 ===', t.body || '', '', '=== 主办回执 ===', receipt,
  ].filter(Boolean).join('\n');
}

// ---- 收线裁决（TK-21 实测修复 + TK-31/TK-29 两案加固）：
// ① 判官（质检/代核/代裁）空输出不是有效裁决——按执行失败重试（TK-21）；
// ② 执行类空输出同样不作数——曾以「（CLI 无输出）」占位回执照常交单，TK-31 实测
//    空壳一路混过 QA 到待验收，产出真伪无据。现改执行失败分诊，绝不占位混关；
// ③ 判官光板结论（有结论行但全文过薄、无逐条理由）＝摆烂不是裁决——TK-29 实测
//    两字"不过"逼制作人层人工清章。按判官失败重试。
// 返工草稿预生成（0.23）已随 H65 同活同号返修制退役：代核不过不再另开返工草稿，
// 判官建议留在原单回执「核查」章，制作人点「返修」同号改写即可。

// 两检初检提示词（H67）：只核格式与规范，不判内容质量——那是深检（opus）的事
function buildPrecheckPrompt(root, t, receiptPath) {
  let receipt = '';
  try { receipt = fs.readFileSync(receiptPath, 'utf8'); } catch { /* 无回执也初检（本身就是缺项） */ }
  return [
    '你是单流的「两检初检」环节：只核对回执的格式与规范，不评价内容质量与技术对错。',
    '逐项核对（缺一项记一条缺项）：',
    '① 存在「自测结果」类章节，且对工单每条验收标准逐条给出 ✓/✗ 判定',
    '② 存在「实际消耗」：用时 + token 双报（缺任一即缺项）',
    '③ 存在「异议」章节（内容可为"无"）',
    '④ 禁语检查：出现 "In progress" / "Waiting" / 「跑完后补」类字样 = 空壳标志，直接缺项',
    '⑤ 验收标准若要求具体数字（阈值/计数/秒数），回执有对应的具体数字（不必核对数字对错，只核存在）',
    '⑥ 工单 frontmatter 有 返修轮 时，回执开头有「相对上轮改了什么」说明',
    '输出：一行结论 + 一个 ```json 代码块：{"初检":"过"或"不过","缺项":["…"]}（无缺项时空数组，"过"）。',
    '', '=== 工单 ===', (() => { try { return fs.readFileSync(t.file, 'utf8').slice(0, 5000); } catch { return '（读取失败）'; } })(),
    '', '=== 回执 ===', receipt.slice(0, 12000) || '（回执文件不存在——这本身就是缺项）',
  ].join(String.fromCharCode(10));
}

// 会话种类名与目录态名分家（2026-08-24 H108 后）：kind='质检' 是判官会话类型与模型档配置键
// （cfg.模型.质检），**不是目录态**——目录态已改 初检/核查/仲裁。键名不动是为了不碰生产 config。
const JUDGE_KINDS = new Set(['质检', '代核', '代裁', '初检']);
const QA_SAME_SESSION_FOLLOW_UP_LIMIT = 1;
// 质检结论的消费端兼容层。新协议只接受末尾独行的【质检结论】；旧报告在升级窗口
// 仍会出现「结论：通过」、Markdown 标题后另起一行、加粗值等形态，故在这里统一归一。
// 不从勾选表或散文语气推断通过与否：没有显式结论就是未知，交给同会话补问或人工判。
function parseQaConclusion(text) {
  const raw = String(text || '');
  const normalize = (v) => (v === '不过' ? '不通过' : v);
  const line = /^\s*(?:[-*>]\s*)?(?:#{1,6}\s*)?(?:\*{1,3}\s*)?(?:【\s*)?(?:质检\s*)?结论(?:\s*】)?\s*[:：]?\s*(?:\*{1,3}\s*)?(不通过|不过|通过|待人工判)(?:\s*\*{1,3})?\s*$/gmi;
  const block = /^\s*(?:#{1,6}\s*)?(?:\*{1,3}\s*)?(?:质检\s*)?结论(?:\s*\*{1,3})?\s*[:：]?\s*\r?\n\s*(?:[-*>]\s*)?(?:\*{1,3}\s*)?(不通过|不过|通过|待人工判)(?:\s*\*{1,3})?(?:\s*[（(][^\r\n）)]*[）)])?\s*$/gmi;
  let hit = null;
  for (const m of raw.matchAll(line)) hit = normalize(m[1]);
  if (!hit) for (const m of raw.matchAll(block)) hit = normalize(m[1]);
  return hit ? { 结论: hit, 通过: hit === '通过' } : null;
}

function extractClaudeSessionId(raw) {
  let id = null;
  for (const line of String(raw || '').split(/\r?\n/)) {
    try {
      const e = JSON.parse(line);
      const candidate = e.session_id || (e.message && e.message.session_id);
      if (typeof candidate === 'string' && candidate.trim()) id = candidate.trim();
    } catch { /* 非 JSON 行不是 stream 会话元数据 */ }
  }
  return id;
}

function settleClose(kind, code, out, errout, ticketId, finishOk, failLocal, opts = {}) {
  const text = String(out).trim();
  if (code !== 0) {
    // 失败原因优先 stderr，空则兜底 stdout 尾部——claude CLI 的 "API Error: ..." 打在 stdout，
    // 只看 stderr 会落库成空白的「CLI 退出码 1：」（另会话实测）
    const src = String(errout).trim() || text;
    failLocal(`CLI 退出码 ${code}：${src.split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 150)}`);
    return;
  }
  if (!text) {
    failLocal('CLI 退出码 0 但输出为空——空输出不作数（判官不盖章 / 执行不占位），按执行失败分诊');
    return;
  }
  if (kind === '代核' && /结论[:：]\s*不过/.test(text)
    && text.replace(/结论[:：]\s*不过/g, '').replace(/[\s#\-—·]/g, '').length < 20) {
    failLocal('代核光板结论（去掉结论行后无实质理由）——摆烂不是裁决，按判官失败重试');
    return;
  }
  const tail = text.slice(-8000);
  if (kind === '初检') { // H67：初检结论必须是机器可读 JSON，解析失败按判官失败重试
    let v = null;
    try { v = JSON.parse((text.match(/```json\s*([\s\S]*?)```/) || [])[1]); } catch { /* 下方兜底 */ }
    if (!v || !['过', '不过'].includes(v.初检)) { failLocal('初检输出不可解析（需 ```json {"初检":"过|不过","缺项":[]}```）——按判官失败重试'); return; }
    return finishOk(JSON.stringify(v), v.初检 === '过');
  }
  // 代核结论机器可读行：找不到"结论：通过"一律按不过处理（保守，不误自动完成）
  if (kind === '代核') return finishOk(tail, /结论[:：]\s*通过/.test(tail));
  if (kind === '质检') {
    const parsed = parseQaConclusion(text);
    if (parsed && parsed.结论 === '待人工判') {
      if (typeof opts.待人工判 === 'function') return opts.待人工判('质检报告明确标为待人工判', text);
      failLocal('质检报告标为待人工判');
      return;
    }
    if (parsed) return finishOk(tail, parsed.通过);
    // 无标记不再走判官失败重试；同会话只补问一次，仍不可判再停在待人工判。
    if (typeof opts.无结论 === 'function') return opts.无结论('质检报告无可判结论标记', text);
    failLocal('质检报告无可判结论标记');
    return;
  }
  finishOk(tail, true);
}

// ---- 流计量回灌（施工令-047）----
// 口径全抄 robinwang2 2026-08-11「stream 侧计量口径」信，一个字不自创：
//   · 只对 claude 家族成立——usage 字段只存在于 --output-format stream-json 的事件流里；
//     codex 是纯文本流（且本就是订阅池），显式**不计量**：不臆造数字、不落假账行，
//     额度卡上同口径标「不计量池——消耗不入预算账」（同「池衡盲区不编数」纪律）。
//   · 三列分开取值（输入=max、缓存=max、输出=Σ），合计不含缓存——这两条都在 budget.usageOf 里，
//     此处只负责喂流与落账，绝不在 runner 里重写一份口径（两份口径必然飘）。
// 三个坑（信 §四）逐条对应：
//   坑一 原始流是内部字段，绝不落账本：本函数只把三个数展开进 记()，流文本一个字节都不经手账本；
//   坑二 干跑/零消耗不记：没花钱就别记，否则污染用量窗口；
//   坑三 记账失败不抛、不阻断交单：本函数**永不抛**——保险丝坏了不该顺带炸掉产线。
// 返回 { 记, 因?, 用量?, 账? } 供测试与调用方判读；调用方不必 try（本函数自己包死）。
function 计量回灌(root, o = {}, bd) {
  const 池 = o.池 || '';
  const 单 = o.单 || null;
  try {
    if (!o.流式) return { 记: false, 因: `${池 || '未知池'} 非 stream-json 流——不计量池，消耗不入预算账` };
    if (池 === 'codex') return { 记: false, 因: 'codex 订阅池——不计量池，消耗不入预算账' };
    const b = bd || require('./budget');
    const u = b.usageOf(o.流 || '');
    if (!u.输入 && !u.输出) return { 记: false, 因: '零消耗（流里没有 usage）——干跑不记账', 用量: u };
    const 账 = b.记(root, { 池, 单, 输入: u.输入, 缓存: u.缓存, 输出: u.输出 });
    if (!账) return { 记: false, 因: '记账未落（预算闸空实现或写盘失败）——不阻断交单', 用量: u };
    try {
      journal.append(root, `流计量回灌 ${单}（${池}）：输入 ${u.输入} · 缓存 ${u.缓存} · 输出 ${u.输出}`
        + `（合计 ${u.输入 + u.输出}，缓存不计入合计）`);
    } catch { /* 流水写不进不影响账已落 */ }
    return { 记: true, 用量: u, 账 };
  } catch (e) {
    const why = String((e && e.message) || e).slice(0, 120);
    try { journal.append(root, `流计量回灌失败 ${单}（${池}）：${why}——记账失败不阻断交单`); } catch { /* 尽力 */ }
    return { 记: false, 因: '记账异常：' + why };
  }
}

// ---- 执行一份工作（在途执行 / 质检复核）。opts.durMs=0 供测试同步完成；opts.failWith 注入失败 ----
async function startWork(root, cfg, t, agentId, kind, opts = {}) {
  if (!agentId || running.has(agentId) || busyTickets().has(t.id)) return false;
  const rc = cfg.执行器 || {};
  const entry = { id: t.id, kind, startedAt: opts.nowIso || new Date().toISOString(), 池: kind === '执行' ? (t.fm.执行池 || null) : 'claude', runId: randomUUID() };
  running.set(agentId, entry);
  let qa补问次数 = 0;
  let cliEnv = null;
  const 置待人工判 = (why, report) => {
    running.delete(agentId);
    const cur = store.find(root, t.id);
    if (!cur || cur.state !== '初检') return;
    const now = new Date().toISOString();
    const r = store.move(root, t.id, '初检', '待处理', (fm) => {
      fm.质检结论 = '待人工判';
      fm.待人工判 = { 原因: String(why).slice(0, 160), 补问次数: qa补问次数, 时间: now };
      delete fm.质检失败次数;
    }, now);
    if (!r.ok) return;
    const receipt = path.join(root, '回执', `${t.id}.md`);
    try { fs.appendFileSync(receipt, `\n\n## 质检（待人工判）\n${String(report || why).slice(0, 6000)}\n`, 'utf8'); } catch { /* 回执保全失败不倒人工挂起 */ }
    journal.append(root, `质检待人工判 ${t.id}（${String(why).slice(0, 100)}；同会话补问 ${qa补问次数}/${QA_SAME_SESSION_FOLLOW_UP_LIMIT}）——不重派`);
    try { inbox.post(root, '急', '质检待人工判', `${t.id}：${String(why).slice(0, 120)}`, { 单号: t.id }); } catch { /* 提醒失败不回退状态 */ }
  };
  const 同会话补问 = (sessionId, why, firstReport) => {
    if (qa补问次数 >= QA_SAME_SESSION_FOLLOW_UP_LIMIT || !sessionId || !cliEnv) {
      置待人工判(sessionId ? why : `${why}（原始事件流缺 session_id，无法同会话补问）`, firstReport);
      return;
    }
    qa补问次数++;
    store.update(root, t.id, (fm) => { fm.质检补问次数 = qa补问次数; });
    journal.append(root, `质检同会话补问 ${t.id} 第 ${qa补问次数}/${QA_SAME_SESSION_FOLLOW_UP_LIMIT} 次（${String(why).slice(0, 80)}）`);
    let follow;
    try {
      // --resume 带首轮 stream-json 的 session_id，补问仍在原质检会话内，不另派整轮 QA。
      follow = (opts.spawn || spawn)(cmd, [...args, '--resume', sessionId], { cwd: proj.path, env: cliEnv, windowsHide: true, shell: cmd.endsWith('.cmd'), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { 置待人工判('同会话补问启动失败：' + e.message, firstReport); return; }
    entry.child = follow;
    let out2 = '', err2 = '';
    const timer = setTimeout(() => {
      try { spawn('taskkill', ['/pid', String(follow.pid), '/T', '/F'], { windowsHide: true }); } catch { /* 尽力 */ }
      置待人工判('同会话补问超时', firstReport);
    }, timeoutMs);
    if (timer.unref) timer.unref();
    follow.stdout.on('data', (d) => { out2 += d; if (out2.length > 800000) out2 = out2.slice(-400000); });
    follow.stderr.on('data', (d) => { err2 += d; if (err2.length > 20000) err2 = err2.slice(-10000); });
    follow.on('error', (e) => { clearTimeout(timer); 置待人工判('同会话补问 CLI 错误：' + e.message, firstReport); });
    follow.on('close', (code) => {
      clearTimeout(timer);
      if (!running.has(agentId)) return;
      const text = stream ? extractClaudeText(out2) : out2;
      if (code !== 0 || !String(text).trim()) {
        const tail = String(err2).trim() || String(text).trim() || `退出码 ${code}`;
        置待人工判(`同会话补问未产出结论：${tail.slice(0, 120)}`, firstReport);
        return;
      }
      计量回灌(root, { 池: cliPool, 单: t.id, 流: out2, 流式: !!stream });
      const parsed = parseQaConclusion(text);
      if (!parsed || parsed.结论 === '待人工判') {
        置待人工判(parsed ? '同会话补问明确标为待人工判' : '同会话补问后仍无可判结论标记', text);
        return;
      }
      finishOk(String(text).slice(-8000), parsed.通过);
    });
    const prompt2 = '你刚才的质检报告没有机器可判结论。不要重写报告；请只在本次会话最后单独一行输出 `【质检结论】通过`、`【质检结论】不通过` 或 `【质检结论】待人工判`。';
    try { follow.stdin.write(prompt2, 'utf8'); follow.stdin.end(); } catch { 置待人工判('同会话补问写入失败', firstReport); }
  };
  const finishOk = (note, verdict) => {
    try { finishOkInner(note, verdict); } catch (e) {
      // 定时器回调里的异常会成为主进程未捕获异常 → 整个 app 弹窗崩掉（0.9.1 YAML 实测）。
      // 单张单的收尾失败只准伤自己：记账 + 尝试入执行失败，绝不外抛。
      running.delete(agentId);
      journal.append(root, `完工收尾异常 ${t.id}：${String(e.message).slice(0, 100)}——单未流转，待分诊`);
      try { lifecycle.执行失败(root, t.id, '完工收尾异常：' + String(e.message).slice(0, 80)); } catch { /* 尽力 */ }
    }
  };
  const finishOkInner = (note, verdict) => {
    running.delete(agentId);
    try { require('./quota').eagerRefresh(cfg); } catch { /* 急刷失败不影响交单 */ } // 完工=额度变化时刻，作废节流窗口让读数跟上
    const cur = store.find(root, t.id);
    if (kind === '质检') {
      if (!cur || cur.state !== '初检') return; // H108：质检会话跑在「初检」目录（原 质检 目录改名）
      store.update(root, t.id, (fm) => { fm.质检人 = agentId; delete fm.质检失败次数; });
      { // H69 线②：质检席质量分
        const mq = String(note).match(/质量分[:：]\s*([1-5])/);
        if (mq) { try { require('./pm/ledger').score(root, { 线: '审检评执行', 席: '质检', 单: t.id, 职能: t.fm.职能, 池: t.fm.执行池 || 'claude', 分: Number(mq[1]) }); } catch { /* 不阻塞 */ } }
      }
      const r = lifecycle.QA裁定(root, cfg, t.id, verdict); // 曾硬编码 true——QA 写"不过"也放行，自修/待定夺全成死代码（TK-31/33 空壳两连过的真凶）
      if (r.ok) journal.append(root, `质检执行完成 ${t.id}（${agentId} · ${note}）`);
    } else if (kind === '代裁') {
      // D43③ / H108：仲裁会话跑在「仲裁」目录（原 待定夺）。解析裁判档结论：
      // 给方向→仲裁定「给方向」回在途（方向文本进正文，主办重执行能读到）；
      // 其余（上呈/解析不出）→ 仲裁定「上呈」送 待处理（总监分诊台）——保守缺省，绝不误放行。
      // 仲裁定 由 lifecycle（A 组）提供：给方向清自修计数+方向入正文，上呈写上呈原因。
      if (!cur || cur.state !== '仲裁') return;
      const text = String(note);
      const rp = path.join(root, '回执', `${t.id}.md`);
      try { fs.appendFileSync(rp, `\n\n## 仲裁\n${text.slice(0, 6000)}\n`, 'utf8'); } catch { /* 无回执不阻塞 */ }
      const give = /结论[:：]\s*给方向/.test(text);
      const dir = give ? (text.match(/方向[:：]\s*([\s\S]{1,2000})/) || [])[1] : null;
      store.update(root, t.id, (fm) => { fm.代裁 = { 结论: give ? '给方向' : '上呈', 时间: new Date().toISOString() }; delete fm.代裁失败次数; });
      if (give && dir) {
        // 给方向 = 仲裁定「打回」回在途重做。方向文本先入正文（主办重执行能读到）；
        // 自修次数清零同 TK-97 案口径：回炉是裁决给的新起点，不清则回来一次不过即再三振，死循环。
        store.update(root, t.id, (fm, t2) => { fm.自修次数 = 0; return { body: (t2.body || '') + `\n\n## 定夺方向（代裁·裁判档 · ${new Date().toISOString().slice(0, 10)}）\n${dir.trim().slice(0, 2000)}\n` }; });
        const r = lifecycle.仲裁定(root, t.id, '打回', '给方向（方向已写入正文）');
        if (r.ok) journal.append(root, `仲裁 ${t.id} → 给方向回在途（D43③，方向已写入正文）`);
      } else {
        const r = lifecycle.仲裁定(root, t.id, '上呈', give ? '方向缺失' : '裁判判断需制作人裁量');
        if (r.ok) journal.append(root, `仲裁 ${t.id} → 上呈待处理（${give ? '方向缺失' : '裁判判断需制作人裁量'}，H108）`);
      }
    } else if (kind === '初检') { // H67 两检制第一道：格式与规范（H108 起随深检同驻「核查」目录）
      if (!cur || cur.state !== '核查') return;
      let v = {}; try { v = JSON.parse(note); } catch { /* finishOk 已保证可解析 */ }
      const 缺 = (v.缺项 || []).slice(0, 10);
      // 判源（施工令-031）：机判 = 进程内 precheck.js；否则是二线 LLM 的模型名。
      // 流水/回执文案照旧，只在括号里标注判源——口径不变，来源可溯。
      const 判源 = v.判源 || (cfg.执行器 && cfg.执行器.两检 && cfg.执行器.两检.模型) || 'deepseek-v4-flash';
      const 机判 = 判源 === '机判';
      const rp0 = path.join(root, '回执', `${t.id}.md`);
      try {
        fs.appendFileSync(rp0, `\n\n## 两检初检（${判源}）\n结论：${v.初检}${缺.length ? '\n缺项：' + 缺.join('；') : ''}`
          + `${v.备注 ? '\n备注：\n' + v.备注 : ''}\n`, 'utf8');
      } catch { /* 不阻塞 */ }
      store.update(root, t.id, (fm) => { fm.初检 = { 结论: v.初检, ...(v.备注 ? { 备注: v.备注 } : {}), ...(缺.length ? { 缺项: 缺 } : {}), 判源, 时间: new Date().toISOString() }; delete fm.初检失败次数; });
      if (verdict) journal.append(root, `两检初检过 ${t.id}${机判 ? '（机判）' : ''} → 进深检（opus 内容质量）`);
      else {
        journal.append(root, `两检初检不过 ${t.id}${机判 ? '（机判）' : ''}：${缺.join('；').slice(0, 120)}——留核查（返修或人工裁），未烧深检`);
        inbox.post(root, '常', '初检不过', `${t.id} 格式规范缺项：${缺.join('；').slice(0, 150)}`, { 单号: t.id });
      }
    } else if (kind === '代核') {
      if (!cur || cur.state !== '核查') return; // H108：核查会话跑在「核查」目录（原 待验收）
      // 核验报告追加进回执；通过→核查过落「完成」（在途出口驻留位，等专项级验收），
      // 不过→送仲裁（H108 审检链：核查争议由仲裁席裁，判官全为 AI、项管全权）
      const rp = path.join(root, '回执', `${t.id}.md`);
      try { fs.appendFileSync(rp, `\n\n## 核查\n${String(note).slice(0, 6000)}\n`, 'utf8'); } catch { /* 无回执文件也不阻塞 */ }
      store.update(root, t.id, (fm) => { fm.核查 = fm.代核 = { 结论: verdict ? '通过' : '不过', 时间: new Date().toISOString() }; delete fm.代核失败次数; }); // H68 双写：新章 核查 + 旧章 代核
      { // H69 线②：核查评执行质量（质量分：N 机读行）
        const mq = String(note).match(/质量分[:：]\s*([1-5])/);
        if (mq) { try { require('./pm/ledger').score(root, { 线: '审检评执行', 席: '核查', 单: t.id, 职能: t.fm.职能, 池: t.fm.执行池 || 'claude', 模型: model || '', 分: Number(mq[1]) }); } catch { /* 不阻塞 */ } }
      }
      if (verdict) {
        // 施工令-032②（H97）引擎门禁停闸：验收标准点名 enginectl/unity-test 这类引擎实测的单，
        // 判官读的只是回执文字——引擎到底跑没跑它看不出来。核查过了也只盖候检印停在核查目录，
        // 等总监确认实测证据真入回执后走「实证放行」。非门禁单一个字不变，照旧直落完成。
        const 门 = lifecycle.引擎门禁命中(cfg, cur);
        if (门) lifecycle.候引擎实证(root, t.id, 门, '核查');
        else {
          const r = lifecycle.核查过(root, t.id); // H108 推进边（A 组 lifecycle 提供）：核查→完成
          if (r.ok) journal.append(root, `核查通过 ${t.id} → 完成（Claude 代劳，D11/D34/H108 出口驻留位候专项验收）`);
        }
      } else {
        const r = lifecycle.送仲裁(root, t.id, '核查不过'); // H108 推进边（A 组 lifecycle 提供）：核查→仲裁
        if (r.ok) journal.append(root, `核查不过 ${t.id} → 送仲裁（核验报告已入回执，H108 审检链）`);
        else journal.append(root, `核查不过 ${t.id} 送仲裁失败：${r.error}——孤儿补链下拍自愈（2026-08-26 案：这条静默曾造出 12h 滞留）`);
        // H65 同活同号語义保留：仲裁裁「上呈」后落 待处理，制作人点「返修」同号改写
      }
    } else {
      if (!cur || cur.state !== '在途') return; // 期间被收回/废弃，不硬交
      if (/##\s*评估回呈/.test(String(note))) { // H61：领单评估判做不了——不算失败，回待派候项管裁决；三轮上呈总监
        const rp0 = path.join(root, '回执', `${t.id}.md`);
        try { fs.writeFileSync(rp0, String(note), 'utf8'); } catch { /* 尽力 */ }
        const 轮 = (cur.fm.评估回呈轮 || 0) + 1;
        // 施工令-012：回呈原因同样落库（优化-D 通则）——本轮回队，若后续再走三振/失败分诊进待处理，
        // 那两处会用各自的原因覆盖；在此之前详情页读到的就是这条真原因，不用 grep 流水猜。
        // H108：原 在途→池 改 在途→待派；撤放行=原地 fm.放行=false（放行已降为标记，项管重放行才可再派）。
        store.move(root, t.id, '在途', '待派', (fm) => {
          delete fm.主办; delete fm.领单时间; delete fm.执行池; fm.放行 = false; fm.评估回呈轮 = 轮; // 运行章随会话销毁（2026-08-26 TK-201 案）
          fm.上呈原因 = `评估回呈第 ${轮} 轮：执行会话领单评估判定做不了，回待派候项管裁决（H61）`;
        }, new Date().toISOString());
        journal.append(root, `评估回呈 ${t.id}（第 ${轮} 轮）：执行会话判定做不了，回待派候项管裁决（H61）`);
        try { require('./pm/ledger').event(root, '评估回呈', { 单: t.id, 轮 }); } catch { /* 不阻塞 */ }
        if (轮 >= 3) {
          inbox.post(root, '急', '三轮裁决不过', `${t.id} 评估回呈已 ${轮} 轮，按 H61 上呈总监查单`, { 单号: t.id });
        } else {
          try { require('./pm/brain').adjudicateReferral(root, cfg, t.id, () => { /* 结果走台账/信道 */ }); } catch (e) { journal.append(root, `裁决拉起失败 ${t.id}：${String(e.message).slice(0, 60)}`); }
        }
        return;
      }
      const r = lifecycle.交产出(root, t.id, note);
      if (r.ok) {
        journal.append(root, `执行完成 ${t.id}（${agentId} · ${kind}）`);
        // H69 线①：执行编制评拆单质量（post-work 工单评分节）
        const m0 = String(note).match(/##\s*工单评分[^\n]*\n+[\s\S]{0,200}?([1-5])\s*分/);
        if (m0) { try { require('./pm/ledger').score(root, { 线: '执行评拆单', 单: t.id, 切单人: t.fm.切单人 || '项管', 分: Number(m0[1]) }); } catch { /* 不阻塞 */ } }
      }
    }
  };
  const failLocal = (why) => {
    try { failLocalInner(why); } catch (e) {
      running.delete(agentId);
      try { journal.append(root, `失败入位异常 ${t.id}：${String(e.message).slice(0, 100)}`); } catch { /* 尽力 */ }
    }
  };
  const failLocalInner = (why) => { // D31：失败入位为纯本地操作，任何网络状况下都能落位
    running.delete(agentId);
    const cap = rc.判官重试上限 ?? 3; // 判官类（质检/代核/代裁）失败重试封顶，可配
    if (kind === '代核' || kind === '代裁' || kind === '初检') {
      // 判官失败不动单不盖章（TK-21：空输出/网络抖动都走这里）：计失败次数，
      // 封顶前 tick 下轮自动重试，封顶后停拉等人工（清计数字段即可重启重审）
      const 场 = kind === '代裁' ? '仲裁' : '核查'; // H108：代裁驻仲裁目录，初检/代核驻核查目录
      const field = kind === '代核' ? '代核失败次数' : kind === '初检' ? '初检失败次数' : '代裁失败次数';
      const cur0 = store.find(root, t.id);
      if (cur0 && cur0.state === 场) {
        const n = (Number(cur0.fm[field]) || 0) + 1;
        store.update(root, t.id, (fm) => { fm[field] = n; });
        journal.append(root, `委托${kind}失败 ${t.id} 第 ${n}/${cap} 次（${String(why).slice(0, 80)}）——单留${场}${n >= cap ? `，重试封顶等你裁（清 ${field} 可重审）` : '，下轮重试'}`);
      } else {
        journal.append(root, `委托${kind}失败 ${t.id}（${String(why).slice(0, 80)}）——单已不在${场}，不计`);
      }
      return;
    }
    if (kind === '质检') {
      // 判官阶段失败（多为网络抖动）不打整单：留在初检原地重试，封顶再入执行失败（→待处理）
      // ——整单失败后重投会连"执行"一起重跑，白烧一遍额度
      const cur0 = store.find(root, t.id);
      if (!cur0 || cur0.state !== '初检') return; // H108：质检会话驻初检目录
      const n = (Number(cur0.fm.质检失败次数) || 0) + 1;
      if (n < cap) {
        store.update(root, t.id, (fm) => { fm.质检失败次数 = n; });
        journal.append(root, `质检执行失败 ${t.id} 第 ${n}/${cap} 次（${String(why).slice(0, 60)}）——留初检下轮重试`);
        return;
      }
      journal.append(root, `质检执行连败 ${cap} 次 ${t.id} → 执行失败分诊`);
    }
    const cur = store.find(root, t.id);
    if (cur && (cur.state === '在途' || cur.state === '初检')) lifecycle.执行失败(root, t.id, why); // H108：入位落 待处理
  };

  if (opts.failWith) { failLocal(opts.failWith); return true; } // 测试注入

  // ---- 初检机判（施工令-031 / H96）：schema 校验是纯代码的活，进程内一次函数调用判完 ----
  // 零 token、零会话、结果可复现。放在 isSim 之前——机判本来就不烧额度，测试与生产同一条路，
  // 免得又出「测试走假路、生产走真路」的两套行为。二线LLM 开关打开才回落到下方 flash CLI。
  if (kind === '初检' && !require('./precheck').用二线LLM(cfg)) {
    let v;
    try {
      v = require('./precheck').run(root, t, cfg);
    } catch (e) {
      // 机判自己炸了不能盖章（同判官失败口径：计数重试，不动单）
      failLocal('机判初检异常：' + String(e.message).slice(0, 100));
      return true;
    }
    finishOk(JSON.stringify({ 初检: v.初检, 缺项: v.缺项, 备注: v.备注, 判源: v.判源 }), v.初检 === '过');
    return true;
  }

  if (isSim(opts)) { // 测试内部钩子：模拟收线，零 CLI 调用。
    // H108 追加 simVerdict/simNote：判官链目录流转判据要能驱动「不过/上呈」分支
    // （三振 初检→待处理、核查不过→送仲裁、仲裁上呈→待处理），缺省行为与旧样逐位一致（通过/给方向）。
    const durMs = opts.durMs;
    const sec = Math.round(durMs / 1000);
    const receipt = `# 完工报告 ${t.id}（模拟）\n工单编号：${t.id}\n## 做了什么\n模拟${kind}（测试钩子，零额度）\n## QA 章节\n${kind === '质检' ? '模拟复核通过' : '（模拟占位）'}\n## 实际消耗\n模拟 ${sec}s · 0 token\n## 异议\n无\n`;
    const fin = () => finishOk(opts.simNote != null ? String(opts.simNote)
      : kind === '质检' ? `模拟复核 ${sec}s`
      : kind === '代核' ? `（模拟）逐条对照验收标准：全部通过\n结论：通过`
      : kind === '代裁' ? `（模拟）失败原因明确，可修复。\n结论：给方向\n方向：按验收标准逐条补齐缺失项（模拟演示）`
      : receipt, opts.simVerdict !== false);
    if (durMs <= 0) fin(); else { entry.timer = setTimeout(fin, durMs); if (entry.timer.unref) entry.timer.unref(); }
    return true;
  }

  // ---- 实弹（D32）：真调无头 CLI。H81 起「运行」即实弹，唯一停手闸是暂停总闸 ----
  // 解析顺序（施工令-055 起）：池/模型/凭据 → OAuth 预检 → 项目定位。凭据死了就是拉不起来，
  // 项目注册得再对也没用；把预检排在项目定位之前，是让「不该开的会话」在最早的一步就掉头。
  // H67 两检制：初检走便宜池（默认 deepseek-flash），只核格式与规范；深检（代核）保持 opus
  const 两检cfg = (cfg.执行器 || {}).两检 || {};
  const poolName = kind === '初检' ? (两检cfg.池 || 'deepseek') : (t.fm.执行池 || 'claude');
  const 档 = roster.modelFor(cfg, t.fm.职能, poolName); // H85 补章：档挂在 职能×池 上，不再按人头查
  const model = kind === '初检' ? (两检cfg.模型 || 'deepseek-v4-flash') : pickModel(cfg, kind, 档, poolName, t.fm.职能);
  const compat = (kind === '执行' || kind === '初检') ? 凭据Of(root, cfg, poolName) : null;
  // 响亮拒派（2026-08-08 实测）：给 codex 池配了托管 key / 内联兼容段，说明制作人**以为**
  // 它会按量跑。codex 会忽略注入照跑订阅——静默跑错池比拒派危险得多，这里直接失败。
  if (poolName === 'codex' && (kind === '执行' || kind === '初检')) {
    const 有托管 = (() => { try { return require('./creds').has(root, 'codex'); } catch { return false; } })();
    const 有内联 = !!((cfg.执行池 || {}).codex || {}).兼容;
    if (有托管 || 有内联) {
      failLocal('codex 池配了 key 但 codex CLI 无视 ANTHROPIC_* 环境变量（2026-08-08 实测）——'
        + '照跑会静默落在订阅登录态上且预算闸失效。请改用 claude 家族的按量池，或撤掉 codex 的托管凭据');
      return true;
    }
  }
  // 质检/代核/代裁实际走 claude，流水如实记；初检（二线 LLM 档）走的是 两检.池（默认 deepseek），
  // 旧样把它也算成 claude——流水失实事小，账记错池事大（施工令-047 起这个名字直接当记账的池名用，
  // 记到 claude 头上等于拿订阅池的名义记按量池的账，判超会掐错池）。
  const cliPool = (kind === '执行' || kind === '初检') ? poolName : 'claude';
  // ---- OAuth 续命预检（施工令-055 要件 2）----
  // 案源 2026-08-12 22:50：token 到点集体 401，判官席空烧三振、TK-163/164 连坐、人工修复 25 分钟。
  // 401 不是「跑失败」而是「压根没资格跑」：撞上去会被 failLocal 计进 判官重试上限，三次即钉死等人工。
  // 只拦真吃 OAuth 订阅登录态的会话（claude 池且没走托管 key）；codex/deepseek/*-key 池另有凭据，不受影响。
  // 拒派＝不开会话、不计失败次数、不动单——返回 false 让本轮跳过，寿命续上后下一拍照常拉起。
  // 留痕节流（施工令-057 要件 1，案源 08-13 16:43-16:44 三连同文）：拒派是个**持续状态**，
  // 而派发拍是逐分钟的——同单同因逐拍刷 journal 只会把真事件盖掉。改为只在状态变化时落痕。
  {
    const oauth = require('./oauth');
    const 预 = oauth.派发预检(root, cfg, { ...(opts.oauth || {}), 池: cliPool, 用托管: !!compat });
    if (!预.放行) {
      running.delete(agentId);
      const 痕 = oauth.拒派留痕(root, t.id, 预.态);
      if (痕.记) {
        journal.append(root, `拒派 ${t.id}（${agentId} · ${kind} · ${cliPool}）：${预.因}${痕.换因 ? '（拒因已变，重新计数）' : ''}——同因后续拒派静默计数，恢复时汇总`);
        try { require('./pm/ledger').event(root, 'OAuth拒派', { 单: t.id, 席: agentId, kind, 池: cliPool, 态: 预.态, 剩余分: 预.剩余分 }); } catch { /* 记账失败不阻塞拒派 */ }
      }
      return false;
    }
    // 恢复条：这张单之前被拦过，现在过了——把「拦了多少发」一次性交代清楚，静默期才有账可对。
    const 复 = oauth.拒派恢复(root, t.id);
    if (复.记) {
      journal.append(root, `恢复派发 ${t.id}（${agentId} · ${kind} · ${cliPool}）：${预.因}——期间拒派 ${复.次数} 次`);
      try { require('./pm/ledger').event(root, 'OAuth恢复派发', { 单: t.id, 席: agentId, kind, 池: cliPool, 态: 预.态, 剩余分: 预.剩余分, 期间拒派: 复.次数 }); } catch { /* 记账失败不阻塞派发 */ }
    }
  }
  const proj = projectPath(cfg, t);
  if (!proj) { failLocal('项目未注册或路径不存在（config.项目）'); return true; }
  const { cmd, args, stream } = resolveCli(cliPool, compat ? (kind === '初检' ? model : (compat.模型 || model)) : model, (cfg.执行器 || {}).放行工具); // 质检/代核/代裁走 claude
  const receiptPath = path.join(root, '回执', `${t.id}.md`);
  const prompt = kind === '质检' ? buildQaPrompt(root, t, proj, receiptPath)
    : kind === '代核' ? buildAuditPrompt(root, t, proj, receiptPath)
    : kind === '代裁' ? buildArbPrompt(root, t, proj, receiptPath)
    : kind === '初检' ? buildPrecheckPrompt(root, t, receiptPath)
    : buildPrompt(root, t, proj);
  let child;
  try {
    const env = proxyEnv(cfg);
    if (compat) {
      // base 可缺省（2026-08-08 凭据托管）：原生厂商的 *-key 池就用官方默认端点，
      // 只有第三方兼容端点（deepseek 之类）才需要改 BASE_URL。
      if (compat.base) env.ANTHROPIC_BASE_URL = compat.base;
      env.ANTHROPIC_AUTH_TOKEN = compat.key; delete env.ANTHROPIC_API_KEY;
      // 双认证冲突（实测挂起 50s+）：订阅 OAuth 登录态与 env 令牌并存时 CLI 静默等待——
      // 带 key 的池一律用独立配置目录隔离登录态。
      env.CLAUDE_CONFIG_DIR = path.join(root, '兼容池配置', poolName);
      try { fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true }); } catch { /* 已存在 */ }
      // 剥代理只对第三方端点（国内直连更快更稳）；官方端点该走代理还得走代理，
      // 一刀切剥掉会让需要代理的机器上 *-key 池必死（2026-08-08 死代理案的反向教训）。
      if (compat.base) { delete env.HTTPS_PROXY; delete env.HTTP_PROXY; delete env.https_proxy; delete env.http_proxy; }
    }
    // opts.spawn 仅供离线测试把假的 CLI 流喂进**同一条**收线逻辑；生产调用从不传，仍是原 spawn。
    cliEnv = env;
    child = (opts.spawn || spawn)(cmd, args, { cwd: proj.path, env, windowsHide: true, shell: cmd.endsWith('.cmd'), stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { failLocal('CLI 启动失败：' + e.message); return true; }
  entry.child = child;
  // 凭据来源入流水（施工令-029）：迁移后要看得见「这一发到底是从托管取的还是从 config 兜底取的」。
  // 只记来源三个字，key/指纹一律不进流水。
  journal.append(root, `实弹开工 ${t.id}（${agentId} · ${kind} · ${cliPool}${model ? '/' + model : ''} → ${proj.name} · 超时闸 ${rc.执行超时分钟 ?? 30}m 派发时快照${compat ? ' · 凭据' + compat.来源 : ''}）`); // 夜班推演 #3：热改超时不作用于在跑会话，快照值写明防误判
  let out = '', errout = '', 计量流 = '', 活片 = '', 报告流 = '';
  const 分拣 = stream ? 流分拣器() : null;
  // 只接已经在此处消费的 stream-json stdout；存档模块不能另开 reader 或改动本回调顺序。
  const 存档 = stream ? eventarchive.打开(root, cfg, { 单号: t && t.id, runId: entry.runId }) : null;
  let 存档已收尾 = false;
  const 收尾存档 = () => {
    if (!存档 || 存档已收尾) return;
    存档已收尾 = true;
    存档.收尾();
  };
  child.stdout.on('data', (d) => {
    entry.收字节 = (entry.收字节 || 0) + d.length; // 活性字节（施工令-010）：零输出看门狗的判据 = stdout∪stderr
    if (存档) 存档.写(d); // 原始字节逐行落盘；失败由模块吞掉并仅留一行告警
    // 活尾巴：stream-json 走行分拣（整块文本 + 增量片），纯文本流走 tailFrom（stdout 优先、stderr 兜底）
    if (!分拣) {
      out += d; if (out.length > 800000) out = out.slice(-400000);
      Object.assign(entry, tailFrom(out, errout));
      return;
    }
    const r = 分拣.收(d);
    out += r.主; if (out.length > 800000) out = out.slice(-400000);
    // 计量细流（施工令-047）：只留含 usage 的整行。out 那条 800KB 上限截的是头，
    // 而 usage 行一旦被截掉就永远补不回来——账不能跟着显示缓冲一起丢。
    if (r.计量) { 计量流 += r.计量; if (计量流.length > 400000) 计量流 = 计量流.slice(-200000); }
    // 报告细流（2026-08-26 截头案真根因，同 计量 的理由）：out 截的是头，而报告开头
    // （做了什么/自测结果）一旦被截就永远补不回来。只存 assistant 正文，同上限装得下整份。
    if (r.报告) { 报告流 += r.报告; if (报告流.length > 400000) 报告流 = 报告流.slice(-200000); }
    // 一条消息吐完（assistant 整行到达）就清增量缓冲：那段字已经以整块形式进 out 了，再拼就是重影
    if (r.主.includes('"type":"assistant"')) 活片 = '';
    if (r.增.length) 活片 = (活片 + r.增.join('')).slice(-400);
    // 展开区「最近 3 行」（施工令-004）：tail3 仍是整块口径，tail 语义原样不动（H63 软超时判据依赖它）
    const s = 流尾(out, 活片);
    if (s.tail) { entry.tail = s.tail; if (s.tail3) entry.tail3 = s.tail3; }
  });
  child.stderr.on('data', (d) => { errout += d; if (errout.length > 20000) errout = errout.slice(-10000);
    entry.收字节 = (entry.收字节 || 0) + d.length;
    // codex 的过程行只在这条路上——不在 stderr 也刷一次尾巴，tail 就永远是空的（施工令-010 第 5 条）
    if (!stream) Object.assign(entry, tailFrom(out, errout));
  });
  // H63 软超时（2026-08-05 制作人拍板：不到点即杀，盯进程判余量）：闸到点先验尸——
  // 尾巴仍在动或回执已落盘 → 续 10 分钟再查；进展停滞才处决。硬顶=闸×3（跑飞保险）。
  const timeoutMs = (rc.执行超时分钟 ?? 30) * 60000;
  const hardMs = timeoutMs * 3;
  const spawnAt = Date.now();
  let lastTailSnap = null;
  let killer;
  const checkDeadline = () => {
    if (!running.has(agentId)) return; // 已收场
    const elapsed = Date.now() - spawnAt;
    const rp0 = path.join(root, '回执', `${t.id}.md`);
    const receiptFresh = (() => { try { return fs.statSync(rp0).mtimeMs > spawnAt; } catch { return false; } })();
    const tailNow = entry.tail || '';
    const wasFirst = lastTailSnap === null; // 首拍无对照快照：给一次续命建立基线
    const progressing = !wasFirst && tailNow !== lastTailSnap;
    lastTailSnap = tailNow;
    if (elapsed < hardMs && (progressing || receiptFresh || wasFirst)) {
      journal.append(root, `宽限 ${t.id}：闸到点但${receiptFresh ? '回执已在写' : '仍在进展'}（H63 验尸续命），续 10 分钟（已跑 ${Math.round(elapsed / 60000)} 分钟）`);
      try { require('./pm/ledger').event(root, '宽限', { 单: t.id, 已跑分: Math.round(elapsed / 60000) }); } catch { /* 不阻塞 */ }
      killer = setTimeout(checkDeadline, 10 * 60000);
      if (killer.unref) killer.unref();
      return;
    }
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* 尽力 */ }
    failLocal(elapsed >= hardMs
      ? `执行超硬顶 ${Math.round(hardMs / 60000)} 分钟，已树杀（H63 天花板）`
      : `执行超时且进展停滞（尾巴 10 分钟未动），已树杀（H63 验尸不过）`);
  };
  killer = setTimeout(checkDeadline, timeoutMs);
  if (killer.unref) killer.unref();
  child.on('error', (e) => { clearTimeout(killer); 收尾存档(); failLocal('CLI 错误：' + e.message); });
  child.on('close', (code) => {
    clearTimeout(killer);
    if (分拣) { const r = 分拣.收尾(); out += r.主; 计量流 += r.计量; if (r.报告) 报告流 += r.报告; } // 末行（常无换行符）也要进账
    收尾存档(); // 清理收尾时把当前 run 显式列为活跃，绝不自删
    if (!running.has(agentId)) return; // 已被超时处理
    // 预算记账（施工令-021 → 047 流计量回灌）：口径与落账全在 计量回灌 里，它永不抛——
    // 交单这条路上不许有第二个可能崩的点（信 §四.3：保险丝坏了不该顺带炸掉产线）。
    计量回灌(root, { 池: cliPool, 单: t.id, 流: 计量流, 流式: !!stream });
    // 报告细流优先（2026-08-26 截头案真根因收口）：out 被 800KB 上限**丢头保尾**且切在
    // 字节中间会腰斩 JSON 行，长会话的报告开头就此蒸发（TK-204 实证）。细流只存 assistant
    // 正文，同上限下装得下整份；细流空（旧版/非流式/解析全败）才回落 out，行为不退化。
    const report = stream ? (报告流.trim() ? 剪闲聊(报告流) : extractClaudeText(out)) : out;
    const sessionId = stream ? extractClaudeSessionId(out) : null;
    settleClose(kind, code, report, errout, t.id, finishOk, failLocal, kind === '质检' ? {
      无结论: (why, text) => 同会话补问(sessionId, why, text),
      待人工判: (why, text) => 置待人工判(why, text),
    } : undefined);
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 事件兜底 */ }
  return true;
}

// 一轮扫描。所有闸都复用既有路径（pool.claim / gates），执行器不自带门。
/* ---- 排期复判触发（H115 增补）：两个触发点＝①有单新落袋（完成/归档 计数涨）②产线空转
   （在途 0 且就绪池空 且 存在未到点排期粒——节拍器把活拦在门外，此刻正该问「排期还准不准」）。
   规则预筛（零 token）命中才起项管小会话；防抖 15 分钟；pmBusy（brain 有活）时让路。 ---- */
let 复判上次 = 0;
let 复判落袋签 = null;
function 排期复判Tick(root, cfg, sim) {
  if (sim) return;
  try {
    const now = Date.now();
    if (now - 复判上次 < 15 * 60000) return;
    if (require('./pm/brain').getWorking()) return;      // 项管手头有活，让路
    const 落袋数 = store.list(root, '完成').length + store.list(root, '归档').length;
    const 在途数 = store.list(root, '在途').length;
    const 签 = String(落袋数);
    const 有新落袋 = 复判落袋签 != null && 签 !== 复判落袋签;
    复判落袋签 = 签;
    let 触因 = null;
    if (有新落袋) 触因 = '有单落袋（完成/归档合计 ' + 落袋数 + '）——校一校后续排期还准不准';
    else if (在途数 === 0) {
      const D = require('./pm/dispatch');
      const 就绪 = D.readySet(root, null);
      if (!就绪.length) {
        const S = require('./pm/schedule');
        const 未到点 = S.现态(root).filter((g) => g.状态 === '已成单' && g.计划开始 &&
          S.计划毫秒(g.计划开始) > now).length;
        if (未到点 > 0) 触因 = '产线空转：在途 0、就绪 0，而 ' + 未到点 + ' 粒排期未到点——排期是否过于保守';
      }
    }
    if (!触因) return;
    复判上次 = now;
    require('./journal').append(root, `排期复判触发（H115）：${触因}`);
    require('./pm/brain').replanReview(root, cfg, 触因, (a) => {
      require('./journal').append(root, `排期复判收官：${a.ok ? a.决定 + '——' + (a.因 || '') : '失败 ' + a.error}`.slice(0, 160));
      try { require('./relay').append(root, '项管', `排期复判（${触因.slice(0, 40)}…）：${a.ok ? a.决定 + '。' + (a.因 || '') + (a.重排结果 ? ' ' + a.重排结果 : '') : '失败：' + a.error}`); } catch { /* 信道不通不阻塞 */ }
    });
  } catch (e) { try { require('./journal').append(root, '排期复判触发异常：' + e.message); } catch { /* 双失稳不再叠 */ } }
}

async function tick(root, cfg, opts = {}) {
  // 人闸升格放在 isOn 早退**之前**（2026-08-21 体检纠正）：
  // 原先放在早退之后，于是「执行器一停，升格就整个停」——而注释写着「人欠的债不因产线停摆而消失」。
  // 注释本身没说谎（本仓「暂停」是专名，指 H81 暂停总闸，它只在领单路径判），
  // 但 isOn 这道早退是另一条依赖，实质缺口成立：产线停着的时候，正是最该有人来看债的时候。
  人闸升格Tick(root, cfg);
  if (!isOn(root)) return { skipped: true, reason: '执行器未运行' };
  const sim = isSim(opts);
  const result = { at: opts.nowIso || new Date().toISOString(), 领单: [], 执行: [], 质检: [], 拒因: [] };
  const agents = roster.agents(cfg).filter((a) => a.上线 !== false); // 拉取制兼容视图（去岗位化后 id 即职能名）

  const st = state.read(root);

  // H49「拉取制退役、派发制立宪」的缺省语义（2026-08-21 对账反转）。
  // 病灶：原写法是 `!!(cfg.执行器 && cfg.执行器.派发制)` —— **缺键即 false**，
  // 于是任何手写的、被裁剪过的、或从旧版本升上来的 config 少这一格，执行链就静默回落到
  // 一条已被决议废止的路，且不报一个字。立宪的东西不该靠「记得手填」。
  // 反转后：缺键＝派发制（立宪态），要回退旧路必须**显式写 false**——退回旧制是需要留下意图的动作。
  // 发行侧两份模板同批补了这一格（lib/setup.js 内置模板 + 套件模板），此处是最后一道兜底。
  const dispatchMode = !(cfg.执行器 && cfg.执行器.派发制 === false);

  // 排期复判触发（H115 增补，2026-08-25 制作人拍板）：单落袋或产线空转时项管判断要不要重排。
  // 规则预筛免 token，命中才起小会话（brain.replanReview → 维持/重排+含已排作业）。防抖 15 分钟。
  排期复判Tick(root, cfg, sim);

  // ① 断点恢复 + 在途执行（待复核单不起工，D36）
  for (const t of store.list(root, '在途')) {
    if (!t.fm.主办 || busyTickets().has(t.id)) continue;
    if (['战役','专项'].includes(t.fm.父单类型) || ['战役','专项'].includes(t.fm.主办)) continue; // H53：父单在途=战役开打的状态章，是组织容器，永不起执行（0.19.1 事故：TK-41 被当断线单续跑）
    if (t.fm.待复核) { result.拒因.push(`${t.id} 待复核未解除，不起执行`); continue; }
    if (t.fm.挂起) { result.拒因.push(`${t.id} 已挂起（制作人原位冻结），不起执行`); continue; } // 施工令-021①：断点续跑这条路是挂起单最容易漏堵的一条
    if (!dispatchMode && !agents.some((a) => a.id === t.fm.主办)) continue; // 拉取制：退役待归者不起新执行；派发制：一次性主办直接续跑
    if (await startWork(root, cfg, t, t.fm.主办, '执行', opts)) result.执行.push(t.id);
  }

  if (dispatchMode) {
    // ②′ 派发制（H49/H108）：就绪盘点 → 护城河/并发闸 → 拉起一次性 agent。
    // 原「池目录归位」迁移环（池→待投）随 H108 退役：池/待投并入 待派，放行是 fm 标记不再是目录跳变，
    // 「撤回放行」= 原地 fm.放行=false（见 评估回呈/收回 路径），存量目录迁移由总控 manifest 一次做完。
    const dispatch = require('./pm/dispatch');
    const pmLedger = require('./pm/ledger');
    if (!st.paused) { // H81：唯一总闸，合上才停派发
      const locks = await require('./gates').allLocks(cfg).catch(() => null);
      const gatesInfo = {};
      if (locks) for (const p of ['codex', 'claude']) gatesInfo[p] = { fivePct: locks[p] && locks[p].fivePct, locked: !!(locks[p] && locks[p].locked) };
      // 预算闸（施工令-021）：按量计费池没有订阅那种用量窗口，额度锁对它恒不生效。
      // 并进 gatesInfo 而不是改 poolFrozen 签名——池序降级/编制快照/UI 三处自动跟着走。
      const gatesInfo2 = require('./budget').并入(gatesInfo, require('./budget').冻结池(cfg, root));
      const runningByPool = {};
      for (const e of running.values()) if (e.kind === '执行' && e.池) runningByPool[e.池] = (runningByPool[e.池] || 0) + 1;
      const ledger = pmLedger.read(root);
      // 编辑器占用监视（用户提议，0.20.2）：制作人开着 Unity 编辑器时该项目的派发挂起，
      // 关编辑器下个周期自动恢复——agent 与人抢工程锁的对撞从派发源头消除（TK-62 超时案）。
      const readyAll = dispatch.readySet(root, pool.criticalSet(root));
      autoUnlockTick(root, cfg); // H64：锁关期间盯编辑器退出，自动开锁
      const busyProjects = manualLockedProjects(root);
      const ready = readyAll.filter((r2) => {
        const t2 = store.find(root, r2.id);
        const pj = t2 && projectPath(cfg, t2);
        if (pj && busyProjects.has(pj.name)) { result.拒因.push(`${r2.id} 挂起：项目 ${pj.name} 编辑器锁关（制作人验收中）`); return false; }
        return true;
      });
      // 派发滞留出声（2026-08-26 TK-201 案）：routePool 死局（钉池撞冻结/池序全冻）从此有 拒因，
      // UI 拒因每拍都给，journal 只在滞留面变化时记一条——静默滞留和刷屏两个坑都堵。
      const 派拒 = [];
      const picks = dispatch.pickNext(cfg, ready, runningByPool, gatesInfo2, ledger.并发上限, 派拒);
      if (派拒.length) {
        for (const x of 派拒) result.拒因.push(x);
        const 签 = 派拒.join('|');
        if (签 !== 滞留拒签) { 滞留拒签 = 签; 滞留首见 = Date.now(); 滞留已急件 = false; journal.append(root, `派发滞留 ${派拒.length} 项：${派拒.join('；')}`); }
        else if (!滞留已急件 && 滞留首见 && Date.now() - 滞留首见 >= 滞留急件阈毫) {
          // 升格（2026-08-26 评审：流水一条单行在忙线上很快滚出视区，7h 级滞留不许只有它）——
          // 同面挂满阈值升 inbox 急件，一签一次；面一变（解了/换单）计时重置。
          滞留已急件 = true;
          try { inbox.post(root, '急', '派发滞留', `滞留 ${派拒.length} 项超 ${Math.round(滞留急件阈毫 / 60000)} 分钟未解：${派拒.join('；').slice(0, 200)}`); } catch { /* 出声失败不阻断派发 */ }
        }
      } else { 滞留拒签 = ''; 滞留首见 = 0; 滞留已急件 = false; }
      for (const p of picks) {
        const t0 = store.find(root, p.id);
        if (!t0 || !['已排期', '待派', '待重派'].includes(t0.state)) continue; // H108：待投/池并入 待派；待重派=重投/复活回队；H116：已排期=排期到点的主派发态（readySet 同盘三态）
        const 主办 = `${t0.fm.职能}·${p.id}`; // 一次性 agent：一人一单一生命周期
        const 源态 = t0.state;
        const mv = store.move(root, p.id, 源态, '在途', (fm) => {
          fm.主办 = 主办; fm.执行池 = p.池; fm.领单时间 = opts.nowIso || new Date().toISOString();
          // H85 死局自愈留痕：工单上看得见它为什么不在本职池跑。
          // **写对象不写字符串**（2026-08-21 体检）：原样是模板字符串，而追溯链
          // （lib/pm/chain.js:128）按对象取 .原池/.新池/.因/.时间 —— 在字符串上取一律 undefined，
          // 于是那一行永远渲染成「临时改池 ? → xxx」、无时间、无原因。
          // 同族对照证明这是笔误不是约定：fm.实证放行、fm.待复核 等同类留痕字段全是对象。
          if (p.改挂) fm.临时改池 = { 原池: p.改挂.原池, 新池: p.池, 因: p.改挂.因, 时间: opts.nowIso || new Date().toISOString() };
          if (p.降级) fm.计费降级 = `${p.降级.原池}(订阅)→${p.池}(按量)`; // 工单自己也要写明这单是花钱跑的
        }, opts.nowIso || new Date().toISOString());
        if (!mv.ok) continue;
        journal.append(root, `派发 ${p.id}（${源态}→在途 · ${主办} · ${p.池} · H49 派发制）`);
        pmLedger.event(root, '派发', { id: p.id, 池: p.池 });
        // 排程台账挂钩（施工令-040 第 6 条）：定稿放行后真正"成单"的时刻就是这里——
        // 粒 起草中→已成单 并回填单号。**只加一个钩子调用**，派发结构一字不改；
        // 无粒ID 的单（绝大多数）在钩子里当场判「无关」直接返回，不产生任何写盘。
        try { require('./pm/schedule').挂钩派发(root, p.id, t0.fm.粒ID); } catch (e) { journal.append(root, `排程挂钩异常（派发 ${p.id}）：${e.message}`); }
        if (p.改挂) { // H85：临时改池是自动动作，必须同时进 journal 与项管台账，事后可追
          journal.append(root, `临时改池：${p.id} ${p.改挂.原池} → ${p.池}（${p.改挂.因}）`);
          pmLedger.event(root, '临时改池', { id: p.id, 原池: p.改挂.原池, 新池: p.池, 因: p.改挂.因 });
        }
        // 跨计费降级（2026-08-08「套餐用完降级到 key」配套）：这是**开始花钱**的时刻。
        // 池序内切换本来是静默的（那对 claude→codex 没问题，都是订阅），但订阅→按量必须响：
        // 不响的话用户看到的是「一切正常在跑」，实际账单在涨。四处同时留痕，一处都不能省。
        if (p.降级) {
          const 摘 = `${p.降级.原池}(订阅) → ${p.池}(按量)`;
          journal.append(root, `跨计费降级：${p.id} ${摘}——${p.降级.因}`);
          pmLedger.event(root, '跨计费降级', { id: p.id, ...p.降级 });
          inbox.post(root, '急', '跨计费降级', `${p.id} ${摘}：从此单起按量计费产生费用`, { 单号: p.id });
        }
        // H53：首子单派发 → 战役父单进在途；施工令-058：专项子单同理推容器 立项→进行
        require('./pm/wake').onChildDispatched(root, t0.fm.父单, t0.fm.专项);
        result.领单.push(p.id);
        const t1 = store.find(root, p.id);
        if (t1 && await startWork(root, cfg, t1, 主办, '执行', opts)) result.执行.push(p.id);
      }
      pmLedger.update(root, (l) => { l.就绪队列 = ready.filter((r2) => !picks.some((pk) => pk.id === r2.id)); l.在跑 = Object.fromEntries([...running.entries()].filter(([, e]) => e.kind === '执行').map(([a, e]) => [e.id, { agent: a, 池: e.池 || '', 拉起时间: e.startedAt }])); });
    }
    // H49 接线②③：战役全落袋→收口报告；连环失败→上呈（台账去重，判断才唤醒）
    // 施工令-058 追加一路：专项注册表的收口/复工自检（容器不换目录，只改注册表状态字段）。
    try {
      const wake = require('./pm/wake');
      wake.checkCloseouts(root, cfg, { test: !!opts.noBrain || sim });
      wake.check专项收口(root, cfg, { test: !!opts.noBrain || sim });
      wake.checkChainFailures(root);
    } catch (e) { result.拒因.push('项管巡检异常：' + String(e.message).slice(0, 60)); }
  } else {
    // ② 自动领单（拉取制，一人一张/双闸/依赖全在 claim 里把关）
    for (const a of agents) {
      if (running.has(a.id)) continue;
      const r = await pool.claim(root, cfg, a.id, opts.nowIso);
      if (r.ok) {
        journal.append(root, `领单 ${r.id}（${r.自 || '待派'}→在途 · ${a.id} · 执行器自动拉取）`);
        result.领单.push(r.id);
        const t = store.find(root, r.id);
        if (t && await startWork(root, cfg, t, a.id, '执行', opts)) result.执行.push(r.id);
      } else if (r.gated) { result.拒因.push(r.error); }
    }
  }

  // H102 接线（施工令-052）：台账对齐拍。放在派发制/领单制两条分支**之外**——
  // 台账对不上账跟用哪种派发模型无关，挂进 if 里就等于领单制那半边永远不对齐。
  try { require('./pm/wake').台账对齐拍(root, opts.对齐 || {}); }
  catch (e) { result.拒因.push('台账对齐异常：' + String(e.message).slice(0, 60)); }

  // ③ 质检执行（QA 只裁不开单，D10）。H85 补章去岗位化：不再从人头册里挑空闲 QA——
  // 判据改为「编制表里有没有 QA 这一行」，会话标签就用职能名（与判官三席 核查/两检初检/代裁 同款），
  // 一轮一张保守推进（判官会话都是单例，避免同一把裁判尺并发漂移）。
  if (roster.has(cfg, 'QA') && !running.has('QA')) {
    for (const t of store.list(root, '初检')) { // H108：质检会话跑「初检」目录
      if (busyTickets().has(t.id)) continue;
      if (t.fm.挂起) continue; // 施工令-021③：挂起单不开质检会话（H108 后挂起=目录态，fm 旗留作迁移期兜底）
      if (await startWork(root, cfg, t, 'QA', '质检', opts)) { result.质检.push(t.id); break; }
    }
  }

  // ④⑤ 判官失败封顶（TK-21）：失败计数到上限的单不再自动拉，等人工（清计数字段可重审）
  const 判官上限 = (cfg.执行器 || {}).判官重试上限 ?? 3;

  // ---- 审检并发去写死（施工令-010，制作人 2026-08-06 23:59 批准）----
  // 旧样是 running.has('两检初检'/'核查'/'仲裁') 的席位单槽写死：一把裁判尺一次只准开一个会话。
  // H85 编制权归项管的同规格延伸——槽数改读 config.并发.审检（默认 1、硬顶 2，项管按积压动态调）。
  // 语义：**同类判官在跑数 < 配额才开新槽**。配额=1 时与旧写法逐位等价（首席位沿用原名，
  // journal / 进度条 / 状态面板口径一字不改），配额>1 才多开 席位·2 这样的并发席。
  // 判官逻辑本身一个字不动——本段只改「槽数从哪来」。
  const 审检配额 = require('./concurrency').审检(cfg);
  const 在跑同类 = (k) => [...running.values()].filter((e) => e.kind === k).length;
  const 空席 = (base) => {
    for (let i = 1; i <= 审检配额; i++) { const id = i === 1 ? base : `${base}·${i}`; if (!running.has(id)) return id; }
    return null;
  };
  // 本轮可开的新槽数在进循环前算死（不在循环里重算）：模拟执行（测试钩子 durMs=0）会当场收线，
  // 循环里重算就会一轮把待验收全抽干——配额=1 必须仍是「一轮一张，保守推进」，与旧样逐位一致。
  const 开审检 = async (kind, 席位名, 场, 挑) => {
    for (let n = 审检配额 - 在跑同类(kind); n > 0; n--) {
      const 席 = 空席(席位名);
      if (!席) break;
      const t = 挑();
      if (!t || !(await startWork(root, cfg, t, 席, kind, opts))) break;
      (result[场] = result[场] || []).push(t.id);
    }
  };

  // 核查孤儿补链（2026-08-26 巡检案：TK-183/186/188/192 滞留 12h+）：代核章落盘与 送仲裁
  // 是两步不原子——中断在缝上即孤儿（章在→审检挑单不再挑它，边没走→永滞留核查），
  // 且原 送仲裁 失败分支静默。每拍补扫：代核不过还赖在核查目录的，补推仲裁；失败出声（签去重防刷屏）。
  for (const x of 核查孤儿们(root)) {
    if (!busyTickets().has(x.id)) {
      const r = lifecycle.送仲裁(root, x.id, '核查不过（孤儿补链自愈）');
      if (r.ok) journal.append(root, `核查孤儿补链 ${x.id} → 仲裁（代核不过章在而边未走——自愈，2026-08-26 案）`);
      else {
        const 签 = x.id + '|' + (r.error || '');
        if (!孤儿失败已留痕.has(签)) { 孤儿失败已留痕.add(签); journal.append(root, `核查孤儿补链失败 ${x.id}：${r.error}——送仲裁边不通，请人工查`); }
      }
    }
  }
  // 仲裁孤儿补链（2026-08-26 制作人 12:11 抓的第二现场：TK-183/186 代裁「给方向」章在而
  // 打回边未走，滞留仲裁 15h+）——章边不原子在代裁 kind 处理同样存在。按章补推：
  // 给方向→打回回炉（方向文本已随代裁写入正文），上呈→上呈待处理。失败出声同核查孤儿。
  for (const x of 仲裁孤儿们(root)) {
    if (busyTickets().has(x.id)) continue;
    const 决 = x.fm.代裁.结论 === '给方向' ? '打回' : '上呈';
    const r = lifecycle.仲裁定(root, x.id, 决, `仲裁孤儿补链自愈（代裁章 ${String(x.fm.代裁.时间 || '').slice(0, 16)} 在而边未走）`);
    if (r.ok) journal.append(root, `仲裁孤儿补链 ${x.id} → ${决}（代裁${x.fm.代裁.结论}章在而边未走——自愈，2026-08-26 案）`);
    else {
      const 签 = '仲' + x.id + '|' + (r.error || '');
      if (!孤儿失败已留痕.has(签)) { 孤儿失败已留痕.add(签); journal.append(root, `仲裁孤儿补链失败 ${x.id}：${r.error}——请人工查`); }
    }
  }

  // ④a 两检制·初检（H67，2026-08-05 用户拍板）：便宜模型先核格式与规范（回执契约/禁语/报数存在性），
  // 不过直接打回不烧 opus；过了才进 ④b 深检。开关与池在 config.执行器.两检。
  const 两检 = (cfg.执行器 || {}).两检 || {};
  // 施工令-031：机判初检零池零凭据——「有没有 deepseek 池」不再是初检开不开的前提条件。
  // 只有回落二线 LLM（config.执行器.两检.初检.二线LLM=true）时才仍要求池在册。
  const 二线 = require('./precheck').用二线LLM(cfg);
  const 两检开 = 两检.开 !== false && (!二线 || (cfg.执行池 || {})[两检.池 || 'deepseek']);
  // H108 注：核查目录不再按 验收方式 挑单——QA关的保留单也走核查（简检）→完成，
  // 「保留」的例外移到了验收闸（完成→归档 由制作人亲验，H110）；免检双钥匙单压根不进核查。
  if (两检开) {
    await 开审检('初检', '两检初检', '初检', () => store.list(root, '核查').find((x) => !['战役', '专项'].includes(x.fm.父单类型) && !x.fm.初检 && !x.fm.代核
      && !x.fm.挂起 // 施工令-021④a（fm 旗=迁移期兜底；新制挂起是目录态）
      && (Number(x.fm.初检失败次数) || 0) < 判官上限 && !busyTickets().has(x.id)));
  }

  // ④b 核查（D34 / H67 深检 / H108）：核查目录里 初检过（或两检关）的单，opus 核内容质量（配额内逐张）
  await 开审检('代核', '核查', '代核', () => store.list(root, '核查').find((x) => !['战役', '专项'].includes(x.fm.父单类型) && !x.fm.代核
    && !x.fm.挂起 // 施工令-021④b
    && (!两检开 || (x.fm.初检 && x.fm.初检.结论 === '过'))
    && (Number(x.fm.代核失败次数) || 0) < 判官上限 && !busyTickets().has(x.id)));

  // ⑤ 仲裁（D43③ / H108）：仲裁目录里未裁过的单（核查争议送入），裁判档裁「给方向/上呈」（配额内逐张）；
  // 打回级判断永远留给制作人（上呈落 待处理）；执行器.代裁=false 可整体关闭
  if ((cfg.执行器 || {}).代裁 !== false) {
    await 开审检('代裁', '仲裁', '代裁', () => store.list(root, '仲裁').find((x) => !x.fm.代裁 && !x.fm.挂起 // 施工令-021⑤
      && (Number(x.fm.代裁失败次数) || 0) < 判官上限 && !busyTickets().has(x.id)));
  }

  lastTick = result;
  return result;
}

// 循环管理（间隔读 config，不写魔法数字）
function startLoop(root, getCfg) {
  stopLoop();
  const run = () => { tick(root, getCfg()).catch(() => { /* 单轮失败不倒循环 */ }); };
  const 秒 = (getCfg().执行器 || {}).间隔秒 ?? 15;
  loopTimer = setInterval(run, 秒 * 1000);
  if (loopTimer.unref) loopTimer.unref();
  run();
}
function stopLoop() { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } }

// ---- 升格环（2026-08-22 体检二修）：与产线环彻底分开 ----
// 一修把 人闸升格Tick 挪到 tick() 的 isOn 早退之前，但那只堵了第一重。第二重是：
// stop() → stopLoop() → clearInterval 把整条 15 秒环拆了，tick 根本不再被调用，
// 升格随产线一起停。而「停止」按章程只管本次产线会话，人欠的债与它无关。
// 这条环 stopLoop() 碰不到——「人欠的债不因产线停摆而消失」这句话到此才在机器上成立。
let 升格Timer = null;
function start升格环(root, getCfg) {
  stop升格环();
  const 分 = ((getCfg().执行器 || {}).升格间隔分钟 ?? 5);
  const 跑 = () => {
    try { 人闸升格Tick(root, getCfg()); }
    catch (e) { try { journal.append(root, '人闸升格环异常：' + String((e && e.message) || e).slice(0, 80)); } catch { /* 留痕失败不倒环 */ } }
  };
  升格Timer = setInterval(跑, Math.max(1, 分 * 60000)); // 下限 1ms 而非 1 分钟：判据要能把这条环跑起来看
  if (升格Timer.unref) 升格Timer.unref();
  跑();
}
function stop升格环() { if (升格Timer) { clearInterval(升格Timer); 升格Timer = null; } }

function start(root, getCfg) {
  state.update(root, (s) => { s.执行器 = { ...(s.执行器 || {}), 运行: true }; delete s.执行器.试跑; delete s.执行器.实弹解锁; });
  journal.append(root, '执行器启动（实弹：运行即真调 CLI，停手闸=暂停总闸）');
  eventarchive.清理(root, getCfg());
  startLoop(root, getCfg);
}
function stop(root) {
  state.update(root, (s) => { s.执行器 = { ...(s.执行器 || {}), 运行: false }; });
  stopLoop();
  journal.append(root, '执行器停止（执行中的单跑完为止，不再领新单）');
}

function status(root, cfg) {
  const st = state.read(root).执行器 || {};
  return {
    运行: !!st.运行,
    间隔秒: (cfg.执行器 || {}).间隔秒 ?? 15,
    执行中: [...running.entries()].map(([agent, e]) => ({ agent, id: e.id, kind: e.kind, startedAt: e.startedAt, tail: e.tail || null, tail3: e.tail3 || null })),
    执行失败数: store.list(root, '待处理').length, // H108：执行失败/待定夺并入 待处理（键名沿用，UI 改名另行走前端组）
    编辑器占用: [...manualLockedProjects(root)], // H64：口径=手动锁（自动探测不再作挂起依据）
    编辑器锁: (() => { try { return require('./core/state').read(root).编辑器锁 || {}; } catch { return {}; } })(),
    引擎作业: engineJobs(cfg), // 项目名 → 引擎作业状态（无锁的项目不出键）
    上轮: lastTick,
  };
}

// 各注册项目的引擎作业（H83 后续 · TK-97 案）：读锁与测试日志心跳，任何缺失静默跳过。
function engineJobs(cfg) {
  const out = {};
  try {
    const engines = require('./engines');
    const reg = (cfg && cfg.项目 && cfg.项目.注册) || {};
    for (const [name, r] of Object.entries(reg)) {
      const s = r && r.路径 && engines.jobStatus(r.路径);
      if (s) out[name] = s;
    }
  } catch { /* 状态面板不因探测失败而崩 */ }
  return out;
}

// 按单终止（2026-08-05 推演补漏）：收回/废弃在途单时同步掐掉执行会话——此前文件挪走、进程仍在跑。
// 施工令-032① 起 返修 也走这条路（掐在飞审检），因 参数带上因由——流水不能再一律写「收回/废弃」。
function killTicket(root, id, 因) {
  for (const [agentId, e] of running.entries()) {
    if (e.id !== id) continue;
    try { if (e.child && e.child.pid) spawn('taskkill', ['/pid', String(e.child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* 尽力 */ }
    running.delete(agentId);
    journal.append(root, `终止会话 ${id}（${agentId}）：${String(因 || '单被收回/废弃').slice(0, 40)}`);
    return true;
  }
  return false;
}

module.exports = { tick, startWork, 凭据Of, start, stop, startLoop, stopLoop, status, running, isOn, projectPath, resolveCli, pickModel, charter, buildPrompt, buildQaPrompt, buildAuditPrompt, buildArbPrompt, settleClose, parseQaConclusion, extractClaudeSessionId, extractClaudeText, killTicket, engineJobs, tailFrom, stripAnsi, 计量回灌, 流分拣器, 分派, 剪闲聊, 流尾, 人闸升格Tick, start升格环, stop升格环, 核查孤儿们, 仲裁孤儿们 };
