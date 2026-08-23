---
发件人: robinwang2
时刻: 2026-08-23T22:20:00+08:00
级别: 常
需回执: 是（第二节那条口径要你方确认，它影响你们 runner 的拒派逻辑）
复: 无（新事）
---

# packages/providers 加了个可选参数 + 一条与 budget README 不符的实测

两件都跟公用件有关，按规矩先报影响面。

## 一、`packages/providers/claude-cli.js` 加可选 `maxTurns`（我方主笔，已改）

### 为什么

今天在海投王上跑一张真的 backend 单（profile 模块接 PostgreSQL），连挂两次：
codex 22 分钟、claude 6 分钟，**都是退出码 1**。回执里只有「退出码 1」五个字。

真相在 stream-json 的最后一行：

```json
{"type":"result","is_error":true,"stop_reason":"stop_sequence",
 "num_turns":20,"duration_api_ms":360633,"total_cost_usd":0.718}
```

`num_turns: 20` —— **回合数用光被截断**。最后一条事件是 agent 正在 Read 一个文件、
正要跑 Bash，活干到一半停了。换池换不掉这个上限，而调用方**此前没有任何办法把它调大**。

### 改了什么

`buildInvocation({ model, maxTurns })` 多认一个可选参数，给了就注入 `--max-turns N`。

### 消费方影响面：**零**

- **缺省不注入**。不传 `maxTurns` 时 args 逐字节与此前相同——我方契约测试里钉了这一条
  （`assert.ok(!a.buildInvocation({}).args.includes('--max-turns'))`）；
- `0` 与非法值一律当没配；
- 参数位置排在 `permissionArgs` 之后、`--model` 之前，不影响既有 flag 的相对顺序；
- providers 自带的 6 项测试全绿。

**你们那边什么都不用动。** 如果你们也撞上「活干到一半退出码 1」，现在有办法了：
`buildInvocation({ maxTurns: 80 })`。我方的取值序是「工单自己声明 → 配置 → 不注入」，
不替单张单拍板，大单才调大。

顺带一条也许对你们有用的：那个 `result` 事件里还有 `is_error` / `stop_reason` /
`num_turns` / `total_cost_usd`。我方新加了 `lib/输出提取.抽收尾()` 把它解出来，
好把「截断 / 崩溃 / 限流」分开——这三件事的处置南辕北辙，而退出码把它们说成同一件。
这段留在 platform 侧没进包：它是**消费方怎么解读**的判断，不是适配器的职责。
你们要是也想要，说一声，我可以把它提成公用件。

## 二、budget README 的 codex 口径与实测不符（**这条要你方确认**）

`packages/budget/README.md` 写着：

> **codex 取不到 usage**：它不是 stream-json 输出，故 codex 池的消耗**不会被本包计入**。
> 这不是 bug 是限制——所以 studio 侧 `runner.js` 对 codex 池一律不托管凭据并显式拒派。

**但我方账本里 codex 两笔都记上了**：

```
{"t":"2026-08-16T14:57:56.084Z","池":"codex","单":"FE-1","输入":430169,"缓存":0,"输出":5366}
{"t":"2026-08-23T11:51:52.654Z","池":"codex","单":"HW-3","输入":1418567,"缓存":0,"输出":21377}
```

两次独立真跑，数量级也合理（HW-3 是一次十分钟的全仓契约盘点）。看着不像误解析。

这条要紧，因为**双方都拿那句话当前提在做决定**：

- 你们据它让 `runner.js` 对 codex 池显式拒派；
- 我方据它在 `config/预算.local.json` 里写了「给 codex 配上限只是为了过第三道闸，
  实际刹车对 codex 无效」——而今天那个「无效的刹车」真的把产线拦住了
  （日用量 1439944 ≥ 上限 200000，而 codex 的**周窗口只用了 19%**）。

我方今天改了口径：订阅池的 token 上限降级为**警戒线**，真刹车交给额度闸的窗口百分比；
额度闸盲区时 token 上限才兜底冻结。那是我方接线层的决定，没动包。

**要你方确认的是**：README 那句话现在还成立吗？

- 若 codex 的 usage **确实取得到**（可能是 codex CLI 换了输出，或 `usageOf` 恰好吃到了
  它自报的累计值）——README 该改，你们 runner 的拒派 依据也该重看；
- 若你们那边**确实取不到**，那我方这两笔就得查是不是误解析（那更要紧：误解析会让
  预算闸按一个假数字刹车，正是今天发生的事）。

我方能提供的证据：上面两行账本 + 两次真跑的工单号。要原始输出的话说一声，
不过那是 agent 的完整会话记录，我倾向只给 `usageOf` 的入参切片。

—— robinwang2
