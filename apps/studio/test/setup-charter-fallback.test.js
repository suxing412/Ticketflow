// setup-charter-fallback.test.js — 打包兜底面的通用章程要说得出制度名（2026-08-22 体检 #19②）
//
// 病灶：exe 里**没有** packages/role-protocol-templates（模板只存在于源码布局），所以首次运行
// 向导给 agent 铺的那份 岗位协议/通用.md 走的是 lib/setup.js 的内置兜底。而那份兜底原文只说
// 「工单由监制台派到你手上」——既不提拉取制（故 propcheck 不打红），也不点派发制。
// 于是制度名在**唯一会被真正读到的那一面**是哑的：真机上开工的 agent 读到的就是这一份。
//
// 判据不看源码文本、也不看导出的字符串常量，而是**真跑一遍向导的落盘**：
// 在子进程里把 role-protocol-templates 屏蔽掉（模拟打包态），调 建工作区()，
// 再把它真写到盘上的 岗位协议/通用.md 读回来看。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { 临时目录, 收尾 } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('打包兜底章程测试（#19②）');

const SETUP = path.join(__dirname, '..', 'lib', 'setup.js').replace(/\\/g, '/');

// 打包态跑一次向导：statSync 对 role-protocol-templates 一律 ENOENT ⇒ 模板目录() 返 null ⇒ 走内置。
function 打包态建工作区(目标) {
  const code = `
    const fs = require('fs');
    const 真 = fs.statSync;
    fs.statSync = (p, ...a) => {
      if (String(p).indexOf('role-protocol-templates') >= 0) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return 真(p, ...a);
    };
    const setup = require(${JSON.stringify(SETUP)});
    const out = { 模板目录: setup.模板目录(), 结果: setup.建工作区(${JSON.stringify(目标)}) };
    process.stdout.write('@@' + JSON.stringify(out) + '@@');`;
  const raw = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 30000 });
  return JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
}

t('打包态（拷不到套件模板）铺出来的 通用.md 里说得出「派发制」和它的语义', () => {
  const 目标 = path.join(临时目录('studio-setup-'), '工作区');
  const o = 打包态建工作区(目标);

  // 前置：确认这一跑**确实**走的是内置兜底，否则测的是套件模板那一面（那面本来就是对的）
  assert.strictEqual(o.模板目录, null, '模板没被屏蔽掉，本条测的不是兜底面：' + JSON.stringify(o.模板目录));
  assert.ok(o.结果 && o.结果.ok, '向导没建成：' + JSON.stringify(o.结果));
  assert.ok((o.结果.落章程 || []).includes('通用'), '通用章程没落盘：' + JSON.stringify(o.结果.落章程));

  const 通用 = fs.readFileSync(path.join(目标, '岗位协议', '通用.md'), 'utf8');
  assert.ok(通用.includes('派发制'),
    'exe 真机上 agent 读到的那份通用章程里没有「派发制」三个字——制度名在这一面是哑的。实测首段：'
    + JSON.stringify(通用.split(String.fromCharCode(10)).slice(0, 4)));
  assert.ok(通用.includes('一人一单一生命周期'),
    '光有制度名不够，得说清它是什么（措辞与 packages/role-protocol-templates/通用.md:3 对齐）。实测：'
    + JSON.stringify(通用.split(String.fromCharCode(10)).slice(0, 4)));
  assert.ok(!通用.includes('拉取制'), '兜底面不许还留着已退役的拉取制（H49 已立宪派发制）');

  // 反向：别为了塞制度名把这份章程的正事弄丢了
  for (const 句 of ['一单一事', '完工报告格式', '不碰 git 历史']) {
    assert.ok(通用.includes(句), `兜底章程该有的「${句}」不许跟着一起没了`);
  }
});

t('六份章程一份不少（改文案不许顺手把铺盘那条路改窄）', () => {
  const 目标 = path.join(临时目录('studio-setup-'), '工作区');
  const o = 打包态建工作区(目标);
  const 应有 = Object.keys(require('../lib/setup').内置章程);
  assert.deepEqual([...(o.结果.落章程 || [])].sort(), [...应有].sort(), '落盘份数与内置册数对不上');
  for (const 名 of 应有) {
    const p = path.join(目标, '岗位协议', `${名}.md`);
    assert.ok(fs.existsSync(p) && fs.readFileSync(p, 'utf8').trim(), `${名}.md 没写出来或是空的`);
  }
});

收尾('', passed);
