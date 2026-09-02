// providers/opencode-cli.js — OpenCode 无头适配器（协议基线：1.18.25）。
const fs = require('fs');
const os = require('os');
const path = require('path');

const GLM_MODEL = /^zhipuai-coding-plan\/glm-[a-z0-9][a-z0-9.-]*$/i;

function defaultCommand() {
  const home = os.homedir();
  const candidates = [
    process.env.OPENCODE_CLI_PATH,
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'opencode.cmd'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'opencode.exe'),
    path.join(home, '.local', 'bin', 'opencode.exe'),
    'opencode',
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === 'opencode' || fs.existsSync(candidate));
}

function assertModel(model) {
  if (!model || !GLM_MODEL.test(String(model))) {
    throw new Error(`opencode-cli 只允许 zhipuai-coding-plan/glm-*，收到：${model || '(空)'}`);
  }
  return String(model);
}

function create(config = {}) {
  const fixedModel = assertModel(config.model);
  return {
    name: config.name || 'glm',
    adapter: 'opencode-cli',
    config,
    buildInvocation({ model, agent } = {}) {
      if (model && String(model) !== fixedModel) {
        throw new Error(`Provider ${config.name || 'glm'} 的模型已固定为 ${fixedModel}，拒绝请求体覆盖为 ${model}`);
      }
      const selectedAgent = agent || config.agent || 'build';
      return {
        cmd: config.command || defaultCommand(),
        args: ['run', '--pure', '--model', fixedModel, '--format', 'json', '--agent', selectedAgent],
        promptMode: 'stdin',
        outputFormat: 'opencode-jsonl',
        env: config.env || {},
        model: fixedModel,
      };
    },
  };
}

module.exports = { create, defaultCommand, assertModel, GLM_MODEL };
