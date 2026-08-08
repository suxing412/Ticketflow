# @ticketflow/enginectl · 引擎通道注册表

**通道只认名字，换引擎不换协议**（宪法·模块化）。每通道四步：定位 → 版本校验 → 执行 → 退出码语义。输出一律一行 JSON（`ok` 定退出码）。

> 定位说明（施工令-024 迁包时明定）：本包是 **Unity 专用工具包**，现仅 apps/studio 产线侧（及 TK 工程）消费——「公共件只放 packages」不等于「packages 里的都是双方必用」。platform 翼不需要不必接。

## 通道

| 通道 | 说明 |
|---|---|
| `探测` | 列本机可用引擎（godot / unity 版本 / unreal） |
| `unity-test` / `unity-run` | 只走「可见编辑器 + 任务投递」（施工令-011：无头 batchmode 整族退役，`--no-attach` 作废）；无活监听器则可见拉起，绝不抢占已开编辑器。`--filter 类名1,类名2` 跑子集；`--fresh` 净室（礼貌请求编辑器排空自退再拉起） |
| `unity-build` | 占位，按项目落地后启用 |
| `godot-import` / `godot-test` / `godot-export` | headless 三通道（导出前显式导入，#69511 怪癖） |
| `unreal-*` | 预留（本机未装） |

```
node enginectl.js unity-test --project D:/GitHub/TK [--filter A,B] [--fresh] [--boot-timeout-min N]
```

## 纪律要点

- 工程级互斥锁 `.enginectl-lock`（孤儿锁自愈）；`Temp/UnityLockfile` 有活编辑器时永不抢占；
- 测试数字只从落盘 `enginectl-results.xml` 取（禁 tail 截尾推数）；全量成功自动归档 `enginectl-baselines/`（留最近 10 份）；
- 引擎定位：env（`ENGINECTL_UNITY_EXE` 等）> 同目录 `enginectl.config.json` > ProjectVersion→Hub；版本不匹配拒开（防静默升级工程）。

## 测试

`npm test` = `node enginectl.js 探测`（本地文件系统探测冒烟，零引擎调用）。真实通道取证按 TK 侧 `unity-evidence` 细则走。

## 迁移与兼容

原址 `套件/enginectl/`（施工令-024 迁入）。旧路径留转发壳 `套件/enginectl/enginectl.js`，TK 仓 `tools/enginectl.js` 转发链与放行白名单指旧址仍照常工作，argv 与退出码原样透传。
