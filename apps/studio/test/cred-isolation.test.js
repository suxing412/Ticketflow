// cred-isolation.test.js — 判据不许读操作员的活体凭据（2026-08-28）
//
// 案源：02:36 本机 OAuth token 到期，02:40 跑全量 → 质检结论.test.js ⑧ 翻红。
// 红的不是被测逻辑：测试进程去读了 ~/.claude/.credentials.json，派发预检判「已过期，拒派」，
// startWork 一发没打出去，`calls===2` 自然不成立。
//
// 假红只花一轮排查；**假绿才是真风险**——token 健康时那批用例照样全过，
// 无论派发预检本身对不对，等于它们从没验过自己声称要验的东西，只是搭了顺风车。
// 故这条判据看住两件事：① 缺省不读活体凭据 ② 显式注入仍然压过缺省（oauth.test.js 的语义不能被顺手改掉）。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const oauth = require('../lib/oauth');
const { CFG, makeRoot, 收尾, 凭据注入, 健康凭据 } = require('./helper');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('cred-isolation 判据与活体凭据解耦');

const 写凭据 = (root, 剩余分) => {
  const p = path.join(root, `cred-${剩余分}.json`);
  fs.writeFileSync(p, JSON.stringify({
    claudeAiOauth: { accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 剩余分 * 60000 },
  }), 'utf8');
  return p;
};

t('缺省注入健康凭据——不去碰 ~/.claude/.credentials.json', () => {
  const o = 凭据注入({});
  assert.ok(typeof o.读 === 'function', '空 opts 必须被补上 读，否则 寿命() 会 fallback 到操作员的真文件');
  const c = JSON.parse(o.读()).claudeAiOauth;
  assert.ok(Number(c.expiresAt) - Date.now() > 3600000, '注入的凭据要足够远期，别在长套件跑到一半自己过期');
});

t('显式注入压过缺省：读 / 文件 / now 任一给了就原样放行', () => {
  const 读 = () => '{}';
  assert.equal(凭据注入({ 读 }).读, 读, '给了 读 就不许换掉');
  assert.equal(凭据注入({ 文件: 'D:/x.json' }).读, undefined, '给了 文件 就不许再塞 读——塞了 读 会把 文件 架空');
  assert.equal(凭据注入({ now: 123 }).读, undefined, '给了 now 说明这条在验时间线，缺省不许插手');
});

t('端到端：缺省放行，与本机 token 此刻是死是活无关', () => {
  const root = makeRoot();
  const 预 = oauth.派发预检(root, CFG, {});
  assert.equal(预.放行, true, '缺省应放行，实得：' + JSON.stringify(预));
  void 健康凭据;
});

t('端到端：显式给一份过期凭据仍然拒派（oauth.test.js 的语义没被顺手改掉）', () => {
  const root = makeRoot();
  const 预 = oauth.派发预检(root, CFG, { now: Date.now(), 文件: 写凭据(root, -20) });
  assert.equal(预.放行, false, '过期凭据必须拒派，实得：' + JSON.stringify(预));
  assert.equal(预.态, '过期');
});

收尾('cred-isolation', passed);
