---
title: "MediaMTX as the RTSP acceptance fixture and optional protocol gateway (live-video planning notes)"
sources:
  - https://github.com/bluenviron/mediamtx (README, main branch)
  - https://raw.githubusercontent.com/bluenviron/mediamtx/main/mediamtx.yml (default configuration, main branch)
  - https://github.com/bluenviron/mediamtx/releases/tag/v1.21.0 (release pinned by the plan)
  - https://mediamtx.org/docs/kickoff/introduction
downloaded: 2026-09-10
note: Condensed offline notes for the deterministic fixture in docs/live-video-operations.md and Phases 2, 9 and 10. Configuration keys were read from the main-branch default `mediamtx.yml` on 2026-09-10; re-check them against the v1.21.0 tag when pinning the image, because key names occasionally change between minor releases.
---

# What MediaMTX is (from the README)

> "MediaMTX is a ready-to-use and zero-dependency live media server and media
> proxy that allows to publish, read, proxy, record and playback real-time
> video and audio streams."

Publish protocols include SRT, WebRTC (WHIP), RTSP, RTMP, HLS, MPEG-TS, RTP;
read protocols include SRT, WebRTC (WHEP), RTSP, RTMP, HLS. "Streams are
automatically converted from a protocol to another." Docker image:
`bluenviron/mediamtx` on Docker Hub. Single static binary; Linux/macOS/Windows.

The plan uses it for two things that must stay separate:

1. **Deterministic RTSP fixture** for Phases 2 and 9 (required).
2. **Optional gateway** for WHIP publishing and HLS/WebRTC live viewing
   (Phase 10 / AD-10; not required for the RTSP MVP).

# Default listeners and ports (main-branch `mediamtx.yml`)

| Feature | Key | Default | Note for the plan |
| --- | --- | --- | --- |
| RTSP | `rtsp: true`, `rtspAddress: :8554` | 8554 | **Not 554.** `LIVE_ALLOWED_PORTS` defaults to `554` in the operations doc; the fixture must set `LIVE_ALLOWED_PORTS=8554` (or remap the container port to 554). |
| RTSP transports | `rtspTransports: [udp, multicast, tcp]` | all | "The handshake is always performed with TCP." For the fixture set `rtspTransports: [tcp]` so a mis-set client cannot silently negotiate UDP; the worker also passes `-rtsp_transport tcp`. |
| RTSP encryption | `rtspEncryption: "no"`, `rtspsAddress: :8322` | plain | RTSPS is out of MVP scope. |
| RTP/RTCP UDP | `rtpAddress: :8000`, `rtcpAddress: :8001` | | Unused when only TCP is enabled. |
| Multicast | `multicastIPRange: 224.1.0.0/16`, `multicastRTPPort: 8002` | | Disabled by removing `multicast` from `rtspTransports`. Relevant because `lib/ingest/ip-guard.ts` does **not** block `224.0.0.0/4` today (see review). |
| HLS read | `hls: true`, `hlsAddress: :8888`, `hlsVariant: lowLatency`, `hlsSegmentDuration: 1s`, `hlsPartDuration: 200ms`, `hlsSegmentCount: 7`, `hlsAlwaysRemux: false`, `hlsAllowOrigins: ["*"]` | | Candidate for the optional live player (AD-10). Low-latency HLS on Apple devices needs HTTPS (`hlsEncryption`). |
| WebRTC (WHIP/WHEP) | `webrtc: true`, `webrtcAddress: :8889`, `webrtcLocalUDPAddress: :8189`, `webrtcLocalTCPAddress: ""`, `webrtcAllowOrigins: ["*"]` | | Phase 10 only. Needs a reachable public IP / ICE servers for remote publishers; CORS wildcard must be tightened. |
| SRT | `srt: true`, `srtAddress: :8890` (UDP) | | Phase 10 only. |
| RTMP | `rtmpAddress: :1935`, `rtmpsAddress: :1936` | | Deferred by the plan. Disable in the fixture. |
| MoQ | `moq: true`, `moqHTTP2Address: :8892` | | Disable in the fixture. |
| Control API | `api: false`, `apiAddress: :9997` | off | Enable only on localhost for fixture fault injection (kick publisher / reader). |
| Timeouts | `readTimeout: 10s`, `writeTimeout: 10s` | | Interacts with the worker's `LIVE_READ_TIMEOUT_MS` (15 s default): the server may drop a stalled client before the worker notices. Document both in the run manifest. |
| Logging | `logLevel: info` | | Set `debug` while validating connect/disconnect transitions. |

# Authentication

`authMethod: internal` with `authInternalUsers`. Default config grants
`publish`, `read`, `playback` to `user: any` (anonymous) from any IP, and
`api`/`metrics`/`pprof` to localhost only. Permissions can be scoped by
`path` (regex with `~` prefix) and by `ips`.

For the fixture, define a real reader user so the worker exercises the
credential path end to end:

```yaml
authMethod: internal
authInternalUsers:
  - user: fixture-reader
    pass: <fixture-only password, injected via env>
    ips: []
    permissions:
      - action: read
        path: fixture
  - user: fixture-publisher
    pass: <fixture-only>
    permissions:
      - action: publish
        path: fixture
  - user: any
    pass:
    ips: ["127.0.0.1", "::1"]
    permissions:
      - action: api
      - action: metrics
```

MediaMTX also supports `authHTTPAddress` (external HTTP authorizer) and
`authJWTJWKS` (JWT). These are the natural mechanism for the Phase 10 idea of
"one-time publishing credentials" for WHIP.

RTSP credentials are supplied by the client as URL userinfo
(`rtsp://user:pass@host:8554/fixture`), which is exactly what the worker must
materialize in memory only (AD-11/LVR-FR-25).

# Path configuration used by the fixture

Per-path settings live under `paths:`; `all_others` is the fallback. The
relevant defaults:

- `source: publisher` — stream is pushed by an RTSP/RTMP/WebRTC/SRT client.
  Alternatives include `rtsp://...` (pull from a camera), `redirect`, and
  `rpiCamera`.
- `sourceOnDemand: false` — for pull sources only.
- `useAbsoluteTimestamp: false` — **"Use absolute timestamp of frames, instead
  of replacing them with the current time."** By default MediaMTX rewrites
  timestamps to its own clock. Consequences: (a) a fixture through MediaMTX
  cannot demonstrate camera-clock fidelity, which is fine because the plan
  defines event time as receive-anchored (AD-16); (b) a **looped** publisher
  will not present a PTS reset to the worker, so the "PTS regression opens a
  new epoch" path must be exercised by restarting the publisher or killing the
  reader, not by looping.
- `runOnInit` / `runOnInitRestart` — command run when the server starts; the
  simplest way to publish the fixture without a separate compose service:

  ```yaml
  paths:
    fixture:
      runOnInit: >
        ffmpeg -nostdin -hide_banner -loglevel warning
        -re -stream_loop -1 -i /fixtures/fixture.mp4
        -c copy -f rtsp -rtsp_transport tcp
        rtsp://fixture-publisher:$MTX_PUBLISH_PASS@localhost:$RTSP_PORT/$MTX_PATH
      runOnInitRestart: yes
  ```

  Environment variables `MTX_PATH`, `RTSP_PORT` (and `G1..` regex groups) are
  provided by MediaMTX. The official Docker image does **not** include FFmpeg;
  use a fixture image that adds it, or run the publisher as its own compose
  service.
- `runOnDemand` / `runOnDemandRestart` / `runOnDemandStartTimeout: 10s` /
  `runOnDemandCloseAfter: 10s` — publish only while a reader is connected.
  Useful for saving CPU but it changes connect latency (reader waits for the
  publisher to start), so do not use it for the timed acceptance run.
- `runOnReady`, `runOnRead`, `runOnUnDemand` hooks — can log reader
  connects/disconnects to prove the worker's reconnect transitions.
- Recording: `record: false`, `recordFormat: fmp4`, `recordSegmentDuration: 1h`,
  `recordDeleteAfter: 1d`. Not used; the worker owns its own spool.
- `rtspTransport: automatic` — for MediaMTX *pulling* from a camera; not the
  fixture path.
- `maxReaders: 0` (unlimited).

# Fault injection for Phase 9

| Fault in the plan | How to inject with MediaMTX |
| --- | --- |
| Controlled feed disconnect | Enable `api: true` on localhost and `DELETE /v3/rtspconns/kick/{id}` (or `rtspsessions/kick`) on the worker's reader session; or `docker kill --signal=SIGINT` the publisher `runOnInit` process; or `docker network disconnect` the worker. |
| Publisher restart (new PTS origin) | Stop and start the publishing FFmpeg; because `useAbsoluteTimestamp` is false the server re-anchors, but the RTSP session to the reader is torn down, forcing a worker reconnect → new epoch. |
| Slow inference | Not a MediaMTX concern; throttle the provider in the worker (config flag) — the fixture keeps publishing at real time. |
| Worker restart | Kill the worker container; MediaMTX keeps serving; the worker reconnects and recovers the spool. |

Metrics (`metrics: true`, `:9998`) expose reader counts and bytes for the run
manifest.

# Pinning

The plan pins **MediaMTX 1.21.0**. Record `bluenviron/mediamtx:1.21.0` plus the
resolved digest (`docker inspect --format='{{index .RepoDigests 0}}'`) in the
Phase 9 run manifest. Because this note was taken from the main branch, verify
that every key above exists unchanged in the v1.21.0 `mediamtx.yml` before
committing fixture configuration; the server rejects unknown keys at startup.
