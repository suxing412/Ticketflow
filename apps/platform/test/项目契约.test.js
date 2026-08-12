// 项目契约测试 —— 项目是一等公民（协-007）。
//
// 全部用**假配置**，不读本机的 config/项目.local.json：
// 项目注册表是机器相关的东西，测试一旦依赖它，就变成「谁本地注册了什么，
// 谁的测试就是另一个样」——那时它不再是共同基准。
'use strict';
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const 平台根 = path.resolve(__dirname, '..');
const 项目 = require(path.join(平台根, 'lib', '项目.js'));

let passed = 0;
const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('项目契约测试');

// 造一个真的 git 仓当靶子：体检要看 .git，假路径糊弄不过去，也不该糊弄。
function 建假仓() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  fs.mkdirSync(path.join(d, '.git'));
  return d;
}
const 配 = (注册, 默认) => ({ 项目: { 注册, 默认 } });

t('体检只报 fs 看得见的，并说清看不见什么', () => {
  const 仓 = 建假仓();
  try {
    const r = 项目.体检('X', { 路径: 仓 });
    assert.equal(r.就绪, true);
    assert.equal(r.是git仓, true);
    // 这句不是客套：不写清边界，人会把「就绪」读成「git 干净可以直接发布」，
    // 而那件事 server 进程根本查不了（它不引 child_process）。
    assert.ok(/工作区服务|4371/.test(r.说), '要说清分支与未提交改动查不了：' + r.说);
  } finally { fs.rmSync(仓, { recursive: true, force: true }); }
});

t('体检分得开三种坏：没写路径 / 路径不在 / 不是 git 仓', () => {
  assert.equal(项目.体检('A', {}).就绪, false);
  assert.ok(/没有写/.test(项目.体检('A', {}).说));

  const 不在 = 项目.体检('B', { 路径: path.join(os.tmpdir(), '绝对不存在的目录-' + 'zzz') });
  assert.equal(不在.存在, false);
  assert.ok(/不存在/.test(不在.说), '路径写了但不在是最常见的注册错误（换机、盘符变、目录挪走），要点名说');

  const 普通目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  try {
    const r = 项目.体检('C', { 路径: 普通目录 });
    assert.equal(r.存在, true);
    assert.equal(r.是git仓, false);
    assert.ok(/git/.test(r.说));
  } finally { fs.rmSync(普通目录, { recursive: true, force: true }); }
});

t('解析：空项目是合法的（不带项目 = 只跑不提交，不是配错了）', () => {
  const r = 项目.解析(配({}, ''), '');
  assert.equal(r.ok, true);
  assert.equal(r.路径, null);
});

t('解析未注册项目时列出已注册的（光说「不在注册表」等于让人自己去猜）', () => {
  const 仓 = 建假仓();
  try {
    const r = 项目.解析(配({ 甲: { 路径: 仓 } }, '甲'), '乙');
    assert.equal(r.ok, false);
    assert.ok(r.错误.includes('甲'), '要列出已注册的有哪些：' + r.错误);
    assert.ok(/白名单/.test(r.错误), '要说清注册表同时是写操作白名单——那才是它拦人的真正原因');
  } finally { fs.rmSync(仓, { recursive: true, force: true }); }
});

t('建单校验：非法名与未注册名都拦，空值放行', () => {
  const 仓 = 建假仓();
  try {
    const c = 配({ 甲: { 路径: 仓 } }, '甲');
    assert.equal(项目.校验工单项目(c, ''), null, '空值必须放行');
    assert.equal(项目.校验工单项目(c, '甲'), null);
    assert.ok(项目.校验工单项目(c, '乙'), '未注册要拦');
    // 项目名会进 URL 查询串、会当对象键、会出现在错误信息里
    for (const 坏 of ['../x', 'a/b', '.hidden', 'x'.repeat(70), '<script>']) {
      assert.ok(项目.校验工单项目(c, 坏), `非法名没拦住：${坏}`);
    }
  } finally { fs.rmSync(仓, { recursive: true, force: true }); }
});

// ---- 落位（登记）----
t('登记：拒相对路径、拒不存在、拒非 git 仓', () => {
  const 假平台 = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-'));
  const 普通目录 = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  try {
    assert.equal(项目.落位(假平台, '', 'D:/x').ok, false);
    assert.equal(项目.落位(假平台, '甲', '').ok, false);
    assert.ok(/绝对路径/.test(项目.落位(假平台, '甲', './相对').错误));
    assert.ok(/不存在/.test(项目.落位(假平台, '甲', path.join(os.tmpdir(), '没有这个目录-zzz')).错误));
    assert.ok(/git/.test(项目.落位(假平台, '甲', 普通目录).错误));
  } finally {
    fs.rmSync(假平台, { recursive: true, force: true });
    fs.rmSync(普通目录, { recursive: true, force: true });
  }
});

t('登记：与平台自身重叠的仓一律拒——两个方向都要挡', () => {
  // 注册表是写操作白名单：登记一个仓就等于允许 AI 往里提交。登记了包含平台自己的仓，
  // AI 就能改自己的闸门——真跑开关、预算上限、门禁令牌全在 config/ 里。
  //
  // ⚠ 第一版只挡了「仓在平台目录里」，漏了**平台在仓里**，而后者才是真会发生的那个：
  // 仓根装着 apps/platform，注册仓根完全是个自然动作。写这条测试时当场抓到并修了。
  const 外 = fs.mkdtempSync(path.join(os.tmpdir(), 'outer-'));
  fs.mkdirSync(path.join(外, '.git'));
  const 假平台 = path.join(外, 'apps', 'platform');
  fs.mkdirSync(假平台, { recursive: true });
  const 里 = path.join(假平台, '子仓');
  fs.mkdirSync(path.join(里, '.git'), { recursive: true });
  try {
    const a = 项目.落位(假平台, '仓根', 外);          // 平台在仓里
    assert.equal(a.ok, false, '注册包含平台自己的仓，被放过去了');
    assert.ok(/重叠|白名单/.test(a.错误), a.错误);

    const b = 项目.落位(假平台, '自己', 里);          // 仓在平台里
    assert.equal(b.ok, false);

    const c = 项目.落位(假平台, '自身', 假平台);      // 就是自己
    assert.equal(c.ok, false);

    // 挡住之后不能留下痕迹：拒绝了却把配置写了，是最糟的一种半成功
    assert.ok(!fs.existsSync(path.join(假平台, 'config', '项目.local.json')),
      '被拒的登记不该写出配置文件');
  } finally { fs.rmSync(外, { recursive: true, force: true }); }
});

t('登记：正常落位写出配置，头一个自动成默认，同名覆盖如实上报', () => {
  const 假平台 = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-'));
  const 仓1 = 建假仓(); const 仓2 = 建假仓();
  const 存 = process.env.PLATFORM_CONFIG;
  delete process.env.PLATFORM_CONFIG;
  try {
    const a = 项目.落位(假平台, '甲', 仓1);
    assert.equal(a.ok, true, a.错误);
    assert.equal(a.默认, '甲', '头一个登记的该自动成默认，省人一步');
    assert.equal(a.覆盖, false);

    const 落 = JSON.parse(fs.readFileSync(path.join(假平台, 'config', '项目.local.json'), 'utf8'));
    assert.equal(path.resolve(落.注册.甲.路径), path.resolve(仓1));
    assert.ok(String(落._说明 || '').includes('白名单') || JSON.stringify(落._说明).includes('白名单'),
      '写出的文件里要留一句「这同时是写操作白名单」——手改它的人得知道这件事');

    // 第二个不抢默认
    const b = 项目.落位(假平台, '乙', 仓2);
    assert.equal(b.默认, '甲');
    // 同名覆盖要如实说：静默覆盖会让人以为登记了两个
    const c = 项目.落位(假平台, '甲', 仓2);
    assert.equal(c.覆盖, true);
  } finally {
    if (存) process.env.PLATFORM_CONFIG = 存;
    for (const d of [假平台, 仓1, 仓2]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// ---- 流程视图的项目筛：依赖必须在全库里查 ----
t('按项目筛流程时，跨项目的上游不能被算成「依赖缺失」', () => {
  // 先筛后铺的话，一张单依赖的上游若属于别的项目，会被判成
  // 「依赖缺失——永远不会就绪」，而它其实好好的。
  // 错的那次代价是让人去删一条完全正常的依赖。
  const 流程 = require(path.join(平台根, 'lib', '流程视图.js'));
  const 单 = (id, state, 项, 依赖) => ({ id, state, fm: { title: id, ...(项 ? { 项目: 项 } : {}), ...(依赖 ? { 依赖 } : {}) } });
  const r = 流程.铺([
    单('上游', '在途', '乙项目'),
    单('下游', '待投', '甲项目', ['上游']),
  ], { 只看项目: '甲项目' });
  const 下 = r.层.flatMap((l) => l.工单).find((x) => x.id === '下游');
  assert.ok(下, '筛甲项目应铺出下游');
  assert.equal(下.卡因.类型, '等上游', '跨项目上游被算成依赖缺失了：' + JSON.stringify(下.卡因));
  // 上游属于别的项目，不该出现在这次铺出来的表里
  assert.ok(!r.层.flatMap((l) => l.工单).some((x) => x.id === '上游'));
});

t('「(无项目)」是个真实类别，不是「全部」的同义词', () => {
  const 流程 = require(path.join(平台根, 'lib', '流程视图.js'));
  const 单 = (id, 项) => ({ id, state: '待投', fm: { title: id, ...(项 ? { 项目: 项 } : {}) } });
  const r = 流程.铺([单('带项目', '甲'), 单('不带')], { 只看项目: '(无项目)' });
  const 全 = r.层.flatMap((l) => l.工单).map((x) => x.id);
  assert.deepEqual(全, ['不带'], '不带项目的单只跑不提交，是一群需要单独看见的单');
});

console.log(`全部通过：${passed} 项`);
