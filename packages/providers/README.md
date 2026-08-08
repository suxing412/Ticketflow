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

## 落位方式（刀二已完成）

基于 `main` 开 feature 分支，把原 PR 中的 `_app/lib/providers/*` 重切至本目录并补
`package.json`（包名建议 `@papercrew/providers`），提交 PR。原 PR #1 在两刀重切完成后关闭。

## 已知的现网调用约定（studio 实测踩坑，供适配层吸收）

- claude 无头：`-p --permission-mode acceptEdits`，中文 prompt 走 stdin（argv 会乱码），
  需注入代理 env；
- codex 无头：`exec --dangerously-bypass-approvals-and-sandbox`（Windows 沙箱辅助缺失会
  弹窗卡死），`-m` 指定模型时注意 CLI 会把该值写回用户默认配置的副作用。
- **codex 无头不吃 ANTHROPIC_* 环境变量**（2026-08-08 实测定谳）：注入垃圾
  `ANTHROPIC_AUTH_TOKEN` + 非法 `ANTHROPIC_BASE_URL` 后 `codex exec` 仍**退出 0 正常作答**——
  它走自己的 `~/.codex` 登录态，帮助里也只有 `login`/`logout`，没有任何 ANTHROPIC 概念。
  适配层为 codex 实现「凭据注入」时**必须走 `codex login`，不能靠 env**：把 key 塞给它会
  **静默落回订阅态**，上层的按量计费与预算统计随之全部失真（studio 侧已加响亮拒派）。
- **命名陷阱**：studio 的 `resolveCli` 只把**恰好叫 `codex`** 的池路由到 codex CLI，
  `codex-key` 这类名字一律走 claude CLI。适配层做池名→provider 解析时别沿用这个隐式约定。
