---
发件人: robinwang2
时刻: 2026-08-23T17:10:00+08:00
级别: 常
需回执: 是（第三节有一个要你方拍板的口子）
复: 2026-08-18《packages/quota 已落包》
---

# packages/quota 已接线（协-018）+ 三条口径 + 一个要你方拍的口子

包落地五天，我方今天接完。先谢一句：`gateOf` 你没等回信就先放进包里是对的——
platform 这边真接的时候，需要的正是「判定不分叉」那一条，自己再写一遍双闸取严只会分叉。

## 一、接线形制（照 budget 默契，包一个字未动）

- 判定件 `lib/额度闸.js`：**纯**，消费 `packages/quota` 的 `gateOf` / `windowsOf` / `claudeWindows`；
- 取数件 `lib/额度取数.js`：codex `app-server` + claude OAuth usage，**引 `child_process`**；
- 两者**分进程**：我方 `server.js` 有一条传递闭包断言钉死「依赖闭包里不得出现 `child_process`」
  （桩模式是物理保证），而 codex 的额度只能靠拉起 app-server 拿。于是执行器进程定期取数落
  `journal/额度快照.json`，server 与派单**只读盘**。这条约束你们那边没有，纯属我方形状；
- 判据接入**不改 `冻结情况` 签名**：额度冻结与预算冻结并进同一个 `挡` map，
  于是池序降级、编制快照可用性、`/tick` 归因三处零额外接线——**这就是 budget 当初留下的先例的价值**。

**实跑实证**（不是干说）：

- codex 真读到了：`周 已用 19%（08-27 17:01 重置）`，`planType: plus`；
- 把快照改成 96% 灌回去，`/api/roster` 当场变成
  `冻结: {"codex":"额度闸：周窗口已用 96%（拦截线 70%＝阈值与单张余量取严）…"}`，
  编制里 codex 的池态转 `冻结:true`，`首个可用` 顺位落到 claude。传导链是通的；
- 全量 `npm test` 242 项绿（新增额度契约 18 项）。

## 二、三条口径

### ① `gateOf` 只吃 codex 形状——claude 双窗进不去（建议进包）

`gateOf` 读的是 `rl.primary` / `rl.secondary`，而 claude 快照是 `{fiveHour, sevenDay}`。
**claude 池根本进不了这个判定**，而它的表现是「claude 永远不被额度锁」——
跟「claude 额度充足」长得一模一样。你们那边没撞上，是因为 `gates.poolLock` 走
`windowsOf` / `claudeWindows` + 每池阈值，压根不经过 `gateOf`。

我方在 `lib/额度闸.归一()` 里补了映射，判定结论仍逐字来自你们的 `gateOf`：

```js
// claude 双窗 → gateOf 认得的形状。窗口时长按 windowLabel 的口径填，label 不会说错话。
function 归一(u) {
  const 窗 = (w, mins) => (w && w.utilization != null
    ? { usedPercent: Number(w.utilization), windowDurationMins: mins, resetsAt: w.resets_at } : null);
  const primary = 窗(u.fiveHour, 300);
  const secondary = 窗(u.sevenDay, 10080);
  if (!primary && !secondary) return null;
  // 只有周窗读得到时把它放 primary：gateOf 缺 primary 直接 fail-open，
  // 照原位放会把一条**读得到的**周窗读数当成「查询不可用」白白丢掉。
  return primary ? { primary, secondary } : { primary: secondary, secondary: null };
}
```

**建议它进包**（叫 `claudeAsRateLimits` 之类）：留在两个消费方各写一遍，
判定还是会分叉——而分叉正是这次提取要消除的东西。代码在上面，你直接拿走即可，我方不提 PR 动你的包。

### ② 两套阈值口径：我方选全局 `cfg.quota` 那一套

包 README 如实记了「`gateOf` 用全局一套、`poolLock` 用每池 `执行池.<池>.阈值`」。
platform 选 `gateOf`。池的差异在我方这边由**计费模式**表达，不由阈值表达：

| 计费模式 | 谁来刹 |
|---|---|
| 订阅 | 额度闸（本次接的这道，5h/周 窗口百分比） |
| api | 预算闸（`packages/budget`，token 上限） |
| 本地 / 未声明 | 额度闸不管（未声明的从严发生在计费那一侧） |

这也顺带补上了我方一个自己写在配置注释里、心知肚明的漏洞：此前给**订阅池**配
`预算.池.<池>.日token` 只是为了过真跑第三闸，而 codex 的用量根本不进 budget 的账——
等于给订阅池装了个假刹车。真正会把人停摆几小时的是窗口烧穿，那个数我方在今天之前一次都没读过。

### ③ 无异议

`fmtReset` 走本地时区、`gateOf` 的 fail-open 红线、「包只证明输出形状、消费方证明自己接得住」——
三条都合用，按原样消费。

## 三、要你方拍板的口子：claude 的 token 谁来刷

**我方定死了一条纪律：platform 只读 `~/.claude/.credentials.json`，绝不写。** 理由两条：

1. `refresh_token` 是**轮换**的。你们的 `refreshClaudeToken` 会把新的一对原子写回去；
   platform 若也刷，谁后刷谁就把对方手里的 refresh 顶掉——而表现只是「额度偶尔读不到」，查起来极难；
2. usage 端点有账号级限流（你们 2026-07-11 吃过两次 429）。两个产品各有各的节流盘、
   互不知情，合起来的实际频率是两倍。我方节流默认取 600s（你们 300s），也是同一个理由。

**代价现在就已经现形了**：本机 `expiresAt` 停在 `2026-08-16T22:29:45Z`，早过期。
于是 platform 侧 claude 池**今天是彻底的盲区**——界面如实标着「盲区：这些池此刻没有额度刹车，已放行」，
但那终究是没有刹车。codex 那一口不受影响（本地 app-server，零请求无限流）。

两条出路，我方都能接，**归你方拍**（你是刷新那一侧的主人）：

- **甲｜你们把最后一次好读数落到一个约定路径**（你们节流盘里本就有 `lastGood`）：
  platform 只读那份快照，零请求、零刷新、零轮换风险，新鲜度由我方按 `快照弃用秒` 自行处置。
  这条最省事，但要把「那个文件是对外契约」写进 `packages/quota` 的取数说明——
  否则我方等于伸手进你们的内部实现，那是我方不该做的事，所以在你点头前我一行都没写。
- **乙｜约定单一刷新方 + 文件锁**：谁都能刷，但拿锁再刷。比甲复杂，好处是 studio 没在跑时
  platform 也能自己续上。

我方倾向 **甲**：刷新这件事有一个主人比有一把锁更省心，而 platform 本来就不该碰你们的凭据。

## 四、消费方影响面

- `packages/quota` **一个字未动**（本信提的归一化是建议，代码在上面，动不动由你方决定）；
- 我方对公用件的依赖面 `providers / watchtower / budget` → **加 `quota`**，四个包。
  契约测试里那条「依赖面变宽必须是显式决定」的断言已同步更新，并注明了理由；
- 我方新增消费面：`gateOf` / `windowsOf` / `claudeWindows` / `fmtReset` 四个。
  其余三个（`describe` / `describeClaude` / `windowLabel`）暂未消费——按「只断言真正用到的东西」的
  纪律，我方契约测试不钉它们，你要改那三个不必知会我方。

—— robinwang2
