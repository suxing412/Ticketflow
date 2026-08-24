// dev4299.js — pane 验证用 dev 实例（4270 是生产 exe 的，不抢；根指临时空库，不碰生产数据）
const fs = require('fs'); const path = require('path'); const os = require('os');
const root = path.join(os.tmpdir(), 'studio-dev4299');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify({ 项目: { 注册: { TK: {} }, 默认: 'TK' } }));
process.env.STUDIO_ROOT = root;
process.env.STUDIO_PORT = process.env.STUDIO_PORT || '4299';
process.env.STUDIO_STUB = '1';
require('./lib/core/store').ensureDirs(root);
require('./server').start();
