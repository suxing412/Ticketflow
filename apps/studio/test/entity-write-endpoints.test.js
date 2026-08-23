// entity-write-endpoints.test.js — 管线开线 / 特性审核两条写口的端点实跑（2026-08-22 体检 #14/#59）
//
// 为什么单立一套：这两条体检项判的是「注册表（lib/gatereg.js）承诺了动作，界面上却点不到」。
// 界面那半是前端的活；**服务端这半必须先自证在位且真能用**——否则前端补了按钮，一点就 404/403，
// 等于把一条死路画成活路。而在此之前，全仓没有任何一条判据打过这两条写口：
//   `grep -rl "api/pipelines" test/` 只命中 tf-layer.test.js 的**假 fetch 桩**（喂死数据，不起服务），
//   `api/features` 只有 gatereg.test.js 打过 GET。POST 面零覆盖。
// 全部真起服务、真打端点、真回读盘上的实体，一条源码文本判据不留。
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeRoot, seed, 收尾 } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('实体写口端点测试（#14 开线 / #59 特性审核）');

const 起 = (root, port, 打法) => {
  const code = `
    require(${JSON.stringify(path.join(__dirname, '..', 'server.js').replace(/\\/g, '/'))}).start().then(async ({ server: srv }) => {
      const B = 'http://127.0.0.1:${port}';
      const G = async (u) => { const r = await fetch(B + u); let j = null; try { j = await r.json(); } catch { j = {}; } return [r.status, j]; };
      const P = async (u, body) => { const r = await fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { j = {}; } return [r.status, j]; };
      const out = ${打法};
      process.stdout.write('@@' + JSON.stringify(out) + '@@');
      srv.close();
    }).catch((e) => { process.stdout.write('@@' + JSON.stringify({ 起服务失败: String(e.message) }) + '@@'); process.exit(1); });`;
  const raw = execFileSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, STUDIO_ROOT: root, STUDIO_PORT: String(port), STUDIO_STUB: '1' },
  });
  const o = JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
  if (o && o.起服务失败) throw new Error('起服务失败：' + o.起服务失败);
  return o;
};

t('#14 开线：POST /api/pipelines 真开得出一条线，封存/复线来回走得通', () => {
  const root = makeRoot();
  const o = 起(root, 4961, `{
    开: await P('/api/pipelines', { 名称: '河道系统', 阶段: '原型' }),
    列: await G('/api/pipelines'),
    封: await P('/api/pipelines/status', { id: 'P-1', 状态: '封存' }),
    复: await P('/api/pipelines/status', { id: 'P-1', 状态: '活跃' }),
    空名: await P('/api/pipelines', { 名称: '  ' }),
    乱态: await P('/api/pipelines/status', { id: 'P-1', 状态: '完工' }),
  }`);
  assert.equal(o.开[0], 200, 'POST /api/pipelines 必须真能开出一条线——注册表 G9 承诺的就是这个动作');
  assert.match(String(o.开[1].id), /^P-\d+$/);
  assert.equal(o.开[1].fm.状态, '活跃', '新线缺省活跃');
  assert.equal(o.开[1].fm.阶段, '原型', '阶段要照传的收，不能吞成 L0');
  assert.deepEqual(o.列[1].管线.map((p) => [p.id, p.名称]), [['P-1', '河道系统']], '开完立刻读得回来');
  assert.equal(o.封[0], 200); assert.equal(o.封[1].fm.状态, '封存');
  assert.equal(o.复[0], 200); assert.equal(o.复[1].fm.状态, '活跃', '封存不是终点，复线要回得来');
  assert.equal(o.空名[0], 400, '空名整条拒，不许开出一条没名字的线');
  assert.equal(o.乱态[0], 400, '状态只有 活跃/封存 两个（lib/pipelines.js STATUSES）');
  // 真落盘（不是只在返回体里说说）
  assert.ok(fs.existsSync(path.join(root, '管线', 'P-1.md')), '管线要真写在 管线/ 目录里');
});

t('#59 特性审核：POST /api/features/审核 真把待审推成活跃；退回即就地封存留痕', () => {
  const root = makeRoot();
  const o = 起(root, 4962, `{
    线: await P('/api/pipelines', { 名称: '地图系统' }),
    提: await P('/api/features/提请', { 名称: '水体', 管线: 'P-1', 边界: '管水面与流向，不管地形高程', 挂载: { 工单: ['TK-1'] } }),
    提2: await P('/api/features/提请', { 名称: '天气', 管线: 'P-1', 边界: '管晴雨风雪，不管光照', 挂载: { 工单: ['TK-2'] } }),
    列待审: await G('/api/features'),
    过: await P('/api/features/审核', { id: 'F-1', 通过: true }),
    退: await P('/api/features/审核', { id: 'F-2', 通过: false, 说明: '预规划' }),
    再审: await P('/api/features/审核', { id: 'F-1', 通过: true }),
    乱动作: await P('/api/features/开除', { id: 'F-1' }),
  }`);
  assert.equal(o.提[0], 200, '提请（项管的动作）在位');
  assert.equal(o.提[1].fm.状态, '待审', '提请落「待审」态——章程「开特性权」：项管提请，总监审核');
  assert.equal(o.列待审[1].特性.filter((f) => f.状态 === '待审').length, 2, '两条都躺在待审');

  assert.equal(o.过[0], 200, 'POST /api/features/审核 必须真能审——#59 判的正是「待审态无动作出口」');
  assert.equal(o.过[1].fm.状态, '活跃', '审过即活跃');
  assert.equal(o.过[1].fm.审核人, '总监', '审核人缺省写死总监（server.js FT_ACTIONS.审核）——这一格决定了按钮该摆在谁的界面上');
  assert.equal(o.退[0], 200);
  assert.equal(o.退[1].fm.状态, '封存', '退回＝就地封存留痕，不删');
  assert.equal(o.再审[0], 400, '已审的不能再审（只有待审态可审核）');
  assert.equal(o.乱动作[0], 404, '未知动作要 404，别让打错字的调用悄悄成功');
  // 真落盘
  const 盘 = fs.readFileSync(path.join(root, '特性', 'F-1.md'), 'utf8');
  assert.match(盘, /状态: 活跃/, '审核结果要真写进 特性/F-1.md');
});

t('H108 放行写口=项管闸：操作者非 项管/总监 一律 400；项管放行 fm.放行=true 真上盘；重复放行拒', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'TK-9' });
  seed(root, '在途', { id: 'TK-10', 主办: '策划' });
  const o = 起(root, 4963, `{
    无人: await P('/api/act/放行', { id: 'TK-9' }),
    制作人: await P('/api/act/放行', { id: 'TK-9', 操作者: '制作人' }),
    项管: await P('/api/act/放行', { id: 'TK-9', 操作者: '项管' }),
    重复: await P('/api/act/放行', { id: 'TK-9', 操作者: '总监' }),
    错态: await P('/api/act/放行', { id: 'TK-10', 操作者: '项管' }),
  }`);
  assert.equal(o.无人[0], 400, '不带操作者必须拒——放行是项管闸不是无主按钮');
  assert.equal(o.制作人[0], 400, '制作人不在放行操作域（需求走 /api/pm/draft 委托）：' + JSON.stringify(o.制作人[1]));
  assert.equal(o.项管[0], 200, '项管放行必须走通：' + JSON.stringify(o.项管[1]));
  assert.equal(o.重复[0], 400, '已放行的单不许重复放行（life.放行 拒）：' + JSON.stringify(o.重复[1]));
  assert.equal(o.错态[0], 400, '非待派单不可放行：' + JSON.stringify(o.错态[1]));
  // 真上盘：放行是 fm 标记不是目录跳变——单还住 待派，frontmatter 里旗已竖
  const 盘 = fs.readFileSync(path.join(root, '待派', 'TK-9.md'), 'utf8');
  assert.match(盘, /放行: true/, '放行旗要真写进 待派/TK-9.md 的 frontmatter');
  assert.ok(!fs.existsSync(path.join(root, '池', 'TK-9.md')), '放行不再是目录跳变（池已并入待派）');
});

收尾('', passed);
