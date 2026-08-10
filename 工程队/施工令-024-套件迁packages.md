# 施工令-024 · 存量套件全迁 packages/（制作人 2026-08-08 23:14 立规、23:53 令夜班先行）

立规原文：「存量的套件全扔 package 吧，这个就确定公共件之后只放在 package 里」。

## 范围

### 一、五件迁入（git mv 保历史）

| 旧址 | 新址 | 包规范化 |
|---|---|---|
| `套件/enginectl/` | `packages/enginectl/` | package.json + README（Unity 专用工具包，仅 studio 消费，公共件≠双方必用） |
| `套件/评审台/` | `packages/review-panel/` | package.json + README + 既有测试可 `npm test` 跑 |
| `套件/瞭望塔/` | `packages/watchtower/` | package.json + README + test.js 147 例照跑 |
| `套件/执行技能模板/` | `packages/skill-templates/` | README 注明「通用契约核+产品叠加层」结构 |
| `套件/岗位协议模板/` | `packages/role-protocol-templates/` | README 注明只留机制模板，协议正本各家私域 |

### 二、旧路径留转发壳（换装前的命门，不许省）

- `套件/评审台/review.js` → 一行 shim `require('../../packages/review-panel/review.js')` 风格转发（含 CLI 直跑透传 argv）：**放行白名单指着旧路径，监制台重启前执行器还要用**。
- `套件/enginectl/enginectl.js` 同款 shim（TK 仓 `tools/enginectl.js` 转发链与我会话的三条白名单路径都指旧址）。
- `套件/瞭望塔/watchtower.js` 同款 shim（部署区当前守护不受影响，但换装脚本/文档可能引用旧址）。
- 模板两件是纯文档，旧目录各留一个 `已迁移.md` 指路即可。

### 三、瞭望塔迁入时顺手三件（当晚制作人拍板的新需求）

1. **心跳戳**：守护每 30 秒把 ISO 时刻写 `<出口>/心跳.txt`（覆盖写，一行）；`--status` 增心跳段。给监制台在岗灯（另单）做数据源。
2. **信箱分拣规则模板**：`规则.json` 与 config 模板增「信箱目录分拣」示例——远端信道对 `docs/信道/收-<自己>/` 触文→急+弹通知；`收-<别人>/`→只记流水。以「本方名」配置项区分，默认注释态不启用（避免影响现网）。
3. **接线说明.md**：写给协作者的一页——装守护（--install 自启）→ 常驻 Claude Code 会话挂 Monitor 盯统一流水 → 信箱收发约定。照我现网同款配置写，不发明新机制。

### 四、全量引用清扫（grep 证据留纪要）

- Ticketflow 仓内：`grep -rn "套件/" --include="*.js" --include="*.md" --include="*.json"`，逐处改指 packages 新址（工程队历史施工令原文**不改**，历史文书保持原貌）。
- `D:\GitHub\AI-GameStudio` 内引用（brain 提示词/章程/换装脚本/config）：**只列清单不改**，输出「待换装清扫清单」到完工纪要——那边改动随 0.26.2 换装流程一并做（config 是 boot-loaded，改了也要重启才生效，攒批）。
- `D:\GitHub\TK`：只列清单不改（shim 兜住了）。

### 五、验收标准

- [ ] 五件在 packages/ 下 git log --follow 历史连续
- [ ] 三个 shim 实测：`node 套件/评审台/review.js --help`（或等价 dry 命令）、`node 套件/enginectl/enginectl.js --status`、`node 套件/瞭望塔/watchtower.js --status` 全部照常工作
- [ ] `packages/watchtower` test 全绿（147 例基线+心跳戳新例）；review-panel 既有测试全绿；apps/studio `npm test` 335 套件基线不回归（35 套件 334 例）
- [ ] 心跳戳实测：起守护（隔离出口目录，别碰部署区）30 秒内心跳文件出现且刷新
- [ ] 引用清扫 grep 前后对照 + AI-GameStudio/TK 待改清单
- [ ] 不 commit（总监验收后统一入库）、不打包、不动部署区在岗守护（pid 勿杀）、不碰 AI-GameStudio 与 TK 的任何文件

## 不要做

不删 apps/platform；不动 packages/providers 与 packages/core；不发任何网络请求；起任何服务前先桩（前车之鉴：021 取证事故）。
