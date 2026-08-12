// 本地覆盖 —— 让「危险开关」只能从**不入库**的文件里打开。
//
// 为什么要有它（这是从一次真实事故里长出来的）：
//   执行.允许真跑 是「平台可以花钱」的总开关，原先它住在 config/platform.config.json，
//   而那是**入库文件**。想在本机开真跑，就只有两条路：
//     ① 把 true 提交上去 —— 等于让所有克隆这个仓的人默认能花钱；
//     ② 一直挂着脏工作区 —— 迟早会被顺手 commit 进去。
//   两条都坏。危险开关不该住在跟踪文件里。
//
// 处置：`config/*.local.json` 覆盖同名字段。该后缀已被 .gitignore 挡住，
// 结构上不可能入库。入库的那份永远是**最严默认**，本机想放宽是本机的事。
//
// 深合并而非整段替换：只想开 执行.允许真跑 的人不该被迫把整个 执行 段抄一遍——
// 抄一遍就会随主配置演进而过期，那是另一种分叉。
'use strict';

const fs = require('fs');
const path = require('path');

// 覆盖文件名 → 被覆盖的顶层键。只认这张表里的，避免随手建个文件就能改任意配置。
const 覆盖表 = {
  '执行.local.json': '执行',
  '预算.local.json': '预算',
  'workspace.local.json': 'workspace',
  // 项目注册表：路径天生是机器相关的，入库那份只能是空壳。
  // 它同时是**写操作的白名单**——不在注册表里的仓，工作区服务一律拒绝往里提交。
  '项目.local.json': '项目',
  // 计费模式：订阅是**账号级事实**（这台机器上的 Claude Pro / Codex Plus 登录态），
  // 跟机器走不跟代码走，入库那份只能是空的。
  // 空的含义是「未声明」，而未声明一律按会计费对待——见 lib/计费.js。
  '计费.local.json': '计费',
};

function 深合并(基, 盖) {
  if (!盖 || typeof 盖 !== 'object' || Array.isArray(盖)) return 盖 === undefined ? 基 : 盖;
  const 出 = { ...(基 && typeof 基 === 'object' && !Array.isArray(基) ? 基 : {}) };
  for (const [k, v] of Object.entries(盖)) 出[k] = 深合并(出[k], v);
  return 出;
}

// 返回 { 配置, 生效的覆盖: [{ 文件, 键 }] }。
// 生效的覆盖要**回报给调用方**并打进开机日志：本机放宽了哪几处，必须看得见。
// 悄悄生效的安全降级比不降级更危险——人会以为还锁着。
function 应用(平台根, 配置) {
  // 测试要测的是**入库默认**的行为。不给这个出口的话，「谁本地开了真跑，
  // 谁的测试就变个样」——测试就不再是共同基准了。
  if (process.env.PLATFORM_NO_LOCAL) return { 配置, 生效的覆盖: [], 跳过本地: true };
  // .local.json 是**本机的**东西：打包态它们在 exe 同级，不在 asar 里。
  const 目录 = require('./配置位置.js').可写配置目录(平台根);
  let 出 = 配置;
  const 生效 = [];
  for (const [文件名, 键] of Object.entries(覆盖表)) {
    const p = path.join(目录, 文件名);
    let 盖 = null;
    try { 盖 = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    if (!盖 || typeof 盖 !== 'object') continue;
    delete 盖._说明;                                   // 说明字段只给人看，不参与合并
    出 = { ...出, [键]: 深合并(出[键], 盖) };
    生效.push({ 文件: 文件名, 键, 字段: Object.keys(盖) });
  }
  return { 配置: 出, 生效的覆盖: 生效 };
}

// 一行人话，给开机日志用
function 摘要(生效) {
  if (!生效.length) return '无本地覆盖（全部按入库默认，即最严）';
  return '本地覆盖生效：' + 生效.map((x) => `${x.文件}→${x.键}.{${x.字段.join(',')}}`).join('  ');
}

module.exports = { 应用, 摘要, 覆盖表, 深合并 };
