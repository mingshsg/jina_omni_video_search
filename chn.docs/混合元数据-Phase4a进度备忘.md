# 混合元数据 — Phase 4a（本地 Suggest）进度（2026-09-22）

## 已完成

- 本地线索：标题中的明确年份、类型词；语言仅在有显式 `media_language` 时建议
- `POST /api/library/{videoId}/meta/suggest`：只返回草稿，不写库
- 资料库「编辑元数据」增加「建议填写」：只填空字段，不覆盖已填；保存可带 `suggestion` 溯源

## 未做（4b）

- 基于片名的外部目录检索 / 生成描述
- 演员、国家自动推断

详见 `todo/12-hybrid-phase4a-progress-2026-09-22.md`。
