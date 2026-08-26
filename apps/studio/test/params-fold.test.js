// params-fold.test.js — 参数页折叠瘦身（TF-8）的行为判据
//
// 判的是**真吐出来的 HTML**，不是源码文本（H104）：装载前端 → 覆盖 fetch 桩喂构造 config →
// 直调 viewParams()，从它返回的那串 HTML 上数卡、剥摘要、看 open。
// `assert.match(app源码, /正则/)` 这类判据在本文件里一条都没有——改名、挪位、被外层 if 绕过，
// 那种断言一概照绿（frontend-sandbox.js 开篇存的就是这条案）。
//
// 为什么「卡数」要从解析真输出得出而不是写死期望：瘦身的收益是**首屏少扫多少张卡**，
// 那个数只有把 details 段剥掉再数才算数。硬编码一个 10 上去，改回平铺它照样绿。
const assert = require('node:assert');
const crypto = require('crypto');
const { 装载前端 } = require('./frontend-sandbox');
const { 收尾 } = require('./helper');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('参数页折叠瘦身测试（TF-8）');

// ── 夹具 ────────────────────────────────────────────────────────────
const 基准CFG = () => ({
  执行器: { 执行超时分钟: 30, 记账间隔分钟: 10 },
  quota: { claudeMinIntervalSeconds: 300 },
  server: { port: 4270 },
  网络: { 远程: { 开: false } },
  执行池: {
    codex: { 阈值: 70, 周阈值: 90 },
    claude: { 阈值: 70, 周阈值: 90 },
    kimi: { 兼容: { base: 'https://api.moonshot.cn', 模型: 'k2', key: '…ab12' }, 职能: ['程序'] },
  },
  模型: { claude默认: 'opus', 项管: 'opus' },
  项目: { 注册: { TK: { 路径: 'D:/GitHub/TK' }, Ticketflow: { 路径: 'D:/GitHub/Ticketflow' } }, 默认: 'TK' },
  闸值白名单: { 待验收积压闸: 8, QA自修上限: 2, 滞留超时小时: 4, 人闸超时小时: 24 },
  闸值: { 待验收积压闸: 8, QA自修上限: 2, 滞留超时小时: 4, 人闸超时小时: 24 },
});
const 基准RUN = () => ({ 运行: false, 间隔秒: 15 });
const MODELS = { claude: { 可选: ['opus', 'sonnet'] }, codex: { 可选: ['gpt-5'] } };

// 池衡夹具：判据⑥拿它跑 pbHtml() 与改造前的黄金串对拍
const PB夹具 = {
  开: true, 版本: 7,
  池: [{ 池: 'claude', 可用度: 62, 源: '/api/gates', 明细: [{ 窗: '5h', 已用: 38, 阈值: 70 }], 读数时刻: '2026-08-26T10:00' },
    { 池: 'codex', 盲区: true, 源: 'cli', 因: '无 usage' }],
  位: [{ 位: '执行-1', 类型: '执行', 当前池: 'claude', 档: 'sonnet', 读数: { 可用度: 62 }, 最近切换: '2026-08-26T09:30' },
    { 位: '质检-1', 类型: '质检', 当前池: 'claude', 档: 'opus', 读数: { 盲区: true },
      锁: { 应为: 'opus', 合规: true, 因: '品味锁' }, 覆盖: { 由: '总监', 理由: '手动', 时刻: '2026-08-26T09:00' } }],
  事件: [{ 类型: '池衡切换', t: '2026-08-26T09:30', 位: '执行-1', 从: 'codex', 到: 'claude', 由: '项管', 因类: '可用度差' }],
  参数: { 最小间隔分钟: 5, 阈值差: 10, 冷却分钟: 15, 失败回退次数: 1 },
};
// 改造前（HEAD 版 app.js）实测出来的黄金值，2026-08-26 现场取：长度 2286。
// 它锁的是「池衡面一个字节都没被这次瘦身碰到」——pbHtml/pbLoad/pbOverride/pbRelease/pbToggle/pbStep 是本单硬禁区。
const PB黄金 = { 长度: 2286, sha256: '1de54fea8c9147d4b2cac36e8da97590b92e8198ff6d07000a09f6a1b0a6ba1e' };

async function 开参数页({ cfg = 基准CFG(), run = 基准RUN(), 记忆 = {} } = {}) {
  const ctx = 装载前端();
  for (const [k, v] of Object.entries(记忆)) ctx.localStorage.setItem(k, v);
  ctx.fetch = async (u) => {
    const p = String(u);
    const b = p.startsWith('/api/config') ? cfg : p.startsWith('/api/runner') ? run : p.startsWith('/api/models') ? MODELS : {};
    return { ok: true, json: async () => b };
  };
  const html = await ctx.viewParams();
  return { ctx, html };
}

// ── 解析件：一律作用在真输出上 ────────────────────────────────────
const 卡正则 = () => /<div[^>]*class="[^"]*\bcard\b[^"]*"[^>]*>/g;
const 数卡 = (s) => (String(s).match(卡正则()) || []).length;

// 把 HTML 切成「每个 details 一段 + 剩下的顶层一段」。分区归属就靠这个切法判：
// 卡落在哪一段，它就属于哪一区——比按行号/顺序猜可靠。
function 分段(html) {
  const 段 = []; let 余 = String(html);
  for (const m of String(html).match(/<details\b[\s\S]*?<\/details>/g) || []) {
    段.push({ 区: (m.match(/data-fold="([^"]+)"/) || [])[1] || '?', 文: m });
    余 = 余.replace(m, '');
  }
  段.push({ 区: '顶层', 文: 余 });
  return 段;
}
const 归属 = (html, 锚) => { const s = 分段(html).find((x) => 锚.test(x.文)); return s ? s.区 : null; };
// 「这个 details 展开着吗」＝开标签上有没有 open **属性**。
// 不能写成 /\bopen\b/：ontoggle="p6FoldToggle('tune',this.open)" 里的 this.open 会让它永远为真
// （第一次跑就踩了这一脚，五个区全被判成展开）。所以要求 open 前面必须是空白、后面是空白或 >。
const 有open = (tag) => /\sopen(?=[\s>])/.test(String(tag));
const 开标签 = (html, id) => (String(html).match(new RegExp(`<details[^>]*data-fold="${id}"[^>]*>`)) || [''])[0];
const 摘要文 = (html, id) => {
  const m = String(html).match(new RegExp(`<details[^>]*data-fold="${id}"[\\s\\S]*?</summary>`));
  return m ? m[0].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
};

// 执行内容①的分区名单，逐卡定死（改造前实测 31 张带 .card 的卡 + 零高度的 #budget-dead）
const 名单 = [
  ['顶层', /id="run-card"/, '执行器状态卡'],
  ['顶层', /data-key="待验收积压闸"/, '闸值·待验收积压闸'],
  ['顶层', /data-key="QA自修上限"/, '闸值·QA自修上限'],
  ['顶层', /data-key="滞留超时小时"/, '闸值·滞留超时'],
  ['顶层', /data-key="人闸超时小时"/, '闸值·人闸超时'],
  ['顶层', /id="env-card"/, '环境探针'],
  ['顶层', /id="creds-card"/, '凭据'],
  ['顶层', /id="budget-dead"/, '预算闸失效位（零高度）'],
  ['顶层', /id="pool-codex"/, '额度双池·codex'],
  ['顶层', /id="pool-claude"/, '额度双池·claude'],
  ['顶层', /id="pb-card"/, '池位矩阵'],
  ['tune', /data-runkey="间隔秒"/, '间隔秒'],
  ['tune', /data-runkey="执行超时分钟"/, '执行超时分钟'],
  ['tune', /data-runkey="记账间隔分钟"/, '记账间隔分钟'],
  ['tune', /data-qk/, '额度刷新秒'],
  ['svc', /<h4>服务端口<\/h4>/, '服务端口'],
  ['svc', /<h4>远程访问<\/h4>/, '远程访问'],
  ['look', /data-theme-card/, '外观主题'],
  ['model', /<h4>claude默认<\/h4>/, '模型档·claude默认'],
  ['model', /<h4>codex默认<\/h4>/, '模型档·codex默认'],
  ['model', /<h4>质检<\/h4>/, '模型档·质检'],
  ['model', /<h4>代核<\/h4>/, '模型档·代核'],
  ['model', /<h4>代裁<\/h4>/, '模型档·代裁'],
  ['model', /<h4>项管<\/h4>/, '模型档·项管'],
  ['model', /<h4>可选模型增补<\/h4>/, '可选模型增补'],
  ['model', /<h4>兼容池 · kimi<\/h4>/, '兼容池·kimi'],
  ['model', /<h4>＋ 新增兼容池<\/h4>/, '＋ 新增兼容池'],
  ['proj', /id="proj-rows"/, '项目注册'],
  ['proj', /data-pl="codex\.阈值"/, '执行池阈值·codex 阈值'],
  ['proj', /data-pl="codex\.周阈值"/, '执行池阈值·codex 周阈值'],
  ['proj', /data-pl="claude\.阈值"/, '执行池阈值·claude 阈值'],
  ['proj', /data-pl="claude\.周阈值"/, '执行池阈值·claude 周阈值'],
];

(async () => {

// ── 判据① 默认闭合 ─────────────────────────────────────────────────
await t('① 恰好 5 个 <details>，标题＝定死的五区，且默认一个 open 都没有', async () => {
  const { html } = await 开参数页();
  const ds = html.match(/<details\b[\s\S]*?<\/details>/g) || [];
  assert.equal(ds.length, 5, `折叠区该是 5 个，实得 ${ds.length}`);
  const 标题 = ds.map((d) => ((d.match(/<span class="p6fold-t">([^<]*)<\/span>/) || [])[1] || '').trim());
  assert.deepEqual(标题, ['执行器细调', '服务与访问', '外观', '模型档', '项目与池阈值'],
    '五区标题与执行内容①的名单对不上：' + JSON.stringify(标题));
  const 开着的 = ds.filter((d) => 有open((d.match(/<details[^>]*>/) || [''])[0]));
  assert.equal(开着的.length, 0,
    '无记忆时必须全闭合，实测有 ' + 开着的.length + ' 个带 open：'
    + JSON.stringify(开着的.map((d) => (d.match(/data-fold="([^"]+)"/) || [])[1])));
});

// ── 判据② 首屏卡数下降 ─────────────────────────────────────────────
await t('② 首屏（不在闭合 details 内）顶层卡 ≤14，折叠区内卡 ≥15——数字由解析真输出得出', async () => {
  const { html } = await 开参数页();
  const 段 = 分段(html);
  const 折内 = 段.filter((s) => s.区 !== '顶层').reduce((n, s) => n + 数卡(s.文), 0);
  const 顶层 = 数卡(段.find((s) => s.区 === '顶层').文);
  console.log(`    ├ 顶层卡 ${顶层} 张（改造前 31）`);
  console.log(`    └ 折叠区内卡 ${折内} 张 · 合计 ${顶层 + 折内}`);
  assert.ok(顶层 <= 14, `首屏该 ≤14 张，实得 ${顶层}`);
  assert.ok(折内 >= 15, `折叠区内该 ≥15 张，实得 ${折内}`);
  assert.equal(顶层 + 折内, 数卡(html), '切段时漏了卡：分段后的合计必须等于整页卡数');
});

// ── 判据③ 零卡丢失 ─────────────────────────────────────────────────
await t('③ 名单上 32 张卡全部仍在，且每张的分区归属与名单一致', async () => {
  const { html } = await 开参数页();
  const 缺 = []; const 错区 = [];
  for (const [区, 锚, 名] of 名单) {
    const 实 = 归属(html, 锚);
    if (实 === null) 缺.push(名);
    else if (实 !== 区) 错区.push(`${名}：名单 ${区} / 实测 ${实}`);
  }
  assert.deepEqual(缺, [], '这些卡在改造后的 HTML 里找不到了：' + JSON.stringify(缺));
  assert.deepEqual(错区, [], '这些卡跑到了名单外的分区：' + JSON.stringify(错区));
});

await t('③续 写口一个没断：11 个交互入口照常可点（mSet 挂的是 onchange，别的是 onclick）', async () => {
  const { html } = await 开参数页();
  const 断 = [
    ...['pStep(', 'rrStep(', 'plStep(', 'mAdd(', 'qtStep(', 'portSave(',
      'remoteToggle(', 'themeSet(', 'compatEdit(', 'projAdd('].filter((f) => !html.includes('onclick="' + f)),
    ...['mSet('].filter((f) => !html.includes('onchange="' + f)),
  ];
  assert.deepEqual(断, [], '这些写口的事件挂点在渲染结果里没了：' + JSON.stringify(断));
});

// ── 判据④ 摘要吃真数据 ─────────────────────────────────────────────
await t('④ 摘要跟着 config 翻：间隔 15→60 / 端口 4270→4300 / claude 阈值 70→85', async () => {
  const 甲 = await 开参数页();
  const 乙cfg = 基准CFG(); 乙cfg.server.port = 4300; 乙cfg.执行池.claude.阈值 = 85;
  const 乙 = await 开参数页({ cfg: 乙cfg, run: { 运行: false, 间隔秒: 60 } });

  const 取 = (h) => ({ tune: 摘要文(h, 'tune'), svc: 摘要文(h, 'svc'), proj: 摘要文(h, 'proj') });
  const a = 取(甲.html); const b = 取(乙.html);
  console.log(`    ├ 甲 ${a.tune} ｜ ${a.svc} ｜ ${a.proj}`);
  console.log(`    └ 乙 ${b.tune} ｜ ${b.svc} ｜ ${b.proj}`);

  assert.match(a.tune, /间隔 15s/); assert.match(b.tune, /间隔 60s/);
  assert.match(a.svc, /端口 4270/); assert.match(b.svc, /端口 4300/);
  assert.match(a.proj, /claude 阈值 70%/); assert.match(b.proj, /claude 阈值 85%/);
  // 三格全都必须**跟着变**——摘要写成常量串时这三条一起红
  for (const k of ['tune', 'svc', 'proj']) assert.notEqual(a[k], b[k], `${k} 区摘要两份夹具吐出同一串，它没在读真数据：${a[k]}`);
});

await t('④续 摘要里的项目数/兼容池数/档数也是真数出来的', async () => {
  const cfg = 基准CFG();
  cfg.项目.注册.第三仓 = { 路径: 'D:/x' };
  cfg.执行池.glm = { 兼容: { base: 'https://glm', 模型: 'glm-4' } };
  cfg.模型 = { claude默认: 'opus', codex默认: 'gpt-5', 项管: 'opus' };
  const { html } = await 开参数页({ cfg });
  assert.match(摘要文(html, 'proj'), /已注册 3 个项目/);
  assert.match(摘要文(html, 'model'), /已配 3\/6 档 · 兼容池 2 个/);
});

// ── 判据⑤ 展开态记忆 ───────────────────────────────────────────────
await t('⑤ localStorage 有记录的区渲染带 open，清掉就不带', async () => {
  const 记 = await 开参数页({ 记忆: { 'studio-p6fold-model': '1' } });
  assert.ok(有open(开标签(记.html, 'model')), '记了展开态，模型档区却没带 open：' + 开标签(记.html, 'model'));
  assert.ok(!有open(开标签(记.html, 'svc')), '只记了 model，svc 区不该跟着展开');

  const 清 = await 开参数页({ 记忆: { 'studio-p6fold-model': '0' } });
  assert.ok(!有open(开标签(清.html, 'model')), '记录被清成 0 后不该再带 open');
});

await t('⑤续 ontoggle 真把展开态写回 localStorage（下次进页才恢复得了）', async () => {
  const { ctx, html } = await 开参数页();
  assert.match(html, /ontoggle="p6FoldToggle\('model',this\.open\)"/, '折叠头没接上记忆写回');
  ctx.p6FoldToggle('model', true);
  assert.equal(ctx.localStorage.getItem('studio-p6fold-model'), '1');
  ctx.p6FoldToggle('model', false);
  assert.equal(ctx.localStorage.getItem('studio-p6fold-model'), '0');
});

// ── 判据⑥ 池衡面零改动 ─────────────────────────────────────────────
await t('⑥ pb-card 仍在顶层常驻，不在任何 details 里', async () => {
  const { html } = await 开参数页();
  assert.equal(归属(html, /id="pb-card"/), '顶层', '池位矩阵卡被收进折叠区了——本单硬禁区');
  assert.match(html, /<div class="card pbcard" id="pb-card">/, 'pb-card 的 DOM 结构被动过');
});

await t('⑥续 pbHtml() 与改造前逐字节一致（同夹具对拍 HEAD 版实测黄金值）', async () => {
  const { ctx } = await 开参数页();
  const 出 = ctx.pbHtml(PB夹具);
  const sha = crypto.createHash('sha256').update(出, 'utf8').digest('hex');
  console.log(`    └ pbHtml 长度 ${出.length} · sha256 ${sha.slice(0, 16)}…`);
  assert.equal(出.length, PB黄金.长度, '池衡卡渲染长度变了');
  assert.equal(sha, PB黄金.sha256, '池衡卡渲染结果与改造前不再逐字节一致');
});

await t('⑥续 池衡四参数格与六个写口函数原样在位', async () => {
  const { ctx } = await 开参数页();
  for (const f of ['pbHtml', 'pbLoad', 'pbOverride', 'pbRelease', 'pbToggle', 'pbStep']) {
    assert.equal(typeof ctx[f], 'function', `${f} 不在了`);
  }
  const 出 = ctx.pbHtml(PB夹具);
  for (const k of ['最小间隔分钟', '阈值差', '冷却分钟', '失败回退次数']) {
    assert.ok(出.includes(`data-pbk="${k}"`), `池衡参数格 ${k} 不见了`);
  }
});

收尾('参数页折叠瘦身', passed);
})().catch((e) => { console.error('  不通过 ' + (e && e.stack || e)); process.exit(1); });
