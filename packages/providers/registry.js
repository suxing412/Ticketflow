// providers/registry.js — Provider 配置与 Adapter 的唯一注册点。
// 新增厂商时在这里注册 Adapter，runner / pool / UI 不再新增厂商分支。
const codex = require('./codex-cli');
const claude = require('./claude-cli');
const command = require('./command-cli');

const FACTORIES = {
  'codex-cli': codex.create,
  'claude-cli': claude.create,
  'command-cli': command.create,
};

function legacyConfigs(cfg = {}) {
  const pools = cfg.执行池 || {};
  const out = {};
  for (const [name, pool] of Object.entries(pools)) {
    out[name] = {
      name,
      adapter: name === 'codex' ? 'codex-cli' : name === 'claude' ? 'claude-cli' : 'command-cli',
      enabled: true,
      roles: pool.职能 || [],
      legacyPool: pool,
    };
  }
  return out;
}

function configs(cfg = {}) {
  const declared = cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : null;
  const source = declared && Object.keys(declared).length ? declared : legacyConfigs(cfg);
  const out = {};
  for (const [name, value] of Object.entries(source)) out[name] = { name, ...(value || {}) };
  return out;
}

function create(cfg, name) {
  const pc = configs(cfg)[name];
  if (!pc) throw new Error(`Provider 未注册：${name}`);
  if (pc.enabled === false) throw new Error(`Provider 已停用：${name}`);
  const factory = FACTORIES[pc.adapter];
  if (!factory) throw new Error(`未知 Provider Adapter：${pc.adapter}`);
  return factory(pc);
}

function list(cfg) {
  return Object.values(configs(cfg));
}

function register(adapter, factory) {
  if (!adapter || typeof factory !== 'function') throw new Error('注册 Adapter 需要名称和工厂函数');
  FACTORIES[adapter] = factory;
}

// 旧测试与旧调用的兼容入口。新代码应使用 create(cfg, provider).buildInvocation。
function resolveLegacy(name, model) {
  const cfg = { providers: { [name]: { adapter: name === 'codex' ? 'codex-cli' : 'claude-cli' } } };
  return create(cfg, name).buildInvocation({ model });
}

module.exports = { configs, list, create, register, resolveLegacy };
