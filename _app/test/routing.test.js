// routing.test.js — 角色/厂商解耦、能力过滤、动态评分与工单固定路由。
const assert = require('node:assert');
const router = require('../lib/routing/router');
const history = require('../lib/routing/history');
const pool = require('../lib/pool');
const store = require('../lib/core/store');
const quota = require('../lib/quota');
const gates = require('../lib/gates');
const { makeRoot, seed } = require('./helper');

quota.getRateLimits = async () => null;
quota.getClaudeUsage = async () => null;

const CFG = {
  providers: {
    codex: { adapter: 'codex-cli', capabilities: ['coding', 'backend'], scores: { backend: { quality: 70 } } },
    claude: { adapter: 'claude-cli', capabilities: ['coding', 'backend', 'planning'], scores: { backend: { quality: 90 } } },
    kimi: { adapter: 'command-cli', command: 'kimi', capabilities: ['coding', 'frontend'], scores: { backend: { quality: 99 } } },
  },
  roles: { backend: { requiredCapabilities: ['backend'] } },
  routing: { weights: { quality: 0.7, success: 0.3, latency: 0, cost: 0 } },
  agents: [{ id: '后端-A', role: 'backend', routing: { mode: 'auto' } }],
  执行池: {},
  执行器: {},
};

let passed = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);
console.log('routing 动态 Provider 路由测试');

t('能力硬过滤优先于厂商静态高分', () => {
  const root = makeRoot();
  const task = { fm: { role: 'backend' } };
  const ranked = router.rankProviders(root, CFG, { agent: CFG.agents[0], task, kind: '执行' });
  assert.deepEqual(ranked.map((x) => x.name), ['claude', 'codex']);
});

t('工单可临时固定 Provider，覆盖自动选择', () => {
  const root = makeRoot();
  const task = { fm: { role: 'backend', routing: { pin: 'codex' } } };
  assert.equal(router.chooseProvider(root, CFG, { agent: CFG.agents[0], task, kind: '执行' }).name, 'codex');
});

t('自动 Reviewer 优先避开原执行 Provider', () => {
  const root = makeRoot();
  const cfg = JSON.parse(JSON.stringify(CFG));
  cfg.providers.codex.capabilities.push('code-review');
  cfg.providers.claude.capabilities.push('code-review');
  cfg.roles.reviewer = { requiredCapabilities: ['code-review'] };
  const task = { fm: { role: 'backend', provider: 'claude' } };
  assert.equal(router.chooseProvider(root, cfg, { task, role: 'reviewer', kind: '质检' }).name, 'codex');
});

t('有评审结果时，质量通过率优先于单纯 CLI 退出结果', () => {
  const root = makeRoot();
  history.append(root, { provider: 'codex', role: 'backend', ok: true, dry: false });
  history.append(root, { provider: 'codex', role: 'backend', qualityPassed: false, dry: false });
  const s = history.summary(root, 'codex', 'backend');
  assert.equal(s.basis, 'review');
  assert.ok(s.successRate < 50);
});

t('近期真实成功率会影响同角色排序，试跑记录不参与', () => {
  const root = makeRoot();
  const cfg = JSON.parse(JSON.stringify(CFG));
  cfg.providers.codex.scores.backend.quality = 80;
  cfg.providers.claude.scores.backend.quality = 80;
  for (let i = 0; i < 5; i++) {
    history.append(root, { provider: 'codex', role: 'backend', ok: true, dry: false, durationMs: 10 });
    history.append(root, { provider: 'claude', role: 'backend', ok: false, dry: false, durationMs: 10 });
  }
  history.append(root, { provider: 'claude', role: 'backend', ok: true, dry: true });
  assert.equal(router.rankProviders(root, cfg, { task: { fm: { role: 'backend' } } })[0].name, 'codex');
});

t('领单时按角色动态选择 Provider，并把决策盖到工单', async () => {
  const root = makeRoot();
  seed(root, '池', { id: 'B-1', role: 'backend', 职能: 'legacy-placeholder' });
  const result = await pool.claim(root, CFG, '后端-A');
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'claude');
  const ticket = store.find(root, 'B-1');
  assert.equal(ticket.fm.provider, 'claude');
  assert.equal(ticket.fm.执行池, 'claude', '旧 UI 兼容章仍保留');
  assert.equal(ticket.fm.主办, '后端-A');
});

t('首选 Provider 暂停时，同一角色自动回退到下一候选', async () => {
  const root = makeRoot();
  gates.setPaused(root, 'claude', true);
  seed(root, '池', { id: 'B-2', role: 'backend', 职能: 'legacy-placeholder' });
  const result = await pool.claim(root, CFG, '后端-A');
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'codex');
});

(async () => {
  for (const [name, fn] of tests) { await fn(); passed++; console.log('  ✓ ' + name); }
  console.log(`全部通过：${passed} 项`);
})().catch((error) => { console.error(error); process.exit(1); });
