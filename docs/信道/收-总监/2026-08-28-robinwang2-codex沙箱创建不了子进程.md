---
发件人: robinwang2
时刻: 2026-08-28T12:20:00+08:00
级别: 急
需回执: 是
---

# codex-cli 0.149.1 在本机创建不了任何子进程（沙箱 helper 报 apply deny-read ACLs）

## 为什么发给你

你们的 SETUP 里写着 **codex 是程序职能的执行引擎**。这台机器上它现在**跑不了任何命令**，
所以大概率不只影响我这边的跨厂质检——你们派程序单如果落到 codex，agent 应该也执行不了工具调用。
先知会一声，免得两边各查各的。

## 现象

任何经 codex 发起的命令，在**实际执行之前**就被拒：

```
ERROR codex_core::tools::router: error=exec_command failed for
  `"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command Get-Location`:
  CreateProcess { message: "Rejected(\"Failed to create unified exec process:
                            helper_unknown_error: apply deny-read ACLs\")" }
```

连 `Get-Location` 都到不了执行那一步。

## 最小复现（不需要我们的平台，一条命令）

在**任意干净目录**下：

```bash
echo "运行命令 'Get-Location' 并把结果原样告诉我，不要做别的。" | \
  codex exec --sandbox read-only --skip-git-repo-check -
```

## 已排除的因素

| 怀疑过 | 结论 |
|---|---|
| 沙箱模式 | **两种都挂**：`read-only` 与 `workspace-write` 报同一条错 |
| 工作目录含中文 | 不是——干净的英文临时目录同样复现 |
| 我们平台注入的参数 | 不是——上面那条最小复现完全绕开平台 |
| 偶发 | 不是——同一天三次三挂（两次真质检 + 一次直测） |

## 版本与时间线

- `codex-cli 0.149.1`（`npm ls -g @openai/codex`）
- 2026-08-27 20:44 那批质检**还是好的**：同版本、同 `--sandbox workspace-write`，
  判官正常跑起 `npm run typecheck` / `unit` 并给出退出码。
- 2026-08-28 上午起就全挂了。中间我们这边没有动过 codex 的任何配置或参数。

顺带一提：同一个版本在 2026-08-25 还踩过另一桩事故（`exec` 子命令 SIGILL、0 字节输出），
记在我们 `apps/platform/scripts/执行器.js` 协-032 的注释里。这个版本在这台机器上不太稳。

## 我这边的临时处置（**没有动全局包**）

把 `reviewer` 的池序临时指到 claude、并关掉 `crossProviderReview`，让质检降级为同源判先把活走完；
**事后已还原**（`crossProviderReview: true`、`reviewer.prefer: []`）。
我没有重装或降级 `@openai/codex`——那是账号级全局包，你们也在用，动它得你们知情。

## 想请你确认的

1. 你们那边跑 codex 现在正常吗？如果也挂，那就是机器/版本级问题，不是我们各自的接线。
2. 要不要降级到 `0.147.0` 试？**这个决定我不单方面做**——全局包，动了影响你们的产线。

（如果你们那边一切正常，那反而更值得查：说明差异在调用方式上，我可以把我们的调用参数完整贴给你比对。）
