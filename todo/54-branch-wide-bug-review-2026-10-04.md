# todo/54 — Branch-wide bug review (2026-10-04)

Source: [`reviews/branch-wide-bug-review-2026-10-04.md`](../reviews/branch-wide-bug-review-2026-10-04.md).
`codex/enrichment-add-runs` at `92b317b`. No code changed by the review.

## P2

- [x] **S1** — retry reuses `run_id`; the `running` marker replaces the
      previous record and its results vanish (permanent if a module that
      succeeded before now fails). Mint a new `run_id` on retry, or snapshot
      a terminal previous record even with the same ID
      (`app/api/jobs/[id]/retry/route.ts:113,145`,
      `lib/drama/persist-meta.ts:66-77`).
- [x] **S2** — fold into `todo/53` D1: also stuck at `running` when the
      final meta write fails (`lib/drama/runner.ts:512-554`) or the runner
      throws (`:563-579`). Fix must key on "no live lease", not on restart.
- [x] **U1** — add `selectedGroup` to `save`'s dependency list
      (`components/EditMetadataFlyout.tsx:1497-1520`); Group-only edits
      currently fail.
- [x] **U2** — add `operatorHint` to `onSuggest`'s deps (`:995-1014`), and
      key the suggest cache on the normalized raw hint
      (`app/api/library/[videoId]/meta/suggest/route.ts:168-181`).
- [x] **U3** — give the ingest page a reachable exit after failures: a
      Clear/Dismiss action for retained batch rows (`app/ingest/page.tsx:928,949`)
      and for a single job with partial/failed enrichment (`:921-926`).

## P3

- [x] **S3** — `job.drama.status` never leaves `running` for
      ingest-enriched videos; trimmed-run GC skips them.
- [x] **S4** — retry vs Library Start race (shared `starting` guard).
- [x] **S5** — malformed JSON / bad `%` escapes return 500 instead of 400
      (drama start route, drama-media route).
- [x] **S6** — record provider/dims identity for subtitle vectors.
- [x] **S7** — `renameAssetTitle`: check `update_by_query` failures and
      conflicts.
- [x] **S8** — store script/SRT paths relative to `MEDIA_ROOT`.
- [x] **U4** — reset `batchRetainRef` in `startBatchImport`.
- [x] **U5** — prevent a rejected enrichment upload from becoming an accepted original. Fixed by validation before promotion and quarantine on rejection; filesystem deletion is forbidden by the user.
- [x] **U6** — return collected errors when a batch is fully rejected.
- [x] **U7** — client check "key_actors needs directors_script" on the
      ingest page.
- [x] **U8** — show stored values when catalogs fail to load in the editor.

## Additions to tracked items

- [x] `todo/53` D3 — also match localized labels (`预告片` → `trailer`).
- [x] `todo/46` retry race — also affects ingest page streams.

## Gates

- [ ] Full real-video live reproduction of S1 / S2 — isolated marker check PASS; failure injection/restart NOT RUN.
- [ ] Browser reproduction of U1 / U2 / U3 — U1 PASS; U2/U3 NOT RUN.
- [x] Upload-orphan check (U5) — rejected staging quarantined before promotion; regression PASS.
- [x] kNN spot-check of a renamed isolated fixture — identical score/ID/variant.
- [x] `yarn test` / `yarn build` after fixes — 846 tests / 115 files and build PASS.

## Remediation — 2026-10-04

All S1–S8/U1–U8 code findings are implemented. [Remediation review](../reviews/review-remediation-code-review-2026-10-04.md), [todo/55](55-review-remediation-2026-10-04.md). Checked items above mean the implementation is fixed, not that every original browser/live acceptance gate passed.

- S1–S4: retry mints a new generation, snapshots old outputs, carries host SRT inputs without altering originals, and shares a start reservation with Library and ingest. Terminal job state is durably persisted. Unowned ready-asset running/pending markers become interrupted/retryable.
- S5: malformed JSON and bad path escapes produce 400.
- S6: subtitle vectors carry provider/model/task/role/dims/normalization identity. Incompatible or unreadable mapping falls back to lexical indexing before inference. Legacy untagged vectors are not migrated; future vector retrieval must exclude/filter them.
- S7: guarded title write, explicit incomplete chunk propagation error, idempotent same-request retry; vector fields remain untouched.
- S8: new script/SRT/thumb paths are run-relative. Shared safe legacy-path conversion supports different roots while retaining allowlist and realpath guards.
- U1/U2/U8: current Group and raw normalized operator hint participate in callbacks/cache; stored select values survive missing catalogs.
- U3/U4/U6/U7: terminal rows allow clearing, new batches reset retention/counts, all-rejected requests return per-file errors, and the actor/director dependency is checked before submission.
- U5: rejected upload bytes are preserved in quarantine; local sources are validated before copying. No filesystem deletion.
- D3 uses actual localized catalog labels (currently `trailer（预告 / 10s）`), rather than inventing a `预告片` synonym.
- Retry polling rejects stale generations/out-of-order reads. Ingest callbacks reject previous batch epochs and duplicate terminal events; retries reset failed-row accounting.

### Current verification

- [x] Isolated live ES S1: new marker retained prior synopsis/script; unowned new marker was retryable.
- [x] Unit S2: final meta-write failure/top-level throw persisted terminal job state and released lease.
- [x] Browser U1: only Group changed; Save persisted `review-fixture-group` and showed Metadata saved. Temporary ES fixture removed; files preserved.
- [x] Route/cache U2: two distinct unparsed hints cause distinct jobs; trimmed equivalent reuses cache.
- [x] Upload U5: rejection leaves no promoted accepted original, retained quarantined bytes; normal import contract regression passes.
- [x] Live renamed fixture kNN: identical result ID/score/variant after title change; same-request retry succeeds.
- [x] Final `yarn test --maxWorkers=4` / `yarn build`: 846 tests / 115 files and build PASS.
- [ ] Full real-video retry plus immediate refresh/restart/failure injection in rebuilt Docker — NOT RUN.
- [ ] Browser U2 provider request, U3 terminal clear/retry sequence, U8 forced catalog outage — NOT RUN.
- [ ] Representative ASR, translation meaning/timing, p95/cost, multi-replica durable ownership — NOT RUN.
