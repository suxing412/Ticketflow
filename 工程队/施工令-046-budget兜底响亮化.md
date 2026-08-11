# 施工令-046 · budget 壳兜底去硬编码 + 失效响亮化

案源：协作者 robinwang2 2026-08-11 来信（docs/信道/收-总监/2026-08-11-robinwang2-budget壳兜底路径与打包态回执.md）：
`lib/budget.js` 第三候选硬编码 `D:/GitHub/Ticketflow`（换机即死），空实现回退让预算闸**静默失效**——不落账、不冻结、零症状。

写区：`apps/studio/lib/budget.js`、`server.js`（/api/gates 失效位）、`public/app.js`+`style.css`（额度卡红标）、`test/`。

## 三件

1. **第三候选去硬编码**：改读 `studio.config.json · packages路径`（字符串，缺省空=跳过该候选）；硬编码路径删除。候选顺序不变：①仓内相对 ②`TICKETFLOW_PACKAGES` 环境变量 ③配置值。
2. **失效响亮化**：三候选全失守落空实现时——journal 落「预算闸失效」事件（带各候选失败因）；`/api/gates` 返回体加 `budget失效: true`；参数页额度卡显著红标「预算闸失效——不落账不冻结」，悬停给三候选失败因。正常命中时一切如旧。
3. **测试**：`test/budget-接线.test.js` 补三格——候选③读配置不读硬编码（构造配置值命中）；全失守必落 journal 事件且 gates 失效位真出；正常命中时失效位不出。

## 验收

逐条自证 + 全量 npm test 零回归；回执 `工程队/回执-046.md`；git 提交本令文件面；不打包（总监下轮统一换装）。
