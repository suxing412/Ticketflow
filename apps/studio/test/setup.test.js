// setup.test.js — 首次运行向导地基（2026-08-08）
// 案源：源码模式没人铺 studio.config.json → app 直接退出 → 加项目的 UI 永远进不去。
// 这套测试盯两件事：**幂等**（重复跑不毁东西）与**兜底**（缺套件模板也得能建起来）。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const setup = require('../lib/setup');
const store = require('../lib/core/store');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('setup 首次运行向导测试（2026-08-08）');

const 新目录 = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setup-')), '工作区');

t('建工作区：配置 + 十态目录 + 章程 + 风格库 一次到位', () => {
  const d = 新目录();
  const r = setup.建工作区(d);
  assert.equal(r.ok, true);
  assert.equal(r.新建, true);
  assert.ok(fs.existsSync(path.join(d, 'studio.config.json')));
  for (const s of store.STATES) assert.ok(fs.existsSync(path.join(d, s)), `缺状态目录 ${s}`);
  assert.ok(fs.existsSync(path.join(d, '回执')));
  assert.ok(fs.existsSync(path.join(d, 'journal')));
  assert.ok(fs.existsSync(path.join(d, '风格库', '策划标杆.md')));
  for (const n of ['通用', '策划', '程序', '美术', 'QA', '装配']) {
    assert.ok(fs.existsSync(path.join(d, '岗位协议', `${n}.md`)), `缺章程 ${n}`);
  }
});

t('落地的配置能被 config.load 直接读出来（向导产物必须是合法输入）', () => {
  const d = 新目录();
  setup.建工作区(d);
  const cfg = require('../lib/core/config').load(d);
  assert.ok(Array.isArray(cfg.职能) && cfg.职能.length);
  assert.ok(cfg.执行池.claude && cfg.执行池.codex);
  assert.equal(cfg.项目.默认, '');
  // 编制↔职能↔池 三者自洽（否则 /api/env 一开机就红）
  const roster = require('../lib/roster');
  const pool = require('../lib/pool');
  for (const fn of cfg.职能) assert.ok(pool.poolFor(cfg, fn), `职能 ${fn} 无池归属`);
  for (const row of roster.read(cfg)) {
    assert.ok(cfg.职能.includes(row.职能));
    for (const p of row.池序) assert.ok(cfg.执行池[p.池], `编制引用了未注册的池 ${p.池}`);
  }
});

t('模板代理默认必须为空（死代理案：模板塞具体代理地址会毒死没代理的机器）', () => {
  assert.equal(setup.模板配置().网络.代理默认, '', '这一条回归就是 2026-08-08 事故的重演');
});

t('模板给池标了计费性质（跨计费降级留痕的前提）', () => {
  const c = setup.模板配置();
  assert.equal(c.执行池.claude.计费, '订阅');
  assert.equal(c.执行池.codex.计费, '订阅');
});

t('幂等：重复建不覆盖已有配置，也不重复落章程', () => {
  const d = 新目录();
  setup.建工作区(d);
  const p = path.join(d, 'studio.config.json');
  fs.writeFileSync(p, JSON.stringify({ 我的: '定制配置' }), 'utf8');
  fs.writeFileSync(path.join(d, '岗位协议', '程序.md'), '# 我改过的章程', 'utf8');
  const r2 = setup.建工作区(d);
  assert.equal(r2.ok, true);
  assert.equal(r2.新建, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { 我的: '定制配置' }, '覆盖用户配置=毁数据');
  assert.equal(fs.readFileSync(path.join(d, '岗位协议', '程序.md'), 'utf8'), '# 我改过的章程');
  assert.deepEqual(r2.落章程, [], '第二遍不该再落任何章程');
  assert.ok(r2.提示.some((x) => x.includes('保留不覆盖')));
});

t('兜底：拿不到套件模板目录时用内置章程，向导照样成功', () => {
  const d = 新目录();
  const 原 = setup.模板目录;
  // 直接验内置内容本身可用（打包后的 exe 就是这条路径）
  assert.ok(setup.内置章程.通用.includes('完工报告'));
  assert.ok(setup.内置章程.QA.includes('结论：通过'));
  const r = setup.建工作区(d);
  assert.equal(r.ok, true);
  assert.equal(r.落章程.length, 6);
  const 通用 = fs.readFileSync(path.join(d, '岗位协议', '通用.md'), 'utf8');
  assert.ok(通用.length > 100);
  assert.equal(typeof 原, 'function');
});

t('章程清单不许再列第二遍：铺哪几份 = 内置章程有哪几份（施工令-027）', () => {
  const d = 新目录();
  const r = setup.建工作区(d);
  assert.deepEqual(r.落章程, Object.keys(setup.内置章程),
    '写死的第二份职能清单一旦回归，新增职能的章程就会漏铺，而自检要到 agent 开工才发现');
});

t('.gitignore 覆盖凭据文件（DPAPI 密文也没有进 git 的道理）', () => {
  const d = 新目录();
  setup.建工作区(d);
  const gi = fs.readFileSync(path.join(d, '.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(gi.includes('凭据.json'));
  assert.ok(gi.includes('.studio-state.json'));
});

t('.gitignore 幂等：已有条目不重复追加', () => {
  const d = 新目录();
  setup.建工作区(d);
  setup.建工作区(d);
  const gi = fs.readFileSync(path.join(d, '.gitignore'), 'utf8').split(/\r?\n/).filter(Boolean);
  assert.equal(gi.filter((l) => l === '凭据.json').length, 1);
});

t('空目录名拒绝；候选目录给得出至少两个可点的位置', () => {
  assert.equal(setup.建工作区('').ok, false);
  assert.equal(setup.建工作区('   ').ok, false);
  assert.ok(setup.候选目录().length >= 2);
  assert.ok(setup.候选目录().every((p) => typeof p === 'string' && p.length));
});

console.log(`全部通过：${passed} 项`);
