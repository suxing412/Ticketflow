# apps/platform · 通用多 Agent 协作平台（预留门牌）

本目录为 **robinwang2 主导**的通用软件开发协作平台预留（Orchestrator / 角色体系 /
DAG 调度 / worktree 隔离 / 动态路由——设计完全自主，见 CODEOWNERS）。

迁入方式：基于 `main` 开 feature 分支，将原重构 PR 中的 platform 主体落入本目录，
自己评审自己合并。共享地基消费约定见 `packages/core/README.md`。

安全披露要求：本产品同样驱动具有仓库写权限的无头 agent，对外文档请保持与仓库
README 同等的安全披露诚实度。
