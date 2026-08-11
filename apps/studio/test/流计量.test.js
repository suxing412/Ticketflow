// 流计量.test.js — claude 流计量回灌 budget（施工令-047）
//
// 案源：robinwang2 2026-08-11「stream 侧计量口径」信。口径、坑、判超规矩全照信抄，不自创，
// 因此本文件锁的也是**信里的那几条**，而不是我们自己觉得合理的算法：
//   §二 三列分开取值（输入=max、缓存=max、输出=Σ），合计不含缓存
//   §四 三个坑：原始流绝不落账本 / 干跑不记账 / 记账失败不抛不阻断交单
//   §五 判超三硬规：未配预算的池永不冻结、算不出费用不判超、≥ 判超
//   §六 接口对齐：直接调 budget.usageOf + budget.记，不另立接口
// 外加要件一的起法（--output-format stream-json --verbose --include-partial-messages）
// 与它的连带面：增量事件不许污染 out（回执/产出解析口径必须逐字节不回归）。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const runner = require('../lib/runner');
const B = require('../../../packages/budget/budget.js');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('流计量回灌测试（施工令-047）');

const 新根 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'meter-'));
const 账行 = (root) => {
  const p = path.join(root, '预算账.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const journal读 = (root) => {
  const dir = path.join(root, 'journal');
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
};

/* ---- 构造流：形状照 claude CLI `-p --output-format stream-json --verbose --include-partial-messages`。
   （本机 claude CLI 的直调在本会话被权限闸拦下，故用构造流；事件形状与字段位置按信 §一/§二 与
   现行 extractClaudeText 的既有假设对齐，两条 usage 取值路径 e.usage / e.message.usage 都覆盖到。）
   两条 assistant 消息 + 一条 result：输入/缓存是累计量（取 max），输出是增量（Σ）。 ---- */
const 报告 = '# 完工报告 TK-47\\n## 做了什么\\n流计量回灌接线\\n结论：通过';
const 流行 = [
  '{"type":"system","subtype":"init","session_id":"s1","model":"claude-opus-5","tools":["Read","Edit"]}',
  '{"type":"stream_event","event":{"type":"message_start","message":{"id":"m1","role":"assistant","usage":{"input_tokens":9,"cache_read_input_tokens":11000,"output_tokens":1}}},"session_id":"s1"}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"先读工单"}},"session_id":"s1"}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"，再跑测试。"}},"session_id":"s1"}',
  '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":120}},"session_id":"s1"}',
  '{"type":"assistant","message":{"id":"m1","role":"assistant","content":[{"type":"text","text":"先读工单，再跑测试。"}],"usage":{"input_tokens":9,"cache_read_input_tokens":11000,"output_tokens":120}},"session_id":"s1"}',
  '这是一行非 JSON 噪声（CLI 偶尔吐，解析必须跳过而不是炸）',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]},"session_id":"s1"}',
  `{"type":"assistant","message":{"id":"m2","role":"assistant","content":[{"type":"text","text":"${报告}"}],"usage":{"input_tokens":12000,"cache_read_input_tokens":88000,"output_tokens":780}},"session_id":"s1"}`,
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":42000,"num_turns":2,"session_id":"s1","usage":{"input_tokens":12000,"cache_read_input_tokens":88000,"output_tokens":900}}',
];
const 全流 = 流行.join('\n') + '\n';

/* ===================== 一、口径（信 §二）===================== */

t('三列分开取值：输入=max、缓存=max、输出=Σ（口径照信，runner 不重写一份）', () => {
  const u = B.usageOf(全流);
  assert.equal(u.输入, 12000, '输入是累计量，取最大值');
  assert.equal(u.缓存, 88000, '缓存是累计量，取最大值');
  // 输出是增量口径，逐条累加：120（m1）+ 780（m2）+ 900（result 汇总行）
  // ——信 §二 就是 Σ(output_tokens)，result 那条与前两条重叠，于是 Σ 偏高。
  // 保险丝方向上偏保守（宁可早刹），但这条口径是对方给的、两边必须一致，本令不擅改。
  assert.equal(u.输出, 120 + 780 + 900);
  // 增量事件（stream_event）的 usage 挂在 e.event.usage 上，usageOf 只认 e.usage / e.message.usage
  // ——加 --include-partial-messages 后账不会被增量行重复灌大，这一条是要件一的安全前提。
  const 只增量 = 流行.filter((l) => l.includes('"stream_event"')).join('\n');
  assert.deepEqual(B.usageOf(只增量), { 输入: 0, 缓存: 0, 输出: 0 }, '增量行一旦被计入，每条消息都要重复记一遍');
});

t('合计不含缓存：缓存读计费约常价 1/10，混进合计就是「起草 57.9 万 token」那种虚胖', () => {
  const root = 新根();
  B.记(root, { 池: 'claude-key', 单: 'TK-47', 输入: 12000, 缓存: 88000, 输出: 900, t: '2026-08-12T00:10:00.000Z' });
  const s = B.汇总(root, 'claude-key', '2026-08-12T01:00:00.000Z');
  assert.equal(s.日.token, 12900, '合计只算输入+输出');
  assert.equal(s.日.缓存, 88000, '缓存仍要留数（只是不进合计）');
});

/* ===================== 二、起法与行分拣（要件一及其连带面）===================== */

t('claude 起法三旗俱全（stream-json + verbose + include-partial-messages）；codex 一旗不沾', () => {
  const a = runner.resolveCli('claude', 'opus').args;
  assert.ok(a.includes('--output-format') && a.includes('stream-json'), '没有 stream-json 就没有 usage 字段（信 §一）');
  assert.ok(a.includes('--verbose'));
  assert.ok(a.includes('--include-partial-messages'), '与 platform 侧 claude-cli.js 同起法（信 §一）');
  assert.ok(a.indexOf('-p') === 0, '--include-partial-messages 只在 --print 下生效');
  const c = runner.resolveCli('codex', 'gpt-x').args;
  assert.ok(!c.includes('--include-partial-messages') && !c.includes('stream-json'), 'codex 是另一条 CLI，起法不许被带歪');
  // *-key 之类的按量池同样走 claude CLI（命名陷阱：只有恰好叫 codex 的池才路由到 codex）
  assert.ok(runner.resolveCli('claude-key', '').args.includes('--include-partial-messages'));
});

t('行分拣：增量事件不进 out（产出解析口径不回归），含 usage 的整行另存细流', () => {
  const d = runner.流分拣器();
  const r = d.收(全流);
  assert.equal(r.主.includes('"stream_event"'), false, '增量行混进 out = 800KB 上限被撑爆、真报告被截头');
  for (const l of 流行) if (!l.includes('"stream_event"')) assert.ok(r.主.includes(l), '非增量行必须原样进主流：' + l.slice(0, 40));
  // 细流对 usageOf 而言与全量流等价（丢掉的行本来就一个 token 都数不出来）
  assert.deepEqual(B.usageOf(r.计量), B.usageOf(全流));
  assert.ok(r.计量.split('\n').filter(Boolean).length <= 3, '细流只收 usage 行，不该把整条会话搬进来');
  assert.deepEqual(r.增, ['先读工单', '，再跑测试。']);
});

t('分拣判据是解析出来的 e.type，不是「行里出现 stream_event 字样」', () => {
  // 本仓的 agent 就在改 runner.js，回执里原样引一段事件 JSON 是迟早的事——
  // 用字面量当判据，那一整行报告会被当增量丢掉，回执直接蒸发。
  const 引用行 = '{"type":"assistant","message":{"content":[{"type":"text","text":'
    + JSON.stringify('分拣把 {"type":"stream_event"} 这种行拦下来') + '}],"usage":{"input_tokens":5,"output_tokens":7}}}';
  const r = runner.流分拣器().收(引用行 + '\n');
  assert.ok(r.主.includes(引用行), '引了一句事件 JSON 的报告被当成增量丢了');
  assert.deepEqual(r.增, []);
  assert.equal(B.usageOf(r.计量).输出, 7, '这行的 usage 也得照收');
});

t('数据块边界劈开一行也不丢账：残段拼到下一块，末行无换行符靠收尾兜住', () => {
  const d = runner.流分拣器();
  const 计量 = [];
  // 逐 7 字节喂——最坏的分块形态（真实 stdout 就是这么不讲究）
  for (let i = 0; i < 全流.length - 1; i += 7) 计量.push(d.收(全流.slice(i, i + 7)).计量);
  计量.push(d.收(全流.slice(全流.length - 1).replace(/\n$/, '')).计量); // 末行故意不带换行
  计量.push(d.收尾().计量);
  assert.deepEqual(B.usageOf(计量.join('')), B.usageOf(全流), '分块喂出来的账必须与整流一字不差');
});

t('活尾巴：整块文本 + 其后到达的增量片（旧样一条消息期间纹丝不动）', () => {
  const 块 = '{"type":"assistant","message":{"content":[{"type":"text","text":"读工单，跑测试。"}]}}';
  assert.equal(runner.流尾(块, '').tail, '读工单，跑测试。');
  assert.equal(runner.流尾(块, '接着写回').tail, '读工单，跑测试。 接着写回');
  assert.equal(runner.流尾('', '还没有整块，只有增量').tail, '还没有整块，只有增量');
  assert.equal(runner.流尾('', '').tail, null, '什么都没有时不许伪造尾巴（调用方据此保持旧尾）');
  const 双块 = 块 + '\n{"type":"assistant","message":{"content":[{"type":"text","text":"第二块"}]}}';
  assert.deepEqual(runner.流尾(双块, '').tail3, ['读工单，跑测试。', '第二块']);
});

t('回执/产出解析不回归：带增量事件的流照样提取出真报告', () => {
  const 主 = runner.流分拣器().收(全流).主;
  const 文 = runner.extractClaudeText(主);
  assert.ok(/完工报告 TK-47/.test(文) && /结论：通过/.test(文), '真报告被吞了：' + 文.slice(0, 80));
  assert.ok(!/先读工单/.test(文), '取的应是最后一个像报告的文本块（TK-35 案口径）');
});

/* ===================== 三、计量挂点（要件一/二/三）===================== */

t('带 usage 的流 → 账落对：一次会话一行，口径与 usageOf 一致', () => {
  const root = 新根();
  const r = runner.计量回灌(root, { 池: 'claude-key', 单: 'TK-47', 流: 全流, 流式: true });
  assert.equal(r.记, true, r.因);
  const 行 = 账行(root);
  assert.equal(行.length, 1, '一次会话一行');
  assert.equal(行[0].池, 'claude-key');
  assert.equal(行[0].单, 'TK-47');
  assert.equal(行[0].输入, 12000);
  assert.equal(行[0].缓存, 88000);
  assert.equal(行[0].输出, 1800);
  assert.match(journal读(root), /流计量回灌 TK-47（claude-key）：输入 12000 · 缓存 88000 · 输出 1800/);
});

t('坑一：原始流绝不落账本——账行只有六个字段，流文本一个字节都不许进', () => {
  const root = 新根();
  runner.计量回灌(root, { 池: 'claude-key', 单: 'TK-47', 流: 全流, 流式: true });
  const 原文 = fs.readFileSync(path.join(root, '预算账.jsonl'), 'utf8');
  assert.deepEqual(Object.keys(账行(root)[0]).sort(), ['t', '单', '池', '缓存', '输入', '输出'].sort(),
    '账行多出/少了字段——记账前剥内部字段那一道没守住');
  // 84KB 那次事故的判据：会话内容整段静默持久化到磁盘。挑几个只在流里出现的串逐个查。
  for (const 串 of ['stream_event', 'session_id', '完工报告', '先读工单', 'tool_result']) {
    assert.equal(原文.includes(串), false, `账本里出现了原始流片段「${串}」——正是信 §四.1 的 84KB 事故`);
  }
  assert.ok(原文.length < 200, '一行账 200 字节都用不了，超了就是夹带了别的东西：' + 原文.length);
});

t('坑二：干跑/零消耗不记账（没花钱就别污染用量窗口）', () => {
  const root = 新根();
  const 无usage = ['{"type":"system","subtype":"init","session_id":"s2"}',
    '{"type":"assistant","message":{"content":[{"type":"text","text":"干跑演练"}]}}',
    '{"type":"result","subtype":"success","is_error":false}'].join('\n');
  const r = runner.计量回灌(root, { 池: 'claude-key', 单: 'TK-48', 流: 无usage, 流式: true });
  assert.equal(r.记, false);
  assert.match(r.因, /零消耗/);
  assert.equal(fs.existsSync(path.join(root, '预算账.jsonl')), false, '零消耗也开了一行 = 干跑污染用量窗口');
  // 空流、undefined 流同理（CLI 崩在起手式上时就是这形态）
  assert.equal(runner.计量回灌(root, { 池: 'claude-key', 单: 'TK-49', 流: '', 流式: true }).记, false);
  assert.equal(runner.计量回灌(root, { 池: 'claude-key', 单: 'TK-49', 流式: true }).记, false);
});

t('坑三：记账抛错 → 不抛、不阻断交单（保险丝坏了不该顺带炸掉产线）', () => {
  const root = 新根();
  const 炸记 = { usageOf: B.usageOf, 记: () => { throw new Error('演练：账本盘满'); } };
  let r;
  assert.doesNotThrow(() => { r = runner.计量回灌(root, { 池: 'claude-key', 单: 'TK-50', 流: 全流, 流式: true }, 炸记); });
  assert.equal(r.记, false);
  assert.match(r.因, /记账异常：演练：账本盘满/);
  assert.match(journal读(root), /流计量回灌失败 TK-50.*不阻断交单/, '失败要留证，但只在流水里留，不许往上抛');
  // 解析口径那一半炸了同样不许外抛
  const 炸析 = { usageOf: () => { throw new Error('演练：解析炸了'); }, 记: () => { throw new Error('不该走到这'); } };
  assert.doesNotThrow(() => runner.计量回灌(root, { 池: 'claude-key', 单: 'TK-51', 流: 全流, 流式: true }, 炸析));
  // 记() 静默返回 null（空实现/写盘失败）也只是不记，不炸
  const 空实现 = { usageOf: B.usageOf, 记: () => null };
  assert.equal(runner.计量回灌(root, { 池: 'claude-key', 单: 'TK-52', 流: 全流, 流式: true }, 空实现).记, false);
  // 收线路径上的调用顺序：先回灌再 settleClose，且回灌不带 try——它必须自己包死
  const 源 = fs.readFileSync(path.join(__dirname, '..', 'lib', 'runner.js'), 'utf8');
  const 收线 = 源.slice(源.indexOf("child.on('close'"));
  const i = 收线.indexOf('计量回灌(root, { 池: cliPool');
  const j = 收线.indexOf('settleClose(kind, code');
  assert.ok(i > 0 && j > i, '收线处没有按「先回灌、后收线裁决」接线');
});

t('要件三：codex 显式不计量——不臆造数字、不落假账行、journal 不落账', () => {
  const root = 新根();
  // 就算硬把一条带 usage 的流塞给它，也不许记（codex 那条流现实里不长这样，此处是防守测试）
  const r = runner.计量回灌(root, { 池: 'codex', 单: 'TK-53', 流: 全流, 流式: true });
  assert.equal(r.记, false);
  assert.match(r.因, /不计量池，消耗不入预算账/);
  assert.equal(fs.existsSync(path.join(root, '预算账.jsonl')), false);
  assert.equal(journal读(root), '', 'codex 会话不许在流水里留计量行——半条假账比没有账更误导');
  // 纯文本流（流式=false）同理：codex CLI 的真实形态
  const 文本流 = '完工报告：做完了。tokens used: 12345';
  const r2 = runner.计量回灌(root, { 池: 'codex', 单: 'TK-54', 流: 文本流, 流式: false });
  assert.equal(r2.记, false);
  assert.match(r2.因, /不计量池/);
  assert.equal(fs.existsSync(path.join(root, '预算账.jsonl')), false);
});

t('壳形状校验加验 usageOf/记：半截包不许一路静默不落账（信 §六 接口对齐）', () => {
  const R = require('../lib/budget-resolve');
  const 仓 = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-res-'));
  fs.writeFileSync(path.join(仓, 'studio.config.json'), JSON.stringify({ packages路径: '包们' }), 'utf8');
  const 假包 = path.join(仓, '包们', 'budget');
  fs.mkdirSync(假包, { recursive: true });
  // 只有冻结那半边的包：046 的形状校验放行，于是计量那半边静默失灵
  fs.writeFileSync(path.join(假包, 'budget.js'), 'module.exports = { 冻结池: () => ({}), 并入: (g) => g };', 'utf8');
  const m = R.解析({ 相对: '../../../packages/budget-不存在/budget.js', 环境: '', 根: 仓 });
  assert.equal(m.失效, true, '半截包被当成好包收下了——计量会静默失灵');
  assert.match(m.失败因[2].因, /缺 usageOf\/记/);
});

/* ===================== 四、判超三硬规（信 §五，要件四：包已内置，测试锁死）===================== */

t('硬规一：未配预算的池永不被冻结——不配 = 不管，绝不臆造上限', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { 'claude-key': { 日token: 100 } } } };
  B.记(root, { 池: 'codex', 输入: 9999999, 输出: 9999999, t: '2026-08-12T00:00:00.000Z' });
  const 冻 = B.冻结池(cfg, root, '2026-08-12T02:00:00.000Z');
  assert.equal('codex' in 冻, false, '没配预算的池被冻了 = 凭空给别人定了个上限');
  assert.equal(B.超预算(cfg, root, 'codex', '2026-08-12T02:00:00.000Z').超, false);
  assert.deepEqual(B.冻结池({}, root, '2026-08-12T02:00:00.000Z'), {}, '整个预算段没配时一个池都不许冻');
});

t('硬规二：算不出费用就不许判超——配了日额没配价目，只剩 token 口径', () => {
  const root = 新根();
  const 今 = '2026-08-12T03:00:00.000Z';
  const cfg = { 预算: { 池: { 'claude-key': { 日额: 1 } } } }; // 有金额闸、无价目
  B.记(root, { 池: 'claude-key', 输入: 5000000, 输出: 5000000, t: 今 });
  assert.equal(B.估费(cfg, 'claude-key', { 输入: 5000000, 输出: 5000000 }), null, '没价目就该算不出钱');
  assert.equal(B.超预算(cfg, root, 'claude-key', 今).超, false, '拿瞎猜的数字掐了派发');
  // 补上价目，同一份账立刻判超——证明上一条不是因为别的原因不超
  const cfg2 = { 预算: { 池: { 'claude-key': { 日额: 1 } }, 价目: { 'claude-key': { 输入: 3, 输出: 15 } } } };
  assert.equal(B.超预算(cfg2, root, 'claude-key', 今).超, true);
});

t('硬规三：≥ 而非 >——用到线上就算超，保守一格', () => {
  const root = 新根();
  const 今 = '2026-08-12T04:00:00.000Z';
  const cfg = { 预算: { 池: { k: { 日token: 100 } } } };
  B.记(root, { 池: 'k', 输入: 99, 输出: 0, t: 今 });
  assert.equal(B.超预算(cfg, root, 'k', 今).超, false, '99 < 100 不该超');
  B.记(root, { 池: 'k', 输入: 1, 输出: 0, t: 今 });
  assert.equal(B.超预算(cfg, root, 'k', 今).超, true, '正好到线（100 ≥ 100）必须判超');
  // 缓存不进合计这条同时也是判超的口径：光靠缓存烧不出「超」来
  const root2 = 新根();
  B.记(root2, { 池: 'k', 输入: 10, 缓存: 999999, 输出: 10, t: 今 });
  assert.equal(B.超预算(cfg, root2, 'k', 今).超, false, '缓存被算进合计了，判超口径跟着虚胖');
});

/* ===================== 五、额度卡「不计量池」标注探针（要件三）=====================
   浏览器/Electron 在本会话起不来，故按既有惯例（escalReason 那格）把 poolCardHtml
   从 public/app.js 原样抽出来渲真 HTML——测的是生产那一份源码，不是抄本。 */

const poolCardHtml = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const a = src.indexOf('// @testable-begin poolCardHtml');
  const b = src.indexOf('// @testable-end poolCardHtml');
  assert.ok(a >= 0 && b > a, 'public/app.js 里的 poolCardHtml 抽取标记丢了——测试与实现已脱钩');
  // eslint-disable-next-line no-new-func
  return new Function('esc', src.slice(a, b) + '\nreturn poolCardHtml;')(
    (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
})();

t('额度卡：codex 池标「不计量池——消耗不入预算账」，claude 池不标', () => {
  const 锁 = { fivePct: 40, weekPct: 55, locked: false };
  const cx = poolCardHtml('codex', 锁, { 阈值: 70, 周阈值: 90 });
  assert.ok(cx.includes('不计量池——消耗不入预算账'), 'codex 额度卡没标不计量：制作人会把空账当成没花钱');
  assert.match(cx, /class="nometer"/);
  assert.match(cx, /title="[^"]*stream-json[^"]*"/, '悬停要说清为什么取不到 usage，否则标注等于一句断言');
  assert.match(cx, /title="[^"]*不臆造数字[^"]*"/, '与「池衡盲区不编数」同纪律，悬停里要写明');
  const cl = poolCardHtml('claude', 锁, { 阈值: 70, 周阈值: 90 });
  assert.equal(cl.includes('不计量池'), false, 'claude 家族是计量池，标上去就是假消息');
  // 标注不许把原有的窗口行/护城河挤掉
  assert.ok(cx.includes('5h') || cx.includes('周'), '窗口行没了');
  const 护 = poolCardHtml('claude', 锁, {}, { 池: 'claude', 已越: true, 窗口: '5h', 余量: 8, 保留线: 10 });
  assert.ok(护.includes('沟通保留线'), '护城河提示被挤掉了');
  // 样式面：三块提示各走各的色，别混成一片红
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  assert.match(css, /\.poolcard \.nometer\s*{/, 'nometer 没有样式，标注会裸奔成一行白字');
  assert.equal(/\.poolcard \.nometer[^}]*var\(--danger\)/.test(css), false, '不计量是事实不是故障，不许用危险红');
});

console.log(`全部通过：${passed} 项`);
