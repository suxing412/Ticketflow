# @papercrew/quota · 额度解读件

> 拿到额度快照**之后**的那一半：窗口解析、百分比、label、重置时刻、守门判定。
> **纯函数、零 I/O**——不发请求、不读文件、不拉进程。取数归调用方。

施工令-059 自 `apps/studio/lib/quota.js` 迁出（应 robinwang2 请求，形制照 `packages/budget`）。
判定逻辑**一行未改**：迁移前后 studio 侧 `gates.poolLock` / `checkGate` 381 项对拍逐字节同结果。

## 为什么划在这条线上

`quota.js` 原本一半是取数（拉 codex `app-server`、发 claude OAuth usage 请求、刷 token、节流、缓存），
一半是解读（快照 → 窗口/百分比/该不该拦）。**只有后半可共用**：前半绑死 studio 的凭据布局、
节流盘、代理策略，platform 那边的取数方式未必相同，搬过去就是负担。

于是本包只收后半。两边各自取数、共用同一份解读——**判定不分叉**是这次提取的全部目的。

## 输入契约（快照形状）

包只认下面两种形状，字段对不上就当**没读到**（给空清单 / fail-open），绝不猜、绝不编数。

**codex 池** — `account/rateLimits/read` 回来的 `rateLimits`，主次两窗：

```jsonc
{
  "primary":   { "usedPercent": 77, "windowDurationMins": 10080, "resetsAt": 1786243868 },
  "secondary": { "usedPercent": 12, "windowDurationMins": 10080, "resetsAt": "2026-08-20T05:50:00Z" },
  "planType": "pro"        // 可选，只进 describe 文案
}
```

- **实机是单窗**：codex 现实只有周窗（`primary.windowDurationMins=10080`、`secondary=null`）。
  窗口 label 按 `windowDurationMins` 自报值算，**不写死「5小时」**（施工令-010 窗口正名）；
- `usedPercent` 缺失 = 没读数（不是 0）；`resetsAt` 收秒级/毫秒级时间戳与 ISO 串，三种都吃。

**claude 池** — OAuth `usage` 端点的双窗，字段名由取数方**改写成驼峰**后递进来
（端点原文是 `five_hour` / `seven_day`；`resets_at` 保持蛇形，那是窗口对象内部的原名）：

```jsonc
{
  "fiveHour": { "utilization": 30, "resets_at": "2026-08-07T05:50:00Z" },
  "sevenDay": { "utilization": 95, "resets_at": "2026-08-09T05:50:00Z" }
}
```

- 两窗各自独立成立：只有 5h、只有周、两个都没有，都是合法输入；
- 取数方额外挂的字段（studio 会挂 `更新于` / `陈旧` 标节流态）本包一律不看、不动。

**配置** — 只有 `gateOf` 读配置，只读 `cfg.quota` 一段：

```jsonc
{
  "quota": {
    "gatePercent": 80,          // 主窗阈值，缺省 80；显式设 0 = 关闭守门（恒放行）
    "costBufferPercent": 30,    // 单张工单预估消耗，缺省 30 → 有效拦截线 = min(80, 100−30) = 70
    "weeklyGatePercent": 90     // 周窗阀门，缺省 90
  }
}
```

`costBuffer` 不是保守癖：守门只在**派发瞬间**检查，不留余量就会 79% 放行、一单烧 30% 冲破 100%
（2026-07-06 实测每张 Unity 单吃 25~30%，TK-11-10 事故即此）。

## 输出契约

```js
const quota = require('@papercrew/quota');   // 或相对路径 require('<仓根>/packages/quota/quota.js')

quota.windowsOf(rl)        // codex 快照 → [{ label:'周', pct:77, reset:'05-07 12:11' }]（**实际存在**的窗口才出条目）
quota.claudeWindows(cu)    // claude 快照 → [{ label:'5小时', pct:30, reset:… }, { label:'周', pct:95, reset:… }]
quota.describe(rl)         // → ['周 已用 77%（05-07 12:11 重置）', '套餐 pro']　CLI / 日志用
quota.describeClaude(cu)   // → ['5小时 已用 30%（… 重置）', '周 已用 95%（… 重置）']
quota.windowLabel(w)       // 窗口 → '5小时' / '45分钟' / '周' / '窗口'（不自报时长时）
quota.fmtReset(v)          // 秒/毫秒时间戳或 ISO 串 → 'MM-DD HH:mm'（本地时区）；解不出原样吐回；null → '未知'
quota.gateOf(rl, cfg)      // 守门判定，见下
```

`gateOf(rl, cfg)` 返回：

```jsonc
// 放行
{ "allowed": true,  "threshold": 70, "snapshot": rl, "usedPercent": 69 }
// 拦下（主窗越线；周窗越线时 threshold 报的是周阀门、reason 换成周窗那句）
{ "allowed": false, "threshold": 70, "snapshot": rl, "usedPercent": 77,
  "resetAt": "2026-05-07T04:11:08.000Z",
  "reason": "周窗口已用 77%（拦截线 70%＝阈值与单张余量取严），05-07 12:11 重置" }
// 关闸（gatePercent 显式为 0）——三个字段，多一个都没有
{ "allowed": true, "threshold": 0, "reason": "额度守门已关闭" }
// 读不到（快照 null / 缺 primary / 缺 usedPercent）
{ "allowed": true, "threshold": 70, "snapshot": rl, "reason": "额度查询不可用，放行（fail-open）" }
```

双闸取严：主窗 `usedPercent >= min(gatePercent, 100−costBufferPercent)` 先拦；主窗没越再看
周窗 `>= weeklyGatePercent`——周额度烧穿会停摆数日，从严把守。比较一律是 `>=`（恰好等于就拦）。

**红线：fail-open。** 快照读不到就放行。守门查不着反把管线卡死，是比多烧一点更大的事故——
所以调用方**必须自己**处理「读不到」这一态（界面如实标盲区，别把 fail-open 显示成「额度充足」）。

## 不做什么

- **不发请求**：codex `app-server` 怎么拉、claude usage 怎么查、token 怎么刷、代理怎么定——全归调用方；
- **不读文件、不写文件**：凭据、节流盘、缓存、配置**落盘**都在外面。`gateOf` 收的是已经读好的 cfg 对象；
- **不管节流与限流**：oauth 端点有账号级限流（2026-07-11 两次 429 的教训），间隔/退避/持久化是取数方的纪律；
- **不做池的调度**：「哪个池锁了、要不要降级到下一个池」是消费方的事。studio 侧 `gates.poolLock` 用的是
  **每池独立**的 `执行池.<池>.阈值 / 周阈值`，它只吃本包的 `windowsOf` / `claudeWindows` 两个窗口清单，
  不走 `gateOf`——两套阈值口径并存是历史现状，本包如实提供两种入口，不替消费方选；
- **不缓存、不看时钟**：同输入恒同输出（包自测里有一条钉这个）。`fmtReset` 按**本地时区**格式化，
  跨时区显示差异归调用方决定要不要改口径。

## 消费方

- **studio**：`apps/studio/lib/quota.js` 是薄壳——取数那一半留在壳里，七个纯函数原样转发，
  消费方 `require` 路径与调用名一个没变。包解析走三候选（仓内相对 → `TICKETFLOW_PACKAGES` →
  `studio.config.json · packages路径`），全失守落**空实现**并响亮报警（控制台 + journal + 失效位），
  代价是那段时间额度锁恒不锁——见 `apps/studio/test/quota-接线.test.js`；
- **platform**：怎么接归你方（`lib/公用件` 那条路，budget 时的默契照旧）。本令**不代接线**。

## 测试

```
node test.js        # 16 项，零 app 依赖
```

消费方接线（壳转发是否同源、gates 是否真拿包里的窗口去锁池、三候选与失效响亮化）
测在消费方那一侧：`apps/studio/test/quota-接线.test.js`（11 项）+ 既有 `gates.test.js`（9 项，一字未改）。
**包证明自己的输出形状，消费方证明自己接得住，各测各的那一半。**

## 归属

robinwang2 请求、suxin 方迁移。本体住这里是唯一正本，消费方不复制粘贴分叉——
`apps/studio/lib/quota.js` 里那七个名字只是转发。
