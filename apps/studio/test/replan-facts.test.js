// replan-facts.test.js — 排期复判的判断输入必须含「现状」（议程第 42 条，2026-08-28）
//
// 病灶：brain.replanReview 的提示词表头写着「计划 vs 现状」，载荷里**只有计划**——
// 没有放行态、没有单在哪个目录、没有是否停靠、没有实际起止。
// 模型被要求做计划-现实比较却无现实可比，只能编。四轮实测三轮在编：
//   00:39「实际进度较计划前移超 3 小时」（当夜零执行，无从前移）
//   03:23 同一句里既说「产线空转 68 分钟」又说「进度前移超 3 小时」，且判词写「整体前移」
//         而实测九粒全部延后、零粒前移
// 判「重排」直接改写排程台账，于是虚构结论成为账实——**这不是诊断不准，是审计记录不可信**。
//
// 本套件不打真实模型：把 spawn 掐掉，只截住**提示词本身**验它带了什么。
// 判据轴＝「现状字段在不在载荷里」，这是能被机械验证的那一半；
// 模型据此判得对不对是另一半，不在本套件范围（也不该用真实调用去测）。
const assert = require('node:assert');
const path = require('path');
const Module = require('module');
const life = require('../lib/lifecycle');
const store = require('../lib/core/store');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('replan-facts 复判现状载荷（议程第 42 条）');

// 截住提示词：替换 child_process.spawn，把 stdin 收到的内容捞出来，不真起进程。
//
// **缓冲必须是模块级共享的，mock 只装一次**——brain.js 第 7 行是
// `const { spawn } = require('child_process')`，加载那一刻就把函数引用解构走了。
// 上一版每次调用装一个新 mock、写进各自的局部变量：brain 捕获的是**第一次那个 mock**，
// 于是第二次起 提示 恒空，断言全挂。而第一格恰好是第一次调用，所以它绿——
// 「第一格绿、后面全红」是这类闭包捕获问题的典型形状，别当成后面几格写错了。
const 缓冲 = { 文: '' };
(() => {
  const cp = require('child_process');
  const { EventEmitter } = require('events');
  cp.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: (s) => { 缓冲.文 += String(s); }, end: () => { setImmediate(() => child.emit('close', 0)); } };
    child.pid = 1;
    return child;
  };
})();

function 捞提示词(root, 触因) {
  缓冲.文 = '';
  require('../lib/pm/brain').replanReview(root, { 模型: { 项管: 'opus' } }, 触因, () => {});
  return 缓冲.文;
}

// 粒表直接写进排程账（走 schedule 的落账口太绕，这里只要 现态() 读得出来）
function 备粒(root, 粒们) {
  const fs = require('fs');
  const p = path.join(root, '排程台账', '排程账.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const 行 = 粒们.map((g) => JSON.stringify({
    粒ID: g.粒ID, 事件类型: '登记', 版本号: 1, 时刻: '2026-08-27T00:00:00.000Z', 操作者: '总监',
    字段变更: { 题: g.题, 状态: g.状态, 计划开始: g.计划开始, 计划完成: g.计划完成, 单号: g.单号 },
  }));
  fs.writeFileSync(p, 行.join('\n') + '\n', 'utf8');
}

t('载荷里真的有现状五格：放行 / 所在 / 停靠 / 实起 / 实完', () => {
  const root = makeRoot();
  seed(root, '待审', { id: 'R-1' }); life.审过(root, 'R-1');
  life.停靠(root, 'R-1', '项目错配候定夺废弃');
  seed(root, '待审', { id: 'R-2' }); life.审过(root, 'R-2');   // 待派未放行
  备粒(root, [
    { 粒ID: 'aaaa1111-0000-0000-0000-000000000001', 题: '停靠那粒', 状态: '已成单', 计划开始: '2026-08-27T23:30', 计划完成: '2026-08-28T00:30', 单号: 'R-1' },
    { 粒ID: 'aaaa1111-0000-0000-0000-000000000002', 题: '未放行那粒', 状态: '已成单', 计划开始: '2026-08-28T01:00', 计划完成: '2026-08-28T02:00', 单号: 'R-2' },
  ]);

  const 提示 = 捞提示词(root, '产线空转：在途 0、就绪 0');
  assert.ok(提示.length > 200, '没捞到提示词（长度 ' + 提示.length + '）——下面几格等于没验');

  for (const k of ['放行', '所在', '停靠', '实起', '实完']) {
    assert.ok(提示.includes(`"${k}"`), `载荷缺现状字段 ${k}——表头写「计划 vs 现状」而没有现状，模型只能编`);
  }
  // 值也要对，不能只是键在
  assert.ok(/"单号":"R-1"[^\n]*"停靠":true/.test(提示.replace(/\s/g, '')) || /"停靠":true/.test(提示),
    '停靠单的 停靠 值要是 true');
  assert.ok(/"所在":"待派"/.test(提示), '所在要给出真实目录');
});

t('触因不再是诱导性提问（「排期是否过于保守」把答案方向先给了）', () => {
  const root = makeRoot();
  备粒(root, [{ 粒ID: 'bbbb2222-0000-0000-0000-000000000001', 题: '甲', 状态: '已成单', 计划开始: '2026-08-28T01:00', 计划完成: '2026-08-28T02:00', 单号: null }]);
  const 提示 = 捞提示词(root, '产线空转：在途 0、就绪 0，而 6 粒排期未到点');
  assert.ok(提示.includes('只是现象，不预设结论'), '触因要中性陈述');
  assert.ok(/放行侧|停靠|依赖|额度/.test(提示), '要把「空转还可能来自哪些地方」摆出来，否则模型只会往排期上想');
});

t('判断纪律四条进了提示词：没给的事实不许推断 / 停靠不是排期问题 / 卡放行不是排期问题 / 人工闸时点是硬约束', () => {
  const root = makeRoot();
  备粒(root, [{ 粒ID: 'cccc3333-0000-0000-0000-000000000001', 题: '手感闸复验（制作人亲自拖 8 次）', 状态: '已成单', 计划开始: '2026-08-28T09:00', 计划完成: '2026-08-28T10:00', 单号: null }]);
  const 提示 = 捞提示词(root, '产线空转');
  assert.ok(提示.includes('现状列没给的事实一律不许推断'), '这条直接对着「凭空断言前移了 3 小时」那个病');
  assert.ok(提示.includes('停靠=true 的粒**不是排期问题**'), '停靠粒挪到几点都跑不了');
  assert.ok(/放行=false[^\n]*不是排期问题/.test(提示), '卡放行的粒重排解决不了');
  assert.ok(提示.includes('硬约束'), '人工闸时点不得被挪');
  // 人工闸标记要真的打上，不是只在纪律里说说
  assert.ok(/"人工闸":true/.test(提示), '含「制作人亲自」的粒要被标成人工闸，否则纪律④无从执行');
});

t('读不到单时留 null，不猜——猜出来的现状比没有现状更坏', () => {
  const root = makeRoot();
  备粒(root, [{ 粒ID: 'dddd4444-0000-0000-0000-000000000001', 题: '挂着不存在的单', 状态: '已成单', 计划开始: '2026-08-28T01:00', 计划完成: '2026-08-28T02:00', 单号: 'NOPE-99' }]);
  const 提示 = 捞提示词(root, '产线空转');
  assert.ok(/"所在":"单不存在"/.test(提示), '单查无此号要如实说，不许留空让模型以为正常');
  assert.ok(/"放行":null/.test(提示), '读不到的放行态要是 null，不是 false——false 是「查过了没放行」，null 是「没查到」');
  assert.ok(提示.includes('null 表示读不到'), '字段说明里要讲明 null 的含义，否则模型会把它当 0 或「正常」');
});

console.log('  ' + passed + ' 项通过');
