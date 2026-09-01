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

## 使用说明 · 对消费方的接口契约

> 2026-08-09 对等交付（主笔方写自己包的说明）。**只有本节列出的才是稳定公开面**，
> 其余导出属内部实现，可能随版本变化——不要在契约测试里断言它们。

### 公开面

| 导出 | 稳定性 | 用途 |
|---|---|---|
| `list(cfg)` | **稳定** | 枚举全部 provider 配置。UI / 仪表盘用 |
| `create(cfg, name)` | **稳定** | 取某 provider 的 adapter 实例，用 `.buildInvocation({model})` 组装调用 |
| `register(adapter, factory)` | **稳定** | 注册新 Adapter。新增厂商只动这里，消费方不新增分支 |
| `configs(cfg)` | 内部 | `list` 的底层，返回对象而非数组。形状可能变 |
| `resolveLegacy(name, model)` | **已弃用** | 旧测试兼容入口。新代码一律走 `create().buildInvocation()` |

### OpenCode / GLM（协议基线 1.18.25）

`opencode-cli` 生成 `opencode run --pure --model <固定模型> --format json --agent <档位>`，
提示词走 stdin，输出格式为 `opencode-jsonl`。首期模型只允许
`zhipuai-coding-plan/glm-*`；provider 配置中的固定模型不能被请求体改成别家模型。

2026-09-01 用本机 OpenCode 1.18.25 实采了成功、stdin/cwd/读写、bash、401、429、
命令不存在、EPERM 与中断流，原始事件夹具在 `apps/platform/test/fixtures/opencode/`。
升级 OpenCode 后必须重采并跑契约测试。成功必须以最终 `step_finish.reason="stop"` 为准；
退出码 0 或正文非空都不能替代完整终态。

### `list(cfg)` 的字段契约

返回**数组**，元素字段（注意是英文键——中文键是消费方自己映射的，不是本包契约）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | provider 名，与 cfg 里的键一致 |
| `adapter` | string | `codex-cli` \| `claude-cli` \| `command-cli`，或经 `register` 注册的自定义名 |
| `enabled` | boolean | `false` 时 `create()` 会抛「Provider 已停用」 |
| `roles` | string[] | 该 provider 承接的角色/职能 |
| `legacyPool` | object | **仅旧配置路径出现**（见下），新配置不带 |

**两条配置路径**：`cfg.providers` 非空时直接用；否则从 `cfg.执行池` 推导（`codex`→`codex-cli`、`claude`→`claude-cli`、其余→`command-cli`），推导出的元素才带 `legacyPool`。

### 入参容错边界

| 入参 | 行为 |
|---|---|
| `list()` / `list({})` | ✅ 返回 `[]`（默认参数生效） |
| `list({执行池:{...}})` | ✅ 走旧配置推导 |
| **`list(null)`** | ❌ **抛 `Cannot read properties of null`** —— `configs(cfg = {})` 的默认参数只对 `undefined` 生效，`null` 穿透。修复 PR 由 suxin 方出（已认领） |
| `create(cfg, 未注册名)` | 抛「Provider 未注册」 |
| `create(cfg, 已停用)` | 抛「Provider 已停用」 |
| `create(cfg, 未知 adapter)` | 抛「未知 Provider Adapter」 |

> ⚠️ **写契约测试的人注意**：`list({})` 返回空数组，所以「遍历元素断言字段」的写法会**静默空转**——
> 循环体一次都不执行，测试照样绿。断言字段契约必须喂一份真配置
> （如 `{执行池:{codex:{职能:['程序']}}}`）。这个洞我方自己踩过。

### 破坏性改动通知

本包改动的 PR 描述须列**消费方影响面**并信道知会（2026-08-09 入协作规范）。
公用件走路径消费、无 semver 锁，这是唯一的提前预警。

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
