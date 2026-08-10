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
const STATES = ['草稿', '待投', '在途', '完成'];
const TERMINAL = ['完成'];
const TRANSITIONS = {
  草稿: ['待投'],          // 定稿投出
  待投: ['在途'],          // 派发
  在途: ['完成', '待投'],  // 交付；退回重投
  完成: [],
};

// ——————————————————————————————————————————————————————————
// 根目录（协-001 决定 2：工单落业务私仓）
// ——————————————————————————————————————————————————————————
// 工单是业务数据不是产品代码，按总说明书第一章的切分判据归私仓，公开仓里只有机器。
// **缺配置时不猜、不兜底、不建默认目录**——猜一个路径然后往里写业务数据，
// 是比报错严重得多的事：等你发现写错地方，数据已经散在两处了。
const 配置文件 = (平台根) => path.join(平台根, 'config', '工单库.local.json');

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
  解析根目录, 配置文件, 校验编号, 建目录, 状态目录, 工单路径, 解析, 序列化,
  find, list, create, move, update,
};
