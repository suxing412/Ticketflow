// runner.js — 执行器（D30/D31/D32）：内嵌 exe 的拉取循环，监制台版"监听器"。
// 每轮 tick 三种工作：
//   ① 自动领单：空闲在岗 agent 从池拉单（双闸/额度锁/依赖/一人一张全在 claim 路径）
//   ② 执行：在途单起执行（试跑=模拟零额度；实弹=真调 codex/claude 无头 CLI，需 实弹解锁）
//   ③ 质检执行：质检单派给空闲 QA agent 复核 → 走 D10 QA 裁定（QA 只裁不开单）
// 失败路径（D31）：CLI 崩溃/超时/非零退出 → lifecycle.执行失败（纯本地目录改名，零网络依赖），
// 由 Claude 会话分诊（重投/上呈/废弃）。停止=不领新单，执行中跑完（同 D26 暂停语义）。
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const store = require('./core/store');
const state = require('./core/state');
const pool = require('./pool');
const lifecycle = require('./lifecycle');
const journal = require('./journal');
const providers = require('./providers/registry');
const router = require('./routing/router');
const routeHistory = require('./routing/history');
const orchestration = require('./orchestration/plan');
const worktrees = require('./workspace/worktree');

// 内存态：正在执行的工作（agentId → { id, kind, startedAt, timer, child }）。
// exe 重启即清空，tick 为"在途/质检有主办但无执行记录"的单重新拉起（断点恢复）。
const running = new Map();
// 最近一次执行轨迹（工单 id → trace）。只保存在本机内存，避免把可能含敏感上下文的 CLI 输出落盘。
const traces = new Map();
const TRACE_MAX_CHARS = 200000;
let loopTimer = null;
let lastTick = null;

function redactTrace(value) {
  return String(value || '')
    .replace(/\b(?:sk|api)[-_][A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|secret)\s*[:=]\s*)[^\s,;}]+/ig, '$1[REDACTED]');
}
function beginTrace(id, meta) {
  const now = meta.startedAt || new Date().toISOString();
  const trace = { id, ...meta, status: 'starting', startedAt: now, lastActivityAt: now, endedAt: null, output: '', stderr: '', truncated: false };
  traces.delete(id); traces.set(id, trace);
  while (traces.size > 100) traces.delete(traces.keys().next().value);
  return trace;
}
function appendTrace(trace, value, channel = 'output') {
  if (!trace || value === undefined || value === null || value === '') return;
  const key = channel === 'stderr' ? 'stderr' : 'output';
  trace[key] += redactTrace(value);
  if (trace[key].length > TRACE_MAX_CHARS) { trace[key] = trace[key].slice(-TRACE_MAX_CHARS); trace.truncated = true; }
  trace.lastActivityAt = new Date().toISOString();
}
function endTrace(trace, status, reason, exitCode) {
  if (!trace) return;
  trace.status = status; trace.endedAt = new Date().toISOString(); trace.lastActivityAt = trace.endedAt;
  if (reason) appendTrace(trace, `\n[系统] ${reason}\n`, status === 'completed' ? 'output' : 'stderr');
  if (exitCode !== undefined) trace.exitCode = exitCode;
}
function traceFor(id) {
  const trace = traces.get(String(id || ''));
  if (!trace) return null;
  const { id: ticket, agent, kind, role, provider, model, status, startedAt, lastActivityAt, endedAt, output, stderr, truncated, exitCode, workspace } = trace;
  return { id: ticket, agent, kind, role, provider, model, status, startedAt, lastActivityAt, endedAt, output, stderr, truncated, exitCode,
    workspace: workspace ? { path: workspace.path, branch: workspace.branch, isolated: workspace.isolated } : null };
}

function renderClaudeEvent(trace, line) {
  let event; try { event = JSON.parse(line); } catch { return line + '\n'; }
  if (event.type === 'system') return `[系统] Claude ${event.subtype || 'session'}${event.model ? ` · ${event.model}` : ''}\n`;
  if (event.type === 'stream_event') {
    const ev = event.event || {};
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') return `\n[工具] ${ev.content_block.name || '调用'}\n`;
    if (ev.type === 'content_block_start' && /thinking/.test(ev.content_block?.type || '')) {
      if (trace._thinkingNotice) return '';
      trace._thinkingNotice = true; return '\n[分析] 模型正在分析（内部思维链不展示）\n';
    }
    if (ev.type === 'content_block_delta') {
      if (ev.delta?.type === 'text_delta') { trace._sawStreamText = true; return ev.delta.text || ''; }
      if (ev.delta?.type === 'input_json_delta') return ev.delta.partial_json || '';
      if (/thinking/.test(ev.delta?.type || '')) {
        if (trace._thinkingNotice) return '';
        trace._thinkingNotice = true; return '\n[分析] 模型正在分析（内部思维链不展示）\n';
      }
    }
    if (ev.type === 'content_block_stop') return '\n';
    return '';
  }
  if (event.type === 'assistant' && !trace._sawStreamText) {
    return (event.message?.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('') || '';
  }
  if (event.type === 'user') {
    const blocks = event.message?.content || [];
    return blocks.filter((x) => x.type === 'tool_result').map((x) => {
      const content = typeof x.content === 'string' ? x.content : JSON.stringify(x.content || '');
      return `\n[工具结果] ${content.slice(0, 4000)}\n`;
    }).join('');
  }
  if (event.type === 'result') return `\n[系统] Claude 执行结束${event.is_error ? '（失败）' : ''}\n`;
  return '';
}
function renderCodexEvent(trace, line) {
  let event; try { event = JSON.parse(line); } catch { return line + '\n'; }
  if (event.type === 'thread.started') return `[系统] Codex 线程 ${event.thread_id || '已启动'}\n`;
  if (event.type === 'turn.started') return '[系统] Codex 开始执行\n';
  if (event.type === 'error' || event.type === 'turn.failed') return `\n[错误] ${event.message || event.error?.message || JSON.stringify(event.error || event)}\n`;
  if (event.type === 'turn.completed') {
    const u = event.usage || {};
    return `\n[系统] Codex 执行结束${u.input_tokens != null ? ` · input ${u.input_tokens} · output ${u.output_tokens || 0}` : ''}\n`;
  }
  if (!/^item\./.test(event.type || '') || !event.item) return '';
  const item = event.item;
  if (item.type === 'reasoning') {
    if (trace._thinkingNotice) return '';
    trace._thinkingNotice = true; return '\n[分析] 模型正在分析（内部思维链不展示）\n';
  }
  if (item.type === 'agent_message') return event.type === 'item.completed' ? `${item.text || ''}\n` : '';
  if (item.type === 'command_execution') {
    const output = event.type === 'item.completed' ? (item.aggregated_output || item.output || '') : '';
    return `\n[命令] ${item.command || ''}${output ? `\n${String(output).slice(-6000)}` : ''}\n`;
  }
  if (item.type === 'file_change') return `\n[文件变更] ${item.path || item.file || JSON.stringify(item.changes || item)}\n`;
  if (item.type === 'mcp_tool_call') return `\n[MCP 工具] ${item.server || ''}${item.tool ? '/' + item.tool : ''}\n`;
  if (item.type === 'web_search') return `\n[搜索] ${item.query || ''}\n`;
  if (/plan|todo/.test(item.type || '')) return `\n[计划] ${item.text || JSON.stringify(item.items || item)}\n`;
  return event.type === 'item.started' ? `\n[事件] ${item.type}\n` : '';
}
function renderProviderEvent(trace, line, format) {
  if (format === 'claude-stream-json') return renderClaudeEvent(trace, line);
  if (format === 'codex-jsonl') return renderCodexEvent(trace, line);
  return line + '\n';
}
function finalProviderText(invocation, raw) {
  if (!['claude-stream-json', 'codex-jsonl'].includes(invocation?.outputFormat)) return String(raw || '').trim();
  let result = ''; const assistant = [];
  for (const line of String(raw || '').split(/\r?\n/).filter(Boolean)) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'result' && typeof event.result === 'string') result = event.result;
    if (event.type === 'assistant') assistant.push(...(event.message?.content || []).filter((x) => x.type === 'text').map((x) => x.text));
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) result = event.item.text;
  }
  return String(result || assistant.join('\n') || '').trim();
}

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
  const providerCfg = cfg.providers && cfg.providers[poolName] || {};
  const reviewRole = kind === '质检' ? 'reviewer' : kind === '代核' ? 'auditor' : kind === '代裁' ? 'arbitrator' : null;
  const roleModel = reviewRole && cfg.roles && cfg.roles[reviewRole] && cfg.roles[reviewRole].model;
  if (kind === '质检') return roleModel || m.质检 || providerCfg.defaultModel || m[poolName + '默认'] || '';
  if (kind === '代核') return roleModel || m.代核 || providerCfg.defaultModel || m[poolName + '默认'] || '';
  if (kind === '代裁') return roleModel || m.代裁 || m.代核 || providerCfg.defaultModel || m[poolName + '默认'] || ''; // D43③ 裁判档
  return (agentCfg && (agentCfg.model || agentCfg.模型)) || providerCfg.defaultModel || m[poolName + '默认'] || '';
}

// ---- 实弹 CLI 定位：exe 的 GUI 进程 PATH 不全（探针实证），按候选绝对路径解析 ----
function resolveCli(poolName, model) {
  return providers.resolveLegacy(poolName, model);
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
  const dirs = ['角色协议', '岗位协议'].map((name) => path.join(root, name));
  const dir = dirs.find((candidate) => fs.existsSync(candidate)) || dirs[1];
  const parts = [];
  const roleFiles = [`${职能}.md`];
  if (职能 === 'reviewer') roleFiles.push('QA.md'); // 旧游戏 Profile 兼容
  for (const candidates of [['通用.md', 'common.md'], roleFiles]) {
    const file = candidates.find((f) => fs.existsSync(path.join(dir, f)));
    try { if (file) parts.push(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { /* 缺章程不阻塞执行 */ }
  }
  return parts.join('\n\n---\n\n');
}

// 工单 → 执行提示词（岗位协议 + 范围/不要做/验收标准；中文走 stdin 防 argv 乱码）
function buildPrompt(root, t, proj, cfg = {}) {
  const role = router.taskRole(t);
  const ch = charter(root, role);
  const ws = proj.workspace;
  const lines = [
    ch ? `=== 岗位协议（必须遵守）===\n${ch}\n` : '',
    `你是「${role}」角色的执行 agent，领到工单 ${t.id}：${t.fm.title}`,
    `工作目录（项目仓库）：${proj.path}`,
    ws && ws.isolated ? `当前是隔离工作区，分支：${ws.branch}。不要切换分支、删除 worktree 或推送远端；系统会在完工时自动形成 Git 检查点。` : '',
    '只做工单范围内的事，遵守「不要做」，产出满足全部验收标准。',
    '', '=== 工单正文 ===', t.body || '（无正文）',
    '', '完成后按通用章程的回执格式输出完工报告，它会作为回执存档。',
  ];
  if (role === 'orchestrator') {
    const maxTasks = Number((cfg.orchestration || {}).maxTasks || 20);
    const allowedRoles = (Object.keys(cfg.roles || {}).length ? Object.keys(cfg.roles) : (cfg.职能 || []))
      .filter((name) => name !== 'orchestrator' || (cfg.orchestration || {}).allowNested === true);
    const planFile = orchestration.configuredPlanFile(cfg);
    lines.push('',
    '=== 机器可读计划（必须输出）===',
    `最多 ${maxTasks} 张子任务；role 只能使用：${allowedRoles.join('、')}。不得发明 product、design、qa、security、fullstack 等未注册角色；复合工作必须拆分或选择最接近的已注册角色。`,
    `完成仓库分析后，把完整 JSON 写入项目内 ${planFile}，并在最终回复末尾原样输出同一份 \`\`\`json 代码块。两处至少一处必须成功。`,
    'JSON 必须符合以下结构：',
    '{"summary":"计划摘要","tasks":[{"key":"contract","title":"任务标题","role":"backend","description":"范围","dependsOn":[],"requiredCapabilities":["coding"],"writeScope":["server/**"],"acceptance":["可客观验证的标准"]}]}',
    'key 只用英文字母开头的字母/数字/下划线/横线；dependsOn 只能引用本计划内 key；不要创建新的 orchestrator 子任务。',
    '前后端并行时优先先建接口契约任务；共享文件交给 integrator 或通过依赖串行化。');
  }
  if (ws && ws.integration) {
    const merged = [...(ws.integration.merged || []), ...(ws.integration.already || [])]
      .map((x) => `${x.id}@${String(x.commit).slice(0, 10)}`).join('、') || '无';
    lines.push('', '=== 依赖集成现场 ===', `已纳入的依赖检查点：${merged}`);
    if ((ws.integration.skipped || []).length) lines.push(`未自动纳入：${ws.integration.skipped.map((x) => `${x.id}（${x.reason}）`).join('、')}`);
    if (role === 'integrator' && (ws.integration.conflicts || []).length) lines.push(
      `Git 合并已停在冲突现场：${ws.integration.conflicts.join('、')}`,
      '你被明确授权在当前隔离分支解决这些冲突；保留两侧已通过的验收条件，解决后运行测试。不要中止合并或改写其他分支。');
  }
  return lines.filter(Boolean).join('\n');
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
  const ch = charter(root, 'reviewer');
  return [
    ch ? `=== 岗位协议（必须遵守）===\n${ch}\n` : '',
    `你是 QA 复核 agent，对工单 ${t.id}（${t.fm.title}）做质检：只读复核，不改实现（D20）。`,
    `项目仓库：${proj.path}`,
    '对照工单验收标准逐条核验主办的产出与回执，按章程格式输出核验结论。',
    '最后单独一行输出机器可读结论：「结论：通过」或「结论：不过」。',
    '', '=== 工单正文 ===', t.body || '', '', '=== 主办回执 ===', receipt,
  ].filter(Boolean).join('\n');
}

// ---- 执行一份工作（在途执行 / 质检复核）。opts.durMs=0 供测试同步完成；opts.failWith 注入失败 ----
async function startWork(root, cfg, t, agentId, kind, opts = {}) {
  if (!agentId || running.has(agentId) || busyTickets().has(t.id)) return false;
  const rc = cfg.执行器 || {};
  const agentCfg = (cfg.agents || []).find((a) => a.id === agentId);
  const routeRole = kind === '执行' ? router.taskRole(t)
    : kind === '质检' ? 'reviewer' : kind === '代核' ? 'auditor' : 'arbitrator';
  const assignedProvider = kind === '执行' && (t.fm.provider || t.fm.供应商 || t.fm.执行池);
  const route = assignedProvider
    ? { name: assignedProvider, role: routeRole, score: t.fm.路由分 || null, reasons: ['领单时已分配'] }
    : router.chooseProvider(root, cfg, { agent: agentCfg, task: t, role: routeRole, kind });
  if (!route) {
    journal.append(root, `无法执行 ${t.id}（${agentId} · ${kind}）：没有可用 Provider`);
    return false;
  }
  const providerName = route.name;
  const model = pickModel(cfg, kind, agentCfg, providerName);
  const entry = { id: t.id, kind, role: routeRole, provider: providerName, model, route, startedAt: opts.nowIso || new Date().toISOString() };
  entry.trace = beginTrace(t.id, { agent: agentId, kind, role: routeRole, provider: providerName, model, startedAt: entry.startedAt });
  appendTrace(entry.trace, `[系统] ${agentId} 开始${kind} · ${providerName}${model ? '/' + model : ''}\n`);
  running.set(agentId, entry);
  const recordResult = (ok, reason) => {
    if (entry.recorded) return;
    entry.recorded = true;
    routeHistory.append(root, {
      ticket: t.id, agent: agentId, kind, role: routeRole, provider: providerName, model,
      ok, reason: reason ? String(reason).slice(0, 300) : undefined,
      outcome: 'execution',
      dry: isDry(root), durationMs: Math.max(0, Date.now() - Date.parse(entry.startedAt)),
      routeScore: route.score, routeReasons: route.reasons,
    });
  };
  const finishOk = (note, verdict) => {
    try {
      finishOkInner(note, verdict);
      if (['starting', 'running'].includes(entry.trace.status)) endTrace(entry.trace, 'completed', 'Provider 执行结束', 0);
    } catch (e) {
      // 定时器回调里的异常会成为主进程未捕获异常 → 整个 app 弹窗崩掉（0.9.1 YAML 实测）。
      // 单张单的收尾失败只准伤自己：记账 + 尝试入执行失败，绝不外抛。
      running.delete(agentId);
      recordResult(false, '完工收尾异常：' + e.message);
      journal.append(root, `完工收尾异常 ${t.id}：${String(e.message).slice(0, 100)}——单未流转，待分诊`);
      try { lifecycle.执行失败(root, t.id, '完工收尾异常：' + String(e.message).slice(0, 80)); } catch { /* 尽力 */ }
      endTrace(entry.trace, 'failed', '完工收尾异常：' + e.message);
    }
  };
  const finishOkInner = (note, verdict) => {
    running.delete(agentId);
    try { require('./quota').eagerRefresh(cfg); } catch { /* 急刷失败不影响交单 */ } // 完工=额度变化时刻，作废节流窗口让读数跟上
    const cur = store.find(root, t.id);
    if (kind === '质检') {
      if (!cur || cur.state !== '质检') return;
      store.update(root, t.id, (fm) => { fm.质检人 = agentId; delete fm.质检失败次数; });
      const passed = verdict !== false;
      const originalProvider = cur.fm.provider || cur.fm.供应商 || cur.fm.执行池;
      if (originalProvider) routeHistory.append(root, {
        ticket: t.id, agent: cur.fm.主办, kind: '评审结果', role: router.taskRole(cur), provider: originalProvider,
        reviewerProvider: providerName, qualityPassed: passed, outcome: 'quality', dry: isDry(root),
      });
      const r = lifecycle.QA裁定(root, cfg, t.id, passed);
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
      store.update(root, t.id, (fm) => { fm.代裁 = { 结论: give ? '给方向' : '上呈', 时间: new Date().toISOString() }; });
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
      store.update(root, t.id, (fm) => { fm.代核 = { 结论: verdict ? '通过' : '不过', 时间: new Date().toISOString() }; });
      if (verdict) {
        const r = lifecycle.验收(root, t.id, true);
        if (r.ok) journal.append(root, `委托代核通过 ${t.id} → 验收完成（${providerName} 代劳）`);
      } else {
        journal.append(root, `委托代核不过 ${t.id}：留在待验收，附核验报告等你裁（不自动打回）`);
      }
    } else {
      if (!cur || cur.state !== '在途') return; // 期间被收回/废弃，不硬交
      let resolvedPlan = null;
      if (routeRole === 'orchestrator') {
        const rawPath = path.join(root, '回执', `${t.id}.provider-output.md`);
        fs.mkdirSync(path.dirname(rawPath), { recursive: true });
        fs.writeFileSync(rawPath, String(note || ''), 'utf8');
        resolvedPlan = orchestration.resolvePlan(cfg, note, entry.workspace && entry.workspace.path);
      }
      if (entry.workspace && entry.workspace.isolated) {
        const checkpoint = worktrees.checkpoint(cfg, entry.workspace, cur);
        entry.workspace = { ...entry.workspace, ...checkpoint, commit: checkpoint.commit || entry.workspace.commit, completedAt: new Date().toISOString() };
        store.update(root, t.id, (fm) => { fm.workspace = entry.workspace; });
        journal.append(root, `Git 检查点 ${t.id} → ${entry.workspace.commit ? String(entry.workspace.commit).slice(0, 10) : '未提交'}（${entry.workspace.branch}）`);
      }
      if (routeRole === 'orchestrator') {
        const planned = { ...resolvedPlan, ...orchestration.materialize(root, cfg, cur, resolvedPlan.plan) };
        journal.append(root, `Orchestrator 计划落盘 ${t.id} → ${planned.children.length} 张待投子单（来源：${planned.source}；${planned.children.join('、')}）`);
      }
      const r = lifecycle.交产出(root, t.id, note);
      if (r.ok) journal.append(root, `执行完成 ${t.id}（${agentId} · ${kind}）`);
    }
    recordResult(true);
  };
  const failLocal = (why) => {
    try { failLocalInner(why); } catch (e) {
      running.delete(agentId);
      endTrace(entry.trace, 'failed', `失败入位异常：${e.message}`);
      try { journal.append(root, `失败入位异常 ${t.id}：${String(e.message).slice(0, 100)}`); } catch { /* 尽力 */ }
    }
  };
  const failLocalInner = (why) => { // D31：失败入位为纯本地操作，任何网络状况下都能落位
    running.delete(agentId);
    endTrace(entry.trace, /超时/.test(String(why)) ? 'timed_out' : 'failed', why);
    recordResult(false, why);
    if (kind === '代核') { // 代核失败不动单（待验收无失败转移）：记账后待下轮/人工
      journal.append(root, `委托代核失败 ${t.id}（${String(why).slice(0, 80)}）——单留待验收`);
      return;
    }
    if (kind === '代裁') { // 代裁失败同理不动单：留待定夺，下轮重试或用户手裁
      journal.append(root, `委托代裁失败 ${t.id}（${String(why).slice(0, 80)}）——单留待定夺`);
      return;
    }
    if (kind === '质检') {
      // 判官阶段失败（多为网络抖动）不打整单：留在质检原地重试，3 次封顶再入执行失败
      // ——整单失败后重投会连"执行"一起重跑，白烧一遍额度
      const cur0 = store.find(root, t.id);
      if (!cur0 || cur0.state !== '质检') return;
      const n = (Number(cur0.fm.质检失败次数) || 0) + 1;
      if (n < 3) {
        store.update(root, t.id, (fm) => { fm.质检失败次数 = n; });
        journal.append(root, `质检执行失败 ${t.id} 第 ${n}/3 次（${String(why).slice(0, 60)}）——留质检下轮重试`);
        return;
      }
      journal.append(root, `质检执行连败 3 次 ${t.id} → 执行失败分诊`);
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
    entry.trace.status = 'running';
    appendTrace(entry.trace, `[试跑] 模拟执行中，预计 ${sec}s，不调用 Provider。\n`);
    const dryWorkerRole = Object.keys(cfg.roles || {}).find((role) => !['orchestrator', 'reviewer', 'integrator'].includes(role)) || (cfg.职能 || []).find((role) => role !== 'orchestrator') || 'generalist';
    const dryPlan = JSON.stringify({ summary: '试跑生成一张演示子单', tasks: [{
      key: 'demo', title: '验证 Orchestrator 子单链路', role: dryWorkerRole,
      description: '验证结构化计划可以落成待投工单', acceptance: ['子工单进入待投且父子链完整'],
      writeScope: ['docs/**'], dependsOn: [],
    }] }, null, 2);
    const fin = () => finishOk(kind === '质检' ? `模拟复核 ${sec}s`
      : kind === '代核' ? `（试跑模拟）逐条对照验收标准：全部通过\n结论：通过`
      : kind === '代裁' ? `（试跑模拟）失败原因明确，可修复。\n结论：给方向\n方向：按验收标准逐条补齐缺失项（试跑演示）`
      : routeRole === 'orchestrator' ? `${receipt}\n\n\`\`\`json\n${dryPlan}\n\`\`\``
      : receipt, true);
    if (durMs <= 0) fin(); else { entry.timer = setTimeout(fin, durMs); if (entry.timer.unref) entry.timer.unref(); }
    return true;
  }

  // ---- 实弹（D32）：真调无头 CLI。经济后果由 实弹解锁 开关把门（server 侧已拦） ----
  const baseProject = projectPath(cfg, t);
  if (!baseProject) { failLocal('项目未注册或路径不存在（config.项目）'); return true; }
  let proj = baseProject;
  try {
    const dependencies = kind === '执行' ? worktrees.dependencyTickets(root, t, store) : [];
    const workspace = worktrees.prepare(root, cfg, t, baseProject, { role: routeRole, dependencies });
    entry.workspace = workspace;
    entry.trace.workspace = workspace;
    appendTrace(entry.trace, `[工作区] ${workspace.path}${workspace.branch ? ` · ${workspace.branch}` : ''}\n`);
    proj = { ...baseProject, path: workspace.path, workspace };
    if (workspace.isolated || workspace.warning) {
      store.update(root, t.id, (fm) => { fm.workspace = workspace; });
      journal.append(root, workspace.isolated
        ? `隔离工作区就绪 ${t.id} → ${workspace.branch}（${workspace.path}）`
        : `工作区降级 ${t.id}：${workspace.warning}`);
    }
  } catch (e) { failLocal('工作区准备失败：' + e.message); return true; }
  let invocation;
  try { invocation = providers.create(cfg, providerName).buildInvocation({ model, kind, role: routeRole }); }
  catch (e) { failLocal('Provider 配置错误：' + e.message); return true; }
  const { cmd, args } = invocation;
  const receiptPath = path.join(root, '回执', `${t.id}.md`);
  const prompt = kind === '质检' ? buildQaPrompt(root, t, proj, receiptPath)
    : kind === '代核' ? buildAuditPrompt(root, t, proj, receiptPath)
    : kind === '代裁' ? buildArbPrompt(root, t, proj, receiptPath)
    : buildPrompt(root, t, proj, cfg);
  let child;
  try {
    child = spawn(cmd, args, {
      cwd: proj.path,
      env: { ...proxyEnv(cfg), ...(invocation.env || {}) },
      windowsHide: true,
      shell: invocation.shell ?? String(cmd).toLowerCase().endsWith('.cmd'),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) { failLocal('CLI 启动失败：' + e.message); return true; }
  entry.child = child;
  entry.trace.status = 'running';
  appendTrace(entry.trace, `[进程] CLI 已启动 · PID ${child.pid || '—'}\n`);
  journal.append(root, `实弹开工 ${t.id}（${agentId} · ${kind} · ${providerName}${model ? '/' + model : ''} → ${proj.name}）`);
  let out = '', errout = '';
  let jsonBuffer = '';
  child.stdout.on('data', (d) => {
    const chunk = String(d); out += chunk; if (out.length > 400000) out = out.slice(-200000);
    if (['claude-stream-json', 'codex-jsonl'].includes(invocation.outputFormat)) {
      jsonBuffer += chunk; const lines = jsonBuffer.split(/\r?\n/); jsonBuffer = lines.pop() || '';
      for (const line of lines) appendTrace(entry.trace, renderProviderEvent(entry.trace, line, invocation.outputFormat));
    } else appendTrace(entry.trace, chunk);
  });
  child.stderr.on('data', (d) => { const chunk = String(d); errout += chunk; if (errout.length > 20000) errout = errout.slice(-10000); appendTrace(entry.trace, chunk, 'stderr'); });
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
    if (jsonBuffer && ['claude-stream-json', 'codex-jsonl'].includes(invocation.outputFormat)) appendTrace(entry.trace, renderProviderEvent(entry.trace, jsonBuffer, invocation.outputFormat));
    if (code === 0) {
      const text = (finalProviderText(invocation, out).slice(-8000)) || `# 完工报告 ${t.id}\n（CLI 无输出）`;
      // 代核结论机器可读行：找不到"结论：通过"一律按不过处理（保守，不误自动完成）
      const parsedVerdict = kind === '代核' || kind === '质检' ? /结论[:：]\s*通过/.test(text) : true;
      finishOk(text, parsedVerdict);
    } else {
      // 失败原因优先 stderr，空则兜底 stdout 尾部——claude CLI 的 "API Error: ..." 打在 stdout，
      // 只看 stderr 会落库成空白的「CLI 退出码 1：」（另会话实测）
      const src = String(errout).trim() || String(out).trim();
      failLocal(`CLI 退出码 ${code}：${src.split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(0, 150)}`);
    }
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

  // ① 断点恢复 + 在途执行（待复核单不起工，D36）
  for (const t of store.list(root, '在途')) {
    if (!t.fm.主办 || busyTickets().has(t.id)) continue;
    if (t.fm.待复核) { result.拒因.push(`${t.id} 待复核未解除，不起执行`); continue; }
    if (!agents.some((a) => a.id === t.fm.主办)) continue; // 退役待归者不起新执行
    if (await startWork(root, cfg, t, t.fm.主办, '执行', opts)) result.执行.push(t.id);
  }

  // ② 自动领单（一人一张/双闸/依赖全在 claim 里把关）
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

  // ③ 质检执行：派给空闲 reviewer（旧配置 QA 继续兼容）
  const qaFree = agents.filter((a) => ['reviewer', 'QA'].includes(router.agentRole(a)) && !running.has(a.id) && !lockedPools.has(a.provider || a.供应商 || a.执行池)
    && !pool.inFlight(root).some((x) => x.fm.主办 === a.id));
  for (const t of store.list(root, '质检')) {
    if (busyTickets().has(t.id)) continue;
    const qa = qaFree.shift();
    if (!qa) break;
    if (await startWork(root, cfg, t, qa.id, '质检', opts)) result.质检.push(t.id);
  }

  // ④ 委托代核（D34）：待验收且验收方式=委托、未核过的单，动态选择 auditor Provider
  if (!running.has('委托代核')) {
    const t = store.list(root, '待验收').find((x) => x.fm.验收方式 === '委托' && !x.fm.代核 && !busyTickets().has(x.id));
    if (t && await startWork(root, cfg, t, '委托代核', '代核', opts)) (result.代核 = result.代核 || []).push(t.id);
  }

  // ⑤ 委托代裁（D43③）：待定夺且未裁过的单，裁判档裁「给方向/上呈」（一次一张）；
  // 打回级判断永远留给用户；执行器.代裁=false 可整体关闭
  if ((cfg.执行器 || {}).代裁 !== false && !running.has('委托代裁')) {
    const t = store.list(root, '待定夺').find((x) => !x.fm.代裁 && !busyTickets().has(x.id));
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
    执行中: [...running.entries()].map(([agent, e]) => ({
      agent, id: e.id, kind: e.kind, role: e.role, provider: e.provider, model: e.model, startedAt: e.startedAt,
      lastActivityAt: e.trace && e.trace.lastActivityAt,
      workspace: e.workspace ? { path: e.workspace.path, branch: e.workspace.branch, isolated: e.workspace.isolated } : null,
    })),
    执行失败数: store.list(root, '执行失败').length,
    上轮: lastTick,
  };
}

module.exports = { tick, startWork, start, stop, startLoop, stopLoop, status, traceFor, traces, renderClaudeEvent, renderCodexEvent, finalProviderText,
  running, isOn, isDry, projectPath, resolveCli, pickModel, charter, buildPrompt, buildQaPrompt, buildArbPrompt };
