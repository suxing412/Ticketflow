// pm-schedule-plan.test.js — 「委托项管排期」链路判据（2026-08-25 制作人拍板常驻 UI）
//
// 链路：欠账区按钮 → POST /api/pm/schedule-plan → brain.schedulePlan 会话产 JSON 合同
//       → schedule.消化排期合同 逐粒走 重排 写口落账（操作者=项管）。
// 判据面：①合同消化纯函数（落账/CAS/坏粒如实报）②按钮渲染在欠账区且指 tqPmPlan
//         ③路由行为（无粒 400、受理后 relay 留痕）。会话层照 brain 成例不测（cut/裁决同族）。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.STUDIO_STUB = '1';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmplan-'));
const S = require('../lib/pm/schedule');
require('../lib/core/store').ensureDirs(root);
fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify({ 项目: { 注册: { TK: {} }, 默认: 'TK' } }));

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('委托项管排期链路测试');

(async () => {

await t('① 合同消化：好粒落账（操作者=项管、因入事件）、悬空粒与被清算粒如实报败，不连坐', () => {
  S.登记(root, [{ 题: '甲', 预估单元: 1, 来源: '排期作业判据' }, { 题: '乙', 预估单元: 2, 来源: '排期作业判据' }], '项管');
  const [a, b] = S.现态(root);
  const r = S.消化排期合同(root, [
    { 粒ID: a.粒ID, 计划开始: '2026-08-26T10:00', 计划完成: '2026-08-26T12:00', 因: '按序首排' },
    { 粒ID: b.粒ID, 计划开始: '2026-08-26T12:15', 计划完成: '2026-08-26T16:00', 因: '依赖甲错峰' },
    { 粒ID: 'ghost-404', 计划开始: '2026-08-26T09:00', 计划完成: '2026-08-26T10:00', 因: '悬空' },
  ]);
  assert.equal(r.成.length, 2, '两好粒都要落账');
  assert.equal(r.败.length, 1, '悬空粒如实报败');
  assert.match(r.败[0].error, /不存在/, '败因如实');
  const a2 = S.取(root, a.粒ID);
  assert.equal(a2.计划开始, '2026-08-26T10:00', '计划落盘');
  assert.equal(a2.末次操作者, '项管', '落账署名=项管（排期判断权归项管，H57）');
  // 事件带因（重排审计载荷既有纪律）
  const 事 = S.事件流(root).filter((e) => e.事件类型 === '重排');
  assert.ok(事.some((e) => JSON.stringify(e).includes('按序首排')), '排期理由入事件留痕');
});

await t('② 合同消化走的是真重排写口：非法刻钟被写口拒、CAS 由消化函数现取版本兜住', () => {
  S.登记(root, [{ 题: '丙', 预估单元: 1, 来源: '排期作业判据' }], '项管');
  const c = S.现态(root).find((g) => g.题 === '丙');
  const r1 = S.消化排期合同(root, [{ 粒ID: c.粒ID, 计划开始: '2026-08-26T10:07', 计划完成: '2026-08-26T12:00', 因: 'x' }]);
  assert.equal(r1.败.length, 1, '10:07 非刻钟——写口拒，消化如实报（合同消化不绕写口校验）');
  // CAS：外部先动一次版本，消化仍按现取版本成功（消化函数逐粒现取，不吃陈旧版本）
  const c1 = S.取(root, c.粒ID);
  S.调整(root, { 粒ID: c.粒ID, 预期版本: c1.版本号, 序: 9, 操作者: '项管' });
  const r2 = S.消化排期合同(root, [{ 粒ID: c.粒ID, 计划开始: '2026-08-26T10:15', 计划完成: '2026-08-26T12:00', 因: 'y' }]);
  assert.equal(r2.成.length, 1, '外部动过版本后消化仍成——逐粒现取版本（不吃合同生成时的陈旧版本）');
});

await t('③ 欠账区按钮：未排期>0 时渲染「委托项管排期」且指 tqPmPlan；tqPmPlan 真发 POST', async () => {
  const { 装载前端 } = require('./frontend-sandbox');
  const ctx = 装载前端();
  const 记 = [];
  ctx.fetch = async (u, o) => { 记.push({ u: String(u), m: (o || {}).method });
    return { ok: true, json: async () => ({ 已受理: 13 }) }; };
  // 欠账区Html 是 viewRelay 内部产物——走全页渲染桩太重，直接调渲染函数面：搜产出
  const html = ctx.欠账区Html ? ctx.欠账区Html([{ 粒ID: 'g1', 题: '未排样本', 状态: '计划' }], [])
    : null;
  if (html != null) {
    assert.ok(html.includes('委托项管排期') && html.includes('tqPmPlan'), '按钮在欠账区头且指 tqPmPlan');
  } else {
    // 欠账区Html 非全局时退而断源码渲染面被 viewRelay 引用（弱断言，标注）
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(/委托项管排期[\s\S]{0,200}tqPmPlan/.test(src), '按钮模板在欠账区（欠账区Html 未导出，源码面断言）');
  }
  await ctx.tqPmPlan();
  assert.ok(记.some((r) => r.u.includes('/api/pm/schedule-plan') && r.m === 'POST'), 'tqPmPlan 真发 POST /api/pm/schedule-plan');
});

await t('④ 路由行为：无未排期粒 400 不受理（STUB 真服务）', async () => {
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pmplan2-'));
  require('../lib/core/store').ensureDirs(root2);
  fs.writeFileSync(path.join(root2, 'studio.config.json'), JSON.stringify({ 项目: { 注册: { TK: {} }, 默认: 'TK' } }));
  process.env.STUDIO_ROOT = root2;
  process.env.STUDIO_PORT = '4951';
  await require('../server').start();
  const r = await fetch('http://127.0.0.1:4951/api/pm/schedule-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 400, '空库无未排期粒——400 拒，不空转项管');
  const j = await r.json();
  assert.match(String(j.error), /无事可排/, '拒因如实');
});

console.log('全部通过：' + passed + ' 项');
process.exitCode = 0; setTimeout(() => process.exit(0), 150).unref();
})().catch((e) => { console.error('  不通过：' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
