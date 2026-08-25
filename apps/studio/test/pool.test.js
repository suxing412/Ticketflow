const assert = require('node:assert');
const pool = require('../lib/pool');
const roster = require('../lib/roster');
const { CFG, 收尾 } = require('./helper');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

console.log('pool 路由回退测试');

const 双账CFG = {
  职能: ['策划', '程序', '美术', '技术策划'],
  执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', '美术'] }, deepseek: { 职能: [] } },
  编制: [
    { 职能: '策划', 池序: [{ 池: 'claude', 档: '' }] },
    { 职能: '程序', 池序: [{ 池: 'claude', 档: '' }, { 池: 'codex', 档: '' }] },
    { 职能: '美术', 池序: [{ 池: 'codex', 档: '' }] },
    { 职能: '技术策划', 池序: [{ 池: 'claude', 档: '' }] },
  ],
};

const poolForOld = (cfg, 职能) => {
  for (const [name, config] of Object.entries(cfg.执行池 || {})) {
    if ((config.职能 || []).includes(职能)) return name;
  }
  return null;
};

t('编制有而旧映射无的职能仍解析出执行池', () => {
  assert.equal(poolForOld(双账CFG, '技术策划'), null);
  assert.equal(pool.poolFor(双账CFG, '技术策划'), 'claude');
});

t('编制池序与旧映射分歧时以编制为准', () => {
  assert.equal(pool.poolFor(双账CFG, '程序'), 'claude');
  assert.equal(pool.poolFor(双账CFG, '美术'), 'codex');
});

t('无编制行或空池序时回退旧映射', () => {
  const 无编制 = { ...双账CFG, 编制: [] };
  for (const 职能 of 无编制.职能) {
    assert.equal(pool.poolFor(无编制, 职能), poolForOld(无编制, 职能), 职能);
  }
  const 空池序 = { ...双账CFG, 编制: [{ 职能: '美术', 池序: [] }] };
  assert.equal(pool.poolFor(空池序, '美术'), 'claude');
  assert.equal(pool.poolFor(双账CFG, '不存在的职能'), null);
});

t('池序首项和回退解析在所有调用形态下等价', () => {
  for (const cfg of [双账CFG, CFG, { ...双账CFG, 编制: [] }]) {
    for (const 职能 of [...(cfg.职能 || []), ...roster.read(cfg).map((row) => row.职能)]) {
      const 池序 = roster.poolsOf(cfg, 职能);
      assert.equal(池序[0] || pool.poolFor(cfg, 职能), 池序[0] || poolForOld(cfg, 职能), 职能);
    }
  }
});

收尾('pool 路由回退', passed);
