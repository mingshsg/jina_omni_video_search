# Code review — demo-path bug sweep (2026-10-03)

**Scope:** demo-visible behavior on `codex/enrichment-add-runs` at `92b317b`:
the file-video search pages (Group filter, scene linking, moment buttons,
timeline) and the drama enrichment flow (start, retry, results flyout,
subtitle/script links, run history). Deliberately narrow — "would a presenter
hit this live?" — not a full audit. Two read-only sub-passes traced the code;
every finding below was re-checked by hand against the cited lines.

**Verdict: nothing breaks the normal demo path. One conditional demo-breaker
(app restart during an enrichment run leaves the UI stuck at "running") and
four visible-but-minor glitches.**

## Findings

### P2 — conditional demo-breaker

- **D1 — a restart mid-run leaves enrichment stuck at `running` in the UI.**
  The run writes `enrichment_status: 'running'` to `meta.drama` before work
  starts (`lib/drama/runner.ts:129`, `:193`). If the process dies, nothing
  rewrites it: `instrumentation.ts:7-10` only checks env secrets, and no
  startup sweep resets stale markers. The server-side job hydrate maps it
  away (`lib/ingest/job-store.ts:570`
  `status: status === 'running' ? 'pending' : status`), but the UI reads
  `meta.drama` directly (`lib/drama/safe-dto.ts:121`
  `status: metaDrama.enrichment_status`). Result:
  - the flyout's retry block needs `['failed', 'partial'].includes(dto.status)`
    (`components/DramaResultsFlyout.tsx:209`) — hidden;
  - Library "Start" needs a terminal status (`app/library/page.tsx:406-409`) —
    hidden;
  - `POST` start returns 409 `'Enrichment is already running for this
    video'` (`lib/drama/start-existing.ts:47-56`);
  - list and flyout keep polling every 5 s.

  Only the generic row retry icon recovers it. Likely before a demo, because
  AGENTS.md trap #9 requires `docker compose up -d --build app` after every
  code change. **Fix direction:** treat `running` with no live in-process
  lease (`isDramaRunActive(videoId)` false) as `failed`/interrupted in the
  DTO and in the start guard, or reset stale markers once at startup.

### P3 — visible but minor

- **D2 — exact group name shows twice in the Group dropdown.**
  `lib/metadata/group-availability-ui.ts:117`
  `const options = [...(data?.groups ?? []), ...lookup];` is not de-duplicated
  (only `entries`, `:122`, is), and `components/SearchGroupFilter.tsx:224-230`
  builds the combo box from that `options` list. Typing `trailer`, `demo` or
  `training` and pausing 300 ms lists the group twice. Fix: de-dupe by `id`.

- **D3 — partial input shows "No stored group matches …" while matches are
  listed.** `components/SearchGroupFilter.tsx:148-150` keeps only
  `entry.id === name`, and `lib/metadata/exact-lookup.ts:63-65` reports a miss
  for any input of at least the minimum length with no exact match. Typing
  `tra` lists trailer/training and the miss hint together. Fix: suppress the
  hint when any catalog option matches the input.

- **D4 — director's script links download instead of opening.** Scripts are
  `.md` (`lib/drama/directors-script.ts:520-521`); `lib/media/serve-file.ts`
  maps only `.srt` to text and falls through to
  `'application/octet-stream'`, with `nosniff` on the route. Fix: map `.md`
  to `text/plain; charset=utf-8` (or `text/markdown`).

- **D5 — "Retry enrichment" shows the toast "Re-index started" /
  "已开始重新索引".** `app/library/page.tsx:645-646` reuses `t.retryStarted`
  (`lib/i18n/ui.ts:760`, `:1246`) though nothing is re-indexed. Fix: a
  dedicated enrichment-retry message.

### Noted, not raised

- Every Group selection briefly flashes "Loading groups…" because `load`
  depends on `selectedKey` (`components/SearchGroupFilter.tsx:105-122`).
  Cosmetic.
- Scene linking is now always the chain rule (`linkGapMs` initial `0`,
  `app/page.tsx:228`); the old `2 × chunkWindowMs` span rule is unreachable.
  By design (`todo/51` product sign-off item), but demo scripts written
  against the old grouping will show fewer, longer cards.
- Runs that did not request subtitles show "Subtitle files: 0"
  (`lib/drama/safe-dto.ts:245-247`); hard-coded English (`zh script`,
  `thumbnail`, raw status words) in `components/DramaResultsFlyout.tsx`.
- Already tracked and still open: retry polling race (`todo/46`), >1000 cue
  translation limit (`todo/46`).

## Checked and rejected

- i18n: no missing keys — `UiMessages` is typed and both locales must
  satisfy it at build time.
- Scene button cap / "+N more" count, and `group_id` filtering through all
  three search paths: correct.
- "all" modality description hits cannot merge into chunk scenes: the server
  excludes videos that already have chunk hits (`app/api/search/route.ts:355-360`).
- `onReadyVariantsChange` cannot loop: the parent returns the same array when
  unchanged (`app/page.tsx:859-865`).
- Subtitle links resolve the right run and language; the media route and DTO
  allow the same set, including earlier runs.
- Year-range 400 only applies when `QUERY_PARSER_FACET_MODE=filter`; default
  is `boost` (`lib/config.ts:155`).
- Group re-run with a stale `query` closure and Reset-during-debounce: both
  need three actions inside a 300 ms window; theoretical.

## Gates

| Gate | Result |
| --- | --- |
| `yarn test` at `92b317b` | **PASS** — 108 files / 809 tests, Node 22.13.1 (run for the previous turn; no code changed since) |
| `yarn build` at `92b317b` | **PASS** |
| D1 restart reproduction against the running container | **NOT RUN** |
| Browser check of D2–D5 | **NOT RUN** — traced in code only |
| Running demo image contains `92b317b` | **NO** — `app` image predates it; rebuild before demoing |
