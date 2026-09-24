# Suggest metadata-editor session — code review (2026-09-23)

**Scope:** the uncommitted working tree at review time — `reference_urls`
end-to-end, the citation-gate relaxation (todo/30 S6), the "Known as" person
alias editor + `PATCH /api/metadata/catalogs/people/{id}`, the
`searchFiltersSchema` nullable fix, two UI fixes (Suggest elapsed timer,
`EuiDescriptionList` column width), the search-input label fix, and the
Agent Builder skill/agent prompt rebalance that unblocks IMDb.

**Verdict: the shipped behavior is sound and five claims were verified
against live infrastructure, but the change set is too large to commit as
one unit, its bounds are duplicated in two places, and the same
"silently discard the agent's answer" defect this session existed to fix is
still present for actor candidates.**

> **Disposition (2026-09-23, same day):** R1–R4 and R6–R9 were fixed in a
> follow-up pass; see [`todo/32`](../todo/32-suggest-metadata-editor-session-2026-09-23.md)
> for the per-item record. **R5 / R5a (commit splitting) remain open and are
> the only thing blocking a commit** — deliberately not actioned here,
> because another actor was editing the tree concurrently and the split must
> be decided against a stable `git status`. The owed-verification list at the
> bottom of this review is also unchanged: no component test runs at all, and
> the relevance/quality claims remain unmeasured. Per this repo's convention
> the body below is left as written — it is the evidence, not a live
> checklist.

Provenance note: the tree also contains **pre-existing uncommitted work not
authored in this session** — `semantic_text` mirror fields and the
strict-dynamic retry loop in `lib/es/asset-meta.ts`, the
`SUGGEST_WEB_TIMEOUT_MS` 60s→180s bump in `.env.example` + `lib/config.ts`,
and `lib/es/asset-meta.test.ts`. Findings below distinguish the two.

**The tree was modified by another actor while this review was in progress.**
`lib/es/asset-meta.test.ts`, `lib/config.ts` and `.env.example` were absent
from `git status` at the start of the session and present by the end, and the
suite moved 445 → 446 tests mid-review with no test added by this review —
the new case is `it('extracts the introduced field name from the reason')`,
covering `strictDynamicIntroducedField`, which belongs to that other work.
Consequence: every gate and live check below is a point-in-time result
against a moving tree, and the commit-splitting plan in R5 must be
re-confirmed against `git status` immediately before any commit.

---

## P1 — blocking

- [ ] **R1 — actor candidates are still silently discarded when uncited,
      which is the exact defect todo/30 S6 was opened to fix.**
      `lib/metadata/suggest-web.ts:107-117`:

      ```ts
      const url = String(actor.url ?? '');
      if (!en || !isNameAllowlistedUrl(url)) return [];
      ```

      A `return []` drops the actor with no error and no operator-visible
      signal. This session relaxed exactly this pattern for all seven scalar
      fields (`cited()` now returns the value and discounts confidence
      instead of dropping it) but left `normalizeAgentActorCandidates`
      untouched. The result is an inconsistency that is worse than either
      policy applied uniformly: for the same agent reply, a `country` with
      no citation is surfaced at 0.5 confidence, while an actor with no
      citation vanishes entirely.

      This is P1 not because strictness for actors is wrong — it is
      defensible, since actor candidates feed catalog growth and aliases
      reach the search hot path (S7) — but because the drop is **silent**.
      The originating user report for S6 was "why is nothing filled in";
      actors still reproduce that report verbatim.

      Minimum fix: keep the allowlist gate, but surface the count of
      dropped candidates to the operator (the `web` meta block already has
      `reason`/`notes` to carry it). Deciding to *relax* the gate is a
      separate product call and should not be bundled.

---

## P2 — should fix

- [ ] **R2 — the "Known as" list is a global write issued from a
      per-asset editor, with no optimistic-concurrency guard.**
      `components/EditMetadataFlyout.tsx:1688,1695` fire
      `updatePersonKnownAs` immediately on add/remove, bypassing the
      flyout's own draft-then-Save model and the `expected_revision` check
      that every other field in that form goes through
      (`save()` sends `expected_revision: dto.meta_revision`).

      Two consequences. (a) UX inconsistency: every other control in the
      flyout is a draft until Save; these two are not, and nothing in the
      UI says so. (b) Blast radius: `aliases` feed `findContainedAliases`,
      which runs in the BM25/query-parse hot path for *all* queries and
      *all* videos (`lib/metadata/people.ts:169-216`). An operator editing
      one video's cast silently changes global search behavior, and
      `setPersonAliases` is a full-list replace, so a mis-click removes a
      name for everyone with no undo.

      `setPersonAliases` correctly re-validates the whole catalog and
      rejects cross-person collisions (verified live, 409), so this is not
      a corruption risk — it is an authority/reversibility risk.

- [ ] **R3 — the new `PATCH` route inherits S7 unguarded: no auth, no rate
      limit, no removal path.** `app/api/metadata/catalogs/people/[personId]/route.ts`
      contains zero auth/rate-limit references. This matches the existing
      `POST` on the same resource, which is already tracked as S7 (P2) in
      `reviews/hybrid-suggest-pipeline-review-2026-09-23.md:100-107`. The
      finding is not that this route is worse — it is that S7's exposure
      was **doubled** without S7 being referenced or re-dated. Anything
      that fixes S7 must now cover two routes.

- [ ] **R4 — documentation is stale for two shipped features.**
      `docs/` has **zero** hits for `reference_urls`, for the known-as
      feature, or for `catalogs/people/`. `docs/api-contract.md` and
      `docs/data-model.md` are this repo's record of the request/response
      contract; a new persisted `AssetMeta` field and a new mutating route
      are exactly what they exist to capture. `docs/agent-builder-jina-suggest.md`
      *was* updated for the prompt change, so the omission is inconsistent
      rather than systematic.

- [ ] **R5 — the change set bundles at least six unrelated concerns,
      against the repo's "one concern per PR" rule** (`AGENTS.md`).
      Currently in one tree: `reference_urls` (schema + mapping + UI), the
      S6 citation relaxation, the known-as feature (+ new route), an
      unrelated image-search `filters` regression fix, two cosmetic UI
      fixes, a search-label fix, the agent prompt rebalance, **and**
      pre-existing third-party work (semantic mirrors, timeout bump). The
      `filters` fix in particular is a pre-existing-bug fix with its own
      regression test and should land alone — it is the one change here a
      bisect would most want isolated.

---

## P3 — hygiene

- [ ] **R6 — the known-name bound is declared twice and the two disagree.**
      `app/api/metadata/catalogs/people/[personId]/route.ts:15` accepts
      `z.array(z.string()).min(1).max(50)`; `lib/metadata/people.ts:321`
      enforces `KNOWN_AS_MAX = 30`. A 31–50 item request passes zod, then
      throws `PersonCatalogError('invalid')` → still a 400, so there is no
      security or corruption impact, but the schema advertises a limit the
      system does not honor. The per-item constraints are similarly
      vestigial: `z.string()` has no `.max()`, so the real 200-char check
      only happens inside `setPersonAliases`. Either import the constant or
      drop the zod bounds and let the function own validation.

- [ ] **R7 — `cited()` no longer gates on citation but kept its name.**
      `lib/metadata/suggest-web.ts:327`. It now returns
      `{ value, url, evidence, cited }` for every field and never returns
      `null` for a missing citation. A reader scanning call sites will
      reasonably assume `const year = cited(...)` means "year, if cited".
      Rename to `readField()`.

- [ ] **R8 — `AGENTS.md` "Current state" is now factually wrong.**
      `AGENTS.md:157-161` states todo/22 has "three P1 items, the most
      serious being that the guaranteed-recall floor sends `retriever` in
      an `_msearch` body". Those are F1–F3 and all three are checked `[x]`
      in `todo/22-hybrid-independent-code-review-2026-09-23.md:11,25,30`,
      with the fix present at `lib/es/hybrid-search.ts:426-433`. The
      paragraph steers agents to read a tracker for P1s that no longer
      exist. (Ten items remain open in todo/22, but none are P1.)

- [ ] **R9 — `setPersonAliases` omits the concurrency caveat its sibling
      carries.** `addPersonToCatalog` documents "Not safe against
      concurrent writers on separate processes/replicas"
      (`lib/metadata/people.ts:363`). `setPersonAliases` performs the same
      read-modify-write on the same file and needs the same warning; the
      atomic temp-file+rename protects against torn files, not lost
      updates.

---

## Verified this pass (claims closed, not assumed)

These were live-tested rather than inferred, and are **not** findings:

| Claim | How verified | Result |
| --- | --- | --- |
| `reference_urls` survives `dynamic: strict` on the real cluster | `GET video-assets/_mapping` | Present as `{type: keyword, index: false}` — migration already applied |
| `reference_urls` persists end-to-end | live `PATCH` → read back → cleared | rev 0→1, both http+https stored, `review.reference_urls` written; test data removed (rev 2) |
| Cross-person alias collision is rejected, not silently merged | live `PATCH` of an alias owned by another person | `409 PEOPLE_CONFLICT` |
| The prompt change reached the live agent | `PUT` → re-`GET` skill, asserted old/new strings | 5/5 assertions pass; old `site:wikipedia.org` steer absent |
| Image-search `filters: null` regression | live multipart `POST /api/search/image` with no `filters` field | `HTTP 200` with hits (was 400) |

One defect was **found and fixed inside this review**: the IMDb worked
example added to the skill had `status: "ok"` but omitted `candidates`,
while `components/EditMetadataFlyout.tsx:805` reads
`web.candidates[0]` to propose `work_title` — the example risked teaching
the model to drop a key the UI depends on. Corrected, redeployed, and the
`.json` snapshot regenerated; both examples now carry `candidates`.

---

## Gates

| Gate | Status |
| --- | --- |
| `yarn test` | PASS — 62 files / 446 tests (445 earlier in the session; +1 from concurrent third-party work, see provenance note) |
| `yarn build` | PASS |
| `tsc --noEmit` | PASS on all touched files (pre-existing `lib/live/*.test.ts` errors unrelated) |
| Live mapping / persistence / conflict / prompt / image-search | PASS (table above) |
| `yarn lint` | **NOT RUN** — no ESLint config in repo (AGENTS.md) |
| Browser E2E of the Known-as chips and the Suggest timer | **NOT RUN** — `vitest.config.ts` covers only `lib/**` and `worker/**`; no component test runs at all |
| Does relaxing citations change real agent output quality | **NOT RUN** — no labeled relevance set; unproven that uncited facts are net-positive |
| Does unblocking IMDb improve real Suggest results | **NOT RUN** — measured on one title (Parasite) via keyless Jina Reader; no before/after over a corpus |
| Multi-replica safety of `setPersonAliases` | **NOT RUN** — single-instance assumption unchanged |
| `reference_urls` behavior on an **un-migrated** index | **NOT RUN** — live index happened to be migrated; the silent-drop retry path (`asset-meta.ts:372-381`) was never exercised |
