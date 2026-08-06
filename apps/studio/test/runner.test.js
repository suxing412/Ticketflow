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
const quota = require('../lib/quota');
// 测试隔离（2026-08-05 案：额度闸曾查真实订阅用量——codex 实际用量爬过 70% 时本套件假失败数版无人察觉）
quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('runner 执行器测试（D30/D31/D32）');
const UN = { durMs: 0 }; // 测试内部钩子：durMs 存在＝模拟执行（0＝同步完成），生产路径不传
const on = (root) => state.update(root, (s) => { s.执行器 = { 运行: true }; });
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

  await t('QA 开 + 编制有 QA：同轮走完 执行→质检→QA复核→待验收，质检人=职能名', async () => {
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-02', 职能: '程序', QA: '开' });
    const r = await runner.tick(root, CFG, UN);
    assert.ok(r.质检.includes('P-02'), '质检执行被派发');
    const cur = store.find(root, 'P-02');
    assert.equal(cur.state, '待验收');
    // H85 补章去岗位化：质检会话不再冒充「QA-A」这个人头，标签就是职能名（判官三席同款单例会话）
    assert.equal(cur.fm.质检人, 'QA');
  });

  await t('QA 开 + 编制无 QA 这一行：停在质检等复核（不越权）', async () => {
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-03', 职能: '程序', QA: '开' });
    await runner.tick(root, NO_QA, UN);
    assert.equal(store.find(root, 'P-03').state, '质检');
  });

  // ---- 施工令-008 去岗位化：新形态 config.编制（每职能一行 + 池序）驱动同一条流水 ----
  await t('新形态编制：领单/质检照常走通，QA 挑人只看编制存在性不看人头', async () => {
    const 新 = { ...CFG, agents: undefined, 编制: [
      { 职能: '程序', 池序: [{ 池: 'codex', 档: '' }, { 池: 'claude', 档: '' }] },
      { 职能: 'QA', 池序: [{ 池: 'claude', 档: '' }] },
    ] };
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-90', 职能: '程序', QA: '开' });
    const r = await runner.tick(root, 新, UN);
    assert.deepEqual(r.领单, ['P-90'], '编制去岗位化后拉取制按职能领单（id 即职能名）');
    const cur = store.find(root, 'P-90');
    assert.equal(cur.fm.主办, '程序', '主办=职能名，不再有 -A 岗位号');
    assert.equal(cur.fm.执行池, 'codex', '池序首位即默认落点');
    assert.equal(cur.fm.质检人, 'QA');
    assert.equal(cur.state, '待验收');
    // 编制里抽掉 QA 这一行 → 质检无人可派，停在质检等复核
    const 无QA = { ...新, 编制: 新.编制.filter((x) => x.职能 !== 'QA') };
    const root2 = makeRoot(); on(root2);
    seed(root2, '池', { id: 'P-91', 职能: '程序', QA: '开' });
    await runner.tick(root2, 无QA, UN);
    assert.equal(store.find(root2, 'P-91').state, '质检');
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

  await t('暂停总闸合上 → 不领单', async () => {
    const root = makeRoot(); on(root);
    gates.setPaused(root, true);
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

  await t('常开单闸制（H81）：运行即实弹，无解锁/模式开关拦路；对外状态无历史字段', async () => {
    const root = makeRoot(); on(root);
    seed(root, '池', { id: 'P-13', 职能: '策划', QA: '关' });
    const r = await runner.tick(root, CFG, UN);
    assert.ok(!r.拒因.some((x) => /解锁|试跑/.test(x)), '不再有「实弹未解锁」这类拒因');
    assert.ok(r.领单.includes('P-13'), '照常领单执行');
    const st = runner.status(root, CFG);
    assert.equal(st.运行, true);
    assert.ok(!('试跑' in st) && !('实弹解锁' in st), '/api/runner 对外状态无历史开关字段');
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
    assert.ok(fs.readFileSync(path.join(root, '回执', 'P-20.md'), 'utf8').includes('## 核查'));
    assert.equal(store.find(root, 'P-21').state, '待验收', '保留单碰都不碰');
  });

  // ---- 施工令-010 第 1 条：审检并发去写死（判官槽数读 config.并发.审检，默认 1＝旧单槽） ----
  await t('审检并发默认 1：两张委托待验收一轮只核一张（与旧 running.has 单槽逐位一致）', async () => {
    const root = makeRoot(); on(root);
    fs.mkdirSync(path.join(root, '回执'), { recursive: true });
    for (const id of ['C-01', 'C-02']) {
      fs.writeFileSync(path.join(root, '回执', `${id}.md`), `# 完工报告 ${id}\n`, 'utf8');
      seed(root, '待验收', { id, 职能: '程序', 验收方式: '委托' });
    }
    const r = await runner.tick(root, CFG, UN);
    assert.equal((r.代核 || []).length, 1, '默认配额 1 → 一轮一张（实际 ' + JSON.stringify(r.代核) + '）');
    const r2 = await runner.tick(root, CFG, UN);
    assert.equal((r2.代核 || []).length, 1, '第二轮补完另一张');
    assert.ok(['C-01', 'C-02'].every((id) => store.find(root, id).state === '完成'));
  });

  await t('审检并发=2：同一轮两张待验收并行核查，席位号 核查 / 核查·2', async () => {
    const root = makeRoot(); on(root);
    const cfg2 = { ...CFG, 并发: { 审检: 2 } };
    fs.mkdirSync(path.join(root, '回执'), { recursive: true });
    for (const id of ['C-11', 'C-12', 'C-13']) {
      fs.writeFileSync(path.join(root, '回执', `${id}.md`), `# 完工报告 ${id}\n`, 'utf8');
      seed(root, '待验收', { id, 职能: '程序', 验收方式: '委托' });
    }
    const r = await runner.tick(root, cfg2, UN);
    assert.equal((r.代核 || []).length, 2, '配额 2 → 一轮开两槽（实际 ' + JSON.stringify(r.代核) + '）');
    assert.equal((r.代核 || []).length, new Set(r.代核).size, '两槽拿的是不同的单');
    assert.equal(store.find(root, 'C-13').state, '待验收', '第三张等下一轮，不越配额');
    // 席位号：并发席真开出来了（durMs=0 当场收线，改用悬挂会话验席位占用）
    const t3 = store.find(root, 'C-13');
    await runner.startWork(root, cfg2, t3, '核查', '代核', { durMs: 60000 });
    const r2 = await runner.tick(root, cfg2, { durMs: 0 });
    assert.equal((r2.代核 || []).length, 0, '首席位被占且无余单 → 不开新槽');
    assert.ok(runner.running.has('核查'), '首席位沿用原名');
    runner.running.clear();
  });

  await t('审检并发=2 且首席位在跑：新单落到 核查·2 并发席', async () => {
    const root = makeRoot(); on(root);
    const cfg2 = { ...CFG, 并发: { 审检: 2 } };
    fs.mkdirSync(path.join(root, '回执'), { recursive: true });
    for (const id of ['C-21', 'C-22']) {
      fs.writeFileSync(path.join(root, '回执', `${id}.md`), `# 完工报告 ${id}\n`, 'utf8');
      seed(root, '待验收', { id, 职能: '程序', 验收方式: '委托' });
    }
    await runner.startWork(root, cfg2, store.find(root, 'C-21'), '核查', '代核', { durMs: 60000 }); // 悬挂占首席
    await runner.tick(root, cfg2, { durMs: 0 });
    assert.equal(store.find(root, 'C-22').state, '完成', '并发席把第二张核完了');
    assert.ok(runner.running.has('核查'), '首席位仍被悬挂会话占着');
    assert.ok(!runner.running.has('核查·2'), '并发席用完即还');
    runner.running.clear();
  });

  await t('审检并发越硬顶按 2 截：配置写 9 也只开 2 槽（成本保险丝）', async () => {
    const root = makeRoot(); on(root);
    const cfg9 = { ...CFG, 并发: { 审检: 9 } };
    fs.mkdirSync(path.join(root, '回执'), { recursive: true });
    for (const id of ['C-31', 'C-32', 'C-33', 'C-34']) {
      fs.writeFileSync(path.join(root, '回执', `${id}.md`), `# 完工报告 ${id}\n`, 'utf8');
      seed(root, '待验收', { id, 职能: '程序', 验收方式: '委托' });
    }
    const r = await runner.tick(root, cfg9, UN);
    assert.equal((r.代核 || []).length, 2, '硬顶 2 封死（实际 ' + JSON.stringify(r.代核) + '）');
  });

  await t('审检并发=2 对仲裁同样生效（同类判官各算各的配额）', async () => {
    const root = makeRoot(); on(root);
    const cfg2 = { ...CFG, 并发: { 审检: 2 } };
    for (const id of ['C-41', 'C-42']) seed(root, '待定夺', { id, 职能: '程序', 主办: '程序-A', 自修次数: 3 });
    const r = await runner.tick(root, cfg2, UN);
    assert.equal((r.代裁 || []).length, 2, '两张待定夺同轮裁完');
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
    assert.ok(fs.readFileSync(path.join(root, '回执', 'P-30.md'), 'utf8').includes('## 仲裁'));
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

  await t('空输出不作数（TK-21/TK-31）：判官不盖章，执行不占位，一律失败分诊', async () => {
    const calls = [];
    const fin = (note, v) => calls.push({ path: 'ok', note, v });
    const fail = (why) => calls.push({ path: 'fail', why });
    for (const k of ['质检', '代核', '代裁', '执行']) {
      calls.length = 0;
      runner.settleClose(k, 0, '  \n ', '', 'X-1', fin, fail);
      assert.equal(calls[0].path, 'fail', k + ' 空输出走执行失败');
      assert.ok(calls[0].why.includes('输出为空'));
    }
    // 有输出的代核照旧解析结论行：有「结论：通过」→通过，缺结论行仍保守判不过
    calls.length = 0;
    runner.settleClose('代核', 0, '逐条核过\n结论：通过', '', 'X-1', fin, fail);
    assert.deepEqual([calls[0].path, calls[0].v], ['ok', true]);
    calls.length = 0;
    runner.settleClose('代核', 0, '有输出但没写结论行——但这段话足够长足够像一份认真写过的核验记录，只是格式没带结论行，保守按不过盖章处理', '', 'X-1', fin, fail);
    assert.deepEqual([calls[0].path, calls[0].v], ['ok', false], '有实质输出缺结论行仍按不过');
    // 代核光板"不过"（TK-29 案）：有结论行但全文过薄 → 判官失败重试，不当有效裁决
    calls.length = 0;
    runner.settleClose('代核', 0, '结论：不过', '', 'X-1', fin, fail);
    assert.equal(calls[0].path, 'fail', '光板不过按判官失败');
    assert.ok(calls[0].why.includes('光板'));
    // 光板保护不误伤实质"不过"：带逐条理由的长报告照常盖不过章
    calls.length = 0;
    runner.settleClose('代核', 0, '逐条核验：第1条 seat_pos 反序列化失败，103 郡治全部堆叠原点，阻断；第2条测试断言 InRange(0,1) 假绿未检出。修复指引：加预处理+断言硬化。\n结论：不过', '', 'X-1', fin, fail);
    assert.deepEqual([calls[0].path, calls[0].v], ['ok', false], '实质不过照常盖章');
    // 非零退出照走失败，原因优先 stderr
    calls.length = 0;
    runner.settleClose('代核', 1, '', 'boom', 'X-1', fin, fail);
    assert.equal(calls[0].path, 'fail');
    assert.ok(calls[0].why.includes('boom'));
    // 质检散文体结论判读（曾硬编码 true 致 QA 永放行，TK-31/33 案）：
    // "## 结论\n**通过**"→true；"结论\n不过"→false；无结论/判读不了→判官失败重试
    calls.length = 0;
    runner.settleClose('质检', 0, '# QA 核验\n## 逐条核验\n1. ✓\n## 结论\n\n**通过**', '', 'X-1', fin, fail);
    assert.deepEqual([calls[0].path, calls[0].v], ['ok', true], 'QA 散文体通过');
    calls.length = 0;
    runner.settleClose('质检', 0, '# QA 核验\n## 结论\n不过（修复指引：补文件）', '', 'X-1', fin, fail);
    assert.deepEqual([calls[0].path, calls[0].v], ['ok', false], 'QA 散文体不过驱动自修');
    calls.length = 0;
    runner.settleClose('质检', 0, '写了一堆核验过程但没有那个收束标记', '', 'X-1', fin, fail);
    assert.equal(calls[0].path, 'fail', 'QA 无结论按判官失败重试');
  });

  await t('stream-json 报告提取（TK-35 案）：真报告不被闲聊尾巴吞掉', async () => {
    const mk = (t2) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t2 }] } });
    const raw = [mk('先做点事'), mk('# 完工报告 TK-X\n## 产出\nA.md'), mk('顺手收个尾，闲聊一句')].join('\n');
    const got = runner.extractClaudeText(raw);
    assert.ok(got.startsWith('# 完工报告') && !got.includes('闲聊'), '取报告样消息而非最后闲聊');
    assert.equal(runner.extractClaudeText('普通纯文本输出'), '普通纯文本输出', '非 JSONL 原样退化');
    assert.equal(runner.extractClaudeText([mk('甲段'), mk('乙段')].join('\n')), '甲段\n\n乙段', '无报告样时全量拼接');
    assert.ok(runner.resolveCli('claude', 'opus').args.includes('stream-json'), 'claude 走 stream-json');
    assert.ok(!runner.resolveCli('codex', '').args.includes('stream-json'), 'codex 不受影响');
  });

  await t('委托代核失败重试封顶：封顶前留待验收下轮重试且不盖章，封顶后停拉、清计数可重审', async () => {
    const root = makeRoot(); on(root);
    seed(root, '待验收', { id: 'P-40', 职能: '程序', 验收方式: '委托' });
    for (let i = 1; i <= 3; i++) {
      const r = await runner.tick(root, CFG, { ...UN, failWith: 'CLI 退出码 0 但输出为空' });
      assert.ok((r.代核 || []).includes('P-40'), `第 ${i} 次仍自动拉起`);
      const cur = store.find(root, 'P-40');
      assert.equal(cur.state, '待验收', '失败不动单');
      assert.ok(!cur.fm.代核, '失败不盖章');
      assert.equal(cur.fm.代核失败次数, i);
    }
    const r4 = await runner.tick(root, CFG, { ...UN, failWith: 'x' });
    assert.ok(!(r4.代核 || []).length, '封顶后不再自动重试');
    assert.equal(store.find(root, 'P-40').fm.代核失败次数, 3, '计数不再涨');
    // 人工清计数 → 恢复重审；成功后计数清除
    store.update(root, 'P-40', (fm) => { fm.代核失败次数 = 2; });
    const r5 = await runner.tick(root, CFG, UN);
    assert.ok((r5.代核 || []).includes('P-40'));
    const ok = store.find(root, 'P-40');
    assert.equal(ok.state, '完成');
    assert.ok(!ok.fm.代核失败次数, '成功清计数');
  });

  await t('委托代裁失败重试封顶：留待定夺不盖章，封顶后停拉；上限可配 判官重试上限', async () => {
    const root = makeRoot(); on(root);
    const cfg2 = { ...CFG, 执行器: { 判官重试上限: 2 } };
    seed(root, '待定夺', { id: 'P-41', 职能: '程序', 主办: '程序-A' });
    for (let i = 1; i <= 2; i++) {
      await runner.tick(root, cfg2, { ...UN, failWith: '空输出' });
      const cur = store.find(root, 'P-41');
      assert.equal(cur.state, '待定夺', '失败不动单');
      assert.ok(!cur.fm.代裁, '失败不盖章');
      assert.equal(cur.fm.代裁失败次数, i);
    }
    const r3 = await runner.tick(root, cfg2, { ...UN, failWith: 'x' });
    assert.ok(!(r3.代裁 || []).length, '配置上限 2 次即封顶');
    // 默认上限 3：同样计数下默认配置还会再试
    const r4 = await runner.tick(root, CFG, UN);
    assert.ok((r4.代裁 || []).includes('P-41'), '默认上限 3 未封顶');
    assert.equal(store.find(root, 'P-41').state, '在途', '模拟代裁给方向回在途');
    assert.ok(!store.find(root, 'P-41').fm.代裁失败次数, '成功清计数');
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

  // ---- 施工令-010 第 5 条：codex tail 观测盲区（过程输出全走 stderr，stdout 只在收尾吐终答）----
  await t('活尾巴 tailFrom：stdout 优先、无 stdout 则收 stderr、ANSI 控制符洗净', () => {
    const E = String.fromCharCode(27); const NL = String.fromCharCode(10);
    const 过程 = `${E}[32mcodex${E}[0m${NL}${E}[2mtokens used: 1234${E}[0m${NL}`;
    const 只有stderr = runner.tailFrom('', 过程);
    assert.ok(只有stderr.tail.includes('tokens used: 1234'), 'stderr-only 也取得到尾巴：' + JSON.stringify(只有stderr.tail));
    assert.ok(!只有stderr.tail.includes(E), 'ANSI 控制符已洗净');
    assert.deepEqual(只有stderr.tail3, ['codex', 'tokens used: 1234'], '最近三行也走同一口径');
    assert.equal(runner.tailFrom('最终答案', 过程).tail, '最终答案', 'stdout 有货就优先（真报告比过程噪声值钱）');
    assert.equal(runner.tailFrom('   ', 过程).tail.includes('tokens used'), true, 'stdout 只有空白＝没货，回落 stderr');
    assert.deepEqual(runner.tailFrom('', ''), { tail: '', tail3: [] }, '两路皆空＝真零输出');
    assert.equal(runner.stripAnsi('plain 32m text [ok]'), 'plain 32m text [ok]', '正常文本零误伤');
  });

  await t('实测形状（stderr-only 子进程）：tail 有内容且零输出看门狗不误报', async () => {
    // 真起一个「过程行全 stderr、stdout 只在收尾吐终答」的子进程——这就是 codex CLI 的实测形状
    const { spawn } = require('child_process');
    const E = String.fromCharCode(27);
    const src = `const E=String.fromCharCode(27);`
      + `process.stderr.write(E+'[32mcodex'+E+'[0m\\n');`
      + `process.stderr.write(E+'[2mtokens used: 1234'+E+'[0m\\n');`
      + `setTimeout(()=>process.stdout.write('done'),60);`;
    const child = spawn(process.execPath, ['-e', src], { windowsHide: true });
    const entry = { id: 'S-1', kind: '执行', 池: 'codex', startedAt: new Date(Date.now() - 30 * 60000).toISOString() };
    let out = '', errout = '';
    child.stdout.on('data', (d) => { out += d; entry.收字节 = (entry.收字节 || 0) + d.length; Object.assign(entry, runner.tailFrom(out, errout)); });
    child.stderr.on('data', (d) => { errout += d; entry.收字节 = (entry.收字节 || 0) + d.length; Object.assign(entry, runner.tailFrom(out, errout)); });
    // 过程期（stdout 还空）：尾巴必须已经有内容，且看门狗不许报
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(entry.tail && entry.tail.includes('tokens used'), '过程期尾巴有内容（旧样这里是空的）：' + JSON.stringify(entry.tail));
    assert.ok(entry.收字节 > 0, '活性字节 = stdout∪stderr');
    const patrol = require('../lib/pm/patrol');
    const root = makeRoot(); patrol.重置(root);
    const r1 = patrol.零输出(root, CFG, { 执行中: [entry] });
    assert.equal(r1.告警.length, 0, '跑了 30 分钟但一路在 stderr 吐字 → 不许误报挂死');
    await new Promise((r) => child.on('close', r));
    assert.equal(out, 'done', '终答仍只从 stdout 取（收线裁决口径不变）');
    assert.equal(entry.tail, 'done', 'stdout 一有货，尾巴立刻切回真报告');
    assert.ok(!entry.tail.includes(E));
    // 对照组：真·零输出会话（一个字节没收到）照报不误
    const 死 = { id: 'D-1', kind: '执行', 池: 'codex', startedAt: new Date(Date.now() - 30 * 60000).toISOString(), tail: '', 收字节: 0 };
    assert.equal(patrol.零输出(root, CFG, { 执行中: [死] }).告警.length, 1, '真零输出照报');
  });

  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
