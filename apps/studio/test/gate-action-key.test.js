// gate-action-key.test.js — 闸表宣告的动作，必须真的存在（2026-08-28 G4 案）
//
// 案源：G4「入库/入标杆」宣告按钮「入标杆」，而实现三处全无——
// lib/stylelib.js 已删、server.js 五个端点已拆、public/app.js 里连字样都没有。
// 成因不是疏忽：风格库子系统 2026-08-26 **计划内退役**（排程台账「风格库退役第二步」已成单转完成），
// 子系统退了，闸表这一格没跟着退。烂了两天没有任何东西会发现。
//
// 为什么此前发现不了：`按钮` 一列同时装着三种不同的东西——
//   ① 同名动作键（G1 放行、G12 失败分诊）：ACTIONS 里有同名键，点了真跑
//   ② 异名标签（G3「通过归档」实为 验收、G7「拍板立项」实为 立项）：名字对不上，查不了
//   ③ 人工指引（G14 推水位、G15 打包换装、G20 重挂瞭望塔）：根本没有 UI，也不该有
// 三种混在一列，**没有任何机器判据能回答「这颗钮还在不在」**：查 ACTIONS 会把②③全判成死钮
// （实测跑出 12 条命中，11 条误报），不查就永远发现不了①型的真死钮。
//
// 治法是把列拆开：动作键（须真实存在）+ 指引（给人看的话）。下面这条判据盯的就是拆完之后
// 那个能判的一半——凡有 动作键 的闸，该键必须在 server.js 的 ACTIONS 表里。
// 从此「实现被拆了、闸没退」这一类腐烂，从「两天无人知」变成「下一次跑测试就红」。
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const gr = require('../lib/gatereg');
const { makeRoot } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('gate-action-key 闸表动作键实存判据（G4 案）');

// ACTIONS 表的键。**从源码解析而不是 require server.js**：server.js 一加载就起服务、
// 读配置、拉执行器，测试里不能有这些副作用。解析的是那张表的字面结构，
// 加一个动作就多一个键，与运行时是同一份东西。
function actions() {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = s.indexOf('const ACTIONS = {');
  assert.ok(i >= 0, '找不到 ACTIONS 表——本判据的取数口断了，先修这里');
  const 段 = s.slice(i, i + 30000);
  const k = [...段.matchAll(/^ {2}([^\s:{}()]+):\s*\(/gm)].map((m) => m[1]);
  assert.ok(k.length >= 10, `ACTIONS 只解析出 ${k.length} 个键，解析口多半坏了（正常二十余个）`);
  return new Set(k);
}

t('凡有动作键的闸，该键必须真实存在于 ACTIONS（G4 那种死钮当场判红）', () => {
  const A = actions();
  const 表 = gr.注册表(makeRoot());
  const 死 = 表.filter((g) => g.动作键 && !A.has(g.动作键))
    .map((g) => `${g.闸号}「${g.名称}」→ 动作键 ${g.动作键}`);
  assert.deepEqual(死, [],
    '闸表宣告了 ACTIONS 里不存在的动作——点了没反应的按钮比没有这条闸更坏：人会以为自己已经处置过了');
});

t('每条闸都要给得出「该干什么」：动作键与指引不可双空', () => {
  const 表 = gr.注册表(makeRoot());
  const 哑 = 表.filter((g) => !g.动作键 && !String(g.指引 || '').trim()).map((g) => g.闸号);
  assert.deepEqual(哑, [],
    '既没有动作键也没有指引的闸＝告诉你欠着一笔却不说怎么还，正是本仓提案里「缺出口」那一型');
});

t('旧的 按钮 字段已全表退场（留着就是第三把尺，改一处漏两处）', () => {
  const 表 = gr.注册表(makeRoot());
  const 残 = 表.filter((g) => g.按钮 !== undefined).map((g) => g.闸号);
  assert.deepEqual(残, [], '按钮 已拆成 动作键+指引，残留的那格会让消费端各读各的');
});

t('G4 已退役且号不复用（风格库子系统 2026-08-26 退役，闸跟着退）', () => {
  const 表 = gr.注册表(makeRoot());
  assert.equal(表.find((g) => g.闸号 === 'G4'), undefined,
    'G4「入库/入标杆」的实现三处全无，闸必须一起退——号不复用，免得史料里的 G4 指错闸');
});

t('拆分不是改语义：闸数、归属、判据、路由一格未动', () => {
  const 表 = gr.注册表(makeRoot());
  assert.equal(表.length, 25, '原 26 闸退掉 G4 应剩 25——多了少了都说明拆分动了不该动的');
  for (const g of 表) {
    assert.ok(['制作人', '总监', '项管', '双'].includes(g.归属), `${g.闸号} 归属值非法：${g.归属}`);
    assert.ok(String(g.路由 || '').startsWith('#/'), `${g.闸号} 路由丢了：${g.路由}`);
    assert.ok(String(g.法源 || '').trim(), `${g.闸号} 法源丢了——闸没有法源就是凭空立的规矩`);
  }
});

t('等我() 下发的债带指引，不带已退场的按钮（前端读的是这一格）', () => {
  const root = makeRoot();
  const r = gr.等我(root);
  assert.ok(Array.isArray(r.债), '等我 要给得出债数组');
  for (const d of r.债) {
    assert.ok(d.按钮 === undefined, `债 ${d.gateKey} 还在下发 按钮——前端 app.js 读的是 指引，这一格会静默变空`);
    assert.ok('指引' in d, `债 ${d.gateKey} 没带指引，界面上那行就只剩单号`);
  }
});

console.log(`全部通过：${passed} 项`);
