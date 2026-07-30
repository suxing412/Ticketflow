// stages.js — 阶段化生产（D43）：阶段字典（项目可配，默认 L0-L2）+ 阶段验收标准（明文 阶段标准.md）。
// 标准文件按 阶段×职能 分节，明文即事实源：改标准下一张单起草时立即生效，不用改代码。
const fs = require('fs');
const path = require('path');

const DEFAULT_STAGES = [
  { 代号: 'L0', 名称: '原型' },
  { 代号: 'L1', 名称: '正式化' },
  { 代号: 'L2', 名称: '打磨' },
];
const SOFTWARE_STAGES = [
  { 代号: 'PLAN', 名称: '规划与契约' },
  { 代号: 'BUILD', 名称: '实现' },
  { 代号: 'VERIFY', 名称: '评审与集成' },
];

const stdPath = (root) => path.join(root, '阶段标准.md');

// 项目阶段字典：config.项目.注册[名].阶段 可覆盖（["L0 原型", ...] 或 [{代号,名称}]），缺省走默认
function stagesFor(cfg, projName) {
  const reg = cfg && cfg.项目 && cfg.项目.注册 && cfg.项目.注册[projName];
  const raw = reg && reg.阶段;
  const globalStages = cfg && cfg.stages;
  const source = Array.isArray(raw) && raw.length ? raw : Array.isArray(globalStages) && globalStages.length ? globalStages : null;
  if (!source) return cfg && cfg.profile === 'software-project' ? SOFTWARE_STAGES : DEFAULT_STAGES;
  const out = [];
  for (const it of source) {
    if (typeof it === 'string') {
      const m = it.trim().match(/^(\S+)\s*(.*)$/);
      if (m) out.push({ 代号: m[1], 名称: m[2] || m[1] });
    } else if (it && it.代号) out.push({ 代号: String(it.代号), 名称: String(it.名称 || it.代号) });
  }
  return out.length ? out : (cfg && cfg.profile === 'software-project' ? SOFTWARE_STAGES : DEFAULT_STAGES);
}

// 解析 阶段标准.md → { L0: { 策划: '…', 程序: '…' }, … }
// 格式：## L0 原型 分节，节内 - 职能：一句话标准
function parseStandards(root) {
  let raw = '';
  try { raw = fs.readFileSync(stdPath(root), 'utf8'); } catch { return {}; }
  const out = {};
  let cur = null;
  for (const line of raw.split('\n')) {
    const h = line.match(/^##\s+(\S+)/);
    if (h) { cur = h[1]; out[cur] = out[cur] || {}; continue; }
    if (!cur) continue;
    const m = line.match(/^[-·]\s*(\S+?)\s*[：:]\s*(.+)$/);
    if (m) out[cur][m[1]] = m[2].trim();
  }
  return out;
}

// 缺文件则落一份默认模板（部署即有着落，用户直接改明文）
function ensureStandards(root, cfg) {
  if (fs.existsSync(stdPath(root))) return false;
  const software = cfg && cfg.profile === 'software-project';
  const tpl = software ? `# 阶段标准（通用软件项目）

## PLAN 规划与契约
- orchestrator：任务依赖、写入范围、接口契约和验收标准完整且无环
- backend：接口输入输出、错误码和数据约束明确
- frontend：页面状态、交互边界和 Mock 契约明确
- reviewer：评审清单与证据要求明确
- integrator：合并顺序和项目级验证命令明确

## BUILD 实现
- orchestrator：阻塞项已处理，变更计划保持可追溯
- backend：实现与测试随行，契约测试通过
- frontend：主要状态完整，前端测试通过
- reviewer：逐条给出通过/不过和证据
- integrator：仅整合已评审产出

## VERIFY 评审与集成
- orchestrator：所有子任务有终态，未解决风险已上呈
- backend：服务端与契约测试通过
- frontend：构建、交互测试和关键状态验证通过
- reviewer：使用不同 Provider 复核关键产出
- integrator：全量测试通过且无未解决冲突
` : `# 阶段标准（D43 · 明文即事实源：改这里，下一张单起草立即生效）

每节 = 一个阶段；节内每行 = 该职能在此阶段的过关口径。起草选阶段时自动带入对应职能的标准。

## L0 原型
- 策划：规则闭环、可读可评审
- 程序：功能可跑通、不崩即可，不追求数据完备
- 美术：占位资产到位，尺寸/命名符合规格
- QA：主流程可走通，无阻断级缺陷
- 装配：灰盒可进入、可体验核心循环

## L1 正式化
- 策划：数值落地、锚号齐全、边界情况写明
- 程序：数据接通、测试随行、异常处理完备
- 美术：风格达标、可入库水准
- QA：全用例过、回归无退化
- 装配：真资产组装、完整可玩

## L2 打磨
- 策划：体验节奏调优、文案终稿
- 程序：性能达标、零告警
- 美术：终稿精度
- QA：全链压测、边角场景清零
- 装配：全链无占位、发布级
`;
  fs.writeFileSync(stdPath(root), tpl, 'utf8');
  return true;
}

module.exports = { DEFAULT_STAGES, SOFTWARE_STAGES, stagesFor, parseStandards, ensureStandards, stdPath };
