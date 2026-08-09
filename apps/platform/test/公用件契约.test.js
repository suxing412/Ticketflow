// 公用件契约测试 — 钉住本仓对 Ticketflow packages 的**全部消费面**。
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
console.log('公用件契约测试（跨仓消费面）');

t('并排克隆约定：默认解析到同级 Ticketflow，TICKETFLOW_HOME 可覆盖', () => {
  assert.equal(path.basename(公用件.仓根), 'AI-DevPlatform');
  const 默认 = path.resolve(公用件.仓根, '..', 'Ticketflow');
  assert.equal(公用件.TICKETFLOW_HOME, process.env.TICKETFLOW_HOME || 默认);
  assert.ok(公用件.解析('providers', 'registry.js').endsWith(path.join('packages', 'providers', 'registry.js')));
});

t('公用件缺位时报人话错误（部署问题必须直接给出修法）', () => {
  assert.throws(() => 公用件.载入('这个包不存在', 'x.js'), (e) => {
    assert.ok(e.message.includes('并排克隆'), '错误里要写清修法：' + e.message);
    assert.ok(e.message.includes('TICKETFLOW_HOME'));
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
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/packages[\/\\'",\s]+([a-z][\w-]*)/g)) 命中.add(m[1]);
    }
  };
  扫(公用件.仓根);
  for (const 包 of 命中) assert.ok(允许.has(包), `新增了对公用件 ${包} 的依赖——请确认这是显式决定并更新本测试`);
});

// ---- providers 消费面：router.js 只用 registry.list(cfg) ----
t('providers/registry 存在且导出我们用到的 list()', () => {
  const registry = 公用件.载入('providers', 'registry.js');
  assert.equal(typeof registry.list, 'function', 'router.js:60 依赖 registry.list(cfg)');
});

t('registry.list(cfg) 返回数组，元素带 名称/adapter/启用（server.js 的 /api/providers 按此渲染）', () => {
  const registry = 公用件.载入('providers', 'registry.js');
  const out = registry.list({});
  assert.ok(Array.isArray(out), 'list 必须返回数组');
  for (const p of out) {
    assert.equal(typeof p.名称, 'string');
    assert.equal(typeof p.adapter, 'string');
    assert.ok('启用' in p, '/api/providers 与仪表盘按 启用 分色');
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
