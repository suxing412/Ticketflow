// schedule-pacer.test.js — 排期节拍器 + 排期复判（H115，2026-08-25 制作人拍板 A 案+增补机制）
//
// A 案「图=现实」：粒.计划开始 未到点的单不入就绪——甘特上的条即真实执行承诺。
// 增补：单落袋或产线空转时项管复判要不要重排（规则预筛零 token，命中才起会话）。
// 判据面：①readySet 节拍闸四分支 ②sortReady 排期次序 ③复判契约解析 ④会话层照 brain 成例不测。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.STUDIO_STUB = '1';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pacer-'));
const store = require('../lib/core/store');
const S = require('../lib/pm/schedule');
const D = require('../lib/pm/dispatch');
store.ensureDirs(root);
fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify({ 项目: { 注册: { TK: {} }, 默认: 'TK' } }));

const 造单 = (id, fm = {}, 态 = '待派') => {
  fs.writeFileSync(path.join(root, 态, id + '.md'),
    '---\n' + Object.entries({ id, title: id + '题', 职能: '程序', 放行: true, ...fm })
      .map(([k, v]) => k + ': ' + JSON.stringify(v)).join('\n') + '\n---\n正文\n');
};
const 时串 = (offsetMin) => {
  const d = new Date(Date.now() + offsetMin * 60000);
  const p = (n) => String(n).padStart(2, '0');
  // 刻钟对齐（登记校验要求 00/15/30/45）
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('排期节拍器与复判测试（H115）');

(async () => {

await t('① 节拍闸分支（H115 + H116 扫描面）：已排期到点入池 / 未到点不入 / 待派散单照旧 / 待派有粒单不直派 / 已排期悬空粒不卡死', () => {
  // 粒 a=过去 1h（到点）、粒 b=未来 2h（未到点）
  S.登记(root, [
    { 题: '到点粒', 预估单元: 1, 来源: 'pacer判据', 计划开始: 时串(-60), 计划完成: 时串(60), 因: '判据' },
    { 题: '未来粒', 预估单元: 1, 来源: 'pacer判据', 计划开始: 时串(120), 计划完成: 时串(240), 因: '判据' },
  ], '项管');
  const [ga, gb] = S.现态(root);
  造单('TK-901', { 粒ID: ga.粒ID }, '已排期');         // H116：有粒的单经排期桥住 已排期，到点即入
  造单('TK-902', { 粒ID: gb.粒ID }, '已排期');         // 已排期但未到点：节拍器拦到点再放
  造单('TK-903', {});                                  // 散单无粒：待派直派道照旧
  造单('TK-904', { 粒ID: 'ghost-绝不存在' });          // 待派里有粒ID 的单：H116 不直派（G24 未排期视野兜）
  造单('TK-905', { 粒ID: 'ghost-也不存在' }, '已排期'); // 已排期悬空粒：台账残缺不许把单永久卡死，照派
  const ids = D.readySet(root, null).map((x) => x.id).sort();
  assert.deepEqual(ids, ['TK-901', 'TK-903', 'TK-905'],
    '已排期到点/散单/已排期悬空入池；未来粒 TK-902 拦到点，待派有粒单 TK-904 不直派（实得 ' + ids.join(',') + '）');
  // 态 字段随行下发（派发 move 以它为源态，不硬编码 待派）
  const 态表 = Object.fromEntries(D.readySet(root, null).map((x) => [x.id, x.态]));
  assert.equal(态表['TK-901'], '已排期');
  assert.equal(态表['TK-903'], '待派');
});

await t('② 排序带排期次序：同优先级下计划开始早者先派；无计划的殿后', () => {
  const 排 = D.sortReady([
    { id: 'x', 优先级: 'P2', 红链: false, 计划开始: '2026-08-26T10:00', 创建时间: '1' },
    { id: 'y', 优先级: 'P2', 红链: false, 计划开始: '2026-08-26T08:00', 创建时间: '2' },
    { id: 'z', 优先级: 'P2', 红链: false, 计划开始: '', 创建时间: '0' },
    { id: 'p0', 优先级: 'P0', 红链: false, 计划开始: '', 创建时间: '9' },
  ]).map((x) => x.id);
  assert.deepEqual(排, ['p0', 'y', 'x', 'z'],
    'P0 仍最先（优先级 > 排期次序）；同级按计划开始早者先；无计划殿后（实得 ' + 排.join(',') + '）');
});

await t('③ 复判契约解析：维持/重排原样收、其他决定与坏 JSON 判 null', () => {
  const { parse复判 } = require('../lib/pm/brain');
  assert.deepEqual(parse复判('说明\n```json\n{"决定":"维持","因":"偏差小"}\n```'), { 决定: '维持', 因: '偏差小' });
  assert.deepEqual(parse复判('```json\n{"决定":"重排","因":"整体前移"}\n```'), { 决定: '重排', 因: '整体前移' });
  assert.equal(parse复判('```json\n{"决定":"观望","因":"x"}\n```'), null, '契约外的决定不认');
  assert.equal(parse复判('没有代码块'), null);
  assert.equal(parse复判('```json\n{坏json\n```'), null);
});

console.log('全部通过：' + passed + ' 项');
process.exitCode = 0; setTimeout(() => process.exit(0), 150).unref();
})().catch((e) => { console.error('  不通过：' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
