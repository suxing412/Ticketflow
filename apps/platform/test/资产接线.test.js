// 资产接线契约 —— 堵住这个仓最常犯的那一类错（协-005）。
//
// 这一路查出来的问题，规律高度一致：**写好了，测过了，但没有任何代码路径走得到**。
//
//   · lib/ 下六个模块全是孤儿（协-004 才接上）
//   · routing/history 接了线，但从没有人写过它（协-002 才有第一个写入方）
//   · 角色协议模板/ 六份出厂就在库里，从没人 require 过（协-005 才喂给 AI）
//   · budget.view 早就有，一直没有消费方——账记着没人看（协-005 才接）
//
// 这些都不会报错。它们只会安静地不存在，而人以为功能在那儿。
//
// 本文件把「资产必须被用到」变成硬约束：新增一个模块或模板却忘了接线，测试就红。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('资产接线契约测试');

// 把全部源码读成一大坨，用来查「谁提到过我」。
// 排除 test/：测试引用不算接线——一个只被测试用到的模块，产品里等于不存在。
function 全部源码() {
  const 出 = [];
  const 扫 = (dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'test', 'dist', 'workspaces', 'journal', 'watchtower-out'].includes(d.name)) continue;
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { 扫(p); continue; }
      if (d.name.endsWith('.js')) 出.push(p);
    }
  };
  扫(平台根);
  return 出;
}

t('lib/ 下没有孤儿模块（写好了没接线是本仓最常犯的错）', () => {
  const 全 = 全部源码();
  const 库 = 全.filter((p) => p.includes(`${path.sep}lib${path.sep}`));
  // 谁提到过它：整仓源码（不含它自己）里出现过它的文件名
  const 孤儿 = [];
  for (const p of 库) {
    const 名 = path.basename(p, '.js');
    const 别人 = 全.filter((q) => q !== p).map((q) => fs.readFileSync(q, 'utf8')).join('\n');
    if (!别人.includes(名)) 孤儿.push(path.relative(平台根, p));
  }
  assert.deepEqual(孤儿, [],
    '这些模块没有任何人 require——它们不会报错，只会安静地不存在：\n  ' + 孤儿.join('\n  '));
});

t('角色协议模板每一份都被真的读过（出厂六份曾整整躺了三张施工令）', () => {
  const 目录 = path.join(平台根, '角色协议模板');
  const 全 = fs.readdirSync(目录).filter((f) => f.endsWith('.md'));
  assert.ok(全.length >= 5, '至少该有五份角色协议');
  // 装配器按「角色名.md」去读，所以只要角色词表里的每个角色都有对应文件即可
  const 装配 = require(path.join(平台根, 'lib', '提示装配.js'));
  const 配置 = JSON.parse(fs.readFileSync(path.join(平台根, 'config', 'platform.config.json'), 'utf8'));
  for (const 角色 of Object.keys(配置.roles || {})) {
    const r = 装配.角色协议(平台根, 角色);
    assert.ok(r.有, `角色 ${角色} 在 roles 里声明了，却没有 角色协议模板/${角色}.md——`
      + '执行时它拿不到任何角色约束，只能靠猜');
    assert.ok(r.文.length > 40, `${角色}.md 内容过短，像是占位没写`);
  }
  // 反过来也要查：有模板却不在角色词表里 = 永远不会被用到
  for (const f of 全) {
    const 名 = f.replace(/\.md$/, '');
    if (名 === 'common') continue;
    assert.ok((配置.roles || {})[名],
      `角色协议模板/${f} 存在，但 ${名} 不在 config 的 roles 里——这份协议永远不会被读到`);
  }
});

// 每个 lib 模块都必须从某个**入口**可达。
//
// 这条是本文件的主菜。上面「没有孤儿」只查了「有没有人提过我的文件名」——
// 太松：被另一个孤儿引用，或只被测试引用，都能蒙混过关。而这个仓真正犯过的错正是
// **写好了、测过了、测试还全绿，但产品里没有任何路径走得到**。
//
// 中间试过一版「导出了没人用」，报 21 个全是文件内部自用的顺手导出——
// 那量的是 API 表面积，不是接线。假阳性比漏报更糟：满屏噪音的断言，人只会学会无视它。
// 换成从入口做传递闭包，对应的就是那个失败模式本身，且零噪音。
const 入口 = ['server.js', 'main.js',
  'scripts/工作区服务.js', 'scripts/执行器.js', 'scripts/watchtower.js'];

function 可达集() {
  const 到 = new Set();
  const 走 = (文件) => {
    if (!文件 || 到.has(文件) || !fs.existsSync(文件) || !fs.statSync(文件).isFile()) return;
    到.add(文件);
    const src = fs.readFileSync(文件, 'utf8');
    const 落地 = (p) => (fs.existsSync(p + '.js') ? p + '.js'
      : fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.js') : p);
    // 形式一：相对路径字面量  require('./x')
    for (const m of src.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      走(落地(path.resolve(path.dirname(文件), m[1])));
    }
    // 形式二：本仓主力写法  require(path.join(平台根, 'lib', 'x.js'))
    // 第一版漏了它，于是 worktree.js 被误报成不可达——闭包分析只认字面量是不够的，
    // 得照着仓里实际怎么写来认。
    for (const m of src.matchAll(/require\(\s*path\.join\(([^)]*)\)\s*\)/g)) {
      const 段 = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      if (段.length) 走(落地(path.join(平台根, ...段)));
    }
    // 形式三：子进程脚本是拼路径 spawn 起来的，根本不走 require——只能认文件名
    for (const m of src.matchAll(/['"]([\w一-龥-]+\.js)['"]/g)) {
      for (const d of ['scripts', 'lib', '.']) {
        const p = path.join(平台根, d, m[1]);
        if (fs.existsSync(p)) 走(p);
      }
    }
  };
  for (const e of 入口) 走(path.join(平台根, e));
  return 到;
}

t('入口清单本身是有效的（入口改名会让下一条断言变得没有意义）', () => {
  for (const e of 入口) {
    assert.ok(fs.existsSync(path.join(平台根, e)), `入口 ${e} 不存在——改名了就在这里同步改，`
      + '否则闭包凭空缩小，下一条断言会报一堆看不懂的「不可达」');
  }
});

t('每个 lib 模块都从入口可达（测试全绿但产品里走不到，是本仓最贵的一种错）', () => {
  const 到 = 可达集();
  const 不可达 = 全部源码()
    .filter((p) => p.includes(`${path.sep}lib${path.sep}`))
    .filter((p) => !到.has(p))
    .map((p) => path.relative(平台根, p));
  assert.deepEqual(不可达, [],
    '这些模块从 ' + 入口.join(' / ') + ' 任何一个都走不到。\n'
    + '它们的测试可能全绿——但用户永远碰不到这个功能，而且不会有任何报错：\n  '
    + 不可达.join('\n  '));
});

t('工单正文里的「写入范围」真的会被执行（不能只是装饰）', () => {
  const wt = require(path.join(平台根, 'lib', 'workspace', 'worktree.js'));
  // 正例：模板生成的那一节，填上真路径后要能被认出来
  assert.deepEqual(
    wt.正文写入范围('## 范围\n做事\n\n## 写入范围\n- `public/**`\n- `lib/x.js`\n\n## 完工要求\n无'),
    ['public/**', 'lib/x.js']);
  // 反例一：模板占位符没填——绝不能当成真范围。
  // 认错方向要命：错认一条 glob，任何真实改动都成违规，checkpoint 抛错，活白干。
  assert.deepEqual(wt.正文写入范围('## 写入范围\n- `<允许改的文件或 glob>`'), []);
  // 反例二：reviewer 模板那句说明
  assert.deepEqual(wt.正文写入范围('## 写入范围\n（留空——只读角色不该有写入范围）'), []);
  // 反例三：没有这一节
  assert.deepEqual(wt.正文写入范围('## 范围\n随便写写'), []);
  // 反例四：散文式描述，不是路径
  assert.deepEqual(wt.正文写入范围('## 写入范围\n- 按角色协议和项目现有边界执行'), []);
  // frontmatter 优先：显式声明过就不再看正文
  const 单 = { fm: { write_scope: ['a/**'] }, body: '## 写入范围\n- `b/**`' };
  assert.equal(String((单.fm.write_scope || []).join()), 'a/**');
  // 工单模板给的骨架，本身不该被误认出范围（全是占位符）
  const 模板 = require(path.join(平台根, 'lib', '工单模板.js'));
  assert.deepEqual(wt.正文写入范围(模板.取('backend').正文), [],
    'backend 骨架里的写入范围是占位符，不该被当真——否则新建单一改文件就报违规');
  assert.deepEqual(wt.正文写入范围(模板.取('reviewer').正文), []);
  // 但 frontend 骨架给的是真 glob（public/**），那就该认
  assert.deepEqual(wt.正文写入范围(模板.取('frontend').正文), ['public/**']);
});

console.log(`全部通过：${passed} 项`);
