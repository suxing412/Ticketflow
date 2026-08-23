// ledger-encoding.test.js — 「读得出」不等于「读得懂」（2026-08-22 亲历）
//
// 案情：08-21 我修 事件.jsonl 里那行 133 个前导 NUL 时，把整本账 latin1→utf8 重编码了。
// 3503 行里 3442 行的字段名全成了乱码——`"类型"` 变 `"ç±»å"`。后果：
//   · JSON.parse 一条都不报错（乱码仍是合法 JSON 字符串）
//   · 文件里一个 NUL 都没有
//   · 于是 **G17「台账坏行」判据全绿，而这本账已经废了**
// 判据盯的是「读得出」，账要的是「读得懂」——差这一格，整本事实源静默作废近一天。
//
// 这套用例把那次事故原样复现（真造一本乱码账），断言体检与闸都必须叫出来。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../lib/pm/ledger');
const gr = require('../lib/gatereg');
const { makeRoot } = require('./helper');
// 闸的谓词不导出，走公开口 等我()：deps 注入真 ledger 模块，其余依赖给空桩（同 gatereg.test.js 的做法）
const 空 = { specials:{list:()=>[]}, ideas:{list:()=>[]}, schedule:{现态:()=>[]}, wiki:{pending:()=>[]} };
const G17 = (root) => gr.等我(root, { deps: { ...空, 台账: L } }).债.filter((d) => d.闸号 === 'G17');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('台账编码测试');
const NL = String.fromCharCode(10);

// 把一行正常事件做成当年那种双重编码乱码：UTF-8 字节被当 latin1 读进来再存成 UTF-8
const 弄乱 = (s) => Buffer.from(s, 'utf8').toString('latin1');

function 造账(root, 行们) {
  const d = path.join(root, '项管台账');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '事件.jsonl'), 行们.join(NL) + NL, 'utf8');
  return path.join(d, '事件.jsonl');
}
const 正常行 = (t2, 型) => JSON.stringify({ t: t2, 类型: 型, 触发: '例行' });

t('乱码账：JSON 解析得过、无 NUL，但必须被判出来', () => {
  const root = makeRoot();
  造账(root, [弄乱(正常行('2026-08-03T00:00:00Z', '切单启动')),
    弄乱(正常行('2026-08-04T00:00:00Z', '派发')),
    正常行('2026-08-22T00:00:00Z', '台账对齐')]);
  const r = L.事件流体检(root);
  // 先证明这本账在旧判据眼里是「干净」的——不证明这一点，就说不清这条判据为什么必要
  assert.equal(r.坏行.length, 0, '乱码行 JSON.parse 得过——旧判据的两格在这里都不响');
  assert.equal(r.含NUL, false, '也没有 NUL');
  // 新格：读得出但读不懂
  assert.deepEqual(r.无类型, [1, 2], '两行乱码必须被点名（行号要给准，人要照着去修）');
  assert.equal(r.总行, 3);
});

t('好账不许误报——判据不能靠「宁可错杀」换灵敏', () => {
  const root = makeRoot();
  造账(root, [正常行('2026-08-03T00:00:00Z', '切单启动'), 正常行('2026-08-22T00:00:00Z', '台账对齐')]);
  const r = L.事件流体检(root);
  assert.deepEqual(r.无类型, [], '正常账零误报');
  assert.deepEqual(r.坏行, []);
});

t('G17 闸真的会为乱码账立债（判据接到闸上了，不是只算不报）', () => {
  const root = makeRoot();
  造账(root, [弄乱(正常行('2026-08-03T00:00:00Z', '切单启动')), 正常行('2026-08-22T00:00:00Z', '台账对齐')]);
  const 债 = G17(root);
  assert.equal(债.length, 1, '乱码账必须立债——这正是当日全绿的那一格');
  assert.match(债[0].title, /读得出但读不懂/, '话要说人听得懂的：' + 债[0].title);
  assert.match(债[0].title, /缺 类型 格/, '要指出缺的是哪一格');
  assert.match(债[0].title, /行号 1/, '要给行号');
});

t('G17 对好账不立债（防上一条修成恒真闸——本项目 G14 犯过）', () => {
  const root = makeRoot();
  造账(root, [正常行('2026-08-22T00:00:00Z', '台账对齐')]);
  assert.deepEqual(G17(root), [], '好账零债');
});

t('真账已还原：3442 行乱码全部读得懂（本次数据修复的验收锚）', () => {
  const R = 'D:/GitHub/AI-GameStudio/监制台';
  if (!fs.existsSync(path.join(R, '项管台账', '事件.jsonl'))) { console.log('  · 跳过（无部署工作区）'); return; }
  const r = L.事件流体检(R);
  assert.deepEqual(r.坏行, [], '真账零坏行');
  assert.deepEqual(r.无类型 || [], [], '真账零乱码行——08-22 的 latin1→utf8 事故已逐行还原');
  assert.ok(r.总行 > 3000, '行数没被这次还原吃掉：' + r.总行);
});

console.log('全部通过：' + passed + ' 项');
