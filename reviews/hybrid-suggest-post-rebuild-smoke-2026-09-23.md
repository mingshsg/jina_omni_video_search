# Suggest post-rebuild application smoke — 2026-09-23

Scope: one user-authorized Suggest request for the existing asset
`30c68499-564c-4a2f-88b9-82108ad97ef7` (`H_HurJun_1999_MBC_youeuitae_6m56s_1I4KFP1K7KA`),
after rebuilding the app from the current worktree. No metadata PATCH was sent.
This is follow-up evidence to `hybrid-code-recheck-2026-09-23.md`; that review
remains an unchanged record of the earlier gate.

## Verdict

**Application-path Suggest smoke passed for this one Korean title.** The POST
returned HTTP 202 in 54 ms with request ID
`449b607e-e89d-4031-8eac-ee7c910c4964`. GET showed `researching`, then
`complete` without error. The result used `local+agent`, reported web status
`ok` and 27,344 ms elapsed, and included seven suggested fields, eight actor
candidates, and four observed tool calls (two `jina.search_web`, two
`jina.read_url` with explicit questions). This proves the async request and
polling route works on the rebuilt container; it does not prove browser
interaction or broad relevance/latency acceptance.

The result identified the 1999 MBC drama *Hur Jun*. Its year, South Korean
country, Korean language, and series-level synopsis are supported by the
[cited work page](https://en.wikipedia.org/wiki/Hur_Jun_(TV_series)). The
`tv_episode` value is a classification of the imported video clip, while the
web page identifies the parent work as a TV series; this distinction should
remain visible to the editor. The local title parser retained `youeuitae` in
`work_title`, but the agent still resolved the parent work in this example.

## Quality caveat from this sample

The sole supplied source URL for the first actor's native Korean spelling
`전광렬` is the English work page. That page lists `Jun Kwang-ryul` in the cast
but does not show the Korean spelling. The name may be correct, yet its
specific cited page does not substantiate it. The normalized API candidate
objects contain `null` placeholders for absent `zh`/native names; this smoke
does not expose the raw agent JSON, so it cannot prove whether the skill
omitted those keys upstream. All eight
candidate `character` fields were null even though the work page lists roles.
Treat these as editable candidates, not verified catalog entries. A name-only
read should attach the actual supporting actor page when enriching native
spellings; cast-role extraction can also be improved later.

## Gates

| Gate | Result |
| --- | --- |
| `yarn test` on current worktree | **PASS**, 62 files / 402 tests |
| `docker compose up -d --build app` | **PASS**, image built with `next build`; app recreated and started |
| `GET /api/library` on rebuilt app | **PASS**, HTTP 200, 388 ms |
| One Suggest POST | **PASS**, HTTP 202, 54 ms |
| Suggest GET progress/result | **PASS**, `researching` then `complete`, web `ok` |
| Browser controls, UI trace rendering, save/apply behavior | **NOT RUN** |
| Multi-title accuracy, cost/latency distribution, hybrid-search floor | **NOT RUN** |

The independent hybrid-search P1 issues remain in
`todo/22-hybrid-independent-code-review-2026-09-23.md`. Browser-level Suggest
follow-up remains in `todo/23-actor-name-and-suggest-ui-2026-09-23.md`.
