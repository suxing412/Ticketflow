// providers.test.js — Provider Adapter 注册、旧 CLI 兼容与通用厂商命令。
const assert = require('node:assert');
const registry = require('../lib/providers/registry');
const codexProvider = require('../lib/providers/codex-cli');
const claudeProvider = require('../lib/providers/claude-cli');

let passed = 0; const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
console.log('providers Provider Adapter 测试');

t('旧执行池可自动映射为 Codex/Claude Adapter', () => {
  const cfg = { 执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['QA'] } } };
  assert.deepEqual(registry.list(cfg).map((x) => x.adapter), ['codex-cli', 'claude-cli']);
});

t('Codex Adapter 保持 stdin 与模型参数协议', () => {
  const cfg = { providers: { codex: { adapter: 'codex-cli' } } };
  const run = registry.create(cfg, 'codex').buildInvocation({ model: 'gpt-x' });
  assert.ok(run.args.includes('-m') && run.args.includes('gpt-x'));
  assert.deepEqual(run.args.slice(-2), ['--json', '-']);
  assert.equal(run.outputFormat, 'codex-jsonl');
  assert.equal(run.promptMode, 'stdin');
});

t('Claude Adapter 使用官方实时 JSON 事件流', () => {
  const run = claudeProvider.create({}).buildInvocation({ model: 'sonnet' });
  assert.equal(run.outputFormat, 'claude-stream-json');
  assert.ok(run.args.includes('stream-json'));
  assert.ok(run.args.includes('--include-partial-messages'));
  assert.ok(run.args.includes('--dangerously-skip-permissions'), '无头执行不应卡在交互式命令审批');
});

t('Provider CLI 支持跨机器环境变量显式定位', () => {
  const oldCodex = process.env.CODEX_CLI_PATH; const oldClaude = process.env.CLAUDE_CLI_PATH;
  process.env.CODEX_CLI_PATH = process.execPath;
  process.env.CLAUDE_CLI_PATH = process.execPath;
  try {
    assert.equal(codexProvider.defaultCommand(), process.execPath);
    assert.equal(claudeProvider.defaultCommand(), process.execPath);
  } finally {
    if (oldCodex == null) delete process.env.CODEX_CLI_PATH; else process.env.CODEX_CLI_PATH = oldCodex;
    if (oldClaude == null) delete process.env.CLAUDE_CLI_PATH; else process.env.CLAUDE_CLI_PATH = oldClaude;
  }
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
