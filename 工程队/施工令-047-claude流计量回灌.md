# 施工令-047 · claude 流计量回灌 budget（Q9）

案源：robinwang2 2026-08-11 stream 计量口径信（docs/信道/收-总监/2026-08-11-robinwang2-stream侧计量口径.md）——口径、坑、判超规矩全按信抄，不自创。前置：施工令-046 已闭环（budget 壳解析可靠、失效响亮）。

写区：`apps/studio/lib/runner.js`（claude 会话收线处的计量挂点）、`lib/budget.js`（转发 `usageOf`/`记`）、`public/`（额度卡 codex 不计量标注）、`test/`。禁碰：派发决策逻辑、门禁判定、人闸链路。

## 要件

1. **只对 claude 家族计量**：claude CLI 会话须以 `--output-format stream-json --verbose --include-partial-messages` 起（若 runner 现行起法不同，改起法并验证回执/产出解析不回归）；收线后把原始流文本喂 `budget.usageOf(raw)`，按信中口径（输入=max、缓存=max、输出=Σ，合计不含缓存）。
2. **落账走 `budget.记(root,{池,单,...u})`**：一次会话一行；**原始流绝不落账本**（信中坑 1：记账前剥 `_输出` 型内部字段）；干跑/零消耗不记（坑 2）；记账失败不抛不阻断交单（坑 3）。
3. **codex 显式不计量**：codex 会话不臆造数字；额度卡 codex 池标「不计量池——消耗不入预算账」（与池衡盲区不编数同纪律）；journal 不为 codex 落假账行。
4. **判超三硬规**（照信第五节）：未配预算的池永不冻结；算不出费用不判超；`≥` 判超。此三条若 budget 包已内置则测试锁死即可，勿重复实现。
5. **测试**：runner 计量挂点单测（构造带 usage 的假流→账落对；无 usage 流→不落账；记账抛错→交单不受阻）；额度卡标注探针；全量 npm test 零回归。

## 验收

逐条自证 + 全量绿；回执 `工程队/回执-047.md` 附一条真实（或构造）账行样例与额度卡文字誊录；git 提交本令文件面；不打包（总监统一换装）。
