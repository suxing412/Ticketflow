#!/usr/bin/env node
// 转发壳（施工令-024）：正本已迁 packages/watchtower/watchtower.js，本文件只做旧路径兼容。
// 计划任务/启动.vbs/换装脚本仍可能指这里。正本以 require.main===module 判直跑，
// 经本壳 require 时该判定不成立，故由本壳显式代点 main（argv 原样透传，退出码由正本自定）。
'use strict';
const W = require('../../packages/watchtower/watchtower.js');
if (require.main === module) W.main(process.argv.slice(2));
module.exports = W;
