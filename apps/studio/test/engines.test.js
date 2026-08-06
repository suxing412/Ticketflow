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

t('引擎作业：无锁 / 路径不存在 / 空路径 → null（不出行不报错）', () => {
  assert.equal(engines.jobStatus(null), null);
  assert.equal(engines.jobStatus(path.join(tmp(), '压根不存在')), null);
  assert.equal(engines.jobStatus(tmp()), null); // 目录在但没锁
});

t('引擎作业：有锁无日志 → 锁在、log秒 null（文件缺失静默）', () => {
  const proj = tmp();
  fs.mkdirSync(path.join(proj, '.enginectl-lock'));
  fs.writeFileSync(path.join(proj, '.enginectl-lock', 'pid'), '27448');
  const r = engines.jobStatus(proj);
  assert.equal(r.锁, true); assert.equal(r.pid, '27448');
  assert.equal(r.log秒, null); assert.equal(r.停滞, false);
});

t('引擎作业：日志新鲜 → 秒数小、不停滞；停更 >7 分钟 → 停滞告警', () => {
  const proj = tmp();
  fs.mkdirSync(path.join(proj, '.enginectl-lock'));
  fs.writeFileSync(path.join(proj, '.enginectl-lock', 'pid'), '1234');
  const log = path.join(proj, 'enginectl-test.log');
  fs.writeFileSync(log, 'run');
  const fresh = engines.jobStatus(proj);
  assert.ok(fresh.log秒 < 5); assert.equal(fresh.停滞, false);
  const old = Date.now() - 8 * 60000;
  fs.utimesSync(log, new Date(old), new Date(old));
  const stale = engines.jobStatus(proj);
  assert.ok(stale.log秒 > 7 * 60); assert.equal(stale.停滞, true);
});

t('引擎作业：空 pid 文件当无锁（写了一半的锁不误报）', () => {
  const proj = tmp();
  fs.mkdirSync(path.join(proj, '.enginectl-lock'));
  fs.writeFileSync(path.join(proj, '.enginectl-lock', 'pid'), '  \n');
  assert.equal(engines.jobStatus(proj), null);
});

console.log(`全部通过：${passed} 项`);
