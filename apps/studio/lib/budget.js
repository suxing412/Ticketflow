// budget.js — 薄接线壳。本体已归位 packages/budget（协-003）。
// 打包态坑（0.26.5 冒烟案）：asar 内 ../../../packages 逃不出应用包——
// platform 侧 main.js 早有同型兜底（见 docs/仓库总说明书 4.1），studio 壳补齐同款：
// ①仓内相对（开发态）→②TICKETFLOW_PACKAGES 环境变量→③固定仓根兜底（换机自改此行）。
function resolveBudget() {
  const candidates = [
    () => require('../../../packages/budget/budget.js'),
    () => require(require('path').join(process.env.TICKETFLOW_PACKAGES || '', 'budget/budget.js')),
    () => require('D:/GitHub/Ticketflow/packages/budget/budget.js'),
  ];
  for (const c of candidates) { try { return c(); } catch { /* 下一候选 */ } }
  // 全灭：回退空实现（记账缺席但绝不炸 gates/派发——保险丝失效好过全线停摆），启动日志留痕
  console.error('[budget] 全部解析候选失败——预算闸缺席运行（保险丝失效，速修 TICKETFLOW_PACKAGES）');
  return { usageOf: () => ({ 输入: 0, 缓存: 0, 输出: 0 }), 记: () => null, 冻结池: () => ({}), 并入: (g) => g };
}
module.exports = resolveBudget();
