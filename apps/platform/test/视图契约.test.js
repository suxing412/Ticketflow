// 视图契约测试 —— 流程页与知识库（协-006）。
//
// 两块都是「把已有的事实换个角度摆出来」，本身不产生新事实。所以真正要守的是：
//   · 流程页算得对，且**算不死**（依赖字段是人写的，环不是不可能）
//   · 知识库读得到该读的，读不到不该读的（路径闸 + 本机配置不外发）
//   · markdown 渲染**先转义再套格式**——顺序反了就是把磁盘上的文件当 HTML 执行
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
const 流程 = require(path.join(平台根, 'lib', '流程视图.js'));
const 知识 = require(path.join(平台根, 'lib', '知识库.js'));

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('视图契约测试');

const 单 = (id, state, 依赖) => ({ id, state, fm: { title: id + ' 标题', role: 'backend', ...(依赖 ? { 依赖 } : {}) } });

// ---- 流程视图 ----
t('依赖成环不把整页算死（先占位再回填，环在这里断掉）', () => {
  // 父子/依赖字段是人写的，环不是不可能。一条环边不该让整页算不出来——
  // 这一手是从 studio 的流程页学的，它踩过。
  const r = 流程.铺([单('A', '待投', ['B']), 单('B', '待投', ['A'])]);
  assert.equal(r.小结.在办, 2);
  assert.ok(r.层.length >= 1, '成环时仍要出得来结果');
  // 深环也不能爆栈
  const 长环 = [];
  for (let i = 0; i < 60; i++) 长环.push(单('L' + i, '待投', ['L' + ((i + 1) % 60)]));
  assert.doesNotThrow(() => 流程.铺(长环), '60 环不能爆栈');
});

t('三种「不动」分得开：等上游 / 依赖缺失 / 就绪', () => {
  // 分得开才有用——三种的处置完全不同：等上游只需等；依赖缺失要去建单或改依赖；
  // 就绪了只是没人点，那就点。在看板上它们长得一模一样，都只是「待投」。
  const r = 流程.铺([
    单('U', '完成'),
    单('就绪', '待投', ['U']),
    单('等着', '待投', ['在途单']),
    单('在途单', '在途'),
    单('缺依赖', '待投', ['根本没有这张单']),
  ]);
  const 取 = (id) => r.层.flatMap((l) => l.工单).find((x) => x.id === id);
  assert.equal(取('就绪').卡因.类型, '就绪');
  assert.equal(取('等着').卡因.类型, '等上游');
  assert.equal(取('缺依赖').卡因.类型, '依赖缺失');
  assert.ok(/永远不会就绪/.test(取('缺依赖').卡因.说), '依赖缺失要说清它不是「等等就好」');
  assert.equal(r.小结.就绪, 1);
  assert.equal(r.小结.依赖缺失, 1);
});

t('完成的单不铺进层里（堆着只会把「现在该看什么」淹掉）', () => {
  const r = 流程.铺([单('D1', '完成'), 单('D2', '完成'), 单('活', '待投')]);
  const 全 = r.层.flatMap((l) => l.工单).map((x) => x.id);
  assert.deepEqual(全, ['活']);
  // 但状态机那一栏要算全部——那是全库分布，不是在办清单
  assert.equal(流程.状态序.length, 5);
  assert.equal((r.状态机.find((x) => x.状态 === '完成') || {}).张数, 2);
});

t('层的深度是依赖深度，不是状态顺序', () => {
  const r = 流程.铺([单('C0', '待投'), 单('C1', '待投', ['C0']), 单('C2', '待投', ['C1'])]);
  const 深 = Object.fromEntries(r.层.flatMap((l) => l.工单.map((x) => [x.id, l.深度])));
  assert.deepEqual(深, { C0: 0, C1: 1, C2: 2 });
  assert.equal(r.小结.最深, 2);
});

// ---- 知识库 ----
t('四个分区都指向真实存在的目录，且都不是空的', () => {
  // 分区照着「自己有什么」定，不照抄 studio 的五分区——抄过来会得到三个永远空着的格子
  const 分区 = 知识.分区();
  assert.ok(分区.length >= 4);
  for (const z of 分区) {
    assert.ok(fs.existsSync(path.join(平台根, z.目录)), `分区 ${z.键} 指向不存在的目录 ${z.目录}`);
    const r = 知识.列区(平台根, z.键);
    assert.equal(r.ok, true, r.错误);
    assert.ok(r.条数 > 0, `分区 ${z.键} 是空的——空分区比没有分区更糟，人会以为东西丢了`);
    assert.ok(z.说 && z.说.length > 8, `分区 ${z.键} 要有一句「这里面是什么」：读的人第一个问题就是该看哪个`);
  }
});

t('路径闸挡住穿越（这个接口读什么由 URL 说了算，是典型穿越目标）', () => {
  for (const 坏 of ['../../config/接口令牌.local.json', '..\\..\\package.json', '../../../../etc/passwd',
    './../../server.js', '/绝对路径.md']) {
    const r = 知识.读(平台根, '说明书', 坏);
    assert.equal(r.ok, false, `穿越没挡住：${坏}`);
  }
  // 正常的读得到
  const 好 = 知识.列区(平台根, '角色协议').文档[0];
  const r = 知识.读(平台根, '角色协议', 好.rel);
  assert.equal(r.ok, true, r.错误);
  assert.ok(r.正文.length > 20);
});

t('本机配置不外发：*.local.* 既不列出也读不到', () => {
  // config 分区选的是出厂默认。本机那几份带着令牌与私仓绝对路径，
  // 列出来就是把它们发给任何打开这个页面的人。
  const 列 = 知识.列区(平台根, '配置示例');
  assert.ok(!列.文档.some((d) => d.文件名.includes('.local.')), '列表里出现了本机配置：'
    + 列.文档.map((d) => d.文件名).join('、'));
  // 就算知道文件名直接点名要也不给
  const r = 知识.读(平台根, '配置示例', '接口令牌.local.json');
  assert.equal(r.ok, false);
  assert.equal(r.码, 403);
});

t('未知分区报人话，并列出可选项', () => {
  const r = 知识.列区(平台根, '不存在的区');
  assert.equal(r.ok, false);
  assert.ok(/可选/.test(r.错误), '要告诉人有哪些区可选：' + r.错误);
});

t('目录列表用文首标题，不是光秃秃的文件名', () => {
  // 一排 backend.md / common.md 得逐个点开才知道是什么。标题是最便宜的目录。
  const r = 知识.列区(平台根, '角色协议');
  const 有真标题 = r.文档.filter((d) => d.标题 !== d.文件名);
  assert.ok(有真标题.length >= r.文档.length - 1, '大多数文档应能取到文首标题');
});

// ---- markdown 渲染（前端函数，从 app.js 抽出来直接跑）----
// 这是唯一一段「把磁盘文件变成 HTML」的代码，必须单独验。
// 在 node 里跑它而不是开浏览器：转义顺序这种事要能随测试跑，不能靠人眼看。
function 取渲染器() {
  const s = fs.readFileSync(path.join(平台根, 'public', 'app.js'), 'utf8');
  const m = s.match(/function 渲染md[\s\S]*?\n\}/);
  assert.ok(m, 'app.js 里找不到 渲染md——改了名字就把这个测试一起改了');
  const 转义 = (x) => String(x == null ? '' : x)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return new Function('转义', 'return (' + m[0] + ')')(转义);
}

t('渲染 md：先转义再套格式（顺序反了就是让文件在页面上执行脚本）', () => {
  const md = 取渲染器();
  const 出 = md('正文里有 <script>alert(1)</script> 和 <img src=x onerror=alert(2)>');
  assert.ok(!/<script/i.test(出), 'script 标签活着出去了：' + 出);
  assert.ok(!/<img/i.test(出), 'img 标签活着出去了：' + 出);
  assert.ok(/&lt;script&gt;/.test(出));
  // 代码块里的更要挡——那里面本来就爱放标签字面量
  const 码 = md('```\n<script>x</script>\n```');
  assert.ok(!/<script/i.test(码), '围栏代码块里的标签活着出去了：' + 码);
});

t('渲染 md：表格真的渲染，普通带竖线的句子不误判成表', () => {
  const md = 取渲染器();
  const 表 = md('| 层 | 位置 |\n|---|---|\n| 公用件 | packages/ |');
  assert.ok(/<table/.test(表) && /<th>层<\/th>/.test(表) && /<td>packages\/<\/td>/.test(表), 表);
  assert.ok(!/\|---\|/.test(表), '分隔行不该出现在渲染结果里');
  // 只有竖线没有分隔行 → 是普通段落。少了这道判据，正文里一句带竖线的话会被吃成表
  const 非表 = md('这句话 | 带了竖线 | 但不是表');
  assert.ok(!/<table/.test(非表), '把普通段落当成表了：' + 非表);
});

t('渲染 md：围栏没闭合也不吞掉后面的内容', () => {
  const md = 取渲染器();
  const 出 = md('# 标题\n```\n没闭合的代码');
  assert.ok(/<\/code><\/pre>/.test(出), '未闭合的围栏要在结尾补上，否则后面所有内容都被吃进代码块');
});

console.log(`全部通过：${passed} 项`);
