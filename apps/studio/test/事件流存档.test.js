// 事件流存档.test.js — TK-186：原始 stream-json 按单落盘 + 双闸清理。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const archive = require('../lib/eventarchive');
const config = require('../lib/core/config');
const runner = require('../lib/runner');
const budget = require('../../../packages/budget/budget.js');
const store = require('../lib/core/store');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };
const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 25, 12, 0, 0);
const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'event-archive-'));
const cfg = (more = {}) => ({ 事件流存档: {
  开: true, 根路径: 'archive', 保留天数: 30, 总体积上限字节: 1024,
  ...more,
} });
const put = (r, ticket, run, bytes, mtime) => {
  const file = path.join(r, 'archive', ticket, run + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 0x61));
  fs.utimesSync(file, new Date(mtime), new Date(mtime));
  return file;
};
const journal = (r) => {
  const dir = path.join(r, 'journal');
  return fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('') : '';
};

// 真实 startWork 的本机替身：stdout 只在 runner 已注册回调后同步吐出，绝不外呼 CLI。
const fakeCli = (raw, exit, observed) => () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.stdin = {
    write: () => {},
    end: () => { child.stdout.emit('data', Buffer.from(raw)); child.emit('close', exit); },
  };
  observed.code = exit;
  return child;
};
const runnerCase = (archiveOn, raw) => {
  const r = root();
  const project = path.join(r, 'project'); fs.mkdirSync(project);
  const runCfg = {
    ...cfg({ 开: archiveOn }),
    执行器: { 执行超时分钟: 30 }, 模型: {}, 执行池: { 'claude-key': {} },
    项目: { 默认: 'fixture', 注册: { fixture: { 路径: project } } }, 编制: [],
  };
  store.ensureDirs(r);
  const fm = { id: 'TK-zero', title: '零回归夹具', 职能: '程序', 产出物类型: '代码', 优先级: 'P1',
    规模: '单兵', QA: '关', 验收方式: '保留', 执行池: 'claude-key', 项目: 'fixture', 主办: '程序-A' };
  fs.writeFileSync(store.ticketPath(r, '在途', fm.id), store.serialize(fm, '## 范围\n测试存档不改变收线。'), 'utf8');
  const observed = {};
  runner.startWork(r, runCfg, store.find(r, fm.id), '程序-A', '执行', { spawn: fakeCli(raw, 0, observed) });
  const 账 = fs.readFileSync(path.join(r, '预算账.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const 归档根 = path.join(r, 'archive');
  const archives = fs.existsSync(归档根) ? fs.readdirSync(归档根, { recursive: true }).filter((f) => String(f).endsWith('.jsonl')) : [];
  return { r, code: observed.code, token: 账.reduce((sum, x) => sum + x.输入 + x.输出, 0), archives };
};

console.log('事件流按单存档与清理测试（TK-186）');

t('路径与命名：按单号/runId 落 jsonl；无单号归 _unassigned', () => {
  const r = root();
  const a = archive.打开(r, cfg(), { 单号: 'TK-186', runId: 'run-A' });
  a.写('{"type":"system"}\n'); a.收尾();
  assert.equal(a.路径, path.join(r, 'archive', 'TK-186', 'run-A.jsonl'));
  assert.ok(fs.existsSync(a.路径));
  assert.equal(fs.statSync(a.路径).size, Buffer.byteLength('{"type":"system"}\n'));
  const unassigned = archive.打开(r, cfg(), { runId: 'run-U' });
  unassigned.写('{"type":"system"}\n'); unassigned.收尾();
  assert.equal(unassigned.路径, path.join(r, 'archive', '_unassigned', 'run-U.jsonl'));
  assert.ok(fs.existsSync(unassigned.路径));
});

t('原样性：数据块切行后逐行字节不变，存档不改已有分拣或流计量输入', () => {
  const r = root();
  const raw = '{"type":"assistant","usage":{"input_tokens":7,"output_tokens":3}}\n'
    + '{"type":"result","usage":{"input_tokens":7,"output_tokens":5}}\n';
  const a = archive.打开(r, cfg(), { 单号: 'TK-186', runId: 'run-raw' });
  a.写(Buffer.from(raw.slice(0, 19))); a.写(Buffer.from(raw.slice(19))); a.收尾();
  assert.equal(fs.readFileSync(a.路径, 'utf8'), raw, '原始行不许重排、改写或补字段');
  const before = runner.流分拣器().收(raw);
  const after = runner.流分拣器().收(fs.readFileSync(a.路径, 'utf8'));
  assert.equal(after.主, before.主, '存档开关不改变已有主流输入');
  assert.deepEqual(budget.usageOf(after.计量), budget.usageOf(before.计量), '存档开关不改变流计量 token 口径');
});

t('零回归：同一 CLI 输入开关存档各跑一次 runner，token 数与退出码相同', () => {
  const raw = '{"type":"assistant","message":{"content":[{"type":"text","text":"# 完工报告 TK-zero"}]},"usage":{"input_tokens":7,"output_tokens":3}}\n'
    + '{"type":"result","usage":{"input_tokens":7,"output_tokens":5}}\n';
  const on = runnerCase(true, raw);
  const off = runnerCase(false, raw);
  assert.equal(on.code, 0); assert.equal(off.code, 0);
  assert.equal(on.token, off.token);
  assert.equal(on.token, 15, '计量口径维持既有 input=max + output=Σ');
  assert.equal(on.archives.length, 1, '开存档时应产生一个 run jsonl');
  assert.equal(off.archives.length, 0, '关存档时零副作用');
  runner.running.clear();
});

t('断连截尾：只保留已完成行，档内每行仍可 JSON.parse', () => {
  const r = root();
  const a = archive.打开(r, cfg(), { 单号: 'TK-186', runId: 'run-cut' });
  a.写('{"seq":1}\n{"seq":2'); a.收尾();
  const lines = fs.readFileSync(a.路径, 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(lines, ['{"seq":1}']);
  lines.forEach((line) => assert.doesNotThrow(() => JSON.parse(line)));
});

t('正常无换行收线：完整最后一行仍按原样保留', () => {
  const r = root();
  const a = archive.打开(r, cfg(), { 单号: 'TK-186', runId: 'run-last' });
  a.写('{"seq":1}'); a.收尾();
  assert.equal(fs.readFileSync(a.路径, 'utf8'), '{"seq":1}');
});

t('存档写失败：只留一行告警，不向调用方抛出', () => {
  const r = root();
  const a = archive.打开(r, cfg(), { 单号: 'TK-186', runId: 'run-full' });
  const original = fs.writeSync;
  fs.writeSync = () => { throw new Error('模拟磁盘满'); };
  try {
    assert.doesNotThrow(() => a.写('{"seq":1}\n'));
    assert.doesNotThrow(() => a.写('{"seq":2}\n'));
  } finally { fs.writeSync = original; }
  a.收尾();
  const warnings = journal(r).match(/事件流存档告警/g) || [];
  assert.equal(warnings.length, 1, '写入失败只能记一行告警');
});

t('清理天数闸：过期 run 按 mtime 删除并回收空单号目录', () => {
  const r = root();
  const old = put(r, 'TK-old', 'old', 3, now - 2 * day);
  const fresh = put(r, 'TK-new', 'fresh', 3, now - day / 2);
  const out = archive.清理(r, cfg({ 保留天数: 1, 总体积上限字节: 100 }), { now });
  assert.equal(out.触发闸, '天数');
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(path.dirname(old)), false, '空单号目录应回收');
  assert.equal(fs.existsSync(fresh), true);
});

t('清理体积闸：未过期时仍按 mtime 最老优先删到上限内', () => {
  const r = root();
  const old = put(r, 'TK-size', 'old', 3, now - day / 2);
  const fresh = put(r, 'TK-size', 'fresh', 3, now - day / 4);
  const out = archive.清理(r, cfg({ 保留天数: 10, 总体积上限字节: 4 }), { now });
  assert.equal(out.触发闸, '体积');
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
});

t('清理双闸：天数与体积同时触发，仍以 mtime 最老顺序删除', () => {
  const r = root();
  const old = put(r, 'TK-both', 'old', 3, now - 2 * day);
  const middle = put(r, 'TK-both', 'middle', 3, now - day / 2);
  const fresh = put(r, 'TK-both', 'fresh', 3, now - day / 4);
  const out = archive.清理(r, cfg({ 保留天数: 1, 总体积上限字节: 4 }), { now });
  assert.equal(out.触发闸, '双闸');
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(middle), false);
  assert.equal(fs.existsSync(fresh), true);
});

t('清理安全：活跃 run 正在写的文件永不被清', () => {
  const r = root();
  const active = put(r, 'TK-live', 'active', 3, now - day / 2);
  const other = put(r, 'TK-live', 'other', 3, now - day / 4);
  const out = archive.清理(r, cfg({ 保留天数: 10, 总体积上限字节: 4 }), { now, activeFiles: [active] });
  assert.equal(out.触发闸, '体积');
  assert.equal(fs.existsSync(active), true, 'activeFiles 里的在写文件不许删');
  assert.equal(fs.existsSync(other), false);
});

t('清理留痕：每次清理输出删除数、释放字节数与触发闸', () => {
  const r = root();
  put(r, 'TK-log', 'old', 3, now - 2 * day);
  archive.清理(r, cfg({ 保留天数: 1 }), { now });
  assert.match(journal(r), /事件流存档清理：删除 1 文件 · 释放 3 字节 · 触发闸=天数/);
});

t('存档关闭：不开目录、不写文件、不清理、不留日志', () => {
  const r = root();
  const off = cfg({ 开: false });
  assert.equal(archive.打开(r, off, { 单号: 'TK-off', runId: 'run-off' }), null);
  assert.equal(archive.清理(r, off, { now }).开, false);
  assert.equal(fs.existsSync(path.join(r, 'archive')), false);
  assert.equal(journal(r), '');
});

t('配置迁移：既有 studio.config.json 补齐四个存档字段与默认值', () => {
  const r = root();
  fs.writeFileSync(path.join(r, 'studio.config.json'), '{}', 'utf8');
  const loaded = config.load(r);
  assert.deepEqual(loaded.事件流存档, config.事件流存档默认);
  const persisted = JSON.parse(fs.readFileSync(path.join(r, 'studio.config.json'), 'utf8'));
  assert.deepEqual(persisted.事件流存档, config.事件流存档默认);
});

console.log(`全部通过：${passed} 项`);
