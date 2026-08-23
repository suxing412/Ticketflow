// precheck.test.js — 初检机判（施工令-031 / H96）。五类场景照案源逐条回归：
//   截断（TK-102）/ 豁免（TK-112·TK-113）/ 真空壳 / 禁语 / 缺章
// 外加 runner 接线的端到端：tick 一轮机判初检写 fm（结论/时间/备注 同构）、零 CLI 零会话。
// 外呼绊线必须排在任何 lib/ require 之前（lib/quota.js:9 在模块加载那一刻就把
// child_process 的函数引用解构走了，事后再替字段无效）。见 test/外呼绊线.js 抬头。
const 绊线 = require('./外呼绊线'); 绊线.装绊线();
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const precheck = require('../lib/precheck');
const runner = require('../lib/runner');
const store = require('../lib/core/store');
const state = require('../lib/core/state');
const { makeRoot, seed, CFG } = require('./helper');
const quota = require('../lib/quota');
quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('precheck 初检机判测试（施工令-031 / H96）');

// ---- 素材：一份合格单据 + 一份合格回执 ----
const 单据正文 = `## 范围
做点什么。

## 验收标准

1. 编译零错误
2. 新增测试类存在
3. 全量测试全绿

## 不要做
不打包。`;

const 好回执 = `# 完工报告 X-01

## 自测结果

| # | 验收标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 编译零错误 | ✓ | dotnet build 退出码 0 |
| 2 | 新增测试类存在 | ✓ | Foo.cs 在位 |
| 3 | 全量测试全绿 | ✗ | 2 例红，见异议 |

## 实际消耗
约 40 分钟；约 90000 tokens

## 异议
无`;

function 铺(root, id, 回执文本, opts = {}) {
  fs.mkdirSync(path.join(root, '回执'), { recursive: true });
  fs.writeFileSync(path.join(root, '回执', `${id}.md`), 回执文本, 'utf8');
  seed(root, '核查', { id, 职能: '程序', 验收方式: '委托', body: opts.body || 单据正文, ...(opts.fm || {}) }); // H108：初检/核查会话同驻「核查」目录（原 待验收）
  return store.find(root, id);
}

(async () => {
// ================= 基线：合格回执必须过 =================
// 用例名里不许出现 ✗：deploy-ritual 换装闸判据是 `npm test 2>&1 | grep -c "✗"` 必须为 0，
// 全绿输出里带 ✗ 的用例名会让那道闸结构性不可达（2026-08-22 体检 #1/#5/#7）。
await t('合格回执 → 过（不通过判定也是应答：判定对错归深检，初检不越界）', () => {
  const root = makeRoot();
  const t1 = 铺(root, 'X-01', 好回执);
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '过', JSON.stringify(r.缺项));
  assert.deepEqual(r.缺项, []);
  assert.equal(r.判源, '机判');
  assert.equal(r.统计.标准条数, 3);
  assert.equal(r.统计.应答条数, 3);
  assert.ok(/机判初检｜结论 过/.test(r.备注), '备注有总账行');
  assert.ok(/\[逐条\]/.test(r.备注) && /\[禁语\]/.test(r.备注), '备注列明逐项判定');
});

// ================= 场景一：截断（TK-102 案）=================
await t('截断场景：2MB 回执超上限即拒，缺项注明「截断风险」', () => {
  const root = makeRoot();
  const 填充 = '\n附录：日志逐行摘录。'.repeat(120000); // > 2MB
  const 大回执 = 好回执 + 填充;
  const t1 = 铺(root, 'X-02', 大回执);
  assert.ok(fs.statSync(path.join(root, '回执', 'X-02.md')).size > 2 * 1024 * 1024, '素材确实超 2MB');
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '不过');
  assert.ok(r.缺项.some((x) => x.includes('截断风险')), '缺项注明截断风险：' + JSON.stringify(r.缺项));
  assert.ok(r.缺项.some((x) => x.includes('超上限')), '报出实际尺寸与上限');
});

await t('截断场景反面证据：尾部藏 ERROR 也读得到——机判读全文，不是前 12000 字', () => {
  const root = makeRoot();
  // 前 2MB 全是干净正文，禁语只藏在最后一行（旧 flash 路径 slice(0,12000) 必然漏看）
  const 尾部 = '\n\n## 收尾\nERROR：全量测试 In progress，跑完后补。\n';
  const 大回执 = 好回执 + '\n附录：日志。'.repeat(120000) + 尾部;
  const t1 = 铺(root, 'X-03', 大回执);
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '不过');
  const 禁 = r.缺项.find((x) => x.includes('空壳标志'));
  assert.ok(禁, '尾部禁语被抓到（证明零截断）：' + JSON.stringify(r.缺项));
  assert.ok(禁.includes('In progress') && 禁.includes('跑完后补'), '两个尾部禁语都命中：' + 禁);
  assert.ok(r.缺项.some((x) => x.includes('截断风险')), '同时仍报截断风险');
});

await t('上限可配：调大到 8MB 后同一份 2MB 回执不再判超限', () => {
  const root = makeRoot();
  const t1 = 铺(root, 'X-04', 好回执 + '\n附录：日志。'.repeat(120000));
  const cfg = { ...CFG, 执行器: { 两检: { 初检: { 回执上限字节: 8 * 1024 * 1024 } } } };
  const r = precheck.run(root, t1, cfg);
  assert.ok(!r.缺项.some((x) => x.includes('截断风险')), '阈值走 config：' + JSON.stringify(r.缺项));
  assert.equal(r.初检, '过');
});

// ================= 场景二：豁免（TK-112 / TK-113 实案措辞）=================
await t('豁免·条目级（TK-113 措辞）：标准写「初检不得以占位判缺项」→ 该条占位不判缺项', () => {
  const root = makeRoot();
  const 正文 = `## 验收标准

1. 编译零错误
2. 新增测试类存在
3. **报数齐**：⑨ 的每一项在回执有实测值。**实测栏由总监代劳节权威提供，初检不得以占位判缺项**；总监代劳誊入不判失分。`;
  const 回执 = `# 完工报告 X-10

## 自测结果

| # | 验收标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 编译零错误 | ✓ | 退出码 0 |
| 2 | 测试类存在 | ✓ | 在位 |

第 3 条实测栏待审检/总监代劳实测后誊入。

## 实际消耗
约 55 分钟；约 135000 tokens

## 异议
无`;
  const t1 = 铺(root, 'X-10', 回执, { body: 正文 });
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '过', '豁免命中不该判不过：' + JSON.stringify(r.缺项));
  assert.ok(r.豁免.some((x) => x.includes('标准 3') && x.includes('初检不得以占位判缺项')), '豁免逐条入账：' + JSON.stringify(r.豁免));
  assert.ok(/⊘ \[逐条\]/.test(r.备注), '备注用 ⊘ 标出豁免项，透明可审');
  assert.ok(/⊘ \[禁语\]/.test(r.备注), '禁语「待誊入」同样落进豁免域并留痕');
});

await t('豁免·全单级（TK-112 措辞）：代劳口径写在另一条标准里，同样罩住占位', () => {
  const root = makeRoot();
  const 正文 = `## 验收标准

1. 编译自查两取一达标
2. 实测报数入回执（V_total / T / 耗时 ms）
3. **代劳口径**：执行池若无法投递 enginectl，B/D 两组实测数字由总监代跑并誊入回执，**不判失分**。`;
  const 回执 = `# 完工报告 X-11

## 自测结果

| # | 验收标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 编译 | ✓ | 两取一达标 |
| 3 | 代劳口径 | ✓ | 已按口径办 |

第 2 条报数待誊入（总监代劳实测）。

## 实际消耗
约 1.5 小时；约 200000 tokens

## 异议
无`;
  const t1 = 铺(root, 'X-11', 回执, { body: 正文 });
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '过', JSON.stringify(r.缺项));
  assert.ok(r.豁免.some((x) => x.includes('标准 2') && x.includes('全单豁免')), '全单级豁免逐条入账：' + JSON.stringify(r.豁免));
  assert.ok(r.备注.includes('不判失分'), '备注写明命中的是哪句条款');
});

// ================= 场景三：真空壳（无豁免条款 + 占位 → 拒）=================
await t('真空壳：同款占位，单据没写豁免条款 → 判缺项不过', () => {
  const root = makeRoot();
  const 回执 = `# 完工报告 X-20

## 自测结果

| # | 验收标准 | 结论 | 证据 |
|---|---|---|---|
| 1 | 编译零错误 | ✓ | 退出码 0 |

第 2、3 条待誊入。

## 实际消耗
约 30 分钟；约 40000 tokens

## 异议
无`;
  const t1 = 铺(root, 'X-20', 回执); // 单据正文无任何豁免措辞
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '不过');
  assert.ok(r.缺项.some((x) => x.includes('缺第 2、3 条')), '逐条缺项报到具体条号：' + JSON.stringify(r.缺项));
  assert.ok(r.缺项.some((x) => x.includes('空壳标志') && x.includes('单据无豁免条款')), '禁语同判：' + JSON.stringify(r.缺项));
  assert.deepEqual(r.豁免, [], '无豁免记录');
});

await t('空回执 / 缺回执：直接不过，不做后续判项', () => {
  const root = makeRoot();
  const a = 铺(root, 'X-21', '   \n  ');
  const ra = precheck.run(root, a, CFG);
  assert.equal(ra.初检, '不过');
  assert.ok(ra.缺项[0].includes('空文件'));

  seed(root, '核查', { id: 'X-22', 职能: '程序', 验收方式: '委托', body: 单据正文 });
  const rb = precheck.run(root, store.find(root, 'X-22'), CFG);
  assert.equal(rb.初检, '不过');
  assert.ok(rb.缺项[0].includes('不存在'));
});

// ================= 场景四：禁语 =================
await t('禁语命中：In progress / Waiting / 等待确认 逐词报数', () => {
  const root = makeRoot();
  const 回执 = 好回执.replace('## 异议\n无', '## 异议\n三方接口 Waiting，等待确认；本地跑批 In progress。');
  const t1 = 铺(root, 'X-30', 回执);
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '不过');
  const 禁 = r.缺项.find((x) => x.includes('空壳标志'));
  assert.ok(禁.includes('In progress×1') && 禁.includes('Waiting×1') && 禁.includes('等待确认×1'), '逐词报数：' + 禁);
});

await t('禁语表可配：清空成自定义表后旧禁语不再命中', () => {
  const root = makeRoot();
  const 回执 = 好回执.replace('## 异议\n无', '## 异议\n本地跑批 In progress。');
  const t1 = 铺(root, 'X-31', 回执);
  const cfg = { ...CFG, 执行器: { 两检: { 初检: { 禁语: ['绝不可能出现的词'] } } } };
  const r = precheck.run(root, t1, cfg);
  assert.equal(r.初检, '过', JSON.stringify(r.缺项));
});

await t('分轮回执只判末轮：上一轮的占位是历史，不算本轮空壳', () => {
  const root = makeRoot();
  const 回执 = `# 完工报告 X-32

## 自测结果
第 1-3 条待誊入，In progress。

## 实际消耗
10 分钟 / 1000 token

## 异议
无

---
## 第 2 轮回执（返修后）

${好回执}`;
  const t1 = 铺(root, 'X-32', 回执, { fm: { 返修轮: 1 } });
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '过', '末轮干净就该过：' + JSON.stringify(r.缺项));
});

// ============ 场景五之前：追加轮识别（施工令-053，四夹具照案源）============
// 案源：2026-08-12/13 连续 8 张单机判 0/N 全靠人工裁。回执按轮追加后，旧机判读的是**第一轮**
// 的「## 自测结果」——末轮改叫「逐条自证」就整节找不到，誊录版整段带 `>` 前缀更是一条认不出。
// 夹具在 test/fixtures/回执-TK-*.md：TK-144 多轮追加、TK-168 抢救誊录、TK-156/160 单轮老格式。
// 后两张是施工令-051 留下的真形态回执（无自测节），在此当「零回归」的对照组。
const 夹具 = (id) => fs.readFileSync(path.join(__dirname, 'fixtures', `回执-${id}.md`), 'utf8');
const 标准表 = (...条) => '## 验收标准\n\n' + 条.map((x, i) => `${i + 1}. ${x}`).join('\n');
const TK144标准 = 标准表(
  '废弃单落 `完成` 而非 `撤销`', '末次说明写明废弃闭合理由', '差量归零',
  '事件流水留痕', '六粒逐条列出含落态与因', '全量测试零回归');
const TK168标准 = 标准表(
  '导出前置校验拦得住空字段', '拦下时报到具体字段名', '合法数据零误拦',
  '校验耗时不劣化导出', '新增测试类在位且全绿');

await t('追加轮·TK-144（3 轮，末轮节名「逐条自证」）：判末轮 6/6，旧法读首轮读成 0/6', () => {
  const root = makeRoot();
  const t1 = 铺(root, 'TK-144', 夹具('TK-144'), { body: TK144标准, fm: { 返修轮: 2 } });
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.统计.轮数, 3, '三轮都切得出来');
  assert.equal(r.统计.标准条数, 6);
  assert.equal(r.统计.应答条数, 6, '末轮「### 逐条自证」六条全认（人工判读同数）：' + JSON.stringify(r.缺项));
  assert.equal(r.初检, '过', JSON.stringify(r.缺项));
  assert.ok(!r.缺项.some((x) => x.includes('空壳标志')), '首轮的「待誊入 / In progress」是历史，不算末轮空壳');
  assert.ok(r.备注.includes('（3 轮，判末轮）'), '备注写明判的是哪一轮：' + r.备注.split('\n')[0]);
  // 反证：旧法的判材选取（只认「自测结果」节名）在这份回执上取不到任何应答
  assert.equal(precheck.章节(precheck.末轮(夹具('TK-144')), '自测结果'), null, '末轮确实没有「自测结果」节名');
});

await t('追加轮·TK-168（抢救誊录，整段引用 + 按语前缀）：剥引用后 5/5，旧法 0/5', () => {
  const root = makeRoot();
  const t1 = 铺(root, 'TK-168', 夹具('TK-168'), { body: TK168标准 });
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.统计.轮数, 2, '半份原件 + 誊录版 = 两轮');
  assert.equal(r.统计.应答条数, 5, '誊录版表格逐条认出（人工判读同数）：' + JSON.stringify(r.缺项));
  assert.equal(r.初检, '过', JSON.stringify(r.缺项));
  assert.ok(!r.缺项.some((x) => x.includes('缺章节')), '章节在引用里也认得出：' + JSON.stringify(r.缺项));
  assert.ok(!r.缺项.some((x) => x.includes('空壳标志')), '首轮的 Waiting / 跑完后补 属上一轮');
  // 反证：不剥引用则整份誊录体一个标题都解析不出
  const 原样 = 夹具('TK-168').split('---')[1] || '';
  assert.equal(precheck.章节(原样, '自测结果'), null, '带 `>` 前缀时旧法看不见任何章节');
});

await t('单轮老格式零回归·TK-156 / TK-160：不误切轮、判材仍是全文、结论与改前一致', () => {
  const root = makeRoot();
  for (const id of ['TK-156', 'TK-160']) {
    const raw = 夹具(id);
    assert.equal(precheck.轮段(raw).length, 1, `${id} 是单轮，不该被切成多段`);
    assert.equal(precheck.末轮(raw).trim(), precheck.去引(raw).trim(), `${id} 末轮即全文`);
    const t1 = 铺(root, id, raw, { body: 标准表('产出清单在位', '数据可复核', '异议已交代') });
    const r = precheck.run(root, t1, CFG);
    assert.equal(r.统计.应答条数, 0, `${id} 本就没有自测节，人工判读也是 0`);
    assert.equal(r.初检, '不过');
    const 章 = r.缺项.find((x) => x.includes('缺章节'));
    assert.ok(章 && 章.includes('自测结果') && 章.includes('实际消耗'), `${id} 缺章报法照旧：` + 章);
    assert.ok(!r.备注.includes('判末轮'), '单轮不加轮次标注');
  }
});

await t('追加轮·边角：轮头与轮身分家、末尾追加机判章不夺判卷面', () => {
  // 轮头单独一行、报告体另起 `# 完工报告`——两段属同一轮，返修说明不该判缺
  const 分家 = `# 完工报告 Y-01\n\n## 自测结果\n第 1-3 条待誊入。\n\n## 实际消耗\n5 分钟 / 900 token\n\n## 异议\n无\n\n## 第 2 轮回执（返修后）\n\n---\n\n${好回执}`;
  const root = makeRoot();
  const a = 铺(root, 'Y-01', 分家, { fm: { 返修轮: 1 } });
  const ra = precheck.run(root, a, CFG);
  assert.equal(ra.初检, '过', '轮头与轮身合段：' + JSON.stringify(ra.缺项));
  assert.equal(ra.统计.应答条数, 3);
  // 机判自己回写的「## 两检初检（机判）」追在末尾，不含自测节 → 判卷面仍是上一段
  const b = 铺(root, 'Y-02', 好回执 + '\n\n## 两检初检（机判）\n结论：过\n', {});
  const rb = precheck.run(root, b, CFG);
  assert.equal(rb.统计.应答条数, 3, '末尾追加节不夺判卷面');
  assert.equal(rb.初检, '过', JSON.stringify(rb.缺项));
  // 轮标出现在自测节**之后**（如「## 完工报告格式说明」）：头一截也是一轮，不能被切丢
  const 尾标 = 好回执.split('\n').slice(1).join('\n') + '\n\n## 完工报告格式说明\n照抄模板即可。\n';
  const c = 铺(root, 'Y-03', 尾标, {});
  const rc = precheck.run(root, c, CFG);
  assert.equal(rc.统计.应答条数, 3, '首个轮标之前的自测节仍是判卷面');
  assert.equal(rc.初检, '过', JSON.stringify(rc.缺项));
});

await t('追加轮·工具函数：去引 / 轮段 / 章节并 各司其职', () => {
  assert.equal(precheck.去引('> ## 自测结果\n>> 深引\n  > 缩进引\n正文'), '## 自测结果\n深引\n  缩进引\n正文');
  assert.equal(precheck.轮段('无标题的散文回执').length, 1, '没标题就是一段');
  const 两节 = '## 自测结果\n1. ✓ 甲\n\n## 补充自证\n2. ✓ 乙\n';
  assert.ok(precheck.章节并(两节, ...precheck.自测别名).includes('甲'), '同轮多节合并计数');
  assert.ok(precheck.章节并(两节, ...precheck.自测别名).includes('乙'));
  const { map } = precheck.应答表('| 第 3 条 | ✓ | 证据 |\n4）✓ 丁\n5：✓ 戊\n耗时 1.5 秒 ✓');
  assert.deepEqual([...map.keys()].sort(), [3, 4, 5], '第 N 条 / 全角括号 / 冒号都认，「1.5 秒」不误读成第 1 条');
});

// ================= 场景五：缺章 / 缺字段 / 报数 =================
await t('缺章：自测结果 / 实际消耗 / 异议 少一节即缺项', () => {
  const root = makeRoot();
  const 回执 = 好回执.split('## 实际消耗')[0]; // 砍掉实际消耗 + 异议
  const t1 = 铺(root, 'X-40', 回执);
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '不过');
  const 章 = r.缺项.find((x) => x.includes('缺章节'));
  assert.ok(章.includes('实际消耗') && 章.includes('异议'), '两节都报：' + 章);
});

await t('必备章节可配：只要求自测结果时，缺实际消耗不判', () => {
  const root = makeRoot();
  const t1 = 铺(root, 'X-41', 好回执.split('## 实际消耗')[0]);
  const cfg = { ...CFG, 执行器: { 两检: { 初检: { 必备章节: ['自测结果'], 报数双报: false } } } };
  const r = precheck.run(root, t1, cfg);
  assert.equal(r.初检, '过', JSON.stringify(r.缺项));
});

await t('实际消耗单报（只有用时没有 token）→ 缺项', () => {
  const root = makeRoot();
  const t1 = 铺(root, 'X-42', 好回执.replace('约 40 分钟；约 90000 tokens', '约 40 分钟'));
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '不过');
  assert.ok(r.缺项.some((x) => x.includes('未双报')), JSON.stringify(r.缺项));
});

await t('fm 必填结构位缺失（验收方式空）→ 缺项，且字段表可配', () => {
  const root = makeRoot();
  const t1 = 铺(root, 'X-43', 好回执);
  t1.fm.验收方式 = '';
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '不过');
  assert.ok(r.缺项.some((x) => x.includes('验收方式')), JSON.stringify(r.缺项));
  const r2 = precheck.run(root, t1, { ...CFG, 执行器: { 两检: { 初检: { 必填字段: ['id'] } } } });
  assert.equal(r2.初检, '过', '字段表可配');
});

await t('返修单无本轮说明 → 缺项；有说明 → 过', () => {
  const root = makeRoot();
  const 坏 = 铺(root, 'X-44', 好回执, { fm: { 返修轮: 2 } });
  assert.ok(precheck.run(root, 坏, CFG).缺项.some((x) => x.includes('相对上轮')));
  const 好 = 铺(root, 'X-45', '# 完工报告\n相对上轮改了什么：补齐报数。\n\n' + 好回执.split('\n').slice(1).join('\n'), { fm: { 返修轮: 2 } });
  assert.equal(precheck.run(root, 好, CFG).初检, '过');
});

// ================= 误拦防线（案源：一夜五次形式性误拦）=================
await t('宽松放行：回执不按编号列行但判定符足额 → 不判缺项（体例差异不是缺项）', () => {
  const root = makeRoot();
  const 回执 = `# 完工报告 X-50

## 自测结果
- 编译零错误：✓ 退出码 0
- 新增测试类存在：✓ Foo.cs 在位
- 全量测试全绿：✓ 349/349

## 实际消耗
20 分钟 / 30000 token

## 异议
无`;
  const t1 = 铺(root, 'X-50', 回执);
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '过', JSON.stringify(r.缺项));
  assert.ok(r.备注.includes('体例宽松放行'));
});

await t('单据没列可编号验收标准 → 逐条项不判（拆单侧问题不算执行方缺项）', () => {
  const root = makeRoot();
  const t1 = 铺(root, 'X-51', 好回执, { body: '## 验收标准\n看着办。' });
  const r = precheck.run(root, t1, CFG);
  assert.equal(r.初检, '过', JSON.stringify(r.缺项));
  assert.equal(r.统计.标准条数, 0);
});

await t('checkbox 体例的验收标准（施工令样式）也数得出条目', () => {
  const 条 = precheck.验收标准条目('## 验收标准\n\n- [ ] 五类场景测试全绿\n- [ ] 桩台实测一单走通\n- [ ] 完工纪要逐条证据\n');
  assert.equal(条.length, 3);
  assert.deepEqual(条.map((x) => x.号), [1, 2, 3]);
});

// ================= 输出同构 =================
await t('输出同构：结论/缺项/备注/判源 四件套 + 缺项封顶 10 条', () => {
  const root = makeRoot();
  const 正文 = '## 验收标准\n\n' + Array.from({ length: 20 }, (_, i) => `${i + 1}. 条目 ${i + 1}`).join('\n');
  const t1 = 铺(root, 'X-60', 好回执, { body: 正文 });
  const r = precheck.run(root, t1, CFG);
  assert.deepEqual(Object.keys(r).sort(), ['备注', '初检', '判定', '判源', '统计', '缺项', '豁免'].sort());
  assert.ok(r.缺项.length <= 10);
  assert.ok(typeof r.备注 === 'string' && r.备注.length <= precheck.默认.备注上限);
});

await t('参数读口：非法配置一律回落默认，不让行为漂移', () => {
  const bad = { 执行器: { 两检: { 初检: { 回执上限字节: -1, 禁语: [], 必备章节: '不是数组', 二线LLM: 'yes' } } } };
  const p = precheck.参数(bad);
  assert.equal(p.回执上限字节, precheck.默认.回执上限字节);
  assert.deepEqual(p.禁语, precheck.默认.禁语);
  assert.deepEqual(p.必备章节, precheck.默认.必备章节);
  assert.equal(p.二线LLM, false, '非布尔不算开');
  assert.equal(precheck.用二线LLM(bad), false);
  assert.equal(precheck.用二线LLM({ 执行器: { 两检: { 初检: { 二线LLM: true } } } }), true, '显式 true 才回落 LLM');
  assert.equal(precheck.用二线LLM({}), false, '缺省关——代码内兜底，不改 AI-GameStudio 配置');
});

// ================= runner 接线（端到端）=================
const on = (root) => state.update(root, (s) => { s.执行器 = { 运行: true }; });
const 两检开 = { ...CFG, 执行器: { 两检: { 开: true } } }; // 机判零池：不注册 deepseek 也开得起来

await t('接线：tick 一轮机判初检 → fm.初检 写 结论/时间/备注（同构）+ 回执追加 + 流水标注机判', async () => {
  const root = makeRoot(); on(root);
  铺(root, 'R-01', 好回执);
  const r = await runner.tick(root, 两检开, { durMs: 0 });
  assert.deepEqual(r.初检, ['R-01'], '机判初检被拉起（无 deepseek 池也能开）');
  const fm = store.find(root, 'R-01').fm.初检;
  assert.equal(fm.结论, '过');
  assert.ok(fm.时间 && !Number.isNaN(Date.parse(fm.时间)), '时间是可解析 ISO');
  assert.ok(fm.备注 && fm.备注.includes('机判初检'), '备注列明逐项判定');
  assert.equal(fm.判源, '机判');
  assert.ok(!fm.缺项, '过的单不写缺项字段（与旧样一致）');
  const 回执文 = fs.readFileSync(path.join(root, '回执', 'R-01.md'), 'utf8');
  assert.ok(回执文.includes('## 两检初检（机判）'), '回执章节标注机判：' + 回执文.slice(-300));
  const 流水 = fs.readFileSync(path.join(root, 'journal', fs.readdirSync(path.join(root, 'journal'))[0]), 'utf8');
  assert.ok(/两检初检过 R-01（机判） → 进深检/.test(流水), '流水文案照旧 + 标注机判：' + 流水);
});

await t('接线：初检过 → 同轮直接进深检（下游核查零改动就能接）', async () => {
  const root = makeRoot(); on(root);
  铺(root, 'R-02', 好回执);
  // 机判是同步的：④a 判完当场落章，同一轮 ④b 就能接手（旧 flash 路径要等下一轮 tick）。
  const r = await runner.tick(root, 两检开, { durMs: 0 });
  assert.deepEqual(r.初检, ['R-02']);
  assert.equal(store.find(root, 'R-02').fm.初检.结论, '过');
  assert.ok((r.代核 || []).includes('R-02'), '④b 深检同轮照常接手（下游零改动）：' + JSON.stringify(r.代核));
  assert.equal(store.find(root, 'R-02').state, '完成');
  assert.equal(store.find(root, 'R-02').fm.核查.结论, '通过', '核查章照旧');
});

await t('接线：机判不过 → 单留核查、不烧深检、信道有急件', async () => {
  const root = makeRoot(); on(root);
  铺(root, 'R-03', '# 完工报告 R-03\n（还没写完）\n');
  const r = await runner.tick(root, 两检开, { durMs: 0 });
  assert.deepEqual(r.初检, ['R-03']);
  const cur = store.find(root, 'R-03');
  assert.equal(cur.state, '核查', '不过留原位');
  assert.equal(cur.fm.初检.结论, '不过');
  assert.ok(cur.fm.初检.缺项.length, '缺项落库');
  assert.ok(!(r.代核 || []).includes('R-03'), '同轮不进深检');
  const r2 = await runner.tick(root, 两检开, { durMs: 0 });
  assert.ok(!(r2.代核 || []).includes('R-03'), '下轮也不进深检（初检未过）');
  const 信道 = require('../lib/inbox').list(root);
  assert.ok(信道.some((x) => x.类型 === '初检不过' && x.单号 === 'R-03'), '呼叫信箱有条目：' + JSON.stringify(信道));
});

await t('接线：二线LLM 开关打开 → 不走机判（回滚路留着，且此时仍要池在册）', async () => {
  const root = makeRoot(); on(root);
  铺(root, 'R-04', 好回执);
  const cfg = { ...CFG, 执行器: { 两检: { 开: true, 初检: { 二线LLM: true } } } };
  const r = await runner.tick(root, cfg, { durMs: 0 });
  assert.ok(!(r.初检 || []).length, '开了二线但无 deepseek 池 → 两检不开（与旧样一致）');
  assert.ok(!store.find(root, 'R-04').fm.初检, '没盖机判章');
});

await t('接线：机判自身抛异常 → 按判官失败计数，不盖章不动单', async () => {
  const root = makeRoot(); on(root);
  铺(root, 'R-05', 好回执);
  const 原 = precheck.run;
  precheck.run = () => { throw new Error('人造炸点'); };
  try {
    await runner.tick(root, 两检开, { durMs: 0 });
    const cur = store.find(root, 'R-05');
    assert.equal(cur.state, '核查');
    assert.ok(!cur.fm.初检, '失败不盖章');
    assert.equal(cur.fm.初检失败次数, 1, '计失败次数，下轮重试');
  } finally { precheck.run = 原; }
});

// #71 余量：本套 6 例走 runner.tick（内含 pool.claim / gates.canPull 那条路）。
// 顶部的 quota 打桩光有桩不算判据——桩子被删掉测试照绿。这一格把「有没有真外呼」变成账。
await t('全套零真实外呼：不点真 API、不起真会话、不读真凭据（#71）', () => {
  绊线.断言无外呼(assert, 'precheck.test.js');
});

require('./helper').收尾('precheck', passed);
})().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
