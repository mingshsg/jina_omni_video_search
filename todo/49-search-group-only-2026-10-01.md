# todo/49 — Use Group as the main search scope (2026-10-01)

The main search toolbar currently offers both Video and Group. The user wants
the Video selector removed and Group to remain the search scope.

- [x] Remove the main search page's Video selector, option list, and selection
  state.
- [x] Send the existing unscoped `video_id: null` request value so the search
  API contract and external callers retain their behavior.
- [x] Give Group the available toolbar space; keep Variant and Group controls.
- [x] Run full tests and production build.
- [x] Rebuild the running app and verify the toolbar and a group-scoped search
  in the browser.
- [x] Commit and push the verified change on its feature branch.

## Verified gates

| Gate | Result |
| --- | --- |
| Full tests | PASS: 106 files / 789 tests under Node 22 |
| Host production build | PASS: `yarn build` |
| Running container | PASS: `docker compose up -d --build app` |
| Browser toolbar | PASS: Variant and Group visible; no Video selector; default Group is All groups |
| Group search | PASS: `AI agents` with `training` returned moments from more than one training video; executed request had `video_id: null`, `filters.group_id: ["training"]`, and 3 eligible assets |

Scope: main text search page in the supplied screenshot. Image search has a
separate toolbar and is not part of this change.
