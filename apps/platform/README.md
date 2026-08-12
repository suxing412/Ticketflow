# AI-DevPlatform · 通用软件开发平台（交钥匙壳）

**robinwang2 全权的独立产品。** 出厂时是个只会报自己活着的壳；2026-08-10 起是一台
**能真的派活、真的执行、真的把代码合进目标仓**的机器。

## 这是什么

一条完整的链路，从一张工单到一次真实的代码提交：

```
建单 → 待投 ──路由选人──► 在途 ──AI 在隔离 worktree 里干活──► 检查点 → 快进发布 → 完成
                              │                                    │
                         预算闸拦超支                         战绩落账 → 反哺路由排名
```

- **驾驶舱**（:4370）：工单看板、路由排名与理由、战绩与成功率、预算、瞭望塔在岗灯。
- **路由**：公开跑分当先验（权重 0.5）+ 本机实际战绩（0.3）。跑得越多，外部榜单影响越小。
- **预算闸**：`packages/budget`，按量池 token 上限，超了那个池就不许派。
- **提交链**：一律在隔离 worktree 里干活，检查点校验写区，快进合并回主线。主工作区零改动。

## 这是什么（安全形状）

三个进程各管一种能力，**默认只起第一个**，可以单独关掉任意一个：

| 进程 | 能力面 | 默认 |
|---|---|---|
| `server.js` :4370 | 只转发，**物理上不引 `child_process`** | 起 |
| `scripts/工作区服务.js` :4371 | 唯一能起 **git** 的地方 | 不起 |
| `scripts/执行器.js` :4372 | 唯一能拉起 **AI CLI** 的地方 | 不起 |

契约测试里有一条**传递闭包断言**盯着 `server.js` 的依赖闭包不得出现 `child_process`——
桩模式是物理保证，不是自觉。

花钱要过**三道独立的闸**：请求显式关干跑 + 配置总开关 + 该池配了预算上限。缺一即拒。
权限白名单之外的角色一律受限，`--dangerously-*` 会被从调用参数里剥掉。

> 安全披露：本平台驱动的是**具有仓库写权限的无头 agent**。对外文档请保持与
> `docs/apps-platform-README.md` 同等的披露诚实度。

## 怎么开机

前置：Windows + node。运行时零第三方依赖，**不需要 `npm install`**。

```
cd D:\Ticketflow\apps\platform
npm start            # 开机 → 浏览器访问 http://127.0.0.1:4370
```

一条命令带起全部三个进程（见下文「三个进程」）。`npm run desktop` 是同一套，
外面套一个桌面窗口。首页自动带上接口令牌，直接能用；命令行调接口要自己带（见「门禁」节）。

第一次打开如果没配工单库，看板上直接有输入框，填个目录就能开工——不用去翻配置文件。

可观测性（出厂标配，不是选配）：

```
npm run watchtower            # 前台起瞭望塔守护 → 在岗灯 30 秒内变绿
npm run watchtower:install    # 注册登录自启计划任务（任务名 AI-DevPlatform瞭望塔）
schtasks /Run /TN AI-DevPlatform瞭望塔    # 装完当场拉起
npm run watchtower:status     # 看在岗状态（含心跳戳秒龄）
```

接线细节（部署区/出口/信箱/常驻会话挂 Monitor）见 `docs/接线说明.md`。

## 公用件从哪来（一仓拓扑）

2026-08-09「拓扑正音」之后是**两产品一仓**：

```
Ticketflow/
  apps/studio      游戏工作流产线（suxin 全权）
  apps/platform    本产品（robinwang2 全权）  ← 我们在这里
  packages/        公用件唯一家（双签共建）：providers、watchtower
```

本产品**不复制正本**，一律经 `lib/公用件` 从仓根 `packages/` 解析——那是唯一的消费入口，
契约测试里有断言盯着不许第二处自抄。换布局时用环境变量 `TICKETFLOW_PACKAGES` 指向 `packages/`。

> 早前的「两仓并排克隆 + `TICKETFLOW_HOME`」已随一仓合并**作废**。那套算法从
> `apps/platform` 往上找名叫 `Ticketflow` 的兄弟目录，一仓之后解析成
> `<仓根>/apps/Ticketflow`——不存在，providers 与瞭望塔会全部加载失败。

## 门禁

服务绑 `127.0.0.1`，但那挡不住你自己浏览器里的页面（浏览器就在 localhost 上），
所以有三道闸：跨站 `Origin` → 403、POST 非 `application/json` → 415、缺令牌 → 401。

令牌落两份（都 gitignore，不入库）：

| 文件 | 用途 |
|---|---|
| `config/接口令牌.local.json` | 正本，带说明与生成时间 |
| `config/api-token.txt` | 明文副本，**纯 ASCII 内容**，只有 64 位十六进制 |

**为什么要明文副本**：Windows PowerShell 5.1 的 `Get-Content` 按系统 ANSI 码页读文件，
JSON 里的中文键（`_说明`/`令牌`/`生成于`）在 GBK 下解不开，`ConvertFrom-Json` 整份失败——
**在 JSON 里加个 `token` 别名救不了，因为坏的是整份文件**。明文副本让 PowerShell 一句话拿到。

浏览器打开首页无需手工填（服务发页时自动注入）；命令行要自己带：

```bash
# bash
curl -H "Authorization: Bearer $(cat config/api-token.txt)" http://127.0.0.1:4370/api/providers
```

```bash
# PowerShell
$T = Get-Content config\api-token.txt
Invoke-RestMethod http://127.0.0.1:4370/api/providers -Headers @{ Authorization = "Bearer $T" }
```

请求体里的中文键同理有 ASCII 别名：`{"dry_run": false}` 等价于 `{"干跑": false}`
（PS 5.1 传中文键要先 `[Encoding]::UTF8.GetBytes` 绕一圈）。

`/api/health` 免令牌——瞭望塔守护要探它，而守护住在 `packages/`（双签共建），
没法单方面让它带令牌。免令牌名单只此一条，契约测试钉死了。

轮换令牌：删掉那个文件重启服务。

## 桌面壳与打包（可选件）

```
npm i -D electron@30.5.1 electron-builder@24.13.3   # 仅这两条命令需要装依赖
npm run desktop      # 开发态桌面窗口
npm run dist         # 出 portable exe（会下载约 109MB electron 二进制）
```

打包态 `__dirname` 落在 asar 内，仓根解析不成立，此时靠 `main.js` 里那行硬编码兜底
（**换机需自行改那一行**），或预先设好 `TICKETFLOW_PACKAGES`。


## 怎么真的用它（完整流程）

三个进程，各管一种能力。**`npm start` 一条命令全起，不用开三个终端**：

```
npm start          # 总启动器：一次带起下面三个，任一个死掉就全停
                   #   :4370 平台服务   —— 只转发，闭包里没有 child_process，物理上起不了进程
                   #   :4371 工作区服务 —— 唯一能起 git 的地方
                   #   :4372 执行器     —— 唯一能拉起 AI CLI 的地方
```

为什么「任一个死掉就全停」：半个产品比全停难查得多——界面照常开，
派活按钮照常点，点了没反应也没报错。

单独起某一个（调试用）：`npm run server` / `npm run workspace` / `npm run executor`。
不想让执行器活着：`PLATFORM_NO_EXECUTOR=1 npm start`，此时只能干跑。

> 执行器进程活着 ≠ 会花钱。真跑要同时过三闸：请求体 `{"干跑": false}`
> ＋ `config/执行.local.json` 的 `允许真跑` ＋ `预算.池` 里配了上限。

浏览器打开 http://127.0.0.1:4370 就是驾驶舱：工单看板、路由排名、战绩、预算、瞭望塔灯。

### 第一次用要配三样（都不入库）

| 文件 | 作用 | 不配的后果 |
|---|---|---|
| `config/工单库.local.json` | 工单落哪（业务私仓） | 工单接口 503，**不猜位置** |
| `config/执行.local.json` | `允许真跑: true` | 只能干跑 |
| `config/预算.local.json` | 各池 token 上限 | 该池不许真跑 |
| `config/项目.local.json` | 项目注册表（写操作白名单） | 带项目的工单起不了隔离工作区 |
| `config/workspace.local.json` | `允许写: true` | 提交链 403 |

同目录有 `*.示例` 文件可直接改名使用。

### 一张工单的一生

```
建单 → 草稿 ──投出──► 待投 ──派活──► 在途 ──检查点+发布──► 完成
```

- **干跑**：全链路走完但不 spawn，零计费。默认就是它。
- **真跑**：要三闸齐备（请求显式 `{"干跑": false}` + 总开关 + 该池有预算上限）。
- 工单带 `项目` 字段 → 走完整提交链（隔离 worktree → 检查点 → 快进发布 → 完成）；
  不带 → 只跑不提交，停在「在途」。

### 权限（协-002 拍板 A3）

`执行.权限.放开` 白名单里的角色沿用适配器默认（含权限绕过）；**白名单之外一律受限**，
受限参数会把 `--dangerously-skip-permissions` 之类从调用里剥掉。
缺配置时**全部受限**——最严不是最松。

## 工作区服务（唯一能起 git 进程的地方）

```
npm run workspace    # 独立进程，默认 4371；要用 /api/workspace/* 才需要拉
```

`server.js` 自己**不碰 `child_process`**——桩模式是物理保证，不是自觉。git 能力全部
住在这个独立进程里，平台服务只经 http 转发。写操作（建分支/提交/合并）默认关闭，
要开需在 `config/workspace.local.json`（不入库）写 `允许写: true`。

## 目录一览

```
server.js            HTTP 服务：静态托管 + 门禁 + 全部 /api（health/watchtower/providers/
                       tickets/plan.validate/plan.materialize/routing.rank/routing.history/
                       toolchain/review.parse/workspace 转发/exec 转发）。
                       **不引 child_process**——桩模式是物理保证，契约测试盯着。
public/              驾驶舱：工单看板 + 派活 + 路由排名 + 战绩 + 瞭望塔灯
                       （令牌由服务发页时注入，无需手工填）
lib/公用件.js         消费 packages/ 的唯一入口
lib/门禁.js           令牌 + Origin + Content-Type 三道闸
lib/工单库.js         目录即状态机（草稿/待投/在途/完成），工单落业务私仓
lib/派单.js           选人 + 权限判定 + 工单流转
lib/执行加固.js       软超时验尸 / 判官失败不打整单 / 空输出不作数 / 候选链降级
lib/本地覆盖.js       危险开关只能从不入库的 *.local.json 打开
lib/                 业务零件：orchestration/plan.js · routing/{router,history}.js ·
                       toolchain.js · review-opinion.js（均已接线）
                       workspace/worktree.js（引 child_process，只被隔离进程持有）
角色协议模板/         common / orchestrator / backend / frontend / reviewer / integrator
config/              platform.config.json · 瞭望塔.config.json（正本）· 规则.json
                       接口令牌.local.json（运行时生成，gitignore）
瞭望塔.config.json    仓根同步副本（--install 计划任务寻径用，见文件内说明）
scripts/watchtower.js 瞭望塔启动器（经 lib/公用件 找正本代为拉起）
scripts/工作区服务.js  唯一被允许起 git 进程的地方，:4371，默认不随 server 启动
scripts/执行器.js      唯一被允许拉起 AI CLI 的地方，:4372，默认不随 server 启动
test/                公用件契约 9 · 接线契约 22 · 工单库契约 16 · 执行链契约 22
docs/                边界与协作.md · 接线说明.md（接线台账/门禁/隔离/执行链）
工程队/              协-001 工单库 · 协-002 执行链 · 协-003 提交链（施工令档案）
journal/ 呼叫/       运行时流水与本地信箱（占位入库，内容 gitignore）
watchtower-out/      瞭望塔唯一写区：心跳戳/流水/未读账本/pid（整目录 gitignore）
```

## 边界宣言

1. **本仓 robinwang2 全权**——架构、节奏、要不要壳、执行器怎么长，都是仓主的事。
2. **公用件在 Ticketflow `packages/` 双签共建**——providers / watchtower（及后续 budget、core）
   唯一正本住那边，接口变更双签，谁需要谁引用，不复制粘贴分叉。
3. **两套平台互不干扰**——本仓与游戏工作室（Ticketflow apps/studio + 监制台）是两个产品，
   动对方 app 先对齐再动手。

三层分账、五条口径与信箱协议全文见 **`docs/边界与协作.md`**（该文即回执 v2 终稿，随仓交接）。
