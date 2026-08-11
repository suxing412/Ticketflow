// pm/poolbalance.js — 池衡控制面（H99 · 施工令-045）
//
// 案源：制作人 2026-08-11 决议 H99——「项管拥有读额度切模型的权力，他应该做到平衡才行」。
// 现状是：池/模型全靠人手改 /api/config/*，项管既无读数也无切换通道，池间失衡只能等总监发现。
//
// 本模块给项管一条**受限**的通道，四条硬口径（改一处就是改协议）：
//   ① 决策是纯函数：读数→是否切→切到哪 全在 决策()/回退判定() 里，零 I/O、可整片单测。
//      采集读数（外呼）与落配置（写盘）各在自己的函数里，绝不混进决策。
//   ② 权界写在代码里，不写在提示词里：动作白名单 + 位白名单 + 禁改域三道，
//      brain 的自由文本再怎么写也改不动门禁/放行工具/人闸/角色模型/并发上限（要件 2/10）。
//   ③ 品味锁在 API 层判：工单带 品味敏感/职能=美术/验收方式=保留 命中任一即锁 claude 高档，
//      项管的切换请求一律拒并记台账。**不依赖提示词自律**——提示词是建议，代码才是闸（要件 3）。
//   ④ 写配置走 CAS：版本 = 池位相关配置切片的指纹，读→校验→写。UI 手改会让指纹变，
//      于是拿旧版本来写的那一手被拒——排程台账（施工令-040）同款教训，不许后写覆盖（要件 8）。
//
// 可用度的口径（跨池比较的诚实交代）：订阅池比的是「距自己那道闸还剩几成」，
// 按量池比的是「余额还剩几成」。两者本不同质，归一到 0–100 只是让它们可排序；
// 正因为不同质，触发阈值（阈值差）默认给到 20 个点这么宽——差一点点就换池是噪音，不是平衡。
//
// 会话职能三席里 QA/核查 的池是 runner 定死的（lib/runner.js resolveCli：质检/代核/代裁一律走
// claude CLI），本模块**不假装**能改它：QA/核查 只开模型档，请求换池一律如实拒绝，
// 免得台账上记着「已切 codex」而实际那一席从来没离开过 claude。

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roster = require('../roster');
const ledger = require('./ledger');

const S = (v) => String(v == null ? '' : v).trim();
const 夹 = (n) => Math.max(0, Math.min(100, Math.round(n)));

// ---- 参数（studio.config.json · 池衡；要件 5 的可调项都在这儿）----
const 默认参数 = {
  开: true,              // 项管自动平衡总开关（关掉只剩人工/显式 API，读数与矩阵照常）
  最小间隔分钟: 30,       // 同一位两次自动切换的最小间隔（迟滞）
  阈值差: 20,            // 池间可用度差 ≥ 此值才值得切（防抖）
  冷却分钟: 60,          // 回退后该池的冷却期（期内不作为候选，迟滞计时一并重置）
  失败回退次数: 2,        // 切入池连续派发失败几次就退回原池
  自愈窗秒: 30,          // 派发后这么久之内的死亡算「首发秒死」，不计入回退计数
  满额: { deepseek: 50 }, // 按量池余额→可用度的换算基准（该币种下的"满格"金额）
  品味档: '',            // 品味锁要求的 claude 档（空=跟 cfg.模型.claude默认）
  人工覆盖: {},          // 位 → {池, 档, 由, 时刻, 理由}：人工覆盖优先且冻结自动切换，直至解除
};

function 参数(cfg) {
  const p = (cfg && cfg.池衡) || {};
  const n = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    ...默认参数,
    开: p.开 !== false,
    最小间隔分钟: n(p.最小间隔分钟, 默认参数.最小间隔分钟),
    阈值差: n(p.阈值差, 默认参数.阈值差),
    冷却分钟: n(p.冷却分钟, 默认参数.冷却分钟),
    失败回退次数: Math.max(1, n(p.失败回退次数, 默认参数.失败回退次数)),
    自愈窗秒: n(p.自愈窗秒, 默认参数.自愈窗秒),
    满额: { ...默认参数.满额, ...(p.满额 || {}) },
    品味档: S(p.品味档),
    人工覆盖: (p.人工覆盖 && typeof p.人工覆盖 === 'object') ? p.人工覆盖 : {},
  };
}

// 品味锁要求的档：显式配置 > claude 池默认档。两者都空 = 本机没定过高档，
// 锁只管得住「留在 claude」，管不了档——如实降级，不臆造一个模型名出来。
function 品味档(cfg) {
  return S((cfg && cfg.池衡 && cfg.池衡.品味档)) || S((cfg && cfg.模型 && cfg.模型.claude默认));
}

// ---- 位（可切对象）：执行·<职能> / QA / 核查，别的一律不在册（要件 2）----
// 判官两席的池由 runner 定死（见文件头），这里只登记它们的档键。
const 判官位 = { QA: { 档键: '质检', 定池: 'claude' }, 核查: { 档键: '核查', 定池: 'claude' } };
// 禁改域：项管永远碰不到的东西。命中即 403 并记台账（要件 2/10）。
const 禁改域 = ['门禁', '放行工具', '人闸', '并发上限', '并发', '闸值', '执行器', '网络', '凭据',
  '总监', '制作人', '项管', '代裁', '仲裁', '代核'];
const 动作白名单 = ['切换', '回退', '人工覆盖', '解除覆盖'];
// 操作域：切换是项管的日常权（总监可代劳）；人工覆盖是**人**的权，项管不得自授
const 操作域 = { 切换: ['项管', '总监'], 回退: ['项管', '总监'], 人工覆盖: ['总监', '制作人'], 解除覆盖: ['总监', '制作人'] };

function 执行位名(职能) { return '执行·' + S(职能); }

// 位全集：编制表每职能一行 → 一个执行位；外加 QA/核查 两个判官位。
// 池序/档从编制表实读，当前池 = 池序首位（与 dispatch.routePool 同一把尺）。
function 位全集(cfg) {
  const out = [];
  for (const r of roster.read(cfg)) {
    const 池序 = r.池序.map((p) => p.池);
    out.push({
      位: 执行位名(r.职能), 类型: '执行', 职能: r.职能,
      池序, 当前池: 池序[0] || null,
      档: (r.池序[0] || {}).档 || '',
      摘: roster.池序摘(r.池序),
    });
  }
  for (const [名, v] of Object.entries(判官位)) {
    const 档 = S((cfg && cfg.模型 && cfg.模型[v.档键]));
    out.push({ 位: 名, 类型: 名, 职能: null, 池序: [v.定池], 当前池: v.定池, 档, 摘: `${v.定池}${档 ? `(${档})` : ''}`, 定池: true });
  }
  return out;
}

function 解析位(cfg, 位) {
  const name = S(位);
  if (!name) return { ok: false, error: '位必填（执行·<职能> / QA / 核查）' };
  // 禁改域先判：把「改门禁」「改并发上限」这类越权动作挡在解析之前，
  // 免得它们混进"未知位"的通用拒因里——台账上要看得出这是**越权**，不是手滑写错名字。
  for (const d of 禁改域) {
    if (name === d || name.includes(d)) return { ok: false, 越权: true, error: `越权：${name} 不在项管权界内（禁改域「${d}」——门禁/放行工具/人闸/角色模型/并发上限只属制作人与总监）` };
  }
  const hit = 位全集(cfg).find((b) => b.位 === name);
  if (!hit) return { ok: false, error: `未知位：${name}（可切的只有 执行·<职能> / QA / 核查）` };
  return { ok: true, ...hit };
}

// ================= 读数（要件 1）=================
// 三池状态各有各的源：claude 看订阅用量 + 凭据在不在；codex 看 app-server 探针；
// deepseek（及其它按量池）看 key 余额接口。**读不到就报盲区**——不编数、不沿用旧值。

const 盲 = (池, 因, 时刻, 源) => ({ 池, 源: 源 || null, 可用度: null, 盲区: true, 因, 读数时刻: 时刻 || null, 明细: null });

function claude凭据在(opts = {}) {
  if (opts.claude凭据 != null) return !!opts.claude凭据; // 测试注入
  try { return fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json')); } catch { return false; }
}

// 订阅池可用度：每个窗口算「距自己那道闸还剩几成」，取最紧的那个窗口。
// 用比例而不是绝对点数，是为了让 阈值70 与 周阈值90 两根不同长度的杆可比。
function 订阅可用度(窗口们) {
  let 最小 = null;
  for (const w of 窗口们) {
    if (!w || w.pct == null) continue;
    const 阈 = Number(w.阈值) > 0 ? Number(w.阈值) : 100;
    const v = 夹(100 * (阈 - w.pct) / 阈);
    最小 = 最小 == null ? v : Math.min(最小, v);
  }
  return 最小;
}

function 按量可用度(余额, 满额) {
  const b = Number(余额);
  const f = Number(满额) > 0 ? Number(满额) : 50;
  if (!Number.isFinite(b)) return null;
  return 夹(100 * b / f);
}

// 按量池清单（计费性质判据复用 dispatch.计费Of，不另写一套）
function 按量池们(cfg) {
  const D = require('./dispatch');
  return Object.keys((cfg && cfg.执行池) || {}).filter((p) => !['codex', 'claude'].includes(p) && D.计费Of(cfg, p) === '按量');
}

// 纯归一：把 gates.allLocks 的锁快照 + 余额探针结果 摊成统一的三池读数。
// locks/ds 为 null 一律出盲区；claude 的 陈旧 标记直接判盲区——
// 节流窗口内 quota 会供「最后一次好读数」，那是给 UI 显示用的，拿它做切换判据就是**沿用旧值充数**。
function 归一读数(cfg, { locks, 余额, 时刻, claude凭据 } = {}) {
  const 参 = 参数(cfg);
  const out = {};
  for (const 池 of ['claude', 'codex']) {
    const 源 = 池 === 'codex' ? 'codex app-server 探针' : 'claude OAuth 用量接口';
    const l = locks && locks[池];
    if (池 === 'claude' && !claude凭据在({ claude凭据 })) { out[池] = 盲(池, '未见 claude 订阅凭据（~/.claude/.credentials.json）——订阅态不可判', 时刻, 源); continue; }
    if (!l) { out[池] = 盲(池, '额度探针未回数', 时刻, 源); continue; }
    if (l.陈旧) { out[池] = 盲(池, '读数陈旧（节流窗外的旧值不充数）', l.更新于 ? new Date(l.更新于).toISOString() : 时刻, 源); continue; }
    const wins = (l.窗口 || []).filter((w) => w && w.pct != null);
    if (!wins.length) { out[池] = 盲(池, '额度接口无可用窗口读数', 时刻, 源); continue; }
    const 读时 = l.更新于 ? new Date(l.更新于).toISOString() : 时刻;
    out[池] = {
      池, 源, 盲区: false, 读数时刻: 读时 || null,
      可用度: l.locked ? 0 : 订阅可用度(wins),
      冻结: !!l.locked, 因: l.locked ? (l.reason || '额度锁已合') : null,
      明细: wins.map((w) => ({ 窗: w.label, 已用: w.pct, 阈值: w.阈值 })),
    };
  }
  for (const 池 of 按量池们(cfg)) {
    const 源 = `${池} 余额接口`;
    const b = 余额 && 余额[池];
    if (!b) { out[池] = 盲(池, '余额接口未回数（无托管 key / 接口不可达 / 该厂无余额接口）', 时刻, 源); continue; }
    if (b.error) { out[池] = 盲(池, String(b.error).slice(0, 80), b.读数时刻 || 时刻, 源); continue; }
    const 可用度 = b.可用 === false ? 0 : 按量可用度(b.余额, 参.满额[池]);
    if (可用度 == null) { out[池] = 盲(池, '余额字段解析不出数', b.读数时刻 || 时刻, 源); continue; }
    out[池] = {
      池, 源, 盲区: false, 读数时刻: b.读数时刻 || 时刻, 可用度,
      冻结: b.可用 === false, 因: b.可用 === false ? '厂商报不可用' : null,
      明细: [{ 窗: '余额', 已用: null, 余额: b.余额, 币种: b.币种 || null, 满额: 参.满额[池] || 50 }],
    };
  }
  return out;
}

// ---- 余额外呼（deepseek 系）：key 绝不进 argv ----
// creds.js 的纪律第 3 条：明文只在内存里活，且从不经过命令行（进程列表可见）。
// curl 的 -K - 从 stdin 读配置，url 与 Authorization 头都走 stdin，argv 干净。
// 第三方端点一律不走代理（同 runner 对兼容 base 的处理：国内直连更快更稳）。
const 余额缓存 = new Map(); // 池 → {at, v}
const 余额缓存毫秒 = 5 * 60000;

function 池key(root, cfg, 池) {
  try { const k = require('../creds').getKey(root, 池); if (k) return { key: k, base: (require('../creds').meta(root, 池) || {}).base || null }; } catch { /* 未托管 */ }
  const c = ((cfg.执行池 || {})[池] || {}).兼容 || null;
  return c && c.key ? { key: c.key, base: c.base || null } : null;
}

// 余额接口的地址：从兼容 base 取源站再挂 /user/balance（deepseek 官方口径）。
// 认不出源站就不猜——回 null，上游据此报盲区。
function 余额端点(池, base) {
  let origin = null;
  try { origin = base ? new URL(String(base)).origin : (池 === 'deepseek' ? 'https://api.deepseek.com' : null); } catch { origin = null; }
  if (!origin) return null;
  if (!/deepseek/i.test(origin) && !/deepseek/i.test(池)) return null; // 只认已知有余额接口的厂
  return origin + '/user/balance';
}

function 探余额(root, cfg, 池, opts = {}) {
  return new Promise((resolve) => {
    const 现在 = opts.现在 || Date.now();
    const c = 余额缓存.get(池);
    if (c && 现在 - c.at < 余额缓存毫秒) return resolve(c.v);
    const kr = 池key(root, cfg, 池);
    if (!kr) return resolve({ error: '该池无托管 key，余额读不到' });
    const url = 余额端点(池, kr.base);
    if (!url) return resolve({ error: '该池无已知余额接口（只 deepseek 系有）' });
    const { execFile } = require('child_process');
    const child = execFile('curl', ['-s', '--max-time', '15', '--noproxy', '*', '-K', '-'],
      { windowsHide: true, timeout: 20000 }, (err, stdout) => {
        if (err) return resolve({ error: '余额接口不可达：' + String(err.message).slice(0, 60) });
        let d = null;
        try { d = JSON.parse(stdout); } catch { return resolve({ error: '余额接口返回非 JSON' }); }
        const info = (d && Array.isArray(d.balance_infos) && d.balance_infos[0]) || null;
        if (!info) return resolve({ error: '余额接口无 balance_infos' });
        const v = { 可用: d.is_available !== false, 余额: Number(info.total_balance), 币种: info.currency || null, 读数时刻: new Date(现在).toISOString() };
        余额缓存.set(池, { at: 现在, v });
        resolve(v);
      });
    try { child.stdin.write(`url = "${url}"\nheader = "Authorization: Bearer ${kr.key}"\n`); child.stdin.end(); } catch { /* close 兜底 */ }
  });
}

// 采集（唯一外呼入口，桩台在 server 里整体哑掉）：locks/余额 皆可注入，单测零外呼。
async function 采集(root, cfg, opts = {}) {
  const 时刻 = opts.时刻 || new Date().toISOString();
  let locks = opts.locks;
  if (locks === undefined) { try { locks = await require('../gates').allLocks(cfg); } catch { locks = null; } }
  let 余额 = opts.余额;
  if (余额 === undefined) {
    余额 = {};
    // 经**导出对象**调用而不是模块内的局部绑定：桩台（server.js 的 STUDIO_STUB 块）哑掉的是
    // module.exports.探余额，局部直调会从它旁边溜过去——施工令-037/038 两起事故的「手搓漏面」正是这一型。
    for (const 池 of 按量池们(cfg)) { try { 余额[池] = await module.exports.探余额(root, cfg, 池, opts); } catch (e) { 余额[池] = { error: String(e.message).slice(0, 60) }; } }
  }
  return 归一读数(cfg, { locks, 余额, 时刻, claude凭据: opts.claude凭据 });
}

// ================= 品味锁（要件 3）=================
// 三条判据命中任一即锁：工单带 品味敏感: 是 / 职能=美术 / 验收方式=保留。
// 判定对象是「位」不是「单」：某职能只要手上有一张品味单，这一职能的执行位就锁死在 claude 高档。
// 判官两席（QA/核查）只看委托验收的单——保留验收的单压根不过判官，拿它锁判官席是无的放矢。
const 活态 = ['草稿', '待投', '池', '在途', '质检'];

function 活单摘(root) {
  const store = require('../core/store');
  const out = [];
  for (const s of 活态) {
    let list = [];
    try { list = store.list(root, s); } catch { list = []; }
    for (const t of list) {
      out.push({
        id: t.id, 状态: s, 职能: S(t.fm.职能),
        品味敏感: /^(是|true|yes)$/i.test(S(t.fm.品味敏感)),
        验收方式: S(t.fm.验收方式) || '委托',
      });
    }
  }
  return out;
}

function 品味锁(位解析, 活单们) {
  const 单们 = Array.isArray(活单们) ? 活单们 : [];
  if (位解析.类型 === '执行') {
    if (位解析.职能 === '美术') return { 因: '职能=美术——品味岗，锁 claude 高档（要件 3）' };
    const hit = 单们.find((t) => t.职能 === 位解析.职能 && (t.品味敏感 || t.验收方式 === '保留'));
    if (hit) return { 因: `${hit.id} ${hit.品味敏感 ? '带「品味敏感: 是」' : '验收方式=保留'}——品味单在手，锁 claude 高档` };
    return null;
  }
  // 判官席：只有委托验收的单才走判官
  const hit = 单们.find((t) => t.验收方式 === '委托' && (t.品味敏感 || t.职能 === '美术'));
  if (hit) return { 因: `${hit.id}（${hit.品味敏感 ? '品味敏感' : '美术单'}）在委托验收链上——判官席锁 claude 高档` };
  return null;
}

// 锁合规：位是不是已经待在「claude + 高档」上了。高档没配就只判池。
function 锁合规(cfg, 位解析) {
  if (位解析.当前池 !== 'claude') return false;
  const 高 = 品味档(cfg);
  if (!高) return true;
  const 实档 = S(位解析.档) || (位解析.类型 === '执行' ? S((cfg.模型 || {}).claude默认) : '');
  return 实档 === 高;
}

// ================= 历史（台账事件折叠）=================
// 迟滞计时与冷却都从只追加的事件流里折叠出来——不另立一份可写状态，
// 就不会有"状态跟账对不上"的第二事实源（pm/ledger 主档损毁案的教训）。
const 池衡事件类型 = ['池衡切换', '池衡归位', '池衡回退', '池衡覆盖', '池衡解除覆盖', '池衡拒绝', '池衡越权'];
const 计时事件 = ['池衡切换', '池衡归位', '池衡回退', '池衡覆盖'];

function 历史Of(events, 参, 现在) {
  const now = 现在 || Date.now();
  const 最近 = {}; const 冷却至 = {};
  for (const e of (Array.isArray(events) ? events : [])) {
    if (!e || !池衡事件类型.includes(e.类型)) continue;
    const t = Date.parse(e.t || '');
    if (!Number.isFinite(t)) continue;
    if (计时事件.includes(e.类型) && e.位) 最近[e.位] = { t, 类型: e.类型, 从: e.从 || null, 到: e.到 || null, 由: e.由 || null };
    // 回退 = 从「切入池」退回原池：进冷却的是那个把活跑死的池（e.从）
    if (e.类型 === '池衡回退' && e.从) 冷却至[e.从] = Math.max(冷却至[e.从] || 0, t + 参.冷却分钟 * 60000);
  }
  return { 最近, 冷却至, 现在: now, 冷却中: (池) => (冷却至[池] || 0) > now };
}

// ================= 决策（纯函数 · 要件 5/11）=================
// 输入全是数据，输出全是判词。一次巡检的全部判断力都在这里，外面只负责取数与落盘。
//
// 判定序（顺序即语义）：
//   ①算清「要不要切、切到哪」——盲区池不参与（当前池盲区就无从比较，直接不切）
//   ②只有在**本来就该切**的时候，人工覆盖/品味锁才算「拒」（要件 6 的记账口径：
//     没到该切的份上就没什么可拒的，天天记一条「阈值不足」只会把台账刷成噪音）
//   ③迟滞窗内即使该切也不切（防抖），如实标 拟切 供事后对账
//   ④品味锁另有一条独立支线：锁着却不在 claude 高档上 → 归位（这是锁在**执行**，不是在拒绝）
function 决策({ 位们, 读数, 参, 历史, 覆盖 } = {}) {
  const out = [];
  const 参2 = 参 || 默认参数;
  const 覆 = 覆盖 || {};
  for (const b of (位们 || [])) {
    const 基 = { 位: b.位, 类型: b.类型, 职能: b.职能 || null, 当前池: b.当前池, 档: b.档 || '' };
    const ov = 覆[b.位] || null;
    if (b.类型 !== '执行') { out.push({ ...基, 动作: '不切', 因类: '判官席池固定', 因: 'QA/核查 会话由 runner 定死走 claude，自动平衡不碰（改档走显式 API）' }); continue; }
    // ④ 品味锁归位（先于可用度算：锁是硬的，跟池子还剩多少额度无关）
    if (b.锁 && !ov && !b.锁合规) {
      out.push({ ...基, 动作: '归位', 从: b.当前池, 到: 'claude', 目标档: b.高档 || '', 因类: '品味锁', 因: `${b.锁.因}——当前 ${b.摘 || b.当前池} 不合锁，归位 claude${b.高档 ? '/' + b.高档 : ''}` });
      continue;
    }
    const 当前 = b.当前池;
    const r当前 = 当前 ? 读数[当前] : null;
    if (!当前) { out.push({ ...基, 动作: '不切', 因类: '未挂池', 因: '该职能池序为空，派发回落职能默认池——平衡无从谈起' }); continue; }
    if (!r当前 || r当前.盲区) { out.push({ ...基, 动作: '不切', 因类: '盲区', 因: `当前池 ${当前} 读数盲区（${(r当前 && r当前.因) || '无读数'}）——盲区池不参与平衡` }); continue; }
    const 候选 = (b.池序 || []).filter((p) => 读数[p] && !读数[p].盲区 && !历史.冷却中(p));
    if (!候选.length) { out.push({ ...基, 动作: '不切', 因类: '无候选', 因: '池序里没有一个既有读数又不在冷却的池' }); continue; }
    let 最佳 = 候选[0];
    for (const p of 候选) if (读数[p].可用度 > 读数[最佳].可用度) 最佳 = p;
    const 差 = 读数[最佳].可用度 - 读数[当前].可用度;
    if (最佳 === 当前) { out.push({ ...基, 动作: '不切', 因类: '已最佳', 因: `${当前} 可用度 ${读数[当前].可用度}% 已是池序里最高` }); continue; }
    if (差 < 参2.阈值差) { out.push({ ...基, 动作: '不切', 因类: '阈值不足', 差, 因: `${最佳} 仅高出 ${差} 点（触发阈值 ${参2.阈值差}）——差一点点就换池是噪音` }); continue; }
    // 到这儿：本来是该切的。人工覆盖与品味锁在此处才构成「拒」。
    if (ov) { out.push({ ...基, 动作: '拒', 因类: '人工覆盖', 拟切: { 从: 当前, 到: 最佳, 差 }, 因: `人工覆盖在位（${ov.由 || '人工'} · ${ov.理由 || '未述'}）——自动切换已冻结，直至人工解除` }); continue; }
    if (b.锁) { out.push({ ...基, 动作: '拒', 因类: '品味锁', 拟切: { 从: 当前, 到: 最佳, 差 }, 因: `${b.锁.因}——切换请求拒绝` }); continue; }
    const 上次 = (历史.最近[b.位] || {}).t || 0;
    const 距上次分 = 上次 ? Math.round((历史.现在 - 上次) / 60000) : null;
    if (上次 && 历史.现在 - 上次 < 参2.最小间隔分钟 * 60000) {
      out.push({ ...基, 动作: '不切', 因类: '迟滞', 差, 拟切: { 从: 当前, 到: 最佳, 差 }, 因: `距上次切换仅 ${距上次分} 分钟（最小间隔 ${参2.最小间隔分钟} 分钟）` });
      continue;
    }
    out.push({ ...基, 动作: '切', 从: 当前, 到: 最佳, 差,
      因: `${最佳} 可用度 ${读数[最佳].可用度}% vs ${当前} ${读数[当前].可用度}%（差 ${差} ≥ 阈值 ${参2.阈值差}）`,
      触发读数: { [当前]: 读数[当前].可用度, [最佳]: 读数[最佳].可用度, 取数时刻: 读数[最佳].读数时刻 } });
  }
  return out;
}

// ================= 失败回退（纯函数 · 要件 7）=================
// 「切入池连续派发失败」的判据复用 runner 既有失败判定——执行失败目录里那些单就是它的产物，
// 不另造一套失败感知。首发秒死（派发后 自愈窗秒 之内就死）不计数：
// codex 那种第一发秒退的抖动会自愈，把它算进去等于让一次抖动就把池衡打回原形。
function 回退判定({ 位们, 失败单们, 历史, 参, 覆盖 } = {}) {
  const out = [];
  const 参2 = 参 || 默认参数;
  const 覆 = 覆盖 || {};
  for (const b of (位们 || [])) {
    if (b.类型 !== '执行') continue;
    if (覆[b.位]) continue;                 // 人工覆盖冻结自动面，回退也算自动面
    const last = 历史.最近[b.位];
    if (!last || last.类型 !== '池衡切换') continue; // 只回退「切换」；归位/覆盖不该被自动推翻
    if (!last.到 || last.到 !== b.当前池 || !last.从) continue; // 现态已不是那次切换的落点：无从回退
    const 计入 = (失败单们 || []).filter((f) => {
      if (S(f.执行池) !== b.当前池) return false;
      if (b.职能 && S(f.职能) !== b.职能) return false;
      const ft = Date.parse(f.失败时间 || '');
      if (!Number.isFinite(ft) || ft <= last.t) return false; // 切换之前的死亡不算这一池的账
      const dt = Date.parse(f.领单时间 || '');
      if (Number.isFinite(dt) && ft - dt < 参2.自愈窗秒 * 1000) return false; // 首发秒死：自愈窗内不计
      return true;
    });
    if (计入.length < 参2.失败回退次数) continue;
    out.push({
      位: b.位, 类型: b.类型, 职能: b.职能, 动作: '回退', 从: b.当前池, 到: last.从,
      失败单: 计入.map((f) => f.id).slice(0, 10),
      因: `切入 ${b.当前池} 后连续 ${计入.length} 次派发失败（≥${参2.失败回退次数}，已排除 ${参2.自愈窗秒}s 内的首发秒死）——退回 ${last.从} 并令 ${b.当前池} 进入 ${参2.冷却分钟} 分钟冷却`,
    });
  }
  return out;
}

// 执行失败单摘（回退判定的输入）
function 失败单摘(root) {
  const store = require('../core/store');
  let list = [];
  try { list = store.list(root, '执行失败'); } catch { list = []; }
  return list.map((t) => ({ id: t.id, 职能: S(t.fm.职能), 执行池: S(t.fm.执行池), 失败时间: t.fm.失败时间 || null, 领单时间: t.fm.领单时间 || null }));
}

// ================= CAS（要件 8）=================
// 版本 = 池位相关配置切片的指纹。UI 手改模型档 / 总监改编制 都会让它变，
// 于是拿旧版本来写的那一手被拒并拿到现态——不许后写覆盖（施工令-040 同款教训）。
function 切片(cfg) {
  const m = (cfg && cfg.模型) || {};
  return {
    编制: roster.read(cfg),
    模型: { 质检: S(m.质检), 核查: S(m.核查), 代核: S(m.代核), claude默认: S(m.claude默认), codex默认: S(m.codex默认) },
    池衡: { ...(cfg && cfg.池衡 ? cfg.池衡 : {}) },
  };
}
function 版本(cfg) { return crypto.createHash('sha1').update(JSON.stringify(切片(cfg))).digest('hex').slice(0, 12); }
function 校验版本(cfg, 预期版本) {
  const v = S(预期版本);
  if (!v) return { error: '预期版本必填（CAS：写前先读现态，把版本号带回来）' };
  const cur = 版本(cfg);
  if (v !== cur) return { error: `版本冲突：预期 ${v}，现 ${cur}——配置已被改动（UI 手改/总监调编制），请按现态重试`, 冲突: true };
  return {};
}

// ================= 落配置 =================
// 执行位落在编制表（池序重排，roster.apply 是唯一写口）；判官位落在模型档。
// 两条路都只碰「位」自己那一格，绝不顺手改别的分区。
function 落位(cfg, 位解析, 池, 档) {
  const 目标池 = S(池) || 位解析.当前池;
  const 目标档 = 档 == null ? null : S(档);
  if (位解析.类型 !== '执行') {
    const v = 判官位[位解析.类型];
    if (目标池 && 目标池 !== v.定池) {
      return { ok: false, error: `${位解析.位} 席的池由 runner 定死走 ${v.定池}（lib/runner.js resolveCli：质检/代核/代裁一律 claude）——本 API 不假装能改它，可切的是模型档` };
    }
    if (目标档 == null) return { ok: false, error: `${位解析.位} 只可切模型档，请给 档` };
    if (目标档 && !/^[\w.\-]{2,40}$/.test(目标档)) return { ok: false, error: '模型档只允许字母数字点横线（2–40 位）' };
    const 前 = S((cfg.模型 || {})[v.档键]);
    if (前 === 目标档) return { ok: false, error: `${位解析.位} 已经是 ${目标档 || '（CLI 默认）'}，无需切换` };
    cfg.模型 = cfg.模型 || {};
    cfg.模型[v.档键] = 目标档;
    return { ok: true, 从: 前 || '（CLI 默认）', 到: 目标档 || '（CLI 默认）', 面: '模型档', 池: v.定池 };
  }
  if (!目标池) return { ok: false, error: '切换须指定目标池' };
  if (!((cfg.执行池 || {})[目标池])) return { ok: false, error: '未知池：' + 目标池 };
  const row = roster.rowOf(cfg, 位解析.职能);
  const 旧池序 = row ? row.池序 : [];
  const 原档 = (旧池序.find((p) => p.池 === 目标池) || {}).档 || '';
  const 新首 = { 池: 目标池, 档: 目标档 == null ? 原档 : 目标档 };
  const 池序 = [新首, ...旧池序.filter((p) => p.池 !== 目标池)];
  const r = roster.apply(cfg, [{ 职能: 位解析.职能, 池序 }]);
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.生效.length) return { ok: false, error: `${位解析.位} 已经是 ${roster.池序摘(池序)}，无需切换` };
  return { ok: true, 从: 位解析.当前池, 到: 目标池, 面: '编制池序', 摘: r.生效[0].摘, 档: 新首.档 };
}

// ================= 受限动作 API（要件 2/3/6/8/10）=================
// 唯一写口。brain 的自由文本改不动配置——它只能来敲这扇门，而这扇门认的是枚举动作。
// 每一次拒绝都留痕：台账上要看得见「谁在什么时候想干什么被拦了」。
function 记(root, 类型, data) {
  try { return ledger.event(root, 类型, data); } catch { return null; }
}
function 志(root, msg) { try { require('../journal').append(root, msg); } catch { /* 无 journal 环境（测试）忽略 */ } }

function 执行动作(root, cfg, req = {}, opts = {}) {
  const 动作 = S(req.动作);
  const 人 = S(req.操作者);
  // 事件二分（要件 6）：账上只认「项管自动」与「人工覆盖」两类。
  // 项管显式来敲门与巡检自己动手同归前者——账要回答的是「这一手是谁的意志」，
  // 而不是「它经由哪条代码路径」；总监/制作人动的手一律后者。
  const 由 = ['项管自动', '人工覆盖'].includes(req.由) ? req.由 : (人 === '项管' ? '项管自动' : '人工覆盖');
  const 理由 = S(req.理由).slice(0, 200);
  const 现在 = opts.现在 || Date.now();
  const 时刻 = new Date(现在).toISOString();

  if (!动作白名单.includes(动作)) {
    记(root, '池衡越权', { 动作: 动作 || '(空)', 操作者: 人, 因: '不在受限动作白名单', 白名单: 动作白名单, t2: 时刻 });
    志(root, `池衡越权拒绝：${人 || '未署名'} 请求动作「${动作 || '(空)'}」——白名单只有 ${动作白名单.join('/')}`);
    return { ok: false, 码: 403, 越权: true, error: `未知/越权动作：${动作 || '(空)'}（受限动作只有 ${动作白名单.join('/')}）` };
  }
  if (!操作域[动作].includes(人)) {
    记(root, '池衡越权', { 动作, 操作者: 人 || '(空)', 因: `不在操作域 ${操作域[动作].join('/')}` });
    志(root, `池衡越权拒绝：「${人 || '空'}」不在 ${动作} 的操作域（${操作域[动作].join('/')}）`);
    return { ok: false, 码: 403, 越权: true, error: `${动作} 的操作域是 ${操作域[动作].join('/')}（收到「${人 || '空'}」）` };
  }
  const 位 = 解析位(cfg, req.位);
  if (!位.ok) {
    记(root, '池衡越权', { 动作, 操作者: 人, 位: S(req.位), 因: 位.error });
    志(root, `池衡${位.越权 ? '越权' : '拒绝'}：${人} 请求 ${动作} ${S(req.位)}——${位.error}`);
    return { ok: false, 码: 位.越权 ? 403 : 400, ...(位.越权 ? { 越权: true } : {}), error: 位.error };
  }
  const cas = 校验版本(cfg, req.预期版本);
  if (cas.error) return { ok: false, 码: cas.冲突 ? 409 : 400, ...(cas.冲突 ? { 冲突: true } : {}), error: cas.error, 版本: 版本(cfg) };

  const 参 = 参数(cfg);
  const 覆盖 = { ...参.人工覆盖 };
  const 保存 = opts.保存 || (() => {});

  // ---- 解除覆盖 ----
  if (动作 === '解除覆盖') {
    if (!覆盖[位.位]) return { ok: false, 码: 400, error: `${位.位} 没有人工覆盖，无需解除` };
    const 前 = 覆盖[位.位];
    delete 覆盖[位.位];
    cfg.池衡 = { ...(cfg.池衡 || {}), 人工覆盖: 覆盖 };
    保存();
    记(root, '池衡解除覆盖', { 位: 位.位, 由: '人工覆盖', 操作者: 人, 前: 前, 理由 });
    志(root, `池衡解除覆盖：${位.位}（${人}）——项管自动切换恢复｜理由：${理由 || '未述'}`);
    return { ok: true, 位: 位.位, 版本: 版本(cfg), 说明: '人工覆盖已解除，项管自动切换恢复' };
  }

  // ---- 品味锁（要件 3）：锁在 API 层判，不依赖提示词自律 ----
  // 人工覆盖是**人**的权（人本化：品味决定只属于人），不受品味锁拦；项管的切换/回退一律拦。
  const 单们 = opts.活单 || 活单摘(root);
  const 锁 = 品味锁(位, 单们);
  // 归位是**锁在执行**，不是在被拒：一个锁着却蹲在 codex 上的位，只有靠一次朝 claude 高档去的
  // 切换才能合规。若把它一并拦下，品味锁就退化成「锁住现状」——单子飘到便宜池上就永远回不来了。
  // 放行判据严到只认「正好落在锁要求的那一格上」：池必须是 claude，配了高档就必须正好是那个档。
  const 归位 = 锁 && 动作 === '切换' && req.因类 === '品味锁'
    && S(req.池) === 'claude' && (!品味档(cfg) || S(req.档) === 品味档(cfg));
  if (锁 && !归位 && (动作 === '切换' || 动作 === '回退')) {
    记(root, '池衡拒绝', { 位: 位.位, 因类: '品味锁', 动作, 操作者: 人, 由, 从: 位.当前池, 到: S(req.池) || null, 因: 锁.因, 理由 });
    志(root, `池衡拒绝 ${位.位}：品味锁（${锁.因}）——${人} 的${动作}请求不予执行`);
    return { ok: false, 码: 403, 品味锁: true, error: `品味锁：${锁.因}。该位锁定 claude${品味档(cfg) ? '/' + 品味档(cfg) : ' 高档'}，项管不可切换（要件 3）` };
  }

  // ---- 人工覆盖（总监/制作人）----
  if (动作 === '人工覆盖') {
    const r = 落位(cfg, 位, req.池, req.档);
    if (!r.ok) return { ok: false, 码: 400, error: r.error };
    覆盖[位.位] = { 池: r.到, 档: req.档 == null ? null : S(req.档), 由: 人, 时刻, 理由: 理由 || '未述' };
    cfg.池衡 = { ...(cfg.池衡 || {}), 人工覆盖: 覆盖 };
    保存();
    const e = 记(root, '池衡覆盖', { 位: 位.位, 从: r.从, 到: r.到, 面: r.面, 由: '人工覆盖', 操作者: 人, 理由, 冻结: true });
    志(root, `池衡人工覆盖：${位.位} ${r.从} → ${r.到}（${人}）——项管自动切换已冻结，直至人工解除｜理由：${理由 || '未述'}`);
    return { ok: true, 位: 位.位, 从: r.从, 到: r.到, 版本: 版本(cfg), 事件: e, 说明: '人工覆盖已生效并冻结项管自动切换（要件 9）' };
  }

  // ---- 切换 / 回退：受迟滞与冷却约束（要件 5）----
  if (覆盖[位.位]) {
    记(root, '池衡拒绝', { 位: 位.位, 因类: '人工覆盖', 动作, 操作者: 人, 由, 因: '人工覆盖在位，自动面冻结' });
    return { ok: false, 码: 409, error: `${位.位} 有人工覆盖在位（${覆盖[位.位].由} · ${覆盖[位.位].理由 || '未述'}），项管切换已冻结——先解除覆盖` };
  }
  const 历史 = 历史Of(ledger.events(root, 800), 参, 现在);
  const 目标 = S(req.池) || 位.当前池;
  // 归位不吃迟滞与冷却：品味锁是硬的，让一个品味位在便宜池上多待 30 分钟只为了「防抖」，
  // 是拿防抖的理由去违反一条更高的纪律。
  if (动作 === '切换' && !归位 && 历史.冷却中(目标)) {
    const 至 = new Date(历史.冷却至[目标]).toISOString();
    记(root, '池衡拒绝', { 位: 位.位, 因类: '冷却', 动作, 操作者: 人, 由, 到: 目标, 因: `${目标} 冷却至 ${至}` });
    return { ok: false, 码: 400, error: `${目标} 在回退冷却期内（至 ${至}），暂不可切入` };
  }
  const 上次 = (历史.最近[位.位] || {}).t || 0;
  if (动作 === '切换' && !归位 && 上次 && 现在 - 上次 < 参.最小间隔分钟 * 60000) {
    const 距 = Math.round((现在 - 上次) / 60000);
    记(root, '池衡拒绝', { 位: 位.位, 因类: '迟滞', 动作, 操作者: 人, 由, 从: 位.当前池, 到: 目标, 因: `距上次切换 ${距} 分钟 < 最小间隔 ${参.最小间隔分钟} 分钟` });
    志(root, `池衡拒绝 ${位.位}：迟滞窗内（距上次 ${距} 分钟 < ${参.最小间隔分钟}）`);
    return { ok: false, 码: 429, 迟滞: true, error: `迟滞窗内：距上次切换 ${距} 分钟 < 最小间隔 ${参.最小间隔分钟} 分钟（studio.config.json · 池衡.最小间隔分钟 可调）` };
  }
  const r = 落位(cfg, 位, req.池, req.档);
  if (!r.ok) return { ok: false, 码: 400, error: r.error };
  保存();
  const 类型 = 动作 === '回退' ? '池衡回退' : (req.因类 === '品味锁' ? '池衡归位' : '池衡切换');
  const e = 记(root, 类型, {
    位: 位.位, 从: r.从, 到: r.到, 面: r.面, 档: r.档 != null ? r.档 : undefined,
    由, 操作者: 人, 理由: 理由 || (req.因 ? S(req.因).slice(0, 200) : ''), 触发读数: req.触发读数 || null,
    生效范围: '此后新派发的会话（在途会话沿用派发时快照，要件 4）',
  });
  志(root, `池衡${动作}：${位.位} ${r.从} → ${r.到}（${由} · ${人}）｜${理由 || S(req.因) || '未述'}——只影响此后新派发的会话`);
  return { ok: true, 位: 位.位, 从: r.从, 到: r.到, 面: r.面, 版本: 版本(cfg), 事件: e };
}

// ================= 巡检（自动面的编排；判断力全在上面的纯函数里）=================
// 顺序：回退优先于平衡——一个刚把活跑死的池，没有资格在同一轮里再参与「谁更空」的比较。
function 巡检(root, cfg, 读数, opts = {}) {
  const 参 = 参数(cfg);
  const 现在 = opts.现在 || Date.now();
  const 保存 = opts.保存 || (() => {});
  const out = { 开: 参.开, 切: [], 回退: [], 拒: [], 不切: [] };
  if (!参.开) return out;
  const 单们 = opts.活单 || 活单摘(root);
  const 高 = 品味档(cfg);
  const 建位们 = () => 位全集(cfg).map((b) => {
    const 锁 = 品味锁(b, 单们);
    return { ...b, 锁, 锁合规: 锁 ? 锁合规(cfg, b) : true, 高档: 高 };
  });

  // ① 失败回退
  let 历史 = 历史Of(ledger.events(root, 800), 参, 现在);
  for (const d of 回退判定({ 位们: 建位们(), 失败单们: opts.失败单 || 失败单摘(root), 历史, 参, 覆盖: 参.人工覆盖 })) {
    const r = 执行动作(root, cfg, { 动作: '回退', 位: d.位, 池: d.到, 预期版本: 版本(cfg), 操作者: '项管', 由: '项管自动', 理由: d.因 }, { ...opts, 现在, 保存, 活单: 单们 });
    if (r.ok) out.回退.push({ ...d, 事件: r.事件 }); else out.拒.push({ ...d, error: r.error });
  }

  // ② 平衡 / 归位
  历史 = 历史Of(ledger.events(root, 800), 参, 现在);
  for (const d of 决策({ 位们: 建位们(), 读数: 读数 || {}, 参, 历史, 覆盖: 参.人工覆盖 })) {
    if (d.动作 === '切' || d.动作 === '归位') {
      const r = 执行动作(root, cfg, {
        动作: '切换', 位: d.位, 池: d.到, ...(d.动作 === '归位' ? { 档: d.目标档 || '', 因类: '品味锁' } : {}),
        预期版本: 版本(cfg), 操作者: '项管', 由: '项管自动', 理由: d.因, 触发读数: d.触发读数 || null,
      }, { ...opts, 现在, 保存, 活单: 单们 });
      if (r.ok) out.切.push({ ...d, 事件: r.事件 }); else out.拒.push({ ...d, error: r.error });
      continue;
    }
    if (d.动作 === '拒') {
      记(root, '池衡拒绝', { 位: d.位, 因类: d.因类, 由: '项管自动', 操作者: '项管', 从: d.当前池, 到: d.拟切 ? d.拟切.到 : null, 因: d.因 });
      out.拒.push(d);
      continue;
    }
    out.不切.push(d);
  }
  return out;
}

// ================= 矩阵视图（要件 9）=================
function 矩阵(cfg, 读数, opts = {}) {
  const 参 = 参数(cfg);
  const 现在 = opts.现在 || Date.now();
  const 事件们 = opts.事件 || [];
  const 历史 = 历史Of(事件们, 参, 现在);
  const 单们 = opts.活单 || [];
  const 高 = 品味档(cfg);
  const 位 = 位全集(cfg).map((b) => {
    const 锁 = 品味锁(b, 单们);
    const ov = 参.人工覆盖[b.位] || null;
    const 最近 = 历史.最近[b.位] || null;
    return {
      ...b, 锁: 锁 ? { ...锁, 应为: 'claude' + (高 ? '/' + 高 : ''), 合规: 锁合规(cfg, b) } : null,
      覆盖: ov, 最近切换: 最近 ? new Date(最近.t).toISOString() : null,
      读数: b.当前池 ? (读数 || {})[b.当前池] || null : null,
    };
  });
  const 池 = Object.values(读数 || {}).map((r) => ({ ...r, 冷却至: 历史.冷却至[r.池] ? new Date(历史.冷却至[r.池]).toISOString() : null }));
  return {
    版本: 版本(cfg), 参数: { ...参, 人工覆盖: undefined }, 开: 参.开, 品味档: 高,
    位, 池, 动作白名单, 操作域,
    事件: 事件们.filter((e) => 池衡事件类型.includes(e.类型)).slice(-5).reverse(),
    覆盖: 参.人工覆盖,
  };
}

module.exports = {
  默认参数, 参数, 品味档, 判官位, 禁改域, 动作白名单, 操作域, 池衡事件类型,
  位全集, 解析位, 执行位名,
  归一读数, 订阅可用度, 按量可用度, 按量池们, 采集, 探余额, 余额端点, 活单摘, 失败单摘,
  品味锁, 锁合规, 历史Of, 决策, 回退判定,
  切片, 版本, 校验版本, 落位, 执行动作, 巡检, 矩阵,
};
