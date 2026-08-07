#!/usr/bin/env node
// review.js — 异厂评审台（施工令-013 · H88 配套）
// 用法：node review.js --file <方案md绝对路径> [--out <意见合集md路径>]
//      [--config <studio.config.json 路径>]  ← 默认读生产 config，实测/演练可指临时副本
//      [--timeout-min N]                     ← 单厂超时（默认 5min），超时该厂记缺席，不拖垮全场
//      [--only 厂1,厂2]                      ← 只请某几席（省额度的定向实测用，正常评审不带）
//      [--dry]                               ← 只列评审团名册不真调（验「新厂自动纳入」用，零 token）
//
// 评审团自动发现（新厂零改动纳入）：
//   ① codex —— 本机 codex exec CLI（--dangerously-bypass-approvals-and-sandbox，提示词走 stdin；
//      过程输出全在 stderr，stdout 只吐最终答案，见 runner.js「活尾巴取样」实测定谳）；
//   ② config.执行池 里每个带 兼容 段的条目（现 deepseek）—— Anthropic 兼容 /v1/messages 直调。
//   将来 config 新增兼容池条目即自动入席，本文件一字不改。
//
// 密钥纪律（施工令-013 红线）：key 只在进程内用于组请求头，任何 stdout / 合集 md / 错误栈
//   都过 scrub() 净化——已知密钥逐一抹除 + sk-*/Bearer/x-api-key 形状兜底。异常路径也归口 out()。
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const DEFAULT_CONFIG = 'D:/GitHub/AI-GameStudio/监制台/studio.config.json';
const REDACT = '***已抹除***';

// —— 参数解析（同 enginectl 口径：--k v / --k 布尔）——
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  args[a.slice(2)] = (process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) ? process.argv[++i] : true;
}

// ——————————————————————————————————————————————————————————
// 密钥净化：任何往外走的字符串（stdout / 文件 / 错误栈）都必须先过这里
// ——————————————————————————————————————————————————————————
const SECRETS = new Set();
function remember(s) { if (typeof s === 'string' && s.trim().length >= 8) SECRETS.add(s.trim()); }
function scrub(x) {
  let s = (x === null || x === undefined) ? '' : String(x);
  for (const k of SECRETS) { if (k) s = s.split(k).join(REDACT); }
  s = s.replace(/sk-[A-Za-z0-9_\-]{6,}/g, REDACT);                                  // 形状兜底：sk- 家族
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, '$1' + REDACT);                 // Authorization
  s = s.replace(/(x-api-key["'\s:=]{1,4})[A-Za-z0-9._\-]{8,}/gi, '$1' + REDACT);    // 头名回显
  s = s.replace(/((?:key|token|secret)["'\s:=]{1,4})[A-Za-z0-9._\-]{16,}/gi, '$1' + REDACT);
  return s;
}
const say = (msg) => process.stderr.write('[评审台] ' + scrub(msg) + '\n');

// —— 一次性工作目录回收：超时路径上 taskkill 是异步的，进程还攥着 cwd 时 rm 会失败，
//    故登记在册、退出前带重试再扫一遍（同步睡，别把退出码耽误了）——
const 临时目录 = new Set();
const 同步睡 = (ms) => { const sab = new SharedArrayBuffer(4); Atomics.wait(new Int32Array(sab), 0, 0, ms); };
function 回收临时目录(retries) {
  for (let i = 0; i <= (retries || 0); i++) {
    for (const d of [...临时目录]) { try { fs.rmSync(d, { recursive: true, force: true }); 临时目录.delete(d); } catch { /* 还被占着，下轮再来 */ } }
    if (!临时目录.size) return;
    同步睡(800);
  }
}
const out = (o) => {
  回收临时目录(3);
  const j = {};
  for (const [k, v] of Object.entries(o)) j[k] = (typeof v === 'string') ? scrub(v) : v;
  process.stdout.write(JSON.stringify(j) + '\n');
  process.exit(j.ok ? 0 : 1);
};
process.on('uncaughtException', (e) => out({ ok: false, error: '未捕获异常：' + scrub(e && e.stack || e) }));
process.on('unhandledRejection', (e) => out({ ok: false, error: '未处理拒绝：' + scrub(e && e.stack || e) }));

// —— ANSI 洗白（codex 过程行带颜色码与光标序列，原样入 md 是乱码）——
const CSI = new RegExp('\u001B\\[[0-9;?]*[ -/]*[@-~]', 'g');
const ESCSEQ = new RegExp('\u001B[@-Z\\-_]', 'g');
const CTRL = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F]', 'g');
const clean = (s) => String(s || '').replace(CSI, '').replace(ESCSEQ, '').replace(CTRL, '');
// 时长人话（超时文案要能表达亚分钟值，演练时才好构造）
const 时长 = (ms) => (ms >= 60000 ? (ms / 60000).toFixed(ms % 60000 ? 1 : 0) + 'min' : Math.round(ms / 1000) + 's');

// ——————————————————————————————————————————————————————————
// 评审团发现：codex 一席 + 每个兼容池条目一席
// ——————————————————————————————————————————————————————————
function seats(cfg) {
  const list = [];
  const 模型 = cfg.模型 || {};
  list.push({ name: 'codex', kind: 'cli', model: 模型.codex默认 || '' });
  const 池 = cfg.执行池 || {};
  for (const [name, p] of Object.entries(池)) {
    const c = p && p.兼容;
    if (!c || !c.base || !c.key) continue;                 // 没配全的条目不入席（不猜、不报错）
    remember(c.key);                                       // 一入册就登记进净化表
    list.push({ name, kind: 'compat', base: String(c.base), key: String(c.key), model: c.模型 || c.model || '' });
  }
  return list;
}

// ——————————————————————————————————————————————————————————
// 统一评审提示词：逐章抬杠，输出「章节×意见×严重度」结构化清单
// 各家独立评审、互不可见（进程/请求彼此隔离，不串上下文）
// ——————————————————————————————————————————————————————————
function buildPrompt(file, text) {
  return [
    '你是资深技术评审员，现在对一份技术方案做独立评审。你的职责是抬杠——找问题，不是夸奖。',
    '',
    '【纪律】只读评审：不要修改任何文件、不要执行任何命令、不要访问网络，直接把评审结论写在回答里。',
    '',
    '【评审重点】逐章过一遍，重点盯四类：',
    '1. 缺失的不变量——文档默认成立但没写死的前提、边界、并发/时序假设；',
    '2. 路径划分的坑——绝对/相对路径、跨平台分隔符、工作目录、编码、命名冲突；',
    '3. 验证法漏洞——所谓「验收/自测」证明不了它声称的事，或能被平凡实现骗过；',
    '4. 实现风险——错误处理、超时、资源泄漏、回滚、兼容与迁移。',
    '',
    '【输出格式】先输出一个 markdown 表格，表头必须一字不差是：',
    '| 章节 | 意见 | 严重度 |',
    '严重度取值只能是 高 / 中 / 低。一行一条意见，「章节」写文档里的小节标题或行号区间，',
    '「意见」一句话说清问题与后果（必要时带一句最小修法）。至少 8 条，宁可尖锐不要凑数。',
    '表格之后可附不超过 5 行的总体判断。不要复述文档原文。',
    '',
    `【被评审方案】文件：${file}`,
    '```markdown',
    text,
    '```',
  ].join('\n');
}

// ——————————————————————————————————————————————————————————
// 意见计数：以「章节×意见×严重度」表格数据行为准，无表格时退回条目行计数
// ——————————————————————————————————————————————————————————
function countOpinions(text) {
  const lines = String(text || '').split(/\r?\n/);
  let rows = 0;
  for (const raw of lines) {
    const l = raw.trim();
    if (!/^\|.*\|$/.test(l)) continue;
    if (/^[|\s:-]+$/.test(l)) continue;                                        // 分隔行
    const cells = l.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length < 2) continue;
    if (/^章节$/.test(cells[0]) || /严重度/.test(l) && /章节/.test(l)) continue; // 表头
    if (!cells.some((c) => c)) continue;
    rows++;
  }
  if (rows) return rows;
  return lines.filter((l) => /^\s*(?:\d+[.)、]|[-*+])\s+\S/.test(l)).length;
}

// ——————————————————————————————————————————————————————————
// 兼容池一席：https 直调 Anthropic 兼容 /v1/messages
// 国内端点剥代理直连（runner.js 实测：兼容池挂代理会挂起），故不注入 proxy agent。
// ——————————————————————————————————————————————————————————
function askCompat(seat, prompt, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let u;
    try { u = new URL(seat.base.replace(/\/+$/, '') + '/v1/messages'); }
    catch { return resolve({ err: `兼容池 base 不是合法 URL：${seat.base}` }); }
    const body = JSON.stringify({
      model: seat.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });
    const mod = u.protocol === 'http:' ? http : https;
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { req.destroy(); } catch { /* 已断 */ } resolve({ ...r, ms: Date.now() - t0 }); };
    const timer = setTimeout(() => finish({ err: `超时（${时长(timeoutMs)} 未出结论）` }), timeoutMs);
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': seat.key,                          // 密钥只活在这一行的请求头里
        authorization: 'Bearer ' + seat.key,            // 部分兼容端点只认 Bearer，双给
        'content-length': Buffer.byteLength(body),
      },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return finish({ err: `HTTP ${res.statusCode}：${String(buf).slice(0, 400)}` });
        let j;
        try { j = JSON.parse(buf); } catch { return finish({ err: '应答不是 JSON：' + String(buf).slice(0, 300) }); }
        if (j.error) return finish({ err: '端点报错：' + JSON.stringify(j.error).slice(0, 400) });
        const text = Array.isArray(j.content) ? j.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('\n').trim() : '';
        if (!text) return finish({ err: '应答里没有文本内容（content 为空）' });
        const usage = j.usage ? { 入: j.usage.input_tokens, 出: j.usage.output_tokens } : null;
        finish({ text, usage, model: j.model || seat.model });
      });
    });
    req.on('error', (e) => finish({ err: '请求失败：' + (e && e.message || e) }));
    req.setTimeout(timeoutMs, () => finish({ err: `连接静默超时（${时长(timeoutMs)}）` }));
    req.end(body);
  });
}

// ——————————————————————————————————————————————————————————
// codex 一席：codex exec，提示词走 stdin（中文走 argv 会被 Windows 命令行编码吃掉）
// 旗标 --dangerously-bypass-approvals-and-sandbox 必带，否则审批弹窗把无头会话卡死。
// cwd 指向一次性空目录：本席只做纸面评审，不给它任何仓库当作业本。
// ——————————————————————————————————————————————————————————
function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') { try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); return; } catch { /* 回落 */ } }
  try { child.kill('SIGKILL'); } catch { /* 已死 */ }
}
function askCodex(seat, prompt, timeoutMs, cfg) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = { ...process.env };
    const p = env.HTTPS_PROXY || env.https_proxy || (cfg.网络 && cfg.网络.代理默认) || '';
    if (p) { env.HTTPS_PROXY = p; env.HTTP_PROXY = p; env.https_proxy = p; env.http_proxy = p; } // 无头 CLI 必须显式注入代理
    let cwd = null;
    try { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'review-codex-')); 临时目录.add(cwd); } catch { cwd = os.tmpdir(); }
    const argv = ['exec', '--dangerously-bypass-approvals-and-sandbox', ...(seat.model ? ['-m', seat.model] : []), '-'];
    let child;
    try { child = spawn('codex', argv, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ err: 'codex CLI 起不来（本机未安装或不在 PATH）：' + (e && e.message || e), ms: Date.now() - t0 }); }
    let so = '', se = '', done = false;
    const finish = (r) => {
      if (done) return; done = true; clearTimeout(timer);
      if (临时目录.has(cwd)) { try { fs.rmSync(cwd, { recursive: true, force: true }); 临时目录.delete(cwd); } catch { /* 进程还没死透，退出前统一回收 */ } }
      resolve({ ...r, ms: Date.now() - t0 });
    };
    const timer = setTimeout(() => { killTree(child); finish({ err: `超时（${时长(timeoutMs)} 未收线），已终止该席会话` }); }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { so += d; });
    child.stderr.on('data', (d) => { se += d; });
    child.on('error', (e) => { finish({ err: 'codex 进程异常：' + (e && e.message || e) }); });
    child.on('close', (code) => {
      const text = clean(so).trim();
      if (text) return finish({ text, model: seat.model || 'codex 默认档', code });
      // codex 过程输出全走 stderr，stdout 空 = 真没出终答，拿 stderr 尾巴当死因
      finish({ err: `退出码 ${code} 且无最终答案；stderr 尾：${clean(se).slice(-600) || '（空）'}` });
    });
    try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); }
    catch (e) { killTree(child); finish({ err: 'stdin 投喂失败：' + (e && e.message || e) }); }
  });
}

// —— 合集 md 组稿 ——
function renderReport(file, results, meta) {
  const L = [];
  L.push('# 异厂评审意见合集');
  L.push('');
  L.push(`- 方案：\`${file}\``);
  L.push(`- 评审时间：${meta.at}`);
  L.push(`- 评审团（自动发现）：${results.map((r) => `${r.name}${r.err ? '（缺席）' : ''}`).join('、')}`);
  L.push(`- 在席 ${results.filter((r) => !r.err).length} / ${results.length}，意见合计 ${meta.total} 条`);
  L.push(`- 单厂超时闸：${meta.闸}`);
  L.push('');
  L.push('> 各家独立评审、互不可见；以下为各家原文，未做删改（仅做密钥净化与控制符清洗）。');
  L.push('');
  for (const r of results) {
    L.push(`## ${r.name}`);
    L.push('');
    if (r.err) {
      L.push(`- 状态：**缺席**（原因：${scrub(r.err)}）`);
      L.push(`- 耗时：${(r.ms / 1000).toFixed(1)}s`);
      L.push('');
      continue;
    }
    L.push(`- 状态：在席 · 模型 \`${r.model || '（默认）'}\` · 耗时 ${(r.ms / 1000).toFixed(1)}s · 意见 ${r.count} 条${r.usage ? ` · tokens 入${r.usage.入}/出${r.usage.出}` : ''}`);
    L.push('');
    L.push(scrub(r.text));
    L.push('');
  }
  return L.join('\n');
}

(async () => {
  // ① 方案文件
  const file = args.file && String(args.file);
  if (!file || file === 'true') return out({ ok: false, error: '必填 --file <方案md绝对路径>' });
  const abs = path.resolve(file);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return out({ ok: false, error: `方案文件不存在：${abs}` });
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { return out({ ok: false, error: `方案读不出来：${abs} —— ${e.message}` }); }
  if (!text.trim()) return out({ ok: false, error: `方案是空文件：${abs}` });

  // ② config（只读；--config 可指临时副本做演练，绝不写回）
  const cfgPath = path.resolve(String(args.config && args.config !== true ? args.config : DEFAULT_CONFIG));
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); }
  catch (e) { return out({ ok: false, error: `读不了监制台 config：${cfgPath} —— ${e.message}` }); }
  remember((cfg.网络 && cfg.网络.远程 && cfg.网络.远程.令牌) || ''); // 顺手把远程令牌也纳入净化表

  // ③ 评审团名册
  let team = seats(cfg);
  if (args.only && args.only !== true) {
    const want = String(args.only).split(',').map((s) => s.trim()).filter(Boolean);
    team = team.filter((s) => want.includes(s.name));
    if (!team.length) return out({ ok: false, error: `--only 点名的席位都不在名册里：${want.join(',')}（名册：${seats(cfg).map((s) => s.name).join(',')}）` });
  }
  const 名册 = team.map((s) => s.name);
  if (args.dry) return out({ ok: true, 评审团: 名册, 意见数: 0, out: null, dry: true, 席位: team.map((s) => ({ 名: s.name, 类型: s.kind, 模型: s.model || '（默认）' })) });

  // ④ 开评（并行，各家独立互不可见；单厂超时/失败只记缺席）
  const t = Number(args['timeout-min']);
  const timeoutMin = (Number.isFinite(t) && t > 0) ? t : 5;          // 非法/缺省一律回默认 5min
  const timeoutMs = Math.max(1000, timeoutMin * 60000);              // 下限 1s（演练可给亚分钟值）
  const prompt = buildPrompt(abs, text);
  say(`方案 ${path.basename(abs)}（${text.length} 字）→ 评审团 [${名册.join(', ')}]，单厂闸 ${时长(timeoutMs)}，开评…`);
  const results = await Promise.all(team.map(async (s) => {
    const r = s.kind === 'cli' ? await askCodex(s, prompt, timeoutMs, cfg) : await askCompat(s, prompt, timeoutMs);
    const one = { name: s.name, ms: r.ms || 0, model: r.model || s.model, usage: r.usage || null };
    if (r.err) { say(`${s.name} 缺席：${r.err}`); return { ...one, err: r.err }; }
    const count = countOpinions(r.text);
    say(`${s.name} 交卷：${count} 条意见 / ${(one.ms / 1000).toFixed(1)}s`);
    return { ...one, text: r.text, count };
  }));

  // ⑤ 落盘 + 一行 JSON 摘要
  const seated = results.filter((r) => !r.err);
  const total = seated.reduce((n, r) => n + r.count, 0);
  const at = new Date().toISOString();
  const defaultOut = path.join(path.dirname(abs), `${path.basename(abs, path.extname(abs))}-评审意见.md`);
  const outPath = path.resolve(String(args.out && args.out !== true ? args.out : defaultOut));
  let wrote = null;
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, renderReport(abs, results, { at, total, 闸: 时长(timeoutMs) }), 'utf8');
    wrote = outPath;
  } catch (e) { say(`合集落盘失败：${e.message}`); }

  return out({
    ok: seated.length > 0,                                  // 全场空手才 ok:false
    评审团: 名册,
    意见数: total,
    out: wrote,
    在席: seated.map((r) => r.name),
    缺席: results.filter((r) => r.err).map((r) => ({ 厂: r.name, 原因: scrub(r.err) })),
    ...(seated.length ? {} : { error: '全场缺席，无一家交卷' }),
  });
})();
