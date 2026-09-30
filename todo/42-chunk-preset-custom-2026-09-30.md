# todo/42 — Chunk preset 调整与自定义（2026-09-30）

用户请求（2026-09-30 09:56–09:57）：

1. **20s preset 的重叠从 2s 改为 3s**
2. **新增 5s window / 2s overlap 的 preset**
3. **新增「自定义」选项**：允许操作者自行填写 chunk 秒数与 overlap 秒数

## 现状（已核实）

- `lib/ingest/chunk-presets.ts:44-51` 定义各 preset：
  - `'20s': { windowMs: 20_000, overlapMs: 2_000, minMs: 2_000 }` ← 需求 1 要改 `overlapMs: 3_000`
  - `'2s': 2s/1s`、`fine: 10s/2s` 等
- `CHUNK_PRESET_NAMES` 已含 `'custom'`（`:6-13`），但 **`IMPORT_CHUNK_PRESET_NAMES`（UI 暴露的）不含**（`:19-27`）——即后端支持 custom，前端 UI 未暴露。
- **后端 custom 通道已存在**：`resolveChunkingFromRequest()`（`:72-105`）接受 `window_ms` + `overlap_ms` +
  可选 `min_ms`，并在两者同时给出时走 custom 分支；仅 `chunk_preset` 时查表。
  校验：`windowMs > 0`、`0 <= overlapMs < windowMs`，否则抛 `INVALID_CHUNKING`。
  `min_ms` 缺省 = `min(4000, max(1000, floor(windowMs/5)))`。
- `app/ingest/page.tsx:815-823` 的下拉只列 `IMPORT_CHUNK_PRESET_NAMES`（6 个固定项），
  无自定义输入框；`:557/:577/:633/:652` 提交时只发 `chunk_preset`，不发 `window_ms`/`overlap_ms`。
- i18n 文案：`lib/i18n/ui.ts:213` `chunkPreset20s`；`en.ts:661` `'20s — 20 s window / 2 s overlap'`；
  `zh.ts:1122` `'20s — 20 秒窗口 / 2 秒重叠'`；help 文案 `en.ts:657`/`zh.ts:1118` 列了各 preset 的 w/o。
- 测试：`lib/ingest/chunk-presets.test.ts:76` 断言 `'20s'.overlapMs === 2_000`（**需求 1 会使其失败，需同步更新**）；
  `:107` 断言 preset 列表。
- 文档：`docs/api-contract.md:105,201` 列了 `20s (20s/2s)`；`README.md:68`。

## ⚠️ 影响与风险（需求 1）

`variant_id` 由 chunking **计入 hash**（`lib/ingest/variant.ts:50-56`：
`chunk_overlap_ms` / `chunk_window_ms` / `chunk_preset` / `chunk_min_ms` 都在 canonical payload 里）。
因此**改 20s 的 overlap 会产生新的 `variant_id`**：

- 已用旧 `20s (20s/2s)` 入库的资产，其 20s 变体会变成**孤立变体**（仍是合法数据、仍可搜索，
  但不再是 UI 当前 `20s` 选项对应的变体；UI 会显示为新变体，旧的只在按 variant 过滤时可见）。
- 这符合 AGENTS.md 硬不变量 3（provider identity 是 variant 的一部分；跨 variant 不得混向量），
  但**必须让用户知晓**：这是一次 variant 语义变更，不是原地修改。
- 缓解选项（待用户决定）：
  - (a) 直接改 `20s` 的 overlap（旧变体保留为孤立；最简单，符合当前用户请求）
  - (b) 保留 `20s (20s/2s)` 不动，**新增** `20s3` / 类似命名（避免孤立）——但与用户「change to」措辞不符
  - (c) 改 `20s` 并在文档/UI 注明该 preset 语义已变更

## 变更计划

### 1. 20s overlap 2s → 3s
- `chunk-presets.ts`：`'20s': { windowMs: 20_000, overlapMs: 3_000, minMs: 2_000 }`（minMs 维持 2s，避免连带改 stride 语义）。
- 更新 `chunk-presets.test.ts:76` 断言。
- i18n `en.ts:661`/`zh.ts:1122` 改为 `20 s window / 3 s overlap`；help 文案（`en.ts:657`/`zh.ts:1118`）同步。
- `docs/api-contract.md:201`、`README.md:68` 同步。

### 2. 新增 5s / 2s preset
- `chunk-presets.ts`：`CHUNK_PRESET_NAMES` 与 `IMPORT_CHUNK_PRESET_NAMES` 加 `'5s'`；
  `CHUNK_PRESET_DEFS` 加 `'5s': { windowMs: 5_000, overlapMs: 2_000, minMs: 1_000 }`。
- i18n 加 `chunkPreset5s`；help 文案补一项。
- 测试：preset 列表断言、def 断言。
- 文档同步。
- 命名待定：用户说「5 second chunk with 2 second overlapping」→ id 用 `5s` 还是 `5s/2s`？
  现有 id 约定是「窗口时长」（`60s`/`30s`/`20s`/`2s`），故建议 `5s`，与既有风格一致。

### 3. 自定义 chunk / overlap
- **后端无需改**：`resolveChunkingFromRequest` 已支持。
- 前端：`app/ingest/page.tsx`
  - preset 下拉加 `custom` 项（或在两处提交路径都支持 `window_ms`+`overlap_ms`）。
  - 选中 custom 时显示两个数字输入（窗口秒数、重叠秒数），可选 min。
  - 客户端校验：`window > 0`、`0 <= overlap < window`；服务端已有 `INVALID_CHUNKING` 兜底。
  - 提交：`fd.append('window_ms', ...)` / `overlap_ms` / 可选 `min_ms`（JSON 路径用 body 字段）；
    注意 `chunk_preset` 在 custom 时可不发或发 `custom`。
  - 进度/回显（`:1156`、`:1311`）要能显示自定义值（`formatChunkPresetLabel` 已支持传 window/overlap）。
- i18n：`chunkPresetCustom`、窗口/重叠输入标签、校验错误文案（EN/ZH）。
- 测试：custom 解析边界（window=overlap 应拒绝、overlap>window 拒绝、合法通过）；
  UI 逻辑尽量下沉 lib 便于测试。

## 阻塞与前置

**必须等 `codex/drama-enrichment-complete` 上的任务 E worker 完成**。原因：
- 任务 E（Edit metadata 提示框）正在改 `lib/i18n/ui.ts` / `en.ts` / `zh.ts`，
  与本任务的 i18n 改动**必然冲突**（同文件并发编辑会互相覆盖）。
- E 尚未提交（当前工作树仍有其 `lib/metadata/operator-hint.*` 等改动）。

E 完成后立即启动本任务。

## 未决问题（用户已决，2026-09-30 09:58）

| 问题 | 决策 |
| --- | --- |
| Q1：改 20s overlap 会产生新 `variant_id`、旧变体孤立 | **不改 20s**；**另新增**一个 preset（避免孤立变体） |
| Q2：新 5s/2s preset 的名字 | **`5s`**（与现有「窗口时长」命名风格一致） |
| Q3：自定义暴露几个字段 | **只暴露窗口 + 重叠两个字段**；`min_ms` 走缺省 `min(4s, max(1s, window/5))` |

### 由 Q1 决策引出的待确认项

用户原话是「20second chunk change to 3 second overlapping」，但 Q1 选了「不改 20s、另新增」。
因此需要明确**新增的那个 preset 叫什么、参数是什么**。两种可能：

- **P1**：新增 `20s/3s`（与 5s/2s 一起，两个新 preset 都体现「窗口/重叠」）
- **P2**：新增 `20s3` 之类的变体名，保持 `20s` 不动

另注意 Q2 已定新 preset 叫 `5s`（窗口风格命名）——若两个新 preset 都用窗口风格命名，
则「20s + 3s overlap」会与现有 `20s` id 冲突（同 id 不同参数），**必须用不同 id**。

**建议**：新增 preset id = `5s`（5s/2s）；「20s/3s」若确需保留现有 `20s` 不动，
则必须另起 id（如 `20s3`）或改用「窗口/重叠」命名风格（如 `20s_3s`）。
此项**待用户确认后再实现**。

## 最终确定的需求集（2026-09-30）

1. 新增 preset `5s` = 5s window / 2s overlap
2. 新增「20s window / 3s overlap」的 preset（**id 待定**，因不能复用现有 `20s`）
3. 新增 UI「自定义」选项：窗口秒数 + 重叠秒数（不含 min）
4. ~~修改现有 20s~~ —— **不做**（Q1 决策：避免孤立变体）

---

## 实现完成（2026-09-30，本 worker）

### B1. 新增 preset `5s`（5s / 2s）✅

- `lib/ingest/chunk-presets.ts`：`CHUNK_PRESET_NAMES` 与
  `IMPORT_CHUNK_PRESET_NAMES` 加 `'5s'`；
  `CHUNK_PRESET_DEFS['5s'] = { windowMs: 5_000, overlapMs: 2_000, minMs: 1_000 }`。

### B2. 新增 preset `20s_3s`（20s / 3s）✅

- id 定为 **`20s_3s`**（「窗口_重叠」命名，避免与现有 `20s` 冲突）。
- `CHUNK_PRESET_DEFS['20s_3s'] = { windowMs: 20_000, overlapMs: 3_000, minMs: 2_000 }`。
- **现有 `20s` 保持 20s/2s 不变**（Q1；避免孤立 `variant_id`）。
- `lib/config.ts` 的 `CHUNK_PRESET` enum 同步加入 `20s_3s` / `5s`。
- `app/api/ingest/route.ts`、`app/api/ingest/batch/route.ts` 已通传
  `window_ms`/`overlap_ms`/`min_ms`（既有代码），无需改。
- 穷尽性检查：`ChunkPreset`/`ImportChunkPreset` 由数组推导；
  `CHUNK_PRESET_DEFS` 是 `Record<ImportChunkPreset, …>`（typecheck 已强制穷尽）；
  `app/ingest/page.tsx` 的 `labels` 也是 `Record<ImportChunkPreset, string>`，
  已补两项；无其他 switch/map 需处理。

### B3. UI「自定义」选项 ✅

- `app/ingest/page.tsx`：
  - 新增类型 `ChunkPresetChoice = ImportChunkPreset | 'custom'`；
    state 改为 `ChunkPresetChoice`，另加 `customWindowS` / `customOverlapS`
    （默认 `20` / `3`）。
  - 下拉 `chunkPresetSelectOptions` 末尾追加 `custom` 项；选中时渲染两个
    `EuiFieldNumber`（窗口秒 / 重叠秒，**不暴露 min**），带内联 `isInvalid` + 错误文案。
  - 新增 `chunkingRequestFields()`（返回 `{chunk_preset}` 或
    `{window_ms, overlap_ms}`，非法返回 null）与 `validateChunkingClient()`
    （不合法则设 `clientError` 并**阻止提交**）。
  - 两条提交路径（single + batch，upload 表单与 JSON body）改用
    `...chunkFields` / `appendChunkingToFormData()`：custom 发
    `window_ms`+`overlap_ms`，非 custom 仍只发 `chunk_preset`（行为不变）。
  - 进度/回显：single 仍显示服务端 `workload.chunk_preset`；batch 汇总行改用
    `chunkingLabel(chunkingRequestFields())`，custom 显示 `custom · 20s/3s`。
- 客户端校验逻辑下沉到 lib 以便测试：
  `resolveCustomChunkingDraft(windowSeconds, overlapSeconds)`（`chunk-presets.ts`），
  整数秒校验 + `window>0 && 0<=overlap<window`。
- 服务端 `INVALID_CHUNKING` 仍是兜底。

### B4. 测试 ✅

- `lib/ingest/chunk-presets.test.ts`：`5s` / `20s_3s` def 断言；`IMPORT_CHUNK_PRESET_NAMES`
  列表断言（含 `custom` 不出现于 import 列表）；`resolveChunkingFromRequest`
  命名/未知预设；custom 边界（window==overlap 拒、overlap>window 拒、
  window<=0 拒、负 overlap 拒、合法通过、`min_ms` 缺省推导与显式覆盖）；
  `formatChunkPresetLabel('5s')` / `('20s_3s')`；variant_id 去重含 20s vs 20s_3s 不相撞；
  `resolveCustomChunkingDraft` UI 侧边界（空/小数/非数字/负数）。

### 文档同步 ✅

- `docs/api-contract.md`（`:105` workload 表、`:201` 字段说明）加入 `20s_3s` / `5s`。
- `README.md:68` `CHUNK_PRESET` 说明同步。
- i18n：`chunkPreset5s` / `chunkPreset20s3s` / `chunkPresetCustom` /
  `chunkPresetCustomWindowLabel` / `chunkPresetCustomOverlapLabel` /
  `chunkPresetCustomHelp` / `chunkPresetCustomInvalid`（`ui.ts` 类型 + `uiEn` + `uiZh`）；
  `INGEST_INVALID_CHUNKING` 文案补新 preset（`en.ts` / `zh.ts`）。

### 门禁

- `yarn test`（Node 22）：**98 files / 744 tests 通过**。
- `yarn build`（Node 22）：**通过**。
- **NOT RUN**：浏览器目视检查自定义输入与禁用态、真实 custom 导入的端到端
  `variant_id` 生成与搜索验证（容器禁令）。自定义 preset 的 `min_ms` 缺省
  `min(4s, max(1s, floor(window/5)))` 仅由单测覆盖，未经真实索引验证。


## 阻塞与前置

**必须等 `codex/drama-enrichment-complete` 上的任务 E worker 完成**。已核实 E 正在改
`lib/i18n/ui.ts`（+12 行），与本任务的 i18n 改动冲突。E 完成后立即启动本任务。
