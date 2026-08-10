# 收货回执 · AI-DevPlatform

- 寄件：robinwang2
- 收件：总监 / 制作人 suxin
- 日期：2026-08-09
- 事由：《仓库总说明书》第一章「`apps/platform/` ← 旧零件盒【迁出至 AI-DevPlatform，**robinwang2 确认收货后删除**】」

---

## 一、结论：**收货确认，`apps/platform/` 可以删**

已克隆并跑通。并排布局按同级约定落在 `D:\AI-DevPlatform`（与 `D:\Ticketflow` 同级），
`../Ticketflow` 直接成立——**不需要挪仓，也不需要设 `TICKETFLOW_HOME`**。
（说明书举例写的是 `D:\GitHub\` 下并排，实际只要同级即可，此处如实记录以免后人误会。）

冒烟三项全绿：

| 端点 | 结果 |
|---|---|
| `/api/health` | `TICKETFLOW_HOME: "D:\Ticketflow"` 自动解析正确，桩模式 true |
| `/api/providers` | `来源: D:\Ticketflow\packages\providers` ——**跨仓消费真的通了**，codex adapter 已枚举 |
| `/api/watchtower` | 心跳「未见」（守护未启动，符合预期） |

`npm install` 零第三方依赖，秒完。

## 二、出厂清单核对（说明书 4.2）

| 项 | 状态 |
|---|---|
| `server.js`（:4370，health/watchtower/providers/providers.echo） | ✓ |
| `public/index.html` 一页仪表盘 | ✓ |
| `lib/` 五件原零件（orchestration/plan、routing/{router,history}、workspace/worktree、toolchain、review-opinion） | ✓ 六个文件齐 |
| `角色协议模板/` 六份 | ✓ |
| 瞭望塔预装（config + scripts/watchtower.js + npm 脚本） | ✓ |
| `main.js` 观览壳 | ✓ |
| `docs/`（边界与协作.md、接线说明.md、apps-platform-README.md） | ✓ |
| **`docs/README.md` 开机手册** | **✗ 缺**——说明书 4.2 列了它，实际目录里没有。开机手册内容在仓根 `README.md` 里，**大概率只是位置写错，不影响使用**，请确认是笔误还是漏放 |

## 三、留白项已自行接线（说明书 4.3）

**① `lib/routing/router.js` 的 registry 相对路径（已修）**

原样搬家留下的 `require('../../../../packages/providers/registry')` 从本仓 `lib/routing`
上溯四级已跑出盘符，必然 MODULE_NOT_FOUND。

处置：新增 `lib/公用件.js` 作为**跨仓消费的唯一入口**（并排约定 + `TICKETFLOW_HOME` 覆盖 +
失败时报人话错误并打印实际解析路径），`router.js` 改走它。
没有在 router 里复制一份 server.js 的解法——同一个约定写两遍必漂。

**② 新增契约测试（`npm test`，7 例全绿）**

公用件走文件路径消费、**没有 semver 锁**，对方合破坏性改动我们要到下次启动才炸，
中间零提示。这套测试就是那个提示：`git pull` 完跑一遍即知。

纪律是**只断言真正用到的东西**——多断言等于把对方的内部实现钉成契约，
会平白制造破坏性改动，那是越界。

其中一条是**依赖面清点**：扫全仓源码，断言对 `packages/` 的引用只有
`providers` 与 `watchtower` 两个包，多一个就红。依赖面变宽必须是显式决定。

## 四、发现一处真缺口（providers 侧，请安排）

`registry.list(null)` 抛 `Cannot read properties of null (reading 'providers')`。

根因：`registry.js` 的 `configs(cfg = {})` 默认参数**只对 `undefined` 生效，`null` 会穿透**。
`list()` 与 `list({})` 都正常，仅 `null` 崩。

影响面小（`server.js` 读配置已用 `读JSON(p, {})` 兜底，实际不会传 null），
所以本仓**不依赖** null 容错，契约测试里如实记成已知缺口而非伪造需求。
但它确实是缺口，修在 `packages/providers` 侧——那是双签区，等你安排。

## 五、两处提请注意

**① 重复配置点已确认存在**（说明书 4.4 已预告）：仓根与 `config/` 各有一份
`瞭望塔.config.json`。已知悉，改时两处同改。

**② 依赖面实测数据**——本仓对 Ticketflow 的**全部代码级依赖**：

| 位置 | 指向 | 状态 |
|---|---|---|
| `server.js:39` | `packages/providers` | 有 `TICKETFLOW_HOME` 覆盖 + 降级提示 |
| `lib/routing/router.js:3` | `packages/providers` | 本次已修，改走 `lib/公用件` |
| `scripts/watchtower.js:18` | `packages/watchtower` | 有 `TICKETFLOW_HOME` 覆盖 |
| `config/瞭望塔.config.json` ×2 | 仓清单 `../Ticketflow` | 配置项，非代码 |

**三处代码引用，两个包。** 而这两个包的主导方是：`providers`（robinwang2 主笔）、
`watchtower`（suxin 方主笔）。

也就是说：**本仓真正依赖对方主笔成果的，只有 `watchtower` 一个包**；
另一个是我方主笔、物理上寄放在贵仓。

---

## 六、提议：`providers` 正本归位（**与收货无关，可单独否决**）

先说清楚：**第一节的收货确认是无条件的**。`apps/platform/` 请随时删，
不以本节采纳与否为前提。以下只是顺势提出，被否掉我方照常按现状消费。

### 事实

`providers` 由我方主笔（说明书第三章），但正本物理上住在贵仓。而刚才清点发现：

> **Ticketflow 内消费 `packages/providers` 的地方，只有 `apps/platform/lib/routing/router.js` 一处
> ——而那个目录正是本次收货后要删除的。**

也就是说 `apps/platform/` 一删，**贵仓对 providers 的消费者数量归零**。
studio 不经过它（`lib/runner.js` 有自己的 `resolveCli`）。

包本身：5 个文件、172 行、自带 `test/`、零第三方依赖。

### 提议

`packages/providers` 正本迁至 AI-DevPlatform，贵仓若将来需要，走对称的并排约定反向消费
（或等命名空间定了统一 npm 化，见下）。

理由不是所有权，是**成本随时间单调上升**：现在搬，贵仓零消费者、零影响；
往后 studio 一旦长出消费点，再搬就变成「改对方整机内文件」，要走口径 3 的方案获批流程。
趁两边都无痛的时候把主导权和物理位置对齐，比拖到有痛点再谈划算。

### 我方预判的反驳，一并摆出来

说明书第三章写 providers 的消费方是「**双方**」。若 studio 已有计划把
`runner.resolveCli` 换成适配层，那搬走就是给贵方凭空制造一条跨仓依赖——
**这个反驳成立，届时应当否决本提议**。

若确有此计划，我方建议改走另一条：把「公用件唯一家 = packages/ 目录」
升级为「公用件唯一家 = 一个 npm registry」，两仓都 `npm install` 消费。
这同时解掉另外两个已知问题——相对路径无 semver 锁（我方已用契约测试临时顶住）、
以及打包态并排约定失效（说明书 4.2 自述）。
入口正好是第三章挂着的待议项：包名前缀不统一（`@papercrew` vs `@ticketflow`）。

### 请裁

三选一，我方都接受：**(A) 正本归位** / **(B) 维持现状**（我方已有契约测试，可长期运行）
/ **(C) 直接谈 npm 化**（先定命名空间）。

---

## 七、**急**：信道有个死结，这封信自己撞上了

### 现象

试图按 `docs/信道/README.md` 的「**git push 即投递**」投递本文书，被拒：

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Changes must be made through a pull request.
```

分支保护已生效（说明书 6.1 口径 5「将开启」= 已开）。**这封信只能改走 PR。**

### 死结

三份文件叠在一起：

| 来源 | 规定 |
|---|---|
| `docs/信道/README.md` | 「git push 即投递」 |
| `CODEOWNERS` | `/docs/ @suxing412` —— docs 整目录归贵方全权 |
| 说明书口径 5 | 作者提 PR → **对方批准** → 作者合并；分支保护强制 1 批准 |

合起来是：

> **我方要给贵方发信，得先由贵方批准这封信。**

信箱有了守门人，而守门人正是收件人。两个衍生问题：

1. **急件失效**。出事要通知对方，通知本身卡在等对方审批——而「急」这个级别存在的理由就是绕过等待。
2. **提醒本身需要信道**。若对方没注意到 PR，我方想催，催的动作还得再走一次同样的流程。

（缓解事实：PR 会经 CODEOWNERS 自动请求评审，GitHub 通知能到人。
所以现在的实际语义是「**PR 即投递**」而非「push 即投递」，只是比设计慢一拍——
要等批准+合并，瞭望塔才 fetch 得到。README 与现实已经不符，至少得改口径。）

### 三条解法（我方倾向 ①）

**① 给 `docs/信道/` 开 CODEOWNERS 例外**

```
/docs/           @suxing412
/docs/信道/                     # 双向信箱：投递不需要收件人批准
```

CODEOWNERS 后规则覆盖前规则，属主留空 = 不强制请求任何人评审。
语义也最准——**信箱不该有守门人**；文书内容的责任在发件人，不在收件人。
「历史文书不删不改」那条纪律仍由双方自律 + git 历史兜底，不靠审批把关。

**② 分支保护配 path 例外**，允许 `docs/信道/**` 直推 main。效果同 ①，但要动仓库设置而非文件。

**③ 信道改走 `dev` 分支**（`origin/dev` 已存在），瞭望塔仓清单盯 dev。
代价是信道与主干分离，历史两处看。

### 注意：这一轮绕不过去

`CODEOWNERS` 自身是双签区（`/CODEOWNERS @suxing412 @robinwang2`），
所以**改它同样要 PR、同样要贵方批准**。本轮只能按现流程走完，下一轮才顺。

### 附带建议

协议里补一条「**信道不可用时的兜底渠道**」（微信/邮件皆可）。
今天这个死结正说明：把唯一的通信手段架在受管控的主干上，它就会在最需要的时候不可用。

---

以上。`apps/platform/` 请随时删除，我方已完整接手。
