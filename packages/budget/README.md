# @papercrew/budget · 预算闸

> 额度锁的**按量计费孪生**。定位是**保险丝，不是财务系统**。

## 为什么需要它

现有的成本刹车（`执行池.*.阈值` / `周阈值`、`额度.沟通保留`）比的都是订阅端点读回的
5h / 周 用量百分比。**API key 按量计费没有这个窗口**——`gates.poolLock` 对 key 池
永远算不出 `fivePct`，于是恒不锁。

结果是：「套餐用完降级到 key」一旦触发，**跑多少烧多少，唯一止损手段是人盯着**。
本包补上那一段。

## 接入方式：不改 `poolFrozen` 签名

刻意选的。本包产出的冻结结果由调用方**并进 `gatesInfo`**，于是池序降级
（`dispatch.routePool`）、编制快照可用性、UI 三处自动跟着走，**零额外接线**。

超预算与额度锁同级——都是「这个池现在一张都不许派」。

```js
const budget = require('@papercrew/budget');           // 或相对路径 require('<仓根>/packages/budget/budget.js')

// 记账：执行完把 usage 落账
const u = budget.usageOf(stdout洪流);                  // 从 stream-json 提取 输入/缓存/输出
if (u.输入 || u.输出) budget.记(root, { 池, 单, ...u });

// 用账：把冻结结果并进既有的 gatesInfo
const gi = budget.并入(gatesInfo, budget.冻结池(cfg, root));
```

## 红线

**未配预算的池永不被冻结。** 不配 = 不管，绝不臆造上限。测试里第一条钉的就是这个。

## 配置

```jsonc
{
  "预算": {
    "池": {
      "claude-key": { "日token": 2000000, "月token": 40000000 }
      // 也可配 日金额/月金额，但需要同时配价目表，否则金额口径自然失效
    }
  }
}
```

算不出费用时**不许判超**——宁可漏刹，不可误刹（误刹会让池序无故降级，比不刹更难查）。

## 计量口径与已知限制

- `输入` / `缓存` 取流中**最大值**（同一会话累进上报），`输出` **累加**；
- **codex 取不到 usage**：它不是 stream-json 输出，故 codex 池的消耗**不会被本包计入**。
  这不是 bug 是限制——所以 studio 侧 `runner.js` 对 codex 池一律不托管凭据并显式拒派，
  宁可响亮地拒，不要静默地跑错池；
- 厂商账单口径各异，本包只求**偏保守的估算**，宁可早刹一点。精确对账不在范围内。

## 测试

```
node test.js        # 12 项，零 app 依赖
```

消费方接线（冻结结构能否喂进 `dispatch.poolFrozen`、池序是否真的绕开超预算池）
测在消费方那一侧：`apps/studio/test/budget-接线.test.js`。
**包证明自己的输出形状，消费方证明自己接得住，各测各的那一半。**

## 归属

robinwang2 主导（口径 2）。本体住这里是唯一正本，消费方不复制粘贴分叉——
`apps/studio/lib/budget.js` 只是一行转发壳。
