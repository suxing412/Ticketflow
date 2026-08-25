// watchpulse.js — 值守心跳节拍器 + 在位回执对账（TK-210）。
//
// 治的病：值守六项全挂在会话内 Monitor(persistent) 与 cron 上，两者都随进程重启而灭，
// 而「进程还在 ≠ 监视还在」已四犯（08-06 13:40 三振急件漏看 45 分钟；08-06 15:03 重启后
// 只重挂信箱线、流水线裸奔 90 分钟；08-11 两次后台 tail 有货不唤醒）。
// watch-rearm 附则给的验活法「近 10 分钟内应有事件是否收到通知」在**安静时段不成立**——
// 没有真实事件时，「没事发生」与「监视器已死」长得一模一样。缺的就是一条自造的稳定脉冲。
//
// 分两侧，协议与实现在此处切开（H80②，换实现不换协议）：
//   监制台侧（本文件）：每 5 分钟往当月 journal 追加一行带单调 seq 的心跳；收会话侧回写的
//                       在位 ack；连续 3 拍无 ack 判「静默阵亡」→ 急件 + 看板告警位 + journal。
//   会话侧（值守会话）：一条只订阅 心跳关键词 的 Monitor(persistent)，每被唤醒一次跑一遍
//                       watch-rearm 动作序列，然后调 scripts/值守在位.js 回执。
// 两侧只认下面这几个常量与几个行格式函数——**周期/阈值/报文各只有一把尺**，
// 两处各写一个数就是两把尺（G16/G20 已立过这条判例，此处照办）。
//
// 命名前缀「值守」不是啰嗦：本仓 `瞭望塔` 一词已被 packages/watchtower 那只常驻守护占着
// （它 30s 覆盖写 瞭望塔/心跳.txt，G14/G20 都键在它身上）。本模块管的是**值守会话侧的第 7 项监视**，
// 与那只守护毫无关系。两者若共用「瞭望塔心跳」这个词，journal 行与闸都会当场歧义。
const fs = require('fs');
const path = require('path');

// ── 协议常量（唯一事实源）──────────────────────────────────────
const 周期毫秒 = 5 * 60000;   // 心跳周期 5 分钟
const 三振阈值 = 3;            // 连续 N 拍无在位回执即判亡。不许提前也不许拖后。
const 应有项数 = 7;            // 值守清单项数（六项 + 瞭望塔自己）
const 心跳关键词 = '值守心跳';  // 会话侧 Monitor 的过滤词，就是心跳行的行首标记
const STATE_FILE = '.值守心跳.json';
const LOCK_DIR = '.值守心跳.lock';

// ── 行格式（协议的另一半）────────────────────────────────────
// 全部集中在此：会话侧与测试都从这里取，谁都不许就地拼字符串。
const 心跳行 = ({ seq, 应有 = 应有项数, restart = false }) =>
  `${心跳关键词} seq=${seq} 应有=${应有} 周期=${周期毫秒 / 60000}m${restart ? ' restart=1' : ''}`;
const 在位行 = ({ seq, 已挂, 应有 = 应有项数 }) =>
  `值守在位 seq=${seq} 值守=${已挂}/${应有}`;
const 自愈行 = ({ seq, 次数, 已挂, 应有 = 应有项数, 补挂 }) =>
  `值守瞭望塔自愈 seq=${seq} 第${次数}次 已挂=${已挂}/${应有} 补挂=${(补挂 || []).join('、')}`;
// 窗口报文行：工单写死的那一句。**有变更才报**，无变更静默——不刷屏是这条的一半价值。
const 窗口行 = ({ 次数, 已挂, 应有 = 应有项数, 补挂 }) =>
  `瞭望塔第 ${次数} 次静默阵亡，已自动重挂 ${已挂}/${应有}（缺 ${(补挂 || []).join('、')} 已补）`;
const 阵亡行 = ({ 自, 至, 连续 }) =>
  `值守瞭望塔静默阵亡：连续 ${连续} 拍无在位回执（缺失 seq ${自}~${至}）`;

const 初态 = () => ({
  seq: 0, 上次心跳: null,
  在位: { seq: 0, 已挂: null, t: null },
  无回执: 0, 阵亡: false, 阵亡起: null, 自愈次数: 0,
});

// ── 独立 state 文件（工单①：seq 不进 .studio-state.json）──────────
// 独立的理由不只是「工单这么写」：拍体在 server 进程里推 seq，回执由**另一个进程**
// （会话侧那条 Monitor 拉起的 CLI）写——两个写者共用总闸状态文件只会把锁竞争面无谓地扩大。
function 读态(root) {
  try { return { ...初态(), ...JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8')) }; }
  catch { return 初态(); }
}

// mkdir 跨进程锁，形制照抄 core/state.js（同一把锁语义，别再发明第二种）。
function 改态(root, mutator) {
  const lockPath = path.join(root, LOCK_DIR);
  const deadline = Date.now() + 4000;
  const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* 忙等兜底 */ } };
  for (;;) {
    try { fs.mkdirSync(lockPath, { recursive: false }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lockPath).mtimeMs > 15000) fs.rmdirSync(lockPath); } catch { /* 竞争回收忽略 */ }
      if (Date.now() > deadline) throw new Error('值守心跳 state 锁获取超时');
      sleep(20);
    }
  }
  try {
    const s = 读态(root);
    const r = mutator(s);
    // 走 core/durable：写→fsync→改名。原子改名保证不了「新的那份真在盘上」（08-21 断电写全 NUL 案）。
    require('../core/durable').写JSON(path.join(root, STATE_FILE), s);
    return r;
  } finally { try { fs.rmdirSync(lockPath); } catch { /* 已释放 */ } }
}

const 默认deps = () => ({
  journal: require('../journal'),
  inbox: require('../inbox'),
  改态, 读态,
  now: () => Date.now(),
});

/**
 * 造心跳拍(取ROOT, 取cfg, opts) → 拍()
 *   取ROOT/取cfg 是取值函数（首次运行向导会就地重挂 ROOT，按值捕获会一直拿着旧仓库）。
 *   opts.deps 覆盖依赖（测试注桩）。
 *   拍() 返回 { seq, restart, 无回执, 阵亡, 判亡本拍 }——运行期行为要能被断言，
 *   不留「只能 grep 源码看」的闭包（patroltick #24/#28 判例）。
 *   跨拍状态全在盘上（重启不回退是工单硬指标）；只有 restart 标记靠闭包，因为它问的正是
 *   「本进程是不是刚起来」——那件事按定义只有进程内存知道。
 */
function 造心跳拍(取ROOT, 取cfg, opts = {}) {
  const d = { ...默认deps(), ...(opts.deps || {}) };
  let 首拍 = true;

  return function 拍() {
    const ROOT = 取ROOT();
    const restart = 首拍;
    首拍 = false;
    try {
      return d.改态(ROOT, (s) => {
        // ① 推进 seq。**只增不减**：从盘上读回来再 +1，进程重启后接着上次往下走。
        s.seq = Number(s.seq || 0) + 1;
        s.上次心跳 = new Date(d.now()).toISOString();
        const seq = s.seq;
        d.journal.append(ROOT, 心跳行({ seq, restart }));

        // ② 对账。本拍刚发出的 seq 塔还来不及回执，故只对 **seq 之前**的那些拍算账：
        //    缺失区间 = [在位.seq+1, seq-1]。首拍（seq=1）区间为空，天然不判亡。
        const 已回执至 = Number((s.在位 && s.在位.seq) || 0);
        const 无回执 = Math.max(0, (seq - 1) - 已回执至);
        s.无回执 = 无回执;

        let 判亡本拍 = false;
        // 告警挂在**进入阵亡态的那一次跃迁**上，不挂在「无回执 ≥ 阈值」这个持续为真的条件上。
        // 差别不是风格：塔一直不回执时缺失区间每拍都在变长，任何「比上次告警的区间更长就再喊」
        // 式的守卫都会每拍复喊一封急件——把急件变噪声，而收件箱被噪声埋掉正是 inbox.js
        // 头注那桩 377 条未读的案源。跃迁只发生一次，复位后才可能再发生第二次。
        if (无回执 >= 三振阈值 && !s.阵亡) {
          const 自 = 已回执至 + 1; const 至 = seq - 1;
          s.阵亡 = true;
          s.阵亡起 = new Date(d.now()).toISOString();
          判亡本拍 = true;
          const 文 = 阵亡行({ 自, 至, 连续: 无回执 });
          d.journal.append(ROOT, 文);
          // 级别 急：塔死了要人去重挂，是「要人动手的事」。类型名不许落进 inbox 噪声表
          //（那张表只收「系统在呼吸」类，见 inbox.js 头注的划线判据）。
          d.inbox.post(ROOT, '急', '值守塔阵亡', 文);
        } else if (s.阵亡 && 无回执 === 0) {
          // 复位：塔回来了。留一行痕——「什么时候活过来的」和「什么时候死的」一样要查得到。
          // 阵亡 归假即解锁下一次跃迁：**不是喊过一次就永久闭嘴**，第二次死照喊第二封。
          s.阵亡 = false; s.阵亡起 = null;
          d.journal.append(ROOT, `值守瞭望塔已恢复在位（seq=${已回执至}）`);
        }
        return { seq, restart, 无回执, 阵亡: s.阵亡, 判亡本拍 };
      });
    } catch (e) {
      // 拍体自己炸不许静默（patroltick 外层兜底同款）：「不阻塞」的代价不该是「不知道」。
      try { d.journal.append(ROOT, `值守心跳拍异常：${String((e && e.message) || e).slice(0, 120)}`); }
      catch { /* 留痕失败不倒下一拍 */ }
      return { seq: null, restart, 无回执: null, 阵亡: null, 判亡本拍: false, 异常: String((e && e.message) || e) };
    }
  };
}

/**
 * 记在位(root, {seq, 已挂, 补挂}, deps) —— 会话侧瞭望塔处理完一拍心跳后的回执写口。
 *   seq   本次处理的心跳序号（从心跳行里读出来的那个数）
 *   已挂  重挂动作跑完后**实测在册**的项数（不是「应该有几项」——那是应有项数）
 *   补挂  本次补挂了哪几项；空数组＝无变更
 * 返回 { ok, seq, 窗口行 }：窗口行仅在有补挂时非空——**有变更才向窗口报一行**，
 * 无变更静默是协议的一部分，不是实现细节。
 */
function 记在位(root, { seq, 已挂, 补挂 = [] } = {}, deps = {}) {
  const d = { ...默认deps(), ...deps };
  // 布尔要显式挡掉：CLI 的 取参 把「--seq 后面没跟值」解析成 true，而 Number(true) === 1
  // ——不挡就会把一次**写错的调用**静默记成「seq 1 已在位」，比报错坏得多（假在位会把三振对账骗过去）。
  const 数 = (v) => (typeof v === 'boolean' ? NaN : Number(v));
  const n = 数(seq);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, 因: 'seq 非法：' + seq };
  const 挂 = Number.isFinite(数(已挂)) ? 数(已挂) : null;
  const 补 = (补挂 || []).filter(Boolean);
  return d.改态(root, (s) => {
    // 回执只许前进（乱序到达/重放不许把水位拽回去——inbox.js 那条「多进程各取 new Date() 一次
    // 乱序就丢数据」的教训同型）。
    if (n > Number((s.在位 && s.在位.seq) || 0)) {
      s.在位 = { seq: n, 已挂: 挂, t: new Date(d.now()).toISOString() };
      s.无回执 = 0;
    }
    d.journal.append(root, 在位行({ seq: n, 已挂: 挂 == null ? '?' : 挂 }));
    let 报 = '';
    if (补.length) {
      s.自愈次数 = Number(s.自愈次数 || 0) + 1;
      d.journal.append(root, 自愈行({ seq: n, 次数: s.自愈次数, 已挂: 挂 == null ? '?' : 挂, 补挂: 补 }));
      报 = 窗口行({ 次数: s.自愈次数, 已挂: 挂 == null ? '?' : 挂, 补挂: 补 });
    }
    return { ok: true, seq: n, 窗口行: 报 };
  });
}

module.exports = {
  造心跳拍, 记在位, 读态, 改态,
  周期毫秒, 三振阈值, 应有项数, 心跳关键词, STATE_FILE,
  心跳行, 在位行, 自愈行, 窗口行, 阵亡行, 初态,
};
