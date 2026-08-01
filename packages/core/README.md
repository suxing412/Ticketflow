# @papercrew/core（占位 · 待抽取）

两个产品共用的地基：**目录即状态机 / 拉取池 / 双闸 / journal / 额度纪律 / 阶段字典**。

## 当前状态

地基模块的**正本目前仍在 `apps/studio/lib/` 内**（store/pool/gates/journal/quota/stages/
lifecycle/trace 等），studio 是唯一使用者。

抽取为独立包是**下一步**（计划中的第二刀），将与 platform 迁入同期进行——由 platform 的
实际消费方式决定包的 API 形状，避免闭门造 API。在那之前：

- 需要引用地基行为的，以 `apps/studio/lib/` 为唯一事实源；
- **对这些模块的任何修改视同修改共享地基，走双签评审**（CODEOWNERS 已覆盖 studio 目录，
  属主会在评审中把关）。

## 抽取时的验收标准（预告）

- studio 全量测试（95+）在抽取后保持全绿；
- platform 以包引用方式消费，无复制粘贴；
- 包内不含任何一方产品特有的概念（职能名/角色名不进 core）。
