#!/usr/bin/env node
// 转发壳（施工令-024）：正本已迁 packages/enginectl/enginectl.js，本文件只做旧路径兼容。
// TK 仓 tools/enginectl.js 已直指 packages 正本（不经本壳）；本壳只为 studio.config 放行白名单里的旧路径条目、
// 以及历史回执里写死本路径的命令继续可用。正本自读 process.argv、自定退出码，require 即原样透传。
require('../../packages/enginectl/enginectl.js');
