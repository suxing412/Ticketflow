#!/usr/bin/env node
// test.js — 评审台离线自测（施工令-024 迁包时补：此前无独立测试文件）。
// 纪律：只走 --dry 与参数校验路径——零网络、零厂商调用、零 token；
//      config 一律现造临时副本，绝不读写生产 config。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const 台 = path.join(__dirname, 'review.js');
let 过 = 0; const 挂 = [];
function ok(名, 真, 详) {
  if (真) { 过++; process.stdout.write(`  ✔ ${名}\n`); }
  else { 挂.push(名 + (详 ? ` —— ${详}` : '')); process.stdout.write(`  ✗ ${名}${详 ? ` —— ${详}` : ''}\n`); }
}
const 章 = (s) => process.stdout.write(`\n【${s}】\n`);

function 跑(argv) {
  const r = spawnSync(process.execPath, [台].concat(argv), { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  let j = null;
  try { j = JSON.parse(String(r.stdout).trim().split('\n').filter(Boolean).pop()); } catch { /* 调用方判空 */ }
  return { code: r.status, j, so: String(r.stdout || ''), se: String(r.stderr || '') };
}

const 巢 = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
const 方案 = path.join(巢, '假方案.md');
fs.writeFileSync(方案, '# 假方案\n\n仅供 dry 演练，不含任何真实内容。\n', 'utf8');
const 空方案 = path.join(巢, '空方案.md');
fs.writeFileSync(空方案, '', 'utf8');
const 假KEY = 'sk-fake1234567890abcdef';
const 兼容 = (名, 改) => ({ [名]: { 兼容: Object.assign({ base: 'http://127.0.0.1:9', key: 假KEY, 模型: 名 + '-chat' }, 改 || {}) } });
function 配(池) {
  const p = path.join(巢, `cfg-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(p, JSON.stringify({ 模型: { codex默认: 'gpt-5' }, 执行池: 池 || {} }), 'utf8');
  return p;
}

章('T1 argv 契约与退出码');
let r = 跑([]);
ok('缺 --file：退出码 1 + 一行 JSON 报错', r.code === 1 && !!r.j && r.j.ok === false && /--file/.test(r.j.error), r.so.trim());
r = 跑(['--file', path.join(巢, '不存在.md'), '--dry', '--config', 配()]);
ok('方案不存在：退出码 1 + 点名路径', r.code === 1 && !!r.j && /不存在/.test(r.j.error), r.so.trim());
r = 跑(['--file', 空方案, '--dry', '--config', 配()]);
ok('空方案拒评', r.code === 1 && !!r.j && /空文件/.test(r.j.error), r.so.trim());
r = 跑(['--file', 方案, '--dry', '--config', path.join(巢, '没有这个config.json')]);
ok('config 读不了：退出码 1', r.code === 1 && !!r.j && /config/i.test(r.j.error), r.so.trim());

章('T2 评审团自动发现（--dry 零调用）');
r = 跑(['--dry', '--file', 方案, '--config', 配()]);
ok('空执行池：codex 独席', r.code === 0 && !!r.j && r.j.ok === true && r.j.dry === true && JSON.stringify(r.j.评审团) === '["codex"]', r.so.trim());
ok('dry 不产合集（out=null 意见数=0）', !!r.j && r.j.out === null && r.j.意见数 === 0);
const 单厂 = r.j;
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek'))]);
ok('兼容池条目自动入席', !!r.j && JSON.stringify(r.j.评审团) === '["codex","deepseek"]', r.so.trim());
const 两厂 = r.j;
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek', { key: '' }))]);
ok('兼容段缺 key 不入席（不猜不报错）', !!r.j && JSON.stringify(r.j.评审团) === '["codex"]', r.so.trim());
r = 跑(['--dry', '--file', 方案, '--config', 配(Object.assign({}, 兼容('deepseek'), 兼容('kimi')))]);
ok('三厂全入席', !!r.j && r.j.评审团.length === 3, r.so.trim());
const 三厂 = r.j;

章('T3 立场卷派发（019 红队制：每卷有主、每席有卷）');
ok('单厂独领三卷', !!单厂 && Array.isArray(单厂.立场卷.codex) && 单厂.立场卷.codex.length === 3, JSON.stringify(单厂 && 单厂.立场卷));
ok('两厂：甲领一三、乙领二', !!两厂
  && JSON.stringify(两厂.立场卷.codex) === JSON.stringify(['可行性红队', '成本红队'])
  && JSON.stringify(两厂.立场卷.deepseek) === JSON.stringify(['不变量红队']), JSON.stringify(两厂 && 两厂.立场卷));
ok('三厂：一席一卷', !!三厂 && Object.values(三厂.立场卷).every((卷) => 卷.length === 1)
  && new Set(Object.values(三厂.立场卷).flat()).size === 3, JSON.stringify(三厂 && 三厂.立场卷));

章('T4 --only 定向');
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek')), '--only', 'deepseek']);
ok('--only 过滤到点名席位', !!r.j && JSON.stringify(r.j.评审团) === '["deepseek"]', r.so.trim());
ok('独席过滤后仍独领三卷', !!r.j && r.j.立场卷.deepseek.length === 3, JSON.stringify(r.j && r.j.立场卷));
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek')), '--only', '不存在的厂']);
ok('--only 点名全落空：退出码 1 + 回报名册', r.code === 1 && !!r.j && /名册/.test(r.j.error), r.so.trim());

章('T5 密钥纪律');
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek'))]);
ok('dry 全量输出不含明文 key', !r.so.includes(假KEY) && !r.se.includes(假KEY), '输出泄密');

try { fs.rmSync(巢, { recursive: true, force: true }); } catch { /* 临时目录留着无害 */ }
process.stdout.write(`\n════ 合计 ${过 + 挂.length} 例：过 ${过}，挂 ${挂.length} ════\n`);
for (const m of 挂) process.stdout.write(`  ✗ ${m}\n`);
process.exit(挂.length ? 1 : 0);
