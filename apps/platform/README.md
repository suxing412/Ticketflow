# AI-DevPlatform · 通用软件开发平台（交钥匙壳）

**robinwang2 全权的独立产品。** 本仓由 Ticketflow 工程队按施工令-025 出厂：一个零游戏语义、
能单独开机的最小整机壳——静态仪表盘 + providers 枚举 + 瞭望塔可观测性标配 + 他方现有零件
（lib/ 五件与角色协议模板）原样在位。**真实调度、工单语义、执行器怎么长，全部由仓主自行决定。**

## 这是什么（与不是什么）

- 是：开机即亮的壳。HTTP 服务（端口 4370）、一页仪表盘、providers 注册表枚举、
  echo 级桩调用、瞭望塔在岗灯与未读账本、信箱协议预配。
- 不是：不含任何工单/职能/派发语义；没有执行器（`server.js` 物理上不引入 `child_process`，
  一切 provider 调用都是**桩模式**——只组装参数不落进程，零真实 CLI 调用零计费）；
  没有 Electron 壳（要不要壳仓主自定）。
- 安全披露：本平台日后若驱动具有仓库写权限的无头 agent，对外文档请保持与
  `docs/apps-platform-README.md` 同等的披露诚实度。

## 怎么开机

前置：Windows + node。运行时零第三方依赖，**不需要 `npm install`**。

```
cd D:\Ticketflow\apps\platform
npm start            # 开机 → 浏览器访问 http://127.0.0.1:4370
```

首页会自动带上接口令牌，直接能用。拿 `curl` 调接口要自己带（见「门禁」节）。

仪表盘四件：平台名+版本 / providers 枚举表（含 echo 桩测按钮）/ 瞭望塔在岗灯 / 未读账本。

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

令牌落在 `config/接口令牌.local.json`（gitignore，不入库），开机日志会打印路径。
浏览器打开首页无需手工填；`curl` 要自己带：

```
curl -H "Authorization: Bearer $(node -p "require('./config/接口令牌.local.json').令牌")" ^
     http://127.0.0.1:4370/api/providers
```

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

## 工作区服务（唯一能起 git 进程的地方）

```
npm run workspace    # 独立进程，默认 4371；要用 /api/workspace/* 才需要拉
```

`server.js` 自己**不碰 `child_process`**——桩模式是物理保证，不是自觉。git 能力全部
住在这个独立进程里，平台服务只经 http 转发。写操作（建分支/提交/合并）默认关闭，
要开需在 `config/platform.config.json` 写 `workspace.允许写: true`。

## 目录一览

```
server.js            HTTP 服务：静态托管 + 门禁 + 九条 /api（health/watchtower/providers/
                       routing.rank/routing.history/toolchain/review.parse/plan.validate/
                       workspace 转发）。**不引 child_process**——桩模式是物理保证。
public/              一页仪表盘（令牌由服务发页时注入，无需手工填）
lib/公用件.js         消费 packages/ 的唯一入口
lib/门禁.js           令牌 + Origin + Content-Type 三道闸
lib/                 业务零件：orchestration/plan.js · routing/{router,history}.js ·
                       toolchain.js · review-opinion.js（均已接线）
                       workspace/worktree.js（引 child_process，只被隔离进程持有）
角色协议模板/         common / orchestrator / backend / frontend / reviewer / integrator
config/              platform.config.json · 瞭望塔.config.json（正本）· 规则.json
                       接口令牌.local.json（运行时生成，gitignore）
瞭望塔.config.json    仓根同步副本（--install 计划任务寻径用，见文件内说明）
scripts/watchtower.js 瞭望塔启动器（经 lib/公用件 找正本代为拉起）
scripts/工作区服务.js  唯一被允许起 git 进程的地方，独立端口 4371，默认不随 server 启动
test/                公用件契约（9 项）· 接线契约（22 项）
docs/                边界与协作.md · 接线说明.md（含接线台账/门禁/隔离三节）· apps-platform-README.md
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
