# Live video test fixtures

## MediaMTX RTSP fixture

Compose file: `docker-compose.live.yml`  
Config: `mediamtx.yml` (RTSP TCP on **8554**)

Pinned digests (Phase 9, 2026-09-11):

- `bluenviron/mediamtx@sha256:19fddade8d6110a3d718ac0045681fbeba344ae563a066205fe5929a87f7582f` (tag 1.21.0)
- `linuxserver/ffmpeg@sha256:2d1569b07dd249fd8a4eeff0afb3c7e4a2e83e6b37d97bf28837f6ccd57b23d8` (tag version-8.0-cli)

```bash
docker compose -f docker-compose.live.yml up -d
# Allowlist defaults already include 127.0.0.1 and ports 554,8554
# Optional worker secret:
# LIVE_SOURCE_FIXTURE_URL={"url":"rtsp://127.0.0.1:8554/fixture"}

# Phase 9 readiness evidence (short soak default READY_WINDOWS=12):
yarn live-rtsp-readiness
# Full 10-minute protocol soak:
# READY_DURATION_SEC=600 yarn live-rtsp-readiness
# Also build + file-search smoke:
# READY_RUN_BUILD=1 READY_RUN_FILE_SMOKE=1 yarn live-rtsp-readiness
```

Publisher runs in a **separate FFmpeg image** (MediaMTX image has no FFmpeg).

## Host webcam → MediaMTX (macOS)

Additive path **`/webcam`** (does not replace `/fixture` or e2e defaults).

```bash
# 1. MediaMTX only is enough; leave live-publisher running for /fixture if you want.
docker compose -f docker-compose.live.yml up -d mediamtx
# After editing mediamtx.yml, recreate so the webcam path is loaded:
# docker compose -f docker-compose.live.yml up -d --force-recreate mediamtx

# 2. List devices / publish on the *host* (needs host ffmpeg + Camera permission)
yarn live-webcam-publish --list
yarn live-webcam-publish                 # → rtsp://127.0.0.1:8554/webcam (host → published port)
# yarn live-webcam-publish --with-audio --audio-device 2

# 3. Worker secret (.env.worker only — never web .env).
#    Docker live-worker must NOT use 127.0.0.1 (container loopback):
# LIVE_SOURCE_WEBCAM_URL={"url":"rtsp://host.docker.internal:8554/webcam"}
#    Host yarn live-worker:
# LIVE_SOURCE_WEBCAM_URL={"url":"rtsp://127.0.0.1:8554/webcam"}

# 4. Restart live-worker; UI: /live → connection_ref LIVE_SOURCE_WEBCAM_URL → Start
```

macOS: grant **Camera** (and **Microphone** if `--with-audio`) to the terminal
that runs ffmpeg (Terminal / iTerm / Cursor). Prefer **Terminal.app or iTerm** —
Cursor’s agent shell can list devices but often cannot open the camera (TCC).
See `docs/live-video-operations.md`.

## Security fixtures

Unit tests under `lib/live/*.test.ts` and `lib/ingest/ip-guard-extended.test.ts`
cover userinfo rejection, protocol smuggling, DNS rebinding, metadata/multicast,
and web/worker env secret separation.

## Phase 10 optional gateway profile

`mediamtx-phase10.example.yml` enables HLS / WebRTC(WHIP) / SRT **in addition**
to RTSP. It is not wired into `docker-compose.live.yml` by default so the RTSP
MVP fixture stays unchanged. The example binds management surfaces to loopback
and requires non-empty publisher/reader/API credential placeholders — never copy
it to a reachable host with `user: any` / empty passwords.

To experiment:

1. Point MediaMTX at the example config (or merge flags carefully).
2. Expand `.env`: `LIVE_ALLOWED_PROTOCOLS` and `LIVE_ALLOWED_PORTS` (and
   `LIVE_SRT_PEER_ALLOWLIST` for SRT listener).
3. Put secrets only in `.env.worker` (see `.env.worker.example`).
4. Register sources via `/live` — protocol select unlocks only when allowlisted.
