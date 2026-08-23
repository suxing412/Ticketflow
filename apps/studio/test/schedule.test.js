// schedule.test.js — 排程台账（施工令-040 第 8 条）
// 被测面：状态机全转移矩阵（5×5 逐格）/ CAS 冲突拒写 / 事件折叠 / 迁移幂等 / H57 挂接钩子。
// 纪律：钩子那一格走**真 runner.tick**（模拟 draft→派发链），不拿 mock 冒充接线证据——
// 挂接点错了而单测全绿，正是施工令-039 那类事故的温床。
// 外呼绊线必须排在任何 lib/ 之前：lib/quota.js 在加载那一刻就把 child_process 解构走了（体检 #71）
const 绊线 = require('./外呼绊线'); 绊线.装绊线();
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
      // 批 已于 2026-08-21 降级为可选（制作人：「待办队列里放着的就是专项或是工单，
      // 不要给我放什么批什么批，这个会很奇怪，这不是我们的正常工作单元」）。
      // 新轴是 型 + 上级，下面三条替上原来那条「批必填」。
      [{ 题: 'a', 来源: 'x', 型: '战役' }, '型只能是'],
      [{ 题: 'a', 来源: 'x', 上级: 'X-9' }, '上级须为特性号'],
      [{ 题: 'a', 来源: 'x', 型: '专项', 上级: 'S-1' }, '型=专项 的上级只能是特性'],
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
    S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 2, 操作者: '总监', 单号: 'TK-200' }); // 派单闸=人闸，项管无此边（2026-08-20）
    S.转移(root, { 粒ID: g.粒ID, 目标: '已成单', 预期版本: 3, 操作者: '总监' });
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
    const r = S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: 乙.版本号, 操作者: '总监' });
    assert.ok(!r.ok && r.冲突, '乙拿旧版本写应被拒');
    assert.ok(r.现态 && r.现态.版本号 === 2 && r.现态.状态 === '起草中', '拒了要把现态交回去供重试：' + JSON.stringify(r.现态));
    assert.equal(S.事件流(root).filter((e) => e.事件类型 === '拒绝').length, 0, 'CAS 冲突不刷审计（重试是正常流量）');
    for (const v of [undefined, '', 'abc']) {
      const bad = S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: v, 操作者: '总监' });
      assert.ok(!bad.ok && /预期版本/.test(bad.error), '预期版本缺失/非整数应拒：' + JSON.stringify(v));
    }
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: r.现态.版本号, 操作者: '总监' }).ok, '按现态重试成功');
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
    assert.ok(批C.every((g) => g.状态 === '计划' && g.来源 === '汉代地图修缮总清单.md §3 批C'), '批C 全为计划态待办，来源落到准确章节');
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
    seed(root, '待派', { id: 'TK-150', 职能: '程序', 放行: true, QA: '关', 粒ID: g.粒ID }); // 定稿放行后的形态
    seed(root, '待派', { id: 'TK-151', 职能: '程序', 放行: true, QA: '关' });               // 无粒ID 的普通单：钩子须当无关放过
    await runner.tick(root, CFG, { durMs: 0 });
    assert.notEqual(store.find(root, 'TK-150').state, '待派', '单已被派发');
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

  await t('现态列表按 上级/序 排序，散单垫底（2026-08-21 换轴，原按 批/序）', async () => {
    // 制作人：「待办队列里放着的就是专项或是工单，不要给我放什么批什么批」。
    // 归了属的先看、散着的垫底——这才是「归属结构」该有的读法。
    const root = makeRoot();
    S.登记(root, [
      { 上级: 'S-1', 序: 2, 题: 's1-2', 来源: 'a4' }, { 上级: 'F-3', 序: 2, 题: 'f3-2', 来源: 'a2' },
      { 序: 9, 题: '散甲', 来源: 'a5' },
      { 上级: 'S-1', 序: 1, 题: 's1-1', 来源: 'a3' }, { 上级: 'F-3', 序: 1, 题: 'f3-1', 来源: 'a1' },
      { 序: 1, 题: '散乙', 来源: 'a6' },
    ], '总监');
    assert.deepEqual(S.现态(root).map((g) => g.题), ['f3-1', 'f3-2', 's1-1', 's1-2', '散乙', '散甲'],
      '上级内按序，上级间按号（F 在 S 前），散单整体垫底');
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


  // ── 逐边操作域（2026-08-20 制作人重定职责：闸前项管能动，闸本身是人闸，闸后项管全权）──
  await t('派单闸：项管推不动 计划→起草中（待办进工单队列是人闸），总监/制作人可以', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    const 拒 = S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 1, 操作者: '项管', 单号: 'TK-300' });
    assert.equal(拒.ok, false, '项管不得自行派单');
    assert.match(拒.error, /转移权在 总监\/制作人/);
    assert.match(拒.error, /派单是人闸/, '拒因要讲清为什么，不是干巴巴一句无权');
    assert.equal(S.取(root, g.粒ID).状态, '计划', '被拒后状态一动不动');
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 1, 操作者: '制作人', 单号: 'TK-300' }).ok, '制作人可派单');
  });

  await t('闸后归项管：已成单→完成 项管有权（推进落地是它的全权）', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 1, 操作者: '总监', 单号: 'TK-301' });
    S.转移(root, { 粒ID: g.粒ID, 目标: '已成单', 预期版本: 2, 操作者: '总监' });
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '完成', 预期版本: 3, 操作者: '项管' }).ok, '闸后项管全权推进');
  });

  await t('销毁性判断归人：项管撤不掉粒', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    assert.equal(S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: 1, 操作者: '项管' }).ok, false);
  });

  await t('系统方豁免：台账对齐/派发补链不受人闸拦（机器记录既成事实，不是行使权力）', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 1, 操作者: '系统·派发', 单号: 'TK-302' }).ok);
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '已成单', 预期版本: 2, 操作者: '系统·台账对齐' }).ok);
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '完成', 预期版本: 3, 操作者: '系统·台账对齐' }).ok, '拿人闸拦机器回填只会让台账停在错的状态上');
  });

  // ── ⑧ 待办队列数据模型（2026-08-20 制作人：排期由项管全权维护并产出甘特图，延期/超期完成须重排）──
  // 这一段修的是三个**结构性空洞**：白名单里没有任何时间字段（甘特图物理上画不出来）、
  // 没有 就绪（G8 人闸的判据恒空）、没有重排动作（延期无从记录，更无从追责到哪一天挪的）。

  await t('时间字段：登记落 计划开始/计划完成/工期天，并按「首次排期」立基线', async () => {
    const root = makeRoot();
    const g = 登记一(root, { 计划开始: '2026-08-20', 计划完成: '2026-08-24', 工期天: 3, 因: '首排' }); // P0-8：带日期必带因
    const now = S.取(root, g.粒ID);
    assert.equal(now.计划开始, '2026-08-20');
    assert.equal(now.计划完成, '2026-08-24');
    assert.equal(now.工期天, 3);
    assert.equal(now.就绪, false, '就绪缺省 false');
    assert.deepEqual([now.基线开始, now.基线完成], ['2026-08-20', '2026-08-24'],
      '登记即首次排期：基线跟着立，否则第一次重排没有比较对象，延期永远算成 0');
    // 不带日期的粒三格全 null——既有 173 张老粒就是这形态，强制必填等于把整本老账判非法
    const n2 = S.取(root, 登记一(root, { 题: '无日期', 来源: '老账' }).粒ID);
    assert.deepEqual([n2.计划开始, n2.计划完成, n2.工期天, n2.基线完成], [null, null, null, null]);
    // ISO 时刻串按日归一：前端传 datetime、后端存 date，两种写法都认，存的一律是日
    assert.equal(S.取(root, 登记一(root, { 题: 'ISO时刻', 来源: 'ISO', 计划完成: '2026-09-01T10:30:00.000Z', 因: '首排' }).粒ID).计划完成, '2026-09-01');
  });

  await t('时间字段校验：坏格式/不存在的日期/开始晚于完成/负工期/非布尔就绪 → 整批不写', async () => {
    const root = makeRoot();
    const 坏 = [
      [{ 计划开始: '2026/08/20' }, 'ISO 日期串'],
      [{ 计划完成: '20260820' }, 'ISO 日期串'],
      [{ 计划完成: '2026-02-30' }, '不是真实存在的日期'],
      [{ 计划开始: '2026-08-24', 计划完成: '2026-08-20' }, '计划开始须早于或等于计划完成'],
      [{ 工期天: -1 }, '工期天须为非负数'],
      [{ 工期天: 'abc' }, '工期天须为非负数'],
      [{ 就绪: 'true' }, '就绪须为布尔'],
    ];
    for (const [补, 词] of 坏) {
      const r = S.登记(root, [粒模板(), 粒模板({ 题: '坏粒', ...补 })], '总监');
      assert.ok(!r.ok, `应拒：${词}`);
      assert.ok(r.error.includes(词), `拒因应含「${词}」，实际：${r.error}`);
      assert.equal(S.现态(root).length, 0, '整批未写入：一条不合法则一条都不落');
    }
    assert.ok(S.登记(root, [粒模板({ 计划开始: '2026-08-20', 计划完成: '2026-08-20', 因: '首排' })], '总监').ok, '同日起止＝一日活，合法');
  });

  await t('就绪：项管标得动，G8 人闸判据从此筛得出东西（此前结构性恒空）', async () => {
    const root = makeRoot();
    const G8 = () => require('../lib/gatereg').判据表.待办候放行(root, { schedule: S });
    const g = 登记一(root);
    assert.equal(G8().length, 0, '没标就绪之前 G8 空——backlog 不冒充欠债');
    const r = S.调整(root, { 粒ID: g.粒ID, 预期版本: 1, 就绪: true, 操作者: '项管' });
    assert.ok(r.ok, r.error);
    assert.equal(S.取(root, g.粒ID).就绪, true);
    assert.deepEqual(G8().map((x) => x.id), [g.粒ID], '白名单收了 就绪，G8 判据才不是恒空的摆设');
    assert.ok(S.调整(root, { 粒ID: g.粒ID, 预期版本: 2, 就绪: false, 操作者: '项管' }).ok, '改主意也得改得回来');
    assert.equal(G8().length, 0);
    const 越 = S.调整(root, { 粒ID: g.粒ID, 预期版本: 3, 就绪: true, 操作者: '美术' });
    assert.ok(!越.ok && 越.越权, '非项管/总监标就绪应越权拒');
    assert.ok(!S.调整(root, { 粒ID: g.粒ID, 预期版本: 3, 就绪: 1, 操作者: '项管' }).ok, '非布尔拒');
  });

  await t('标就绪 ≠ 放行：只有计划态能举旗，举旗不推动状态机也不替项管开闸', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    S.调整(root, { 粒ID: g.粒ID, 预期版本: 1, 就绪: true, 操作者: '项管' });
    assert.equal(S.取(root, g.粒ID).状态, '计划', '标就绪不该顺手把粒推过闸');
    assert.equal(S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 2, 操作者: '项管', 单号: 'TK-400' }).ok, false,
      '标了就绪的粒，项管照样推不过派单闸——就绪是项管的旗，放行是人闸');
    assert.ok(S.转移(root, { 粒ID: g.粒ID, 目标: '起草中', 预期版本: 2, 操作者: '总监', 单号: 'TK-400' }).ok);
    const 拒 = S.调整(root, { 粒ID: g.粒ID, 预期版本: 3, 就绪: true, 操作者: '项管' });
    assert.equal(拒.ok, false, '已过闸的粒不该再举旗（否则 G8 清单里混进已放行的东西）');
    assert.match(拒.error, /只有计划态待办能标就绪/);
  });

  await t('重排：首次排期立基线（延期 0），再排按基线累计延期，事件带原计划→新计划', async () => {
    const root = makeRoot();
    const g = 登记一(root); // 老粒：一格日期都没有
    const a = S.重排(root, { 粒ID: g.粒ID, 计划开始: '2026-08-20', 计划完成: '2026-08-24', 因: '首次排期', 操作者: '项管', 预期版本: 1 });
    assert.ok(a.ok, a.error);
    assert.equal(a.延期天, 0, '首次排期＝基线，延期 0');
    const n1 = S.取(root, g.粒ID);
    assert.deepEqual([n1.计划开始, n1.计划完成, n1.基线开始, n1.基线完成], ['2026-08-20', '2026-08-24', '2026-08-20', '2026-08-24']);
    const b = S.重排(root, { 粒ID: g.粒ID, 计划完成: '2026-08-27', 因: '上游依赖晚了三天', 操作者: '项管', 预期版本: n1.版本号 });
    assert.ok(b.ok, b.error);
    assert.equal(b.延期天, 3);
    const n2 = S.取(root, g.粒ID);
    assert.equal(n2.计划完成, '2026-08-27');
    assert.equal(n2.计划开始, '2026-08-20', '只给完成日不该把开始日抹掉');
    assert.deepEqual([n2.基线开始, n2.基线完成], ['2026-08-20', '2026-08-24'], '基线一经立下不随重排变——变了延期就永远是 0');
    const c = S.重排(root, { 粒ID: g.粒ID, 计划完成: '2026-08-30', 因: '又滑三天', 操作者: '总监', 预期版本: n2.版本号 });
    assert.equal(c.延期天, 6, '延期是累计的，不是「跟上次比又没延期」');
    const 事件 = S.事件流(root).filter((x) => x.事件类型 === '重排');
    assert.equal(事件.length, 3);
    assert.deepEqual(事件[1].原计划, { 开始: '2026-08-20', 完成: '2026-08-24' });
    assert.deepEqual(事件[1].新计划, { 开始: '2026-08-20', 完成: '2026-08-27' });
    assert.equal(事件[1].延期天, 3);
    assert.equal(事件[1].因, '上游依赖晚了三天');
    for (const x of 事件) for (const k of ['粒ID', '事件类型', '字段变更', '版本号', '时刻', '操作者']) assert.ok(k in x, '重排事件缺字段 ' + k);
    assert.ok(!('延期天' in S.取(root, g.粒ID)), '审计载荷走事件顶层，不进现态（同 拒绝 事件的 因）');
    assert.equal(S.取(root, g.粒ID).末次说明, '又滑三天', '因同时落成末次说明，页面上看得见为什么挪');
  });

  await t('重排：因必填 / 无字段拒 / 无变化拒 / 坏日期拒 / 起止倒挂拒 / 可清空排期', async () => {
    const root = makeRoot();
    const g = 登记一(root, { 计划开始: '2026-08-20', 计划完成: '2026-08-24', 因: '首排' }); // P0-8：带日期必带因
    const 试 = (p) => S.重排(root, { 粒ID: g.粒ID, 操作者: '项管', 预期版本: 1, ...p });
    assert.match(试({ 计划完成: '2026-08-25' }).error, /必须带因/, '没有因的甘特图没人敢照着排产');
    assert.match(试({ 因: 'x' }).error, /未给任何排期字段/);
    assert.match(试({ 计划完成: '2026-08-24', 因: '一模一样' }).error, /未改变任何排期字段/);
    assert.match(试({ 计划完成: '2026-8-24', 因: 'x' }).error, /ISO 日期串/);
    assert.match(试({ 计划开始: '2026-08-25', 因: 'x' }).error, /计划开始须早于或等于计划完成/);
    assert.match(试({ 工期天: -2, 因: 'x' }).error, /工期天须为非负数/);
    assert.equal(S.取(root, g.粒ID).版本号, 1, '以上全拒，现态一个字节没动');
    const r = S.重排(root, { 粒ID: g.粒ID, 计划开始: null, 计划完成: null, 因: '依赖未定，撤出本轮排期', 操作者: '项管', 预期版本: 1 });
    assert.ok(r.ok, r.error);
    const now = S.取(root, g.粒ID);
    assert.deepEqual([now.计划开始, now.计划完成], [null, null], '「这条先不排了」是合法动作');
    assert.equal(now.基线完成, '2026-08-24', '基线是历史，撤排期不抹历史');
  });

  await t('重排：操作域=项管+总监（排期是项管的活），CAS 管得住，终态不可重排', async () => {
    const root = makeRoot();
    const g = 登记一(root);
    const 越 = S.重排(root, { 粒ID: g.粒ID, 计划完成: '2026-09-01', 因: 'x', 操作者: '执行agent', 预期版本: 1 });
    assert.ok(!越.ok && 越.越权, '非项管/总监应越权拒');
    const 冲 = S.重排(root, { 粒ID: g.粒ID, 计划完成: '2026-09-01', 因: 'x', 操作者: '项管', 预期版本: 99 });
    assert.ok(!冲.ok && 冲.冲突 && 冲.现态.版本号 === 1, '版本不符要拒并把现态交回去重试');
    assert.ok(!S.重排(root, { 粒ID: '不存在的粒', 计划完成: '2026-09-01', 因: 'x', 操作者: '项管', 预期版本: 1 }).ok);
    assert.ok(S.重排(root, { 粒ID: g.粒ID, 计划完成: '2026-09-01', 因: '排期', 操作者: '项管', 预期版本: 1 }).ok, '项管排得动');
    const g2 = 登记一(root, { 题: '已完成的活', 来源: '终态', 状态: '已成单', 单号: 'TK-410' });
    S.转移(root, { 粒ID: g2.粒ID, 目标: '完成', 预期版本: 1, 操作者: '项管' });
    const r = S.重排(root, { 粒ID: g2.粒ID, 计划完成: '2026-09-09', 因: '晚了', 操作者: '项管', 预期版本: 2 });
    assert.ok(!r.ok && /终态待办不可重排/.test(r.error), '要重排的是它后面还没做的那些，不是它自己');
  });

  await t('工期判定（纯函数·零 I/O）：延期 / 超期 / 超期完成 三者各判各的', async () => {
    const 判 = (g, o) => S.工期判定(g, o);
    const a = 判({ 状态: '计划' }, { 今日: '2026-08-20' });
    assert.deepEqual([a.已排期, a.延期天, a.超期, a.需重排], [false, null, false, false], '没排期就没有延期/超期可言，不许拿 0 冒充');
    const b = 判({ 状态: '计划', 计划开始: '2026-08-20', 计划完成: '2026-08-24', 基线开始: '2026-08-20', 基线完成: '2026-08-24' }, { 今日: '2026-08-22' });
    assert.deepEqual([b.延期, b.超期, b.余量天, b.需重排], [false, false, 2, false]);
    const c = 判({ 状态: '计划', 计划完成: '2026-08-27', 基线完成: '2026-08-24' }, { 今日: '2026-08-22' });
    assert.deepEqual([c.延期, c.延期天, c.超期], [true, 3, false], '挪了计划但今天还没到期：延期成立、超期不成立');
    const d = 判({ 状态: '起草中', 计划完成: '2026-08-24', 基线完成: '2026-08-24' }, { 今日: '2026-08-27' });
    assert.deepEqual([d.延期, d.超期, d.超期天, d.需重排], [false, true, 3, true], '没挪过计划照样能超期——两件事');
    const e = 判({ 状态: '完成', 计划完成: '2026-08-24', 基线完成: '2026-08-24', 更新时刻: '2026-08-28T09:00:00.000Z' }, { 今日: '2026-08-30' });
    assert.deepEqual([e.超期完成, e.超期完成天, e.超期], [true, 4, false], '完成日缺省取终态粒的更新时刻；已了结的不再算超期');
    assert.equal(判({ 状态: '完成', 计划完成: '2026-08-24', 更新时刻: '2026-08-24T23:00:00.000Z' }, { 今日: '2026-08-30' }).超期完成, false, '当天做完不算超期完成');
    assert.equal(判({ 状态: '完成', 计划完成: '2026-08-24', 更新时刻: '2026-08-20T09:00:00Z' }, { 完成日: '2026-08-30' }).超期完成天, 6, '完成日可显式给（对齐/补账时用）');
    assert.equal(判({ 状态: '撤销', 计划完成: '2026-01-01' }, { 今日: '2026-08-30' }).需重排, false, '撤销了的活不必重排');
    assert.equal(判({ 状态: '计划', 计划完成: '2026-08-24', 基线完成: '2026-08-20' }).延期天, 4, '零 I/O：不传今日、不碰盘照样算得出延期');
    assert.deepEqual([S.日差('2026-08-20', '2026-08-20'), S.日差('2026-08-24', '2026-08-20'), S.日差(null, '2026-08-20'), S.日差('坏日子', '2026-08-20')],
      [0, -4, null, null], '日差：同日 0 / 倒序为负 / 缺一头或坏值为 null（不拿 0 冒充「没差」）');
  });

  await t('称谓改「待办」（2026-08-20 定名）：文案不再出现「计划粒」，数据格式一个字节不动', async () => {
    const 源 = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pm', 'schedule.js'), 'utf8');
    const 码 = 源.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)); // 注释里讲改名缘由，必然要提旧称
    assert.ok(!码.some((l) => l.includes('计划粒')), '代码与对外文案里不该再有「计划粒」：' + (码.find((l) => l.includes('计划粒')) || ''));
    // 零迁移的机器判据：事件形状与老字段一格没动，新字段全部走白名单
    const root = makeRoot();
    const g = 登记一(root);
    const e = S.事件流(root)[0];
    assert.deepEqual(Object.keys(e).sort(), ['粒ID', '事件类型', '字段变更', '版本号', '时刻', '操作者'].sort(), '事件形状不动');
    const 老字段 = ['批', '序', '题', '状态', '管线', '依赖', '池衡建议', '预估单元', '来源', '单号'];
    // 型/上级 是 2026-08-21 的归属换轴（批 → 型+上级），一并进白名单
    const 新字段 = ['计划开始', '计划完成', '工期天', '基线开始', '基线完成', '就绪', '项目', '型', '上级'];
    for (const k of 老字段) assert.ok(k in e.字段变更, `老字段 ${k} 一个都不许丢`);
    for (const k of 新字段) assert.ok(k in e.字段变更, `新字段 ${k} 须进白名单`);
    assert.equal(Object.keys(e.字段变更).length, 老字段.length + 新字段.length, '白名单之外的字段一律不落盘');
    assert.ok(/^[0-9a-f-]{36}$/.test(g.粒ID), '粒ID 仍是 UUID，字段名没改（改字段名才叫迁移）');
    // 基线不进入参：调用方不能自己宣称基线，否则延期天数也就成了可以随便宣称的数
    const g2 = S.登记(root, [粒模板({ 题: '越白名单', 来源: 'wl', 基线完成: '2020-01-01', 甘特色: '红' })], '总监').新增[0];
    const now = S.取(root, g2.粒ID);
    assert.equal(now.基线完成, null, '基线由系统按「首次排期」推，不收入参');
    assert.ok(!('甘特色' in now), '白名单外的字段静默丢弃——新字段一律进 规范粒，不许绕过');
  });

  await t('归属：项目可改，且终态粒也能改（归属是分类不是计划）', async () => {
    // 案源：2026-08-21 制作人「在一个项目里能看到另外一个项目的东西，这不对」。
    // 项目 这一格当天才加，存量 122 条全空、其中 82 条已是完成/撤销——终态一并拒掉的话，
    // 历史账**永远无法归属**，按项目过滤的队列与报表会永久缺一大块，正好是加这一格要治的病。
    const root = makeRoot();
    const r = S.登记(root, [粒模板({ 题: '一条活', 来源: 'proj-test' })], '总监');
    const id = r.新增[0].粒ID;
    assert.equal(r.新增[0].项目, null, '不传即未归属——不许静默塞项目默认值');

    const a = S.调整(root, { 粒ID: id, 预期版本: 1, 项目: 'Ticketflow', 操作者: '总监' });
    assert.ok(a.ok, a.error);
    assert.equal(a.粒.项目, 'Ticketflow');

    S.转移(root, { 粒ID: id, 目标: '撤销', 预期版本: a.粒.版本号, 操作者: '总监', 说明: '不做了' });
    const g2 = S.取(root, id);
    assert.equal(g2.状态, '撤销');
    const b = S.调整(root, { 粒ID: id, 预期版本: g2.版本号, 项目: 'TK', 操作者: '总监' });
    assert.ok(b.ok, '终态粒的归属要改得动：' + b.error);
    assert.equal(S.取(root, id).项目, 'TK');
    const c = S.调整(root, { 粒ID: id, 预期版本: S.取(root, id).版本号, 项目: 'TK', 序: 9, 操作者: '总监' });
    assert.equal(c.ok, false, '掺了计划面字段就照拒——开的是归属这一个口子，不是把终态闸拆了');
    assert.match(String(c.error), /终态待办不可调整/);
  });

  // ── ⑨ P0 批次（2026-08-24 落实表：依赖 ref 存在性 / 预估进调整白名单 / 登记堵日期旁路）──

  await t('P0-4 登记依赖 ref 存在性：坏 ref 拒 / 真工单号过 / 真粒ID过 / 强制旁路 / 不传回调保持旧行为', async () => {
    const root = makeRoot();
    const 查引用 = (ref) => ref === 'TK-127'; // 桩工单库：只有 TK-127 这一张现存工单
    const 坏 = S.登记(root, [粒模板({ 依赖: [{ ref: 'Q5', 规则: '全部完成' }] })], '总监', { 查引用 });
    assert.ok(!坏.ok, 'ref 指向不存在实体应拒');
    assert.match(坏.error, /依赖 ref 不存在：Q5/);
    assert.equal(S.现态(root).length, 0, '整批未写入：一条不合法则一条都不落');
    const 甲 = S.登记(root, [粒模板({ 依赖: [{ ref: 'TK-127', 规则: '全部完成' }] })], '总监', { 查引用 });
    assert.ok(甲.ok, '真工单号应过：' + 甲.error);
    const 乙 = S.登记(root, [粒模板({ 题: '面单二', 依赖: [{ ref: 甲.新增[0].粒ID, 规则: '任一完成' }] })], '总监', { 查引用 });
    assert.ok(乙.ok, '真粒ID应过（命中现存粒不需要回调认识它）：' + 乙.error);
    const 强 = S.登记(root, [粒模板({ 题: '预挂', 依赖: [{ ref: 'TK-999', 规则: '全部完成' }] })], '总监', { 查引用, 强制: true });
    assert.ok(强.ok, '强制:true 应旁路存在性校验：' + 强.error);
    assert.ok(S.登记(root, [粒模板({ 题: '旧调用方', 依赖: [{ ref: '不存在的东西' }] })], '总监').ok,
      '没传回调保持旧行为不校验——既有调用方一个不破');
  });

  await t('P0-4 调整同一道引用检：坏 ref 拒且留痕、现态不动；真实体过；强制旁路', async () => {
    const root = makeRoot();
    const 查引用 = (ref) => ref === 'TK-127';
    const g = 登记一(root);
    const 坏 = S.调整(root, { 粒ID: g.粒ID, 预期版本: 1, 依赖: [{ ref: 'Q5', 规则: '全部完成' }], 操作者: '项管' }, { 查引用 });
    assert.ok(!坏.ok, '调整坏 ref 应拒');
    assert.match(坏.error, /依赖 ref 不存在：Q5/);
    assert.equal(S.取(root, g.粒ID).版本号, 1, '被拒不改现态不顶版本');
    assert.ok(S.事件流(root).some((e) => e.事件类型 === '拒绝' && /依赖 ref 不存在/.test(e.因)), '拒绝留痕');
    const 好 = S.调整(root, { 粒ID: g.粒ID, 预期版本: 1, 依赖: [{ ref: 'TK-127', 规则: '全部完成' }], 操作者: '项管' }, { 查引用 });
    assert.ok(好.ok, 好.error);
    assert.deepEqual(S.取(root, g.粒ID).依赖, [{ ref: 'TK-127', 规则: '全部完成' }]);
    const 强 = S.调整(root, { 粒ID: g.粒ID, 预期版本: 2, 依赖: [{ ref: 'TK-888' }], 操作者: '项管' }, { 查引用, 强制: true });
    assert.ok(强.ok, '强制旁路：' + 强.error);
  });

  await t('P0-6 预估单元进调整白名单：改得动且变更留痕；0/负/非数拒；终态粒拦', async () => {
    const root = makeRoot();
    const g = 登记一(root, { 预估单元: 2 });
    const r = S.调整(root, { 粒ID: g.粒ID, 预期版本: 1, 预估单元: 5, 操作者: '项管' });
    assert.ok(r.ok, r.error);
    assert.equal(S.取(root, g.粒ID).预估单元, 5, '现态更新');
    const e = S.事件流(root).find((x) => x.事件类型 === '调整');
    assert.equal(e.字段变更.预估单元, 5, '变更留痕在调整事件的字段变更里');
    for (const v of [0, -1, 'abc']) {
      const 拒 = S.调整(root, { 粒ID: g.粒ID, 预期版本: 2, 预估单元: v, 操作者: '项管' });
      assert.ok(!拒.ok && /预估单元须为正数/.test(拒.error), `坏值 ${v} 应拒：` + 拒.error);
    }
    assert.equal(S.取(root, g.粒ID).版本号, 2, '坏值全拒，现态不动');
    S.转移(root, { 粒ID: g.粒ID, 目标: '撤销', 预期版本: 2, 操作者: '总监' });
    const 拦 = S.调整(root, { 粒ID: g.粒ID, 预期版本: 3, 预估单元: 8, 操作者: '项管' });
    assert.ok(!拦.ok && /终态待办不可调整/.test(拦.error), '终态粒传预估单元应被终态闸拦：' + 拦.error);
  });

  await t('P0-8 登记堵日期旁路：带计划日期必须带非空因；带因过且因落事件顶层；无日期照旧免因', async () => {
    const root = makeRoot();
    for (const 补 of [{ 计划完成: '2026-09-01' }, { 计划开始: '2026-09-01' }, { 计划开始: '2026-09-01', 计划完成: '2026-09-03', 因: '   ' }]) {
      const r = S.登记(root, [粒模板(补)], '总监');
      assert.ok(!r.ok, '带日期不带因应拒：' + JSON.stringify(补));
      assert.match(r.error, /必须带非空 因/);
      assert.equal(S.现态(root).length, 0, '整批未写入');
    }
    const r = S.登记(root, [粒模板({ 计划完成: '2026-09-01', 因: '排期依据：落实表 P0 批次' })], '总监');
    assert.ok(r.ok, r.error);
    const e = S.事件流(root)[0];
    assert.equal(e.因, '排期依据：落实表 P0 批次', '因走登记事件顶层作审计载荷（同 重排 的口径）');
    assert.ok(!('因' in S.取(root, r.新增[0].粒ID)), '因不进现态，不动字段白名单');
    assert.ok(S.登记(root, [粒模板({ 题: '无日期不需要因' })], '总监').ok, '不带日期的登记照旧不需要因（老账形态不破）');
  });

  console.log(`全部通过：${passed} 项`);
})().catch((e) => { console.error('  ✗ ' + (e.stack || e.message)); process.exit(1); });
