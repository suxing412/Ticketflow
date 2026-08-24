// gantt-stance-close.test.js — 表态「派发」消债闭环 + 甘特读口项目视界（终审 T1/T3 · 2026-08-24）
//
// 病例（codex 终审 #3）：选「派发」只落审计痕——债不消、状态不推进，重绘后同一条待重判还在。
// 修法三件套，全在这里端到端锁死（STUDIO_STUB 真服务，同 gantt-p1 判据③ 的成例）：
//   ① G23 谓词（lib/pm/schedule.越线待表态判，gatereg 与 /api/schedule 共用同一份）补表态豁免：
//      已表态（任一决定，折叠记 末次表态时刻）且表态晚于本次越线时刻 ⇒ 债消；
//   ② 决定=派发 且粒有单号 ⇒ 同一请求内复用 life.放行 落 fm.放行（写口唯一，与看板「放行」钮同产线）；
//      无单号纯计划粒只落表态事件（派单是人闸 H57，表态不代行）；
//   ③ 表态=重排 挪到未来 ⇒ 债同样消（越线判据 计划开始≤now 自然不再命中）。
// 附带（终审 T1 服务端半）：GET /api/schedule?项目= 生效时，跨项目端点的边标 外部:true；
// 不带参数则不判跨项目——前端带参取数的那半在 relay-scope 判据锁。
//
// 变异自证（H104，施工中实跑，改坏→红→复原绿）：
//   m1 删 越线待表态判 的表态豁免两行 ⇒ 「派发后 G23:GA 消失」「待表态 摘除」当场红（gatereg 豁免档同红）；
//   m2 删 server.js 表态动作的 life.放行 联动 ⇒ 「fm.放行 落盘」「G1:TK-77 消债」当场红。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeRoot, seed } = require('./helper');
const store = require('../lib/core/store');

let passed = 0;
const 待 = [];
const t = (n, f) => 待.push([n, f]);
console.log('gantt-stance-close 表态消债闭环端到端判据（终审 T1/T3）');

t('端到端：越线三粒立债→派发消债（有单号联动 fm.放行）→重排消债→甘特 待表态 全程联动；?项目= 边集视界', () => {
  const root = makeRoot();
  // 工单侧：TK-77 窝在待派（未放行 ⇒ G1 债在、G23 可派视野含它）；TF-9 是别家项目的在途单（跨项目前置样本）
  seed(root, '待派', { id: 'TK-77', 项目: 'TK' });
  seed(root, '在途', { id: 'TF-9', 项目: 'Ticketflow' });
  // 排程台账：GA/GB/GC 三粒计划态越线（计划开始已过），GD 未来粒带跨项目依赖（只为边集，不进债）
  const ev = (粒ID, 字段变更) => JSON.stringify({ 粒ID, 事件类型: '登记', 字段变更, 版本号: 1, 时刻: '2026-08-01T01:00:00Z', 操作者: '总监' });
  fs.mkdirSync(path.join(root, '排程台账'), { recursive: true });
  fs.writeFileSync(path.join(root, '排程台账', '排程账.jsonl'), [
    ev('GA', { 题: '越线无单', 状态: '计划', 项目: 'TK', 计划开始: '2026-08-01T09:00', 计划完成: '2026-08-01T12:00' }),
    ev('GB', { 题: '越线有单', 状态: '计划', 项目: 'TK', 单号: 'TK-77', 计划开始: '2026-08-01T09:00', 计划完成: '2026-08-01T12:00' }),
    ev('GC', { 题: '越线待重排', 状态: '计划', 项目: 'TK', 计划开始: '2026-08-01T13:00', 计划完成: '2026-08-01T15:00' }),
    ev('GD', { 题: '跨项目依赖样本', 状态: '计划', 项目: 'TK', 计划开始: '2030-01-01T09:00', 计划完成: '2030-01-01T12:00', 依赖: [{ ref: 'TF-9', 规则: '全部完成' }] }),
  ].join('\n') + '\n', 'utf8');
  const port = 4973;
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js').replace(/\\/g, '/'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const 表态口 = B + '/api/schedule/' + encodeURIComponent('表态');
      const GET = async (p) => (await fetch(B + p)).json();
      const P = async (body) => { const r = await fetch(表态口, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
      const 债键 = async () => (await GET('/api/attn')).债.map((d) => d.gateKey);
      const 表态图 = async () => { const s = await GET('/api/schedule'); return Object.fromEntries(s.粒.map((g) => [g.粒ID, g.待表态 === true])); };
      const 版 = async (id) => (await GET('/api/schedule')).粒.find((g) => g.粒ID === id).版本号;
      const out = {};
      out.前债 = await 债键(); out.前标 = await 表态图();
      const 挑边 = (s) => (s.边 || []).find((e) => e.from && e.from.单号 === 'TF-9');
      out.边无参 = 挑边(await GET('/api/schedule'));
      out.边带参 = 挑边(await GET('/api/schedule?' + encodeURIComponent('项目') + '=TK'));
      out.派GA = await P({ 粒ID: 'GA', 预期版本: await 版('GA'), 触发源: '今时线', 决定: '派发', 操作者: '总监' });
      out.中债 = await 债键(); out.中标 = await 表态图();
      out.派GB = await P({ 粒ID: 'GB', 预期版本: await 版('GB'), 触发源: '今时线', 决定: '派发', 操作者: '总监' });
      out.重GC = await P({ 粒ID: 'GC', 预期版本: await 版('GC'), 触发源: '今时线', 决定: '重排', 类别: '优先级不够',
        新计划开始: '2030-02-01T09:00', 新计划完成: '2030-02-01T12:00', 因: '排位让给主线，后挪', 操作者: '总监' });
      out.后债 = await 债键(); out.后标 = await 表态图();
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e && e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 120000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const o = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  if (o.起服务失败) throw new Error('起服务失败：' + o.起服务失败);
  // —— 立债前提自证（没有这段，后面的「消失」可能是从来就没立过）——
  for (const k of ['G23:GA', 'G23:GB', 'G23:GC']) assert.ok(o.前债.includes(k), `前提：越线粒 ${k} 债须在`);
  assert.ok(o.前债.includes('G1:TK-77'), '前提：TK-77 待派未放行，G1 项管闸债须在');
  assert.deepEqual([o.前标.GA, o.前标.GB, o.前标.GC, !!o.前标.GD], [true, true, true, false],
    '前提：/api/schedule 对三张越线粒下发 待表态:true（GD 未来粒不标）——甘特灰显读的就是这格');
  // —— T1 服务端半：项目视界只作边集标注轴 ——
  assert.ok(o.边无参 && o.边无参.外部 === false, '不带 ?项目=：跨项目前置不判外部（schedule-edges 契约）');
  assert.ok(o.边带参 && o.边带参.外部 === true && /跨项目/.test(String(o.边带参.外部因)),
    '带 ?项目=TK：TF-9 前置边须标 外部:true（跨项目）——甘特读口带参后此边在项目页显 .ext');
  // —— 派发（无单号）：表态事件即消债，不代行派单（H57 人闸）——
  assert.equal(o.派GA.status, 200, '无单号越线粒表态派发须过闸');
  assert.ok(!o.派GA.body.放行, '无单号粒没有放行联动（派单是人闸，表态不代行）');
  assert.ok(!o.中债.includes('G23:GA'), '派发后 G23:GA 债须消失（表态豁免谓词）——删豁免分支此断言当场红');
  assert.ok(!o.中标.GA, '派发后 /api/schedule 不再对 GA 下发 待表态——甘特待重判标记随之消失（T2 联动）');
  assert.ok(o.中债.includes('G23:GB') && o.中债.includes('G23:GC'), '别家的债不许被连带消掉');
  // —— 派发（有单号）：同一请求联动 fm.放行（复用 life.放行 写口）——
  assert.equal(o.派GB.status, 200, '有单号越线粒表态派发须过闸');
  assert.deepEqual(o.派GB.body.放行, { ok: true, 单号: 'TK-77' }, '响应体须报放行联动结果');
  assert.ok(!o.后债.includes('G23:GB'), '派发后 G23:GB 债消');
  assert.ok(!o.后债.includes('G1:TK-77'), 'fm.放行 落盘后 G1 待派候放行债同步消——联动走的正是那道闸读的旗');
  const 单 = store.find(root, 'TK-77');
  assert.ok(单 && 单.state === '待派' && 单.fm.放行 === true,
    'fm.放行=true 须真落盘且单不动窝（放行是标记不是目录跳变，H109）——删 server 联动此断言当场红');
  // —— 重排：挪到未来，债同样消 ——
  assert.equal(o.重GC.status, 200, '表态重排须过闸');
  assert.ok(!o.后债.includes('G23:GC'), '重排到未来后 G23:GC 债消（计划开始>now，越线判据自然不再命中）');
  assert.deepEqual([!!o.后标.GA, !!o.后标.GB, !!o.后标.GC], [false, false, false],
    '收尾：三粒的 待表态 全数摘除——重绘后甘特上不再有同一条待重判（终审 #3 病例正身）');
});

(async () => {
  for (const [n, f] of 待) { await f(); passed++; console.log('  ✓ ' + n); }
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => {
  console.error('  不通过：' + (e && e.message));
  console.error(e && e.stack);
  process.exit(1);
});
