// retire.test.js — 打包产物留存（2026-08-22 体检 #52/#61）
// 案源：换装只拷不删，dist 与部署目录只进不出。08-21 实测两处共 206 个 exe / 14.2 GB，
// 而 D: 盘只剩 45 GB 且零磁盘余量监控。存量被手工清了、脚本没改 —— 本条判的正是「机制仍缺」。
//
// 这里一条 grep 都没有：全部真造文件、真跑函数、真跑 CLI，看目录里最后剩下什么。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const R = require('../lib/retire');
const { 临时目录, 收尾 } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('产物留存测试');

// 造一目录塞 exe：mtime 按传入顺序**递增**（越靠后越新）
const 造产物 = (版本s, 杂物 = []) => {
  const d = 临时目录('retire-');
  版本s.forEach((v, i) => {
    const p = path.join(d, `监制台 ${v}.exe`);
    fs.writeFileSync(p, 'x'.repeat(16), 'utf8');
    const ts = new Date(1.7e12 + i * 60000);
    fs.utimesSync(p, ts, ts);
  });
  for (const f of 杂物) fs.writeFileSync(path.join(d, f), 'y', 'utf8');
  return d;
};

t('按 mtime 排不按文件名：0.17.10 是最新的一版，字典序会把它当最老的剪掉', () => {
  // 这个样本刻意让**字典序与时间序结论相反**：
  //   时间序（真）：0.17.10 最新 > 0.17.2 > 0.17.9 最老  →  留 2 份该删 0.17.9
  //   字典序（错）："0.17.9" > "0.17.2" > "0.17.10"       →  留 2 份会删掉最新的 0.17.10
  // dist 里 0.17.1 与 0.17.10 真的同时躺过，这不是假想的边界。
  const 件 = [
    { 名: '监制台 0.17.9.exe', mtime: 1000 },
    { 名: '监制台 0.17.2.exe', mtime: 2000 },
    { 名: '监制台 0.17.10.exe', mtime: 3000 },
  ];
  assert.deepEqual(R.该删(件, 2, []), ['监制台 0.17.9.exe'],
    '该删的是 mtime 最小的 0.17.9——按文件名排会反过来删掉最新的 0.17.10');
  assert.deepEqual(R.该删(件, 1, []), ['监制台 0.17.2.exe', '监制台 0.17.9.exe'],
    '只留 1 份就该留 mtime 最大的 0.17.10');
  // 顺序也要对：删名单按「越旧越靠后」给，日志读起来才不会误导
  assert.equal(R.该删(件, 0, [])[0], '监制台 0.17.10.exe');
});

t('保留 N：十件留三件，留下的必须是最新三件', () => {
  const 件 = Array.from({ length: 10 }, (_, i) => ({ 名: `监制台 0.2${i}.0.exe`, mtime: 1000 + i }));
  const 删 = R.该删(件, 3, []);
  assert.equal(删.length, 7, '十件留三件该删七件，实际 ' + 删.length);
  for (const 新 of ['监制台 0.29.0.exe', '监制台 0.28.0.exe', '监制台 0.27.0.exe']) {
    assert.ok(!删.includes(新), 新 + ' 是最新三件之一，不许进删名单');
  }
});

t('必保集：即使最老也不许删，且不占保留额度（vbs 钉在旧版被删＝开机静默起不来）', () => {
  const 件 = [
    { 名: '监制台 0.20.0.exe', mtime: 1 },      // 最老，但 vbs 指着它
    { 名: '监制台 0.26.0.exe', mtime: 2 },
    { 名: '监制台 0.27.0.exe', mtime: 3 },
    { 名: '监制台 0.27.3.exe', mtime: 4 },
  ];
  const 删 = R.该删(件, 2, ['监制台 0.20.0.exe']);
  assert.ok(!删.includes('监制台 0.20.0.exe'), '必保那份落进删名单＝把开机脚本指着的那份删了');
  assert.deepEqual(删, ['监制台 0.26.0.exe'], '必保不占额度：最新两件照留，只剩 0.26.0 该删');
  // 裸版本号也要认（换装脚本传的是 $Version，不是文件名）
  assert.deepEqual(R.该删(件, 2, ['0.20.0']), ['监制台 0.26.0.exe'], '裸版本号写法要等价');
});

t('非监制台文件一个字节都不碰', () => {
  const d = 造产物(['0.1.0', '0.2.0', '0.3.0'], ['别的工具 1.0.exe', '启动监制台.vbs', '读我.txt']);
  R.剪(d, { 保留: 1 });
  const 剩 = fs.readdirSync(d).sort();
  assert.ok(剩.includes('别的工具 1.0.exe'), '同目录别人的 exe 不许剪');
  assert.ok(剩.includes('启动监制台.vbs') && 剩.includes('读我.txt'), '非 exe 更不许碰');
  assert.deepEqual(剩.filter((f) => f.startsWith('监制台 ')), ['监制台 0.3.0.exe'], '监制台件只留最新一份');
});

t('剪：真删文件，目录里最后剩下的就是留存策略的答案', () => {
  // 写入顺序 = mtime 递增顺序。最后三个（0.9.1 / 0.17.2 / 0.17.10）是**时间上**最新的三版，
  // 而它们的文件名字典序恰好排在 0.26/0.27 之后位——按文件名剪会留下 0.27.x、删掉真正的新版。
  const d = 造产物(['0.26.16', '0.26.17', '0.27.0', '0.27.3', '0.9.1', '0.17.2', '0.17.10']);
  const r = R.剪(d, { 保留: 3, 必保: '0.26.16' });
  const 留 = fs.readdirSync(d).sort();
  assert.deepEqual(留, ['监制台 0.26.16.exe', '监制台 0.9.1.exe', '监制台 0.17.2.exe', '监制台 0.17.10.exe'].sort(),
    '最近 3 版（按 mtime）+ 必保那版，其余全删；实测剩下：' + 留.join('、'));
  assert.ok(!r.删.includes('监制台 0.26.16.exe'), '必保版本不许出现在删名单里');
  assert.ok(!fs.existsSync(path.join(d, '监制台 0.27.3.exe')),
    '0.27.3 文件名最大但 mtime 最老之一，该删——按文件名排会把它当最新的留下');
  assert.equal(r.失手.length, 0);
});

t('目录不存在不抛：换装脚本里一抛就中断，而此时新版已在跑', () => {
  const r = R.剪(path.join(临时目录('retire-none-'), '根本没有这个子目录'), { 保留: 3 });
  assert.deepEqual(r.删, []);
  assert.match(r.因, /目录不存在/);
});

t('保留 0 也不许把必保那份剪掉（边界：只想留在役那一版）', () => {
  const d = 造产物(['0.1.0', '0.2.0']);
  R.剪(d, { 保留: 0, 必保: '0.1.0' });
  assert.deepEqual(fs.readdirSync(d), ['监制台 0.1.0.exe'], '保留 0 + 必保 → 只剩必保那份');
});

t('CLI 真跑一遍：换装.ps1 调的就是这条命令行，参数拼错在这里就红', () => {
  const d = 造产物(['0.20.0', '0.21.0', '0.22.0', '0.23.0', '0.24.0', '0.25.0', '0.26.0', '0.27.3']);
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '..', 'lib', 'retire.js'), '--剪', d, '--保留', '3', '--必保', '0.20.0'],
    { encoding: 'utf8', timeout: 30000, windowsHide: true });
  const 剩 = fs.readdirSync(d).sort();
  assert.deepEqual(剩, ['监制台 0.20.0.exe', '监制台 0.25.0.exe', '监制台 0.26.0.exe', '监制台 0.27.3.exe'].sort(),
    'CLI 走完后目录应只剩最新三件 + 必保那件；实测：' + 剩.join('、'));
  assert.match(out, /留 4 删 4/, 'CLI 要如实报数（换装日志里就靠这一行看清了几个）：' + out.trim());
});

t('换装脚本真的调了它，且调在验活之后（剪在验活之前＝毁掉回滚件）', () => {
  // 这一格盯的是**顺序**，PowerShell 在本项目里没有测试位，只能读脚本判位置；
  // 策略本身的行为由上面七格真跑文件覆盖，这里不承担逻辑判据。
  const ps = fs.readFileSync(path.join(__dirname, '..', '换装.ps1'), 'utf8');
  const 验 = ps.indexOf('换装未生效');
  const 剪 = ps.indexOf('retire.js');
  const 拷 = ps.indexOf('Copy-Item');
  assert.ok(剪 > 0, '换装脚本没调留存逻辑＝写了也白写（本条 08-22 前正是这个状态）');
  assert.ok(验 > 0 && 剪 > 验, '剪必须在验活之后——新版还没证明能起来就先删旧版，等于毁掉回滚件');
  assert.ok(拷 > 0 && 剪 > 拷, '剪也必须在拷贝之后');
  assert.match(ps, /--必保 \$Version/, '在役版本必须进必保集，否则可能把刚换上的那版剪掉');
});

收尾('产物留存', passed);
