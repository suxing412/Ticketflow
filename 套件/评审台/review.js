#!/usr/bin/env node
// 转发壳（施工令-024）：正本已迁 packages/review-panel/review.js，本文件只做旧路径兼容。
// 放行白名单与监制台重启前的执行器仍指这里；正本自读 process.argv、自定退出码，require 即原样透传。
require('../../packages/review-panel/review.js');
