// draft-project-fit.test.js — 起草落盘的「项目落点一查」（TF-13）
//
// 病灶（2026-08-26 一日六例：TK-183/184/197/205/210 …）：监制台/Ticketflow 自身的活被开成 TK 号段单。
// 执行会话 cwd 由项目字段派生，TK 沙箱够不着 Ticketflow 工作区 → 必然评估回呈，每例烧一次执行会话＋一轮裁决。
// 闸装在 draftFm 之后、起草依赖闸与 store.create 之前：拦下即「号不消耗、盘不落、粒不挂钩、不发待审」。
//
// 三层判据：
//   ①纯函数直测（lib/pm/项目落点.js）——判定规则六格全覆盖，脱开 spawn；
//   ②真 draftTicket + 假 CLI 桩（样板照 draft-proj.test.js:112）——错配被拒、且是**真早退**（落盘零/粒不动）；
//   ③正常 TK 单不受影响——同一条链走到底，草稿 md 真落盘。
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { makeRoot, 临时目录, 收尾 } = require('./helper');

const 落点 = require('../lib/pm/项目落点');

let passed = 0; const 红 = [];
const t = (n, f) => {
  try { f(); passed++; console.log('  ✓ ' + n); } catch (e) {
    红.push(n); console.log('  ' + String.fromCharCode(0x2717) + ' ' + n + ' —— ' + e.message);
  }
};
console.log('起草落盘 · 项目落点闸测试（TF-13）');

// 生产形状的双项目注册：TK 默认（前缀 TK）、Ticketflow（前缀 TF）。前缀一律从这张表推，不写死。
const 注册 = { 项目: { 默认: 'TK', 注册: { TK: { 单号前缀: 'TK' }, Ticketflow: { 单号前缀: 'TF' } } } };

// ══════ 一、纯函数直测（验收标准 5：六格必备 + 三格优先级加固）══════

t('纯函数·强特征 × 项目 TK → 拒（apps/studio 落在 TK 号段就是本病）', () => {
  const r = 落点.查落点({ 项目: 'TK', cfg: 注册, 文本: '写区=D:/GitHub/Ticketflow/apps/studio/lib/pm/brain.js' });
  assert.equal(r.ok, false, '强特征命中且落点不在 Ticketflow，必须拒');
  assert.equal(r.疑似项目, 'Ticketflow');
  assert.ok(r.命中.includes('apps/studio'), '命中集要如实列出触发词：' + JSON.stringify(r.命中));
  assert.match(r.error, /项目落点疑似错配/);
});

t('纯函数·强特征 × 项目 Ticketflow → 放（自维护单填对了项目，照常起草）', () => {
  const r = 落点.查落点({ 项目: 'Ticketflow', cfg: 注册, 文本: '写区=apps/studio/lib/pm/brain.js' });
  assert.equal(r.ok, true, '落点已在 Ticketflow，判疑似也不该拦——拦了就是误杀自维护单');
});

t('纯函数·单个弱词 ＋ TK 写区 → 放（「回执贴进监制台」是 TK 单常态，一词不判）', () => {
  const r = 落点.查落点({ 项目: 'TK', cfg: 注册, 文本: '改 D:/GitHub/TK/Assets/Scripts/Pathfind.cs，回执贴进监制台' });
  assert.equal(r.ok, true, '一个弱词就判＝把正常 TK 单成片误杀');
});

t('纯函数·两个弱词 × 项目 TK → 拒（≥2 个不同弱词才够判疑似）', () => {
  const r = 落点.查落点({ 项目: 'TK', cfg: 注册, 文本: '把监制台的排程台账那一页重画' });
  assert.equal(r.ok, false, '两个不同弱词命中且无 TK 反证，应判疑似');
  assert.deepEqual(r.命中.sort(), ['排程台账', '监制台'].sort());
});

t('纯函数·空文本 → 放（没证据不许判，为图省事的默认拒是造假）', () => {
  assert.equal(落点.查落点({ 项目: 'TK', cfg: 注册, 文本: '' }).ok, true);
  assert.equal(落点.查落点({ 项目: 'TK', cfg: 注册 }).ok, true, '文本缺参也不许炸');
});

t('纯函数·反斜杠形 D:\\GitHub\\Ticketflow → 拒（归一化①：\\ 与大小写都不该是漏网口）', () => {
  const r = 落点.查落点({ 项目: 'TK', cfg: 注册, 文本: '写区 D:\\GitHub\\Ticketflow\\apps\\studio\\server.js' });
  assert.equal(r.ok, false, '反斜杠形没归一就会整类漏判');
  assert.ok(r.命中.includes('d:/github/ticketflow'), '命中集：' + JSON.stringify(r.命中));
});

t('纯函数·优先级⑤：强特征遇 TK 反证仍拒（反证只豁免弱特征，压不过强特征）', () => {
  const r = 落点.查落点({ 项目: 'TK', cfg: 注册, 文本: '照 D:/GitHub/TK/Assets 的口径，改 apps/studio/lib/pm/brain.js' });
  assert.equal(r.ok, false, '强特征被反证豁免掉＝本闸对「顺带提一句 TK 写区」的错配单失效');
});

t('纯函数·优先级⑤：两弱词 ＋ TK 反证 → 放（仅弱特征时反证生效）', () => {
  const r = 落点.查落点({ 项目: 'TK', cfg: 注册, 文本: '改 D:/GitHub/TK/Assets/Scripts/A.cs；监制台与排程台账各贴一份回执' });
  assert.equal(r.ok, true, '仅弱特征命中且有 TK 反证，应放行');
});

t('纯函数·前缀不写死：注册表把 Ticketflow 的前缀改成别的，判定跟着走', () => {
  const 改 = { 项目: { 默认: 'TK', 注册: { TK: { 单号前缀: 'TK' }, Ticketflow: { 单号前缀: 'ZZ' } } } };
  const 文本 = '写区=apps/studio/lib/pm/brain.js';
  assert.equal(落点.查落点({ 项目: 'Ticketflow', cfg: 改, 文本 }).ok, true, '仍按注册表认得出是同一个项目');
  const r = 落点.查落点({ 项目: 'TK', cfg: 改, 文本 });
  assert.equal(r.ok, false);
  assert.match(r.error, /ZZ/, '报文里的前缀必须来自注册表，不是写死的 TF');
});

// ══════ 二、真 draftTicket + 假 CLI 桩（LLM 面替换，别的一概走真码）══════

// 起草一次：造临时根 + 登记一粒 + 假 CLI 吐 canned ticket 块 → 回调结果与盘面全量回传。
function 跑起草({ 需求, 项目, canned }) {
  const root = makeRoot();
  const 桩目录 = 临时目录('tf13cli-');
  fs.writeFileSync(path.join(桩目录, 'canned.txt'), canned, 'utf8');
  fs.writeFileSync(path.join(桩目录, 'fake-cli.js'),
    "const fs=require('fs');const path=require('path');\n"
    + "process.stdin.on('data',()=>{});\n"
    + "process.stdin.on('end',()=>{console.log(fs.readFileSync(path.join(__dirname,'canned.txt'),'utf8'));});\n", 'utf8');
  const code = `
    const cp = require('child_process');
    const orig = cp.spawn;
    cp.spawn = function (cmd) { // 只换 claude 外呼；node（假 CLI 自身）照走
      if (/claude/i.test(String(cmd))) return orig(process.execPath, [process.env.FAKE_CLI], { windowsHide: true });
      return orig.apply(cp, arguments);
    };
    const brain = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'pm', 'brain.js'))});
    const schedule = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'pm', 'schedule.js'))});
    const store = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'core', 'store.js'))});
    const root = process.env.STUDIO_ROOT;
    const cfg = ${JSON.stringify(注册)};
    const r1 = schedule.登记(root, [{ 题: 'TF13 主粒', 来源: 'TF13' }], '总监');
    if (!r1.ok) { process.stdout.write('@@' + JSON.stringify({ 登记失败: r1.error }) + '@@'); process.exit(1); }
    const 粒ID = r1.新增[0].粒ID;
    brain.draftTicket(root, cfg, ${JSON.stringify(需求)}, null, (r) => {
      // 落盘零判据：把 STATES 全态的单库一次扫干净，任何一张新单都算落了盘
      const 盘上单 = [];
      for (const s of store.STATES) for (const x of store.list(root, s)) 盘上单.push(s + '/' + x.id);
      const t2 = r.ok ? store.find(root, r.单) : null;
      const g = schedule.取(root, 粒ID);
      process.stdout.write('@@' + JSON.stringify({
        r, 盘上单, 粒态: g && g.状态, 粒单号: (g && g.单号) || null,
        找得到: !!t2, 落盘项目: t2 && t2.fm.项目,
      }) + '@@');
      process.exit(0);
    }, { 粒ID, 项目: ${JSON.stringify(项目 || null)} });`;
  let raw = '';
  try {
    raw = execFileSync(process.execPath, ['-e', code], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, STUDIO_ROOT: root, FAKE_CLI: path.join(桩目录, 'fake-cli.js') },
    });
  } catch (e) {
    // 子进程崩了不许把整套件带崩——回一个可断言的形，让红出现在具体用例上而不是 harness 里
    return { 子进程崩: String((e.stderr || e.message || '').toString()).slice(0, 600) };
  }
  return JSON.parse((raw.match(/@@([\s\S]*)@@/) || [])[1] || '{}');
}

const 通用块 = (范围) => '```ticket\ntitle: 落点闸验证\n职能: 程序\n---\n## 范围\n' + 范围 + '\n```\n\n## 起草说明\n无样本，未校准\n';

// 判据①：需求点名 Ticketflow 写区、项目走默认 TK
const 错配 = 跑起草({
  需求: '给起草链加一道闸。写区=D:/GitHub/Ticketflow/apps/studio/lib/pm/brain.js，新模块放 lib/pm/ 下。',
  项目: null, canned: 通用块('照工单加闸'),
});

t('判据①·错配被拒：真 draftTicket 回调 ok=false，报文含「项目落点疑似错配」与「Ticketflow」', () => {
  assert.ok(错配.r, 'draftTicket 没回调：' + JSON.stringify(错配));
  assert.equal(错配.r.ok, false, '错配单必须被拒，实收：' + JSON.stringify(错配.r));
  assert.ok(String(错配.r.error).includes('项目落点疑似错配'), 'error 缺定性词：' + 错配.r.error);
  assert.ok(String(错配.r.error).includes('Ticketflow'), 'error 缺疑似项目名：' + 错配.r.error);
  assert.equal(错配.r.疑似项目, 'Ticketflow');
  // 报文全文入输出：这一段就是派单人看到的改正指引，跑绿时也该看得见（回执直接取证）
  for (const l of String(错配.r.error).split(String.fromCharCode(10))) console.log('      | ' + l);
});

t('判据①附加·真早退：落盘零（STATES 全态无新单）', () => {
  assert.deepEqual(错配.盘上单, [], '闸后仍有单落盘＝早退点站错位置（必须在 store.create 之前）：' + JSON.stringify(错配.盘上单));
});

t('判据①附加·真早退：粒仍是登记初态「计划」，未被挂钩成「起草中」、未回填单号', () => {
  assert.equal(错配.粒态, '计划', '粒被挂钩了＝早退点在 store.create 之后');
  assert.equal(错配.粒单号, null, '号不该被消耗到粒上');
});

// 判据②：正常 TK 单（写区在游戏工程）
const 正常 = 跑起草({
  需求: '修寻路绕路。写区=D:/GitHub/TK/Assets/Scripts/Map/Pathfind.cs，回执贴进监制台。',
  项目: null, canned: 通用块('改 Assets/Scripts/Map/Pathfind.cs 的绕路判定'),
});

t('判据②·正常 TK 单不受影响：ok=true 且草稿 md 真落盘（store.find 取得到）', () => {
  assert.ok(正常.r && 正常.r.ok, '正常单被误杀＝闸过紧：' + JSON.stringify(正常.r));
  assert.ok(正常.找得到, '回了 ok 却找不到落盘的单：' + JSON.stringify(正常));
  assert.equal(正常.落盘项目, 'TK');
  assert.equal(正常.粒态, '起草中', '正常路的粒挂钩行为一字不变');
  console.log('      · 新单号 ' + 正常.r.单 + '（落盘项目 ' + 正常.落盘项目 + '）');
});

if (红.length) {
  console.log('不通过 ' + 红.length + ' 项：' + 红.join('；'));
  process.exit(1);
}
收尾(null, passed);
