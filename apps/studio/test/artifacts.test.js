// artifacts.test.js — 产出定位：结构化章节优先 / fallback 正则 / 越界防护 / 落盘核验
// 施工令-051 追加：解析收敛（菜单路径·数字串·URL 三类噪声剔除）+ TK-156/160 夹具回归 + 前端假红降级
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../lib/artifacts');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('artifacts 产出定位测试');

t('结构化「## 产出」章节：列表符/反引号/尾注剥离，逐行入列', () => {
  const r = A.extract('# 完工报告 X\n## 产出\n- `Docs/SLG/地图/地图设计原则.md`\n- Assets/Art/icons/sword.png（占位图标）\n## 做了什么\n- 也提到 `Other/thing.md` 但不该被抓\n');
  assert.equal(r.来源, '结构化');
  assert.deepEqual(r.路径, ['Docs/SLG/地图/地图设计原则.md', 'Assets/Art/icons/sword.png']);
});

t('无产出章节 → fallback：抓反引号与裸路径，去重', () => {
  const r = A.extract('## 做了什么\n- 新建 `Docs/SLG/地图/地图设计原则.md`，更新 Docs/SLG/地图/地图设计原则.md 与 `map_view.json`\n');
  assert.equal(r.来源, 'fallback');
  assert.deepEqual(r.路径, ['Docs/SLG/地图/地图设计原则.md']); // 无斜杠的裸文件名不算产出定位
});

t('fallback 排除 URL 与盘符绝对路径', () => {
  const r = A.extract('见 `https://a.b/c.md` 与 `C:/tmp/x.md` 和 `Docs/ok.md`');
  assert.deepEqual(r.路径, ['Docs/ok.md']);
});

t('resolveIn：仓内正常解析，.. 越界与空值 → null', () => {
  const root = os.tmpdir();
  assert.ok(A.resolveIn(root, 'a/b.md').startsWith(path.resolve(root)));
  assert.equal(A.resolveIn(root, '../escape.md'), null);
  assert.equal(A.resolveIn(root, '..\\escape.md'), null);
  assert.equal(A.resolveIn(null, 'a.md'), null);
});

t('locate：存在的报大小，声称但不存在的标缺失', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  fs.mkdirSync(path.join(root, 'Docs'));
  fs.writeFileSync(path.join(root, 'Docs', '真.md'), '内容');
  const r = A.locate('## 产出\n- Docs/真.md\n- Docs/假.md\n', root);
  assert.equal(r.产出[0].存在, true); assert.ok(r.产出[0].大小 > 0);
  assert.equal(r.产出[1].存在, false);
});

t('空回执不炸', () => {
  assert.deepEqual(A.extract('').路径, []);
  assert.deepEqual(A.extract(null).路径, []);
});

/* ---- 施工令-051 一、判据收敛：isArtifactPath 逐分支 ----
   旧判据只问「含不含 /」，于是菜单路径与度量串一律进清单、一律扣红。
   下面每条对应要件1 的一类噪声，分开写：合并成表驱动后某类漏网只会报「第 N 行不符」。 */

t('真路径：含目录分隔且带扩展名 → 认', () => {
  assert.equal(A.isArtifactPath('Docs/SLG/地图/水系参数.md'), true);
  assert.equal(A.isArtifactPath('Assets/Editor/汉代地图/水系手修窗口.cs'), true);
  assert.equal(A.isArtifactPath('Assets\\Art\\Map\\terrain.png'), true); // 反斜杠归一
});

t('菜单路径：Tools/、SLG/ 开头且无扩展名 → 剔（案源三红之一）', () => {
  assert.equal(A.isArtifactPath('Tools/TK/汉代地图/手修编辑器'), false);
  assert.equal(A.isArtifactPath('SLG/地图/烘焙'), false);
  assert.equal(A.isArtifactPath('Window/TK/面板'), false);
  assert.equal(A.isArtifactPath('Tools/TK/预设.asset'), true); // 带扩展名的不冤枉
});

t('数字/单位串：斜杠是「实测/目标」不是目录分隔 → 剔（案源另两红）', () => {
  assert.equal(A.isArtifactPath('2.21/2.46 km'), false);
  assert.equal(A.isArtifactPath('0.00/0.00 km'), false);
  assert.equal(A.isArtifactPath('12/30'), false);
  assert.equal(A.isArtifactPath('80/100 %'), false);
  assert.equal(A.isArtifactPath('1.8/2.0 s'), false);
});

t('URL 与盘符绝对路径 → 剔（产出必须相对项目仓）', () => {
  assert.equal(A.isArtifactPath('https://a.b/c.md'), false);
  assert.equal(A.isArtifactPath('http://x.y/z'), false);
  assert.equal(A.isArtifactPath('C:/tmp/x.md'), false);
  assert.equal(A.isArtifactPath('D:\\GitHub\\TK\\a.md'), false);
});

t('版本号不冒充扩展名：扩展名须字母打头', () => {
  assert.equal(A.isArtifactPath('Docs/方案v1.2'), false);
  assert.equal(A.isArtifactPath('Docs/方案v1.2.md'), true);
});

t('无扩展名但磁盘实测存在 → 认（LICENSE/Dockerfile 这类真交付物）', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-real-'));
  fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'build', 'Dockerfile'), 'FROM node');
  assert.equal(A.isArtifactPath('build/Dockerfile', root), true);
  assert.equal(A.isArtifactPath('build/不存在的东西', root), false);
  assert.equal(A.isArtifactPath('build/Dockerfile'), false);      // 不给仓根就只剩扩展名一条路
  assert.equal(A.isArtifactPath('../外面/Dockerfile', root), false); // 越界的不去问磁盘
});

t('无斜杠的裸串一律不进清单', () => {
  assert.equal(A.isArtifactPath('map_view.json'), false);
  assert.equal(A.isArtifactPath('做完了'), false);
  assert.equal(A.isArtifactPath(''), false);
  assert.equal(A.isArtifactPath(null), false);
});

t('混合清单：真路径留下、三类噪声出局，顺序不乱', () => {
  const raw = ['## 产出',
    '- `Tools/TK/汉代地图/手修编辑器`',
    '- Docs/SLG/地图/水系参数.md',
    '- 2.21/2.46 km',
    '- `Assets/Art/Map/river.png`（河道贴图）',
    '- https://wiki.local/a/b.md',
    '- 0.00/0.00 km', ''].join('\n');
  const r = A.extract(raw);
  assert.equal(r.来源, '结构化');
  assert.deepEqual(r.路径, ['Docs/SLG/地图/水系参数.md', 'Assets/Art/Map/river.png']);
});

/* ---- 施工令-051 二、TK-156/160 夹具回归 ----
   本会话够不着 TK 项目仓，夹具按 2026-08-12 21:28 截图复原（见夹具文件头说明）。
   真回执可达时设 TK_REPO 指向该仓，装载口自动改吃真件，断言一字不改。 */
const 夹具 = (id) => {
  const 真 = process.env.TK_REPO && path.join(process.env.TK_REPO, '回执', `${id}.md`);
  if (真 && fs.existsSync(真)) return fs.readFileSync(真, 'utf8');
  return fs.readFileSync(path.join(__dirname, 'fixtures', `回执-${id}.md`), 'utf8');
};

t('TK-160（fallback 通道）：三枚假红消失，两个真路径与参数表留下', () => {
  const raw = 夹具('TK-160');
  const 收敛前 = raw.match(/`[^`\n]+`/g).map((s) => s.slice(1, -1)).filter((s) => s.includes('/'));
  assert.ok(收敛前.includes('Tools/TK/汉代地图/手修编辑器') && 收敛前.includes('2.21/2.46 km') && 收敛前.includes('0.00/0.00 km'),
    '夹具已不含案发那三串，回归失去意义');
  const r = A.extract(raw);
  assert.equal(r.来源, 'fallback');
  for (const 假 of ['Tools/TK/汉代地图/手修编辑器', '2.21/2.46 km', '0.00/0.00 km']) {
    assert.ok(!r.路径.includes(假), `假红未消：${假}`);
  }
  assert.deepEqual(r.路径, ['Assets/Editor/汉代地图/水系手修窗口.cs', 'Assets/Scripts/Map/RiverMesh.cs', 'Docs/SLG/地图/水系参数.md']);
});

t('TK-156（结构化通道）：度量行与菜单路径出局，两件真产出留下', () => {
  const r = A.extract(夹具('TK-156'));
  assert.equal(r.来源, '结构化');
  assert.deepEqual(r.路径, ['Docs/SLG/地图/地形分层规范.md', 'Assets/Art/Map/terrain_layers.png']);
});

t('TK-160 落盘核验：真路径缺失才红，且红点数由 3 降到实缺数', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk160-'));
  fs.mkdirSync(path.join(root, 'Assets', 'Editor', '汉代地图'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Assets', 'Editor', '汉代地图', '水系手修窗口.cs'), 'class W {}');
  const r = A.locate(夹具('TK-160'), root);
  assert.equal(r.产出.length, 3);
  assert.deepEqual(r.产出.filter((a) => !a.存在).map((a) => a.路径),
    ['Assets/Scripts/Map/RiverMesh.cs', 'Docs/SLG/地图/水系参数.md']); // 真缺的照红不误
});

/* ---- TF-7 过形闸：带合法扩展名 ≠ 指向某个具体文件（案源 TK-203） ----
   051 的四道闸放行了两类残余：glob 通配（一族文件）与占位／省略（一个样例）。
   两者都被 EXT_RE 判成真路径、被 statSync 判成缺失，于是扣红。红色专供「声称交了、仓里却没有」，
   声称本身不具体时它没有资格出现。判据一律直调 isArtifactPath/extract/locate，不 grep 源码（H104）。 */

// 判据逐条把**实跑值**打出来再断言：回执要贴的就是这几行，不必另起探针、更不必 grep 源码
const 判 = (s, 期望, root) => {
  const v = A.isArtifactPath(s, root);
  console.log(`    · isArtifactPath('${s}') → ${v}`);
  assert.equal(v, 期望, `期望 ${期望}，实测 ${v}：${s}`);
};

t('glob 通配串 → 剔（说的是一族文件，不是一个产出）', () => {
  判('Assets/**/*.unity', false);
  判('Assets/*.unity', false);
  判('Assets/SLG/Tests/Editor/?apTests.cs', false);
  判('Docs/{草案,定稿}/方案.md', false);
  判('Docs/[未定]/方案.md', false);
  判('Assets/Scenes/主城.unity', true); // 同族真路径不误伤
});

t('占位／省略串 → 剔（说的是一个样例，不是交付件）', () => {
  判('enginectl-baselines/results-….xml', false);
  判('enginectl-baselines/results-....xml', false);
  判('enginectl-baselines/results-<时间戳>.xml', false);
  判('enginectl-runs/${单号}-x.log', false);
  判('enginectl-runs/{{单号}}-x.log', false);
  判('enginectl-runs/%s.log', false);
  判('enginectl-baselines/results-20260826.xml', true); // 具体时间戳照认
});

t('过形闸压在磁盘实测之前：给了仓根也不去问磁盘', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf7-'));
  fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'build', 'Dockerfile'), 'FROM node');
  判('build/Dockerfile', true, root);  // 无扩展名实测通道原样保留
  判('build/*', false, root);          // 通配串不走实测通道
  判('build/<名>', false, root);
});

t('通配与占位串不进清单：extract 两条通道都拦', () => {
  const 结构化 = A.extract(['## 产出',
    '- `Assets/**/*.unity`',
    '- Docs/SLG/地图/水系参数.md',
    '- `enginectl-baselines/results-….xml`', ''].join('\n'));
  assert.equal(结构化.来源, '结构化');
  assert.deepEqual(结构化.路径, ['Docs/SLG/地图/水系参数.md']);
  const f = A.extract('复跑见 `Assets/**/*.unity` 与 `enginectl-baselines/results-<时间戳>.xml`，产物 `Docs/报告.md`');
  assert.deepEqual(f.路径, ['Docs/报告.md']);
});

t('TK-203 落盘核验：通配与占位串一个红标不留，真声明照红', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk203-'));
  const raw = 夹具('TK-203');
  const 收敛前 = raw.match(/`[^`\n]+`/g).map((s) => s.slice(1, -1));
  assert.ok(收敛前.includes('Assets/**/*.unity') && 收敛前.includes('enginectl-baselines/results-….xml'),
    '夹具已不含案发那两串，回归失去意义');
  const r0 = A.locate(raw, root);
  console.log('    ├ 原夹具条目清单：' + JSON.stringify(r0.产出));
  assert.deepEqual(r0.产出.filter((a) => !a.存在), []); // 假红清零
  const r1 = A.locate(raw + '\n- 另交 `Docs/不存在.md`\n', root);
  console.log('    └ 追加真声明后条目清单：' + JSON.stringify(r1.产出));
  assert.deepEqual(r1.产出.filter((a) => !a.存在).map((a) => a.路径), ['Docs/不存在.md']); // 红色语义未被降级
});

/* ---- 施工令-051 三、前端假红降级 ----
   测的是 public/app.js 里生产那一份 artifactsPanel（@testable 原样抽出），不是抄本。 */
const artifactsPanel = (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const a = src.indexOf('// @testable-begin artifactsPanel');
  const b = src.indexOf('// @testable-end artifactsPanel');
  assert.ok(a >= 0 && b > a, 'public/app.js 里的 artifactsPanel 抽取标记丢了——测试与实现已脱钩');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // eslint-disable-next-line no-new-func
  return new Function('esc', src.slice(a, b) + '\nreturn artifactsPanel;')(esc);
})();

t('解析不出合法产出 → 中性占位「无产出物声明」，一个红字都没有', () => {
  const html = artifactsPanel('TK-160', { 来源: null, 产出: [] });
  assert.ok(html.includes('无产出物声明'));
  assert.ok(!html.includes('缺失') && !html.includes('pill sm red'), '空清单不许出红');
});

t('真路径缺失 → 照旧扣红（红色的语义没被降级掉）', () => {
  const html = artifactsPanel('TK-160', { 来源: '结构化', 产出: [{ 路径: 'Docs/真.md', 存在: false, 大小: null }] });
  assert.ok(html.includes('缺失') && html.includes('pill sm red'));
});

t('真路径存在 → 出体积与调起按钮', () => {
  const html = artifactsPanel('TK-160', { 来源: '结构化', 产出: [{ 路径: 'Docs/真.md', 存在: true, 大小: 2048 }] });
  assert.ok(html.includes('2 KB') && html.includes("openArt('TK-160','Docs/真.md','文件')"));
  assert.ok(!html.includes('无产出物声明'));
});

t('无回执/无所属项目（产出=null）→ 整块不出，不占版面', () => {
  assert.equal(artifactsPanel('TK-160', null), '');
  assert.equal(artifactsPanel('TK-160', undefined), '');
});

console.log(`全部通过：${passed} 项`);
