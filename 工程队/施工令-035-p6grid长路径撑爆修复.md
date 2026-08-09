# 施工令-035 · 参数页长路径撑爆 p6grid 修复（2026-08-09 15:58 立单，034 勘察遗留件）

案源：034 施工期发现的潜伏病，明令留单另办。症状：#/params 注册路径超长（100+ 字符）时 `.p6grid` 双列网格撑爆（实测 870px 视口内列宽 100px+1189px，文档宽 1369）、全页横滚。

根因：`flex:1` + `white-space:nowrap` + `overflow:hidden;text-overflow:ellipsis` 只配 `min-width:0`——`min-width:0` 管自动最小尺寸，**管不住 nowrap 的固有 min-content 贡献**，串宽一路顶穿 flex 容器传给网格列。修法=显式 `width:0` 配 `flex:1 1 0`（034 已在 `.credrow .cr-stat` 落过同款，复制其修法与注释体例）。

## 范围（仅 public/style.css）

1. 已知病灶两处，**先量后修**（不许盲贴）：`.prow .pv`（约 :123，项目注册卡）、`.envcard .ev`（约 :755，环境探针卡）；
2. 同病全查：style.css 内 `flex:1`+`nowrap`+ellipsis 组合逐一排查，凡只有 `min-width:0` 者同批修并列清单；
3. **度量取证**（桩台注册一条 120+ 字符长路径）：修前复现 `gridTemplateColumns` 爆列与 `scrollWidth>clientWidth`；修后文档宽=视口宽、且省略号仍在渲染（`el.scrollWidth > el.clientWidth` 为真）；
4. 双主题+860px 复查；`npm test` 全量零回归（基线以 034 落库后为准）。

## 不要做

前端 only；不动 server/数据面；不 commit 不打包；与 034 串行（其落库后开工）。

## 验收标准

- [ ] 修前/修后度量对照表（gridTemplateColumns/文档宽/省略号三项）
- [ ] 同病排查清单（修了哪些、哪些确认无病）
- [ ] 全量测试 0 失败；完工纪要逐条证据
