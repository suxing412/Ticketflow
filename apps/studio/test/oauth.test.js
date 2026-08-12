// oauth.test.js — OAuth 续命哨兵（施工令-055）：临期 / 过期 / 缺失 / 节流 四分支 + 派发预检。
// 案源：08-12 22:50 token 到点集体 401，判官席空烧三振、TK-163/164 连坐、人工修复 25 分钟。
// 全用例时钟与凭据文件双注入——一个字节都不碰本机真凭据（~/.claude/.credentials.json）。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const oauth = require('../lib/oauth');
const inbox = require('../lib/inbox');
const ledger = require('../lib/pm/ledger');
const runner = require('../lib/runner');
const store = require('../lib/core/store');
const { CFG, makeRoot, seed } = require('./helper');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const ta = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };

const T0 = Date.parse('2026-08-12T14:00:00.000Z');
const 分 = (n) => T0 + n * 60000;
// 造一份凭据文件：距 T0 还有 剩余分 钟到期（负数＝已过期）
function 凭据(root, 剩余分, extra = {}) {
  const p = path.join(root, '.credentials.test.json');
  fs.writeFileSync(p, JSON.stringify({ claudeAiOauth: {
    accessToken: 'sk-ant-oat-测试用假串', refreshToken: 'sk-ant-ort-测试用假串',
    expiresAt: T0 + 剩余分 * 60000, ...extra } }), 'utf8');
  return p;
}
const 急件 = (root) => inbox.list(root, 200).filter((e) => e.类型 === 'OAuth续命');

// ---- ① 读数：四态判定（时钟可注入）----
console.log('oauth 凭据寿命读数（施工令-055 要件 1/3）');

t('有效 / 临期 / 过期：判据只认 expiresAt，边界闭在「<30 分钟才算临期」上', () => {
  const root = makeRoot();
  assert.equal(oauth.寿命(CFG, { now: T0, 文件: 凭据(root, 240) }).态, '有效');
  assert.equal(oauth.寿命(CFG, { now: T0, 文件: 凭据(root, 30) }).态, '有效', '恰好 30 分钟不算临期（要件写的是 <30）');
  const 临 = oauth.寿命(CFG, { now: T0, 文件: 凭据(root, 29) });
  assert.equal(临.态, '临期');
  assert.equal(临.剩余分, 29);
  assert.ok(临.可续, 'refreshToken 在场如实标注');
  const 过 = oauth.寿命(CFG, { now: T0, 文件: 凭据(root, -10) });
  assert.equal(过.态, '过期');
  assert.equal(过.剩余分, -10);
  assert.equal(oauth.寿命(CFG, { now: T0, 文件: 凭据(root, 0) }).态, '过期', '零毫秒即过期');
});

t('缺失 / 读不动 / 缺 token / 缺 expiresAt → 一律「未登录」（要件 3：探不出寿命＝没凭据）', () => {
  const root = makeRoot();
  const 缺 = oauth.寿命(CFG, { now: T0, 文件: path.join(root, '压根没有这个文件.json') });
  assert.equal(缺.态, '未登录');
  assert.ok(缺.因.includes('未登录'));
  const 坏 = path.join(root, '坏.json');
  fs.writeFileSync(坏, '{ 这不是 JSON', 'utf8');
  assert.equal(oauth.寿命(CFG, { now: T0, 文件: 坏 }).态, '未登录', '解析失败不当成有效');
  const 无token = path.join(root, '无token.json');
  fs.writeFileSync(无token, JSON.stringify({ claudeAiOauth: { expiresAt: T0 + 9e6 } }), 'utf8');
  assert.equal(oauth.寿命(CFG, { now: T0, 文件: 无token }).态, '未登录');
  assert.equal(oauth.寿命(CFG, { now: T0, 文件: 凭据(root, 240, { expiresAt: '不是数' }) }).态, '未登录', 'expiresAt 不是数＝寿命不可判');
  assert.equal(oauth.寿命(CFG, { now: T0, 读: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } }).态, '未登录', '读不动也算未登录');
});

t('阈值可配（config.凭据.临期分钟）：厂商砍寿命时改配置不改代码', () => {
  const root = makeRoot();
  const cfg10 = { ...CFG, 凭据: { 临期分钟: 10 } };
  assert.equal(oauth.寿命(cfg10, { now: T0, 文件: 凭据(root, 20) }).态, '有效', '临期线调到 10 分钟后 20 分钟不报');
  assert.equal(oauth.寿命(cfg10, { now: T0, 文件: 凭据(root, 9) }).态, '临期');
});

// ---- ② 巡检哨兵：临期 / 过期 / 缺失 三分支的告警形态 ----
console.log('oauth 巡检哨兵告警（要件 1）');

t('临期 → 信箱急件一条（含一键重登配方），不挂门禁横幅', () => {
  const root = makeRoot(); oauth.重置(root);
  const r = oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 12) });
  assert.equal(r.态, '临期');
  assert.equal(r.剩余分, 12);
  assert.ok(r.告警.includes('即将到期'), '告警文案：' + r.告警);
  assert.ok(r.告警.includes('一键重登'), '附一键 cmd 配方文本');
  assert.equal(r.横幅, null, '临期只发急件，门禁位不挂常驻条');
  const 信 = 急件(root);
  assert.equal(信.length, 1);
  assert.equal(信[0].级别, '急');
  assert.ok(ledger.events(root, 50).some((e) => e.类型 === 'OAuth告警' && e.态 === '临期'), '台账留痕');
});

t('已过期 → 急件 + 门禁横幅（横幅带重登配方）', () => {
  const root = makeRoot(); oauth.重置(root);
  const r = oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, -45) });
  assert.equal(r.态, '过期');
  assert.ok(r.横幅 && r.横幅.态 === '过期', '过期挂门禁横幅');
  assert.ok(r.横幅.配方 && r.横幅.配方.length > 0, '横幅自带重登配方');
  assert.equal(急件(root).length, 1);
  assert.equal(急件(root)[0].级别, '急');
});

t('凭据缺失 → 视为未登录，同样急件 + 横幅（要件 3）', () => {
  const root = makeRoot(); oauth.重置(root);
  const r = oauth.哨兵(root, CFG, { now: T0, 文件: path.join(root, '没有.json') });
  assert.equal(r.态, '未登录');
  assert.ok(r.告警.includes('未登录'));
  assert.ok(r.横幅 && r.横幅.态 === '未登录');
  assert.equal(急件(root).length, 1);
});

t('有效 → 不报不留痕（哨兵在正常态下完全沉默）', () => {
  const root = makeRoot(); oauth.重置(root);
  const r = oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 300) });
  assert.equal(r.态, '有效');
  assert.equal(r.告警, null);
  assert.equal(r.横幅, null);
  assert.equal(急件(root).length, 0);
});

// ---- ③ 节流：同状态每 30 分钟至多一封（要件 3）----
console.log('oauth 急件节流（要件 3）');

t('同状态 30 分钟内至多一封（15 分钟巡检拍每拍都问，只准响一次）', () => {
  const root = makeRoot(); oauth.重置(root);
  const f = 凭据(root, 28); // 一直是临期：到第 20 分钟仍剩 8 分钟
  assert.ok(oauth.哨兵(root, CFG, { now: T0, 文件: f }).告警, '首封放行');
  for (const m of [15, 20]) {
    const r = oauth.哨兵(root, CFG, { now: 分(m), 文件: f });
    assert.equal(r.告警, null, `第 ${m} 分钟被节流`);
    assert.equal(r.节流, true);
  }
  assert.equal(急件(root).length, 1, '30 分钟窗内只发一封');
});

t('过窗再发一封：长时间不修不许沉默（未登录一挂就是几小时）', () => {
  const root = makeRoot(); oauth.重置(root);
  const 缺 = { 文件: path.join(root, '没有.json') };
  assert.ok(oauth.哨兵(root, CFG, { now: T0, ...缺 }).告警, '首封');
  assert.equal(oauth.哨兵(root, CFG, { now: 分(29), ...缺 }).告警, null, '窗内压住');
  assert.ok(oauth.哨兵(root, CFG, { now: 分(31), ...缺 }).告警, '过窗再响');
  assert.equal(急件(root).length, 2);
});

t('状态升级（临期→过期）立刻放行一封，不被上一封的窗口压住', () => {
  const root = makeRoot(); oauth.重置(root);
  oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 20) });
  const r = oauth.哨兵(root, CFG, { now: 分(5), 文件: 凭据(root, -1) });
  assert.ok(r.告警 && r.态 === '过期', '状态一变即放行：' + JSON.stringify(r.告警));
  assert.deepEqual(急件(root).map((e) => e.摘要.slice(0, 8)), ['OAuth 即将到期', 'OAuth 已过期'].map((s) => s.slice(0, 8)));
});

t('重登恢复（回到有效）→ 记忆清空，下次临期重新武装', () => {
  const root = makeRoot(); oauth.重置(root);
  oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 20) });
  oauth.哨兵(root, CFG, { now: 分(5), 文件: 凭据(root, 600) }); // 制作人重登了
  const r = oauth.哨兵(root, CFG, { now: 分(10), 文件: 凭据(root, 20) }); // 新 token 又临期（同状态但已复位）
  assert.ok(r.告警, '恢复后重新武装，不被 30 分钟窗口压住');
  assert.equal(急件(root).length, 2);
});

t('横幅() 是只读的：不发信、不动节流记忆', () => {
  const root = makeRoot(); oauth.重置(root);
  const f = 凭据(root, -5);
  assert.ok(oauth.横幅(CFG, { now: T0, 文件: f }), '过期出条');
  assert.equal(oauth.横幅(CFG, { now: T0, 文件: 凭据(root, 10) }), null, '临期不出条');
  assert.equal(急件(root).length, 0, '只读，零信件');
  assert.ok(oauth.哨兵(root, CFG, { now: T0, 文件: f }).告警, '横幅没占掉哨兵的首封额度');
});

// ---- ④ 派发预检：<5 分钟拒派 claude 订阅会话，codex 不受影响（要件 2）----
console.log('oauth 派发预检（要件 2）');

t('剩余充足 → 放行；<5 分钟 / 过期 / 未登录 → 拒派', () => {
  const root = makeRoot();
  const 预 = (剩余, o = {}) => oauth.派发预检(root, CFG, { now: T0, 文件: 凭据(root, 剩余), 池: 'claude', ...o });
  assert.equal(预(240).放行, true);
  assert.equal(预(29).放行, true, '临期照派——临期只是要提醒人，不是不能跑');
  assert.equal(预(5).放行, true, '恰好 5 分钟放行（要件写的是 <5）');
  const 拒 = 预(4);
  assert.equal(拒.放行, false);
  assert.ok(拒.因.includes('4 分钟') && 拒.因.includes('拒派'), '拒因说清剩余寿命：' + 拒.因);
  const 拒2 = 预(-30);
  assert.equal(拒2.放行, false);
  assert.ok(拒2.因.includes('已过期'));
  const 拒3 = oauth.派发预检(root, CFG, { now: T0, 文件: path.join(root, '没有.json'), 池: 'claude' });
  assert.equal(拒3.放行, false);
  assert.ok(拒3.因.includes('未登录'));
});

t('codex 池与托管 key 池不受影响：凭据死透了也照派', () => {
  const root = makeRoot();
  const 死 = { now: T0, 文件: path.join(root, '没有.json') };
  for (const 池 of ['codex', 'deepseek', 'claude-key']) {
    const r = oauth.派发预检(root, CFG, { ...死, 池 });
    assert.equal(r.放行, true, `${池} 池不吃 OAuth 订阅凭据`);
    assert.equal(r.态, '不适用');
  }
  assert.equal(oauth.派发预检(root, CFG, { ...死, 池: 'claude', 用托管: true }).放行, true, 'claude 家族的按量池走注入令牌，与订阅寿命无关');
});

t('拒派线可配（config.凭据.拒派分钟）', () => {
  const root = makeRoot();
  const cfg15 = { ...CFG, 凭据: { 拒派分钟: 15 } };
  assert.equal(oauth.派发预检(root, cfg15, { now: T0, 文件: 凭据(root, 10), 池: 'claude' }).放行, false);
  assert.equal(oauth.派发预检(root, CFG, { now: T0, 文件: 凭据(root, 10), 池: 'claude' }).放行, true, '默认线 5 分钟下同一读数照派');
});

// ---- ⑤ runner 接线：拒派＝不开会话、不计失败次数、台账留痕 ----
console.log('oauth × runner 派发接线（要件 2）');

(async () => {
  await ta('claude 判官会话遇过期凭据 → 拒派（返回 false、零会话、不计判官失败次数、台账留痕）', async () => {
    const root = makeRoot(); oauth.重置(root);
    seed(root, '质检', { id: 'O-01', 职能: '策划', 主办: '策划·O-01' });
    const t1 = store.find(root, 'O-01');
    const ok = await runner.startWork(root, CFG, t1, 'QA', '质检', { oauth: { now: T0, 文件: 凭据(root, -20) } });
    assert.equal(ok, false, '拒派：本轮不开会话');
    assert.equal(runner.running.has('QA'), false, '在跑表里不留残席');
    const ev = ledger.events(root, 50).filter((e) => e.类型 === 'OAuth拒派');
    assert.equal(ev.length, 1);
    assert.equal(ev[0].单, 'O-01'); assert.equal(ev[0].kind, '质检'); assert.equal(ev[0].池, 'claude'); assert.equal(ev[0].态, '过期');
    const cur = store.find(root, 'O-01');
    assert.equal(cur.state, '质检', '单原地不动');
    assert.equal(cur.fm.质检失败次数, undefined, '拒派不是失败——三振计数一次都不能加（08-12 空烧案的根）');
  });

  await ta('codex 执行会话不受影响：凭据缺失也越过预检（后续按原有路径走）', async () => {
    const root = makeRoot(); oauth.重置(root);
    seed(root, '在途', { id: 'O-02', 职能: '程序', 主办: '程序·O-02', 执行池: 'codex' });
    const t2 = store.find(root, 'O-02');
    // 项目未注册 → 越过 OAuth 预检后倒在项目定位那一步（返回 true＝真派过一次），证明这一发没被 OAuth 拦
    const ok = await runner.startWork(root, CFG, t2, '程序·O-02', '执行', { oauth: { now: T0, 文件: path.join(root, '没有.json') } });
    assert.equal(ok, true, 'codex 会话照常进入派发流程');
    assert.equal(ledger.events(root, 50).filter((e) => e.类型 === 'OAuth拒派').length, 0, 'codex 池零 OAuth 拒派');
    assert.equal(store.find(root, 'O-02').state, '执行失败', '倒在项目定位（原有行为），不是倒在 OAuth');
  });

  await ta('claude 会话凭据健康 → 不拦（越过预检走原有路径）', async () => {
    const root = makeRoot(); oauth.重置(root);
    seed(root, '在途', { id: 'O-03', 职能: '策划', 主办: '策划·O-03', 执行池: 'claude' });
    const t3 = store.find(root, 'O-03');
    const ok = await runner.startWork(root, CFG, t3, '策划·O-03', '执行', { oauth: { now: T0, 文件: 凭据(root, 240) } });
    assert.equal(ok, true);
    assert.equal(ledger.events(root, 50).filter((e) => e.类型 === 'OAuth拒派').length, 0);
  });

  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error(e); process.exit(1); });
