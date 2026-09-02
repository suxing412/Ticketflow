// 质检结论.test.js — TK-197：结论解析兼容 + 同会话补问上限 + 待人工判兜底。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const runner = require('../lib/runner');
const store = require('../lib/core/store');
const quota = require('../lib/quota');
const { CFG, makeRoot, seed } = require('./helper');

quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null; quota.eagerRefresh = () => {};
let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name); };
console.log('质检结论解析与兜底测试（TK-197）');

const parse = (text) => runner.parseQaConclusion(text);
const stream = (session, text) => JSON.stringify({
  type: 'assistant', session_id: session,
  message: { content: [{ type: 'text', text }] },
});

// 本机 CLI 替身：每次 stdin 结束才同步交出对应 stream-json，不接外部服务。
const fakeCli = (responses, calls) => (cmd, args) => {
  calls.push({ cmd, args: [...args] });
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = {
    write: () => {},
    end: () => {
      const response = responses[calls.length - 1];
      child.stdout.emit('data', Buffer.from(response.raw));
      child.emit('close', response.code == null ? 0 : response.code);
    },
  };
  return child;
};

const qaCase = (id) => {
  const root = makeRoot();
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const cfg = {
    ...CFG,
    执行器: { ...CFG.执行器, 执行超时分钟: 1 },
    项目: { 默认: 'fixture', 注册: { fixture: { 路径: project } } },
  };
  seed(root, '初检', { id, 职能: '程序', 项目: 'fixture', 主办: '程序-A', QA: '开', 验收方式: '委托' });
  return { root, cfg };
};

(async () => {
  // 四种旧报文兼容样本：原始四发报文未保存在本地仓，故这些不是对真件的伪称。
  await t('① 旧报文兼容：标准旧标签', () => {
    assert.deepEqual(parse('逐条核验结束\n结论：通过'), { 结论: '通过', 通过: true });
  });
  await t('② 旧报文兼容：标题后二行加粗值', () => {
    assert.deepEqual(parse('## 质检结论\n\n**不通过**'), { 结论: '不通过', 通过: false });
  });
  await t('③ 旧报文兼容：全角冒号', () => {
    assert.deepEqual(parse('  【质检结论】：不通过  '), { 结论: '不通过', 通过: false });
  });
  await t('④ 旧报文兼容：散行标签', () => {
    assert.deepEqual(parse('---\n**结论：不过**'), { 结论: '不通过', 通过: false });
  });
  await t('⑤ 新协议：标记行前后带空行仍可判', () => {
    assert.deepEqual(parse('\n\n【质检结论】通过\n\n'), { 结论: '通过', 通过: true });
  });
  await t('⑥ 新协议：结论行之后仍有 Markdown 表格尾巴可判', () => {
    assert.deepEqual(parse('【质检结论】不通过\n\n| 项 | 证据 |\n|---|---|\n| 1 | 缺文件 |'), { 结论: '不通过', 通过: false });
  });
  await t('⑦ 新协议：待人工判是显式非自动裁定', () => {
    assert.deepEqual(parse('【质检结论】待人工判'), { 结论: '待人工判', 通过: false });
  });
  await t('⑧ 同会话补问：缺标记只 resume 一次，补出结论后正常流转', async () => {
    const { root, cfg } = qaCase('Q-197-A');
    const calls = [];
    const sid = '11111111-1111-1111-1111-111111111111';
    await runner.startWork(root, cfg, store.find(root, 'Q-197-A'), 'QA', '质检', {
      spawn: fakeCli([
        { raw: stream(sid, '已逐条核验，证据完整。') },
        { raw: stream(sid, '【质检结论】通过') },
      ], calls),
    });
    assert.equal(calls.length, 2, '无标记只允许一次同会话补问');
    assert.ok(calls[1].args.includes('--resume') && calls[1].args.includes(sid), '第二发必须复用首轮 session_id');
    assert.equal(store.find(root, 'Q-197-A').state, '核查', '补问拿到通过后走既有 QA 通过边');
  });

  // ⑧b 两件事一起验（都由 TF-15 暴露）：
  //   ① 质检分支原本**一个字都不写回执**——全仓 196 份回执里含核查 83、含仲裁 3、含质检报告 0。
  //      项目开张至今每一次质检的判断依据都只以一行 journal 的形式存在。
  //   ② 补问路径上 finishOk 只拿得到补问轮那一行标记，首轮报告同样会丢。
  await t('⑧b 质检报告必须入回执，且补问时首轮报告不许丢', async () => {
    const { root, cfg } = qaCase('Q-197-D');
    // 回执由执行会话先建；本用例直接铺一份，模拟 QA 之前已有执行回执
    const rp = path.join(root, '回执', 'Q-197-D.md');
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    fs.writeFileSync(rp, '## 做了什么\n执行轮写的内容\n', 'utf8');
    const sid = '44444444-4444-4444-4444-444444444444';
    await runner.startWork(root, cfg, store.find(root, 'Q-197-D'), 'QA', '质检', {
      spawn: fakeCli([
        { raw: stream(sid, '逐条核验：判据 1-11 全过，证据如下……质量分：4') },
        { raw: stream(sid, '【质检结论】通过') },
      ], []),
    });
    assert.equal(store.find(root, 'Q-197-D').state, '核查', '通过应走 QA 通过边');
    const 回执D = fs.readFileSync(rp, 'utf8');
    assert.ok(回执D.includes('## 做了什么'), '执行轮的内容不许被覆盖——质检是追加不是重写');
    assert.match(回执D, /## 质检（通过）/, '质检报告必须落一个自己的段落进回执');
    assert.ok(回执D.includes('逐条核验：判据 1-11 全过'), '首轮报告的正文要留住，不能只剩结论标记');
    assert.ok(回执D.includes('【质检结论】通过'), '结论行也要在，判定出处不能只存在于 journal');
  });
  await t('⑨ 兜底：补问一次仍无标记则待人工判，不产生新的质检派发', async () => {
    const { root, cfg } = qaCase('Q-197-B');
    const calls = [];
    const sid = '22222222-2222-2222-2222-222222222222';
    await runner.startWork(root, cfg, store.find(root, 'Q-197-B'), 'QA', '质检', {
      spawn: fakeCli([
        { raw: stream(sid, '报告已完成，但未输出机器结论。') },
        { raw: stream(sid, '仍只说明已核验，不给结论。') },
      ], calls),
    });
    const ticket = store.find(root, 'Q-197-B');
    assert.equal(calls.length, 2, '补问上限硬编为 1');
    assert.equal(ticket.state, '待处理', '不可判的质检不留在自动派发的初检队列');
    assert.equal(ticket.fm.质检结论, '待人工判');
    assert.equal(ticket.fm.待人工判.补问次数, 1);
    assert.equal(ticket.fm.质检失败次数, undefined, '无标记不计为质检失败，不触发整轮重派');
    const 回执B = fs.readFileSync(path.join(root, '回执', 'Q-197-B.md'), 'utf8');
    assert.ok(回执B.includes('## 质检（待人工判）'), '人工判段落要有');
    // 原样只断了上面这个标题，而断言消息写的是「人工判需要保留原质检文本」——
    // **说要留正文，只验了有没有标题**。真正的正文有没有留下，这条判据一个字都没看。
    // 下面两条才是它自称要验的东西（2026-08-28 TF-15 案暴露）。
    assert.ok(回执B.includes('报告已完成，但未输出机器结论'), '首轮报告必须留在回执里——要人判的人得有可判的东西');
    assert.ok(回执B.includes('仍只说明已核验'), '补问轮回复也要留，否则结论从哪来的查不到');
  });

  // ⑨b 是 TF-15 的真实形状，也是原样唯一漏掉 firstReport 的那一支：
  // 补问轮**明确回「待人工判」**。补问提示词写死「不要重写报告，只输出一行结论标记」，
  // 于是补问轮的文本就是那一行；只留它，等于把首轮那份逐条复核整个丢掉。
  // TF-15 实况：人工判回执全文两行，而首轮 3592 字的判据实跑证据与根因定位不知所终。
  await t('⑨b 补问轮明确判「待人工判」：首轮报告同样不许丢（TF-15 案）', async () => {
    const { root, cfg } = qaCase('Q-197-C');
    const calls = [];
    const sid = '33333333-3333-3333-3333-333333333333';
    const 首轮 = '逐条复核：判据 1-10 全过，实跑证据如下……第 11 条实测红 2，根因是老夹具口径过期。';
    await runner.startWork(root, cfg, store.find(root, 'Q-197-C'), 'QA', '质检', {
      spawn: fakeCli([
        { raw: stream(sid, 首轮) },
        { raw: stream(sid, '【质检结论】待人工判') },
      ], calls),
    });
    const t2 = store.find(root, 'Q-197-C');
    assert.equal(t2.fm.质检结论, '待人工判');
    const 回执C = fs.readFileSync(path.join(root, '回执', 'Q-197-C.md'), 'utf8');
    assert.ok(回执C.includes('根因是老夹具口径过期'),
      '首轮报告被丢了——这一支恰恰是唯一以「把材料交给人」为全部目的的路径');
    assert.ok(回执C.includes('【质检结论】待人工判'), '补问轮的结论行也要在，人才知道这个判定的出处');
  });
  await t('⑩ 生成端提示词使用固定结论格式', () => {
    const prompt = runner.buildQaPrompt(makeRoot(), { id: 'Q-197-P', fm: { title: '提示词断言' }, body: '' }, { path: 'D:/fixture' }, 'D:/none.md');
    assert.ok(prompt.includes('【质检结论】通过') && prompt.includes('【质检结论】不通过') && prompt.includes('【质检结论】待人工判'));
  });
  console.log('全部通过：' + passed + ' 项');
})().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
