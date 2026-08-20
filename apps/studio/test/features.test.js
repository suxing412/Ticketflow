// features.test.js — 特性注册表（四层架构第二层，制作人 2026-08-20 拍板）
// 被测面：①禁预规划闸（附不出活就拒）②三状态与转移 ③待审/封存挂不了单
//        ④散单兜底位幂等 ⑤进度全推导不落盘 ⑥只记直接上级（上级不存子清单）
const assert = require('node:assert');
const fs = require('fs');
const F = require('../lib/features');
const store = require('../lib/core/store');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('特性注册表测试');

const 提 = (root, o = {}) => F.提请(root, {
  名称: o.名称 || '手修编辑器', 管线: o.管线 || 'P-1',
  边界: o.边界 || '制作人在编辑器里落笔的整套工具',
  挂载: o.挂载 || { 专项: ['S-1'] }, ...o,
});

t('禁预规划：提请附不出「现在就要挂进来」的对象即拒', () => {
  const root = makeRoot();
  const r = F.提请(root, { 名称: '水体', 管线: 'P-1', 边界: '河湖海' });
  assert.equal(r.ok, false);
  assert.equal(r.禁预规划, true);
  assert.match(r.error, /被活撑出来的/, '拒因要讲清道理——特性不是设计出来的');
  assert.equal(F.list(root).length, 0, '拒了就不该留半个文件');
});

t('提请三必填：名称/管线/边界缺一即拒（特性不能悬空）', () => {
  const root = makeRoot();
  assert.equal(F.提请(root, { 管线: 'P-1', 边界: 'x', 挂载: { 专项: ['S-1'] } }).ok, false);
  assert.equal(F.提请(root, { 名称: 'a', 边界: 'x', 挂载: { 专项: ['S-1'] } }).ok, false);
  assert.equal(F.提请(root, { 名称: 'a', 管线: 'P-1', 挂载: { 专项: ['S-1'] } }).ok, false);
});

t('提请落待审态，编号扁平 F-n 跨管线连号', () => {
  const root = makeRoot();
  const a = 提(root);
  assert.equal(a.id, 'F-1');
  assert.equal(a.fm.状态, '待审');
  assert.deepEqual(a.fm.挂载凭据.专项, ['S-1'], '当初拿什么活撑起来的要留痕');
  const b = 提(root, { 名称: '主地图镜头', 管线: 'P-2', 挂载: { 工单: ['TK-26'] } });
  assert.equal(b.id, 'F-2', '跨管线连号，不按管线分段');
});

t('同管线重名拒；封存态不算冲突（路线回摆时能重开同名）', () => {
  const root = makeRoot();
  提(root);
  assert.equal(提(root).ok, false, '同管线同名拒');
  assert.ok(提(root, { 管线: 'P-2' }).ok, '异管线同名可以');
  F.转移(root, 'F-1', '封存', { 操作者: '总监', 因: '被取代' });
  assert.ok(提(root).ok, '封存的不占名');
});

t('审核：过→活跃并记审核人；不过→就地封存留痕，不删', () => {
  const root = makeRoot();
  提(root);
  assert.equal(F.审核(root, 'F-1', { 通过: true }).ok, false, '审核必须署名');
  const r = F.审核(root, 'F-1', { 通过: true, 审核人: '总监' });
  assert.equal(r.fm.状态, '活跃');
  assert.equal(r.fm.审核人, '总监');
  assert.equal(F.审核(root, 'F-1', { 通过: true, 审核人: '总监' }).ok, false, '已审的不能再审');

  提(root, { 名称: '另一个' });
  F.审核(root, 'F-2', { 通过: false, 审核人: '总监', 说明: '预规划' });
  assert.equal(F.find(root, 'F-2').fm.状态, '封存');
  assert.ok(F.find(root, 'F-2'), '审不过是封存不是删除——留痕可查');
});

t('挂单闸：待审挂不了单、封存挂不了单、活跃才可以', () => {
  const root = makeRoot();
  提(root);
  assert.equal(F.可挂单(root, 'F-1').ok, false, '待审：审过才能挂');
  F.审核(root, 'F-1', { 通过: true, 审核人: '总监' });
  assert.equal(F.可挂单(root, 'F-1').ok, true);
  F.转移(root, 'F-1', '封存', { 操作者: '总监', 因: '被栅格方案取代' });
  const r = F.可挂单(root, 'F-1');
  assert.equal(r.ok, false);
  assert.match(r.error, /被栅格方案取代/, '拒因带上封存理由，别让人去翻履历');
});

t('封存可复活：路线回摆时不该另开同名特性把历史劈成两半', () => {
  const root = makeRoot();
  提(root); F.审核(root, 'F-1', { 通过: true, 审核人: '总监' });
  F.转移(root, 'F-1', '封存', { 操作者: '总监' });
  assert.ok(F.转移(root, 'F-1', '活跃', { 操作者: '总监', 因: '路线回摆' }).ok);
  assert.equal(F.find(root, 'F-1').fm.封存时间, null);
});

t('状态机严进：未定义的转移一律拒', () => {
  const root = makeRoot();
  提(root);
  assert.equal(F.转移(root, 'F-1', '不存在的态', { 操作者: '总监' }).ok, false);
  assert.equal(F.转移(root, 'F-1', '待审', { 操作者: '总监' }).幂等, true, '同态转移幂等返回，不刷履历（巡检会反复调）');
  assert.equal(F.转移(root, 'F-9', '活跃', { 操作者: '总监' }).ok, false, '特性不存在');
});

t('散单兜底位：系统建、免审直接活跃、幂等不重建', () => {
  const root = makeRoot();
  const a = F.确保散单位(root, 'P-1', '地图系统');
  assert.equal(a.fm.状态, '活跃', '兜底位不是「谁提议的功能」，无需审');
  assert.equal(a.fm.系统, true);
  assert.match(a.fm.名称, /散单/);
  const b = F.确保散单位(root, 'P-1', '地图系统');
  assert.equal(b.幂等, true);
  assert.equal(b.id, a.id);
  assert.equal(F.list(root).length, 1, '幂等就是不重建');
});

t('进度全推导不落盘：特性文件里没有任何进度/子清单字段', () => {
  const root = makeRoot();
  提(root); F.审核(root, 'F-1', { 通过: true, 审核人: '总监' });
  const 文 = fs.readFileSync(F.find(root, 'F-1').file, 'utf8');
  for (const 禁 of ['百分比', '落袋', '单数', '子专项', '子单']) {
    assert.ok(!new RegExp('^' + 禁 + ':', 'm').test(文), `frontmatter 不得落「${禁}」——存了就是第二个事实源`);
  }
});

t('聚合：直挂单与子专项的单一起数，落袋比例现算', () => {
  const root = makeRoot();
  提(root); F.审核(root, 'F-1', { 通过: true, 审核人: '总监' });
  seed(root, '完成', { id: 'TK-1', 特性: 'F-1' });
  seed(root, '完成', { id: 'TK-2', 特性: 'F-1' });
  seed(root, '在途', { id: 'TK-3', 特性: 'F-1' });
  seed(root, '完成', { id: 'TK-4', 特性: 'F-1', 专项: 'S-9' }); // 有专项的走专项那条路，不在直挂里数
  const v = F.聚合(root, 'F-1');
  assert.equal(v.直挂单数, 3, '带专项的不算直挂');
  assert.equal(v.落袋, 2);
  assert.equal(v.百分比, 67);
});

t('只记直接上级：特性记管线，特性文件里不存子专项清单', () => {
  const root = makeRoot();
  提(root);
  const fm = F.find(root, 'F-1').fm;
  assert.equal(fm.管线, 'P-1', '记直接上级');
  assert.equal(fm.专项, undefined, '不记子级——那是反向聚合现算的事');
});

t('编辑：改名不动挂链，记履历不静默改；重名拒、改空拒', () => {
  const root = makeRoot();
  提(root); F.审核(root, 'F-1', { 通过: true, 审核人: '总监' });
  seed(root, '完成', { id: 'TK-9', 特性: 'F-1' });
  const r = F.编辑(root, 'F-1', { 名称: '手绘编辑器', 操作者: '制作人' });
  assert.equal(r.fm.名称, '手绘编辑器');
  assert.equal(F.聚合(root, 'F-1').直挂单数, 1, '改名后底下的单一张不掉——挂的是 F-n 号不是名字');
  const 末 = r.fm.履历[r.fm.履历.length - 1];
  assert.match(末.因, /名称 手修编辑器 → 手绘编辑器/, '改名是真事件，半年后翻账要查得到旧名');
  assert.equal(F.编辑(root, 'F-1', { 名称: '   ' }).ok, false, '改空拒');
  提(root, { 名称: '另一个' }); F.审核(root, 'F-2', { 通过: true, 审核人: '总监' });
  assert.equal(F.编辑(root, 'F-2', { 名称: '手绘编辑器' }).ok, false, '同管线重名拒');
  assert.equal(F.编辑(root, 'F-1', { 名称: '手绘编辑器' }).幂等, true, '没变即幂等，不刷履历');
});

console.log('全部通过：' + passed + ' 项');
