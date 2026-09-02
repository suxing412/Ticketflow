// draftguard.test.js — 起草落盘前置校验闸（TF-15）
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { makeRoot, 临时目录, 收尾 } = require('./helper');
const draftguard = require('../lib/pm/draftguard');
const brain = require('../lib/pm/brain');

let passed = 0; const 红 = [];
const t = (名, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + 名); } catch (e) {
    红.push(名); console.log('  ' + String.fromCharCode(0x2717) + ' ' + 名 + ' —— ' + e.message);
  }
};
const 有型 = (r, 型) => r.违规.some((x) => x.型 === 型);
const 无型 = (r, 型) => !r.违规.some((x) => x.型 === 型) && !r.警示.some((x) => x.型 === 型);
const 注册 = { 项目: { 默认: 'TK', 注册: { TK: { 单号前缀: 'TK' } } } };
const 完整正文 = '## 背景\n说明背景。\n\n## 执行内容\n说明执行。\n\n## 验收标准\n机器可判定。';
const 合法fm = { 验收方式: '委托', 专项: 'S-3' };
const 查 = (overrides = {}) => draftguard.查草稿({ fm: 合法fm, body: 完整正文, 需求: '正常需求', 项目: 'TK', cfg: 注册, ...overrides });

console.log('起草落盘前置校验闸测试（TF-15）');

t('缺章拦得住：缺验收标准章即拒，说明点名缺章', () => {
  const r = 查({ body: '## 背景\n有背景。\n## 执行内容\n有执行。' });
  assert.equal(r.ok, false);
  assert.ok(有型(r, '正文缺章'));
  assert.match(r.违规.find((x) => x.型 === '正文缺章').说明, /验收标准/);
});

t('悬尾拦得住：TF-6 断点形拒，正常句号不误伤', () => {
  const bad = 查({ body: 完整正文.replace('机器可判定。', '协议固定（换实现不换协议，H80②）：') });
  const good = 查();
  assert.equal(bad.ok, false);
  assert.ok(有型(bad, '正文悬尾'));
  assert.ok(无型(good, '正文悬尾'));
});

t('验收方式非法拦得住：自检拒，委托/保留/空值均不误伤', () => {
  const bad = 查({ fm: { ...合法fm, 验收方式: '自检' } });
  assert.equal(bad.ok, false);
  assert.ok(有型(bad, '验收方式非法'));
  for (const 验收方式 of ['委托', '保留', '']) {
    const r = 查({ fm: { ...合法fm, 验收方式 } });
    assert.ok(!有型(r, '验收方式非法'), `验收方式=${JSON.stringify(验收方式)} 被误拦`);
  }
});

t('项目字段拦得住：已配置注册表时空/未注册拒；缺表降为警示', () => {
  for (const 项目 of ['', '不存在的项目']) {
    const r = 查({ 项目 });
    assert.equal(r.ok, false);
    assert.ok(有型(r, '项目落点'));
  }
  for (const 项目 of ['', '不存在的项目']) {
    const r = 查({ 项目, cfg: {} });
    assert.equal(r.ok, true);
    assert.equal(r.警示.filter((x) => x.型 === '项目落点').length, 1);
  }
});

t('归属漏落拦得住：无归属拒，散单声明降警示，专项不误伤', () => {
  const 无归属 = { 验收方式: '委托' };
  const bad = 查({ fm: 无归属 });
  const 散单 = 查({ fm: 无归属, body: 完整正文 + '\n确无归属的独立杂务。' });
  const 有专项 = 查();
  assert.equal(bad.ok, false);
  assert.ok(有型(bad, '归属漏落'));
  assert.equal(散单.ok, true);
  assert.equal(散单.警示.filter((x) => x.型 === '归属漏落').length, 1);
  assert.ok(无型(有专项, '归属漏落'));
});

t('反向不误杀：四型都合法的完整草稿通过且零违规', () => {
  const r = 查();
  assert.equal(r.ok, true);
  assert.equal(r.违规.length, 0);
});

// 真实起草走独立进程：先替换 child_process.spawn 再加载 brain，确保只假掉模型外呼，落盘链保持真实。
function 跑真起草(canned) {
  const root = makeRoot();
  const 桩目录 = 临时目录('tf15cli-');
  fs.writeFileSync(path.join(桩目录, 'canned.txt'), canned, 'utf8');
  fs.writeFileSync(path.join(桩目录, 'fake-cli.js'),
    "const fs=require('fs');const path=require('path');\n"
    + "process.stdin.on('data',()=>{});\n"
    + "process.stdin.on('end',()=>{console.log(fs.readFileSync(path.join(__dirname,'canned.txt'),'utf8'));});\n", 'utf8');
  const code = `
    const cp = require('child_process');
    const orig = cp.spawn;
    cp.spawn = function (cmd) {
      if (/claude/i.test(String(cmd))) return orig(process.execPath, [process.env.FAKE_CLI], { windowsHide: true });
      return orig.apply(cp, arguments);
    };
    const brain = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'pm', 'brain.js'))});
    const store = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'core', 'store.js'))});
    const journal = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'journal.js'))});
    const root = process.env.STUDIO_ROOT;
    const cfg = ${JSON.stringify(注册)};
    const 前 = brain.下一号(root, 'TK');
    brain.draftTicket(root, cfg, '起草链真早退验证', null, (r) => {
      const 后 = brain.下一号(root, 'TK');
      const 待审 = store.list(root, '待审').map((x) => x.id);
      const 志 = journal.readLatest(root).lines.join('\\n');
      process.stdout.write('@@' + JSON.stringify({ r, 前, 后, 待审, 志 }) + '@@');
      process.exit(0);
    }, { 项目: 'TK' });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, STUDIO_ROOT: root, FAKE_CLI: path.join(桩目录, 'fake-cli.js') },
  });
  return JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
}

const 块 = (fm, body) => `\`\`\`ticket\ntitle: 起草闸验证\n职能: 程序\n专项: S-3\n${fm || ''}---\n${body}\n\`\`\``;

t('真早退：缺章输出不落盘、不耗号，journal 留拦截行', () => {
  const r = 跑真起草(块('', '## 背景\n有背景。\n## 执行内容\n有执行。'));
  assert.equal(r.r && r.r.ok, false, JSON.stringify(r));
  assert.deepEqual(r.待审, []);
  assert.equal(r.前, r.后);
  assert.match(r.志, /起草校验闸拦截/);
  assert.match(r.志, /正文缺章/);
});

t('真早退反向：合法输出真落待审', () => {
  const r = 跑真起草(块('', 完整正文));
  assert.equal(r.r && r.r.ok, true, JSON.stringify(r));
  assert.equal(r.待审.length, 1);
  assert.notEqual(r.前, r.后);
});

t('白名单不吞归属：模型自填保留，排程注入仍覆盖', () => {
  const 自填 = brain.draftFm({ fm: { 专项: 'S-3' } }, { id: 'TK-1', 项目: 'TK', 归属: null });
  const 注入 = brain.draftFm({ fm: { 专项: 'S-3' } }, { id: 'TK-2', 项目: 'TK', 归属: { 专项: 'S-9' } });
  assert.equal(自填.专项, 'S-3');
  assert.equal(注入.专项, 'S-9');
});

t('纯函数自守：替换读写与 spawn 为抛错桩后全部查草稿用例仍可运行', () => {
  const 读 = fs.readFileSync; const 写 = fs.writeFileSync; const spawn = childProcess.spawn;
  try {
    fs.readFileSync = () => { throw new Error('不许读盘'); };
    fs.writeFileSync = () => { throw new Error('不许写盘'); };
    childProcess.spawn = () => { throw new Error('不许 spawn'); };
    for (const input of [
      {}, { body: 完整正文 }, { fm: { ...合法fm, 验收方式: '自检' } },
      { 项目: '' }, { fm: { 验收方式: '委托' }, body: 完整正文 },
    ]) assert.doesNotThrow(() => 查(input));
  } finally {
    fs.readFileSync = 读; fs.writeFileSync = 写; childProcess.spawn = spawn;
  }
});

t('配置可覆盖：单章覆盖生效，空表回落默认三章', () => {
  const onlyBackground = '## 背景\n完整。';
  const 覆盖 = 查({ body: onlyBackground, cfg: { ...注册, draftguard: { 必备章: ['背景'] } } });
  const 非法 = 查({ body: onlyBackground, cfg: { ...注册, draftguard: { 必备章: [] } } });
  assert.ok(!有型(覆盖, '正文缺章'));
  assert.equal(覆盖.ok, true);
  assert.ok(有型(非法, '正文缺章'));
});

if (红.length) {
  console.log('不通过 ' + 红.length + ' 项：' + 红.join('；'));
  process.exit(1);
}
收尾(null, passed);
