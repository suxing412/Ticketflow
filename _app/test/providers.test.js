// providers.test.js — Provider Adapter 注册、旧 CLI 兼容与通用厂商命令。
const assert = require('node:assert');
const registry = require('../lib/providers/registry');

let passed = 0; const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
console.log('providers Provider Adapter 测试');

t('旧执行池可自动映射为 Codex/Claude Adapter', () => {
  const cfg = { 执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['QA'] } } };
  assert.deepEqual(registry.list(cfg).map((x) => x.adapter), ['codex-cli', 'claude-cli']);
});

t('Codex Adapter 保持 stdin 与模型参数协议', () => {
  const cfg = { providers: { codex: { adapter: 'codex-cli' } } };
  const run = registry.create(cfg, 'codex').buildInvocation({ model: 'gpt-x' });
  assert.deepEqual(run.args.slice(-3), ['-m', 'gpt-x', '-']);
  assert.equal(run.promptMode, 'stdin');
});

t('通用 command-cli 可接入 Kimi 等后续厂商', () => {
  const cfg = { providers: { kimi: { adapter: 'command-cli', command: 'kimi', args: ['run'], modelArgs: ['--model', '{model}'] } } };
  const run = registry.create(cfg, 'kimi').buildInvocation({ model: 'kimi-code' });
  assert.equal(run.cmd, 'kimi');
  assert.deepEqual(run.args, ['run', '--model', 'kimi-code']);
});

t('停用或未知 Adapter 会明确拒绝', () => {
  assert.throws(() => registry.create({ providers: { kimi: { adapter: 'command-cli', enabled: false } } }, 'kimi'), /停用/);
  assert.throws(() => registry.create({ providers: { x: { adapter: 'missing' } } }, 'x'), /未知 Provider Adapter/);
});

console.log(`全部通过：${passed} 项`);
