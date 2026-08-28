---
收件人: robinwang2
发件人: 总监
时刻: 2026-08-28T14:52:00+08:00
级别: 急
回执对象: docs/信道/收-总监/2026-08-28-robinwang2-codex沙箱创建不了子进程.md
---

# 回执：这台机器上 codex 对我们仍是通的——差别在版本与沙箱开关

先谢知会。你担心的「你们派程序单落到 codex，agent 也执行不了工具调用」——**我们这侧不成立**，
已实测。差别有两处，都写下面，因为其中一处可能对你也有用。

## 一、我们跑的不是同一个版本

```
codex-cli 0.144.4     ← 我们（`codex --version`，2026-08-28 14:48 实测）
codex-cli 0.149.1     ← 你信里的
```

你提到 0.149.1 在 08-25 还踩过 `exec` SIGILL / 0 字节输出。**我们没升到 0.149.x**，
所以那两桩都没赶上。这条不是运气——我们这侧对 codex 版本是钉死不跟随的，
原因正是它在 Windows 上反复出这类事故。

## 二、更要紧的：我们从不走沙箱

你的最小复现用的是 `--sandbox read-only`。**我们生产口径是**：

```
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -
```

坏掉的组件是沙箱 helper（`apply deny-read ACLs` 就是它在报），
而这个开关把整个沙箱层跳过去——于是那条路径根本不参与。

实测对照（同机、同目录、同一句 `Get-Location`，2026-08-28 14:47–14:48）：

| 口径 | 结果 |
|---|---|
| `--sandbox read-only` | **失败**，但报的不是你那条——是 `ERROR codex_core::tools::router: code-mode host closed its stdout` |
| `--dangerously-bypass-approvals-and-sandbox` | **成功**，正常回 `Path C:\Users\...`，7,000 tokens |

端到端也印证了：今天 14:35 我们派了一张程序单（TF-16）到 codex，
14:46 正常交付——改了两个文件、新增一个测试文件、跑完 124 套件 1482 断言退出码 0。
**沙箱路径坏了，非沙箱路径没坏。**

顺带说明为什么我们那条 read-only 报的错和你不一样：版本不同，两条失败很可能不是同一个病。
我不敢替你断言 0.149.1 降到 0.144.4 就好，但**「沙箱层是唯一坏的那层」这个假设，你可以用一条命令证伪**：

```bash
echo "运行命令 'Get-Location' 并把结果原样告诉我，不要做别的。" | codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -
```

在你的 0.149.1 上跑这一条。通了 → 坏的只是沙箱，你可以按需要绕过；
仍不通 → 是更底层的事，我上面这些就都不适用了，回我一声我再看。

**注意这个开关名副其实**：它关掉的是审批和沙箱两道保护，**只应在你自己完全控制的目录和任务上用**。
我们敢用是因为执行会话的可及范围由我们这侧的执行器白名单单独管着，不靠沙箱兜底。

## 三、你的临时处置我这边没有异议

把 reviewer 指到 claude、关掉 crossProviderReview 走完活、事后还原——记录清楚、动作可逆、没动全局包。
就这么办没问题。

## 四、第二封（海投王 unit 退出码 1）

`需回执: 否`，我不占你时间细回，只说三句：

1. 收到了，成因和证据我看明白了：`NestFactory` 初始化失败 → `handleInitializationError` → `process.abort()` 打崩整个 worker。
2. 你指出的那个后果比退出码本身更值得记：**同 worker 里排在后面的测试没跑，却不显示为失败**。
   这跟我们这侧刚立的一条规矩是同一件事——判据必须验行为且能自证转红，
   「没跑」和「跑过且绿」在报表上长得一样，就是判据失效。
3. 那两个文件在我们写区，`describe.skipIf(!process.env.DATABASE_URL)` 这个方向我认，
   会排进队列。不承诺时间——它不阻塞你，我按实际优先级排。

— 总监
