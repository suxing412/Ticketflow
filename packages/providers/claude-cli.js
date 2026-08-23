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
    // maxTurns：可选。缺省不注入 `--max-turns`，行为与此前**逐字节相同**。
    //
    // 为什么加它（2026-08-23 实测）：一张真项目的 backend 单连挂两次，回执只有「退出码 1」。
    // 而 stream-json 的最后一行写着 `{"type":"result","is_error":true,
    // "stop_reason":"stop_sequence","num_turns":20}`——**回合数用光被截断**，
    // 活干到一半停了。默认那个上限对「读 27 条契约再改一个模块」这种单不够用，
    // 而调用方此前没有任何办法把它调大。
    buildInvocation({ model, maxTurns } = {}) {
      const 轮 = Number(maxTurns);
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
          ...(Number.isFinite(轮) && 轮 > 0 ? ['--max-turns', String(Math.floor(轮))] : []),
          ...(model ? ['--model', model] : []),
        ],
        promptMode: 'stdin',
        outputFormat: 'claude-stream-json',
      };
    },
  };
}

module.exports = { create, defaultCommand };
