# @papercrew/providers（占位 · 等待第一块贡献）

CLI 厂商适配层——把"由哪家 AI 执行"从两个产品的业务逻辑里解耦出来。
**本包由 robinwang2 主笔**（自其「通用多 agent 协作平台重构」PR 吸收），接口变更双签。

## 期待的形状（供重切 PR 参考，非强制）

- 每个 provider 一个模块：`claude-cli.js` / `codex-cli.js` / `command-cli.js`（通用命令行）…
- 一个 `registry.js`：按名字取 provider；provider 至少描述——
  - 如何组装无头调用（命令/参数/prompt 走 stdin 的约定、超时、代理 env）；
  - 能力与状态自述（可用性探测、模型档列表）；
- **不含调度逻辑**：谁来选用哪个 provider（评分/路由）属于消费方（platform 的 router、
  studio 的池机制），不进本包——保持适配层纯粹；
- 自带测试；不依赖 apps/* 下任何代码。

## 落位方式

基于 `main` 开 feature 分支，把原 PR 中的 `_app/lib/providers/*` 重切至本目录并补
`package.json`（包名建议 `@papercrew/providers`），提交 PR。原 PR #1 在两刀重切完成后关闭。

## 已知的现网调用约定（studio 实测踩坑，供适配层吸收）

- claude 无头：`-p --permission-mode acceptEdits`，中文 prompt 走 stdin（argv 会乱码），
  需注入代理 env；
- codex 无头：`exec --dangerously-bypass-approvals-and-sandbox`（Windows 沙箱辅助缺失会
  弹窗卡死），`-m` 指定模型时注意 CLI 会把该值写回用户默认配置的副作用。
