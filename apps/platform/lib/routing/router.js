// routing/router.js — 角色与 Provider 解耦的动态路由。
// 先按能力/启用状态做硬过滤，再结合配置评分与近期成功率排序；不负责启动进程。
// 公用件消费统一走 lib/公用件（仓根 packages/，TICKETFLOW_PACKAGES 可覆盖）。
// 原样搬家留下的 `../../../../packages/providers/registry` 从本仓 lib/routing
// 上溯四级已跑出盘符，必然 MODULE_NOT_FOUND——交壳清单里标为「留白」的就是这处。
const registry = require('../公用件').载入('providers', 'registry.js');
const history = require('./history');

const arr = (value) => Array.isArray(value) ? value : value ? [value] : [];
const taskRole = (task) => task && task.fm && (task.fm.role || task.fm.角色 || task.fm.职能) || '';
const agentRole = (agent) => agent && (agent.role || agent.角色 || agent.职能) || '';

function routeConfig(value) {
  return value && typeof value === 'object' ? value : {};
}

function requiredCapabilities(cfg, task, role) {
  const roleCfg = (cfg.roles || {})[role] || {};
  const fm = task && task.fm || {};
  return [...new Set([
    ...arr(roleCfg.requiredCapabilities || roleCfg.required_capabilities),
    ...arr(fm.requiredCapabilities || fm.required_capabilities || fm.所需能力),
  ])];
}

function explicitPin(cfg, agent, task, kind) {
  const taskRoute = routeConfig(task && task.fm && (task.fm.routing || task.fm.路由));
  const agentRoute = routeConfig(agent && (agent.routing || agent.路由));
  const direct = taskRoute.pin || taskRoute.provider || agent && (agent.provider || agent.供应商);
  if (direct) return direct;
  const hasV2 = !!(cfg.providers && Object.keys(cfg.providers).length);
  if (agent && agent.执行池 && (!hasV2 || agentRoute.mode !== 'auto' && agentRoute.模式 !== 'auto')) return agent.执行池;
  // 旧协议里裁判固定 Claude；只在没有 V2 Provider 配置时保留。
  if (!hasV2 && kind !== '执行') return 'claude';
  return null;
}

function metricsOf(provider, role) {
  const raw = provider.scores && (provider.scores[role] || provider.scores.default) || provider.score || {};
  if (typeof raw === 'number') return { quality: raw, latency: 50, cost: 50 };
  return {
    quality: Number(raw.quality ?? 50),
    latency: Number(raw.latency ?? 50),
    cost: Number(raw.cost ?? 50),
  };
}

function weightsOf(cfg, role) {
  const routing = cfg.routing || {};
  const roleCfg = routing.roles && routing.roles[role] || {};
  const w = roleCfg.weights || routing.weights || {};
  return {
    quality: Number(w.quality ?? 0.5),
    success: Number(w.success ?? 0.3),
    latency: Number(w.latency ?? 0.1),
    cost: Number(w.cost ?? 0.1),
  };
}

function rankProviders(root, cfg, { agent = null, task = null, role = '', kind = '执行' } = {}) {
  const actualRole = role || taskRole(task) || agentRole(agent) || (kind === '执行' ? 'generalist' : 'reviewer');
  const pin = explicitPin(cfg, agent, task, kind);
  const providers = registry.list(cfg);
  if (pin) {
    const found = providers.find((provider) => provider.name === pin && provider.enabled !== false);
    return found ? [{ name: pin, score: Infinity, role: actualRole, reasons: ['显式固定'] }] : [];
  }

  const routing = cfg.routing || {};
  const roleRouting = routing.roles && routing.roles[actualRole] || {};
  const allow = new Set(arr(roleRouting.allow));
  const deny = new Set(arr(roleRouting.deny));
  const prefer = arr(roleRouting.prefer);
  const required = requiredCapabilities(cfg, task, actualRole);
  const weights = weightsOf(cfg, actualRole);

  const ranked = providers.filter((provider) => {
    if (provider.enabled === false || deny.has(provider.name)) return false;
    if (allow.size && !allow.has(provider.name)) return false;
    // 桩 Provider 不参与自动挑选（2026-08-13 实测踩到）。
    //
    // echo 靠打 0 分让它排最后。但**0 分是排序信号，不是资格判据**：
    // 真判官全被预算闸冻结时，桩池就顶上来了——海投王 HW-1 的质检
    // 就这么被派给了 echo，一个只会把输入回声出来的东西。
    //
    // 用显式字段 桩:true，不去认自述里的措辞——那种判据改个字就静默失效，
    // 而失效的表现是「质检被派给桩池」，跟正常派活长得一模一样。
    //
    // 显式 pin（allow/prefer 点名）仍然放行：接线自测要靠它。
    if (provider.桩 === true && !allow.has(provider.name) && !prefer.includes(provider.name)) return false;
    if (provider.roles && provider.roles.length && !provider.roles.includes(actualRole)) return false;
    const caps = arr(provider.capabilities);
    return !required.length || !caps.length || required.every((cap) => caps.includes(cap));
  }).map((provider) => {
    const metrics = metricsOf(provider, actualRole);
    const recent = root ? history.summary(root, provider.name, actualRole) : { runs: 0, successRate: 50 };
    const preferenceBonus = prefer.includes(provider.name) ? (prefer.length - prefer.indexOf(provider.name)) * 2 : 0;
    const score = metrics.quality * weights.quality
      + recent.successRate * weights.success
      + metrics.latency * weights.latency
      + metrics.cost * weights.cost
      + preferenceBonus;
    return {
      name: provider.name,
      role: actualRole,
      score: Math.round(score * 100) / 100,
      reasons: [`质量 ${metrics.quality}`, `近期成功率 ${recent.successRate}%/${recent.runs} 次`, `偏好加分 ${preferenceBonus}`],
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  // 自动评审默认采用不同厂商，降低同源盲区；只有没有替代者时才回到原 Provider。
  const original = task && task.fm && (task.fm.provider || task.fm.供应商 || task.fm.执行池);
  if (kind !== '执行' && original && routing.crossProviderReview !== false) {
    const alternatives = ranked.filter((candidate) => candidate.name !== original);
    if (alternatives.length) return alternatives;
  }
  return ranked;
}

function chooseProvider(root, cfg, context) {
  return rankProviders(root, cfg, context)[0] || null;
}

module.exports = { taskRole, agentRole, requiredCapabilities, rankProviders, chooseProvider };
