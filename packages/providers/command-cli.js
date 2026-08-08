// providers/command-cli.js — 通用无头 CLI 适配器。
// 可用于 Kimi 或后续任意厂商：命令、固定参数和模型参数都由配置声明，提示词默认走 stdin。

function fill(values, model) {
  return (values || []).map((value) => String(value).replaceAll('{model}', model || ''));
}

function create(config = {}) {
  return {
    name: config.name,
    adapter: 'command-cli',
    config,
    buildInvocation({ model } = {}) {
      if (!config.command) throw new Error(`Provider ${config.name || ''} 缺少 command`);
      const args = fill(config.args, model);
      if (model && !args.some((arg) => arg.includes(model))) {
        args.push(...fill(config.modelArgs || ['--model', '{model}'], model));
      }
      return {
        cmd: config.command,
        args,
        promptMode: config.promptMode || 'stdin',
        env: config.env || {},
      };
    },
  };
}

module.exports = { create };
