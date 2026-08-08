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
  // 输入/缓存分列（2026-08-05）：缓存读计费约为常价 1/10，混进合计会虚胖离群（起草 57.9 万 token 案）
  let inTok = 0, cacheTok = 0, outTok = 0;
  for (const line of String(raw).split(String.fromCharCode(10))) {
    const s = line.replace(String.fromCharCode(13), '').trim();
    if (!s.startsWith('{')) continue;
    try { const e = JSON.parse(s);
      const u = (e.usage) || (e.message && e.message.usage);
      if (u) {
        if (u.input_tokens) inTok = Math.max(inTok, u.input_tokens);
        if (u.cache_read_input_tokens) cacheTok = Math.max(cacheTok, u.cache_read_input_tokens);
        if (u.output_tokens) outTok += u.output_tokens;
      }
    } catch { /* 忽略 */ }
  }
  return { input: inTok, cache: cacheTok, output: outTok };
}
function billFee(root, 用途, raw) {
  try { const u = extractUsage(raw);
    ledger.update(root, (l) => { l.管理费 = l.管理费 || { token合计: 0, 次数: 0 };
      l.管理费.token合计 += u.input + u.output; l.管理费.次数 += 1;
      l.管理费.缓存合计 = (l.管理费.缓存合计 || 0) + u.cache;
      l.管理费.明细 = l.管理费.明细 || []; l.管理费.明细.push({ t: new Date().toISOString(), 用途, 输入: u.input, 缓存: u.cache, 输出: u.output, tokens: u.input + u.output });
      if (l.管理费.明细.length > 200) l.管理费.明细 = l.管理费.明细.slice(-200);
    });
  } catch { /* 记账失败不阻塞 */ }
}

// 作业态（0.23.7 呼吸灯）：项管 LLM 会话起止登记，供信道在线灯显示
let working = null;
function setWorking(w) { working = w ? { ...w, 起时: new Date().toISOString() } : null; }
function getWorking() { return working; }

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
    '宪法要句（H80，规则空白时按此裁并注明依据）：①自动化——能给机器的不耗人 ②模块化——换实现不换协议 ③透明化——一切留痕如实呈报 ④自优化——教训必须变成协议或工具的改动 ⑤人本化——品味/取舍/方向/销毁性决定只属于人，AI 仅建议与执行。',
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
    '⑩短题制（H83，2026-08-06 制作人裁决，适用全部单型——子单/专项/父单/机制单一视同仁）：标题 ≤16 字、「对象+动作」结构（如「海岸线钉零与衰减」），不堆机制词不带括号补语；范围枚举（①②③…）一律写进正文「范围」章，禁入标题——标题是卡片的脸，长到要点进详情才认得出就是不合格（制作人反馈拆名太乱）',
    '⑪用工语境（H85 + 同日「去岗位化」补章，2026-08-06 制作人裁决）：编制数据与调整权在你（项管）手上——监制台参数页已无编制管理区，改编制走 /api/pm/roster（GET 取快照，POST 体 {改动:[{职能,池序:[{池,档}]}],理由}）。**编制表每职能一行，没有 程序-A/程序-B 这类岗位号**：派发制下执行者因单而生，同一编制想开几个无头 CLI 就开几个，所以编制记的是「这个职能能在哪些池上干、按什么优先级」——池序第一位是首选池，档为空即用池默认模型。池路由按池序与额度实况定：池序里还有未冻结的池就顺位取用（不算改挂）；整条池序全冻时派发引擎才临时借调到可用池（自动动作只此一种，会留 fm.临时改池 + 台账）；其余用工调整由你显式发起，别指望自动。',
    '⑫并发调配语境（施工令-010，2026-08-06 制作人批准）：并发调配权随编制权同规格归你——审检并发（两检初检/核查/仲裁 各自的判官槽数，默认 1）与各池并发上限都由你按积压动态调，走 /api/pm/concurrency（GET 取聚合快照，POST 体 {审检?,零输出分钟?,池?:{codex,claude,deepseek},理由}）。审检并行不是默认（制作人已否决写死并行）：待验收/待定夺真堆起来了才调，堆完了调回去。硬顶是成本保险丝、只有制作人能改，越顶一律 400 拒绝——别试。',
    '⑨分级检审（2026-08-05 制作人批准）：QA 字段按单型定死——代码/装配/程序类=开（全检）；文档/wiki/调研/工程类=关（简检，仅核查两检）；验收方式=保留 的品味单免检直达制作人。不逐单裁量。',
    '',
    '=== 单型库（只从六型选：调研单/方案单/实现单/装配单/修复单/工程单）===',
    '工程单（H71）：纯机械体力活——批量替换/清洗/格式化/迁移，零设计判断零技术抉择；frontmatter 必须盖 执行池: deepseek（最便宜池），QA: 关（简检口径）。验收标准必须全机判（grep 计数/文件清单比对）。',
    '调研单（H90）：未知数排查的先行单——调研结论文档本身就是交付物。**产物路径口径（施工令-020）：调研结论一律落 `Docs/SLG/调研方案/<题目>.md`**（竞品横评落 `Docs/SLG/竞品分析/`），两者同挂监制台 wiki「调研方案」分区；产出物路径写别处即返修。执行会话必须调异厂评审台（packages/review-panel/review.js，喂调研结论 md 全绝对路径）过一遍全员评审，命令口径同方案单：评审团自动发现、异厂全到，少一席要写缺席原因；额度耗尽则弃对应厂并在回执如实记录。回执必带附录三件：①各厂意见原文 ②逐条采纳/驳回（驳回写理由）③由此产生的修订点。评审台已行**红队立场卷制**（H91/施工令-019）：三卷（可行性红队/不变量红队/成本红队）按席序轮换派发、单厂在席时独领全部三卷，每卷必须尝试构造具体失败场景，构造不出要明写「未能构造击杀」——该声明本身即通过证据。验收标准必须含评审台证据项（意见合集 md 绝对路径 + 附录三件齐备 + 击杀结论：各厂领卷与击杀/未杀条数，缺席致落空的立场卷如实标注）。质检阶段按 H93 只做击杀点定向复核，零击杀免次轮。',
    '方案单（H88）：承重技术方案的设计单——先出方案再动手，方案本身就是交付物。frontmatter 定死：职能: 技术策划、产出物类型: 文档、QA: 开、验收方式: 委托（承重设计不吃⑨「文档类=关」的简检口径，这是明定例外）。正文按五章契约写（章名以协议库 H88 正本为准，至少覆盖 问题与目标／不变量／路径划分与取舍／验证法／实现风险与回滚），缺章即返修。执行会话必须调异厂评审台（packages/review-panel/review.js，喂方案 md 全绝对路径）过一遍全员评审——评审团自动发现、异厂全到，少一席要写缺席原因。回执必带附录三件：①各厂意见原文 ②逐条采纳/驳回（驳回写理由）③由此产生的修订点。质检阶段定向复核（H90，经 H93 收窄 2026-08-09）——执行阶段全量异厂对抗性评审为唯一全量轮；QA 质检只对首轮击杀点+对应修订处定向对抗复核（回执击杀点清单即次轮卷面），零击杀免次轮；额度耗尽则弃对应厂并如实记录。评审台已行**红队立场卷制**（H91/施工令-019）：三卷（可行性红队/不变量红队/成本红队）按席序轮换派发、单厂在席时独领全部三卷，每卷必须尝试构造具体失败场景，构造不出要明写「未能构造击杀」——该声明本身即通过证据。验收标准必须含评审台证据项（意见合集 md 绝对路径 + 附录三件齐备 + 击杀结论：各厂领卷与击杀/未杀条数，缺席致落空的立场卷如实标注）。',
    '承重实现单挂依据（H88）：凡实现单落在已出方案的承重面上，frontmatter 必须写 依据: <已落袋的方案单号>——方案没落袋就不许切实现单，先切方案单、再把实现单的 依赖 挂到它身上。',
    '实现单/装配单/修复单——无方案不开工（H92 项管侧，施工令-020）：程序与装配类单型的**依据栏应指向已落袋技术方案**（方案单号或 `Docs/SLG/技术方案/` 下已定案的那一篇）；**无对应方案先切方案单**，再把本单 依赖 挂上去。判不出该挂哪篇就是方案缺位，按缺位处置——不许拿「边做边定」搪塞。',
    '不设收口单（H56）：全部子单完成后项管自动生成收口报告、专项父单自动转待验收——制作人的保留签字在父单，一个专项只签一次（H53）。最后一张实现/装配单须含受控重建与全量测试绿的交付责任。',
    '',
    '=== 输出契约（机器解析，严格遵守）===',
    '每张子单一个代码块，格式：',
    '```ticket',
    'title: <标题>',
    '单型: <调研单|方案单|实现单|装配单|修复单|工程单>',
    '职能: <策划|技术策划|程序|美术|QA|装配>',
    '产出物类型: <代码|文档|资产|规格|场景>',
    '优先级: <P0|P1|P2>',
    'QA: <开|关>',
    '验收方式: <委托|保留>',
    '预计时间: <小时数>',
    '预计token: <数字>',
    '依赖: <逗号分隔的同批序号如 1,2；无则留空>',
    '依据: <承重实现单填已落袋的方案单号（H88）；其余留空>',
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
  setWorking({ 用途: '切单', 对象: parentId });
  const child = spawn(cmd, ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'],
    { cwd: projPath || undefined, env: { ...process.env }, windowsHide: true, shell: String(cmd).endsWith('.cmd') }); // cwd=项目仓：项管盘点有读权（首切简报暴露的盲区）
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 900000) out = out.slice(-450000); });
  const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /**/ } }, 20 * 60000);
  if (timer.unref) timer.unref();
  child.on('close', () => {
    setWorking(null);
    clearTimeout(timer);
    billFee(root, '切单', out);
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
        父单: parentId, ...(dep ? { 依赖: dep } : {}),
        ...(tk.fm.依据 ? { 依据: tk.fm.依据 } : {}), // H88：承重实现单挂方案单号，白名单不带就落不到盘
        单型: tk.fm.单型 || '实现单', 切单人: '项管',
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
    '⑤（H69 仪表盘）报告末尾单独一行「审检报告可用性：N」（N=1-5）——评本专项各审检报告（回执里的质检/委托代核章）作为收口材料的可用度：证据链清晰度、返工建议可执行性。',
    '⑥（H92 落地即词条，施工令-020）报告必设「应入词条」一章：本专项落地的设计事实与技术口径逐条列出（词条名 + 出处子单 + 一句话口径），供策划落 Docs/wiki/；确无新增的明写「无新增词条」——空着不算交代。',
    '', '=== 专项父单 ===', parent.body || '', '', '=== 子单回执摘要 ===', receipts,
  ].join('\n');
  const cmd = cli();
  const model = (cfg.模型 || {}).项管 || 'fable';
  setWorking({ 用途: '收口', 对象: parentId });
  const child = spawn(cmd, ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'],
    { env: { ...process.env }, windowsHide: true, shell: String(cmd).endsWith('.cmd') });
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 900000) out = out.slice(-450000); });
  const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /**/ } }, 10 * 60000);
  if (timer.unref) timer.unref();
  child.on('close', () => {
    setWorking(null);
    clearTimeout(timer);
    billFee(root, '收口', out);
    const text = require('../runner').extractClaudeText(out);
    if (!text.trim()) return cb({ ok: false, error: '收口报告空输出' });
    const rp = path.join(ledger.DIR(root), `收口报告-${parentId}.md`);
    fs.mkdirSync(ledger.DIR(root), { recursive: true });
    fs.writeFileSync(rp, `# 收口报告 · ${parentId}\n\n${text}\n`, 'utf8');
    ledger.event(root, '收口报告', { 父单: parentId, 报告: rp });
    { // H69 线④：项管评审检报告可用性
      const ms = text.match(/审检报告可用性[:：]\s*([1-5])/);
      if (ms) ledger.score(root, { 线: '项管评审检', 专项: parentId, 分: Number(ms[1]) });
    }
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
    '你手上有两项调配权（H85 + 施工令-010）：编制（/api/pm/roster）与并发调配（/api/pm/concurrency——审检并发与各池并发上限，按积压动态调，硬顶是制作人专属的成本保险丝，越顶 400）。被问到并发/积压时按这个语境答。',
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
  setWorking({ 用途: '答话' });
  const child = spawn(cmd, ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'],
    { cwd: root, env: { ...process.env }, windowsHide: true, shell: String(cmd).endsWith('.cmd') }); // cwd=工单库：答话会话有读权（2026-08-05 推演案：曾困在临时目录只能看注入摘要）
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 400000) out = out.slice(-200000); });
  const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /**/ } }, 5 * 60000);
  if (timer.unref) timer.unref();
  child.on('close', () => {
    setWorking(null);
    clearTimeout(timer);
    billFee(root, '答话', out);
    const text = require('../runner').extractClaudeText(out).trim();
    cb({ ok: !!text, text: text || '（项管无应答——fable 会话空输出，请重问或查额度）' });
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 兜底 */ }
}

// 评估回呈裁决（H61，2026-08-05 用户拍板）：执行会话判定做不了 → 项管裁决 改单/改池/上呈。
// 三轮封顶由 runner 把关（≥3 直接上呈总监不再进此函数）。
function adjudicateReferral(root, cfg, id, cb) {
  const t = store.find(root, id);
  if (!t) return cb({ ok: false, error: '单不存在' });
  let receipt = '';
  try { receipt = fs.readFileSync(path.join(root, '回执', id + '.md'), 'utf8'); } catch { /* 无回执照裁 */ }
  setWorking({ 用途: '裁决', 对象: id });
  const prompt = [
    '你是单流的「项目管理」职能。一张执行单的会话领单评估后判定做不了，回呈你裁决（H61）。',
    '宪法要句（H80，规则空白时按此裁并注明依据）：①自动化——能给机器的不耗人 ②模块化——换实现不换协议 ③透明化——一切留痕如实呈报 ④自优化——教训必须变成协议或工具的改动 ⑤人本化——品味/取舍/方向/销毁性决定只属于人，AI 仅建议与执行。',
    '你的选项（只能选一）：改单（修字段/补正文让它可做）/ 改池（换执行池）/ 上呈（单子本身有问题，交总监）。',
    '输出契约：先一段 100 字内裁决说明，然后一个 ```json 代码块：',
    '{"处置":"改单|改池|上呈","执行池":"claude|codex|null","字段修改":{"优先级":"P0-P3 或省略","预计时间":"小时数或省略"},"正文补充":"改单时追加进工单正文的指令文本，其它情况空串","说明":"一句话"}',
    '', '=== 工单全文 ===', fs.readFileSync(t.file, 'utf8').slice(0, 6000),
    '', '=== 评估回呈 ===', receipt.slice(0, 3000),
    '', '=== 该单历史（journal 摘录）===',
    (() => { try { const jf = fs.readdirSync(path.join(root, 'journal')).sort().pop(); return fs.readFileSync(path.join(root, 'journal', jf), 'utf8').split(/\r?\n/).filter((l) => l.includes(id)).slice(-12).join('\n'); } catch { return '（无）'; } })(),
  ].join(String.fromCharCode(10));
  const cmd = cli();
  const model = (cfg.模型 || {}).项管 || 'opus';
  const child = spawn(cmd, ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'],
    { cwd: root, env: { ...process.env }, windowsHide: true, shell: String(cmd).endsWith('.cmd') });
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 400000) out = out.slice(-200000); });
  const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /**/ } }, 5 * 60000);
  if (timer.unref) timer.unref();
  child.on('close', () => {
    setWorking(null); clearTimeout(timer); billFee(root, '裁决', out);
    const text = require('../runner').extractClaudeText(out);
    let v = null;
    try { v = JSON.parse((text.match(/```json\s*([\s\S]*?)```/) || [])[1]); } catch { /* 解析失败走上呈 */ }
    const journal = require('../journal');
    if (!v || !['改单', '改池', '上呈'].includes(v.处置)) {
      try { require('../inbox').post(root, '急', '裁决异常', id + ' 项管裁决输出不可解析，按上呈处理', { 单号: id }); } catch { /**/ }
      journal.append(root, `项管裁决 ${id}：输出不可解析 → 上呈总监`);
      return cb({ ok: false, error: '裁决输出不可解析' });
    }
    ledger.event(root, '裁决', { 单: id, 处置: v.处置 });
    try { require('../relay').append(root, '项管', `评估回呈裁决 ${id}：${v.处置}——${v.说明 || ''}`); } catch { /**/ }
    if (v.处置 === '上呈') {
      try { require('../inbox').post(root, '急', '裁决上呈', id + '：' + (v.说明 || '单子本身存疑'), { 单号: id }); } catch { /**/ }
      journal.append(root, `项管裁决 ${id}：上呈总监（${v.说明 || ''}）`);
      return cb({ ok: true, 处置: '上呈' });
    }
    store.update(root, id, (fm, t2) => {
      const patch = { 放行: true };
      if (v.处置 === '改池' && ['claude', 'codex'].includes(v.执行池)) patch.执行池 = v.执行池;
      if (v.处置 === '改单') {
        const f = v.字段修改 || {};
        if (/^P[0-3]$/.test(String(f.优先级 || ''))) patch.优先级 = f.优先级;
        if (f.预计时间) patch.预计时间 = String(f.预计时间);
      }
      Object.assign(fm, patch);
      if (v.处置 === '改单' && v.正文补充) return { body: (t2.body || '') + '\n\n## 项管裁决改单（H61 · ' + new Date().toISOString().slice(0, 10) + '）\n' + String(v.正文补充).slice(0, 2000) + '\n' };
    });
    journal.append(root, `项管裁决 ${id}：${v.处置}${v.执行池 ? '→' + v.执行池 : ''}（带放行重新可派）`);
    cb({ ok: true, 处置: v.处置 });
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 兜底 */ }
}

// 派单委托（H57，2026-08-04 用户裁定：派单权归项管，Claude 不得直接造单）：
// 制作人层提需求 → 项管起草单张工单（草稿态）→ Claude 审 → 定稿放行。审批与起草分离。
// 字段规范硬约束（2026-08-05：TK-82/83 连续两张草稿字段非标返修）——见 FIELD_RULES 注入。
const FIELD_RULES = '字段规范（补：单型=工程单 时 执行池 必须= deepseek，QA=关；单型=方案单 时 职能 必须= 技术策划、产出物类型=文档、QA=开、验收方式=委托，H88）（补 H90：单型=调研单/方案单 时，正文「验收标准」章必须含评审台证据项——异厂评审意见合集 md 的绝对路径 + 回执附录三件（意见原文/采纳驳回/修订点）齐备，缺则返修）（补 H91/施工令-019：评审台已行红队立场卷制，上述评审证据项还须含击杀结论——各厂领卷（可行性/不变量/成本红队）与击杀/未杀条数，构造不出击杀的卷须有「未能构造击杀」声明，缺席致落空的立场卷如实标注，缺则返修）（逐字遵守，违者返修）：职能 只能取 策划/技术策划/程序/美术/QA/装配 六者之一，不得加括号后缀；优先级 只能取 P0/P1/P2/P3；QA 只能取 开/关；需求若点名依赖单号或执行池，frontmatter 必须含 依赖:/执行池: 字段原样带上。正文三章（背景/执行内容/验收标准）必须写在 ticket 代码块内部、frontmatter 的第二个 --- 之后——写在代码块外会被解析丢弃（TK-86 空壳案）。';
function draftTicket(root, cfg, 需求, projPath, cb) {
  setWorking({ 用途: '起草' });
  const 单元 = (cfg.单元 || {});
  const prompt = [
    '你是单流的「项目管理」职能。制作人层委托你起草一张执行工单（单张，不是拆专项）。',
    '宪法要句（H80，规则空白时按此裁并注明依据）：①自动化——能给机器的不耗人 ②模块化——换实现不换协议 ③透明化——一切留痕如实呈报 ④自优化——教训必须变成协议或工具的改动 ⑤人本化——品味/取舍/方向/销毁性决定只属于人，AI 仅建议与执行。',
    '项目仓库（可读，用于盘点核实）：' + (projPath || '（未注册）'),
    '纪律：①先盘仓核实需求描述的现状 ②单元标准 ' + (单元.小时 || 0.25) + 'h/≤' + (单元.token || 50000) + ' token，顶格 2 单元 ③验收标准全部可判定 ④收尾锚点（受控重建/SavedScene/体积闸）只属装配单 ⑤如需求实际需要多张单，直说并建议走专项拍板，不要硬塞。',
    '短题制（H83，2026-08-06 制作人裁决，适用全部单型——子单/专项/父单/机制单一视同仁）：标题 ≤16 字、「对象+动作」结构（如「海岸线钉零与衰减」），不堆机制词不带括号补语；范围枚举（①②③…）一律写进正文「范围」章，禁入标题——标题是卡片的脸，长到要点进详情才认得出就是不合格。',
    FIELD_RULES,
    '输出契约与拆单相同：一个 ```ticket 代码块（title/单型/职能/产出物类型/优先级/QA/验收方式/预计时间/预计token/依赖（需求点名了就写，否则留空）+ --- + 正文三章）。之后一段「起草说明」：盘点发现+边界取舍。',
    '', '=== 制作人层需求 ===', String(需求 || '').slice(0, 4000),
  ].join(String.fromCharCode(10));
  const cmd = cli();
  const model = (cfg.模型 || {}).项管 || 'opus';
  const child = spawn(cmd, ['-p', '--model', model, '--output-format', 'stream-json', '--verbose'],
    { cwd: projPath || undefined, env: { ...process.env }, windowsHide: true, shell: String(cmd).endsWith('.cmd') });
  let out = '';
  child.stdout.on('data', (d) => { out += d; if (out.length > 900000) out = out.slice(-450000); });
  const timer = setTimeout(() => { try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /**/ } }, 10 * 60000);
  if (timer.unref) timer.unref();
  child.on('close', () => {
    setWorking(null);
    clearTimeout(timer);
    billFee(root, '起草', out);
    const text = require('../runner').extractClaudeText(out);
    const { tickets, brief } = parseTickets(text);
    if (!tickets.length) return cb({ ok: false, error: '起草输出无工单块', raw: text.slice(0, 400) });
    const px = 'TK';
    let mx = 0;
    for (const s of store.STATES) for (const x of store.list(root, s)) {
      const mm = String(x.id).match(/^TK-([0-9]+)$/);
      if (mm) mx = Math.max(mx, Number(mm[1]));
    }
    const nid = px + '-' + (mx + 1);
    const tk = tickets[0];
    const fm = { id: nid, title: tk.fm.title || '起草单', 职能: tk.fm.职能 || '程序', 产出物类型: tk.fm.产出物类型 || '代码',
      优先级: tk.fm.优先级 || 'P1', 规模: '单兵', QA: tk.fm.QA || '开', 验收方式: tk.fm.验收方式 || '委托',
      预计时间: tk.fm.预计时间 || '0.25', 预计token: tk.fm.预计token || '50000', 项目: (cfg.项目 && cfg.项目.默认) || '',
      单型: tk.fm.单型 || '修复单', 切单人: '项管', 创建时间: new Date().toISOString().slice(0, 10),
      ...(tk.fm.依据 ? { 依据: tk.fm.依据 } : {}) }; // H88：同 cut，依据栏要落盘
    const r = store.create(root, nid, fm, tk.body);
    if (!r.ok) return cb(r);
    try { require('../relay').append(root, '项管', '受托起草：' + nid + ' ' + fm.title + '（草稿区待 Claude 审）' + String.fromCharCode(10) + String.fromCharCode(10) + (brief || '')); } catch { /**/ }
    ledger.event(root, '待审', { 单: nid, 起草: '单张' }); // 不写父单/子单：夜班推演 #7——伪装拆单结构会污染 H53 收口/成本归集
    cb({ ok: true, 单: nid });
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 兜底 */ }
}

module.exports = { cut, closeout, answer, draftTicket, adjudicateReferral, buildCutPrompt, parseTickets, getWorking };
