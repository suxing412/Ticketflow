// 返修 —— 质检「不过」之后，决定转修复职责还是停手待人工。
'use strict';

function 上限(配置) {
  const n = Number(配置 && 配置.执行 && 配置.执行.返修上限);
  return Number.isInteger(n) && n >= 0 ? n : 2;
}

function 判后处置(配置, fm, 结论) {
  if (结论 !== '不过') return { 转修复: false, 挂起: false };
  const raw = Number(fm && fm.返修次数);
  const 前 = Number.isInteger(raw) && raw >= 0 ? raw : 0;
  const 限 = 上限(配置);
  if (前 >= 限) {
    const 原因 = `已返修 ${前} 次仍不过，停手待人工`;
    return { 转修复: false, 挂起: true, 下一步: '挂起', 返修次数: 前, 原因, 上限: 限 };
  }
  return {
    转修复: true, 挂起: false, 下一步: '待投', 返修次数: 前 + 1, 上限: 限,
    原角色: fm && (fm.原角色 || fm.role || fm.角色 || fm.职能) || '',
  };
}

function 应用(fm, 处置, now = new Date().toISOString()) {
  if (!fm || !处置) return fm;
  if (处置.转修复) {
    if (!fm.原角色 && 处置.原角色) fm.原角色 = 处置.原角色;
    fm.role = '修复';
    fm.返修次数 = 处置.返修次数;
    delete fm.返修挂起;
  } else if (处置.挂起) {
    fm.返修次数 = 处置.返修次数;
    fm.返修挂起 = { 时刻: now, 原因: 处置.原因, 上限: 处置.上限 };
    fm.挂起原因 = 处置.原因;
  }
  return fm;
}

module.exports = { 上限, 判后处置, 应用 };
