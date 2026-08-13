// 执行器 —— 唯一被允许拉起 AI CLI 的地方（协-002）。
//
// 为什么又是一个独立进程（不复用工作区服务）：
//   工作区服务的能力面是 **git**；本进程的能力面是 **拉起任意 AI CLI**。
//   风险量级不同。混在一个进程里，将来想单独关掉其中一个就办不到了。
//   server.js 依旧只用 http 转发，那条传递闭包断言第三次不需要例外。
//
// 四重真跑前置，缺一即拒：
//   ① 请求体显式 {"干跑": false}          防手滑
//   ② 配置 执行.允许真跑 = true            防「服务起来了就跑得动」
//   ③ 该池在 预算.池 里配了上限            订阅池守**订阅窗口**，API 池守钱包
//   ④ 落到 API 计费须显式 同意计费         协-008：防「在你不知情时开始计费」
// 四条各自独立，不互相替代。
//
// ⚠ ③ 的说法在协-008 改过：**跑一次不等于花一次钱**。走 Claude Pro / Codex Plus
// 这类订阅额度时月费已经付了，边际成本是零，那道闸守的是「别把订阅窗口一口气烧完」
// 而不是钱包。真正对着钱包的只有 ④。见 lib/计费.js。
//
// 2026-08-12 起随 npm start 一并起（scripts/开机.js 带的）。单起：npm run executor
// 进程活着不等于会跑活——上面四闸照旧。不想让它活着：PLATFORM_NO_EXECUTOR=1 npm start
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const 平台根 = path.resolve(__dirname, '..');
const 门禁 = require(path.join(平台根, 'lib', '门禁.js'));
const 公用件 = require(path.join(平台根, 'lib', '公用件.js'));
const 加固 = require(path.join(平台根, 'lib', '执行加固.js'));
const 派单 = require(path.join(平台根, 'lib', '派单.js'));
const 工单库 = require(path.join(平台根, 'lib', '工单库.js'));
const 路由历史 = require(path.join(平台根, 'lib', 'routing', 'history.js'));
const 调度 = require(path.join(平台根, 'lib', '调度.js'));
const 巡检 = require(path.join(平台根, 'lib', '巡检.js'));
const 质检 = require(path.join(平台根, 'lib', '质检.js'));
const 输出提取 = require(path.join(平台根, 'lib', '输出提取.js'));
const 计划 = require(path.join(平台根, 'lib', 'orchestration', 'plan.js'));
const 编排提示 = require(path.join(平台根, 'lib', '编排提示.js'));
const 提示装配 = require(path.join(平台根, 'lib', '提示装配.js'));
const 计费 = require(path.join(平台根, 'lib', '计费.js'));

function 读JSON(p, 缺省) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return 缺省; }
}
const 本地覆盖 = require(path.join(平台根, 'lib', '本地覆盖.js'));
// 危险开关（允许真跑 / 预算上限）只能从 config/*.local.json 打开——那些文件不入库。
// 入库的 platform.config.json 永远是最严默认，本机放宽是本机的事。
const { 配置, 生效的覆盖 } = 本地覆盖.应用(平台根, 读JSON(path.join(平台根, 'config', 'platform.config.json'), {}));
const 端口 = Number(process.env.EXECUTOR_PORT || (配置.执行 && 配置.执行.port) || 4372);
const 允许真跑 = (配置.执行 && 配置.执行.允许真跑) === true;
const 上限毫秒 = Number((配置.执行 && 配置.执行.超时毫秒) || 900000);
const 静默毫秒 = Number((配置.执行 && 配置.执行.静默毫秒) || 120000);
const { 令牌 } = 门禁.取令牌(平台根);
// 每次用的时候现解，不在开机时定死。
//
// 定死会出这个事（打包件冒烟时实测）：人在界面上把工单库配好了，server 那边当场生效，
// 但**执行器是另一个进程**，它启动时拿到的还是「未配置」，于是点干跑照样报未配置。
// 从人的角度看就是「明明配好了，它说没配」——最没头绪的一类问题，
// 因为界面上每一处都显示配好了。
//
// 代价只是每次请求读一个几十字节的 JSON。为省这个而让配置改不动，不划算。
const 取工单根 = () => 工单库.解析根目录(平台根);

// 编制（协-015）同理现读：界面上改完「哪个角色归哪个模型」，这个进程还捧着开机那份的话，
// 派活仍按旧编制走——而界面上每一处都显示改成功了。同一类问题在工单根、项目注册表上
// 各踩过一次，不第三次。
//
// 只重读 routing 一段，其余照旧开机定死：那些是这个进程的形状（端口、允许真跑），
// 中途换掉只会让「我现在到底跑在什么设置下」说不清。
function 现配置() {
  try {
    const c = 本地覆盖.应用(平台根, 读JSON(path.join(平台根, 'config', 'platform.config.json'), {})).配置;
    return { ...配置, routing: c.routing };
  } catch { return 配置; }
}

let registry = null;
try { registry = 公用件.载入('providers', 'registry.js'); } catch { /* 下面报 */ }

function 发JSON(res, 码, 体) {
  const 文 = JSON.stringify(体, null, 1);
  res.writeHead(码, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(文) });
  res.end(文);
}

// ——————————————————————————————————————————————————————————
// 真跑四闸
// ——————————————————————————————————————————————————————————
// 订阅耗尽的记账。**只活在本进程内存里**，不落盘：
// 订阅窗口会自己恢复（各家都是滚动窗口），落盘的话重启后还捧着一份过期的「已耗尽」，
// 比不记更糟——人会以为额度还没回来。重启即清空，代价只是可能多试一次。
const 耗尽记录 = {};                                   // { 池: { 时刻, 命中, 出处 } }

function 真跑许可(池, { 同意计费 } = {}) {
  if (!允许真跑) {
    return { 准: false, 码: 403, 错: '真跑未启用：config/platform.config.json 需写 执行.允许真跑 = true。'
      + '这道闸独立于请求体的「干跑」参数——防的是「服务起来了就跑得动」。' };
  }
  const 状 = 计费.说明(配置, 池, { 订阅已耗尽: !!耗尽记录[池] });
  const 上限 = ((配置.预算 && 配置.预算.池) || {})[池];
  if (!上限 || !Object.keys(上限).length) {
    // 同一个机制，两种诚实的说法。订阅池的上限守的**不是钱包，是订阅窗口**——
    // 把额度一口气烧完，接下来几小时什么都跑不了，这跟花超了是两回事。
    return {
      准: false, 码: 403,
      错: 计费.模式(配置, 池) === 计费.订阅
        ? `池「${池}」没配用量上限（预算.池.${池}）。走的是${计费.订阅名(配置, 池) || '订阅'}额度，`
          + '这道闸守的不是钱包，是**订阅窗口**：一口气烧完，接下来几小时什么都跑不了。'
        : `池「${池}」没配花费上限（预算.池.${池}）。按 token 计费，没有刹车不许上路——`
          + '这道闸独立于总开关：开了总开关也不代表每个池都有上限。',
    };
  }

  // 第四闸（协-008）：**落到 API 计费必须显式同意**。
  //
  // 这是整套闸门里唯一真正对着钱包的一道。前三道守的是「别乱跑」，
  // 而这一道守的是「别在你不知情的时候开始计费」。
  // 订阅额度耗尽之后再跑，CLI 可能自己切到按 token 计费——平台看不见那次切换，
  // 人也不会收到任何提示，直到账单出来。所以在这里停下来问。
  if (计费.模式(配置, 池) === 计费.订阅 && 耗尽记录[池]) {
    const 策 = 计费.耗尽后(配置, 池);
    if (策 === '停') {
      return { 准: false, 码: 429, 错: `${状.说} 配置 计费.${池}.耗尽后 = 停，本轮不跑。等额度恢复后重启执行器清掉这个标记。`, 计费状态: 状 };
    }
    if (策 === '问' && !同意计费) {
      return {
        准: false, 码: 402,                            // 402 Payment Required：语义正好
        错: `${状.说}\n继续跑要落到 **API 按 token 计费**，这才是真的产生新开销。`
          + `\n确认要花这笔钱：请求体加 {"同意计费": true}（界面上会弹确认）。`
          + `\n不想花：等订阅窗口恢复，或把 计费.${池}.耗尽后 设成「停」。`,
        需同意计费: true, 计费状态: 状, 耗尽于: 耗尽记录[池].时刻,
      };
    }
  }
  return { 准: true, 计费状态: 状 };
}

// ——————————————————————————————————————————————————————————
// 工作目录：绝不在主工作区跑（施工令决定 3）
// ——————————————————————————————————————————————————————————
// 决定 3 原文：「不给『直接在主工作区跑』这个选项。主工作区全程零改动。」
// 完整的 worktree 隔离（prepare→checkpoint→publish）属协-003，本期未做。
// 但「未做隔离」不等于「可以在主工作区跑」——那是把一条已批准的安全决定悄悄降级。
// 故本期的处置是：**没有隔离目录就拒绝真跑**，而不是退回主工作区。
//
// 隔离目录来源：配置 执行.工作目录（须在仓外），或每次真跑现建一个临时目录。
// 无论哪种，落在仓根之内一律拒——那正是决定 3 要挡的事。
const 仓根 = path.resolve(平台根, '..', '..');

function 取工作目录() {
  const 配的 = String((配置.执行 && 配置.执行.工作目录) || '').trim();
  const 目标 = 配的 ? path.resolve(配的) : fs.mkdtempSync(path.join(require('os').tmpdir(), 'platform-run-'));
  const 相对 = path.relative(仓根, 目标);
  if (!相对.startsWith('..') && !path.isAbsolute(相对)) {
    return {
      ok: false,
      错: `工作目录落在仓根之内（${目标}）。施工令决定 3：不给「直接在主工作区跑」这个选项。`
        + `请把 执行.工作目录 指向仓外，或留空由本进程现建临时目录。`,
    };
  }
  if (!fs.existsSync(目标)) fs.mkdirSync(目标, { recursive: true });
  return { ok: true, 目录: 目标, 临时: !配的 };
}

// ——————————————————————————————————————————————————————————
// 提交链（协-003）：经工作区服务做 git，本进程不碰 git
// ——————————————————————————————————————————————————————————
// 为什么绕一圈 http 而不直接 require worktree：本进程的能力面是「拉起 AI CLI」，
// 工作区服务的能力面是 git。两者分开，才能单独关掉其中一个——
// 比如「允许跑 AI 但今天不许它提交」就是一个真实存在的状态。
const 工作区端口 = Number(process.env.WORKSPACE_PORT || (配置.workspace && 配置.workspace.port) || 4371);

function 工作区请求(路径, 体) {
  return new Promise((resolve) => {
    const 数据 = JSON.stringify(体 || {});
    // 路径里的中文必须编码。node 的 http.request 对未转义字符**直接抛**
    // ERR_UNESCAPED_CHARACTERS——不是返回错误，是同步抛，整个执行器进程就此挂掉。
    // `/write/审阅区`、`/write/收工` 都是中文路径，两条都会踩。
    // 在助手里统一编码，比让每个调用点自己记得靠谱（今天已经在测试里踩过一次同款）。
    const 编码路径 = String(路径).split('/').map(encodeURIComponent).join('/');
    const req = http.request({
      host: '127.0.0.1', port: 工作区端口, path: 编码路径, method: 'POST',
      headers: { Authorization: `Bearer ${令牌}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(数据) },
    }, (上游) => {
      let s = '';
      上游.on('data', (d) => s += d);
      上游.on('end', () => {
        try { resolve({ 码: 上游.statusCode, 体: JSON.parse(s) }); }
        catch { resolve({ 码: 502, 体: { ok: false, error: '工作区服务返回非 JSON' } }); }
      });
    });
    req.on('error', () => resolve({
      码: 503,
      体: { ok: false, error: `工作区服务未在 127.0.0.1:${工作区端口} 应答——提交链需要它。拉起：npm run workspace` },
    }));
    req.write(数据); req.end();
  });
}

// codex 的消耗取不到 usage（非 stream-json），必须显式呈报，闷着跑等于账目失真
function 计量提示(池) {
  return 池 === 'codex'
    ? '⚠ 本次消耗**不计入预算账**：codex 非 stream-json 输出，budget.usageOf 取不到 usage（见 packages/budget/README.md）'
    : null;
}

// ——————————————————————————————————————————————————————————
// 真实拉起（唯一 spawn 点）
// ——————————————————————————————————————————————————————————
function 拉起(调用, 提示词, 工作目录, 回调) {
  const 起时 = Date.now();
  let 输出 = ''; let 错出 = ''; let 末次输出时 = 起时; let 已杀 = false;
  const p = spawn(调用.cmd, 调用.args, { cwd: 工作目录, env: { ...process.env, ...(调用.env || {}) } });

  const 计时 = setInterval(() => {
    const 判 = 加固.软超时判定({ 现在: Date.now(), 起时, 末次输出时, 上限毫秒, 静默毫秒 });
    if (判.该杀 && !已杀) {
      已杀 = true;
      try { p.kill(); } catch { /* 已退出 */ }
      clearInterval(计时);
      回调({ 退出码: -1, 输出, 错出, 耗时毫秒: Date.now() - 起时, 验尸: 判.原因, 活尾巴: 加固.活尾巴(输出) });
    }
  }, 5000);

  p.stdout.on('data', (d) => { 输出 += d; 末次输出时 = Date.now(); });
  p.stderr.on('data', (d) => { 错出 += d; 末次输出时 = Date.now(); });
  if (调用.promptMode === 'stdin') { try { p.stdin.write(String(提示词 || '')); p.stdin.end(); } catch { /* 管道已断 */ } }

  p.on('close', (码) => {
    if (已杀) return;
    clearInterval(计时);
    回调({ 退出码: 码, 输出, 错出, 耗时毫秒: Date.now() - 起时, 验尸: null, 活尾巴: null });
  });
  p.on('error', (e) => {
    if (已杀) return;
    clearInterval(计时);
    回调({ 退出码: -2, 输出, 错出: String(e.message), 耗时毫秒: Date.now() - 起时, 验尸: `拉不起来：${e.message}`, 活尾巴: null });
  });
}

// 战绩账本根。默认平台根——必须与 server.js 里 rank/history 读的那个根**一致**，
// 否则写进 A 读的是 B，闭环从一开始就断了。环境变量只为让测试隔离，
// 不是给运行时用的（改了它就得同时改 server 侧，两边必须对齐）。
const 账本根 = process.env.PLATFORM_JOURNAL || 平台根;

// 战绩落账：路由历史的**第一个写入方**。写了它，/api/routing/rank 才第一次有真信号。
//
// 注意 dry 记录**照写但不算数**：history.summary 会把 dry 行过滤掉，
// 所以干跑再多次也不会让 rank 产生区分度——干跑是演练，不是战绩。
// 这条是有意的：如果干跑能刷出信号，那 rank 就成了「谁演练得多谁排前面」。
function 记战绩(条目) {
  // _输出 是**内部字段**：只为传给 budget.usageOf 提取 token 数，绝不能落进账本。
  // 首次真跑（2026-08-10）踩到了：一次运行往 provider-runs.jsonl 写了 84KB，
  // 其中 76468 字符是完整的 CLI 会话记录。两重问题——账本体积失控（rank 每次
  // 都要读它），以及把 agent 干活的全部过程静默持久化到磁盘。
  const { _输出, ...入账 } = 条目;
  try { 路由历史.append(账本根, 入账); } catch { /* 账写不进不该反过来打断执行 */ }
  if (条目.dry) return;                       // 干跑不进预算账——没花钱就别记账
  try {
    const budget = 公用件.载入('budget', 'budget.js');
    const u = budget.usageOf(_输出 || '');
    if (u.输入 || u.输出) budget.记(账本根, { 池: 条目.provider, 单: 条目.ticket, ...u });
  } catch { /* budget 缺位不阻断 */ }
}

function 收体(req, 上限, 完成) {
  let 体 = '';
  req.on('data', (c) => { 体 += c; if (体.length > 上限) req.destroy(); });
  req.on('end', () => { try { 完成(体 ? JSON.parse(体) : {}); } catch { 完成(null); } });
}

const 服务 = http.createServer((req, res) => {
  const 请求URL = new URL(req.url || '/', 'http://127.0.0.1');
  const 路径 = 请求URL.pathname;

  const 拒 = 门禁.校验(req, { 令牌, 端口, 路径: '/api/执行器' });
  if (拒) return 发JSON(res, 拒.码, { ok: false, error: 拒.错误 });

  // ——— 质检（协-004）：由另一个 Provider 判一次 ———
  // 独立接口而不是塞进 /run 的尾巴：质检是一次**独立的付费调用**，
  // 应该能被单独触发、单独看回执、单独失败重来。混在 /run 里，
  // 「执行成功但质检挂了」会变成一个说不清的复合结果。
  const q = 路径.match(/^\/qa\/([^/]+)$/);
  if (q && req.method === 'POST') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: 'providers 注册表加载失败' });
    const 工单根 = 取工单根();
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    const id = decodeURIComponent(q[1]);

    // async：要 await 工作区服务建审阅区（协-011）。/run 那边本来就是 async，
    // 这边一直是同步的——加 await 之前先把签名对齐，否则 node 直接语法报错。
    return 收体(req, 64 * 1024, async (体) => {
      const 干跑 = !(体 && (体.干跑 === false || 体.dry_run === false));
      const t = 工单库.find(工单根.根, id);
      if (!t) return 发JSON(res, 404, { ok: false, error: `工单不存在：${id}` });
      if (t.state !== '质检') {
        return 发JSON(res, 409, { ok: false, error: `只有「质检」态的工单可以判，当前是「${t.state}」` });
      }

      // 判官走「评审」类别：router 的 crossProviderReview 会优先挑**别家**，
      // 降低同源盲区——自己判自己是最没有价值的一种评审。
      const 派 = 派单.选派(平台根, 现配置(), { 角色: 'reviewer', 类别: '评审', 公用件, 账本根, 工单: t });
      if (!派.ok) return 发JSON(res, 409, { ok: false, ...派 });

      let 调用;
      try {
        const adapter = registry.create(配置, 派.选中);
        调用 = adapter.buildInvocation({});
        // 判官一律受限：它只该读和判，不该改任何文件。
        const 受限 = 派单.权限参数(配置, 'reviewer', 派.adapter);
        调用 = { ...调用, args: [...调用.args.filter((a) => !/^--dangerously-/.test(a)), ...(受限.参数 || [])] };
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }

      // 变更文件：**默认读工单里记着的那份**，请求体只能覆盖不能是唯一来源。
      //
      // 原先只认 体.变更文件，而没有任何调用方会传它——界面的 判() 只发 {干跑}。
      // 于是判官每次都被告知「实际改动的文件：（无文件改动）」，
      // 然后理所当然地判不过：验收标准要求改文件，而材料上写着什么都没改。
      // 首次真跑当场撞到（E2E-1 的实现已经合进 master，仍被判不过）；
      // R-1 连挂三次多半也是同一回事，我当时误判成「我自己喂错了测试数据」。
      const 变更文件 = (体 && 体.变更文件) || (t.fm && t.fm.变更文件) || [];
      // 提示词在**审阅区确定之后**再拼：它要如实告诉判官有没有代码可看。
      let 提示 = 质检.质检提示词(t, 变更文件);
      // 同源兜底要**透传到回执**。质检的价值全在「另一个模型看一遍」上，
      // 悄悄退回同一家而回执照常写「已判过」，是把这次质检的含金量偷偷降级了。
      const 共同 = {
        ok: true, 工单: id, 判官: 派.选中, 跨厂: 派.选中 !== t.fm.执行池, 调用,
        ...(派.同源兜底 ? { 同源兜底: 派.同源兜底 } : {}),
      };

      if (干跑) {
        return 发JSON(res, 200, {
          ...共同, 干跑: true, 提示词预览: 提示.slice(0, 400),
          说明: '干跑：未拉起判官，零计费。真判需 {"干跑": false} 且满足真跑四闸。',
        });
      }

      // 同意计费只对**这一次请求**有效，不落盘、不记住。
      // 记住它等于把第四闸永久打开——而那道闸的全部意义就是每次都问一遍。
      const 许 = 真跑许可(派.选中, { 同意计费: !!(体 && (体.同意计费 || 体.agreeBilling)) });
      if (!许.准) {
        return 发JSON(res, 许.码, {
          ...共同, ok: false, error: 许.错,
          ...(许.需同意计费 ? { 需同意计费: true, 计费状态: 许.计费状态, 耗尽于: 许.耗尽于 } : {}),
        });
      }

      // 判官要**看得见代码**（协-011）。
      //
      // 此前它跑在 取工作目录() 现建的空目录里，跟被评审的东西毫无关系：
      // 被告知「改了 util.js」，去读，得到 ENOENT。它的判断没错——
      // 「工作区中不存在 util.js」是它眼前的事实——错的是我们没给它代码。
      // 实测 QA-VERIFY：实现已合进 master 且功能正确，仍被判不过。
      //
      // 给一个 detached worktree 落在该单的检查点上：判官看到的正是它要判的那份代码，
      // 且是历史上那个点的样子。不直接递项目主仓路径——施工令决定 3 那条是架构保证，
      // 指望一个无头 agent 因为几个 CLI flag 就不写，是把它降级成自觉。
      let 工作目录 = null; let 审阅区 = null;
      // 项目名从工单读——**这里不是 /run 的作用域**，那边的 项目名 变量在这看不见。
      // 第一版直接引用了它，执行器一收到质检请求就 ReferenceError 整个进程崩掉，
      // 而 179 项测试一条都没红：质检的真跑路径从来没被覆盖过。
      const 项目名 = (t.fm && t.fm.项目) || '';
      const 检查点sha = (t.fm && t.fm.workspace && t.fm.workspace.commit) || t.fm.检查点;
      if (项目名 && 检查点sha) {
        const a = await 工作区请求('/write/审阅区', { 项目: 项目名, 工单: id, commit: 检查点sha });
        if (a.码 === 200 && a.体.ok) { 审阅区 = a.体; 工作目录 = a.体.路径; }
        else 审阅区 = { ok: false, 错误: (a.体 && a.体.error) || '审阅区建不起来' };
      }
      if (!工作目录) {
        // 没项目、没检查点、或审阅区建不起来 —— 退回空目录，但**必须说出来**。
        // 不说的话，判官在空目录里得出的「什么都没有」会被当成结论，
        // 而那其实只说明它没拿到材料。
        const 工作 = 取工作目录();
        if (!工作.ok) return 发JSON(res, 403, { ...共同, ok: false, error: 工作.错 });
        工作目录 = 工作.目录;
      }

      提示 = 质检.质检提示词(t, 变更文件, { 审阅区: !!(审阅区 && 审阅区.ok !== false) });

      拉起(调用, 提示, 工作目录, (r) => {
        // 先按适配器声明的格式抽出 agent 正文，再交给判定——
        // 直接拿整条 JSONL 流去解析，「阻断问题」里会塞满流事件（实测踩过）。
        const 抽 = 输出提取.抽正文(r.输出, 调用.outputFormat);
        // 订阅耗尽检测：跑挂了要分清是「活没干成」还是「额度用完了」。
        // 混为一谈的后果是产线继续往这个池派活，每次都失败一次——
        // 而真正该做的是停下来问人要不要落到计费。
        const 耗 = 计费.判耗尽(配置, 派.选中, r);
        if (耗) 耗尽记录[派.选中] = { 时刻: new Date().toISOString(), 命中: 耗.命中, 出处: 耗.出处 };
        const 判 = 质检.判定(r.退出码, 抽.正文);
        记战绩({
          provider: 派.选中, role: 'reviewer', ticket: id, kind: '质检', 项目: t.fm.项目 || '',
          ok: 判.结论 !== '判官失败', dry: false, durationMs: r.耗时毫秒,
          qualityPassed: 判.结论 === '通过', _输出: r.输出,
        });

        // 审阅区判完就收——否则每判一次多留一个 worktree，
        // 正是协-009 刚堵掉的那类泄漏，不能在这儿又开一个口。
        // 用 --force：判官理论上不写，但它是个无头 agent，真留下脏改动时
        // 不该因此卡住清理；那份快照本来就没有交付价值（detached，无分支）。
        if (审阅区 && 审阅区.ok !== false && 审阅区.路径) {
          工作区请求('/write/收工', { 项目: 项目名, 工作区: { path: 审阅区.路径 } })
            .catch(() => { /* 收不掉不该影响判定结果，遗留会被 /遗留 抓到 */ });
        }

        let 流转 = null;
        if (判.下一步) {
          const m = 工单库.move(工单根.根, id, '质检', 判.下一步, (fm) => {
            fm.质检结论 = 判.结论;
            fm.质检意见 = 判.意见;
            fm.质检时间 = new Date().toISOString();
            fm.质检判官 = 派.选中;
            if (判.下一步 === '完成') fm.完成时间 = new Date().toISOString();
          });
          流转 = m.ok ? 判.下一步 : `流转失败：${m.error}`;
        }

        return 发JSON(res, 200, {
          ...共同, 干跑: false, 结论: 判.结论, 说明: 判.说明,
          正文来源: 抽.来源, ...(抽.提取失败 ? { 提取告警: "按声明格式抽不出 agent 正文，已回退原文——格式可能变了" } : {}),
          意见: 判.意见, 工单状态: 流转 || '质检（判官失败，维持原状待重判）',
          耗时毫秒: r.耗时毫秒,
          ...(r.验尸 ? { 验尸: r.验尸, 活尾巴: r.活尾巴 } : {}),
        });
      });
    });
  }

  // ——— 调度一轮（协-004）：算出这一轮该派谁，顺带巡检 ———
  // GET 只算不派，POST 才真派。分开是因为「看看会派什么」是个高频且无害的动作，
  // 而它和「真的派出去」只差一个 HTTP 方法时，人迟早会点错。
  if (路径 === '/tick') {
    const 工单根 = 取工单根();
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    const 全部 = 工单库.list(工单根.根);
    const 待投表 = 全部.filter((t) => t.state === '待投').map((t) => 工单库.find(工单根.根, t.id)).filter(Boolean);
    // 卡死阈值复用巡检那把尺（默认 30 分钟）。两处用不同阈值的话，
    // 会出现「巡检说它超时了、调度说它正常在跑」——同一台机器对同一张单两种说法。
    const 卡死阈值 = Number((配置.巡检 && 配置.巡检.在途超时毫秒) || 30 * 60 * 1000);
    const { 在跑, 疑似卡死 } = 调度.统计在跑(全部.filter((t) => t.state === '在途'), Date.now(), 卡死阈值);
    const 冻 = 派单.冻结情况(公用件, 配置, 账本根);

    const 排 = 调度.排一轮(配置, {
      待投表, 在跑,
      依赖就绪: (单) => 派单.依赖就绪(工单库, 工单根.根, 单).ok,
      选池: (单) => {
        const p = 派单.选派(平台根, 现配置(), { 角色: (单.fm && (单.fm.role || 单.fm.职能)) || '', 公用件, 账本根 });
        return p.ok ? p.选中 : null;
      },
    });

    // 「已达并发上限」这句话字面没错，但它把真正的原因盖住了：
    // 额度是被一张卡死的单占着的。归因把两条信息接起来——原先它们隔着一个页面，
    // 巡检在这边报「在途超时」，调度在那边说「上限满了」，人得自己连线。
    const 跳过 = 调度.归因(排.跳过, 疑似卡死);

    const 告警 = 巡检.巡一轮(配置, {
      全部工单: 全部, 现在: Date.now(), 冻结: 冻.挡,
      战绩: 路由历史.read(账本根, 300),
      本轮派出: 排.派.length, 本轮跳过: 跳过,
    });

    return 发JSON(res, 200, {
      ok: true, 待投: 待投表.length, 在跑, 并发上限: (配置.执行 && 配置.执行.并发) || { 默认: 1 },
      ...(疑似卡死.length ? { 疑似卡死 } : {}),
      本轮可派: 排.派, 跳过, 告警,
      说明: 'GET /tick 只算不派。真派用 POST /run/<工单> —— 一次一张，'
        + '每张都要独立过真跑四闸。**本进程不自动连跑**，见 /health 的 自动派发 字段。',
    });
  }

  if (路径 === '/health') {
    const 工单根 = 取工单根();          // 现解：健康接口报的是**此刻**的状态，不是开机那一刻的
    return 发JSON(res, 200, {
      ok: true, 服务: '执行器', 端口, 允许真跑, 上限毫秒, 静默毫秒,
      工单库: 工单根.ok ? 工单根.根 : null,
      并发: (配置.执行 && 配置.执行.并发) || { 默认: 1 },
      // 计费状态（协-008）：界面靠它决定按钮该不该写「花钱」。
      // 走订阅额度的那一次不该被标成花钱——月费已经付了，边际成本是零，
      // 见 lib/计费.js 头部。
      计费: Object.fromEntries(Object.keys((配置.providers) || {}).map((池) => {
        const 状 = 计费.说明(配置, 池, { 订阅已耗尽: !!耗尽记录[池] });
        const 险 = 计费.落计费风险(配置, 池);
        return [池, { ...状, 模式: 计费.模式(配置, 池), 已耗尽: !!耗尽记录[池], ...(险 ? { 落计费风险: 险.说 } : {}) }];
      })),
      // 有意不做自动连跑：/tick 只**算**该派谁，真派仍要一张一张 POST /run。
      // 让一个能自己花钱的循环在后台无人值守地转，是另一个量级的授权——
      // 那要单独一张令，不该由「加了调度模块」顺带获得。
      自动派发: false,
      说明: '本进程是唯一被允许拉起 AI CLI 的地方；干跑默认开启；'
        + 'GET /tick 只算不派，不存在后台自动连跑的循环',
    });
  }

  // 派活 + 执行。干跑默认，四闸齐备才真跑。
  const m = 路径.match(/^\/run\/([^/]+)$/);
  if (m && req.method === 'POST') {
    if (!registry) return 发JSON(res, 503, { ok: false, error: 'providers 注册表加载失败' });
    const 工单根 = 取工单根();
    if (!工单根.ok) return 发JSON(res, 503, { ok: false, error: 工单根.错误 });
    const id = decodeURIComponent(m[1]);

    return 收体(req, 256 * 1024, (体) => {
      // 缺省即干跑。dry_run 是 干跑 的 ASCII 别名——PowerShell 5.1 传中文键的
      // 请求体要先 [Encoding]::UTF8.GetBytes 绕一圈，否则按 ISO-8859-1 编码，
      // 服务端解析不出来（实测踩过）。两个键都认，显式 false 才真跑。
      const 干跑值 = 体 && (体.干跑 !== undefined ? 体.干跑 : 体.dry_run);
      const 干跑 = !(干跑值 === false);
      const t = 工单库.find(工单根.根, id);
      if (!t) return 发JSON(res, 404, { ok: false, error: `工单不存在：${id}` });

      const 派 = 派单.选派(平台根, 现配置(), {
        角色: t.fm.role || t.fm.职能 || '',
        公用件, 账本根: 平台根,
      });
      if (!派.ok) return 发JSON(res, 409, { ok: false, ...派 });

      let 调用;
      try {
        const adapter = registry.create(配置, 派.选中);
        调用 = adapter.buildInvocation({ model: 体 && 体.model ? String(体.model) : undefined });
        // A3：受限角色覆盖掉适配器默认的权限绕过开关
        if (派.权限.模式 === '受限') {
          调用 = { ...调用, args: [...调用.args.filter((a) => !/^--dangerously-/.test(a)), ...派.权限.参数] };
        }
      } catch (e) { return 发JSON(res, 400, { ok: false, error: e.message }); }

      const 共同 = {
        ok: true, 工单: id, provider: 派.选中, 角色: t.fm.role || t.fm.职能 || '',
        权限: 派.权限, 降级: 派.降级, 跳过: 派.跳过, 调用,
        ...(派.预算闸 ? { 预算闸: 派.预算闸 } : {}),
      };

      if (干跑) {
        记战绩({ provider: 派.选中, role: 共同.角色, ticket: id, kind: '执行', 项目: t.fm.项目 || '', ok: true, dry: true, durationMs: 0 });
        return 发JSON(res, 200, { ...共同, 干跑: true, 说明: '干跑：全链路走完但未拉起任何进程，零计费。真跑需 {"干跑": false} 且满足另两闸。' });
      }

      // 同意计费只对**这一次请求**有效，不落盘、不记住。
      // 记住它等于把第四闸永久打开——而那道闸的全部意义就是每次都问一遍。
      const 许 = 真跑许可(派.选中, { 同意计费: !!(体 && (体.同意计费 || 体.agreeBilling)) });
      if (!许.准) {
        return 发JSON(res, 许.码, {
          ...共同, ok: false, error: 许.错,
          ...(许.需同意计费 ? { 需同意计费: true, 计费状态: 许.计费状态, 耗尽于: 许.耗尽于 } : {}),
        });
      }

      // ——— 提交链（协-003）———
      // 工单带「项目」就走完整链路：worktree 里干活 → 检查点 → 快进发布 → 完成。
      // 不带项目就退回临时目录，只跑不提交（问答类工单本来就没有产出物要合）。
      const 项目名 = String(t.fm.项目 || '').trim();
      (async () => {
        let 工作区 = null; let 工作目录 = null; let 临时 = false;

        // 依赖闸（协-004）：DAG 写在工单里就得被执行，否则子单会拿到缺半截的工作区。
        const 依 = 派单.依赖就绪(工单库, 工单根.根, t);
        if (!依.ok) return 发JSON(res, 409, { ...共同, ok: false, error: 依.error, 未完成: 依.未完成, 缺失: 依.缺失 });

        if (项目名) {
          const p = await 工作区请求('/write/prepare', {
            项目: 项目名, 工单: { id, fm: t.fm },
            // 依赖单原样递过去：worktree.integrate 从它们的 fm.workspace.commit 取检查点，
            // 把上游的产出合进本单的工作区。不递的话每张子单都从基线起步，
            // 前一张干的活对后一张不可见。
            依赖: 依.依赖单.map((d) => ({ id: d.id, fm: d.fm })),
          });
          if (p.码 !== 200 || !p.体.ok) {
            return 发JSON(res, p.码, { ...共同, ok: false, error: `建隔离工作区失败：${p.体.error}` });
          }
          工作区 = p.体.工作区;
          工作目录 = 工作区.path;
          派.工作区 = 工作区;                 // 落单时写进 fm.workspace，供后续依赖单集成
        } else {
          // 决定 3：没有隔离目录就拒绝真跑，而不是退回主工作区
          const 工作 = 取工作目录();
          if (!工作.ok) return 发JSON(res, 403, { ...共同, ok: false, error: 工作.错 });
          工作目录 = 工作.目录; 临时 = 工作.临时;
        }

        const 落 = 派单.落单(工单库, 工单根.根, id, 派);
        if (!落.ok) return 发JSON(res, 409, { ...共同, ok: false, error: 落.error });

        // orchestrator 的输出契约由平台附加，不指望工单作者去背 plan.js 的字段名。
        // 首次真跑就栽在这上面：AI 输出 {"tickets":[...]}，拆解完全正确，
        // 只因顶层键不叫 tasks 就整份作废，白烧 88 秒。
        // 先装配：工单正文 + 通用/角色协议 + 上一轮的回炉要求。
        // 角色协议出厂就在库里，此前从没有人喂给过 AI；回炉要求让重做时
        // 至少知道上次为什么没过——不然同一个坑会照踩不误，每踩一次都是真实付费。
        const 装 = (体 && 体.提示词) ? { 提示: 体.提示词, 装配记录: { 来源: '请求体覆盖' } } : 提示装配.装配(平台根, t);
        const 拼 = 编排提示.拼提示(配置, 共同.角色, 装.提示);
        拉起(调用, 拼.提示, 工作目录, async (r) => {
        // 订阅耗尽检测：跑挂了要分清是「活没干成」还是「额度用完了」。
        // 混为一谈的后果是产线继续往这个池派活，每次都失败一次——
        // 而真正该做的是停下来问人要不要落到计费。
        const 耗 = 计费.判耗尽(配置, 派.选中, r);
        if (耗) 耗尽记录[派.选中] = { 时刻: new Date().toISOString(), 命中: 耗.命中, 出处: 耗.出处 };
        const 判 = 加固.成败判定({ 退出码: r.退出码, 输出: r.输出 });
        记战绩({
          provider: 派.选中, role: 共同.角色, ticket: id, kind: '执行', 项目: t.fm.项目 || '',
          ok: 判.成, dry: false, durationMs: r.耗时毫秒, _输出: r.输出,
        });

        // 提交链只在**成功**时走。失败的活不该留下检查点——那会让「有提交」
        // 变成一个不可信的信号，事后分不清哪些提交是成品哪些是半成品。
        let 检查点 = null; let 发布 = null; let 完成 = null; let 空转 = null;
        if (判.成 && 工作区) {
          const c = await 工作区请求('/write/checkpoint', { 项目: 项目名, 工作区, 工单: { id, fm: t.fm } });
          检查点 = c.体;
          if (c.码 === 200 && c.体.ok && c.体.committed) {
            工作区.commit = c.体.commit;                       // publish 要用检查点的 sha
            const pb = await 工作区请求('/write/publish', { 项目: 项目名, 工作区 });
            发布 = pb.体;
            if (pb.码 === 200 && pb.体.ok) {
              // 干完了不等于做对了。默认送质检，由**另一个 Provider** 判一次；
              // 跳过质检必须是显式决定（配置关掉、工单 QA:关、或角色免检）。
              // 反过来会让「没配 = 没人验收」，那是最危险的默认。
              const 检 = 质检.需质检(配置, t);
              const 目标 = 检.要 ? '质检' : '完成';
              const m = 工单库.move(工单根.根, id, '在途', 目标, (fm) => {
                if (!检.要) { fm.完成时间 = new Date().toISOString(); fm.免检原因 = 检.因; }
                fm.检查点 = c.体.commit;
                fm.发布提交 = pb.体.commit;
                // 改动清单落进工单（协-009）。**质检唯一的客观材料就是这个**，
                // 而它只在检查点那一刻取得到：提交之后 diff 就空了，收工之后目录都没了。
                // 首次真跑当场撞到：判官被告知「实际改动的文件：（无文件改动）」，
                // 于是把一次成功的实现判成不过——代码明明已经合进 master 了。
                // R-1 连挂三次多半也是这个，我当时误判成「测试数据喂错了」。
                fm.变更文件 = c.体.变更文件 || [];
                // 回填 commit：下游依赖单靠 fm.workspace.commit 把本单的产出合进去。
                // 只写 fm.检查点 的话 worktree.integrate 看不见，会把本单当成
                // 「没有可集成的检查点」而 **静默跳过**——DAG 就断在这里。
                fm.workspace = Object.assign({}, fm.workspace, { commit: c.体.commit });
              });
              完成 = m.ok ? 目标 : `流转失败：${m.error}`;
              if (m.ok && 检.要) 完成 += '（待质检：POST /qa/' + id + '）';
            }
          } else if (c.码 === 200 && c.体.ok && !c.体.committed && !c.体.changed) {
            // 跑成功了，但**一个文件都没改**。
            //
            // 原先这条路什么都不做：检查点不提交 → 不发布 → 不流转，工单就这么
            // 静静留在「在途」。人看到的是一张卡住的单，而巡检迟早报
            // 「在途超时，执行器可能已挂」——**归错了因**：进程好好地跑完了。
            // 首次真跑的第二轮当场撞到（clamp 上一轮已经合进去，这轮无事可做）。
            //
            // 这是个**歧义结果**，平台判不了是哪种：活本来就已经做完了（重跑幂等），
            // 还是 agent 压根没动手。所以不替人下结论，只做两件事：
            //   ① 退回待投——「在途」的意思是「AI 正在干」，而它已经不在干了，
            //      留着只是白占一个并发额度；
            //   ② 把原因写进工单并在回执里说清，让人来判断。
            const m = 工单库.move(工单根.根, id, '在途', '待投', (fm) => {
              fm.空转 = { 时刻: new Date().toISOString(), 说: '执行成功但没有任何文件改动' };
            });
            完成 = m.ok
              ? '退回待投（空转：跑成功但没改任何文件）'
              : `空转且流转失败：${m.error}`;
            空转 = {
              是: true,
              说: '这次执行成功结束，但**一个文件都没改**。平台判不出是哪种情况：'
                + '活可能上一轮就已经做完了（重跑本来就该没改动），也可能 agent 这次没动手。'
                + '工单已退回待投并记下原因——请看一眼再决定要不要重派。',
            };
          }
        }

        // Orchestrator 的产出是**一份计划**，不是代码。跑完先把计划解析出来给人看，
        // **不自动物化**——AI 提的拆解方案没经人眼就落成一批工单，那是把「AI 只提计划、
        // 确定性内核负责校验」这条原则从中间掐断。物化是单独一个动作（/api/plan/materialize）。
        let 计划预览 = null;
        if ((共同.角色 === 'orchestrator') && 判.成) {
          try {
            const 抽 = 输出提取.抽正文(r.输出, 调用.outputFormat);
            const { plan, source } = 计划.resolvePlan(配置, 抽.正文, undefined);
            计划预览 = {
              合规: true, 来源: source, 摘要: plan.summary || '', 任务数: plan.tasks.length,
              任务: plan.tasks.map((x) => ({ key: x.key, 标题: x.title, 角色: x.role, 依赖: x.dependsOn })),
              // 原文一并带回。物化时要把它原样回填给 /api/plan/materialize——
              // 那边**自己再解析一次**，不信任这里已经解析好的结构：
              // 经过前端的东西不该成为落盘的依据。顺带，人可以在物化前手改计划。
              正文预览: String(抽.正文 || '').slice(0, 8000),
              下一步: `确认无误后物化：POST /api/plan/materialize {"输出": <正文预览原样回填>, "父单": "${id}"}`,
            };
          } catch (e) {
            // 校验不过是**正常业务结果**：AI 的拆解方案不合规，该打回重提，不是执行失败。
            //
            // 但必须把 AI 的**原话**带出来。只报「未找到合法的 JSON 计划」，人无从判断
            // 是 AI 没按格式、还是我们抽错了正文——两者的处置完全相反（改提示词 vs 改代码）。
            // 首次跑 orchestrator 就卡在这儿：回执说不合规，却看不到它到底说了什么。
            const 抽 = 输出提取.抽正文(r.输出, 调用.outputFormat);
            计划预览 = {
              合规: false, 原因: e.message,
              正文来源: 抽.来源,
              正文预览: String(抽.正文 || '').slice(0, 1200),
              说明: '拆解方案不合规，未物化任何子单——这是内核在挡，不是执行失败。'
                + '看「正文预览」判断是 AI 没按格式（改提示词）还是抽取有误（改代码）。',
            };
          }
        }

        return 发JSON(res, 200, {
          ...共同, 干跑: false, 成: 判.成,
          装配: 装.装配记录,
          ...(计划预览 ? { 计划预览 } : {}),
          ...(判.成 ? {} : { 失败原因: 判.原因 }),
          耗时毫秒: r.耗时毫秒,
          ...(r.验尸 ? { 验尸: r.验尸, 活尾巴: r.活尾巴 } : {}),
          工作目录,
          ...(临时 ? { 工作目录说明: '本次现建的临时隔离目录（仓外）——决定 3：主工作区全程零改动' } : {}),
          ...(工作区 ? { 隔离工作区: { 分支: 工作区.branch, 路径: 工作区.path } } : {}),
          ...(检查点 ? { 检查点 } : {}),
          ...(发布 ? { 发布 } : {}),
          工单状态: 完成 || '在途',
          // 空转要顶在回执里，不能只写进工单。人点完「真跑」看的是这个响应，
          // 而「成功但什么都没改」和「成功并合并了」在别的字段上长得几乎一样。
          ...(空转 ? { 空转 } : {}),
          ...(!项目名 ? { 提交链: '未走——工单没有「项目」字段，只跑不提交' } : {}),
          ...(计量提示(派.选中) ? { 计量提示: 计量提示(派.选中) } : {}),
        });
        });
      })();
    });
  }

  return 发JSON(res, 404, { ok: false, error: '未知路径：' + 路径 });
});

服务.listen(端口, '127.0.0.1', () => {
  process.stdout.write(`[执行器] 上岗 → http://127.0.0.1:${端口}\n`);
  process.stdout.write(`[执行器] 真跑：${允许真跑 ? '**总开关已开**（仍需逐池预算上限 + 请求显式关干跑）' : '关闭（默认）'}\n`);
  // 本机放宽了哪几处必须看得见：悄悄生效的安全降级比不降级更危险，人会以为还锁着
  process.stdout.write(`[执行器] ${本地覆盖.摘要(生效的覆盖)}\n`);
  const 有上限 = Object.keys((配置.预算 && 配置.预算.池) || {});
  process.stdout.write(`[执行器] 配了预算上限的池：${有上限.length ? 有上限.join('/') : '无（任何池都不许真跑）'}\n`);
});
