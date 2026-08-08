#!/usr/bin/env node
// test.js — 瞭望塔自测（施工令-018 验收标准第 5 条）
// 用法：node test.js            全跑（单元 + 端到端，含一发真实跨分钟时钟，约 90s）
//      node test.js --fast     跳过跨分钟等待（时钟改用「当前分钟即触发」口径）
//
// 纪律：端到端一律在系统临时目录里造【假部署区】（journal/ 呼叫/ 齐备），
//      真部署区 D:\GitHub\AI-GameStudio\监制台 一个字节都不碰；
//      通知走 WATCHTOWER_TOAST_FILE_ONLY=1 落文件，不刷屏；
//      远端（E5，施工令-023）一律拿【本地 bare 仓】当假 origin，真远端不碰、更无写操作，
//      其余各例的 远端.启用 一律 false（内置默认仓清单指着真仓，不许误触）。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const W = require('./watchtower.js');
const 守护 = path.join(__dirname, 'watchtower.js');
const 快 = process.argv.includes('--fast');

let 过 = 0; const 挂 = [];
function ok(名, 真, 详) {
  if (真) { 过++; process.stdout.write(`  ✔ ${名}\n`); }
  else { 挂.push(名 + (详 ? ` —— ${详}` : '')); process.stdout.write(`  ✗ ${名}${详 ? ` —— ${详}` : ''}\n`); }
}
const eq = (名, 得, 期) => ok(名, JSON.stringify(得) === JSON.stringify(期), `得 ${JSON.stringify(得)}，期 ${JSON.stringify(期)}`);
const 章 = (s) => process.stdout.write(`\n【${s}】\n`);
const 睡 = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

// ════════════════════════════ 单元 ════════════════════════════
function 单元() {
  章('U1 参数解析');
  eq('--k v 取值 / --k 后接 --k2 为布尔 / 非 -- 前缀忽略',
    W.解析参数(['--root', 'D:/x', '--once', '--limit', '5', '垃圾', '--install']),
    { root: 'D:/x', once: true, limit: '5', install: true });

  章('U2 当月日志名（月切跟随的算子）');
  eq('1 月补零', W.当月日志名(new Date(2027, 0, 9)), '2027-01.log');
  eq('12 月', W.当月日志名(new Date(2026, 11, 31)), '2026-12.log');

  章('U3 规则匹配');
  const 表 = W.默认规则表.规则;
  eq('信箱急件命中「急件」', W.匹配规则(表, '信箱', '级别=急 类型=三振上呈 摘要=TK-104 待裁 单号=TK-104').名, '急件');
  eq('首匹配优先：流水里的三振先中「三振上呈」而非「兜底」', W.匹配规则(表, '流水', 'TK-104 三振上呈，四件套待裁').名, '三振上呈');
  eq('信源隔离：流水文本不会命中 信源=信箱 的规则', W.匹配规则(表, '流水', '级别=急').名, '兜底');
  eq('无匹配落兜底（仅记流水）', W.匹配规则([{ 名: 'X', 信源: '信箱', 正则: 'zzz' }], '信箱', 'aaa'), W.兜底规则);
  const 警 = [];
  eq('坏正则跳过不炸，继续往下匹配',
    W.匹配规则([{ 名: '坏', 信源: '*', 正则: '([' }, { 名: '好', 信源: '*', 正则: 'abc' }], '流水', 'xx abc yy', 警).名, '好');
  ok('坏正则登记进告警', 警.length === 1 && /坏/.test(警[0]), JSON.stringify(警));
  eq('停用规则跳过', W.匹配规则([{ 名: 'A', 信源: '*', 正则: '.', 停用: true }], '流水', 'x'), W.兜底规则);

  章('U4 信源规范化');
  eq('流水行头解析', W.规范流水('[2026-08-08 01:20] 验收 TK-24：通过→完成'), { 原时刻: '2026-08-08 01:20', 文本: '验收 TK-24：通过→完成' });
  eq('续行（journal 内嵌报告）不成事件', W.规范流水('| 文件 | 存在 |'), null);
  eq('信箱 JSON → 规范串',
    W.规范信箱('{"t":"2026-08-07T02:23:29.309Z","级别":"急","类型":"三振上呈","摘要":"TK-104 QA 修不好","单号":"TK-104"}'),
    { 原时刻: '2026-08-07T02:23:29.309Z', 文本: '级别=急 类型=三振上呈 摘要=TK-104 QA 修不好 单号=TK-104', 级别: '急' });
  eq('信箱脏行返回 null（不毒死整轮）', W.规范信箱('{半个 json'), null);
  eq('多行事件压成一行', W.单行('第一行\n第二行\r\n第三行'), '第一行 ⏎ 第二行 ⏎ 第三行');
  ok('密钥形状抹除', W.scrub('key=sk-abcdef1234567890 tail').includes('***已抹除***'), W.scrub('key=sk-abcdef1234567890 tail'));

  章('U5 尾随器（tail 断续 / 截断 / 编码）');
  const 巢 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-unit-'));
  const f = path.join(巢, 'a.log');
  fs.writeFileSync(f, '');
  const t = W.新尾随({});
  W.尾随读(t, f, { 从头: true });
  fs.appendFileSync(f, '完整一行\n半行没换');
  eq('半行不吐，只吐完整行', W.尾随读(t, f, {}).行, ['完整一行']);
  fs.appendFileSync(f, '行符\n');
  eq('下轮补齐后吐出完整半行', W.尾随读(t, f, {}).行, ['半行没换行符']);
  // UTF-8 多字节被切在两次写入之间
  const 汉 = Buffer.from('汉字测试\n', 'utf8');
  fs.appendFileSync(f, 汉.slice(0, 5));
  eq('多字节被切开时不吐半个字', W.尾随读(t, f, {}).行, []);
  fs.appendFileSync(f, 汉.slice(5));
  eq('补齐后中文不乱码', W.尾随读(t, f, {}).行, ['汉字测试']);
  eq('CRLF 行尾被剥', (fs.appendFileSync(f, 'CR行\r\n'), W.尾随读(t, f, {}).行), ['CR行']);
  fs.writeFileSync(f, '截断后新行\n');                                  // 文件变小 = 截断
  const r截 = W.尾随读(t, f, {});
  eq('文件截断后位置归零不漏读', r截.行, ['截断后新行']);
  ok('截断留痕', r截.说明.some((s) => /截断/.test(s)), JSON.stringify(r截.说明));
  const t2 = W.新尾随({});
  W.尾随读(t2, path.join(巢, '不存在.log'), {});
  const r缺 = W.尾随读(t2, path.join(巢, '不存在.log'), {});
  eq('文件缺席不炸、缺席只报一次', r缺.行, []);
  const t3 = W.新尾随({});
  fs.writeFileSync(f, '旧内容一\n旧内容二\n');
  W.尾随读(t3, f, {});                                                  // 冷启默认从尾
  eq('冷启从文件尾，不回放历史', W.尾随读(t3, f, {}).行, []);
  const t4 = W.新尾随({ 路径: f, 位置: 999999 });
  eq('换档从头（月切口径）读到新文件全部内容', W.尾随读(t4, f, { 换档从头: true }).行, ['旧内容一', '旧内容二']);

  章('U6 心跳判定（连续两次报一次，恢复报一次）');
  const h = { 连续失败: 0, 已报失联: false, 阈值: 2 };
  eq('第 1 次失败不报', W.心跳判定(h, false), null);
  eq('第 2 次失败报失联', W.心跳判定(h, false), '监制台失联');
  eq('第 3 次失败不重复报', W.心跳判定(h, false), null);
  eq('恢复报一次', W.心跳判定(h, true), '监制台恢复');
  eq('恢复后再通不重复报', W.心跳判定(h, true), null);
  eq('二度失联可再报', (W.心跳判定(h, false), W.心跳判定(h, false)), '监制台失联');

  章('U7 时钟到点');
  const 触 = new Map();
  const d = (h2, m2) => new Date(2026, 7, 8, h2, m2, 0);
  const 晨 = { 名: '晨报', 定点: '09:03' };
  eq('未到点不触发', W.时钟到点(晨, d(9, 2), 触), false);
  eq('到点触发', W.时钟到点(晨, d(9, 3), 触), true);
  eq('同日同点不重复', W.时钟到点(晨, d(9, 4), 触), false);
  const 触2 = new Map();
  eq('晚 4 分钟仍补报（默认窗 5min）', W.时钟到点(晨, d(9, 7), 触2), true);
  const 触3 = new Map();
  eq('晚 30 分钟不补报（防重启回放整天）', W.时钟到点(晨, d(9, 33), 触3), false);
  eq('非法定点不触发', W.时钟到点({ 名: 'X', 定点: '99:99' }, d(9, 3), new Map()), false);
  eq('00:00 切夜班可触发', W.时钟到点({ 名: '夜', 定点: '00:00' }, d(0, 0), new Map()), true);

  章('U8 账本读写 / 水位清账');
  const 账 = path.join(巢, '未读账本.jsonl');
  const 水 = path.join(巢, '账本水位.json');
  W.追加账本(账, { id: '1', t: '2026-08-08T01:00:00.000Z', 信源: '信箱', 级别: '急', 规则: '急件', 文本: 'A' });
  W.追加账本(账, { id: '2', t: '2026-08-08T02:00:00.000Z', 信源: '流水', 级别: '常', 规则: '完成', 文本: 'B' });
  fs.appendFileSync(账, '{脏行不该毒死整本\n');
  W.追加账本(账, { id: '3', t: '2026-08-08T03:00:00.000Z', 信源: '时钟', 级别: '急', 规则: '晨报', 文本: 'C' });
  eq('脏行被跳过，其余照读', W.读账本(账).map((e) => e.id), ['1', '2', '3']);
  eq('未清过账时全未读', W.未读筛(W.读账本(账), W.读水位(水)).length, 3);
  W.写水位(水, '2026-08-08T02:00:00.000Z');
  eq('水位前移后只剩水位之后的', W.未读筛(W.读账本(账), W.读水位(水)).map((e) => e.id), ['3']);
  W.写水位(水, '2026-08-08T09:00:00.000Z');
  eq('水位盖过全部 = 清空未读', W.未读筛(W.读账本(账), W.读水位(水)).length, 0);

  章('U9 计划任务 XML / 通知脚本组装');
  const xml = W.任务XML('C:\\Program Files\\nodejs\\node.exe', '"D:\\a b\\watchtower.js" --root "D:\\x"', 'D:\\GitHub\\AI-GameStudio\\监制台', 'DOM\\usr');
  ok('XML 带 LogonTrigger', /<LogonTrigger>/.test(xml));
  // 实测定谳：Principal 缺 UserId 时 schtasks /Create 直接 Access denied，加上才注册得进去
  ok('Principal 与 LogonTrigger 都带 UserId', (xml.match(/<UserId>DOM\\usr<\/UserId>/g) || []).length === 2, xml.match(/<UserId>[^<]*<\/UserId>/g));
  ok('XML 带 WorkingDirectory=部署区', /<WorkingDirectory>D:\\GitHub\\AI-GameStudio\\监制台<\/WorkingDirectory>/.test(xml));
  ok('XML 参数里的引号已转义', /&quot;/.test(xml) && !/[^&]"D:/.test(xml.split('<Arguments>')[1].split('</Arguments>')[0]));
  const ps = W.通知脚本("标题'带单引号", '正文');
  ok('通知脚本单引号已转义', /''/.test(ps));
  ok('通知脚本三档回落齐全', /BurntToast/.test(ps) && /NotifyIcon/.test(ps) && /msg \*/.test(ps));

  章('U10 远端 refs 解析 / 信道文书判定（施工令-023）');
  const A = 'a'.repeat(40); const B = 'b'.repeat(40); const C = 'c'.repeat(40);
  eq('for-each-ref 输出解析成 { ref: sha }',
    W.解析远端refs(`${A} refs/remotes/origin/main\n${B} refs/remotes/origin/feat/x\n`),
    { 'refs/remotes/origin/main': A, 'refs/remotes/origin/feat/x': B });
  eq('origin/HEAD 是符号引用，不当分支',
    Object.keys(W.解析远端refs(`${A} refs/remotes/origin/main\n${A} refs/remotes/origin/HEAD\n`)), ['refs/remotes/origin/main']);
  eq('杂行/空行跳过不炸', W.解析远端refs('warning: 一句提示\n\n垃圾'), {});
  eq('远端短名剥前缀', W.远端短名('refs/remotes/origin/feat/x'), 'origin/feat/x');
  ok('信道文书：docs 下带「交接」的 md', W.是信道文书('docs/交接-2026-08-08.md'));
  ok('信道文书：docs 子目录名带「回执」也算', W.是信道文书('docs/回执/TK-104.md'));
  ok('信道文书：带「信道」', W.是信道文书('工程队/docs/信道说明.md'));
  ok('非 docs 下的同名 md 不算', !W.是信道文书('工程队/交接-x.md'));
  ok('docs 下的普通 md 不算', !W.是信道文书('docs/设计稿.md'));
  ok('docs 下的非 md 不算', !W.是信道文书('docs/交接.txt'));
  ok('反斜杠路径同样认', W.是信道文书('docs\\交接\\a.md'));

  章('U11 远端快照比对 / 事件文本');
  const 差 = W.比对远端(
    { 'refs/remotes/origin/main': A, 'refs/remotes/origin/老': C },
    { 'refs/remotes/origin/main': B, 'refs/remotes/origin/新': C });
  eq('改了 sha 的算新提交', 差.新提交.map((x) => x.ref), ['refs/remotes/origin/main']);
  eq('只在新快照里的算新分支', 差.新分支.map((x) => x.ref), ['refs/remotes/origin/新']);
  eq('只在旧快照里的算删分支', 差.删分支.map((x) => x.ref), ['refs/remotes/origin/老']);
  eq('无变化 = 三类全空', W.比对远端({ x: A }, { x: A }), { 新提交: [], 新分支: [], 删分支: [] });
  eq('普通新提交文本',
    W.远端事件('Ticketflow', W.比对远端({ 'refs/remotes/origin/main': A }, { 'refs/remotes/origin/main': B }), { 'refs/remotes/origin/main': ['apps/a.js'] }),
    [{ 种类: '新提交', ref: 'refs/remotes/origin/main', 文本: `新提交 Ticketflow origin/main ${'a'.repeat(7)}..${'b'.repeat(7)}` }]);
  const 文书事件 = W.远端事件('Ticketflow',
    W.比对远端({ 'refs/remotes/origin/main': A }, { 'refs/remotes/origin/main': B }),
    { 'refs/remotes/origin/main': ['apps/a.js', 'docs/交接-x.md'] });
  eq('触及信道文书 → 整条升格为「信道文书」，不再另发一条新提交', 文书事件.map((e) => e.种类), ['信道文书']);
  ok('信道文书事件文本点名文件', /触及 docs\/交接-x\.md/.test(文书事件[0].文本), 文书事件[0].文本);
  eq('新分支文本',
    W.远端事件('T', W.比对远端({}, { 'refs/remotes/origin/feat': B }), {}).map((e) => e.文本),
    [`新分支 T origin/feat（${'b'.repeat(7)}）`]);
  eq('删分支文本',
    W.远端事件('T', W.比对远端({ 'refs/remotes/origin/feat': B }, {}), {}).map((e) => e.文本),
    [`删分支 T origin/feat（原 ${'b'.repeat(7)}）`]);

  章('U12 远端默认规则分档');
  const 表远 = W.默认规则表.规则;
  const 中 = (t) => W.匹配规则(表远, '远端', t);
  eq('信道文书 → 急 + 弹通知', [中('信道文书 T origin/main a..b 触及 docs/交接.md').名, 中('信道文书 T origin/main a..b 触及 docs/交接.md').级别, 中('信道文书 T origin/main a..b 触及 docs/交接.md').动作.includes('弹通知')], ['远端信道文书', '急', true]);
  eq('新提交 → 常 + 记未读不弹', [中('新提交 T origin/main a..b').名, 中('新提交 T origin/main a..b').级别, 中('新提交 T origin/main a..b').动作], ['远端新提交', '常', ['记流水', '记未读']]);
  eq('新分支 → 常 + 记未读不弹', [中('新分支 T origin/feat（bbbbbbb）').名, 中('新分支 T origin/feat（bbbbbbb）').动作], ['远端分支变动', ['记流水', '记未读']]);
  eq('删分支 → 走分支变动', 中('删分支 T origin/feat（原 bbbbbbb）').名, '远端分支变动');
  eq('远端三条不串到别的信源', W.匹配规则(表远, '流水', '新提交 something').名, '兜底');
  eq('远端段默认值', [W.默认远端.启用, W.默认远端.间隔毫秒, Array.isArray(W.默认远端.仓清单)], [true, 300000, true]);

  章('U13 心跳戳（施工令-024）：覆盖写一行 ISO / 读回带毫秒龄');
  const 戳巢 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-hb-'));
  const 戳 = path.join(戳巢, '心跳.txt');
  eq('文件不存在读回 null', W.读心跳戳(戳), null);
  ok('写入成功返回 true', W.写心跳戳(戳, new Date('2026-08-09T01:02:03.456Z')));
  eq('内容 = 一行 ISO 时刻，无换行', fs.readFileSync(戳, 'utf8'), '2026-08-09T01:02:03.456Z');
  const 读1 = W.读心跳戳(戳);
  ok('读回有效且时刻一致', !!读1 && 读1.有效 === true && 读1.时刻 === '2026-08-09T01:02:03.456Z', JSON.stringify(读1));
  W.写心跳戳(戳, new Date(Date.now() - 5000));                      // 拿 5s 前的真实刻算龄，别拿写死的未来时刻
  const 读龄 = W.读心跳戳(戳);
  ok('毫秒龄为数且非负、量级对', !!读龄 && Number.isFinite(读龄.毫秒龄) && 读龄.毫秒龄 >= 4000 && 读龄.毫秒龄 < 60000, String(读龄 && 读龄.毫秒龄));
  ok('覆盖写不追加', (W.写心跳戳(戳, new Date('2026-08-09T02:00:00.000Z')), fs.readFileSync(戳, 'utf8') === '2026-08-09T02:00:00.000Z'));
  const 新读 = W.读心跳戳(戳);
  ok('第二戳读回新时刻', !!新读 && 新读.时刻 === '2026-08-09T02:00:00.000Z');
  fs.writeFileSync(戳, '不是时间戳', 'utf8');
  const 脏读 = W.读心跳戳(戳);
  ok('脏内容判无效不炸', !!脏读 && 脏读.有效 === false, JSON.stringify(脏读));
  eq('默认间隔 30s', W.默认心跳戳间隔, 30000);
  try { fs.rmSync(戳巢, { recursive: true, force: true }); } catch { /* 留着无妨 */ }

  try { fs.rmSync(巢, { recursive: true, force: true }); } catch { /* 留着无妨 */ }
}

// ════════════════════════════ 端到端脚手架 ════════════════════════════
function 造假部署区(标) {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), `wt-e2e-${标}-`));
  fs.mkdirSync(path.join(根, 'journal'), { recursive: true });
  fs.mkdirSync(path.join(根, '呼叫'), { recursive: true });
  fs.mkdirSync(path.join(根, '瞭望塔'), { recursive: true });
  const 月 = W.当月日志名(new Date());
  fs.writeFileSync(path.join(根, 'journal', 月), '[2026-08-01 00:00] 冷启前的历史行，不该被回放\n', 'utf8');
  fs.writeFileSync(path.join(根, '呼叫', 'inbox.jsonl'), '', 'utf8');
  return {
    根,
    月日志: path.join(根, 'journal', 月),
    信箱: path.join(根, '呼叫', 'inbox.jsonl'),
    规则: path.join(根, '瞭望塔', '规则.json'),
    流水: path.join(根, '瞭望塔', '瞭望塔流水.log'),
    账本: path.join(根, '瞭望塔', '未读账本.jsonl'),
    回落: path.join(根, '瞭望塔', '通知回落.log'),
    pid: path.join(根, '瞭望塔', 'watchtower.pid'),
    远端游标: path.join(根, '瞭望塔', '远端游标.json'),
    心跳: path.join(根, '瞭望塔', '心跳.txt'),
  };
}
const 读文本 = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
function 起守护(区, 额外env, 额外参数) {
  const c = spawn(process.execPath, [守护, '--root', 区.根, '--rules', 区.规则].concat(额外参数 || []), {
    env: Object.assign({}, process.env, { WATCHTOWER_TOAST_FILE_ONLY: '1' }, 额外env || {}),
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  c.stdout.on('data', () => {}); c.stderr.on('data', () => {});
  return c;
}
function 停守护(c) {
  if (!c || c.killed) return;
  if (process.platform === 'win32') { try { spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }); return; } catch { /* 回落 */ } }
  try { c.kill('SIGKILL'); } catch { /* 已死 */ }
}
async function 等到(判, 上限ms, 步长) {
  const 止 = Date.now() + 上限ms;
  for (;;) { if (判()) return true; if (Date.now() > 止) return false; await 睡(步长 || 250); }
}
// 注意 远端.启用 默认 false：内置默认的仓清单指着真仓 D:\GitHub\Ticketflow，
// 除 E5 自己搭的假 origin 外，任何一例都不许摸真远端。
const 基础规则 = (改) => Object.assign({
  轮询毫秒: 300,
  心跳: { 地址: 'http://127.0.0.1:1/api/board', 间隔毫秒: 3600000, 超时毫秒: 800, 连续失败阈值: 2 },
  远端: { 启用: false, 间隔毫秒: 3600000, 超时毫秒: 5000, 仓清单: [] },
  规则: W.默认规则表.规则,
  时钟: [],
}, 改 || {});

// ════════════════════════════ E1 三路投递 + 规则热改 ════════════════════════════
async function E1() {
  章('E1 假部署区：journal/inbox 注入 → 流水 + 未读 + 急件 toast 三路，规则表改动生效');
  const 区 = 造假部署区('三路');
  fs.writeFileSync(区.规则, JSON.stringify(基础规则(), null, 2), 'utf8');
  const c = 起守护(区);
  ok('守护起来了（流水见上岗行）', await 等到(() => /瞭望塔上岗/.test(读文本(区.流水)), 12000));
  ok('冷启不回放历史行', !/冷启前的历史行/.test(读文本(区.流水)));

  fs.appendFileSync(区.月日志, '[2026-08-08 01:30] 验收 TK-24：通过→完成\n', 'utf8');
  fs.appendFileSync(区.月日志, '[2026-08-08 01:31] 巡检例行一句，无关键词\n', 'utf8');
  fs.appendFileSync(区.信箱, JSON.stringify({ t: new Date().toISOString(), 级别: '急', 类型: '三振上呈', 摘要: 'E1 造的急件', 单号: 'TK-999' }) + '\n', 'utf8');
  fs.appendFileSync(区.信箱, JSON.stringify({ t: new Date().toISOString(), 级别: '常', 类型: '编辑器占用', 摘要: 'TK 派发挂起' }) + '\n', 'utf8');
  ok('三条都落了流水', await 等到(() => {
    const s = 读文本(区.流水);
    return /\[流水\].*验收 TK-24/.test(s) && /\[信箱\].*E1 造的急件/.test(s) && /\[信箱\].*编辑器占用/.test(s);
  }, 12000), 读文本(区.流水).slice(-600));

  const 流 = 读文本(区.流水);
  ok('急件带 急 级别与规则名', /\[信箱\] 急 急件 \| .*E1 造的急件/.test(流), 流.split('\n').filter((l) => /E1 造的急件/.test(l)).join(''));
  ok('无关键词的流水行只记流水（走兜底）', /\[流水\] 常 兜底 \| 巡检例行一句/.test(流));

  ok('未读账本收到急件与完成', await 等到(() => {
    const 本 = W.读账本(区.账本);
    return 本.some((e) => /E1 造的急件/.test(e.文本) && e.级别 === '急') && 本.some((e) => /验收 TK-24/.test(e.文本));
  }, 8000), JSON.stringify(W.读账本(区.账本).map((e) => e.文本)));
  ok('兜底事件不进未读账本', !W.读账本(区.账本).some((e) => /巡检例行一句/.test(e.文本)));
  ok('急件触发了通知（实测强制落文件通道）', await 等到(() => /E1 造的急件/.test(读文本(区.回落)), 8000), 读文本(区.回落));
  ok('常件不触发通知', !/编辑器占用/.test(读文本(区.回落)));

  // —— 规则表热改：把「编辑器占用」提成弹通知急件 ——
  const 新表 = 基础规则();
  新表.规则 = [{ 名: '编辑器占用升格', 信源: '信箱', 正则: '编辑器占用', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] }].concat(W.默认规则表.规则);
  fs.writeFileSync(区.规则, JSON.stringify(新表, null, 2), 'utf8');
  ok('规则表热重载生效（流水见重载行）', await 等到(() => /规则表重载/.test(读文本(区.流水)), 8000));
  fs.appendFileSync(区.信箱, JSON.stringify({ t: new Date().toISOString(), 级别: '常', 类型: '编辑器占用', 摘要: '改表后这条该弹' }) + '\n', 'utf8');
  ok('改表后同类事件按新规则弹通知', await 等到(() => /改表后这条该弹/.test(读文本(区.回落)), 8000), 读文本(区.回落));
  ok('改表后该事件级别升为 急', /\[信箱\] 急 编辑器占用升格 \| .*改表后这条该弹/.test(读文本(区.流水)));

  // —— pid 互斥 ——
  const 二 = spawnSync(process.execPath, [守护, '--root', 区.根, '--rules', 区.规则], { encoding: 'utf8', windowsHide: true, env: Object.assign({}, process.env, { WATCHTOWER_TOAST_FILE_ONLY: '1' }) });
  ok('pid 互斥：第二个实例退出码非 0', 二.status !== 0, `退出码 ${二.status}`);
  ok('pid 互斥：报「已有瞭望塔在岗」', /已有瞭望塔在岗/.test(String(二.stdout)), String(二.stdout).trim());

  停守护(c);
  await 睡(1200);

  // —— --ack 清账 ——
  const 未读前 = W.读账本(区.账本).length;
  const a = spawnSync(process.execPath, [守护, '--root', 区.根, '--rules', 区.规则, '--ack', 'all'], { encoding: 'utf8', windowsHide: true });
  let aj = null; try { aj = JSON.parse(String(a.stdout).trim().split('\n').pop()); } catch { /* 下面判空 */ }
  ok('--ack all 成功', !!(aj && aj.ok), String(a.stdout).trim());
  ok('--ack 清账数 = 清账前未读数', !!aj && aj['清账数'] === 未读前, `清 ${aj && aj['清账数']} / 原 ${未读前}`);
  ok('--ack 后剩余未读 0', !!aj && aj['剩余未读'] === 0);
  ok('守护已下岗，账本被压实', !!aj && aj['已压实'] === true && aj['守护在岗'] === false);
  const u = spawnSync(process.execPath, [守护, '--root', 区.根, '--rules', 区.规则, '--unread'], { encoding: 'utf8', windowsHide: true });
  let uj = null; try { uj = JSON.parse(String(u.stdout).trim().split('\n').pop()); } catch { /* 下面判空 */ }
  ok('--unread 复核为 0', !!uj && uj['未读'] === 0, String(u.stdout).trim());
  return 区;
}

// ════════════════════════════ E2 心跳失联/恢复 ════════════════════════════
async function E2() {
  章('E2 心跳：连续两次不通报一次失联，恢复报一次恢复');
  const 区 = 造假部署区('心跳');
  // 先占一个空闲端口拿号，随即让开——守护起来时它是不通的
  const 探 = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"ok":true}'); });
  await new Promise((r) => 探.listen(0, '127.0.0.1', r));
  const 端口 = 探.address().port;
  await new Promise((r) => 探.close(r));

  fs.writeFileSync(区.规则, JSON.stringify(基础规则({
    心跳: { 地址: `http://127.0.0.1:${端口}/api/board`, 间隔毫秒: 1000, 超时毫秒: 800, 连续失败阈值: 2 },
  }), null, 2), 'utf8');
  const c = 起守护(区);
  ok('守护起来了', await 等到(() => /瞭望塔上岗/.test(读文本(区.流水)), 12000));
  ok('连续两次不通 → 报一次失联', await 等到(() => /监制台失联/.test(读文本(区.流水)), 15000), 读文本(区.流水).slice(-400));
  await 睡(3500);                                                       // 再放三四轮，验不重复刷屏
  // 只数「心跳信源产出的事件行」——「通知已发」回执行也带规则名，不算重复上报
  const 数事件 = (关键) => 读文本(区.流水).split('\n').filter((l) => new RegExp(`\\[心跳\\] \\S+ ${关键} \\|`).test(l)).length;
  const 失联条数 = 数事件('监制台失联');
  ok('失联只报一次（后续轮次不刷屏）', 失联条数 === 1, `报了 ${失联条数} 次`);
  ok('失联进了未读账本且级别为急', W.读账本(区.账本).some((e) => /失联/.test(e.文本) && e.级别 === '急'));
  ok('失联弹了通知', /失联/.test(读文本(区.回落)));

  const 探2 = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"ok":true}'); });
  await new Promise((r) => 探2.listen(端口, '127.0.0.1', r));
  ok('恢复后报一次恢复', await 等到(() => /监制台恢复/.test(读文本(区.流水)), 15000), 读文本(区.流水).slice(-400));
  await 睡(3000);
  const 恢复条数 = 数事件('监制台恢复');
  ok('恢复只报一次', 恢复条数 === 1, `报了 ${恢复条数} 次`);
  await new Promise((r) => 探2.close(r));
  停守护(c);
  await 睡(800);
  return 区;
}

// ════════════════════════════ E3 时钟定点 ════════════════════════════
async function E3() {
  章(`E3 时钟：${快 ? '当前分钟即触发（--fast）' : '近分钟定点，真实等到点'}`);
  const 区 = 造假部署区('时钟');
  const 现 = new Date();
  const 目标 = 快 ? 现 : new Date(现.getTime() + 62000);
  const 定点 = `${pad(目标.getHours())}:${pad(目标.getMinutes())}`;
  fs.writeFileSync(区.规则, JSON.stringify(基础规则({
    时钟: [{ 名: '实测定点', 定点, 文本: 'E3 造的定点唤起', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] }],
  }), null, 2), 'utf8');
  const c = 起守护(区);
  ok('守护起来了', await 等到(() => /瞭望塔上岗/.test(读文本(区.流水)), 12000));
  process.stdout.write(`    （现在 ${pad(现.getHours())}:${pad(现.getMinutes())}:${pad(现.getSeconds())}，等 ${定点} 到点…）\n`);
  ok(`定点 ${定点} 到点自产时钟事件`, await 等到(() => /\[时钟\].*E3 造的定点唤起/.test(读文本(区.流水)), 快 ? 10000 : 100000), 读文本(区.流水).slice(-400));
  ok('时钟事件弹了通知', await 等到(() => /E3 造的定点唤起/.test(读文本(区.回落)), 6000), 读文本(区.回落));
  ok('时钟事件进未读账本', W.读账本(区.账本).some((e) => e.信源 === '时钟' && /E3 造的定点唤起/.test(e.文本)));
  await 睡(2500);
  const 次数 = (读文本(区.流水).match(/E3 造的定点唤起/g) || []).length;
  ok('同一天同一点只放一次', 次数 === 1, `放了 ${次数} 次`);
  停守护(c);
  await 睡(800);
  return 区;
}

// ════════════════════════════ E4 月切跟随 ════════════════════════════
async function E4() {
  章('E4 月切：时钟跨月后自动跟随到新月份日志，并从头读');
  const 区 = 造假部署区('月切');
  fs.writeFileSync(区.规则, JSON.stringify(基础规则(), null, 2), 'utf8');
  // WATCHTOWER_TIME_SHIFT_MS 把守护的钟平移到【月末前 5 秒】——钟照走，5 秒后真跨月，
  // 走的是守护自己的月切分支（旧档在尾、新档从头），不是伪造出来的路径。
  const 现 = new Date();
  const 月初 = new Date(现.getFullYear(), 现.getMonth() + 1, 1, 0, 0, 0);
  const 偏移 = 月初.getTime() - 8000 - 现.getTime();
  const 新月名 = W.当月日志名(月初);
  const 新月日 = 新月名.replace('.log', '') + '-01';
  const 新月路径 = path.join(区.根, 'journal', 新月名);
  fs.writeFileSync(新月路径, `[${新月日} 00:01] 新月份第一行，该被从头读到\n`, 'utf8');

  const c = 起守护(区, { WATCHTOWER_TIME_SHIFT_MS: String(偏移) });
  ok('守护起来了', await 等到(() => /瞭望塔上岗/.test(读文本(区.流水)), 12000));
  fs.appendFileSync(区.月日志, '[2026-08-31 23:59] 跨月前旧档增量行\n', 'utf8');
  ok('跨月前仍在读旧月份日志', await 等到(() => /跨月前旧档增量行/.test(读文本(区.流水)), 6000), 读文本(区.流水).slice(-500));
  ok('跨月后流水留下「月切」痕迹', await 等到(() => new RegExp(`月切 \\| 流水换档 → ${新月名.replace('.', '\\.')}`).test(读文本(区.流水)), 20000), 读文本(区.流水).slice(-500));
  ok(`跟随到新月份日志 ${新月名} 并从头读`, await 等到(() => /新月份第一行/.test(读文本(区.流水)), 12000), 读文本(区.流水).slice(-500));
  fs.appendFileSync(新月路径, `[${新月日} 00:02] 月切后的增量行\n`, 'utf8');
  ok('月切后增量继续跟读', await 等到(() => /月切后的增量行/.test(读文本(区.流水)), 10000));
  ok('旧月份日志不再产出事件', !/冷启前的历史行/.test(读文本(区.流水)));
  停守护(c);
  await 睡(800);
  return 区;
}

// ════════════════════════════ E5 远端信道（施工令-023）════════════════════════════
// 纪律：假 origin 一律是【本地 bare 仓】，跑在系统临时目录里；
//      真远端 github.com/suxing412/* 一次都不碰，更没有任何写操作（本信源只 fetch）。
function git(仓) {
  const 参数 = Array.prototype.slice.call(arguments, 1);
  const r = spawnSync('git', ['-C', 仓].concat(参数), {
    encoding: 'utf8', windowsHide: true,
    env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }),
  });
  if (r.status !== 0) throw new Error(`git ${参数.join(' ')} @ ${仓} 失败：${String(r.stderr || r.stdout || '').trim()}`);
  return String(r.stdout || '');
}
function 定身份(仓) {
  git(仓, 'config', 'user.email', 'watchtower-test@local');
  git(仓, 'config', 'user.name', '瞭望塔自测');
  git(仓, 'config', 'commit.gpgsign', 'false');
}
function 提交推送(仓, 相对路径, 内容, 讯息, 分支) {
  const p = path.join(仓, 相对路径);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 内容 + '\n', 'utf8');
  git(仓, 'add', '-A');
  git(仓, 'commit', '-m', 讯息);
  git(仓, 'push', '-u', 'origin', 分支);
}
function 造假远端() {
  const 巢 = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-git-'));
  const origin = path.join(巢, 'origin.git');          // 假 origin：本地 bare 仓
  const 工 = path.join(巢, '工作仓');                   // 往假 origin 推东西的那一侧
  const 侦 = path.join(巢, '侦察仓');                   // 瞭望塔盯的那一侧（只 fetch）
  const r0 = spawnSync('git', ['init', '--bare', '-b', 'main', origin], { encoding: 'utf8', windowsHide: true });
  if (r0.status !== 0) throw new Error('假 origin 建不出来：' + String(r0.stderr || r0.stdout));
  fs.mkdirSync(工, { recursive: true });
  const r1 = spawnSync('git', ['init', '-b', 'main', 工], { encoding: 'utf8', windowsHide: true });
  if (r1.status !== 0) throw new Error('工作仓建不出来：' + String(r1.stderr || r1.stdout));
  定身份(工);
  git(工, 'remote', 'add', 'origin', origin);
  提交推送(工, 'README.md', '# 假仓', 'chore: 初始提交', 'main');
  const r2 = spawnSync('git', ['clone', origin, 侦], { encoding: 'utf8', windowsHide: true });
  if (r2.status !== 0) throw new Error('侦察仓克隆不出来：' + String(r2.stderr || r2.stdout));
  定身份(侦);
  return { 巢, origin, 工, 侦 };
}
async function E5() {
  章('E5 远端：本地 bare 仓当假 origin —— 新提交 / 新分支 / 删分支 / 信道文书 / 断网容错 / 游标幂等');
  const 区 = 造假部署区('远端');
  let g = null;
  try { g = 造假远端(); }
  catch (e) { ok('假远端搭建（git 可用）', false, String(e && e.message)); return 区; }
  ok('假远端搭建（bare origin + 工作仓 + 侦察仓）', true);

  fs.writeFileSync(区.规则, JSON.stringify(基础规则({
    远端: { 启用: true, 间隔毫秒: 700, 超时毫秒: 25000, 仓清单: [g.侦] },
  }), null, 2), 'utf8');
  const c = 起守护(区);
  ok('守护起来了', await 等到(() => /瞭望塔上岗/.test(读文本(区.流水)), 12000));
  ok('上岗行播报远端在编', /远端 1 仓/.test(读文本(区.流水)), 读文本(区.流水).split('\n')[0]);

  const 计 = (re) => (读文本(区.流水).match(re) || []).length;
  const 远端行 = /\[远端\]/g;

  // —— 首轮只立基线：满仓分支不该被当成「新分支」报一遍 ——
  ok('首见该仓只立基线', await 等到(() => /远端建基线/.test(读文本(区.流水)), 20000), 读文本(区.流水).slice(-500));
  await 睡(1500);
  ok('立基线阶段零远端事件', 计(远端行) === 0, `已产 ${计(远端行)} 条`);
  ok('远端游标已落盘', fs.existsSync(区.远端游标));
  const 游 = JSON.parse(读文本(区.远端游标) || '{}');
  ok('游标按仓存 refs 快照', !!(游['仓'] && 游['仓'][path.resolve(g.侦)] && 游['仓'][path.resolve(g.侦)].refs['refs/remotes/origin/main']), 读文本(区.远端游标).slice(0, 300));
  ok('origin/HEAD 不进快照（符号引用不算分支）', !Object.keys(游['仓'][path.resolve(g.侦)].refs).some((k) => /\/HEAD$/.test(k)));

  // —— ① main 新提交（不带信道文书）——
  提交推送(g.工, 'apps/a.txt', '普通改动', 'chore: 普通提交', 'main');
  ok('main 新提交进流水', await 等到(() => /\[远端\] 常 远端新提交 \| 新提交 .*origin\/main/.test(读文本(区.流水)), 20000), 读文本(区.流水).slice(-500));
  ok('新提交进未读账本', W.读账本(区.账本).some((e) => e.信源 === '远端' && /新提交/.test(e.文本)));
  ok('新提交不弹通知', !/新提交/.test(读文本(区.回落)), 读文本(区.回落));

  // —— ② 新分支 ——
  git(g.工, 'checkout', '-b', 'feat/x');
  提交推送(g.工, 'apps/b.txt', '分支改动', 'chore: 分支提交', 'feat/x');
  ok('新分支进流水', await 等到(() => /\[远端\] 常 远端分支变动 \| 新分支 .*origin\/feat\/x/.test(读文本(区.流水)), 20000), 读文本(区.流水).slice(-500));
  ok('新分支进未读账本', W.读账本(区.账本).some((e) => e.信源 === '远端' && /新分支/.test(e.文本)));
  ok('新分支不弹通知', !/新分支/.test(读文本(区.回落)));

  // —— ③ 信道文书（docs/ 下的交接类 md）——
  git(g.工, 'checkout', 'main');
  提交推送(g.工, 'docs/交接-E5.md', '# 有信来了', 'docs: 交接文书一份', 'main');
  ok('信道文书事件进流水且级别为急', await 等到(() => /\[远端\] 急 远端信道文书 \| 信道文书 .*docs\/交接-E5\.md/.test(读文本(区.流水)), 20000), 读文本(区.流水).slice(-500));
  ok('信道文书弹了通知（这是「有信来了」）', await 等到(() => /信道文书/.test(读文本(区.回落)), 10000), 读文本(区.回落));
  ok('信道文书进未读账本且级别为急', W.读账本(区.账本).some((e) => e.信源 === '远端' && e.级别 === '急' && /信道文书/.test(e.文本)));
  ok('同一次推送不重复再发一条新提交', 计(/远端新提交 \| 新提交 .*origin\/main/g) === 1, `新提交行 ${计(/远端新提交 \| 新提交 .*origin\/main/g)} 条`);

  // —— ④ 删分支 ——
  git(g.工, 'push', 'origin', '--delete', 'feat/x');
  ok('删分支进流水', await 等到(() => /\[远端\] 常 远端分支变动 \| 删分支 .*origin\/feat\/x/.test(读文本(区.流水)), 20000), 读文本(区.流水).slice(-500));
  ok('删分支不弹通知', !/删分支/.test(读文本(区.回落)));

  // —— ⑤ 断网容错：把 origin 指到不存在的仓，等价于「拉不通」——
  const 断前事件 = 计(远端行);
  git(g.侦, 'remote', 'set-url', 'origin', path.join(g.巢, '并不存在.git'));
  ok('拉不通只留一行「远端暂歇」', await 等到(() => /远端暂歇/.test(读文本(区.流水)), 20000), 读文本(区.流水).slice(-500));
  await 睡(3000);
  ok('不通期间不刷屏（暂歇只报一次）', 计(/远端暂歇/g) === 1, `报了 ${计(/远端暂歇/g)} 次`);
  ok('不通期间零新增远端事件（不当错误报）', 计(远端行) === 断前事件, `断前 ${断前事件} → 现 ${计(远端行)}`);
  fs.appendFileSync(区.月日志, '[2026-08-08 02:00] 断网期间守护仍在读流水\n', 'utf8');
  ok('拉不通不拖垮守护，其余信源照跑', await 等到(() => /断网期间守护仍在读流水/.test(读文本(区.流水)), 8000));

  // —— ⑥ 恢复即续 ——
  git(g.侦, 'remote', 'set-url', 'origin', g.origin);
  提交推送(g.工, 'apps/c.txt', '恢复后', 'chore: 恢复后的提交', 'main');
  ok('恢复后留一行「远端复通」', await 等到(() => /远端复通/.test(读文本(区.流水)), 20000), 读文本(区.流水).slice(-500));
  ok('恢复后续报新提交（断网期间的改动不丢）', await 等到(() => 计(/远端新提交 \| 新提交 .*origin\/main/g) === 2, 20000), `新提交行 ${计(/远端新提交 \| 新提交 .*origin\/main/g)} 条`);

  // —— ⑦ 只侦察不合并 / 工作区零改动 ——
  const 本地main = git(g.侦, 'rev-parse', 'main').trim();
  const 远端main = git(g.侦, 'rev-parse', 'refs/remotes/origin/main').trim();
  ok('只 fetch 不 pull/merge：本地 main 仍停在旧点', 本地main !== 远端main, `本地 ${本地main.slice(0, 7)} / 远端 ${远端main.slice(0, 7)}`);
  ok('侦察仓工作区零改动（fetch 只动 refs）', git(g.侦, 'status', '--porcelain').trim() === '', git(g.侦, 'status', '--porcelain'));

  // —— ⑧ 游标幂等：重启不重报 ——
  停守护(c);
  await 睡(1200);
  const 重启前 = 计(远端行);
  const c2 = 起守护(区);
  ok('守护重启起来了', await 等到(() => 计(/瞭望塔上岗/g) === 2, 12000));
  await 睡(4000);
  ok('游标幂等：重启不回放旧的远端事件', 计(远端行) === 重启前, `重启前 ${重启前} → 现 ${计(远端行)}`);
  ok('重启后不再建基线（游标已在盘）', 计(/远端建基线/g) === 1, `建基线 ${计(/远端建基线/g)} 次`);
  提交推送(g.工, 'apps/d.txt', '重启后', 'chore: 重启后的提交', 'main');
  ok('重启后新事件照报（游标续得上）', await 等到(() => 计(/远端新提交 \| 新提交 .*origin\/main/g) === 3, 20000), `新提交行 ${计(/远端新提交 \| 新提交 .*origin\/main/g)} 条`);
  停守护(c2);
  await 睡(800);

  // —— ⑨ 关掉整路 ——
  const 区2 = 造假部署区('远端停用');
  fs.writeFileSync(区2.规则, JSON.stringify(基础规则(), null, 2), 'utf8');
  const c3 = 起守护(区2);
  ok('启用=false 时上岗行播报「远端 停用」', await 等到(() => /远端 停用/.test(读文本(区2.流水)), 12000), 读文本(区2.流水).split('\n')[0]);
  await 睡(1500);
  ok('停用时不起 git、零远端痕迹', !/\[远端\]|远端建基线|远端暂歇/.test(读文本(区2.流水)));
  ok('停用时不写远端游标', !fs.existsSync(区2.远端游标));
  停守护(c3);
  await 睡(600);

  try { fs.rmSync(g.巢, { recursive: true, force: true }); } catch { /* 临时目录留着无害 */ }
  try { fs.rmSync(区2.根, { recursive: true, force: true }); } catch { /* 同上 */ }
  return 区;
}

// ════════════════════════════ E6 心跳戳（施工令-024）════════════════════════════
// 实测用 --config 把间隔压到 500ms（生产默认 30s，验收另跑真间隔）；隔离假部署区，不碰现网。
async function E6() {
  章('E6 心跳戳：开机即戳 → 周期刷新 → --status 心跳段 → 下岗即断更');
  const 区 = 造假部署区('心跳戳');
  fs.writeFileSync(区.规则, JSON.stringify(基础规则(), null, 2), 'utf8');
  const 配置路径 = path.join(区.根, '瞭望塔.config.json');
  fs.writeFileSync(配置路径, JSON.stringify({ 心跳戳间隔毫秒: 500 }, null, 2), 'utf8');
  const c = 起守护(区, null, ['--config', 配置路径]);
  ok('守护起来了', await 等到(() => /瞭望塔上岗/.test(读文本(区.流水)), 12000));
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  ok('心跳文件出现', await 等到(() => fs.existsSync(区.心跳), 6000), 区.心跳);
  const 戳A = 读文本(区.心跳);
  ok('内容是一行 ISO 时刻（无换行）', ISO.test(戳A), JSON.stringify(戳A));
  ok('周期内刷新（覆盖写出新时刻）', await 等到(() => {
    const s = 读文本(区.心跳);
    return ISO.test(s) && s !== 戳A && s > 戳A;
  }, 8000), `A=${戳A} 现=${读文本(区.心跳)}`);
  const st2 = spawnSync(process.execPath, [守护, '--root', 区.根, '--rules', 区.规则, '--config', 配置路径, '--status'], { encoding: 'utf8', windowsHide: true });
  let sj2 = null; try { sj2 = JSON.parse(String(st2.stdout).trim().split('\n').pop()); } catch { /* 下面判空 */ }
  ok('--status 带心跳段', !!(sj2 && sj2.ok && sj2['心跳戳'] && sj2['心跳戳']['存在'] === true), String(st2.stdout).trim().slice(0, 300));
  ok('心跳段报秒龄且在跳', !!sj2 && Number.isFinite(sj2['心跳戳']['秒龄']) && sj2['心跳戳']['在跳'] === true, JSON.stringify(sj2 && sj2['心跳戳']));
  停守护(c);
  await 睡(1500);
  const 戳B = 读文本(区.心跳);
  await 睡(1500);
  ok('守护下岗后心跳断更（文件留最后一戳）', 读文本(区.心跳) === 戳B && ISO.test(戳B), `B=${戳B}`);
  return 区;
}

// ════════════════════════════ 跑 ════════════════════════════
(async () => {
  process.stdout.write('瞭望塔自测（假部署区，真部署区只读）\n');
  const 区们 = [];
  try {
    单元();
    区们.push(await E1());
    区们.push(await E2());
    区们.push(await E3());
    区们.push(await E4());
    区们.push(await E5());
    区们.push(await E6());
  } catch (e) {
    挂.push('测试自身炸了：' + (e && e.stack || e));
    process.stdout.write(`\n!! ${e && e.stack || e}\n`);
  }
  for (const z of 区们) { try { fs.rmSync(z.根, { recursive: true, force: true }); } catch { /* 临时目录留着无害 */ } }
  process.stdout.write(`\n════ 合计 ${过 + 挂.length} 例：过 ${过}，挂 ${挂.length} ════\n`);
  for (const m of 挂) process.stdout.write(`  ✗ ${m}\n`);
  process.exit(挂.length ? 1 : 0);
})();
