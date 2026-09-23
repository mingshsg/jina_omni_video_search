# 混合元数据检索 — Phase 1 实现备忘（2026-09-22）

对应计划：`plan/03-hybrid-metadata-search-plan.md` / `chn.docs/混合元数据检索规划.md`。

## 已完成

- 分析器探针：Serverless 上 `cjk` / `nori` / `smartcn` / `icu` / `phonetic` 均可用；映射冻结为 `standard` + `meta.search_text.cjk`
- `config/people.json` 人物目录 + `lib/metadata/*` 校验与别名展开
- `video-assets` 增加 `meta.*`；`yarn setup-indices` 可幂等升级已有索引
- Ingest 改为部分更新，不再整文档覆盖，保留编辑过的 `meta`
- `GET /api/library/{id}`、`PATCH /api/library/{id}/meta`、`GET /api/metadata/catalogs`
- Library「编辑元数据」抽屉（国家/地区 20 项、演员仅能选自目录）
- Dockerfile 复制 `config/`

## 下一步（Phase 2）

- 搜索侧 `filters.actor_ids` 等 facet + 就绪变体 ID 枚举
- 镜像内验收 catalog 加载与元数据保存
