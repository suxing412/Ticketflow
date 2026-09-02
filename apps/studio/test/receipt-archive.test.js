// receipt-archive.test.js — 重投前归档上一轮回执（2026-08-28 TF-15 案）
//
// 案源：TF-15 走了三轮（首轮执行 → 质检待人工判 → 总监裁决重投 → 第三轮执行）。
// 第三轮开工后回执从 4689 字节变成 1745——**第一轮的逐条应答、质检那份完整复核报告、
// 以及总监从事件流存档补回的 3592 字分析，一次抹干净**。
// 回执是执行会话自己写的，它拿到的指令是「写回执到这个路径」，于是重投时整份重写。
//
// 这是同一夜里第三例「记录被丢弃」（前两例：待人工判只留补问轮标记、质检回执无正文）。
// 故修法刻意不走「改提示词让模型记得追加」——**记录保全不该建立在模型自觉上**。
// 机器在开工前拍快照，模型爱怎么写怎么写。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const runner = require('../lib/runner');
const store = require('../lib/core/store');
const quota = require('../lib/quota');
const { CFG, makeRoot, seed, 收尾 } = require('./helper');

quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null; quota.eagerRefresh = () => {};

let passed = 0;
const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('receipt-archive 重投前归档上一轮回执（TF-15 案）');

// 假 CLI：立刻收工，不产出任何东西——本判据只看归档动作，不看会话写了什么
const 哑CLI = (calls) => (cmd, args) => {
  calls.push(args.join(' '));
  const c = new EventEmitter();
  c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
  c.stdin = { write: () => {}, end: () => { c.stdout.emit('data', Buffer.from('done')); c.emit('close', 0); } };
  return c;
};

const 造 = (id, 态 = '待派') => {
  const root = makeRoot();
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const cfg = { ...CFG, 执行器: { ...CFG.执行器, 执行超时分钟: 1 }, 项目: { 默认: 'fixture', 注册: { fixture: { 路径: project } } } };
  seed(root, 态, { id, 职能: '策划', 项目: 'fixture', 主办: '策划-A', 放行: true });
  return { root, cfg };
};
const 历轮 = (root) => { try { return fs.readdirSync(path.join(root, '回执', '历轮')); } catch { return []; } };

(async () => {
  await t('执行轮开工前：既有回执被拍进 回执/历轮，内容逐字一致', async () => {
    const { root, cfg } = 造('R-1');
    const rp = path.join(root, '回执', 'R-1.md');
    const 前轮 = '## 自测结果\n1. 判据一：过（证据……）\n\n## 质检\n完整复核报告，3592 字的那种。\n';
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    fs.writeFileSync(rp, 前轮, 'utf8');

    await runner.startWork(root, cfg, store.find(root, 'R-1'), '策划-A', '执行', { spawn: 哑CLI([]) });

    const 档 = 历轮(root);
    assert.equal(档.length, 1, '上一轮回执必须被归档，实得 ' + JSON.stringify(档));
    assert.match(档[0], /^R-1-\d{4}-\d{2}-\d{2}T/, '档名要带单号与时间戳，便于按轮回查');
    assert.equal(fs.readFileSync(path.join(root, '回执', '历轮', 档[0]), 'utf8'), 前轮,
      '归档件必须与原回执逐字一致——差一个字就不叫存档');
  });

  await t('首轮（无既有回执）不产生空档，也不往 journal 刷失败行', async () => {
    const { root, cfg } = 造('R-2');
    await runner.startWork(root, cfg, store.find(root, 'R-2'), '策划-A', '执行', { spawn: 哑CLI([]) });
    assert.deepEqual(历轮(root), [], '没有前轮就不该凭空造一个档——空档会让人以为这单返工过');
    // existsSync 那道守卫真正拦的是这个：去掉它，copyFileSync 会 ENOENT 抛出、被 try 兜住，
    // 档确实不会产生（所以只断「无档」验不到它），但**每一张新单开工都会往 journal 写一行归档失败**。
    // 一条恒假的失败行比没有更坏：它把真失败淹掉，还让读账的人以为归档这件事一直是坏的。
    let 流水 = '';
    try {
      const 目 = path.join(root, 'journal');
      for (const f of fs.readdirSync(目)) 流水 += fs.readFileSync(path.join(目, f), 'utf8');
    } catch { 流水 = ''; }
    assert.ok(!/回执归档失败/.test(流水), '首轮不该有归档失败留痕：' + (流水.match(/.*回执归档失败.*/) || [''])[0]);
  });

  await t('归档不动原回执：原文件照旧在原位，会话仍写它', async () => {
    const { root, cfg } = 造('R-3');
    const rp = path.join(root, '回执', 'R-3.md');
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    fs.writeFileSync(rp, '前轮内容\n', 'utf8');
    await runner.startWork(root, cfg, store.find(root, 'R-3'), '策划-A', '执行', { spawn: 哑CLI([]) });
    assert.ok(fs.existsSync(rp), '归档是复制不是搬走——搬走会让本轮会话找不到它要写的文件');
    assert.equal(fs.readFileSync(rp, 'utf8'), '前轮内容\n', '归档动作本身不许改原文件');
  });

  await t('三轮下来留三份？——每次执行轮各拍一张，不覆盖彼此', async () => {
    const { root, cfg } = 造('R-4');
    const rp = path.join(root, '回执', 'R-4.md');
    fs.mkdirSync(path.dirname(rp), { recursive: true });
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(rp, `第 ${i} 轮回执\n`, 'utf8');
      // 每轮之间隔开一秒：档名按秒取戳，同秒两轮会撞名
      await new Promise((r) => setTimeout(r, 1100));
      const cur = store.find(root, 'R-4');
      if (!cur) break;
      await runner.startWork(root, cfg, cur, '策划-A', '执行', { spawn: 哑CLI([]) });
      // 会话跑完单会流转，放回待派再来一轮
      const t2 = store.find(root, 'R-4');
      if (t2 && t2.state !== '待派') store.move(root, 'R-4', t2.state, '待派', (fm) => { fm.放行 = true; }, new Date().toISOString());
    }
    const 档 = 历轮(root);
    assert.ok(档.length >= 2, '多轮应各留一档，实得 ' + 档.length + ' 份：' + JSON.stringify(档));
    assert.equal(new Set(档).size, 档.length, '档名不许撞——撞了就是又一次覆盖');
  });

  收尾('receipt-archive', passed);
})().catch((e) => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
