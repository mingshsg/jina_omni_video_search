# Phase 4a/4b review follow-up — 2026-09-22

Review: [`hybrid-metadata-search-phase4a-4b-review-2026-09-22.md`](../reviews/hybrid-metadata-search-phase4a-4b-review-2026-09-22.md). Keep prior review and implementation progress documents as history.
Post-rebuild evidence: [`hybrid-metadata-search-phase4a-4b-post-rebuild-review-2026-09-22.md`](../reviews/hybrid-metadata-search-phase4a-4b-post-rebuild-review-2026-09-22.md).
Code fixes: [`hybrid-metadata-search-holistic-and-f4-fixes-2026-09-23.md`](../reviews/hybrid-metadata-search-holistic-and-f4-fixes-2026-09-23.md).

## Fix before 4a/4b sign-off

- [x] **F4-01 P1:** Keep caution text out of indexed description/abstract and semantic embedding; prove generic scene/cast queries do not match on boilerplate.
- [x] **F4-02 P1:** Merge suggested values and provenance atomically; cover multiple fields and typing during an in-flight request with a UI-level test.
- [x] **F4-03 P1:** Preserve source/review for unchanged fields on later Saves; cover two successive edits with an indexed asset.
- [x] **F4-04 P1:** Bound/cancel Suggest independently of closing the editor; a stalled request must not prevent saving an existing draft.
- [x] **F4-05 P2:** Display per-field source/confidence/evidence and retain bounded provenance on accepted values.
- [x] **F4-06 P2:** Correct title decoration/type parsing and score against a labeled multilingual filename/title set.
- [~] **F4-07 P2:** Reopen falsely completed sample/quality gates; record library sample size, precision/abstention, thresholds, and disposition. Keep catalog/LLM deferred until selected and evaluated.
      Local heuristic sample recorded in [`todo/17-hybrid-local-title-sample-2026-09-23.md`](./17-hybrid-local-title-sample-2026-09-23.md). Catalog precision thresholds still open (`plan/04`).
- [x] **F4-08 P2:** Obtain language from a server-verified media tag or represent client input as an unverified hint.

## Acceptance still needed

- [ ] Browser test: empty fields, existing saved fields, typing during Suggest, conflict reload, timeout/cancel, multi-field provenance.
- [ ] Live indexed-asset POST→PATCH→GET→hybrid-search check; verify description does not create false lexical or semantic matches.
- [ ] Rebuild/restart the `app` image using the existing Compose port/media variables after fixes; verify the running container serves the new route and retains its media mount.
- [ ] Run mapping upgrade so `meta.review.*.evidence` exists on the target index.
