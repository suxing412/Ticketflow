// test/helper.js — 造一个临时监制台仓库 + 配置 + 建单工具
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../../studio/lib/core/store');

const CFG = {
  职能: ['策划', '程序', '美术', 'QA'],
  优先级: ['P0', 'P1', 'P2', 'P3'],
  执行池: {
    codex: { 职能: ['程序'], 阈值: 70, 周阈值: 90 },
    claude: { 职能: ['策划', '美术', 'QA'], 阈值: 70, 周阈值: 90 },
  },
  闸值: { 全局在途上限: 3, 每职能在途上限: 1, 待验收积压闸: 8, QA自修上限: 2, 滞留超时小时: 4 },
  agents: [
    { id: '策划-A', 职能: '策划', 执行池: 'claude' },
    { id: '程序-A', 职能: '程序', 执行池: 'codex' },
    { id: 'QA-A', 职能: 'QA', 执行池: 'claude' },
  ],
};

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  store.ensureDirs(root);
  fs.writeFileSync(path.join(root, 'studio.config.json'), JSON.stringify(CFG), 'utf8');
  return root;
}

let seq = 0;
// 直接在某状态目录建单（跳过流转，用于铺测试初态）
function seed(root, state, opts = {}) {
  const id = opts.id || `P-${String(++seq).padStart(2, '0')}`;
  const fm = {
    id, title: opts.title || `单${id}`, 职能: opts.职能 || '策划',
    产出物类型: opts.产出物类型 || '文档', 优先级: opts.优先级 || 'P1',
    规模: opts.规模 || '单兵', QA: opts.QA || '关', 验收方式: opts.验收方式 || '保留',
    创建时间: opts.创建时间 || '2026-07-08', 更新时间: '2026-07-08',
  };
  if (opts.父单) fm.父单 = opts.父单;
  if (opts.依赖) fm.依赖 = opts.依赖;
  if (opts.依据) fm.依据 = opts.依据;
  if (opts.主办) fm.主办 = opts.主办;
  if (opts.领单时间) fm.领单时间 = opts.领单时间;
  // 其余字段透传（代裁/自修次数/预计时间/阶段/执行池…）——白名单曾吞掉新字段导致测试假阳
  for (const k of Object.keys(opts)) if (!(k in fm) && k !== 'body' && opts[k] !== undefined) fm[k] = opts[k];
  fs.writeFileSync(store.ticketPath(root, state, id), store.serialize(fm, opts.body || '## 范围\n做 ' + id), 'utf8');
  return id;
}

module.exports = { CFG, makeRoot, seed };
