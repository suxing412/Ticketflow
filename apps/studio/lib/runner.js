// runner.js — 执行器（D30/D31/D32）：内嵌 exe 的拉取循环，监制台版"监听器"。
// 每轮 tick 三种工作：
//   ① 自动领单：空闲在岗 agent 从池拉单（双闸/额度锁/依赖/一人一张全在 claim 路径）
//   ② 执行：在途单起执行（试跑=模拟零额度；实弹=真调 codex/claude 无头 CLI，需 实弹解锁）
//   ③ 质检执行：质检单派给空闲 QA agent 复核 → 走 D10 QA 裁定（QA 只裁不开单）
// 失败路径（D31）：CLI 崩溃/超时/非零退出 → lifecycle.执行失败（纯本地目录改名，零网络依赖），
// 由 Claude 会话分诊（重投/上呈/废弃）。停止=不领新单，执行中跑完（同 D26 暂停语义）。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const store = require('./core/store');
const state = require('./core/state');
const pool = require('./pool');
const lifecycle = require('./lifecycle');
const journal = require('./journal');

// 内存态：正在执行的工作（agentId → { id, kind, startedAt, timer, child }）。
// exe 重启即清空，tick 为"在途/质检有主办但无执行记录"的单重新拉起（断点恢复）。
const running = new Map();
let loopTimer = null;
let lastTick = null;

const busyTickets = () => new Set([...running.values()].map((e) => e.id));
function isOn(root) { return !!state.read(root).执行器?.运行; }
function isDry(root) { return state.read(root).执行器?.试跑 !== false; }

// ---- 项目定位（D32）：工单.项目 → config 注册表 → 仓库路径；完整注册向导属打包后首配 ----
function projectPath(cfg, t) {
  const reg = (cfg.项目 && cfg.项目.注册) || {};
  const name = t.fm.项目 || (cfg.项目 && cfg.项目.默认);
  const p = name && reg[name] && reg[name].路径;
  return p && fs.existsSync(p) ? { name, path: p } : null;
}

// ---- 模型分级（D38 = 停车场 P-5 落地）：贵模型当裁判，便宜模型干体力 ----
// 解析顺序：agent 个体覆盖(config.agents[].模型) > 工种/池默认(config.模型) > CLI 自带默认(空)
function pickModel(cfg, kind, agentCfg, poolName) {
  const m = cfg.模型 || {};
  if (kind === '质检') return m.质检 || m.claude默认 || '';
  if (kind === '代核') return m.代核 || m.claude默认 || '';
  if (kind === '代裁') return m.代裁 || m.代核 || m.claude默认 || ''; // D43③ 裁判档
  return (agentCfg && agentCfg.模型) || m[poolName + '默认'] || '';
}

// ---- 实弹 CLI 定位：exe 的 GUI 进程 PATH 不全（探针实证），按候选绝对路径解析 ----
function resolveCli(poolName, model) {
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
  return { cmd, args: ['-p', '--permission-mode', 'acceptEdits', '--output-format', 'stream-json', '--verbose', ...(model ? ['--model', model] : [])], stream: true };
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
  const like = texts.filter((t) => /完工报告|QA 核验|核验报告|结论[:：]/.test(t));
  if (like.length) return like[like.length - 1];
  return texts.join('\n\n');
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
// 委托代核提示词（D34）：Claude 按验收标准逐条只读核验，结论行机器可读
function buildAuditPrompt(root, t, proj, receiptPath) {
  const receipt = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8') : '（无回执）';
  return [
    `你代制作人层核验委托验收单 ${t.id}（${t.fm.title}）。只读核验，不改任何文件。`,
    `项目仓库：${proj.path}`,
    '对照工单验收标准逐条核验产出与回执，输出核验报告；',
    '最后单独一行输出机器可读结论：「结论：通过」或「结论：不过」。',
    '', '=== 工单正文 ===', t.body || '', '', '=== 主办回执 ===', receipt,
  ].join('\n');
}
// 委托代裁提示词（D43③）：QA 三振上呈的单，裁判档裁「给方向/上呈」；打回级判断永远留给制作人
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
    '', '=== 工单正文 ===', t.body || '', '', '=== 主办回执 ===', receipt,
  ].filter(Boolean).join('\n');
}

// ---- 收线裁决（TK-21 实测修复 + TK-31/TK-29 两案加固）：
// ① 判官（质检/代核/代裁）空输出不是有效裁决——按执行失败重试（TK-21）；
// ② 执行类空输出同样不作数——曾以「（CLI 无输出）」占位回执照常交单，TK-31 实测
//    空壳一路混过 QA 到待验收，产出真伪无据。现改执行失败分诊，绝不占位混关；
// ③ 判官光板结论（有结论行但全文过薄、无逐条理由）＝摆烂不是裁决——TK-29 实测
//    两字"不过"逼制作人层人工清章。按判官失败重试。
const JUDGE_KINDS = new Set(['质检', '代核', '代裁']);
function settleClose(kind, code, out, errout, ticketId, finishOk, failLocal) {
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
  // 代核结论机器可读行：找不到"结论：通过"一律按不过处理（保守，不误自动完成）
  if (kind === '代核') return finishOk(tail, /结论[:：]\s*通过/.test(tail));
  if (kind === '质检') {
    // QA 报告是散文体（"## 结论\n**通过**"之类）：取最后一个「结论」标记后的近文判定；
    // 找不到结论标记＝报告没写完 → 按判官失败重试，绝不默认放行（曾硬编码 true 酿成 TK-31/33 案）
    const i = text.lastIndexOf('结论');
    if (i < 0) { failLocal('质检报告无结论标记——不作数，按判官失败重试'); return; }
    const seg = text.slice(i, i + 80);
    if (/不过|不通过/.test(seg)) return finishOk(tail, false);
    if (/通过/.test(seg)) return finishOk(tail, true);
    failLocal('质检结论无法判读——按判官失败重试');
    return;
  }
  finishOk(tail, true);
}

// ---- 执行一份工作（在途执行 / 质检复核）。opts.durMs=0 供测试同步完成；opts.failWith 注入失败 ----
async function startWork(root, cfg, t, agentId, kind, opts = {}) {
  if (!agentId || running.has(agentId) || busyTickets().has(t.id)) return false;
  const rc = cfg.执行器 || {};
  const entry = { id: t.id, kind, startedAt: opts.nowIso || new Date().toISOString(), 池: kind === '执行' ? (t.fm.执行池 || null) : 'claude' };
  running.set(agentId, entry);
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
      if (!cur || cur.state !== '质检') return;
      store.update(root, t.id, (fm) => { fm.质检人 = agentId; delete fm.质检失败次数; });
      const r = lifecycle.QA裁定(root, cfg, t.id, verdict); // 曾硬编码 true——QA 写"不过"也放行，自修/待定夺全成死代码（TK-31/33 空壳两连过的真凶）
      if (r.ok) journal.append(root, `质检执行完成 ${t.id}（${agentId} · ${note}）`);
    } else if (kind === '代裁') {
      // D43③：解析裁判档结论。给方向→定夺给方向（方向文本进正文，主办重执行能读到）；
      // 其余（上呈/解析不出）→ 盖代裁章留在待定夺等用户——保守缺省，绝不误放行
      if (!cur || cur.state !== '待定夺') return;
      const text = String(note);
      const rp = path.join(root, '回执', `${t.id}.md`);
      try { fs.appendFileSync(rp, `\n\n## 委托代裁\n${text.slice(0, 6000)}\n`, 'utf8'); } catch { /* 无回执不阻塞 */ }
      const give = /结论[:：]\s*给方向/.test(text);
      const dir = give ? (text.match(/方向[:：]\s*([\s\S]{1,2000})/) || [])[1] : null;
      store.update(root, t.id, (fm) => { fm.代裁 = { 结论: give ? '给方向' : '上呈', 时间: new Date().toISOString() }; delete fm.代裁失败次数; });
      if (give && dir) {
        const r = lifecycle.定夺(root, t.id, '给方向', dir.trim(), '代裁·裁判档');
        if (r.ok) journal.append(root, `委托代裁 ${t.id} → 给方向回在途（D43③，方向已写入正文）`);
      } else {
        journal.append(root, `委托代裁 ${t.id} → 上呈：留待定夺等你裁（${give ? '方向缺失' : '裁判判断需制作人裁量'}）`);
      }
    } else if (kind === '代核') {
      if (!cur || cur.state !== '待验收') return;
      // 核验报告追加进回执；通过→自动验收完成（D11 委托代劳），不过→留在待验收等用户裁
      const rp = path.join(root, '回执', `${t.id}.md`);
      try { fs.appendFileSync(rp, `\n\n## 委托代核\n${String(note).slice(0, 6000)}\n`, 'utf8'); } catch { /* 无回执文件也不阻塞 */ }
      store.update(root, t.id, (fm) => { fm.代核 = { 结论: verdict ? '通过' : '不过', 时间: new Date().toISOString() }; delete fm.代核失败次数; });
      if (verdict) {
        const r = lifecycle.验收(root, t.id, true);
        if (r.ok) journal.append(root, `委托代核通过 ${t.id} → 验收完成（Claude 代劳，D11/D34）`);
      } else {
        journal.append(root, `委托代核不过 ${t.id}：留在待验收，附核验报告等你裁（不自动打回）`);
      }
    } else {
      if (!cur || cur.state !== '在途') return; // 期间被收回/废弃，不硬交
      const r = lifecycle.交产出(root, t.id, note);
      if (r.ok) journal.append(root, `执行完成 ${t.id}（${agentId} · ${kind}）`);
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
    if (kind === '代核' || kind === '代裁') {
      // 判官失败不动单不盖章（TK-21：空输出/网络抖动都走这里）：计失败次数，
      // 封顶前 tick 下轮自动重试，封顶后停拉等人工（清计数字段即可重启重审）
      const 场 = kind === '代核' ? '待验收' : '待定夺';
      const field = kind === '代核' ? '代核失败次数' : '代裁失败次数';
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
      // 判官阶段失败（多为网络抖动）不打整单：留在质检原地重试，封顶再入执行失败
      // ——整单失败后重投会连"执行"一起重跑，白烧一遍额度
      const cur0 = store.find(root, t.id);
      if (!cur0 || cur0.state !== '质检') return;
      const n = (Number(cur0.fm.质检失败次数) || 0) + 1;
      if (n < cap) {
        store.update(root, t.id, (fm) => { fm.质检失败次数 = n; });
        journal.append(root, `质检执行失败 ${t.id} 第 ${n}/${cap} 次（${String(why).slice(0, 60)}）——留质检下轮重试`);
        return;
      }
      journal.append(root, `质检执行连败 ${cap} 次 ${t.id} → 执行失败分诊`);
    }
    const cur = store.find(root, t.id);
    if (cur && (cur.state === '在途' || cur.state === '质检')) lifecycle.执行失败(root, t.id, why);
  };

  if (opts.failWith) { failLocal(opts.failWith); return true; } // 测试注入

  if (isDry(root)) {
    const lo = kind === '执行' ? (rc.试跑耗时秒下限 ?? 3) : (rc.质检耗时秒下限 ?? 2);
    const hi = kind === '执行' ? (rc.试跑耗时秒上限 ?? 8) : (rc.质检耗时秒上限 ?? 5);
    const durMs = opts.durMs ?? (lo + Math.random() * Math.max(0, hi - lo)) * 1000;
    const sec = Math.round(durMs / 1000);
    const receipt = `# 完工报告 ${t.id}（试跑）\n工单编号：${t.id}\n## 做了什么\n试跑模拟${kind}（零额度）\n## QA 章节\n${kind === '质检' ? '模拟复核通过' : '（试跑占位）'}\n## 实际消耗\n模拟 ${sec}s · 0 token\n## 异议\n无\n`;
    const fin = () => finishOk(kind === '质检' ? `模拟复核 ${sec}s`
      : kind === '代核' ? `（试跑模拟）逐条对照验收标准：全部通过\n结论：通过`
      : kind === '代裁' ? `（试跑模拟）失败原因明确，可修复。\n结论：给方向\n方向：按验收标准逐条补齐缺失项（试跑演示）`
      : receipt, true);
    if (durMs <= 0) fin(); else { entry.timer = setTimeout(fin, durMs); if (entry.timer.unref) entry.timer.unref(); }
    return true;
  }

  // ---- 实弹（D32）：真调无头 CLI。经济后果由 实弹解锁 开关把门（server 侧已拦） ----
  const proj = projectPath(cfg, t);
  if (!proj) { failLocal('项目未注册或路径不存在（config.项目）'); return true; }
  const poolName = t.fm.执行池 || 'claude';
  const agentCfg = (cfg.agents || []).find((a) => a.id === agentId);
  const model = pickModel(cfg, kind, agentCfg, poolName);
  const { cmd, args, stream } = resolveCli(kind === '执行' ? poolName : 'claude', model); // 质检/代核都走 claude
  const receiptPath = path.join(root, '回执', `${t.id}.md`);
  const prompt = kind === '质检' ? buildQaPrompt(root, t, proj, receiptPath)
    : kind === '代核' ? buildAuditPrompt(root, t, proj, receiptPath)
    : kind === '代裁' ? buildArbPrompt(root, t, proj, receiptPath)
    : buildPrompt(root, t, proj);
  let child;
  try {
    child = spawn(cmd, args, { cwd: proj.path, env: proxyEnv(cfg), windowsHide: true, shell: cmd.endsWith('.cmd'), stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { failLocal('CLI 启动失败：' + e.message); return true; }
  entry.child = child;
  const cliPool = kind === '执行' ? poolName : 'claude'; // 质检/代核实际走 claude，流水如实记
  journal.append(root, `实弹开工 ${t.id}（${agentId} · ${kind} · ${cliPool}${model ? '/' + model : ''} → ${proj.name}）`);
  let out = '', errout = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 800000) out = out.slice(-400000);
    // 活尾巴：stream-json 取最近一个 text 块的可读文本，纯文本流原样截尾
    if (stream) {
      const ms = out.match(/"text":"((?:[^"\\]|\\.)*)"/g);
      if (ms) { try { entry.tail = JSON.parse('"' + ms[ms.length - 1].slice(8, -1) + '"').replace(/\s+/g, ' ').trim().slice(-300); } catch { /* 保持旧尾 */ } }
    } else entry.tail = out.replace(/\s+/g, ' ').trim().slice(-300);
  });
  child.stderr.on('data', (d) => { errout += d; if (errout.length > 20000) errout = errout.slice(-10000); });
  const timeoutMs = (rc.执行超时分钟 ?? 30) * 60000;
  const killer = setTimeout(() => { // 超时树杀（中台同款）：整棵进程树掐掉再标失败
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* 尽力 */ }
    failLocal(`执行超时 ${rc.执行超时分钟 ?? 30} 分钟，已树杀`);
  }, timeoutMs);
  if (killer.unref) killer.unref();
  child.on('error', (e) => { clearTimeout(killer); failLocal('CLI 错误：' + e.message); });
  child.on('close', (code) => {
    clearTimeout(killer);
    if (!running.has(agentId)) return; // 已被超时处理
    settleClose(kind, code, stream ? extractClaudeText(out) : out, errout, t.id, finishOk, failLocal);
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 事件兜底 */ }
  return true;
}

// 一轮扫描。所有闸都复用既有路径（pool.claim / gates），执行器不自带门。
async function tick(root, cfg, opts = {}) {
  if (!isOn(root)) return { skipped: true, reason: '执行器未运行' };
  const dry = isDry(root);
  const armed = dry || (cfg.执行器 && cfg.执行器.实弹解锁 === true);
  const result = { at: opts.nowIso || new Date().toISOString(), 领单: [], 执行: [], 质检: [], 拒因: [] };
  const agents = (cfg.agents || []).filter((a) => a.上线 !== false);
  if (!armed) { result.拒因.push('实弹未解锁（config.执行器.实弹解锁），仅试跑可执行'); lastTick = result; return result; }

  const st = state.read(root);
  const lockedPools = new Set();
  for (const [k, v] of Object.entries(st.paused || {})) if (k !== 'global' && v) lockedPools.add(k);

  const dispatchMode = !!(cfg.执行器 && cfg.执行器.派发制); // H49 特性开关：true=派发制，false=旧拉取制（可回退）

  // ① 断点恢复 + 在途执行（待复核单不起工，D36）
  for (const t of store.list(root, '在途')) {
    if (!t.fm.主办 || busyTickets().has(t.id)) continue;
    if (t.fm.待复核) { result.拒因.push(`${t.id} 待复核未解除，不起执行`); continue; }
    if (!dispatchMode && !agents.some((a) => a.id === t.fm.主办)) continue; // 拉取制：退役待归者不起新执行；派发制：一次性主办直接续跑
    if (await startWork(root, cfg, t, t.fm.主办, '执行', opts)) result.执行.push(t.id);
  }

  if (dispatchMode) {
    // ②′ 派发制（H49）：迁移旧池 → 就绪盘点 → 护城河/并发闸 → 拉起一次性 agent
    const dispatch = require('./pm/dispatch');
    const pmLedger = require('./pm/ledger');
    for (const t of store.list(root, '池')) { // 一次性迁移：存量池单并入待投（已放行）
      const r = store.move(root, t.id, '池', '待投', (fm) => { fm.放行 = true; }, opts.nowIso || new Date().toISOString());
      if (r.ok) { journal.append(root, `H49 迁移：${t.id} 池→待投（自动放行）`); pmLedger.event(root, '迁移', { id: t.id }); }
    }
    if (!(st.paused || {}).global) {
      const locks = await require('./gates').allLocks(cfg).catch(() => null);
      const gatesInfo = {};
      if (locks) for (const p of ['codex', 'claude']) gatesInfo[p] = { fivePct: locks[p] && locks[p].fivePct, locked: !!(locks[p] && locks[p].locked) };
      for (const p of lockedPools) { gatesInfo[p] = gatesInfo[p] || {}; gatesInfo[p].locked = true; }
      const runningByPool = {};
      for (const e of running.values()) if (e.kind === '执行' && e.池) runningByPool[e.池] = (runningByPool[e.池] || 0) + 1;
      const ledger = pmLedger.read(root);
      const ready = dispatch.readySet(root, pool.criticalSet(root));
      const picks = dispatch.pickNext(cfg, ready, runningByPool, gatesInfo, ledger.并发上限);
      for (const p of picks) {
        const t0 = store.find(root, p.id);
        if (!t0 || t0.state !== '待投') continue;
        const 主办 = `${t0.fm.职能}·${p.id}`; // 一次性 agent：一人一单一生命周期
        const mv = store.move(root, p.id, '待投', '在途', (fm) => { fm.主办 = 主办; fm.执行池 = p.池; fm.领单时间 = opts.nowIso || new Date().toISOString(); }, opts.nowIso || new Date().toISOString());
        if (!mv.ok) continue;
        journal.append(root, `派发 ${p.id}（待投→在途 · ${主办} · ${p.池} · H49 派发制）`);
        pmLedger.event(root, '派发', { id: p.id, 池: p.池 });
        result.领单.push(p.id);
        const t1 = store.find(root, p.id);
        if (t1 && await startWork(root, cfg, t1, 主办, '执行', opts)) result.执行.push(p.id);
      }
      pmLedger.update(root, (l) => { l.就绪队列 = ready.filter((r2) => !picks.some((pk) => pk.id === r2.id)); l.在跑 = Object.fromEntries([...running.entries()].filter(([, e]) => e.kind === '执行').map(([a, e]) => [e.id, { agent: a, 池: e.池 || '', 拉起时间: e.startedAt }])); });
    }
  } else {
    // ② 自动领单（拉取制，一人一张/双闸/依赖全在 claim 里把关）
    for (const a of agents) {
      if (running.has(a.id)) continue;
      const r = await pool.claim(root, cfg, a.id, opts.nowIso);
      if (r.ok) {
        journal.append(root, `领单 ${r.id}（池→在途 · ${a.id} · 执行器自动拉取）`);
        result.领单.push(r.id);
        const t = store.find(root, r.id);
        if (t && await startWork(root, cfg, t, a.id, '执行', opts)) result.执行.push(r.id);
      } else if (r.gated) { result.拒因.push(r.error); }
    }
  }

  // ③ 质检执行：派给空闲在岗 QA agent（QA 只裁不开单，D10）
  const qaFree = agents.filter((a) => a.职能 === 'QA' && !running.has(a.id) && !lockedPools.has(a.执行池)
    && !pool.inFlight(root).some((x) => x.fm.主办 === a.id));
  for (const t of store.list(root, '质检')) {
    if (busyTickets().has(t.id)) continue;
    const qa = qaFree.shift();
    if (!qa) break;
    if (await startWork(root, cfg, t, qa.id, '质检', opts)) result.质检.push(t.id);
  }

  // ④⑤ 判官失败封顶（TK-21）：失败计数到上限的单不再自动拉，等人工（清计数字段可重审）
  const 判官上限 = (cfg.执行器 || {}).判官重试上限 ?? 3;

  // ④ 委托代核（D34）：待验收且验收方式=委托、未核过的单，Claude 代劳核验（一次一张，保守）
  if (!running.has('委托代核')) {
    const t = store.list(root, '待验收').find((x) => x.fm.验收方式 === '委托' && !x.fm.代核
      && (Number(x.fm.代核失败次数) || 0) < 判官上限 && !busyTickets().has(x.id));
    if (t && await startWork(root, cfg, t, '委托代核', '代核', opts)) (result.代核 = result.代核 || []).push(t.id);
  }

  // ⑤ 委托代裁（D43③）：待定夺且未裁过的单，裁判档裁「给方向/上呈」（一次一张）；
  // 打回级判断永远留给用户；执行器.代裁=false 可整体关闭
  if ((cfg.执行器 || {}).代裁 !== false && !running.has('委托代裁')) {
    const t = store.list(root, '待定夺').find((x) => !x.fm.代裁
      && (Number(x.fm.代裁失败次数) || 0) < 判官上限 && !busyTickets().has(x.id));
    if (t && await startWork(root, cfg, t, '委托代裁', '代裁', opts)) (result.代裁 = result.代裁 || []).push(t.id);
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

function start(root, getCfg) {
  state.update(root, (s) => { s.执行器 = { ...(s.执行器 || {}), 运行: true, 试跑: s.执行器?.试跑 !== false }; });
  journal.append(root, `执行器启动（${isDry(root) ? '试跑模式，零额度' : '实弹模式'}）`);
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
    运行: !!st.运行, 试跑: st.试跑 !== false,
    实弹解锁: !!(cfg.执行器 && cfg.执行器.实弹解锁),
    间隔秒: (cfg.执行器 || {}).间隔秒 ?? 15,
    执行中: [...running.entries()].map(([agent, e]) => ({ agent, id: e.id, kind: e.kind, startedAt: e.startedAt, tail: e.tail || null })),
    执行失败数: store.list(root, '执行失败').length,
    上轮: lastTick,
  };
}

module.exports = { tick, startWork, start, stop, startLoop, stopLoop, status, running, isOn, isDry, projectPath, resolveCli, pickModel, charter, buildPrompt, buildQaPrompt, buildArbPrompt, settleClose, extractClaudeText };
