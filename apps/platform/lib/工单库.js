// 工单库 —— 目录即状态机（协-001）。
//
// 只用 fs + path，**不引 child_process**：工单落盘是纯文件操作，压根不需要 git。
// 所以它住 server 进程即可，桩模式那条传递闭包断言一个字都不用改。
//
// 但它引入了一个新能力：**server 进程可以往仓库之外写文件**（工单落业务私仓）。
// 这和 git 能力是同一量级的东西，不能因为「只是写文件」就不设防。三条约束：
//   ① 根目录必须显式配置，缺配置直接拒——不猜路径、不兜底；
//   ② 路径闸：一切落盘路径收窄到根目录之内；
//   ③ 工单号字符白名单 + Windows 设备名黑名单。
// 契约测试 test/工单库契约.test.js 盯着这三条。
'use strict';

const fs = require('fs');
const path = require('path');

// ——————————————————————————————————————————————————————————
// 状态机（协-001 决定 1：先做四态）
// ——————————————————————————————————————————————————————————
// studio 那套是八态加挂起族，实战打磨出来的。但 platform 还没跑过一次真实派发，
// 照抄一套没跑过的状态机只会把复杂度提前引进来。先四态跑通，缺什么加什么。
// 表驱动：加态是改这两张表，不是改逻辑。
//
// 本期明确不做（是排期不是遗忘）：挂起族、质检与验收分离、仲裁、上呈、
// 返修同号回炉、废弃。
// 协-004 加「质检」一态。加态就是改这两张表——协-001 决定 1 承诺的表驱动兑现了，
// 状态机逻辑一行没动。
//
// 为什么加它：在途干完直接判完成，等于**没有人验收**。AI 说自己做完了就算做完，
// 这在真花钱的产线上不成立。质检是一道独立的判断，判官是另一个 Provider（跨厂评审
// 降低同源盲区，router 的 crossProviderReview 已经在做这件事）。
//
// 质检不过 → 回「待投」重做，而不是打成失败终态：同一张单可以再跑一轮。
// 协-009 加「已归档」。加态仍然只是改这两张表——表驱动第三次兑现。
//
// 为什么需要它：此前工单库**只能建不能销**。一张废掉的单（需求取消、
// 重复提、验收标准写错了不想改）除了永远躺在看板上没有别的去处；
// 真要清掉只能去磁盘上 rm 文件——绕过产品本身，账本还会留下对不上号的记录
// （实测：删掉的单，「反复回炉」告警永远消不掉，因为战绩账本是只追加的）。
//
// **归档而不是删除**是有意的：记录留着，账本对得上号，历史查得到；
// 但它不占看板、不进巡检、不算并发额度。删除是不可逆的，归档不是——
// 后悔了从 已归档 回 草稿 就行。
const STATES = ['草稿', '待投', '在途', '质检', '挂起', '完成', '已归档'];
const TERMINAL = ['已归档'];
const TRANSITIONS = {
  草稿: ['待投', '已归档'],              // 定稿投出；废弃
  待投: ['在途', '草稿', '已归档'],      // 派发；退回改；废弃
  在途: ['质检', '完成', '待投', '已归档'], // 交付送检；无需质检直接完成；退回重投；废弃
  质检: ['完成', '待投', '挂起', '已归档'], // 判过 → 完成；判不过 → 修复，超上限 → 挂起待人工
  挂起: ['待投', '已归档'],              // 人工处理后可重投，或归档
  完成: ['已归档'],                      // 完成之后只剩归档一条路——它不是垃圾桶，是收纳
  已归档: ['草稿'],                      // 后悔了能回来。归档不可逆的话，人就不敢用它，只会继续攒
};

// ——————————————————————————————————————————————————————————
// 根目录（协-001 决定 2：工单落业务私仓）
// ——————————————————————————————————————————————————————————
// 工单是业务数据不是产品代码，按总说明书第一章的切分判据归私仓，公开仓里只有机器。
// **缺配置时不猜、不兜底、不建默认目录**——猜一个路径然后往里写业务数据，
// 是比报错严重得多的事：等你发现写错地方，数据已经散在两处了。
// 走可写目录：这份配置是界面上填出来的，打包态必须落在 asar 外，否则写不进去。
const 配置文件 = (平台根) => path.join(require('./配置位置.js').可写配置目录(平台根), '工单库.local.json');

function 解析根目录(平台根) {
  const 来自环境 = String(process.env.PLATFORM_TICKETS || '').trim();
  if (来自环境) return { ok: true, 根: path.resolve(来自环境), 来源: 'PLATFORM_TICKETS 环境变量' };
  const 文件 = 配置文件(平台根);
  try {
    const 值 = String(JSON.parse(fs.readFileSync(文件, 'utf8')).根目录 || '').trim();
    if (值) return { ok: true, 根: path.resolve(值), 来源: 文件 };
  } catch { /* 不存在或坏了，落到下面报错 */ }
  return {
    ok: false,
    错误: `工单库根目录未配置。工单是业务数据，须落业务私仓，本产品不替你选位置。\n`
      + `二选一：① 写 ${文件}，内容 { "根目录": "D:\\\\你的私仓\\\\工单" }\n`
      + `        ② 设环境变量 PLATFORM_TICKETS 指向该目录\n`
      + `（该配置文件名带 .local.json，已被 .gitignore 挡住，私仓路径不会入库。）`,
  };
}

// ——————————————————————————————————————————————————————————
// 三道约束
// ——————————————————————————————————————————————————————————
// 首字符必须是字母数字，故 '..' 与 '.foo' 天然被排除；其余允许 . _ -
const 合法编号 = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Windows 保留设备名：CON.md 这种文件建不出来，且行为诡异，提前挡掉给人话错误
const 设备名 = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function 校验编号(id) {
  const s = String(id == null ? '' : id);
  if (!合法编号.test(s)) {
    return `工单编号非法：${JSON.stringify(s)}。只允许字母数字开头、其后 . _ - 与字母数字，最长 64 字符。`;
  }
  if (设备名.test(s.split('.')[0])) return `工单编号撞上 Windows 保留设备名：${s}`;
  return null;
}

// 路径闸：算出来的路径必须落在根之内。校验编号之后它其实已经进不来 ../，
// 但这一关照留——纵深防御，编号规则将来放宽时这里仍然守着。
function 收窄(根, 目标) {
  const 绝对 = path.resolve(目标);
  const 相对 = path.relative(path.resolve(根), 绝对);
  if (相对.startsWith('..') || path.isAbsolute(相对)) {
    return { ok: false, 错误: `路径越界：只允许工单库根 ${根} 之内，实得 ${绝对}` };
  }
  return { ok: true, 路径: 绝对 };
}

const 状态目录 = (根, 状态) => path.join(根, 状态);
const 工单路径 = (根, 状态, id) => path.join(状态目录(根, 状态), `${id}.md`);

function 建目录(根) {
  for (const s of STATES) fs.mkdirSync(状态目录(根, s), { recursive: true });
}

// 落位：把用户填的路径写进 工单库.local.json（协-005）。
//
// 这不违反上面「不替你选位置」的原则——**位置仍然是人给的**，本函数只负责
// 把人给的那个值收好。原则要挡的是「产品自作主张猜一个路径就往里写业务数据」，
// 不是「让人配起来必须去翻文档手搓 JSON」。后者只是难用，不是稳妥。
function 落位(平台根, 值) {
  const 原 = String(值 || '').trim();
  if (!原) return { ok: false, 错误: '没填路径。工单库根目录要指向你的业务私仓，本产品不替你选。' };
  if (!path.isAbsolute(原)) {
    return { ok: false, 错误: `请填绝对路径（实得 ${原}）。相对路径的基准是服务进程的工作目录，`
      + '换个方式启动就指向别处了——业务数据不能挂在这么飘的东西上。' };
  }
  const 根 = path.resolve(原);
  // 挡住「装进应用自己目录里」。这是真踩过的坑：打包成 portable 时，exe 每次运行
  // 都解到一个新的临时目录，写进去的工单下次启动就找不着了——而且不会报错，
  // 只会显示成一个空看板，像是数据凭空蒸发。
  const 相对 = path.relative(path.resolve(平台根), 根);
  if (!相对.startsWith('..') && !path.isAbsolute(相对)) {
    return { ok: false, 错误: `不能放在产品自己的目录里（${根}）。工单是业务数据：`
      + '放这儿会被升级或重装抹掉，打包成 portable 运行时更是每次都换临时目录，'
      + '工单下次启动就消失且不报错。请指向你的业务私仓。' };
  }
  try {
    建目录(根);
  } catch (e) {
    return { ok: false, 错误: `建不出目录 ${根}：${e.message}` };
  }
  const 文件 = 配置文件(平台根);
  fs.mkdirSync(path.dirname(文件), { recursive: true });
  const 旧 = (() => { try { return String(JSON.parse(fs.readFileSync(文件, 'utf8')).根目录 || ''); } catch { return ''; } })();
  fs.writeFileSync(文件, JSON.stringify({ 根目录: 根 }, null, 2) + '\n', 'utf8');
  return {
    ok: true, 根, 文件,
    换根: !!(旧 && path.resolve(旧) !== 根),
    旧根: 旧 || null,
    // 环境变量优先级更高。人在界面上配了却不生效，是最让人抓狂的一种「没反应」，
    // 所以这里主动把它顶出来讲明白。
    被环境变量盖住: !!String(process.env.PLATFORM_TICKETS || '').trim(),
  };
}

// ——————————————————————————————————————————————————————————
// 序列化：JSON frontmatter
// ——————————————————————————————————————————————————————————
// 为什么不是 YAML：studio 用 gray-matter，而本产品运行时零第三方依赖（既定口径），
// 引不进来。自己手搓 YAML 又是明摆着的坑——plan.js 往 fm 里写的 routing、计划生成
// 都是**嵌套对象**，还有数组，手写解析器处理嵌套/转义/多行是经典的静默出错来源，
// 而这里存的是业务数据，错了不一定当场发现。
//
// JSON 用内置 JSON.parse/stringify，往返精确、不可能歧义。代价是格式与 studio 不同；
// 但真到抽 packages/core 那天，写一个格式转换器是**小而明确**的活，
// 远小于「手搓 YAML 静默损坏嵌套字段」的风险。这个取舍是有意的。
const 分隔 = '---';

function 序列化(fm, 正文) {
  const 净 = {};
  // 剔 undefined：JSON.stringify 会把它整个吃掉，留着只会让字段悄无声息地消失
  for (const [k, v] of Object.entries(fm || {})) if (v !== undefined) 净[k] = v;
  return `${分隔}\n${JSON.stringify(净, null, 2)}\n${分隔}\n\n${String(正文 || '')}`;
}

function 解析(文件) {
  const 原文 = fs.readFileSync(文件, 'utf8');
  const m = 原文.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, 正文: 原文, 原文, 坏帧: true };
  let fm = {};
  let 坏帧 = false;
  try { fm = JSON.parse(m[1]); } catch { 坏帧 = true; }
  return { fm, 正文: (m[2] || '').replace(/^\r?\n/, ''), 原文, 坏帧 };
}

// ——————————————————————————————————————————————————————————
// 四个方法：签名对齐 plan.js 的调用点（硬约束，不是设计自由度）
// ——————————————————————————————————————————————————————————

// 扫全部状态目录定位一张单。返回 { id, state, file, fm, body } 或 null。
// 注：返回字段用英文键（state/file/fm/body），因为 plan.js 读的是 existing.state、
// existing.fm——那是既有契约，不能按本仓的中文习惯改。
function find(根, id) {
  if (校验编号(id)) return null;
  for (const state of STATES) {
    const file = 工单路径(根, state, id);
    const 闸 = 收窄(根, file);
    if (!闸.ok) return null;
    if (fs.existsSync(file)) {
      const { fm, 正文 } = 解析(file);
      return { id, state, file, fm, body: 正文 };
    }
  }
  return null;
}

function list(根, 状态) {
  const 结果 = [];
  for (const state of STATES) {
    if (状态 && state !== 状态) continue;
    let 项 = [];
    try { 项 = fs.readdirSync(状态目录(根, state)); } catch { continue; }
    for (const 名 of 项) {
      if (!名.endsWith('.md')) continue;
      const id = 名.slice(0, -3);
      const { fm } = 解析(工单路径(根, state, id));
      结果.push({ id, state, fm });
    }
  }
  return 结果;
}

function create(根, id, fm, 正文) {
  const 坏 = 校验编号(id);
  if (坏) return { ok: false, error: 坏 };
  if (find(根, id)) return { ok: false, error: `编号已存在：${id}` };
  const 目标 = 工单路径(根, '草稿', id);
  const 闸 = 收窄(根, 目标);
  if (!闸.ok) return { ok: false, error: 闸.错误 };
  fs.mkdirSync(状态目录(根, '草稿'), { recursive: true });
  fs.writeFileSync(闸.路径, 序列化(fm, 正文), 'utf8');
  return { ok: true, id, state: '草稿', file: 闸.路径 };
}

function isLegal(from, to) {
  return Boolean(TRANSITIONS[from] && TRANSITIONS[from].includes(to));
}

function move(根, id, from, to, mutator) {
  const 坏 = 校验编号(id);
  if (坏) return { ok: false, error: 坏 };
  if (!STATES.includes(to)) return { ok: false, error: `非法目标状态：${to}（合法：${STATES.join('/')}）` };
  if (!isLegal(from, to)) {
    return { ok: false, error: `不合法的转移：${from} → ${to}。${from} 的合法去向：${(TRANSITIONS[from] || []).join('/') || '无（终态）'}` };
  }
  const 源 = 收窄(根, 工单路径(根, from, id));
  const 的 = 收窄(根, 工单路径(根, to, id));
  if (!源.ok) return { ok: false, error: 源.错误 };
  if (!的.ok) return { ok: false, error: 的.错误 };
  if (!fs.existsSync(源.路径)) return { ok: false, error: `源不存在：${from}/${id}（已被移走或状态不符）` };
  if (fs.existsSync(的.路径)) return { ok: false, error: `目标已存在同名单：${to}/${id}` };

  const { fm, 正文 } = 解析(源.路径);
  const 新fm = { ...fm, 更新时间: new Date().toISOString() };
  if (typeof mutator === 'function') mutator(新fm);
  fs.mkdirSync(状态目录(根, to), { recursive: true });
  fs.writeFileSync(源.路径, 序列化(新fm, 正文), 'utf8');
  fs.renameSync(源.路径, 的.路径);   // 同盘改名，原子
  return { ok: true, id, from, to, file: 的.路径 };
}

// mutator(fm, 工单) 可改 frontmatter，返回 { body } 则一并换正文。
function update(根, id, mutator) {
  const t = find(根, id);
  if (!t) return { ok: false, error: `工单不存在：${id}` };
  const fm = { ...t.fm, 更新时间: new Date().toISOString() };
  let 正文 = t.body;
  const r = typeof mutator === 'function' ? mutator(fm, t) : null;
  if (r && typeof r.body === 'string') 正文 = r.body;
  fs.writeFileSync(t.file, 序列化(fm, 正文), 'utf8');
  return { ok: true, id, state: t.state, file: t.file };
}

module.exports = {
  STATES, TERMINAL, TRANSITIONS, isLegal,
  解析根目录, 落位, 配置文件, 校验编号, 建目录, 状态目录, 工单路径, 解析, 序列化,
  find, list, create, move, update,
};
