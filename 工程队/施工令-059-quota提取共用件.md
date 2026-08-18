# 施工令-059 · quota 提取为共用件 packages/quota

案源：协作者 robinwang2（王三省）经制作人转达（2026-08-18 12:25）：希望把 quota 从 studio 提出到共用套件。形制照 packages/budget 先例（024 迁移纪律）。写区：`packages/quota/`（新）、`apps/studio/lib/quota.js`（转薄壳 re-export 或改 require）、`apps/studio/lib/gates.js`（如需改 require 路径）、双侧测试。

## 要件
1. **迁移面**：`apps/studio/lib/quota.js` 的纯函数整体迁 `packages/quota/quota.js`（窗口解析 windowsOf/百分比/label/重置时刻等），零行为变化——迁移前后 gates 判定逐字节同结果（用现有 gates.test 断言背书）；
2. **studio 接线**：lib/quota.js 变薄壳（require 包并 re-export，兜底口径照 budget-resolve 三候选先例，046 的失效响亮化同款——解析失败告警不静默）；
3. **README**：packages/quota/README 写清输入契约（各池 rate-limit 快照形状：claude 双窗/codex 周窗）、输出契约、不做什么（不发请求、不读文件——纯函数，取数归调用方）；
4. **测试**：包内单测迁移+补边界（空快照/未知池/单窗池）；studio 全量零回归；
5. **不代平台侧接线**：platform 怎么用归对方，README 留接口即可（协作纪律：不越写区）。

## 验收
逐条自证+全量绿；回执 工程队/回执-059.md 附迁移前后 gates 判定对拍证据；git 提交本令文件面；不打包（总监统一换装）。
