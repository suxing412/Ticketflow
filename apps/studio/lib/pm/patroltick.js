// patroltick.js — 15 分钟巡检拍（H61，2026-08-05 制作人拍板）的拍体本身。
//
// 为什么从 server.js 搬出来（2026-08-22 体检 #24/#28）：
//   拍体原本整段闭在 server.js 的 setInterval 里，于是它**只能被 grep 判据看着**——
//   「一只狗炸了后面几只还跑不跑」「连炸三拍立不立债」这两件事全是运行期行为，
//   源码文本判据既漏真病（换个写法照样病）又误伤重构（改个变量名就假红）。
//   搬成一个可注入依赖的纯函数后，测试能真造一只「必炸的狗」、真跑三拍、真看 state 与信箱。
//
// 逐狗跑：**一只狗炸掉不许拖死后面的**。原样是六个动作串在同一个 try 里、
// catch 体 `{ /* 巡检失败不阻塞 */ }` 零留痕——任一步同步抛出，后面几只当拍全不执行，
// 外面看不出任何异样。被掐掉的里头就有 OAuth 续命哨兵，而 08-21 早晨那次 token 过期正是它该管的。
//
// 2026-08-22 补：**第①步在途扫描原本还裸在逐狗之外**。store.list 要解析每张手写工单的
// frontmatter，YAML 坏一处就抛——先炸的仍会把后面六只全掐掉，与本条要治的病同型。
// 现在它也各兜各的；且扫不到时不拿「在途 0」冒充真读数去记账（假零比没数更坏）。
const 默认deps = () => ({
  journal: require('../journal'),
  store: require('../core/store'),
  runner: require('../runner'),
  pmLedger: require('./ledger'),
  patrol: require('./patrol'),
  oauth: require('../oauth'),
  pool: require('../pool'),
  wake: require('./wake'),
  inbox: require('../inbox'),
  state: require('../core/state'),
  fs: require('fs'),
  path: require('path'),
  now: () => Date.now(),
});

/**
 * 造巡检拍(取ROOT, 取cfg, opts) → 拍()
 *   取ROOT/取cfg 是取值函数（server 侧 ROOT/cfg 可被首次运行向导就地重挂，不能按值捕获）。
 *   opts.deps 覆盖任意依赖（测试注入桩）；opts.保存 是池衡巡检落配置用的 saveCfg。
 *   拍() 返回 { 本拍全好, 连续 }，供调用方与测试断言；跨拍状态（尾巴表、连炸计数）由闭包持有。
 */
function 造巡检拍(取ROOT, 取cfg, opts = {}) {
  const d = { ...默认deps(), ...(opts.deps || {}) };
  const 保存 = opts.保存 || (() => {});
  const patrolTails = new Map();
  const 巡检异常拍 = { 连续: 0 };

  return function 拍() {
    const ROOT = 取ROOT();
    const cfg = 取cfg();
    let 本拍全好 = true;
    const 逐狗 = (名, fn) => {
      try { fn(); return true; } catch (e) {
        try { d.journal.append(ROOT, `${名} 异常：${String((e && e.message) || e).slice(0, 120)}`); } catch { /* 留痕失败不阻塞下一只 */ }
        return false;
      }
    };
    try {
      // ① 在途扫描：也得各兜各的。store.list 解析每张手写工单的 frontmatter，坏一处即抛，
      // 它裸在逐狗之外就等于「①一炸，②～⑦ 当拍全不跑」——OAuth 续命哨兵正在这条链上。
      let inflight = [];
      const anomalies = [];
      const 在途按池 = {}; // P0-3（2026-08-24）：并发按池拆开——「在途 3」看不出是谁家的 3
      let 队列长 = 0; // P0-3：待投/池 里排着的张数，排期估算的另一半输入
      const 扫到 = 逐狗('在途扫描', () => {
        inflight = d.store.list(ROOT, '在途').filter((t) => !['战役', '专项'].includes(t.fm.父单类型));
        // P0-3 按池统计：执行池以工单 fm 落章为准（领单时盖的），没落章按职能查池归属，都判不出的归 未知——不许瞎猜
        for (const t of inflight) {
          const 池 = t.fm.执行池 || d.pool.poolFor(cfg, t.fm.职能) || '未知';
          在途按池[池] = (在途按池[池] || 0) + 1;
        }
        // P0-3 队列长：待投+池 两态都算排队；容器单（战役/专项）过滤口径与在途同
        for (const 态 of ['待投', '池']) {
          队列长 += d.store.list(ROOT, 态).filter((t) => !['战役', '专项'].includes(t.fm.父单类型)).length;
        }
        for (const t of inflight) {
          const e = [...d.runner.running.values()].find((x) => x.id === t.id && x.kind === '执行');
          if (!e) { anomalies.push(`${t.id} 在途但无执行会话`); patrolTails.delete(t.id); continue; }
          const prev = patrolTails.get(t.id);
          const tailNow = e.tail || '';
          // 引擎测试活跃时不计尾巴停滞（2026-08-06 狼来了案：会话前台等测试，尾巴静止是纪律不是僵死）
          const engActive = (() => { try {
            const reg = (cfg.项目 && cfg.项目.注册) || {}; const pj = t.fm.项目 && reg[t.fm.项目] && reg[t.fm.项目].路径;
            return pj && (d.now() - d.fs.statSync(d.path.join(pj, 'enginectl-test.log')).mtimeMs) < 5 * 60000;
          } catch { return false; } })();
          if (prev !== undefined && prev === tailNow && tailNow !== '' && !engActive) anomalies.push(`${t.id} 15 分钟进展尾巴无变化`);
          patrolTails.set(t.id, tailNow);
          const mins = (d.now() - new Date(e.startedAt).getTime()) / 60000;
          const est = (parseFloat(t.fm.预计时间) * 60) || 30;
          if (mins > est * 2) anomalies.push(`${t.id} 已跑 ${Math.round(mins)} 分钟 > 预估 ${est} 分钟 ×2`);
        }
      });
      本拍全好 = 扫到 && 本拍全好;
      // ② 记账与告警各包一层：台账写盘失败（EPERM/锁竞争都发生过）不该把后面五只狗掐掉。
      // 扫不到就不记——拿「在途 0」冒充真读数，比缺一拍心跳更坏（假零会把零派发看门狗也骗过去）。
      if (扫到) {
        // P0-3：旧 在途 总数照留（消费方还在读旧格），在途按池/队列长 是新增不是替换
        本拍全好 = 逐狗('巡检记账', () => d.pmLedger.event(ROOT, '巡检', { 在途: inflight.length, 异常: anomalies.length, 在途按池, 队列长 })) && 本拍全好;
      }
      if (anomalies.length) {
        本拍全好 = 逐狗('巡检告警', () => {
          d.journal.append(ROOT, `项管巡检异常：${anomalies.join('；')}`);
          d.inbox.post(ROOT, '常', '巡检异常', anomalies.join('；').slice(0, 200));
        }) && 本拍全好;
      }
      // ③ H81 零派发看门狗：有放行就绪单却连续 ≥2 个周期零派发零执行 → 信箱告警（换装漏开闸案）
      本拍全好 = 逐狗('零派发看门狗', () => d.patrol.零派发告警(ROOT, cfg)) && 本拍全好;
      // ④ 施工令-004 打点停滞：签了打点软契约却不动了才提醒（无打点的单不适用）
      本拍全好 = 逐狗('打点停滞巡检', () => d.patrol.打点停滞(ROOT, cfg)) && 本拍全好;
      // ⑤ 施工令-010 零输出看门狗：会话拉起 ≥config.并发.零输出分钟 仍一个字没吐 → 急件（TK-102 挂死 48 分钟案）
      本拍全好 = 逐狗('零输出看门狗', () => d.patrol.零输出(ROOT, cfg)) && 本拍全好;
      // ⑥ 施工令-055/057 OAuth 续命哨兵：拍读凭据 expiresAt；临期/过期先发一发无头探针自续
      // （08-13 16:49 实证 +8h），续成只留流水，**续不上才**发急件（同状态 30 分钟至多一封）。
      // 二期起是 async（探针最多 60 秒）——不 await，异常自吞进流水，别把同一拍的其余巡检拖住。
      // 逐狗包一层：async 那两只原本就自吞异常，但**同步抛出**（require 失败、参数校验之类）
      // 会漏过 .catch 落到外层——那正是把后面几只一起掐掉的路径。
      本拍全好 = 逐狗('OAuth 哨兵', () => d.oauth.哨兵(ROOT, cfg)
        .catch((e) => d.journal.append(ROOT, `OAuth 哨兵异常：${String(e && e.message).slice(0, 80)}`))) && 本拍全好;
      // ⑦ H99 池衡巡检（施工令-045）：读三池额度 → 决策 → 受限动作落配置。异步且自吞异常，
      // 不 await——池衡是优化面，它的外呼慢一点不该把同一拍的其余巡检项拖住。
      本拍全好 = 逐狗('池衡巡检', () => d.wake.池衡巡检(ROOT, cfg, { 保存 })
        .catch((e) => d.journal.append(ROOT, `池衡巡检异常：${String(e.message).slice(0, 80)}`))) && 本拍全好;
    } catch (e) {
      // 外层兜底也**必须留痕**：原样是 `catch { /* 巡检失败不阻塞 */ }`，
      // 于是「不阻塞」的代价是「不知道」——同一个人在 runner.js 里立过相反的规矩
      //（「取不到数就闭嘴，不许假装零欠债」），这里是漏的。
      本拍全好 = false;
      try { d.journal.append(ROOT, `巡检拍异常：${String((e && e.message) || e).slice(0, 120)}`); } catch { /* 留痕失败不阻塞下一拍 */ }
    }
    // 连续异常立成债：一次异常可能是瞬时的，**连着三拍（45 分钟）还在炸就是坏了**，
    // 而坏了没人知道正是本条要治的病。写进 state 供 gatereg 的 G16 取；好了即清零。
    try {
      const st = d.state;
      if (本拍全好) { if ((st.read(ROOT).巡检异常拍 || 0) !== 0) st.update(ROOT, (s) => { s.巡检异常拍 = 0; s.巡检异常起 = null; }); 巡检异常拍.连续 = 0; }
      else {
        巡检异常拍.连续 += 1;
        st.update(ROOT, (s) => {
          s.巡检异常拍 = 巡检异常拍.连续;
          if (巡检异常拍.连续 === 1) s.巡检异常起 = new Date().toISOString(); // 停摆自：第一拍炸的时刻，G16 据它算欠了多久
        });
        if (巡检异常拍.连续 === 3) {
          d.inbox.post(ROOT, '急', '巡检连炸', `巡检已连续 ${巡检异常拍.连续} 拍异常（45 分钟）——看门狗自己坏了`);
        }
      }
    } catch { /* 记账失败不阻塞巡检本身 */ }
    return { 本拍全好, 连续: 巡检异常拍.连续 };
  };
}

module.exports = { 造巡检拍, 默认deps };
