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

前置：**并排克隆约定**（见下节）；Windows + node（本仓零第三方依赖）。

```
cd D:\GitHub\AI-DevPlatform
npm install          # 零第三方依赖，秒完
npm start            # 开机 → 浏览器访问 http://127.0.0.1:4370
```

仪表盘四件：平台名+版本 / providers 枚举表（含 echo 桩测按钮）/ 瞭望塔在岗灯 / 未读账本。

可观测性（出厂标配，不是选配）：

```
npm run watchtower            # 前台起瞭望塔守护 → 在岗灯 30 秒内变绿
npm run watchtower:install    # 注册登录自启计划任务（任务名 AI-DevPlatform瞭望塔）
schtasks /Run /TN AI-DevPlatform瞭望塔    # 装完当场拉起
npm run watchtower:status     # 看在岗状态（含心跳戳秒龄）
```

接线细节（部署区/出口/信箱/常驻会话挂 Monitor）见 `docs/接线说明.md`。

## 并排克隆约定

公用件唯一家在 Ticketflow `packages/`（providers、watchtower），本仓**不复制正本**，
按相对路径消费。两仓必须并排克隆：

```
D:\GitHub\Ticketflow        # 公用件正本：packages/providers、packages/watchtower
D:\GitHub\AI-DevPlatform    # 本仓
```

仓位不同时，设环境变量 `TICKETFLOW_HOME` 指向 Ticketflow 仓根即可
（`server.js` 与 `scripts/watchtower.js` 都认它）。

## 目录一览

```
server.js            最小 HTTP 服务：静态托管 + /api/health + /api/watchtower + providers 枚举/echo 桩
public/              一页仪表盘
lib/                 他方现有零件（自 Ticketflow apps/platform/lib 原样复制）：
                       orchestration/plan.js · routing/{router,history}.js ·
                       workspace/worktree.js · toolchain.js · review-opinion.js
角色协议模板/         common / orchestrator / backend / frontend / reviewer / integrator（原样复制）
config/              platform.config.json · 瞭望塔.config.json（正本）· 规则.json
瞭望塔.config.json    仓根同步副本（--install 计划任务寻径用，见文件内说明）
scripts/watchtower.js 瞭望塔启动器（按并排克隆约定找正本代为拉起）
docs/                边界与协作.md（回执 v2 终稿）· 接线说明.md · apps-platform-README.md（原件）
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
