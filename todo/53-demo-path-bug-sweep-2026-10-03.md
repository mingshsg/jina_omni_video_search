# todo/53 — Demo-path bug sweep (2026-10-03)

Source: [`reviews/demo-path-bug-sweep-code-review-2026-10-03.md`](../reviews/demo-path-bug-sweep-code-review-2026-10-03.md).
Demo-visible issues only, on `codex/enrichment-add-runs` at `92b317b`.

## Findings

- [x] **D1 (P2)** — enrichment stuck at `running` after an app restart
      mid-run: flyout retry and Library Start are hidden, start API returns
      409. Treat `running` without a live in-process lease as interrupted
      (DTO + start guard), or reset stale markers at startup. Workaround
      until fixed: don't restart the app while a run is in progress; if
      stuck, use the row retry icon.
- [x] **D2 (P3)** — de-dupe Group combo-box options by `id`
      (`lib/metadata/group-availability-ui.ts:117`).
- [x] **D3 (P3)** — suppress "No stored group matches" when catalog options
      match a partial input (`components/SearchGroupFilter.tsx:148-150`).
- [x] **D4 (P3)** — serve `.md` director's scripts as text, not
      `application/octet-stream` (`lib/media/serve-file.ts`).
- [x] **D5 (P3)** — enrichment retry toast says "Re-index started"; add a
      dedicated message (`app/library/page.tsx:645-646`).

## Gates

- [x] `yarn test` / `yarn build` at `92b317b` — pass (Node 22.13.1).
- [ ] D1 reproduced against the running container.
- [ ] Browser check of D2–D5.
- [ ] Demo image rebuilt with `92b317b` (`docker compose up -d --build app`).

## Remediation — 2026-10-04

All D1–D5 code changes are implemented; see [the remediation review](../reviews/review-remediation-code-review-2026-10-04.md) and [todo/55](55-review-remediation-2026-10-04.md). D1 uses the shared live lease/start reservation, preserves genuine base-ingest work, exposes interrupted runs as retryable, and allows a new Library run. This is a single-process recovery rule; multi-replica ownership still needs durable coordination.

- [x] Final host tests/build: 115 files / 846 tests and Node 22 build PASS.
- [x] Fresh production preview on port 3032: an unowned running fixture shows failed/retryable and Enrichment options. This is not a Docker restart reproduction.
- [x] Browser D2/D3: one Group option per ID, English `tra` and Chinese `预告` have no false no-match hint; actual localized catalog label resolves to `trailer`.
- [x] HTTP D4: legacy container-root script URL returns 200, `text/plain; charset=utf-8`, `nosniff`.
- [ ] Browser click-through D5 retry toast — NOT RUN; dedicated EN/ZH message and callback reviewed.
- [ ] Docker rebuild/restart — NOT RUN; production host preview used, existing port 3031 left untouched.
