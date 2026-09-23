# Agent Builder — grounded title lookup (Jina MCP)

Date: 2026-09-23. Product path for Edit-time Suggest:

**Library web page → `POST …/meta/suggest` creates a job → browser polls `GET`
for progress → background Kibana Agent Builder `converse` → agent tools
`jina.search_web` / `jina.read_url`.**

Cursor IDE must **not** connect to Jina for this feature. The app does **not**
need `JINA_API_KEY` for the product path (key stays in the Kibana MCP connector).

Companion: [`plan/04-internet-grounded-metadata-suggest.md`](../plan/04-internet-grounded-metadata-suggest.md).

**Live artefacts** (validated export of agent / skill / assigned tools):
[`reference/agent-builder/`](../reference/agent-builder/). Refresh with
`yarn download-agent-builder-artefacts`.

## Runtimes

| Runtime | Role |
| --- | --- |
| **App Suggest (product)** | Next.js job → Agent Builder converse → Jina MCP tools |
| **Jina REST (`SUGGEST_WEB_PROVIDER=jina`)** | Optional/dev only; needs app `JINA_API_KEY` |
| **Cursor IDE** | Irrelevant to this product feature |

## Prerequisites

1. Import Jina MCP into Agent Builder on the target Kibana/Serverless project
   (`search_web`, `read_url` available as tools).
2. Create/update the Suggest agent:

```bash
yarn tsx scripts/ensure-suggest-agent.ts
```

Creates/updates custom skill `grounded_title_lookup`, then creates/updates the
dedicated agent `video_metadata_research`. The agent has:

- `enable_elastic_capabilities: false`
- skill IDs: `grounded_title_lookup` only
- tool IDs: `jina.search_web` and `jina.read_url` only
- no default Elastic tools, built-in skills, plugins, workflows, AI indices,
  or broad connector capabilities

The same two tool IDs are attached to the skill. This is deliberate: the
agent-level allowlist prevents other tools from entering the agent context,
while the skill activates the tools with the task instructions.

## App config

Demo settings (see `.env.example`; the library default is `none` so unrelated
deployments do not require Kibana/Agent Builder):

- `SUGGEST_WEB_PROVIDER=agent_builder`
- `SUGGEST_AGENT_ID=video_metadata_research`
- `SUGGEST_AGENT_CONNECTOR_ID=.google-gemini-3.5-flash-lite-chat_completion`
  (Agent Builder `converse` model override; same EIS catalogue model as the
  query parser's `google-gemini-3.5-flash-lite`. Empty falls back to the
  Kibana project default, often Claude Sonnet 5.)
- `SUGGEST_WEB_TIMEOUT_MS=60000` (live multilingual smokes took 39–43s;
  representative p95 is still an open gate)
- Kibana URL: set `KIBANA_URL` or use Cloud ES URL (`.es.` → `.kb.`)
- Auth: `KIBANA_API_KEY` or fall back to `ELASTICSEARCH_API_KEY`

## Smoke

1. Kibana Agent Builder → agent `video_metadata_research` → chat with
   `raw_title: Official Trailer Breakfast at Tiffany's 1961.mp4` — expect
   `search_web` then `read_url`, JSON with year ~1961.
2. Library → Edit metadata → Suggest — the status callout moves through
   `queued`, `preparing`, `researching`, and `validating`; Save remains
   available and Cancel aborts the downstream call. The result `provider` may be
   `local+agent` with a `web` object (`status`, `candidates`, `reads`,
   `agent_id`). Failures fall back to local drafts (`provider: local`,
   `web.status: unavailable|skipped`).

The demo job queue is bounded to two active requests, six starts per
client/video per minute, and 64 retained jobs. Results are cached for ten
minutes by video, metadata revision, locale, draft, and provider configuration.
Job and cache state is in the single Next.js process: a container restart loses
pending/status records, and a multi-replica deployment needs a shared durable
queue/store before rollout.

Reusable direct smoke commands:

```bash
yarn tsx scripts/smoke-suggest-agent.ts "더 글로리"
yarn tsx scripts/smoke-suggest-agent.ts "琅琊榜"
```

These calls are read-only but invoke the configured model and Jina tools, so
they consume provider quota.

Live smoke on 2026-09-23:

- `더 글로리`: PASS in 38.9s — unique 2022 work, English/Hangul title and six
  actor identities with English/Korean names.
- `琅琊榜`: first call exceeded the former 45s timeout; diagnostic retry PASS
  in 43.1s — unique 2015 work, Chinese/English title and three actor identities
  with English/Chinese names. Default raised to 60s for the demo; this is not a
  measured p95 and does not close the latency gate.

## Skill contract (agent returns)

Compact JSON only. **Omit unknown keys; never emit `null` placeholders.**

```json
{
  "status": "ok | ambiguous | empty | unavailable",
  "candidates": [{ "title": "", "url": "", "year": 2020, "reason": "" }],
  "fields": {
    "year": { "value": 2020, "url": "https://…", "evidence": "…" }
  },
  "actors": [
    {
      "names": {
        "en": "Jane Doe",
        "zh": "张三",
        "native": { "lang": "ko", "name": "가나다" }
      },
      "url": "https://…",
      "evidence": "…"
    }
  ],
  "notes": ""
}
```

Actor `names.en` is required (Chinese/Korean names stay family-name-first, no
comma — e.g. "Lee Jung-jae"). `names.zh` is optional but the skill is asked to
find it for *any* actor, regardless of nationality — pure convenience for
Chinese-speaking searchers. `names.native` is optional, `{ "lang": <code>,
"name": <verbatim native-script name> }` for the actor's own native language;
it's omitted when it would duplicate `zh` or match `en` verbatim, and the
value is never reordered or reconstructed — copied exactly as the source
shows it. Omit `character` and any field entry you cannot cite; never send
`null` language keys.

The app accepts this JSON only through a strict bounded schema. It drops
non-HTTPS or non-allowlisted URLs, applies fields and actors only for
`status=ok`, requires cited URLs for external proposals, validates
country/language/type against catalogs, and keeps unresolved actor identities
read-only. Filled editor fields are never overwritten (draft + UI empty checks).

## Skill behavior

The skill body source of truth is
[`reference/agent-builder/skill-grounded_title_lookup.md`](../reference/agent-builder/skill-grounded_title_lookup.md)
(loaded by [`scripts/ensure-suggest-agent.ts`](../scripts/ensure-suggest-agent.ts)).
Two-phase budget: Phase 1 is **1 targeted Wikipedia/Wikidata search + 1 page
read** to verify the work (unchanged); Phase 2 is an optional **+1
search/+1 read** spent only on completing a missing actor zh/native name
after the work is already verified — worst case still 2 searches + 2 reads.
Every `read_url` call must pass a `question` argument so the tool returns
only the relevant passages (cheaper, and less raw page text for prompt
injection to hide in) instead of the whole page. Abstain early on ambiguous
titles. Reader domains for work-level facts: Wikipedia (incl. language
subdomains), Wikidata, IMDb, TMDB. Reader domains additionally allowed for
Phase 2 name-only lookups: Baidu Baike, Douban, MyDramaList, HanCinema,
AsianWiki. Extract year, country, original language, video_type (file-level
cues win over parent work), description/abstract, genre tags, and
multilingual cast when sourced. Actor candidates require a sourced English
name; the server resolves them only by exact alias against
`config/people.json`.
