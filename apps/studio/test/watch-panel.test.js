// watch-panel.test.js — 总览「值守」区：闸注册表指的门牌必须真存在（2026-08-22 体检 #9 / #31）
//
// 案情：闸注册表里 G13/G14/G15/G16/G17 五条的「落点」都写着「总览 · 值守」，
// 而总览从来没有值守这块区；这五条又归总监，被收件箱那道 `归属 !== '总监'` 滤掉。
// 结果是**闸算得出、没有一块屏幕会显示**：实测停最久的两笔（G14 停 274h、G13 停 243h）
// 在七个页签里一个像素都没有，兜底只落 journal，而总览只画末 5 行，十几行之后就滚没了。
//
// 判据取行为面：真装 public/app.js（frontend-sandbox）、真调 viewOverview()、断言它吐出来的 HTML。
// **不许写 assert.match(app源码, /值守/)** —— 今天的源码里「值守」二字出现十几次（注释、项管页在线条），
// 那种断言在病灶原样复发时照绿。本轮复核正是靠「把病原样种回去、测试仍全绿」判掉了 22 条这样的假判据。
const assert = require('node:assert');
const { 装载前端 } = require('./frontend-sandbox');
const gatereg = require('../lib/gatereg');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('总览值守区测试');

// 总览要摸四个接口：/api/board（loadBoard）、/api/journal、/api/agents、/api/attn。
// 桩按路径分发，未列到的一律给空对象——渲染函数是纯的，这一层够用。
function 备(ctx, attn, 板 = { states: [], board: {}, 隐藏数: 0 }) {
  ctx._showHidden = false; // window 代理对未定义键返回 noop＝真值，不显式关掉会走 ?含隐藏=1
  const 供 = {
    '/api/config': { 项目: { 注册: { TK: {} }, 默认: 'TK' } },
    '/api/board': 板,
    '/api/journal': { lines: [] },
    '/api/agents': {},
  };
  ctx.fetch = async (u) => {
    const k = String(u).split('?')[0];
    if (k === '/api/attn') {
      if (attn === '炸') throw new Error('attn 不可达');
      return { ok: true, json: async () => attn };
    }
    return { ok: true, json: async () => (k in 供 ? 供[k] : {}) };
  };
  return ctx;
}
const 值守区 = (h) => { const i = h.indexOf('<details class="ovwatch'); if (i < 0) return ''; const j = h.indexOf('</details>', i); return h.slice(i, j < 0 ? h.length : j); };

(async () => {

await t('① 总监的债必须有一块屏幕显示——闸算得出而没处显示，等于没算', async () => {
  const ctx = 备(装载前端(), { 计数: 2, 逾期阈值小时: 24, 债: [
    { 闸号: 'G14', 闸名: '账本水位停滞', 归属: '总监', 落点: '总览 · 值守', 按钮: '推水位/分拣',
      id: '瞭望塔账本', title: '未读账本水位未推进', 路由: '#/', 停摆小时: 274 },
    { 闸号: 'G1', 闸名: '投池放行', 归属: '双', 落点: '看板 · 待投列',
      id: 'TK-182', title: '河道分段身份模型', 路由: '#/board', 停摆小时: 76 },
  ], 失败: [] });
  const h = await ctx.viewOverview();
  assert.ok(h.includes('瞭望塔账本'), 'G14 停 274 小时却全 UI 零像素，正是本条的病');
  assert.ok(h.includes('未读账本水位未推进'), '标题也要上屏，光有 id 认不出是什么事');
  assert.ok(h.includes('ovwatch'), '注册表落点写的是「总览 · 值守」，就要真有这块区（按 class 锁，不按字面）');
  assert.ok(h.includes('TK-182'), '制作人的债照旧在「需你处理」，值守区不许把它吃掉');
  assert.ok(h.indexOf('TK-182') < h.indexOf('瞭望塔账本'), '总监的债折叠在制作人收件箱之下，不抢第一屏');
  assert.equal((h.match(/(\d+) 项待你决定/) || [])[1], '1',
    '「需你处理 N」永远只数制作人的——归属分流不许被反向破掉');
  // 落点里的操作提示要跟着走，否则看见一行也不知道该干嘛
  const 区 = 值守区(h);
  assert.ok(/推水位\/分拣/.test(区), '注册表下发的按钮文案要落到行上');
  assert.ok(/已停 11\.4 天/.test(区), '停摆时长要报出来（274h → 11.4 天）');
  assert.ok(/href|location\.hash='#\/'/.test(区), '要能点进落点');
});

await t('② 逾期的值守债默认展开并标红；没逾期的收着', async () => {
  const 造 = (小时) => ({ 逾期阈值小时: 24, 债: [{ 闸号: 'G13', 闸名: '班次归档断更', 归属: '总监',
    落点: '总览 · 值守', 按钮: '补跑一期', id: '班档', title: '夜班档断更', 路由: '#/', 停摆小时: 小时 }] });
  const 逾 = 值守区(await 备(装载前端(), 造(243)).viewOverview());
  const 未 = 值守区(await 备(装载前端(), 造(3)).viewOverview());
  assert.ok(/<details class="ovwatch[^>]*\sopen/.test(逾), '逾期了还默认折叠＝换个方式再藏一次');
  assert.ok(/inbox-row card od/.test(逾), '逾期行要挂 od（红）记号');
  assert.ok(!/<details class="ovwatch[^>]*\sopen/.test(未), '没逾期就别抢版面');
  assert.ok(!/inbox-row card od/.test(未), '没逾期不许标红——狼来了喊多了就没人看了');
  assert.ok(/已停 3 小时/.test(未), '不足一天按小时报');
});

await t('③ 一笔总监债都没有时不画空面板，也不影响制作人那半边', async () => {
  const ctx = 备(装载前端(), { 逾期阈值小时: 24, 债: [
    { 闸号: 'G1', 闸名: '投池放行', 归属: '双', 落点: '看板 · 待投列', id: 'TK-9', title: '甲', 路由: '#/board', 停摆小时: 2 },
  ] });
  const h = await ctx.viewOverview();
  assert.ok(!h.includes('ovwatch'), '没债就不该有这块区（空面板是另一种噪音）');
  assert.ok(h.includes('TK-9'), '制作人的债照常');
  assert.equal((h.match(/(\d+) 项待你决定/) || [])[1], '1');
});

await t('④ 反向锁：注册表里凡落点含「值守」的闸，喂进来都必须落到值守区', async () => {
  // 这条挡的是「下次又加一条 G18，落点照抄『总览 · 值守』，归属写错就又指空门牌」。
  // 不比对落点字面，而是**拿注册表真数据造债、真渲染、看它有没有上屏**。
  const 值守闸 = gatereg.缺省注册表.filter((g) => String(g.落点).includes('值守'));
  assert.ok(值守闸.length >= 1, '注册表得真有这类闸，否则本条锁的是空气：' + 值守闸.length);
  const 债 = 值守闸.map((g, i) => ({ 闸号: g.闸号, 闸名: g.名称, 归属: g.归属, 落点: g.落点,
    按钮: g.按钮, 路由: g.路由, id: 'W-' + i, title: '值守债样本 ' + g.闸号, 停摆小时: 30 + i }));
  const h = await 备(装载前端(), { 逾期阈值小时: 24, 债 }).viewOverview();
  const 区 = 值守区(h);
  assert.ok(区, '有值守闸就必须有值守区');
  for (const x of 债) {
    assert.ok(区.includes(x.id), `${x.闸号}（${x.闸名}）的债没进值守区——注册表又指了一个不存在的门牌`);
    assert.ok(区.includes(x.title), `${x.闸号} 的标题没上屏`);
  }
  assert.equal((h.match(/(\d+) 项待你决定/) || [])[1], '0', '值守闸全归总监，不许混进制作人的计数');
});

await t('⑤ /api/attn 不可达时值守区退场，不许拿老路冒充「无债」', async () => {
  const ctx = 备(装载前端(), '炸', { states: ['待验收'], board: { 待验收: [{ id: 'TK-77', 验收方式: '委托' }] }, 隐藏数: 0 });
  const h = await ctx.viewOverview();
  assert.ok(!h.includes('ovwatch'), 'attn 没到手就没有值守债这个事实，不许凭空画');
  assert.ok(h.includes('TK-77'), '收件箱降级回两态拼接的老路——开机第一屏宁可退化也不空白');
});

console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error(e); process.exit(1); });
