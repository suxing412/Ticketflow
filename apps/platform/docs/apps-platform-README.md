# apps/platform · 通用多 Agent 协作平台

**robinwang2 主导**（CODEOWNERS 全权）。Orchestrator / 角色体系 / DAG 调度 /
worktree 隔离 / 动态路由。

## 迁入状态（刀一，2026-08-08）

原「通用多-Agent-协作平台重构」分支的平台主体已落本目录：

```
lib/orchestration/plan.js      DAG 计划：切分、依赖、恢复
lib/routing/{router,history}.js 动态路由 + 路由历史
lib/workspace/worktree.js       worktree 隔离（一单一工作区）
lib/toolchain.js                agent 工具链发现与 PATH 注入
lib/review-opinion.js           AI 评审意见解析
scripts/recover-orchestrator-plan.js
角色协议模板/                    common / orchestrator / backend / frontend / reviewer / integrator
platform.config.template.json   schemaVersion 2 · profile: software-project
test/                           5 个套件
```

**实证**：这套实现已在真实项目上跑过 22 张完成单（求职平台 `海投王`，
M0–M3 里程碑，工作区 `AIStudioDev`）。角色体系与 worktree 隔离是被压过的，不是纸面设计。

## 测试现状（诚实记录）

本分支单独跑：**5 套件中 4 绿、13 用例**。`routing` 一条红，原因是**依赖顺序**而非缺陷：

- `lib/routing/router.js` 引用 `packages/providers/registry`，
  而 providers 是**刀二**的产物（双签 PR，分支 `feat/providers-adapters`）。
- **两刀都入 main 后 routing 自然转绿。** 不要为了本分支单独绿而在此复制一份 registry——
  那正是 providers README 明令避免的「复制粘贴」。

## 共享地基的消费点（待 packages/core 抽取）

平台主体目前跨目录引用 studio 的地基正本（`packages/core/README.md` 记载的过渡状态）：

| 引用方 | 依赖 |
|---|---|
| `lib/orchestration/plan.js` | `apps/studio/lib/core/store`（目录即状态机） |
| `test/*`（含 `helper.js`） | `apps/studio/lib/{core/store,gates,pool,quota}` |

这些正是 `packages/core` 抽取时该固化的 API 面——**由 platform 的实际消费方式决定包形状**，
而不是闭门造 API。抽取前，对这些模块的任何修改视同修改共享地基，走双签评审。

## 安全披露

本产品同样驱动具有仓库写权限的无头 agent，对外文档保持与仓库 README 同等的披露诚实度。
