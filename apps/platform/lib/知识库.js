// 知识库 —— 把散在磁盘上的说明与规矩搬进界面（协-006）。
//
// 现状是：角色协议模板/ 六份、docs/ 两篇、工程队/ 的施工令档案、README——
// 全是这台机器怎么运转的**唯一权威说法**，而界面上一个字都看不到。
// 人要么去翻文件，要么问写它的人。规矩看不见，就等于没有规矩。
//
// studio 的 Wiki 是五分区（设计事实/策划案/调研方案/技术方案/美术标杆），
// 那是游戏工作室的知识形状。本产品的知识形状不一样，所以分区照着**自己有什么**定，
// 不照着对方的抄——抄过来会得到三个永远空着的分区。
//
// 只读。**不给编辑入口**是有意的：这些文件多数入库，改它们应当走 PR 与评审，
// 而不是在一个网页上点两下就改掉——那等于给「绕过评审改规矩」开了一条路。
'use strict';
const fs = require('fs');
const path = require('path');

// 分区 = 一个目录 + 一句「这里面是什么」。
// 说明不是装饰：读的人第一个问题永远是「我该看哪个分区」，
// 只给目录名的话，那个问题得靠猜。
const 分区表 = [
  { 键: '角色协议', 目录: '角色协议模板', 说: 'AI 干活时被喂进去的角色约束——想改 agent 的行为，先改这里', 后缀: ['.md'] },
  { 键: '说明书', 目录: 'docs', 说: '接线台账、门禁、隔离、执行链；产品边界与协作口径', 后缀: ['.md'] },
  { 键: '施工令', 目录: '工程队', 说: '每一期做了什么、为什么这么定——决策档案，不是流水账', 后缀: ['.md'] },
  { 键: '配置示例', 目录: 'config', 说: '出厂默认与 *.示例；照着改名就能用', 后缀: ['.json', '.示例'] },
];

// 路径闸。与 lib/工单库.js 同款：算出来的路径必须落在分区目录之内。
// 这个接口读什么由 URL 参数决定，是典型的穿越目标——`区=说明书&rel=../../config/接口令牌.local.json`
// 一旦放过去就是把令牌发出去了。
function 收窄(根, 目标) {
  const 绝对 = path.resolve(目标);
  const 相对 = path.relative(path.resolve(根), 绝对);
  if (相对.startsWith('..') || path.isAbsolute(相对)) {
    return { ok: false, 错误: `路径越界：只允许 ${根} 之内` };
  }
  return { ok: true, 路径: 绝对 };
}

const 找区 = (键) => 分区表.find((z) => z.键 === String(键 || '').trim()) || null;

// 首个 markdown 标题当作条目标题；没有就用文件名。
// 目录里躺一排文件名，人得逐个点开才知道是什么——标题是最便宜的目录。
function 取标题(文件, 兜底) {
  try {
    const 头 = fs.readFileSync(文件, 'utf8').slice(0, 4096).split(/\r?\n/);
    for (const l of 头) {
      const m = l.match(/^#{1,3}\s+(.+?)\s*$/);
      if (m) return m[1].replace(/[#*`]/g, '').trim();
    }
  } catch { /* 读不了就用兜底 */ }
  return 兜底;
}

function 列区(平台根, 键) {
  const z = 找区(键);
  if (!z) return { ok: false, 错误: `未知分区：${键}（可选 ${分区表.map((x) => x.键).join('/')}）` };
  const 根 = path.join(平台根, z.目录);
  const 出 = [];
  const 扫 = (dir, 前缀) => {
    let 项 = [];
    try { 项 = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of 项) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) { 扫(p, path.posix.join(前缀, d.name)); continue; }
      if (!z.后缀.some((s) => d.name.endsWith(s))) continue;
      // .local.json 一律不列：那是本机配置，可能带令牌与私仓路径。
      // 分区选的是 config 目录，出厂默认该看，本机的不该。
      if (d.name.includes('.local.')) continue;
      let 大小 = 0; let 改于 = null;
      try { const st = fs.statSync(p); 大小 = st.size; 改于 = st.mtime.toISOString(); } catch { /* 忽略 */ }
      出.push({
        rel: path.posix.join(前缀, d.name),
        文件名: d.name,
        标题: d.name.endsWith('.md') ? 取标题(p, d.name) : d.name,
        字节: 大小,
        改于,
      });
    }
  };
  扫(根, '');
  出.sort((a, b) => a.rel.localeCompare(b.rel));
  return { ok: true, 区: z.键, 目录: z.目录, 说: z.说, 条数: 出.length, 文档: 出 };
}

function 读(平台根, 键, rel) {
  const z = 找区(键);
  if (!z) return { ok: false, 码: 400, 错误: `未知分区：${键}` };
  const 根 = path.join(平台根, z.目录);
  const 闸 = 收窄(根, path.join(根, String(rel || '')));
  if (!闸.ok) return { ok: false, 码: 400, 错误: 闸.错误 };
  const 名 = path.basename(闸.路径);
  if (!z.后缀.some((s) => 名.endsWith(s))) return { ok: false, 码: 400, 错误: `本分区只读 ${z.后缀.join('/')}` };
  if (名.includes('.local.')) return { ok: false, 码: 403, 错误: '本机配置不外发（*.local.* 可能带令牌与私仓路径）' };
  let 文;
  try { 文 = fs.readFileSync(闸.路径, 'utf8'); } catch { return { ok: false, 码: 404, 错误: `读不到：${rel}` }; }
  return { ok: true, 区: z.键, rel: String(rel), 标题: 取标题(闸.路径, 名), 正文: 文 };
}

const 分区 = () => 分区表.map(({ 键, 目录, 说 }) => ({ 键, 目录, 说 }));

module.exports = { 分区, 列区, 读, 分区表 };
