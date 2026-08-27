// 首装 —— 把一份裸 clone 带到「全链路就绪」（协-036）。
//
// 为什么需要它：`git archive HEAD` 解出来的那份（＝别人 clone 到的样子）自检报**未就绪**，
// 一句话是「连工单都没地方放」。要走到就绪得手写四个 .local.json——而其中
// `workspace.local.json` 连 `.示例` 都没有。2026-08-27 实测：照 README 那张表办，
// 我自己就把它的形状写错了（写成 { "workspace": {...} }，实际文件名即段名、内容就是段体）。
// 「装好之后照着表手写四个 JSON 才能用」不叫交钥匙。
//
// **本脚本不自己拼 JSON**，一律走产品自己的 落位 函数（工单库.落位 / 项目.落位）。
// studio 那份 部署.bat 是用 PowerShell 现改 JSON 的——那等于把「配置长什么样」
// 这件事在批处理里又写了一遍，主配置一演进它就悄悄过期。同一个约定写两遍就会漏改一遍。
//
// 三条纪律：
//   ① **不覆盖已有配置**（升级模式）。重跑一遍是安全的，已配好的原样留着并说出来；
//   ② **每一步都可跳过**。只想配工单库、暂时不注册项目，是正常用法；
//   ③ **结尾必须打自检**。装完了不等于能用——就绪与否由产品自己说，不由安装脚本说。
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const 平台根 = path.resolve(__dirname, '..');
const 工单库 = require(path.join(平台根, 'lib', '工单库.js'));
const 项目 = require(path.join(平台根, 'lib', '项目.js'));
const 自检 = require(path.join(平台根, 'lib', '自检.js'));
const 本地覆盖 = require(path.join(平台根, 'lib', '本地覆盖.js'));

const 配置目录 = path.join(平台根, 'config');
const 配 = (名) => path.join(配置目录, 名);
const 有 = (名) => fs.existsSync(配(名));
const 读JSON = (p, 缺省) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 缺省; } };

// 参数：非交互装机用（CI、批量铺机器）。一个都不给就走问答。
const argv = process.argv.slice(2);
const 取参 = (名) => {
  const i = argv.indexOf(名);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};
const 有旗 = (名) => argv.includes(名);
const 非交互 = 有旗('--yes') || 有旗('-y');

const 说 = (s) => process.stdout.write(s + '\n');
const 步 = [];
const 记 = (t, 文) => { 步.push(`${t} ${文}`); 说(`    ${t} ${文}`); };

let rl = null;
const 问 = async (提示, 缺省 = '') => {
  if (非交互) return 缺省;
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const 答 = await new Promise((r) => rl.question(提示, r));
  return String(答 || '').trim() || 缺省;
};

(async () => {
  说('');
  说('============================================');
  说('  AI-DevPlatform 首装');
  说('  建单 → 派活 → 真跑 → 质检 → 提交');
  说('============================================');
  说('');
  说(`安装位置：${平台根}`);
  说('本脚本只写 config/*.local.json（不入库），不动任何代码。已配好的一律保留。');
  说('');

  // ——— 1/5 工单库：没有它其余都谈不上 ———
  说('[1/5] 工单库根目录（工单落哪）');
  if (有('工单库.local.json')) {
    记('·', `已配置，跳过 → ${(读JSON(配('工单库.local.json'), {}).根目录) || '(读不出)'}`);
  } else {
    说('    工单是**业务数据**，该落你的业务私仓，本产品不替你选位置。');
    const 值 = 取参('--工单库') || await 问('    绝对路径（回车跳过）：');
    if (!值) 记('⚠', '跳过——没有它自检必报「未就绪」，稍后可在界面上补');
    else {
      const r = 工单库.落位(平台根, 值);
      if (r.ok) 记('✅', `已写 ${path.basename(r.文件)} → ${r.根}`);
      else 记('❌', r.错误);
    }
  }
  说('');

  // ——— 2/5 项目注册：同时是写操作白名单 ———
  说('[2/5] 注册项目（agent 要改的那个仓）');
  if (有('项目.local.json')) {
    const 表 = (读JSON(配('项目.local.json'), {}).注册) || {};
    记('·', `已配置，跳过 → 已登记：${Object.keys(表).join('、') || '(空)'}`);
  } else {
    说('    ⚠ 注册表同时是**写操作白名单**：登记一个仓 = 允许 AI 往里提交。');
    const 名 = 取参('--项目名') || await 问('    项目名（回车跳过）：');
    if (!名) 记('·', '跳过——稍后在设置页「项目注册」里加，或重跑本脚本');
    else {
      const 路 = 取参('--项目路径') || await 问('    仓库绝对路径：');
      const r = 项目.落位(平台根, 名, 路, true);
      if (r.ok) 记('✅', `已注册 ${r.名} → ${r.路径}（设为默认）`);
      else 记('❌', r.错误);
    }
  }
  说('');

  // ——— 3/5 真跑：这一步开始要花钱 ———
  说('[3/5] 真跑（让它真的调 AI CLI —— **会花钱**）');
  if (有('执行.local.json') || 有('预算.local.json')) {
    记('·', `已配置，跳过 → ${['执行', '预算'].filter((n) => 有(`${n}.local.json`)).join('、')}.local.json`);
  } else {
    说('    不开也能用：全链路走得通，只是每次都是干跑（零计费）。');
    const 要 = 有旗('--真跑') || /^y/i.test(await 问('    现在就开真跑？[y/N]：', 'n'));
    if (!要) 记('·', '跳过——保持干跑。要开时把两个 .示例 改名并按里面说明填');
    else {
      for (const 名 of ['执行', '预算']) {
        if (有(`${名}.local.json`)) { 记('·', `${名}.local.json 已存在，不覆盖`); continue; }
        fs.copyFileSync(配(`${名}.local.json.示例`), 配(`${名}.local.json`));
        记('✅', `已由 .示例 生成 ${名}.local.json`);
      }
      记('⚠', '预算.local.json 里的池上限是**示例值**，按你的钱包改——没配上限的池一律不许真跑');
    }
  }
  说('');

  // ——— 4/5 写权：agent 的成果能不能回到你的仓 ———
  说('[4/5] 提交链（agent 改完的代码能不能合回目标仓）');
  if (有('workspace.local.json')) {
    记('·', `已配置，跳过 → 允许写 = ${读JSON(配('workspace.local.json'), {}).允许写}`);
  } else {
    说('    不开的话提交链一律 403：agent 能干活，但成果回不到你的仓里。');
    说('    开了意味着带令牌的调用方可以在**已注册的项目仓**里建分支、提交、合并。');
    const 要 = 有旗('--允许写') || /^y/i.test(await 问('    打开写权？[y/N]：', 'n'));
    if (!要) 记('·', '跳过——稍后把 workspace.local.json.示例 改名即可');
    else {
      fs.copyFileSync(配('workspace.local.json.示例'), 配('workspace.local.json'));
      记('✅', '已由 .示例 生成 workspace.local.json（允许写 = true）');
    }
  }
  说('');

  // ——— 5/5 自检：装完了不等于能用，由产品自己说 ———
  说('[5/5] 自检');
  if (rl) { rl.close(); rl = null; }
  const { 配置 } = 本地覆盖.应用(平台根, 读JSON(配('platform.config.json'), {}));
  const 工单根 = 工单库.解析根目录(平台根);
  const 条 = 自检.查(平台根, 配置, 工单根);
  const 结 = 自检.结论(条);
  说('');
  for (const c of 条) {
    说(`    ${c.就绪 ? '✅' : '❌'} ${c.能力}`);
    if (!c.就绪 && c.缺) 说(`         缺：${String(c.缺).split('\n')[0]}`);
  }
  说('');
  说('============================================');
  说(`  ${结.级别}：${结.一句话}`);
  说('============================================');
  // 令牌与 api-token.txt 是**开机时自动生成**的，不用配也不该配。
  // 这里说一句，是因为自检在没开过机的机器上会把「命令行调接口」标红，
  // 那一格会自己变绿，不该让人跑去手写一个令牌。
  if (!有('接口令牌.local.json')) {
    说('  （「命令行调接口」现在标红是正常的：令牌与 api-token.txt 由第一次开机自动生成。）');
  }
  说('');
  说(`  起服务：npm start   →  http://127.0.0.1:${(配置.server && 配置.server.port) || 4370}`);
  说('  没配全也能起——界面上能补工单库根目录与项目注册。');
  说('');
  process.exit(结.级别 === '未就绪' ? 1 : 0);
})().catch((e) => {
  if (rl) try { rl.close(); } catch { /* 无所谓 */ }
  说(`首装出错：${e && e.message}`);
  process.exit(1);
});
