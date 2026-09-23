# 混合元数据检索 — Phase 3.6（EIS 解析）进度（2026-09-22）

## 已完成

- `QUERY_PARSER_*` 配置（超时 800ms、缓存、独立并发门闩）
- `client.inference.completion` 客户端；失败/超时回退字典；校验目录防幻觉
- 精确别名 / 无目录命中时跳过 LLM；解析结果 TTL 缓存
- 与解析并行的投机式全文 embed
- 标注集 over-trigger 门禁；`yarn probe-query-parser`

## 启用

1. 在 ES 创建 `completion` 推理端点（建议 `google-gemini-3.5-flash-lite`）
2. `.env`：`QUERY_PARSER_PROVIDER=eis` + `QUERY_PARSER_INFERENCE_ID=…`
3. `yarn probe-query-parser`

详见 `todo/10-hybrid-phase3.6-progress-2026-09-22.md`。
