// trace.test.js — 四追溯链 + 锚号迁移广播（R5）——H108 十二态口径
const assert = require('node:assert');
const trace = require('../lib/trace');
const store = require('../lib/core/store');
const { makeRoot, seed } = require('./helper');

let passed = 0; const t = (n, f) => { f(); passed++; console.log('  ✓ ' + n); };
console.log('trace 追溯链测试');

t('chains：父子/返工/依据/依赖 四链齐全（新态名）', () => {
  const root = makeRoot();
  seed(root, '归档', { id: 'M', title: '母单' });
  seed(root, '归档', { id: 'DEP' });
  seed(root, '待派', { id: 'C', 父单: 'M', 依赖: 'DEP', 依据: '战斗系统#战斗-03' });
  const c = trace.chains(root, 'C');
  assert.equal(c.父子.父, 'M');
  assert.equal(c.依据, '战斗系统#战斗-03');
  assert.equal(c.依赖[0].id, 'DEP');
  assert.equal(c.依赖[0].state, '归档');
  // 母单能看到子单
  assert.ok(trace.chains(root, 'M').父子.子.some((x) => x.id === 'C'));
});

t('锚号迁移（R5）：广播更新所有未落账单——含完成（判官过而已，未验收，H108 口径）；归档/废弃不改史', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'A', 依据: '战斗系统#战斗-03' });
  seed(root, '在途', { id: 'B', 依据: '战斗系统#战斗-03', 主办: 'x', 领单时间: new Date().toISOString() });
  seed(root, '完成', { id: 'F', 依据: '战斗系统#战斗-03' });   // 完成=未验收，上游改版要跟
  seed(root, '归档', { id: 'DONE', 依据: '战斗系统#战斗-03' }); // 落袋单不动（不改史）
  seed(root, '废弃', { id: 'DEAD', 依据: '战斗系统#战斗-03' }); // 废弃单不动
  seed(root, '待派', { id: 'C', 依据: '外交系统#外-01' });       // 不相关不动
  const r = trace.migrateAnchor(root, '战斗-03', '战斗-04', '战斗系统');
  assert.equal(r.更新数, 3); // A + B + F
  assert.equal(store.find(root, 'A').fm.依据, '战斗系统#战斗-04');
  assert.equal(store.find(root, 'B').fm.依据, '战斗系统#战斗-04');
  assert.equal(store.find(root, 'F').fm.依据, '战斗系统#战斗-04', '完成单要跟：它还没过验收闸');
  assert.equal(store.find(root, 'DONE').fm.依据, '战斗系统#战斗-03'); // 归档单不迁
  assert.equal(store.find(root, 'DEAD').fm.依据, '战斗系统#战斗-03'); // 废弃单不迁
  assert.equal(store.find(root, 'C').fm.依据, '外交系统#外-01'); // 无关单不动
});

t('affectedByRef：列出引用某锚号的未落账单，挂起单也在列（复活后依据同样过期）', () => {
  const root = makeRoot();
  seed(root, '待派', { id: 'A', 依据: '战斗系统#战斗-03' });
  seed(root, '挂起', { id: 'H', 依据: '战斗系统#战斗-03', 挂起前态: '待派' });
  seed(root, '归档', { id: 'D', 依据: '战斗系统#战斗-03' });
  const hits = trace.affectedByRef(root, '战斗-03');
  assert.deepEqual(hits.map((x) => x.id).sort(), ['A', 'H'], '归档不列，挂起要列');
});

/* ===== 子单表格 + 批量验收射程（施工令-028：树形退役，两项能力迁进父单详情页）=====
   树形整页删掉之后，这两条断言就是「能力没丢」的唯一机器凭据。 */

t('子单一览带齐表格五列所需字段（子单号/标题/状态/进度/池），STPCT 换新表', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'P', title: '父单' });
  seed(root, '在途', { id: 'K1', title: '子一', 父单: 'P', 职能: '程序', 执行池: 'codex', 主办: '程序', 领单时间: new Date().toISOString() });
  seed(root, '归档', { id: 'K2', title: '子二', 父单: 'P', 职能: '美术', 执行池: 'claude' });
  seed(root, '初检', { id: 'K3', title: '子三', 父单: 'P', 职能: 'QA' });
  const 子 = trace.chains(root, 'P').父子.子;
  assert.equal(子.length, 3);
  const k1 = 子.find((x) => x.id === 'K1');
  assert.equal(k1.title, '子一');
  assert.equal(k1.state, '在途');
  assert.equal(k1.执行池, 'codex');
  assert.equal(k1.职能, '程序');
  assert.equal(k1.进度, 60, '在途=60%，尺没换');
  assert.equal(子.find((x) => x.id === 'K2').进度, 100, 'H108 归档=落袋=100%（旧已归档0% 的混居口径已分家）');
  assert.equal(子.find((x) => x.id === 'K3').进度, 85, '初检承旧质检 85%');
});

t('进度递归口径：父单取子单均值，不被容器子单拉成 0%；完成=100（专项内部做完等关账即算做完）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'TOP', title: '总单' });
  seed(root, '待派', { id: 'MID', title: '阶段父单', 父单: 'TOP' });  // 容器自身状态=待派(0%)
  seed(root, '完成', { id: 'L1', 父单: 'MID' });                      // 100：判官全过，等关账
  seed(root, '在途', { id: 'L2', 父单: 'MID', 主办: 'x', 领单时间: new Date().toISOString() }); // 60
  const mid = trace.chains(root, 'TOP').父子.子.find((x) => x.id === 'MID');
  assert.equal(mid.子数, 2);
  assert.equal(mid.进度, 80, '(100+60)/2=80，而不是容器自己的 0%');
});

t('批量验收射程：只挑直系「完成」子单（原待验收并入完成），孙单与其它状态一律不进', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'P2', title: '父单' });
  seed(root, '完成', { id: 'A1', 父单: 'P2' });
  seed(root, '完成', { id: 'A2', 父单: 'P2' });
  seed(root, '在途', { id: 'B1', 父单: 'P2', 主办: 'x', 领单时间: new Date().toISOString() }); // 未到验收闸
  seed(root, '归档', { id: 'B2', 父单: 'P2' });     // 已落袋，不再验
  seed(root, '核查', { id: 'B3', 父单: 'P2' });     // 审检中，不进射程
  seed(root, '完成', { id: 'G1', 父单: 'A1' });     // 孙单：完成但不是直系，不许进射程
  seed(root, '完成', { id: 'X1' });                 // 别人家的单
  const 待 = trace.chains(root, 'P2').父子.待验收;
  assert.deepEqual([...待].sort(), ['A1', 'A2'], '多一个都是扩权，少一个都是能力丢失');
});

t('批量验收空态：父下无完成子单时射程为空数组（前端据此不发任何请求）', () => {
  const root = makeRoot();
  seed(root, '完成', { id: 'P3', title: '父单' });
  seed(root, '在途', { id: 'C1', 父单: 'P3', 主办: 'x', 领单时间: new Date().toISOString() });
  assert.deepEqual(trace.chains(root, 'P3').父子.待验收, []);
  const 无子 = trace.chains(root, 'C1');
  assert.deepEqual(无子.父子.子, [], '叶子单没有子单表格可画');
  assert.deepEqual(无子.父子.待验收, []);
});

console.log(`全部通过：${passed} 项`);
