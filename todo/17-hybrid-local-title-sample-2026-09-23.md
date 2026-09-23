# Labeled local title-clue sample (F4-07 baseline) — 2026-09-23

Frozen heuristic expectations for local Suggest. Not a unique-work catalog match
audit. Update when `lib/metadata/suggest-local.ts` rules change.

| Title (as stored) | Expected work_title | year | video_type | description? | notes |
| --- | --- | --- | --- | --- | --- |
| `Official Trailer Breakfast at Tiffany's 1961.mp4` | Breakfast at Tiffany's | 1961 | trailer | yes (title clue only) | strip Official Trailer prefix |
| `My Movie Trailer 2024.mp4` | My Movie | 2024 | trailer | yes | trailer beats movie |
| `Interview with Alice 2024.mp4` | Interview with Alice | 2024 | interview | yes | keep "Interview with" |
| `18_JurassicPark.mp4` | JurassicPark | — | — | yes | strip leading index |
| `Show.S01E03.720p.mkv` | Show | — | tv_episode | yes | episode code |
| `untitled clip.mp4` | — | — | — | abstain | generic |
| `Breakfast at Tiffany's` | Breakfast at Tiffany's | — | — | yes | no type/year |
| `trailer interview mix.mp4` | mix | — | abstain type | yes | conflicting file-level types |

## Disposition (post F4-01/06 fix)

- Description values must **not** contain scene/dialogue/cast disclaimer tokens.
- Disclaimer belongs in `evidence` only.
- Caller `media_language` → `source: caller_hint`, never `media_tag`.
- Precision/abstention thresholds for Phase 4b catalog matching remain **unset** until an external catalog spike (`plan/04`).
