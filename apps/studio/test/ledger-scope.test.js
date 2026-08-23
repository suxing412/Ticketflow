// ledger-scope.test.js — 自动记账的范围与安全闸（2026-08-21 体检）
// 案源：DIRS 白名单漏掉一半活数据目录——专项/特性/排程台账/项管台账/呼叫/瞭望塔/遥控 全不在册。
// 昨日新建的「特性」与「待办队列」两类实体全落在这些目录，**建了就不记账**。
// 而 ledger.js 头注记的正是这个教训（36 个文件躺工作区数日）：教训记了，名单没跟着长。
//
// **枚举必漏**：它要求每加一类实体就有人记得回来改那一行。改排除法之后，
// 漏一条排除项的后果是「多记一个文件」（看得见、可补）；漏一条白名单的后果是
// 「那类改动永远不入库」（看不见、只能靠事故发现）。两者不对称。
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../lib/ledger');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
const ta = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('记账范围测试');

const 造仓 = (条目) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-'));
  execFileSync('git', ['-C', d, 'init', '-q'], { windowsHide: true });
  fs.writeFileSync(path.join(d, '.gitignore'), ['凭据.json', '*.exe'].join(String.fromCharCode(10)), 'utf8');
  for (const [名, 是目录] of 条目) {
    if (是目录) fs.mkdirSync(path.join(d, 名), { recursive: true });
    else fs.writeFileSync(path.join(d, 名), 'x', 'utf8');
  }
  return d;
};

t('默认全收：新加的实体目录不用改代码就自动进范围', () => {
  const d = 造仓([['专项', 1], ['特性', 1], ['排程台账', 1], ['瞭望塔', 1], ['遥控', 1], ['将来才有的新实体', 1]]);
  const t2 = L.记账目标(d);
  for (const n of ['专项', '特性', '排程台账', '瞭望塔', '遥控', '将来才有的新实体']) {
    assert.ok(t2.includes(n), `${n} 该在范围里——枚举白名单正是漏在这里`);
  }
});

t('排除项：产物/依赖/运行态/点开头 一律不收', () => {
  const d = 造仓([['_app', 1], ['node_modules', 1], ['.git', 1], ['.studio-state.json', 0],
    ['监制台 0.27.2.exe', 0], ['x.tmp', 0], ['y.bak', 0], ['正常目录', 1]]);
  const t2 = L.记账目标(d);
  for (const n of ['_app', 'node_modules', '.git', '.studio-state.json', '监制台 0.27.2.exe', 'x.tmp', 'y.bak']) {
    assert.ok(!t2.includes(n), `${n} 不该进范围`);
  }
  assert.ok(t2.includes('正常目录'));
});

t('**密钥类硬排除**：凭据.json / 兼容池配置 绝不进范围', () => {
  // git add <显式路径> 会绕过 .gitignore，而排除法按「默认全收」工作——
  // 两者相遇，一次疏忽就能把密钥推进仓库。2026-08-21 刚把远程令牌搬进 凭据.json。
  const d = 造仓([['凭据.json', 0], ['兼容池配置', 1]]);
  const t2 = L.记账目标(d);
  assert.ok(!t2.includes('凭据.json'), '凭据档不许进范围');
  assert.ok(!t2.includes('兼容池配置'), '池密钥目录不许进范围');
});

t('安全闸正反两向：正常目标零越界，喂被 ignore 的能拦住', () => {
  const d = 造仓([['正常', 1], ['凭据.json', 0]]);
  assert.deepEqual(L.越界目标(d, ['正常']), [], '正常目标不该报越界');
  const 越 = L.越界目标(d, ['凭据.json']);
  assert.equal(越.length, 1, '被 .gitignore 排掉的必须检出——检不出这闸就是摆设');
});

t('接线判据：commitStudio 在 add 之前真的过了这道闸', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ledger.js'), 'utf8');
  const 体 = src.slice(src.indexOf('function commitStudio'));
  const i越 = 体.indexOf('越界目标(repo, targets)');
  const iadd = 体.indexOf("g(['add'");
  assert.ok(i越 >= 0 && iadd >= 0, '两处都要在');
  assert.ok(i越 < iadd, '安全闸必须在 add 之前——放后面等于事后追悔');
  assert.match(体, /已中止/, '越界要中止整次记账，不是跳过那一条');
});

t('失败带原因（不带原因就只能靠人去复现）', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ledger.js'), 'utf8');
  assert.match(src, /commit 失败：' \+ String\(\(se \|\| e4\.message\)/, 'commit 失败要把 git 的 stderr 带出来');
});

/* ──────────────────────────────────────────────────────────────────────────
   2026-08-22 体检 #76：运行态/密钥类文件入库。
   `.studio-state.json` 是进程每动一次就变一次的运行态，被 git 跟踪 = 工作区永远脏、
   记账每一拍都在提交噪声。既有判据只断言「它不进 记账目标()」——那只管住了本模块这一条路，
   管不住「谁手工 git add 过一次，从此它就一直被跟踪」。下面两格补这半边。
   ────────────────────────────────────────────────────────────────────────── */

t('真跑一遍 git add：运行态与密钥文件一个都不许进暂存区（不是看名单，是看 git 自己怎么说）', () => {
  const d = 造仓([['专项', 1], ['凭据.json', 0], ['.studio-state.json', 0], ['兼容池配置', 1]]);
  fs.writeFileSync(path.join(d, '专项', 'a.md'), '正常内容', 'utf8');
  fs.writeFileSync(path.join(d, '兼容池配置', 'k.json'), '{"key":"sk-真密钥"}', 'utf8');
  const 目标 = L.记账目标(d);
  // 真跑 git add（这正是 commitStudio 干的事），再问 git 暂存了什么
  execFileSync('git', ['-C', d, 'add', '--', ...目标], { windowsHide: true });
  const 暂存 = execFileSync('git', ['-c', 'core.quotepath=false', '-C', d, 'diff', '--cached', '--name-only'],
    { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).filter(Boolean);
  assert.ok(暂存.includes('专项/a.md'), '正常内容要进得去，否则这一格什么也没证明：' + 暂存.join('、'));
  for (const 禁 of ['凭据.json', '.studio-state.json', '兼容池配置/k.json']) {
    assert.ok(!暂存.some((f) => f === 禁), `${禁} 进了暂存区——git add <显式路径> 会绕过 .gitignore。实测暂存：` + 暂存.join('、'));
  }
});

t('本仓自己没把运行态/密钥跟踪进去（#76 的另一半：名单管不住已经被 add 过的文件）', () => {
  // 案源：AI-GameStudio 那边 `监制台/.studio-state.json` 至今仍被跟踪——
  // 名单排得再干净，只要有人手工 add 过一次，它就一直脏下去。
  // 这一格问的是 git 的真实状态，不是源码里的排除名单。
  let 跟踪 = null;
  try {
    跟踪 = execFileSync('git', ['-c', 'core.quotepath=false', '-C', path.join(__dirname, '..'), 'ls-files'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean);
  } catch { return; } // 打包产物/非 git 环境里跳过，不算失败
  const 犯 = 跟踪.filter((f) => /(^|\/)\.studio-state\.(json|lock)$|(^|\/)凭据\.json$|(^|\/)兼容池配置\//.test(f));
  assert.deepEqual(犯, [], '这些文件不许被本仓跟踪（运行态每动一次就是一次版本噪声，密钥更不该在库里）：' + 犯.join('、'));
});

/* ──────────────────────────────────────────────────────────────────────────
   2026-08-22 体检 #50 后半格：**四条失败分支全静默**。
   前半格（排除法的范围）上面已有真判据；失败面此前一条都没有——回调写在 server.js 的
   匿名闭包里，除了 grep 源码文本没有第二种验法，而 grep 既漏真病又误伤重构。
   现在回调是 lib/ledger.js 的具名工厂，下面两格**真调它、真跑一次 commitStudio**。
   ────────────────────────────────────────────────────────────────────────── */

t('四条失败分支一条都不许静默；「无变更」与成功不进 journal', () => {
  const 写 = [];
  const cb = L.记账回调('/不存在的根', { journal: { append: (r, s) => 写.push(s) }, log: () => {} });
  for (const n of ['不在 git 仓库内', '无可记账目录', 'add 失败', 'commit 失败：hook rejected']) cb(false, n);
  assert.equal(写.length, 4, '四条失败全要留痕——原样 `if (ok)` 让记账停摆一周也没有任何痕迹；实际留痕 ' + 写.length);
  assert.ok(写.every((s) => s.startsWith('自动记账未成：')), '留痕要认得出是记账的：' + JSON.stringify(写));
  assert.ok(写.some((s) => s.includes('hook rejected')), '原因要带出来，不是只写一句「失败」');
  const 屏 = [];
  const cb2 = L.记账回调('/不存在的根', { journal: { append: (r, s) => 写.push(s) }, log: (s) => 屏.push(s) });
  cb2(false, '无变更'); cb2(true, '已记账');
  assert.equal(写.length, 4, '「无变更」是常态不是失败——刷进 journal 会把真失败埋掉');
  assert.deepEqual(屏, ['自动记账：已记账'], '成功照旧打屏');
});

t('生产那一份回调（server.js 真正跑的那个）也得过同一套断言', () => {
  // **判据不许测抄本**。记账回调此刻在两处：lib/ledger.js 的具名工厂（本套件直接调的那个），
  // 与 server.js 里那段内联匿名闭包（生产真正跑的那个）。二者内容一致，但一致不是自动的——
  // 只测工厂等于测了一份抄本，server.js 那份改坏了这里一格都不会红。
  // 故：**把 server.js 里那段原文抽出来当函数跑一遍**，喂同样的四条失败。
  // server.js 不在本次改动范围内（属另一组），等它换成 ledger.记账回调(ROOT) 之后
  // 这一格自动走上面那条分支——两种形态都能过，不会因为换法而假红。
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  if (src.includes('ledger.记账回调(ROOT)')) {
    assert.ok(!/const 记 = \(\) => ledger\.commitStudio\(ROOT, \(ok, note\) => \{/.test(src),
      'server.js 已改调 记账回调()，就不该再留一份内联实现');
    return; // 生产跑的就是上面几格测过的那个工厂，无需再抽
  }
  const 锚 = 'const 记 = () => ledger.commitStudio(ROOT, ';
  const i = src.indexOf(锚);
  assert.ok(i > 0, 'server.js 里找不到记账回调的接线点——判据与被测对象已脱钩，先修判据再说别的');
  // 从 (ok, note) => { 起做括号配对，取到闭合的 }
  const 起 = src.indexOf('(ok, note)', i);
  const 体起 = src.indexOf('{', 起);
  let 深 = 0; let 体止 = -1;
  for (let k = 体起; k < src.length; k += 1) {
    if (src[k] === '{') 深 += 1;
    else if (src[k] === '}') { 深 -= 1; if (深 === 0) { 体止 = k; break; } }
  }
  assert.ok(体止 > 体起, '括号配对失败，抽不出回调体');
  const 体 = src.slice(体起 + 1, 体止);
  // eslint-disable-next-line no-new-func
  const 生产回调 = new Function('journal', 'console', 'ROOT', `return (ok, note) => {${体}};`);

  const 写 = []; const 屏 = [];
  const cb = 生产回调({ append: (r, s) => 写.push(s) }, { log: (s) => 屏.push(s) }, '/假根');
  for (const n of ['不在 git 仓库内', '无可记账目录', 'add 失败', 'commit 失败：hook rejected']) cb(false, n);
  assert.equal(写.length, 4, 'server.js 里那份回调把失败吞了 ' + (4 - 写.length) + ' 条——四条失败分支全静默正是本条案由');
  assert.ok(写.every((s) => s.startsWith('自动记账未成：')), '留痕要认得出是记账的：' + JSON.stringify(写));
  cb(false, '无变更'); cb(true, '已记账');
  assert.equal(写.length, 4, '「无变更」与成功不许进 journal（常态刷屏会把真失败埋掉）');
  assert.deepEqual(屏, ['自动记账：已记账'], '成功照旧打屏，实测：' + JSON.stringify(屏));
});

t('journal 写不进也不许把这一拍炸掉（留痕失败不阻塞下一拍）', () => {
  const cb = L.记账回调('/不存在的根', { journal: { append: () => { throw new Error('磁盘满'); } }, log: () => {} });
  assert.doesNotThrow(() => cb(false, 'add 失败'), '留痕失败会顺着 setInterval 抛出去，把整条记账拍打死');
});

// 异步那一格单独走：本文件的 t() 是同步的，塞一个返回 Promise 的用例进去
// 会让断言在「全部通过」打印之后才炸（跑测试.js 靠退出码判红，但人看到的顺序是反的）。
const 异步用例 = async () => {
  await ta('端到端：commit 真被钩子拒掉 → 回调收到带原因的失败并留痕（不是模拟，是真跑 git）', async () => {
    // 这一格把「commitStudio 的 done(false, ...) 分支」与「记账回调」接在一起真跑一遍：
    // 造一个真 git 仓 → 塞一个必然拒绝的 pre-commit 钩子 → commit 必失败 →
    // 回调必须在 journal 留下一条带 git stderr 的痕。四条失败分支里最难到达的就是这一条。
    const d = 造仓([['专项', 1]]);
    fs.writeFileSync(path.join(d, '专项', 'a.md'), '内容', 'utf8');
    const hooks = path.join(d, '.git', 'hooks');
    fs.mkdirSync(hooks, { recursive: true });
    fs.writeFileSync(path.join(hooks, 'pre-commit'),
      ['#!/bin/sh', 'echo "本仓禁止提交（判据用钩子）" 1>&2', 'exit 1'].join(String.fromCharCode(10)), { encoding: 'utf8', mode: 0o755 });
    execFileSync('git', ['-C', d, 'config', 'user.email', 'x@y.z'], { windowsHide: true });
    execFileSync('git', ['-C', d, 'config', 'user.name', '判据'], { windowsHide: true });

    const 写 = [];
    const cb = L.记账回调(d, { journal: { append: (r, s) => 写.push(s) }, log: () => {} });
    const [ok, note] = await new Promise((res) => L.commitStudio(d, (o, n) => { cb(o, n); res([o, n]); }));
    assert.equal(ok, false, 'pre-commit 拒了，commitStudio 不该报成功：' + note);
    assert.match(note, /commit 失败/, '要指名道姓是 commit 那一步失败：' + note);
    assert.equal(写.length, 1, '真失败必须留痕，实际 ' + 写.length + ' 条');
    assert.match(写[0], /^自动记账未成：commit 失败/, '留痕内容：' + 写[0]);
  });
};

异步用例().then(() => { console.log('全部通过：' + passed + ' 项'); },
  (e) => { console.error('  ✗ ' + e.message); process.exitCode = 1; });
