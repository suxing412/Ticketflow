# 施工令-056 · enginectl 结果新鲜度自校

案源：坑档案「enginectl 陈旧结果假绿」（2026-08-11 22:05 TK-144 案：旧 results.xml 被读成本轮 523 全绿）。总监手工三步硬化（杀净/挪件/核 mtime）机器化。写区：`packages/enginectl/enginectl.js`＋测试。

## 要件
1. unity-test 起跑前记录起始时刻；收尾读 results.xml 时校验 mtime ≥ 起始时刻，否则 status=error（error=stale_results，绝不报数）；
2. 起跑时若旧 results.xml 在位，先挪至 enginectl-baselines/（带时间戳名），失败则报错不静默；
3. 输出 JSON 增 resultsMtime 字段供外部复核；
4. 测试：陈旧/新鲜/挪件失败三分支（文件系统可注入或用临时目录实测）；enginectl 现有行为零回归（unity-run/attach 不受影响）。

## 验收
逐条自证+测试绿；回执 工程队/回执-056.md；git 提交本令文件面；不打包。
