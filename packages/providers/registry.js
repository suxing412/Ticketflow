// providers/registry.js — Provider 配置与 Adapter 的唯一注册点。
// 新增厂商时在这里注册 Adapter，runner / pool / UI 不再新增厂商分支。
const codex = require('./codex-cli');
const claude = require('./claude-cli');
const command = require('./command-cli');
const opencode = require('./opencode-cli');

const FACTORIES = {
  'codex-cli': codex.create,
  'claude-cli': claude.create,
  'command-cli': command.create,
  'opencode-cli': opencode.create,
};

const IDENTITY_FIELDS = ['modelVendor', 'harness', 'authRealm', 'reviewDomain'];
const HARNESS_BY_ADAPTER = { 'codex-cli': 'codex', 'claude-cli': 'claude', 'opencode-cli': 'opencode' };

function validate(name, pc) {
  // 路由/编制的轻量配置历史上允许只写 enabled/roles；真正 create 时仍会因未知 adapter 响亮失败。
  if (!pc.adapter) return pc;
  const identity = pc.identity;
  if (identity != null) {
    if (!identity || typeof identity !== 'object') throw new Error(`Provider ${name} 的 identity 必须是对象`);
    const missing = IDENTITY_FIELDS.filter((key) => !String(identity[key] || '').trim());
    if (missing.length) throw new Error(`Provider ${name} 的 identity 缺字段：${missing.join('、')}`);
    const expectedHarness = HARNESS_BY_ADAPTER[pc.adapter];
    if (expectedHarness && identity.harness !== expectedHarness) {
      throw new Error(`Provider ${name} 的 adapter=${pc.adapter} 与 identity.harness=${identity.harness} 不一致`);
    }
  }
  if (pc.adapter === 'opencode-cli') {
    opencode.assertModel(pc.model);
    if (!identity) throw new Error(`Provider ${name} 使用 opencode-cli 时必须声明完整 identity`);
    if (identity.modelVendor !== 'zhipu' || identity.authRealm !== 'zhipuai-coding-plan'
      || identity.reviewDomain !== 'zhipu-glm') {
      throw new Error(`Provider ${name} 的 OpenCode/GLM identity 与固定模型域不一致`);
    }
  }
  return pc;
}

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
  for (const [name, value] of Object.entries(source)) out[name] = validate(name, { name, ...(value || {}) });
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

module.exports = { configs, list, create, register, resolveLegacy, validate, IDENTITY_FIELDS };
