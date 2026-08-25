// project-scope.test.js — 三层实体口的项目视界过滤（2026-08-25 制作人「各项目只显示自己的东西」）
//
// 病例：S-4/S-5 是 Ticketflow 专项，曾串进 TK 甘特树；管线/特性无 项目 字段（建模早于多项目制），
// 任何视图全量下发。修法：fm 补 项目 字段（存量 22 件总监补齐）+ 三口 ?项目= 服务端过滤
// （切在源头，同报表 ③b 一把尺）；无字段实体回落默认项目视图（防将来漏写时静默消失）。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.STUDIO_STUB = '1';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pscope-'));
require('../lib/core/store').ensureDirs(root);
fs.writeFileSync(path.join(root, 'studio.config.json'),
  JSON.stringify({ 项目: { 注册: { 甲: {}, 乙: {} }, 默认: '甲' } }));
// 造实体：甲管线×1、乙管线×1、无字段管线×1（回落默认=甲）；甲特性、乙专项
fs.mkdirSync(path.join(root, '管线'), { recursive: true });
fs.writeFileSync(path.join(root, '管线', 'P-1.md'), '---\nid: P-1\n项目: 甲\n名称: 甲线\n阶段: L0\n状态: 活跃\n---\n');
fs.writeFileSync(path.join(root, '管线', 'P-2.md'), '---\nid: P-2\n项目: 乙\n名称: 乙线\n阶段: L0\n状态: 活跃\n---\n');
fs.writeFileSync(path.join(root, '管线', 'P-3.md'), '---\nid: P-3\n名称: 无主线\n阶段: L0\n状态: 活跃\n---\n');
fs.mkdirSync(path.join(root, '特性'), { recursive: true });
fs.writeFileSync(path.join(root, '特性', 'F-1.md'), '---\nid: F-1\n项目: 甲\n名称: 甲特性\n管线: P-1\n状态: 活跃\n---\n');
fs.mkdirSync(path.join(root, '专项'), { recursive: true });
fs.writeFileSync(path.join(root, '专项', 'S-1.md'), '---\nid: S-1\n项目: 乙\n名称: 乙专项\n类型: 攻坚\n状态: 进行\n---\n');

let passed = 0;
const t = (n, f) => { const r = f(); const 收 = () => { passed++; console.log('  ✓ ' + n); };
  return r && typeof r.then === 'function' ? r.then(收) : 收(); };
console.log('项目视界过滤测试');

(async () => {
process.env.STUDIO_ROOT = root;
process.env.STUDIO_PORT = '4952';
await require('../server').start();
const q = (u, p) => fetch('http://127.0.0.1:4952' + u + (p ? '?' + new URLSearchParams({ 项目: p }) : '')).then((r) => r.json());

await t('管线口：甲视图=甲线+无主线（回落默认），乙视图=乙线，不带参=全量', async () => {
  const 甲 = await q('/api/pipelines', '甲');
  assert.deepEqual(甲.管线.map((x) => x.id).sort(), ['P-1', 'P-3'],
    '甲视图＝甲的+无字段回落（无字段实体静默消失是比串显更糟的漏账）');
  const 乙 = await q('/api/pipelines', '乙');
  assert.deepEqual(乙.管线.map((x) => x.id), ['P-2'], '乙视图只见乙线——串显病例的正身');
  const 全 = await q('/api/pipelines');
  assert.equal(全.管线.length, 3, '不带参＝全量（单项目部署/未选项目语义不变）');
});

await t('特性口与专项口：同一把尺', async () => {
  const f甲 = await q('/api/features', '甲'); const f乙 = await q('/api/features', '乙');
  assert.equal(f甲.特性.length, 1, '甲特性在甲视图');
  assert.equal(f乙.特性.length, 0, '甲特性不许出现在乙视图');
  const s甲 = await q('/api/specials', '甲'); const s乙 = await q('/api/specials', '乙');
  assert.equal(s甲.专项.length, 0, '乙专项不许出现在甲视图（S-4/S-5 病例）');
  assert.deepEqual(s乙.专项.map((x) => x.id), ['S-1'], '乙专项在乙视图');
});

console.log('全部通过：' + passed + ' 项');
process.exitCode = 0; setTimeout(() => process.exit(0), 150).unref();
})().catch((e) => { console.error('  不通过：' + (e && e.message)); console.error(e && e.stack); process.exit(1); });
