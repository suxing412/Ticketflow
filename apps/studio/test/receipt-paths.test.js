// receipt-paths.test.js — 回执裸相对路径的解析（议程第 40 条，2026-08-28）
//
// **原议程条目的诊断是错的**，这是本套件存在的第一个理由：
// 原文写「Docs/ 产出不入版本，回执引用的文件事后查无」。实测 `D:/GitHub/TK/Docs` 有 126 个文件
// 在 git 里，被点名查无的两份都在。真相是回执写的是**相对各自项目根**的路径，
// 而查的人站在监制台目录下找。问题不是「不入版本」，是「没说清相对谁」——两者修法完全不同。
//
// 存量 1382 处裸相对路径不改写（回执是 append-only 事实记录）。改成读的时候能解析。
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../lib/回执路径');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('receipt-paths 回执路径解析（议程第 40 条）');

const 仓 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rp-'));

t('摘路径：认得出常见仓内根，且不把散文切碎', () => {
  const 文 = [
    '改了 `apps/studio/lib/pm/brain.js` 与 `apps/studio/test/oauth.test.js`。',
    '方案见 Docs/SLG/技术方案/编辑器驻任务监听协议.md。',
    '素材落 Assets/Maps/han.geojson。',
    '这句里有 a/b 这种两字母的东西，不该被当成路径。',
    '范围是 Docs/** 与 Docs/*.md —— 通配符是在说范围，不是指某个文件。',
  ].join('\n');
  const 出 = R.摘路径(文);
  assert.ok(出.includes('apps/studio/lib/pm/brain.js'));
  assert.ok(出.includes('apps/studio/test/oauth.test.js'));
  assert.ok(出.includes('Docs/SLG/技术方案/编辑器驻任务监听协议.md'), '中文路径要认得：' + JSON.stringify(出));
  assert.ok(出.includes('Assets/Maps/han.geojson'));
  assert.ok(!出.some((p) => p.startsWith('a/')), '两字母散文不该被当成路径');
  assert.ok(!出.some((p) => p.includes('*')), '通配符是范围不是文件，不该收进来');
});

t('前置边界用否定式：全角冒号/箭头/行首之后的路径都要摘得到（白名单式边界必漏）', () => {
  // 第一版把前置字符写成白名单 ` \`（(【`，「产出：Docs/x.md」的全角冒号不在列，整条漏掉。
  // 判据把各种真实分隔符点名，免得下次又漏一个。
  for (const 句 of ['产出：Docs/甲.md', '方案 → Docs/甲.md', 'Docs/甲.md 是行首',
    '见【Docs/甲.md】', '（Docs/甲.md）', '产物=Docs/甲.md', '· Docs/甲.md']) {
    assert.ok(R.摘路径(句).includes('Docs/甲.md'), '摘不到：' + 句);
  }
  // 反面：粘在别的词后面的不算
  assert.equal(R.摘路径('xDocs/甲.md').length, 0, '前面粘着字母不算路径起点');
  assert.equal(R.摘路径('a/Docs/甲.md').length, 0, '前面粘着路径分隔也不算');
});

t('解析：按项目取仓根，同一个相对路径在不同项目下指向不同文件', () => {
  const tk = 仓(); const tf = 仓();
  fs.mkdirSync(path.join(tk, 'Docs', 'SLG'), { recursive: true });
  fs.writeFileSync(path.join(tk, 'Docs', 'SLG', '甲.md'), 'x');
  fs.mkdirSync(path.join(tf, 'Docs', 'SLG'), { recursive: true });   // TF 仓里没有 甲.md

  const cfg = { 项目: { 默认: 'TK', 注册: { TK: { 路径: tk, 单号前缀: 'TK' }, Ticketflow: { 路径: tf, 单号前缀: 'TF' } } } };
  const 正文 = '产出：Docs/SLG/甲.md';

  const a = R.解析(cfg, { 项目: 'TK', 正文 });
  assert.equal(a.length, 1);
  assert.equal(a[0].在, true, 'TK 仓里有这份文件');
  assert.ok(a[0].绝对.startsWith(tk), '解析到 TK 仓');

  const b = R.解析(cfg, { 项目: 'Ticketflow', 正文 });
  assert.equal(b[0].在, false, 'TF 仓里没有——同一相对路径在不同项目下是不同文件');
  assert.ok(b[0].绝对.startsWith(tf));
});

t('项目不在注册表 → 在=null 并说明定位不了，**不猜**', () => {
  const cfg = { 项目: { 默认: 'TK', 注册: { TK: { 路径: 仓() } } } };
  const r = R.解析(cfg, { 项目: '不存在的项目', 正文: 'Docs/x.md' });
  assert.equal(r[0].在, null, '定位不了要回 null，不是 false');
  assert.match(r[0].因, /不在注册表/);
  assert.equal(r[0].绝对, null, '猜错会把「查无」变成「指向别人家的同名文件」，更坏');
});

t('越界防护：../../ 不许把路径指到仓外', () => {
  const tk = 仓();
  const cfg = { 项目: { 默认: 'TK', 注册: { TK: { 路径: tk } } } };
  const r = R.解析(cfg, { 项目: 'TK', 正文: '看 Docs/../../../../Windows/System32/drivers/etc/hosts' });
  assert.ok(r.length > 0, '应摘到这条');
  assert.equal(r[0].绝对, null, '越界要拒绝——验证产物存在的功能不该变成任意路径探测器');
  assert.match(r[0].因, /越出仓根/);
});

t('体检：分清「在 / 查无 / 定位不了」三态', () => {
  const tk = 仓();
  fs.mkdirSync(path.join(tk, 'Docs'), { recursive: true });
  fs.writeFileSync(path.join(tk, 'Docs', '在.md'), 'x');
  const cfg = { 项目: { 默认: 'TK', 注册: { TK: { 路径: tk } } } };
  const r = R.体检(cfg, { 项目: 'TK', 正文: '产出 Docs/在.md 与 Docs/不在.md' });
  assert.equal(r.总, 2);
  assert.equal(r.在, 1);
  assert.equal(r.查无.length, 1);
  assert.equal(r.查无[0].相对, 'Docs/不在.md');
  assert.equal(r.定位不了.length, 0);
});

t('真账回放：TK 仓里那两份被议程点名「查无」的文件，解析后其实都在', () => {
  // 这一格直接打真盘。**它就是「原诊断错了」的实证**——
  // 议程第 40 条点名的两份文件，用对了仓根之后一份不少。
  const TK = 'D:/GitHub/TK';
  if (!fs.existsSync(TK)) { console.log('    （TK 仓不在本机，跳过真账回放）'); return; }
  const cfg = { 项目: { 默认: 'TK', 注册: { TK: { 路径: TK, 单号前缀: 'TK' } } } };
  const 正文 = [
    '方案：Docs/SLG/技术方案/编辑器驻任务监听协议.md',
    '调研：Docs/SLG/调研方案/汉代geojson绘制说明.md',
  ].join('\n');
  const r = R.体检(cfg, { 项目: 'TK', 正文 });
  assert.equal(r.总, 2, '两份都该被摘出来');
  assert.equal(r.在, 2, '用对仓根后两份都在——议程原诊断「查无」是站错目录找的结果：'
    + JSON.stringify(r.查无.map((x) => x.相对)));
});

console.log('  ' + passed + ' 项通过');
