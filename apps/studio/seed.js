// seed.js — 铺样例工单（父子链 + 执行时间戳，供在途视图的执行时间轴演示）。node seed.js
const path = require('path');
const fs = require('fs');
const store = require('./lib/core/store');
const ROOT = path.resolve(__dirname, '..');
store.ensureDirs(ROOT);

const now = new Date().toISOString();
const rows = [
  // 母单（组织容器，不进池）
  ['草稿', { id: 'P-00', title: '甲系统总单', 职能: '策划', 优先级: 'P1', 规模: '小队', QA: '关', 验收方式: '保留' }],
  ['草稿', { id: 'M1', title: '乙系统总单', 职能: '程序', 优先级: 'P1', 规模: '小队', QA: '开', 验收方式: '委托' }],
  // P-00 的子单
  ['待验收', { id: 'P-08', title: '甲-规则落地', 职能: '策划', 优先级: 'P2', 规模: '小队', QA: '关', 验收方式: '保留', 父单: 'P-00', 主办: '策划-A', 领单时间: new Date(Date.now()-5*3600000).toISOString(), 交付时间: new Date(Date.now()-3.2*3600000).toISOString(), 依据: '示例系统#示例-03' }],
  ['池', { id: 'P-16', title: '乙-评分接口', 职能: '程序', 优先级: 'P2', 规模: '小队', QA: '开', 验收方式: '委托', 父单: 'P-00', 依赖: 'P-08' }],
  // M1 的子单
  ['完成', { id: 'P-05', title: '乙-地图基础', 职能: '程序', 优先级: 'P1', 规模: '小队', QA: '开', 验收方式: '委托', 父单: 'M1', 主办: '程序-A', 领单时间: new Date(Date.now()-30*3600000).toISOString(), 交付时间: new Date(Date.now()-26*3600000).toISOString() }],
  ['在途', { id: 'P-12', title: '甲-数值落点', 职能: '策划', 优先级: 'P1', 规模: '小队', QA: '关', 验收方式: '保留', 父单: 'M1', 主办: '策划-A', 执行池: 'claude', 领单时间: now }],
  ['池', { id: 'P-13', title: '乙-面板交互', 职能: '程序', 优先级: 'P1', QA: '开', 验收方式: '委托', 父单: 'M1', 依据: '示例系统#示例-02' }],
  ['待定夺', { id: 'P-11', title: 'UI 原型三版', 职能: '美术', 优先级: 'P2', QA: '开', 验收方式: '保留', 父单: 'M1', 自修次数: 2 }],
  // 顶层散单
  ['池', { id: 'P-14', title: 'UI 配色规范', 职能: '美术', 优先级: 'P2', QA: '关', 验收方式: '保留' }],
  ['质检', { id: 'P-15', title: '结算回归测试', 职能: 'QA', 优先级: 'P0', QA: '开', 验收方式: '委托', 主办: 'QA-A', 执行池: 'claude', 领单时间: now, 自修次数: 1 }],
  ['待投', { id: 'P-20', title: '图标一套', 职能: '美术', 优先级: 'P2', QA: '开', 验收方式: '保留' }],
  ['待投', { id: 'P-19', title: '存档迁移', 职能: '程序', 优先级: 'P1', QA: '开', 验收方式: '委托' }],
  ['草稿', { id: 'P-21', title: '甲-扩展规则', 职能: '策划', 优先级: 'P2', 规模: '小队', QA: '关', 验收方式: '保留' }],
  ['待验收', { id: 'P-09', title: '乙-描边渲染', 职能: '程序', 优先级: 'P1', QA: '开', 验收方式: '委托', 主办: '程序-A', 领单时间: new Date(Date.now()-8*3600000).toISOString(), 交付时间: new Date(Date.now()-7*3600000).toISOString() }],
  ['已归档', { id: 'P-03', title: '旧原型（返工替代）', 职能: '美术', 优先级: 'P3', QA: '关', 验收方式: '保留', 归档原因: '返工替代' }],
];
let n = 0;
for (const [state, opts] of rows) {
  const fm = { 产出物类型: '文档', 规模: opts.规模 || '单兵', 创建时间: '2026-07-08', 更新时间: now, ...opts };
  fs.writeFileSync(store.ticketPath(ROOT, state, fm.id),
    store.serialize(fm, `## 范围\n（${fm.title}）\n\n## 不要做\n\n## 验收标准\n□ 要点一　□ 要点二\n\n## 完工要求\n`), 'utf8');
  n++;
}
fs.writeFileSync(path.join(ROOT, '回执', 'P-08.md'),
  '# 完工报告 P-08\n工单编号：P-08\n## 做了什么\n规则映射 + 参数表 + 边界公式\n## QA 章节\n本单 QA 关，无\n## 实际消耗\n1.3h · 6.5万 token\n## 异议\n无\n', 'utf8');
console.log(`已铺 ${n} 张样例工单（含 2 母单 + 执行时间戳演示段）+ 1 份回执`);
