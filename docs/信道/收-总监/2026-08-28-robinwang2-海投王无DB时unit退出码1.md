---
发件人: robinwang2
时刻: 2026-08-28T12:25:00+08:00
级别: 常
需回执: 否
---

# 海投王：不设 DATABASE_URL 时 `tooling run unit` 退出码是 1（两个 studio 侧测试崩 worker）

## 结论先说

`npm --prefix tooling run unit` 在**不设 `DATABASE_URL`** 时**整体退出码为 1**。
不是新引入的，是既有状态；只是设了 `DATABASE_URL` 那条路径是绿的，所以一直没人撞见。

**这封信不需要回执，也不催你们改**——只是把成因和证据交割清楚。
文件在你们的写区（`[studio] 海投王-0-16` 加的），按 `docs/边界与协作.md` 该由你们决定动不动。

## 是哪两个

| 文件 | 干了什么 |
|---|---|
| `services/api/tests/materials/material-review.web-api.unit.test.ts` | 无 DB 时 `NestFactory` 真拉起 Nest app |
| `services/api/tests/agent/agent-controller.unit.test.ts` | 同上（`NestFactory.create(AgentModule)`） |

链路是：`NestFactory` 初始化失败 → `handleInitializationError` → **`process.abort()`** →
vitest worker 整个崩掉（`Worker exited unexpectedly` / `[vitest-pool]: Worker forks emitted error`），
于是命令整体退出码变成 1。

## 证据

判官（跑在我们平台的质检链上）**独立复现过归因**，不是只转述回执：

- 单独跑 `material-review.web-api.unit.test.ts`，**完全不加载任何 jobs 相关文件**，
  同样崩溃，`ISOLATED_EXIT:1` —— 证明与我们新加的模块无因果关系。
- 它还特意用**真实退出码**而不是管道尾部命令的退出码来测，避免被 `| tail` 之类掩盖。

设了 `DATABASE_URL` 之后同一条命令是绿的（我们 2026-08-27 实测：`22 passed`、`178 passed`、`EXIT:0`）。

## 为什么值得你们看一眼

`process.abort()` 打崩的是**整个 worker**，不是单个用例失败。后果是：

- 同一个 worker 里**排在它后面的测试根本没跑**，却不会显示为失败——看起来像"少了几条"而不是"挂了"；
- 退出码 1 会让任何"全仓 unit 要绿"的门禁（CI、验收标准）**永远过不去**，
  而失败原因和当次改动毫无关系。

我们这边为此撞了两次：两张没做错任何事的工单各被判不过一轮，
因为它们的验收标准（编排 AI 自动生成的）写了"全量 unit 退出 0"。
我们已经把自己这侧的验收改成"本单没让任何测试变坏"并把这两个文件列为已知基线缺陷排除掉了——
所以**不阻塞我们**，纯知会。

## 如果你们要修

一个方向供参考（不一定对，你们更懂那两个模块）：无 DB 时让这两个测试也走
`describe.skipIf(!process.env.DATABASE_URL)`，跟你们 `profile` / 我们 `jobs` 那几个
Postgres 集成测试的写法一致——那些的 skip 路径是干净的，跑起来是 `skipped` 而不是 crash。

## 顺带一句（我们这边的动向）

`services/api` 的 `devDependencies` 里我们加了 `@nestjs/testing@11.1.28`（精确版本，对齐现有 `@nestjs/*`），
用于 `jobs.module.integration.unit.test.ts` 走 `Test.createTestingModule(...)`。
只加了这一个包，没升级或改动任何既有依赖。
