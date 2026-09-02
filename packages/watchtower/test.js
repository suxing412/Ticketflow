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

  章('U3b 引号内是别人的题目，不算本条事件的性质（2026-08-21 实测）');
  // 案源：待办「代裁策略：**上呈**项全为总监代跑…」——光是被重排一次，就因标题里有「上呈」
  // 二字被判成急件、弹通知、进未读账本。一条排期记账冒充成一次三振上呈。
  // 实测同族：三振上呈 2/14、告警 11/488 属此类。量不大（1300 条积压里 13 条），
  // 但它是**假急件**——比多几行噪声更坏，因为它教人不信急件。
  eq('标题里的「上呈」不算三振上呈',
    W.匹配规则(表, '流水', '待办重排 9107f「代裁策略：上呈项全为总监代跑/制作人联验时直判」：未排 → 2026-08-25（总监）').名, '兜底');
  eq('标题里的「熔断/急件」不算告警',
    W.匹配规则(表, '流水', '排程粒调整 68ad5「状态目录互斥哨兵：同单号双态即熔断派发+急件」：项目（总监）').名, '兜底');
  eq('真失败照旧命中（去题不许把真事件一起摘掉）',
    W.匹配规则(表, '流水', '执行失败 TK-181（在途→执行失败 · CLI 退出码 1）——待 Claude 分诊').名, '失败');
  eq('真三振照旧命中（关键词在题外）',
    W.匹配规则(表, '流水', 'TK-104 三振上呈，四件套待裁').名, '三振上呈');
  eq('整条就是一个标题时回落原文，不许因摘空而谁都不匹配',
    W.匹配规则(表, '流水', '「TK-104 三振上呈，四件套待裁」').名, '三振上呈');
  eq('去题只摘成对引号内 120 字以内的（太长多半是正文，摘了会伤真事件）',
    W.去题('前「' + 'x'.repeat(200) + '」后'), '前「' + 'x'.repeat(200) + '」后');
  eq('无引号原样返回', W.去题('执行失败 TK-181'), '执行失败 TK-181');
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
    // 类型 是 2026-08-29 为打断表加的：打断表按结构化字段查，不从 文本 里正则抠——
    // 抠会撞词（实测 22 条 OAuth 摘要正文里嵌了「判官席空烧三振」）。
    { 原时刻: '2026-08-07T02:23:29.309Z', 文本: '级别=急 类型=三振上呈 摘要=TK-104 QA 修不好 单号=TK-104', 级别: '急', 类型: '三振上呈' });
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

  章('U6b 守护判定（塔→终端 三条闸的判断部分，纯函数）');
  {
    // 退避表是 [0, 30 秒, 2 分钟]，端到端要验「连三次停手」得等 150 秒以上——
    // 所以判断抽成纯函数在这里测，端到端只验接线。
    const 表 = [0, 30000, 120000];
    const 新态 = () => ({ 连续失败: 0, 次数: 0, 上次: 0, 停手: false });
    const 通 = { 通: true };
    const 卡 = { 通: false, 没人听: false, 因: '超时' };      // 有人听但不应答
    const 死 = { 通: false, 没人听: true, 因: 'ECONNREFUSED' }; // 端口没人听

    let s = 新态();
    eq('闸一 · 卡住第 1 次不报', W.守护判定(s, 卡, 2, 表, 1000).动, '无');
    eq('闸一 · 卡住第 2 次报观望', W.守护判定(s, 卡, 2, 表, 1000).动, '观望');
    eq('闸一 · 卡住第 3 次不重复刷屏', W.守护判定(s, 卡, 2, 表, 1000).动, '无');
    eq('闸一 · 卡住**永远**不扶（起第二个会撞端口，两个都废）', W.守护判定(s, 卡, 2, 表, 9e9).动, '无');

    s = 新态();
    eq('没人听第 1 次不算死（可能它正在重启）', W.守护判定(s, 死, 2, 表, 1000).动, '无');
    eq('没人听第 2 次才判死并扶', W.守护判定(s, 死, 2, 表, 1000).动, '扶');

    s = 新态();
    eq('阈值 1：第一次就扶', W.守护判定(s, 死, 1, 表, 1000).动, '扶');
    eq('闸二 · 退避内不再扶（才过 5 秒）', W.守护判定(s, 死, 1, 表, 6000).动, '无');
    eq('闸二 · 退避到点再扶（过了 30 秒）', W.守护判定(s, 死, 1, 表, 32000).动, '扶');
    eq('闸二 · 第二档 2 分钟内不扶', W.守护判定(s, 死, 1, 表, 60000).动, '无');
    const 三 = W.守护判定(s, 死, 1, 表, 200000);
    eq('闸二 · 第三次扶且到顶', [三.动, 三.次数, 三.到顶], ['扶', 3, true]);
    eq('闸二 · 到顶后停手——起不来的东西不许被无限重启', W.守护判定(s, 死, 1, 表, 9e9).动, '无');

    eq('活过来报一次归位', W.守护判定(s, 通, 1, 表, 9e9).动, '归位');
    eq('归位后再通不重复报', W.守护判定(s, 通, 1, 表, 9e9).动, '无');
    eq('归位清了停手，下次死了重新从第一次算', W.守护判定(s, 死, 1, 表, 9e9).动, '扶');

    const s2 = 新态();
    eq('从没出过事就不报归位（不许每轮刷「它还活着」）', W.守护判定(s2, 通, 2, 表, 1000).动, '无');
  }

  章('U6d 打断表：拿真实信箱回放，降噪且不漏真事');
  {
    const 箱 = 'D:/GitHub/AI-GameStudio/监制台/呼叫/inbox.jsonl';
    let 行 = [];
    try { 行 = fs.readFileSync(箱, 'utf8').trim().split(/\r?\n/).filter(Boolean); } catch { /* 不在就跳过 */ }
    if (!行.length) {
      ok('真实信箱读得到（读不到则本组跳过，不算通过）', false, 箱);
    } else {
      const 不打断 = W.默认打断表.不打断;
      // 复刻 派发 的判定：规则命中且动作含弹通知 → 会弹；打断表命中 → 压制
      const 判 = (l) => {
        const e = W.规范信箱(l);
        if (!e) return null;
        const r = W.匹配规则(W.默认规则表.规则, '信箱', e.文本, []);
        const 会弹 = Array.isArray(r.动作) && r.动作.includes('弹通知');
        return { 类型: e.类型, 现状: 会弹, 新表: 会弹 && !不打断.includes(e.类型) };
      };
      const 果 = 行.map(判).filter(Boolean);
      const 现 = 果.filter((x) => x.现状).length;
      const 新 = 果.filter((x) => x.新表).length;

      ok(`打断量显著下降（现状 ${现} → 新表 ${新}）`, 新 <= 现 * 0.5, `${新}/${现}`);

      // **这条才是硬的**：光降数字不难，难在降完不漏。
      // 用比例而不是绝对数，因为 inbox.jsonl 是活文件，锁死绝对数会随增长漂移。
      const 保急 = ['执行失败', '代核不过', '三振上呈', '裁决上呈', '滞留告警',
        '值守塔阵亡', '到点无单', '零派发', '空转非排期', '依赖悬空', '仲裁上呈', '三轮裁决不过'];
      for (const t of 保急) {
        const a = 果.filter((x) => x.类型 === t && x.现状).length;
        const b = 果.filter((x) => x.类型 === t && x.新表).length;
        if (a === 0) continue;                     // 该类型这份数据里没有会弹的，跳过
        eq(`保急不漏 · ${t}（现状 ${a}）`, b, a);
      }

      // 失效方向朝响：表外类型一律照旧打断，不许被静默降级
      const 假 = JSON.stringify({ t: new Date().toISOString(), 级别: '急', 类型: '台账损毁', 摘要: '这个类型今天没在信箱出现过' });
      const 假判 = 判(假);
      ok('表外类型（台账损毁）仍然打断——失效方向必须朝响', 假判 && 假判.新表, JSON.stringify(假判));

      // 压制只压弹通知，不影响记流水/记未读
      const 待审样 = 行.find((l) => /"类型":"待审"/.test(l));
      if (待审样) {
        const r = W.匹配规则(W.默认规则表.规则, '信箱', W.规范信箱(待审样).文本, []);
        ok('被压制的类型仍然记流水与记未读（只是不打断，不是丢掉）',
          r.动作.includes('记流水') && r.动作.includes('记未读'), JSON.stringify(r.动作));
      }
    }
  }

  章('U6c 拆任务路径（自启悬空核验的取数部分）');
  {
    const 直 = W.拆任务路径('Folder: \\\nTaskName:  \\游戏开发者终端\nTask To Run:  D:\\GitHub\\AI-GameStudio\\终端\\游戏开发者终端 0.7.2.exe\nStart In:  D:\\x\n');
    eq('直接指 exe（路径含空格照样完整）', 直, { 在册: true, 路径: 'D:\\GitHub\\AI-GameStudio\\终端\\游戏开发者终端 0.7.2.exe' });

    const 壳 = W.拆任务路径('Task To Run:  C:\\WINDOWS\\System32\\wscript.exe "D:\\GitHub\\AI-GameStudio\\监制台\\启动监制台.vbs"\n');
    eq('经 wscript 的要取引号里那个（不是 wscript.exe 本身）', 壳.路径, 'D:\\GitHub\\AI-GameStudio\\监制台\\启动监制台.vbs');

    const 中 = W.拆任务路径('要运行的任务:  D:\\a\\b.exe\n');
    eq('中文表头也认（本机 schtasks 按代码页出中文表头）', 中.路径, 'D:\\a\\b.exe');

    eq('没有那一行 = 不在册', W.拆任务路径('ERROR: The system cannot find the file specified.'), { 在册: false, 路径: null });
    eq('N/A 算在册但读不出——**不许猜一个路径出来**', W.拆任务路径('Task To Run:  N/A\n'), { 在册: true, 路径: null });
    eq('空值同理不猜', W.拆任务路径('Task To Run:  \n'), { 在册: true, 路径: null });
  }

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
  // 守护同理默认关：内置默认目标指着真终端（127.0.0.1:4280）并会 schtasks /Run 真任务。
  // 不关的话每一条 e2e 都会去探真终端、甚至真把它拉起来——判据不许有这种外溢副作用。
  // 要测守护的用例自己开，并且只指向本例现搭的假端口与不存在的任务名。
  守护: { 启用: false, 间隔毫秒: 3600000, 目标: [] },
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
  // 用「巡检异常」而不是「编辑器占用」：后者在打断表的 不打断 里，会被压住弹通知——
  // 那是打断表的行为，不是热更的行为，混在一起测等于两个特性互相遮挡。
  // 打断表与规则表冲突时会怎样，由 E9 单独验。
  const 新表 = 基础规则();
  新表.规则 = [{ 名: '巡检异常升格', 信源: '信箱', 正则: '巡检异常', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] }].concat(W.默认规则表.规则);
  fs.writeFileSync(区.规则, JSON.stringify(新表, null, 2), 'utf8');
  ok('规则表热重载生效（流水见重载行）', await 等到(() => /规则表重载/.test(读文本(区.流水)), 8000));
  fs.appendFileSync(区.信箱, JSON.stringify({ t: new Date().toISOString(), 级别: '常', 类型: '巡检异常', 摘要: '改表后这条该弹' }) + '\n', 'utf8');
  ok('改表后同类事件按新规则弹通知', await 等到(() => /改表后这条该弹/.test(读文本(区.回落)), 8000), 读文本(区.回落));
  ok('改表后该事件级别升为 急', /\[信箱\] 急 巡检异常升格 \| .*改表后这条该弹/.test(读文本(区.流水)));

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

// ════════════════════════════ E7 下岗留痕 ════════════════════════════
// 案源（2026-08-22 体检 TF-V-12）：真部署区流水里 10 次「瞭望塔上岗」对 0 次下岗——
// 塔死了和塔活着在流水里长得一模一样。收摊() 只 报() 到 stderr，而 启动.vbs 隐藏窗口起，
// stderr 落黑洞。判据钉的是**流水里必须同时看见上岗与下岗两行**，且下岗行带 pid 与因。
// 口径注记：本例救不了 Windows 注销/taskkill /F 那类硬杀（'exit' 不开火）——
// 那一类只有心跳戳 + 消费方（GET /api/watchtower，见 需协调）探得到。两条不是并列，
// 心跳消费方是主干，只做本例不算收口。
async function E7() {
  章('E7 下岗留痕：--once 跑完一轮收摊 → 流水里上岗/下岗成对，下岗行带 pid 与因');
  const 区 = 造假部署区('下岗');
  fs.writeFileSync(区.规则, JSON.stringify(基础规则(), null, 2), 'utf8');
  const r = spawnSync(process.execPath, [守护, '--root', 区.根, '--rules', 区.规则, '--once'], {
    encoding: 'utf8', windowsHide: true, timeout: 40000,
    env: Object.assign({}, process.env, { WATCHTOWER_TOAST_FILE_ONLY: '1' }),
  });
  const 流 = 读文本(区.流水);
  ok('--once 正常退出', r.status === 0, `status=${r.status} stderr=${String(r.stderr || '').slice(-200)}`);
  const 上 = 流.split('\n').filter((l) => l.includes('瞭望塔上岗'));
  const 下 = 流.split('\n').filter((l) => l.includes('瞭望塔下岗'));
  ok('流水里有上岗行', 上.length === 1, `上岗 ${上.length} 行`);
  ok('流水里有下岗行（今天真部署区正缺这一行）', 下.length === 1, `下岗 ${下.length} 行 · 流水=${流.slice(-300)}`);
  ok('下岗行带 pid', 下.length === 1 && /pid \d+/.test(下[0]), 下[0] || '(无)');
  ok('下岗行带退出因（--once）', 下.length === 1 && /因 --once/.test(下[0]), 下[0] || '(无)');
  ok('下岗行是急级（塔死是急事，不许淹在常级里）', 下.length === 1 && /\] 急 瞭望塔下岗/.test(下[0]), 下[0] || '(无)');
  ok('上岗在前、下岗在后', 上.length === 1 && 下.length === 1 && 流.indexOf('瞭望塔上岗') < 流.indexOf('瞭望塔下岗'));
  ok('pid 文件已随下岗清掉（塔不在了不许留占位）', !fs.existsSync(区.pid), 区.pid);
  return 区;
}

// ════════════════════════════ E8 守护（塔 → 终端）════════════════════════════
//
// 三方互保的第三条边。这套东西装错了会自己把系统搞坏（无限重启、端口撞车），
// 所以三条闸每条都要有判据顶着。**全部指向本例现搭的假端口与不存在的任务名**，
// 一次都不许碰真终端（127.0.0.1:4280）与真任务「游戏开发者终端」。
async function E8() {
  章('E8 守护：端口没人听才扶；有人听不应答一律不动手；每次动手都留痕');
  const 区 = 造假部署区('守护');

  // 甲：一个只监听不回应的服务——连得上，但永远不给响应（模拟「卡住」）
  const 卡住 = http.createServer(() => { /* 故意不响应 */ });
  await new Promise((k) => 卡住.listen(0, '127.0.0.1', k));
  const 卡口 = 卡住.address().port;

  // 乙：一个正常回 200 的服务（模拟「在岗」）
  const 在岗 = http.createServer((q, s) => { s.writeHead(200); s.end('{}'); });
  await new Promise((k) => 在岗.listen(0, '127.0.0.1', k));
  const 好口 = 在岗.address().port;

  // 丙：一个**没人听**的端口——先占再放，拿到一个确定空着的号
  const 空 = http.createServer(() => {});
  await new Promise((k) => 空.listen(0, '127.0.0.1', k));
  const 空口 = 空.address().port;
  await new Promise((k) => 空.close(k));

  const 任务名 = '守护判据-绝不存在的任务-' + process.pid;
  fs.writeFileSync(区.规则, JSON.stringify(基础规则({
    守护: {
      启用: true, 间隔毫秒: 500,
      目标: [
        { 名: '卡住的', 任务名, 探址: `http://127.0.0.1:${卡口}/`, 超时毫秒: 600, 连续失败阈值: 1 },
        { 名: '在岗的', 任务名, 探址: `http://127.0.0.1:${好口}/`, 超时毫秒: 600, 连续失败阈值: 1 },
      ],
    },
  }), null, 2), 'utf8');

  let c = 起守护(区);
  ok('守护起来了', await 等到(() => /瞭望塔上岗/.test(读文本(区.流水)), 12000));
  await 等到(() => /守护观望/.test(读文本(区.流水)), 12000);
  停守护(c);
  let 文 = 读文本(区.流水);

  // 闸一：这是全套东西里最要紧的一条
  ok('闸一 · 端口有人听但不应答 → 记「观望」而不动手', /端口有人听但不应答/.test(文), 文.slice(-400));
  ok('闸一 · 卡住的目标绝不许触发自启', !/已触发自启/.test(文), 文.slice(-400));
  ok('在岗的目标一声不吭（没出过事就不该报归位）', !/在岗的归位/.test(文), 文.slice(-400));

  // 闸二/闸三：换成一个真没人听的端口 + 一个不存在的任务名。
  // 于是它会判死 → 动手 → schtasks 因任务不存在而失败 → 必须报「扶不动」。
  // **这一条同时验了三件事**：判死走通、真去拉了、拉失败不许静默。
  const 区2 = 造假部署区('守护2');
  fs.writeFileSync(区2.规则, JSON.stringify(基础规则({
    守护: {
      启用: true, 间隔毫秒: 500,
      目标: [{ 名: '死了的', 任务名, 探址: `http://127.0.0.1:${空口}/`, 超时毫秒: 600, 连续失败阈值: 1 }],
    },
  }), null, 2), 'utf8');
  c = 起守护(区2);
  ok('守护起来了（第二区）', await 等到(() => /瞭望塔上岗/.test(读文本(区2.流水)), 12000));
  const 出结论 = await 等到(() => /扶不动|已触发自启/.test(读文本(区2.流水)), 20000);
  停守护(c);
  const 文2 = 读文本(区2.流水);

  ok('闸三 · 端口没人听 → 判死并动手（留痕可见）', 出结论, 文2.slice(-500));
  ok('闸三 · 拉不起来必须明说「扶不动」，不许静默', /扶不动/.test(文2), 文2.slice(-500));
  ok('扶不动带得出 schtasks 的退出码', /退出码/.test(文2), 文2.slice(-500));
  ok('扶不动是急级（扶得起来只是掩盖，扶不动才要人看）',
    /急.*扶不动|扶不动.*急/.test(文2) || /\[急\]/.test(文2.split('\n').filter((l) => /扶不动/.test(l)).join('\n')),
    文2.split('\n').filter((l) => /扶不动/.test(l)).slice(0, 2).join(' | '));

  // 闸二（退避与上限）不在这里测：状态是进程内的，重启塔就清零；而退避表 [0, 30秒, 2分钟]
  // 要连到三次得等 150 秒以上。**首版就是这么写错的**——用「重启塔」来凑三次，
  // 结果每次都是新进程的第一次，判据永远绿，什么也没验到。改由 U6b 单测确定性地覆盖。

  // 配置校验：残缺目标必须被丢掉并留警告——否则「守护在跑」这句话成立而实际什么都没守
  const 区3 = 造假部署区('守护3');
  fs.writeFileSync(区3.规则, JSON.stringify(基础规则({
    守护: { 启用: true, 间隔毫秒: 500, 目标: [{ 名: '缺任务名的', 探址: 'http://127.0.0.1:1/' }] },
  }), null, 2), 'utf8');
  const c4 = 起守护(区3);
  const 有警 = await 等到(() => /守护目标缺/.test(读文本(区3.流水)), 12000);
  停守护(c4);
  ok('残缺目标被丢弃且留警告（不许静默当成守着了）', 有警, 读文本(区3.流水).slice(-400));

  // 自启核验的小结必须带**指向哪个文件**，不能只带好坏计数。
  // 2026-08-29 无人值守唤醒实测里被唤起的坐席点出：只带计数的话，
  // 「三个都存在」答得了，「存在的是不是该在的那个」答不了——换装指向旧版 exe 就查不出来。
  // 本例只查真实存在的「瞭望塔」任务，且 schtasks 只用 /Query（只读，无副作用）；
  // 守护目标留空，所以不会去探任何端口、更不会触发任何自启。
  const 区4 = 造假部署区('核验');
  fs.writeFileSync(区4.规则, JSON.stringify(基础规则({
    守护: {
      启用: true, 间隔毫秒: 3600000, 目标: [],
      自启核验: { 启用: true, 间隔毫秒: 3600000, 任务名: ['瞭望塔'] },
    },
  }), null, 2), 'utf8');
  const c5 = 起守护(区4);
  await 等到(() => /自启核验/.test(读文本(区4.流水)), 15000);
  停守护(c5);
  const 核 = 读文本(区4.流水).split('\n').filter((l) => /自启核验/.test(l)).pop() || '';
  ok('自启核验出了小结行', !!核, 读文本(区4.流水).slice(-300));
  ok('小结带「任务→文件名」，不只带计数（漏了就查不出指向旧版本）',
    /瞭望塔→\S+/.test(核), 核);
  ok('带的是文件名不是全路径（全路径会把流水行撑爆）', !/瞭望塔→[A-Za-z]:[\\/]/.test(核), 核);
  try { fs.rmSync(区4.根, { recursive: true, force: true }); } catch { /* 无害 */ }

  try { 卡住.close(); } catch { /* 已关 */ }
  try { 在岗.close(); } catch { /* 已关 */ }
  try { fs.rmSync(区2.根, { recursive: true, force: true }); } catch { /* 无害 */ }
  try { fs.rmSync(区3.根, { recursive: true, force: true }); } catch { /* 无害 */ }
  return 区;
}

// ════════════════════════════ E9 打断表接线 ════════════════════════════
//
// U6d 验的是判定逻辑，这一条验**接线**：派发层真的压住了弹通知，
// 而且压制不影响记流水与记未读。两条都要——只验逻辑等于没验接线，
// 而接线正是评审指出的空洞（载规则 白名单式 return 会把 打断表 整个丢掉，零条正面立案）。
async function E9() {
  章('E9 打断表：压弹通知不压账本；表外类型照旧打断；规则表能覆盖内置表');
  const 区 = 造假部署区('打断');
  fs.writeFileSync(区.规则, JSON.stringify(基础规则(), null, 2), 'utf8');
  const c = 起守护(区);
  ok('守护起来了', await 等到(() => /瞭望塔上岗/.test(读文本(区.流水)), 12000));

  const 投 = (o) => fs.appendFileSync(区.信箱, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n', 'utf8');
  投({ 级别: '急', 类型: '待审', 摘要: 'E9压制样本-待审', 单号: 'TK-901' });
  投({ 级别: '急', 类型: '执行失败', 摘要: 'E9保急样本-执行失败', 单号: 'TK-902' });
  投({ 级别: '急', 类型: '台账损毁', 摘要: 'E9表外样本-台账损毁' });

  await 等到(() => /E9保急样本/.test(读文本(区.回落)), 12000);
  await 睡(1200);                                   // 给压制样本一个「本来会弹」的窗口
  const 回 = 读文本(区.回落);
  const 账 = 读文本(区.账本);

  ok('保急类型正常弹通知', /E9保急样本/.test(回), 回.slice(-300));
  ok('被压制的类型**不弹**通知', !/E9压制样本/.test(回), 回.slice(-300));
  ok('表外类型（台账损毁）照旧弹——失效方向朝响', /E9表外样本/.test(回), 回.slice(-300));
  ok('压制的那条仍进未读账本（只是不打断，不是丢掉）', /E9压制样本/.test(账), 账.slice(-300));
  ok('压制的那条仍进流水', /E9压制样本/.test(读文本(区.流水)), 读文本(区.流水).slice(-300));

  // 冲突留痕：有人在规则表里显式让某类型弹，而打断表把它压住了——**不许静默否决**。
  // 不留痕的话，那个人会以为自己规则写错了，去改一个没坏的东西。
  const 冲表 = 基础规则();
  冲表.规则 = [{ 名: '待审升格', 信源: '信箱', 正则: '待审', 级别: '急', 动作: ['记流水', '记未读', '弹通知'] }].concat(W.默认规则表.规则);
  fs.writeFileSync(区.规则, JSON.stringify(冲表, null, 2), 'utf8');
  await 等到(() => /规则表重载/.test(读文本(区.流水)), 8000);
  投({ 级别: '急', 类型: '待审', 摘要: 'E9冲突样本-规则要弹但打断表压着', 单号: 'TK-905' });
  const 有痕 = await 等到(() => /打断表压制/.test(读文本(区.流水)), 12000);
  ok('规则表与打断表冲突时留痕，不静默否决', 有痕, 读文本(区.流水).slice(-400));
  ok('留痕说得出怎么改（点名类型与该动哪张表）',
    /不打断.*待审|待审.*不打断/.test(读文本(区.流水)), 读文本(区.流水).slice(-400));
  ok('冲突仍然不弹（打断表赢，但赢得看得见）', !/E9冲突样本/.test(读文本(区.回落)), 读文本(区.回落).slice(-300));

  // 规则表里的 打断表 必须能覆盖内置表——这一条直接验 载规则 有没有把它丢掉
  fs.writeFileSync(区.规则, JSON.stringify(基础规则({
    打断表: { 不打断: ['执行失败'] },              // 反过来：压执行失败，放行待审
  }), null, 2), 'utf8');
  await 等到(() => /规则表重载/.test(读文本(区.流水)), 8000);
  投({ 级别: '急', 类型: '待审', 摘要: 'E9换表后-待审该弹了', 单号: 'TK-903' });
  投({ 级别: '急', 类型: '执行失败', 摘要: 'E9换表后-执行失败该被压', 单号: 'TK-904' });
  await 等到(() => /E9换表后-待审该弹了/.test(读文本(区.回落)), 12000);
  await 睡(1200);
  const 回2 = 读文本(区.回落);
  停守护(c);

  ok('规则表的打断表覆盖内置表：待审改为会弹', /E9换表后-待审该弹了/.test(回2), 回2.slice(-300));
  ok('规则表的打断表覆盖内置表：执行失败改为被压', !/E9换表后-执行失败该被压/.test(回2), 回2.slice(-300));
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
    区们.push(await E7());
    区们.push(await E8());
    区们.push(await E9());
  } catch (e) {
    挂.push('测试自身炸了：' + (e && e.stack || e));
    process.stdout.write(`\n!! ${e && e.stack || e}\n`);
  }
  for (const z of 区们) { try { fs.rmSync(z.根, { recursive: true, force: true }); } catch { /* 临时目录留着无害 */ } }
  process.stdout.write(`\n════ 合计 ${过 + 挂.length} 例：过 ${过}，挂 ${挂.length} ════\n`);
  for (const m of 挂) process.stdout.write(`  ✗ ${m}\n`);
  process.exit(挂.length ? 1 : 0);
})();
