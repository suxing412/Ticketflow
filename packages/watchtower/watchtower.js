#!/usr/bin/env node
// watchtower.js — 瞭望塔（施工令-018 · 统一监视守护）
//
// 一个常驻进程收口全部信源与定点唤起，与总监会话 / VPN / CLI 生死解耦。
//
// 用法：
//   node watchtower.js [--root <部署工作区根>] [--rules <规则.json>] [--config <瞭望塔.config.json>]
//                      [--out <输出目录>] [--from-start] [--once] [--no-toast]
//   node watchtower.js --ack <ISO时间戳|毫秒|all|latest>   清账（未读账本水位前移，并在无守护在岗时压实）
//   node watchtower.js --unread [--limit N]                看未读
//   node watchtower.js --status                            看在岗状态/水位/游标
//   node watchtower.js --toast-test                        发一条测试通知（验通道回落链）
//   node watchtower.js --install [--task-name 瞭望塔] [--no-vbs]   注册登录自启计划任务
//   node watchtower.js --uninstall [--task-name 瞭望塔]            反注册
//
// 五路信源：
//   ① 流水 —— tail 部署区 journal/<当月>.log（月切自动跟随，新月从头读）
//   ② 信箱 —— tail 部署区 呼叫/inbox.jsonl
//   ③ 时钟 —— 规则表 时钟[] 里的定点（默认 09:03 晨报 / 23:26 晚报 / 00:00 切夜班）
//   ④ 心跳 —— 每 5 分钟探 /api/board，连续两次非 200 → 「监制台失联」，恢复后报「监制台恢复」
//   ⑤ 远端 —— 每 5 分钟对仓清单 git fetch --all --prune（只动 refs，不碰工作区、不 pull/merge），
//              比对上轮快照报 新提交 / 新分支 / 删分支；触及 docs/ 下 交接·回执·信道 类 md 的另标「信道文书」
//
// 三个输出（落部署区 瞭望塔/ 子目录，本进程只写这里，AI-GameStudio 其余一律只读）：
//   瞭望塔流水.log —— 统一事件流，一行一事件带信源标（总监会话唯一 tail 对象）
//   未读账本.jsonl —— 会话不在场时的积压，配 账本水位.json 做已读线
//   心跳.txt —— 在岗活体信号（施工令-024）：每 30s 覆盖写一行 ISO 时刻，--status 有心跳段
//
// 纪律：
//   - 只读部署区，只写 <部署区>/瞭望塔/ 下的自有文件；不碰监制台任何代码；
//   - 任何往外走的字符串（流水/账本/stdout）先过 scrub()，形状兜底抹密钥；
//   - 单文件、零依赖（node 内置模块 only），同 packages/review-panel/review.js 口径。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const 默认部署区 = 'D:/GitHub/AI-GameStudio/监制台';
const 默认心跳地址 = 'http://127.0.0.1:4270/api/board';
const 默认任务名 = '瞭望塔';
const 默认远端仓 = 'D:/GitHub/Ticketflow';
const REDACT = '***已抹除***';
const 余量上限 = 1 << 20;                       // 单条未完行超 1MB 视为脏数据，丢弃不撑爆内存

// —— 参数解析（同 review.js / enginectl 口径：--k v 取值，--k 后接 --k2 则为布尔真）——
function 解析参数(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const it = argv[i];
    if (typeof it !== 'string' || !it.startsWith('--')) continue;
    const 下 = argv[i + 1];
    a[it.slice(2)] = (typeof 下 === 'string' && !下.startsWith('--')) ? (i++, 下) : true;
  }
  return a;
}
const 取值 = (v, 兜底) => (typeof v === 'string' && v !== '' ? v : 兜底);

// —— 密钥净化：流水/账本/stdout 三条出口共用，只做形状兜底（本进程不持有任何密钥）——
function scrub(x) {
  let s = (x === null || x === undefined) ? '' : String(x);
  s = s.replace(/sk-[A-Za-z0-9_\-]{6,}/g, REDACT);
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]{8,}/gi, '$1' + REDACT);
  s = s.replace(/(x-api-key["'\s:=]{1,4})[A-Za-z0-9._\-]{8,}/gi, '$1' + REDACT);
  s = s.replace(/((?:key|token|secret)["'\s:=]{1,4})[A-Za-z0-9._\-]{16,}/gi, '$1' + REDACT);
  return s;
}

// —— 时间（WATCHTOWER_TIME_SHIFT_MS 只给实测用：整体平移时钟，钟仍在走，可造月切/定点）——
const 时移 = Number(process.env.WATCHTOWER_TIME_SHIFT_MS || 0) || 0;
const 现在 = () => new Date(Date.now() + 时移);
const pad = (n) => String(n).padStart(2, '0');
const 日期串 = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const 时刻串 = (d) => `${日期串(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const 当月日志名 = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}.log`;
// 事件文本必须压成一行——流水是「一行一事件」，journal 里塞过整篇 QA 报告
const 单行 = (s) => scrub(String(s === undefined || s === null ? '' : s)).replace(/\r?\n/g, ' ⏎ ').replace(/\s+$/, '');

// ——————————————————————————————————————————————————————————
// 默认规则表（部署时 规则.json 可整体覆盖；首匹配优先，无匹配落兜底）
// ——————————————————————————————————————————————————————————
const 默认远端 = { 启用: true, 间隔毫秒: 300000, 超时毫秒: 60000, 仓清单: [默认远端仓] };
const 默认规则表 = {
  轮询毫秒: 1000,
  心跳: { 地址: 默认心跳地址, 间隔毫秒: 300000, 超时毫秒: 5000, 连续失败阈值: 2 },
  远端: 默认远端,
  规则: [
    // 远端三条摆最前：信源=远端，与其余信源互不干扰；「信道文书」必须先于「新提交」命中
    { 名: '远端信道文书', 信源: '远端', 正则: '信道文书', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] },
    { 名: '远端分支变动', 信源: '远端', 正则: '新分支|删分支', 级别: '常', 动作: ['记流水', '记未读'] },
    { 名: '远端新提交', 信源: '远端', 正则: '新提交', 级别: '常', 动作: ['记流水', '记未读'] },
    { 名: '急件', 信源: '信箱', 正则: '级别=急', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] },
    { 名: '三振上呈', 信源: '*', 正则: '三振|上呈|待裁|代核不过', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] },
    { 名: '监制台失联', 信源: '心跳', 正则: '失联', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] },
    { 名: '监制台恢复', 信源: '心跳', 正则: '恢复', 级别: '常', 动作: ['记流水', '记未读'] },
    { 名: '告警', 信源: '*', 正则: '告警|熔断|停摆|超时|额度|不过|拦截', 级别: '常', 动作: ['记流水', '记未读'] },
    { 名: '待审待验收', 信源: '信箱', 正则: '待审|待验收|待定夺', 级别: '常', 动作: ['记流水', '记未读'] },
    { 名: '完成', 信源: '*', 正则: '验收.*通过|执行完成|QA 通过|交产出|定稿', 级别: '常', 动作: ['记流水', '记未读'] },
    { 名: '失败', 信源: '*', 正则: '失败|异常|报错|退出码', 级别: '常', 动作: ['记流水', '记未读'] },
    { 名: '兜底', 信源: '*', 正则: '.', 级别: '常', 动作: ['记流水'] },
  ],
  时钟: [
    { 名: '晨报', 定点: '09:03', 文本: '晨报窗口到点（H58 班次制）', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] },
    { 名: '晚报', 定点: '23:26', 文本: '晚报窗口到点（H70a/H76）', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] },
    { 名: '切夜班', 定点: '00:00', 文本: '切夜班（H58/H70）', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] },
  ],
};
const 兜底规则 = { 名: '兜底', 级别: '常', 动作: ['记流水'] };

// ——————————————————————————————————————————————————————————
// 规则匹配：按表序首匹配优先。信源不合跳过；坏正则跳过不炸（登记进警告）。
// 时钟规则自带触发条件，不参与文本匹配。
// ——————————————————————————————————————————————————————————
// 引号内是**别人的题目**，不是本条事件的性质（2026-08-21 实测）。
// 案源：待办「代裁策略：**上呈**项全为总监代跑…」——光是被重排一次，就因为标题里有「上呈」
// 二字被规则 6（/三振|上呈|待裁|代核不过/，信源=*）判成急件、弹通知、进未读账本。
// 一条排期动作冒充成一次三振上呈。同族实测：三振上呈 2/14、告警 11/488 属此类。
// 量不大（1300 条积压里 13 条），但它是**假急件**——比多几行噪声更坏，因为它教人不信急件。
// 治法：匹配前把成对引号里的内容摘掉再试。摘的是 「」『』"" 三种成对号，且限长 120 字
// （太长的多半不是标题而是正文，摘了会伤真事件）。
// **摘完为空则回落原文**：整条就是一个标题时不能因此变成谁都不匹配。
const 题引 = /[「『"]([^」』"]{4,120})[」』"]/g;
function 去题(文本) {
  const s = String(文本 || '');
  const 去 = s.replace(题引, ' ');
  return 去.trim() ? 去 : s;
}

function 匹配规则(规则表, 信源, 文本, 警告) {
  const 表 = Array.isArray(规则表) ? 规则表 : [];
  const 净 = 去题(文本);
  for (const r of 表) {
    if (!r || r.停用) continue;
    const s = 取值(r.信源, '*');
    if (s === '时钟') continue;
    if (s !== '*' && s !== 信源) continue;
    let re;
    try { re = new RegExp(取值(r.正则, '.'), 'i'); }
    catch (e) { if (警告) 警告.push(`规则「${r.名 || '(无名)'}」正则非法，已跳过：${e.message}`); continue; }
    if (re.test(净)) return r;
  }
  return 兜底规则;
}

// —— 信源原始行 → 可匹配的规范文本 ——
const 流水行头 = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)\]\s?([\s\S]*)$/;
function 规范流水(行) {
  const m = 流水行头.exec(行);
  if (!m) return null;                                     // 续行（journal 里嵌过整篇报告）不单独成事件
  return { 原时刻: m[1], 文本: m[2] };
}
function 规范信箱(行) {
  let j;
  try { j = JSON.parse(行); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const 片 = [];
  if (j['级别']) 片.push(`级别=${j['级别']}`);
  if (j['类型']) 片.push(`类型=${j['类型']}`);
  if (j['摘要']) 片.push(`摘要=${j['摘要']}`);
  if (j['单号']) 片.push(`单号=${j['单号']}`);
  if (!片.length) 片.push(行);
  return { 原时刻: j.t || '', 文本: 片.join(' '), 级别: j['级别'] || '' };
}

// ——————————————————————————————————————————————————————————
// 尾随器（tail）：按字节位读增量，Buffer 攒余量——
//   ① 半行不吐（下轮补齐再吐）；② UTF-8 多字节被切开不乱码；
//   ③ 文件变小 = 截断/换档，位置归零重来；④ 换文件（月切）由调用方给新路径。
// ——————————————————————————————————————————————————————————
function 新尾随(初始) {
  return { 路径: (初始 && 初始.路径) || null, 位置: Number(初始 && 初始.位置) || 0, 余: Buffer.alloc(0), 缺席已报: false };
}
function 尾随读(t, 路径, 选项) {
  const o = 选项 || {};
  const 说明 = [];
  if (路径 !== t.路径) {
    // 换档：月切走「新月从头读」；冷启走「从文件尾」（不回放上百万字历史）
    t.路径 = 路径;
    t.余 = Buffer.alloc(0);
    if (o.换档从头) t.位置 = 0;
    else { let sz = 0; try { sz = fs.statSync(路径).size; } catch { sz = 0; } t.位置 = o.从头 ? 0 : sz; }
    说明.push(`换档→${path.basename(路径)}（起点 ${t.位置}）`);
  }
  let st = null;
  try { st = fs.statSync(路径); } catch { /* 文件还没生出来 */ }
  if (!st || !st.isFile()) {
    if (!t.缺席已报) { t.缺席已报 = true; 说明.push(`文件缺席：${路径}`); }
    return { 行: [], 说明 };
  }
  if (t.缺席已报) { t.缺席已报 = false; 说明.push(`文件到位：${path.basename(路径)}`); }
  if (st.size < t.位置) { t.位置 = 0; t.余 = Buffer.alloc(0); 说明.push('文件截断，位置归零重读'); }
  if (st.size > t.位置) {
    let fd = null;
    try {
      fd = fs.openSync(路径, 'r');
      const 长 = st.size - t.位置;
      const b = Buffer.alloc(长);
      const n = fs.readSync(fd, b, 0, 长, t.位置);
      t.位置 += n;
      t.余 = Buffer.concat([t.余, b.slice(0, n)]);
    } catch (e) { 说明.push(`读取失败：${e.message}`); }
    finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* 已关 */ } } }
  }
  const 行 = [];
  let i;
  while ((i = t.余.indexOf(0x0A)) >= 0) {
    let seg = t.余.slice(0, i);
    if (seg.length && seg[seg.length - 1] === 0x0D) seg = seg.slice(0, seg.length - 1);
    t.余 = t.余.slice(i + 1);
    const s = seg.toString('utf8');
    if (s.trim()) 行.push(s);
  }
  if (t.余.length > 余量上限) { 说明.push(`未完行超 ${余量上限} 字节，丢弃余量`); t.余 = Buffer.alloc(0); }
  return { 行, 说明 };
}

// ——————————————————————————————————————————————————————————
// 心跳判定（纯函数，可单测）：连续失败达阈值报一次失联，恢复报一次恢复，中间不重复刷屏
// ——————————————————————————————————————————————————————————
function 心跳判定(状态, 通) {
  if (通) {
    const 需报恢复 = !!状态.已报失联;
    状态.连续失败 = 0;
    状态.已报失联 = false;
    return 需报恢复 ? '监制台恢复' : null;
  }
  状态.连续失败 = (状态.连续失败 || 0) + 1;
  if (状态.连续失败 >= (状态.阈值 || 2) && !状态.已报失联) { 状态.已报失联 = true; return '监制台失联'; }
  return null;
}

// ——————————————————————————————————————————————————————————
// 信源⑤远端：只 fetch 侦察，绝不 pull/merge/push；git fetch 只写 .git/refs，工作区零改动。
// 下面几个是纯函数（可单测），真正起 git 进程的部分在 守望() 里。
// ——————————————————————————————————————————————————————————
const 远端短名 = (ref) => String(ref || '').replace(/^refs\/remotes\//, '');
const 短sha = (s) => String(s || '').slice(0, 7);

// `git for-each-ref --format=%(objectname) %(refname) refs/remotes` 的输出 → { ref: sha }
// origin/HEAD 是符号引用（跟着默认分支飘），不算分支，滤掉免得误报「新分支/删分支」。
function 解析远端refs(文本) {
  const 出 = {};
  for (const 行 of String(文本 || '').split(/\r?\n/)) {
    const m = /^([0-9a-f]{7,40})\s+(refs\/remotes\/\S+)$/i.exec(行.trim());
    if (!m) continue;
    if (/\/HEAD$/.test(m[2])) continue;
    出[m[2]] = m[1];
  }
  return 出;
}

// 「信道文书」= docs/ 下、路径里带 交接 / 回执 / 信道 的 md（子目录名或文件名带都算）
function 是信道文书(路径) {
  const s = String(路径 || '').replace(/\\/g, '/');
  if (!/\.md$/i.test(s)) return false;
  const m = /(?:^|\/)docs\/(.+)$/i.exec(s);
  if (!m) return false;
  return /交接|回执|信道/.test(m[1]);
}

// 上轮快照 vs 本轮快照 → 三类差异（键排序输出，事件顺序稳定可测）
function 比对远端(旧, 新) {
  const a = (旧 && typeof 旧 === 'object') ? 旧 : {};
  const b = (新 && typeof 新 === 'object') ? 新 : {};
  const 新提交 = []; const 新分支 = []; const 删分支 = [];
  for (const k of Object.keys(b).sort()) {
    if (!Object.prototype.hasOwnProperty.call(a, k)) 新分支.push({ ref: k, 新: b[k] });
    else if (a[k] !== b[k]) 新提交.push({ ref: k, 旧: a[k], 新: b[k] });
  }
  for (const k of Object.keys(a).sort()) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) 删分支.push({ ref: k, 旧: a[k] });
  }
  return { 新提交, 新分支, 删分支 };
}

// 差异 + 每个 ref 触及的文件表 → 事件（一 ref 一事件；带信道文书的整条升格标「信道文书」，
// 不再另发一条新提交——同一件事发两遍等于刷屏）
function 远端事件(仓名, 差异, 文件表) {
  const 表 = 文件表 || {};
  const 文书 = (ref) => (Array.isArray(表[ref]) ? 表[ref] : []).filter(是信道文书);
  const 出 = [];
  for (const it of (差异.新分支 || [])) {
    const d = 文书(it.ref);
    出.push({
      种类: d.length ? '信道文书' : '新分支',
      ref: it.ref,
      文本: d.length
        ? `信道文书 ${仓名} ${远端短名(it.ref)}（新分支 ${短sha(it.新)}）触及 ${d.join('、')}`
        : `新分支 ${仓名} ${远端短名(it.ref)}（${短sha(it.新)}）`,
    });
  }
  for (const it of (差异.新提交 || [])) {
    const d = 文书(it.ref);
    出.push({
      种类: d.length ? '信道文书' : '新提交',
      ref: it.ref,
      文本: d.length
        ? `信道文书 ${仓名} ${远端短名(it.ref)} ${短sha(it.旧)}..${短sha(it.新)} 触及 ${d.join('、')}`
        : `新提交 ${仓名} ${远端短名(it.ref)} ${短sha(it.旧)}..${短sha(it.新)}`,
    });
  }
  for (const it of (差异.删分支 || [])) {
    出.push({ 种类: '删分支', ref: it.ref, 文本: `删分支 ${仓名} ${远端短名(it.ref)}（原 ${短sha(it.旧)}）` });
  }
  return 出;
}

// 目录是不是个能 fetch 的 git 仓（工作仓看 .git，bare 仓看 HEAD + refs）
function 是git仓(p) {
  try {
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) return false;
    if (fs.existsSync(path.join(p, '.git'))) return true;
    return fs.existsSync(path.join(p, 'HEAD')) && fs.existsSync(path.join(p, 'refs'));
  } catch { return false; }
}

// 跑一条 git 子命令（异步、带超时）。两处坑各钉一颗钉：
//   core.quotepath=false —— 默认 git 会把非 ASCII 路径转义成 "docs/\344\272\244..."，
//     信道文书全是中文名，不关这个开关一个都认不出来（实测定谳：施工令-023 首轮 5 例挂在这）；
//   GIT_TERMINAL_PROMPT=0 —— 认证失败直接退，不然网络一断就卡在凭据交互上，守护整条腿被拖住。
function 跑git(仓, 参数, 超时毫秒, 完成) {
  let 收 = false; let child = null;
  const 收线 = (码, 出) => { if (收) return; 收 = true; clearTimeout(闸); 完成(码, 出); };
  const 闸 = setTimeout(() => { try { child && child.kill(); } catch { /* 已死 */ } 收线(-1, `git 超时 ${超时毫秒}ms`); },
    Math.max(1000, Number(超时毫秒) || 60000));
  try {
    child = spawn('git', ['-c', 'core.quotepath=false', '-C', 仓].concat(参数), {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' }),
    });
  } catch (e) { return 收线(-1, 'git 起不来：' + (e && e.message)); }
  let so = ''; let se = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', (d) => { so += d; });
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (d) => { se += d; });
  child.on('error', (e) => 收线(-1, 'git 异常：' + (e && e.message)));
  child.on('close', (码) => 收线(码, 码 === 0 ? so : (se || so)));
}

// ——————————————————————————————————————————————————————————
// 时钟到点（纯函数）：当天当点只放一次；晚于定点超过补报窗（默认 5min）不补
// ——————————————————————————————————————————————————————————
function 时钟到点(规则, 此刻, 已触发) {
  const m = /^(\d{1,2})\s*[:：]\s*(\d{2})$/.exec(String((规则 && 规则.定点) || ''));
  if (!m) return false;
  const hh = Number(m[1]); const mm = Number(m[2]);
  if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return false;
  const 键 = `${日期串(此刻)} ${pad(hh)}:${pad(mm)}`;
  const 名 = 规则.名 || 规则.定点;
  if (已触发.get(名) === 键) return false;
  const 现分 = 此刻.getHours() * 60 + 此刻.getMinutes();
  const 定分 = hh * 60 + mm;
  if (现分 < 定分) return false;
  const 窗 = Number.isFinite(Number(规则.补报分)) ? Number(规则.补报分) : 5;
  if (现分 - 定分 > 窗) { 已触发.set(名, 键); return false; }   // 记账但不报，防重启回放整天
  已触发.set(名, 键);
  return true;
}

// ——————————————————————————————————————————————————————————
// 账本：未读账本.jsonl 只追加；已读线放 账本水位.json（与守护并发写不打架）
// ——————————————————————————————————————————————————————————
function 读水位(水位路径) {
  try { const j = JSON.parse(fs.readFileSync(水位路径, 'utf8')); return String(j['至'] || ''); } catch { return ''; }
}
function 写水位(水位路径, 至) {
  写文件原子(水位路径, JSON.stringify({ 至, 更新于: 时刻串(现在()) }, null, 2));
}
function 读账本(账本路径) {
  let 原文 = '';
  try { 原文 = fs.readFileSync(账本路径, 'utf8'); } catch { return []; }
  const 出 = [];
  for (const 行 of 原文.split('\n')) {
    const s = 行.trim();
    if (!s) continue;
    try { 出.push(JSON.parse(s)); } catch { /* 半行/脏行丢弃，不让一行毒死整本 */ }
  }
  return 出;
}
const 未读筛 = (条目, 水位) => 条目.filter((e) => e && String(e.t || '') > String(水位 || ''));
function 追加账本(账本路径, 条目) {
  fs.mkdirSync(path.dirname(账本路径), { recursive: true });
  fs.appendFileSync(账本路径, JSON.stringify(条目) + '\n', 'utf8');
}
function 写文件原子(p, 内容) {
  // 写 → **fsync** → 改名。原子改名只保证「要么旧要么新」，保证不了「新的那份真在盘上」：
  // 2026-08-21 查实项管台账被断电写成 21918 字节全 NUL（大小正好等于坏前那版），
  // 病根就是 writeFileSync 只交页缓存不落盘。本塔的水位/游标同形制，一并补上。
  // 本包不引 apps/studio 的共用件（跨包依赖），故就地实现——三行，不值得为它建依赖。
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp' + process.pid;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, 内容, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, p);
}

// ——————————————————————————————————————————————————————————
// 心跳戳（施工令-024）：守护在岗的活体信号——每 30s 把 ISO 时刻覆盖写 <出口>/心跳.txt（一行）。
// 监制台在岗灯（另单）拿它当数据源：文件新鲜 = 守护活着；断更 = 守护下岗/僵死。
// ——————————————————————————————————————————————————————————
const 默认心跳戳间隔 = 30000;
function 写心跳戳(路径, 此刻) {
  try {
    fs.mkdirSync(path.dirname(路径), { recursive: true });
    fs.writeFileSync(路径, new Date(此刻).toISOString(), 'utf8');   // 覆盖写，仅一行 ISO 时刻
    return true;
  } catch { return false; }
}
function 读心跳戳(路径) {
  let 原文;
  try { 原文 = fs.readFileSync(路径, 'utf8'); } catch { return null; }     // 文件不存在/读不动
  const s = String(原文).trim();
  const t = new Date(s);
  if (!s || isNaN(t.getTime())) return { 时刻: s || null, 有效: false };
  return { 时刻: s, 有效: true, 毫秒龄: Date.now() - t.getTime() };
}

// ——————————————————————————————————————————————————————————
// pid 互斥
// ——————————————————————————————————————————————————————————
function 进程还活着(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return false;
  let 存在 = false;
  try { process.kill(Number(pid), 0); 存在 = true; }
  catch (e) { 存在 = (e && e.code === 'EPERM'); }
  if (!存在) return false;
  if (process.platform !== 'win32') return true;
  // 防 pid 复用误判：确认那个 pid 确实是 node
  try {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true });
    const s = String((r && r.stdout) || '');
    if (!s.trim() || /没有|No tasks/i.test(s)) return false;
    return /node\.exe/i.test(s);
  } catch { return true; }
}
function 读pid(pid路径) { try { return JSON.parse(fs.readFileSync(pid路径, 'utf8')); } catch { return null; } }

// ——————————————————————————————————————————————————————————
// 通知：BurntToast → 气泡通知（System.Windows.Forms 原生）→ msg → 落文件（永不炸）
// 中文一律走 UTF-8 BOM 的 ps1 文件，不走 argv（argv 中文会被 Windows 命令行编码吃掉）
// ——————————————————————————————————————————————————————————
const ps引号 = (s) => "'" + String(s === undefined || s === null ? '' : s).replace(/'/g, "''").replace(/[\r\n]+/g, ' ') + "'";
// ps1 回吐的通道名一律 ASCII——powershell stdout 走控制台代码页（本机 936），
// 中文回吐到 node 会成乱码进流水，故 ASCII 出、node 侧映射成人话。
const 通道人话 = { BurntToast: 'BurntToast', Balloon: '气泡通知', msg: 'msg 广播' };
function 通知脚本(标题, 正文) {
  const T = ps引号(标题); const B = ps引号(正文);
  return [
    '$ErrorActionPreference = "Stop"',
    '$ok = ""',
    `$t = ${T}`,
    `$b = ${B}`,
    'try { Import-Module BurntToast -ErrorAction Stop; New-BurntToastNotification -Text $t, $b -ErrorAction Stop; $ok = "BurntToast" } catch { }',
    'if (-not $ok) {',
    '  try {',
    '    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop',
    '    Add-Type -AssemblyName System.Drawing -ErrorAction Stop',
    '    $n = New-Object System.Windows.Forms.NotifyIcon',
    '    $n.Icon = [System.Drawing.SystemIcons]::Information',
    '    $n.Visible = $true',
    '    $n.BalloonTipTitle = $t',
    '    $n.BalloonTipText = $b',
    '    $n.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning',
    '    $n.ShowBalloonTip(15000)',
    '    Start-Sleep -Seconds 6',
    '    $n.Visible = $false',
    '    $n.Dispose()',
    '    $ok = "Balloon"',
    '  } catch { }',
    '}',
    'if (-not $ok) {',
    '  try { $line = "$t`n$b"; msg * /TIME:60 $line; if ($LASTEXITCODE -eq 0) { $ok = "msg" } } catch { }',
    '}',
    'Write-Output $ok',
  ].join('\n');
}
function 发通知(标题, 正文, 回落文件, 完成) {
  const done = typeof 完成 === 'function' ? 完成 : () => {};
  const 落文件 = (因) => {
    try {
      fs.mkdirSync(path.dirname(回落文件), { recursive: true });
      fs.appendFileSync(回落文件, `[${时刻串(现在())}] ${单行(标题)} | ${单行(正文)}${因 ? `（通道回落：${因}）` : ''}\n`, 'utf8');
    } catch { /* 连回落都写不动也不能炸守护 */ }
    done('落文件');
  };
  if (process.env.WATCHTOWER_TOAST_FILE_ONLY === '1') return 落文件('实测强制落文件');
  let ps1 = null;
  try {
    ps1 = path.join(os.tmpdir(), `wt-toast-${process.pid}-${Date.now()}.ps1`);
    fs.writeFileSync(ps1, '\uFEFF' + 通知脚本(标题, 正文), 'utf8');       // BOM：PS 5.1 靠它认 UTF-8
  } catch (e) { return 落文件('临时脚本写不出：' + e.message); }
  const 清理 = () => { try { fs.unlinkSync(ps1); } catch { /* 已清 */ } };
  let 收 = false;
  let child;
  const 收线 = (通道, 因) => {
    if (收) return; 收 = true;
    clearTimeout(闸);
    清理();
    if (通道) done(通道); else 落文件(因);
  };
  const 闸 = setTimeout(() => { try { child && child.kill(); } catch { /* 已死 */ } 收线(null, '通知进程超时 25s'); }, 25000);
  try {
    child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { return 收线(null, 'powershell 起不来：' + e.message); }
  let so = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { so += d; });
  child.stderr.on('data', () => { /* PS 噪声不入流水 */ });
  child.on('error', (e) => 收线(null, 'powershell 异常：' + (e && e.message)));
  child.on('close', () => {
    const 记 = (so.trim().split(/\r?\n/).filter(Boolean).pop() || '').trim();
    const 通道 = 通道人话[记] || (记 ? `未知通道(${记.replace(/[^\x20-\x7E]/g, '?')})` : '');
    if (通道) 收线(通道); else 收线(null, '三档通道全不可用');
  });
}

// ——————————————————————————————————————————————————————————
// 计划任务注册（登录即启，工作目录=部署区）
// schtasks /Create /XML 要求 UTF-16 文件；WorkingDirectory 只有 XML 路子能设。
// 默认再垫一层 .vbs 无窗启动器，免得每次登录弹黑框；--no-vbs 直挂 node.exe。
// ——————————————————————————————————————————————————————————
const xml转义 = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const 当前用户 = () => `${process.env.USERDOMAIN || process.env.COMPUTERNAME || '.'}\\${process.env.USERNAME || ''}`;
function 任务XML(命令, 参数, 工作目录, 用户) {
  const u = 用户 || 当前用户();
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo><Description>瞭望塔 · 统一监视守护（施工令-018）</Description></RegistrationInfo>',
    `  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml转义(u)}</UserId></LogonTrigger></Triggers>`,
    `  <Principals><Principal id="Author"><UserId>${xml转义(u)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    '    <RunOnlyIfIdle>false</RunOnlyIfIdle>',
    '    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>',
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>7</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${xml转义(命令)}</Command>`,
    `      <Arguments>${xml转义(参数)}</Arguments>`,
    `      <WorkingDirectory>${xml转义(工作目录)}</WorkingDirectory>`,
    '    </Exec>',
    '  </Actions>',
    '</Task>',
  ].join('\r\n');
}
function 写UTF16(p, 文本) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from('\uFEFF' + 文本, 'utf16le'));
}
const win = (p) => String(p).replace(/\//g, '\\');

// schtasks 输出走控制台 OEM 代码页（本机 936），直接 encoding:'utf8' 收会得到一串乱码，
// 排障时等于没有错误信息——故一律套 chcp 65001 的 shell 跑，拿可读文本。
function 跑(命令行) {
  const r = spawnSync(`chcp 65001 >nul & ${命令行}`, { shell: true, encoding: 'utf8', windowsHide: true });
  return { 码: r.status, 出: String((r.stdout || '') + (r.stderr || '')).replace(/\r/g, '').trim() };
}
const 任务名合法 = (s) => /^[^"&|<>%^\r\n]{1,200}$/.test(String(s));
const 拒绝访问 = (s) => /Access is denied|拒绝访问/i.test(String(s));
const 提权提示 = '任务计划根目录不允许普通完整性进程建任务。请在【以管理员身份运行】的 PowerShell 里重跑这条 --install（本进程无法自提权）。';

// XML 只送进任务计划服务做 schema 校验，不注册（--install --dry 用）
function 校验XML(xml路径) {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    '  $s = New-Object -ComObject Schedule.Service',
    '  $s.Connect()',
    '  $t = $s.NewTask(0)',
    `  $t.XmlText = [IO.File]::ReadAllText('${String(xml路径).replace(/'/g, "''")}', [Text.Encoding]::Unicode)`,
    '  Write-Output ("VALID|" + $t.Actions.Count + "|" + $t.Triggers.Count + "|" + $t.Principal.LogonType)',
    '} catch { Write-Output ("INVALID|" + $_.Exception.Message) }',
  ].join('\n');
  const f = path.join(os.tmpdir(), `wt-xmlcheck-${Date.now()}.ps1`);
  try { fs.writeFileSync(f, '﻿' + ps, 'utf8'); } catch (e) { return { ok: false, 说明: '校验脚本写不出：' + e.message }; }
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8', windowsHide: true });
  try { fs.unlinkSync(f); } catch { /* 已清 */ }
  const 出 = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  const 片 = 出.split('|');
  if (片[0] === 'VALID') return { ok: true, 动作数: Number(片[1]), 触发器数: Number(片[2]), 登录类型: Number(片[3]) };
  return { ok: false, 说明: 片.slice(1).join('|') || '任务计划服务未给结论' };
}

function 装(环境, 参数) {
  if (process.platform !== 'win32') return { ok: false, error: '计划任务只在 Windows 上支持' };
  const 任务名 = 取值(参数['task-name'], 默认任务名);
  if (!任务名合法(任务名)) return { ok: false, error: `--task-name 含命令行元字符，拒绝：${任务名}` };
  const 脚本 = win(path.resolve(__filename));
  const 根 = win(环境.根);
  const node = win(process.execPath);
  const 启动参数 = `"${脚本}" --root "${根}"`;
  let 命令 = node; let 命令参数 = 启动参数; let vbs = null;
  if (!参数['no-vbs']) {
    try {
      vbs = path.join(环境.出口, '启动.vbs');
      写UTF16(vbs, [
        "' 瞭望塔无窗启动器（--install 自动生成，--uninstall 自动清除）",
        'Set s = CreateObject("WScript.Shell")',
        `s.CurrentDirectory = "${win(根)}"`,
        `s.Run """${node}"" ${启动参数.replace(/"/g, '""')}", 0, False`,
      ].join('\r\n'));
      命令 = win(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe'));
      命令参数 = `"${win(vbs)}"`;
    } catch (e) { vbs = null; 命令 = node; 命令参数 = 启动参数; }
  }
  const xml = path.join(os.tmpdir(), `瞭望塔-任务-${Date.now()}.xml`);
  try { 写UTF16(xml, 任务XML(命令, 命令参数, 根)); }
  catch (e) { return { ok: false, error: '任务 XML 写不出：' + e.message }; }

  // --dry：只把 XML 送任务计划服务做 schema 校验，不注册（无权注册的环境里先验形）
  if (参数.dry) {
    const v = 校验XML(xml);
    const 存 = path.join(环境.出口, '计划任务.xml');
    try { 写UTF16(存, 任务XML(命令, 命令参数, 根)); } catch { /* 存不下不影响结论 */ }
    try { fs.unlinkSync(xml); } catch { /* 已清 */ }
    return v.ok
      ? { ok: true, dry: true, 任务名, XML校验: '通过（任务计划服务已接受）', 动作数: v.动作数, 触发器数: v.触发器数, 命令, 参数: 命令参数, 工作目录: 根, XML留档: win(存), 注册命令: `schtasks /Create /TN "${任务名}" /XML "${win(存)}" /F` }
      : { ok: false, dry: true, 任务名, error: 'XML 校验不过：' + v.说明 };
  }

  const r = 跑(`schtasks /Create /TN "${任务名}" /XML "${win(xml)}" /F`);
  try { fs.unlinkSync(xml); } catch { /* 已清 */ }
  if (r.码 !== 0) {
    return { ok: false, error: `schtasks 注册失败（退出码 ${r.码}）：${scrub(r.出)}`, ...(拒绝访问(r.出) ? { 处方: 提权提示 } : {}) };
  }
  return { ok: true, 任务名, 命令, 参数: 命令参数, 工作目录: 根, vbs: vbs ? win(vbs) : null, schtasks: scrub(r.出) };
}
function 卸(环境, 参数) {
  if (process.platform !== 'win32') return { ok: false, error: '计划任务只在 Windows 上支持' };
  const 任务名 = 取值(参数['task-name'], 默认任务名);
  if (!任务名合法(任务名)) return { ok: false, error: `--task-name 含命令行元字符，拒绝：${任务名}` };
  const r = 跑(`schtasks /Delete /TN "${任务名}" /F`);
  let vbs删 = false;
  try { const v = path.join(环境.出口, '启动.vbs'); if (fs.existsSync(v)) { fs.unlinkSync(v); vbs删 = true; } } catch { /* 留着无害 */ }
  try { const x = path.join(环境.出口, '计划任务.xml'); if (fs.existsSync(x)) fs.unlinkSync(x); } catch { /* 留着无害 */ }
  if (r.码 !== 0) {
    return { ok: false, 任务名, 已删vbs: vbs删, error: `schtasks 反注册失败（退出码 ${r.码}）：${scrub(r.出)}`, ...(拒绝访问(r.出) ? { 处方: 提权提示 } : {}) };
  }
  return { ok: true, 任务名, 已删vbs: vbs删, schtasks: scrub(r.出) };
}

// ——————————————————————————————————————————————————————————
// 环境组装：CLI > 瞭望塔.config.json > 默认
// ——————————————————————————————————————————————————————————
function 载JSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function 组装环境(参数) {
  const 警告 = [];
  const 配置候选 = [];
  if (取值(参数.config)) 配置候选.push(path.resolve(参数.config));
  配置候选.push(path.join(__dirname, '瞭望塔.config.json'));
  配置候选.push(path.resolve(process.cwd(), '瞭望塔.config.json'));
  let 配置 = {}; let 配置来源 = '（内置默认）';
  for (const c of 配置候选) {
    if (!fs.existsSync(c)) continue;
    const j = 载JSON(c);
    if (j) { 配置 = j; 配置来源 = c; break; }
    警告.push(`配置文件解析失败，已忽略：${c}`);
  }
  const 根 = path.resolve(取值(参数.root, 取值(配置['部署区'], 默认部署区)));
  const 出口 = path.resolve(取值(参数.out, 取值(配置['输出目录'], path.join(根, '瞭望塔'))));
  const 规则路径 = path.resolve(取值(参数.rules, 取值(配置['规则表'], (() => {
    const 部署侧 = path.join(出口, '规则.json');
    return fs.existsSync(部署侧) ? 部署侧 : path.join(__dirname, '规则.json');
  })())));
  return {
    根,
    出口,
    规则路径,
    配置来源,
    配置,
    流水目录: path.join(根, 'journal'),
    信箱: path.join(根, '呼叫', 'inbox.jsonl'),
    流水: path.join(出口, '瞭望塔流水.log'),
    账本: path.join(出口, '未读账本.jsonl'),
    水位: path.join(出口, '账本水位.json'),
    游标: path.join(出口, '游标.json'),
    远端游标: path.join(出口, '远端游标.json'),
    心跳戳: path.join(出口, '心跳.txt'),
    pid: path.join(出口, 'watchtower.pid'),
    通知回落: path.join(出口, '通知回落.log'),
    警告,
  };
}
function 载规则(环境) {
  const 警告 = [];
  let 表 = null;
  if (fs.existsSync(环境.规则路径)) {
    表 = 载JSON(环境.规则路径);
    if (!表) 警告.push(`规则表解析失败，回落内置默认：${环境.规则路径}`);
  } else 警告.push(`规则表不存在，用内置默认：${环境.规则路径}`);
  const 基 = 表 || 默认规则表;
  const 心跳基 = Object.assign({}, 默认规则表.心跳, 基['心跳'] || {}, 环境.配置['心跳'] || {});
  const 远端基 = Object.assign({}, 默认远端, 基['远端'] || {}, 环境.配置['远端'] || {});
  const 单仓 = 远端基['仓清单'];
  远端基['仓清单'] = (typeof 单仓 === 'string' ? [单仓] : (Array.isArray(单仓) ? 单仓 : []))
    .map((s) => String(s || '').trim()).filter(Boolean);
  return {
    轮询毫秒: Math.max(200, Number(环境.配置['轮询毫秒'] || 基['轮询毫秒'] || 1000)),
    心跳: 心跳基,
    远端: 远端基,
    规则: Array.isArray(基['规则']) ? 基['规则'] : 默认规则表.规则,
    时钟: Array.isArray(基['时钟']) ? 基['时钟'] : 默认规则表.时钟,
    警告,
    mtime: (() => { try { return fs.statSync(环境.规则路径).mtimeMs; } catch { return 0; } })(),
  };
}

// ——————————————————————————————————————————————————————————
// 一行 JSON 收线（同 review.js 口径）
// ——————————————————————————————————————————————————————————
function 收(o) {
  const j = {};
  for (const [k, v] of Object.entries(o)) j[k] = (typeof v === 'string') ? scrub(v) : v;
  process.stdout.write(JSON.stringify(j) + '\n');
  process.exit(j.ok === false ? 1 : 0);
}
const 报 = (s) => process.stderr.write('[瞭望塔] ' + scrub(s) + '\n');

// ——————————————————————————————————————————————————————————
// 守护主体
// ——————————————————————————————————————————————————————————
function 守望(环境, 参数) {
  let 规则表 = 载规则(环境);
  const 规则警告 = [];
  fs.mkdirSync(环境.出口, { recursive: true });

  // —— pid 互斥 ——
  const 旧 = 读pid(环境.pid);
  if (旧 && 旧.pid && Number(旧.pid) !== process.pid && 进程还活着(旧.pid)) {
    return 收({ ok: false, error: `已有瞭望塔在岗（pid ${旧.pid}，起于 ${旧['起于'] || '?'}），本次不重复启动`, pid文件: 环境.pid });
  }
  if (旧 && 旧.pid) 报(`发现陈旧 pid 文件（pid ${旧.pid} 已不在），接管`);
  try { 写文件原子(环境.pid, JSON.stringify({ pid: process.pid, 起于: 时刻串(现在()), 根: 环境.根, 出口: 环境.出口 }, null, 2)); }
  catch (e) { return 收({ ok: false, error: 'pid 文件写不出：' + e.message }); }
  let 已退 = false;
  const 收摊 = (因) => {
    if (已退) return; 已退 = true;
    try { const cur = 读pid(环境.pid); if (cur && Number(cur.pid) === process.pid) fs.unlinkSync(环境.pid); } catch { /* 无妨 */ }
    // 若在游标变量初始化前就走到收摊（启动早期异常），这里会撞 TDZ——退出路径上不许再炸
    try { 存游标(); } catch { /* 游标没存上，下次冷启从文件尾续，不致命 */ }
    try { 存远端游标(); } catch { /* 同上 */ }
    // 死也要留痕（2026-08-22 体检 TF-V-12）：10 次上岗 0 次下岗——「塔没写」和「一切正常」
    // 在流水里长得一模一样，塔死了没人知道。报() 只走 stderr，而 启动.vbs 是隐藏窗口起的，
    // stderr 落进黑洞；必须落流水。appendFileSync 是同步的，'exit' 钩子里合法。
    // 口径注记：本行救不了 Windows 下的注销/硬杀（'exit' 不开火）——那一类只有心跳戳探得到。
    try { 记流水('守望', '急', '瞭望塔下岗', `pid ${process.pid} · 因 ${因 || 'exit'} · 部署区 ${环境.根}`); }
    catch { /* 退出路径上不许再炸 */ }
    if (因) 报(`收摊（${因}）`);
  };
  process.on('exit', () => 收摊(''));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    try { process.on(sig, () => { 收摊(sig); process.exit(0); }); } catch { /* 该平台没这信号 */ }
  }
  process.on('uncaughtException', (e) => { 记流水('守望', '急', '内部异常', '未捕获异常：' + (e && e.stack || e)); });
  process.on('unhandledRejection', (e) => { 记流水('守望', '急', '内部异常', '未处理拒绝：' + (e && e.stack || e)); });

  // —— 游标（重启续读，不漏不重）——
  const 游标 = 载JSON(环境.游标) || {};
  const 流水尾 = 新尾随({ 路径: 游标['流水'] && 游标['流水']['路径'], 位置: 游标['流水'] && 游标['流水']['位置'] });
  const 信箱尾 = 新尾随({ 路径: 游标['信箱'] && 游标['信箱']['路径'], 位置: 游标['信箱'] && 游标['信箱']['位置'] });
  let 游标脏 = false;
  function 存游标() {
    if (!游标脏) return;
    try {
      写文件原子(环境.游标, JSON.stringify({
        流水: { 路径: 流水尾.路径, 位置: 流水尾.位置 },
        信箱: { 路径: 信箱尾.路径, 位置: 信箱尾.位置 },
        存于: 时刻串(现在()),
      }, null, 2));
      游标脏 = false;
    } catch { /* 下轮再存 */ }
  }

  // —— 远端游标（每仓一份 refs 快照；重启不重报）——
  const 远端游标 = (() => { const j = 载JSON(环境.远端游标); return (j && typeof j['仓'] === 'object' && j['仓']) ? j['仓'] : {}; })();
  let 远端游标脏 = false;
  function 存远端游标() {
    if (!远端游标脏) return;
    try {
      写文件原子(环境.远端游标, JSON.stringify({ 仓: 远端游标, 存于: 时刻串(现在()) }, null, 2));
      远端游标脏 = false;
    } catch { /* 下轮再存 */ }
  }

  // —— 三条出口 ——
  function 记流水(信源, 级别, 规则名, 文本) {
    const 行 = `[${时刻串(现在())}] [${信源}] ${级别} ${规则名} | ${单行(文本)}\n`;
    try { fs.appendFileSync(环境.流水, 行, 'utf8'); } catch (e) { 报('流水写不动：' + e.message); }
    process.stderr.write(行);
  }
  let 通知窗口起 = 0; let 通知窗口数 = 0;
  function 弹(信源, 级别, 规则名, 文本) {
    const 现 = Date.now();
    if (现 - 通知窗口起 > 60000) { 通知窗口起 = 现; 通知窗口数 = 0; }
    通知窗口数++;
    if (通知窗口数 > 8) {                                   // 限流：一分钟最多 8 条，防事件风暴刷屏
      if (通知窗口数 === 9) 记流水('守望', '常', '通知限流', '一分钟内通知超 8 条，其余只入账本');
      return;
    }
    发通知(`瞭望塔 · ${规则名}`, `[${信源}] ${文本}`, 环境.通知回落, (通道) => {
      记流水('守望', '常', '通知已发', `通道=${通道} 规则=${规则名}`);
    });
  }
  function 派发(信源, 规则, 文本, 原时刻) {
    const 动作 = Array.isArray(规则.动作) ? 规则.动作 : ['记流水'];
    const 级别 = 取值(规则.级别, '常');
    const 名 = 取值(规则.名, '(无名)');
    if (动作.includes('记流水')) 记流水(信源, 级别, 名, 文本);
    if (动作.includes('记未读')) {
      try {
        追加账本(环境.账本, {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          t: new Date(现在()).toISOString(),
          信源, 级别, 规则: 名, 文本: 单行(文本), 原时刻: 原时刻 || '',
        });
      } catch (e) { 报('账本写不动：' + e.message); }
    }
    if (动作.includes('弹通知') && !参数['no-toast']) 弹(信源, 级别, 名, 文本);
  }

  // —— 心跳戳（施工令-024）：开机即戳一记，此后每 30s 覆盖写；写不动只留痕不炸守护 ——
  const 心跳戳间隔 = Math.max(200, Number(环境.配置['心跳戳间隔毫秒']) || 默认心跳戳间隔);
  let 心跳戳下次 = 0;                                      // 0 = 开机即写
  let 心跳戳已报障 = false;
  function 戳心跳() {
    if (Date.now() < 心跳戳下次) return;
    心跳戳下次 = Date.now() + 心跳戳间隔;
    if (写心跳戳(环境.心跳戳, 现在())) { 心跳戳已报障 = false; return; }
    if (!心跳戳已报障) { 心跳戳已报障 = true; 记流水('守望', '常', '心跳戳写不动', 环境.心跳戳); }
  }

  // —— 时钟/心跳状态 ——
  const 时钟已触发 = new Map();
  const 心跳态 = { 连续失败: 0, 已报失联: false, 阈值: Number(规则表.心跳['连续失败阈值']) || 2 };
  let 心跳下次 = 0;                                        // 0 = 开机即探一次
  let 心跳在途 = false;

  function 探心跳() {
    if (心跳在途) return;
    心跳在途 = true;
    const 地址 = 取值(规则表.心跳['地址'], 默认心跳地址);
    const 超时 = Number(规则表.心跳['超时毫秒']) || 5000;
    let 收线 = false;
    const 判 = (通, 因) => {
      if (收线) return; 收线 = true; 心跳在途 = false;
      const 结论 = 心跳判定(心跳态, 通);
      if (结论 === '监制台失联') {
        const 文本 = `监制台失联：${地址} 连续 ${心跳态.连续失败} 次不通（${因 || '?'}）`;
        派发('心跳', 匹配规则(规则表.规则, '心跳', 文本, 规则警告), 文本, '');
      } else if (结论 === '监制台恢复') {
        const 文本 = `监制台恢复：${地址} 已回 200`;
        派发('心跳', 匹配规则(规则表.规则, '心跳', 文本, 规则警告), 文本, '');
      }
    };
    let req;
    try {
      req = http.get(地址, { timeout: 超时 }, (res) => {
        res.resume();
        res.on('end', () => 判(res.statusCode === 200, `HTTP ${res.statusCode}`));
      });
    } catch (e) { return 判(false, '请求起不来：' + (e && e.message)); }
    req.on('timeout', () => { try { req.destroy(); } catch { /* 已断 */ } 判(false, `静默超时 ${超时}ms`); });
    req.on('error', (e) => 判(false, (e && e.code) || (e && e.message) || '连接失败'));
  }

  // —— 信源⑤远端 ——
  let 远端下次 = 0;                                        // 0 = 开机即侦察一次
  let 远端在途 = false;
  const 远端不通态 = new Map();                            // 仓 → 是否已报「暂歇」，只在状态翻转时留一行痕

  // 网络断/仓不在 = 跳过本轮，不当事件报（施工令-023 第 1 条「静默容错」）。
  // 但状态翻转各留一行守望级流水，方便事后查「什么时候断的、什么时候续上的」。
  function 远端暂歇(仓, 因) {
    if (远端不通态.get(仓)) return;
    远端不通态.set(仓, true);
    记流水('守望', '常', '远端暂歇', `${path.basename(仓)} fetch 不通，跳过本轮（${单行(因).slice(0, 200)}）`);
  }
  function 远端复通(仓) {
    if (!远端不通态.get(仓)) return;
    远端不通态.set(仓, false);
    记流水('守望', '常', '远端复通', `${path.basename(仓)} fetch 已恢复，续侦察`);
  }

  // 取某个 ref 本轮新提交触及的文件：已知旧点走两点 diff；全新分支只看分支顶端那次提交
  function 取触及文件(仓, 超时, 项, 是新分支, 完成) {
    const 参数 = 是新分支
      ? ['show', '--name-only', '--pretty=format:', 项.新]
      : ['diff', '--name-only', 项.旧, 项.新];
    跑git(仓, 参数, 超时, (码, 出) => {
      if (码 !== 0) return 完成([]);                        // 旧点被 gc 掉等情况：文件表算空，事件照发
      完成(String(出 || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  }

  function 扫一仓(仓, 超时, 完成) {
    if (!是git仓(仓)) { 远端暂歇(仓, '不是 git 仓或目录不存在'); return 完成(); }
    // 只 fetch，不 pull/merge——工作区一个字节不动
    跑git(仓, ['fetch', '--all', '--prune', '--quiet'], 超时, (码, 出) => {
      if (码 !== 0) { 远端暂歇(仓, 出); return 完成(); }
      远端复通(仓);
      跑git(仓, ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/remotes'], 超时, (码2, 出2) => {
        if (码2 !== 0) { 远端暂歇(仓, 出2); return 完成(); }
        const 新refs = 解析远端refs(出2);
        const 旧格 = 远端游标[仓];
        const 旧refs = (旧格 && typeof 旧格.refs === 'object') ? 旧格.refs : null;
        const 落账 = () => {
          远端游标[仓] = { refs: 新refs, 更新于: 时刻串(现在()) };
          远端游标脏 = true;
          存远端游标();
        };
        if (!旧refs) {                                     // 首见此仓：只立基线，不把满仓分支当「新分支」报一遍
          落账();
          记流水('守望', '常', '远端建基线', `${path.basename(仓)}：首轮快照 ${Object.keys(新refs).length} 个远端分支`);
          return 完成();
        }
        const 差 = 比对远端(旧refs, 新refs);
        const 待查 = (差.新分支 || []).map((it) => ({ 项: it, 新: true }))
          .concat((差.新提交 || []).map((it) => ({ 项: it, 新: false })));
        const 文件表 = {};
        const 下一个 = (i) => {
          if (i >= 待查.length) {
            const 事件们 = 远端事件(path.basename(仓), 差, 文件表);
            for (const ev of 事件们) 派发('远端', 匹配规则(规则表.规则, '远端', ev.文本, 规则警告), ev.文本, '');
            落账();                                         // 事件先落地再推游标，中途崩了下轮还会重算
            return 完成();
          }
          const it = 待查[i];
          取触及文件(仓, 超时, it.项, it.新, (files) => { 文件表[it.项.ref] = files; 下一个(i + 1); });
        };
        下一个(0);
      });
    });
  }

  function 巡远端() {
    if (远端在途) return;
    const 配 = 规则表.远端 || 默认远端;
    const 仓们 = Array.isArray(配['仓清单']) ? 配['仓清单'] : [];
    if (!仓们.length) return;
    const 超时 = Number(配['超时毫秒']) || 60000;
    远端在途 = true;
    const 走 = (i) => {
      if (i >= 仓们.length) { 远端在途 = false; return; }
      let 走过 = false;
      try { 扫一仓(path.resolve(仓们[i]), 超时, () => { if (走过) return; 走过 = true; 走(i + 1); }); }
      catch (e) { 报('远端侦察异常：' + (e && e.message)); if (!走过) { 走过 = true; 走(i + 1); } }
    };
    走(0);                                                 // 逐仓串行，别一口气拉起十个 git 进程
  }

  // —— 一轮 ——
  function 一轮() {
    // 心跳戳：先戳后干活——就算下面某信源堵住，本轮活体信号已留
    戳心跳();

    // 规则表热更（改了立刻生效，不用重启守护）
    try {
      const m = fs.statSync(环境.规则路径).mtimeMs;
      if (m !== 规则表.mtime) {
        const 新 = 载规则(环境);
        规则表 = 新;
        心跳态.阈值 = Number(新.心跳['连续失败阈值']) || 2;
        记流水('守望', '常', '规则表重载', `${环境.规则路径}（规则 ${新.规则.length} 条 / 时钟 ${新.时钟.length} 点）${新.警告.join('；')}`);
      }
    } catch { /* 规则表不在，继续用当前表 */ }

    // 信源①流水（月切自动跟随：换月从头读）
    const 目标 = path.join(环境.流水目录, 当月日志名(现在()));
    const 首挂流水 = !流水尾.路径;
    const r1 = 尾随读(流水尾, 目标, { 从头: !!参数['from-start'], 换档从头: !首挂流水 });
    if (!首挂流水 && r1.说明.some((s) => s.startsWith('换档'))) 记流水('守望', '常', '月切', `流水换档 → ${path.basename(目标)}`);
    for (const s of r1.说明) if (!s.startsWith('换档')) 记流水('守望', '常', '信源提示', `流水：${s}`);
    if (r1.行.length) 游标脏 = true;
    for (const 行 of r1.行) {
      const e = 规范流水(行);
      if (!e) continue;                                    // 续行不单独成事件
      派发('流水', 匹配规则(规则表.规则, '流水', e.文本, 规则警告), e.文本, e.原时刻);
    }

    // 信源②信箱（不换档，只在被截断/重建时归零）
    const r2 = 尾随读(信箱尾, 环境.信箱, { 从头: !!参数['from-start'] });
    for (const s of r2.说明) if (!s.startsWith('换档')) 记流水('守望', '常', '信源提示', `信箱：${s}`);
    if (r2.行.length) 游标脏 = true;
    for (const 行 of r2.行) {
      const e = 规范信箱(行);
      if (!e) { 记流水('信箱', '常', '脏行', `非 JSON 行已跳过：${行.slice(0, 200)}`); continue; }
      派发('信箱', 匹配规则(规则表.规则, '信箱', e.文本, 规则警告), e.文本, e.原时刻);
    }

    // 信源③时钟
    const 此刻 = 现在();
    for (const c of 规则表.时钟) {
      if (!c || c.停用) continue;
      if (!时钟到点(c, 此刻, 时钟已触发)) continue;
      const 文本 = `${取值(c.文本, c.名 || '定点')}（定点 ${c.定点}）`;
      派发('时钟', c, 文本, 时刻串(此刻));
    }

    // 信源④心跳
    if (Date.now() >= 心跳下次) {
      心跳下次 = Date.now() + (Number(规则表.心跳['间隔毫秒']) || 300000);
      探心跳();
    }

    // 信源⑤远端
    const 远端配 = 规则表.远端 || 默认远端;
    if (远端配['启用'] !== false && Date.now() >= 远端下次) {
      远端下次 = Date.now() + (Number(远端配['间隔毫秒']) || 300000);
      巡远端();
    }

    // 坏正则警告去重后入流水
    while (规则警告.length) 记流水('守望', '常', '规则告警', 规则警告.shift());
    存游标();
    存远端游标();
  }

  const 远端播报 = (规则表.远端 && 规则表.远端['启用'] !== false && (规则表.远端['仓清单'] || []).length)
    ? `${(规则表.远端['仓清单'] || []).length} 仓 / ${Number(规则表.远端['间隔毫秒']) || 300000}ms`
    : '停用';
  记流水('守望', '常', '瞭望塔上岗', `pid ${process.pid} · 部署区 ${环境.根} · 规则表 ${环境.规则路径} · 配置 ${环境.配置来源} · 轮询 ${规则表.轮询毫秒}ms · 远端 ${远端播报}`);
  for (const w of 环境.警告.concat(规则表.警告)) 记流水('守望', '常', '启动告警', w);

  // --once：跑一轮就走（实测用；留 1.5s 让心跳/通知的异步回调收线；远端 fetch 在途则多等，上限 30s）
  if (参数.once) {
    一轮();
    const 起 = Date.now();
    const 等收 = () => {
      if (远端在途 && Date.now() - 起 < 30000) return void setTimeout(等收, 200);
      setTimeout(() => { 收摊('--once'); process.exit(0); }, 1500);
    };
    等收();
    return;
  }
  一轮();
  setInterval(() => { try { 一轮(); } catch (e) { 报('轮询异常：' + (e && e.message)); } }, 规则表.轮询毫秒);
}

// ——————————————————————————————————————————————————————————
// 入口
// ——————————————————————————————————————————————————————————
function main(argv) {
  const 参数 = 解析参数(argv);
  const 环境 = 组装环境(参数);

  if (参数.help || 参数.h) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n') + '\n');
    return;
  }
  if (参数.install) return 收(装(环境, 参数));
  if (参数.uninstall) return 收(卸(环境, 参数));

  if (参数['toast-test']) {
    return 发通知('瞭望塔 · 通道自检', `这是一条测试通知（${时刻串(现在())}）`, 环境.通知回落, (通道) => {
      收({ ok: true, 通道, 回落文件: 环境.通知回落 });
    });
  }

  if (参数.ack !== undefined) {
    const 条目 = 读账本(环境.账本);
    let 至;
    const v = 参数.ack;
    if (v === true || v === 'all' || v === 'latest') {
      至 = 条目.length ? 条目.map((e) => String(e.t || '')).sort().pop() : new Date(现在()).toISOString();
    } else if (/^\d+$/.test(String(v))) 至 = new Date(Number(v)).toISOString();
    else {
      const d = new Date(String(v));
      if (isNaN(d.getTime())) return 收({ ok: false, error: `--ack 时间戳不认识：${v}（要 ISO 串 / 毫秒数 / all）` });
      至 = d.toISOString();
    }
    const 前未读 = 未读筛(条目, 读水位(环境.水位)).length;
    try { 写水位(环境.水位, 至); } catch (e) { return 收({ ok: false, error: '水位写不出：' + e.message }); }
    const 剩 = 未读筛(条目, 至);
    // 守护在岗时账本正被追加，压实会撞车——只前移水位，等它下岗再压
    const 在岗 = (() => { const p = 读pid(环境.pid); return !!(p && p.pid && 进程还活着(p.pid)); })();
    let 已压实 = false;
    if (!在岗 && 条目.length) {
      try { 写文件原子(环境.账本, 剩.map((e) => JSON.stringify(e)).join('\n') + (剩.length ? '\n' : '')); 已压实 = true; }
      catch { /* 压实失败无碍，水位已生效 */ }
    }
    return 收({ ok: true, 清账至: 至, 清账数: 前未读 - 剩.length, 剩余未读: 剩.length, 已压实, 守护在岗: 在岗 });
  }

  if (参数.unread) {
    const 水位 = 读水位(环境.水位);
    const 未读 = 未读筛(读账本(环境.账本), 水位);
    const n = Number(参数.limit) > 0 ? Number(参数.limit) : 20;
    process.stderr.write(未读.slice(-n).map((e) => `[${e.t}] [${e.信源}] ${e.级别} ${e.规则} | ${e.文本}`).join('\n') + (未读.length ? '\n' : ''));
    return 收({ ok: true, 未读: 未读.length, 水位: 水位 || '(未清过账)', 账本: 环境.账本 });
  }

  if (参数.status) {
    const p = 读pid(环境.pid);
    const 在岗 = !!(p && p.pid && 进程还活着(p.pid));
    return 收({
      ok: true, 在岗, pid: (p && p.pid) || null, 起于: (p && p['起于']) || null,
      部署区: 环境.根, 出口: 环境.出口, 规则表: 环境.规则路径, 配置来源: 环境.配置来源,
      未读: 未读筛(读账本(环境.账本), 读水位(环境.水位)).length,
      水位: 读水位(环境.水位) || '(未清过账)',
      心跳戳: (() => {                                     // 施工令-024：--status 增心跳段
        const h = 读心跳戳(环境.心跳戳);
        if (!h) return { 文件: 环境.心跳戳, 存在: false };
        if (!h.有效) return { 文件: 环境.心跳戳, 存在: true, 有效: false, 时刻: h.时刻 };
        return { 文件: 环境.心跳戳, 存在: true, 时刻: h.时刻, 秒龄: Math.round(h.毫秒龄 / 1000), 在跳: h.毫秒龄 <= 90000 };
      })(),
      游标: 载JSON(环境.游标) || null,
      远端: (() => {
        const 配 = 载规则(环境).远端;
        const j = 载JSON(环境.远端游标);
        const 仓 = (j && j['仓']) || {};
        return {
          启用: 配['启用'] !== false,
          间隔毫秒: Number(配['间隔毫秒']) || 300000,
          仓清单: 配['仓清单'],
          快照: Object.keys(仓).map((k) => ({ 仓: k, 分支数: Object.keys((仓[k] && 仓[k].refs) || {}).length, 更新于: (仓[k] && 仓[k]['更新于']) || '' })),
        };
      })(),
    });
  }

  if (!fs.existsSync(环境.根)) return 收({ ok: false, error: `部署工作区不存在：${环境.根}（用 --root 指，或写 瞭望塔.config.json）` });
  return 守望(环境, 参数);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = {
  main,                                                    // 供旧路径转发壳（施工令-024）直跑代点
  解析参数, 取值, scrub, 单行, 当月日志名, 日期串, 时刻串,
  匹配规则, 去题, 兜底规则, 默认规则表, 默认远端, 规范流水, 规范信箱,
  新尾随, 尾随读, 心跳判定, 时钟到点,
  写心跳戳, 读心跳戳, 默认心跳戳间隔,
  远端短名, 短sha, 解析远端refs, 是信道文书, 比对远端, 远端事件, 是git仓, 跑git,
  读账本, 追加账本, 未读筛, 读水位, 写水位, 写文件原子,
  组装环境, 载规则, 任务XML, 通知脚本, 进程还活着,
};
