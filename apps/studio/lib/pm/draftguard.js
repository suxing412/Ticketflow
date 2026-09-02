// draftguard.js — 起草落盘前的纯函数校验闸（TF-15）
//
// 本模块不读盘、不写盘、不 spawn。起草链只在 store.create 前调用 查草稿，
// 所有判据从参数取得，便于离线复核与测试。
const 项目落点 = require('./项目落点');

const 默认 = {
  必备章: ['背景', '执行内容', '验收标准'],
  悬尾标点: ['：', ':', '—', '－', '、', '，', ',', '；'],
  验收方式合法值: ['委托', '保留'],
  散单声明: ['独立杂务', '确无归属', '散单'],
};

// 形制与 precheck.js 一致：配置坏一格只回落这一格，绝不让闸的行为漂移。
function 参数(cfg) {
  const c = ((cfg || {}).draftguard) || {};
  const 数 = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const 表 = (v, d) => (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') ? v.slice() : d.slice());
  const 真假 = (v, d) => (typeof v === 'boolean' ? v : d);
  // 本闸当前只有表形参数；保留三校验器的同构入口，避免以后新增数值/开关时另起一套回落纪律。
  void 数; void 真假;
  return {
    必备章: 表(c.必备章, 默认.必备章),
    悬尾标点: 表(c.悬尾标点, 默认.悬尾标点),
    验收方式合法值: 表(c.验收方式合法值, 默认.验收方式合法值),
    散单声明: 表(c.散单声明, 默认.散单声明),
  };
}

function 正则转义(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function 有值(v) { return v !== undefined && v !== null && String(v).trim() !== ''; }

function 有章(body, 章名) {
  // 只认 ##、### 或独占一行的裸标题，正文提到同名词不能蒙混过关。
  return new RegExp(`^\\s*(?:(?:##|###)\\s*)?${正则转义(章名)}\\s*$`, 'm').test(String(body || ''));
}

function 正文悬尾(body, 悬尾标点) {
  const text = String(body || '').trim();
  if (!text) return false;
  const lines = text.replace(/\r/g, '').split('\n');
  const last = lines[lines.length - 1].trim();
  return 悬尾标点.includes(text[text.length - 1])
    || /^#{2,3}\s*$/.test(last)
    || /^(?:[-*+]|\d+[.)])\s*$/.test(last);
}

function 项目注册表(cfg) {
  const reg = cfg && cfg.项目 && cfg.项目.注册;
  return reg && typeof reg === 'object' && !Array.isArray(reg) && Object.keys(reg).length ? reg : null;
}

function 说明(命中, 现在, 改法) {
  return `命中：${命中}；现在：${现在}；改法：${改法}`;
}

// 查草稿({ fm, body, 需求, 项目, cfg }) → { ok, 违规, 警示 }
function 查草稿({ fm, body, 需求, 项目, cfg } = {}) {
  const p = 参数(cfg);
  const 违规 = [];
  const 警示 = [];
  const 加违规 = (型, 说明文本) => 违规.push({ 型, 说明: 说明文本 });
  const 加警示 = (型, 说明文本) => 警示.push({ 型, 说明: 说明文本 });
  const 文本 = `${String(需求 || '')}\n${String(body || '')}`;
  const frontmatter = fm || {};

  const 缺章 = p.必备章.filter((章) => !有章(body, 章));
  if (缺章.length) {
    加违规('正文缺章', 说明(`缺少必备章「${缺章.join('、')}」`, '正文未形成完整三章', `补齐 ${缺章.join('、')} 标题及其内容`));
  }

  if (正文悬尾(body, p.悬尾标点)) {
    const 收尾 = String(body || '').trim().split(/\r?\n/).pop().trim();
    加违规('正文悬尾', 说明(`正文以「${收尾}」悬尾`, '末行不是完整陈述', '补全末句或删除空标题/空列表项后再起草'));
  }

  const 验收方式 = frontmatter.验收方式;
  if (验收方式 !== undefined && 验收方式 !== null && 验收方式 !== '' && !p.验收方式合法值.includes(验收方式)) {
    加违规('验收方式非法', 说明(`验收方式「${String(验收方式)}」不在合法值集`, `现填「${String(验收方式)}」`, `改为 ${p.验收方式合法值.join(' 或 ')}，或留空让 draftFm 兜底`));
  }

  // 既有项目落点模块负责特征错配；本闸只把它并入，并补项目字段与注册表这两个残口。
  const 落点 = 项目落点.查落点({ 项目, 文本, cfg });
  if (!落点.ok) 加违规('项目落点', 落点.error);
  const 注册 = 项目注册表(cfg);
  const 项目名 = String(项目 || '').trim();
  const 项目问题 = !项目名
    ? 说明('项目字段为空', '项目为空', '填写已注册的项目名')
    : 注册 && Object.prototype.hasOwnProperty.call(注册, 项目名)
      ? null
      : 说明(`项目「${项目名}」未注册`, `现填项目「${项目名}」`, 注册
        ? `改为已注册项目（${Object.keys(注册).join('、')}）或先完成注册`
        : '补齐项目注册表后选择已注册项目');
  if (项目问题) {
    if (注册) 加违规('项目落点', 项目问题);
    else 加警示('项目落点', `${项目问题}；项目.注册 缺失或为空，本次降为警示`);
  }

  const 有归属 = ['专项', '特性', '管线'].some((k) => 有值(frontmatter[k]));
  if (!有归属) {
    const 命中 = p.散单声明.find((词) => 文本.includes(词));
    const 漏落说明 = 说明('专项/特性/管线三格均缺', '草稿会落入散单行', '补一项直接归属；确属独立杂务请在正文或需求明确散单声明');
    if (命中) 加警示('归属漏落', `${漏落说明}；命中散单声明「${命中}」，本次降为警示`);
    else 加违规('归属漏落', 漏落说明);
  }

  return { ok: 违规.length === 0, 违规, 警示 };
}

module.exports = { 默认, 参数, 查草稿, 有章, 正文悬尾 };
