// oauth.test.js — OAuth 续命哨兵：
//   一期（施工令-055）：临期 / 过期 / 缺失 / 节流 四分支 + 派发预检。
//   二期（施工令-057）：拒派留痕节流（同因去重 / 恢复附计数）+ 临期自续（成功 / 失败 / 超时 / 探针节流）。
// 案源：08-12 22:50 token 到点集体 401（判官席空烧三振、人工修复 25 分钟）；
//       08-13 16:43 拒派逐拍刷 journal 三连同文；16:49 实证一发 `claude -p` 自续 +8h。
// 全用例时钟、凭据文件、自续探针三路注入——不碰本机真凭据（~/.claude/.credentials.json），不拉真 CLI。
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
const 流水 = (root) => {
  const dir = path.join(root, 'journal');
  try { return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join(''); } catch { return ''; }
};
// 不续的探针桩：二期起哨兵在临期/过期会先探一发，全部一期用例都用它顶住——
// 探不成＝维持 055 原行为（发急件），既不拉真 CLI，也不改老用例的语义。
const 不续桩 = () => async () => ({ ok: false, 因: '测试桩：探针不续' });
const 哨 = (root, cfg, o = {}) => oauth.哨兵(root, cfg, { 探针: 不续桩(), ...o });

(async () => {
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

// ---- ② 巡检哨兵：临期 / 过期 / 缺失 三分支的告警形态（自续探不成时）----
console.log('oauth 巡检哨兵告警（要件 1）');

await ta('临期 → 信箱急件一条（含一键重登配方），不挂门禁横幅', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await 哨(root, CFG, { now: T0, 文件: 凭据(root, 12) });
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

await ta('已过期 → 急件 + 门禁横幅（横幅带重登配方）', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await 哨(root, CFG, { now: T0, 文件: 凭据(root, -45) });
  assert.equal(r.态, '过期');
  assert.ok(r.横幅 && r.横幅.态 === '过期', '过期挂门禁横幅');
  assert.ok(r.横幅.配方 && r.横幅.配方.length > 0, '横幅自带重登配方');
  assert.equal(急件(root).length, 1);
  assert.equal(急件(root)[0].级别, '急');
});

await ta('凭据缺失 → 视为未登录，同样急件 + 横幅（要件 3）', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await 哨(root, CFG, { now: T0, 文件: path.join(root, '没有.json') });
  assert.equal(r.态, '未登录');
  assert.ok(r.告警.includes('未登录'));
  assert.ok(r.横幅 && r.横幅.态 === '未登录');
  assert.equal(急件(root).length, 1);
});

await ta('有效 → 不报不留痕（哨兵在正常态下完全沉默）', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await 哨(root, CFG, { now: T0, 文件: 凭据(root, 300) });
  assert.equal(r.态, '有效');
  assert.equal(r.告警, null);
  assert.equal(r.横幅, null);
  assert.equal(急件(root).length, 0);
});

// ---- ③ 节流：同状态每 30 分钟至多一封（要件 3）----
console.log('oauth 急件节流（要件 3）');

await ta('同状态 30 分钟内至多一封（15 分钟巡检拍每拍都问，只准响一次）', async () => {
  const root = makeRoot(); oauth.重置(root);
  const f = 凭据(root, 28); // 一直是临期：到第 20 分钟仍剩 8 分钟
  assert.ok((await 哨(root, CFG, { now: T0, 文件: f })).告警, '首封放行');
  for (const m of [15, 20]) {
    const r = await 哨(root, CFG, { now: 分(m), 文件: f });
    assert.equal(r.告警, null, `第 ${m} 分钟被节流`);
    assert.equal(r.节流, true);
  }
  assert.equal(急件(root).length, 1, '30 分钟窗内只发一封');
});

await ta('过窗再发一封：长时间不修不许沉默（未登录一挂就是几小时）', async () => {
  const root = makeRoot(); oauth.重置(root);
  const 缺 = { 文件: path.join(root, '没有.json') };
  assert.ok((await 哨(root, CFG, { now: T0, ...缺 })).告警, '首封');
  assert.equal((await 哨(root, CFG, { now: 分(29), ...缺 })).告警, null, '窗内压住');
  assert.ok((await 哨(root, CFG, { now: 分(31), ...缺 })).告警, '过窗再响');
  assert.equal(急件(root).length, 2);
});

await ta('状态升级（临期→过期）立刻放行一封，不被上一封的窗口压住', async () => {
  const root = makeRoot(); oauth.重置(root);
  await 哨(root, CFG, { now: T0, 文件: 凭据(root, 20) });
  const r = await 哨(root, CFG, { now: 分(5), 文件: 凭据(root, -1) });
  assert.ok(r.告警 && r.态 === '过期', '状态一变即放行：' + JSON.stringify(r.告警));
  assert.deepEqual(急件(root).map((e) => e.摘要.slice(0, 8)), ['OAuth 即将到期', 'OAuth 已过期'].map((s) => s.slice(0, 8)));
});

await ta('重登恢复（回到有效）→ 记忆清空，下次临期重新武装', async () => {
  const root = makeRoot(); oauth.重置(root);
  await 哨(root, CFG, { now: T0, 文件: 凭据(root, 20) });
  await 哨(root, CFG, { now: 分(5), 文件: 凭据(root, 600) }); // 制作人重登了
  const r = await 哨(root, CFG, { now: 分(10), 文件: 凭据(root, 20) }); // 新 token 又临期（同状态但已复位）
  assert.ok(r.告警, '恢复后重新武装，不被 30 分钟窗口压住');
  assert.equal(急件(root).length, 2);
});

await ta('横幅() 是只读的：不发信、不动节流记忆', async () => {
  const root = makeRoot(); oauth.重置(root);
  const f = 凭据(root, -5);
  assert.ok(oauth.横幅(CFG, { now: T0, 文件: f }), '过期出条');
  assert.equal(oauth.横幅(CFG, { now: T0, 文件: 凭据(root, 10) }), null, '临期不出条');
  assert.equal(急件(root).length, 0, '只读，零信件');
  assert.ok((await 哨(root, CFG, { now: T0, 文件: f })).告警, '横幅没占掉哨兵的首封额度');
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

await ta('claude 判官会话遇过期凭据 → 拒派（返回 false、零会话、不计判官失败次数、台账留痕）', async () => {
  const root = makeRoot(); oauth.重置(root);
  seed(root, '初检', { id: 'O-01', 职能: '策划', 主办: '策划·O-01' }); // H108：质检会话驻初检目录
  const t1 = store.find(root, 'O-01');
  const ok = await runner.startWork(root, CFG, t1, 'QA', '质检', { oauth: { now: T0, 文件: 凭据(root, -20) } });
  assert.equal(ok, false, '拒派：本轮不开会话');
  assert.equal(runner.running.has('QA'), false, '在跑表里不留残席');
  const ev = ledger.events(root, 50).filter((e) => e.类型 === 'OAuth拒派');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].单, 'O-01'); assert.equal(ev[0].kind, '质检'); assert.equal(ev[0].池, 'claude'); assert.equal(ev[0].态, '过期');
  const cur = store.find(root, 'O-01');
  assert.equal(cur.state, '初检', '单原地不动');
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
  assert.equal(store.find(root, 'O-02').state, '待处理', '倒在项目定位（原有行为，H108 失败入位落待处理），不是倒在 OAuth');
});

await ta('claude 会话凭据健康 → 不拦（越过预检走原有路径）', async () => {
  const root = makeRoot(); oauth.重置(root);
  seed(root, '在途', { id: 'O-03', 职能: '策划', 主办: '策划·O-03', 执行池: 'claude' });
  const t3 = store.find(root, 'O-03');
  const ok = await runner.startWork(root, CFG, t3, '策划·O-03', '执行', { oauth: { now: T0, 文件: 凭据(root, 240) } });
  assert.equal(ok, true);
  assert.equal(ledger.events(root, 50).filter((e) => e.类型 === 'OAuth拒派').length, 0);
});

// ================= 二期（施工令-057）=================

// ---- ⑥ 拒派留痕节流：状态机口径（要件 1）----
console.log('oauth 拒派留痕节流（施工令-057 要件 1）');

t('首拒记一条、同因静默计数、换因再记一条、恢复交出期间次数', () => {
  const root = makeRoot(); oauth.重置(root);
  const 首 = oauth.拒派留痕(root, 'T-1', '过期');
  assert.deepEqual([首.记, 首.次数, 首.换因], [true, 1, false], '首拒必记');
  for (const n of [2, 3, 4]) {
    const r = oauth.拒派留痕(root, 'T-1', '过期');
    assert.equal(r.记, false, `第 ${n} 拍同因不再刷 journal（08-13 16:43 三连同文案）`);
    assert.equal(r.次数, n, '静默期照常计数');
  }
  const 换 = oauth.拒派留痕(root, 'T-1', '未登录');
  assert.deepEqual([换.记, 换.次数, 换.换因], [true, 1, true], '拒因一变即放行一条，计数重开');
  const 复 = oauth.拒派恢复(root, 'T-1');
  assert.deepEqual([复.记, 复.次数], [true, 1], '恢复条附「期间拒派 N 次」（换因后只数新因的那 1 次）');
  assert.equal(oauth.拒派恢复(root, 'T-1').记, false, '清账后再问不重复记——恢复条只出一次');
});

t('计数按单分账：一张单被拦不影响另一张单的首拒放行', () => {
  const root = makeRoot(); oauth.重置(root);
  assert.equal(oauth.拒派留痕(root, 'T-A', '过期').记, true);
  assert.equal(oauth.拒派留痕(root, 'T-B', '过期').记, true, '另一张单自己首拒，不被 T-A 的记忆吞掉');
  assert.equal(oauth.拒派留痕(root, 'T-A', '过期').记, false);
  assert.equal(oauth.拒派恢复(root, 'T-B').次数, 1);
  assert.equal(oauth.拒派恢复(root, 'T-A').次数, 2);
});

t('未被拦过的单放行时不记恢复条（正常派发一个字都不多写）', () => {
  const root = makeRoot(); oauth.重置(root);
  assert.deepEqual(oauth.拒派恢复(root, 'T-Z'), { 记: false, 次数: 0 });
});

await ta('runner 实拍：同单同因连拒三拍 → journal 只落一条；恢复后一条附「期间拒派 3 次」', async () => {
  const root = makeRoot(); oauth.重置(root);
  seed(root, '初检', { id: 'O-04', 职能: '策划', 主办: '策划·O-04' });
  const 死 = { oauth: { now: T0, 文件: 凭据(root, -20) } };
  for (let i = 0; i < 3; i++) {
    const ok = await runner.startWork(root, CFG, store.find(root, 'O-04'), 'QA', '质检', 死);
    assert.equal(ok, false, `第 ${i + 1} 拍照常拒派（节流只管留痕，不管拦不拦）`);
  }
  const 拒行 = 流水(root).split('\n').filter((l) => l.includes('拒派 O-04'));
  assert.equal(拒行.length, 1, '三拍只落一条 journal（旧样是三条同文）：' + JSON.stringify(拒行));
  assert.ok(拒行[0].includes('静默计数'), '首条说明后续会静默：' + 拒行[0]);
  assert.equal(ledger.events(root, 50).filter((e) => e.类型 === 'OAuth拒派').length, 1, '台账同口径去重');

  // 凭据续上 → 下一拍放行，恢复条把静默期一次交代清楚
  const ok = await runner.startWork(root, CFG, store.find(root, 'O-04'), 'QA', '质检', { oauth: { now: T0, 文件: 凭据(root, 240) } });
  assert.equal(ok, true, '凭据健康后照常派发（倒在项目定位是原有行为）');
  const 复行 = 流水(root).split('\n').filter((l) => l.includes('恢复派发 O-04'));
  assert.equal(复行.length, 1);
  assert.ok(复行[0].includes('期间拒派 3 次'), '恢复条附期间计数：' + 复行[0]);
  const ev = ledger.events(root, 50).filter((e) => e.类型 === 'OAuth恢复派发');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].期间拒派, 3);
});

await ta('runner 实拍：拒因升级（剩余不足 → 过期）另起一条，不被同单静默期吞掉', async () => {
  const root = makeRoot(); oauth.重置(root);
  seed(root, '初检', { id: 'O-05', 职能: '策划', 主办: '策划·O-05' });
  await runner.startWork(root, CFG, store.find(root, 'O-05'), 'QA', '质检', { oauth: { now: T0, 文件: 凭据(root, 2) } });   // 态=临期
  await runner.startWork(root, CFG, store.find(root, 'O-05'), 'QA', '质检', { oauth: { now: T0, 文件: 凭据(root, 2) } });   // 同因静默
  await runner.startWork(root, CFG, store.find(root, 'O-05'), 'QA', '质检', { oauth: { now: T0, 文件: 凭据(root, -1) } });  // 态=过期，换因
  const 拒行 = 流水(root).split('\n').filter((l) => l.includes('拒派 O-05'));
  assert.equal(拒行.length, 2, '两个因各落一条：' + JSON.stringify(拒行));
  assert.ok(拒行[1].includes('拒因已变'), '升级条标明换因：' + 拒行[1]);
  assert.equal(ledger.events(root, 50).filter((e) => e.类型 === 'OAuth拒派').length, 2);
});

// ---- ⑦ 临期自续：成功 / 失败 / 超时 / 探针节流（要件 2/3）----
console.log('oauth 临期自续探针（施工令-057 要件 2/3）');

// 续成桩：模拟 CLI 自己拿 refreshToken 换了新的——把凭据文件的 expiresAt 往前推
const 续成桩 = (root, 新剩余分, 记 = []) => async (o) => { 记.push(o.次); 凭据(root, 新剩余分); return { ok: true, 因: '桩：探针跑通' }; };

await ta('临期 + 自续成功 → journal 记「OAuth 自续成功 +8h」，零急件（不惊动制作人）', async () => {
  const root = makeRoot(); oauth.重置(root);
  const 记 = [];
  const r = await oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 12), 探针: 续成桩(root, 12 + 480, 记) });
  assert.equal(记.length, 1, '临期确实探了一发');
  assert.equal(r.自续.成功, true);
  assert.equal(r.态, '有效', '续上后本拍读数已回有效');
  assert.equal(r.剩余分, 492);
  assert.equal(r.告警, null, '续成了就不该叫人');
  assert.equal(急件(root).length, 0, '零急件');
  const 行 = 流水(root).split('\n').filter((l) => l.includes('OAuth 自续成功'));
  assert.equal(行.length, 1);
  assert.ok(行[0].includes('+8h'), '增时写成人话：' + 行[0]);
  const ev = ledger.events(root, 50).filter((e) => e.类型 === 'OAuth自续');
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].结果, ev[0].增文, ev[0].次数], ['成功', '+8h', 1]);
});

await ta('已过期 + 自续成功 → 同样静默续命，横幅一并撤掉（08-12 集体 401 的正解）', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, -8), 探针: 续成桩(root, 300) });
  assert.equal(r.自续.成功, true);
  assert.equal(r.态, '有效');
  assert.equal(r.横幅, null, '续上了就不该在门禁位挂红条');
  assert.equal(急件(root).length, 0);
  assert.ok(流水(root).includes('OAuth 自续成功'));
});

await ta('自续失败（探针 401）→ 才发急件，正文保留一键重登配方并附自续结论', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 9),
    探针: async () => ({ ok: false, 因: '探针退出码 1：API Error 401 · OAuth token expired' }) });
  assert.equal(r.自续.成功, false);
  assert.equal(r.自续.尝试, true);
  assert.ok(r.告警.includes('即将到期'), '沿用既有配方文本');
  assert.ok(r.告警.includes('一键重登'), '重登配方不被自续说明挤掉');
  assert.ok(r.告警.includes('自续已试') && r.告警.includes('401'), '把自续为什么没成说清：' + r.告警);
  assert.equal(急件(root).length, 1);
  assert.ok(急件(root)[0].摘要.includes('一键重登'), '急件截 300 字后配方仍在：' + 急件(root)[0].摘要);
  assert.ok(ledger.events(root, 50).some((e) => e.类型 === 'OAuth告警' && e.自续 === '试过未成'), '台账记下「试过了才叫的人」');
  assert.equal(流水(root).includes('OAuth 自续成功'), false);
});

await ta('自续超时（探针 60s 不回）→ 按续败办，急件写明超时', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 7),
    探针: async ({ cfg }) => ({ ok: false, 因: `探针超时 ${oauth.参数(cfg).探针超时秒}s（CLI 没在时限内回话）` }) });
  assert.equal(r.自续.成功, false);
  assert.ok(r.告警.includes('超时 60s'), '超时原样进急件：' + r.告警);
  assert.equal(急件(root).length, 1);
});

await ta('探针跑通但 expiresAt 没动 → 不算续成（判据只认那个数往前走）', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 11), 探针: async () => ({ ok: true, 因: '桩：跑通但没续' }) });
  assert.equal(r.自续.成功, false);
  assert.ok(r.自续.因.includes('没动'), '说清是「跑通了但没续」而不是「没跑通」：' + r.自续.因);
  assert.equal(急件(root).length, 1);
});

await ta('探针节流：同一到期窗口至多 2 发，第三拍不再烧调用（要件 3）', async () => {
  const root = makeRoot(); oauth.重置(root);
  let 发数 = 0;
  const 桩 = async () => { 发数++; return { ok: false, 因: '桩：续不上' }; };
  // 四拍都读同一张凭据、且都落在「临期」里＝同一窗口（体检 #27 起窗口键带态，
  // 原来的 0/15/30 三拍会在第 30 分钟跨进「过期」，那是**另一个**窗口，不该拿来验本条）
  const f = 凭据(root, 25);
  for (const m of [0, 5, 10]) await oauth.哨兵(root, CFG, { now: 分(m), 文件: f, 探针: 桩 });
  assert.equal(发数, 2, `同窗口至多两发，实发 ${发数}`);
  const r = await oauth.哨兵(root, CFG, { now: 分(15), 文件: f, 探针: 桩 });
  assert.equal(发数, 2, '第四拍照样不发');
  assert.equal(r.自续.已尽, true);
  assert.ok(r.自续.因.includes('上限 2'), '把「为什么不再试」说出来：' + r.自续.因);
});

await ta('临期烧完的额度不殃及过期：同一张 token 过期后有它自己的 2 发（08-22 06:16→10:30 案）', async () => {
  // 临期那一发的典型下场是「探针跑通了但 expiresAt 没动」——token 还没到点，CLI 本来
  // 就不换新的。用同一份额度，等于让两发注定打空的探针把过期后真正管用的那两发吃光，
  // 之后只剩每 30 分钟重复同一封急件。
  const root = makeRoot(); oauth.重置(root);
  let 发数 = 0;
  const 桩 = async () => { 发数++; return { ok: true, 因: '桩：跑通但 expiresAt 没动' }; };
  const f = 凭据(root, 20); // T0 时剩 20 分钟＝临期
  await oauth.哨兵(root, CFG, { now: 分(0), 文件: f, 探针: 桩 });
  await oauth.哨兵(root, CFG, { now: 分(5), 文件: f, 探针: 桩 });
  assert.equal(发数, 2, '临期这个窗口的两发先打光');
  const 满 = await oauth.哨兵(root, CFG, { now: 分(10), 文件: f, 探针: 桩 });
  assert.equal(发数, 2, '临期窗口内确实封顶了');
  assert.equal(满.自续.已尽, true);
  const r = await oauth.哨兵(root, CFG, { now: 分(25), 文件: f, 探针: 桩 }); // 已过期 5 分钟
  assert.equal(r.态, '过期');
  assert.equal(r.自续.尝试, true, '过期是另一个态、另一份额度——临期那两发本来就不可能换出新 token');
  assert.equal(发数, 3);
});

await ta('探针额度落盘：换个进程不许把「防烧钱」上限重新开两发（今晨那次「修好」实为重启撞对）', async () => {
  const root = makeRoot(); oauth.重置(root);
  let 发数 = 0;
  const 桩 = async () => { 发数++; return { ok: false, 因: '桩：续不上' }; };
  const f = 凭据(root, -10); // 已过期，全程同一个态
  await oauth.哨兵(root, CFG, { now: 分(0), 文件: f, 探针: 桩 });
  await oauth.哨兵(root, CFG, { now: 分(5), 文件: f, 探针: 桩 });
  assert.equal(发数, 2, '同进程内先把额度打满');
  // 模拟重启：把模块整个从 require 缓存里拆掉重建（进程内存归零，盘上那份不动）
  for (const k of Object.keys(require.cache)) if (k.includes('oauth')) delete require.cache[k];
  const oauth2 = require('../lib/oauth');
  const r = await oauth2.哨兵(root, CFG, { now: 分(10), 文件: f, 探针: 桩 });
  assert.equal(发数, 2, `换进程后照样封顶——额度住在盘上不住在进程里，实发 ${发数}`);
  assert.equal(r.自续.已尽, true, '并且要说清是「本窗额度已尽」，不是「第 1 发」');
});

await ta('同窗重挂：额度打空后满 N 分钟放行一发（不许「两发打空即永久锁死」卡 3h50m）', async () => {
  const root = makeRoot(); oauth.重置(root);
  let 发数 = 0;
  const 桩 = async () => { 发数++; return { ok: false, 因: '桩：续不上' }; };
  const f = 凭据(root, -8); // 已过期，态全程不变＝同一窗口
  await oauth.哨兵(root, CFG, { now: 分(0), 文件: f, 探针: 桩 });
  await oauth.哨兵(root, CFG, { now: 分(5), 文件: f, 探针: 桩 });
  assert.equal(发数, 2, '先打满');
  await oauth.哨兵(root, CFG, { now: 分(20), 文件: f, 探针: 桩 });
  assert.equal(发数, 2, '距上一发不足 N=30 分钟，不重发（防烧钱那条约束仍在）');
  const r = await oauth.哨兵(root, CFG, { now: 分(36), 文件: f, 探针: 桩 });
  assert.equal(发数, 3, '距上一发满 30 分钟 → 重挂一发。本窗解锁只能靠探针，而探针被本窗锁死＝自指死锁');
  assert.equal(r.自续.尝试, true);
  const cfg关 = { ...CFG, 凭据: { 自续重挂分钟: 0 } };
  const root2 = makeRoot(); oauth.重置(root2);
  let 发2 = 0;
  const 桩2 = async () => { 发2++; return { ok: false, 因: '桩：续不上' }; };
  const f2 = 凭据(root2, -8);
  for (const m of [0, 5, 36, 120]) await oauth.哨兵(root2, cfg关, { now: 分(m), 文件: f2, 探针: 桩2 });
  assert.equal(发2, 2, '重挂间隔配成 0 = 关掉重挂，退回 055 老行为（打满即锁死）');
});

await ta('窗口随 expiresAt 复位：续成后的新 token 再临期时，探针额度是新的', async () => {
  const root = makeRoot(); oauth.重置(root);
  let 发数 = 0;
  const 桩 = async () => { 发数++; return { ok: false, 因: '桩：续不上' }; };
  const f1 = 凭据(root, 20);
  await oauth.哨兵(root, CFG, { now: T0, 文件: f1, 探针: 桩 });
  await oauth.哨兵(root, CFG, { now: 分(5), 文件: f1, 探针: 桩 });
  assert.equal(发数, 2, '旧窗口两发用尽');
  凭据(root, 25); // 换了一张新 token（哪怕仍临期）——这是新窗口
  await oauth.哨兵(root, CFG, { now: 分(10), 文件: f1, 探针: 桩 });
  assert.equal(发数, 3, '新窗口重新给额度');
});

await ta('自续上限可配（config.凭据.探针上限）', async () => {
  const root = makeRoot(); oauth.重置(root);
  let 发数 = 0;
  const 桩 = async () => { 发数++; return { ok: false, 因: '桩：续不上' }; };
  const cfg1 = { ...CFG, 凭据: { 探针上限: 1 } };
  const f = 凭据(root, 18);
  await oauth.哨兵(root, cfg1, { now: T0, 文件: f, 探针: 桩 });
  await oauth.哨兵(root, cfg1, { now: 分(15), 文件: f, 探针: 桩 });
  assert.equal(发数, 1, '上限调到 1 就只发一发');
});

await ta('无 refreshToken / 未登录 / 有效 三种情形一发探针都不发', async () => {
  const root = makeRoot(); oauth.重置(root);
  let 发数 = 0;
  const 桩 = async () => { 发数++; return { ok: true, 因: '桩' }; };
  const 无refresh = path.join(root, '无refresh.json');
  fs.writeFileSync(无refresh, JSON.stringify({ claudeAiOauth: { accessToken: 'x', expiresAt: T0 + 10 * 60000 } }), 'utf8');
  const r1 = await oauth.哨兵(root, CFG, { now: T0, 文件: 无refresh, 探针: 桩 });
  assert.equal(r1.自续.尝试, false, '没有 refreshToken 就没什么可续的');
  assert.ok(r1.告警, '直接叫人');
  oauth.重置(root);
  await oauth.哨兵(root, CFG, { now: T0, 文件: path.join(root, '没有.json'), 探针: 桩 });
  oauth.重置(root);
  await oauth.哨兵(root, CFG, { now: T0, 文件: 凭据(root, 600), 探针: 桩 });
  assert.equal(发数, 0, '未登录（无从续起）与有效（无需续）都不烧调用');
});

await ta('自续总闸可配（config.凭据.自续=false）→ 逐字节退回 055 行为', async () => {
  const root = makeRoot(); oauth.重置(root);
  let 发数 = 0;
  const cfg关 = { ...CFG, 凭据: { 自续: false } };
  const r = await oauth.哨兵(root, cfg关, { now: T0, 文件: 凭据(root, 12), 探针: async () => { 发数++; return { ok: true, 因: '桩' }; } });
  assert.equal(发数, 0, '关了就一发不探');
  assert.equal(r.自续, null);
  assert.ok(r.告警.includes('即将到期'));
  assert.equal(r.告警.includes('自续已试'), false, '关闸时急件正文与 055 同形');
  assert.equal(急件(root).length, 1);
});

await ta('自续() 单调也能用：直接问「续得上吗」，且不发信不动告警节流', async () => {
  const root = makeRoot(); oauth.重置(root);
  const r = await oauth.自续(root, CFG, { now: T0, 文件: 凭据(root, 6), 探针: 续成桩(root, 6 + 90) });
  assert.equal(r.成功, true);
  assert.equal(r.增文, '+1.5h');
  assert.equal(急件(root).length, 0, '单调自续不发信');
  assert.equal(流水(root).includes('OAuth 自续成功'), false, '流水由哨兵落，自续() 自己不写');
});

console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error(e); process.exit(1); });
