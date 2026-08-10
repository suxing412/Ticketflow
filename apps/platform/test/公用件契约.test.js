// 公用件契约测试 — 钉住本产品对仓根 packages 的**全部消费面**。
//
// 为什么需要它：公用件走文件路径消费，**没有 semver 锁**。对方往 packages 合一个
// 破坏性改动，我们这边下次启动才炸，而且中间没有任何提示——因为我们除了
// `git pull` 什么都没做。这套测试就是那个提示：pull 完跑一遍，破没破立刻知道。
//
// 纪律：**只断言我们真的用到的东西**。多断言 = 把别人的内部实现钉成契约，
// 会平白给对方制造破坏性改动，那是越界。消费面变宽时同步扩这里。
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const 公用件 = require('../lib/公用件');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('公用件契约测试（消费面）');

t('公用件解析：仓根的 packages/（一仓拓扑），TICKETFLOW_PACKAGES 可覆盖', () => {
  // 按**长相**认仓根，不按目录名认。此前这里断言 basename === 'Ticketflow'，
  // 于是把仓 clone 成任何别的目录名（或在 worktree 里跑）测试就无故变红——
  // 那是测试自己的毛病，不是被测代码的问题。
  assert.ok(fs.existsSync(path.join(公用件.仓根, 'apps', 'platform')),
    '仓根应含 apps/platform（一仓拓扑）：' + 公用件.仓根);
  assert.ok(fs.existsSync(公用件.PACKAGES), '公用件目录必须存在：' + 公用件.PACKAGES);
  assert.ok(公用件.解析('providers', 'registry.js').endsWith(path.join('packages', 'providers', 'registry.js')));
});

t('公用件缺位时报人话错误（部署问题必须直接给出修法）', () => {
  assert.throws(() => 公用件.载入('这个包不存在', 'x.js'), (e) => {
    assert.ok(e.message.includes('packages'), '错误里要写清公用件在哪：' + e.message);
    assert.ok(e.message.includes('TICKETFLOW_PACKAGES'));
    assert.ok(e.message.includes('当前解析'), '要报出实际解析到的路径，否则没法排查');
    return true;
  });
});

// ---- 依赖面清点：本仓对 Ticketflow 的代码级依赖只有两个包 ----
// providers（本仓主笔，寄放对方仓）+ watchtower（对方主笔，信道守护）。
// 这条断言的意义是**防止依赖面无意中变宽**——每多一个包，正本归位与 npm 化的谈判就更难。
t('依赖面只有 providers 与 watchtower 两个包（变宽必须是显式决定）', () => {
  const 允许 = new Set(['providers', 'watchtower']);
  const 命中 = new Set();
  const 扫 = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'test') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { 扫(p); continue; }
      if (!d.name.endsWith('.js')) continue;
      // 剔整行注释再扫，与下面那条跨产品断言同款：注释里提一句「将来若抽 packages/core」
      // 是在讨论依赖，不是**产生**依赖。不剔的话，写文档反而会把测试顶红。
      const src = fs.readFileSync(p, 'utf8').split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('//')).join('\n');
      for (const m of src.matchAll(/packages[\/\\'",\s]+([a-z][\w-]*)/g)) 命中.add(m[1]);
    }
  };
  扫(path.resolve(__dirname, '..'));
  for (const 包 of 命中) assert.ok(允许.has(包), `新增了对公用件 ${包} 的依赖——请确认这是显式决定并更新本测试`);
});

// ---- 跨产品直引：上面那条盯不住的洞 ----
// 上面的扫描认的是 `packages/xxx` 形态，于是 `require('../../../studio/lib/core/store')`
// 这种「上溯出本产品、伸手进另一个产品内部」的写法**完全不在雷达上**。
// orchestration/plan.js 就这么溜了很久（2026-08-10 查接线时才发现）。
// 边界规矩：公用件唯一家是仓根 packages/、双签共建；对方的内部实现不是我们的 API。
t('不得直引另一个产品的内部模块（公用件走 packages/，不走 apps/*/lib）', () => {
  const 平台根 = path.resolve(__dirname, '..');
  const 违规 = [];
  const 扫 = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'test') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { 扫(p); continue; }
      if (!d.name.endsWith('.js')) continue;
      // 剔掉整行注释再扫：交代「原先这里写的是 require('...')」的文档注释不该被判违规，
      // 否则修好一处之后，解释这处修法的注释本身会把测试顶红。
      const src = fs.readFileSync(p, 'utf8').split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('//')).join('\n');
      for (const m of src.matchAll(/require\(\s*'(\.\.[^']*)'\s*\)/g)) {
        // 把相对路径解析成真实位置，看它有没有跑出本产品目录
        const 目标 = path.resolve(path.dirname(p), m[1]);
        if (目标.startsWith(平台根 + path.sep)) continue;         // 还在本产品内，放行
        const 仓根 = path.resolve(平台根, '..', '..');
        const 相对仓根 = path.relative(仓根, 目标).replace(/\\/g, '/');
        if (相对仓根.startsWith('packages/')) continue;            // 公用件，放行
        违规.push(`  ${path.relative(平台根, p)} → ${m[1]}  (解析到 ${相对仓根})`);
      }
    }
  };
  扫(平台根);
  assert.deepEqual(违规, [], '这些 require 伸出了本产品之外，且不是公用件：\n' + 违规.join('\n')
    + '\n公用件唯一家是仓根 packages/（双签共建）；对方产品的内部模块不是可依赖的 API。');
});

// ---- 消费点收敛：解析算法只准存在一份 ----
// 补 2026-08-09 漏掉的那个洞：上面那条只清点「依赖了哪些包」，不管各消费点是不是
// 真的走 lib/公用件。于是 server.js 与 scripts/watchtower.js 各自抄了一份「往上找
// 兄弟仓」的解析，一仓合并时漏改，瞭望塔整条线全废，而测试照样全绿。
// 断言换个问法：除了正本自己，谁都不准出现解析算法的特征。
t('公用件解析只有 lib/公用件 一份（自抄一份即红）', () => {
  // 例外只有两处，各有物理原因：
  //   lib/公用件.js  解析正本自己
  //   main.js        打包态 __dirname 在 asar 内、上溯三级不成立，必须赶在
  //                  require('./server.js') 之前把 TICKETFLOW_PACKAGES 顶上
  const 例外 = new Set([path.join('lib', '公用件.js'), 'main.js']);
  const 特征 = [
    [/TICKETFLOW_HOME/, '用了已作废的 TICKETFLOW_HOME（一仓后没人读它）'],
    [/['"]\.\.['"]\s*,\s*['"]Ticketflow['"]/, '还在往上找兄弟仓 Ticketflow（一仓后解析成 <仓根>/apps/Ticketflow）'],
    [/(?:require|path\.(?:join|resolve))\s*\([^)]*['"]packages['"]/, '自己拼 packages/ 路径，请改走 公用件.解析()/载入()'],
  ];
  const 平台根 = path.resolve(__dirname, '..');
  const 违规 = [];
  const 扫 = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name === 'node_modules' || d.name === '.git' || d.name === 'test') continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { 扫(p); continue; }
      if (!d.name.endsWith('.js')) continue;
      const 相对 = path.relative(平台根, p);
      if (例外.has(相对)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const [re, 说法] of 特征) if (re.test(src)) 违规.push(`  ${相对}：${说法}`);
    }
  };
  扫(平台根);
  assert.deepEqual(违规, [], '以下文件自抄了公用件解析，请改走 lib/公用件：\n' + 违规.join('\n'));
});

// ---- providers 消费面：router.js 只用 registry.list(cfg) ----
t('providers/registry 存在且导出我们用到的 list()', () => {
  const registry = 公用件.载入('providers', 'registry.js');
  assert.equal(typeof registry.list, 'function', 'router.js:60 依赖 registry.list(cfg)');
});

t('registry.list(cfg) 字段契约：英文键（中文键是 server.js 自己映射的，不是本包契约）', () => {
  const registry = 公用件.载入('providers', 'registry.js');
  // **必须喂真配置**：list({}) 返回空数组，遍历断言会静默空转——循环体一次不执行，测试照样绿。
  // 本测试自己踩过这个洞（2026-08-09），已写进 packages/providers/README 的使用说明节。
  const out = registry.list({ 执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划'] } } });
  assert.ok(Array.isArray(out), 'list 必须返回数组');
  assert.ok(out.length >= 2, `空数组会让下面的断言全部空转（实得 ${out.length} 项）`);
  for (const p of out) {
    assert.equal(typeof p.name, 'string');
    assert.equal(typeof p.adapter, 'string');
    assert.ok('enabled' in p, 'server.js 映射成 启用 供仪表盘分色');
  }
});

t('registry.list 对缺省/空配置容错（开机时 platform.config.json 可能还没写）', () => {
  const registry = 公用件.载入('providers', 'registry.js');
  assert.ok(Array.isArray(registry.list()), 'undefined 走默认参数');
  assert.ok(Array.isArray(registry.list({})), '空对象');
  // 已知缺口（2026-08-09 契约测试发现，待回执报给对方）：list(null) 会抛
  // 「Cannot read properties of null」——registry.js 的 configs(cfg = {}) 默认参数
  // 只对 undefined 生效，null 穿透。我们**不依赖** null 容错（server.js 读配置
  // 已用 读JSON(p, {}) 兜底），故不在此断言 null；但它是真缺口，修在 providers 侧。
  assert.throws(() => registry.list(null), /null/, '缺口若被修复，请删掉这条并改断言 null 也返回数组');
});

// ---- router 的实际接线（回归 2026-08-09 修的那处坏路径）----
t('router.js 能加载（搬家前的四级相对路径已修，回归即 MODULE_NOT_FOUND）', () => {
  const router = require('../lib/routing/router');
  assert.equal(typeof router, 'object');
  assert.ok(Object.keys(router).length > 0, 'router 应有导出');
});

console.log(`全部通过：${passed} 项`);
