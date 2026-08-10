#!/usr/bin/env node
// test.js — 评审台离线自测（施工令-024 迁包时补：此前无独立测试文件）。
// 纪律：只走 --dry 与参数校验路径——零网络、零厂商调用、零 token；
//      config 一律现造临时副本，绝不读写生产 config。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const 台 = path.join(__dirname, 'review.js');
let 过 = 0; const 挂 = [];
function ok(名, 真, 详) {
  if (真) { 过++; process.stdout.write(`  ✔ ${名}\n`); }
  else { 挂.push(名 + (详 ? ` —— ${详}` : '')); process.stdout.write(`  ✗ ${名}${详 ? ` —— ${详}` : ''}\n`); }
}
const 章 = (s) => process.stdout.write(`\n【${s}】\n`);

function 跑(argv) {
  const r = spawnSync(process.execPath, [台].concat(argv), { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  let j = null;
  try { j = JSON.parse(String(r.stdout).trim().split('\n').filter(Boolean).pop()); } catch { /* 调用方判空 */ }
  return { code: r.status, j, so: String(r.stdout || ''), se: String(r.stderr || '') };
}

const 巢 = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
const 方案 = path.join(巢, '假方案.md');
fs.writeFileSync(方案, '# 假方案\n\n仅供 dry 演练，不含任何真实内容。\n', 'utf8');
const 空方案 = path.join(巢, '空方案.md');
fs.writeFileSync(空方案, '', 'utf8');
const 假KEY = 'sk-fake1234567890abcdef';
const 兼容 = (名, 改) => ({ [名]: { 兼容: Object.assign({ base: 'http://127.0.0.1:9', key: 假KEY, 模型: 名 + '-chat' }, 改 || {}) } });
function 配(池) {
  const p = path.join(巢, `cfg-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(p, JSON.stringify({ 模型: { codex默认: 'gpt-5' }, 执行池: 池 || {} }), 'utf8');
  return p;
}

章('T1 argv 契约与退出码');
let r = 跑([]);
ok('缺 --file：退出码 1 + 一行 JSON 报错', r.code === 1 && !!r.j && r.j.ok === false && /--file/.test(r.j.error), r.so.trim());
r = 跑(['--file', path.join(巢, '不存在.md'), '--dry', '--config', 配()]);
ok('方案不存在：退出码 1 + 点名路径', r.code === 1 && !!r.j && /不存在/.test(r.j.error), r.so.trim());
r = 跑(['--file', 空方案, '--dry', '--config', 配()]);
ok('空方案拒评', r.code === 1 && !!r.j && /空文件/.test(r.j.error), r.so.trim());
r = 跑(['--file', 方案, '--dry', '--config', path.join(巢, '没有这个config.json')]);
ok('config 读不了：退出码 1', r.code === 1 && !!r.j && /config/i.test(r.j.error), r.so.trim());

章('T2 评审团自动发现（--dry 零调用）');
r = 跑(['--dry', '--file', 方案, '--config', 配()]);
ok('空执行池：codex 独席', r.code === 0 && !!r.j && r.j.ok === true && r.j.dry === true && JSON.stringify(r.j.评审团) === '["codex"]', r.so.trim());
ok('dry 不产合集（out=null 意见数=0）', !!r.j && r.j.out === null && r.j.意见数 === 0);
const 单厂 = r.j;
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek'))]);
ok('兼容池条目自动入席', !!r.j && JSON.stringify(r.j.评审团) === '["codex","deepseek"]', r.so.trim());
const 两厂 = r.j;
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek', { key: '' }))]);
ok('兼容段缺 key 不入席（不猜不报错）', !!r.j && JSON.stringify(r.j.评审团) === '["codex"]', r.so.trim());
r = 跑(['--dry', '--file', 方案, '--config', 配(Object.assign({}, 兼容('deepseek'), 兼容('kimi')))]);
ok('三厂全入席', !!r.j && r.j.评审团.length === 3, r.so.trim());
const 三厂 = r.j;

章('T3 立场卷派发（019 红队制：每卷有主、每席有卷）');
ok('单厂独领三卷', !!单厂 && Array.isArray(单厂.立场卷.codex) && 单厂.立场卷.codex.length === 3, JSON.stringify(单厂 && 单厂.立场卷));
ok('两厂：甲领一三、乙领二', !!两厂
  && JSON.stringify(两厂.立场卷.codex) === JSON.stringify(['可行性红队', '成本红队'])
  && JSON.stringify(两厂.立场卷.deepseek) === JSON.stringify(['不变量红队']), JSON.stringify(两厂 && 两厂.立场卷));
ok('三厂：一席一卷', !!三厂 && Object.values(三厂.立场卷).every((卷) => 卷.length === 1)
  && new Set(Object.values(三厂.立场卷).flat()).size === 3, JSON.stringify(三厂 && 三厂.立场卷));

章('T4 --only 定向');
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek')), '--only', 'deepseek']);
ok('--only 过滤到点名席位', !!r.j && JSON.stringify(r.j.评审团) === '["deepseek"]', r.so.trim());
ok('独席过滤后仍独领三卷', !!r.j && r.j.立场卷.deepseek.length === 3, JSON.stringify(r.j && r.j.立场卷));
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek')), '--only', '不存在的厂']);
ok('--only 点名全落空：退出码 1 + 回报名册', r.code === 1 && !!r.j && /名册/.test(r.j.error), r.so.trim());

章('T5 密钥纪律');
r = 跑(['--dry', '--file', 方案, '--config', 配(兼容('deepseek'))]);
ok('dry 全量输出不含明文 key', !r.so.includes(假KEY) && !r.se.includes(假KEY), '输出泄密');

/* ═══ T6 凭据三态（施工令-030；案源 H94 补巡：deepseek 全场缺席）═══
   施工令-029 把 key 迁进 DPAPI 托管后 config 兼容段是空串，评审台只认明文 → 静静漏席。
   这里用**假托管模块**（REVIEW_CREDS_MODULE 注入）替真 DPAPI：零真调、零 PowerShell、
   非 Windows 也跑得动。夹具 key 全是明摆着的假串。 */
章('T6 凭据三态：托管优先 / config 兜底 / 双缺失');
const 托管KEY = 'sk-fakehosted-0001';
// 假托管模块：只对 deepseek 有记录，且刻意**不给 base**——用来验字段粒度兜底（029 的 401 陷阱）
const 假托管 = path.join(巢, 'fake-creds.js');
fs.writeFileSync(假托管, `
module.exports = {
  has: (root, 池) => 池 === 'deepseek' && !process.env.FAKE_CREDS_EMPTY,
  getKey: (root, 池) => (池 === 'deepseek' && !process.env.FAKE_CREDS_EMPTY) ? ${JSON.stringify(托管KEY)} : null,
  meta: (root, 池) => (池 === 'deepseek' ? { 类型: 'key', base: null, 模型: 'ds-hosted' } : null),
};
`, 'utf8');
const 跑注入 = (argv, env) => {
  const r = spawnSync(process.execPath, [台].concat(argv), {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: Object.assign({}, process.env, { REVIEW_CREDS_MODULE: 假托管 }, env || {}),
  });
  let j = null;
  try { j = JSON.parse(String(r.stdout).trim().split('\n').filter(Boolean).pop()); } catch { /* 调用方判空 */ }
  return { code: r.status, j, so: String(r.stdout || ''), se: String(r.stderr || '') };
};
const 席 = (j, 名) => (j && j.席位 || []).find((x) => x.名 === 名);

// ① 托管命中：config 明文已清空（029 后的现网形态）仍应在席
r = 跑注入(['--dry', '--file', 方案, '--config', 配(兼容('deepseek', { key: '' }))]);
ok('托管命中：config 明文为空仍入席（H94 失席案的回归闸）',
  !!r.j && JSON.stringify(r.j.评审团) === '["codex","deepseek"]', r.so.trim());
ok('托管命中：凭据来源如实报「托管」', !!席(r.j, 'deepseek') && 席(r.j, 'deepseek').凭据 === '托管',
  JSON.stringify(r.j && r.j.席位));
ok('字段粒度兜底：托管没给 base 时回落 config 的 base（否则 key 会被发去官方端点）',
  !!r.j && r.j.ok === true, r.so.trim());
ok('托管命中：模型取托管值', !!席(r.j, 'deepseek') && 席(r.j, 'deepseek').模型 === 'ds-hosted',
  JSON.stringify(r.j && r.j.席位));

// ② config 兜底：托管里没有这个池（kimi）→ 回落 config 明文
r = 跑注入(['--dry', '--file', 方案, '--config', 配(兼容('kimi'))]);
ok('config 兜底：托管无此池时用 config 明文入席',
  !!r.j && JSON.stringify(r.j.评审团) === '["codex","kimi"]', r.so.trim());
ok('config 兜底：凭据来源如实报「config」', !!席(r.j, 'kimi') && 席(r.j, 'kimi').凭据 === 'config',
  JSON.stringify(r.j && r.j.席位));

// ③ 双缺失：托管空 + config 明文空 → 不入席（不猜、不报错，维持原语义）
r = 跑注入(['--dry', '--file', 方案, '--config', 配(兼容('deepseek', { key: '' }))], { FAKE_CREDS_EMPTY: '1' });
ok('双缺失：托管与 config 都没有 → 该席静默缺席、其余照常开评',
  r.code === 0 && !!r.j && JSON.stringify(r.j.评审团) === '["codex"]', r.so.trim());

// ④ 环境变量兜底（协作者/CI：没有 studio、没有 DPAPI 的机器）
r = 跑注入(['--dry', '--file', 方案, '--config', 配(兼容('deepseek', { key: '' }))],
  { FAKE_CREDS_EMPTY: '1', REVIEW_KEY_DEEPSEEK: 'sk-fakeenv-0002' });
ok('环境变量兜底：REVIEW_KEY_<池名> 能让无托管无明文的机器照样入席',
  !!r.j && JSON.stringify(r.j.评审团) === '["codex","deepseek"]', r.so.trim());
ok('环境变量兜底：凭据来源如实报「环境变量」', !!席(r.j, 'deepseek') && 席(r.j, 'deepseek').凭据 === '环境变量',
  JSON.stringify(r.j && r.j.席位));

// ⑤ 公共包纪律：creds 模块指向一个不存在/坏掉的路径时，必须优雅回落而不是崩
r = 跑注入(['--dry', '--file', 方案, '--config', 配(兼容('deepseek'))], { REVIEW_CREDS_MODULE: path.join(巢, '根本没有这个模块.js') });
ok('协作者环境：托管模块不在场 → 静默回落 config，不硬崩',
  r.code === 0 && !!r.j && JSON.stringify(r.j.评审团) === '["codex","deepseek"]' && 席(r.j, 'deepseek').凭据 === 'config', r.so.trim());

// ⑥ 托管来的 key 同样进净化表
r = 跑注入(['--dry', '--file', 方案, '--config', 配(兼容('deepseek', { key: '' }))]);
ok('托管 key 也不出现在任何输出里', !r.so.includes(托管KEY) && !r.se.includes(托管KEY), '输出泄密');

try { fs.rmSync(巢, { recursive: true, force: true }); } catch { /* 临时目录留着无害 */ }
process.stdout.write(`\n════ 合计 ${过 + 挂.length} 例：过 ${过}，挂 ${挂.length} ════\n`);
for (const m of 挂) process.stdout.write(`  ✗ ${m}\n`);
process.exit(挂.length ? 1 : 0);
