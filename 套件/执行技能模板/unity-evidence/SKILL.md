---
name: unity-evidence
description: Unity 工程（TK）取证细则——测试数字从哪取、怎么防陈旧结果与脏环境。跑 enginectl unity-test 取证据前调用，与 pre-work/post-work 配套。
---

# Unity 取证细则（TK 工程专属）

## 一、跑之前

1. 清环境自查：`Temp/UnityLockfile`、`.enginectl-lock` 残留即报告（孤儿锁会饿死会话——TK-80 案）；有非本会话的 Unity.exe 在跑先声明再等待。
2. **记下当前 `enginectl-results.xml` 的 mtime**——跑完必须确认它变新了；引用陈旧 xml 的数字=伪证（00:33 陈旧结果案）。

## 二、跑法

- 一律 `node tools/enginectl.js unity-test --project D:/GitHub/TK`（仓内 shim 已在放行白名单）；**前台等跑完**，不许丢后台交单（TK-84 空壳案）。
- 需要超 40 分钟的加 `--timeout-min`；正常全量基线 ~340s（TK-87 修复后），明显超基线要在回执说明原因。
- 受控重建/执行工程内静态方法用 `unity-run --method <类.方法>`（通道已实装，TK-71 案勿再误判缺失）。

## 三、数字从哪取（回执引用要能复核）

- 总量：`enginectl-results.xml` 根节点 `total/passed/failed/skipped/duration` 属性——引用时写明 xml mtime
- 单测细节：`enginectl-test.log` 的 DIAGNOSTIC 行（逐点偏差/violations/RasterFallbackSuspectCount），引用带**日志行号**
- 出口判定：enginectl 的 JSON 输出（ok/code/passed/failed）与 xml 一致才算数，不一致要查（曾出现 log 覆盖但 xml 未更新的中断态）

## 四、红灯口径

既有红灯以开工基线（pre-work 记录）为准；当前工程已知唯一豁免红灯以工单声明为准，其余任何红灯=不许交单。
