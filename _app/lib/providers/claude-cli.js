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
          ...(config.permissionArgs || ['--permission-mode', 'acceptEdits']),
          ...(model ? ['--model', model] : []),
        ],
        promptMode: 'stdin',
        outputFormat: 'claude-stream-json',
      };
    },
  };
}

module.exports = { create, defaultCommand };
