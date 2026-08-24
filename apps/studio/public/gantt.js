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
// P1/P2 留接口不留死代码：右键菜单/聚焦/越线处置弹窗/拖拽/依赖线一律不在本文件；
// 依赖线（P2）需要的离屏端点聚合只留一个桩（离屏端点），数据.边 原样存着不画。
(function () {
  'use strict';

  /* ═══ 常量与小工具 ═══ */
  const 行高 = 30, HW = 20, 树宽 = 280, 头高 = 46, 缓冲行 = 10;
  const 时毫 = 3600000, 天毫 = 86400000, 刻毫 = 900000;
  const 终态 = ['完成', '撤销'];
  const 单号形 = /^[A-Za-z]+-\d+$/;   // P0-0 裁决③：过形才成链（库里实证有「（无单·直接落码）」自由文本）
  const 状态类 = { 计划: 'plan', 起草中: 'draft', 已成单: 'made', 完成: 'done', 撤销: 'drop' };
  const 型层 = { 管线: 0, 特性: 1, 专项: 2, 工单: 3, 伪组: 0 };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ═══ 分钟几何（岛内自足，口径同旧 H112 分钟几何：本地钟面串 → 时区无关毫秒算术）═══ */
  const 解时 = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v == null ? '' : v));
    return m ? { ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)), 含时: m[4] != null } : null;
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
  // 时间窗＝计划/基线极值 ∪ 今，整日取齐（表头日界与 4h 网格因此天然对齐），两侧各留 1h 再取整。
  function 算窗(点们) {
    const 点 = 点们.filter((x) => x != null);
    if (!点.length) return { 空: true };
    const t0 = Math.floor((Math.min.apply(null, 点) - 时毫) / 天毫) * 天毫;
    const t1 = Math.ceil((Math.max.apply(null, 点) + 时毫) / 天毫) * 天毫;
    const 小时 = Math.round((t1 - t0) / 时毫);
    return { 空: false, t0, t1, 小时, 宽: 小时 * HW };
  }
  const X = (ms, 窗) => ((ms - 窗.t0) / 时毫) * HW;
  const 毫文 = (ms) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
  const 时点文 = (v) => { const p = 解时(v); return p ? (p.含时 ? String(v).slice(5, 16).replace('T', ' ') : String(v).slice(5, 10)) : '未定'; };

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
    if (伪组.子.length) 根.push(伪组);   // 根级尾部：伪组永远排在所有管线之后
    // 闸债 → 节点（数据源 /api/attn，路由随债下发，本层不猜跳哪儿）
    const 索 = new Map();
    (function 走(列) { for (const n of 列) { 索.set(n.键, n); if (n.粒 && n.粒.单号) 索.set(String(n.粒.单号), n); 走(n.子); } })(根);
    for (const d of (数据.债 || [])) { const n = 索.get(String(d.id)); if (n) n.债.push(d); }
    return { 根, 键表: 索 };
  }

  // 聚合区间（括号条/汇总条）与活跃分支（DS-15：分支内存在 未完成∧计划开始≤今 的工单）——自底向上一趟
  function 铺算(根, 今ms) {
    (function 走(n) {
      let a = Infinity, b = -Infinity, 活 = false, 叶数 = 0;
      const 并 = (s) => { if (s) { a = Math.min(a, s.起); b = Math.max(b, s.讫); } };
      if (n.粒) {
        n.段 = 计划段(n.粒); n.基 = 基线段(n.粒); 并(n.段);
        叶数 = 1;
        活 = !!(n.段 && 今ms != null && n.段.起 <= 今ms && !终态.includes(n.粒.状态));
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

  // 展平：折叠节点自身仍出行（rollup 投影画在它行上），子孙跳过
  function 展平(根, 折叠) {
    const 行 = [];
    (function 走(列, 深) {
      for (const n of 列) {
        行.push({ 节点: n, 深 });
        if (n.子.length && !折叠.has(n.键)) 走(n.子, 深 + 1);
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
  // 离屏依赖端点聚合桩（P2 依赖线用；本期只定接口）：给行键，回该行在图上的锚点或 null（离屏）。
  function 离屏端点() { return null; }

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
  const 越线判 = (g, s, 今ms, 停表) => !!(!停表 && 今ms != null && g && g.状态 === '计划' && s && s.起 <= 今ms);
  const 钻串 = (债) => (债 || []).map((d) => `<button class="gt2gem" data-act="gem" data-r="${esc(d.路由 || '')}"
      title="${esc(`${d.闸号 || ''} ${d.闸名 || ''} · 闸债${d.停摆小时 != null ? ` · 停摆 ${d.停摆小时}h` : ''}\n点击去处置：${d.路由 || ''}`)}">◆</button>`).join('');

  function 名链(n) {
    // #16 三分工：三角=折叠、名称=详情、条=排期操作。四层路由＝P0-0 裁决③。
    let r = null;
    if (n.型 === '管线') r = `#/tickets/${n.号}`;
    else if (n.型 === '特性' && n.管线) r = `#/tickets/${n.管线}/${n.号}`;
    else if (n.型 === '专项') r = `#/sp/${n.号}`;
    else if (n.型 === '工单' && n.粒 && 单号形.test(String(n.粒.单号 || ''))) r = `#/t/${n.粒.单号}`;
    const 名 = esc(n.名 || (n.粒 && n.粒.粒ID) || n.号);
    return r ? `<a class="gt2nm" href="${esc(r)}" title="进${n.型}详情">${名}</a>` : `<span class="gt2nm plain">${名}</span>`;
  }

  function 行HTML(r, st) {
    const n = r.节点, 窗 = st.窗, 折 = st.折叠.has(n.键) && n.子.length > 0;
    const px = (v) => v.toFixed(1) + 'px';
    const 条宽 = (s) => px(Math.max(3, X(s.讫, 窗) - X(s.起, 窗)));
    // —— 树列格（grid，无嵌套 flex）——
    // 自由文本单号照样显示（判据⑧：不成链不等于不显示——库里实证有「（无单·直接落码）」形）
    const 显号 = n.型 === '工单' ? String(n.粒.单号 || '') : n.号;
    const tri = n.子.length
      ? `<button class="gt2tri" data-act="tri" data-k="${esc(n.键)}" aria-expanded="${!折}"
          title="折叠/展开（Ctrl+点击＝整支递归）" aria-label="${折 ? '展开' : '折叠'} ${esc(n.名)}">${折 ? '▸' : '▾'}</button>`
      : '<span class="gt2tri leaf"></span>';
    const 树格 = `<div class="gt2t" style="padding-left:${8 + r.深 * 16}px">${tri}
      <span class="gt2id mono">${esc(显号)}${n.型 === '专项' ? ' ◈' : ''}</span>${名链(n)}
      <span class="gt2mx mono">${n.子.length ? `${n.叶数} 单` : ''}${钻串(n.债)}</span></div>`;
    // —— 时间格 ——
    let 条 = '';
    if (!窗.空) {
      if (折) {
        // 折叠投影（#17）：聚合条完全退场，子孙工单迷你条显影在各自时间位
        const 叶 = [];
        (function 走(x) { if (x.粒 && x.段) 叶.push(x); for (const k of x.子) 走(k); })(n);
        const { 分配, 块 } = 泳道(叶.map((x) => ({
          键: x.键, 起: x.段.起, 讫: x.段.讫,
          越线: 越线判(x.粒, x.段, st.今ms, st.停表), 完成: x.粒.状态 === '完成',
        })));
        条 = 分配.map((m) => `<i class="gt2mini${m.越线 ? ' xline' : ''}${m.完成 ? ' done' : ''}" data-tid="${esc(m.键)}" data-act="bar" data-g="${esc(m.键)}"
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
        const 越 = 越线判(g, s, st.今ms, st.停表);
        if (n.基) 条 += `<i class="gt2base" style="left:${px(X(n.基.起, 窗))};width:${条宽(n.基)}"></i>`;
        if (s) {
          // 越线灰显不标红（重判前不算超期事故）；不越线才按服务端判定挂延期/超期记号
          const 红 = 越 ? '' : `${j && j.超期 ? ' gt2-od' : ''}${j && j.延期 ? ' gt2-late' : ''}`;
          条 += `<i class="gt2bar ${状态类[g.状态] || ''}${s.单端 ? ' half' : ''}${s.超长 ? ' cut gt2cut' : ''}${越 ? ' xline' : ''}${红}"
              data-tid="${esc(n.键)}" data-act="bar" data-g="${esc(g.粒ID)}" tabindex="0" role="button"
              aria-label="${esc((g.题 || '') + '：点击改排期')}" style="left:${px(X(s.起, 窗))};width:${条宽(s)}"></i>`;
          const 尾 = px(X(s.讫, 窗) + 4);
          // 徽标（越线＞判定，判定只读服务端下发——无判定不造字）
          if (越) 条 += `<em class="gt2flag rejudge" style="left:${尾}" title="计划开始已过今时线且未表态——数据层已立债给项管（派发/重排二选一），重判前灰显不标红">待重判</em>`;
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
      for (let h = 0; h < 窗.小时; h += 4) 下 += `<span class="gt2hd-时" style="left:${h * HW}px">${String(((窗.t0 / 时毫 + h) % 24 + 24) % 24).padStart(2, '0')}:00</span>`;
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
      const 越 = 越线判(g, s, st.今ms, st.停表);
      const 态 = 越 ? ['late', '越线待重判'] : g.状态 === '完成' ? ['ok', '完成'] : ['run', g.状态 || ''];
      行('计划', `${时点文(g.计划开始)} → ${时点文(g.计划完成)}`);
      if (s) 行('工期', ((s.真讫 - s.起) / 时毫).toFixed(1).replace(/\.0$/, '') + ' 小时' + (s.单端 ? '（单端）' : ''));
      行('基线', g.基线开始 || g.基线完成 ? `${时点文(g.基线开始)} → ${时点文(g.基线完成)}` : '未立');
      // 偏差与需重排＝服务端判定字段（DS-1）：不下发就显「—」，前端不算 e−基线；
      // 延期/超期两格独立并列（判据⑦：服务端说超期就得显超期，不许被延期一格挤掉）
      行('偏差', j ? ([j.延期 ? `延期 ${j.延期天} 天` : null, j.超期 ? `超期 ${j.超期天} 天` : null]
        .filter(Boolean).join(' · ') || '—') : '—', j && (j.延期 || j.超期) ? 'warn' : '');
      行('需重排', j ? (j.需重排 ? '是' : '否') : '—', j && j.需重排 ? 'warn' : '');
      for (const d of ([].concat(g.依赖 || []))) {
        const t = st.键表.get(String(d));
        行('依赖', `${d}${t && t.名 ? `（${t.名}）` : ''}`);
      }
      const 徽 = `<span class="st ${态[0]}">${esc(态[1])}</span>${s && s.超长 ? '<span class="st late">超长异常</span>' : ''}`;
      const 注 = s && s.超长 ? `<div class="note">工期超过 24h：图上截断到 24h（⋯），此处为真实区间——制度上小时级任务不该有这种条，走人闸处置</div>` : '';
      return `<div class="th"><span class="id mono">${esc(显号于(n))}</span>${徽}</div><div class="tt">${esc(g.题 || '')}</div><div class="kv">${kv.join('')}</div>${注}`;
    }
    let 完 = 0, 越 = 0, 数 = 0;
    (function 走(x) {
      if (x.粒) { 数++; if (x.粒.状态 === '完成') 完++; if (越线判(x.粒, x.段, st.今ms, st.停表)) 越++; }
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
  function 建状态(数据) {
    const { 根, 键表 } = 拼树(数据);
    const 今点 = 解时(数据.今);
    const 今ms = 今点 ? 今点.ms : null;
    铺算(根, 今ms);
    const { 折叠, 默认 } = 生效折叠(根, 键表);
    const 行 = 展平(根, 折叠);
    const 点 = [];
    (function 走(x) {
      if (x.粒) { if (x.段) 点.push(x.段.起, x.段.讫); if (x.基) 点.push(x.基.起, x.基.讫); }
      if (x.自段) 点.push(x.自段.起, x.自段.讫);
      for (const k of x.子) 走(k);
    })({ 子: 根 });
    if (今ms != null) 点.push(今ms);
    return { 数据, 根, 键表, 行, 折叠, 默认, 今ms, 停表: !!数据.停表, 窗: 算窗(点) };
  }
  function 试渲染(数据, 视口, 选项) {
    const st = 建状态(规范数据(数据, 选项));
    const v = 视口 || { 滚: 0, 高: Infinity };
    const [a, b] = 可视范围(v.滚, v.高, st.行.length);
    return { 状态: st, 可视: [a, b], 表头: 表头HTML(st), html: st.行.slice(a, b).map((r) => 行HTML(r, st)).join('') };
  }

  /* ═══ DOM 装配与增量重绘（key→节点 Map＋行签名＝行 HTML 串，spike A 甲案）═══ */
  function render(容器, 数据, 选项) {
    if (!容器) return;
    let 岛 = 容器._gt2;
    if (岛 && 岛.根el && 岛.根el.isConnected) { 末岛 = 岛; 岛.选项 = 选项 || 岛.选项; 岛.数据 = 规范数据(数据, 岛.选项); 重排(岛); return 岛; }
    岛 = 容器._gt2 = 末岛 = { 容器, 数据: null, 选项: 选项 || {}, 图: new Map(), st: null };
    岛.数据 = 规范数据(数据, 岛.选项);
    容器.innerHTML = `<div class="gt2" tabindex="-1">
      <div class="gt2bar-tools" role="toolbar" aria-label="甘特工具">
        <span class="gt2grp"><i class="gt2lab">折到</i><button data-act="fold" data-lv="1">1 管线</button><button data-act="fold" data-lv="2">2 特性</button><button data-act="fold" data-lv="3">3 专项</button><button data-act="fold" data-lv="4">4 工单</button></span>
        <span class="gt2grp"><button data-act="today" title="快捷键 T：横滚到今时线并闪一下">◎ 回到今天</button></span>
        <span class="gt2note subnote">固定小时轴 ${HW}px/h · 数字键 1-4 折层 · ⋯＝超 24h 截断（悬浮看真实区间）</span>
      </div>
      <div class="gt2stopband" hidden>产线关闭中 · 停表</div>
      <div class="gt2wrap" role="region" aria-label="四层甘特图" tabindex="0">
        <div class="gt2cv"><div class="gt2head gt2hd"></div><div class="gt2body"><i class="gt2gridbg"></i><i class="gt2now b" hidden></i></div></div>
      </div>
      <div class="gt2empty gtempty" hidden></div>
      <div class="gt2debt" hidden></div>`;
    岛.根el = 容器.firstElementChild;
    岛.wrap = 岛.根el.querySelector('.gt2wrap');
    岛.head = 岛.根el.querySelector('.gt2head');
    岛.body = 岛.根el.querySelector('.gt2body');
    岛.卡 = document.createElement('div'); 岛.卡.className = 'gt2tip'; 岛.根el.appendChild(岛.卡);
    挂事件(岛);
    重排(岛);
    return 岛;
  }
  function 更新(数据) { const 岛 = 找岛(); if (岛) { 岛.数据 = 规范数据(数据, 岛.选项); 重排(岛); } }
  // 程序口按「末次 render 的岛」兜底（gantt-p0 判据约定：headless 容器没有 rl-gantt id 也得能调）
  let 末岛 = null;
  function 找岛() { const box = document.getElementById('rl-gantt'); return (box && box._gt2) || 末岛; }

  function 重排(岛) {
    const 焦 = 记焦点(岛);
    岛.st = 建状态(岛.数据);
    const st = 岛.st, 空 = !st.行.length || st.窗.空;
    岛.根el.querySelector('.gt2stopband').hidden = !st.停表;
    const 空框 = 岛.根el.querySelector('.gt2empty');
    空框.hidden = !空;
    岛.wrap.hidden = 空;
    if (空) {
      空框.innerHTML = '甘特图上没有可画的行——四层树是空的，或没有一粒待办排过日期。排期入口在下方待办队列（欠账区列着每一条没排期的活）。';
      岛.图.clear(); 岛.body.querySelectorAll('.gt2r').forEach((e) => e.remove());
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
    const 今线 = 岛.body.querySelector('.gt2now.b');
    if (st.今ms != null && st.今ms >= st.窗.t0 && st.今ms <= st.窗.t1) {
      今线.hidden = false; 今线.style.left = X(st.今ms, st.窗).toFixed(1) + 'px';
    } else 今线.hidden = true;
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
  function 回今(岛) {
    const st = 岛.st; if (!st || st.窗.空 || st.今ms == null) return;
    岛.wrap.scrollTo({ left: Math.max(0, 树宽 + X(st.今ms, st.窗) - 岛.wrap.clientWidth / 2), behavior: 'smooth' });
    岛.根el.querySelectorAll('.gt2now').forEach((l) => {
      if (l.animate) l.animate([{ opacity: 1 }, { opacity: .15 }, { opacity: 1 }, { opacity: .15 }, { opacity: 1 }], { duration: 900 });
    });
  }

  function 挂事件(岛) {
    岛.根el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b || !岛.根el.contains(b)) return;
      const act = b.dataset.act;
      if (act === 'tri') 折切(岛, b.dataset.k, e.ctrlKey || e.metaKey);
      else if (act === 'dens') { 岛.st.折叠.delete(b.dataset.k); 存重画(岛); }
      else if (act === 'fold') 折到层(岛, +b.dataset.lv || 4);
      else if (act === 'today') 回今(岛);
      else if (act === 'gem') { e.stopPropagation(); if (b.dataset.r) location.hash = b.dataset.r; }
      else if (act === 'bar') { const g = b.dataset.g; if (g && typeof window.tqReplan === 'function') window.tqReplan(g); }
    });
    // #14 最小集：快捷键挂岛内（岛里有焦点才响应），输入框/IME 组合一律放行
    岛.根el.addEventListener('keydown', (e) => {
      if (e.isComposing || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (e.key === 'Enter' && e.target.dataset && e.target.dataset.act === 'bar') { e.preventDefault(); e.target.click(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '4') { e.preventDefault(); 折到层(岛, +e.key); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); 回今(岛); }
    });
    岛.wrap.addEventListener('scroll', () => {
      if (岛._滚订) return;
      岛._滚订 = requestAnimationFrame ? requestAnimationFrame(() => { 岛._滚订 = 0; 画行(岛); }) : (画行(岛), 0);
    }, { passive: true });
    // 悬浮卡：mouseover 委托 + mousemove 跟随，出屏收边
    岛.根el.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tid]');
      if (!t || !岛.根el.contains(t)) { 岛.卡.classList.remove('show'); return; }
      const n = 岛.st && 岛.st.键表.get(t.dataset.tid);
      if (!n) return;
      岛.卡.innerHTML = 卡HTML(n, 岛.st);
      岛.卡.classList.add('show');
      摆卡(岛, e);
    });
    岛.根el.addEventListener('mouseleave', () => 岛.卡.classList.remove('show'));
    岛.根el.addEventListener('mousemove', (e) => { if (岛.卡.classList.contains('show')) 摆卡(岛, e); });
  }
  function 摆卡(岛, e) {
    岛.卡.style.left = Math.min(e.clientX + 14, (window.innerWidth || 1200) - 岛.卡.offsetWidth - 12) + 'px';
    岛.卡.style.top = Math.min(e.clientY + 16, (window.innerHeight || 800) - 岛.卡.offsetHeight - 12) + 'px';
  }

  // 程序口（gantt-p0 判据约定：事件处理器的落点实体，判据直接调不模拟点击）
  function 切折叠(id) { const 岛 = 找岛(); if (岛 && 岛.st) 折切(岛, String(id), false); }
  function 悬浮卡Html(粒ID) {
    const 岛 = 找岛(); if (!岛 || !岛.st) return '';
    const n = 岛.st.键表.get(String(粒ID));
    return n ? 卡HTML(n, 岛.st) : '';
  }

  window.GanttIsland = {
    render, 更新, 切折叠, 悬浮卡Html, 离屏端点,
    // 判据面（H104：验行为不 grep 源码）：纯函数出口，node 沙箱直调断结构
    _测: { 拼树, 铺算, 建状态, 试渲染, 展平, 默认折叠, 可视范围, 泳道, 段, 算窗, 行HTML, 表头HTML, 行高, HW, 树宽, 头高 },
  };
})();
