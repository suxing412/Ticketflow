// pm-ledger.test.js — 项管台账「杀假读数 + 行为分桶」（丙-4 · 2026-08-20）
// 被测三件：① 成本() 读时派生（原 父单成本 零写入方、界面照渲染 = 假数）
//          ② 视图() 逐字段来源标注（账 / 快照 / 派生分得清，死镜像不下发）
//          ③ 分桶() 心跳归一桶只报计数、判断类各成一桶保留明细（治「心跳挤爆窗口」）
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const L = require('../lib/pm/ledger');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('项管台账 · 杀假读数与行为分桶测试');

const 回执 = (root, id, txt) => {
  fs.mkdirSync(path.join(root, '回执'), { recursive: true });
  fs.writeFileSync(path.join(root, '回执', id + '.md'), txt, 'utf8');
};
const ev = (类型, t2, more = {}) => ({ 类型, t: t2, ...more });

// ---------------- ① 成本()：读时派生 ----------------
t('父单成本不再恒空：按容器归集子单回执 token（此前全仓零写入方，界面永远「暂无归集」）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'K-1', 专项: 'S-9' });
  seed(root, '在途', { id: 'K-2', 专项: 'S-9' });
  回执(root, 'K-1', '## 实际消耗\n用了 12,000 tokens\n');
  回执(root, 'K-2', '## 实际消耗\n3000 token\n');
  const c = L.成本(root);
  assert.deepEqual(c['S-9'], { token合计: 15000, 单数: 2, 完成数: 1, 有回执数: 2 });
});

t('token 口径同 report.parseReceipt：一篇回执里多个数取最大（分段计数与总计同现时总计最大）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'K-1', 专项: 'S-1' });
  回执(root, 'K-1', '输入 900 tokens；输出 250 tokens；合计 1,150 tokens');
  assert.equal(L.成本(root)['S-1'].token合计, 1150);
});

t('归属两路：fm.专项 新路优先于 fm.父单 老路（同 ledger-sync.差量 口径）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'K-1', 父单: 'TK-40', 专项: 'S-2' });
  seed(root, '完成', { id: 'K-2', 父单: 'TK-40' });
  回执(root, 'K-1', '100 tokens'); 回执(root, 'K-2', '200 tokens');
  const c = L.成本(root);
  assert.equal(c['S-2'].token合计, 100, '带专项章的走新路');
  assert.equal(c['TK-40'].token合计, 200, '没专项章的回落战役父单老路');
});

t('容器与迁移伪单不计：壳不是活单，重复计会把成本翻倍', () => {
  const root = makeRoot();
  seed(root, '在途', { id: 'TK-40', 父单类型: '战役', 父单: 'TK-40' });
  seed(root, '归档', { id: 'K-9', 父单: 'TK-40', 迁移至专项: 'S-3' });
  回执(root, 'TK-40', '999 tokens'); 回执(root, 'K-9', '888 tokens');
  assert.deepEqual(L.成本(root), {}, '只剩壳与伪单时应一个归集单位都不出');
});

t('散单不归集；无回执的单只计单数不计 token（有回执数 如实报，别拿 0 冒充「花了 0」）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'K-1' });                    // 散单：无容器
  seed(root, '待派', { id: 'K-2', 专项: 'S-4' });       // 有容器无回执
  const c = L.成本(root);
  assert.equal(c['K-1'], undefined);
  assert.deepEqual(c['S-4'], { token合计: 0, 单数: 1, 完成数: 0, 有回执数: 0 });
});

t('完成数按「做完了」算（完成+归档，H110 专项内部口径）；在途/审检/废弃/挂起都不算', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'K-1', 专项: 'S-5' });   // 判官全过候关账：专项内部算做完
  seed(root, '归档', { id: 'K-2', 专项: 'S-5' });   // 验收过：做完
  seed(root, '初检', { id: 'K-3', 专项: 'S-5' });   // 审检链在途：没做完
  seed(root, '废弃', { id: 'K-4', 专项: 'S-5' });   // 砍掉的不是做完
  seed(root, '挂起', { id: 'K-5', 专项: 'S-5' });   // 冻着的不是做完
  const c = L.成本(root);
  assert.equal(c['S-5'].单数, 5, '单数照全量数（废弃/挂起的成本也是花出去的）');
  assert.equal(c['S-5'].完成数, 2, '完成数只认 完成+归档');
});

// ---------------- ② 视图()：字段来源 ----------------
t('视图() 用派生真值覆盖 read() 的空壳 父单成本', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'K-1', 专项: 'S-6' });
  回执(root, 'K-1', '4200 tokens');
  L.write(root, { ...L.DEFAULT() });                 // 落一份「父单成本: {}」的真实空壳台账
  assert.deepEqual(L.read(root).父单成本, {}, '前提：read() 拿到的就是空壳');
  assert.equal(L.视图(root).父单成本['S-6'].token合计, 4200);
});

t('逐字段声明来源：账 / 快照 / 派生分得清，消费方不必靠猜', () => {
  const root = makeRoot();
  const v = L.视图(root);
  assert.equal(v.字段来源.管理费.来源, '账');
  assert.equal(v.字段来源.父单成本.来源, '派生');
  assert.equal(v.字段来源.就绪队列.来源, '快照');
  assert.ok(/runner/.test(v.字段来源.就绪队列.写入方), '快照字段必须指名写入方，否则「为什么是旧的」无从查');
  assert.ok(/api\/agents/.test(v.字段来源.就绪队列.权威), '快照字段必须指出权威口');
});

t('死镜像 在跑 不下发（全仓零读取方，留着只会与 /api/agents 现算值分叉），但来源表里如实交代', () => {
  const root = makeRoot();
  L.write(root, { ...L.DEFAULT(), 在跑: { 'K-1': { 池: 'codex' } } });
  assert.ok(L.read(root).在跑['K-1'], '前提：持久值原样保留，本组不动 runner 的写入方');
  const v = L.视图(root);
  assert.ok(!('在跑' in v), '视图不下发');
  assert.equal(v.字段来源.在跑.已剔除, true, '不是偷偷删掉：接口明说剔了，并指出权威在哪');
  assert.ok(/api\/agents/.test(v.字段来源.在跑.权威));
});

t('派生算炸不带崩整张台账，且不假装成「无归集」——异常如实写进来源表', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'K-1', 专项: 'S-7' });
  const v = L.视图(root, { 取token() { throw new Error('回执目录挂了'); } });
  assert.deepEqual(v.父单成本, {});
  assert.ok(/回执目录挂了/.test(v.字段来源.父单成本.异常), '故障必须留痕');
  assert.ok(/故障/.test(v.字段来源.父单成本.说明), '说明要写明这是故障不是没数据');
  assert.ok(v.管理费, '其余字段照常下发');
});

// ---------------- ③ 分桶()：治「心跳挤爆窗口」 ----------------
const 造流水 = () => {
  const out = [];
  for (let i = 0; i < 200; i++) out.push(ev('巡检', `2026-08-19T00:${String(i % 60).padStart(2, '0')}:00.000Z`));
  for (let i = 0; i < 150; i++) out.push(ev('台账对齐', `2026-08-19T01:${String(i % 60).padStart(2, '0')}:00.000Z`));
  out.push(ev('估时校准', '2026-08-19T02:00:00.000Z', { 单: 'K-1' }));
  out.push(ev('裁决', '2026-08-19T02:10:00.000Z', { 单: 'K-2', 处置: '返修' }));
  out.push(ev('切单失败', '2026-08-19T02:20:00.000Z', { 父单: 'S-1' }));
  out.push(ev('起草失败', '2026-08-19T02:30:00.000Z', { error: '模型跑飞' }));
  return out;
};

t('心跳归一桶只报计数：巡检/台账对齐 不出明细，计数与占比如实报', () => {
  const r = L.分桶(造流水());
  const h = r.桶.find((b) => b.桶 === '机器心跳');
  assert.equal(h.类, '心跳');
  assert.equal(h.计数, 350);
  assert.deepEqual(h.最近, [], '心跳逐条列出去就是把判断动作再挤一次');
  assert.deepEqual(h.类型, { 巡检: 200, 台账对齐: 150 });
  assert.equal(r.心跳占比, 99);
});

t('待人裁的异常不许混进心跳：台账孤粒 归告警桶并留明细（埋进计数就等于又犯一次本病）', () => {
  const r = L.分桶([ev('台账孤粒', '2026-08-19T01:00:00.000Z', { 粒ID: 'g7', 单号: 'K-9' }), ev('巡检', '2026-08-19T02:00:00.000Z')]);
  const g = r.桶.find((x) => x.桶 === '告警');
  assert.equal(g.类, '判断');
  assert.equal(g.最近[0].粒ID, 'g7');
  assert.equal(r.桶.find((x) => x.桶 === '机器心跳').计数, 1, '心跳桶只剩巡检');
});

t('判断动作不再被心跳挤出窗口：估时校准/裁决/切单失败/起草失败 各自成桶且都留着明细', () => {
  const r = L.分桶(造流水());
  for (const [桶, 类型] of [['估时校准', '估时校准'], ['定夺', '裁决'], ['切单', '切单失败'], ['起草', '起草失败']]) {
    const b = r.桶.find((x) => x.桶 === 桶);
    assert.ok(b, `缺桶：${桶}`);
    assert.equal(b.类, '判断');
    assert.ok(b.最近.some((e) => e.类型 === 类型), `${桶} 桶里看不见 ${类型}`);
  }
});

t('桶内也保底：同桶里高频类型不许把低频类型挤光（池衡拒绝 vs 池衡切换）', () => {
  const 流 = [];
  for (let i = 0; i < 60; i++) 流.push(ev('池衡拒绝', `2026-08-19T03:${String(i % 60).padStart(2, '0')}:00.000Z`, { 因类: '迟滞' }));
  流.push(ev('池衡切换', '2026-08-19T00:00:00.000Z', { 位: '程序' })); // 最老的一条
  const b = L.分桶(流, { 每桶: 3 }).桶.find((x) => x.桶 === '池衡');
  assert.equal(b.计数, 61);
  assert.equal(b.最近.length, 3);
  assert.ok(b.最近.some((e) => e.类型 === '池衡切换'), '切成过 4 次和被挡了 271 次是两件事，都得看得见');
  assert.deepEqual(b.类型, { 池衡拒绝: 60, 池衡切换: 1 }, '保底一条不等于报全，计数在类型栏里是全的');
});

t('明细按时间倒序；每桶条数可调，取 0 即只要计数不要明细', () => {
  const 流 = [
    ev('排程转移', '2026-08-19T01:00:00.000Z', { 粒ID: 'g1' }),
    ev('排程登记', '2026-08-19T03:00:00.000Z', { 粒ID: 'g2' }),
    ev('排程调整', '2026-08-19T02:00:00.000Z', { 粒ID: 'g3' }),
  ];
  const b = L.分桶(流, { 每桶: 3 }).桶.find((x) => x.桶 === '排期');
  assert.deepEqual(b.最近.map((e) => e.粒ID), ['g2', 'g3', 'g1']);
  assert.equal(b.首次, '2026-08-19T01:00:00.000Z');
  assert.equal(b.末次, '2026-08-19T03:00:00.000Z');
  assert.deepEqual(L.分桶(流, { 每桶: 0 }).桶[0].最近, []);
});

t('按操作者分账：同一桶里项管干了几次、系统干了几次分得开（排程转移里项管 0 次正是要看见的事）', () => {
  const 流 = [
    ev('排程转移', '2026-08-19T01:00:00.000Z', { 操作者: '系统·台账对齐' }),
    ev('排程转移', '2026-08-19T02:00:00.000Z', { 操作者: '系统·台账对齐' }),
    ev('排程登记', '2026-08-19T03:00:00.000Z', { 操作者: '项管' }),
  ];
  const b = L.分桶(流).桶.find((x) => x.桶 === '排期');
  assert.deepEqual(b.按操作者, { '系统·台账对齐': 2, 项管: 1 });
  assert.equal(L.分桶([ev('估时校准', '2026-08-19T01:00:00.000Z')]).桶[0].按操作者, null, '无操作者字段时报 null，不编一个空对象');
});

t('新事件类型不静默吞：落「其他」桶并进 未归类 清单（桶表漏登会被看见，不是消失）', () => {
  const r = L.分桶([ev('某种没登记过的动作', '2026-08-19T01:00:00.000Z'), ev('派发', '2026-08-19T02:00:00.000Z')]);
  assert.deepEqual(r.未归类, ['某种没登记过的动作']);
  const o = r.桶.find((x) => x.桶 === '其他');
  assert.equal(o.计数, 1);
  assert.ok(o.最近.length, '未归类也要留明细，否则新类型上线即隐身');
});

t('桶序固定：心跳永远垫底，面板位置不随活跃度浮动', () => {
  const r = L.分桶([ev('巡检', '2026-08-19T09:00:00.000Z'), ev('派单委托', '2026-08-19T01:00:00.000Z'), ev('裁决', '2026-08-19T02:00:00.000Z')]);
  assert.deepEqual(r.桶.map((b) => b.桶), ['起草', '定夺', '机器心跳']);
});

t('空账与脏行不崩：零事件给空壳，无 t / 无类型的行照样进桶', () => {
  const 空 = L.分桶([]);
  assert.deepEqual(空, { 合计: 0, 窗: { 条数: 0, 起: null, 讫: null }, 心跳占比: 0, 桶: [], 未归类: [] });
  const 脏 = L.分桶([{ 类型: '派发' }, null, { t: '2026-08-19T01:00:00.000Z' }]);
  assert.equal(脏.合计, 2, 'null 行剔除，其余不丢');
  assert.deepEqual(脏.未归类, ['（无类型）']);
  assert.equal(脏.桶.find((b) => b.桶 === '派发').首次, null, '无 t 的行不编时间');
});

t('分桶是纯函数：不读盘不写盘（活体台账体积不因调用而变）', () => {
  const root = makeRoot();
  L.event(root, '巡检', { 在途: 1 });
  const 前 = fs.statSync(path.join(L.DIR(root), '事件.jsonl')).size;
  L.分桶(L.events(root, 100), { 每桶: 5 });
  assert.equal(fs.statSync(path.join(L.DIR(root), '事件.jsonl')).size, 前);
});


// ---------------- ④ 坏行不静默丢（2026-08-21 事件.jsonl 第 2728 行 133 个 NUL 案）----------------
t('坏行要被计数：NUL 半截行不许无声消失（events 报坏行数，体检点得出行号）', () => {
  const root = makeRoot();
  L.event(root, '派发', { id: 'K-1' });
  const EV = path.join(L.DIR(root), '事件.jsonl');
  // 复刻断电现场：133 个前导 NUL + 一条没写完的 JSON
  fs.appendFileSync(EV, Buffer.concat([Buffer.alloc(133, 0),
    Buffer.from('{"t":"2026-08-20T14:30:17.055Z","类型":"台账孤粒"' + String.fromCharCode(10), 'utf8')]));
  L.event(root, '完成', { id: 'K-2' });
  const out = L.events(root, 200);
  assert.equal(out.length, 2, '两条好行照读');
  assert.equal(out.坏行数, 1, '坏行必须计数——这一格是「账不可信」的唯一证据，丢了就回到静默吞');
  const r = L.事件流体检(root);
  assert.equal(r.总行, 3);
  assert.deepEqual(r.坏行, [2], '体检要点出行号，不能只说「有坏行」');
  assert.equal(r.含NUL, true, 'NUL 是断电写坏的物证');
});

// ---------------- ⑤ 退空账不许盖真账（2026-08-20 管理费 98.1 万 token/34 次归零案）------------
t('双档不可读：退空账要喊人，且不许拿空账盖掉主档', () => {
  const root = makeRoot();
  const dir = path.join(root, '项管台账'); fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, '台账.json');
  fs.writeFileSync(p, JSON.stringify({ 管理费: { token合计: 981000, 次数: 34 } }), 'utf8');
  fs.copyFileSync(p, p + '.bak');
  fs.writeFileSync(p, Buffer.alloc(200, 0));          // 撕裂写实测形态：全 NUL
  fs.writeFileSync(p + '.bak', Buffer.alloc(200, 0)); // 副本同样坏 → 双档不可读
  L.update(root, (l) => { l.管理费.token合计 += 100; l.管理费.次数 += 1; });  // 下一拍照常记账
  let 盖了 = false;
  try { 盖了 = JSON.parse(fs.readFileSync(p, 'utf8')).管理费.token合计 < 981000; } catch { 盖了 = false; } // 仍是 NUL＝没盖
  assert.ok(!盖了, '主档不许被空账覆盖——盖了真账就再也算不回来（原样这里会变成 100）');
  assert.ok(fs.existsSync(p + '.待人裁'), '退空态的写要改道到人能看见的落点，不能默默丢弃这一拍');
  assert.equal(JSON.parse(fs.readFileSync(p + '.待人裁', 'utf8')).管理费.token合计, 100, '改道那份要如实是空账起算，供人比对');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('台账.json.损毁-')), '损毁现场要留档，人靠它捞账');
  const ibx = path.join(root, '呼叫', 'inbox.jsonl');
  assert.ok(fs.existsSync(ibx), '退空账必须进收件箱——不喊人账就在无声中归零（原样这里根本没有这个文件）');
  const 件 = fs.readFileSync(ibx, 'utf8').trim().split(String.fromCharCode(10)).filter(Boolean).map((l) => JSON.parse(l));
  const 报 = 件.find((e) => e.类型 === '台账损毁');
  assert.ok(报, '收件箱里要有 台账损毁 这一件');
  assert.equal(报.级别, '急', '这是急件不是知会——降成常就会被淹在 377 条未读里');
});

t('单档损毁走 .bak 回退：真账要活着回来（防上一条修过头，把正常回退也堵死）', () => {
  const root = makeRoot();
  const dir = path.join(root, '项管台账'); fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, '台账.json');
  fs.writeFileSync(p, JSON.stringify({ 管理费: { token合计: 981000, 次数: 34 } }), 'utf8');
  fs.copyFileSync(p, p + '.bak');
  fs.writeFileSync(p, Buffer.alloc(200, 0));   // 只坏主档，副本完好
  L.update(root, (l) => { l.管理费.token合计 += 100; });
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).管理费.token合计, 981100, '.bak 回退这条路不许被门闩误伤');
  assert.ok(!fs.existsSync(p + '.待人裁'), '没退空就不该改道');
});

t('空仓首写不算退空：没有主档 ≠ 主档坏了（门闩不许把新仓库的第一笔账扣在 .待人裁）', () => {
  const root = makeRoot();   // 项管台账/台账.json 压根不存在
  L.update(root, (l) => { l.管理费.次数 += 1; });
  const p = path.join(root, '项管台账', '台账.json');
  assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).管理费.次数, 1, '首写必须落主档');
  assert.ok(!fs.existsSync(p + '.待人裁'), '首写不是灾情，不许改道');
  assert.ok(!fs.existsSync(path.join(root, '呼叫', 'inbox.jsonl')), '首写更不该往信箱里丢急件');
});
console.log(`全部通过：${passed} 项`);
