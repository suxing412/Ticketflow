const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const toolchain = require('../lib/toolchain');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-toolchain-'));
try {
  const dir = path.join(root, 'runtime', 'node-v24.1.0-win-x64');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'node.exe'), 'stub');
  fs.writeFileSync(path.join(dir, 'npm.cmd'), 'stub');
  fs.writeFileSync(path.join(dir, 'npx.cmd'), 'stub');
  const found = toolchain.resolve(root, {});
  assert.equal(found.ok, true);
  assert.equal(found.dir, dir);
  const env = toolchain.env(root, {}, { PATH: 'C:\\Windows' });
  assert.ok(env.PATH.startsWith(dir + path.delimiter));
  assert.equal(env.CI, '1');
  assert.match(toolchain.guidance(root, {}), /不要再次搜索系统安装路径/);
  console.log('  ✓ Agent 工具链发现、PATH 注入与防重复探测提示');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
