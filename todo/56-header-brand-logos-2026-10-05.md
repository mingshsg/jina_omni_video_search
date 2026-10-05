# Header logos — 2026-10-05

User request: add the supplied Elastic and Jina logos.

- [x] Save unchanged images as local public assets with source attribution.
- [x] Add both logos to shared header with alt text and responsive sizing; preserve home link/navigation.
- [x] Run full tests and final container production build.
- [x] Recreate app container, confirm new image/assets and HTTP responses.
- [x] Inspect desktop and narrow header in the running browser; save screenshot.

This UI concern is tracked separately from remediation in todo/55. No media files deleted.

Validation: Node 22 `yarn test --maxWorkers=4` PASS (115 files / 846 tests), Docker `yarn build` PASS, `git diff --check` PASS. Final `docker compose up -d --build app` recreated the app successfully. Both logo URLs return 200/image/png and browser images report loaded. Header visually checked at 1280px and 390px; narrow page width equals viewport width (no horizontal overflow), both logos visible with navigation menu and language buttons. Temporary viewport reset.

Logs: `/private/tmp/jina-header-tests-20261005.log`, `/private/tmp/jina-container-header-rebuild-20261005.log`. Screenshot: `/private/tmp/jina-header-logos-20261005.png`. Existing media mount/port preserved. Other Compose orphan services were not removed. Committed and published; see todo/58. Full runtime search/ASR/performance acceptance was NOT RUN for this branding change.
