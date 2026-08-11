// budget-接线.test.js — 预算闸的**消费方接线**测试（协-003 本体归位后拆出）
//
// 分工：`packages/budget/test.js` 证明本包自己的输出形状（零 app 依赖，那是入包条件）；
// 本文件证明 **studio 这边接得住**——冻结结构能直接喂进 dispatch，且池序真的会绕开超预算的池。
//
// 这两条原先住在 apps/studio/test/budget.test.js 里。本体迁 packages/budget 时，
// 纯契约那 12 条跟着包走，这 2 条留下——它们测的是 studio 的接线，不是包的契约。
// 其中「不改签名即生效」那条的断言一字未改，包括那句 “这一条不过，本单等于没做”。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// 公用件走仓根 packages/（一仓拓扑）：apps/studio/test → 上三级到仓根
const B = require('../../../packages/budget/budget.js');
const D = require('../lib/pm/dispatch');
const R = require('../lib/budget-resolve');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('budget 消费方接线测试（studio 侧）');

const 新根 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'budget-wire-'));
const 今 = '2026-08-08T10:00:00.000Z';

t('冻结结构可直接喂 poolFrozen：不改签名即生效', () => {
  const root = 新根();
  const cfg = { 预算: { 池: { 'claude-key': { 日token: 10 } } }, 执行池: { 'claude-key': {} } };
  B.记(root, { 池: 'claude-key', 输入: 20, 输出: 0, t: 今 });
  const gi = B.并入({}, B.冻结池(cfg, root, 今));
  assert.equal(D.poolFrozen(cfg, gi, 'claude-key'), true, '这一条不过，本单等于没做');
});

t('实测证据：超预算的 key 池会被池序绕开（降级链路端到端）', () => {
  const root = 新根();
  const cfg = {
    执行池: { claude: { 计费: '订阅' }, 'claude-key': { 计费: '按量' }, codex: { 计费: '订阅' } },
    编制: [{ 职能: '程序', 池序: [{ 池: 'claude' }, { 池: 'claude-key' }, { 池: 'codex' }] }],
    预算: { 池: { 'claude-key': { 日token: 10 } } },
  };
  const ready = [{ id: 'T-1', 职能: '程序', 优先级: 'P1', 创建时间: '2026-08-08' }];
  // 套餐冻结 + key 池未超 → 落 key 池
  let gi = B.并入({ claude: { locked: true } }, B.冻结池(cfg, root, 今));
  assert.equal(D.pickNext(cfg, ready, {}, gi, { 'claude-key': 1, codex: 1 })[0].池, 'claude-key');
  // key 池烧超预算后 → 继续顺位到 codex，不再落 key 池
  B.记(root, { 池: 'claude-key', 输入: 99, 输出: 0, t: 今 });
  gi = B.并入({ claude: { locked: true } }, B.冻结池(cfg, root, 今));
  const picks = D.pickNext(cfg, ready, {}, gi, { 'claude-key': 1, codex: 1 });
  assert.equal(picks[0].池, 'codex', '超预算的池必须被绕开，否则保险丝形同虚设');
});

/* ===================== 壳兜底三候选（施工令-046）=====================
   案源：robinwang2 2026-08-11 来信——候选③曾硬编码 `D:/GitHub/Ticketflow`（换机即死），
   且三候选全失守只落一行 console.error 就静默走空实现：不落账、不冻结、界面零症状。
   下面三格锁的就是这两条：候选③读配置、失效必须响亮。 */

const 仓根 = path.resolve(__dirname, '..', '..', '..');
const 壳源 = ['../lib/budget.js', '../lib/budget-resolve.js']
  .map((p) => fs.readFileSync(path.join(__dirname, p), 'utf8')).join('\n');
// 候选①强制失守用的路径（相对 lib/ 解析，指向一个不存在的包）
const 死路 = '../../../packages/budget-不存在/budget.js';
function 仓(packages路径) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-res-'));
  const cfg = packages路径 === undefined ? {} : { packages路径 };
  fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify(cfg), 'utf8');
  return root;
}
const journal读 = (root) => {
  const dir = path.join(root, 'journal');
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
};

t('候选③读 studio.config.json · packages路径命中真包——硬编码仓根已从壳里删干净', () => {
  const root = 仓(path.join(仓根, 'packages'));
  const m = R.解析({ 相对: 死路, 环境: '', 根: root });
  assert.equal(m, B, '候选③没解析到真包（require 缓存同源即同对象）');
  assert.equal(m.失效, undefined, '命中时不该带失效位');
  assert.equal(journal读(root), '', '命中时不该往流水里写东西');
  // 相对值按**监制台仓根**解析（打包态的实际形态：包目录搁在仓库旁边，配置里写相对位置）
  const rel = 仓('包们');
  const 假包 = path.join(rel, '包们', 'budget');
  fs.mkdirSync(假包, { recursive: true });
  fs.writeFileSync(path.join(假包, 'budget.js'),
    'module.exports = { 冻结池: () => ({ 假: true }), 并入: (g) => g, 记: () => null, usageOf: () => ({}) };', 'utf8');
  const 相对命中 = R.解析({ 相对: 死路, 环境: '', 根: rel });
  assert.deepEqual(相对命中.冻结池(), { 假: true }, '配置里的相对路径没按仓根解析');
  assert.equal(相对命中.失效, undefined);
  // 硬编码那行是本令要拔的钉子：壳的两份源码里不许再出现盘符仓根
  assert.ok(!/[A-Za-z]:[\\/]/.test(壳源), '壳里还留着硬编码绝对路径：' + (壳源.match(/[A-Za-z]:[\\/][^'"\s]*/) || [])[0]);
  // 缺省/空串 = 跳过该候选（不是报错，也不是当成仓根用）
  for (const v of [undefined, '', '   ']) {
    const bad = R.解析({ 相对: 死路, 环境: '', 根: 仓(v) });
    assert.equal(bad.失效, true, `packages路径=${JSON.stringify(v)} 竟解析出了东西`);
    assert.match(bad.失败因[2].因, /为空/, '空配置的失败因该明说是空，不该是别的错');
  }
});

t('三候选全失守：落空实现 + journal 留「预算闸失效」+ 对象带失效位与三条失败因', () => {
  const root = 仓('');
  const m = R.解析({ 相对: 死路, 环境: path.join(仓根, '不存在的包目录'), 根: root });
  assert.equal(m.失效, true);
  assert.equal(m.失败因.length, 3, '失败因必须逐候选各一条，缺一条就等于瞒了一条线索');
  assert.deepEqual(m.失败因.map((f) => f.候选),
    ['仓内相对', 'TICKETFLOW_PACKAGES 环境变量', 'studio.config.json · packages路径']);
  assert.match(m.失败因[0].因, /budget-不存在|Cannot find module/);
  assert.match(m.失败因[1].因, /不存在的包目录|Cannot find module/);
  // 空实现的行为：不炸（保险丝失效好过全线停摆），但也确实什么都不做
  assert.deepEqual(m.冻结池({}, root), {});
  assert.deepEqual(m.并入({ x: 1 }), { x: 1 });
  assert.equal(m.记(root, { 池: 'k', 输入: 9 }), null);
  // 响亮化第一层：流水留证（控制台那行开机就滚没了）
  const log = journal读(root);
  assert.match(log, /预算闸失效/, 'journal 没落失效事件——静默失效正是本令要修的病');
  assert.match(log, /不落账、不冻结/);
  assert.match(log, /仓内相对/, '流水里没带候选失败因，运维照样不知道该修哪一条');
  assert.equal(m.journal, '已落');
  // 响亮化第二层：/api/gates 的失效位形状（server 直接展开这个对象）
  assert.deepEqual(R.失效位(m), { budget失效: true, budget失败因: m.失败因 });
  assert.deepEqual(R.失效位(B), {}, '正常命中时失效位必须一个字段都不出（返回体逐字节不变）');
  // 环境变量候选（②）单独验一格：设对了就该命中，且轮不到候选③
  const 中 = R.解析({ 相对: 死路, 环境: path.join(仓根, 'packages'), 根: 仓('') });
  assert.equal(中, B, '候选②（TICKETFLOW_PACKAGES）没接住');
});

t('服务实测：全失守时 /api/gates 真出 budget失效 位（正常命中时不出）', () => {
  const 起 = (root, port, 失守) => {
    // 失守态怎么造：子进程里把「仓内相对」那一次 require 拦下——生产代码不留测试后门，
    // 拦截写在测试的子进程脚本里（同 stub.test.js「两态各自一个干净进程」的手法）。
    const code = `
      ${失守 ? `const Module = require('module');
      const 原 = Module._load;
      Module._load = function (r) {
        if (/packages.budget.budget[.]js$/.test(r)) throw new Error('演练：仓内相对候选强制失守');
        return 原.apply(this, arguments);
      };` : ''}
      require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
        const g = await (await fetch('http://127.0.0.1:${port}/api/gates')).json();
        process.stdout.write('@@' + JSON.stringify(g) + '@@');
        srv.close();
      });
    `;
    // 桩台模式起服务：零派发零计费（额度外呼已哑）。TICKETFLOW_PACKAGES 显式清空，
    // packages路径 留空——于是失守态下三条候选各按各的因失守，与真实故障同形。
    const out = execFileSync(process.execPath, ['-e', code], {
      env: { ...process.env, STUDIO_STUB: '1', STUDIO_ROOT: root, STUDIO_PORT: String(port), TICKETFLOW_PACKAGES: '' },
      encoding: 'utf8', timeout: 60000,
    });
    return JSON.parse(out.split('@@')[1]);
  };
  const 死仓 = 仓('');
  const 死 = 起(死仓, 4937, true);
  assert.equal(死.budget失效, true, '预算闸空转了，/api/gates 却报得跟没事一样');
  assert.equal((死.budget失败因 || []).length, 3);
  assert.match(死.budget失败因[0].因, /强制失守/);
  assert.match(journal读(死仓), /预算闸失效/, '真服务起来时没往流水落失效事件');
  assert.ok(死.locks && 死.护城河, '失效位不该把原有返回体挤掉');
  const 活仓 = 仓('');
  const 活 = 起(活仓, 4938, false);
  assert.equal('budget失效' in 活, false, '正常命中竟也挂失效位——狼来了喊两次就没人信了');
  assert.equal('budget失败因' in 活, false);
  assert.equal(journal读(活仓), '', '正常命中时流水不该有失效事件');
});

console.log(`全部通过：${passed} 项`);
