// rerun-context.test.js — 回炉轮要把上一轮回执带进提示词（2026-08-28 TF-15 案）
//
// 案源：执行会话**结构性读不到回执**——回执在监制台数据根，会话 cwd 是项目仓，跨仓读权限没开
// （正是 TF-1 卡住的那道口子）。它只把回执正文吐出来、由 runner 落盘，所以每一轮都从零重写。
// TF-15 重投轮因此只写了夹具那一处的增量，初检当场判「十一条验收标准已答 0 条」，又多绕一轮。
// 而 buildAuditPrompt 早就会读回执传给核查——执行侧漏了同一件事。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const runner = require('../lib/runner');
const store = require('../lib/core/store');
const { makeRoot, seed, 收尾 } = require('./helper');

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('rerun-context 回炉轮带上一轮回执（TF-15 案）');

const 铺回执 = (root, id, 文) => {
  fs.mkdirSync(path.join(root, '回执'), { recursive: true });
  fs.writeFileSync(path.join(root, '回执', `${id}.md`), 文, 'utf8');
};

t('首轮不带（没有前文可带，别凭空塞一段）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R-1' });
  铺回执(root, 'R-1', '## 自测结果\n上一轮写的\n');   // 文件在，但这单没回过炉
  assert.equal(runner.前轮回执(root, store.find(root, 'R-1')), '');
});

for (const [名, 格] of [['重投', '重投次数'], ['返修', '返修轮'], ['自修', '自修次数']]) {
  t(`${名}轮要带：三种回炉计数任一 > 0 都算`, () => {
    const root = makeRoot();
    seed(root, '在途', { id: 'R-' + 格, [格]: 1 });
    铺回执(root, 'R-' + 格, '## 自测结果\n1. 判据一：过\n');
    const 段 = runner.前轮回执(root, store.find(root, 'R-' + 格));
    assert.match(段, /上一轮回执/, `${名}轮没带上一轮回执`);
    assert.match(段, /判据一：过/, '前文正文要誊进去');
  });
}

t('明写「整份重写不是追加」——不说这句，模型只会补增量（TF-15 实测）', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R-3', 重投次数: 1 });
  铺回执(root, 'R-3', '## 自测结果\n1. 过\n');
  const 段 = runner.前轮回执(root, store.find(root, 'R-3'));
  assert.match(段, /整份重写/, '要点破这是整份重写；TF-15 那一轮正是当成增量写的，判官判「已答 0 条」');
});

t('超长回执要截断，且如实说省了多少——不能悄悄切掉', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R-4', 重投次数: 2 });
  铺回执(root, 'R-4', 'X'.repeat(20000));
  const 段 = runner.前轮回执(root, store.find(root, 'R-4'));
  assert.ok(段.length < 9000, '18KB 的历史回执不许整个灌进提示词，实得 ' + 段.length);
  assert.match(段, /省略 \d+ 字/, '省略要说出来，否则模型以为自己看到的就是全文');
});

// 首版只取头 6000 字。而回执的排布是：执行方正文在**头**，判官最新的结论与修复指引在**尾**
// （质检/核查往后追加）。于是回炉那一轮看得见「自己上次写了什么」，
// 却看不见「判官说哪儿不行、该怎么改」——最该照着改的那段被截掉了。
// TF-15 第六轮实测：质检判不通过并给了逐条修复指引，而下一轮提示词里那段根本不在。
t('超长时头尾都要留——判官的结论在尾巴上，只留头等于把修复指引扔了', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R-8', 自修次数: 1 });
  const 文 = '## 自测结果\n执行方写在开头的内容\n' + 'X'.repeat(20000)
    + '\n## 质检（不通过）\n修复指引：把自测结果换回实证式逐条应答\n【质检结论】不通过\n';
  铺回执(root, 'R-8', 文);
  const 段 = runner.前轮回执(root, store.find(root, 'R-8'));
  assert.match(段, /执行方写在开头的内容/, '头要留——那是它自己上一轮写的');
  assert.match(段, /修复指引：把自测结果换回实证式逐条应答/, '尾更要留——判官说哪儿不行就在这儿');
  assert.match(段, /【质检结论】不通过/, '结论行也在尾巴上');
  assert.match(段, /下面是文件末尾/, '要点破尾巴是从哪儿接上的，否则读起来像一段连续文本');
});

t('回执不存在时不炸也不塞空段', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R-5', 重投次数: 1 });
  assert.equal(runner.前轮回执(root, store.find(root, 'R-5')), '');
});

t('真进提示词：buildPrompt 的产物里能看见前文', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'R-6', 重投次数: 1, 职能: '程序' });
  铺回执(root, 'R-6', '## 自测结果\n1. 缺章拦得住：过\n');
  const p = runner.buildPrompt(root, store.find(root, 'R-6'), { path: 'D:/fixture', name: 'fixture' });
  assert.match(p, /缺章拦得住：过/, '带不进 buildPrompt 等于没带');
  // 反向：首轮的提示词里不该出现这一段
  seed(root, '在途', { id: 'R-7', 职能: '程序' });
  铺回执(root, 'R-7', '## 自测结果\n不该出现\n');
  assert.ok(!runner.buildPrompt(root, store.find(root, 'R-7'), { path: 'D:/fixture', name: 'fixture' }).includes('不该出现'));
});

收尾('rerun-context', passed);
