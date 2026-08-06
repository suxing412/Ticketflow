# 施工令-009 · enginectl attach 模式 + 子集通道 + 基线归档（制作人 2026-08-06 23:59 批准）

设定考古（H86）：TK-49 案定死 enginectl 入口必须落仓内 shim（本单不动 shim，只改真实套件）；deploy-ritual 案定死取数禁 tail 截尾（结果仍以 results.xml 为准）；H67 两检与「质检全量走冷 batch 净室」并存不冲突。职权切割新决议：程序不跑测试，测试执行归审检；装配走静态方法。

## 范围（仓：D:\GitHub\Ticketflow，工区：套件/enginectl/ + 套件/执行技能模板/）

1. **attach 模式**：enginectl unity-test / unity-run 执行前探测活编辑器（读 TK 仓根 `.enginectl-attach.json` 端口发现文件 + loopback 握手）；有活编辑器→投递任务并等待结果（结果落盘口径不变：enginectl-results.xml / enginectl-run.log）；无→回落现有冷 batchmode。对接协议以 TK-103（编辑器内驻任务监听器）回执的「对接约定」节为准——该单在途，本单先按草稿协议实现（`{"type":"test","filters":[...]}` / `{"type":"invoke","method":"..."}`，final 行带 status），留一层薄适配以便对齐。
2. **--filter 子集**：unity-test 加 `--filter 类名1,类名2`（EditMode 测试类过滤，冷热两路都支持——冷路走 Unity -testFilter）。
3. **基线归档**：每次全量（无 --filter）成功落盘后，自动复制 results.xml 至 `enginectl-baselines/results-<UTC时间戳>.xml`（仓内目录，保留最近 10 份自动清老）；输出行报归档路径。
4. **契约分版**（套件/执行技能模板/）：pre-work/post-work 出程序版与审检版差异段——程序版：删「测试前台跑完」，改「dotnet build 静态自查 + 回执列受影响测试类清单」；审检版：按清单先跑子集、过了再全量定案（全量必冷 batch），unity-evidence 同步基线归档取数口径。模板改完 grep 验证。

## 不要做

- 不动 TK 仓（tools/enginectl.js shim、.claude/skills 由总监文书线处理）；不碰 AI-GameStudio。
- 不打包不提交。监听器未上线前 attach 探测必须静默回落冷路（探测失败零打扰）。

## 验收标准

- [ ] 无活编辑器时 unity-test/--filter/unity-run 全部走冷路照常（回归：真跑一次 --filter 子集与一次探测回落，取证输出）
- [ ] --filter 冷路生效：子集用例数与点名类实际用例数一致（以 TK 仓真类取证）
- [ ] 全量成功后 enginectl-baselines/ 出现带时间戳归档且只保留 10 份（构造 11 份验证清老）
- [ ] attach 探测：伪造 .enginectl-attach.json 指向假端口→静默回落冷路不报错；起一个假 TCP 服务按草稿协议应答→任务投递路径走通（模拟取证）
- [ ] 模板契约分版 grep 命中；`npm test`（apps/studio）全量 0 失败（本单不动 studio 但跑一遍护身）
- [ ] 完工纪要：改动清单+逐条证据+与 TK-103 对接的适配点说明
