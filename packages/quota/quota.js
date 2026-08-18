// quota.js — 额度快照的**解读**：窗口解析、百分比、label、重置时刻、守门判定。
// 施工令-059：本体自 apps/studio/lib/quota.js 迁来（应 robinwang2 请求），形制照 packages/budget。
//
// 本包只做「拿到快照之后」的那一半：**不发请求、不读文件、不碰进程**。
// 取数（codex app-server / claude OAuth usage / 节流 / 缓存）归调用方，见 README「不做什么」。
// 于是本包纯函数、零依赖、同输入恒同输出——studio 与 platform 两边共用同一份判定，不分叉。
'use strict';

// 重置时刻的人读形态。秒/毫秒时间戳与 ISO 串都吃；解不出就原样吐回，绝不编一个像样的时间。
function fmtReset(resetsAt) {
  if (resetsAt == null) return '未知';
  let d;
  if (typeof resetsAt === 'number') d = new Date(resetsAt * (resetsAt > 1e12 ? 1 : 1000));
  else d = new Date(resetsAt);
  if (isNaN(d.getTime())) return String(resetsAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 窗口自报的时长 → 人读 label（施工令-010 窗口正名：文案按真窗口说话，不写死「5小时」）。
function windowLabel(w) {
  if (!w || w.windowDurationMins == null) return '窗口';
  const mins = w.windowDurationMins;
  if (mins <= 360) return `${Math.round(mins / 60)}小时`;
  if (mins >= 9000) return '周';
  return `${mins}分钟`;
}

// 结构化窗口数据（label/pct/reset），供界面画进度条；text 版继续服务 CLI 与日志
function windowsOf(rl) {
  const out = [];
  if (!rl) return out;
  for (const key of ['primary', 'secondary']) {
    const w = rl[key];
    if (!w || w.usedPercent == null) continue;
    out.push({ label: windowLabel(w), pct: Math.round(w.usedPercent), reset: fmtReset(w.resetsAt) });
  }
  return out;
}

function claudeWindows(cu) {
  const out = [];
  if (!cu) return out;
  const push = (w, label) => { if (w && w.utilization != null) out.push({ label, pct: Math.round(w.utilization), reset: fmtReset(w.resets_at) }); };
  push(cu.fiveHour, '5小时');
  push(cu.sevenDay, '周');
  return out;
}

function describe(rl) {
  const parts = [];
  if (!rl) return parts;
  for (const key of ['primary', 'secondary']) {
    const w = rl[key];
    if (!w) continue;
    const pct = w.usedPercent == null ? '?' : Math.round(w.usedPercent);
    parts.push(`${windowLabel(w)} 已用 ${pct}%（${fmtReset(w.resetsAt)} 重置）`);
  }
  if (rl.planType) parts.push(`套餐 ${rl.planType}`);
  return parts;
}

function describeClaude(cu) {
  const parts = [];
  if (!cu) return parts;
  const fmt = (w, label) => {
    if (!w || w.utilization == null) return;
    parts.push(`${label} 已用 ${Math.round(w.utilization)}%（${fmtReset(w.resets_at)} 重置）`);
  };
  fmt(cu.fiveHour, '5小时');
  fmt(cu.sevenDay, '周');
  return parts;
}

// 守门判定（双闸 + 余量感知）。**纯函数**：快照由调用方取好递进来，查询失败就递 null。
// - 5h 闸：有效阈值 = min(gatePercent, 100 - costBufferPercent)。costBuffer 是"单张工单
//   的预估消耗"——守门只在派发瞬间检查，不留余量就会 79% 放行、一单烧 30% 冲破 100%
//   （2026-07-06 实测每张 Unity 单吃 25~30%，TK-11-10 事故即此）
// - 周闸：周窗烧穿是灾难级（停摆数日），weeklyGatePercent 兜底
// gatePercent 显式设 0 = 关闭守门（调用方据此连查询都不必发起，测试/离线环境用）
// 快照缺失/字段缺失一律 fail-open 放行：守门查不着不能反过来卡死管线。
function gateOf(rl, cfg) {
  const q = (cfg && cfg.quota) || {};
  if (Number(q.gatePercent) === 0) return { allowed: true, threshold: 0, reason: '额度守门已关闭' };
  const gatePercent = Number(q.gatePercent) > 0 ? Number(q.gatePercent) : 80;
  const costBuffer = q.costBufferPercent != null ? Number(q.costBufferPercent) : 30;
  const threshold = Math.min(gatePercent, 100 - costBuffer);
  const weeklyThreshold = q.weeklyGatePercent != null ? Number(q.weeklyGatePercent) : 90;
  if (!rl || !rl.primary || rl.primary.usedPercent == null) {
    return { allowed: true, threshold, snapshot: rl, reason: '额度查询不可用，放行（fail-open）' };
  }
  const toISO = (raw) => {
    if (raw == null) return null;
    const d = typeof raw === 'number' ? new Date(raw * (raw > 1e12 ? 1 : 1000)) : new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };
  const used = rl.primary.usedPercent;
  if (used >= threshold) {
    return {
      allowed: false, threshold, snapshot: rl, usedPercent: used, resetAt: toISO(rl.primary.resetsAt),
      reason: `${windowLabel(rl.primary)}窗口已用 ${Math.round(used)}%（拦截线 ${threshold}%＝阈值与单张余量取严），${fmtReset(rl.primary.resetsAt)} 重置`,
    };
  }
  const weekly = rl.secondary && rl.secondary.usedPercent;
  if (weekly != null && weekly >= weeklyThreshold) {
    return {
      allowed: false, threshold: weeklyThreshold, snapshot: rl, usedPercent: weekly, resetAt: toISO(rl.secondary.resetsAt),
      reason: `周窗口已用 ${Math.round(weekly)}%（周阀门 ${weeklyThreshold}%），${fmtReset(rl.secondary.resetsAt)} 重置——周额度烧穿会停摆数日，从严把守`,
    };
  }
  return { allowed: true, threshold, snapshot: rl, usedPercent: used };
}

module.exports = { windowsOf, claudeWindows, describe, describeClaude, fmtReset, windowLabel, gateOf };
