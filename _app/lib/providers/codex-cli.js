// providers/codex-cli.js — Codex CLI 适配器。
// 适配器只负责把统一执行请求翻译成进程调用；调度、角色和工单状态不在这里判断。

function create(config = {}) {
  return {
    name: config.name || 'codex',
    adapter: 'codex-cli',
    config,
    buildInvocation({ model } = {}) {
      return {
        cmd: config.command || 'codex',
        args: [
          'exec',
          ...(config.permissionArgs || ['--dangerously-bypass-approvals-and-sandbox']),
          ...(model ? ['-m', model] : []),
          '-',
        ],
        promptMode: 'stdin',
      };
    },
  };
}

module.exports = { create };
