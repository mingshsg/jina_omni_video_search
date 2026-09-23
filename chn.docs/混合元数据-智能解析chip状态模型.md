# 混合元数据 — 智能解析 chip 状态模型（2026-09-23）

对应英文计划：`plan/05-parse-chip-state-model.md`；跟踪：`todo/21-parse-chip-state-model-2026-09-23.md`。
本文是决策摘要，不重复计划正文；行号以 2026-09-23 的 `live-video-search` 工作树为准，会漂移。

## 问题

用户反馈「Use as filter」时有时无。核对代码后结论：

- chip **已经**从 `meta.parse.extracted` 渲染（不是 `applied`），但只有 `boosting | unused` 两态。
  `unused` 把四种完全不同的原因揉在一起：候选池未命中（`no_effect`）、hybrid 未开（`hybrid_text_required`）、
  快照失败（`snapshot_unavailable`）、评估模式（`facet_mode=filter`）。用户分不清哪种情况下「用作筛选」有用。
- `promoteChip` 在写入 Facets 的同时还把字段压进 `suppress_extracted`。服务端 `boostsMinusHardFilters`
  本来就会因手选 facet 丢掉同字段 boost，这一步多余；副作用是用户之后手动清掉 facet，boost 也回不来。
- suppress 按**字段**记且跨查询存活：在 "Korean kissing" 上忽略 KR，再搜 "Japanese kissing"，JP 被静默压掉。
- 被忽略的 chip 直接消失，没有恢复入口。
- chip 推导逻辑在 `app/page.tsx` 里，`vitest.config.ts` 只收 `lib/**`，测不到。

关键澄清：`no_effect` 的意思是「本轮 **融合候选池** 里没有一个资产命中该 facet」，不是「片库里没有」。
boost 只能给已在池内的候选加权；硬筛会按 §D 重新全量枚举，把池外资产拉进来。
所以 `no_effect` 恰恰是「用作筛选」最有价值的状态。

## 决策

| 编号 | 决策 |
| --- | --- |
| 1 | chip 状态改为封闭枚举：`suppressed / hard_filter / filter_mode / hybrid_off / snapshot_unavailable / no_effect / boosting`，按此优先级推导 |
| 2 | 「用作筛选」不再写 suppress，去重交给服务端 |
| 3 | suppress 以 `field:value` 为键（年份用 `year`），提交的查询词变化即清空 |
| 4 | 「忽略」缩成 chip 上的 ×；被忽略项折叠为一行「已忽略 N 项 · 恢复」 |
| 5 | 点 chip 后自动重搜，加请求序号防乱序 |
| 6 | 服务端只做加法：`rejected[].reason` 新增 `hard_filter`；`suppress_extracted` 接受 `field:value`，单项长度上限 32 → 128；`applied/rejected` 结构不变 |
| 7 | `hard_filter` 状态的 chip 显示但无动作，改动入口统一在 Facets 面板（是否保留待观察） |

校验阶段就被拒的值（`not in catalog`、`out of range`、`not in candidate set`）不进 `extracted`，因此不出 chip，只留在「解析详情」。

## 各状态的 chip 表现

| 状态 | 视觉 | 动作 |
| --- | --- | --- |
| `boosting` | 实心 | 用作筛选 · × |
| `no_effect` | 空心 + 提示「当前候选中未命中」 | **用作筛选**（主动作）· × |
| `hybrid_off` | 空心 + 提示 | 用作筛选（硬筛不依赖 hybrid） |
| `snapshot_unavailable` | 空心 + 提示 | 用作筛选 · × |
| `hard_filter` | 带筛选图标 | 无 |
| `filter_mode` | 全部标为筛选，附「评估模式」说明 | 无 |
| `suppressed` | 折叠行 | 恢复 |

## 拆分（一个 PR 一个关注点）

- **PR-A** 修 bug，零契约改动：promote 不写 suppress；查询变化重置 suppress；请求序号。
- **PR-B** 状态机：`lib/metadata/parse-chips.ts` 纯函数 + 测试；`app/page.tsx` 按状态渲染；i18n。
  客户端先用 `field:value` 键，发送时映射回字段名，保证在 PR-C 之前可独立上线。
- **PR-C** 契约加法：`hard_filter` reason；`suppress_extracted` 值级；文档由「Planned」转正。

## 不做的事

不动 `w_facet`、RRF 常量、`deriveExtractedBoostEffects` 语义和现有 `hybrid-fusion.test.ts` 断言；
不动纯向量默认路径、以图搜片、直播检索；不改解析器、不加 LLM 调用；suppress 不跨页面刷新持久化。

## 验收

以 `yarn test`、`yarn build` 为基础 gate，另按 `plan/05` 的手工验证矩阵逐条跑并把结果记到 `todo/21`。
未跑的 gate 必须在 todo 里明写。
