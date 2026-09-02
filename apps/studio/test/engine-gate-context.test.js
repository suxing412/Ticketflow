// engine-gate-context.test.js — H97 引擎门禁的语境判定（议程第 38 条，2026-08-28）
//
// 病灶：门禁按**字面**匹配特征词（enginectl / unity-test / 受控重建），
// 两类语境会误拦，TF-7 与 TF-8 各中一类，都手工豁免过：
//   · TF-7：`isArtifactPath('enginectl-baselines/results-….xml')`
//     ——词在**代码示例的字符串常量**里，不是在说这单要跑引擎
//   · TF-8：「上述条目均为前端沙箱判据与 node 测试链，**不涉** enginectl / unity-test / 受控重建，
//     **不触发** H97 引擎门禁停闸」——三条特征全中，而它说的恰恰是不用
//
// 修法两条：遮代码区（与「凡解析 markdown 必先认围栏」同族第五例）＋ 按句读判否定语境。
// **fail-safe 仍向严**：只要有一处是肯定语境就拦；同一特征多次出现，一处被否定不代表处处被否定。
const assert = require('node:assert');
const fs = require('node:fs');
const life = require('../lib/lifecycle');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('engine-gate-context 引擎门禁语境判定（议程第 38 条）');

const 判 = (体) => life.引擎门禁命中({}, { body: 体 });
const 章 = (行) => '## 验收标准\n' + 行;

t('词边界：特征词不许匹配进更长的词里（TF-7 类）', () => {
  assert.equal(判(章('1. `isArtifactPath(\'enginectl-baselines/results.xml\')` → false')), null,
    'enginectl-baselines 是另一个词（测试基线目录名），不是在说要跑引擎');
  assert.equal(判(章('1. 检查 pre-enginectl 钩子')), null, '左边界同理');
  // 反面：真是那个词的照拦，**哪怕它写在行内 code 里**
  assert.equal(判(章('2. 四个测试类全绿：`node tools/enginectl.js unity-test --project D:/GitHub/TK`')), 'enginectl',
    '行内 code 恰恰是写「要跑什么命令」最自然的形式，不能因为它在反引号里就放走');
  assert.equal(判(章('1. 跑 enginectl 全绿')), 'enginectl');
});

t('**第一版修错方向的反例**——「遮掉所有代码区」会把真阳性一起放走', () => {
  // 我最初把 TF-7 诊断成「代码区里的词不算」，写了遮代码。结果 lifecycle 的夹具
  // `node tools/enginectl.js unity-test` 立刻被放走——那是真该拦的。
  // 遮代码遮的是症状（词恰好在反引号里），真病是匹配没有边界。这一格把那条错路钉死。
  const 真阳 = 章('2. 全绿：`node tools/enginectl.js unity-test`');
  const 假阳 = 章('1. `isArtifactPath(\'enginectl-baselines/r.xml\')`');
  assert.equal(判(真阳), 'enginectl', '代码里的真命令必须拦');
  assert.equal(判(假阳), null, '代码里的复合词不该拦');
  // 两者都在行内 code 里——**任何以「在不在代码区」为轴的修法都区分不了它们**
});

t('否定语境按句读切，列表式否定整条豁免（TF-8 类）', () => {
  const 体 = 章('1. 上述条目均为前端沙箱判据与 node 测试链，不涉 enginectl / unity-test / 受控重建，不触发 H97 引擎门禁停闸。');
  assert.equal(判(体), null, '「不涉 A / B / C」三项都该豁免：' + JSON.stringify(判(体)));
});

t('**定长窗口在这里必然失效**——这一格锁死「按句读」这个修法', () => {
  // TF-8 原话里 受控重建 距 不涉 26 字，24 字窗口刚好够不着：前两项豁免、第三项照拦。
  // 一个「差两个字就失效」的判据不是判据。这一格用一个更长的列表把窗口式修法钉死。
  const 长列表 = 章('1. 不涉 enginectl、以及各类构建脚本、以及打包链路、以及回归基线、以及 unity-test、以及 受控重建。');
  assert.equal(判(长列表), null, '任意长的列表式否定都该整条豁免，不该取决于第几项：' + JSON.stringify(判(长列表)));
});

t('转折翻回来的不算否定：「不涉 A，但要跑 B」里的 B 是真要跑', () => {
  assert.equal(判(章('1. 不涉 Assets 改动，但要跑 enginectl 验证')), 'enginectl');
  assert.equal(判(章('1. 无需改地图，不过仍需 受控重建 一次')), '受控重建');
});

t('跨句不串味：前一句否定不豁免后一句的肯定', () => {
  assert.equal(判(章('1. 不涉 unity-test。\n2. 需执行 受控重建 并附日志')), '受控重建',
    '句读是边界——否定只作用于它自己那一句');
});

t('同一特征多处出现：一处被否定不代表处处被否定（fail-safe 向严）', () => {
  assert.equal(判(章('1. 不涉 enginectl 的部分照旧。\n2. 第二阶段要跑 enginectl 全量')), 'enginectl',
    '只要有一处是肯定语境就该拦');
});

t('无验收标准章 → 不判门禁（定稿预检 H62 另有一道拦这个）', () => {
  assert.equal(判('## 范围\n跑 enginectl'), null);
});

t('真账回放：TF-7 与 TF-8 现在都不再误拦', () => {
  const 找 = (id) => ['完成', '归档', '核查', '待派']
    .map((d) => `D:/GitHub/AI-GameStudio/监制台/${d}/${id}.md`).find((f) => fs.existsSync(f));
  let 验过 = 0;
  for (const id of ['TF-7', 'TF-8']) {
    const f = 找(id);
    if (!f) continue;
    const body = fs.readFileSync(f, 'utf8').replace(/^---[\s\S]*?---/, '');
    assert.equal(life.引擎门禁命中({}, { body }), null, `${id} 仍被误拦`);
    验过++;
  }
  if (!验过) console.log('    （TF-7/TF-8 不在本机，跳过真账回放）');
});

console.log('  ' + passed + ' 项通过');
