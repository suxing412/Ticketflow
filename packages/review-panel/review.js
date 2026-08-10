#!/usr/bin/env node
// review.js — 异厂评审台（施工令-013 · H88 配套；施工令-019 红队立场卷制 · H91 配套）
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
//   密钥取值三级（施工令-030）：DPAPI 托管（<config 同目录>/凭据.json）→ config 兼容段明文
//   → 环境变量 REVIEW_KEY_<池名大写>。studio 不在场 / DPAPI 不可用一律静默回落，不硬崩。
//
// 红队立场卷制（施工令-019）：评审团按席序轮换领卷——可行性红队 / 不变量红队 / 成本红队；
//   单厂在席时独领全部三卷，两厂时甲领一三乙领二，三厂及以上一席一卷、超出继续轮发。
//   行「击杀制」：每卷必须尝试构造具体失败场景（输入/状态/时序），构造不出要明写
//   「未能构造击杀」——该声明本身即通过证据；泛泛意见不算完卷。
//   输出向后兼容：表格仍以「章节 | 意见 | 严重度」开头，卷别与击杀标追加为第 4/5 列。
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
// 凭据托管读取（施工令-030；案源 H94 补巡：deepseek 全场缺席）
// ——————————————————————————————————————————————————————————
// 施工令-029 把 deepseek 的 key 迁进了 DPAPI 托管（<工作区>/凭据.json），config 兼容段的
// key 从此是空串。评审台当时没跟上，于是 seats() 的「没配全不入席」把 deepseek 静静滤掉了——
// 不报错、不告警，只是名册里少一个人。这种失明比崩溃更贵：红队环节全场缺席都没人发现。
//
// 本包是**公共包**，不能假设 apps/studio 在场（协作者只拿 packages/ 的机器是常态），故三条纪律：
//   ① creds 模块用「找得到就用、找不到就算了」的方式加载，任何 require 异常都不许冒泡；
//   ② 托管库与 config **同工作区**：root = dirname(cfgPath)。--config 指临时副本时托管口也跟着走，
//      演练绝不会摸到生产托管库；
//   ③ 三级取值：托管 → config 明文 → 环境变量 REVIEW_KEY_<池名>。前两级都没有时环境变量兜底，
//      让没有 studio、没有 DPAPI 的 CI/协作者机器照样能开评。
const CREDS_候选 = [
  ['..', '..', 'apps', 'studio', 'lib', 'creds.js'],   // 仓内并排布局：packages/review-panel → 仓库根
  ['..', 'apps', 'studio', 'lib', 'creds.js'],
];
let _creds; // undefined=还没找过，null=找过但没有
function 托管模块() {
  if (_creds !== undefined) return _creds;
  _creds = null;
  // 注入口 REVIEW_CREDS_MODULE 是**覆盖**不是追加：设了就只认它。
  // 追加语义会让"模拟托管不在场"变成不可能（内置候选还在，照样找得到真 creds），
  // 于是「协作者环境」那条路径永远测不到——本机自测当场抓到（改前那一发 deepseek 仍在席）。
  const 候选 = process.env.REVIEW_CREDS_MODULE
    ? [path.resolve(process.env.REVIEW_CREDS_MODULE)]
    : CREDS_候选.map((seg) => path.resolve(__dirname, ...seg));
  for (const p of 候选) {
    try {
      if (!fs.existsSync(p)) continue;
      const m = require(p);
      if (m && typeof m.getKey === 'function' && typeof m.has === 'function') { _creds = m; break; }
    } catch { /* 加载不了就当没有——评审台的价值是"能开评"，不是"必须有托管" */ }
  }
  return _creds;
}
const 环境变量名 = (池) => 'REVIEW_KEY_' + String(池).toUpperCase().replace(/[^A-Z0-9]/g, '_');

// 单个兼容池条目的凭据解析：托管 → config → 环境变量，**字段粒度**兜底。
// 字段粒度那一条是 029 的教训：托管里只有 key 时 base 必须回落 config，
// 否则第三方 key 会被发到官方端点去（必 401，且密钥递给了错误的收件人）。
function 解析凭据(name, c, root) {
  let key = ''; let 来源 = '';
  let base = c && c.base ? String(c.base) : '';
  let model = (c && (c.模型 || c.model)) || '';
  const creds = root ? 托管模块() : null;
  if (creds && root) {
    try {
      if (creds.has(root, name)) {
        const k = creds.getKey(root, name);
        if (k) {
          const m = (typeof creds.meta === 'function' && creds.meta(root, name)) || {};
          key = String(k); 来源 = '托管';
          if (m.base) base = String(m.base);
          if (m.模型) model = m.模型;
        }
      }
    } catch { /* DPAPI 挂了 / 非 Windows / PowerShell 不在 → 往下回落，不硬崩 */ }
  }
  if (!key && c && c.key) { key = String(c.key); 来源 = 'config'; }
  if (!key) { const e = process.env[环境变量名(name)]; if (e && e.trim()) { key = e.trim(); 来源 = '环境变量'; } }
  return { key, base, model, 来源 };
}

// ——————————————————————————————————————————————————————————
// 评审团发现：codex 一席 + 每个兼容池条目一席
// ——————————————————————————————————————————————————————————
function seats(cfg, cfgPath) {
  const list = [];
  const 模型 = cfg.模型 || {};
  list.push({ name: 'codex', kind: 'cli', model: 模型.codex默认 || '' });
  const root = cfgPath ? path.dirname(path.resolve(cfgPath)) : null;
  const 池 = cfg.执行池 || {};
  for (const [name, p] of Object.entries(池)) {
    const c = p && p.兼容;
    if (!c) continue;                                      // 压根不是兼容池，跳过
    const { key, base, model, 来源 } = 解析凭据(name, c, root);
    if (!key || !base) continue;                           // 没配全的条目不入席（不猜、不报错）
    remember(key);                                         // 一入册就登记进净化表
    list.push({ name, kind: 'compat', base, key, model, 凭据来源: 来源 });
  }
  return list;
}

// ——————————————————————————————————————————————————————————
// 立场卷（施工令-019 · H91 配套）：评审不再是「一人一份泛意见」，而是三支红队分立场开火。
// 各家独立评审、互不可见（进程/请求彼此隔离，不串上下文）——立场分工只由本台派发，厂商之间不知道彼此领了什么。
// ——————————————————————————————————————————————————————————
const 立场卷 = [
  {
    名: '可行性红队',
    要旨: '找实现不了的点——方案里被当作「照做即可」的步骤，实际受限于接口能力／权限／平台／依赖版本／数据不可得，根本做不出来。',
    抓手: '所需接口是否真存在且吐得出那几个字段；跨平台差异（Windows 路径与分隔符、编码、进程与信号模型）；权限与凭据从哪来；第三方限速、配额与鉴权；并发与超时下的真实行为而非文档承诺。',
  },
  {
    名: '不变量红队',
    要旨: '找清单漏掉的承重约束——文档默认成立却没写死的前提、边界、时序与并发假设，一旦被破坏整套逻辑当场塌方。',
    抓手: '状态机的残缺态与非法转移；跨进程／跨会话的读写竞争；失败中断留下的半成品；幂等与重放；空集、单元素与超大集；编码／换行／大小写；回滚与迁移路径。',
  },
  {
    名: '成本红队',
    要旨: '找烧穿工期与额度的暗礁——看着一行代码、实则拖出长尾的活。',
    抓手: '隐藏返工面（改一处牵动多处）；测试与取证的真实耗时；token／调用量随规模的增长曲线；需要人工介入的频次；维护期负担与不可逆的技术锁定。',
  },
];

// —— 派卷：按序轮换发牌。两条硬性质：①每张卷都有主 ②每席都有卷。
//    单厂在席 → 独厂领全部三卷（施工令-019 明定）；两厂 → 甲领一三、乙领二；
//    三厂及以上 → 一席一卷，超出三席继续按序轮着发（新厂入席零改动）。
function 派卷(n) {
  const 派 = Array.from({ length: Math.max(0, n) }, () => []);
  if (!派.length) return 派;
  const 张数 = Math.max(立场卷.length, n);              // 至少把三卷发完，席多则每席保底一卷
  for (let j = 0; j < 张数; j++) 派[j % n].push(立场卷[j % 立场卷.length]);
  return 派;
}
const 卷名 = (卷组) => (卷组 || []).map((s) => s.名).join('、');

// ——————————————————————————————————————————————————————————
// 评审提示词：按席位领到的立场卷组稿，行「击杀制」——每卷必须尝试构造具体失败场景。
// 输出格式向后兼容：仍是「章节 | 意见 | 严重度」开头的表格，卷别与击杀标追加在后两列。
// ——————————————————————————————————————————————————————————
function buildPrompt(file, text, 卷组) {
  const 卷 = (卷组 && 卷组.length) ? 卷组 : 立场卷;
  const 下限 = 3 * 卷.length;
  const L = [
    '你是资深技术评审员，现在以**红队**身份、按指派的立场卷对一份技术方案做独立评审。',
    '你的职责是击杀——构造能让这份方案当场失败的具体场景，不是夸奖，也不是泛泛提醒。',
    '',
    '【纪律】只读评审：不要修改任何文件、不要执行任何命令、不要访问网络，直接把评审结论写在回答里。',
    '',
    `【你领到的立场卷】共 ${卷.length} 卷，只按这些立场开火，别人的立场不用替他管：`,
  ];
  卷.forEach((s, i) => {
    L.push(`■ 第${i + 1}卷 · ${s.名}`);
    L.push(`  要旨：${s.要旨}`);
    L.push(`  抓手：${s.抓手}`);
  });
  L.push('');
  L.push('【击杀制】每一卷都必须至少尝试构造一个**具体失败场景**——把 输入 / 状态 / 时序 里至少一项写成具体取值，');
  L.push('说清它怎么触发、失败长什么样、后果多大。判定只有两种：');
  L.push('- 构造出来了 → 该条「击杀」列标 击杀；');
  L.push(`- 确实构造不出来 → 必须在完卷声明里原样写「第k卷 <卷名>：未能构造击杀」。**这句话本身就是该卷的通过证据**，如实写不扣分；`);
  L.push('  但只给泛泛意见而不写这句，视为该卷未完卷。');
  L.push('- 泛泛意见（「建议加强错误处理」「注意兼容性」这类没有具体触发条件的话）不算完卷，更不许标 击杀。');
  L.push('');
  L.push('【输出格式】先输出一个 markdown 表格，表头必须一字不差是：');
  L.push('| 章节 | 意见 | 严重度 | 卷别 | 击杀 |');
  L.push('- 「章节」写文档里的小节标题或行号区间；');
  L.push('- 「意见」一句话说清 触发条件 → 失败后果（必要时带一句最小修法）；');
  L.push('- 「严重度」只能取 高 / 中 / 低；');
  L.push(`- 「卷别」只能取你领到的卷名之一：${卷名(卷)}；`);
  L.push('- 「击杀」只能取 击杀 / 未杀。');
  L.push(`一行一条，每卷至少 3 条，合计不少于 ${下限} 条，宁可尖锐不要凑数。`);
  L.push('表格之后逐卷写一行完卷声明，格式二选一：');
  L.push('「第k卷 <卷名>：击杀 N 条」或「第k卷 <卷名>：未能构造击杀」。');
  L.push('最后可附不超过 5 行的总体判断。不要复述文档原文。');
  L.push('');
  L.push(`【被评审方案】文件：${file}`);
  L.push('```markdown');
  L.push(text);
  L.push('```');
  return L.join('\n');
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
// 击杀计数（施工令-019）：只认表格数据行里独立成格的 击杀 / 未杀 标，
// 不拿正文里的「未能构造击杀」当命中（那是完卷声明，不是条目）。
// ——————————————————————————————————————————————————————————
function countKills(text) {
  const r = { 击杀: 0, 未杀: 0, 未能构造击杀: /未能构造击杀/.test(String(text || '')) };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim();
    if (!/^\|.*\|$/.test(l) || /^[|\s:-]+$/.test(l)) continue;
    const cells = l.slice(1, -1).split('|').map((c) => c.trim());
    if (/^章节$/.test(cells[0]) || (/严重度/.test(l) && /章节/.test(l))) continue;   // 表头自身带「击杀」字样，别把表头算成一条
    if (cells.some((c) => /^击杀$/.test(c))) r.击杀++;
    else if (cells.some((c) => /^未杀$/.test(c))) r.未杀++;
  }
  return r;
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
  L.push(`- 在席 ${results.filter((r) => !r.err).length} / ${results.length}，意见合计 ${meta.total} 条，击杀 ${meta.击杀} 条 / 未杀 ${meta.未杀} 条`);
  L.push(`- 立场卷派发（红队制，施工令-019）：${results.map((r) => `${r.name}=${r.卷 || '（无）'}`).join('；')}`);
  if (meta.漏卷 && meta.漏卷.length) L.push(`- **缺席致落空的立场卷：${meta.漏卷.join('、')}**（该立场本轮无人开火，采信时须自行补位）`);
  L.push(`- 单厂超时闸：${meta.闸}`);
  L.push('');
  L.push('> 各家独立评审、互不可见，各自只领到本席的立场卷（谁领了什么互相不知）；');
  L.push('> 击杀制：每卷须构造具体失败场景，构造不出须明写「未能构造击杀」——该声明即通过证据。');
  L.push('> 以下为各家原文，未做删改（仅做密钥净化与控制符清洗）。');
  L.push('');
  for (const r of results) {
    L.push(`## ${r.name}`);
    L.push('');
    L.push(`- 立场卷：${r.卷 || '（无）'}`);
    if (r.err) {
      L.push(`- 状态：**缺席**（原因：${scrub(r.err)}）—— 上列立场卷本轮落空`);
      L.push(`- 耗时：${(r.ms / 1000).toFixed(1)}s`);
      L.push('');
      continue;
    }
    L.push(`- 状态：在席 · 模型 \`${r.model || '（默认）'}\` · 耗时 ${(r.ms / 1000).toFixed(1)}s · 意见 ${r.count} 条${r.usage ? ` · tokens 入${r.usage.入}/出${r.usage.出}` : ''}`);
    L.push(`- 战果：击杀 ${r.kill.击杀} 条 / 未杀 ${r.kill.未杀} 条${r.kill.未能构造击杀 ? ' · 含「未能构造击杀」声明' : ''}`);
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
  let team = seats(cfg, cfgPath);
  if (args.only && args.only !== true) {
    const want = String(args.only).split(',').map((s) => s.trim()).filter(Boolean);
    team = team.filter((s) => want.includes(s.name));
    if (!team.length) return out({ ok: false, error: `--only 点名的席位都不在名册里：${want.join(',')}（名册：${seats(cfg, cfgPath).map((s) => s.name).join(',')}）` });
  }
  const 名册 = team.map((s) => s.name);
  // ③′ 立场卷派发（施工令-019）：按在册席序轮换，单厂在席即独领三卷
  const 派 = 派卷(team.length);
  team.forEach((s, i) => { s.卷组 = 派[i] || []; });
  if (args.dry) {
    return out({
      ok: true, 评审团: 名册, 意见数: 0, out: null, dry: true,
      立场卷: Object.fromEntries(team.map((s) => [s.name, s.卷组.map((x) => x.名)])),
      // 凭据来源摆进 dry 名册（施工令-030）："deepseek 在席"与"deepseek 从哪取的 key"是两件事，
      // 只报前者的话，托管挂了悄悄回落 config 明文也看不出来。key 本身不出现。
      席位: team.map((s) => ({ 名: s.name, 类型: s.kind, 模型: s.model || '（默认）', 领卷: 卷名(s.卷组), 凭据: s.凭据来源 || '—' })),
    });
  }

  // ④ 开评（并行，各家独立互不可见；单厂超时/失败只记缺席）
  const t = Number(args['timeout-min']);
  const timeoutMin = (Number.isFinite(t) && t > 0) ? t : 5;          // 非法/缺省一律回默认 5min
  const timeoutMs = Math.max(1000, timeoutMin * 60000);              // 下限 1s（演练可给亚分钟值）
  say(`方案 ${path.basename(abs)}（${text.length} 字）→ 评审团 [${名册.join(', ')}]，单厂闸 ${时长(timeoutMs)}，立场卷 ${team.map((s) => `${s.name}=${卷名(s.卷组)}`).join('；')}，开评…`);
  const results = await Promise.all(team.map(async (s) => {
    const prompt = buildPrompt(abs, text, s.卷组);                      // 一席一份提示词：各领各的立场卷
    const r = s.kind === 'cli' ? await askCodex(s, prompt, timeoutMs, cfg) : await askCompat(s, prompt, timeoutMs);
    const one = { name: s.name, ms: r.ms || 0, model: r.model || s.model, usage: r.usage || null, 卷: 卷名(s.卷组) };
    if (r.err) { say(`${s.name} 缺席：${r.err}（立场卷「${one.卷}」落空）`); return { ...one, err: r.err }; }
    const count = countOpinions(r.text);
    const kill = countKills(r.text);
    say(`${s.name} 交卷：${count} 条意见（击杀 ${kill.击杀} / 未杀 ${kill.未杀}）/ ${(one.ms / 1000).toFixed(1)}s`);
    return { ...one, text: r.text, count, kill };
  }));

  // ⑤ 落盘 + 一行 JSON 摘要
  const seated = results.filter((r) => !r.err);
  const total = seated.reduce((n, r) => n + r.count, 0);
  const 击杀 = seated.reduce((n, r) => n + r.kill.击杀, 0);
  const 未杀 = seated.reduce((n, r) => n + r.kill.未杀, 0);
  const 在席卷 = new Set(seated.flatMap((r) => (r.卷 ? r.卷.split('、') : [])));
  const 漏卷 = 立场卷.map((s) => s.名).filter((n) => !在席卷.has(n));   // 缺席带走的立场，如实标出
  const at = new Date().toISOString();
  const defaultOut = path.join(path.dirname(abs), `${path.basename(abs, path.extname(abs))}-评审意见.md`);
  const outPath = path.resolve(String(args.out && args.out !== true ? args.out : defaultOut));
  let wrote = null;
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, renderReport(abs, results, { at, total, 击杀, 未杀, 漏卷, 闸: 时长(timeoutMs) }), 'utf8');
    wrote = outPath;
  } catch (e) { say(`合集落盘失败：${e.message}`); }

  return out({
    ok: seated.length > 0,                                  // 全场空手才 ok:false
    评审团: 名册,
    意见数: total,
    击杀数: 击杀,
    未杀数: 未杀,
    立场卷: Object.fromEntries(results.map((r) => [r.name, r.卷])),
    ...(漏卷.length ? { 落空立场卷: 漏卷 } : {}),
    out: wrote,
    在席: seated.map((r) => r.name),
    缺席: results.filter((r) => r.err).map((r) => ({ 厂: r.name, 原因: scrub(r.err) })),
    ...(seated.length ? {} : { error: '全场缺席，无一家交卷' }),
  });
})();
