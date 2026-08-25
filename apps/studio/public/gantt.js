// gantt.js — 甘特岛渲染器（P0 四层树骨架 + 虚拟化底座 · 施工令《方案-甘特表现层重做-2026-08-24》）
//
// 岛与宿主的边界（P0-0 裁决①，spike A 甲案）：
//   app.js 只吐一个空壳 <div id="rl-gantt" data-morph-skip></div> 并把四口拼树数据递进来；
//   morph 在壳上整枝跳过（岛内 DOM 宿主一个字节不碰），岛自己做 key→节点 Map + 行签名 的增量重绘。
//   行元素带 id（gt2-row-<键>）供焦点找回——morph 焦点恢复按 id 查，岛内换行后同样按 id 归位。
//
// 纪律（与旧甘特一脉相承，一条不松）：
//   · 只画不判：延期/超期/需重排的唯一实现在服务端 lib/pm/schedule.工期判定，随 /api/schedule
//     逐粒下发（悬浮卡与徽标一律读 g.判定，禁止前端算 e−基线；无判定字段显「—」）。
//   · 布局层禁嵌套 flex 撑宽（Chromium 124 事故纪律）：行=absolute 定位，树列格=grid。
//   · 固定小时轴（制作人 2026-08-24 拍板）：不设缩放档位，HW=20px/h；超视口走横向滚动。
//   · 超长条图端兜底（CX-5 乙案）：工期 >24h 的条画到 24h 截断+「⋯」折断符号，
//     悬浮卡显真实区间并标「超长异常」——写口不加闸，图不被撑爆。
//   · 孤儿契约（P0-0 裁决⑤）：直挂特性/无父两形原生接受，渲染期不修数据。
//
// P1（施工令 #8/#9/#19/#20 · 2026-08-24）已入本文件：右键两区菜单（行/条＋空白）、聚焦模式
//   （祖先链+子孙投影＋面包屑，会话内不持久化）、越线图内处置（红点/待重判标记/右键表态 →
//   window.tqStance，弹窗在 app.js 与 tqReplan 同区）、树列轻量字段（状态色点＋工期徽章）、
//   越线计数角标（点击滚到下一张越线行）。
// P2（施工令 #10/#11/#12 · 2026-08-24）已入本文件：
//   #10 拖拽两路分流——工单条（非终态）拖条身=整体平移（工期不变）、拉端点(.gt2h 6px 热区)=改起/讫；
//     拖拽中条半透明跟随+悬浮时间提示（刻钟吸附实时显示）；像素→时间反算＝窗起点毫+px/HW 小时、
//     15 分钟吸附，产 'YYYY-MM-DDTHH:mm' 本地钟面（串即契约：lib/pm/schedule.规范计划时刻 原样收下，
//     计划毫秒 按本地墙钟解析——判据①拿服务端模块对拍往返）；松手分流：普通条→tqReplan 预填、
//     越线待重判条→tqStance 预填(决定=重排)；取消/失败原位回滚（岛数据不变重绘即回滚）；
//     拖拽期间 window._gt2Dragging=true 挂起 30s 轮询重绘（app.js pollLoop 见旗跳过，DS-6）；
//     CAS 409 冲突二选（重新加载/放弃）在壳层 排程写。
//   #11 只读态（最小实现）：停表（/api/gates paused，viewRelay 十四口已带）或粒终态 ⇒
//     不出端点手柄、拖拽不启动、悬停详情照常。不做用户角色系统（单用户桌面应用，写口自有域校验兜底）。
//   #12 依赖线——数据=服务端已下发 边/边统计（/api/schedule 增发，lib/pm/schedule-edges 冻结形）；
//     岛内全局 SVG 层（绝对定位盖时间区，pointer-events:none）；三次贝塞尔（出点=前置条右端中点、
//     入点=后继条左端中点、控制柄 k 按施工令 #12 原文）；着色只按服务端字段：冲突=红、环=虚线+环组
//     title、外部/解析不到=半截线+空心端点符；默认淡色退后台，悬停条时其上下游线点亮；
//     锚点缓存 key→{x,y}，虚拟滚动窗变/横滚/resize 同步重绘；离屏端点走 P0 预留的 离屏端点 桩
//     （线画到可视区边缘+方向箭头）；工具栏冲突角标＝边统计.冲突（点击定位下一条冲突线）。
(function () {
  'use strict';

  /* ═══ 常量与小工具 ═══ */
  const 行高 = 30, HW = 20, 树宽 = 280, 头高 = 46, 缓冲行 = 10;
  const 时毫 = 3600000, 天毫 = 86400000, 刻毫 = 900000;
  const 终态 = ['完成', '撤销'];
  const 单号形 = /^[A-Za-z]+-\d+$/;   // P0-0 裁决③：过形才成链（库里实证有「（无单·直接落码）」自由文本）
  const 状态类 = { 计划: 'plan', 起草中: 'draft', 已成单: 'made', 完成: 'done', 撤销: 'drop' };
  const 型层 = { 管线: 0, 特性: 1, 专项: 2, 工单: 3, 伪组: 0 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); // ' 也转（DS 终审 #8）：题名/名册进双引号属性值时单引号不许裸奔

  /* ═══ 分钟几何（终审 T9 统一钟面轴）：本地钟面串 → **本地墙钟毫秒**，与服务端
     lib/pm/schedule.计划毫秒 同语义（纯日期＝当日本地 00:00，刻钟形本地解析）。
     原以 Date.UTC 自建时区无关轴——岛内自洽但与服务端两把尺，遇夏令时部署即分叉；
     判据（gantt-p2 ①）锁「岛毫秒轴 == schedule.计划毫秒 逐样本相等」。 ═══ */
  const 解时 = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v == null ? '' : v));
    return m ? { ms: new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)).getTime(), 含时: m[4] != null } : null;
  };
  // 端点对 → 段。纯日期讫含尾一整天（040 老口径）；最窄一刻钟；>24h 截断（真讫留给悬浮卡）。
  function 段(开始, 完成) {
    let a = 解时(开始), b = 解时(完成);
    if (!a && !b) return null;
    const 单端 = !a || !b;
    if (!a) a = b; if (!b) b = a;
    const 起 = a.ms;
    const 真讫 = Math.max(b.含时 ? b.ms : b.ms + 天毫, 起 + 刻毫);
    const 超长 = 真讫 - 起 > 天毫;
    return { 起, 讫: 超长 ? 起 + 天毫 : 真讫, 真讫, 单端, 超长 };
  }
  const 计划段 = (g) => 段(g && g.计划开始, g && g.计划完成);
  const 基线段 = (g) => 段(g && g.基线开始, g && g.基线完成);
  // 真时刻（2026-08-26 优化包）：领单/交付是完整 ISO（带秒带 Z），解时 的钟面正则会把 UTC 字面
  // 当本地钟读——时区整移八小时。真实执行时刻一律走 Date.parse 落真毫。
  const 实时毫 = (v) => { const t = Date.parse(String(v == null ? '' : v)); return Number.isNaN(t) ? null : t; };
  // 三档已完视野（2026-08-26 制作人拍板：全部保留 / 保留最近若干（默认近完 24h）/ 不保留）。
  // 纯函数（判据面）：档∈{全,近,无}；近档卡交付时刻 ≥ 今−24h。缺时单不归它管（画不出，由 史况 挂账）。
  function 史过滤(史单, 档, 今ms) {
    const 全 = Array.isArray(史单) ? 史单 : [];
    if (档 === '无') return [];
    if (档 === '全') return 全;
    const 底 = (今ms == null ? Date.now() : 今ms) - 24 * 时毫;
    return 全.filter((h) => { const t = 实时毫(h.交付); return t == null || t >= 底; }); // 缺时不在此滤（进 缺时账 不进图）
  }
  const 完档读 = () => { try { const v = localStorage.getItem('gt2-done'); return v === '全' || v === '无' ? v : '近'; } catch { return '近'; } };
  const 完档写 = (v) => { try { localStorage.setItem('gt2-done', v); } catch { /* 隐私模式：会话内照切 */ } };
  // 时间窗＝计划/基线极值 ∪ 今，整日取齐（表头日界与 4h 网格因此天然对齐），两侧各留 1h 再取整。
  // 取齐用**本地午夜**（T9：轴是本地墙钟毫秒，按 天毫 取整会齐到 UTC 午夜、把日界画到本地 08:00）。
  const 整日下 = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  function 算窗(点们, 最少小时) {
    const 点 = 点们.filter((x) => x != null);
    if (!点.length) return { 空: true };
    const t0 = 整日下(Math.min.apply(null, 点) - 时毫);
    const 顶 = Math.max.apply(null, 点) + 时毫;
    let t1 = 整日下(顶);
    if (t1 < 顶) { const d = new Date(t1); t1 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); }
    let 小时 = Math.round((t1 - t0) / 时毫);
    // 窗宽下限＝铺满视口（2026-08-25 制作人所指：数据窄时窗缩到一天 480px，宽屏右侧大片无刻度
    // 死白、表头深色半途截止，看着像断裂）。不足则按整日扩 t1，刻度一路画到右缘。
    if (最少小时 && 小时 < 最少小时) {
      const 补日 = Math.ceil((最少小时 - 小时) / 24);
      const d = new Date(t1); t1 = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 补日).getTime();
      小时 = Math.round((t1 - t0) / 时毫);
    }
    return { 空: false, t0, t1, 小时, 宽: 小时 * HW };
  }
  const X = (ms, 窗) => ((ms - 窗.t0) / 时毫) * HW;
  const 毫文 = (ms) => { const d = new Date(ms), p = (n) => String(n).padStart(2, '0'); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }; // 本地格式（T9：轴是本地毫，toISOString 会漂回 UTC）
  const 时点文 = (v) => { const p = 解时(v); return p ? (p.含时 ? String(v).slice(5, 16).replace('T', ' ') : String(v).slice(5, 10)) : '未定'; };

  /* ═══ P2 #10 像素↔钟面反算（纯函数，判据①锁往返恒等）═══
     解时 按本地墙钟解析（T9 统一轴），反算就得用本地 getters 收回来——同一把尺才有
     像素→时间→像素恒等。吸附 落全球刻钟格（时区偏移全为 15 分整倍数，格即本地 00/15/30/45）。
     产出串 'YYYY-MM-DDTHH:mm' 与 lib/pm/schedule.规范计划时刻 的刻钟形一字不差
     （15 分对齐由 吸附 保证，服务端拒非刻钟），写口按本地墙钟解析：串即契约、轴即同轴。 */
  const 吸附 = (ms) => Math.round(ms / 刻毫) * 刻毫;
  const 像素毫 = (px) => (px / HW) * 时毫;
  function 毫钟面(ms) {
    const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  // 拖几何：模式∈{移,左,右}。移=平移工期不变（真讫参与——超长条拖完还是超长，截断只截图）；
  // 左/右=改起/讫，最窄一刻钟；全部落点先过 吸附（图上跟随的就是吸附后的位置，所见即所提交）。
  function 拖几何(s, 模式, dx像素) {
    const d = 像素毫(dx像素);
    if (模式 === '左') return { 起: Math.min(吸附(s.起 + d), s.真讫 - 刻毫), 讫: s.真讫 };
    if (模式 === '右') return { 起: s.起, 讫: Math.max(吸附(s.真讫 + d), s.起 + 刻毫) };
    const 起 = 吸附(s.起 + d);
    return { 起, 讫: 起 + (s.真讫 - s.起) };
  }

  /* ═══ 拼树（P0-0 契约②：pipelines/features/specials/schedule＋board 四口前端拼装）═══ */
  function 拼树(数据) {
    const 名册 = 数据.名册 || {};
    const 造 = (型, 号, 名) => ({ 键: String(号), 型, 号: String(号), 名: String(名 || 名册[号] || ''), 子: [], 自粒: null, 债: [] });
    const P表 = new Map(), F表 = new Map(), S表 = new Map();
    const 根 = [];
    // 管线全上（制作人指令「所有管线全部放上」）
    for (const p of (数据.管线 || [])) { const n = 造('管线', p.id, p.名称); P表.set(n.键, n); 根.push(n); }
    // 特性挂管线；无管线＝孤儿，原生落根（裁决⑤：渲染期不修数据）
    for (const f of (数据.特性 || [])) {
      const n = 造('特性', f.id, f.名称); n.管线 = f.管线 || null; F表.set(n.键, n);
      (P表.get(String(f.管线)) || { 子: 根 }).子.push(n);
    }
    // 专项挂特性，退而挂管线，再退落根；项目滤镜只滤明确写了别家项目的
    for (const s of (数据.专项 || [])) {
      if (数据.项目 && s.项目 && s.项目 !== 数据.项目) continue;
      const n = 造('专项', s.id, s.名称); S表.set(n.键, n);
      (F表.get(String(s.特性)) || P表.get(String(s.管线)) || { 子: 根 }).子.push(n);
    }
    // 板归属（board 的 fm.特性/专项/管线）：粒无上级时的回落认亲，只查表不推断
    const 板 = 数据.板归属 || {};
    // 未归属伪组（P0-0 裁决⑤＋2026-08-24 整合裁决）：无父工单不散落根级、集中入伪组，
    // 伪组挂**根级尾部**（排在所有管线节点之后）——判据①以此锁死，孤儿原生接受不修数据。
    const 伪组 = 造('伪组', '未归属', '未归属（无父孤儿单）');
    for (const g of (数据.粒 || [])) {
      if (g.型 === '专项') {   // 专项登记粒＝专项节点的自身计划；注册表缺该专项时按孤儿工单落根
        const k = 单号形.test(String(g.单号 || '')) && S表.has(String(g.单号)) ? String(g.单号)
          : (S表.has(String(g.上级 || '')) ? String(g.上级) : null);
        if (k) { S表.get(k).自粒 = g; continue; }
      }
      if (!g.计划开始 && !g.计划完成) continue;    // 未排期粒不进树时间区——欠账区（壳层）单列
      const 上 = String(g.上级 || '');
      let 亲 = S表.get(上) || F表.get(上) || P表.get(上) || null;
      if (!亲 && g.单号 && 板[g.单号]) {
        const b = 板[g.单号];
        亲 = S表.get(String(b.专项 || '')) || F表.get(String(b.特性 || '')) || P表.get(String(b.管线 || '')) || null;
      }
      const n = 造('工单', g.粒ID, g.题); n.粒 = g;
      (亲 ? 亲.子 : 伪组.子).push(n);
    }
    // 史条（2026-08-26 优化包·历史全量接入）：已了结工单按**真实执行区间**（领单→交付）入树。
    // 缺任一真时刻＝计数不画（为图造数红线：不许拿创建日/归档日冒充执行区间）——
    // 缺时单在 建状态.史况.缺时 里挂账，工具栏挂「史缺时 N」角标如实报数。
    // 归属走单 fm 三格认亲（特性/专项/管线，同 板归属 口径）；认不到照伪组，不修数据。
    const 已画 = new Set();
    for (const h of (数据.史单 || [])) {
      const 号 = String(h.单号 || ''); if (!号 || 已画.has(号)) continue; 已画.add(号);
      if (实时毫(h.领单) == null || 实时毫(h.交付) == null) continue; // 缺时：计数不画（史况 在 建状态 里统计）
      const n = 造('工单', '史:' + 号, h.题); n.史 = h;
      // 伪粒：显号/色点/终态判共用工单行通路；带完成粒回挂的计划起讫（覆盖式实况条的底）
      n.粒 = { 粒ID: '史:' + 号, 单号: 号, 题: h.题, 状态: '完成',
        ...(h.计划开始 || h.计划完成 ? { 计划开始: h.计划开始 || null, 计划完成: h.计划完成 || null } : {}) };
      const 亲 = S表.get(String(h.专项 || '')) || F表.get(String(h.特性 || '')) || P表.get(String(h.管线 || '')) || null;
      (亲 ? 亲.子 : 伪组.子).push(n);
    }
    if (伪组.子.length) 根.push(伪组);   // 根级尾部：伪组永远排在所有管线之后
    // 闸债 → 节点（数据源 /api/attn，路由随债下发，本层不猜跳哪儿）；顺手记 父键（#9 聚焦要走祖先链）
    const 索 = new Map();
    (function 走(列, 父) { for (const n of 列) { n.父键 = 父 ? 父.键 : null; 索.set(n.键, n); if (n.粒 && n.粒.单号) 索.set(String(n.粒.单号), n); 走(n.子, n); } })(根, null);
    for (const d of (数据.债 || [])) { const n = 索.get(String(d.id)); if (n) n.债.push(d); }
    return { 根, 键表: 索 };
  }

  // 聚合区间（括号条/汇总条）与活跃分支（DS-15：分支内存在 未完成∧计划开始≤今 的工单）——自底向上一趟
  function 铺算(根, 今ms, 单册) {
    const 册 = 单册 || {};
    (function 走(n) {
      let a = Infinity, b = -Infinity, 活 = false, 叶数 = 0;
      const 并 = (s) => { if (s) { a = Math.min(a, s.起); b = Math.max(b, s.讫); } };
      if (n.粒) {
        n.段 = 计划段(n.粒); n.基 = 基线段(n.粒);
        // 实段（2026-08-26 优化包·活条制+史条）：真实执行区间，与计划段并存。
        // 史条＝领单→交付（拼树已卡缺时不进）；活条＝在途单 领单→今，右缘骑今时线随拍长。
        if (n.史) {
          const a2 = 实时毫(n.史.领单), b2 = 实时毫(n.史.交付);
          n.实段 = a2 != null && b2 != null
            ? { 起: a2, 讫: Math.max(b2, a2 + 刻毫), 真讫: Math.max(b2, a2 + 刻毫), 单端: false, 超长: false } : null;
        } else {
          const 单 = n.粒.单号 ? 册[String(n.粒.单号)] : null;
          if (单 && 单.大态 === '在途' && 今ms != null) {
            const 领 = 实时毫(单.领单);
            const 交 = 实时毫(单.交付);
            const a2 = 领 != null ? 领 : (n.段 ? n.段.起 : 今ms - 刻毫);
            // 骑线判定收窄（2026-08-26 制作人起夜点名 185/203 案）：只有**目录态=在途**（真执行中）
            // 才骑今时线生长；初检/质检/核查/仲裁是审检驻留——执行早已交付，条定格在交付时刻，
            // 不许跟着今时线继续变长（那是把「排队等审」画成「还在干活」）。
            if (单.态 === '在途') {
              n.实段 = { 起: Math.min(a2, 今ms), 讫: Math.max(今ms, a2 + 刻毫), 真讫: Math.max(今ms, a2 + 刻毫), 单端: false, 超长: false, 活: true };
            } else if (交 != null) {
              n.实段 = { 起: Math.min(a2, 交), 讫: Math.max(交, a2 + 刻毫), 真讫: Math.max(交, a2 + 刻毫), 单端: false, 超长: false, 定格: true };
            } else n.实段 = null; // 审检驻留却无交付时刻：数据残，不造条（红线）
          } else n.实段 = null;
        }
        并(n.段); 并(n.实段);
        叶数 = 1;
        活 = !!(n.段 && 今ms != null && n.段.起 <= 今ms && !终态.includes(n.粒.状态)) || !!(n.实段 && n.实段.活);
      }
      if (n.自粒) { n.自段 = 计划段(n.自粒); 并(n.自段); }
      for (const k of n.子) { 走(k); 并(k.聚 ? { 起: k.聚.起, 讫: k.聚.讫 } : null); 活 = 活 || k.活; 叶数 += k.叶数; }
      n.聚 = a <= b ? { 起: a, 讫: b } : null;
      n.活 = 活; n.叶数 = 叶数;
    }).call(null, { 子: 根, 粒: null, 自粒: null, 叶数: 0 });
    return 根;
  }

  /* ═══ 折叠（#1/#2/#3/#4）：默认策略＝展开到特性层＋活跃分支到底；localStorage 只存差异集 ═══ */
  function 默认折叠(根) {
    const 折 = new Set();
    (function 走(n) {
      for (const k of n) {
        // 管线恒展；其余（特性/专项/工单父/伪组）展开 ⇔ 分支活跃（#4/DS-15）
        if (k.子.length && k.型 !== '管线' && !k.活) 折.add(k.键);
        走(k.子);
      }
    })(根);
    return 折;
  }
  function 读差异() {
    try { const d = JSON.parse(localStorage.getItem('gt2-fold') || '{}') || {}; return { 折: d.折 || [], 展: d.展 || [] }; }
    catch { return { 折: [], 展: [] }; }
  }
  function 写差异(折叠, 默认) {
    const 折 = [...折叠].filter((k) => !默认.has(k));
    const 展 = [...默认].filter((k) => !折叠.has(k));
    try { localStorage.setItem('gt2-fold', JSON.stringify({ 折, 展 })); } catch { /* 隐私模式等：折叠照用，只是不记 */ }
  }
  function 生效折叠(根, 键表) {
    const 默认 = 默认折叠(根);
    const d = 读差异();
    const 折叠 = new Set(默认);
    for (const k of d.折) if (键表.has(k)) 折叠.add(k);
    for (const k of d.展) 折叠.delete(k);
    return { 折叠, 默认 };
  }

  // 展平：折叠节点自身仍出行（rollup 投影画在它行上），子孙跳过。
  // 聚焦投影（#9）：只出 祖先链+聚焦节点+子孙；祖先链强制展开（折着的支里也能聚到叶子），
  // 但**不改折叠集**——聚焦态与折叠态正交，退出聚焦后折叠原样。
  function 展平(根, 折叠, 聚) {
    const 行 = [];
    (function 走(列, 深) {
      for (const n of 列) {
        if (聚 && !聚.准许.has(n.键)) continue;
        行.push({ 节点: n, 深 });
        if (n.子.length && (!折叠.has(n.键) || (聚 && 聚.链.has(n.键)))) 走(n.子, 深 + 1);
      }
    })(根, 0);
    return 行;
  }

  /* ═══ 虚拟化底座（#15）：固定行高＋可视行选择器，前后各留缓冲 ═══ */
  function 可视范围(滚, 视高, 总行, 缓 = 缓冲行) {
    const a = Math.max(0, Math.floor(滚 / 行高) - 缓);
    const b = Math.min(总行, Math.ceil((滚 + 视高) / 行高) + 缓);
    return [a, b];
  }
  // 离屏依赖端点（P0 桩 → P2 #12 实装）：给行键（节点键/粒ID/单号），回该行在图上的锚点
  // {入x,出x,y,行}（当前可视窗内）或 null（离屏/不在树上）——离屏端点的线画到可视区边缘+方向箭头。
  function 离屏端点(键) {
    const 岛 = 找岛(); if (!岛 || !岛.st) return null;
    const k = String(键);
    const a = 端锚(岛._锚 || 锚点集(岛.st, 岛._行窗 || [0, 岛.st.行.length]), { 键: k, 粒ID: k, 单号: k });
    return a && !a.离屏 ? { 入x: a.入x, 出x: a.出x, y: a.y, 行: a.行 } : null;
  }

  /* ═══ rollup 微型泳道（#17）：≤3 道，越线单永在最上道，溢出聚成密度块 ═══ */
  function 泳道(子列) {
    const 有越 = 子列.some((m) => m.越线);
    const 道尾 = [-Infinity, -Infinity, -Infinity];
    const 分配 = [], 溢出 = [];
    for (const m of [...子列].sort((x, y) => x.起 - y.起)) {
      if (m.越线) { 分配.push({ ...m, 道: 0 }); 道尾[0] = Math.max(道尾[0], m.讫); continue; }
      let 放 = -1;
      for (let i = 有越 ? 1 : 0; i < 3; i++) if (道尾[i] <= m.起) { 放 = i; break; }
      if (放 < 0) { 溢出.push(m); continue; }
      分配.push({ ...m, 道: 放 }); 道尾[放] = m.讫;
    }
    // 溢出按重叠聚簇 → 密度块（数字角标，点击展开）
    const 块 = [];
    for (const m of 溢出) {
      const 尾 = 块[块.length - 1];
      if (尾 && m.起 <= 尾.讫) { 尾.讫 = Math.max(尾.讫, m.讫); 尾.数++; }
      else 块.push({ 起: m.起, 讫: m.讫, 数: 1 });
    }
    return { 分配, 块 };
  }

  /* ═══ 行渲染（纯字符串：签名即 HTML，比对相等则一个字节不碰）═══ */
  // 越线待重判＝服务端下发字段（终审 T2：只画不判）。唯一判处是 lib/pm/schedule.越线待表态判，
  // 随 GET /api/schedule 逐粒下发 待表态:true——计划态/可派视野（单还在待派∕待重派∕已排期才欠，H116）/
  // 停表短路/表态豁免（G23 同一份谓词）全在服务端。岛内原「计划态+开始≤今」私判已删：
  // 「计划态但对应工单已在途」的粒从此不再被岛错标（终审点名的两把尺病例）；翻转下发字段，
  // 越线视觉/角标/菜单/拖拽分流全跟走（判据锁死）。
  const 越线判 = (g) => !!(g && g.待表态 === true);
  const 钻串 = (债) => (债 || []).map((d) => `<button class="gt2gem" data-act="gem" data-r="${esc(d.路由 || '')}"
      title="${esc(`${d.闸号 || ''} ${d.闸名 || ''} · 闸债${d.停摆小时 != null ? ` · 停摆 ${d.停摆小时}h` : ''}\n点击去处置：${d.路由 || ''}`)}">◆</button>`).join('');

  // 四层详情路由＝P0-0 裁决③（名链与右键「跳详情」共用一处，两口一把尺）
  function 详情路由(n) {
    if (n.型 === '管线') return `#/tickets/${n.号}`;
    if (n.型 === '特性' && n.管线) return `#/tickets/${n.管线}/${n.号}`;
    if (n.型 === '专项') return `#/sp/${n.号}`;
    if (n.型 === '工单' && n.粒 && 单号形.test(String(n.粒.单号 || ''))) return `#/t/${n.粒.单号}`;
    return null;
  }
  function 名链(n) {
    // #16 三分工：三角=折叠、名称=详情、条=排期操作。
    const r = 详情路由(n);
    const 名 = esc(n.名 || (n.粒 && n.粒.粒ID) || n.号);
    return r ? `<a class="gt2nm" href="${esc(r)}" title="进${n.型}详情">${名}</a>` : `<span class="gt2nm plain">${名}</span>`;
  }

  // 工期徽章文（#20）：真实工期（超长条也显真 30h——截断只截图，不截事实）
  const 工期文 = (s) => ((s.真讫 - s.起) / 时毫).toFixed(1).replace(/\.0$/, '') + 'h';

  function 行HTML(r, st) {
    const n = r.节点, 窗 = st.窗, 折 = st.折叠.has(n.键) && n.子.length > 0;
    const px = (v) => v.toFixed(1) + 'px';
    const 条宽 = (s) => px(Math.max(3, X(s.讫, 窗) - X(s.起, 窗)));
    const 越行 = n.型 === '工单' && 越线判(n.粒);
    // —— 树列格（grid，无嵌套 flex）——
    // 自由文本单号照样显示（判据⑧：不成链不等于不显示——库里实证有「（无单·直接落码）」形）
    const 显号 = n.型 === '工单' ? String(n.粒.单号 || '') : n.号;
    const tri = n.子.length
      ? `<button class="gt2tri" data-act="tri" data-k="${esc(n.键)}" aria-expanded="${!折}"
          title="折叠/展开（Ctrl+点击＝整支递归）" aria-label="${折 ? '展开' : '折叠'} ${esc(n.名)}">${折 ? '▸' : '▾'}</button>`
      : '<span class="gt2tri leaf"></span>';
    // 树列轻量字段（#20/DS-5）：工单行＝状态色点（按粒状态着色，越线加红点纹）＋工期徽章（Nh）；
    // 聚合行＝子单计数照旧（不挂工期徽章——聚合区间在括号条与悬浮卡，树列不重复报数）
    const 轻 = n.型 === '工单'
      ? `<i class="gt2dot ${状态类[n.粒.状态] || ''}${越行 ? ' xline' : ''}" title="${esc(越行 ? '越线待重判' : n.粒.状态 || '')}"></i>${n.段 ? `<b class="gt2dur">${工期文(n.段)}</b>` : n.实段 ? `<b class="gt2dur">${工期文(n.实段)}</b>` : ''}`
      : (n.子.length ? `${n.叶数} 单` : '');
    const 树格 = `<div class="gt2t" style="padding-left:${8 + r.深 * 16}px">${tri}
      <span class="gt2id mono">${esc(显号)}${n.型 === '专项' ? ' ◈' : ''}</span>${名链(n)}
      <span class="gt2mx mono">${轻}${钻串(n.债)}</span></div>`;
    // —— 时间格 ——
    let 条 = '';
    if (!窗.空) {
      if (折) {
        // 折叠投影（#17）：聚合条完全退场，子孙工单迷你条显影在各自时间位
        const 叶 = [];
        (function 走(x) { if (x.粒 && (x.段 || x.实段)) 叶.push(x); for (const k of x.子) 走(k); })(n);
        const { 分配, 块 } = 泳道(叶.map((x) => {
          const s0 = x.实段 && x.实段.活 ? x.实段 : (x.段 || x.实段); // 活条投影同骑今时线；史条投影用实区间
          return { 键: x.键, 起: s0.起, 讫: s0.讫, 越线: 越线判(x.粒), 完成: x.粒.状态 === '完成' };
        }));
        条 = 分配.map((m) => `<i class="gt2mini${m.越线 ? ' xline' : ''}${m.完成 ? ' done' : ''}" data-tid="${esc(m.键)}" data-act="bar" data-g="${esc(m.键)}"${m.越线 ? ' data-x="1"' : ''}
            data-gid="${esc(m.键)}" data-道="${m.道}" style="left:${px(X(m.起, 窗))};width:${条宽(m)};top:${5 + m.道 * 7}px"></i>`).join('')
          + 块.map((b) => `<button class="gt2dens gt2dense" data-act="dens" data-k="${esc(n.键)}" style="left:${px(X(b.起, 窗))};width:${条宽(b)}"
              title="同时段并发子单 ${b.数} 张（3 道泳道装不下）——点击展开这一支">+${b.数}</button>`).join('');
      } else if (n.型 === '管线' || n.型 === '特性') {
        if (n.聚) 条 = `<i class="gt2brkt ${n.型 === '管线' ? 'lv0' : 'lv1'}" data-tid="${esc(n.键)}" style="left:${px(X(n.聚.起, 窗))};width:${条宽(n.聚)}"></i>`;
      } else if (n.型 === '专项') {
        if (n.自段) 条 += `<i class="gt2spbar" data-tid="${esc(n.键)}" style="left:${px(X(n.自段.起, 窗))};width:${条宽(n.自段)}"></i>`;
        if (n.聚) 条 += `<i class="gt2sum" data-tid="${esc(n.键)}" style="left:${px(X(n.聚.起, 窗))};width:${条宽(n.聚)};top:${n.自段 ? 21 : 13}px"></i>`;
      } else if (n.粒) {
        const g = n.粒, s = n.段, j = g.判定 || null;
        const 越 = 越行;
        const 活条 = n.实段 && n.实段.活;
        if (n.基) 条 += `<i class="gt2base" style="left:${px(X(n.基.起, 窗))};width:${条宽(n.基)}"></i>`;
        // 覆盖式实况条（2026-08-26 制作人拍板）：今时线触到开工后，计划条退成**深色低饱和底层**，
        // 实际用时条以**浅色高饱和覆盖层**叠上——今时线走到哪盖到哪（living 带脉冲，动画只给
        // 正在改变的东西）；落袋定格：提前完＝右侧露出没用完的计划底（省时可视），拖期完＝
        // 盖满并右溢（溢出段同色加深——红仍是服务端超期判定的专色，实况溢出不冒用）。
        // 无计划底的老史单只有覆盖层（没有承诺就没有对照，不造底）。三层语义：
        // 基线影子=最初承诺 · 计划底=现行承诺 · 实际覆盖=事实。
        if (n.实段 && (活条 || n.史 || n.实段.定格)) {
          const 实 = n.实段;
          if (s) 条 += `<i class="gt2planbase${s.超长 ? ' cut' : ''}" style="left:${px(X(s.起, 窗))};width:${条宽(s)}" title="计划承诺区间（底）——实际用时覆盖其上"></i>`;
          const 盖类 = 活条 ? ' living' : (n.史 ? ' hist' : ' set'); // set＝审检驻留定格（已交付候审，静态不脉冲）
          const 述 = 活条
            ? (g.题 || '') + '：执行中，实况 ' + 毫文(实.起) + ' → 今'
            : n.实段.定格
              ? (g.题 || '') + '：已交付候审检，实际 ' + 毫文(实.起) + ' → ' + 毫文(实.讫)
              : (g.题 || '') + '：已落袋，实际 ' + 毫文(实.起) + ' → ' + 毫文(实.讫);
          条 += `<i class="gt2bar gt2real${盖类}" data-tid="${esc(n.键)}"${活条 ? ' data-act="bar" role="button"' : ''} data-g="${esc(g.粒ID)}" tabindex="0"
              aria-label="${esc(述)}" style="left:${px(X(实.起, 窗))};width:${条宽(实)}"></i>`;
          // 溢出加深段：实际用时越过计划讫的那一截（真讫对真讫，截断只截图不截事实）
          if (s && 实.真讫 > s.真讫) {
            const 溢起 = Math.max(s.真讫, 实.起);
            条 += `<i class="gt2real-over${盖类}" data-g="${esc(g.粒ID)}" role="img"
                aria-label="${esc('超用 ' + ((实.真讫 - s.真讫) / 时毫).toFixed(1).replace(/.0$/, '') + ' 小时（实况，非判定）')}"
                title="${esc('超用 ' + ((实.真讫 - s.真讫) / 时毫).toFixed(1).replace(/.0$/, '') + ' 小时：实际用时越过计划讫（实况呈现；红条才是服务端超期判定）')}"
                style="left:${px(X(溢起, 窗))};width:${px(Math.max(2, X(Math.min(实.讫, 实.真讫), 窗) - X(溢起, 窗)))}"></i>`;
          }
          if (活条) {
            const 尾活 = px(X(实.讫, 窗) + 4);
            if (!越 && j && j.需重排) 条 += `<em class="gt2flag od" style="left:${尾活}" title="已超期${j.超期天 != null ? ' ' + j.超期天 + ' 天' : ''}未了结：该重排了">该重排</em>`;
          }
        }
        if (s && !活条 && !n.史) {
          // 越线灰显不标红（重判前不算超期事故）；不越线才按服务端判定挂延期/超期记号
          const 红 = 越 ? '' : `${j && j.超期 ? ' gt2-od' : ''}${j && j.延期 ? ' gt2-late' : ''}`;
          // 红段只消费服务端给出的「超期 + 超期天」：N 天直接换成固定小时轴的 N*24*HW 像素，
          // 不从日期重算。真讫保留了超长条截断前的计划终点，红段才不会接在截断影子后误报。
          const 超期天 = Number(j && j.超期天);
          const 出红段 = !越 && !终态.includes(g.状态) && !!(j && j.超期)
            && Number.isFinite(超期天) && 超期天 > 0;
          // 越线条带 data-x：点击分流到表态口（#19，普通条仍走重排）
          // 可拖（#10）⇔ 非只读（#11 最小实现：停表或终态即只读——不出手柄、拖不启动，悬停详情照常）
          // 且非超长（DS 终审 #2）：>24h 截断条是异常态，图上拖的是截断影子、所见非所提交——
          // 处置走重排弹窗（悬浮卡「超长异常」照旧点名），不走拖拽。
          const 拖ok = !st.停表 && !终态.includes(g.状态) && !s.超长;
          条 += `<i class="gt2bar ${状态类[g.状态] || ''}${s.单端 ? ' half' : ''}${s.超长 ? ' cut gt2cut' : ''}${越 ? ' xline' : ''}${红}${拖ok ? ' drag' : ''}"
              data-tid="${esc(n.键)}" data-act="bar" data-g="${esc(g.粒ID)}"${越 ? ' data-x="1"' : ''} tabindex="0" role="button"
              aria-label="${esc((g.题 || '') + (越 ? '：越线待重判，点击表态（派发/重排二选一）' : '：点击改排期'))}" style="left:${px(X(s.起, 窗))};width:${条宽(s)}">${拖ok
                ? '<b class="gt2h l" title="拉起点：改计划开始（15 分钟吸附）"></b><b class="gt2h r" title="拉讫点：改计划完成（15 分钟吸附）"></b>' : ''}</i>`;
          if (出红段) 条 += `<i class="gt2overdue" data-g="${esc(g.粒ID)}" role="img"
              aria-label="${esc(`超期 ${超期天} 天（服务端判定）`)}" title="${esc(`超期 ${超期天} 天（服务端判定）`)}"
              style="left:${px(X(s.真讫, 窗))};width:${px(超期天 * 24 * HW)}"></i>`;
          const 尾 = px(X(s.讫, 窗) + 4);
          // 徽标（越线＞判定，判定只读服务端下发——无判定不造字）；
          // 待重判标记可点（#19/DS-3）：处置不出甘特页，点它直接弹表态框
          if (越) 条 += `<em class="gt2flag rejudge" data-act="stance" data-g="${esc(g.粒ID)}" role="button" tabindex="0" style="left:${尾}" title="计划开始已过今时线且未表态——点击表态（派发/重排二选一），重判前灰显不标红">待重判</em>`;
          else if (j && j.需重排) 条 += `<em class="gt2flag od" style="left:${尾}" title="已超期${j.超期天 != null ? ' ' + j.超期天 + ' 天' : ''}未了结：该重排了">该重排</em>`;
          else if (j && j.延期) 条 += `<em class="gt2flag late" style="left:${尾}" title="现计划较基线累计后挪 ${j.延期天} 天（服务端判定）">延 ${j.延期天}d</em>`;
        }
      }
    }
    const 格 = `<div class="gt2g" style="width:${窗.空 ? 0 : 窗.宽}px">${条}</div>`;
    // gt2row / data-层 / data-gid / data-缩进 是判据侧（gantt-p0）的抓手标记，与 gt2r/data-k 并挂
    return `<div class="gt2r gt2row lv${型层[n.型]}" id="gt2-row-${esc(n.键)}" role="row" aria-level="${r.深 + 1}"
      data-k="${esc(n.键)}" data-gid="${esc(n.键)}" data-层="${n.型}" data-缩进="${r.深}">${树格}${格}</div>`;
  }

  function 表头HTML(st) {
    const 窗 = st.窗;
    let 时 = '';
    if (!窗.空) {
      for (let h = 0; h < 窗.小时; h += 24) 时 += `<span class="d gt2hd-日" style="left:${h * HW}px">${毫文(窗.t0 + h * 时毫).slice(0, 5)}</span>`;
      let 下 = '';
      for (let h = 0; h < 窗.小时; h += 4) 下 += `<span class="gt2hd-时" style="left:${h * HW}px">${String(new Date(窗.t0 + h * 时毫).getHours()).padStart(2, '0')}:00</span>`; // 本地小时（T9：t0/时毫 的模算是 UTC 位）
      时 = `<div class="t1">${时}</div><div class="t2">${下}</div>`;
      if (st.今ms != null && st.今ms >= 窗.t0 && st.今ms <= 窗.t1) {
        时 += `<i class="gt2now h" style="left:${X(st.今ms, 窗).toFixed(1)}px"><em>今 ${esc(String(st.数据.今 || '').slice(11, 16))}</em></i>`;
      }
    }
    return `<div class="gt2ht">管线 → 特性 → 专项 → 工单</div><div class="gt2hx" style="width:${窗.空 ? 0 : 窗.宽}px">${时}</div>`;
  }

  /* ═══ 悬浮详情卡（#18）：事件委托全局卡，判定字段一律读服务端下发 ═══ */
  function 卡HTML(n, st) {
    const kv = [];
    const 行 = (k, v, c) => kv.push(`<span class="k">${esc(k)}</span><span class="v${c ? ' ' + c : ''}">${esc(v)}</span>`);
    if (n.型 === '工单') {
      const g = n.粒, s = n.段, j = g.判定 || null;
      const 越 = 越线判(g);
      // 单现状（2026-08-26 制作人「覆盖上去只知道已成单，其它都不知道」）：工单态/主办/池 随卡下发，
      // 数据源＝宿主传的 单册（/api/board 全态映射）；查不到如实显缺，不猜。
      const 册 = (st.数据 && st.数据.单册) || {};
      const 单 = g.单号 ? 册[String(g.单号)] : null;
      if (n.史) {
        const 实 = n.实段;
        行('实际', 实 ? `${毫文(实.起)} → ${毫文(实.讫)}` : '—');
        if (实) 行('实工期', ((实.真讫 - 实.起) / 时毫).toFixed(1).replace(/\.0$/, '') + ' 小时');
        // 对计划（2026-08-26 覆盖式实况条）：前端只做减法呈现，不造判定——图上「露底/右溢」的数字版
        if (实 && s) {
          const 差 = (实.真讫 - s.真讫) / 时毫;
          行('对计划', 差 > 0 ? `拖期 ${差.toFixed(1).replace(/\.0$/, '')} 小时（盖满右溢）`
            : `提前 ${(-差).toFixed(1).replace(/\.0$/, '')} 小时（右侧露底）`, 差 > 0 ? 'warn' : '');
        }
        行('现状', 单 ? `${单.态}${单.主办 ? ' · ' + 单.主办 : ''}${单.执行池 ? ' · ' + 单.执行池 : ''}` : (n.史.态 || '已落袋'));
        return `<div class="th"><span class="id mono">${esc(显号于(n))}</span><span class="st ok">${esc(单 ? 单.态 : '已落袋')}</span></div>
          <div class="tt">${esc(g.题 || '')}</div><div class="kv">${kv.join('')}</div>`;
      }
      const 态 = 越 ? ['late', '越线待重判'] : g.状态 === '完成' ? ['ok', '完成'] : ['run', (单 && 单.态) || g.状态 || ''];
      if (单) 行('现状', `${单.态}${单.主办 ? ' · ' + 单.主办 : ''}${单.执行池 ? ' · ' + 单.执行池 : ''}`, 单.大态 === '在途' ? 'warn' : '');
      if (n.实段 && n.实段.活) 行('实况', `${毫文(n.实段.起)} → 今（已 ${((n.实段.讫 - n.实段.起) / 时毫).toFixed(1).replace(/\.0$/, '')} 小时）`);
      else if (n.实段 && n.实段.定格) 行('实际', `${毫文(n.实段.起)} → ${毫文(n.实段.讫)}（已交付，候审检）`);
      行('计划', `${时点文(g.计划开始)} → ${时点文(g.计划完成)}`);
      if (s) 行('工期', ((s.真讫 - s.起) / 时毫).toFixed(1).replace(/\.0$/, '') + ' 小时' + (s.单端 ? '（单端）' : ''));
      行('基线', g.基线开始 || g.基线完成 ? `${时点文(g.基线开始)} → ${时点文(g.基线完成)}` : '未立');
      // 偏差与需重排＝服务端判定字段（DS-1）：不下发就显「—」，前端不算 e−基线；
      // 延期/超期两格独立并列（判据⑦：服务端说超期就得显超期，不许被延期一格挤掉）
      行('偏差', j ? ([j.延期 ? `延期 ${j.延期天} 天` : null, j.超期 ? `超期 ${j.超期天} 天` : null]
        .filter(Boolean).join(' · ') || '—') : '—', j && (j.延期 || j.超期) ? 'warn' : '');
      行('需重排', j ? (j.需重排 ? '是' : '否') : '—', j && j.需重排 ? 'warn' : '');
      // 依赖区（终审 T6）：粒.依赖 冻结形是 {ref,规则} 对象（lib/pm/schedule.规范依赖），
      // 整对象 String() 只会印 [object Object]——按 d.ref 解析：粒ID/单号都在 键表（拼树两口都登记），
      // 命中即渲染「单号 题名（规则）」；解析不到（悬空/树外）如实标，不冒充。esc 由 行() 统一转义。
      for (const d of ([].concat(g.依赖 || []))) {
        const ref = d && typeof d === 'object' ? String(d.ref == null ? '' : d.ref) : String(d == null ? '' : d);
        const 规则 = d && typeof d === 'object' && d.规则 ? String(d.规则) : '';
        const t = ref ? st.键表.get(ref) : null;
        行('依赖', t
          ? `${显号于(t)}${t.名 ? ' ' + t.名 : ''}${规则 ? `（${规则}）` : ''}`
          : `${ref || '(空引用)'}（悬空${规则 ? '·' + 规则 : ''}）`);
      }
      const 徽 = `<span class="st ${态[0]}">${esc(态[1])}</span>${s && s.超长 ? '<span class="st late">超长异常</span>' : ''}`;
      const 注 = s && s.超长 ? `<div class="note">工期超过 24h：图上截断到 24h（⋯），此处为真实区间——制度上小时级任务不该有这种条，走人闸处置</div>` : '';
      return `<div class="th"><span class="id mono">${esc(显号于(n))}</span>${徽}</div><div class="tt">${esc(g.题 || '')}</div><div class="kv">${kv.join('')}</div>${注}`;
    }
    let 完 = 0, 越 = 0, 数 = 0;
    (function 走(x) {
      if (x.粒) { 数++; if (x.粒.状态 === '完成') 完++; if (越线判(x.粒)) 越++; }
      for (const k of x.子) 走(k);
    })(n);
    if (n.聚) 行('区间', `${毫文(n.聚.起)} → ${毫文(n.聚.讫)}`);
    行('子单', `${数} 张（完成 ${完}${越 ? ' · 越线 ' + 越 : ''}）`);
    if (n.自段) 行('自身计划', `${时点文(n.自粒.计划开始)} → ${时点文(n.自粒.计划完成)}`);
    return `<div class="th"><span class="id mono">${esc(n.号)}</span><span class="st run">${esc(n.型)}聚合</span></div>
      <div class="tt">${esc(n.名)}</div><div class="kv">${kv.join('')}</div>`;
  }
  const 显号于 = (n) => (n.粒 && 单号形.test(String(n.粒.单号 || '')) ? n.粒.单号 : (n.粒 ? n.粒.粒ID : n.号));

  /* ═══ 数据规范（对齐 gantt-p0 判据的入参形，integration 前先把便宜的对齐做掉）═══
     判据侧（test/gantt-p0.test.js.pending）约定 数据={管线,特性,专项,粒,边,判定,board单}、
     选项={现在,视口}；宿主（app.js）给的是 {…,名册,板归属,今,停表,债,项目}。两形都收：
     board单（/api/board 原形）→ 板归属 归属格；判定 索引 → 补到缺 判定 的粒上（不改入参原件）。 */
  function 规范数据(数据, 选项) {
    const d = { ...(数据 || {}) };
    if (!d.今 && 选项 && 选项.现在) d.今 = 选项.现在;
    if (!d.板归属 && d.board单) {
      const m = {};
      for (const s of Object.keys(d.board单)) {
        for (const t of (d.board单[s] || [])) m[t.id] = { 特性: t.特性 || null, 专项: t.专项 || null, 管线: t.管线 || null };
      }
      d.板归属 = m;
    }
    if (d.判定) d.粒 = (d.粒 || []).map((g) => (!g.判定 && d.判定[g.粒ID]) ? { ...g, 判定: d.判定[g.粒ID] } : g);
    return d;
  }

  /* ═══ 状态装配（纯，无 DOM——判据面：_测.试渲染 走的就是这一条）═══ */
  // 聚焦键（#9）：可选。有效时投影＝祖先链+聚焦节点+子孙；键在数据里找不到（粒被删/改名）即失焦回全量。
  function 建状态(数据, 聚焦键, 最少小时) {
    const 今点 = 解时(数据.今);
    const 今ms = 今点 ? 今点.ms : null;
    // 史况（2026-08-26 优化包）：三档过滤在拼树前做——藏档的史条根本不进树；
    // 缺时单永不进图，单独挂账（总/画/藏/缺时 四数工具栏如实报，无声截断是判过死刑的病）。
    const 全史 = Array.isArray(数据.史单) ? 数据.史单 : [];
    const 缺时 = 全史.filter((h) => 实时毫(h.领单) == null || 实时毫(h.交付) == null);
    const 可画 = 全史.filter((h) => 实时毫(h.领单) != null && 实时毫(h.交付) != null);
    const 档 = 完档读();
    const 入图史 = 史过滤(可画, 档, 今ms);
    const { 根, 键表 } = 拼树(全史.length ? { ...数据, 史单: 入图史 } : 数据);
    铺算(根, 今ms, 数据.单册);
    const { 折叠, 默认 } = 生效折叠(根, 键表);
    let 聚 = null;
    if (聚焦键 != null && 键表.has(String(聚焦键))) {
      const 焦 = 键表.get(String(聚焦键));
      const 准许 = new Set(), 链 = new Set();
      for (let p = 焦; p.父键 != null && 键表.has(p.父键);) { p = 键表.get(p.父键); 准许.add(p.键); 链.add(p.键); }
      (function 走(x) { 准许.add(x.键); for (const k of x.子) 走(k); })(焦);
      聚 = { 键: 焦.键, 名: 焦.名 || 焦.号, 准许, 链 };
    }
    const 行 = 展平(根, 折叠, 聚);
    const 点 = [];
    (function 走(x) {
      if (x.粒) { if (x.段) 点.push(x.段.起, x.段.讫); if (x.基) 点.push(x.基.起, x.基.讫); if (x.实段) 点.push(x.实段.起, x.实段.讫); }
      if (x.自段) 点.push(x.自段.起, x.自段.讫);
      for (const k of x.子) 走(k);
    })({ 子: 根 });
    if (今ms != null) 点.push(今ms);
    // 窗按全树算不按投影算（#9「全局树不销毁只淡出」）：聚焦切换时时间轴不跳
    return { 数据, 根, 键表, 行, 折叠, 默认, 今ms, 停表: !!数据.停表, 窗: 算窗(点, 最少小时), 聚焦: 聚,
      史况: { 总: 全史.length, 画: 入图史.length, 藏: 可画.length - 入图史.length, 缺时: 缺时.map((h) => String(h.单号 || '')), 档 } };
  }
  function 试渲染(数据, 视口, 选项) {
    const st = 建状态(规范数据(数据, 选项), null, 选项 && 选项.视口 && 选项.视口.宽小时);
    const v = 视口 || { 滚: 0, 高: Infinity };
    const [a, b] = 可视范围(v.滚, v.高, st.行.length);
    return { 状态: st, 可视: [a, b], 表头: 表头HTML(st), 图例: 图例HTML(), html: st.行.slice(a, b).map((r) => 行HTML(r, st)).join('') };
  }

  function 图例HTML() {
    return '<span class="gt2legend"><i class="gt2legend-overdue" aria-hidden="true"></i>红条＝超期（服务端判定）</span>';
  }

  /* ═══ DOM 装配与增量重绘（key→节点 Map＋行签名＝行 HTML 串，spike A 甲案）═══ */
  function render(容器, 数据, 选项) {
    if (!容器) return;
    let 岛 = 容器._gt2;
    if (岛 && 岛.根el && 岛.根el.isConnected) {
      末岛 = 岛; 岛.选项 = 选项 || 岛.选项;
      const d = 规范数据(数据, 岛.选项);
      // #10/DS-6：拖拽进行中一律不重绘（30s 轮询在壳层已挂旗跳过，这里兜其余入口）——
      // 新数据存着，松手（收拖）后补一拍，既不丢更新也不打断手上的条。
      if (岛._拖) { 岛._拖后数据 = d; return 岛; }
      岛._拖后数据 = null;   // DS#1：新数据直落即最新事实，取消拖拽遗留的挂起件作废（防恢复可见时旧盖新）
      岛.数据 = d; 重排(岛); return 岛;
    }
    岛 = 容器._gt2 = 末岛 = { 容器, 数据: null, 选项: 选项 || {}, 图: new Map(), st: null };
    岛.数据 = 规范数据(数据, 岛.选项);
    容器.innerHTML = `<div class="gt2" tabindex="-1">
      <div class="gt2bar-tools" role="toolbar" aria-label="甘特工具">
        <span class="gt2grp"><i class="gt2lab">折到</i><button data-act="fold" data-lv="1">1 管线</button><button data-act="fold" data-lv="2">2 特性</button><button data-act="fold" data-lv="3">3 专项</button><button data-act="fold" data-lv="4">4 工单</button></span>
        <span class="gt2grp"><button data-act="today" title="快捷键 T：横滚到今时线并闪一下">◎ 回到今天</button></span>
        <span class="gt2grp"><i class="gt2lab">已完</i><button data-act="done" data-v="近" title="只画最近 24 小时内落袋的史条（默认档）">近完24h</button><button data-act="done" data-v="全" title="项目开始至今全部史条">全部</button><button data-act="done" data-v="无" title="图上不画史条">不留</button></span>
        <span class="gt2grp"><input class="gt2search mono" type="search" placeholder="单号 / YYYY-MM-DD" aria-label="搜索定位"
          title="回车或点定位：单号→展开滚到该行并高亮；日期→横滚到那一天"><button data-act="search" title="定位单号或日期在图上的位置">定位</button></span>
        <span class="gt2histnote subnote" hidden></span>
        <button class="gt2xbadge" data-act="xnext" hidden title="越线待重判计数（#19）——点击滚到下一张越线行，逐个处置">越线 0</button>
        <button class="gt2cbadge" data-act="cnext" hidden title="依赖冲突计数（#12/DS-7，服务端 边统计.冲突）——点击定位下一条冲突线，逐个处置">冲突 0</button>
        ${图例HTML()}
        <span class="gt2note subnote">固定小时轴 ${HW}px/h · 数字键 1-4 折层 · 右键有菜单 · ⋯＝超 24h 截断（悬浮看真实区间）· 拖条身平移/拉端点改起讫（15 分钟吸附）</span>
      </div>
      <div class="gt2crumb" hidden></div>
      <div class="gt2stopband" hidden>产线关闭中 · 停表</div>
      <div class="gt2wrap" role="region" aria-label="四层甘特图" tabindex="0">
        <div class="gt2cv"><div class="gt2head gt2hd"></div><div class="gt2body"><i class="gt2gridbg"></i><i class="gt2now b" hidden></i><svg class="gt2deps" aria-hidden="true"></svg></div></div>
      </div>
      <div class="gt2empty gtempty" hidden></div>
      <div class="gt2debt" hidden></div>`;
    岛.根el = 容器.firstElementChild;
    岛.wrap = 岛.根el.querySelector('.gt2wrap');
    岛.head = 岛.根el.querySelector('.gt2head');
    岛.body = 岛.根el.querySelector('.gt2body');
    岛.卡 = document.createElement('div'); 岛.卡.className = 'gt2tip'; 岛.根el.appendChild(岛.卡);
    岛.菜 = document.createElement('div'); 岛.菜.className = 'gt2menu'; 岛.根el.appendChild(岛.菜); // #8 自绘右键菜单（fixed 定位防出屏）
    岛.拖tip = document.createElement('div'); 岛.拖tip.className = 'gt2dragtip'; 岛.根el.appendChild(岛.拖tip); // #10 拖拽悬浮时间提示
    岛.线 = 岛.根el.querySelector('.gt2deps'); // #12 依赖线全局 SVG 层
    挂事件(岛);
    重排(岛);
    return 岛;
  }
  function 更新(数据) {
    const 岛 = 找岛(); if (!岛) return;
    const d = 规范数据(数据, 岛.选项);
    if (岛._拖) { 岛._拖后数据 = d; return; } // 同 render：拖拽中挂起，松手补一拍
    岛._拖后数据 = null;   // 同 render（DS#1）：直落的新数据作废取消拖拽遗留的挂起件
    岛.数据 = d; 重排(岛);
  }
  // 程序口按「末次 render 的岛」兜底（gantt-p0 判据约定：headless 容器没有 rl-gantt id 也得能调）
  let 末岛 = null;
  let 已挂resize = false; // T8 单例分发旗：全模块只挂一个 resize 监听（见 挂事件）
  let 已挂可见 = false;   // DS#1 单例分发旗：全模块只挂一个 visibilitychange 监听（见 挂事件）
  let 已挂今走 = false;   // 今时线分钟自走单例旗
  function 找岛() { const box = document.getElementById('rl-gantt'); return (box && box._gt2) || 末岛; }

  function 重排(岛) {
    const 焦 = 记焦点(岛);
    关菜单(岛); // 数据/结构一变，悬着的菜单就是对着旧图开的——先收
    // 铺满视口下限：真浏览器量 wrap 可用宽（headless 沙箱 clientWidth 恒 0 → 不扩，判据经 选项.视口.宽小时 注入）
    const 满 = (岛.选项 && 岛.选项.视口 && 岛.选项.视口.宽小时) ||
      (岛.wrap && 岛.wrap.clientWidth ? Math.ceil((岛.wrap.clientWidth - 树宽) / HW) : 0);
    岛.st = 建状态(岛.数据, 岛.聚焦, 满);
    if (岛.聚焦 && !岛.st.聚焦) 岛.聚焦 = null; // 聚焦的节点已不在数据里：失焦回全量（会话态，不持久化）
    const st = 岛.st, 空 = !st.行.length || st.窗.空;
    岛.根el.querySelector('.gt2stopband').hidden = !st.停表;
    // 面包屑（#9）：全部 › <节点名> ✕退出（Esc 同效）
    const 屑 = 岛.根el.querySelector('.gt2crumb');
    if (屑) {
      if (st.聚焦) {
        屑.hidden = false;
        屑.innerHTML = `<button class="gt2mi" data-act="m-unfocus" title="退出聚焦，回全量树">全部</button><i>›</i><b>${esc(st.聚焦.名)}</b>
          <button class="gt2crumb-x" data-act="m-unfocus" title="Esc 同效">✕ 退出聚焦</button>`;
      } else { 屑.hidden = true; 屑.innerHTML = ''; }
    }
    // 越线计数角标（#19）：计全树不计投影——折叠/聚焦藏得住行，藏不住债
    let 越数 = 0;
    (function 走(x) { if (x.粒 && 越线判(x.粒)) 越数++; for (const k of x.子) 走(k); })({ 子: st.根, 粒: null });
    const 标 = 岛.根el.querySelector('.gt2xbadge');
    if (标) { 标.hidden = !越数; 标.setAttribute('data-数', String(越数)); 标.textContent = '越线 ' + 越数; }
    // 冲突角标（#12/DS-7）＝服务端 边统计.冲突——线着色读逐边字段、角标读统计字段，两格都不前端私算
    const 统 = 岛.数据.边统计 || null;
    const 冲数 = 统 && 统.冲突 != null ? Number(统.冲突) : 0;
    const c标 = 岛.根el.querySelector('.gt2cbadge');
    if (c标) { c标.hidden = !冲数; c标.setAttribute('data-数', String(冲数)); c标.textContent = '冲突 ' + 冲数; }
    // 三档已完视野按钮态 + 史况角标（2026-08-26 优化包）：画/藏/缺时如实报数——
    // 藏是档位选的（可切回），缺时是数据缺真时刻（计数不画，为图造数红线的挂账面）。
    岛.根el.querySelectorAll('[data-act="done"]').forEach((b) => { // className 直赋不走 classList（minidom 判据沙箱无它，成例同 关菜单 的 className 正则）
      b.className = b.dataset.v === (st.史况 && st.史况.档) ? 'on' : '';
    });
    const 史注 = 岛.根el.querySelector('.gt2histnote');
    if (史注) {
      const 况 = st.史况 || { 总: 0, 画: 0, 藏: 0, 缺时: [] };
      const 缺 = (况.缺时 || []).length;
      史注.hidden = !况.总 && !缺;
      史注.textContent = (况.总 || 缺) ? `史 ${况.画}/${况.总}${况.藏 ? ` · 藏 ${况.藏}` : ''}${缺 ? ` · 缺时 ${缺}` : ''}` : '';
      史注.setAttribute('data-画', String(况.画)); 史注.setAttribute('data-缺时', String(缺));
      史注.title = 缺 ? '缺真实起讫时刻、计数不画（不拿创建日冒充执行区间）：' + 况.缺时.slice(0, 12).join('、') + (缺 > 12 ? '…' : '') : '';
    }
    const 空框 = 岛.根el.querySelector('.gt2empty');
    空框.hidden = !空;
    岛.wrap.hidden = 空;
    if (空) {
      空框.innerHTML = '甘特图上没有可画的行——四层树是空的，或没有一粒待办排过日期。排期入口在下方欠账区（列着每一条没排期的活；待办队列已随 2026-08-26 裁定拆除）。';
      岛.图.clear(); 岛.body.querySelectorAll('.gt2r').forEach((e) => e.remove());
      if (岛.线) 岛.线.innerHTML = '';
      return;
    }
    const cv = 岛.根el.querySelector('.gt2cv');
    cv.style.width = (树宽 + st.窗.宽) + 'px';
    cv.style.height = (头高 + st.行.length * 行高) + 'px';
    岛.body.style.height = (st.行.length * 行高) + 'px';
    岛.body.setAttribute('data-总行数', String(st.行.length)); // #15：可见树行全量（虚拟滚动高度依据）
    // 欠账区（.gt2debt，判据抓手）：未排期粒逐条列名挂账。宿主 app.js 自己在壳层画带按钮的欠账区，
    // 传 选项.欠账区=false 关掉这一块免得一账两列；判据/独立装载时默认开。
    const 债块 = 岛.根el.querySelector('.gt2debt');
    if (债块) {
      const 欠 = 岛.选项.欠账区 === false ? [] : (岛.数据.粒 || []).filter((g) => g.型 !== '专项' && !g.计划开始 && !g.计划完成);
      债块.hidden = !欠.length;
      债块.innerHTML = 欠.length ? `<b>未排期 ${欠.length} 条</b>` + 欠.map((g) =>
        `<button class="gt2debtrow" data-act="bar" data-g="${esc(g.粒ID)}" title="点击排期">${esc(g.题 || g.粒ID)}</button>`).join('') : '';
    }
    岛.head.innerHTML = 表头HTML(st);
    const bg = 岛.body.querySelector('.gt2gridbg');
    bg.style.width = st.窗.宽 + 'px';
    摆今线(岛);
    画行(岛);
    还焦点(岛, 焦);
  }

  function 画行(岛) {
    const st = 岛.st; if (!st || st.窗.空) return;
    // 可视窗：选项.视口={滚过行,行数} 优先（headless 判据无真实布局量测，DS-2/CX-7 约定注入），
    // 否则按滚动容器真量测。两条路走的是同一个 可视范围 选择器。
    const 视 = 岛.选项.视口;
    const [a, b] = 视
      ? 可视范围((Number(视.滚过行) || 0) * 行高, (Number(视.行数) || 40) * 行高, st.行.length)
      : 可视范围(Math.max(0, 岛.wrap.scrollTop - 头高), 岛.wrap.clientHeight || 480, st.行.length);
    const 留 = new Set();
    const tpl = document.createElement('template');
    for (let i = a; i < b; i++) {
      const r = st.行[i], 键 = r.节点.键;
      留.add(键);
      const html = 行HTML(r, st);
      const 旧 = 岛.图.get(键);
      if (旧 && 旧.签 === html && 旧.el.isConnected) { 旧.el.style.top = (i * 行高) + 'px'; continue; }
      tpl.innerHTML = html;
      const el = tpl.content.firstElementChild;
      el.style.top = (i * 行高) + 'px';
      if (旧 && 旧.el.isConnected) 旧.el.replaceWith(el); else 岛.body.appendChild(el);
      岛.图.set(键, { 签: html, el });
    }
    for (const [键, v] of 岛.图) if (!留.has(键)) { v.el.remove(); 岛.图.delete(键); }
    岛._行窗 = [a, b];
    画线(岛); // #12：行几何与可视窗一变（重排/虚拟滚动换窗/resize），依赖线同步重绘（DS-11）
  }

  const 记焦点 = (岛) => {
    const f = document.activeElement;
    if (!f || !岛.根el.contains(f)) return null;
    const 行 = f.closest && f.closest('.gt2r');
    return 行 ? { 键: 行.dataset.k, act: f.dataset && f.dataset.act } : null;
  };
  const 还焦点 = (岛, 焦) => {
    if (!焦 || (document.activeElement && 岛.根el.contains(document.activeElement))) return;
    const 行 = document.getElementById('gt2-row-' + 焦.键);
    const el = 行 && (焦.act ? 行.querySelector(`[data-act="${焦.act}"]`) : null) || 行 && 行.querySelector('[data-act],a') || 行;
    if (el && el.focus) el.focus();
  };

  /* ═══ 交互（#1/#2/#7/#14/#16）═══ */
  function 存重画(岛) { 写差异(岛.st.折叠, 岛.st.默认); 重排(岛); }
  function 折切(岛, 键, 递归) {
    const st = 岛.st, n = st.键表.get(键); if (!n || !n.子.length) return;
    const 开 = st.折叠.has(键);
    const 施 = (x) => { if (!x.子.length) return; if (开) st.折叠.delete(x.键); else st.折叠.add(x.键); if (递归) x.子.forEach(施); };
    施(n);
    存重画(岛);
  }
  function 折到层(岛, lv) {
    const st = 岛.st;
    st.折叠.clear();
    (function 走(列) { for (const n of 列) { if (n.子.length && 型层[n.型] >= lv - 1) st.折叠.add(n.键); 走(n.子); } })(st.根);
    存重画(岛);
  }
  /* 今时线摆位与分钟自走（2026-08-24 制作人验收所指两病一修）：
     ① body 竖线在 .gt2body 坐标系（0 起），时间几何 X() 是时间区坐标（280 树宽之后）——
        原先漏加 树宽，线画进树列右缘的假时刻位（表头徽章父容器 .gt2hx 自带 left:280px 故无恙）；
     ② 今时线不进 30s 轮询签名（粒ID|状态|版本号），数据不变永不重绘，今线冻在末次渲染时刻——
        今时线是墙钟不是数据，60s 单例自走（同 resize 成例经 找岛 分发），越出窗界才全量重排。 */
  function 摆今线(岛) {
    const st = 岛.st; if (!st || st.窗.空) return;
    const 今线 = 岛.body.querySelectorAll('.gt2now')[0];
    if (!今线) return;
    if (st.今ms != null && st.今ms >= st.窗.t0 && st.今ms <= st.窗.t1) {
      今线.hidden = false; 今线.style.left = (树宽 + X(st.今ms, st.窗)).toFixed(1) + 'px';
    } else 今线.hidden = true;
  }
  function 走今(岛, 注入串) {                            // 注入串＝判据的假钟口，生产不传走真钟
    const st = 岛.st; if (!st || st.窗.空) return;
    const 今串 = 注入串 || 毫钟面(Date.now());
    if (st.数据.今 === 今串) return;                       // 分钟未跳，不动
    st.数据.今 = 今串; 岛.数据.今 = 今串;
    const 点 = 解时(今串); st.今ms = 点 ? 点.ms : null;
    if (st.今ms != null && st.今ms > st.窗.t1) { 重排(岛); return; }  // 滚出窗右缘：重算窗
    摆今线(岛);
    const 徽 = 岛.head.querySelectorAll('.gt2now')[0];
    if (徽) { 徽.style.left = X(st.今ms, st.窗).toFixed(1) + 'px';
      const em = 徽.querySelector('em'); if (em) em.textContent = '今 ' + 今串.slice(11, 16); }
  }
  function 回今(岛) {
    const st = 岛.st; if (!st || st.窗.空 || st.今ms == null) return;
    岛.wrap.scrollTo({ left: Math.max(0, 树宽 + X(st.今ms, st.窗) - 岛.wrap.clientWidth / 2), behavior: 'smooth' });
    岛.根el.querySelectorAll('.gt2now').forEach((l) => {
      if (l.animate) l.animate([{ opacity: 1 }, { opacity: .15 }, { opacity: 1 }, { opacity: .15 }, { opacity: 1 }], { duration: 900 });
    });
  }

  /* ═══ 聚焦模式（#9）：会话态不持久化——聚焦是「现在只看这一支」，不是折叠那种工作习惯 ═══ */
  function 设聚焦(岛, 键) { 岛.聚焦 = 键 == null ? null : String(键); 重排(岛); }

  /* ═══ 右键两区菜单（#8）：行上/条上/空白，菜单项按上下文出现 ═══ */
  // 造菜单＝菜单内容的唯一产地（H104 判据面：程序口 菜单Html 与 contextmenu 处理器走的是同一条）
  const 层名 = ['管线', '特性', '专项', '工单'];
  function 造菜单(st, 种类, id) {
    const B = (act, attrs, 文) => `<button class="gt2mi" data-act="${act}"${attrs || ''}>${文}</button>`;
    const 空白菜 = () => B('m-expand', '', '全部展开') + B('m-collapse', '', '全部折叠') + B('m-today', '', '回到今天（T）');
    if (种类 === '空白' || id == null) return 空白菜();
    const n = st.键表.get(String(id));
    if (!n) return 空白菜();
    if (种类 === '条') {
      // 条上两分：越线待重判条→表态（强制二选一，不给普通重排口绕），普通条→重排；终态条只留跳详情
      const g = n.粒 || (n.型 === '专项' ? n.自粒 : null);
      let h = '';
      if (g && !终态.includes(g.状态)) {
        h += (n.粒 && 越线判(g))
          ? B('m-stance', ` data-g="${esc(g.粒ID)}"`, '表态：派发 / 重排（越线强制二选一）')
          : B('m-replan', ` data-g="${esc(g.粒ID)}"`, '重排（改计划起讫，必带因）');
      }
      const r = 详情路由(n);
      if (r) h += B('m-goto', ` data-r="${esc(r)}"`, `跳${n.型}详情`);
      return h || 空白菜();
    }
    // 行上：折叠此支（叶子行没有）/折到N层/聚焦此分支/跳详情/改期（有粒且非终态才有）
    let h = '';
    if (n.子.length) h += B('m-fold', ` data-k="${esc(n.键)}"`, st.折叠.has(n.键) ? '展开此支' : '折叠此支');
    h += `<div class="gt2mrow"><i>折到</i>${[1, 2, 3, 4].map((lv) =>
      `<button class="gt2mi lv" data-act="m-foldlv" data-lv="${lv}" title="同数字键 ${lv}">${lv} ${层名[lv - 1]}</button>`).join('')}</div>`;
    h += B('m-focus', ` data-k="${esc(n.键)}"`, '聚焦此分支');
    const r = 详情路由(n);
    if (r) h += B('m-goto', ` data-r="${esc(r)}"`, `跳${n.型}详情`);
    const g = n.粒 || n.自粒;
    if (g && !终态.includes(g.状态)) {
      h += (n.粒 && 越线判(g))
        ? B('m-stance', ` data-g="${esc(g.粒ID)}"`, '表态：派发 / 重排（越线）')
        : B('m-replan', ` data-g="${esc(g.粒ID)}"`, '改期（重排，必带因）');
      // 编依赖入口随待办队列拆除迁到此（2026-08-26）：能力不随区块陪葬；史条伪粒（史:前缀）不给
      if (!n.史) h += B('m-editdeps', ` data-g="${esc(g.粒ID)}"`, '编依赖（前置，CAS 留痕）');
    }
    return h;
  }
  function 开菜单(岛, x, y, html) {
    const 菜 = 岛.菜; if (!菜 || !html) return;
    菜.innerHTML = html;
    菜.className = 'gt2menu show'; // 不走 classList：headless 判据环境的 El 只有 className（判据装载约定）
    // fixed 定位防出屏：先量再摆，右缘/下缘各留 8px
    const W = window.innerWidth || 1280, H = window.innerHeight || 800;
    菜.style.left = Math.max(4, Math.min(x, W - (菜.offsetWidth || 220) - 8)) + 'px';
    菜.style.top = Math.max(4, Math.min(y, H - (菜.offsetHeight || 160) - 8)) + 'px';
    if (!岛._菜哨 && typeof document.addEventListener === 'function') {
      岛._菜哨 = (ev) => { if (!菜.contains(ev.target)) 关菜单(岛); }; // 点别处关闭
      document.addEventListener('mousedown', 岛._菜哨, true);
    }
  }
  function 关菜单(岛) {
    if (岛.菜) { 岛.菜.className = 'gt2menu'; 岛.菜.innerHTML = ''; }
    if (岛._菜哨 && typeof document.removeEventListener === 'function') {
      document.removeEventListener('mousedown', 岛._菜哨, true); 岛._菜哨 = null;
    }
  }

  /* ═══ 越线定位（#19 角标）：点一下滚到下一张越线行（折叠行里的越线显影也算靶）═══ */
  /* ═══ 搜索定位（2026-08-26 优化包·制作人「搜工单号和日期看在甘特图上的位置」）═══
     单号/节点键 → 展开祖先链滚到该行并闪；日期（YYYY-MM-DD）→ 横滚到那天并闪今线族同款高亮。
     返回 {中:'行'|'日'} 或 null（无命中——输入框抖一下如实报没有，不静默）。 */
  function 定位(岛, 词) {
    const st = 岛.st; if (!st) return null;
    const q = String(词 == null ? '' : 词).trim();
    if (!q) return null;
    // 滚动兜底：判据沙箱（minidom）无 scrollTo 方法，直赋 scrollTop/Left（真浏览器走 smooth）
    const 滚 = (o) => { if (岛.wrap.scrollTo) 岛.wrap.scrollTo({ ...o, behavior: 'smooth' });
      else { if (o.top != null) 岛.wrap.scrollTop = o.top; if (o.left != null) 岛.wrap.scrollLeft = o.left; } };
    const n = st.键表.get(q) || st.键表.get(q.toUpperCase());
    if (n) {
      // 祖先链强制展开（否则行不在投影里滚不到）；写差异同 折切 纪律
      let 改 = false;
      for (let p = n; p && p.父键 != null && st.键表.has(p.父键);) { p = st.键表.get(p.父键); if (st.折叠.delete(p.键)) 改 = true; }
      if (改) 存重画(岛); // 存重画 会重建 st——按键重找行索引
      const st2 = 岛.st;
      const 键 = n.键;
      const i = st2.行.findIndex((r) => r.节点.键 === 键);
      if (i < 0) return null;
      const m = st2.行[i].节点;
      const s = m.实段 || m.段 || m.聚 || m.自段;
      滚({ top: Math.max(0, i * 行高 - 120),
        left: s && !st2.窗.空 ? Math.max(0, 树宽 + X(s.起, st2.窗) - 240) : 岛.wrap.scrollLeft });
      const el = document.getElementById('gt2-row-' + m.键);
      if (el && el.animate) el.animate([{ background: 'rgba(255,200,60,.35)' }, { background: 'transparent' }], { duration: 1400 });
      return { 中: '行', 键: m.键 };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(q)) {
      const p = 解时(q); if (!p || st.窗.空) return null;
      if (p.ms < st.窗.t0 || p.ms > st.窗.t1) return null; // 窗外日期＝图上没有这一天，如实无命中
      滚({ left: Math.max(0, 树宽 + X(p.ms + 12 * 时毫, st.窗) - 岛.wrap.clientWidth / 2) });
      岛.根el.querySelectorAll('.gt2hd-日').forEach((d) => {
        if (d.textContent === q.slice(5) && d.animate) d.animate([{ opacity: 1 }, { opacity: .1 }, { opacity: 1 }], { duration: 900 });
      });
      return { 中: '日', 日: q };
    }
    return null;
  }
  function 搜一把(岛) {
    const 框 = 岛.根el.querySelector('.gt2search');
    if (!框) return;
    const r = 定位(岛, 框.value);
    if (!r && 框.animate) 框.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 240 });
  }

  function 越线定位(岛) {
    const st = 岛.st; if (!st) return;
    const 有越 = (x) => (x.粒 && 越线判(x.粒)) || x.子.some(有越);
    const 靶 = [];
    st.行.forEach((r, i) => {
      const n = r.节点;
      const 折 = st.折叠.has(n.键) && n.子.length > 0;
      if ((n.粒 && 越线判(n.粒)) || (折 && n.子.some(有越))) 靶.push(i);
    });
    if (!靶.length) return;
    岛._越游 = ((岛._越游 == null ? -1 : 岛._越游) + 1) % 靶.length;
    const i = 靶[岛._越游], n = st.行[i].节点;
    const s = n.段 || n.聚;
    岛.wrap.scrollTo({
      top: Math.max(0, i * 行高 - 120),
      left: s && !st.窗.空 ? Math.max(0, 树宽 + X(s.起, st.窗) - 240) : 岛.wrap.scrollLeft,
      behavior: 'smooth',
    });
    const el = document.getElementById('gt2-row-' + n.键);
    if (el && el.animate) el.animate([{ opacity: 1 }, { opacity: .25 }, { opacity: 1 }, { opacity: .25 }, { opacity: 1 }], { duration: 800 });
  }

  /* ═══ 依赖线（#12）：岛内全局 SVG 层（绝对定位盖时间区，pointer-events:none），只画不判——
     冲突/环/外部一律读服务端下发字段（lib/pm/schedule-edges 冻结形，/api/schedule 增发），
     前端一格都不自算：翻转下发字段，线就得跟着变（判据④锁死）。 ═══ */
  function 边表(数据) { const b = 数据 && 数据.边; return Array.isArray(b) ? b : []; }
  // 锚点缓存 key→{入x,出x,y,行,离屏}（DS-11）：树行里有段的行才有锚；节点键与单号都作 key。
  // 出点＝条右端中点、入点＝条左端中点（施工令 #12 原文）；y 按行几何（行高恒定）恒等推得。
  function 锚点集(st, 行窗) {
    const 锚 = new Map();
    const 放 = (键, 粒, a) => {
      if (!锚.has(键)) 锚.set(键, a);
      if (粒 && 粒.单号 && !锚.has(String(粒.单号))) 锚.set(String(粒.单号), a);
    };
    for (let i = 0; i < st.行.length; i++) {
      const n = st.行[i].节点;
      const 离屏 = i < 行窗[0] ? '上' : (i >= 行窗[1] ? '下' : null);
      const s = n.段 || n.自段;
      if (s) 放(n.键, n.粒, { 入x: X(s.起, st.窗), 出x: X(s.讫, st.窗), y: i * 行高 + 行高 / 2, 行: i, 离屏 });
      // 折叠行聚合桩（终审 T5）：折叠分支的叶子不占整行，但迷你条仍显影在本行各自时间位——
      // 依赖锚随之建在本行（x=叶子自己的段几何、y=行中线，与迷你泳道同高区），默认折叠态下
      // 分支内/跨分支依赖线照样可表达；单端边（悬空/跨项目）锚得住可见端，外部端点语义原样。
      // 删掉这一段，默认折叠的 S-2 六条边整组消失（gantt-p2 判据④默认态断言锁死）。
      if (st.折叠.has(n.键) && n.子.length) {
        (function 走(x) {
          if (x !== n && x.粒 && x.段) 放(x.键, x.粒, { 入x: X(x.段.起, st.窗), 出x: X(x.段.讫, st.窗), y: i * 行高 + 行高 / 2, 行: i, 离屏 });
          for (const k of x.子) 走(k);
        })(n);
      }
    }
    return 锚;
  }
  const 端锚 = (锚, 端) => (端 ? (锚.get(String(端.粒ID || '')) || 锚.get(String(端.单号 || '')) || 锚.get(String(端.键 || '')) || null) : null);
  // 三次贝塞尔（施工令 #12 原文）：k = dx≥24 ? clamp(dx/2,12,32) : min(44, 12+(24−dx)·0.45)——
  // 常规平缓 S 形，相接/倒挂时柄随贴近程度加长、曲线外鼓绕行不打结；两控制点与端点同高
  // ⇒ 出入切向水平；同行顺排（|dy|<1 且 dx>0）退化直线。
  function 贝塞尔(x1, y1, x2, y2) {
    const dx = x2 - x1;
    if (Math.abs(y2 - y1) < 1 && dx > 0) return `M${x1},${y1} L${x2},${y2}`;
    const k = dx >= 24 ? Math.max(12, Math.min(32, dx / 2)) : Math.min(44, 12 + (24 - dx) * 0.45);
    return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`;
  }
  function 线HTML(st, 行窗, 锚) {
    const 边 = 边表(st.数据);
    if (!边.length || st.窗.空 || !st.行.length) return '';
    const f = (v) => String(+(+v).toFixed(1));
    const 上缘 = 行窗[0] * 行高 + 3, 下缘 = 行窗[1] * 行高 - 3;
    const out = [];
    for (let i = 0; i < 边.length; i++) {
      const e = 边[i];
      const A = 端锚(锚, e.from), B = 端锚(锚, e.to);
      if (!A && !B) continue;                        // 两端都不在树上：无处可挂
      if ((!A || A.离屏) && (!B || B.离屏)) continue; // 整条在可视窗外（离屏聚合只救单端）
      // 着色只按服务端字段（CX-3/DS-1）：冲突=红、环=虚线+环组 title、外部=半截线家族
      const cls = 'gtedge' + (e.冲突 === true ? ' conflict' : '') + (e.环 ? ' cyc' : '') + (e.外部 ? ' ext' : '');
      const 词 = e.冲突因 || e.外部因 || (e.环 ? `环组 ${e.环组}：循环依赖（服务端判定）` : `${e.规则 || ''}${e.源 ? ' · ' + e.源 : ''}`);
      let x1, y1, x2, y2, d; const 饰 = [];
      if (A) { x1 = A.出x; y1 = A.离屏 ? (A.离屏 === '上' ? 上缘 : 下缘) : A.y; }
      if (B) { x2 = B.入x; y2 = B.离屏 ? (B.离屏 === '上' ? 上缘 : 下缘) : B.y; }
      if (!A) {
        // 前置不可见/外部（含 外:悬空）：半截线+空心端点符，向岛缘一侧收 36px（#12 乙式兜底）
        x1 = Math.max(0, x2 - 36); y1 = y2;
        d = `M${f(x1)},${f(y1)} L${f(x2)},${f(y2)}`;
        饰.push(`<circle class="hollow" cx="${f(x1)}" cy="${f(y1)}" r="3"/>`);
        饰.push(`<path class="arw" d="M${f(x2)},${f(y2)} l-6,-3.5 l0,7 z"/>`);
      } else if (!B) {
        x2 = Math.min(st.窗.宽, x1 + 36); y2 = y1;
        d = `M${f(x1)},${f(y1)} L${f(x2)},${f(y2)}`;
        饰.push(`<circle class="dot" cx="${f(x1)}" cy="${f(y1)}" r="2.5"/>`);
        饰.push(`<circle class="hollow" cx="${f(x2)}" cy="${f(y2)}" r="3"/>`);
      } else {
        d = 贝塞尔(+f(x1), +f(y1), +f(x2), +f(y2));
        // 起点圆点贴条缘、终点箭头水平指入；离屏端换方向箭头（线画到可视区边缘，#15 聚合桩语义）
        饰.push(A.离屏 ? `<path class="offarw" d="M${f(x1)},${f(y1)} l-4,${A.离屏 === '上' ? '6' : '-6'} l8,0 z"/>`
          : `<circle class="dot" cx="${f(x1)}" cy="${f(y1)}" r="2.5"/>`);
        饰.push(B.离屏 ? `<path class="offarw" d="M${f(x2)},${f(y2)} l-4,${B.离屏 === '上' ? '6' : '-6'} l8,0 z"/>`
          : `<path class="arw" d="M${f(x2)},${f(y2)} l-6,-3.5 l0,7 z"/>`);
      }
      out.push(`<g class="${cls}" data-边="${i}" data-from="${esc(e.from && e.from.键)}" data-to="${esc(e.to && e.to.键)}"><title>${esc(词)}</title><path class="ln" d="${d}"/>${饰.join('')}</g>`);
    }
    return out.join('');
  }
  function 画线(岛) {
    const svg = 岛.线; if (!svg) return;
    const st = 岛.st;
    if (!st || st.窗.空 || !边表(st.数据).length) { svg.innerHTML = ''; 岛._锚 = null; 岛._行窗 = null; return; } // 锚与行窗同清（DS 终审 #10）：半新半旧的缓存对 离屏端点 是错位源，null 走全量重建兜底
    const 行窗 = 岛._行窗 || [0, st.行.length];
    const 锚 = 岛._锚 = 锚点集(st, 行窗);
    const 高 = st.行.length * 行高;
    svg.setAttribute('width', String(Math.max(1, Math.round(st.窗.宽))));
    svg.setAttribute('height', String(Math.max(1, 高)));
    svg.setAttribute('style', `left:${树宽}px;width:${st.窗.宽}px;height:${高}px`);
    svg.innerHTML = 线HTML(st, 行窗, 锚);
  }
  // 悬停联动（#12）：悬停任一条时其上下游线点亮（挂 P0 悬浮卡委托里，默认淡色退后台）
  function 亮线(岛, n) {
    const svg = 岛.线; if (!svg || !svg.children) return;
    const 中 = (v) => !!(v != null && n && (v === n.键
      || (n.粒 && n.粒.单号 && (v === String(n.粒.单号) || v === '单:' + n.粒.单号))));
    for (const g of [...svg.children]) {
      if (!g.getAttribute) continue;
      const 类 = (g.getAttribute('class') || '').replace(/ ?\blit\b/, '');
      g.setAttribute('class', (n && (中(g.getAttribute('data-from')) || 中(g.getAttribute('data-to')))) ? 类 + ' lit' : 类);
    }
  }
  // 冲突定位（#12/DS-7 角标落点）：点一下滚到下一条冲突线的可锚端，循环轮转（同 越线定位 的成例）
  function 冲突定位(岛) {
    const st = 岛.st; if (!st || st.窗.空) return;
    const 锚 = 岛._锚 || 锚点集(st, [0, st.行.length]);
    const 靶 = [];
    for (const e of 边表(st.数据)) {
      if (e.冲突 !== true) continue;
      const B = 端锚(锚, e.to) || 端锚(锚, e.from);
      if (B) 靶.push(B);
    }
    if (!靶.length) return;
    岛._冲游 = ((岛._冲游 == null ? -1 : 岛._冲游) + 1) % 靶.length;
    const B = 靶[岛._冲游];
    岛.wrap.scrollTo({ top: Math.max(0, B.行 * 行高 - 120), left: Math.max(0, 树宽 + B.入x - 240), behavior: 'smooth' });
    const el = document.getElementById('gt2-row-' + (st.行[B.行] && st.行[B.行].节点.键));
    if (el && el.animate) el.animate([{ opacity: 1 }, { opacity: .25 }, { opacity: 1 }, { opacity: .25 }, { opacity: 1 }], { duration: 800 });
  }

  /* ═══ 拖拽两路分流（#10）＋只读态（#11）═══
     计算与分流全走下面这三个落点（可拖判/拖几何/拖分流）——鼠标路（起拖/拖动/收拖）与
     程序口（试拖，判据②③直调）共用同一条产线，H104 验的就是行为本体。 */
  // 只读（#11 最小实现）：停表（/api/gates paused）或粒终态 ⇒ 拖不启动（手柄在 行HTML 同判据不出）；
  // 超长（>24h 截断，DS 终审 #2）同禁：异常态处置走重排弹窗，截断影子上的拖拽所见非所提交。
  function 可拖判(st, n) {
    return !!(n && n.型 === '工单' && n.粒 && n.段 && !n.段.超长 && !st.停表 && !终态.includes(n.粒.状态));
  }
  // 松手分流：普通条→重排口预填、越线待重判条→表态口预填（决定=重排+新计划）——
  // 弹窗与写口都在壳层（app.js tqReplan/tqStance，CAS+必填因原样），岛只递 粒ID+预填。
  // 取消/失败一律原位回滚：岛数据从头到尾没动过，重绘即回滚。
  function 拖分流(岛, 粒ID, r) {
    const st = 岛.st, n = st && st.键表.get(String(粒ID));
    if (!n || !n.粒) return null;
    const 起串 = 毫钟面(r.起), 讫串 = 毫钟面(r.讫);
    if (越线判(n.粒)) {
      const 预填 = { 决定: '重排', 新计划开始: 起串, 新计划完成: 讫串, 拖拽: true };
      if (typeof window.tqStance === 'function') window.tqStance(n.粒.粒ID, 预填);
      return { 口: '表态', 粒ID: n.粒.粒ID, 预填 };
    }
    const 预填 = { 计划开始: 起串, 计划完成: 讫串, 拖拽: true };
    if (typeof window.tqReplan === 'function') window.tqReplan(n.粒.粒ID, 预填);
    return { 口: '重排', 粒ID: n.粒.粒ID, 预填 };
  }
  // 程序口（判据②③直调；也是排障入口）：给 粒ID+模式+像素位移，跑完整条拖拽管线
  function 试拖(粒ID, 模式, dx像素) {
    const 岛 = 找岛(); if (!岛 || !岛.st) return { 启动: false, 因: '无岛' };
    const n = 岛.st.键表.get(String(粒ID));
    if (!可拖判(岛.st, n)) {
      return { 启动: false, 因: !n || !n.粒 ? '非工单行' : (岛.st.停表 ? '停表只读' : (终态.includes(n.粒.状态) ? '终态只读' : (n.段 && n.段.超长 ? '超长禁拖' : '无段'))) };
    }
    const r = 拖几何(n.段, String(模式 || '移'), Number(dx像素) || 0);
    if (r.起 === n.段.起 && r.讫 === n.段.真讫) return { 启动: true, 变: false };
    return { 启动: true, 变: true, ...拖分流(岛, String(粒ID), r) };
  }
  function 起拖(岛, e) {
    if (e.button !== 0 || !岛.st || 岛._拖) return;
    const bar = e.target.closest && e.target.closest('.gt2bar');
    if (!bar || !bar.dataset.g) return;
    const n = 岛.st.键表.get(String(bar.dataset.g));
    if (!可拖判(岛.st, n)) return;   // 只读态（#11）：拖拽不启动
    const h = e.target.closest && e.target.closest('.gt2h');
    e.preventDefault();
    const D = 岛._拖 = { 键: n.键, 粒ID: n.粒.粒ID, 模式: h ? (/\bl\b/.test(h.className) ? '左' : '右') : '移',
      起x: e.clientX, bar, 段: n.段, 新: null };
    window._gt2Dragging = true;      // DS-6：拖拽期间挂起 30s 轮询重绘（app.js pollLoop 见旗跳过）
    if (bar.classList) bar.classList.add('dragging');
    D.动 = (ev) => 拖动(岛, ev); D.收 = () => 收拖(岛);
    document.addEventListener('mousemove', D.动);
    document.addEventListener('mouseup', D.收);
  }
  function 拖动(岛, e) {
    const D = 岛._拖; if (!D) return;
    const r = D.新 = 拖几何(D.段, D.模式, e.clientX - D.起x);
    const 窗 = 岛.st.窗;
    const l = X(r.起, 窗);
    D.bar.style.left = l.toFixed(1) + 'px';   // 半透明跟随（.dragging 样式管透明度）
    D.bar.style.width = Math.max(3, X(Math.min(r.讫, r.起 + 天毫), 窗) - l).toFixed(1) + 'px'; // 图上仍守 24h 截断
    const tip = 岛.拖tip;
    if (tip) {   // 悬浮时间提示：刻钟吸附实时显示——所见即所提交
      tip.textContent = `${毫钟面(r.起).replace('T', ' ')} → ${毫钟面(r.讫).replace('T', ' ')}`;
      tip.className = 'gt2dragtip show';
      tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY - 34) + 'px';
    }
  }
  // 摘拖（公共收尾）：摘 document 监听、清全局旗与提示、把被拖过内联样式的那一行扔出签名图
  //（岛数据没动过，重画即原位回滚）。返回拖账 D 给两条出路：收拖=松手分流、取消拖=DS#1 可见性补给。
  function 摘拖(岛) {
    const D = 岛._拖; if (!D) return null;
    岛._拖 = null;
    document.removeEventListener('mousemove', D.动);
    document.removeEventListener('mouseup', D.收);
    window._gt2Dragging = false;
    if (岛.拖tip) 岛.拖tip.className = 'gt2dragtip';
    const 旧 = 岛.图.get(D.键);
    if (旧) { 岛.图.delete(D.键); if (旧.el && 旧.el.remove) 旧.el.remove(); }
    return D;
  }
  function 收拖(岛) {
    const D = 摘拖(岛); if (!D) return;
    if (岛._拖后数据) { 岛.数据 = 岛._拖后数据; 岛._拖后数据 = null; 重排(岛); } // 拖拽期挂起的更新补一拍
    else 画行(岛);   // 原位回滚（#10）：岛数据没动过，按数据重画即是回滚
    const r = D.新;
    if (!r || (r.起 === D.段.起 && r.讫 === D.段.真讫)) return;   // 没挪就不弹（原地松手＝取消）
    岛._拖动过 = true;   // 吞掉随 mouseup 补发的那记 click——分流已开弹窗，别再叠一个普通口
    拖分流(岛, D.粒ID, r);
  }
  // 取消拖（DS 终审 #1）：页面转不可见时的强制收手——只回滚不分流（拖一半没有「默认成交」）；
  // 拖拽期挂起的 _拖后数据 不在这儿消化（不可见时重排是白画），留给恢复可见那拍补。
  function 取消拖(岛) {
    if (!摘拖(岛)) return;
    画行(岛);
  }

  function 挂事件(岛) {
    岛.根el.addEventListener('click', (e) => {
      if (岛._拖动过) { 岛._拖动过 = false; return; } // #10：拖完松手补发的那记 click 不作数（分流已开弹窗）
      const b = e.target.closest('[data-act]'); if (!b || !岛.根el.contains(b)) return;
      const act = b.dataset.act;
      const 去 = (fn) => { 关菜单(岛); fn(); }; // 菜单项点完即收
      if (act === 'tri') 折切(岛, b.dataset.k, e.ctrlKey || e.metaKey);
      else if (act === 'dens') { 岛.st.折叠.delete(b.dataset.k); 存重画(岛); }
      else if (act === 'fold') 折到层(岛, +b.dataset.lv || 4);
      else if (act === 'today') 回今(岛);
      else if (act === 'done') { 完档写(b.dataset.v); 重排(岛); } // 三档已完视野（2026-08-26 优化包）
      else if (act === 'search') 搜一把(岛);
      else if (act === 'xnext') 越线定位(岛);
      else if (act === 'cnext') 冲突定位(岛);
      else if (act === 'gem') { e.stopPropagation(); if (b.dataset.r) location.hash = b.dataset.r; }
      // 条点击分流（#19）：越线条（data-x）→ 表态弹窗，普通条 → 重排弹窗（两窗都在 app.js 壳层）
      else if (act === 'bar' || act === 'stance') {
        const g = b.dataset.g; if (!g) return;
        const 表态口 = (act === 'stance' || b.dataset.x) && typeof window.tqStance === 'function';
        if (表态口) window.tqStance(g);
        else if (typeof window.tqReplan === 'function') window.tqReplan(g);
      }
      // 右键菜单项（#8）：落点全是既有实体（折切/折到层/设聚焦/回今/tqReplan/tqStance）
      else if (act === 'm-fold') 去(() => 折切(岛, b.dataset.k, false));
      else if (act === 'm-foldlv') 去(() => 折到层(岛, +b.dataset.lv || 4));
      else if (act === 'm-focus') 去(() => 设聚焦(岛, b.dataset.k));
      else if (act === 'm-unfocus') 去(() => 设聚焦(岛, null));
      else if (act === 'm-goto') 去(() => { if (b.dataset.r) location.hash = b.dataset.r; });
      else if (act === 'm-replan') 去(() => { if (b.dataset.g && typeof window.tqReplan === 'function') window.tqReplan(b.dataset.g); });
      else if (act === 'm-editdeps') 去(() => { if (b.dataset.g && typeof window.tqEditDeps === 'function') window.tqEditDeps(b.dataset.g); });
      else if (act === 'm-stance') 去(() => { if (b.dataset.g && typeof window.tqStance === 'function') window.tqStance(b.dataset.g); });
      else if (act === 'm-expand') 去(() => { 岛.st.折叠.clear(); 存重画(岛); });
      else if (act === 'm-collapse') 去(() => 折到层(岛, 1));
      else if (act === 'm-today') 去(() => 回今(岛));
    });
    // #10 拖拽起手：条身=平移、端点手柄(.gt2h)=改起/讫；只读态（#11）在 起拖 里不启动
    岛.根el.addEventListener('mousedown', (e) => 起拖(岛, e));
    // 中键平移（2026-08-25 制作人拍板：横滚条去掉，中键拖拽——游戏编辑器的母语，同 TK-50 镜头手感）。
    // 全向（横+纵），左键拖条/右键菜单零冲突；preventDefault 阻 Windows 中键 autoscroll。
    岛.根el.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      const wrap = 岛.wrap; if (!wrap) return;
      e.preventDefault();
      const 起 = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
      let 动过 = false;
      wrap.style.cursor = 'grabbing';
      const 移 = (ev) => {
        const dx = ev.clientX - 起.x, dy = ev.clientY - 起.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) 动过 = true;
        wrap.scrollLeft = 起.l - dx; wrap.scrollTop = 起.t - dy;
      };
      const 收 = () => {
        document.removeEventListener('mousemove', 移); document.removeEventListener('mouseup', 收);
        wrap.style.cursor = '';
        if (动过) { const 拦 = (ce) => { ce.preventDefault(); ce.stopPropagation(); };
          document.addEventListener('auxclick', 拦, { once: true, capture: true }); } // 拖过就不算中键点击（防误开树列链接）
      };
      document.addEventListener('mousemove', 移); document.addEventListener('mouseup', 收);
    });
    // #12：视口尺寸一变可视窗跟着变，行与依赖线同步重绘（DS-11）。
    // 单例分发（终审 T8）：模块级只挂**一个** resize 监听，事件时经 找岛() 分发到活岛——
    // 原先每建一岛挂一个匿名闭包且无注销口，反复进出页面积攒已脱离的岛与整份台账（内存漏）；
    // 单例不捕获任何岛引用，旧岛随 末岛 换代即可回收。判据：连续两次挂载后 resize 监听计数=1。
    if (!已挂resize && typeof window.addEventListener === 'function') {
      已挂resize = true;
      window.addEventListener('resize', () => {
        const 活 = 找岛();
        if (活 && 活.根el && 活.根el.isConnected && 活.st) 画行(活);
      });
    }
    // 拖拽可见性补给（DS 终审 #1）：后台标签页里 mouseup 送不到（事件冻结），_gt2Dragging 悬 true
    // ⇒ 30s 轮询无限期挂起。visibilitychange 单例（同 T8 resize 成例，事件时经 找岛() 分发）：
    // 转不可见时若在拖拽中 ⇒ 取消拖拽（原位回滚、清旗、不分流）；恢复可见时若拖拽期挂起过
    // 数据（_拖后数据）补一拍重绘——轮询错过的那拍不丢。
    if (!已挂可见 && typeof document.addEventListener === 'function') {
      已挂可见 = true;
      document.addEventListener('visibilitychange', () => {
        const 活 = 找岛(); if (!活) return;
        const 藏 = document.hidden === true || document.visibilityState === 'hidden';
        if (藏) { if (活._拖) 取消拖(活); }
        else if (!活._拖 && 活._拖后数据) { 活.数据 = 活._拖后数据; 活._拖后数据 = null; 重排(活); }
      });
    }
    // 今时线分钟自走单例（同上成例；setInterval 不用 rAF——后台冻结的教训同喂岛）
    if (!已挂今走 && typeof setInterval === 'function') {
      已挂今走 = true;
      setInterval(() => {
        const 活 = 找岛();
        if (活 && 活.根el && 活.根el.isConnected && 活.st && !活._拖) 走今(活);
      }, 60000);
    }
    // #8 右键两区菜单：岛容器一个 contextmenu 委托——条上（实条/迷你条）＞行上＞空白
    岛.根el.addEventListener('contextmenu', (e) => {
      if (!岛.st) return;
      const 条 = e.target.closest && e.target.closest('.gt2bar,.gt2mini');
      const 行 = e.target.closest && e.target.closest('.gt2r');
      const html = 条 && 条.dataset.g ? 造菜单(岛.st, '条', 条.dataset.g)
        : 行 ? 造菜单(岛.st, '行', 行.dataset.k)
          : 造菜单(岛.st, '空白', null);
      if (!html) return;
      e.preventDefault();
      开菜单(岛, e.clientX, e.clientY, html);
    });
    // #14 最小集：快捷键挂岛内（岛里有焦点才响应），输入框/IME 组合一律放行
    岛.根el.addEventListener('keydown', (e) => {
      if (e.isComposing || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      // Esc 两段收：先收菜单，再退聚焦（#8/#9）
      if (e.key === 'Escape') {
        if (岛.菜 && /\bshow\b/.test(岛.菜.className)) { e.preventDefault(); 关菜单(岛); }
        else if (岛.聚焦) { e.preventDefault(); 设聚焦(岛, null); }
        return;
      }
      if (e.key === 'Enter' && e.target.dataset && (e.target.dataset.act === 'bar' || e.target.dataset.act === 'stance')) { e.preventDefault(); e.target.click(); return; }
      // 搜索框护栏（2026-08-26 优化包）：框内敲「TK-201」的数字不许被 1-4 折层快捷键劫走；回车＝定位
      if (e.target && e.target.classList && e.target.classList.contains('gt2search')) {
        if (e.key === 'Enter') { e.preventDefault(); 搜一把(岛); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '4') { e.preventDefault(); 折到层(岛, +e.key); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); 回今(岛); }
    });
    岛.wrap.addEventListener('scroll', () => {
      关菜单(岛); // 菜单是对着点下去那一刻的坐标开的，一滚就不作数
      if (岛._滚订) return;
      岛._滚订 = requestAnimationFrame ? requestAnimationFrame(() => { 岛._滚订 = 0; 画行(岛); }) : (画行(岛), 0);
    }, { passive: true });
    // 悬浮卡：mouseover 委托 + mousemove 跟随，出屏收边
    岛.根el.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tid]');
      if (!t || !岛.根el.contains(t)) { 岛.卡.classList.remove('show'); 亮线(岛, null); return; }
      const n = 岛.st && 岛.st.键表.get(t.dataset.tid);
      if (!n) return;
      岛.卡.innerHTML = 卡HTML(n, 岛.st);
      岛.卡.classList.add('show');
      亮线(岛, n); // #12：悬停条时其上下游依赖线点亮（默认淡色退后台）
      摆卡(岛, e);
    });
    岛.根el.addEventListener('mouseleave', () => { 岛.卡.classList.remove('show'); 亮线(岛, null); });
    岛.根el.addEventListener('mousemove', (e) => { if (岛.卡.classList.contains('show')) 摆卡(岛, e); });
  }
  function 摆卡(岛, e) {
    岛.卡.style.left = Math.min(e.clientX + 14, (window.innerWidth || 1200) - 岛.卡.offsetWidth - 12) + 'px';
    岛.卡.style.top = Math.min(e.clientY + 16, (window.innerHeight || 800) - 岛.卡.offsetHeight - 12) + 'px';
  }

  // 程序口（gantt-p0/p1 判据约定：事件处理器的落点实体，判据直接调不模拟点击）
  function 切折叠(id) { const 岛 = 找岛(); if (岛 && 岛.st) 折切(岛, String(id), false); }
  function 悬浮卡Html(粒ID) {
    const 岛 = 找岛(); if (!岛 || !岛.st) return '';
    const n = 岛.st.键表.get(String(粒ID));
    return n ? 卡HTML(n, 岛.st) : '';
  }
  // P1 程序口：聚焦/退出聚焦＝右键「聚焦此分支」与面包屑 ✕ 的落点；
  // 菜单Html＝contextmenu 处理器造菜单的同一条产线（判据①断的就是它，不模拟右键）。
  function 聚焦(id) { const 岛 = 找岛(); if (岛 && 岛.st) 设聚焦(岛, id); }
  function 退出聚焦() { const 岛 = 找岛(); if (岛 && 岛.st) 设聚焦(岛, null); }
  function 菜单Html(种类, id) {
    const 岛 = 找岛(); if (!岛 || !岛.st) return '';
    return 造菜单(岛.st, 种类, id == null ? null : String(id));
  }

  window.GanttIsland = {
    render, 更新, 切折叠, 悬浮卡Html, 离屏端点, 聚焦, 退出聚焦, 菜单Html,
    试拖, // P2 程序口：鼠标松手（收拖）分流的同一条产线，判据②③直调不模拟鼠标
    // 判据面（H104：验行为不 grep 源码）：纯函数出口，node 沙箱直调断结构
    _测: { 拼树, 铺算, 建状态, 试渲染, 展平, 默认折叠, 可视范围, 泳道, 段, 算窗, 行HTML, 表头HTML, 走今, 行高, HW, 树宽, 头高,
      吸附, 像素毫, 毫钟面, 拖几何, 可拖判, 贝塞尔, 锚点集, 线HTML, 刻毫,
      史过滤, 实时毫, 完档读, 定位, 卡HTML }, // 2026-08-26 优化包判据面：三档/活条/史条/搜索/悬浮现状
  };
})();
