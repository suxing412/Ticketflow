# @ticketflow/watchtower · 瞭望塔

会话外**统一监视守护**（施工令-018 立项，023 添远端信源，024 迁包并添心跳戳）：一个常驻 node 进程收口全部信源与定点唤起，与总监会话 / VPN / CLI 生死解耦。单文件、零依赖（node 内置模块 only）。

## 五路信源 → 三个输出

| 信源 | 说明 |
|---|---|
| ① 流水 | tail 部署区 `journal/<当月>.log`，月切自动跟随 |
| ② 信箱 | tail 部署区 `呼叫/inbox.jsonl`（一行一 JSON） |
| ③ 时钟 | 规则表定点唤起（晨报/晚报/切夜班等） |
| ④ 心跳 | 定时探监制台 `/api/board`，失联/恢复各报一次 |
| ⑤ 远端 | 对仓清单 `git fetch --all --prune` 只侦察不合并；信道文书（docs/ 下带 交接/回执/信道 的 md）升急 |

输出全落 `<部署区>/瞭望塔/`（本进程唯一写区）：

- `瞭望塔流水.log` —— 统一事件流，一行一事件带信源标（会话唯一 tail 对象）；
- `未读账本.jsonl` + `账本水位.json` —— 会话不在场的积压与已读线（`--unread` / `--ack`）；
- `心跳.txt` —— **在岗活体信号（施工令-024）**：每 30s 覆盖写一行 ISO 时刻，`--status` 有心跳段（`秒龄`/`在跳`），供监制台在岗灯做数据源。

## 常用命令

```
node watchtower.js [--root <部署区>] [--config <瞭望塔.config.json>] [--rules <规则.json>]
node watchtower.js --status | --unread [--limit N] | --ack <ISO|毫秒|all> | --toast-test
node watchtower.js --install [--task-name 瞭望塔] | --uninstall
```

配置模板见 `瞭望塔.config.template.json`；规则模板见 `规则.json`（含**信箱目录分拣**两条停用示例，`<本方名>` 换名启用）；给协作者的部署一页见 **`接线说明.md`**。

## 测试

```
npm test          # 全量（单元 + 端到端，含真实跨分钟时钟，约 2min）
npm run test:fast # 跳过跨分钟等待
```

端到端一律在系统临时目录造假部署区，通知走 `WATCHTOWER_TOAST_FILE_ONLY=1` 落文件，远端用本地 bare 仓当假 origin——**真部署区/真远端一个字节不碰**。

## 迁移与兼容

原址 `套件/瞭望塔/`（施工令-024 迁入）。旧路径留转发壳 `套件/瞭望塔/watchtower.js`，计划任务/白名单/换装脚本指旧址仍照常工作，argv 与退出码原样透传。
