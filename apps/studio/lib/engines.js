// engines.js — 引擎档案自检（探针组3 用）
// 发现契约与 套件/enginectl 一致：env > 默认路径；Unity 版本纪律同源
// （batchmode 打开版本不匹配工程会静默升级——探针提前亮黄，别等实弹炸）。
const fs = require('fs');
const path = require('path');

const TYPES = ['godot', 'unity', 'unreal'];

function findGodot(env) {
  const e = env || process.env;
  if (e.ENGINECTL_GODOT && fs.existsSync(e.ENGINECTL_GODOT)) return e.ENGINECTL_GODOT;
  for (const dir of ['D:/engines/godot', 'C:/engines/godot']) {
    try {
      const fl = fs.readdirSync(dir);
      const f = fl.find((x) => /console\.exe$/i.test(x)) || fl.find((x) => /Godot.*\.exe$/i.test(x));
      if (f) return path.join(dir, f);
    } catch { /* 下一个 */ }
  }
  return null;
}
function findUnityVersions(env) {
  const base = (env || process.env).ENGINECTL_UNITY_HUB || 'C:/Program Files/Unity/Hub/Editor';
  try { return fs.readdirSync(base).filter((v) => fs.existsSync(path.join(base, v, 'Editor', 'Unity.exe'))); } catch { return []; }
}
function findUnreal(env) {
  const base = (env || process.env).ENGINECTL_UE || 'C:/Program Files/Epic Games';
  try { const d = fs.readdirSync(base).find((x) => /^UE_/.test(x)); return d ? path.join(base, d) : null; } catch { return null; }
}

// 项目引擎档案自检 → { 级别: 绿/黄, note }。无档案返回 null（探针不出灯）。
// 级别只到黄不出红：引擎缺位挡的是该项目的引擎单，不阻断全 app。
function checkProject(reg, env) {
  const eng = reg && reg.引擎;
  if (!eng || !eng.类型) return null;
  if (!TYPES.includes(eng.类型)) return { 级别: '黄', note: `引擎类型未知：${eng.类型}` };
  if (eng.类型 === 'godot') {
    const g = findGodot(env);
    return g ? { 级别: '绿', note: 'godot · ' + g }
      : { 级别: '黄', note: 'godot 未装（ENGINECTL_GODOT 或 D:/engines/godot，引擎单不可用）' };
  }
  if (eng.类型 === 'unity') {
    const vers = findUnityVersions(env);
    if (!vers.length) return { 级别: '黄', note: 'unity 编辑器未装（引擎单不可用）' };
    // 工程实际版本优先于注册申报——ProjectVersion.txt 是事实源
    let want = eng.版本 || null;
    try {
      const pv = fs.readFileSync(path.join(reg.路径, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
      want = (pv.match(/m_EditorVersion:\s*(\S+)/) || [])[1] || want;
    } catch { /* 非 unity 工程结构或未申报版本，按注册值走 */ }
    if (!want) return { 级别: '绿', note: 'unity · 本机 ' + vers.join('/') + '（工程未见版本文件）' };
    return vers.includes(want) ? { 级别: '绿', note: 'unity ' + want + ' · 版本匹配' }
      : { 级别: '黄', note: `unity 版本纪律：工程要 ${want}，本机 [${vers.join(', ')}]——不匹配时 batchmode 会静默升级工程，引擎单拒开` };
  }
  const ue = findUnreal(env);
  return ue ? { 级别: '绿', note: 'unreal · ' + ue }
    : { 级别: '黄', note: 'unreal 未装（30-100GB 级，按需再装；引擎单不可用）' };
}

module.exports = { TYPES, findGodot, findUnityVersions, findUnreal, checkProject };
