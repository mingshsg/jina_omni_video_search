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

- `yarn test`（Node 22）：**96 files / 710 tests 全部通过**（基线 94/687 → 新增 2 文件 23 例）。
- `yarn build`：通过（~123s）。
- 未跑的门禁：见 `reviews/README.md` 约定；本任务无新增 review 文件。

## 提交

- 环境：全程未触碰 Docker/容器；未向 `127.0.0.1:3000|3001` 发任何请求。
- 未提交：`reviews/suggest-metadata-editor-session-review-2026-09-23 (1).md`、`todo/32-suggest-metadata-editor-session-2026-09-23 (1).md`（历史遗留未跟踪文件）。
