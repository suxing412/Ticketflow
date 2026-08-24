// dev4300.js — 甘特冒烟用：连生产工单库只读浏览（写口全走人操作，浏览安全）
process.env.STUDIO_ROOT = 'D:/GitHub/AI-GameStudio/\u76d1\u5236\u53f0';
process.env.STUDIO_PORT = '4300';
process.env.STUDIO_STUB = '1';
require('./server').start();
