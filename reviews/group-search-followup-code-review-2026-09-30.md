# Group search follow-up code review — 2026-09-30

Scope: review the five local commits `3b787fb..9c48842` on `codex/drama-enrichment-complete` against remote base `7226d22` and `todo/39`. Inspect the new Group availability endpoint, primary search control, shared catalogs response, and search trigger. This review does not change application code or execute a group backfill.

**Verdict: direction is sound, but the five local commits are not ready to push.** The new endpoint, selection cap, and explicit catalog status address the right areas. Four P2 defects leave the stated G1/G3/G4 behavior incomplete despite 653 passing tests and a passing Node 22 build. Live Elasticsearch, browser, and manual backfill acceptance remain unrun.

## P2 — fix before pushing this stack

### R1 — A group outside the Library page cannot switch to its ready Variant

The new availability endpoint enumerates groups beyond `/api/library`, but the Variant selector still derives its options from `listAssets(200)` (`app/api/library/route.ts:12-20`; `app/page.tsx:255-268,303-319`). `SearchGroupFilter` filters suggested ready variant IDs through `knownVariantIds` (`components/SearchGroupFilter.tsx:276-295`), and `selectableCompatibleVariants` drops every ID not in that 200-asset-derived list (`lib/metadata/group-availability-ui.ts:119-125`). For a group whose only ready assets are older than the newest 200, the server identifies a compatible variant but the UI offers neither a switch button nor a Variant option. This is the exact G1 case the server-backed endpoint was meant to fix.

Use a complete server-backed ready-variant option source or add the compatible variant to the selector after verifying it is ready. Test with >200 newer assets and an older grouped asset whose variant is absent from `/api/library`.

### R2 — Unresolved availability is presented as a confirmed incompatibility

When an existing selected group is missing from a response, `mergeSelectedGroupEntries` invents an entry with `ready_variant_ids: []` (`lib/metadata/group-availability-ui.ts:45-59`). `SearchGroupFilter` passes these merged entries to `deriveGroupVariantNotice` even while loading or when `status` is `unavailable`/`partial` (`components/SearchGroupFilter.tsx:123-169`). The helper checks only whether an entry exists, then treats an empty ready-variant list as `incompatible` (`lib/metadata/group-availability-ui.ts:97-111`). A failed ES request can therefore show “no ready videos” for a selected group that may have ready videos. Starter suggestions have the same empty-list shape on an unavailable response (`lib/metadata/group-availability.ts:115-122,206-213`). Preserve an unresolved state separate from a verified empty group; make the notice depend on a successfully resolved selected ID. Test loading, unavailable, truncated-with-selected, and genuinely empty cases through the same composition the component uses.

### R3 — G4 still submits draft queries and spends one request per rapid click

`searchSubmittedRef` becomes permanently true after any search (`app/page.tsx:242-246,378-386`). The Group handler checks that boolean and the *current* nonempty input, then calls `runSearch` (`app/page.tsx:858-869`; `lib/metadata/search-request-gate.ts:24-29`). After searching “cat,” typing an unsubmitted “dog” and selecting a group submits “dog” implicitly. Moreover the accepted test asserts three rapid Group changes produce three requests (`lib/metadata/search-request-gate.test.ts:29-46`), directly contrary to `todo/39` G4's “avoid one provider request per rapid selection.” The unused `SearchRequestGate` only tests stale-response suppression; it cannot cancel provider work already sent.

Tie reruns to the last submitted query text and use either an explicit Search action for filter changes or a bounded debounce/cancellation policy. Test changed drafts and actual request counts, not only the pure boolean helper.

### R4 — Person-catalog failure now looks successful to existing actor clients

The shared route returns HTTP 200 after `buildCatalogsPayload` catches a person-catalog exception and sets `people: []`, `people_status: 'unavailable'` (`app/api/metadata/catalogs/route.ts:31-47`; `lib/metadata/catalogs-payload.ts:41-61`). Existing `SearchFacets` checks only `res.ok` and replaces actor options with `data.people` (`components/SearchFacets.tsx:47-56,64-75`); `EditMetadataFlyout` likewise checks only `catRes.ok` before accepting the empty catalog (`components/EditMetadataFlyout.tsx:480-499`). Thus a people-catalog failure silently removes actor choices instead of displaying a failure. The response also copies the raw exception string to `people_error` (`lib/metadata/catalogs-payload.ts:45-47,60-61`), exposing internal error details and potentially confidential text through an API response.

Keep Group availability independent, but make every actor client handle `people_status` explicitly or keep the shared route's old failure semantics and use the dedicated Group endpoint. Return a fixed public error code/message; log sanitized details server-side. Test a person-catalog exception through route and actor-client behavior.

## P3 — follow-up hygiene

### R5 — Exact lookup can restore a stale option after the input is cleared

`lookupGroup` increments `lookupSeq` only for names of length ≥2 (`components/SearchGroupFilter.tsx:95-106`). Clearing the input resets `lookup` but does not invalidate a previous in-flight request; that response can later repopulate the option and no-match hint (`:108-116`). It also sends a full 1000-group aggregation for every successive 2+ character input, despite the comment saying it avoids a request per keystroke. Invalidate on every input change and bound/debounce exact lookup; browser-test type-clear and out-of-order responses.

## Checked and not raised as new defects

- The 20-ID cap is applied before `onChange` (`components/SearchGroupFilter.tsx:148-155`), and the search schema still caps arrays at 20. All remains an empty selection. This closes the source-contract portion of G2; browser acceptance is separate.
- The new availability query groups root `meta.group_id` values and uses a nested ready-variant sub-aggregation (`lib/metadata/group-availability.ts:40-60,136-160`). This is the intended asset/variant relationship, subject to a real Elasticsearch request gate.
- The five development commits are already **committed locally**. The two pre-existing untracked duplicate documents are unrelated and were left untouched.

## Gates

| Gate | Result | Evidence / limit |
| --- | --- | --- |
| `PATH=/usr/local/bin:$PATH yarn test --maxWorkers=4` | PASS | Node 22.13.1; 92 files / 653 tests on 2026-09-30 |
| `PATH=/usr/local/bin:$PATH yarn build` | PASS | Node 22.13.1; compile, typecheck, routes including group availability on 2026-09-30 |
| `git diff --check 7226d22..HEAD` | PASS | No whitespace errors in the five local commits |
| New nested terms aggregation on target Elasticsearch | NOT RUN | Tests mock the client response; they do not prove server acceptance or counts |
| Rebuilt-container browser Group/Variant, catalog failure, request-count cases | NOT RUN | No rebuild or browser fixture in this review; Docker socket read was denied in the sandbox |
| Real grouped search, image/live regression, and manual per-video backfill | NOT RUN | No grouped fixture or asset write in this review |
| Representative p95/cost and broader drama acceptance | NOT RUN | Separate tracked gates remain open |

Follow-up: [`todo/40-group-search-followup-2026-09-30.md`](../todo/40-group-search-followup-2026-09-30.md).
