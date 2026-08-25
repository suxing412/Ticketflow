#!/usr/bin/env node
// 值守在位.js — 会话侧瞭望塔的回执写口（TK-210 ②③ 的会话端接缝）。
//
// 值守会话那条只订阅「值守心跳」的 Monitor(persistent) 每被唤醒一次，
// 就跑一遍 watch-rearm 的动作序列（CronList + TaskList 与清单逐项比对 → 缺哪项补哪项 →
// 补完再 List 一次确认在册），然后调本脚本回执：
//
//   node scripts/值守在位.js --seq 42 --已挂 7
//   node scripts/值守在位.js --seq 42 --已挂 7 --补挂 流水关键事件监视,呼叫信箱监视
//
// 有补挂时 stdout 打一行窗口报文（照工单写死的格式），会话把它原样贴进窗口；
// 无补挂时**一个字都不打**——「有变更才报，无变更静默」是协议，不是实现细节。
// 退出码：0 成功；1 参数非法或写盘失败（会话侧据此判「回执没写上」，不许当成写上了）。
//
// 为什么是 node CLI 而不是 curl 打 HTTP：
//   ① 中文 payload 走 curl 内联是本仓根治过的坑（编码在 Windows 控制台一路失真）。本脚本
//      argv 只收数字与项名，项名走 --补挂 一个参数、内部不再转码，避开整片雷区。
//   ② 回执写的是盘上 state 文件，本来就不需要 server 在跑。塔活着而 server 正好在换装，
//      回执照样落盘——把回执绑在 HTTP 上等于给「看守者的看守者」加一个新的单点。
const path = require('path');
const wp = require('../lib/pm/watchpulse');

function 取参(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) { o[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { o[a.slice(2)] = true; continue; }
    o[a.slice(2)] = next; i++;
  }
  return o;
}

function 解析根(o) {
  if (o.root) return path.resolve(String(o.root));
  // 缺省走监制台自己的解析（与 server.js 同一把尺，别在这儿另发明一套寻径）
  return require('../lib/core/config').resolveRoot();
}

function main() {
  const o = 取参(process.argv);
  const root = 解析根(o);
  if (!root) { console.error('值守在位：数据根未就绪，回执无处可落'); return 1; }
  const 补挂 = String(o.补挂 || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  const r = wp.记在位(root, { seq: o.seq, 已挂: o.已挂, 补挂 });
  if (!r || !r.ok) { console.error('值守在位：' + ((r && r.因) || '写盘失败')); return 1; }
  if (r.窗口行) console.log(r.窗口行); // 有变更才报这一行
  return 0;
}

if (require.main === module) {
  let code = 1;
  try { code = main(); }
  catch (e) { console.error('值守在位异常：' + String((e && e.message) || e)); code = 1; }
  process.exit(code);
}

module.exports = { 取参 };
