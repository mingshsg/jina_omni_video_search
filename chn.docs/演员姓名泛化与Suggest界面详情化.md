# 演员多语言姓名泛化 + Suggest 界面详情化（2026-09-23）

对应英文文档：[`plan/06-actor-name-generalization-and-suggest-ui.md`](../plan/06-actor-name-generalization-and-suggest-ui.md)、
[`todo/23-actor-name-and-suggest-ui-2026-09-23.md`](../todo/23-actor-name-and-suggest-ui-2026-09-23.md)。

## 背景

用户直接提出三个改进需求（非代码审查发现）：

1. **Agent 工具调用效率**：`jina.read_url` 支持 `question` 参数，只返回与问题相关的片段，
   比整页读取更省 token，也减少了未受信页面文本进入上下文的量（降低 prompt 注入面）。
2. **演员姓名字段泛化**：原来写死 `en/zh/ko/ja` 四个语言键，不够通用。改为
   `en`（必填）+ `zh`（可选，但不论演员国籍都建议尽量补全，方便中文用户）+
   `native`（可选，`{lang, name}`，演员本人母语文字，原样抄录，绝不重排/转写）。
   中韩人名的 `en` 字段依旧遵循姓在前、不加逗号的习惯写法（如 "Lee Jung-jae"）。
3. **Suggest 界面详情化**：之前每个字段只有一行挤在一起的 `helpText`，且——最关键的
   bug——如果字段已经有内容，后台建议会被**直接丢弃**，用户根本看不到。现在每个字段都
   展示完整证据（建议值、置信度、证据文字、可点击来源链接、抓取时间），并且哪怕字段已有
   内容，建议也会显示在字段下方的卡片里，配一个"+"按钮供采纳。

## 关键决定

- 不要求必须读 Wikidata，网页搜索即可。
- 工具调用预算允许略微增加：两阶段各 1 搜索 + 1 阅读——第一阶段（必做）确认作品身份；
  第二阶段（可选）仅在作品已唯一确认、且某演员仍缺 `zh`/`native` 名字时才启动。最坏情况
  仍是 2 搜索 + 2 阅读，但因为每次阅读都带 `question` 参数，单次成本比以前的整页阅读低。
- `native` 字段在与 `zh`/`en` 重复时应省略——只有在真正提供额外信息时才出现。
- 演员姓名专用的"仅限姓名场景"域名白名单额外开放百度百科、豆瓣、MyDramaList、
  HanCinema、AsianWiki——作品级事实（年份/国家/语言等）仍然只信任 Wikipedia/Wikidata/
  IMDb/TMDB。这是因为演员候选在写入前必须先精确匹配 `config/people.json` 的别名索引，
  低可信来源的风险可以接受。
- "+" 采纳按钮的语义：单值字段（年份/国家/语言/类型/简介/摘要）是替换；`tags` 是
  合并去重；演员候选保持原有加入逻辑不变，只是卡片更详细。
- 硬性不变量保持不变：已保存的字段内容永远不会被后台建议自动覆盖，只有用户主动点击
  （现在包括对已填字段点"+"）才会改变。

## 改动文件

`lib/metadata/people.ts`、`config/people.json`、
`lib/metadata/agent-builder-suggest.ts`（含测试）、
`lib/metadata/suggest-web.ts`（含测试）、
`components/EditMetadataFlyout.tsx`、`lib/i18n/ui.ts`、
`reference/agent-builder/skill-grounded_title_lookup.md`、
`scripts/ensure-suggest-agent.ts`、`docs/agent-builder-jina-suggest.md`。

## 验证情况

- `yarn test`：398/398 通过（62 个文件），在 schema 改动后和 UI 改动后各跑了一次。
- `yarn build`：通过，两次。
- `EditMetadataFlyout.tsx` 的诊断：无新增警告（只有改动前就有的、与本次无关的
  "Props must be serializable" 警告）。

## 明确没有做/没有验证的部分

- **没有**把新版 skill/agent 指令重新推送到线上 Kibana（本次会话没有凭据/网络访问）。
  需要用户自己运行 `yarn tsx scripts/ensure-suggest-agent.ts`，再跑
  `yarn tsx scripts/smoke-suggest-agent.ts` 确认线上 MCP 的 `read_url` 真的接受
  `question` 参数。
- **没有**做浏览器端的手工验收（"+"按钮点击效果、tags 合并去重效果、演员候选卡片的
  实际展示）。
- **没有**测量 `question` 参数是否真的降低了生产环境的 token 消耗/延迟——这只是基于
  工具描述文档的设计改动，不是已测量的验收指标。
- 顺带发现一份**与本次任务无关**、已经躺在工作区但尚未提交的独立代码审查产物
  （`reviews/hybrid-metadata-search-independent-code-review-2026-09-23.md` +
  `todo/22-...`），指出 `lib/es/hybrid-search.ts` 的 `msearch`/`retriever` 类型
  绕过问题（P1）。已单独提交（commit `de71234`），但**未在本次修复**，与本次任务
  范围无关，仅供用户知悉。
