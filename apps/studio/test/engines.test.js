// engines.test.js — 引擎档案自检：发现契约（env 优先）+ Unity 版本纪律 + 无档案不出灯
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const engines = require('../lib/engines');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('engines 引擎档案自检测试');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eng-'));
// 假 Unity Hub：<hub>/<版本>/Editor/Unity.exe
const fakeHub = (vers) => {
  const hub = tmp();
  for (const v of vers) { const d = path.join(hub, v, 'Editor'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'Unity.exe'), ''); }
  return hub;
};

t('无引擎档案 → null（探针不出灯）', () => {
  assert.equal(engines.checkProject({ 路径: 'x' }), null);
  assert.equal(engines.checkProject(null), null);
});

t('未知引擎类型 → 黄', () => {
  const r = engines.checkProject({ 路径: 'x', 引擎: { 类型: 'cocos' } });
  assert.equal(r.级别, '黄');
});

t('godot：env 指到真实文件 → 绿并回报路径', () => {
  const f = path.join(tmp(), 'godot_console.exe'); fs.writeFileSync(f, '');
  const r = engines.checkProject({ 路径: 'x', 引擎: { 类型: 'godot' } }, { ENGINECTL_GODOT: f });
  assert.equal(r.级别, '绿'); assert.ok(r.note.includes('godot'));
});

t('unity：编辑器未装 → 黄（引擎单不可用）', () => {
  const r = engines.checkProject({ 路径: tmp(), 引擎: { 类型: 'unity' } }, { ENGINECTL_UNITY_HUB: tmp() });
  assert.equal(r.级别, '黄'); assert.ok(r.note.includes('未装'));
});

t('unity 版本纪律：ProjectVersion.txt ≠ 本机 → 黄拒开警示（工程文件优先于注册申报）', () => {
  const proj = tmp(); fs.mkdirSync(path.join(proj, 'ProjectSettings'));
  fs.writeFileSync(path.join(proj, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.9.9f1\n');
  const hub = fakeHub(['6000.3.10f1']);
  const r = engines.checkProject({ 路径: proj, 引擎: { 类型: 'unity', 版本: '6000.3.10f1' } }, { ENGINECTL_UNITY_HUB: hub });
  assert.equal(r.级别, '黄'); assert.ok(r.note.includes('版本纪律'));
});

t('unity 版本匹配 → 绿', () => {
  const proj = tmp(); fs.mkdirSync(path.join(proj, 'ProjectSettings'));
  fs.writeFileSync(path.join(proj, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.3.10f1\n');
  const r = engines.checkProject({ 路径: proj, 引擎: { 类型: 'unity' } }, { ENGINECTL_UNITY_HUB: fakeHub(['6000.3.10f1']) });
  assert.equal(r.级别, '绿'); assert.ok(r.note.includes('版本匹配'));
});

t('unreal：未装 → 黄；有 UE_* 目录 → 绿', () => {
  const empty = tmp();
  assert.equal(engines.checkProject({ 路径: 'x', 引擎: { 类型: 'unreal' } }, { ENGINECTL_UE: empty }).级别, '黄');
  const base = tmp(); fs.mkdirSync(path.join(base, 'UE_5.7'));
  assert.equal(engines.checkProject({ 路径: 'x', 引擎: { 类型: 'unreal' } }, { ENGINECTL_UE: base }).级别, '绿');
});

console.log(`全部通过：${passed} 项`);
