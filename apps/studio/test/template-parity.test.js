// template-parity.test.js — 配置模板的两份事实源（2026-08-22 体检 #74）
//
// 案源：新部署开箱即卡（TK-49 案）。acceptEdits 下 Bash 仍逐条要审批，而实弹会话是无头的、
// **没有人可以批**——缺 执行器.放行工具 的模板，第一条 Bash 就停在那里，
// 界面上还看不出原因（会话既没报错也没进展，只是不动了）。
// 本机实配早就补齐了，所以本机跑什么都对；伤的是**每一台新机**。
//
// 判据一条 grep 都没有：
//   · 第一格把模板给的放行工具真喂给 lib/runner.resolveCli，看拉起参数里到底有没有 --allowedTools；
//   · 第二格真跑一遍 建工作区()，读**落到磁盘的那份 config**（不是读模板函数）；
//   · 第三格把两份模板的键集全比一遍——分叉正是「两台机器行为不一致」的病根。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const setup = require('../lib/setup');
const runner = require('../lib/runner');
const { 临时目录, 收尾 } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('配置模板一致性测试');

const 套件模板 = path.resolve(__dirname, '..', '..', '..', '套件', 'studio.config.template.json');

t('模板给得出放行工具，且真的进得了拉起串（验 --allowedTools，不验模板文本）', () => {
  const 放 = (setup.模板配置().执行器 || {}).放行工具;
  assert.ok(Array.isArray(放) && 放.length, '模板必须给放行工具，缺键=新部署实弹会话逐条卡审批');
  assert.ok(!放.some((s) => /[A-Za-z]:[\\/]/.test(s)),
    '模板不许带盘符绝对路径（在别人的机器上不成立）：' + 放.join(' | '));
  // 真调 resolveCli：这才是「卡审批」的直接死因所在
  const { args } = runner.resolveCli('claude', 'sonnet', 放);
  const i = args.indexOf('--allowedTools');
  assert.ok(i >= 0, '模板的放行工具没进拉起参数——接线断了，模板写得再全也没用。实参：' + args.join(' '));
  assert.deepEqual(args.slice(i + 1, i + 1 + 放.length), 放, '放行项要原样逐个传给 CLI');
  // 反证：不给放行工具时不该凭空长出这个旗（否则上面那条断言证明不了任何事）
  assert.equal(runner.resolveCli('claude', 'sonnet', []).args.indexOf('--allowedTools'), -1,
    '空放行集不该带 --allowedTools —— 带了说明上面那格测的是别的东西');
});

t('向导落地的新工作区开箱就带放行工具与人闸口径（看落盘产物，不看模板函数）', () => {
  const d = path.join(临时目录('tpl-'), '工作区');
  const r = setup.建工作区(d);
  assert.equal(r.ok, true, '建工作区失败：' + r.error);
  const cfg = JSON.parse(fs.readFileSync(path.join(d, 'studio.config.json'), 'utf8'));
  const 放 = (cfg.执行器 || {}).放行工具;
  assert.ok(Array.isArray(放) && 放.length, '新部署开箱就该有放行工具，实测：' + JSON.stringify(cfg.执行器));
  assert.equal(typeof ((cfg.闸值 || {}).人闸超时小时), 'number',
    '缺键=两台机器的升格口径不一致（gatereg.逾期阈值 读它，缺键回落 24 而参数页显示「未设」）');
  // 落盘那份要能被真正的 config 加载器吃下去，并且吃完还带着这两格
  const 活 = require('../lib/core/config').load(d);
  assert.deepEqual((活.执行器 || {}).放行工具, 放, 'config.load 之后放行工具不许被吃掉');
  assert.equal((活.闸值 || {}).人闸超时小时, cfg.闸值.人闸超时小时);
  assert.equal(require('../lib/gatereg').逾期阈值(活), cfg.闸值.人闸超时小时,
    '升格阈值要取到模板给的那个数，而不是回落缺省');
});

t('套件模板与内置模板键集完全一致（分叉就是「新部署行为不一致」的病根）', () => {
  if (!fs.existsSync(套件模板)) return; // 打包产物里没有 套件/，跳过不算失败
  const 套 = JSON.parse(fs.readFileSync(套件模板, 'utf8').replace(/^﻿/, ''));
  const 键 = (o, pre) => Object.keys(o || {}).flatMap((k) => {
    const q = pre ? pre + '.' + k : k; const v = o[k];
    return (v && typeof v === 'object' && !Array.isArray(v)) ? [q, ...键(v, q)] : [q];
  });
  const 内 = 键(setup.模板配置(), '').sort();
  const 外 = 键(套, '').sort();
  assert.deepEqual(外.filter((k) => !内.includes(k)), [], '套件模板有内置模板没有的键');
  assert.deepEqual(内.filter((k) => !外.includes(k)), [], '内置模板有套件模板没有的键（08-22 前分叉 11 个）');
});

t('套件模板本身就带放行工具与人闸口径，且照样进得了拉起串', () => {
  if (!fs.existsSync(套件模板)) return;
  const 套 = JSON.parse(fs.readFileSync(套件模板, 'utf8').replace(/^﻿/, ''));
  const 放 = (套.执行器 || {}).放行工具;
  assert.ok(Array.isArray(放) && 放.length, '套件模板缺放行工具——照它部署的机器一样卡审批');
  assert.ok(!放.some((s) => /[A-Za-z]:[\\/]/.test(s)), '套件模板更不许带盘符路径：' + 放.join(' | '));
  assert.ok(runner.resolveCli('claude', '', 放).args.includes('--allowedTools'));
  assert.equal(typeof ((套.闸值 || {}).人闸超时小时), 'number');
  assert.equal(!!(套.执行器 || {}).派发制, !!setup.模板配置().执行器.派发制,
    '派发制口径不许分叉（H49 立宪项，原有判据保留）');
});

收尾('配置模板一致性', passed);
