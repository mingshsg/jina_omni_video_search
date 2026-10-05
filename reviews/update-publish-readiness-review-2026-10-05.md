# Update publication readiness — 2026-10-05

Scope: pending working-tree update on `codex/enrichment-add-runs`, based on `92b317b`: October 3–4 review remediation, supplied header logos, Group-to-Variant selection.

**Verdict: ready to commit and publish as a feature branch; remaining runtime/quality gates prevent a release-complete claim.** Follow-up: [todo/58](../todo/58-update-publish-2026-10-05.md).

No new blocking issue found in this focused pass. Earlier findings/dispositions: [remediation review](review-remediation-code-review-2026-10-04.md), [todo/55](../todo/55-review-remediation-2026-10-04.md).

## Checked and rejected

- Retry creates a distinct run and persists the handoff before accepting (`app/api/jobs/[id]/retry/route.ts:118-120`, `await prepareDramaHandoff`, `persist: true`), with shared single-process reservation and retained old outputs. Durable ownership across replicas remains open.
- Artifact access converts legacy roots using exact video/run anchors and keeps published allowlist/realpath boundaries; new outputs use portable relative paths. Metadata/rename updates do not change vector fields.
- Group gestures choose only verified ready variants (`components/SearchGroupFilter.tsx`, `groupSelectionVariant`). Compatible current choices and later manual overrides are preserved. All/unknown/unavailable cases retain current Variant. Debounced rerun supplies `variantOverride: variantRef.current` (`app/page.tsx`) so a captured callback cannot submit the old Variant with new Group filters.
- Supplied logos are served locally under `/brands/`; no browser dependency on remote thumbnail URLs. Responsive header/alt text checked.
- Secret-pattern scan found no matches; `.env`/`.env.worker` are ignored and untracked. No filesystem files were deleted.
- Three concerns are separated into commits. No integration-branch merge or history rewriting is authorized by this push request.

## Gates

| Gate | State / evidence |
| --- | --- |
| Full tests, final source | PASS: Node 22 `yarn test --maxWorkers=4`, 115 files / 851 tests, `/private/tmp/jina-group-auto-tests-20261005.log` |
| Final production Docker build | PASS: `yarn build` inside `docker compose up -d --build app`, `/private/tmp/jina-group-auto-container-build-20261005.log` |
| Recreated container | PASS: `0f31988c6616`, image `b70829bcffa8`; media mount/loopback port preserved |
| Browser Group mapping/clear/manual override | PASS: trailer/drama/training selected their ready Variant; screenshot and details in todo/57 |
| Browser logos/desktop/narrow header | PASS: todo/56 |
| Isolated live marker/history and rename kNN parity | PASS: October 4 remediation review |
| Diff whitespace | PASS: `git diff --check` |
| Credential-pattern / environment exclusion | PASS: no pattern hits, env files ignored/untracked |
| Full retry/restart/failure injection, provider browser hint/terminal ingest/cat outage, submitted-query rerun stress, human ASR/relevance/p95/cost/multi-replica | NOT RUN: acceptance trackers remain open |
| Standalone tsc / lint | Existing test-source tsc debt; lint NOT RUN (unconfigured). Required Next build PASS |
| Remote publication | Recorded after verified pushes in todo/58 |
