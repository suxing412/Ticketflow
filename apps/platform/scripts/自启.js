// 自启 —— 登录即起整台平台（协-019）。
//
//   node scripts/自启.js --install     注册登录自启计划任务
//   node scripts/自启.js --status      看它装没装、上次跑得怎么样
//   node scripts/自启.js --uninstall   卸掉
//
// 无人值守的最后一环：机器重启之后**没有人会去敲 npm start**。
// 装完之后这台平台的生命周期就跟登录态绑在一起，不再依赖那个开着的终端窗口。
//
// 为什么不直接用 packages/watchtower 的 --install：那套 XML 的 <Description> 写死是
// 「瞭望塔 · 统一监视守护」，拿来注册平台的任务会在任务计划里挂一个说自己是瞭望塔的条目——
// 排障时看见它只会更糊涂。XML 骨架照抄它（那是踩出来的知识，正本在它那儿），
// 只换描述、命令与工作目录，不去改双签共建的包。
//
// 三条 Windows 上踩出来的（都在瞭望塔那份文件里有原始记录）：
//   · `schtasks /Create /XML` 要求文件是 **UTF-16 带 BOM**；写 UTF-8 会直接报格式错；
//   · `WorkingDirectory` 只有走 XML 才设得了，命令行 /TR 那条路设不了；
//   · schtasks 的输出走控制台 OEM 代码页（本机 936），按 utf8 收会得到乱码——
//     出错时等于没有错误信息，故一律套 `chcp 65001` 再跑。
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const 平台根 = path.resolve(__dirname, '..');
const 参数 = process.argv.slice(2);
const 有 = (名) => 参数.includes(名);
const 取 = (名, 缺省) => { const i = 参数.indexOf(名); return i >= 0 && 参数[i + 1] ? 参数[i + 1] : 缺省; };
const 任务名 = 取('--task-name', 'AI-DevPlatform');
const 无窗 = !有('--no-vbs');

const xml转义 = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const 当前用户 = () => `${process.env.USERDOMAIN || process.env.COMPUTERNAME || '.'}\\${process.env.USERNAME || ''}`;
const win = (p) => String(p).replace(/\//g, '\\');

function 跑(命令行) {
  const r = spawnSync(`chcp 65001 >nul & ${命令行}`, { shell: true, encoding: 'utf8', windowsHide: true });
  return { 码: r.status, 出: String((r.stdout || '') + (r.stderr || '')).replace(/\r/g, '').trim() };
}

function 任务XML(命令, 参数串, 工作目录) {
  const u = 当前用户();
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo><Description>AI-DevPlatform · 平台三进程（协-019 无人值守）</Description></RegistrationInfo>',
    `  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml转义(u)}</UserId></LogonTrigger></Triggers>`,
    `  <Principals><Principal id="Author"><UserId>${xml转义(u)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>',
    '    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    '    <Hidden>false</Hidden>',
    // 不设执行时限：这是个常驻服务，不是一次性任务。默认 72 小时会把它掐掉，
    // 而掐掉的表现是「用着用着就没了」，最难查的那一类。
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <Priority>7</Priority>',
    '  </Settings>',
    '  <Actions Context="Author">',
    `    <Exec><Command>${xml转义(命令)}</Command><Arguments>${xml转义(参数串)}</Arguments>`
    + `<WorkingDirectory>${xml转义(工作目录)}</WorkingDirectory></Exec>`,
    '  </Actions>',
    '</Task>',
  ].join('\r\n');
}

function 写UTF16(p, 文本) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.from('﻿' + 文本, 'utf16le'));
}

// 无窗启动器：直挂 node.exe 的话每次登录都会弹一个黑框，而且那个框一关服务就没了。
// vbs 起一层 WScript.Shell.Run(..., 0, false)，进程照跑、窗口不出现。
function 写VBS(p) {
  const 行 = [
    "' AI-DevPlatform 无窗启动器（--install 自动生成，--uninstall 自动清除）",
    'Set s = CreateObject("WScript.Shell")',
    `s.CurrentDirectory = "${win(平台根)}"`,
    `s.Run """${win(process.execPath)}"" ""${win(path.join(平台根, 'scripts', '开机.js'))}""", 0, False`,
  ].join('\r\n');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 行, 'utf8');
}

function 装() {
  if (process.platform !== 'win32') {
    console.error('本脚本只处理 Windows 计划任务。别的平台请用 systemd --user / launchd，'
      + '命令是：node ' + path.join(平台根, 'scripts', '开机.js'));
    process.exit(2);
  }
  const 出区 = path.join(平台根, 'watchtower-out');       // 已 gitignore 的唯一写区，借它放启动件
  const vbs = path.join(出区, '平台自启.vbs');
  const xml = path.join(出区, '平台自启.xml');
  let 命令; let 参数串;
  if (无窗) { 写VBS(vbs); 命令 = 'wscript.exe'; 参数串 = `"${win(vbs)}"`; }
  else { 命令 = win(process.execPath); 参数串 = `"${win(path.join(平台根, 'scripts', '开机.js'))}"`; }
  写UTF16(xml, 任务XML(命令, 参数串, win(平台根)));

  const r = 跑(`schtasks /Create /TN "${任务名}" /XML "${win(xml)}" /F`);
  if (r.码 !== 0) {
    if (/Access is denied|拒绝访问/i.test(r.出)) {
      console.error('注册被拒：任务计划根目录不允许普通完整性进程建任务。\n'
        + '请在【以管理员身份运行】的 PowerShell 里重跑这条（本进程无法自提权）：\n'
        + `  node "${win(path.join(平台根, 'scripts', '自启.js'))}" --install`);
    } else console.error('注册失败：\n' + r.出);
    process.exit(1);
  }
  console.log(`已注册计划任务「${任务名}」：登录即起 scripts/开机.js（三进程）${无窗 ? '，无窗' : ''}`);
  console.log(`当场拉起：schtasks /Run /TN "${任务名}"`);
  console.log(`看状态：  node scripts/自启.js --status`);
  console.log('注意：任务跟**登录态**绑定，不是系统服务——注销之后它不再跑。'
    + '要脱离登录态得改成服务账户运行，那需要把令牌与凭据的归属一并想清楚，不在本单范围。');
}

function 态() {
  const r = 跑(`schtasks /Query /TN "${任务名}" /V /FO LIST`);
  if (r.码 !== 0) { console.log(`没装（或查不到）：${任务名}\n装：node scripts/自启.js --install`); process.exit(1); }
  const 取行 = (键) => (r.出.split('\n').find((l) => l.trim().startsWith(键)) || '').split(':').slice(1).join(':').trim();
  console.log(`任务：${任务名}`);
  for (const k of ['Status', 'Last Run Time', 'Last Result', 'Next Run Time', '状态', '上次运行时间', '上次结果', '下次运行时间']) {
    const v = 取行(k); if (v) console.log(`  ${k}：${v}`);
  }
}

function 卸() {
  const r = 跑(`schtasks /Delete /TN "${任务名}" /F`);
  console.log(r.码 === 0 ? `已卸载：${任务名}` : `卸载失败：\n${r.出}`);
  for (const f of ['平台自启.vbs', '平台自启.xml']) {
    try { fs.unlinkSync(path.join(平台根, 'watchtower-out', f)); } catch { /* 本来就没有 */ }
  }
  process.exit(r.码 === 0 ? 0 : 1);
}

if (有('--install')) 装();
else if (有('--status')) 态();
else if (有('--uninstall')) 卸();
else {
  console.log(`用法：
  node scripts/自启.js --install [--task-name 名] [--no-vbs]   注册登录自启
  node scripts/自启.js --status                                 看装没装、上次跑得如何
  node scripts/自启.js --uninstall                              卸掉

装完之后平台跟登录态绑在一起，不再依赖那个开着的终端窗口。
它起的是 scripts/开机.js（三进程 + 守护自恢复），不是单个 server。
主目录：${平台根}
用户：${当前用户()}${os.type() === 'Windows_NT' ? '' : '（非 Windows，本脚本不适用）'}`);
}
