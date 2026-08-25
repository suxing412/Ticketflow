// dep-edit.test.js — 依赖前端入口（落实表 P0-5 · 2026-08-24）
// 判据全走 frontend-sandbox 真跑（H104：assert.match(源码,正则) 不算判据，本项目已判掉 22 条）：
// ① 队列页待办卡真画出「编依赖」入口，终态卡不画；
// ② 弹窗预填现有依赖，提交体真带 依赖（[{ref,规则}]）与 预期版本，规则默认「全部完成」、已有规则沿用；
// ③ CAS 冲突（冲突:true+现态）→ 人话提示 + 按服务端回传的新版本号恰重试一次；
// ④ 留空提交＝清空（依赖:[]）；⑤ 自引用前端先拦，不发请求。
// 本套件只装载 public/app.js 的 vm 沙盒，不 require lib/，不碰 pool/runner/quota，无需外呼打桩。
const assert = require('node:assert');
const { 装载前端 } = require('./frontend-sandbox');

let passed = 0; const 队 = [];
const t = (n, f) => 队.push(async () => { await f(); passed++; console.log('  ✓ ' + n); });
console.log('依赖前端入口测试（P0-5）');

// 队列页夹具：g1 计划态（该有入口）、g2 完成态（终态，不该有）
const 队列夹具 = () => ({
  q: { 摘要: { 文: '共 2 项' },
    批们: [{ 批: 'B-1', 完结: false, 计数: { 总: 2, 未完: 1, 完: 1 }, 预估: 3,
      粒: [{ 粒ID: 'g1', 状态: '计划', 徽章: '计划', 题: '甲', 上级: 'S-1', 序: 1, 提示: '' },
        { 粒ID: 'g2', 状态: '完成', 徽章: '完成', 题: '乙', 上级: 'S-1', 序: 2, 提示: '' }] }] },
  粒表: { g1: { 状态: '计划', 就绪: false, 题: '甲', 版本号: 3, 依赖: [{ ref: 'TK-2', 规则: '全部完成' }] },
    g2: { 状态: '完成', 题: '乙', 版本号: 9 } },
});

t('入口（2026-08-26 迁）：待办队列拆除后 编依赖 入口迁甘特右键菜单；壳层函数链仍在', () => {
  // 队列卡入口随区块拆除；菜单入口的行为判据在 gantt-viewpack ⑥（菜单Html 真产 m-editdeps 项、
  // 终态/史条不产）。本席只守壳层能力：入口指到的函数必须真存在——菜单点了不能静默无事发生。
  const ctx = 装载前端();
  assert.equal(ctx.待办队列Html, undefined, '待办队列Html 已拆除，不许残留');
  assert.equal(typeof ctx.tqEditDeps, 'function', '菜单项指到的 tqEditDeps 要真存在');
  assert.equal(typeof ctx.tqEditDepsGo, 'function', '提交函数 tqEditDepsGo 要真存在');
});

// 弹窗+提交的公共装配：桩 fetch（GET /api/schedule 给现态，POST 全捕获）、桩 showModal 捕 HTML
const 开测 = (现粒, POST应答) => {
  const ctx = 装载前端();
  const 呼 = []; const 吐 = [];
  ctx.fetch = async (u, o) => {
    const url = decodeURIComponent(String(u));
    if (!o) { // GET：取待办 现读现态
      return { ok: true, json: async () => ({ 粒: [现粒] }) };
    }
    const body = o.body ? JSON.parse(o.body) : null;
    呼.push({ url, body });
    const 答 = typeof POST应答 === 'function' ? POST应答(呼.length, body) : (POST应答 || { ok: true, 粒: {} });
    return { ok: true, json: async () => 答 };
  };
  ctx.toast = (m) => 吐.push(String(m));
  ctx.repaint = () => {};
  let 模 = '';
  ctx.showModal = (inner) => { 模 = String(inner); return { querySelector: () => null }; };
  const 原取 = ctx.document.getElementById;
  const 填 = (v) => { ctx.document.getElementById = (id) => (id === 'dep-v' ? { value: v } : 原取(id)); };
  return { ctx, 呼, 吐, 模: () => 模, 填 };
};
const 计划粒 = { 粒ID: 'g1', 状态: '计划', 版本号: 3, 题: '甲', 上级: 'S-1', 序: 1,
  依赖: [{ ref: 'TK-2', 规则: '任一完成' }] };

t('提交体：弹窗预填现有 ref；逗号分隔解析成 [{ref,规则}]，已有规则沿用、新 ref 默认全部完成，带 预期版本', async () => {
  const { ctx, 呼, 模, 填 } = 开测(计划粒);
  await ctx.tqEditDeps('g1');
  assert.match(模(), /编依赖/, '弹窗没开');
  assert.match(模(), /TK-2/, '弹窗必须预填现有依赖 ref');
  填(' TK-2，Q5, TK-9 ');           // 中英文逗号混用+冗余空白，全该吃得下
  await ctx.tqEditDepsGo('g1', 3, null);
  assert.equal(呼.length, 1, '该恰好发一次调整');
  assert.equal(呼[0].url, '/api/schedule/调整', '要打现成的 调整 口，不另立写口');
  const b = 呼[0].body;
  assert.equal(b.粒ID, 'g1');
  assert.equal(b.预期版本, 3, 'CAS 版本号必须随行');
  assert.equal(b.操作者, '总监', '写账署名走 排期署名');
  assert.deepEqual(b.依赖, [
    { ref: 'TK-2', 规则: '任一完成' },   // 原有规则沿用，不被默认值悄悄重置
    { ref: 'Q5', 规则: '全部完成' },
    { ref: 'TK-9', 规则: '全部完成' },
  ], '依赖形状必须是后端 规范依赖 认的 [{ref,规则}]');
});

t('CAS 冲突：人话提示 + 按服务端回传现态版本号恰重试一次，第二发带新版本', async () => {
  const { ctx, 呼, 吐, 填 } = 开测(计划粒, (第几发) => (第几发 === 1
    ? { ok: false, error: '版本冲突：预期 3，现 7', 冲突: true, 现态: { 版本号: 7 } }
    : { ok: true, 粒: { 版本号: 8 } }));
  await ctx.tqEditDeps('g1');
  填('Q5');
  await ctx.tqEditDepsGo('g1', 3, null);
  assert.equal(呼.length, 2, '冲突后该恰重试一次（不多不少）');
  assert.equal(呼[0].body.预期版本, 3);
  assert.equal(呼[1].body.预期版本, 7, '重试必须带服务端回传的新版本号');
  assert.ok(吐.some((m) => m.includes('版本冲突') && m.includes('7')), '要给人话提示并报新版本号：' + JSON.stringify(吐));
  assert.ok(吐.some((m) => m.includes('已更新依赖')), '重试成功后要报成功');
});

t('CAS 连续冲突：重试仍冲突就停手报失败，不无限连发', async () => {
  const { ctx, 呼, 吐, 填 } = 开测(计划粒,
    () => ({ ok: false, error: '版本冲突：又被人改了', 冲突: true, 现态: { 版本号: 9 } }));
  await ctx.tqEditDeps('g1');
  填('Q5');
  await ctx.tqEditDepsGo('g1', 3, null);
  assert.equal(呼.length, 2, '只许重试一次，第二次冲突必须停手');
  assert.ok(吐.some((m) => m.includes('编依赖失败')), '二连冲突要如实报失败：' + JSON.stringify(吐));
});

t('清空：输入留空提交 依赖:[]（后端认 [] 为清空全部）', async () => {
  const { ctx, 呼, 填 } = 开测(计划粒);
  await ctx.tqEditDeps('g1');
  填('   ');
  await ctx.tqEditDepsGo('g1', 3, null);
  assert.equal(呼.length, 1);
  assert.deepEqual(呼[0].body.依赖, [], '留空＝清空，依赖必须是空数组而不是缺键（缺键是「这格不动」）');
});

t('自引用：依赖填到自己头上，前端先拦、一个请求都不发', async () => {
  const { ctx, 呼, 吐, 填 } = 开测(计划粒);
  await ctx.tqEditDeps('g1');
  填('Q5, g1');
  await ctx.tqEditDepsGo('g1', 3, null);
  assert.equal(呼.length, 0, '自引用不该发到后端（后端也会拒，但前端先拦省一趟）');
  assert.ok(吐.some((m) => m.includes('自己')), '要说清为什么拦：' + JSON.stringify(吐));
});

t('终态：完成态待办点开编依赖直接劝退，不开弹窗', async () => {
  const ctx = 装载前端();
  const 吐 = [];
  ctx.fetch = async () => ({ ok: true, json: async () => ({ 粒: [{ 粒ID: 'g2', 状态: '完成', 版本号: 9, 题: '乙' }] }) });
  ctx.toast = (m) => 吐.push(String(m));
  let 开了 = false;
  ctx.showModal = () => { 开了 = true; return { querySelector: () => null }; };
  await ctx.tqEditDeps('g2');
  assert.equal(开了, false, '终态不许开编依赖弹窗');
  assert.ok(吐.some((m) => m.includes('终态')), '要说明是终态拦的：' + JSON.stringify(吐));
});

(async () => { for (const f of 队) await f(); console.log('全部通过：' + passed + ' 项'); })()
  .catch((e) => { console.error('  ✗ ' + (e && e.message)); process.exit(1); });
