// providers/codex-cli.js — Codex CLI 适配器。
const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultCommand() {
  const home = os.homedir();
  const candidates = [
    process.env.CODEX_CLI_PATH,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'codex.cmd'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'codex.exe'),
    path.join(home, '.local', 'bin', 'codex.exe'),
    'codex',
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === 'codex' || fs.existsSync(candidate));
}
// 适配器只负责把统一执行请求翻译成进程调用；调度、角色和工单状态不在这里判断。

function create(config = {}) {
  return {
    name: config.name || 'codex',
    adapter: 'codex-cli',
    config,
    buildInvocation({ model } = {}) {
      return {
        cmd: config.command || defaultCommand(),
        args: [
          'exec',
          ...(config.permissionArgs || ['--dangerously-bypass-approvals-and-sandbox']),
          ...(model ? ['-m', model] : []),
          '--json',
          '-',
        ],
        promptMode: 'stdin',
        outputFormat: 'codex-jsonl',
      };
    },
  };
}

module.exports = { create, defaultCommand };
