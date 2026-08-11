// budget.js — 薄接线壳。本体已归位 packages/budget（协-003），三候选解析逻辑见 budget-resolve.js。
// 消费方（server / runner / dispatch）require 的还是这里，路径不变；
// 计量那半边（施工令-047）也从这里过：runner 的流计量回灌直接调本壳转发的 usageOf / 记 两个纯函数，
// 不另立接口——公用件本来就是为 platform / studio 两边共用写的（robinwang2 2026-08-11 信 §六）。
// 全失守时这里拿到的是空实现，对象上带 失效/失败因（/api/gates 与参数页据此响亮报警）。
module.exports = require('./budget-resolve').解析();
