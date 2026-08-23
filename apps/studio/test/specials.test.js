// specials.test.js — 专项注册表（H103 · 施工令-058 第 6 条）
// 被测面六块，对着令面要件逐条排：
//   ① 注册表状态机：立项/顺序派号/四态转移合法性/关账人闸/复工回头路/幂等不刷履历
//   ② 聚合：子单反向聚合（专项章 + 别名兜底）、进度四段、预算实耗、基线变迁、零子单不编进度
//   ③ 迁移：伪单→容器四步（建容器/子单挂链/推收口/伪单归档不删）、**重跑幂等**、演练零写盘、
//           工单库不可达时不凭空造容器（本仓够不着真库，这一格就是它的排练口径）
//   ④ 切单改绑：容器解析两形、子单挂链字段与派号前缀、管线显式落盘、on专项立项 唤醒
//   ⑤ 052 台账适配：专项批名=专项名、子单挂粒规则不变、伪单不登粒、战役老路零回归
//   ⑥ 隔离：专项实体不进工单目录（store 扫不到）、不参与机判/QA/派发
// 纪律沿用 ledger-sync.test：接线那一格走真 runner.tick，不拿 mock 冒充接线证据。
// 外呼绊线必须排在任何 lib/ 之前：lib/quota.js 在加载那一刻就把 child_process 解构走了（体检 #71）
const 绊线 = require('./外呼绊线'); 绊线.装绊线();
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRoot, seed, CFG } = require('./helper');
const SP = require('../lib/specials');
const store = require('../lib/core/store');
const LS = require('../lib/pm/ledger-sync');
const S = require('../lib/pm/schedule');
const wake = require('../lib/pm/wake');
const brain = require('../lib/pm/brain');
const ideas = require('../lib/pm/ideas');
const pmLedger = require('../lib/pm/ledger');
const inbox = require('../lib/inbox');
const quota = require('../lib/quota');
// 测试隔离（同 dispatch-tick 2026-08-05 案）：额度闸别去查真实订阅用量
quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('specials 专项注册表测试（施工令-058 · H103）');

const 立 = (root, o = {}) => SP.立项(root, { 名称: '编辑器专项', 单号前缀: 'TK', ...o });

(async () => {
  /* ================= ① 状态机 ================= */

  await t('立项：S 系列顺序派号 · 初态一律「立项」· 名称必填', async () => {
    const root = makeRoot();
    assert.equal(SP.立项(root, { 名称: '  ' }).ok, false, '空名称不收');
    const a = 立(root, { 名称: '甲专项' });
    const b = 立(root, { 名称: '乙专项', 管线: 'P-3', 项目: 'SLG' });
    assert.equal(a.id, 'S-1'); assert.equal(b.id, 'S-2', '递增派号');
    assert.equal(a.fm.状态, '立项', '初态没有第二个入口——机器推的态不许手工指定');
    assert.equal(b.fm.管线, 'P-3'); assert.equal(b.fm.项目, 'SLG');
    assert.equal(b.fm.单号前缀, 'TK', '专项号是 S-n，子单号照旧走项目前缀');
    assert.equal(a.fm.履历.length, 1, '立项也留一笔履历');
    // 落盘即事实源：文件真在 专项/ 目录里，且 store 扫不到（要件3 隔离）
    assert.ok(fs.existsSync(path.join(root, '专项', 'S-1.md')));
    assert.equal(store.find(root, 'S-1'), null, '专项实体不进工单目录');
    assert.equal(SP.list(root).length, 2);
  });

  await t('转移：主链顺走合法 · 跨级/倒退非法 · 幂等不刷履历', async () => {
    const root = makeRoot();
    立(root);
    assert.equal(SP.转移(root, 'S-1', '收口').ok, false, '立项 → 收口 是跨级，拒');
    assert.equal(SP.转移(root, 'S-1', '进行', { 因: '首派' }).ok, true);
    assert.equal(SP.转移(root, 'S-1', '立项').ok, false, '进行 → 立项 没有这条路');
    const 幂 = SP.转移(root, 'S-1', '进行');
    assert.equal(幂.幂等, true, '到已在的态是幂等，不是失败');
    assert.equal(SP.find(root, 'S-1').fm.履历.length, 2, '幂等一拍不刷履历（巡检拍会反复调它）');
    assert.equal(SP.转移(root, 'S-1', '收口', { 因: '全落袋' }).ok, true);
    assert.ok(SP.find(root, 'S-1').fm.收口时间, '收口盖时间戳');
  });

  await t('关账是唯一人闸：必须署名 · 只从收口出发 · 关账后是终态', async () => {
    const root = makeRoot();
    立(root);
    assert.equal(SP.关账(root, 'S-1', '制作人').ok, false, '立项态不许关账');
    SP.转移(root, 'S-1', '进行'); SP.转移(root, 'S-1', '收口');
    SP.定完成定义(root, 'S-1', '本用例测的是署名与状态机，完成定义闸另有专测'); // 2026-08-20 新闸
    assert.equal(SP.关账(root, 'S-1', '   ').ok, false, '不署名不给关');
    assert.equal(SP.转移(root, 'S-1', '关账', { 操作者: '' }).ok, false, '绕过 关账() 直接转移也拦——人闸判据在状态机里');
    const r = SP.关账(root, 'S-1', '制作人', '验收通过');
    assert.equal(r.ok, true);
    const fm = SP.find(root, 'S-1').fm;
    assert.equal(fm.状态, '关账'); assert.equal(fm.关账签字, '制作人'); assert.ok(fm.关账时间);
    assert.equal(SP.转移(root, 'S-1', '进行').ok, false, '关账是终态，没有出边');
  });

  await t('复工：收口后子单又活了 → 自动回「进行」（不让容器说假话）', async () => {
    const root = makeRoot();
    立(root);
    seed(root, '完成', { id: 'TK-1', 专项: 'S-1' });
    SP.转移(root, 'S-1', '进行');
    assert.equal(SP.收口自检(root, 'S-1').动作, '收口');
    // H65 返修：同号回草稿
    fs.renameSync(store.ticketPath(root, '完成', 'TK-1'), store.ticketPath(root, '草稿', 'TK-1'));
    const r = SP.收口自检(root, 'S-1');
    assert.equal(r.动作, '复工');
    assert.deepEqual(r.活单, ['TK-1']);
    assert.equal(SP.find(root, 'S-1').fm.状态, '进行');
    assert.equal(SP.find(root, 'S-1').fm.收口时间, null, '复工要把收口时间抹掉，不然纸面上还留着个假收口');
  });

  await t('人手复工优先于机器自检：复工后无新子单，机器不得推回收口（2026-08-21 S-3 案）', async () => {
    // 案源实测：总监把 S-3 从收口退回「进行」（完成定义要求过制作人手感闸，而手感闸从未通过），
    // **10 秒后**自检以「全部子单落袋（2 张）」把它推回收口——那两张正是复工时判定「不够」的那两张。
    // 病根：自检的判据是「子单有没有活」，而复工是**人说「这事没完」**，两者说的不是一件事。
    // 后果比状态错更坏：推回来的痕迹与正常收口一模一样，事后看不出发生过复工，
    // 于是「假收口」第三次成立——而且这次是机制自己造的。
    const root = makeRoot();
    立(root);
    seed(root, '完成', { id: 'TK-1', 专项: 'S-1' });
    SP.转移(root, 'S-1', '进行');
    assert.equal(SP.收口自检(root, 'S-1').动作, '收口');

    // 人手复工（这是人闸动作，不是系统方）
    const 复 = SP.转移(root, 'S-1', '进行', { 操作者: '总监', 因: '完成定义未达成' });
    assert.ok(复.ok);
    assert.ok(SP.find(root, 'S-1').fm.复工时间, '复工要留时刻，自检据它判「人刚说过没完」');

    // 关键：此刻子单仍是全落袋的，但机器**不许**推回收口
    const r = SP.收口自检(root, 'S-1');
    assert.equal(r.动作, null, '复工后无新子单 → 自检必须挂起，不得替人宣布做完');
    assert.match(String(r.挂起自检 || ''), /复工/);
    assert.equal(SP.find(root, 'S-1').fm.状态, '进行', '状态要守住——守不住，复工这条退路就形同虚设');

    // 有了新子单，机器才重新拿回收口权（新单落袋后正常收口，不误伤正常流程）
    seed(root, '完成', { id: 'TK-2', 专项: 'S-1', 创建时间: new Date(Date.now() + 60000).toISOString() });
    assert.equal(SP.收口自检(root, 'S-1').动作, '收口', '新子单出现并落袋后，自检恢复常态');
  });

  await t('首派：立项 → 进行（只推一次，非立项态不动）', async () => {
    const root = makeRoot();
    立(root);
    assert.equal(SP.首派(root, 'S-1').ok, true);
    assert.equal(SP.find(root, 'S-1').fm.状态, '进行');
    assert.equal(SP.首派(root, 'S-1').跳过, true, '已经进行了就不再推');
    assert.equal(SP.首派(root, 'TK-9').跳过, true, '非 S 号一律不认');
  });

  /* ================= ② 聚合 ================= */

  await t('子单反向聚合：认 专项 章 · 别名兜底 · 容器伪单不算子单', async () => {
    const root = makeRoot();
    立(root, { 别名: ['TK-150'] });
    seed(root, '完成', { id: 'TK-151', 专项: 'S-1' });
    seed(root, '在途', { id: 'TK-152', 父单: 'TK-150' });          // 漏补专项章：别名认回来
    seed(root, '草稿', { id: 'TK-153', 父单: 'TK-999' });          // 别人家的活
    seed(root, '已归档', { id: 'TK-150', 专项: 'S-1', 迁移至专项: 'S-1' }); // 迁移后的容器伪单
    const kids = SP.子单(root, 'S-1');
    assert.deepEqual(kids.map((k) => k.id), ['TK-151', 'TK-152'], '容器伪单自己不算子单');
  });

  await t('聚合：进度四段 · 预算实耗 · 零子单不编进度', async () => {
    const root = makeRoot();
    立(root, { 名称: '编辑器专项', 管线: 'P-3' });
    assert.deepEqual(SP.聚合(root, 'S-1').进度, { 总数: 0, 落袋: 0, 归档: 0, 在办: 0, 未起: 0, 百分比: 0 },
      '零子单 = 0%，不是 100%——切单没出结果的专项不许显示「做完了」');
    seed(root, '完成', { id: 'TK-1', 预计时间: '1', 领单时间: '2026-08-10T00:00:00Z', 交付时间: '2026-08-10T02:00:00Z', 专项: 'S-1' });
    seed(root, '在途', { id: 'TK-2', 预计时间: '0.5', 专项: 'S-1' });
    seed(root, '草稿', { id: 'TK-3', 预计时间: '0.5', 专项: 'S-1' });
    seed(root, '已归档', { id: 'TK-4', 归档原因: '废弃', 专项: 'S-1' });
    const v = SP.聚合(root, 'S-1');
    assert.deepEqual(v.进度, { 总数: 4, 落袋: 1, 归档: 1, 在办: 1, 未起: 1, 百分比: 25 },
      '归档单留在分母里——废掉一张不该让完成度凭空变好看');
    assert.equal(v.预算.预计h, 2);
    assert.equal(v.预算.实耗h, 2, '实耗走 领单→交付，与 report.aggregate 的 实际h 同源');
    assert.equal(v.预算.偏差pct, 100, '踩点');
    assert.equal(v.名称, '编辑器专项'); assert.equal(v.管线, 'P-3');
    assert.equal(v.子单.length, 4);
    assert.equal(v.子单[0].id, 'TK-1', '子单按号定序');
  });

  await t('基线变迁：容器履历 + 子单增删（返工/推翻/撤销）', async () => {
    const root = makeRoot();
    立(root);
    SP.转移(root, 'S-1', '进行', { 因: '首子单派发' });
    seed(root, '草稿', { id: 'TK-2', 返工自: 'TK-1', 专项: 'S-1' });
    seed(root, '已归档', { id: 'TK-1', 归档原因: '返工替代', 专项: 'S-1' });
    const 基 = SP.聚合(root, 'S-1').基线;
    assert.equal(基.filter((b) => b.类型 === '容器').length, 2, '立项 + 进行两笔');
    assert.ok(基.some((b) => b.类型 === '返工' && b.单号 === 'TK-2'));
    assert.ok(基.some((b) => b.类型 === '撤销' && b.单号 === 'TK-1'));
  });

  /* ================= ③ 迁移 ================= */

  const 铺伪单 = (root) => {
    seed(root, '待验收', { id: 'TK-150', title: '编辑器专项', 父单类型: '专项', 管线: 'P-3', 项目: 'SLG', 验收方式: '保留', body: '## 专项目标\n把编辑器做出来\n' });
    seed(root, '完成', { id: 'TK-156', title: '大纲树拖拽', 父单: 'TK-150' });
    seed(root, '完成', { id: 'TK-157', title: '属性面板', 父单: 'TK-150' });
  };

  await t('迁移四步：建容器 · 子单挂链（父单章不动）· 推收口 · 伪单归档不删', async () => {
    const root = makeRoot();
    铺伪单(root);
    const r = SP.迁移(root, [{ 单号: 'TK-150' }]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.专项, ['S-1']);
    const s = SP.find(root, 'S-1');
    assert.equal(s.fm.名称, '编辑器专项');
    assert.equal(s.fm.管线, 'P-3'); assert.equal(s.fm.项目, 'SLG');
    assert.deepEqual(s.fm.别名, ['TK-150'], '原 TK 号记别名');
    assert.equal(s.fm.状态, '收口', '迁移后停在收口，候制作人关账签字');
    assert.deepEqual(s.fm.履历.map((h) => h.到), ['立项', '进行', '收口'],
      '三跳全走状态机并留履历——不许直接把状态字段写成「收口」给自己开后门');
    assert.match(s.body, /追溯链/, '正文带追溯链');
    // 子单挂链，父单章原样不动
    for (const id of ['TK-156', 'TK-157']) {
      const k = store.find(root, id);
      assert.equal(k.fm.专项, 'S-1');
      assert.equal(k.fm.父单, 'TK-150', '父单章不动——追溯链保真');
    }
    // 伪单归档不删
    const 伪 = store.find(root, 'TK-150');
    assert.equal(伪.state, '已归档', '待验收文件归档，不删');
    assert.ok(fs.existsSync(伪.file));
    assert.match(伪.fm.归档原因, /专项实体化迁移 → S-1/);
    assert.equal(伪.fm.迁移至专项, 'S-1', '工单板据此摘掉伪单（要件5）');
    // 聚合看得见两张子单，伪单不混进来
    assert.deepEqual(SP.聚合(root, 'S-1').子单.map((k) => k.id), ['TK-156', 'TK-157']);
  });

  await t('迁移幂等：重跑不造新号 · 不重复挂链 · 不把已归档伪单再动一次', async () => {
    const root = makeRoot();
    铺伪单(root);
    SP.迁移(root, [{ 单号: 'TK-150' }]);
    const 一 = fs.readFileSync(path.join(root, '专项', 'S-1.md'), 'utf8');
    const r2 = SP.迁移(root, [{ 单号: 'TK-150' }]);
    assert.deepEqual(r2.专项, ['S-1'], '认别名当钥匙，重跑不造 S-2');
    assert.equal(SP.list(root).length, 1);
    assert.ok(r2.动作.some((a) => a.动作 === '容器已在'));
    assert.ok(r2.动作.some((a) => a.动作 === '子单已挂'));
    assert.ok(r2.动作.some((a) => a.动作 === '伪单已归档'));
    assert.ok(!r2.动作.some((a) => a.动作 === '推收口'), '状态已到位就不再推');
    assert.equal(fs.readFileSync(path.join(root, '专项', 'S-1.md'), 'utf8'), 一, '重跑一个字节都不改容器文件');
    // 第三跑也一样（幂等不是"第二次凑巧对"）
    SP.迁移(root, [{ 单号: 'TK-150' }]);
    assert.equal(SP.list(root).length, 1);
  });

  await t('迁移演练：只算不写（本仓够不着真工单库时的排练口径）', async () => {
    const root = makeRoot();
    铺伪单(root);
    const r = SP.迁移(root, [{ 单号: 'TK-150' }], { 演练: true });
    assert.equal(r.演练, true);
    assert.ok(r.动作.length >= 4, '动作清单照出，让人先看');
    assert.equal(SP.list(root).length, 0, '演练不建容器');
    assert.equal(store.find(root, 'TK-150').state, '待验收', '演练不动伪单');
    assert.equal(store.find(root, 'TK-156').fm.专项, undefined, '演练不挂链');
  });

  await t('迁移：伪单不在本库 → 跳过不报错、更不凭空造容器', async () => {
    const root = makeRoot();
    const r = SP.迁移(root, SP.默认迁移计划);
    assert.equal(r.ok, true);
    assert.deepEqual(r.专项, []);
    assert.equal(r.跳过.length, 2, 'TK-146/150 都不在 → 两条跳过');
    assert.match(r.跳过[0].因, /不凭空造容器/);
    assert.equal(SP.list(root).length, 0);
  });

  await t('迁移：令面点名的两张一起跑 → S-1/S-2 各自成容器', async () => {
    const root = makeRoot();
    seed(root, '待验收', { id: 'TK-146', title: '海岸线专项', 父单类型: '专项', body: '## 目标\n海岸线\n' });
    seed(root, '完成', { id: 'TK-147', title: '钉零', 父单: 'TK-146' });
    铺伪单(root);
    const r = SP.迁移(root, SP.默认迁移计划);
    assert.deepEqual(r.专项, ['S-1', 'S-2'], '按计划序派号：146→S-1、150→S-2');
    assert.equal(SP.聚合(root, 'S-1').名称, '海岸线专项');
    assert.equal(SP.聚合(root, 'S-2').名称, '编辑器专项');
    assert.deepEqual(SP.聚合(root, 'S-1').子单.map((k) => k.id), ['TK-147']);
    assert.deepEqual(SP.聚合(root, 'S-2').子单.map((k) => k.id), ['TK-156', 'TK-157']);
    assert.equal(SP.find(root, 'S-1').fm.状态, '收口');
    assert.equal(SP.find(root, 'S-2').fm.状态, '收口');
  });

  await t('迁移：收口报告在场则原样指过去（不搬文件）', async () => {
    const root = makeRoot();
    铺伪单(root);
    fs.mkdirSync(path.join(root, '项管台账'), { recursive: true });
    const rp = path.join(root, '项管台账', '收口报告-TK-150.md');
    fs.writeFileSync(rp, '# 收口报告\n', 'utf8');
    SP.迁移(root, [{ 单号: 'TK-150' }]);
    assert.equal(SP.find(root, 'S-1').fm.收口报告, rp);
    assert.ok(fs.existsSync(rp), '报告文件原地不动');
  });

  /* ================= ④ 切单改绑 ================= */

  await t('容器解析两形：S-n 走注册表（挂链=专项、前缀=单号前缀）· 存量战役号走工单', async () => {
    const root = makeRoot();
    立(root, { 名称: '编辑器专项', 管线: 'P-3', 项目: 'SLG', 单号前缀: 'TK' });
    const c1 = brain.容器(root, 'S-1');
    assert.equal(c1.专项, true);
    assert.deepEqual(c1.挂链, { 专项: 'S-1' });
    assert.equal(c1.前缀, 'TK', '专项号是 S-1，子单绝不能跟着叫 S-2——那会跟下一个专项号撞车');
    assert.equal(c1.fm.项目, 'SLG'); assert.equal(c1.fm.管线, 'P-3');
    seed(root, '待投', { id: 'TK-90', 父单类型: '战役', 项目: 'SLG' });
    const c2 = brain.容器(root, 'TK-90');
    assert.equal(c2.专项, false);
    assert.deepEqual(c2.挂链, { 父单: 'TK-90' });
    assert.equal(c2.前缀, 'TK');
    assert.equal(brain.容器(root, 'S-9'), null);
  });

  await t('childFm：专项子单落 专项 章而非 父单 · 管线缺章时继承容器', async () => {
    const tk = { fm: { title: '大纲树拖拽', 职能: '程序', 依赖: '1' } };
    const 专 = brain.childFm(tk, { id: 'TK-2', ids: ['TK-1', 'TK-2'], 项目: 'SLG', 挂链: { 专项: 'S-1' }, 容器管线: 'P-3' });
    assert.equal(专.专项, 'S-1');
    assert.equal(专.父单, undefined, '专项子单没有父单——容器压根不是工单');
    assert.equal(专.管线, 'P-3', '专项子单没有工单父链可上溯，管线必须在落盘这一刻显式落下');
    assert.equal(专.依赖, 'TK-1', '同批序号 → 实际编号，口径不变');
    const 显 = brain.childFm({ fm: { title: 'x', 管线: 'P-9' } }, { id: 'TK-3', 挂链: { 专项: 'S-1' }, 容器管线: 'P-3' });
    assert.equal(显.管线, 'P-9', '子单自带管线章优先');
    const 战 = brain.childFm(tk, { id: 'TK-2', ids: ['TK-1', 'TK-2'], parentId: 'TK-90', 项目: 'SLG' });
    assert.equal(战.父单, 'TK-90', '战役老路一字未改');
    assert.equal(战.专项, undefined);
  });

  await t('on专项立项：落「切单启动」事件 + journal，候期出口语义原样保留（054）', async () => {
    const root = makeRoot();
    const r = 立(root, { 名称: '编辑器专项' });
    const w = wake.on专项立项(root, CFG, { id: r.id, fm: r.fm }, null, { test: true });
    assert.equal(w.woke, true);
    const e = pmLedger.events(root).find((x) => x.类型 === '切单启动');
    assert.equal(e.触发, '立项自动', '挂钩从「定稿」迁到「立项」');
    assert.equal(e.专项, 'S-1');
    // 054 三出口：拒切候期照旧不记失败、容器原位不动
    const 出 = wake.onCutResult(root, 'S-1', { ok: false, 候期: true, 理由: '承重方案未落袋', 复切时机: '方案单落袋后', 判语: '论证' });
    assert.equal(出.出口, '候期');
    assert.ok(pmLedger.events(root).some((x) => x.类型 === '切单候期' && x.父单 === 'S-1'));
    assert.ok(!pmLedger.events(root).some((x) => x.类型 === '切单失败'), '候期不记失败');
    assert.equal(SP.find(root, 'S-1').fm.状态, '立项', '容器原位不动，等条件齐了复切');
  });

  await t('想法拍板：落注册表条目，不再造伪工单', async () => {
    const root = makeRoot();
    const i = ideas.add(root, '把编辑器做出来');
    const r = ideas.拍板(root, i.idea.id, 'SLG', 'TK');
    assert.equal(r.ok, true);
    assert.equal(r.专项, 'S-1');
    assert.equal(r.父单, undefined, '不再产出父单号');
    const s = SP.find(root, 'S-1');
    assert.equal(s.fm.名称, '把编辑器做出来');
    assert.equal(s.fm.项目, 'SLG'); assert.equal(s.fm.单号前缀, 'TK');
    assert.equal(s.fm.状态, '立项');
    // 容器身上没有一格执行者字段（QA/验收方式/预计时间正是 TK-146/150 的病灶）
    for (const k of ['QA', '验收方式', '预计时间', '预计token', '规模', '职能', '父单类型']) {
      assert.equal(s.fm[k], undefined, `容器不该有 ${k} 字段`);
    }
    assert.equal(store.snapshot(root).草稿.length, 0, '拍板不再往工单目录里塞东西');
    assert.equal(ideas.list(root)[0].专项, 'S-1', '想法回链指专项');
  });

  /* ================= ⑤ 052 台账适配 ================= */

  await t('052 适配：专项批名=专项名 · 子单挂粒规则不变', async () => {
    const root = makeRoot();
    立(root, { 名称: '编辑器专项' });
    seed(root, '草稿', { id: 'TK-156', title: '大纲树拖拽', 专项: 'S-1', 职能: '程序', 依赖: ['TK-151'] });
    const { 动作 } = LS.差量(store.snapshot(root), S.现态(root), SP.list(root));
    assert.equal(动作.length, 1);
    const a = 动作[0];
    assert.equal(a.动作, '登粒');
    assert.equal(a.批, '编辑器专项', '批名 = 专项名（不是 S-1）');
    assert.equal(a.父单, 'S-1', '挂链指容器号');
    assert.equal(a.题, '大纲树拖拽'); assert.equal(a.序, 156); assert.equal(a.状态, '起草中');
    assert.deepEqual(a.依赖, [{ ref: 'TK-151', 规则: '全部完成' }], '依赖照 fm，规则一字未改');
    assert.equal(a.管线, '程序');
  });

  await t('052 适配：迁移后的伪单不登粒 · 散单照旧不登 · 战役老路零回归', async () => {
    const root = makeRoot();
    铺伪单(root);
    SP.迁移(root, [{ 单号: 'TK-150' }]);
    seed(root, '草稿', { id: 'TK-200', title: '散单' });                            // 无归属
    seed(root, '待投', { id: 'TK-90', title: '存量战役', 父单类型: '战役' });
    seed(root, '草稿', { id: 'TK-91', title: '战役子单', 父单: 'TK-90' });
    const { 动作 } = LS.差量(store.snapshot(root), S.现态(root), SP.list(root));
    const 号 = 动作.filter((a) => a.动作 === '登粒').map((a) => a.单号);
    assert.ok(!号.includes('TK-150'), '迁移后的伪单是纸面留档，不是活粒');
    assert.ok(!号.includes('TK-200'), '散单不归排程台账');
    assert.ok(!号.includes('TK-90'), '容器不是活粒');
    assert.ok(号.includes('TK-91'), '战役老路照旧登粒');
    assert.equal(动作.find((a) => a.单号 === 'TK-91').批, '存量战役', '战役批名仍取父单题');
    assert.equal(动作.find((a) => a.单号 === 'TK-156').批, '编辑器专项', '迁移过来的子单改按专项名归批');
  });

  await t('052 适配：不传专项表 → 退回战役老路（读盘失败不该把整拍带崩）', async () => {
    const root = makeRoot();
    立(root, { 名称: '编辑器专项' });
    seed(root, '草稿', { id: 'TK-156', title: '子单', 专项: 'S-1' });
    const { 动作 } = LS.差量(store.snapshot(root), S.现态(root)); // 第三参缺省
    assert.equal(动作.length, 0, '认不出容器就不登粒——少登几粒好过登错批');
  });

  await t('052 接线实拍：同步() 自己去读注册表（不靠调用方喂）', async () => {
    const root = makeRoot();
    立(root, { 名称: '编辑器专项' });
    seed(root, '草稿', { id: 'TK-156', title: '大纲树拖拽', 专项: 'S-1' });
    const r = LS.同步(root, { 触发: '首跑' });
    assert.equal(r.成.length, 1);
    const 粒 = S.现态(root);
    assert.equal(粒.length, 1);
    assert.equal(粒[0].批, '编辑器专项');
    assert.equal(粒[0].单号, 'TK-156');
  });

  /* ================= ⑥ 隔离与收口巡检 ================= */

  await t('收口巡检：全落袋 → 容器转收口 + 急件叫人关账（绝不代签）', async () => {
    const root = makeRoot();
    立(root, { 名称: '编辑器专项' });
    SP.转移(root, 'S-1', '进行');
    seed(root, '完成', { id: 'TK-1', 专项: 'S-1' });
    seed(root, '在途', { id: 'TK-2', 专项: 'S-1' });
    assert.deepEqual(wake.check专项收口(root, CFG, { test: true }), [], '有在途不收口');
    fs.renameSync(store.ticketPath(root, '在途', 'TK-2'), store.ticketPath(root, '完成', 'TK-2'));
    assert.deepEqual(wake.check专项收口(root, CFG, { test: true }), ['S-1']);
    assert.equal(SP.find(root, 'S-1').fm.状态, '收口');
    assert.notEqual(SP.find(root, 'S-1').fm.状态, '关账', '机器永远推不到关账——它没有签字人');
    assert.deepEqual(wake.check专项收口(root, CFG, { test: true }), [], '台账去重不重复唤醒');
    const 急 = inbox.list(root).find((x) => x.类型 === '专项待关账' && x.级别 === '急');
    assert.ok(急, '收口要叫人：不叫的话签字位就成了没人看的角落');
  });

  await t('收口巡检：复工把收口旗撤掉（不然复工后再落袋出不了第二版报告）', async () => {
    const root = makeRoot();
    立(root); SP.转移(root, 'S-1', '进行');
    seed(root, '完成', { id: 'TK-1', 专项: 'S-1' });
    wake.check专项收口(root, CFG, { test: true });
    assert.equal(pmLedger.read(root).已收口['S-1'], true);
    fs.renameSync(store.ticketPath(root, '完成', 'TK-1'), store.ticketPath(root, '草稿', 'TK-1'));
    wake.check专项收口(root, CFG, { test: true });               // 这一拍走复工
    assert.equal(SP.find(root, 'S-1').fm.状态, '进行');
    assert.equal((pmLedger.read(root).已收口 || {})['S-1'], undefined, '收口旗已撤');
    fs.renameSync(store.ticketPath(root, '草稿', 'TK-1'), store.ticketPath(root, '完成', 'TK-1'));
    assert.deepEqual(wake.check专项收口(root, CFG, { test: true }), ['S-1'], '再落袋重出收口');
  });

  await t('childrenOf：专项号走注册表判据，战役号走父单（一份判据，两条挂链）', async () => {
    const root = makeRoot();
    立(root, { 别名: ['TK-150'] });
    seed(root, '完成', { id: 'TK-1', 专项: 'S-1' });
    seed(root, '完成', { id: 'TK-2', 父单: 'TK-150' });
    seed(root, '完成', { id: 'TK-3', 父单: 'TK-90' });
    assert.deepEqual(wake.childrenOf(root, 'S-1').map((k) => k.id), ['TK-1', 'TK-2']);
    assert.deepEqual(wake.childrenOf(root, 'TK-90').map((k) => k.id), ['TK-3']);
  });

  await t('隔离实拍：专项不进工单目录 → 机判/QA/派发/预检全都够不着它', async () => {
    const root = makeRoot();
    立(root, { 名称: '编辑器专项' });
    // store 层：快照与全状态扫描里一个字都没有
    const snap = store.snapshot(root);
    assert.equal(Object.values(snap).flat().length, 0);
    assert.equal(store.find(root, 'S-1'), null);
    // 派发候选：待投里没有它 → 派发引擎连看都看不到
    const 待投 = store.list(root, '待投');
    assert.equal(待投.length, 0);
    // 初检候选（runner 的两检初检取的就是 待验收 列表）：同理为空
    assert.equal(store.list(root, '待验收').length, 0);
    // 预检不吃容器：它压根不是 store 认得的单
    const preflight = require('../lib/preflight');
    assert.deepEqual(preflight.preflight(root, null, CFG), [], '容器不进预检');
  });

  await t('派发实拍：专项子单派发 → 容器 立项 自动转 进行（走真 runner.tick，不拿 mock 冒充接线）', async () => {
    const root = makeRoot();
    const state = require('../lib/core/state');
    const runner = require('../lib/runner');
    const cfg = {
      执行器: { 派发制: true, 两检: { 开: false } },
      执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', 'QA'] } },
      编制: [{ 职能: 'QA', 池序: [{ 池: 'claude', 档: '' }] }],
      闸值: {},
    };
    state.update(root, (s) => { s.执行器 = { 运行: true }; });
    立(root, { 名称: '编辑器专项' });
    seed(root, '待投', { id: 'TK-1', 专项: 'S-1', 职能: '程序', 放行: true, QA: '关' });
    await runner.tick(root, cfg, { durMs: 0, noBrain: true });
    assert.notEqual(store.find(root, 'TK-1').state, '待投', '子单确实被派出去了（接线前提）');
    assert.equal(SP.find(root, 'S-1').fm.状态, '进行', 'H53 状态诚实映射：首子单派发 → 容器开工');
  });

  await t('追溯链：专项子单的详情页认得出自己的容器（不当孤儿）', async () => {
    const root = makeRoot();
    const trace = require('../lib/trace');
    立(root, { 名称: '编辑器专项' });
    seed(root, '在途', { id: 'TK-156', 专项: 'S-1' });
    seed(root, '在途', { id: 'TK-900', 专项: 'S-9' });   // 挂链写错：注册表里没这号
    seed(root, '在途', { id: 'TK-901' });                 // 散单
    const c = trace.chains(root, 'TK-156').专项;
    assert.deepEqual(c, { id: 'S-1', 名称: '编辑器专项', 状态: '立项', 在册: true });
    assert.equal(trace.chains(root, 'TK-900').专项.在册, false, '查无此号要如实说，不能装作挂对了');
    assert.equal(trace.chains(root, 'TK-901').专项, null, '散单没有这一格');
  });

  /* ================= ⑦ 前端：聚合条口径（从 public/app.js 原样抽出）================= */

  const { spAgg } = (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const a = src.indexOf('// @testable-begin spAgg');
    const b = src.indexOf('// @testable-end spAgg');
    assert.ok(a >= 0 && b > a, 'public/app.js 里的 spAgg 抽取标记丢了——测试与实现已脱钩');
    // eslint-disable-next-line no-new-func
    return new Function(src.slice(a, b) + '\nreturn { spAgg };')();
  })();

  await t('前端聚合条：段宽按数量分 · 零子单是空槽不是满条', async () => {
    const 空 = spAgg({ 总数: 0, 落袋: 0, 在办: 0, 未起: 0, 归档: 0, 百分比: 0 });
    assert.equal(空.空, true); assert.equal(空.百分比, 0); assert.deepEqual(空.段, []);
    const a = spAgg({ 总数: 4, 落袋: 1, 在办: 1, 未起: 1, 归档: 1, 百分比: 25 });
    assert.equal(a.空, false); assert.equal(a.百分比, 25);
    assert.deepEqual(a.段.map((g) => g.名), ['落袋', '在办', '未起', '归档']);
    assert.deepEqual(a.段.map((g) => g.宽), [25, 25, 25, 25], '四段等分铺满');
    const b = spAgg({ 总数: 2, 落袋: 2, 在办: 0, 未起: 0, 归档: 0, 百分比: 100 });
    assert.deepEqual(b.段.map((g) => g.名), ['落袋'], '零数量的段不出现（不画 0 宽的色块）');
    assert.equal(b.段[0].宽, 100);
    // 前端不自己算百分比：服务端给多少显示多少，两处各算一套正是 041 §四那道病
    assert.equal(spAgg({ 总数: 3, 落袋: 1, 百分比: 33 }).百分比, 33);
  });


// ── 完成定义闸（2026-08-20）：两次误催签字之后加的那道闸 ──
  await t('关账要对照完成定义：缺了就拒，并说清为什么', () => {
  const root = makeRoot();
  const s = SP.立项(root, { 名称: '重构专项', 操作者: '制作人' });
  SP.转移(root, s.id, '进行', { 操作者: '系统' });
  SP.转移(root, s.id, '收口', { 操作者: '系统' });
  const r = SP.关账(root, s.id, '制作人');
  assert.equal(r.ok, false, '没有完成定义不许关账');
  assert.equal(r.缺完成定义, true);
  assert.match(r.error, /不是「没活在跑了」/, '拒因要讲清道理——机器判得出没活在跑，判不出做完了');
  assert.equal(SP.find(root, s.id).fm.状态, '收口', '被拒后状态一动不动');
});

  await t('补完成定义后可关账；关账留痕带上对照的那句话', () => {
  const root = makeRoot();
  const s = SP.立项(root, { 名称: '重构专项', 操作者: '制作人' });
  SP.转移(root, s.id, '进行', { 操作者: '系统' });
  SP.转移(root, s.id, '收口', { 操作者: '系统' });
  assert.equal(SP.定完成定义(root, s.id, '   ').ok, false, '空的不算');
  assert.ok(SP.定完成定义(root, s.id, '制作人能顺手改图', '制作人').ok);
  const r = SP.关账(root, s.id, '制作人');
  assert.equal(r.ok, true);
  const h = SP.find(root, s.id).fm.履历;
  assert.match(h[h.length - 1].因, /制作人能顺手改图/, '签的是哪句话要留在账上');
});

  await t('完成定义改写记履历（旧的是什么半年后要查得到）', () => {
  const root = makeRoot();
  const s = SP.立项(root, { 名称: 'x', 完成定义: '旧的一句', 操作者: '制作人' });
  assert.equal(SP.find(root, s.id).fm.完成定义, '旧的一句', '立项即可带');
  SP.定完成定义(root, s.id, '新的一句', '制作人');
  const h = SP.find(root, s.id).fm.履历;
  assert.match(h[h.length - 1].因, /旧的一句.*→.*新的一句/);
});

  await t('类型只收枚举内的值，别的落 null（判不出类型说明边界没想清）', () => {
  const root = makeRoot();
  assert.equal(SP.立项(root, { 名称: 'a', 类型: '重构' }).fm.类型, '重构');
  assert.equal(SP.立项(root, { 名称: 'b', 类型: '瞎写' }).fm.类型, null);
  assert.deepEqual(SP.TYPES, ['调研', '建设', '重构', '修缮', '迁移']);
});

  console.log(`\n✓ specials 全部 ${passed} 项通过`);
})().catch((e) => { console.error('✗ ' + e.message); console.error(e.stack); process.exit(1); });
