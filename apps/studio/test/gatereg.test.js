// gatereg.test.js — 闸注册表 + 等我()（施工令-061 第二节）
// 病灶：决策台按「工单状态」找人闸，专项关账这类非工单闸结构上看不见——08-20 实测欠 3 笔只报 1 笔。
// 本套件盯三条缝：①换轴后非工单闸收得到 ②发起型不许冒充欠债 ③backlog 不许冒充欠债。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../lib/core/store');
const gr = require('../lib/gatereg');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('闸注册表 + 等我() 测试');

const fm = (id, o = {}) => ({ id, title: id, 职能: '程序', 单型: '实现单', QA: '关', 验收方式: '委托', 项目: 'TK', ...o });
// 空桩：默认依赖会去读真盘，测试里一律注入空实现，只放开被测的那一路
const 空 = {
  specials: { list: () => [] },
  ideas: { list: () => [] },
  schedule: { 现态: () => [] },
  wiki: { pending: () => [] },
};

t('注册表：文件缺失回落缺省 13 条，不静默变空', () => {
  const root = makeRoot();
  const 表 = gr.注册表(root);
  assert.equal(表.length, 13, '缺省 13 条闸（12 条法源闸 + G12 失败分诊）');
  assert.ok(表.every((g) => g.闸号 && g.名称 && g.法源 && g.型 && g.归属), '每条闸五要素齐（含归属）');
  assert.ok(表.some((g) => g.名称 === '专项关账'), 'H103 专项关账在册——它正是决策台看不见的那个');
});

t('注册表：文件在则以文件为准（人可增补）', () => {
  const root = makeRoot();
  fs.writeFileSync(gr.REG_FILE(root), JSON.stringify([
    { 闸号: 'X1', 名称: '自定闸', 法源: '测试', 型: '响应', 判据: '待投', 落点: '看板', 按钮: '放行' },
  ]), 'utf8');
  const 表 = gr.注册表(root);
  assert.equal(表.length, 1);
  assert.equal(表[0].闸号, 'X1');
});

t('发起型闸不产生欠债（开线/入标杆/撤回/废弃/编辑器锁）', () => {
  const root = makeRoot();
  const r = gr.等我(root, { deps: 空 });
  assert.equal(r.计数, 0, '空仓零欠债');
  const 发起 = gr.缺省注册表.filter((g) => g.型 === '发起');
  assert.equal(发起.length, 5, '五条发起型');
  assert.ok(发起.every((g) => g.判据 === null), '发起型判据显式为 null——没有队列就不许有 pending');
});

t('换轴实证：专项关账收得到（非工单实体，旧决策台结构上看不见）', () => {
  const root = makeRoot();
  const r = gr.等我(root, {
    现在: '2026-08-20T00:00:00Z',
    deps: { ...空, specials: { list: () => [
      { id: 'S-1', fm: { 名称: '编辑器专项', 状态: '收口', 关账时间: null, 收口时间: '2026-08-18T00:00:00Z' } },
      { id: 'S-2', fm: { 名称: '已关账的', 状态: '关账', 关账时间: '2026-08-19T00:00:00Z' } },
      { id: 'S-3', fm: { 名称: '还在跑', 状态: '进行', 关账时间: null } },
    ] } },
  });
  assert.equal(r.计数, 1, '只有 收口且未关账 那一笔算欠债');
  assert.equal(r.债[0].gateKey, 'G6:S-1');
  assert.equal(r.债[0].停摆小时, 48, '停摆时长按收口时刻算');
});

t('严判据：委托待验收在等判官，不算你的活；保留待验收才算', () => {
  const root = makeRoot();
  seed(root, '待验收', { id: 'TK-1', 验收方式: '委托' });
  seed(root, '待验收', { id: 'TK-2', 验收方式: '保留' });
  const r = gr.等我(root, { deps: 空 });
  assert.deepEqual(r.债.map((x) => x.id), ['TK-2'], '委托单不进人闸清单（施工令-038 案源 TK-117）');
});

t('严判据：有活跃会话的单不算你的活（判官正在跑）', () => {
  const root = makeRoot();
  seed(root, '待验收', { id: 'TK-3', 验收方式: '保留' });
  const r = gr.等我(root, { deps: { ...空, 活跃单: new Set(['TK-3']) } });
  assert.equal(r.计数, 0);
});

t('backlog 不冒充欠债：计划态待办须显式标就绪才算候放行', () => {
  const root = makeRoot();
  const 粒 = (id, o) => ({ 粒ID: id, 题: id, 状态: '计划', ...o });
  const r1 = gr.等我(root, { deps: { ...空, schedule: { 现态: () => [粒('g1'), 粒('g2'), 粒('g3')] } } });
  assert.equal(r1.计数, 0, '未标就绪的排期 backlog 一笔都不算——虚报会把清单变噪声');
  const r2 = gr.等我(root, { deps: { ...空, schedule: { 现态: () => [粒('g1'), 粒('g2', { 就绪: true })] } } });
  assert.deepEqual(r2.债.map((x) => x.id), ['g2']);
});

t('幂等：同闸同实体只算一笔（gateKey 去重）', () => {
  const root = makeRoot();
  const dup = { fm: { 名称: '同一个', 状态: '收口', 关账时间: null, 收口时间: '2026-08-19T00:00:00Z' }, id: 'S-9' };
  const r = gr.等我(root, { deps: { ...空, specials: { list: () => [dup, dup, dup] } } });
  assert.equal(r.计数, 1);
});

t('排序：停摆最久的排最前；时长未知的垫底', () => {
  const root = makeRoot();
  const r = gr.等我(root, {
    现在: '2026-08-20T00:00:00Z',
    deps: { ...空, specials: { list: () => [
      { id: 'S-新', fm: { 名称: '新', 状态: '收口', 关账时间: null, 收口时间: '2026-08-19T22:00:00Z' } },
      { id: 'S-久', fm: { 名称: '久', 状态: '收口', 关账时间: null, 收口时间: '2026-08-10T00:00:00Z' } },
      { id: 'S-无', fm: { 名称: '无戳', 状态: '收口', 关账时间: null } },
    ] } },
  });
  assert.deepEqual(r.债.map((x) => x.id), ['S-久', 'S-新', 'S-无']);
});

t('逾期：按小时阈值筛，缺省 24h', () => {
  const root = makeRoot();
  const deps = { ...空, specials: { list: () => [
    { id: 'S-老', fm: { 名称: '老', 状态: '收口', 关账时间: null, 收口时间: '2026-08-18T00:00:00Z' } },
    { id: 'S-新', fm: { 名称: '新', 状态: '收口', 关账时间: null, 收口时间: '2026-08-19T20:00:00Z' } },
  ] } };
  assert.deepEqual(gr.逾期(root, 24, { 现在: '2026-08-20T00:00:00Z', deps }).map((x) => x.id), ['S-老']);
  assert.equal(gr.逾期(root, 100, { 现在: '2026-08-20T00:00:00Z', deps }).length, 0);
});

t('一条判据哑掉不带崩全表（失败如实登记，不假装为空）', () => {
  const root = makeRoot();
  const r = gr.等我(root, { deps: { ...空,
    specials: { list: () => { throw new Error('盘读挂了'); } },
    ideas: { list: () => [{ id: 'i1', 文: '一个想法' }] },
  } });
  assert.equal(r.计数, 1, '别的闸照常出数');
  assert.equal(r.失败.length, 1);
  assert.equal(r.失败[0].闸号, 'G6');
  assert.match(r.失败[0].因, /盘读挂了/);
});

t('禁以通知为数据源：模块不 require inbox（硬约束①的机器判据）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'gatereg.js'), 'utf8');
  const 代码 = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/require\(['"].*inbox/.test(代码), '收件箱是广播不是账本——377 条未读即实证');
});

t('归属分流：总监的闸不报进制作人清单（混数就说不清欠的是谁的）', () => {
  const root = makeRoot();
  seed(root, '执行失败', { id: 'TK-90' });
  seed(root, '待验收', { id: 'TK-91', 验收方式: '保留' });
  assert.deepEqual(gr.等我(root, { deps: 空, 归属: '制作人' }).债.map((x) => x.id), ['TK-91']);
  assert.deepEqual(gr.等我(root, { deps: 空, 归属: '总监' }).债.map((x) => x.id), ['TK-90'], '失败分诊归总监');
  assert.equal(gr.等我(root, { deps: 空 }).计数, 2, '不传归属即全收');
});

console.log('全部通过：' + passed + ' 项');
