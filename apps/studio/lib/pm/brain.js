// pm/brain.js — 项目管理的判断脑（H49）：fable 档，事件唤醒，只出建议不落裁决
// v0.18-alpha 职能：切单（拍板父单 → 单元子单草稿 + 拆单简报呈 Claude 审批）。
// 硬边界：产出全为草稿与简报——放行/裁决权不在此模块（人本化）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const store = require('../core/store');
const ledger = require('./ledger');
const estimate = require('./estimate');

/* ===================== 估时自校准接线（H101 · 施工令-050）=====================
 * 章程「估时校准步」四步：①取历史（历史样本）→②算偏差 ③校估值（pm/estimate 纯函数）
 * →④落痕（ledger.event('估时校准')）。每次切单/起草在成单前必过，不是可选优化。
 * 双层：提示词自律（把校准表与纪律注进会话，要求引用算式）+ 机器兜底（落 fm 前用同一张表复核改写）。
 * 单层不够——提示词那半边是「请你遵守」，模型漏读一行就退回自由拍值，而这正是 H101 要治的病。 */

// ① 取历史（取数层：本文件唯一碰盘的一段，deps 全可注入便于测试）。
// 时间实耗取 领单时间→交付时间（口径同 report.aggregate 的 实际h）；
// token 实耗从预算账按单归集（施工令-047 流计量回灌落的就是这一本，合计不含缓存）。
// 预算闸落空实现时它没有 读账——那就当没有 token 计量，只校时间（不臆造数字）。
function 历史样本(root, deps = {}) {
  const st = deps.store || store;
  const 单表 = [];
  for (const s of (deps.状态 || ['完成', '已归档'])) {
    for (const t of st.list(root, s)) 单表.push({ id: t.id, fm: t.fm, 实耗token: 0 });
  }
  let 账 = [];
  try {
    const 读 = deps.读账 || require('../budget').读账;
    if (typeof 读 === 'function') 账 = 读(root) || [];
  } catch { 账 = []; } // 账读不到＝无 token 计量：本轮只校时间
  const 归 = new Map();
  for (const r of 账) {
    if (!r || !r.单) continue;
    归.set(r.单, (归.get(r.单) || 0) + (Number(r.输入) || 0) + (Number(r.输出) || 0));
  }
  for (const t of 单表) t.实耗token = 归.get(t.id) || 0;
  return 单表;
}

// ②③ 备料：一次取数 → 一张校准表 + 一段提示词块。取数/算表失败一律降级到「无表」，
// 提示词块照发（那一版明写「无样本，按基准估值原样填」）——校准挂了不许把切单带崩。
function 备校准(root, deps) {
  try {
    const 表 = estimate.校准表(estimate.比样本(历史样本(root, deps)));
    return { 表, 块: estimate.提示词块(表) };
  } catch (e) {
    try { require('../journal').append(root, `估时校准取数失败：${String(e.message).slice(0, 100)}——本次按基准估值不校准`); } catch { /* 留痕失败不阻塞 */ }
    return { 表: null, 块: estimate.提示词块(null) };
  }
}

// ③④ 机器兜底 + 落痕：落盘前拿同一张表复核 fm 两个估值字段，改写并记台账事件。
// 就地改 fm（调用方拿到的是 childFm/draftFm 刚吐出来的对象，还没进 store.create）。
function 校准落fm(root, id, fm, 表) {
  if (!表 || !fm) return null;
  try {
    const r = estimate.校准({ 表, 职能: fm.职能, 单型: fm.单型, 预计时间: fm.预计时间, 预计token: fm.预计token });
    fm.预计时间 = String(r.预计时间);
    fm.预计token = String(r.预计token);
    ledger.event(root, '估时校准', { 单: id, ...r.记录 }); // 晨报按这条对账
    return r.记录;
  } catch (e) {
    try { require('../journal').append(root, `估时校准复核失败 ${id}：${String(e.message).slice(0, 100)}——估值保留模型原值`); } catch { /* 尽力 */ }
    return null;
  }
}

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

// 切单提示词：六件套纪律 + 单型库 + 单元标准 + 估时校准表 + 机器可读输出契约
// 校准块（H101，可缺）：备校准() 出的那段文本；不传时退化为「无历史可校」版，提示词结构不变。
function buildCutPrompt(root, cfg, parent, projPath, 校准块) {
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
    '③历史校准（H101 已制度化，见下方「估时校准表」）：先按 agent 实测口径出基准估值（' + (单元.小时 || 0.25) + 'h/单元，≤' + (单元.token || 50000) + ' token），'
      + '**再乘校准表里本单 职能×单型 的偏差系数得最终 预计时间/预计token，并在简报里写出引用了哪一格与算式——不得自由拍值**',
    '④协议选段：把相关纪律写进各子单「不要做」与验收标准',
    '⑤依赖建模：同写区串行（依赖链）、异写区并行；标注红链',
    '⑥单元合规自检：每张 ≤2 单元、单一写区、验收标准全部可判定（GWT/勾选）',
    '⑧验收锚点归位（TK-78/75 两案）：受控重建、SavedScene 在位断言、场景体积闸这类收尾锚点，只准写进最后一张装配单的验收标准——写进前置单必与其「不要做」互斥，烧判官轮次',
    '⑧附·引擎门禁停闸（H97，2026-08-09 制作人批准，施工令-032 实装）：**验收标准章**里出现 enginectl / unity-test / 受控重建 这类引擎实测特征的单，核查判通过后机器不转完成——原位盖「候引擎实证」印停在待验收，待总监确认引擎实测证据确已誊入回执后走「实证放行」才收（特征表可在 studio.config 执行器.引擎门禁.特征 覆盖，缺省即上述三特征；门禁只扫验收标准章）。这是设计内的第二把钥匙，不是故障：切这类单时把验收标准写成「谁跑哪条命令、回执里必须贴哪几个数字」的可复核条目，别只写「测试通过」。',
    '⑦结构归位（H50/H51）：工单树是项管资产，管线是顶层单位——若本父单无管线章（frontmatter 管线: P-#），在简报里提出应挂入的既有管线，或建议开新线（开线是制作人人闸，你只有建议权）；判不出写「呈制作人定归属」',
    '⑩短题制（H83，2026-08-06 制作人裁决，适用全部单型——子单/专项/父单/机制单一视同仁）：标题 ≤16 字、「对象+动作」结构（如「海岸线钉零与衰减」），不堆机制词不带括号补语；范围枚举（①②③…）一律写进正文「范围」章，禁入标题——标题是卡片的脸，长到要点进详情才认得出就是不合格（制作人反馈拆名太乱）',
    '⑪用工语境（H85 + 同日「去岗位化」补章，2026-08-06 制作人裁决）：编制数据与调整权在你（项管）手上——监制台参数页已无编制管理区，改编制走 /api/pm/roster（GET 取快照，POST 体 {改动:[{职能,池序:[{池,档}]}],理由}）。**编制表每职能一行，没有 程序-A/程序-B 这类岗位号**：派发制下执行者因单而生，同一编制想开几个无头 CLI 就开几个，所以编制记的是「这个职能能在哪些池上干、按什么优先级」——池序第一位是首选池，档为空即用池默认模型。池路由按池序与额度实况定：池序里还有未冻结的池就顺位取用（不算改挂）；整条池序全冻时派发引擎才临时借调到可用池（自动动作只此一种，会留 fm.临时改池 + 台账）；其余用工调整由你显式发起，别指望自动。',
    '⑫并发调配语境（施工令-010，2026-08-06 制作人批准）：并发调配权随编制权同规格归你——审检并发（两检初检/核查/仲裁 各自的判官槽数，默认 1）与各池并发上限都由你按积压动态调，走 /api/pm/concurrency（GET 取聚合快照，POST 体 {审检?,零输出分钟?,池?:{codex,claude,deepseek},理由}）。审检并行不是默认（制作人已否决写死并行）：待验收/待定夺真堆起来了才调，堆完了调回去。硬顶是成本保险丝、只有制作人能改，越顶一律 400 拒绝——别试。',
    '⑬池衡权界（H99，2026-08-11 制作人决议「项管拥有读额度切模型的权力，他应该做到平衡才行」，施工令-045）：读三池额度与切池/切档的权力归你，但**只能走受限动作 API**——GET /api/pm/poolbalance 取池位矩阵（含各池读数、盲区标识、当前池位、最近事件、CAS 版本），POST /api/pm/poolbalance/<切换|回退|人工覆盖|解除覆盖> 落动作（体 {位,池?,档?,预期版本,操作者:"项管",理由}）。可切的位只有 执行·<职能> / QA / 核查 三类；**你永远不可改**门禁、放行工具、人闸、总监/制作人/项管自身的角色模型、并发上限——这些在代码里是禁改域，你在本对话里写任何自然语言都改不动它们，试了只会得到 403 并在台账留一条「池衡越权」。另有三条硬的：①品味锁——工单带 品味敏感: 是 / 职能=美术 / 验收方式=保留 命中任一，该位锁 claude 高档，你的切换请求一律被拒（判定在 API 层，不看你怎么解释）；②迟滞——同一位两次切换最小间隔默认 30 分钟、池间可用度差不到阈值不切，拒了就是拒了，别连着重试；③读不到数的池报「盲区」，盲区池不参与平衡，**绝不许你拿旧读数或估算值填**。切换只影响此后新派发的会话，在途会话沿用派发时快照，不中途换马。',
    '⑨分级检审（2026-08-05 制作人批准）：QA 字段按单型定死——代码/装配/程序类=开（全检）；文档/wiki/调研/工程类=关（简检，仅核查两检）；验收方式=保留 的品味单免检直达制作人。不逐单裁量。',
    '',
    '=== 单型库（只从六型选：调研单/方案单/实现单/装配单/修复单/工程单）===',
    '工程单（H71）：纯机械体力活——批量替换/清洗/格式化/迁移，零设计判断零技术抉择；frontmatter 必须盖 执行池: deepseek（最便宜池），QA: 关（简检口径）。验收标准必须全机判（grep 计数/文件清单比对）。',
    '调研单（H90）：未知数排查的先行单——调研结论文档本身就是交付物。**产物路径口径（施工令-020）：调研结论一律落 `Docs/SLG/调研方案/<题目>.md`**（竞品横评落 `Docs/SLG/竞品分析/`），两者同挂监制台 wiki「调研方案」分区；产出物路径写别处即返修。执行会话必须调异厂评审台（packages/review-panel/review.js，喂调研结论 md 全绝对路径）过一遍全员评审，命令口径同方案单：评审团自动发现、异厂全到，少一席要写缺席原因；额度耗尽则弃对应厂并在回执如实记录。回执必带附录三件：①各厂意见原文 ②逐条采纳/驳回（驳回写理由）③由此产生的修订点。评审台已行**红队立场卷制**（H91/施工令-019）：三卷（可行性红队/不变量红队/成本红队）按席序轮换派发、单厂在席时独领全部三卷，每卷必须尝试构造具体失败场景，构造不出要明写「未能构造击杀」——该声明本身即通过证据。验收标准必须含评审台证据项（意见合集 md 绝对路径 + 附录三件齐备 + 击杀结论：各厂领卷与击杀/未杀条数，缺席致落空的立场卷如实标注）。质检阶段按 H93 只做击杀点定向复核，零击杀免次轮。',
    '方案单（H88）：承重技术方案的设计单——先出方案再动手，方案本身就是交付物。frontmatter 定死：职能: 技术策划、产出物类型: 文档、QA: 开、验收方式: 委托（承重设计不吃⑨「文档类=关」的简检口径，这是明定例外）。正文按**六章契约**写（H91 六章制，2026-08-08 制作人决议；章名以 监制台/岗位协议/技术策划.md 为准：第一性拆解／目标／不变量清单／现状与病灶／改动面与路径／验证法。首章「第一性拆解」写本问题不可约的物理约束与目的三问——是什么／为何非有不可／谁是唯一所有者，不变量清单必须从该章推导，红队优先对该章开火），缺章即返修。执行会话必须调异厂评审台（packages/review-panel/review.js，喂方案 md 全绝对路径）过一遍全员评审——评审团自动发现、异厂全到，少一席要写缺席原因。回执必带附录三件：①各厂意见原文 ②逐条采纳/驳回（驳回写理由）③由此产生的修订点。质检阶段定向复核（H90，经 H93 收窄 2026-08-09）——执行阶段全量异厂对抗性评审为唯一全量轮；QA 质检只对首轮击杀点+对应修订处定向对抗复核（回执击杀点清单即次轮卷面），零击杀免次轮；额度耗尽则弃对应厂并如实记录。评审台已行**红队立场卷制**（H91/施工令-019）：三卷（可行性红队/不变量红队/成本红队）按席序轮换派发、单厂在席时独领全部三卷，每卷必须尝试构造具体失败场景，构造不出要明写「未能构造击杀」——该声明本身即通过证据。验收标准必须含评审台证据项（意见合集 md 绝对路径 + 附录三件齐备 + 击杀结论：各厂领卷与击杀/未杀条数，缺席致落空的立场卷如实标注）。',
    '承重实现单挂依据（H88）：凡实现单落在已出方案的承重面上，frontmatter 必须写 依据: <已落袋的方案单号>——方案没落袋就不许切实现单，先切方案单、再把实现单的 依赖 挂到它身上。',
    '实现单/装配单/修复单——无方案不开工（H92 项管侧，施工令-020）：程序与装配类单型的**依据栏应指向已落袋技术方案**（方案单号或 `Docs/SLG/技术方案/` 下已定案的那一篇）；**无对应方案先切方案单**，再把本单 依赖 挂上去。判不出该挂哪篇就是方案缺位，按缺位处置——不许拿「边做边定」搪塞。',
    '职能定夺（H98）：职能按改动面实质定——改动面全落 Scripts/Tests 代码的单一律 职能: 程序（不论单型叫什么）；装配单型只用于场景/预制体/资产拼装写区动作。',
    '管线归属必填：凡属某条管线域的单（看板管线注册表见 /api/pipelines 或工单正文域语义），frontmatter 必须写 管线: P-N；确无归属的独立杂务才允许留空进散单。案源：TK-106~116 整条地图施工链漏章堆散单，制作人亲自抓出。',
    '不设收口单（H56）：全部子单完成后项管自动生成收口报告、专项父单自动转待验收——制作人的保留签字在父单，一个专项只签一次（H53）。最后一张实现/装配单须含受控重建与全量测试绿的交付责任。',
    '',
    校准块 || estimate.提示词块(null),
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
    '预计时间: <小时数——基准估值 × 校准系数，粒度 0.25h（H101）>',
    '预计token: <数字——基准估值 × 校准系数，粒度 万 token（H101）>',
    '依赖: <逗号分隔的同批序号如 1,2；无则留空>',
    '依据: <承重实现单填已落袋的方案单号（H88）；其余留空>',
    '管线: <本单所属管线号 P-N（注册表见 /api/pipelines）；确无归属的独立杂务才留空>',
    '---',
    '<正文：## 范围 / ## 不要做 / ## 验收标准>',
    '```',
    '全部子单之后，输出「## 拆单简报」：切法理由、依赖图、红链、预计总耗时与总 token，'
      + '外加「估时校准引用」一段（逐张写 基准估值 × 引用的系数格 = 最终估值；无样本就写「无样本，未校准」）。',
    '',
    // 施工令-054（TK-146 案）：拒切是合法结论，不是故障。此前只要没有 ticket 块就一律记「切单失败」，
    // 连带把「为什么现在不能切」的判语一起吞掉——父单纪律明写候期时，机器仍按坏输出处理。
    '=== 拒切候期出口（合法结论 · 施工令-054）===',
    '父单**确实不具备切单条件**时（承重方案未落袋、前置依赖还在途、需求含糊到切出来必返工、父单正文自身写明候期），',
    '既不许硬切凑数，也不许空手交白卷——输出下面这个块作为结论，一个块即是完整判断：',
    '```verdict',
    '拒切: 候期',
    '理由: <为什么现在不能切：指名缺的到底是什么（单号／文件／悬着未定的取舍）>',
    '复切时机: <什么条件达成即可复切，写成可判定的条件，不写「等等看」>',
    '```',
    '块之后另起「## 拒切判语」一段写完整论证：缺的前置、硬切会烂在哪、候期期间建议先做什么。',
    '机器侧待遇：记台账事件「切单候期」并存判语全文、父单原位不动等复切，**不记切单失败**。',
    '反过来——空输出、或格式坏到既无 ticket 块又无本块——才判切单失败。',
    '别拿本块当超时/跑飞的挡箭牌：判语会存档并呈制作人复读，理由立不住比切错更难看。',
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

// 解析「拒切候期」结论（施工令-054 · TK-146 案）。切单三出口里最难判的一态：
// **无子单块未必是失败**——模型可能是在说「现在不该切」，那是判断力的产出，不是故障。
// 认块不认话：必须是 verdict 块里明写「拒切: 候期」才算数，散文里飘一句「建议候期」不认——
// 否则一句吐槽就能把真·坏输出洗成合法出口，机器从此分不出模型跑飞和模型拒切。
const 判语上限 = 4000; // 台账是单个 JSON 文件，判语不设限会把它撑成负担；4000 字装得下完整论证
function parse拒切(text) {
  const s = String(text || '');
  const m = s.match(/```verdict\s*\n([\s\S]*?)```/);
  if (!m) return null;
  const head = m[1];
  if (!/^\s*拒切\s*[:：]\s*候期/m.test(head)) return null;
  const pick = (k) => {
    const mm = head.match(new RegExp('^\\s*' + k + '\\s*[:：]\\s*(.*)$', 'm'));
    return mm ? mm[1].trim() : '';
  };
  // 判语取「## 拒切判语」整段；模型没另起段落就退回整篇输出——判语宁可宽，不可空（TK-146 就是空的）
  const seg = (s.match(/## 拒切判语[\s\S]*$/) || [''])[0].trim();
  return { 候期: true, 理由: pick('理由'), 复切时机: pick('复切时机'), 判语: (seg || s.trim()).slice(0, 判语上限) };
}

/* ===== 容器解析（施工令-058 · H103）=====
 * 切单/收口的对象从此有两形：
 *   S-n  → 专项注册表条目（专项是容器，不是工单）；
 *   其余 → 存量战役父单工单（战役号不迁移，这条老路留着）。
 * 统一成同一个形回给下游：{ id, fm, body, 专项 }。切单主流程只认这个形，不必到处判「这是哪一种」。
 * 关键差别只有两处，全在这里定死：**子单挂链字段**（专项: S-n / 父单: TK-n）与**派号前缀**
 * （专项号是 S-n，子单绝不能跟着叫 S-2——那会跟下一个专项号撞车）。 */
// 项目前缀（施工令-061 · 制作人 2026-08-20 00:45 拍板监制台自立 Ticketflow 项目）：
// 派号前缀原先六处写死 'TK'，第二个项目一进来就会跟 TK 抢号。前缀是**项目的属性**，
// 事实源在 config.项目.注册[名].单号前缀；缺注册项时回落项目名本身（注册名即前缀是最省心的默认），
// 再兜底 'TK' 只为老库无注册表时不炸。三级回落各有其用，别合并。
function 前缀Of(cfg, 项目) {
  const reg = (cfg && cfg.项目 && cfg.项目.注册) || {};
  const name = String(项目 || (cfg && cfg.项目 && cfg.项目.默认) || '').trim();
  const px = name && reg[name] && reg[name].单号前缀;
  return String(px || name || 'TK').trim();
}

// 派下一个号：只数**本前缀**的号段。两项目号段互不相扰的保证就在这个正则的前缀上——
// 数 TK 时不看 TF，数 TF 时不看 TK，故各自连号、互不串号。
function 下一号(root, px) {
  const re = new RegExp('^' + px.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-([0-9]+)$');
  let mx = 0;
  for (const s of store.STATES) for (const x of store.list(root, s)) {
    const mm = String(x.id).match(re);
    if (mm) mx = Math.max(mx, Number(mm[1]));
  }
  return px + '-' + (mx + 1);
}

function 容器(root, id, cfg) {
  const specials = require('../specials');
  if (specials.是专项号(id)) {
    const s = specials.find(root, id);
    if (!s) return null;
    return {
      id: s.id, body: s.body, 专项: true,
      前缀: String(s.fm.单号前缀 || 前缀Of(cfg, s.fm.项目)),
      挂链: { 专项: s.id },
      fm: { 项目: s.fm.项目 || '', 管线: s.fm.管线 || null, title: s.fm.名称 || s.id },
    };
  }
  const t = store.find(root, id);
  if (!t) return null;
  return {
    id: t.id, body: t.body, 专项: false,
    前缀: (String(t.id).match(/^(.+)-(\d+)$/) || [])[1] || 前缀Of(cfg, t.fm.项目),
    挂链: { 父单: t.id },
    fm: t.fm,
  };
}

// 子单 frontmatter 白名单：ticket 块解析出来的字段，只有列在这里的才落得到盘。
// 抽成纯函数是为了能单测——白名单漏字段已经吃过两次（H88 依据、TK-106~116 管线），
// 都是「提示词要求写了、落盘时被静默吞掉」，肉眼审不出来。
// ids 用于把 依赖 里的同批序号（1,2…）换成实际编号。
// 挂链 = {父单: TK-n}（存量战役）或 {专项: S-n}（施工令-058）——由 容器() 定，这里只照抄。
// 管线兜底同理：专项子单没有工单父链可上溯（pipelines.pipelineOf 走的是 父单 字段），
// 所以容器的管线章必须在落盘这一刻显式落到子单身上，否则整批子单会齐刷刷掉进散单行。
function childFm(tk, { id, ids, parentId, 项目, 挂链, 容器管线 }) {
  const dep = String(tk.fm.依赖 || '').split(/[，,\s]+/).filter(Boolean)
    .map((n) => (ids || [])[Number(n) - 1]).filter(Boolean).join('，');
  const 管线 = tk.fm.管线 || 容器管线 || null;
  return {
    id, title: tk.fm.title || '子单', 职能: tk.fm.职能 || '程序',
    产出物类型: tk.fm.产出物类型 || '代码', 优先级: tk.fm.优先级 || 'P1', 规模: '单兵',
    QA: tk.fm.QA || '开', 验收方式: tk.fm.验收方式 || '委托',
    预计时间: tk.fm.预计时间 || '0.25', 预计token: tk.fm.预计token || '50000',
    项目, 创建时间: new Date().toISOString().slice(0, 10),
    ...(挂链 || { 父单: parentId }), ...(dep ? { 依赖: dep } : {}),
    ...(tk.fm.依据 ? { 依据: tk.fm.依据 } : {}), // H88：承重实现单挂方案单号，白名单不带就落不到盘
    ...(管线 ? { 管线 } : {}),                   // TK-106~116：管线归属同理，不带就只能靠父链继承
    单型: tk.fm.单型 || '实现单', 切单人: '项管',
  };
}

// 单张起草单的 frontmatter 白名单（draftTicket 用，与 childFm 同口径、独立一份因为无父单/无同批依赖）。
// 无父单意味着归属没得继承——管线漏写就直接进散单行（TK-115/116 案发现场），比子单路径更该带。
function draftFm(tk, { id, 项目, 粒ID }) {
  return {
    id, title: tk.fm.title || '起草单', 职能: tk.fm.职能 || '程序', 产出物类型: tk.fm.产出物类型 || '代码',
    优先级: tk.fm.优先级 || 'P1', 规模: '单兵', QA: tk.fm.QA || '开', 验收方式: tk.fm.验收方式 || '委托',
    预计时间: tk.fm.预计时间 || '0.25', 预计token: tk.fm.预计token || '50000', 项目,
    单型: tk.fm.单型 || '修复单', 切单人: '项管', 创建时间: new Date().toISOString().slice(0, 10),
    ...(tk.fm.依据 ? { 依据: tk.fm.依据 } : {}), // H88：同 cut，依据栏要落盘
    ...(tk.fm.管线 ? { 管线: tk.fm.管线 } : {}), // TK-106~116：同 cut，管线归属要落盘
    // 施工令-040：粒ID 由委托方（/api/pm/draft 请求体）指定，不由起草模型自填——
    // 它是台账与工单池的对账钥匙，让模型猜一个等于让账目自己长出来。
    ...(粒ID ? { 粒ID: String(粒ID) } : {}),
  };
}

// 切单主流程：调 fable → 解析 → 建草稿挂容器 → 简报落台账待审
// parentId 吃两形（见 容器()）：专项号 S-n（施工令-058 新路）或存量战役父单号。
function cut(root, cfg, parentId, projPath, cb) {
  const parent = 容器(root, parentId, cfg);
  if (!parent) return cb({ ok: false, error: parentId && String(parentId).startsWith('S-') ? '专项不存在' : '父单不存在' });
  const 校 = 备校准(root); // H101：切单链的校准步，取数一次，提示词与机器复核共用这张表
  const prompt = buildCutPrompt(root, cfg, parent, projPath, 校.块);
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
    if (!tickets.length) {
      // 施工令-054：无子单块先问一句「是不是拒切」——是则走候期出口（判语存档、父单原位不动），
      // 判不出才是真失败。顺序不能反：先记失败再补判语，等于 TK-146 再演一遍。
      const 拒 = parse拒切(text);
      if (拒) return cb({ ok: false, error: '拒切候期', ...拒 });
      return cb({ ok: false, error: '切单输出无子单块', raw: text.slice(0, 500) });
    }
    // 派号 + 建草稿（依赖引用同批序号→实际编号）
    // 前缀由容器给（施工令-058）：专项号 S-1 的子单要叫 TK-n，不能顺着容器号叫 S-n——
    // 那会跟下一个专项号 S-2 撞车，一个编号两种实体是账目最难拆的一种烂摊子。
    const px = parent.前缀 || 前缀Of(cfg, parent.fm && parent.fm.项目);
    let mx = 0;
    for (const s of store.STATES) for (const x of store.list(root, s)) {
      const mm = String(x.id).match(/^(.+)-(\d+)$/);
      if (mm && mm[1] === px) mx = Math.max(mx, Number(mm[2]));
    }
    const ids = tickets.map(() => `${px}-${++mx}`);
    const created = [];
    const 校痕 = [];
    tickets.forEach((tk, i) => {
      const fm = childFm(tk, { id: ids[i], ids, parentId, 项目: parent.fm.项目, 挂链: parent.挂链, 容器管线: parent.fm.管线 });
      const 记 = 校准落fm(root, ids[i], fm, 校.表); // H101 机器兜底：落盘前用同一张表复核估值
      if (记) 校痕.push(ids[i] + ' ' + estimate.记录一行(记));
      const r = store.create(root, ids[i], fm, tk.body);
      if (r.ok) created.push(ids[i]);
    });
    // 简报落台账，事件=待审（Claude 制作人层审批后放行）
    const briefPath = path.join(ledger.DIR(root), `拆单简报-${parentId}.md`);
    fs.mkdirSync(ledger.DIR(root), { recursive: true });
    // 机器侧校准结果附在简报末尾：模型写的「引用算式」与机器实际改写的值并排放，对不上一眼看得出
    const 校段 = 校痕.length ? `\n\n## 估时校准（H101 · 机器复核实况）\n${校痕.map((s) => '- ' + s).join('\n')}\n` : '';
    fs.writeFileSync(briefPath, `# 拆单简报 · ${parentId}\n\n子单：${created.join('、')}\n\n${brief || '（项管未附简报）'}\n${校段}`, 'utf8');
    ledger.event(root, '待审', { 父单: parentId, 子单: created, 简报: briefPath });
    // 0.23.3：拆单简报本体主动贴进项管信道——制作人不该去翻台账文件（用户实测困惑）
    try { require('../relay').append(root, '项管', '拆单完成：' + parentId + ' → ' + created.join('、') + '（简报呈 Claude 审批后放行）' + String.fromCharCode(10) + String.fromCharCode(10) + (brief || '（无简报正文）')); } catch { /* 信道失败不阻塞 */ }
    cb({ ok: true, 子单: created, 简报: briefPath });
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 兜底 */ }
}

// 收口报告：专项全落袋后汇总子单回执 → 验收包（含逐项验收步骤与成本账）
function closeout(root, cfg, parentId, cb) {
  const parent = 容器(root, parentId, cfg); // 施工令-058：收口对象同样吃 S-n 与存量战役父单两形
  if (!parent) return cb({ ok: false, error: parentId && String(parentId).startsWith('S-') ? '专项不存在' : '父单不存在' });
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
// opts.粒ID（施工令-040 第 6 条，可选）：这次起草兑现的排程计划粒。落草稿成功后
// 一并写进工单 frontmatter 并把粒推到「起草中」——挂接点就这一处，Pump/派发结构不动。
// 起草提示词（H101 起抽成纯函数：校准步的文本是可断言的合规面，藏在 spawn 里没法测）。
// 校准块可缺——缺时退化为「无历史可校」版，同 buildCutPrompt。
function buildDraftPrompt(cfg, 需求, projPath, 校准块) {
  const 单元 = ((cfg || {}).单元 || {});
  return [
    '你是单流的「项目管理」职能。制作人层委托你起草一张执行工单（单张，不是拆专项）。',
    '宪法要句（H80，规则空白时按此裁并注明依据）：①自动化——能给机器的不耗人 ②模块化——换实现不换协议 ③透明化——一切留痕如实呈报 ④自优化——教训必须变成协议或工具的改动 ⑤人本化——品味/取舍/方向/销毁性决定只属于人，AI 仅建议与执行。',
    '项目仓库（可读，用于盘点核实）：' + (projPath || '（未注册）'),
    '纪律：①先盘仓核实需求描述的现状 ②单元标准 ' + (单元.小时 || 0.25) + 'h/≤' + (单元.token || 50000) + ' token，顶格 2 单元 ③验收标准全部可判定 ④收尾锚点（受控重建/SavedScene/体积闸）只属装配单 ⑤如需求实际需要多张单，直说并建议走专项拍板，不要硬塞。',
    '短题制（H83，2026-08-06 制作人裁决，适用全部单型——子单/专项/父单/机制单一视同仁）：标题 ≤16 字、「对象+动作」结构（如「海岸线钉零与衰减」），不堆机制词不带括号补语；范围枚举（①②③…）一律写进正文「范围」章，禁入标题——标题是卡片的脸，长到要点进详情才认得出就是不合格。',
    '引擎门禁停闸（H97，2026-08-09 制作人批准，施工令-032 实装）：验收标准章里写了 enginectl / unity-test / 受控重建 这类引擎实测特征的单，核查判通过后不转完成——原位盖「候引擎实证」印停在待验收，待总监确认实测证据誊入回执后走「实证放行」才收。这是设计内的第二把钥匙，不是故障：这类验收标准要写成「谁跑哪条命令、回执里必须贴哪几个数字」的可复核条目，别只写「测试通过」。',
    FIELD_RULES,
    '输出契约与拆单相同：一个 ```ticket 代码块（title/单型/职能/产出物类型/优先级/QA/验收方式/预计时间/预计token/依赖（需求点名了就写，否则留空）/管线 + --- + 正文三章）。之后一段「起草说明」：盘点发现+边界取舍。',
    '管线归属必填（案源 TK-106~116，起草单尤重）：单张起草单没有父单可继承归属，漏写就必落看板「散单」行——凡属某条管线域的单，frontmatter 必须写 管线: P-N（注册表见 /api/pipelines 或按工单正文域语义判），确无归属的独立杂务才允许留空。',
    '', 校准块 || estimate.提示词块(null),
    '起草说明里必须单列「估时校准引用」一行：基准估值 × 引用的系数格 = 最终估值（无样本就写「无样本，未校准」）。',
    '', '=== 制作人层需求 ===', String(需求 || '').slice(0, 4000),
  ].join(String.fromCharCode(10));
}

function draftTicket(root, cfg, 需求, projPath, cb, opts) {
  setWorking({ 用途: '起草' });
  const 校 = 备校准(root); // H101：起草链的校准步，与切单同一套取数/表/复核
  const prompt = buildDraftPrompt(cfg, 需求, projPath, 校.块);
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
    // 施工令-061：项目 → 前缀 → 号段。起草单的项目取 opts.项目（派单委托可指定），缺省走项目默认。
    const 项目 = ((opts || {}).项目) || (cfg.项目 && cfg.项目.默认) || '';
    const nid = 下一号(root, 前缀Of(cfg, 项目));
    const tk = tickets[0];
    const 粒ID = ((opts || {}).粒ID) || null;
    const fm = draftFm(tk, { id: nid, 项目, 粒ID });
    const 记 = 校准落fm(root, nid, fm, 校.表); // H101 机器兜底：落盘前复核估值
    const r = store.create(root, nid, fm, tk.body);
    if (!r.ok) return cb(r);
    // 排程台账挂钩：粒 计划→起草中 + 回填单号。账记不上不能把起草带崩——单已经落盘了，
    // 这里抛异常只会让调用方以为起草失败而重起一张（同 pmLedger.event 的待遇：包一层，失败留痕）。
    if (粒ID) {
      try {
        const sr = require('./schedule').挂钩起草(root, 粒ID, nid);
        if (!sr.ok) require('../journal').append(root, `排程挂钩失败（起草 ${nid} · 粒 ${粒ID}）：${sr.error}`);
      } catch (e) { try { require('../journal').append(root, `排程挂钩异常（起草 ${nid}）：${e.message}`); } catch { /* 留痕失败不阻塞 */ } }
    }
    try {
      require('../relay').append(root, '项管', '受托起草：' + nid + ' ' + fm.title + '（草稿区待 Claude 审）'
        + String.fromCharCode(10) + String.fromCharCode(10) + (brief || '')
        + (记 ? String.fromCharCode(10) + String.fromCharCode(10) + '估时校准（机器复核）：' + estimate.记录一行(记) : ''));
    } catch { /**/ }
    ledger.event(root, '待审', { 单: nid, 起草: '单张' }); // 不写父单/子单：夜班推演 #7——伪装拆单结构会污染 H53 收口/成本归集
    cb({ ok: true, 单: nid });
  });
  try { child.stdin.write(prompt, 'utf8'); child.stdin.end(); } catch { /* close 兜底 */ }
}

module.exports = { cut, closeout, answer, draftTicket, adjudicateReferral, buildCutPrompt, buildDraftPrompt,
  parseTickets, parse拒切, childFm, draftFm, getWorking, 历史样本, 备校准, 校准落fm, 容器, 前缀Of, 下一号 };
