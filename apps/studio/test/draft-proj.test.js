// draft-proj.test.js — 派单委托的项目透传（2026-08-21 对账补）
// 病灶：施工令-061 让 Ticketflow 自立为第二项目（前缀 TF），brain.draftTicket 也早认 opts.项目，
// **唯独 /api/pm/draft 这条委托路没把它传下去**——于是监制台自维护的活会被编进游戏的号段。
// 这一格只有真起服务才验得出来（lib 层没断，断的是端点接线），故本套件全走端点实跑。
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeRoot, seed, 临时目录 } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('派单委托 · 项目透传测试');

const 起 = (root, port, 打法) => {
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const P = async (u, body) => { const r = await fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { j = {}; } return [r.status, j]; };
      const out = ${打法};
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  return JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
};
// 双项目注册（生产形状）：TK 默认，Ticketflow 前缀 TF
const 双项目 = (root) => {
  const f = path.join(root, 'studio.config.json');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.项目 = { 默认: 'TK', 注册: { TK: { 路径: root, 单号前缀: 'TK' }, Ticketflow: { 路径: root, 单号前缀: 'TF' } } };
  fs.writeFileSync(f, JSON.stringify(c), 'utf8');
};

t('未注册的项目名整条拒，不静默落回默认项目', () => {
  const root = makeRoot(); 双项目(root);
  const o = 起(root, 4941, `await P('/api/pm/draft', { 需求: '测试', 项目: '不存在的项目' })`);
  assert.equal(o[0], 400, '不认的项目名必须 400');
  assert.match(String(o[1].error), /未注册的项目/);
  assert.match(String(o[1].error), /Ticketflow/, '错误里要列出可选项，不然人不知道该填什么');
});

t('带项目 → 回执如实报该项目；不带 → 回落项目默认（老调用方行为不变）', () => {
  const root = makeRoot(); 双项目(root);
  const o = 起(root, 4942, `{ 带: await P('/api/pm/draft', { 需求: '监制台自维护的活', 项目: 'Ticketflow' }), 不带: await P('/api/pm/draft', { 需求: '游戏侧的活' }) }`);
  assert.equal(o.带[0], 200);
  assert.equal(o.带[1].项目, 'Ticketflow', '带了就得按带的走——这一格漏传正是本条病灶');
  assert.equal(o.不带[0], 200);
  assert.equal(o.不带[1].项目, 'TK', '不带即项目默认，缺省行为一字不变');
});

t('接线判据：项目真传进了 draftTicket 的 opts（传了不用等于没传）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const seg = src.slice(src.indexOf("app.post('/api/pm/draft'"), src.indexOf("app.post('/api/pm/draft'") + 4500); // P0-7 依赖透传块加长了处理器，窗口同步放宽
  assert.match(seg, /draftTicket\(ROOT, cfg, 需求, projPath,/, '调用点还在');
  assert.match(seg, /项目: name \|\| null/, 'opts 里必须带项目——brain 据它选号段');
});

// ═══ P0-7（2026-08-24 落实表）：draftFm 白名单补 依赖 + /api/pm/draft 透传粒依赖 ═══
// 病灶两截：①draftFm 白名单没有 依赖 ——提示词契约明写「依赖（需求点名了就写）」，模型写了
// 也被落盘静默吞掉（与 H88 依据、TK-106~116 管线同病）；②带粒起草时，粒身上的 依赖[{ref,规则}]
// 全程没人搬——工单落盘后看不出前置。判据三层全走真函数/真接口，LLM 外呼一律换成假 CLI/捕获桩。

const brain = require('../lib/pm/brain');

t('draftFm：模型写了依赖 → 白名单带过去；没写不造字段；委托注入盖过模型自填', () => {
  const 块 = '```ticket\ntitle: x\n依赖: TK-1，TK-2\n---\n## 范围\n验\n```';
  const { tickets } = brain.parseTickets(块);
  const fm = brain.draftFm(tickets[0], { id: 'TK-150', 项目: 'TK' });
  assert.equal(fm.依赖, 'TK-1，TK-2', '模型自填的依赖被白名单吞掉——正是本条病灶');
  assert.ok(!('依赖' in brain.draftFm({ fm: {} }, { id: 'TK-151', 项目: 'TK' })), '没写依赖不该凭空长出字段');
  const 注 = brain.draftFm(tickets[0], { id: 'TK-152', 项目: 'TK', 依赖: 'TK-9' });
  assert.equal(注.依赖, 'TK-9', '委托注入（排程台账是事实源）必须盖过模型自填');
});

t('端点透传：带依赖的粒起草 → 单号形直取、粒ID形解析成回填单号、解析不了丢弃并 journal 留痕', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'TK-12' }); // 单号形 ref 的实体（P0-4 引用检要它真存在）
  const brainPath = JSON.stringify(path.join(__dirname, '..', 'lib', 'pm', 'brain.js'));
  const o = 起(root, 4943, `await (async () => {
    // LLM 面捕获桩（同 STUDIO_STUB 的替换术）：只捕 opts，不起真会话
    const bm = require(${brainPath});
    let 截获 = null;
    bm.draftTicket = (rt, cf, xq, pp, cb, opts) => { 截获 = { 需求: xq, opts }; cb({ ok: true, 单: 'TK-99' }); };
    const 登 = await P('/api/schedule/%E7%99%BB%E8%AE%B0', { 操作者: '总监', 粒: [
      { 题: '前置甲', 来源: 'P07', 状态: '已成单', 单号: 'TK-77' },
      { 题: '前置乙', 来源: 'P07' } ] });
    const 新增 = (登[1] || {}).新增 || [];
    const 甲 = (新增.find((g) => g.题 === '前置甲') || {}).粒ID;
    const 乙 = (新增.find((g) => g.题 === '前置乙') || {}).粒ID;
    const 主 = await P('/api/schedule/%E7%99%BB%E8%AE%B0', { 操作者: '总监', 粒: [
      { 题: '主粒', 来源: 'P07', 依赖: [{ ref: 'TK-12' }, { ref: 甲 }, { ref: 乙 }] } ] });
    const 主ID = (((主[1] || {}).新增 || [])[0] || {}).粒ID;
    const d = await P('/api/pm/draft', { 需求: '验证依赖透传', 粒ID: 主ID });
    const fsx = require('fs'); const px = require('path');
    let 志 = '';
    try { const jd = px.join(process.env.STUDIO_ROOT, 'journal');
      for (const f of fsx.readdirSync(jd)) 志 += fsx.readFileSync(px.join(jd, f), 'utf8'); } catch { 志 = ''; }
    return { 登态: 登[0], 主态: 主[0], d态: d[0], 截获, 乙, 志有丢弃: 志.includes('依赖透传丢弃') && !!乙 && 志.includes(乙) };
  })()`);
  assert.equal(o.登态, 200, '前置两粒登记须过（含直登已成单+单号）');
  assert.equal(o.主态, 200, '主粒登记须过（ref 全部真实存在，兼容 P0-4 引用检）');
  assert.equal(o.d态, 200, '带粒起草受理须过');
  assert.ok(o.截获, 'draftTicket 未被调到——委托链断了');
  assert.equal(o.截获.opts.依赖, 'TK-12，TK-77',
    '透传串必须=单号形直取+粒ID形解析回填单号（计划态无单号的乙不得混入）——去掉 server.js 依赖串 计算即红');
  assert.ok(o.志有丢弃, '解析不了的 ref（乙，计划态无单号）必须丢弃并 journal 留痕');
});

t('起草落盘：真 draftTicket（假 CLI）→ 草稿 md frontmatter 含 依赖 且粒挂钩起草中', () => {
  const root = makeRoot();
  const 桩目录 = 临时目录('p07cli-');
  // 假 CLI：吃完 stdin 后原样吐一段 ticket 块（不含 依赖 行——依赖走注入路，不靠模型转述）
  fs.writeFileSync(path.join(桩目录, 'canned.txt'),
    '```ticket\ntitle: 依赖透传验证\n职能: 程序\n专项: S-3\n---\n## 背景\n验证起草链的依赖透传。\n\n## 执行内容\n验证 P0-7 透传。\n\n## 验收标准\n依赖字段随草稿落盘。\n```\n\n## 起草说明\n无样本，未校准\n', 'utf8');
  fs.writeFileSync(path.join(桩目录, 'fake-cli.js'),
    "const fs=require('fs');const path=require('path');\n"
    + "process.stdin.on('data',()=>{});\n"
    + "process.stdin.on('end',()=>{console.log(fs.readFileSync(path.join(__dirname,'canned.txt'),'utf8'));});\n", 'utf8');
  const code = `
    const cp = require('child_process');
    const orig = cp.spawn;
    cp.spawn = function (cmd, args, o) { // 只换 claude 外呼；node（假 CLI 自身）照走
      if (/claude/i.test(String(cmd))) return orig(process.execPath, [process.env.FAKE_CLI], { windowsHide: true });
      return orig.apply(cp, arguments);
    };
    const brain = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'pm', 'brain.js'))});
    const schedule = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'pm', 'schedule.js'))});
    const store = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'core', 'store.js'))});
    const fs = require('fs');
    const root = process.env.STUDIO_ROOT;
    const r1 = schedule.登记(root, [{ 题: '主粒', 来源: 'P07C' }], '总监');
    if (!r1.ok) { process.stdout.write('@@' + JSON.stringify({ 登记失败: r1.error }) + '@@'); process.exit(1); }
    const 粒ID = r1.新增[0].粒ID;
    brain.draftTicket(root, {}, '验证 P0-7 起草落依赖', null, (r) => {
      const t2 = r.ok ? store.find(root, r.单) : null;
      const raw = t2 ? fs.readFileSync(t2.file, 'utf8') : '';
      const g = schedule.取(root, 粒ID);
      process.stdout.write('@@' + JSON.stringify({ r, fm依赖: t2 && t2.fm.依赖,
        raw含依赖: raw.includes('依赖') && raw.includes('TK-12，TK-77'),
        粒态: g && g.状态, 粒单号: g && g.单号 }) + '@@');
      process.exit(0);
    }, { 粒ID, 依赖: 'TK-12，TK-77' });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, FAKE_CLI: path.join(桩目录, 'fake-cli.js') },
  });
  const o = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  assert.ok(o.r && o.r.ok, '真 draftTicket 走假 CLI 必须成单：' + JSON.stringify(o));
  assert.equal(o.fm依赖, 'TK-12，TK-77', '落盘 fm 必须含注入的依赖——去 draftFm 白名单/注入项即红');
  assert.ok(o.raw含依赖, '磁盘上的 md frontmatter 原文必须含依赖串（不是只在内存对象里）');
  assert.equal(o.粒态, '起草中', '粒须被挂钩到起草中');
  assert.equal(o.粒单号, o.r.单, '粒须回填新单号');
});

console.log('全部通过：' + passed + ' 项');
