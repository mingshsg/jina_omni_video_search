# todo/43 — Pending commits readiness (2026-09-30)

Source: [`reviews/pending-commits-readiness-review-2026-09-30.md`](../reviews/pending-commits-readiness-review-2026-09-30.md). Local HEAD `39abb06` is 17 commits ahead of GitHub branch tip `7226d22`. Hold this code push until P2 items are repaired and re-reviewed. Preserve the two unrelated untracked ` (1).md` copies.

## P2 fixes

- [x] **F1 UTF-8 filename length:** `sanitizeFilenameStem` now caps by UTF-8 bytes with room for `-<token>`, the longest allowed extension, upload `.part`, and quarantine timestamp/`.partial`. `paths.test.ts` covers long Chinese and emoji names plus the longest quarantine suffix; `getconf NAME_MAX` returned 255 on both the host and running app container. The shared helper serves upload, local copy, and URL download.
- [x] **F2 Metadata editor loading:** metadata and catalogs responses are classified independently in `meta-load-state.ts`. A metadata failure clears stale DTO state and shows an error with retry; a catalog failure retains the valid DTO/form and shows the actor catalog warning. Tests cover success, both failure modes, and the view state.
- [x] **F3 Group availability race:** `createGroupAvailabilityLoader` publishes only the latest request and invalidates on effect cleanup. Tests resolve or reject an older request after the new selection succeeds and cover unmount.
- [x] **F4 URL display name:** `titleFromUrlPath` decodes only the final URL pathname segment for the title; provenance remains sanitized and unchanged. Tests cover Chinese, malformed escapes, encoded separator, and no filename.

## P3 and delivery

- [x] Remove the extra EOF blank line in `todo/41` (local correction; combined diff check after commit remains to run).
- [x] Re-ran `yarn test`, `yarn build`, and `git diff --check` on the repaired code. Final suite: 101 files / 758 tests passed; Node 22 production build and typecheck passed; `git diff --check origin/codex/drama-enrichment-complete..b2f7442` passed after the code fix commit.
- [x] Run the read-only Group availability aggregation against the target ES mapping. Through the running app: HTTP 200, status `ok`, 3 groups, `truncated=false`; included `trailer` had 20 indexed assets and ready variant `4495e972f9e6b5a1`.
- [x] Rebuilt/restarted the app image and browser-checked Group selection/variant switch, editor form, and custom chunk input on the repaired code. Browser: selected `trailer`, used the explicit ready-variant switch (`4495e972f9e6b5a1`) with keyboard activation, loaded the drama video editor form with Group `drama`, and selected custom chunking to reveal Window/Overlap inputs. No metadata or ingest write was made. Browser injection of failed fetch/out-of-order responses remains NOT RUN; the new pure tests cover the state rules. The later quarantine-reserve adjustment only changes file naming and was host-tested, not rebuilt in the container.
- [ ] Real encoded/long filename ingest remains NOT RUN until a safe media fixture is available. The byte limit and URL title transformation are covered by focused tests; do not infer actual media processing from them.
- [ ] Verify grouped text/image/live search and one real custom ingest/search. Manual Group backfill requires an explicit per-video choice; do not bulk or automatically backfill.
- [x] Re-reviewed the repaired diff and staged/committed only the reviewed code and tests as `b2f7442`; no additional scoped blocker found. The two unrelated duplicate docs remain untracked and untouched.
- [x] Pushed this branch to `git@github.com:mingsorg/jina_omni_drama.git` as a reviewable backup (`7226d22..2bc2061`). Its existing 19-commit history spans Group search, naming, Suggest UI, and chunk presets; prepare one PR per concern against `live-video-search` before merge.

## Resolution note — 2026-09-30

Two docs-only commits advanced this shared branch to `cd316ce` (19 ahead of GitHub) after the historical review snapshot at `39abb06`. The four P2 findings are repaired in the current working tree. The original review remains the pre-fix record; this tracker records subsequent evidence and the remaining release gates.

## Existing project-level gates still open

- See `todo/31` for the framework upgrade and repo-level test/branch work; `todo/30` for Suggest authentication/rate-limit ownership; `todo/37`/`todo/38` for drama recovery, audit, and outcome UI. These are not made complete by the 744 passing tests.
