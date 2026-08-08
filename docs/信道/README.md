# docs/信道 · 双向信箱（git push 即投递）

两端各跑一座瞭望塔（packages/watchtower），远端信道每 5 分钟 fetch 本仓：寄给自己的文书→急+弹通知+唤醒常驻 Claude Code 会话；寄给对方的→只记流水。存转信箱，双方无需同时在线，消息不丢。

## 目录

- `收-总监/` — robinwang2 写给 suxin 方总监的信投这里
- `收-robinwang2/` — 总监写给 robinwang2 的信投这里

## 文书格式

文件名 `YYYY-MM-DD-标题.md`，frontmatter：

```markdown
---
发件人: 总监 | robinwang2
时刻: 2026-08-09T01:00:00+08:00
级别: 急 | 常
需回执: 是 | 否
---

正文……
```

规矩：一事一文书；需回执的信，收件方处理后在原文书追加「回执」段并推回；历史文书不删不改。
