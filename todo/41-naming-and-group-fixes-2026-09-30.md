# 待办与变更：命名、分组修复（2026-09-30）

用户请求（2026-09-30 08:51）：

1. `O_SpringOfTheBlade_iQIYI_BTS_3m28s_U5m0UgmU2kA` → **删除**
2. `75f1e202-ad61-470e-aab9-0d7cff56c067.mp4` → 改名为 `Q_ZhenHuanZhuan_EmpressesInThePalace_EP38_LetvOfficial_45m10s_xPic_NctWfg.mp4`
3. **单文件上传应保留原始文件名**（可重命名但需保留可识别名称），并**可用 Suggest 来命名**

## 根因（已核实，与代码/数据一致）

- `lib/ingest/paths.ts` `newMediaFilename()` = `` `${randomUUID()}${ext}` `` —— 存储路径丢弃原始文件名。
- `lib/ingest/job-store.ts:368-372` `createIngestJob()`：title 回退链是
  `input.title?.trim() || input.mediaPath.split('/').pop() || videoId`。
  上传路由（`app/api/ingest/upload/route.ts`）只在**显式传 `title` 表单字段**时才给 title；
  否则落到 UUID 文件名。
- 对比：`app/api/ingest/batch/route.ts` 的 `titleFromFilename()` 会去掉扩展名保留原名——单文件上传路径缺这一步。
- title 还被**冗余写入每个 chunk 文档**的 `video_title`（`lib/ingest/pipeline.ts:347`，`lib/es/indices.ts:174`），搜索结果从那里读（`lib/es/search-core.ts:172`）。所以重命名 asset title 时须同步 chunk。
- **补充（本次新发现）**：同一个缺陷也存在于 `app/api/ingest/route.ts` 的 `local` 与 `url` 两个单文件模式；URL 模式尤其严重——公开可读的 `provenance.source_origin_path` 本来就是 URL 末段文件名，却没用上，直接落到 UUID。

## 变更计划与执行状态

### A. 删除 O_ 资产 — ✅ 已执行（2026-09-30）

- `_id = 050f80a5-2ce6-420e-a9a9-ca2d66927a6e`，title 断言匹配后由 `removeAssetFromIndex` 删除。
- 结果：`deleted_asset: true`、`deleted_chunks: 208`（**连带删除 chunks**）。
- 磁盘文件保留：`/app/data/uploads/3e56d7ff-154b-4f77-9827-0d64eb280cd4.mp4`（NFR-5）。
- 验证：assets / chunks 中该 video_id 计数均为 0。
- 变更记录：`chn.docs/数据变更-命名修复-2026-09-30.md`。

### B. 重命名 75f1e202 资产 — ✅ 已执行（2026-09-30）

- `_id = 399fccc1-b2d0-4e76-a9e7-3dcc8e6e73ed`，title 断言匹配。
- `video-assets.title` + 2709 条 `video-chunks.video_title` 同步更新（`update_by_query`，painless 只写 `video_title`）。
- 未触碰：`media_path`、`variant_id`（`8b28281cd6671e40`）、`chunk_count`（2709）、`embedding_video`/`embedding_audio`（抽查 1024 维）、`meta.group_id`（`drama`）、`meta.revision`（1）。
- 验证：asset title 与 chunk `video_title` 唯一 bucket 一致；全库无残留旧 title。

### C. 单文件上传/导入保留原始名 — ✅ 已实现（代码）

- 新增 `lib/ingest/media-name.ts`（纯函数、可被客户端组件引用，不含 `node:fs`）：
  - `titleFromFilename()` —— 去扩展名保留原名（batch 里那份已删除，改共用此处）。
  - `resolveIngestTitle()` —— 显式 title 优先，否则用文件名。
  - `sanitizeFilenameStem()` —— 只取 basename、NFKC、非 `[\p{L}\p{N}._-]` 折叠为 `-`、`..` 不可能存活、按码点截断 80。
- `newMediaFilename(ext, originalName?)` 改为 `<sanitized-stem>-<12位随机hex><ext>`；无原名或 stem 为空时保持旧 `<uuid><ext>` 行为。
- 三个磁盘写入点均传入原名：`sources.ts`（upload、copyLocalToOriginals）、`url-fetch.ts`（URL 下载）。
- 三个单文件入口均补 title 回退：upload、`/api/ingest` local、`/api/ingest` url。
- `app/ingest/page.tsx` 进度面板预览同步用 `titleFromFilename`（原先上传显示带扩展名的原文件名、URL/local 显示带扩展名）。
- 测试：`lib/ingest/paths.test.ts`（18 例）覆盖 文件名→title、文件名→磁盘名（sanitized/唯一/保扩展名）、路径穿越、长度上限、显式 title 优先。
- 变更记录：`chn.docs/数据变更-命名修复-2026-09-30.md`。

### D. 用 Suggest 命名（任务 3）— ⛔ 未实现，待用户决策

**结论：现有 Suggest 不支持生成标题，不能在不新造引擎的前提下复用。**

- `POST /api/library/{videoId}/meta/suggest` 的请求体 schema（`suggest/route.ts:37-54`）**没有 title 字段**；它只能建议 `year / video_type / primary_language / country / description / abstract / tags / reference_urls` + `work_title`（从 web candidates 取）。
- `getAssetMetaEditorDto(videoId)` 要求 asset **已存在**（`asset-meta.ts:248` → `MetaNotFoundError`）。上传完成时 asset 已创建，所以端点可用，但：
- **无任何写路径能持久化显示标题**：`patchAssetMeta` 的 `EDITABLE_KEYS`（`lib/metadata/validate.ts:340`）不含 `title`；`AssetMeta` 里根本没有 `title`（`title` 是 ingest-owned，见 `lib/es/index-assets.ts:84` 注释「Editorial metadata — owned by PATCH /meta」）。
- 所以「一键接受建议标题」只能改**本地表单值**再让用户手动 Save —— 但那个 Save 不写 `title`，会静默失败，属于比「不做」更糟的半成品。

**发现的两个真实缺口**（若要做，必须先解决，均非本任务可擅自决定）：

1. **没有 title 写入通道**：需要新增一个 ingest-owned 的 `PATCH title`（同时同步 chunk `video_title`），并明确它是否碰 `meta.revision`。
2. **歧义写状态**：`meta.work_title` 与 ingest `title` 是两个字段，编辑后 `meta.revision` 会漂移。把 title 纳入 PATCH 会让二者语义重叠，需要产品决策。

**可复用的部分（若用户批准缺口 1）**：`app/api/library/[videoId]/meta/suggest` 已能对 `dto.title` 运行 `buildLocalSuggestions`，`title_clues.work_title` 可在上传完成后返回；`data.web.candidates[0].title`（仅 `status==='ok'`）已带 allowlist 校验，可作为建议标题。**不要在 upload 请求里同步调用**（会引入长时网络依赖）。

**不做的事**：本次未新增任何 Suggest 代码、未引入网络调用，也未把 Suggest 放上热路径。

## 验证

- `yarn test`（Node 22）：**97 files / 716 tests 通过**（F 新增 1 文件 6 例）。
- `yarn build`：通过（F 后 ~120s）。
- 未跑的门禁：见 `reviews/README.md` 约定；本任务无新增 review 文件。
  浏览器目视检查（tooltip 悬停渲染）与直连 ES 的 `listAssets` 冒烟
  **NOT RUN**（容器禁令）。


## 提交

- 环境：全程未触碰 Docker/容器；未向 `127.0.0.1:3000|3001` 发任何请求。
- 未提交：`reviews/suggest-metadata-editor-session-review-2026-09-23 (1).md`、`todo/32-suggest-metadata-editor-session-2026-09-23 (1).md`（历史遗留未跟踪文件）。

---

## D 节更正（2026-09-30 09:38，用户指出后核实）

D 节的「现有 Suggest 不支持生成标题」**表述有误**，它把两个不同的标题混为一谈：

| | ingest `title` | `meta.work_title` |
| --- | --- | --- |
| 来源 | 文件名 | **Suggest / 人工** |
| 结构 | 单字符串 | `{ en, zh?, native?{lang,name} }`（即 English/Chinese title） |
| 写入通道 | ingest-owned，`EDITABLE_KEYS` **不含** | ✅ `EDITABLE_KEYS` **含**（`validate.ts:349`） |
| 搜索结果显示 | 回退值 | **优先显示**（`app/page.tsx:133-139`） |
| Library 列表 | ✅ 显示 `item.title` | ✗ 不显示 |

**事实：Suggest 已经会产出并写入 work_title。** 证据
`components/EditMetadataFlyout.tsx:884-913`：从 allowlist 校验过的
`web.candidates[0].title`（仅 `status==='ok'`）自动填入 `workTitleEn`，
并把 `work_title` 标为 suggestion 来源；`PATCH /meta` 已支持写 `work_title`。

所以 D 节的「缺口 1（需要新增 PATCH title）」**对 work_title 而言不存在**。
它只在讨论「是否要改 ingest `title`（文件名那个）」时成立——而用户已决定
**不改**，因为文件名要保留作原始线索（呼应 D 节需求「文件名是重要信息」）。

### 用户决策（2026-09-30 09:38）

| 项 | 决策 |
| --- | --- |
| 新增 PATCH title | **否** —— 文件名 `title` 保持原样，作为原始线索 |
| 主动让 Suggest 生成中文 work title | **否** —— 改由**提示词控制**（即 E 的输入框） |
| Library 列表展示 work_title | **用 tooltip**（不替换主显示的 `title`） |

## 据此确定的两项工作

### F. Library 列表 tooltip 显示 work_title（小）— ✅ 已实现（2026-09-30）

- `lib/es/list-assets.ts` 的 `LibraryAssetSummary` 新增**加法**只读字段
  `work_title?: WorkTitle`（类型取自 `lib/metadata/validate.ts`），
  `toSummary` 从 `doc.meta?.work_title` 赋值，缺失则不出现该键；
  **未改动排序 / 过滤 / 分页**（`listAssets` 的 `sort` 与 `size` 原样）。
  不泄露 `meta` 下其他字段。
- `lib/metadata/work-title-display.ts`（新增，纯函数）：
  `workTitleTooltipLines()` 按 `en` → `zh` → `native.name (lang)`
  输出非空行，缺失/空白变体省略，无 `work_title` 返回 `[]`。
- `app/library/page.tsx`：标题单元格主文本仍是 ingest `title`（文件名），
  仅当 tooltip 行非空时用 `EuiToolTip` 包裹；无 `work_title` 时渲染路径与原先一致。
- i18n：新增 `workTitleTooltipLabel`（`lib/i18n/ui.ts` 类型 + `en.ts`/`zh.ts`）。
- 测试：`lib/metadata/work-title-display.test.ts`（6 例：仅 en、en+zh、
  含 native、空白省略、native 无语言、无 work_title）。


### E. Edit metadata 提示输入框（用户既定决策不变）

**状态：✅ 已实现（2026-09-30，本 worker 补完 UI）**

- **ephemeral**：仅本次 Suggest 运行有效，不落库、不新增资产字段。
- 作为 `POST /api/library/{videoId}/meta/suggest` 的**请求体字段**；
  job `cacheKey` **必须纳入**，避免 A 的提示命中 B 的缓存。
- **作用范围 search_and_output**：① 检索引导（如补剧名）② 输出语言。
- **优先复用现有参数**而非改 agent 契约：
  - 「剧名：X」→ 映射到既有 `work_title` 输入参数；
  - 「output in Chinese」→ 映射到 locale，从而影响 description/abstract 语言。
  - 若确需扩 agent 输入，须另行说明并评估对已部署 skill 的影响
    （`scripts/ensure-suggest-agent.ts`、`reference/agent-builder/*`）。
- **安全**：提示是操作者本人输入的合法引导，但仍按不可信数据处理——
  限长、转义、**独立参数通道**（不得与被检索页面内容同流），
  **不得借此绕过既有 source policy**（IMDb 等边界不变）。
  UI 需标明这是「操作者提示」，而非已核实的媒体标签/引用证据。

#### 实现落点（本 worker）

- `lib/metadata/operator-hint.ts`（新，纯函数）：`normalizeOperatorHint`
  （NFKC → 去控制字符 → 折叠空白 → 截断 200）、`resolveOperatorHint`
  （受标签约束的 `workTitle` 抽取 + `locale` 覆盖，歧义双语时弃权并记 `locale:ambiguous`）。
  仅把提示作为 **JSON 值**传给既有 `work_title` 输入，绝不拼进指令正文；
  未加标签的长散文不会被当成剧名（防止凭空编造作品身份）。
- `app/api/library/[videoId]/meta/suggest/route.ts`：请求体新增 `operator_hint`
  （`z.union([z.string(), z.null()]).optional()`，`transform` 走 normalize，
  **截断而非拒绝**）；`hint.workTitle` / `hint.locale` 纳入 `cacheKey`；
  通传 `operatorWorkTitle` 给 web/agent enrich。
- `lib/metadata/agent-builder-suggest.ts` + `suggest-web.ts`：向下传递
  `operatorWorkTitle`（不扩 agent 输入契约）。
- `components/EditMetadataFlyout.tsx`：`operatorHint` state + 提交时仅在非空时
  附带 `operator_hint`（不回填、不进 PATCH body）；**新增**渲染
  `EuiFormRow(label=metaOperatorHintLabel, helpText=metaOperatorHintHelp)`
  包裹 `EuiTextArea`（placeholder + `setOperatorHint`），位置在 work_title 区块
  之后、description 之前——与它引导的检索同区，但明确是 Suggest 输入而非资产字段。
- i18n：`ui.ts` 类型 + `uiEn`/`uiZh` 三键（`metaOperatorHintLabel/Help/Placeholder`）。
- 测试：`lib/metadata/operator-hint.test.ts`（标题抽取、语言覆盖、注入串、
  截断、控制字符、notes 不回显原文）；`agent-builder-suggest.test.ts` /
  `suggest-web.test.ts` 覆盖 `operatorWorkTitle` 传递。

#### 门禁

- `yarn test`（Node 22）：**98 files / 744 tests 通过**（含 B 的 9 例）。
- `yarn build`（Node 22）：**通过**。
- **浏览器验收 2026-09-30：PASS**（容器已重建，`20:04:06`；截图 `reviews/archive/browser-acceptance-2026-09-30/`）。`/library` 的「操作者提示（可选）」EuiTextArea 已目视确认：label「操作者提示（可选）」、help 文案（ephemeral、不写入资产、不是已核实证据）、placeholder「剧名：甄嬛传 · 用中文输出」、`rows=2`、宽度 672px；输入「剧名：甄嬛传」可正常回显（`t41-04-operator-hint.png`、`t41-05-operator-hint-filled.png`）。`建议填写` 按钮存在但**未点击**（避免真实 Agent Builder 调用）。
- **浏览器验收 F：work_title tooltip PASS**。悬停 `N_EarlySpring…` → tooltip「作品名称 / The Early Spring」；`K_MadeInKorea2…` →「作品名称 / Made in Korea (TV series)」；无 `work_title` 的 `Q_ZhenHuanZhuan…` 行只有行选择 tooltip、无标题 tooltip（`t41-01c`/`t41-01d`）。
- **NOT RUN**：真实 Agent Builder 端到端提示效果、`operator_hint` cacheKey 隔离的运行时验证（需要真实调用，本次刻意不触发）。
- 附带发现（与本任务**无关**，未修）：`/library` 浏览器控制台有 React hydration 报错 #418/#423。根因是 EUI `119.1.0` 的 `EuiBasicTable` 内部 `OverrideCopiedTabularContent` / `VisuallyHide`，在 1440×900 下渲染了服务端不存在的 `<span>`（开发模式 warning：`Expected server HTML to contain a matching <span> in <div>`）。用**空 `assets` 响应**即可复现，与 `work_title` tooltip、todo/40–42 均无关；属既有缺陷，仓库无可控开关（`EuiBasicTable` 硬编码该包裹层）。
