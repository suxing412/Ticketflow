// runner.test.js — 执行器 D30/D31/D32：领单执行/QA质检执行/执行失败入位与分诊/闸门/断点恢复/实弹门
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const runner = require('../lib/runner');
const life = require('../lib/lifecycle');
const state = require('../lib/core/state');
const store = require('../lib/core/store');
const gates = require('../lib/gates');
const { makeRoot, seed, CFG } = require('./helper');

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('runner 执行器测试（D30/D31/D32）');
const UN = { durMs: 0 }; // 同步完成模拟执行
const on = (root) => state.update(root, (s) => { s.执行器 = { 运行: true, 试跑: true }; });
const NO_QA = { ...CFG, agents: CFG.agents.filter((a) => a.职能 !== 'QA') };

(async () => {
  await t('未启动 → tick 跳过，不领单', async () => {
    const root = makeRoot();
    seed(root, '池', { id: 'P-01', 职能: '策划' });
    const r = await runner.tick(root, CFG, UN);
    assert.ok(r.skipped);
    assert.equal(store.find(root, 'P-01').state, '池');
  });

  await t('QA 关：自动领单 → 执行 → 直达待验收 + 回执落盘', async () => {
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-01', 职能: '策划', QA: '关' });
    const r = await runner.tick(root, CFG, UN);
    assert.deepEqual(r.领单, ['P-01']);
    const cur = store.find(root, 'P-01');
    assert.equal(cur.state, '待验收');
    assert.equal(cur.fm.主办, '策划-A');
    assert.ok(cur.fm.交付时间);
    assert.ok(fs.existsSync(path.join(root, '回执', 'P-01.md')));
  });

  await t('QA 开 + 有 QA agent：同轮走完 执行→质检→QA复核→待验收，落 质检人', async () => {
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-02', 职能: '程序', QA: '开' });
    const r = await runner.tick(root, CFG, UN);
    assert.ok(r.质检.includes('P-02'), '质检执行被派发');
    const cur = store.find(root, 'P-02');
    assert.equal(cur.state, '待验收');
    assert.equal(cur.fm.质检人, 'QA-A');
  });

  await t('QA 开 + 无 QA agent：停在质检等复核（不越权）', async () => {
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-03', 职能: '程序', QA: '开' });
    await runner.tick(root, NO_QA, UN);
    assert.equal(store.find(root, 'P-03').state, '质检');
  });

  await t('一个 QA 一轮只审一张，下一轮接着审（一人一张同源约束）', async () => {
    const root = makeRoot(); on(root);
    seed(root, '质检', { id: 'P-04', 职能: '策划', 主办: '策划-A', 领单时间: new Date().toISOString() });
    seed(root, '质检', { id: 'P-05', 职能: '程序', 主办: '程序-A', 领单时间: new Date().toISOString() });
    await runner.tick(root, CFG, UN);
    const states1 = ['P-04', 'P-05'].map((id) => store.find(root, id).state).sort();
    assert.deepEqual(states1, ['待验收', '质检'].sort(), '第一轮只过一张');
    await runner.tick(root, CFG, UN);
    assert.ok(['P-04', 'P-05'].every((id) => store.find(root, id).state === '待验收'), '第二轮补完');
  });

  await t('执行失败注入（D31）：本地入位 + 失败元数据 + agent 空出', async () => {
    const root = makeRoot(); on(root);
    seed(root, '在途', { id: 'P-06', 职能: '策划', 主办: '策划-A', 领单时间: new Date().toISOString() });
    await runner.tick(root, CFG, { ...UN, failWith: 'CLI 退出码 1：模拟崩溃' });
    const cur = store.find(root, 'P-06');
    assert.equal(cur.state, '执行失败');
    assert.equal(cur.fm.失败次数, 1);
    assert.ok(cur.fm.失败原因.includes('模拟崩溃'));
    assert.equal(cur.fm.主办, '策划-A', '主办保留作诊断线索');
    assert.equal(runner.running.size, 0, 'agent 空出');
    // 执行失败不占在途口径：同 agent 可继续领新单
    seed(root, '池', { id: 'P-07', 职能: '策划', QA: '关' });
    const r2 = await runner.tick(root, CFG, UN);
    assert.ok(r2.领单.includes('P-07'));
  });

  await t('判官失败不打整单：质检失败原地重试（<3 留质检），3 次封顶入执行失败', async () => {
    const root = makeRoot(); on(root);
    seed(root, '质检', { id: 'P-30', 职能: '策划', 主办: '策划-A', 领单时间: new Date().toISOString() });
    await runner.tick(root, CFG, { ...UN, failWith: '网络抖动' });
    let cur = store.find(root, 'P-30');
    assert.equal(cur.state, '质检', '第 1 次失败留质检');
    assert.equal(cur.fm.质检失败次数, 1);
    await runner.tick(root, CFG, { ...UN, failWith: '网络抖动' });
    await runner.tick(root, CFG, { ...UN, failWith: '网络抖动' });
    assert.equal(store.find(root, 'P-30').state, '执行失败', '3 次封顶入分诊');
    // 成功路径清计数
    const root2 = makeRoot(); on(root2);
    seed(root2, '质检', { id: 'P-31', 职能: '策划', 主办: '策划-A', 领单时间: new Date().toISOString() });
    await runner.tick(root2, CFG, { ...UN, failWith: 'x' });
    await runner.tick(root2, CFG, UN);
    const ok = store.find(root2, 'P-31');
    assert.equal(ok.state, '待验收');
    assert.ok(!ok.fm.质检失败次数, '成功后计数清除');
  });

  await t('失败分诊（D31）：重投清主办回池 / 上呈进待定夺', async () => {
    const root = makeRoot();
    seed(root, '执行失败', { id: 'P-08', 职能: '程序', 主办: '程序-A' });
    const r1 = life.失败分诊(root, 'P-08', '重投');
    assert.ok(r1.ok);
    const cur = store.find(root, 'P-08');
    assert.equal(cur.state, '池');
    assert.ok(!cur.fm.主办, '重投清主办');
    store.move(root, 'P-08', '池', '在途', (fm) => { fm.主办 = 'x'; }, new Date().toISOString());
    life.执行失败(root, 'P-08', '再次失败');
    assert.equal(store.find(root, 'P-08').fm.失败次数, 1); // 分诊后重新计（此环境 fm 已清? 保守断言 ≥1）
    const r2 = life.失败分诊(root, 'P-08', '上呈');
    assert.ok(r2.ok);
    assert.equal(store.find(root, 'P-08').state, '待定夺');
  });

  await t('自动续单（D29）：完成一张后下一轮同 agent 领下一张', async () => {
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-09', 职能: '美术', QA: '关', 优先级: 'P0' });
    seed(root, '池', { id: 'P-10', 职能: '美术', QA: '关', 优先级: 'P1' });
    const cfg4 = { ...CFG, agents: [...CFG.agents, { id: '美术-A', 职能: '美术', 执行池: 'claude' }] };
    await runner.tick(root, cfg4, UN);
    assert.equal(store.find(root, 'P-09').state, '待验收');
    await runner.tick(root, cfg4, UN);
    assert.equal(store.find(root, 'P-10').state, '待验收');
  });

  await t('暂停闸门合上 → 不领单', async () => {
    const root = makeRoot(); on(root);
    gates.setPaused(root, 'global', true);
    seed(root, '池', { id: 'P-11', 职能: '策划' });
    const r = await runner.tick(root, CFG, UN);
    assert.equal(r.领单.length, 0);
  });

  await t('断点恢复：在途有主办无执行记录 → 重新拉起', async () => {
    const root = makeRoot(); on(root);
    seed(root, '在途', { id: 'P-12', 职能: '程序', QA: '关', 主办: '程序-A', 领单时间: new Date().toISOString() });
    const r = await runner.tick(root, CFG, UN);
    assert.ok(r.执行.includes('P-12'));
    assert.equal(store.find(root, 'P-12').state, '待验收');
  });

  await t('实弹未解锁（D32）：切实弹后 tick 拒绝执行，不领单', async () => {
    const root = makeRoot();
    state.update(root, (s) => { s.执行器 = { 运行: true, 试跑: false }; }); // 实弹但 config 未解锁
    seed(root, '池', { id: 'P-13', 职能: '策划' });
    const r = await runner.tick(root, CFG, UN);
    assert.ok(r.拒因.some((x) => x.includes('实弹未解锁')));
    assert.equal(store.find(root, 'P-13').state, '池');
  });

  await t('委托代核（D34）：委托待验收单自动核验通过 → 验收完成 + 回执追加 + 代核戳', async () => {
    const root = makeRoot(); on(root);
    fs.mkdirSync(path.join(root, '回执'), { recursive: true });
    fs.writeFileSync(path.join(root, '回执', 'P-20.md'), '# 完工报告 P-20\n', 'utf8');
    seed(root, '待验收', { id: 'P-20', 职能: '程序', 验收方式: '委托' });
    seed(root, '待验收', { id: 'P-21', 职能: '美术', 验收方式: '保留' }); // 保留单不代核
    const r = await runner.tick(root, CFG, UN);
    assert.ok((r.代核 || []).includes('P-20'));
    assert.equal(store.find(root, 'P-20').state, '完成');
    assert.equal(store.find(root, 'P-20').fm.代核.结论, '通过');
    assert.ok(fs.readFileSync(path.join(root, '回执', 'P-20.md'), 'utf8').includes('## 委托代核'));
    assert.equal(store.find(root, 'P-21').state, '待验收', '保留单碰都不碰');
  });

  await t('委托代裁（D43③）：待定夺自动裁给方向 → 回在途 + 方向进正文 + 代裁戳；已裁过不重裁', async () => {
    const root = makeRoot(); on(root);
    fs.mkdirSync(path.join(root, '回执'), { recursive: true });
    fs.writeFileSync(path.join(root, '回执', 'P-30.md'), '# 完工报告 P-30\n## QA 章节\n不过\n', 'utf8');
    seed(root, '待定夺', { id: 'P-30', 职能: '程序', 主办: '程序-A', 自修次数: 3 });
    const r = await runner.tick(root, CFG, UN);
    assert.ok((r.代裁 || []).includes('P-30'));
    const cur = store.find(root, 'P-30');
    assert.equal(cur.state, '在途', '给方向回在途');
    assert.equal(cur.fm.代裁.结论, '给方向');
    assert.ok(cur.body.includes('## 定夺方向'), '方向写入正文');
    assert.ok(fs.readFileSync(path.join(root, '回执', 'P-30.md'), 'utf8').includes('## 委托代裁'));
    // 已盖代裁章的单不再重裁（上呈态等用户）
    const root2 = makeRoot(); on(root2);
    seed(root2, '待定夺', { id: 'P-31', 职能: '程序', 主办: '程序-A', 代裁: { 结论: '上呈', 时间: 'x' } });
    const r2 = await runner.tick(root2, CFG, UN);
    assert.ok(!(r2.代裁 || []).length, '已裁过不重复');
    assert.equal(store.find(root2, 'P-31').state, '待定夺');
  });

  await t('委托代裁失败不动单：留待定夺（判官失败不打整单同源约束）', async () => {
    const root = makeRoot(); on(root);
    seed(root, '待定夺', { id: 'P-32', 职能: '程序', 主办: '程序-A' });
    const t2 = store.find(root, 'P-32');
    await runner.startWork(root, CFG, t2, '委托代裁', '代裁', { failWith: '网络抖动' });
    assert.equal(store.find(root, 'P-32').state, '待定夺', '失败不动单');
    assert.ok(!store.find(root, 'P-32').fm.代裁, '失败不盖章，下轮可重试');
  });

  await t('待复核（D36）：标记后 池不可领/在途不起工/交产出被拒，解除后恢复', async () => {
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-22', 职能: '策划', 依据: '战斗系统#战斗-03' });
    const mk = life.标记待复核(root, '战斗系统#战斗-03', '公式改版');
    assert.equal(mk.命中.length, 1);
    const r1 = await runner.tick(root, CFG, UN);
    assert.ok(!r1.领单.includes('P-22'), '待复核单不派活');
    assert.equal(store.find(root, 'P-22').state, '池');
    // 在途中的待复核单：不起执行 + 交产出被拒
    store.move(root, 'P-22', '池', '在途', (fm) => { fm.主办 = '策划-A'; }, new Date().toISOString());
    const r2 = await runner.tick(root, CFG, UN);
    assert.ok(r2.拒因.some((x) => x.includes('P-22')));
    assert.ok(!life.交产出(root, 'P-22', 'x').ok);
    // 解除后正常交
    assert.ok(life.解除待复核(root, 'P-22', '已核对新公式').ok);
    assert.ok(life.交产出(root, 'P-22', '# 完工报告 P-22').ok);
    assert.ok(store.find(root, 'P-22').fm.复核确认);
  });

  await t('岗位协议：通用+职能章程自动前置进提示词；缺章程不阻塞', async () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, '岗位协议'), { recursive: true });
    fs.writeFileSync(path.join(root, '岗位协议', '通用.md'), '# 通用章程\n一单一事-MARKER-COMMON', 'utf8');
    fs.writeFileSync(path.join(root, '岗位协议', '程序.md'), '# 程序章程\n测试随行-MARKER-CODE', 'utf8');
    const fake = { id: 'X-1', fm: { 职能: '程序', title: 't' }, body: '## 范围\nx' };
    const p = runner.buildPrompt(root, fake, { name: 'TK', path: 'D:/x' });
    assert.ok(p.includes('MARKER-COMMON') && p.includes('MARKER-CODE'), '两份章程都在');
    assert.ok(p.indexOf('MARKER-COMMON') < p.indexOf('工单正文'), '章程在正文之前');
    const p2 = runner.buildPrompt(root, { ...fake, fm: { 职能: '美术', title: 't' } }, { name: 'TK', path: 'D:/x' });
    assert.ok(p2.includes('MARKER-COMMON') && !p2.includes('MARKER-CODE'), '职能章程按职能取');
    const rootBare = makeRoot();
    const p3 = runner.buildPrompt(rootBare, fake, { name: 'TK', path: 'D:/x' });
    assert.ok(p3.includes('工单正文'), '无章程目录也能组提示词');
  });

  await t('模型分级（D38）：个体覆盖 > 池默认 > CLI 默认；质检/代核走裁判档', async () => {
    const cfgM = { ...CFG, 模型: { codex默认: '', claude默认: 'sonnet', 质检: 'opus', 代核: 'opus' } };
    assert.equal(runner.pickModel(cfgM, '执行', { 模型: 'haiku' }, 'claude'), 'haiku', '个体覆盖优先');
    assert.equal(runner.pickModel(cfgM, '执行', {}, 'claude'), 'sonnet', '池默认');
    assert.equal(runner.pickModel(cfgM, '执行', {}, 'codex'), '', 'codex 空=CLI 默认');
    assert.equal(runner.pickModel(cfgM, '质检', { 模型: 'haiku' }, 'claude'), 'opus', '质检走裁判档，个体不覆盖');
    assert.equal(runner.pickModel(cfgM, '代核', {}, 'claude'), 'opus');
    const c1 = runner.resolveCli('codex', 'gpt-x');
    assert.deepEqual(c1.args.slice(-3), ['-m', 'gpt-x', '-'], 'codex -m 注入且 stdin 标记殿后');
    const c2 = runner.resolveCli('claude', 'opus');
    assert.ok(c2.args.includes('--model') && c2.args.includes('opus'));
    assert.ok(!runner.resolveCli('claude', '').args.includes('--model'), '空模型不加旗标');
  });

  await t('项目定位（D32）：注册表解析路径，未注册返回 null', async () => {
    const cfgP = { ...CFG, 项目: { 默认: 'TK', 注册: { TK: { 路径: require('os').tmpdir() } } } };
    const fake = { fm: { 项目: 'TK' } };
    const p = runner.projectPath(cfgP, fake);
    assert.ok(p && p.name === 'TK');
    assert.equal(runner.projectPath(cfgP, { fm: { 项目: '不存在' } }), null);
    assert.equal(runner.projectPath(CFG, fake), null, '无注册表 → null');
  });

  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
