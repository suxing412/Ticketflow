// artifacts.test.js — 产出定位：结构化章节优先 / fallback 正则 / 越界防护 / 落盘核验
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

console.log(`全部通过：${passed} 项`);
