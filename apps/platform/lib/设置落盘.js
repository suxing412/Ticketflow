// 设置落盘 —— 把界面上改的设置写进 config/*.local.json（协-037）。
//
// 为什么要有：到协-036 为止，界面只配得了两样——工单库根目录、项目注册。
// 其余全得关掉程序、翻到 config/ 手改 JSON、再重启。而那几样恰恰是**最要紧的**：
// 真跑总开关、预算上限、提交链写权、计费模式、角色写权白名单。
// 一个「交钥匙壳」把最关键的五个开关留在文本编辑器里，那叫半成品。
//
// 边界（这条不能松）：**写的仍然只是 config/*.local.json**。
// 那个后缀被 .gitignore 结构性挡着，所以本地覆盖那条原始保证一个字都没变——
// 危险开关依旧不可能被提交进仓，入库那份永远是最严默认。
// 变的只是「怎么改它」：从手写文件变成点界面，不是从不可入库变成可入库。
//
// 白名单直接**复用 本地覆盖.覆盖表**，不另起一张。两张表迟早会对不上，
// 而对不上的表现是「界面写进去了、加载时不认」——配了没反应，最难查的那类。
'use strict';

const fs = require('fs');
const path = require('path');
const 本地覆盖 = require('./本地覆盖.js');
const 配置位置 = require('./配置位置.js');

// 落一份补丁。深合并，**值为 null 表示删掉那个键**。
//
// 要 null-删除是因为「取消某个池的上限」「取消某个角色的放开」是真实操作，
// 而纯深合并只增不减——没有删除语义的话，用户在界面上清空一个池，
// 下次加载它还在，而界面显示它没了。两边说法不一致比不能删更坏。
function 落(平台根, 文件名, 补丁) {
  const 键 = 本地覆盖.覆盖表[文件名];
  if (!键) return { ok: false, 错误: `不认识的覆盖文件：${文件名}（只认 本地覆盖.覆盖表 里那几个）` };
  const 文件 = path.join(配置位置.可写配置目录(平台根), 文件名);
  let 现 = {};
  try { 现 = JSON.parse(fs.readFileSync(文件, 'utf8')) || {}; } catch { /* 没有或坏了就从空开始 */ }
  const 合 = 合并可删(现, 补丁);
  try {
    fs.mkdirSync(path.dirname(文件), { recursive: true });
    fs.writeFileSync(文件, JSON.stringify(合, null, 2) + '\n', 'utf8');
  } catch (e) { return { ok: false, 错误: `写不进去（${文件}）：${e.message}` }; }
  return { ok: true, 文件, 键, 现值: 合 };
}

function 合并可删(基, 盖) {
  if (!盖 || typeof 盖 !== 'object' || Array.isArray(盖)) return 盖;
  const 出 = { ...(基 && typeof 基 === 'object' && !Array.isArray(基) ? 基 : {}) };
  for (const [k, v] of Object.entries(盖)) {
    if (v === null) { delete 出[k]; continue; }        // null = 删
    出[k] = 合并可删(出[k], v);
  }
  return 出;
}

// ——— 设置项的显式模式（协-037）———
//
// **不做通用的「任意键路径赋值」接口。** 那种接口等于把整份配置暴露成可写的，
// 而这里写的是花钱开关与写权白名单——能改什么必须是有限、可枚举、能一眼看完的。
// 请求里出现表外的键一律忽略（不是报错：界面版本可能比服务新，忽略比整单拒绝友好）。
const 布尔 = (v) => v === true || v === false;
const 池名合法 = (s) => /^[A-Za-z0-9._-]{1,40}$/.test(String(s || ''));
const 角色合法 = (s) => /^[A-Za-z0-9._-]{1,40}$/.test(String(s || ''));
const 计费模式 = ['订阅', 'api', '本地'];

function 应用设置(平台根, 请求) {
  const 体 = 请求 && typeof 请求 === 'object' ? 请求 : {};
  const 改 = [];
  const 错 = [];

  // ① 真跑总开关：这是「平台可以花钱」那道闸。
  //    开它**不等于**开始花钱——真跑还要过另外三闸（请求显式关干跑、该池有上限、
  //    落到 API 计费还要显式同意）。但它是第一道，所以界面上必须说清。
  if (体.允许真跑 !== undefined) {
    if (!布尔(体.允许真跑)) 错.push('允许真跑 只能是 true/false');
    else 改.push({ 文件: '执行.local.json', 补丁: { 允许真跑: 体.允许真跑 }, 说: `真跑总开关 → ${体.允许真跑 ? '开' : '关'}` });
  }

  // ② 提交链写权：开了意味着带令牌的调用方能在**已注册的项目仓**里建分支、提交、合并。
  if (体.允许写 !== undefined) {
    if (!布尔(体.允许写)) 错.push('允许写 只能是 true/false');
    else 改.push({ 文件: 'workspace.local.json', 补丁: { 允许写: 体.允许写 }, 说: `提交链写权 → ${体.允许写 ? '开' : '关'}` });
  }

  // ③ 角色写权白名单：白名单内的角色沿用适配器默认（含权限绕过）＝能改文件。
  //    缺配置即最严这条不动：空数组就是「全部受限」，而不是「全部放开」。
  if (体.放开 !== undefined) {
    if (!Array.isArray(体.放开)) 错.push('放开 要是数组');
    else if (!体.放开.every(角色合法)) 错.push('放开 里有非法角色名（只允许字母数字 . _ -）');
    else 改.push({ 文件: '执行.local.json', 补丁: { 权限: { 放开: [...new Set(体.放开.map(String))] } }, 说: `写权放开 → ${体.放开.join('、') || '(全部受限)'}` });
  }

  // ④ 每个 Provider 独立的并发上限。调度器把 Provider 当作池来计数，
  //    所以这里直接写 执行.并发.<provider>，改完不需要重启。
  //    null 保留给配置文件/后续界面做「恢复默认」；加减按钮只会写正整数。
  if (体.并发 !== undefined) {
    if (!体.并发 || typeof 体.并发 !== 'object' || Array.isArray(体.并发)) 错.push('并发 要是对象');
    else {
      const 段 = {};
      for (const [名, v] of Object.entries(体.并发)) {
        if (!池名合法(名)) { 错.push(`Provider 名非法：${名}`); continue; }
        if (v === null) { 段[名] = null; continue; }
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) { 错.push(`${名} 的并发上限要是正整数`); continue; }
        段[名] = n;
      }
      if (Object.keys(段).length) 改.push({ 文件: '执行.local.json', 补丁: { 并发: 段 }, 说: `并发上限 → ${Object.entries(段).map(([k, v]) => v === null ? `${k}:默认` : `${k}:${v}`).join('、')}` });
    }
  }

  // ⑤ 预算上限：没配上限的池一律不许真跑（第三道闸）。null = 取消该池上限。
  if (体.预算 !== undefined) {
    if (!体.预算 || typeof 体.预算 !== 'object') 错.push('预算 要是对象');
    else {
      const 池 = {};
      for (const [名, v] of Object.entries(体.预算)) {
        if (!池名合法(名)) { 错.push(`池名非法：${名}`); continue; }
        if (v === null) { 池[名] = null; continue; }
        const n = Number(v && (v.日token ?? v.dayToken));
        if (!Number.isFinite(n) || n <= 0) { 错.push(`${名} 的日token 要是正数`); continue; }
        池[名] = { 日token: Math.floor(n) };
      }
      if (Object.keys(池).length) 改.push({ 文件: '预算.local.json', 补丁: { 池 }, 说: `预算上限 → ${Object.entries(池).map(([k, v]) => v === null ? `${k}:取消` : `${k}:${v.日token}`).join('、')}` });
    }
  }

  // ⑥ 计费模式：**未声明一律按会计费对待**（见 lib/计费.js），所以这是个要人显式说的事实。
  //    它是账号级事实（这台机器上的订阅登录态），不是代码里的东西。
  if (体.计费 !== undefined) {
    if (!体.计费 || typeof 体.计费 !== 'object') 错.push('计费 要是对象');
    else {
      const 段 = {};
      for (const [名, v] of Object.entries(体.计费)) {
        if (!池名合法(名)) { 错.push(`池名非法：${名}`); continue; }
        if (v === null) { 段[名] = null; continue; }
        const 模式 = String((v && v.模式) || '').trim();
        if (!计费模式.includes(模式)) { 错.push(`${名} 的计费模式要是 ${计费模式.join('/')} 之一`); continue; }
        段[名] = { 模式 };
        if (v.订阅名) 段[名].订阅名 = String(v.订阅名).slice(0, 60);
        if (v.耗尽后) 段[名].耗尽后 = String(v.耗尽后).slice(0, 20);
      }
      if (Object.keys(段).length) 改.push({ 文件: '计费.local.json', 补丁: 段, 说: `计费模式 → ${Object.entries(段).map(([k, v]) => v === null ? `${k}:取消` : `${k}:${v.模式}`).join('、')}` });
    }
  }

  if (错.length) return { ok: false, 错误: 错.join('；') };
  if (!改.length) return { ok: false, 错误: '没有可改的项——请求里一个认识的键都没有' };

  // 同一个文件的多条补丁要合起来一次写，否则后写的会拿到前一次写之前的快照。
  // （放开 与 允许真跑 都落 执行.local.json，这不是假设性的。）
  //
  // ⚠ 聚合这一步**必须用保留 null 的深合并**，不能用 合并可删。
  // 用后者的话 null 在拼补丁时就被当成「删」执行掉了，落到 落() 的补丁里那个键
  // 干脆不存在——于是磁盘上那份原样留着，而回执写着「已取消」。
  // 实测踩到：取消 codex 的预算上限，返回 ok，文件里 codex 纹丝不动。
  // null 是**要一路带到磁盘那一步**才生效的指令，中途任何一次合并都不能消费它。
  const 按文件 = new Map();
  for (const c of 改) 按文件.set(c.文件, 本地覆盖.深合并(按文件.get(c.文件) || {}, c.补丁));
  const 结果 = [];
  for (const [文件名, 补丁] of 按文件) {
    const r = 落(平台根, 文件名, 补丁);
    if (!r.ok) return { ok: false, 错误: r.错误, 已改: 结果 };
    结果.push({ 文件: 文件名, 键: r.键 });
  }
  return { ok: true, 改: 改.map((c) => c.说), 落盘: 结果 };
}

module.exports = { 落, 应用设置, 合并可删 };
