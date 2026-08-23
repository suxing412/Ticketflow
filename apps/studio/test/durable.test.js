// durable.test.js — 落盘写（写 → fsync → 改名）
// 案源（2026-08-21 查实）：项管台账主档被写成 **21918 字节全 NUL**，大小正好等于坏前那版；
// 事件流里救不回（管理费只活在主档，事件不带 token），08-21 之前的项管开销记账真丢了。
// **不是逻辑错**——写路径本来就是 temp+rename，NTFS 上 rename 是原子的。病根低一层：
// fs.writeFileSync 只把数据交给页缓存，元数据（文件大小）先提交、数据还在内存，断电即成 NUL。
// 这台机器两天内非正常断电三次，于是踩中了。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const d = require('../lib/core/durable');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('落盘写测试');
const 巢 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dur-'));

t('写得进、读得出、目录不存在自动建', () => {
  const p = path.join(巢(), '深', '两层', 'a.json');
  d.写JSON(p, { 甲: 1, 乙: ['x'] });
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { 甲: 1, 乙: ['x'] });
});

t('覆盖写不留 .tmp 残骸（残骸会让下次 mkdir/rename 撞车）', () => {
  const dir = 巢(); const p = path.join(dir, 'b.json');
  d.写JSON(p, { n: 1 }); d.写JSON(p, { n: 2 });
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).n, 2);
  assert.deepEqual(fs.readdirSync(dir), ['b.json'], '临时件必须已改名走人');
});

t('**关键格**：fsync 发生在 rename 之前（这一格红了，整条修法就是摆设）', () => {
  // 直接盯系统调用顺序——这正是本案缺的那一步，用行为断言它真的在。
  const 序 = [];
  const 原fsync = fs.fsyncSync, 原rename = fs.renameSync;
  fs.fsyncSync = function (fd) { 序.push('fsync'); return 原fsync.call(fs, fd); };
  fs.renameSync = function (a, b) { 序.push('rename'); return 原rename.call(fs, a, b); };
  try { d.写JSON(path.join(巢(), 'c.json'), { x: 1 }); }
  finally { fs.fsyncSync = 原fsync; fs.renameSync = 原rename; }
  const i = 序.indexOf('fsync'), j = 序.indexOf('rename');
  assert.ok(i >= 0, '必须调用 fsync——不调就等于什么都没改');
  assert.ok(j >= 0, '必须调用 rename');
  assert.ok(i < j, `fsync 必须在 rename 之前（实际顺序：${序.join(' → ')}）`);
});

t('断电模拟：fsync 抛错即整体失败，旧档原样保留（宁可写不进，不许写成半截）', () => {
  const p = path.join(巢(), 'd.json');
  d.写JSON(p, { 版: '旧' });
  const 原 = fs.fsyncSync;
  fs.fsyncSync = () => { throw new Error('模拟落盘失败'); };
  try {
    assert.throws(() => d.写JSON(p, { 版: '新' }), /模拟落盘失败/, '写不进就要抛，不许静默吞——静默吞正是这类事故的温床');
  } finally { fs.fsyncSync = 原; }
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).版, '旧', '失败后旧档必须完好');
});

t('序列化失败在写盘之前抛，不留半截 tmp', () => {
  const dir = 巢(); const o = {}; o.自己 = o; // 循环引用
  assert.throws(() => d.写JSON(path.join(dir, 'e.json'), o));
  assert.deepEqual(fs.readdirSync(dir), [], '一个文件都不许留下');
});

t('接线判据：六个关键写口都走落盘写，无人再裸用 writeFileSync(tmp,…)', () => {
  // 案源：本次一处处改过来的时候发现，全库当时**零处 fsync**，而 temp+rename 有六处。
  // 这条判据盯的是「将来新增的写口别再漏」——漏一处就够丢一次账。
  const 口 = [
    ['lib/core/state.js', /durable'\)\.写JSON/],
    ['lib/pm/ledger.js', /durable'\)\.写JSON/],
    ['lib/pm/ideas.js', /durable'\)\.写/],
    ['lib/quota.js', /durable'\)\.写/],
    ['lib/creds.js', /durable'\)\.写/],
  ];
  for (const [f, re] of 口) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(src, re, `${f} 必须走落盘写`);
    assert.ok(!/writeFileSync\(tmp/.test(src), `${f} 不许再裸用 writeFileSync(tmp,…)`);
  }
  const 塔 = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'watchtower', 'watchtower.js'), 'utf8');
  assert.match(塔, /fsyncSync/, '瞭望塔跨包不引共用件，但必须就地 fsync');
});

console.log('全部通过：' + passed + ' 项');
