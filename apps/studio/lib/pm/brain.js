// pm/brain.js — 项目管理的判断脑（H49）：fable 档，事件唤醒，只出建议不落裁决
// v0.18-alpha 职能：切单（拍板父单 → 单元子单草稿 + 拆单简报呈 Claude 审批）。
// 硬边界：产出全为草稿与简报——放行/裁决权不在此模块（人本化）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const store = require('../core/store');
const ledger = require('./ledger');

// 管理费记账（H49 报表单列，0.22.3 补接线）：从事件流提取真实用量入台账
function extractUsage(raw) {
  let inTok = 0, outTok = 0;
  for (const line of String(raw).split(String.fromCharCode(10))) {
    const s = line.replace(String.fromCharCode(13), '').trim();
    if (!s.startsWith('{')) continue;
    try { const e = JSON.parse(s);
      const u = (e.usage) || (e.message && e.message.usage);
      if (u) { if (u.input_tokens) inTok = Math.max(inTok, u.input_tokens + (u.cache_read_input_tokens || 0)); if (u.output_tokens) outTok += u.output_tokens; }
    } catch { /* 忽略 */ }
  }
  return { input: inTok, output: outTok };
}
function billFee(root, 用途, raw) {
  try { const u = extractUsage(raw);
    ledger.update(root, (l) => { l.管理费 = l.管理费 || { token合计: 0, 次数: 0 };
      l.管理费.token合计 += u.input + u.output; l.管理费.次数 += 1;
      l.管理费.明细 = l.管理费.明细 || []; l.管理费.明细.push({ t: new Date().toISOString(), 用途, tokens: u.input + u.output });
      if (l.管理费.明细.length > 200) l.管理费.明细 = l.管理费.明细.slice(-200);
    });
  } catch { /* 记账失败不阻塞 */ }
}

function cli() {
  const home = os.homedir();
  const cands = [path.join(home, '.local', 'bin', 'claude.exe'), path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'), 'claude'];
  return cands.find((c) => c === 'claude' || fs.existsSync(c));
}

// 切单提示词：六件套纪律 + 单型库 + 单元标准 + 机器可读输出契约
function buildCutPrompt(root, cfg, parent, projPath) {
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
  const 单元 = (cfg.单元 || {});
  return [
    '你是单流的「项目管理」职能（fable 档）。任务：把下面的拍板父单切成单元子单草稿。',
    `项目仓库（可读，用于仓况盘点）：${projPath || '（未注册）'}`,
    '',
    '=== 拆单六件套（缺一不拆，按序执行）===',
    '①仓况盘点：先扫项目仓相关目录，列出已有实现，绝不重复造轮',
    '②调研先行判断：未知数多则第一张子单必须是调研单',
    '③历史校准：预计时间用 agent 实测口径（' + (单元.小时 || 0.25) + 'h/单元，≤' + (单元.token || 50000) + ' token）',
    '④协议选段：把相关纪律写进各子单「不要做」与验收标准',
    '⑤依赖建模：同写区串行（依赖链）、异写区并行；标注红链',
    '⑥单元合规自检：每张 ≤2 单元、单一写区、验收标准全部可判定（GWT/勾选）',
    '⑧验收锚点归位（TK-78/75 两案）：受控重建、SavedScene 在位断言、场景体积闸这类收尾锚点，只准写进最后一张装配单的验收标准——写进前置单必与其「不要做」互斥，烧判官轮次',
    '⑦结构归位（H50/H51）：工单树是项管资产，管线是顶层单位——若本父单无管线章（frontmatter 管线: P-#），在简报里提出应挂入的既有管线，或建议开新线（开线是制作人人闸，你只有建议权）；判不出写「呈制作人定归属」',
    '',
    '=== 单型库（只从四型选：调研单/实现单/装配单/修复单）===',
    '不设收口单（H56）：全部子单完成后项管自动生成收口报告、专项父单自动转待验收——制作人的保留签字在父单，一个专项只签一次（H53）。最后一张实现/装配单须含受控重建与全量测试绿的交付责任。',
    '',
    '=== 输出契约（机器解析，严格遵守）===',
    '每张子单一个代码块，格式：',
    '```ticket',
    'title: <标题>',
    '单型: <调研单|实现单|装配单|修复单|收口单>',
    '职能: <策划|程序|美术|QA|装配>',
    '产出物类型: <代码|文档|资产|规格|场景>',
    '优先级: <P0|P1|P2>',
    'QA: <开|关>',
    '验收方式: <委托|保留>',
    '预计时间: <小时数>',
    '预计token: <数字>',
    '依赖: <逗号分隔的同批序号如 1,2；无则留空>',
    '---',
    '<正文：## 范围 / ## 不要做 / ## 验收标准>',
    '```',
    '全部子单之后，输出「## 拆单简报」：切法理由、依赖图、红链、预计总耗时与总 token。',
    '',
    '=== 拍板父单 ===',
    parent.body || '',
    '',
    '（父单 frontmatter：项目=' + (parent.fm.项目 || '') + '，编号=' + parent.id + '）',
  ].join('\n');
}

// 解析输出契约 → 子单数组
function parseTickets(text) {
  const out = [];
  const re = /```ticket\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const [head, ...bodyParts] = m[1].split(/^---$/m);
    const fm = {};
    for (const line of head.split('\n')) {
      const mm = line.match(/^([\w一-鿿]+):\s*(.*)$/);
      if (mm) fm[mm[1]] = mm[2].trim();
    }
    out.push({ fm, body: bodyParts.join('---').trim() });
  }
  const brief = (text.match(/## 拆单简报[\s\S]*$/) || [''])[0].trim();
  return { tickets: out, brief };
}

// 切单主流程：调 fable → 解析 → 建草稿挂父单 → 简报落台账待审
function cut(root, cfg, parentId, projPath, cb) {
  const parent = store.find(root, parentId);
  if (!parent) return cb({ ok: false, error: '父单不存在' });
  const prompt = buildCutPrompt(root, cfg, parent, projPath);
  const cmd = cli();
  const model = (cfg.模型 || {}).项管 || 'fable';
  const child = spawn(cmd, ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'],
    { cwd: projPath || undefined, env: { ...process.env }, windowsHide: true, shell: String(cmd).endsWith('.cmd') }); // cwd=项目仓：项管盘点有读权（首切简报暴露的盲区）
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 900000) out = out.slice(-450000); });
  const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /**/ } }, 20 * 60000);
  if (timer.unref) timer.unref();
  child.on('close', () => {
    clearTimeout(timer);
    const text = require('../runner').extractClaudeText(out);
    const { tickets, brief } = parseTickets(text);
    if (!tickets.length) return cb({ ok: false, error: '切单输出无子单块', raw: text.slice(0, 500) });
    // 派号 + 建草稿（依赖引用同批序号→实际编号）
    const px = (String(parentId).match(/^(.+)-(\d+)$/) || [])[1] || 'TK';
    let mx = 0;
    for (const s of store.STATES) for (const x of store.list(root, s)) {
      const mm = String(x.id).match(/^(.+)-(\d+)$/);
      if (mm && mm[1] === px) mx = Math.max(mx, Number(mm[2]));
    }
    const ids = tickets.map(() => `${px}-${++mx}`);
    const created = [];
    tickets.forEach((tk, i) => {
      const dep = String(tk.fm.依赖 || '').split(/[，,\s]+/).filter(Boolean)
        .map((n) => ids[Number(n) - 1]).filter(Boolean).join('，');
      const fm = {
        id: ids[i], title: tk.fm.title || '子单', 职能: tk.fm.职能 || '程序',
        产出物类型: tk.fm.产出物类型 || '代码', 优先级: tk.fm.优先级 || 'P1', 规模: '单兵',
        QA: tk.fm.QA || '开', 验收方式: tk.fm.验收方式 || '委托',
        预计时间: tk.fm.预计时间 || '0.25', 预计token: tk.fm.预计token || '50000',
        项目: parent.fm.项目, 创建时间: new Date().toISOString().slice(0, 10),
        父单: parentId, ...(dep ? { 依赖: dep } : {}), 单型: tk.fm.单型 || '实现单', 切单人: '项管',
      };
      const r = store.create(root, ids[i], fm, tk.body);
      if (r.ok) created.push(ids[i]);
    });
    // 简报落台账，事件=待审（Claude 制作人层审批后放行）
    const briefPath = path.join(ledger.DIR(root), `拆单简报-${parentId}.md`);
    fs.mkdirSync(ledger.DIR(root), { recursive: true });
    fs.writeFileSync(briefPath, `# 拆单简报 · ${parentId}\n\n子单：${created.join('、')}\n\n${brief || '（项管未附简报）'}\n`, 'utf8');
    ledger.event(root, '待审', { 父单: parentId, 子单: created, 简报: briefPath });
    // 0.23.3：拆单简报本体主动贴进项管信道——制作人不该去翻台账文件（用户实测困惑）
    try { require('../relay').append(root, '项管', '拆单完成：' + parentId + ' → ' + created.join('、') + '（简报呈 Claude 审批后放行）' + String.fromCharCode(10) + String.fromCharCode(10) + (brief || '（无简报正文）')); } catch { /* 信道失败不阻塞 */ }
    cb({ ok: true, 子单: created, 简报: briefPath });
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 兜底 */ }
}

// 收口报告：专项全落袋后汇总子单回执 → 验收包（含逐项验收步骤与成本账）
function closeout(root, cfg, parentId, cb) {
  const parent = store.find(root, parentId);
  if (!parent) return cb({ ok: false, error: '父单不存在' });
  const wake = require('./wake');
  const kids = wake.childrenOf(root, parentId);
  const receipts = kids.map((k) => {
    let raw = '';
    try { raw = fs.readFileSync(path.join(root, '回执', `${k.id}.md`), 'utf8'); } catch { /* 无回执 */ }
    const pick = raw.split(/^## /m).filter((s) => /^(产出|验收步骤|实际消耗)/.test(s)).map((s) => '## ' + s.trim()).join('\n');
    return `### ${k.id} ${k.fm.title}（${k.state}）\n${pick.slice(0, 1800) || '（无回执）'}`;
  }).join('\n\n');
  const prompt = [
    '你是单流的「项目管理」职能。专项父单的全部子单已落袋，写收口报告呈制作人验收。',
    '要求：①一段专项总结（做成了什么）②合并的验收步骤清单（制作人按此逐项实测，绝对路径）',
    '③成本账（各单实耗汇总）④遗留事项/异议汇总。务实文风，不奉承不注水。',
    '', '=== 专项父单 ===', parent.body || '', '', '=== 子单回执摘要 ===', receipts,
  ].join('\n');
  const cmd = cli();
  const model = (cfg.模型 || {}).项管 || 'fable';
  const child = spawn(cmd, ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'],
    { env: { ...process.env }, windowsHide: true, shell: String(cmd).endsWith('.cmd') });
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 900000) out = out.slice(-450000); });
  const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /**/ } }, 10 * 60000);
  if (timer.unref) timer.unref();
  child.on('close', () => {
    clearTimeout(timer);
    const text = require('../runner').extractClaudeText(out);
    if (!text.trim()) return cb({ ok: false, error: '收口报告空输出' });
    const rp = path.join(ledger.DIR(root), `收口报告-${parentId}.md`);
    fs.mkdirSync(ledger.DIR(root), { recursive: true });
    fs.writeFileSync(rp, `# 收口报告 · ${parentId}\n\n${text}\n`, 'utf8');
    ledger.event(root, '收口报告', { 父单: parentId, 报告: rp });
    try { require('../relay').append(root, '项管', '收口报告：' + parentId + String.fromCharCode(10) + String.fromCharCode(10) + text.slice(0, 3000)); } catch { /* 信道失败不阻塞 */ }
    cb({ ok: true, 报告: rp });
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 兜底 */ }
}

// 项管答话（0.18.6 项管信道）：制作人在信道里问 → fable 带台账/事件/盘面答 → 回帖
// 硬边界同上：只答不裁——不得放行/移单/改协议，涉裁决一律回「呈制作人/Claude」。
function answer(root, cfg, question, cb) {
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
  const board = [];
  for (const s of store.STATES) {
    const l = store.list(root, s).map((t) => t.id + ' ' + (t.fm.title || '').slice(0, 24));
    if (l.length) board.push(s + '：' + l.join('；'));
  }
  const events = (ledger.events(root, 40) || []).map((e) => JSON.stringify(e)).join('\n');
  const prompt = [
    '你是单流的「项目管理」职能（fable 档），在监制台的项管信道里回复制作人。',
    '你的权限：读台账/事件/盘面，答进度、排期、依赖、成本、风险。你无裁决权——放行/验收/改协议只能建议并注明「呈制作人」。',
    '回复体裁：直接回答，先结论后依据，中文，禁散文化寒暄，300 字内；不确定就明说。',
    '',
    '=== 台账 ===', read('项管台账/台账.json'),
    '=== 最近事件 ===', events,
    '=== 盘面 ===', board.join('\n'),
    '',
    '制作人问：', String(question || '').slice(0, 2000),
  ].join('\n');
  const cmd = cli();
  const model = (cfg.模型 || {}).项管 || 'fable';
  const child = spawn(cmd, ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'],
    { env: { ...process.env }, windowsHide: true, shell: String(cmd).endsWith('.cmd') });
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 400000) out = out.slice(-200000); });
  const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /**/ } }, 5 * 60000);
  if (timer.unref) timer.unref();
  child.on('close', () => {
    clearTimeout(timer);
    const text = require('../runner').extractClaudeText(out).trim();
    cb({ ok: !!text, text: text || '（项管无应答——fable 会话空输出，请重问或查额度）' });
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 兜底 */ }
}

module.exports = { cut, closeout, answer, buildCutPrompt, parseTickets };
