// schedule.test.js — 排程台账（施工令-040 第 8 条）
// 被测面：状态机全转移矩阵（5×5 逐格）/ CAS 冲突拒写 / 事件折叠 / 迁移幂等 / H57 挂接钩子。
// 纪律：钩子那一格走**真 runner.tick**（模拟 draft→派发链），不拿 mock 冒充接线证据——
// 挂接点错了而单测全绿，正是施工令-039 那类事故的温床。
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeRoot, seed } = require('./helper');
const S = require('../lib/pm/schedule');
const store = require('../lib/core/store');
const state = require('../lib/core/state');
const quota = require('../lib/quota');
// 测试隔离（同 dispatch-tick 2026-08-05 案）：额度闸别去查真实订阅用量
quota.getRateLimits = async () => null; quota.getClaudeUsage = async () => null;

let passed = 0; const t = async (n, f) => { await f(); passed++; console.log('  ✓ ' + n); };
console.log('schedule 排程台账测试');

const 粒模板 = (o = {}) => ({ 批: '批C', 序: 1, 题: '面单一', 来源: '总清单.md §3 批C', ...o });
const 登记一 = (root, o = {}, 人 = '总监') => {
  const r = S.登记(root, [粒模板(o)], 人);
  assert.ok(r.ok, '登记应成功：' + r.error);
  assert.equal(r.新增.length, 1, '应新增 1 粒');
  return r.新增[0];
};

(async () => {
  // ---- ① 登记与校验 ----
  await t('登记：字段落全 + 默认状态计划 + 版本从 1 起', async () => {
    const root = makeRoot();
    const g = 登记一(root, { 管线: 'P-3', 池衡建议: 'claude', 预估单元: 2, 依赖: [{ ref: 'TK-127', 规则: '全部完成' }] });
    assert.ok(/^[0-9a-f-]{36}$/.test(g.粒ID), '粒ID 应为 UUID：' + g.粒ID);
    assert.equal(g.状态, '计划');
    assert.equal(g.版本号, 1);
    const now = S.取(root, g.粒ID);
    assert.equal(now.管线, 'P-3');
    assert.equal(now.池衡建议, 'claude');
    assert.equal(now.预估单元, 2);
    assert.deepEqual(now.依赖, [{ ref: 'TK-127', 规则: '全部完成' }]);
    assert.equal(now.来源, '总清单.md §3 批C');
  });

  await t('登记校验：一条不合法则整批不写（缺题/缺来源/非法规则/终态无单号）', async () => {
    const root = makeRoot();
    const 坏 = [
      [{ 批: '批C', 题: '', 来源: 'x' }, '题必填'],
      [{ 批: '批C', 题: 'a', 来源: '' }, '来源必填'],
      [{ 批: '', 题: 'a', 来源: 'x' }, '批必填'],
      [{ 批: '批C', 题: 'a', 来源: 'x', 状态: '飞升' }, '未知状态'],
      [{ 批: '批C', 题: 'a', 来源: 'x', 依赖: [{ ref: 'TK-1', 规则: '差不多完成' }] }, '依赖规则'],
      [{ 批: '批C', 题: 'a', 来源: 'x', 依赖: [{ 规则: '全部完成' }] }, '缺 ref'],
      [{ 批: '批C', 题: 'a', 来源: 'x', 状态: '已成单' }, '必须回填单号'],
      [{ 批: '批C', 题: 'a', 来源: 'x', 序: 1.5 }, '序须为非负整数'],
    ];
    for (const [粒, 词] of 坏) {
      const r = S.登记(root, [粒模板(), 粒], '总监'); // 混在合法粒里：整批口径要求合法的那条也不许落
      assert.ok(!r.ok, `应拒：${词}`);
      assert.ok(r.error.includes(词), `拒因应含「${词}」，实际：${r.error}`);
      assert.equal(S.现态(root).length, 0, '整批未写入：一条不合法则一条都不落');
    }
  });

  await t('登记：操作域限总监/项管，越权拒', async () => {
    const root = makeRoot();
    const r = S.登记(root, [粒模板()], '执行agent');
    assert.ok(!r.ok && r.越权, '非总监/项管应越权拒');
    assert.equal(S.现态(root).length, 0);
    assert.ok(S.登记(root, [粒模板()], '项管').ok, '项管可登记');
  });

  // ---- ② 事件折叠 ----
  await t('事件折叠：只追加不覆盖，现态=事件序列折叠结果', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    const 行数 = () => fs.readFileSync(S.LOG(root), 'utf8').split(/\r?\n/).filter(Boolean).length;
    assert.equal(行数(), 1, '登记 1 事件');
    S.调整(root, { 粒ID: g.粒ID, 预期版本: 1, 序: 7, 操作者: '项管' });
    S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 2, 操作者: '项管', 单号: 'TK-200' });
    S.转移(root, { 粒ID: g.粒ID, 目标: '已成单', 预期版本: 3, 操作者: '项管' });
    assert.equal(行数(), 4, '四次写盘=四条事件（只追加）');
    const now = S.取(root, g.粒ID);
    assert.equal(now.序, 7, '调整字段被折叠进现态');
    assert.equal(now.状态, '已成单');
    assert.equal(now.单号, 'TK-200', '单号回填后一路带着走');
    assert.equal(now.版本号, 4);
    // 事件形状（第 1 条口径）：粒ID/事件类型/字段变更/版本号/时刻/操作者
    for (const e of S.事件流(root)) {
      for (const k of ['粒ID', '事件类型', '字段变更', '版本号', '时刻', '操作者']) assert.ok(k in e, `事件缺字段 ${k}：${JSON.stringify(e)}`);
    }
    // 折叠是纯函数：同一串事件反复折叠结果一致
    assert.deepEqual(S.折叠(S.事件流(root)).get(g.粒ID), now);
  });

  await t('事件折叠：坏行跳过不炸；拒绝事件不改现态也不进版本', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    fs.appendFileSync(S.LOG(root), '{坏行不是 json\n', 'utf8');
    assert.equal(S.取(root, g.粒ID).版本号, 1, '坏行不影响折叠');
    S.转移(root, { 粒ID: g.粒ID, 目标: '完成', 预期版本: 1, 操作者: '总监' }); // 非法：留拒绝痕
    const now = S.取(root, g.粒ID);
    assert.equal(now.状态, '计划', '被拒的转移不改状态');
    assert.equal(now.版本号, 1, '拒绝事件不顶高版本（否则在重试的调用方全被 CAS 误伤）');
    assert.ok(S.事件流(root).some((e) => e.事件类型 === '拒绝' && e.因.includes('不合法的转移')), '非法转移须留痕');
  });

  // ---- ③ 状态机全转移矩阵 ----
  await t('状态机全转移矩阵：5×5 逐格（合法必成 / 非法必拒且留痕）', async () => {
    const root = makeRoot();
    const 合法 = { 计划: ['起草中', '撤销'], 起草中: ['已成单', '撤销'], 已成单: ['完成'], 完成: [], 撤销: [] };
    let 成 = 0; let 拒 = 0;
    for (const from of S.状态全集) {
      for (const to of S.状态全集) {
        const g = 登记一(root, {
          题: `${from}→${to}`, 来源: '矩阵',
          状态: from, ...(['已成单', '完成'].includes(from) ? { 单号: 'TK-900' } : {}),
        });
        const r = S.转移(root, { 粒ID: g.粒ID, 目标: to, 预期版本: 1, 操作者: '总监', 单号: 'TK-901' });
        const 应成 = 合法[from].includes(to);
        assert.equal(!!r.ok, 应成, `${from} → ${to} 期望 ${应成 ? '放行' : '拒绝'}，实际 ${r.ok ? '放行' : '拒绝：' + r.error}`);
        const now = S.取(root, g.粒ID);
        assert.equal(now.状态, 应成 ? to : from, `${from} → ${to} 落态错`);
        assert.equal(now.版本号, 应成 ? 2 : 1, `${from} → ${to} 版本错`);
        if (应成) 成++; else { 拒++; assert.ok(S.事件流(root).some((e) => e.粒ID === g.粒ID && e.事件类型 === '拒绝'), `${from} → ${to} 拒绝未留痕`); }
      }
    }
    assert.equal(成, 5, '合法转移恰 5 条（计划→起草中/撤销、起草中→已成单/撤销、已成单→完成）');
    assert.equal(拒, 20, '其余 20 格全拒');
  });

  await t('已成单不可直接撤销：拒因点名「先收回工单」，不是一句「不合法」', async () => {
    const root = makeRoot();
    const g = 登记一(root, { 状态: '已成单', 单号: 'TK-134' });
    const r = S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: 1, 操作者: '总监' });
    assert.ok(!r.ok);
    assert.ok(r.error.includes('先收回对应工单') && r.error.includes('TK-134'), '拒因要给出下一步动作：' + r.error);
    assert.equal(S.取(root, g.粒ID).状态, '已成单');
  });

  await t('转「已成单」必须有单号；未知目标态/同态转移一律拒', async () => {
    const root = makeRoot();
    const g = 登记一(root, { 状态: '起草中' });
    assert.ok(!S.转移(root, { 粒ID: g.粒ID, 目标: '已成单', 预期版本: 1, 操作者: '总监' }).ok, '无单号不得成单');
    assert.ok(!S.转移(root, { 粒ID: g.粒ID, 目标: '飞升', 预期版本: 1, 操作者: '总监' }).ok, '未知状态');
    assert.ok(!S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 1, 操作者: '总监' }).ok, '同态转移');
    assert.ok(!S.转移(root, { 粒ID: 'no-such', 目标: '撤销', 预期版本: 1, 操作者: '总监' }).ok, '粒不存在');
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '已成单', 预期版本: 1, 操作者: '总监', 单号: 'TK-1' }).ok);
  });

  // ---- ④ CAS ----
  await t('CAS：旧版本写被拒并回现态；缺预期版本也拒；正确版本才放行', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    const 甲 = S.取(root, g.粒ID); const 乙 = S.取(root, g.粒ID); // 两个调用方读到同一现态
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 甲.版本号, 操作者: '总监', 单号: 'TK-2' }).ok, '甲先手成功');
    const r = S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: 乙.版本号, 操作者: '项管' });
    assert.ok(!r.ok && r.冲突, '乙拿旧版本写应被拒');
    assert.ok(r.现态 && r.现态.版本号 === 2 && r.现态.状态 === '起草中', '拒了要把现态交回去供重试：' + JSON.stringify(r.现态));
    assert.equal(S.事件流(root).filter((e) => e.事件类型 === '拒绝').length, 0, 'CAS 冲突不刷审计（重试是正常流量）');
    for (const v of [undefined, '', 'abc']) {
      const bad = S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: v, 操作者: '总监' });
      assert.ok(!bad.ok && /预期版本/.test(bad.error), '预期版本缺失/非整数应拒：' + JSON.stringify(v));
    }
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: r.现态.版本号, 操作者: '项管' }).ok, '按现态重试成功');
  });

  await t('CAS 同样管住调整；调整只开序/依赖/池衡，终态与越权拒', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    assert.ok(!S.调整(root, { 粒ID: g.粒ID, 预期版本: 99, 序: 3, 操作者: '项管' }).ok, '版本不符拒');
    const 越 = S.调整(root, { 粒ID: g.粒ID, 预期版本: 1, 序: 3, 操作者: '美术' });
    assert.ok(!越.ok && 越.越权, '非项管/总监调整应越权拒（H99 项管域）');
    const r = S.调整(root, { 粒ID: g.粒ID, 预期版本: 1, 序: 3, 依赖: [{ ref: 'TK-9', 规则: '任一完成' }], 池衡建议: 'codex', 操作者: '项管' });
    assert.ok(r.ok, r.error);
    const now = S.取(root, g.粒ID);
    assert.equal(now.序, 3); assert.equal(now.池衡建议, 'codex');
    assert.deepEqual(now.依赖, [{ ref: 'TK-9', 规则: '任一完成' }]);
    assert.equal(now.版本号, 2);
    assert.ok(!S.调整(root, { 粒ID: g.粒ID, 预期版本: 2, 操作者: '项管' }).ok, '一个可改字段都没给应拒');
    assert.ok(!S.调整(root, { 粒ID: g.粒ID, 预期版本: 2, 依赖: [{ ref: g.粒ID, 规则: '全部完成' }], 操作者: '项管' }).ok, '依赖不能指向自己');
    S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: 2, 操作者: '总监' });
    const 终 = S.取(root, g.粒ID);
    assert.ok(!S.调整(root, { 粒ID: g.粒ID, 预期版本: 终.版本号, 序: 9, 操作者: '项管' }).ok, '终态粒不可调整');
  });

  // ---- ⑤ 迁移幂等 ----
  const 清单MD = [
    '# 汉代地图修缮总清单', '', '## 2 背景', '略', '',
    '## 3 批次表', '',
    '| 批 | 序 | 题 | 状态 | 单号 | 预估单元 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 批0 | 1 | 底图对齐 | 完成 | TK-127 | 1 |',
    '| 批A | 1 | 水系描线 | 完成 | TK-128 | 2 |',
    '| 批A | 2 | 水系上色 | 在途 | TK-129 | 2 |',
    '| 批B | 1 | 城邑点位 | 完成 | TK-130 | 1 |',
    '| 批B | 2 | 城邑标注 | 在途 | TK-131 | 1 |',
    '', '### 批C 五幅面单', '',
    '1. 关中面单', '2. 河北面单', '3. 江淮面单', '4. 巴蜀面单', '5. 岭南面单', '',
    '### 批D', '', '- 图例统一', '- 比例尺重绘', '',
    '### 批E', '', '- 成图总校', '',
    '## 4 其它', '不该被解析的东西',
  ].join('\n');
  const 巡礼MD = [
    '# 点名巡礼', '## 五 结论', '略', '',
    '## 六 后续队列', '',
    '- **Q1**：排程台账后端（施工令-040）',
    '- **Q2**：排程消费接线',
    '- **Q3**：晨晚报接线',
    '- **Q4**：额度感知排程',
    '- **Q5**：批次进度可视化',
    '- **Q6**：历史队列归档',
    '', '## 七 附录', '不该被解析的东西',
  ].join('\n');

  await t('迁移：§3 批次表（表格+列表两种写法）与 §六 队列全解析，终态回填单号', async () => {
    const M = require('../scripts/migrate-schedule');
    const root = makeRoot();
    const r = M.迁移(root, { 清单文本: 清单MD, 清单名: '汉代地图修缮总清单.md', 巡礼文本: 巡礼MD, 巡礼名: '巡礼报告.md', 操作者: '总监' });
    assert.ok(r.ok, r.error);
    const 全 = S.现态(root);
    assert.equal(全.length, 19, `批0/A/B 5 + 批C 5 + 批D 2 + 批E 1 + Q1-Q6 6 = 19（实际 ${全.length}）`);
    const 批C = 全.filter((g) => g.批 === '批C');
    assert.equal(批C.length, 5, '批C 五幅面单');
    assert.deepEqual(批C.map((g) => g.序), [1, 2, 3, 4, 5], '列表项按出现次序补序');
    assert.ok(批C.every((g) => g.状态 === '计划' && g.来源 === '汉代地图修缮总清单.md §3 批C'), '批C 全为计划粒，来源落到准确章节');
    assert.equal(全.filter((g) => g.批 === '批D').length, 2);
    assert.equal(全.filter((g) => g.批 === '批E').length, 1);
    // 终态回填：完成 3 张 + 在途 2 张，单号一一对上
    const 终 = 全.filter((g) => ['已成单', '完成'].includes(g.状态));
    assert.equal(终.length, 5, '批0/A/B 五项生成终态');
    assert.deepEqual(终.map((g) => g.单号).sort(), ['TK-127', 'TK-128', 'TK-129', 'TK-130', 'TK-131']);
    assert.equal(全.find((g) => g.题 === '水系上色').状态, '已成单', '文档「在途」→ 已成单');
    assert.equal(全.find((g) => g.题 === '底图对齐').状态, '完成');
    const q = 全.filter((g) => g.批 === 'Q队列');
    assert.equal(q.length, 6, 'Q1-Q6');
    assert.deepEqual(q.map((g) => g.序), [1, 2, 3, 4, 5, 6]);
    assert.equal(q[0].来源, '巡礼报告.md §六 Q1', '来源落到 Q 号');
    assert.ok(!全.some((g) => /不该被解析/.test(g.题)), '章节切片不许溢出到下一章');
  });

  await t('迁移幂等：重跑零新增全跳过（判重键=来源+题）', async () => {
    const M = require('../scripts/migrate-schedule');
    const root = makeRoot();
    const 参 = { 清单文本: 清单MD, 清单名: '汉代地图修缮总清单.md', 巡礼文本: 巡礼MD, 巡礼名: '巡礼报告.md', 操作者: '总监' };
    const a = M.迁移(root, 参);
    const 行数1 = fs.readFileSync(S.LOG(root), 'utf8').split(/\r?\n/).filter(Boolean).length;
    const b = M.迁移(root, 参);
    assert.ok(b.ok);
    assert.equal(b.新增.length, 0, '重跑零新增');
    assert.equal(b.跳过.length, a.新增.length, '全部判重跳过');
    assert.equal(fs.readFileSync(S.LOG(root), 'utf8').split(/\r?\n/).filter(Boolean).length, 行数1, '重跑一个字节都不该写');
    assert.equal(S.现态(root).length, 19, '账里还是 19 粒');
    // 迁移后人工改了序（调整 API），再重跑仍不重复——判重键不含会变的字段
    const g = S.现态(root)[0];
    S.调整(root, { 粒ID: g.粒ID, 预期版本: g.版本号, 序: 99, 操作者: '项管' });
    assert.equal(M.迁移(root, 参).新增.length, 0, '改过序的粒仍判为同一粒');
  });

  await t('迁移：解析零命中 → 失败退出，绝不"成功地写进 0 条"', async () => {
    const M = require('../scripts/migrate-schedule');
    const root = makeRoot();
    const r = M.迁移(root, { 清单文本: '# 空文档\n没有批次章节', 清单名: 'x.md' });
    assert.ok(!r.ok && /0 条/.test(r.error), '零命中必须报错：' + JSON.stringify(r));
    assert.ok(!fs.existsSync(S.LOG(root)), '零命中不建账本');
    const d = M.迁移(root, { 清单文本: 清单MD, 清单名: 'x.md', dry: true });
    assert.ok(d.ok && d.dry && d.粒.length === 13 && !fs.existsSync(S.LOG(root)), '--dry 只解析不写盘');
  });

  // ---- ⑥ H57 挂接钩子：模拟 draft → 派发 全链 ----
  await t('挂接钩子：起草落草稿 → 粒转起草中并回填单号（含 frontmatter 白名单）', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    const r = S.挂钩起草(root, g.粒ID, 'TK-140');
    assert.ok(r.ok, r.error);
    const now = S.取(root, g.粒ID);
    assert.equal(now.状态, '起草中');
    assert.equal(now.单号, 'TK-140');
    assert.equal(now.末次操作者, '系统·H57起草');
    // draftFm 白名单要带得动 粒ID，否则工单上认不出它兑现的是哪条计划（TK-106~116 同款漏面）
    const fm = require('../lib/pm/brain').draftFm({ fm: { title: 'x' } }, { id: 'TK-140', 项目: 'TK', 粒ID: g.粒ID });
    assert.equal(fm.粒ID, g.粒ID, 'draftFm 须落 粒ID');
    assert.ok(!('粒ID' in require('../lib/pm/brain').draftFm({ fm: {} }, { id: 'TK-141', 项目: 'TK' })), '不带粒ID时不该凭空长出字段');
    assert.ok(!S.挂钩起草(root, '不存在的粒', 'TK-1').ok, '粒不存在 → 无关，不炸');
  });

  await t('挂接钩子：真 runner.tick 派发 → 粒转已成单（draft→派发链贯通）', async () => {
    const runner = require('../lib/runner');
    const CFG = { 执行器: { 派发制: true }, 执行池: { codex: { 职能: ['程序'] }, claude: { 职能: ['策划', 'QA'] } }, 编制: [{ 职能: 'QA', 池序: [{ 池: 'claude', 档: '' }] }], 闸值: {} };
    const root = makeRoot();
    state.update(root, (s) => { s.执行器 = { 运行: true }; });
    const g = 登记一(root);
    S.挂钩起草(root, g.粒ID, 'TK-150');              // 起草半：粒 → 起草中
    seed(root, '待投', { id: 'TK-150', 职能: '程序', 放行: true, QA: '关', 粒ID: g.粒ID }); // 定稿放行后的形态
    seed(root, '待投', { id: 'TK-151', 职能: '程序', 放行: true, QA: '关' });               // 无粒ID 的普通单：钩子须当无关放过
    await runner.tick(root, CFG, { durMs: 0 });
    assert.notEqual(store.find(root, 'TK-150').state, '待投', '单已被派发');
    const now = S.取(root, g.粒ID);
    assert.equal(now.状态, '已成单', '派发时粒应转已成单（当前 ' + now.状态 + '）');
    assert.equal(now.单号, 'TK-150');
    assert.equal(now.末次操作者, '系统·派发');
    assert.equal(S.现态(root).length, 1, '无粒ID 的单不该在账里凭空造粒');
  });

  await t('挂接钩子：重复派发幂等 / 计划态补链 / 认不出的单不写盘', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    S.挂钩起草(root, g.粒ID, 'TK-160');
    assert.ok(S.挂钩派发(root, 'TK-160', g.粒ID).ok);
    const v = S.取(root, g.粒ID).版本号;
    const 再 = S.挂钩派发(root, 'TK-160', g.粒ID);
    assert.ok(再.ok && 再.幂等, '收回重投再派发应幂等，不该报错');
    assert.equal(S.取(root, g.粒ID).版本号, v, '幂等路径不写盘');
    // 手工起草的单（没走 /api/pm/draft）：粒还停在计划 → 补起草中一步再成单，状态机不放宽
    const g2 = 登记一(root, { 题: '手工单', 来源: '手工' });
    assert.ok(S.挂钩派发(root, 'TK-161', g2.粒ID).ok);
    const n2 = S.取(root, g2.粒ID);
    assert.equal(n2.状态, '已成单');
    assert.equal(n2.版本号, 3, '补链=两次转移（计划→起草中→已成单）');
    assert.ok(S.事件流(root).some((e) => e.粒ID === g2.粒ID && e.操作者 === '系统·派发补链'), '补链要留痕');
    // 按单号回查：粒ID 丢了也能靠单号找回；两者都对不上则「无关」，一个字节都不写
    const g3 = 登记一(root, { 题: '按单号回查', 来源: '回查' });
    S.挂钩起草(root, g3.粒ID, 'TK-162');
    assert.ok(S.挂钩派发(root, 'TK-162', undefined).ok, '仅凭单号也应认出');
    const 行前 = fs.readFileSync(S.LOG(root), 'utf8').length;
    const r = S.挂钩派发(root, 'TK-999', undefined);
    assert.ok(!r.ok && r.无关, '认不出的单应回「无关」');
    assert.equal(fs.readFileSync(S.LOG(root), 'utf8').length, 行前, '无关的单不产生任何写盘');
  });

  await t('现态列表按 批/序 排序（消费端不必各排各的）', async () => {
    const root = makeRoot();
    S.登记(root, [
      { 批: '批D', 序: 2, 题: 'd2', 来源: 's4' }, { 批: '批C', 序: 2, 题: 'c2', 来源: 's2' },
      { 批: '批D', 序: 1, 题: 'd1', 来源: 's3' }, { 批: '批C', 序: 1, 题: 'c1', 来源: 's1' },
    ], '总监');
    assert.deepEqual(S.现态(root).map((g) => g.题), ['c1', 'c2', 'd1', 'd2']);
  });

  // ---- ⑦ 四条路由实跑（桩台起服务）----
  // 必须真起服务打一遍：本令实测踩到 express 4 的坑——中文字面量路由按**原始 URL**匹配，
  // 而 fetch 发的是百分号编码，四条路由在单测里怎么调都对、一进浏览器全 404。
  // 这一格锁的就是「中文动作名真的路由得到」。桩台模式（STUDIO_STUB=1）：零派发零计费。
  await t('四条路由实跑：中文路径可达 + 状态码语义（200/403/409/400）', async () => {
    const { execFileSync } = require('child_process');
    const root = makeRoot();
    const p = path.join(root, 'studio.config.json');
    const c = JSON.parse(fs.readFileSync(p, 'utf8'));
    c.执行器 = { ...(c.执行器 || {}), 派发制: true };
    fs.writeFileSync(p, JSON.stringify(c), 'utf8');
    const port = 4932;
    // 收尾用 srv.close() 让事件循环自然排空，不用 process.exit——服务还在监听时硬退，
    // Windows 上 libuv 会 abort（同 stub.test ③ 的注释，实测同款）。
    const code = `
      require(${JSON.stringify(path.join(__dirname, '..', 'server.js'))}).start().then(async ({ server: srv }) => {
        const B = 'http://127.0.0.1:${port}';
        const P = async (u, body) => { const r = await fetch(B + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return [r.status, await r.json()]; };
        const G = async (u) => { const r = await fetch(B + u); return [r.status, await r.json()]; };
        const out = {};
        let [s, j] = await P('/api/schedule/登记', { 操作者: '总监', 粒: [
          { 批: '批C', 序: 1, 题: '关中面单', 来源: '总清单.md §3 批C' },
          { 批: '批0', 序: 1, 题: '底图对齐', 来源: '总清单.md §3 批0', 状态: '完成', 单号: 'TK-127' } ] });
        out.登记 = [s, j.新增.length]; const 粒ID = j.新增[0].粒ID;
        [s, j] = await P('/api/schedule/登记', { 操作者: '美术', 粒: [{ 批: 'x', 题: 'y', 来源: 'z' }] });
        out.越权 = [s, j.越权 === true];
        [s, j] = await G('/api/schedule'); out.现态 = [s, j.粒.map((g) => g.批 + '#' + g.序 + g.状态), j.计数];
        [s, j] = await P('/api/schedule/调整', { 操作者: '项管', 粒ID, 预期版本: 1, 序: 5, 池衡建议: 'claude' });
        out.调整 = [s, j.粒.序];
        [s, j] = await P('/api/schedule/调整', { 操作者: '项管', 粒ID, 预期版本: 1, 序: 9 });
        out.冲突 = [s, j.冲突 === true, j.现态 && j.现态.版本号];
        [s, j] = await P('/api/schedule/转移', { 操作者: '总监', 粒ID, 目标: '起草中', 预期版本: 2, 单号: 'TK-200' });
        out.转移 = [s, j.粒.状态, j.粒.单号];
        [s, j] = await P('/api/schedule/转移', { 操作者: '总监', 粒ID, 目标: '完成', 预期版本: 3 });
        out.非法 = [s, j.error];
        [s, j] = await P('/api/schedule/无此动作', { 操作者: '总监' }); out.未知 = [s];
        process.stdout.write('@@' + JSON.stringify(out) + '@@');
        srv.close();
      });`;
    const stdout = execFileSync(process.execPath, ['-e', code], {
      env: { ...process.env, STUDIO_STUB: '1', STUDIO_ROOT: root, STUDIO_PORT: String(port) }, encoding: 'utf8', timeout: 60000,
    });
    const v = JSON.parse(stdout.split('@@')[1]);
    assert.deepEqual(v.登记, [200, 2], 'POST /api/schedule/登记 应 200 且新增 2 粒（中文路径可达）');
    assert.deepEqual(v.越权, [403, true], '非总监/项管登记应 403');
    assert.equal(v.现态[0], 200);
    assert.deepEqual(v.现态[1], ['批0#1完成', '批C#1计划'], 'GET 应按 批/序 排序下发');
    assert.equal(v.现态[2].计划, 1);
    assert.deepEqual(v.调整, [200, 5], '调整应 200 且序改到 5');
    assert.deepEqual(v.冲突, [409, true, 2], '拿旧版本重写应 409 并回现态');
    assert.deepEqual(v.转移, [200, '起草中', 'TK-200']);
    assert.equal(v.非法[0], 400, '非法转移应 400');
    assert.match(v.非法[1], /不合法的转移/);
    assert.deepEqual(v.未知, [404], '未知动作应 404');
  });

  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error('  ✗ ' + (e.stack || e.message)); process.exit(1); });
