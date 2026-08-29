// server.js — AI-DevPlatform 交钥匙壳 · 最小 HTTP 服务（施工令-025 出厂）
//
// 端口 4370（避开监制台 4270 与其心跳探测）。零第三方依赖，node 内置模块 only。
//
// 边界（出厂即锁定的形状，往后怎么长由本仓主人定）：
//   - 不含任何工单/职能/派发语义；
//   - 执行器接线只到「providers 注册表可枚举 + echo 级测试调用（桩模式）」为止；
//   - 桩模式是物理性的：本文件不引入 child_process，任何路径都发不起真实 CLI 进程，零计费。
//
// 2026-08-10 接线：lib/ 下六个模块此前一个都没接到接口上（写好了、测过了，但没有任何
// 代码路径走得到）。本轮接了其中四个——判据是**不破坏上面那条物理保证**：
//   routing/router + routing/history + toolchain + review-opinion   零 child_process，已接
//   orchestration/plan                                              纯计算那半已接（store 改注入）
//   workspace/worktree   引 child_process，**不进本文件的依赖闭包**——它住独立进程
//                        scripts/工作区服务.js，本文件只用 http 转发过去。
//   执行加固/派单/调度/巡检/质检/输出提取/编排提示/提示装配   同理**隔离**进 scripts/执行器.js。它们自身是纯计算，
//                        但只服务于「拉起 AI CLI」那条链，跟着能力走比跟着纯度走更清楚：
//                        谁要用它们，谁就得先有那个能力面。本文件只转发 /api/exec/*。
// 全部台账见 docs/接线说明.md 第四、六、八节。
//
// providers 消费走仓根 packages/providers（@papercrew/providers），
// 换布局时用环境变量 TICKETFLOW_PACKAGES 指向 packages/。
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const 仓根 = __dirname;
// 公用件解析统一走 lib/公用件（一仓拓扑）。此处曾自抄一份「往上找兄弟仓 Ticketflow」的
// 算法，一仓合并后解析成 <仓根>/apps/Ticketflow 而失效——同一个约定不留第二份。
const 公用件 = require('./lib/公用件');

// 本仓自有模块。四个都是纯计算或只读文件，不起进程——桩模式的物理保证不受影响，
// 契约测试里有一条断言盯着这件事（见 test/接线契约.test.js）。
const 路由器 = require('./lib/routing/router');
const 路由历史 = require('./lib/routing/history');
const 工具链 = require('./lib/toolchain');
const 评审意见 = require('./lib/review-opinion');
// plan 只用它纯计算的那半（解析 + 校验）。落盘的 materialize/consume 需要注入工单库，
// platform 目前没有自己的工单库，故不接——不是忘了，见 docs/接线说明.md 第四节。
const 计划 = require('./lib/orchestration/plan');
const 门禁 = require('./lib/门禁');
// 工单库（协-001）：纯 fs+path，落盘是文件操作不需要 git，故住本进程即可。
// 但它让本进程有了往仓外写文件的能力，三条约束见 lib/工单库.js 头部。
const 工单库 = require('./lib/工单库');
const 自检 = require('./lib/自检');
const 设置落盘 = require('./lib/设置落盘');
const 工单模板 = require('./lib/工单模板');
const 流程视图 = require('./lib/流程视图');
const 知识库 = require('./lib/知识库');
const 编制 = require('./lib/编制');
const 派单 = require('./lib/派单');
const 项目 = require('./lib/项目');
// let 不是 const：界面上配好工单库之后要能当场生效。
// 让人「配完请重启」是 studio 级产品不该有的台阶——尤其这还是第一次打开就撞上的那一步。
let 工单根 = 工单库.解析根目录(仓根);

// ——————————————————————————————————————————————————————————
// 配置
// ——————————————————————————————————————————————————————————
function 读JSON(p, 缺省) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 缺省; }
}
// 编制落盘（协-015）：写 config/routing.local.json。
// 走本地覆盖那套白名单，与其他可改配置同一个机制——不为一个新功能另开一条写盘路径。
// 协-037 起改走 lib/设置落盘：本地覆盖的写入口收敛成一个，白名单也只剩一张
// （本地覆盖.覆盖表）。此前这里自己拼路径写盘，而设置页要写另外四个文件——
// 两处各写一遍，迟早对不上。
function 编制落盘(routing) {
  const r = 设置落盘.落(仓根, 'routing.local.json', routing);
  return r.ok ? { ok: true, 文件: r.文件 } : { ok: false, 错误: `编制写不进去：${r.错误}` };
}

// 打包态第一次开机，把 .示例 播到 exe 同级的 config/（协-036）。
//
// 不播的话，拿到 exe 的人只能配「工单库」那一个（界面上有输入框），
// 真跑 / 预算 / 写权 / 项目注册**无路可走**——模板全锁在只读的 app.asar 里，
// 文件管理器打不开，也没地方放改好的文件。翻 2026-08-16 那次真打包留下的
// dist/config/ 就是这样：只有自动生成的令牌两件 + 界面配的工单库。
//
// 播在读配置**之前**：让「模板在那儿」这件事先于任何一次配置解析成立，
// 免得以后有人把播种挪到某个懒加载分支里、结果第一次开机反而没播。
const 播种结果 = require('./lib/配置位置').播种示例(仓根);

// 危险开关只能从 config/*.local.json 打开——那些文件被 .gitignore 结构性挡住。
// server 侧也要走同一套合并，否则它看到的配置与执行器不一致（比如工作区写开关），
// 两个进程对同一份事实各执一词，是最难查的那类 bug。
const 本地覆盖 = require('./lib/本地覆盖');
const { 配置, 生效的覆盖 } = 本地覆盖.应用(仓根, 读JSON(path.join(仓根, 'config', 'platform.config.json'), {}));
const 包 = 读JSON(path.join(仓根, 'package.json'), {});
const 端口 = Number(process.env.PORT || (配置.server && 配置.server.port) || 4370);
const { 令牌, 文件: 令牌路径, 新建: 令牌新建 } = 门禁.取令牌(仓根);
const 工作区端口 = Number(process.env.WORKSPACE_PORT || (配置.workspace && 配置.workspace.port) || 4371);
const 执行器端口 = Number(process.env.EXECUTOR_PORT || (配置.执行 && 配置.执行.port) || 4372);
// 战绩账本根：必须与执行器写入的那个根一致，否则 rank 读不到执行器写的战绩，闭环断掉。
// 环境变量只为测试隔离——改它必须两边同时改。
const 账本根 = process.env.PLATFORM_JOURNAL || 仓根;
const 平台名 = 配置.名称 || 包.name || 'AI-DevPlatform';
const 版本 = 配置.版本 || 包.version || '0.0.0';

// ——————————————————————————————————————————————————————————
// providers 注册表（一仓：仓根 packages/；TICKETFLOW_PACKAGES 可覆盖）
// ——————————————————————————————————————————————————————————
let registry = null;
let registry错误 = null;
try {
  registry = 公用件.载入('providers', 'registry.js');
} catch (e) {
  registry错误 = String(e.message); // lib/公用件 已给出人话修法与实际解析路径

}

// ——————————————————————————————————————————————————————————
// 瞭望塔读数（只读 watchtower-out/，绝不写）
// ——————————————————————————————————————————————————————————
const 瞭望塔出口 = path.resolve(仓根, (配置.watchtower && 配置.watchtower.outDir) || 'watchtower-out');
const 新鲜阈值毫秒 = Number((配置.watchtower && 配置.watchtower.freshMs) || 45000);
const 未读上限 = Number((配置.watchtower && 配置.watchtower.unreadLimit) || 50);

function 心跳状态() {
  let 原文 = null;
  try { 原文 = fs.readFileSync(path.join(瞭望塔出口, '心跳.txt'), 'utf8').trim(); } catch { /* 未见 */ }
  if (!原文) return { 存在: false, 在岗: false, 说明: '未见心跳戳（守护从未启动或出口目录不对）' };
  const t = new Date(原文);
  if (isNaN(t.getTime())) return { 存在: true, 在岗: false, 时刻: 原文, 说明: '心跳戳不可解析' };
  const 毫秒龄 = Date.now() - t.getTime();
  return { 存在: true, 时刻: 原文, 毫秒龄, 阈值毫秒: 新鲜阈值毫秒, 在岗: 毫秒龄 <= 新鲜阈值毫秒 };
}

function 未读账本() {
  try {
    const 行 = fs.readFileSync(path.join(瞭望塔出口, '未读账本.jsonl'), 'utf8')
      .trim().split(/\r?\n/).filter(Boolean);
    return {
      总数: 行.length,
      条目: 行.slice(-未读上限).map((l) => { try { return JSON.parse(l); } catch { return { 原文: l }; } }),
    };
  } catch { return { 总数: 0, 条目: [] }; }
}

// ——————————————————————————————————————————————————————————
// HTTP 工具
// ——————————————————————————————————————————————————————————
function 发JSON(res, 码, 体) {
  const s = JSON.stringify(体, null, 1);
  res.writeHead(码, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}
// 解析失败时第二个参数带上「体到底来了没有」。
// 为什么要分：命令行内联中文键的 JSON 在 Windows 上常态传丢——
// git bash 的 curl -d '{"到":"待投"}' 与 PS 5.1 的 -Body 都会把字节弄坏，
// 服务端拿到的要么是空体、要么是解不开的乱码。两种情况都回一句「需要 JSON 体」，
// 人只会以为自己忘了带体，然后把同一条命令再敲一遍。
function 收体(req, 上限, 完成) {
  let 体 = '';
  req.on('data', (c) => { 体 += c; if (体.length > 上限) { req.destroy(); } });
  req.on('end', () => {
    if (!体) return 完成({}, { 空: true });
    try { return 完成(JSON.parse(体)); } catch {
      return 完成(null, { 空: false, 字节: Buffer.byteLength(体), 预览: 体.slice(0, 120) });
    }
  });
}

// 体来了但没能用上时补一句诊断。**只在体确实来过时才说**——真没带体就是没带，别乱指方向。
// 中文键传丢有两种长相，回执要分得开：
//   ① 整份解不成 JSON —— 字节被 shell 弄坏得连结构都不剩；
//   ② 解得开、但键是乱码 —— UTF-8 字节按别的码页走了一遭，非法字节被换成 U+FFFD，
//      `{"到":…}` 变成 `{"??":…}`，JSON.parse 照样成功。这一种最坑：
//      体明明到了、格式也没错，只是那个键谁也不认识。
const 传丢提示 = '命令行内联中文键在 Windows 上常态传丢——git bash 与 PowerShell 5.1 都会。'
  + '把体写进文件再 curl --data-binary @体.json，或改用 ASCII 别名。）';

function 体伤(详情, 体) {
  if (详情 && 详情.空 === false) {
    return `（收到 ${详情.字节} 字节但解不成 JSON：${JSON.stringify(详情.预览)}。`
      + 传丢提示;
  }
  const 键 = 体 && typeof 体 === 'object' ? Object.keys(体) : [];
  if (键.length) return `（体里的键是 ${JSON.stringify(键)}，没有认识的。` + 传丢提示;
  return '';
}

// 主动向工作区服务发一次请求（不同于 /api/workspace/* 的透传：那条是把浏览器的请求
// 原样递过去，这条是本进程自己组装一份——比如遗留回收要先读工单库，
// 而工单库不是工作区服务的能力面）。
// 路径带中文要编码：node 的 http.request 对未转义字符**同步抛** ERR_UNESCAPED_CHARACTERS，
// 不是返回错误，是把整个进程带走（/write/收工 就带中文，执行器那边踩过一次）。
function 转发工作区(res, 路径, 方法, 体) {
  const 数据 = JSON.stringify(体 || {});
  const 编码路径 = String(路径).split('/').map(encodeURIComponent).join('/');
  const 代理 = http.request({
    host: '127.0.0.1', port: 工作区端口, method: 方法 || 'POST', path: 编码路径,
    headers: {
      Authorization: `Bearer ${令牌}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(数据),
    },
  }, (上游) => {
    let s = '';
    上游.on('data', (d) => s += d);
    上游.on('end', () => {
      try { return 发JSON(res, 上游.statusCode, JSON.parse(s)); }
      catch { return 发JSON(res, 502, { ok: false, error: '工作区服务返回了非 JSON 内容' }); }
    });
  });
  代理.on('error', () => 发JSON(res, 503, {
    ok: false,
    error: `工作区服务未在 127.0.0.1:${工作区端口} 应答（npm run workspace 单起，或 npm start 一并起）。`,
  }));
  代理.write(数据);
  代理.end();
}

// 「这一张花了多少」。
//
// 数据本来就在预算账里——budget.记 是按 单 落的——只是从没被按单归集过。
// 战绩表有耗时，消耗表有池的日/月总量，而人真正想问的是
// 「FE-1 这一趟花了多少额度」，那两张表都答不了。
//
// **取不到读数的池必须点名**。codex 是非 stream-json 输出，usageOf 取不到 usage，
// 所以它跑过的那几次在账本里根本没有行。只报一个数字的话，
// 人会把「没记到」读成「没花」——而那正是花得最多的那次。
function 按单花费(id, 真跑记录) {
  try {
    const budget = 公用件.载入('budget', 'budget.js');
    const 按池 = {};
    for (const r of budget.读账(账本根)) {
      if (String(r.单 || '') !== String(id)) continue;
      const c = 按池[r.池] || (按池[r.池] = { 输入: 0, 缓存: 0, 输出: 0, token: 0, 条数: 0 });
      c.输入 += r.输入 || 0; c.缓存 += r.缓存 || 0; c.输出 += r.输出 || 0;
      c.token += (r.输入 || 0) + (r.输出 || 0);            // 合计不含缓存，与 budget 同口径
      c.条数 += 1;
    }
    const 跑过的池 = [...new Set((真跑记录 || []).map((r) => r.provider).filter(Boolean))];
    const 未计量 = 跑过的池.filter((p) => !按池[p]);
    return {
      按池,
      合计token: Object.values(按池).reduce((a, c) => a + c.token, 0),
      未计量池: 未计量,
      ...(未计量.length
        ? { 说明: `${未计量.join('/')} 跑过但账本里没有读数（非 stream-json 输出取不到 usage）——这部分消耗没被计入，不是没花。` }
        : {}),
    };
  } catch { return null; }                                  // budget 缺位就不报花费，不编数
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const 静态根 = path.join(仓根, 'public');
function 发静态(res, url路径) {
  const 相对 = url路径 === '/' ? 'index.html' : decodeURIComponent(url路径.replace(/^\/+/, ''));
  const 绝对 = path.normalize(path.join(静态根, 相对));
  if (!绝对.startsWith(静态根 + path.sep) && 绝对 !== path.join(静态根, 'index.html')) {
    return 发JSON(res, 403, { ok: false, error: '路径越界' });
  }
  fs.readFile(绝对, (err, buf) => {
    if (err) return 发JSON(res, 404, { ok: false, error: '未找到：' + 相对 });
    const 类型 = MIME[path.extname(绝对).toLowerCase()] || 'application/octet-stream';
    // 首页发出去之前把令牌注进 </head> 前。注入脚本给同源请求自动带上 Authorization
    // 与 JSON 头，于是 public/index.html 里已有的 fetch 调用一行都不用改。
    // 令牌只随首页出门：跨站页面读不到本页内容，拿不到它。
    if (绝对 === path.join(静态根, 'index.html')) {
      const 注入 = String(buf).replace('</head>', 门禁.注入脚本(令牌) + '\n</head>');
      res.writeHead(200, { 'Content-Type': 类型, 'Cache-Control': 'no-store' });
      return res.end(注入);
    }
    // no-store：前端随服务一起分发，没有版本化文件名。不加这个头，
    // 改完 app.js 刷新看不到变化——人会以为改动没生效，然后去代码里找一个
    // 根本不存在的 bug。2026-08-12 实测被它骗了一次：接口发的是新的，
    // 浏览器拿的是旧的，而两边都不报错。全是本机小文件，不缓存的代价可以忽略。
    res.writeHead(200, { 'Content-Type': 类型, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

// ——————————————————————————————————————————————————————————
// 路由
// ——————————————————————————————————————————————————————————
const 服务 = http.createServer((req, res) => {
  // 原先只 split('?')[0] 把查询串整个丢掉。新接的几条要读 role/kind/limit，故正经解析一次。
  // 基底 URL 只为让 WHATWG URL 肯收相对路径，不参与任何判断。
  const 请求URL = new URL(req.url || '/', 'http://127.0.0.1');
  const url路径 = 请求URL.pathname;
  const 查询 = 请求URL.searchParams;

  // 门禁在路由之前。放在之后的话，未知路径的 404 会泄露「哪些接口存在」——
  // 未授权者不该有能力区分「这条接口不存在」和「这条接口存在但你进不来」。
  if (url路径.startsWith('/api/')) {
    const 拒 = 门禁.校验(req, { 令牌, 端口, 路径: url路径 });
    if (拒) return 发JSON(res, 拒.码, { ok: false, error: 拒.错误 });
  }

  if (url路径 === '/api/health') {
    return 发JSON(res, 200, {
      ok: true, 平台: 平台名, 版本, 端口,
      时刻: new Date().toISOString(),
      桩模式: true,
      公用件: 公用件.PACKAGES,
    });
  }

  if (url路径 === '/api/watchtower') {
    const 心跳 = 心跳状态();
    return 发JSON(res, 200, {
      ok: true,
      心跳,
      未读: 未读账本(),
      出口: 瞭望塔出口,
      ...(心跳.在岗 ? {} : { 拉起命令: 'npm run watchtower（前台）或 npm run watchtower:install 装登录自启' }),
    });
  }

  if (url路径 === '/api/providers' && req.method === 'GET') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: registry错误 });
    try {
      const providers = registry.list(配置).map((p) => ({
        名称: p.name, adapter: p.adapter,
        启用: p.enabled !== false,
        roles: p.roles || [],
        说明: p.说明 || '',
      }));
      return 发JSON(res, 200, { ok: true, 来源: 公用件.解析('providers'), providers });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  if (url路径 === '/api/providers/echo' && req.method === 'POST') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: registry错误 });
    return 收体(req, 64 * 1024, (体) => {
      if (!体 || !体.provider) return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "provider": "<名称>", "model"?, "prompt"? }' });
      try {
        const adapter = registry.create(配置, String(体.provider));
        const 调用 = adapter.buildInvocation({ model: 体.model ? String(体.model) : undefined });
        return 发JSON(res, 200, {
          ok: true, 桩: true,
          provider: adapter.name, adapter: adapter.adapter,
          调用,                                  // 组装出的进程调用（证明适配层接线通）
          回声: String(体.prompt || 'echo'),      // 桩回声：原样弹回
          说明: '桩模式：仅经 @papercrew/providers 组装调用参数，未落任何进程，零真实 CLI 调用零计费。',
        });
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }
    });
  }

  // ——— 动态路由：按角色给 Provider 排名 ———
  // 只算不派。返回每个候选的分数与理由，理由是给人看的——排名不透明就没人敢信它。
  if (url路径 === '/api/routing/rank' && req.method === 'GET') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: registry错误 });
    try {
      const 角色 = 查询.get('role') || 查询.get('角色') || '';
      const 类别 = 查询.get('kind') || 查询.get('类别') || '执行';
      const 排名 = 路由器.rankProviders(账本根, 配置, { role: 角色, kind: 类别 });
      // 全平局要**说出来**。否则调用方会把「按字母序排第一」误当成「评估下来最优」，
      // 那比没有排名更危险——它看起来像个判断，实际上一点信号都没有。
      const 无区分度 = 排名.length > 1 && 排名.every((r) => r.score === 排名[0].score);
      return 发JSON(res, 200, {
        ok: true,
        角色: 排名[0] ? 排名[0].role : (角色 || (类别 === '执行' ? 'generalist' : 'reviewer')),
        类别,
        选中: 排名[0] ? 排名[0].name : null,
        有区分度: !无区分度,
        排名: 排名.map((r) => ({ 名称: r.name, 分数: r.score, 理由: r.reasons })),
        说明: !排名.length ? '无候选：检查 providers 是否启用、能力是否匹配'
          : 无区分度 ? '本次排名无区分度：各候选得分相同，当前顺序仅按名称字母序，不代表评估结论。'
            + '要让排名真正有信号，需其一：providers.<名>.scores 显式打分、'
            + 'routing.roles.<角色>.prefer 声明偏好，或 journal/provider-runs.jsonl 积累实际战绩。'
            : '仅排名，未派发任何任务',
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 路由历史：只读 journal/provider-runs.jsonl ———
  if (url路径 === '/api/routing/history' && req.method === 'GET') {
    try {
      const 上限 = Math.min(Math.max(Number(查询.get('limit')) || 50, 1), 500);
      const 角色 = 查询.get('role') || 查询.get('角色') || '';
      const 记录 = 路由历史.read(账本根, 上限);
      const 汇总 = {};
      if (角色 && registry) {
        for (const p of registry.list(配置)) 汇总[p.name] = 路由历史.summary(账本根, p.name, 角色);
      }
      return 发JSON(res, 200, {
        ok: true,
        账本: 路由历史.historyPath(账本根),
        条数: 记录.length,
        ...(角色 ? { 角色, 汇总 } : {}),
        记录,
        ...(记录.length ? {} : { 说明: '尚无执行记录——桩模式不写账，真实派发接线后才会有内容' }),
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 工具链探测：只查文件是否存在，不安装、不下载 ———
  if (url路径 === '/api/toolchain' && req.method === 'GET') {
    try {
      const found = 工具链.resolve(仓根, 配置);
      return 发JSON(res, 200, {
        ok: true,
        就位: found.ok,
        目录: found.dir, node: found.node, npm: found.npm, npx: found.npx,
        候选路径: 工具链.candidates(仓根, 配置),
        注入指引: 工具链.guidance(仓根, 配置),
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 评审报告归一：纯文本进、结构化字段出 ———
  // 无状态、不落盘。各家 Provider 的 Markdown 格式不一，UI 不该自己去猜。
  if (url路径 === '/api/review/parse' && req.method === 'POST') {
    return 收体(req, 256 * 1024, (体) => {
      if (!体 || typeof 体.文本 !== 'string') {
        return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "文本": "<评审报告 Markdown>", "通过"?: true|false }' });
      }
      try {
        return 发JSON(res, 200, { ok: true, ...评审意见.parse(体.文本, 体.通过) });
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }
    });
  }

  // ——— 计划校验：Orchestrator 的自然语言输出 → 结构化 DAG ———
  // 只解析与校验，**不落盘**。落盘要注入工单库，platform 还没有自己的那一套。
  // 这条的价值在于：AI 提的计划先过确定性内核，角色/依赖/数量/写区不合规当场打回。
  if (url路径 === '/api/plan/validate' && req.method === 'POST') {
    return 收体(req, 512 * 1024, (体) => {
      if (!体 || typeof 体.输出 !== 'string') {
        return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "输出": "<Orchestrator 的回复原文>" }' });
      }
      try {
        const { plan, source } = 计划.resolvePlan(配置, 体.输出, undefined);
        return 发JSON(res, 200, {
          ok: true, 合规: true, 来源: source,
          摘要: plan.summary || '',
          任务数: plan.tasks.length,
          任务: plan.tasks.map((t) => ({
            key: t.key, 标题: t.title, 角色: t.role,
            依赖: t.dependsOn, 验收: t.acceptance, 写区: t.writeScope,
          })),
          说明: '仅校验，未落盘——物化子工单需要注入工单库，platform 尚无自有工单库',
        });
      } catch (e) {
        // 校验不通过是**正常业务结果**，不是服务故障，所以是 200 + 合规:false。
        return 发JSON(res, 200, { ok: true, 合规: false, 原因: e.message });
      }
    });
  }

  // ——— 落位工单库（协-005）———
  // 「不替你猜位置」拦的是产品自作主张，不是让人必须去翻文档手搓 JSON。
  // 这个口子只收人明确填进来的路径，落到 config/工单库.local.json（已被 gitignore 挡住）。
  if (url路径 === '/api/setup/tickets' && req.method === 'POST') {
    return 收体(req, 8 * 1024, (体) => {
      const r = 工单库.落位(仓根, 体 && (体.根目录 || 体.root));
      if (!r.ok) return 发JSON(res, 400, { ok: false, error: r.错误 });
      工单根 = 工单库.解析根目录(仓根);       // 当场生效，不用重启
      return 发JSON(res, 200, {
        ok: true, 根目录: r.根, 配置文件: r.文件, 换根: r.换根, 旧根: r.旧根,
        // 环境变量优先级高于配置文件。配了却不生效是最难自查的一种「没反应」，
        // 所以宁可在成功回执里也把这句顶出来。
        ...(r.被环境变量盖住 ? {
          警告: '当前设了 PLATFORM_TICKETS 环境变量，它优先级更高，会盖住这份配置。'
            + `实际生效的仍是 ${工单根.ok ? 工单根.根 : '(解析失败)'}。要让本次设置生效，请清掉该环境变量。`,
        } : {}),
      });
    });
  }

  // ——— 工单库（协-001）———
  // 未配置根目录时一律 503 + 人话修法。**不猜路径不兜底**：猜一个位置往里写业务数据，
  // 等发现写错地方时数据已经散在两处了，比直接报错严重得多。
  // ——— 工单实例（协-028）：一张单的一生 + 每次运行的流水 ———
  //
  // 看板是**横着看**的：一眼扫过所有单。而人点开一张单时问的是**竖着**的问题——
  // 它走到哪一步了、每一步花了多久、那一步里 agent 到底说了什么。
  // 这两个问题的答案此前散在四处：工单 frontmatter、provider-runs 账本、
  // 那一次 HTTP 回执（关掉就没了）、以及**根本没留下的** agent 输出。
  // 路由名用 ASCII：中文路径段会被浏览器百分号编码（`/实例` → `/%E5%AE%9E%E4%BE%8B`），
  // 正则对不上就一路掉进块尾的 404——既有的 /move、/runs 也都是 ASCII，照做。
  const 实例 = url路径.match(/^\/api\/tickets\/([^/]+)\/instance$/);
  if (实例 && req.method === 'GET') {
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    const id = decodeURIComponent(实例[1]);
    const t = 工单库.find(工单根.根, id);
    if (!t) return 发JSON(res, 404, { ok: false, error: `工单不存在：${id}` });
    const 流水 = require('./lib/运行流水');
    const 态 = 读JSON(path.join(账本根, 'journal', '执行器态.json'), {});
    const 在跑 = (Array.isArray(态.在跑) ? 态.在跑 : []).find((x) => x.单 === id) || null;
    return 发JSON(res, 200, {
      ok: true, 工单: { id: t.id, state: t.state, fm: t.fm, body: t.body },
      阶段: require('./lib/阶段轴').阶段轴(t),
      运行: 流水.列(账本根, id),
      在跑: 在跑 ? { ...在跑, 已跑毫秒: 在跑.起于 ? Math.max(0, Date.now() - Date.parse(在跑.起于)) : null } : null,
      // 态龄跟着走：在跑那条若来自一份很旧的态文件，它说明不了「现在」。
      态龄秒: 态.更新于 ? Math.max(0, Math.round((Date.now() - Date.parse(态.更新于)) / 1000)) : null,
    });
  }

  // 一次运行的流水，增量读。**按字节偏移续读**——按行会因为半行而错位。
  const 流 = url路径.match(/^\/api\/tickets\/([^/]+)\/stream\/([^/]+)$/);
  if (流 && req.method === 'GET') {
    const id = decodeURIComponent(流[1]);
    const 运行号 = decodeURIComponent(流[2]);
    const 流水 = require('./lib/运行流水');
    const from = Number(查询.get('from')) || 0;
    const 形 = 查询.get('形态') || '人读';
    const r = 流水.读(账本根, id, 运行号, from);
    const 元 = 流水.列(账本根, id).find((x) => x.运行号 === 运行号) || null;
    return 发JSON(res, 200, {
      ok: true, 运行号, ...r, 元,
      内容: 形 === '原始' ? r.内容
        : 流水.渲染(r.内容, (元 && 元.类别) === '质检' ? undefined : undefined) || r.内容,
      形态: 形,
      说明: '原始流是证据，人读那版是在读的时候现渲染的——格式会变，解析随时可能抽错，'
        + '抽错了还能回头看原文（形态=原始），原文丢了就什么都没有。',
    });
  }

  if (url路径 === '/api/tickets' || url路径.startsWith('/api/tickets/')) {
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    const 根 = 工单根.根;

    if (url路径 === '/api/tickets' && req.method === 'GET') {
      try {
        const 状态 = 查询.get('state') || 查询.get('状态') || '';
        if (状态 && !工单库.STATES.includes(状态)) {
          return 发JSON(res, 400, { ok: false, error: `未知状态：${状态}（合法：${工单库.STATES.join('/')}）` });
        }
        // 不指定状态时**不含已归档**（协-009）。归档的意义就是从眼前挪走，
        // 「全部」照样列出来的话归档等于没做。要看就显式 ?state=已归档。
        //
        // 这条下沉到接口而不是只在前端过滤：前端过滤只护得住浏览器，
        // 命令行调用方拿到的仍是含归档的全表，两处对同一个词各执一词。
        const 含归档 = 状态 === '已归档' || 查询.get('含归档') === '1';
        const 全 = 工单库.list(根, 状态).filter((t) => 含归档 || t.state !== '已归档');
        // 按项目收窄（协-007）。工单库只有一个，项目是**筛选维度**不是分库——
        // 分库会把跨项目依赖切断，也让巡检与调度失去全局视野（studio 同样是一个库）。
        // 「(无项目)」是个真实的类别，不是「全部」的同义词：不带项目的单只跑不提交，
        // 它们是一群需要单独看见的单，所以给它一个显式的筛选值。
        const 项目筛 = 查询.get('项目') || 查询.get('project') || '';
        const 单 = !项目筛 ? 全
          : 全.filter((t) => (项目筛 === '(无项目)' ? !((t.fm || {}).项目) : (t.fm || {}).项目 === 项目筛));
        return 发JSON(res, 200, {
          ok: true, 根目录: 根, 来源: 工单根.来源, 条数: 单.length, 工单: 单,
          ...(项目筛 ? { 项目筛, 全库条数: 全.length } : {}),
        });
      } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
    }

    if (url路径 === '/api/tickets' && req.method === 'POST') {
      return 收体(req, 256 * 1024, (体) => {
        if (!体 || !体.id) return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "id": "<编号>", "fm"?: {}, "正文"?: "" }' });
        // 项目名在**建单这一刻**校验，不留到真跑（协-007）。
        // 不拦的话，一个写错的项目名要经过投出、排队、派活好几步——每步都显示正常——
        // 最后在花钱那一刻炸成「项目未注册」。错得越晚越贵。
        // 空值仍然放行：不带项目的单只跑不提交，那是既定行为不是配错了。
        const 项目错 = 项目.校验工单项目(配置, (体.fm || {}).项目);
        if (项目错) return 发JSON(res, 400, { ok: false, error: 项目错 });
        try {
          const r = 工单库.create(根, String(体.id), 体.fm || {}, 体.正文 || '');
          if (!r.ok) return 发JSON(res, 400, { ok: false, error: r.error });
          // 验收标准体检：**只提醒不拦**。标准是人对「做对了」的定义，
          // 机器无权替人改写，也不该因为写得不够好就拒绝建单——
          // 但把毛病说出来，比等它跑三轮判不过再由巡检报「反复回炉」便宜得多。
          const 检 = 工单模板.体检(体.正文 || '');
          return 发JSON(res, 201, {
            ok: true, ...r,
            验收标准: { 条数: 检.条数, ...(检.病.length ? { 体检: 检.病 } : {}) },
            ...(检.病.length ? { 提醒: '验收标准有可改进处（已建单，不影响使用）。写不清的标准会让判官只能靠猜，最后表现为反复回炉。' } : {}),
          });
        } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
      });
    }

    // 模板：按角色给出带**可验证验收标准**的骨架。
    // 验收标准写不好 → 判官判不过 → 回炉重跑 → 再判不过，每轮都是真实付费。
    // 与其等巡检报「反复回炉」，不如建单那一刻就把结构给对。
    if (url路径 === '/api/tickets/template' && req.method === 'GET') {
      const 角色 = 查询.get('role') || 查询.get('角色') || '';
      const t = 工单模板.取(角色);
      return 发JSON(res, 200, { ok: true, 角色, ...t });
    }

    const 迁移 = url路径.match(/^\/api\/tickets\/([^/]+)\/move$/);
    if (迁移 && req.method === 'POST') {
      const id = decodeURIComponent(迁移[1]);
      return 收体(req, 64 * 1024, (体, 详情) => {
        // to 是 到 的 ASCII 别名（与 /run 的 dry_run 同一档口径）。
        // 中文键的请求体在命令行里传不可靠：不止 PS 5.1，git bash 的
        // curl -d '{"到":"待投"}' 同样解不出来。别名让「一句 curl 挪张单」重新成立。
        const 到 = 体 && (体.到 !== undefined ? 体.到 : 体.to);
        if (!到) {
          return 发JSON(res, 400, {
            ok: false,
            error: '需要 JSON 体 { "到": "<目标状态>" }（ASCII 别名：{ "to": "<目标状态>" }）' + 体伤(详情, 体),
          });
        }
        try {
          const 当前 = 工单库.find(根, id);
          if (!当前) return 发JSON(res, 404, { ok: false, error: `工单不存在：${id}` });
          const r = 工单库.move(根, id, 当前.state, String(到));
          return 发JSON(res, r.ok ? 200 : 409, r.ok ? { ok: true, ...r } : { ok: false, error: r.error });
        } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
      });
    }

    // 运行历史必须在「单张详情」**之前**判——不然会被块尾的 404 吃掉。
    // 全局战绩看不出「这一张跑过几轮、每轮什么结果」，而判不过会回待投重跑，
    // 一张单跑三四轮是常态：不按单归集，就没法回答「它为什么还没完成」。
    const 单史 = url路径.match(/^\/api\/tickets\/([^/]+)\/runs$/);
    if (单史 && req.method === 'GET') {
      try {
        const id = decodeURIComponent(单史[1]);
        const 全 = 路由历史.read(账本根, 1000).filter((r) => r.ticket === id);
        const 真 = 全.filter((r) => !r.dry);
        return 发JSON(res, 200, {
          ok: true, 工单: id, 总次数: 全.length, 真实次数: 真.length, 干跑次数: 全.length - 真.length,
          // 按 kind 分而不是按 role：**reviewer 角色的工单本身也要被执行**，
          // 只按 role 分会把「执行一张 reviewer 单」错记成「对它做了质检」。
          // 实测踩到：R-1 是 reviewer 单，它的首次执行被归进了质检列。
          // 老记录没有 kind，回退到 qualityPassed 是否存在来判——
          // 那个字段只有质检才写，是可靠的区分依据。
          执行: 真.filter((r) => (r.kind ? r.kind === '执行' : r.qualityPassed === undefined))
            .map((r) => ({ 时刻: r.at, provider: r.provider, 成: r.ok, 耗时毫秒: r.durationMs })),
          质检: 真.filter((r) => (r.kind ? r.kind === '质检' : r.qualityPassed !== undefined))
            .map((r) => ({ 时刻: r.at, 判官: r.provider, 判过: r.qualityPassed, 耗时毫秒: r.durationMs })),
          ...(全.length ? {} : { 说明: '这张单还没跑过' }),
          花费: 按单花费(id, 真),
        });
      } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
    }

    const 单张 = url路径.match(/^\/api\/tickets\/([^/]+)$/);
    if (单张 && req.method === 'GET') {
      try {
        const t = 工单库.find(根, decodeURIComponent(单张[1]));
        if (!t) return 发JSON(res, 404, { ok: false, error: `工单不存在：${decodeURIComponent(单张[1])}` });
        return 发JSON(res, 200, { ok: true, id: t.id, 状态: t.state, fm: t.fm, 正文: t.body });
      } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
    }

    return 发JSON(res, 404, { ok: false, error: '未知工单接口：' + url路径 });
  }

  // ——— 计划物化：把 /api/plan/validate 的下半场接上 ———
  // plan.js 的 materialize 要注入工单库，这里把两头接起来。**这是唯一会落盘的计划接口**。
  if (url路径 === '/api/plan/materialize' && req.method === 'POST') {
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    return 收体(req, 512 * 1024, (体) => {
      if (!体 || typeof 体.输出 !== 'string' || !体.父单) {
        return 发JSON(res, 400, { ok: false, error: '需要 JSON 体 { "输出": "<Orchestrator 回复原文>", "父单": "<父单编号>" }' });
      }
      try {
        const 父 = 工单库.find(工单根.根, String(体.父单));
        if (!父) return 发JSON(res, 404, { ok: false, error: `父单不存在：${体.父单}` });
        工单库.建目录(工单根.根);
        const r = 计划.consume(工单根.根, 配置, { id: 父.id, fm: 父.fm }, 体.输出, { store: 工单库 });
        return 发JSON(res, 200, {
          ok: true, 来源: r.source, 摘要: r.plan.summary || '',
          子单: r.children, 新建: r.created, 更新: r.updated, 保留: r.retained,
          说明: '保留的是已开工或已完成的旧计划子单，重规划不覆盖它们',
        });
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }
    });
  }

  // ——— 设置落盘（协-037）：五个开关也能在界面上改 ———
  //
  // 到协-036 为止界面只配得了工单库根与项目注册，其余五样得关程序、手改 JSON、重启。
  // 而那五样恰恰最要紧：真跑总开关、预算上限、提交链写权、计费模式、角色写权白名单。
  //
  // **写的仍然只是 config/*.local.json**——那个后缀被 .gitignore 结构性挡着，
  // 「危险开关不可能入库」这条原始保证一个字没变。变的只是怎么改它。
  //
  // 改完回一份新的自检：人点完开关最想知道的是「现在够不够用了」，
  // 让他自己再去点一次自检是把答案藏起来。
  // 读当前值。界面要先知道现在是什么样，才谈得上「改」——
  // 没有这条的话开关只能画成无状态的按钮，人点之前不知道它现在开着还是关着。
  if (url路径 === '/api/setup/switches' && req.method === 'GET') {
    const 执 = 配置.执行 || {};
    // providers 是**对象**（池名 → 定义），不是数组。第一版当数组 map，
    // 结果 GET 一打就 TypeError——而这是个读接口，它把整个 server 掀了。
    // 拿配置的形状当想当然，是这条链上最容易犯的错；顺手都套一层保护。
    const 取键 = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v) : [];
    const 池表 = [...new Set([
      ...取键(配置.预算 && 配置.预算.池),
      ...取键(配置.计费),
      ...取键(配置.providers),
    ])];
    return 发JSON(res, 200, {
      ok: true,
      允许真跑: 执.允许真跑 === true,
      允许写: !!(配置.workspace && 配置.workspace.允许写 === true),
      放开: Array.isArray(执.权限 && 执.权限.放开) ? 执.权限.放开 : [],
      并发: (执.并发 && typeof 执.并发 === 'object' && !Array.isArray(执.并发)) ? 执.并发 : { 默认: 1 },
      预算: (配置.预算 && 配置.预算.池) || {},
      计费: 配置.计费 || {},
      池表,
      // 角色表给界面画勾选框用。写死一份不如从工单模板取——但那是另一条链，
      // 这里给的是**已知会用到的角色**，界面允许自己加。
      角色表: [...new Set([...(Array.isArray(执.权限 && 执.权限.放开) ? 执.权限.放开 : []),
        'backend', 'frontend', 'integrator', 'reviewer', 'planner'])],
      说明: '这些开关写的是 config/*.local.json（被 .gitignore 挡着，不会入库）。'
        + '改完当场生效，不用重启。',
    });
  }

  if (url路径 === '/api/setup/switches' && req.method === 'POST') {
    return 收体(req, 16 * 1024, (体) => {
      if (!体) return 发JSON(res, 400, { ok: false, error: '需要 JSON 体' });
      const r = 设置落盘.应用设置(仓根, 体);
      if (!r.ok) return 发JSON(res, 400, { ok: false, error: r.错误 });
      // 本进程捧着开机时合并好的那份配置，不重读的话人在界面上改完、
      // 下一次调用还按旧的走——而界面已经显示改好了。项目注册那条踩过同款（协-005）。
      const 新 = 本地覆盖.应用(仓根, 读JSON(path.join(仓根, 'config', 'platform.config.json'), {})).配置;
      for (const k of ['执行', '预算', 'workspace', '计费']) 配置[k] = 新[k];
      // 放宽了哪几处必须看得见——悄悄生效的安全降级比不降级更危险。
      try { require('./lib/呼叫').常(账本根, '设置变更', r.改.join('；'), { 静默秒: 0 }); } catch { /* 记不下不影响改动 */ }
      process.stdout.write(`[${平台名}] 设置变更：${r.改.join('；')}\n`);
      return 发JSON(res, 200, { ok: true, 改: r.改, 落盘: r.落盘, 自检: 自检.结论(自检.查(仓根, 配置, 工单根)) });
    });
  }

  // ——— 自检（协-005）：这台机器现在能干什么、不能干什么、为什么 ———
  // 免令牌？不。它会吐出配置路径与已注册项目——那些不该给未授权者看。
  if (url路径 === '/api/selfcheck' && req.method === 'GET') {
    try {
      const 条 = 自检.查(仓根, 配置, 工单根);
      return 发JSON(res, 200, {
        ok: true, ...自检.结论(条), 能力: 条,
        本地覆盖: 本地覆盖.摘要(生效的覆盖),
        说明: '自检只报事实**不做修复**：自动补配置意味着替你决定业务数据落哪、要不要花钱，'
          + '那些不该由一个自检函数拍板。',
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 消耗报表（协-005）：钱花在哪 ———
  // 平台会真的花钱之后，「花了多少」就不再是可选信息。budget.view 早就有，
  // 但一直没有消费方——账记着没人看，等于没记。
  if (url路径 === '/api/budget' && req.method === 'GET') {
    try {
      const budget = 公用件.载入('budget', 'budget.js');
      const 池表 = budget.view(配置, 账本根);
      const 明细 = budget.读账(账本根).slice(-200);
      // 按工单归集：一张单可能跑过多次（判不过回炉重跑），成本要算总账。
      const 按单 = {};
      for (const r of 明细) {
        const k = r.单 || '(无单号)';
        const o = 按单[k] || (按单[k] = { 单: k, 次数: 0, 输入: 0, 缓存: 0, 输出: 0, 池: new Set() });
        o.次数 += 1; o.输入 += r.输入 || 0; o.缓存 += r.缓存 || 0; o.输出 += r.输出 || 0;
        o.池.add(r.池);
      }
      // 按项目归集（协-007）：回答「这个项目花了多少」。
      //
      // 账本是公用件 packages/budget 写的，字段里没有项目——**不去改那个包**：
      // 它是双签共建的正本，为本产品的一个报表去动它的记录格式，等于把
      // 单方需求塞进公共契约。这里用工单库做一次关联即可，代价只是一次目录扫描。
      const 项目of = {};
      if (工单根.ok) {
        try {
          for (const t of 工单库.list(工单根.根)) 项目of[t.id] = (t.fm || {}).项目 || '(无项目)';
        } catch { /* 工单库读不了不该把整个报表打掉 */ }
      }
      const 按项目 = {};
      for (const r of 明细) {
        // 单已不在库（改过号、手工删过）要单独成类，不能并进「(无项目)」——
        // 那会让一笔查不到出处的开销看起来像一笔正常的无项目开销。
        const k = 项目of[r.单] || (r.单 ? '(单已不在库)' : '(无单号)');
        const o = 按项目[k] || (按项目[k] = { 项目: k, 次数: 0, 输入: 0, 缓存: 0, 输出: 0, 单数: new Set() });
        o.次数 += 1; o.输入 += r.输入 || 0; o.缓存 += r.缓存 || 0; o.输出 += r.输出 || 0;
        if (r.单) o.单数.add(r.单);
      }
      return 发JSON(res, 200, {
        ok: true, 账本: budget.账本(账本根), 池: 池表,
        按项目: Object.values(按项目).map((o) => ({ ...o, 单数: o.单数.size }))
          .sort((a, b) => (b.输入 + b.输出) - (a.输入 + a.输出)),
        按工单: Object.values(按单).map((o) => ({ ...o, 池: [...o.池] }))
          .sort((a, b) => (b.输入 + b.输出) - (a.输入 + a.输出)).slice(0, 20),
        条数: 明细.length,
        ...(池表.length ? {} : { 说明: '还没有配任何池的预算上限——没有上限就没有刹车，也无从判超' }),
        codex提示: 'codex 非 stream-json 输出，取不到 usage，其消耗**不计入本账**（见 packages/budget/README.md）',
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: `预算闸不可用：${e.message}` }); }
  }

  // ——— 欠你几笔（协-019）：全系统唯一的「现在等我落笔的是哪些」———
  //
  // 定义域是**闸**不是工单状态（形制取自 studio 的 gatereg，理由见 lib/闸注册表.js 头部）。
  // 三条纪律：只读权威状态（绝不拿呼叫信箱当账本）、gateKey 幂等、发起型不进清单。
  if (url路径 === '/api/attn' && req.method === 'GET') {
    const 闸表 = require('./lib/闸注册表');
    if (!工单根.ok) {
      // 连工单库都没配时不硬凑一份空清单——空清单会被读成「一笔都不欠」，
      // 而真相是「根本没查」。这两件事必须分得开。
      return 发JSON(res, 503, { ok: false, error: 工单根.错误, 说明: '工单库没配，欠账无从谈起——这不是「零欠账」' });
    }
    const 工单表 = 工单库.list(工单根.根);
    const 冻 = 派单.冻结情况(公用件, 配置, 账本根);
    const 池数 = Object.keys(配置.providers || {}).length;
    const 态 = 读JSON(path.join(账本根, 'journal', '执行器态.json'), {});
    const 逾期阈值小时 = Number((配置.执行 && 配置.执行.逾期升格小时) || 24);
    const r = 闸表.等我({
      工单表,
      现在: Date.now(),
      卡死阈值: Number((配置.巡检 && 配置.巡检.在途超时毫秒) || 30 * 60 * 1000),
      依赖就绪: (t) => 派单.依赖就绪(工单库, 工单根.根, 工单库.find(工单根.根, t.id) || t).ok,
      // 自动派发开着时「待投」不算欠人——有人接管了。取执行器落下的运行态，
      // 不取 config：人可以在界面上开关它，config 里那个只是开机默认。
      自动派发开: !!(态.自动派发 && 态.自动派发.开),
      可用池数: Math.max(0, 池数 - Object.keys(冻.挡 || {}).length),
      耗尽: 闸表.读耗尽(账本根),
      账本根,
    });
    return 发JSON(res, 200, {
      ok: true, ...r,
      逾期阈值小时,
      逾期: r.债.filter((x) => x.停摆小时 != null && x.停摆小时 >= 逾期阈值小时),
      // 在跑要跟着一起报（协-027）：「欠你几笔」回答的是「有什么等我」，
      // 而人问的第一句往往是「它现在还在动吗」。两者分两个接口取，界面就会有一半是旧的。
      //
      // 态文件的**新鲜度**也一并给出去：执行器崩了这份文件还在，里面的「在跑」会永远挂着
      // 一张早就没跑的单。分不出「正在跑」和「死在那儿」，比不显示更坏。
      执行器态: 态.pid ? {
        自动派发: 态.自动派发 || null, 起于: 态.起于 || null, pid: 态.pid,
        // 已跑多久**在读的时候算**：写盘只发生在进出清单的两个瞬间，
        // 落在文件里的那个数一写就冻住，读到的永远是 0。
        在跑: (Array.isArray(态.在跑) ? 态.在跑 : []).map((x) => ({
          ...x, 已跑毫秒: x.起于 ? Math.max(0, Date.now() - Date.parse(x.起于)) : null,
        })),
        态龄秒: 态.更新于 ? Math.max(0, Math.round((Date.now() - Date.parse(态.更新于)) / 1000)) : null,
      } : null,
      说明: '按停摆时长降序（催办的天然序）。发起型闸不进这份清单——没有队列的动作不可能「欠着」，'
        + '硬塞进来只会造出永远为空或永远为满的假账。注册表里能看到它们全部。',
    });
  }

  // ——— 就绪探针（协-019）：**存活 ≠ 就绪** ———
  //
  // /api/health 回答「这个进程还活着吗」（瞭望塔探它，免令牌）；
  // 本端点回答「它现在真的能干活吗」——工单库读不读得到、公用件载不载得动、
  // 另外两个进程在不在。无人值守时这两件事必须分开：进程活着但工单库那块盘掉了，
  // health 照样绿，而产线一张单也走不动。
  if (url路径 === '/api/ready' && req.method === 'GET') {
    const 项 = [];
    项.push({ 项: '工单库', 就绪: !!工单根.ok, 详: 工单根.ok ? 工单根.根 : 工单根.错误 });
    for (const 包 of ['providers', 'budget', 'quota']) {
      try { 公用件.载入(包, `${包 === 'providers' ? 'registry' : 包}.js`); 项.push({ 项: `公用件/${包}`, 就绪: true }); }
      catch (e) { 项.push({ 项: `公用件/${包}`, 就绪: false, 详: String(e.message).split('\n')[0] }); }
    }
    // 自检的「级别」进来当一条只读旁证，**不当闸**：能干到哪一步（干跑可用 / 全链路就绪）
    // 是产品形态问题，不是「服务坏了」。把「没开真跑」判成未就绪，会让探针在
    // 一台**故意只跑干跑**的机器上永远红着，红久了就没人看了。
    const 自检结论 = 自检.结论(自检.查(仓根, 配置, 工单根));
    const 探 = (口, 名) => new Promise((定) => {
      const q = http.request({ host: '127.0.0.1', port: 口, method: 'GET', path: '/health', timeout: 1500,
        headers: { Authorization: `Bearer ${令牌}` } }, (上) => {
        let s = ''; 上.on('data', (d) => s += d);
        上.on('end', () => 定({ 项: 名, 就绪: 上.statusCode === 200, 详: 上.statusCode === 200 ? undefined : `HTTP ${上.statusCode}` }));
      });
      q.on('timeout', () => { q.destroy(); 定({ 项: 名, 就绪: false, 详: '1.5s 无应答' }); });
      q.on('error', (e) => 定({ 项: 名, 就绪: false, 详: `${e.code || e.message}——没起来或已崩` }));
      q.end();
    });
    return Promise.all([探(工作区端口, '工作区服务'), 探(执行器端口, '执行器')]).then((远) => {
      const 全 = [...项, ...远];
      const 就绪 = 全.every((x) => x.就绪);
      发JSON(res, 就绪 ? 200 : 503, {
        ok: 就绪, 就绪, 检查: 全, 能力级别: 自检结论.级别, 能力一句话: 自检结论.一句话,
        未就绪: 全.filter((x) => !x.就绪).map((x) => `${x.项}：${x.详 || '不可用'}`),
        说明: '就绪 = 现在能干活。存活探针是 /api/health（免令牌，瞭望塔用），它不看这些。',
      });
    });
  }

  // ——— 呼叫信箱（协-019）：无人值守时的唯一出口 ———
  if (url路径 === '/api/inbox' && req.method === 'GET') {
    const 呼叫 = require('./lib/呼叫');
    const 上限 = Math.min(500, Number(请求URL.searchParams.get('limit')) || 100);
    const 全 = 呼叫.列(账本根, 上限);
    const 未 = 呼叫.未读(账本根, 500);
    return 发JSON(res, 200, {
      ok: true, 条数: 全.length, 未读: 未.length, 急未读: 未.filter((x) => x.级别 === '急').length,
      呼叫: 全.slice().reverse(),
      说明: '同因告警在静默窗内只落一笔（同因压制 字段记着被压了多少次）——'
        + '一条报了 265 次的告警和一条只报过一次的，在信箱里必须长得不一样。',
    });
  }
  if (url路径 === '/api/inbox/read' && req.method === 'POST') {
    return 发JSON(res, 200, { ok: true, ...require('./lib/呼叫').标记已读(账本根) });
  }

  // ——— 额度（协-018）：订阅窗口的当下读数 + 这道闸此刻挡了谁 ———
  //
  // 取数不在这个进程（要拉起 codex app-server，本进程闭包里不许有 child_process）：
  // 执行器定期取数落 journal/额度快照.json，这里只读盘 + 判定（判定整块是 packages/quota 的纯函数）。
  // 所以这个接口报的是**快照**，不是实时值——更新于 / 盲区 两个字段就是为了让人看见这件事。
  if (url路径 === '/api/quota' && req.method === 'GET') {
    const 额度闸 = require('./lib/额度闸');
    const 快照 = 额度闸.读快照(账本根);
    const 判 = 额度闸.判(配置, 快照);
    return 发JSON(res, 200, {
      ok: true, ...判,
      快照文件: 额度闸.快照文件(账本根),
      ...(快照 ? {} : { 说明: '还没有额度快照——执行器起来之后会定期取数落盘（npm start 会带起它）。'
        + '在那之前额度闸恒不锁，界面上这一块是**盲区**，不是「额度充足」。' }),
    });
  }

  // ——— 编制（协-015）：哪个角色归哪个模型 ———
  // 照抄 studio 的 /api/pm/roster：GET 只读快照，POST 批量改。
  // **可用性用调度那把尺**——冻结判定直接复用 派单.冻结情况，不在这儿另写一套。
  // 各算各的话，界面显示「可用」而实际派不出去，人会以为平台坏了。
  if (url路径 === '/api/roster' && req.method === 'GET') {
    const 冻 = 派单.冻结情况(公用件, 配置, 账本根);
    const isFrozen = (池) => (冻.ok ? Object.prototype.hasOwnProperty.call(冻.挡, 池) : null);
    return 发JSON(res, 200, {
      ok: true,
      编制: 编制.快照(配置, isFrozen),
      池: 编制.池表(配置),
      ...(冻.ok ? { 冻结: 冻.挡 } : { 预算闸: 冻.错误 }),
      说明: '池序是**有序偏好**：从左到右取第一个没被冻结的池。留空 = 按全局排名（路由排名页那套分数）。',
    });
  }
  if (url路径 === '/api/roster' && req.method === 'POST') {
    return 收体(req, 16 * 1024, (体) => {
      const r = 编制.应用(配置, 体 && (体.改动 || 体.changes));
      if (!r.ok) return 发JSON(res, 400, { ok: false, error: r.错误 });
      const 理由 = String((体 && 体.理由) || '').trim();
      // 理由必填。改「谁干什么活」是会影响钱和产出的决定，三个月后回头看
      // 「为什么 reviewer 挂在 codex 上」，没有理由就只能靠猜。
      if (!理由) return 发JSON(res, 400, { ok: false, error: '理由必填——这条改动会影响派给谁、花谁的额度' });
      if (!r.生效.length) return 发JSON(res, 200, { ok: true, 生效: [], 说明: '没有实际变化' });
      const 落 = 编制落盘(r.routing);
      if (!落.ok) return 发JSON(res, 500, { ok: false, error: 落.错误 });
      配置.routing = r.routing;                 // 本进程当场生效，不用重启
      return 发JSON(res, 200, {
        ok: true, 生效: r.生效, 配置文件: 落.文件,
        说明: '执行器与本进程都现读 routing——改完立刻生效，不用重启。',
      });
    });
  }

  // ——— 项目（协-007）：项目是一等公民，不是工单上的一个字符串 ———
  // 注册表一直都在（config/项目.local.json），但界面上项目不存在：看板混着列、
  // 消耗不分项目、登记只能手改 JSON、项目名写错要等到真跑那一刻才炸。
  // ——— 工作区回收（协-017）———
  //
  // 遗留工作区这套（协-009）写完之后**一个界面调用方都没有**，而且它的路径闸只放行
  // 仓根之内，登记的项目全在仓外——接上按钮也够不着。于是垃圾只能在磁盘上攒着：
  // 实测 workspaces/ 下堆着三个目录，靶仓里五条 platform/* 分支收不掉，谁也看不见。
  //
  // 这条端点做两件工作区服务做不了的事：**读工单库**（那不是它的能力面），
  // 以及把「哪些单还在办」这份判断喂给它。回收本身仍由它执行。
  if (url路径 === '/api/reclaim' && req.method === 'GET') {
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    const 项目名 = String(请求URL.searchParams.get('项目') || '').trim();
    if (!项目名) return 发JSON(res, 400, { ok: false, error: '需要 项目 参数' });
    // 只递工单表里判得上的那几个字段。整份 fm 递过去既没必要，也会把
    // 工单正文里的东西送进另一个进程的日志里。
    const 工单表 = 工单库.list(工单根.根).map((t) => ({
      id: t.id, state: t.state, fm: { 待集成: (t.fm && t.fm.待集成) || undefined },
    }));
    return 转发工作区(res, '/遗留', 'POST', { 项目: 项目名, 工单: 工单表 });
  }
  if (url路径 === '/api/reclaim' && req.method === 'POST') {
    return 收体(req, 16 * 1024, (体) => {
      if (!体 || !体.项目) return 发JSON(res, 400, { ok: false, error: '需要 项目' });
      if (!体.路径 && !体.分支) return 发JSON(res, 400, { ok: false, error: '需要 路径 或 分支' });
      // 收工用的是 `git worktree remove`（不带 --force）+ `git branch -d`（小写）：
      // 有未提交改动的目录摘不掉，没合并的分支删不掉。这两道是 git 自己的闸，
      // 比我们在这儿判可靠——**那些提交可能是这台机器上唯一的一份**。
      return 转发工作区(res, '/write/收工', 'POST', {
        项目: 体.项目, 工作区: { path: 体.路径 || '', branch: 体.分支 || '' }, 分支: 体.分支 || '',
      });
    });
  }

  if (url路径 === '/api/projects' && req.method === 'GET') {
    return 发JSON(res, 200, {
      ok: true,
      默认: 项目.默认项目(配置),
      项目: 项目.列(配置),
      说明: '「就绪」只表示路径在、是 git 仓——本进程不引 child_process，'
        + '查不了分支与未提交改动，那是工作区服务(:4371)的能力面',
    });
  }
  // 注销：只删注册表里的一行，不动那个仓。与 POST 同一个路径、不同方法——
  // 「登记 / 改 / 注销」是同一样东西的三种写法，不该散成三条路径。
  if (url路径 === '/api/setup/project' && req.method === 'DELETE') {
    const r = 项目.注销(仓根, 请求URL.searchParams.get('名') || 请求URL.searchParams.get('name'));
    if (!r.ok) return 发JSON(res, 400, { ok: false, error: r.错误 });
    // 和登记那条一样要重读：本进程捧着旧表的话，注销完还能往那个仓提交，
    // 而界面上已经显示注销成功了。
    const 新配置 = 本地覆盖.应用(仓根, 读JSON(path.join(仓根, 'config', 'platform.config.json'), {})).配置;
    配置.项目 = 新配置.项目;
    return 发JSON(res, 200, { ok: true, ...r });
  }
  if (url路径 === '/api/setup/project' && req.method === 'POST') {
    return 收体(req, 8 * 1024, (体) => {
      const r = 项目.落位(仓根, 体 && (体.名 || 体.name), 体 && (体.路径 || 体.path), 体 && (体.设为默认 || 体.makeDefault));
      if (!r.ok) return 发JSON(res, 400, { ok: false, error: r.错误 });
      // 注册表进的是 配置.项目，而 配置 是开机时合并好的常量。改完不重读，
      // 本进程会一直用旧表——人在界面上登记完，下一秒建单还说「项目不在注册表里」。
      const 新配置 = 本地覆盖.应用(仓根, 读JSON(path.join(仓根, 'config', 'platform.config.json'), {})).配置;
      配置.项目 = 新配置.项目;
      return 发JSON(res, 200, {
        ok: true, 名: r.名, 路径: r.路径, 配置文件: r.文件, 覆盖: r.覆盖, 默认: r.默认,
      });
    });
  }

  // ——— 流程（协-006）：现在卡在哪、接下来能干什么 ———
  // 看板答不了这个。一张单不动，可能是等上游、可能上游根本不存在、也可能它早就绪了
  // 只是没人点——三种在列表里长得一模一样，都只是「待投」。
  if (url路径 === '/api/flow' && req.method === 'GET') {
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    try {
      // list 只带 fm 摘要，依赖字段就在 fm 里，够用；不必逐张 find 读正文。
      const 全 = 工单库.list(工单根.根);
      const 项目筛 = 查询.get('项目') || 查询.get('project') || '';
      // ⚠ 依赖要在**全库**里查，筛选只决定铺哪些出来。
      // 先筛后铺的话，一张单依赖的上游若属于别的项目，会被算成「依赖缺失——
      // 永远不会就绪」，而它其实好好的。跨项目依赖不常见，但错的那次代价是
      // 让人去删一条完全正常的依赖。
      const 视图 = 流程视图.铺(全, { 转移表: 工单库.TRANSITIONS, 只看项目: 项目筛 });
      return 发JSON(res, 200, { ok: true, 根目录: 工单根.根, ...(项目筛 ? { 项目筛 } : {}), ...视图 });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 知识库（协-006）：把散在磁盘上的规矩搬进界面 ———
  // 只读。不给编辑入口是有意的：这些文件多数入库，改它们该走 PR 与评审，
  // 而不是在网页上点两下——那等于给「绕过评审改规矩」开一条路。
  if (url路径 === '/api/knowledge' && req.method === 'GET') {
    const 区 = 查询.get('区');
    if (!区) return 发JSON(res, 200, { ok: true, 分区: 知识库.分区() });
    const r = 知识库.列区(仓根, 区);
    return 发JSON(res, r.ok ? 200 : 400, r.ok ? r : { ok: false, error: r.错误 });
  }
  if (url路径 === '/api/knowledge/file' && req.method === 'GET') {
    const r = 知识库.读(仓根, 查询.get('区'), 查询.get('rel'));
    return 发JSON(res, r.ok ? 200 : (r.码 || 400), r.ok ? r : { ok: false, error: r.错误 });
  }

  // ——— 工单树（协-005）：把 plan.materialize 生成的 DAG 显出来 ———
  // 父子关系与依赖一直写在 fm 里，但看板是平的——DAG 存在却看不见，
  // 等于每次都要人肉在几十张单里拼出结构。
  if (url路径 === '/api/tickets-tree' && req.method === 'GET') {
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    try {
      const 全 = 工单库.list(工单根.根).map((t) => {
        const d = 工单库.find(工单根.根, t.id);
        const fm = (d && d.fm) || {};
        const 依 = fm.依赖;
        return {
          id: t.id, 状态: t.state, 角色: fm.role || fm.职能 || '', 标题: fm.title || '',
          父单: fm.父单 || null, 项目: fm.项目 || '', 执行池: fm.执行池 || '',
          依赖: Array.isArray(依) ? 依 : (依 ? [依] : []),
          质检结论: fm.质检结论 || null,
        };
      });
      const 子 = {};
      for (const t of 全) if (t.父单) (子[t.父单] = 子[t.父单] || []).push(t.id);
      return 发JSON(res, 200, {
        ok: true, 条数: 全.length, 工单: 全,
        根单: 全.filter((t) => !t.父单).map((t) => t.id),
        子表: 子,
      });
    } catch (e) { return 发JSON(res, 500, { ok: false, error: e.message }); }
  }

  // ——— 执行链：转发给执行器进程，本文件绝不自己拉起 AI CLI ———
  // 与 /api/workspace 同一套路：能起进程的能力住独立进程，这里只用 http。
  // 两个隔离进程各管一种能力（git / AI CLI），可以单独关掉其中任意一个。
  if (url路径.startsWith('/api/exec/')) {
    const 尾 = url路径.slice('/api/exec'.length);
    const 代理 = http.request({
      host: '127.0.0.1', port: 执行器端口, method: req.method,
      path: 尾 + (请求URL.search || ''),
      headers: { Authorization: `Bearer ${令牌}`, 'Content-Type': 'application/json' },
    }, (上游) => {
      let s = '';
      上游.on('data', (d) => s += d);
      上游.on('end', () => {
        try { return 发JSON(res, 上游.statusCode, JSON.parse(s)); }
        catch { return 发JSON(res, 502, { ok: false, error: '执行器返回了非 JSON 内容' }); }
      });
    });
    代理.on('error', () => 发JSON(res, 503, {
      ok: false,
      error: `执行器未在 127.0.0.1:${执行器端口} 应答。它默认不随本服务启动——`
        + '手动拉起：npm run executor。它是唯一被允许拉起 AI CLI 的地方，本服务自己不碰 child_process。',
    }));
    req.pipe(代理);
    return;
  }

  // ——— 工作区：转发给隔离进程，本文件绝不自己起 git ———
  // worktree.js 引 child_process，**读 git 状态也要 spawn**（rev-parse/diff 一样起进程），
  // 所以「只接只读函数」绕不开那条保证。唯一出路是进程隔离：git 能力全住
  // scripts/工作区服务.js，这里只用 http 转发。于是 server.js 的依赖闭包依旧干净，
  // 那条传递闭包断言一个字都不用改。
  if (url路径.startsWith('/api/workspace/')) {
    const 尾 = url路径.slice('/api/workspace'.length);
    const 代理 = http.request({
      host: '127.0.0.1', port: 工作区端口, method: req.method,
      path: 尾 + (请求URL.search || ''),
      headers: { Authorization: `Bearer ${令牌}`, 'Content-Type': 'application/json' },
    }, (上游) => {
      let s = '';
      上游.on('data', (d) => s += d);
      上游.on('end', () => {
        try { return 发JSON(res, 上游.statusCode, JSON.parse(s)); }
        catch { return 发JSON(res, 502, { ok: false, error: '工作区服务返回了非 JSON 内容' }); }
      });
    });
    代理.on('error', () => 发JSON(res, 503, {
      ok: false,
      error: `工作区服务未在 127.0.0.1:${工作区端口} 应答。它默认不随本服务启动——`
        + '手动拉起：npm run workspace。它是唯一被允许起 git 进程的地方，本服务自己不碰 child_process。',
    }));
    // 必须把请求体转发过去。原先这里是裸的 代理.end()——**请求体被整个丢掉**，
    // 于是经 server 调任何 /write/* 都收到空 body，报「项目(空)不在注册表里」。
    // 之前没暴露是因为执行器直连 4371 绕过了 server，这条路径压根没人走过。
    // /api/exec/* 那条一直是对的（req.pipe），两条不一致才是根源。
    req.pipe(代理);
    return;
  }

  if (url路径.startsWith('/api/')) return 发JSON(res, 404, { ok: false, error: '未知 API：' + url路径 });
  return 发静态(res, url路径);
});

服务.listen(端口, '127.0.0.1', () => {
  process.stdout.write(`[${平台名}] v${版本} 开机 → http://127.0.0.1:${端口}  （桩模式，零真实 CLI 调用）\n`);
  process.stdout.write(`[${平台名}] 门禁：${令牌新建 ? '已生成新令牌' : '沿用既有令牌'} → ${令牌路径}`
    + `（浏览器打开首页无需手工填；curl 需带 Authorization: Bearer <令牌>；`
    + `/api/health 免令牌，供瞭望塔心跳探测）\n`);
  if (registry错误) process.stderr.write(`[${平台名}] 警告：${registry错误}\n`);
  // 播了模板要说出来——不说的话，那排文件对用户是不存在的（协-036）。
  // 打包态用户没有 README 在手边，这行日志就是他知道「去哪儿改配置」的唯一入口。
  if (播种结果 && 播种结果.播 && 播种结果.播.length) {
    process.stdout.write(`[${平台名}] 已把 ${播种结果.播.length} 个配置模板放到 ${播种结果.目录}`
      + `（把 xxx.local.json.示例 去掉「.示例」即生效，里面写了每个字段干什么）\n`);
  }
  if (播种结果 && 播种结果.错) process.stderr.write(`[${平台名}] 配置模板没播成：${播种结果.错}\n`);

  // 开机自检进呼叫信箱（协-019）。无人值守时**没有人会去点自检页**——
  // 配置坏了的表现是「界面开着、看板空着」，而那跟「今天没建单」长得一模一样。
  // 只报致命项：一台故意只跑干跑的机器不该每次开机都往信箱里塞一条。
  try {
    const 呼叫 = require('./lib/呼叫');
    const 结 = 自检.结论(自检.查(仓根, 配置, 工单根));
    if (结.级别 === '未就绪') {
      呼叫.急(账本根, '开机未就绪', `${平台名} v${版本} 起来了，但${结.一句话}`, { 静默秒: 3600 });
    }
    if (registry错误) 呼叫.急(账本根, '公用件失效', `providers 注册表加载失败：${registry错误}`, { 静默秒: 3600 });
  } catch (e) { process.stderr.write(`[${平台名}] 开机自检写信箱失败：${e.message}\n`); }
});

// 优雅停机（协-019）：先停接新请求，再放已建立的连接走完。
// 直接 process.exit 的话，正在传输的响应会断在半路——调用方看到的是
// 「连接被重置」，跟服务从来没起过长得一样。
let 停机中 = false;
function 停机(信号) {
  if (停机中) return;
  停机中 = true;
  process.stdout.write(`[${平台名}] 收到 ${信号}，停止接新请求…\n`);
  服务.close(() => process.exit(0));
  // 兜底：有长连接赖着不走时也得走。3 秒足够放走正常请求。
  setTimeout(() => process.exit(0), 3000).unref();
}
for (const 信号 of ['SIGINT', 'SIGTERM']) process.on(信号, () => 停机(信号));
// IPC：Windows 上信号是无条件终止，handler 收不到。监工收摊时走这条请我们自己收工。
process.on('message', (m) => { if (m && m.停机) 停机(`IPC:${m.停机}`); });
