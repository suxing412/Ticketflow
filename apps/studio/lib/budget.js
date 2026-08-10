// budget.js — 薄接线壳。**本体已归位 packages/budget**（协-003）。
//
// 制作人 2026-08-08 裁定「预算池应算进公共件 package 里」，故本体迁出，
// studio 这边只留这一行转发。保留本文件而不是改三处调用点，是为了把改动面
// 压到最小——`lib/runner.js` 与 `server.js` 里那三处 `require('./budget')`
// 一个字都不用动（口径 3：动对方整机内文件先对齐，改得越少越好审）。
//
// 公用件唯一家是仓根 packages/（双签共建）。要改预算闸的行为，改那边，别在这里加逻辑：
// 这个文件里**任何**新增代码都会让两边分叉，而分叉正是归位要消除的东西。
module.exports = require('../../../packages/budget/budget.js');
