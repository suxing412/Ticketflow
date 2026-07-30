// providers/claude-cli.js — Claude Code CLI 适配器。
const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultCommand() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
    path.join(home, '.local', 'bin', 'claude.exe'),
    'claude',
  ];
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
          ...(config.permissionArgs || ['--permission-mode', 'acceptEdits']),
          ...(model ? ['--model', model] : []),
        ],
        promptMode: 'stdin',
      };
    },
  };
}

module.exports = { create, defaultCommand };
