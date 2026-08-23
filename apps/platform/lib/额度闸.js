// 额度闸 —— 订阅窗口的守门（协-018）。
//
// 这是 `packages/budget` 的**订阅侧孪生**。budget 守的是 token 上限（按量计费那一半），
// 本模块守的是**订阅窗口**：5h / 周 的用量百分比烧穿之后，接下来几小时到几天什么都跑不了。
// 两件事的止损方式完全不同，所以两套判据并存，不做语义合并。
//
// **本模块是纯的**：不引 child_process、不发请求、不拉进程。判定整块来自
// `packages/quota.gateOf`（对方主笔的公用件正本，纯函数），本模块只负责三件事：
//   ① 从盘上读执行器落下的快照（取数在那边，见 lib/额度取数.js）
//   ② 把 claude 的双窗**归一**成 gateOf 认得的形状（包只吃 codex 形状，见下）
//   ③ 按**计费模式**决定这个池该不该受本闸管
//
// 为什么取数与判定要分进程：server.js 的依赖闭包里不许出现 child_process
// （桩模式是物理保证，接线契约测试盯着）。而 codex 的额度只能靠拉起 app-server 拿到。
// 于是执行器（唯一被允许起进程的地方）定期取数落盘，server 与派单只读盘。
'use strict';

const fs = require('fs');
const path = require('path');
const 公用件 = require('./公用件');
const 计费 = require('./计费');

const 快照文件 = (账本根) => path.join(账本根, 'journal', '额度快照.json');

// 解读件缺位不阻断派单——但要**明说**。
//
// 与 budget 那边「读不到用量就不许真跑」刻意相反：那道闸对着钱包，读不到数就该停；
// 这道闸对着订阅窗口，读不到数还去卡死管线是本末倒置（包 README 的红线也是 fail-open）。
// 代价是这段时间没有任何池会被额度锁住，所以更要吭声：接口 盲区 字段 + 界面标注 + 控制台。
function 载入包() {
  try {
    const m = 公用件.载入('quota', 'quota.js');
    // 形状校验：解析到了但不是额度解读件（半截包 / 同名文件）比找不到更坑——
    // 它会**静默**地表现为「一切正常，就是从来不锁」。当场判失败，别让它蒙混过关。
    const 缺 = ['windowsOf', 'claudeWindows', 'gateOf', 'fmtReset'].filter((k) => typeof m[k] !== 'function');
    if (缺.length) return { 失效: true, 因: `模块形状不对（缺 ${缺.join('/')}）` };
    return { 包: m };
  } catch (e) {
    return { 失效: true, 因: String((e && e.message) || e).split('\n')[0] };
  }
}

// claude 双窗 → gateOf 认得的形状。
//
// **这是我方补的口径，不是包里的东西**（协-018 已走信道回信给对方）：
// `gateOf` 读的是 rl.primary / rl.secondary（codex 形状），而 claude 快照是
// { fiveHour, sevenDay }——不归一的话 claude 池根本进不了这个判定，
// 而表现是「claude 永远不被额度锁」，跟「claude 额度充足」长得一模一样。
// studio 那边没撞上是因为它的 poolLock 走 windowsOf/claudeWindows + 每池阈值，不经过 gateOf。
//
// 窗口时长按包里 windowLabel 的口径填：≤360min 报「N小时」，≥9000min 报「周」。
function 归一(项) {
  if (!项) return null;
  if (项.形态 === 'codex') return 项.rl || null;
  if (项.形态 === 'claude') {
    const u = 项.usage;
    if (!u) return null;
    const 窗 = (w, mins) => (w && w.utilization != null
      ? { usedPercent: Number(w.utilization), windowDurationMins: mins, resetsAt: w.resets_at }
      : null);
    const primary = 窗(u.fiveHour, 300);
    const secondary = 窗(u.sevenDay, 10080);
    if (!primary && !secondary) return null;
    // 只有周窗读得到时，把它放 primary：gateOf 缺 primary 就直接 fail-open，
    // 那会把一条**读得到的**周窗读数白白丢掉。label 由 windowDurationMins 自报，不会说错话。
    return primary ? { primary, secondary } : { primary: secondary, secondary: null };
  }
  return null;
}

function 读快照(账本根) {
  try {
    const j = JSON.parse(fs.readFileSync(快照文件(账本根), 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

// 秒龄。取不到时刻返回 null（「不知道多久了」和「刚取的」不是一回事）。
function 秒龄(iso, 现在) {
  const t = Date.parse(iso || '');
  if (isNaN(t)) return null;
  return Math.max(0, Math.round((现在 - t) / 1000));
}

// 判定 —— 快照 + 配置 → 哪些池现在不许派。
//
// 返回 挡:{池:因}，形状与 budget.冻结池 一致，好让调用方并进同一个 gatesInfo。
// 盲区是**第一等公民**：读不到就放行，但放行的每一条都要留在 盲区 里被看见。
function 判(配置, 快照, o = {}) {
  const 现在 = o.现在 || Date.now();
  const q = (配置 && 配置.quota) || {};
  const 最长秒 = Number(q.快照最长秒) > 0 ? Number(q.快照最长秒) : 900;      // 超过就标陈旧（仍照判）
  const 弃用秒 = Number(q.快照弃用秒) > 0 ? Number(q.快照弃用秒) : 3600;     // 超过就当读不到（fail-open）
  const 挡 = {}; const 明细 = []; const 盲区 = [];

  if (Number(q.gatePercent) === 0) {
    return { ok: true, 挡: {}, 明细: [], 盲区: [], 关闸: true, 说明: '额度守门已关闭（quota.gatePercent = 0）' };
  }

  const 载 = 载入包();
  if (载.失效) {
    const 因 = `额度解读件失效：${载.因}——窗口读不出、额度锁恒不锁`;
    return { ok: false, 挡: {}, 明细: [], 盲区: [{ 池: '(全部)', 因 }], 失效: true, 错误: 因 };
  }
  const 包 = 载.包;

  for (const 池 of Object.keys((配置 && 配置.providers) || {})) {
    const 模式 = 计费.模式(配置, 池);
    // 只有订阅池有「窗口」这回事。api 池按 token 计费、没有会重置的窗口，那是 budget 的活；
    // 本地池根本没有厂商在计费。未声明的池不在这里从严——它的从严发生在计费那一侧
    // （会新增开销 = true，真跑前会被拦下问），在这儿硬造一个不存在的窗口只会假装有刹车。
    if (模式 !== 计费.订阅) {
      明细.push({ 池, 模式, 适用: false, 说明: 模式 === 计费.计费 ? '按量计费池：刹车归预算闸（token 上限）'
        : 模式 === 计费.本地 ? '本机命令池：没有厂商额度' : '未声明计费模式：无从判断窗口，本闸不管（真跑前由计费闸拦）' });
      continue;
    }

    const 项 = (快照 && 快照.池 && 快照.池[池]) || null;
    const 龄 = 项 ? 秒龄(项.取于, 现在) : null;
    const rl = 归一(项);
    if (!rl) {
      const 因 = 项 && 项.因 ? `取数失败：${项.因}` : '还没有额度读数（执行器没跑过取数，或该池不认识窗口来源）';
      盲区.push({ 池, 因 });
      明细.push({ 池, 模式, 适用: true, 盲区: true, 说明: 因 + '——已放行（fail-open）' });
      continue;
    }
    if (龄 == null || 龄 > 弃用秒) {
      const 因 = `读数太旧（${龄 == null ? '取数时刻不明' : Math.round(龄 / 60) + ' 分钟前'}，弃用线 ${Math.round(弃用秒 / 60)} 分钟）`;
      盲区.push({ 池, 因 });
      明细.push({ 池, 模式, 适用: true, 盲区: true, 说明: 因 + '——当读不到处理，已放行（fail-open）' });
      continue;
    }

    const 判据 = 包.gateOf(rl, 配置);
    const 窗口 = 项.形态 === 'claude' ? 包.claudeWindows(项.usage) : 包.windowsOf(rl);
    const 陈旧 = 龄 > 最长秒;

    // 拦下之前先自查一件事：**这个读数指向的重置时刻是不是已经过去了**。
    // 过去了就说明窗口早已重置、这份快照描述的是上一个窗口——再拿它锁池就是
    // 拿一条过期的读数把管线卡住。而卡住的表现是「派不出去，也没人说得清为什么」。
    if (!判据.allowed && 判据.resetAt && Date.parse(判据.resetAt) <= 现在) {
      const 因 = `读数已过重置时刻（${判据.resetAt}），窗口应已重置——不拿过期读数锁池`;
      盲区.push({ 池, 因 });
      明细.push({ 池, 模式, 适用: true, 盲区: true, 窗口, 说明: 因 + '——已放行（fail-open）' });
      continue;
    }

    if (!判据.allowed) {
      挡[池] = 判据.reason + (陈旧 ? `（读数 ${Math.round(龄 / 60)} 分钟前，已偏旧）` : '');
      明细.push({ 池, 模式, 适用: true, 挡: true, 窗口, 阈值: 判据.threshold, 用量: 判据.usedPercent,
        重置于: 判据.resetAt || null, 陈旧, 说明: 判据.reason });
      continue;
    }
    明细.push({ 池, 模式, 适用: true, 挡: false, 窗口, 阈值: 判据.threshold, 用量: 判据.usedPercent, 陈旧,
      ...(判据.reason ? { 说明: 判据.reason } : {}) });
    if (陈旧) 盲区.push({ 池, 因: `读数 ${Math.round(龄 / 60)} 分钟前（新鲜线 ${Math.round(最长秒 / 60)} 分钟），判定照做但已偏旧` });
  }

  return { ok: true, 挡, 明细, 盲区, 更新于: (快照 && 快照.更新于) || null };
}

// 给调用方的一步到位版：读盘 + 判。派单/接口都走它，免得两处各写一遍读盘。
function 现况(配置, 账本根, o = {}) {
  return 判(配置, 读快照(账本根), o);
}

module.exports = { 快照文件, 读快照, 归一, 判, 现况, 载入包 };
