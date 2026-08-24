// schedule-edges.test.js — 依赖边读口判据（甘特施工令 P0-0 裁决④ · 2026-08-24）
// 合成台账（spike-c 十断言正式化）+ /api/schedule 路由层实跑（真起 STUB 服务，验响应含 边/边统计）。
// H104：验行为不 grep 源码；变异自证点见文件尾注释（m1 冲突比较换向 / m3 删 Tarjan 低链，实测见红）。
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeRoot, seed, 收尾 } = require('./helper');
const { 边集 } = require('../lib/pm/schedule-edges');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('依赖边读口测试（P0-0 裁决④）');

/* ═══ 一、合成台账（与 spike-c 同账：正常边/单号ref/规则/跨项目/悬空/自环/三角环/冲突/统计）═══ */
const 造粒 = (id, o = {}) => ({ 粒ID: id, 状态: '计划', 题: id, 项目: 'TK', 依赖: [], ...o });
const 台账粒 = [
  造粒('A', { 计划开始: '2026-08-25T08:00', 计划完成: '2026-08-25T12:00' }),
  造粒('B', { 依赖: [{ ref: 'A', 规则: '全部完成' }], 计划开始: '2026-08-25T13:00', 计划完成: '2026-08-25T18:00' }),
  造粒('D', { 单号: 'TK-9', 状态: '已成单' }),
  造粒('C', { 依赖: [{ ref: 'TK-9', 规则: '全部完成' }] }),
  造粒('E', { 依赖: [{ ref: 'A', 规则: '任一完成' }, { ref: 'D', 规则: '任一完成' }] }),
  造粒('F', { 依赖: [{ ref: 'G', 规则: '全部完成' }] }), 造粒('G', { 项目: 'TF' }),
  造粒('H', { 依赖: [{ ref: 'TK-404', 规则: '全部完成' }] }),
  造粒('X', { 依赖: [{ ref: 'Z' }] }), 造粒('Y', { 依赖: [{ ref: 'X' }] }), 造粒('Z', { 依赖: [{ ref: 'Y' }] }),
  造粒('P', { 计划完成: '2026-08-25' }),                                                      // 纯日期前置（含尾日）
  造粒('Q', { 依赖: [{ ref: 'P' }], 计划开始: '2026-08-25T20:00', 计划完成: '2026-08-26T08:00' }),
];
const 台账单册 = { 'TK-9': { 态: '在途', 项目: 'TK', 归档原因: null, 依赖: null },
                   'TK-50': { 态: '待派', 项目: 'TK', 归档原因: null, 依赖: 'TK-50' } };       // 自环（fm.依赖 自指）
const r = 边集(台账粒, 台账单册, { 项目: 'TK' });
const 找 = (f, to) => r.边.find((e) => e.from.键 === f && e.to.键 === to);

t('① 正常边形状（A→B：非外部/非冲突/非环，规则原样）', () => {
  const e = 找('A', 'B');
  assert.ok(e, 'A→B 这条边必须在');
  assert.deepStrictEqual({ 外部: e.外部, 冲突: e.冲突, 环: e.环, 规则: e.规则, 源: e.源 },
    { 外部: false, 冲突: false, 环: false, 规则: '全部完成', 源: '粒依赖' });
});
t('② 单号 ref 解析到粒（TK-9→粒D），端点同时带单号', () => {
  assert.strictEqual(找('D', 'C').from.粒ID, 'D');
  assert.strictEqual(找('D', 'C').from.单号, 'TK-9');
});
t('③ 任一完成 规则原样下发（E 的两条前置）', () => {
  assert.strictEqual(r.边.filter((e) => e.to.键 === 'E' && e.规则 === '任一完成').length, 2);
});
t('④ 跨项目=外部，外部因写明跨项目（G∈TF → F∈TK）', () => {
  assert.strictEqual(找('G', 'F').外部, true);
  assert.match(String(找('G', 'F').外部因), /跨项目/);
});
t('⑤ 悬空 ref=外部端点（外:TK-404）', () => {
  const 悬 = r.边.find((e) => e.to.键 === 'H');
  assert.deepStrictEqual({ 键: 悬.from.键, 单号: 悬.from.单号, 外部: 悬.外部 },
    { 键: '外:TK-404', 单号: 'TK-404', 外部: true });
});
t('⑥ 自环判环（TK-50 fm.依赖 自指）', () => {
  const 自 = r.边.find((e) => e.from.键 === '单:TK-50');
  assert.ok(自 && 自.环 && 自.from.键 === 自.to.键);
});
t('⑦ 三角环三边同环组（X→Y→Z→X）', () => {
  const 三角 = ['X', 'Y', 'Z'].flatMap((n) => r.边.filter((e) => e.to.键 === n));
  assert.strictEqual(三角.length, 3);
  assert.ok(三角.every((e) => e.环), '三条边都得判环');
  assert.strictEqual(new Set(三角.map((e) => e.环组)).size, 1, '同一个环组号');
});
t('⑧ 顺排不误报冲突（A 完 12:00 → B 起 13:00）', () => {
  assert.strictEqual(找('A', 'B').冲突, false);
});
t('⑨ 纯日期含尾日冲突（P 完 25 全日 → Q 起 25T20:00 早于 25 日尾）', () => {
  assert.ok(找('P', 'Q').冲突, '25T20:00 < 26T00:00（纯日期讫+尾日）必须判冲突');
  assert.match(String(找('P', 'Q').冲突因), /早于/);
});
t('⑩ 统计口径（角标读数：11 边/1 冲突/4 环/2 外部）', () => {
  // 11 边：A→B, D→C, A→E, D→E, G→F, 外:404→H, Z→X, X→Y, Y→Z, P→Q, TK-50 自环；
  // 外部=2（G 跨项目 + TK-404 悬空；D 已成单**非**粒终态不算）；环=3 三角+1 自环。
  assert.deepStrictEqual(r.统计, { 总数: 11, 冲突: 1, 环: 4, 外部: 2 });
});
t('⑪ 单端点终态口径＝depsDone（归档无因=已了结外部；归档带因=账没了不算了结，边保持在场）', () => {
  const 粒们 = [造粒('I', { 依赖: [{ ref: 'TK-60' }] }), 造粒('J', { 依赖: [{ ref: 'TK-61' }] })];
  const 单册 = { 'TK-60': { 态: '归档', 项目: 'TK', 归档原因: null, 依赖: null },
                 'TK-61': { 态: '归档', 项目: 'TK', 归档原因: '废弃', 依赖: null } };
  const g = 边集(粒们, 单册, { 项目: 'TK' });
  const 了 = g.边.find((e) => e.to.键 === 'I'), 欠 = g.边.find((e) => e.to.键 === 'J');
  assert.strictEqual(了.外部, true, '归档且无归档原因＝落袋旧账，标外部不再判');
  assert.match(String(了.外部因), /已了结/);
  assert.strictEqual(欠.外部, false, '带因归档在 depsDone 眼里永不就绪——边必须保持在场，不许藏成外部');
});

/* ═══ 二、路由层实跑：/api/schedule 增发 边/边统计（同一次现态快照），?项目= 定跨项目轴；
       顺手把 P0-0 裁决② 的 board 特性 一格也按行为验掉（不另开套件）═══ */
t('⑫ 真起 STUB 服务：/api/schedule 下发 边+边统计，?项目= 生效；/api/board 下发 特性', () => {
  const root = makeRoot();
  // 排程账直铺（事件源=jsonl 只追加，折叠口径归 schedule.现态——这里铺的就是它读的）
  const ev = (粒ID, 字段变更) => JSON.stringify({ 粒ID, 事件类型: '登记', 字段变更, 版本号: 1, 时刻: '2026-08-24T12:00:00Z', 操作者: '总监' });
  fs.mkdirSync(path.join(root, '排程台账'), { recursive: true });
  fs.writeFileSync(path.join(root, '排程台账', '排程账.jsonl'), [
    ev('GA', { 批: '批A', 序: 1, 题: '前置', 状态: '计划', 项目: 'TK', 计划开始: '2026-08-25T08:00', 计划完成: '2026-08-25T12:00' }),
    ev('GB', { 批: '批A', 序: 2, 题: '后继倒挂', 状态: '计划', 项目: 'TK', 依赖: [{ ref: 'GA', 规则: '全部完成' }], 计划开始: '2026-08-25T10:00', 计划完成: '2026-08-25T16:00' }),
    ev('GG', { 批: '批B', 序: 1, 题: '别家前置', 状态: '计划', 项目: 'TF' }),
    ev('GF', { 批: '批B', 序: 2, 题: '跨项目后继', 状态: '计划', 项目: 'TK', 依赖: [{ ref: 'GG', 规则: '全部完成' }] }),
  ].join('\n') + '\n', 'utf8');
  seed(root, '在途', { id: 'TK-9', 项目: 'TK' });
  seed(root, '待派', { id: 'TK-7', 项目: 'TK', 依赖: 'TK-9', 特性: 'F-3' });
  const port = 4967;
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js').replace(/\\/g, '/'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const G = async (u) => (await fetch(B + u)).json();
      const out = { 全: await G('/api/schedule'), 视界: await G('/api/schedule?%E9%A1%B9%E7%9B%AE=TK'), 板: await G('/api/board') };
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e && e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const o = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  if (o.起服务失败) throw new Error('起服务失败：' + o.起服务失败);

  assert.ok(Array.isArray(o.全.边), '/api/schedule 响应必须带 边 数组——P2 依赖线/DS-7 角标全吃这口');
  assert.ok(o.全.边统计 && typeof o.全.边统计.总数 === 'number', '边统计 四格齐下发');
  assert.strictEqual(o.全.边统计.总数, 3, 'GA→GB、GG→GF、TK-9→TK-7 三条');
  const 倒 = o.全.边.find((e) => e.from.键 === 'GA' && e.to.键 === 'GB');
  assert.ok(倒 && 倒.冲突 === true && /早于/.test(String(倒.冲突因)), '倒挂边的冲突由服务端判死（前端只画不判）');
  assert.strictEqual(o.全.边统计.冲突, 1, '冲突角标读数');
  const 单边 = o.全.边.find((e) => e.from.键 === '单:TK-9' && e.to.键 === '单:TK-7');
  assert.ok(单边 && 单边.源 === '单依赖' && 单边.规则 === '全部完成', 'fm.依赖 摊平进边集（单册注入生效）');
  // ?项目= 只定跨项目标注轴：不带参不判跨项目，带参才把 TF 前置标外部
  const 跨全 = o.全.边.find((e) => e.from.键 === 'GG');
  const 跨视 = o.视界.边.find((e) => e.from.键 === 'GG');
  assert.strictEqual(跨全.外部, false, '缺省视界不判跨项目');
  assert.ok(跨视.外部 === true && /跨项目\(TF\)/.test(String(跨视.外部因)), '?项目=TK 时 TF 前置标外部');
  assert.strictEqual(o.视界.边统计.外部, 1);
  // 裁决②：board 补 特性 一格（四层树 feed 前端拼装的最后一格）
  const 板单 = o.板.board.待派.find((x) => x.id === 'TK-7');
  assert.strictEqual(板单 && 板单.特性, 'F-3', '/api/board 必须下发 fm.特性');
  assert.strictEqual(o.板.board.在途.find((x) => x.id === 'TK-9').特性, null, '无特性下发 null 不下发 undefined');
});

收尾('schedule-edges', passed);
/* 变异自证（H104 已实测，逐个人工翻错见红后复原）：
   m1 冲突比较 b<a 换向 a<b → ⑧⑨⑫ 红    m3 Tarjan 低链回填删掉 → ⑦ 红
   其余备用：m2 完成毫 去 +天毫 → ⑨ 红；m4 自环特判删 → ⑥ 红；m5 单号粒 索引删 → ② 红；
   m6 跨项目支删 → ④⑫ 红；m7 悬空按内部处理 → ⑤ 红；m8 任一强转全部 → ③ 红 */
