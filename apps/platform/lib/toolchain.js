// toolchain.js — 给无头 Provider 统一注入项目工具链，避免每个 Agent 重复找 node/npm。
const fs = require('fs');
const path = require('path');

function candidates(root, cfg = {}) {
  const explicit = cfg.执行器 && (cfg.执行器.工具链目录 || cfg.执行器.nodeHome);
  const runtime = path.join(root, 'runtime');
  let installed = [];
  try {
    installed = fs.readdirSync(runtime, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^node-v/i.test(entry.name))
      .map((entry) => path.join(runtime, entry.name)).sort().reverse();
  } catch { /* 尚未安装平台工具链 */ }
  return [explicit, process.env.STUDIO_NODE_HOME, path.join(runtime, 'node'), ...installed]
    .filter(Boolean).map((value) => path.resolve(String(value)));
}

function resolve(root, cfg = {}) {
  for (const dir of candidates(root, cfg)) {
    const node = path.join(dir, 'node.exe');
    const npm = path.join(dir, 'npm.cmd');
    if (fs.existsSync(node) && fs.existsSync(npm)) return { ok: true, dir, node, npm, npx: path.join(dir, 'npx.cmd') };
  }
  return { ok: false, dir: null, node: null, npm: null, npx: null };
}

function env(root, cfg = {}, base = process.env) {
  const out = { ...base, CI: base.CI || '1', NO_UPDATE_NOTIFIER: '1', npm_config_update_notifier: 'false' };
  const found = resolve(root, cfg);
  if (!found.ok) return out;
  const current = out.PATH || out.Path || '';
  out.PATH = `${found.dir}${path.delimiter}${current}`;
  out.Path = out.PATH;
  out.STUDIO_NODE_HOME = found.dir;
  out.npm_config_cache = out.npm_config_cache || path.join(root, 'runtime', 'npm-cache');
  return out;
}

function guidance(root, cfg = {}) {
  const found = resolve(root, cfg);
  if (!found.ok) return [
    '平台未检测到统一 Node/npm 工具链。不要扫描整个磁盘、不要自行下载运行时；只做无需该工具链的工作，并在回执中报告一次环境缺失。',
  ].join('\n');
  return [
    `平台已把 Node/npm 工具链注入 PATH：${found.dir}`,
    '直接使用 node、npm.cmd、npx.cmd；不要再次搜索系统安装路径，也不要下载或安装另一套 Node。',
    '可按项目锁文件安装项目依赖；同一命令因环境或权限失败后最多换一种等价写法重试一次，随后停止试错并如实记录。',
    'Windows 下优先使用单一、短小的 PowerShell 命令；不要把多段探测、下载和管道拼成一条复杂命令。',
    '禁止从 C:\\、用户目录或其他盘符根目录递归搜索。所有文件操作保持在当前隔离工作区内。',
  ].join('\n');
}

module.exports = { candidates, resolve, env, guidance };
