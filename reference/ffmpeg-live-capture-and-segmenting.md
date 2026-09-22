---
title: "FFmpeg for live RTSP capture, canonical fragments, and receive-clock anchoring (live-video planning notes)"
sources:
  - https://ffmpeg.org/ffmpeg-protocols.html   (rtsp demuxer options, protocol_whitelist, rw_timeout)
  - https://ffmpeg.org/ffmpeg-formats.html     (segment / hls muxers, use_wallclock_as_timestamps)
  - https://ffmpeg.org/ffmpeg.html             (-force_key_frames, -re, -nostdin)
  - local probe: `ffmpeg -version`, `-protocols`, `-demuxers`, `-encoders` on the dev host, 2026-09-10
downloaded: 2026-09-10
note: Condensed offline notes for AD-2, AD-3, AD-4, AD-11, AD-16 and Phases 2–3 of the live-video plan. Quotations are short excerpts from the FFmpeg manuals; everything else is our summary and must be re-verified against the pinned worker FFmpeg build.
---

# Why this document exists

The live-video plan says the RTSP adapter "transcodes ... to canonical MPEG-TS
fragments with forced 2-second keyframes and atomic publication", that windows
"use actual PTS coverage", and that "Phase 2 must prove" a receive-anchored
clock. None of the existing `reference/` files cover FFmpeg's RTSP demuxer,
segmenting muxers, or timestamp options. This note records the specific
options that make those requirements implementable and the constraints the
plan must respect. `lib/video/run-ffmpeg.ts` (`execFile`, buffered output, no
timeout) is **not** usable for a long-running capture process; a `spawn`-based
supervisor is required.

# 1. Host capability probe (dev machine, 2026-09-10)

```
ffmpeg version 8.1.1
protocols (subset): file pipe rtp srt tcp udp
demuxers  (subset): rtsp, hls, mpegts, mpegtsraw
encoders  (subset): libx264, aac, libopus
```

- `rtsp` is a **demuxer**, not a protocol handler: "RTSP is not technically a
  protocol handler in libavformat, it is a demuxer and muxer." It therefore
  does not appear in `-protocols`; check `-demuxers` in the worker capability
  manifest.
- `srt` appears in the host protocol list; the Debian Bookworm `ffmpeg` used by
  the current `Dockerfile` may differ. The plan's rule "SRT stays disabled
  unless the probe reports `srt`" must key off the **worker image** probe.

# 2. RTSP demuxer options that matter

From the protocols manual, demuxer section:

| Option | Meaning | Use in the plan |
| --- | --- | --- |
| `-rtsp_transport tcp` | "Use TCP (interleaving within the RTSP control channel) as lower transport protocol." Multiple values may be listed and are tried in order. | LVR-FR-5 requires TCP; pass exactly `tcp` so UDP/multicast is never negotiated. |
| `-rtsp_flags prefer_tcp` | Try TCP first if available. | Redundant when `rtsp_transport tcp` is set; do not rely on it alone. |
| `-timeout <µs>` | "Set socket TCP I/O timeout in microseconds." (Older builds called this `-stimeout`; 8.x uses `-timeout`.) | Maps to `LIVE_READ_TIMEOUT_MS * 1000`. Verify on the pinned build that the flag is `-timeout` and not `-stimeout`. |
| `-rw_timeout <µs>` | Protocol-level "Maximum time to wait for (network) read/write operations to complete, in microseconds." | Belt-and-braces alongside `-timeout`. |
| `-allowed_media_types video,audio` | "Set media types to accept from the server." | Drop `data`/`subtitle` tracks so the fragment contract is stable. |
| `-user_agent` | Override User-Agent. | Optional; useful for camera ACLs and fixture logs. |
| `-reorder_queue_size`, `-buffer_size` | UDP reordering / socket buffer. | Not relevant for TCP interleave. |
| `-initial_pause`, `-listen_timeout`, `rtsp_flags listen` | Server / paused modes. | Not used by the pull adapter. Do not allow `listen`. |

There is **no** `-reconnect*` support for RTSP (those options belong to the
HTTP protocol). Reconnection must be implemented by the worker's process
supervisor (spawn → exit classification → capped backoff → new process →
**new stream epoch**), exactly as AD-4 assumes.

Digest/basic credentials are normally supplied as URL userinfo
(`rtsp://user:pass@host/path`). The plan forbids userinfo in stored URLs and
materializes credentials "only at the process boundary". Practically this means
the worker builds the URL string with userinfo in memory immediately before
`spawn` and never logs `argv`; there is no separate `-user`/`-password` option
for the RTSP demuxer. Redaction of the spawned argument array is mandatory.

## Protocol whitelist

From the protocols manual:

> "`protocol_whitelist` list (input): Set a ','-separated list of allowed
> protocols. 'ALL' matches all protocols. Protocols prefixed by '-' are
> disabled. All protocols are allowed by default but protocols used by an
> another protocol (nested protocols) are restricted to a per protocol subset."

For RTSP-over-TCP interleave, start with `-protocol_whitelist rtsp,tcp` and
add `rtp,udp` only if the pinned build refuses to negotiate; the acceptance
fixture (Phase 2) must confirm the minimal list. Never include `file`, `pipe`,
`http`, `https`, `data`, `concat`, or `subfile` in the *input* whitelist. The
whitelist is an **input** option and must precede `-i`.

# 3. Producing canonical fragments

## Forcing 2-second keyframes on the transcode

The segment muxers cut only at keyframes of the reference stream:

> "Every segment starts with a keyframe of the selected reference stream ...
> if you want accurate splitting for a video file, you need to make the input
> key frames correspond to the exact splitting times expected by the
> segmenter, or the segment muxer will start the new segment with the key
> frame found next after the specified start time."

For a transcoded output (libx264):

```
-c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p
-force_key_frames "expr:gte(t,n_forced*2)" -sc_threshold 0 -g 60
```

- `-force_key_frames expr:gte(t,n_forced*2)` inserts a keyframe at every
  multiple of 2 seconds of *output* time.
- `-sc_threshold 0` disables scene-cut keyframes so GOPs stay aligned;
  `-g` should be ≥ fps × 2 so the encoder does not add extra keyframes.
- Fragment boundaries will still be **approximate** on variable-frame-rate or
  odd-fps inputs (a keyframe lands on the first frame at or after t = 2n).
  Actual fragment duration must be read from the output (PTS), which is why the
  plan's "window assembly uses actual PTS coverage" is correct — but see the
  review: the assembler should be **fragment-count aligned** (4 fragments per
  window, advance 3) rather than cutting at exact 6,000 ms PTS.

## Choosing a segmenting muxer

Two options; both write MPEG-TS segments.

### `segment` / `stream_segment` muxer

```
-f segment -segment_format mpegts -segment_time 2 -reset_timestamps 0
-segment_list frag.csv -segment_list_type csv -segment_list_flags +live
-strftime 0 frag_%06d.ts
```

- "This muxer outputs streams to a number of separate files of nearly fixed
  duration."
- "The segment muxer works best with a single constant frame rate video."
- `segment_list_type csv` writes `filename,start_time,end_time` per finished
  segment — a convenient, cheap "fragment finalized" signal with PTS coverage.
- `reset_timestamps 0` keeps continuous PTS across fragments (needed to compute
  coverage and to concatenate). `reset_timestamps 1` would restart each
  fragment near zero.
- **No temp-file / atomic-rename behaviour.** The muxer writes directly to the
  final filename; a reader can observe a partially written segment. To satisfy
  AD-3 ("never hands an open fragment to inference") the worker must treat a
  segment as finalized only when (a) the CSV list row for it appears, or (b) the
  *next* segment file has been opened. Option (a) is simpler and gives PTS.

### `hls` muxer with `temp_file`

```
-f hls -hls_segment_type mpegts -hls_time 2 -hls_list_size 0
-hls_flags temp_file+independent_segments+program_date_time
-hls_segment_filename frag_%06d.ts frag.m3u8
```

- `temp_file`: "Write segment data to filename.tmp and rename to filename only
  once the segment is complete." — this **is** the atomic publication the plan
  wants at the FFmpeg boundary. It also writes playlists atomically.
- `independent_segments`: playlist tag asserting every segment starts with a
  keyframe (documentation of the guarantee, not enforcement).
- `program_date_time`: writes `EXT-X-PROGRAM-DATE-TIME` per segment, a
  wall-clock stamp derived from the muxer clock — a second source of receive
  time.
- `split_by_time` must **not** be set (it allows non-keyframe splits).
- `hls_list_size 0` keeps every segment in the playlist; with `omit_endlist`
  the playlist stays "live". The `.m3u8` is a byproduct; the worker still owns
  the manifest.
- The `hls` demuxer/muxer is heavier than `segment` but the atomic rename is
  worth it. Recommendation for Phase 3: use `hls` + `temp_file` and read
  `#EXTINF` durations plus `PROGRAM-DATE-TIME` from the playlist; keep the
  option to fall back to `segment` + CSV list.

Both muxers require the *encoder* to place keyframes at the desired times;
they do not re-encode.

## Windows from fragments

MPEG-TS is byte-concatenable. For an 8-second window from four consecutive
finalized fragments with continuous timestamps:

```
ffmpeg -nostdin -hide_banner -loglevel error -y
  -f concat -safe 0 -protocol_whitelist file,concat -i window_list.txt
  -c copy -movflags +faststart window.mp4
```

or simply `cat f1.ts f2.ts f3.ts f4.ts | ffmpeg -i pipe:0 -c copy ...`.
`-c copy` avoids a second encode; `lib/video/proxy-encode.ts` then reads the
standalone MP4 as it does today (`-ss` before `-i` on a seekable file).

# 4. Receive-clock anchoring (AD-16)

The plan defers the mechanism ("Phase 2 must prove"). Concrete options:

1. **`-use_wallclock_as_timestamps 1`** (input option):
   > "Use wallclock as timestamps if set to 1. Default is 0."
   FFmpeg replaces incoming packet timestamps with the local wall clock at
   receive time. This yields receive-anchored PTS directly and makes
   `window_end_at` = PTS. It discards source timing (jitter becomes PTS
   jitter), so it should be used **for the anchor sample**, not necessarily for
   the encoded output. A common pattern is to run it once at epoch start to
   measure `anchor_utc - first_pts`, or to record the muxer's
   `EXT-X-PROGRAM-DATE-TIME` alongside the fragment's first PTS.
2. **Playlist `PROGRAM-DATE-TIME`** (hls muxer flag above): the muxer stamps
   each segment with wall time when the segment starts. Difference between
   this and the segment's first PTS gives the anchor; the spread across
   segments gives `uncertainty_ms` empirically.
3. **RTCP Sender Reports**: RTSP/RTP carries NTP↔RTP mappings from the sender.
   FFmpeg uses them internally for A/V sync but does not expose them on the
   command line. Not usable without library-level code. Note that MediaMTX by
   default **rewrites** timestamps to its own clock (`useAbsoluteTimestamp:
   false`), so a fixture through MediaMTX cannot prove camera-clock fidelity
   anyway — which is consistent with the plan's decision to treat event time as
   receive-anchored.

Recommendation: adopt (2) as the primary anchor because it is free with the
`hls` muxer, sample the worker's own `Date.now()`/`process.hrtime.bigint()`
when the finalized fragment is detected as a cross-check, and persist the
observed spread as `uncertainty_ms`. Do not claim sub-fragment precision.

# 5. Process supervision requirements (Phase 2)

- Spawn with `child_process.spawn(binary, argv, { stdio: ['ignore', 'ignore', 'pipe'] })`
  — no shell. Add `-nostdin` so FFmpeg never waits on a TTY.
- Read stderr **incrementally**; FFmpeg logs RTSP errors (e.g. `Connection
  timed out`, `Server returned 401`, `Invalid data found`) there. Classify by
  pattern into retryable vs fatal. Bound the retained stderr ring buffer.
- Graceful stop: send `SIGINT` (FFmpeg finalizes the current segment and
  playlist on SIGINT), wait for `LIVE_STOP_DRAIN_TIMEOUT_MS`, then `SIGKILL`.
  A killed process leaves a `.tmp` (hls) or partial `.ts` (segment) that the
  manifest reducer must treat as never finalized.
- `-loglevel level+warning` (or `+info`) instead of `error` during Phase 2
  fixtures so timestamp discontinuity warnings are visible.
- `-re` is only for *publishing* a file at real-time pace (fixture side); never
  use it on the capture side.
- Encoding cost: real-time libx264 `veryfast` at ≤720p is the safe default for
  a one-stream developer machine. The per-window proxy encoder adds another
  ~1–3 s of CPU per window (measured 3.3 s/window end-to-end sequential in the
  file E2E, including two inferences), so total CPU headroom for two streams
  is not proven.

# 6. Argument-array sketch for the RTSP adapter (to be validated on the pinned build)

```
ffmpeg -nostdin -hide_banner -loglevel level+warning
  -protocol_whitelist rtsp,tcp
  -rtsp_transport tcp -allowed_media_types video,audio
  -timeout 15000000 -rw_timeout 15000000
  -i <url with in-memory credentials>
  -map 0:v:0 -map 0:a:0?
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p
  -force_key_frames "expr:gte(t,n_forced*2)" -sc_threshold 0 -g 60
  -c:a aac -ac 1 -ar 48000 -b:a 64k
  -f hls -hls_segment_type mpegts -hls_time 2 -hls_list_size 0
  -hls_flags temp_file+independent_segments+program_date_time
  -hls_segment_filename <spool>/frag_%06d.ts <spool>/frag.m3u8
```

Notes: `-map 0:a:0?` makes audio optional (LVR-FR-11 "absent audio is a
valid video-only window"). Audio is re-encoded to AAC inside the TS fragments;
the per-window Opus 16 kbps proxy for inference is still produced by
`encodeAudioProxy` from the window MP4, unchanged.
