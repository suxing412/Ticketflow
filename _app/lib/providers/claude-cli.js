// providers/claude-cli.js — Claude Code CLI 适配器。
const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultCommand() {
  const home = os.homedir();
  const candidates = [
    process.env.CLAUDE_CLI_PATH,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'claude.cmd'),
    path.join(home, '.local', 'bin', 'claude.exe'),
    'claude',
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === 'claude' || fs.existsSync(candidate));
}

function create(config = {}) {
  return {
    name: config.name || 'claude',
    adapter: 'claude-cli',
    config,
    buildInvocation({ model } = {}) {
      return {
        cmd: config.command || defaultCommand(),
        args: [
          '-p',
          '--output-format', 'stream-json',
          '--verbose',
          '--include-partial-messages',
          // 无头 -p 会话无法弹出权限确认；acceptEdits 只放行编辑，测试命令仍会反复被拒。
          // 工单已运行在独立 worktree，且检查点会校验 write_scope，因此使用官方无头绕过开关。
          ...(config.permissionArgs || ['--dangerously-skip-permissions']),
          ...(model ? ['--model', model] : []),
        ],
        promptMode: 'stdin',
        outputFormat: 'claude-stream-json',
      };
    },
  };
}

module.exports = { create, defaultCommand };
