// 门禁 —— 本机接口的最小鉴权。
//
// 要挡的是什么（2026-08-10 实测过的真实缺口）：
//   server.js 绑 127.0.0.1，挡得住局域网里的别的机器，**挡不住你自己浏览器里的页面**——
//   浏览器就在 localhost 上。而 收体() 不看 Content-Type，拿到什么都直接 JSON.parse。
//   两件事凑一起：用 `Content-Type: text/plain` 发 JSON 属于跨域「简单请求」，不触发
//   CORS 预检，于是你随手打开的任何网页都能往 127.0.0.1:4370 发 POST 并被执行到底。
//   （浏览器只拦住它*读取*响应，请求本身照发不误——对会改状态的接口来说，伤害已经造成。）
//
// 三道闸，按从便宜到贵的顺序：
//   ① Origin 校验  浏览器发跨域请求必带 Origin，非本站来源直接 403。
//                  curl / 瞭望塔守护不带这个头，正常放行——它们本来也不是威胁模型里的角色。
//   ② Content-Type 卡死  POST 必须 application/json，「简单请求」那条路当场断掉。
//   ③ 令牌         Authorization: Bearer <令牌>。前两道针对浏览器，这道针对本机其它进程。
//
// /api/health 是**有意的例外**：瞭望塔守护按 config/瞭望塔.config.json 里的
// 心跳地址探它，而守护住在仓根 packages/（双签共建），我们没法单方面让它带令牌。
// 它只吐版本/端口/路径，且跨域读不到响应，例外成本可接受——但 Origin 与 Content-Type
// 两道闸对它照样生效。
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const 配置位置 = require('./配置位置.js');

// 令牌要写盘，故走可写目录：打包态在 asar 里写不进去（实测踩到）。
const 令牌文件 = (仓根) => path.join(配置位置.可写配置目录(仓根), '接口令牌.local.json');
// 明文副本，纯 ASCII 路径 + 纯 ASCII 内容（只有 64 位十六进制，无换行歧义）。
//
// 为什么非要多一个文件：Windows PowerShell 5.1 的 Get-Content 按系统 ANSI 码页读文件，
// 上面那份 JSON 里有中文键（_说明/令牌/生成于），GBK 解 UTF-8 直接把整个 JSON 读坏，
// ConvertFrom-Json 当场失败——**在 JSON 里加个 token 别名救不了，因为坏的是整份文件**。
// 实测两次才定位到这一点（2026-08-10）。明文文件让 PowerShell 一句话拿到令牌：
//   $T = Get-Content config\api-token.txt
const 明文令牌文件 = (仓根) => path.join(配置位置.可写配置目录(仓根), 'api-token.txt');
// 免令牌路径。加条目前先问一句：这条接口泄露什么、能改什么。
const 免令牌 = new Set(['/api/health']);

// 令牌落盘复用，不每次开机重生成——否则你存下来的 curl 别名每次重启都失效。
// 要轮换就删掉这个文件再起服务。文件名带 .local.json，被 .gitignore 的 *.local.json 挡住。
function 取令牌(仓根) {
  const 文件 = 令牌文件(仓根);
  try {
    const 旧 = JSON.parse(fs.readFileSync(文件, 'utf8'));
    // 两个键都认：老文件只有 令牌，新文件两者都有。读哪个都行，值相同。
    const 值 = 旧.令牌 || 旧.token;
    if (typeof 值 === 'string' && /^[0-9a-f]{64}$/.test(值)) {
      // 老装机没有明文副本，补写一次（不改令牌值，已存的 curl 别名仍有效）
      if (!fs.existsSync(明文令牌文件(仓根))) 写明文(仓根, 值);
      return { 令牌: 值, 文件, 新建: false };
    }
  } catch { /* 不存在或坏了，重新生成 */ }
  // ⚠ 首次安装是三个进程**同时**启动的（scripts/开机.js 一起拉起 server/工作区/执行器）。
  // 它们都发现文件不存在，于是各自生成一个令牌、各自写盘——最后落盘的那个覆盖前面的，
  // 而每个进程内存里还捧着自己那份。
  //
  // 实测（打包件首次安装，2026-08-13）：磁盘上的令牌对 4371、4372 有效，
  // **唯独对 4370 无效**。表现极坏——界面能打开（首页令牌是服务发页时注进去的），
  // 但任何命令行调用一律 401，而 config 里那份看上去完全正常。
  //
  // 用 'wx' 独占创建来定胜负：**谁先建成谁说了算**，抢输的那个回头去读赢家写的那份。
  // 这比加锁简单，而且是文件系统层面的原子性，跨进程有效。
  const 令牌 = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(文件), { recursive: true });
    fs.writeFileSync(文件, JSON.stringify({
      _说明: '本机接口令牌。删掉本文件并重启服务即可轮换。已被 .gitignore 挡住，不入库。',
      // token 是 令牌 的 ASCII 别名，两个字段值相同。
      // 为什么要这个别名：Windows PowerShell 5.1 的 Get-Content 按系统 ANSI 码页读文件，
      // 读 UTF-8 的中文键会乱码 → ConvertFrom-Json 直接失败。实测踩过（2026-08-10）。
      // 有了 token，PowerShell 至少能靠它取到值；中文键保留，不破坏既有读法。
      token: 令牌,
      令牌,
      生成于: new Date().toISOString(),
    }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });     // wx：已存在就抛，不覆盖
  } catch (e) {
    // EEXIST = 另一个进程抢先建好了。**用它的，不用自己的**——
    // 三个进程必须对同一个令牌达成一致，否则总有一个对不上。
    if (e && e.code === 'EEXIST') {
      try {
        const 赢 = JSON.parse(fs.readFileSync(文件, 'utf8'));
        const 值 = 赢.令牌 || 赢.token;
        if (typeof 值 === 'string' && /^[0-9a-f]{64}$/.test(值)) {
          写明文(仓根, 值);
          return { 令牌: 值, 文件, 新建: false, 让位: true };
        }
      } catch { /* 赢家写了一半？落到下面用自己的，至少本进程能工作 */ }
    }
    /* 其余写盘失败不致命：令牌仍在内存里，本次进程有效 */
  }
  写明文(仓根, 令牌);
  return { 令牌, 文件, 新建: true };
}

// 明文副本单独抽出来：新建与让位两条路都要写它，重复一遍迟早漏一处。
function 写明文(仓根, 值) {
  try { fs.writeFileSync(明文令牌文件(仓根), 值, 'utf8'); } catch { /* 非致命 */ }
}

// 定长比较，避免按字节提前返回泄露前缀。长度不等时拿自己比一次再返回 false，
// 让耗时与长度无关。
function 等值(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

function 本站来源(端口) {
  return new Set([`http://127.0.0.1:${端口}`, `http://localhost:${端口}`]);
}

// 返回 null 表示放行；否则返回 { 码, 错误 } 由调用方原样发出。
function 校验(req, { 令牌, 端口, 路径 }) {
  const 来源 = req.headers.origin;
  if (来源 && !本站来源(端口).has(来源)) {
    return { 码: 403, 错误: `跨站来源被拒：${来源}。本服务只接受同源页面的请求。` };
  }

  if (req.method === 'POST') {
    const 类型 = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (类型 !== 'application/json') {
      return {
        码: 415,
        错误: `POST 必须带 Content-Type: application/json（实得 ${类型 || '空'}）。`
          + '这道闸是故意的：text/plain 属于跨域简单请求，不触发 CORS 预检。',
      };
    }
  }

  if (免令牌.has(路径)) return null;

  const 头 = String(req.headers.authorization || '');
  const m = 头.match(/^Bearer\s+(\S+)$/i);
  if (!m || !等值(m[1], 令牌)) {
    return {
      码: 401,
      错误: '需要 Authorization: Bearer <令牌>。令牌见 config/接口令牌.local.json；'
        + '本机页面由服务自动注入，无需手工填。',
    };
  }
  return null;
}

// 注进 index.html 的 </head> 之前。给同源页面自动带上令牌与 JSON 头，
// 这样 UI 里已有的 fetch 调用一行都不用改。
function 注入脚本(令牌) {
  return `<script>(function(){
  var 令牌 = ${JSON.stringify(令牌)};
  var 原始 = window.fetch;
  window.fetch = function(入参, 选项){
    var 地址 = typeof 入参 === 'string' ? 入参 : (入参 && 入参.url) || '';
    if (地址.indexOf('/api/') === 0) {
      选项 = Object.assign({}, 选项);
      选项.headers = Object.assign({ 'Authorization': 'Bearer ' + 令牌 }, 选项.headers || {});
      if ((选项.method || 'GET').toUpperCase() === 'POST') 选项.headers['Content-Type'] = 'application/json';
    }
    return 原始(入参, 选项);
  };
})();</script>`;
}

module.exports = { 取令牌, 校验, 注入脚本, 令牌文件, 免令牌, 等值 };
