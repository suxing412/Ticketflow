// 产出 —— 「这张单交付的是文件，还是判定？」（协-023）
//
// 这个判断有**两个消费方**，而它们住在不同的进程里：
//   · lib/派单.js（server 进程）：写权矛盾闸、空转闸要靠它分类；
//   · lib/workspace/worktree.js（工作区进程）：依赖集成要靠它回答
//     「上游没有 Git 检查点，是它坏了还是它本来就不产出文件？」
//
// 所以抽出来。本仓的教训写在 lib/公用件.js 头上：**同一个约定写两遍，就会漏改一遍**——
// 交壳时 server.js 与 scripts/watchtower.js 各抄了一份公用件解析，改一处漏两处。
//
// 纯函数、零依赖，两个进程都能安全 require。
'use strict';

// 要落盘的产出：这些类型的单跑完**应当**有文件改动，没有就是出事了。
const 落盘类型 = new Set(['代码', '文档', '资产', '规格']);

// 不落盘的产出：交付的是判定/意见，归宿是回执与 review-opinion 通道。
// reviewer 的产出就在这一类——它按设计只读（orchestration/plan.js 禁止它声明 writeScope），
// 「零改动」对它是**正确结果**，不是空转。
const 不落盘类型 = new Set(['评审意见', '结论', '判定', '意见']);

const 域of = (fm) => {
  const 域 = (fm && (fm.write_scope || fm.writeScope || fm.写入范围)) || null;
  return Array.isArray(域) ? 域 : (域 ? [域] : []);
};

/**
 * 只读产出：这张单的交付物本来就不是文件。
 *
 * 判据只认**显式声明**，不靠角色猜：声明了 write_scope 就是打算写（一票否决）。
 * 宁可漏判成普通单（顶多退回待投让人看一眼），也不能把一个真该写代码却什么都没写的单
 * 说成「它本来就不用写」——那是把失败洗成成功。
 */
function 只读产出(工单) {
  const fm = (工单 && 工单.fm) || {};
  if (域of(fm).length) return false;
  return 不落盘类型.has(String(fm.产出物类型 || '').trim());
}

/** 要落盘：声明了写入范围，或产出物类型属于落盘那几类。 */
function 要落盘(工单) {
  const fm = (工单 && 工单.fm) || {};
  return 域of(fm).length > 0 || 落盘类型.has(String(fm.产出物类型 || '').trim());
}

module.exports = { 落盘类型, 不落盘类型, 只读产出, 要落盘, 域of };
