#!/usr/bin/env bash
# Publish the local macOS camera (AVFoundation) to the MediaMTX RTSP fixture.
#
# Default target: rtsp://127.0.0.1:8554/webcam
# Worker secret example (in .env.worker only):
#   LIVE_SOURCE_WEBCAM_URL={"url":"rtsp://127.0.0.1:8554/webcam"}
#
# Prerequisites:
#   - ffmpeg with avfoundation (Homebrew: brew install ffmpeg)
#   - MediaMTX listening on 8554 (docker compose -f docker-compose.live.yml up -d mediamtx)
#   - macOS Camera (and Microphone if --with-audio) permission for Terminal/iTerm
#
# Usage:
#   yarn live-webcam-publish              # or: ./scripts/live-webcam-publish.sh
#   yarn live-webcam-publish --list
#   yarn live-webcam-publish --smoke
#   yarn live-webcam-publish --with-audio --video-device 0 --audio-device 2
#   yarn live-webcam-publish --path fixture   # only if live-publisher is stopped

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
HOST="${LIVE_WEBCAM_HOST:-127.0.0.1}"
PORT="${LIVE_WEBCAM_PORT:-8554}"
PATH_NAME="${LIVE_WEBCAM_PATH:-webcam}"
VIDEO_DEVICE="${LIVE_WEBCAM_VIDEO_DEVICE:-0}"
AUDIO_DEVICE="${LIVE_WEBCAM_AUDIO_DEVICE:-}"
FRAMERATE="${LIVE_WEBCAM_FRAMERATE:-30}"
VIDEO_SIZE="${LIVE_WEBCAM_SIZE:-1280x720}"
# AVFoundation capture pixel format (uyvy422|nv12|yuyv422). Required for many Mac cameras.
PIXEL_FORMAT="${LIVE_WEBCAM_PIXEL_FORMAT:-uyvy422}"
WITH_AUDIO=0
LIST_ONLY=0
SMOKE=0
SMOKE_SECONDS="${LIVE_WEBCAM_SMOKE_SECONDS:-5}"

usage() {
  cat <<EOF
${SCRIPT_NAME} — publish macOS webcam to MediaMTX RTSP

Usage:
  ${SCRIPT_NAME} [options]

Options:
  -h, --help              Show this help
  -l, --list              List AVFoundation devices and exit
  -s, --smoke             Publish briefly then exit (default ${SMOKE_SECONDS}s)
  -a, --with-audio        Include microphone (default: video only)
  --host <host>           MediaMTX host (default: ${HOST})
  --port <port>           MediaMTX RTSP port (default: ${PORT})
  --path <name>           RTSP path (default: ${PATH_NAME}; fixture e2e uses "fixture")
  --video-device <idx>    AVFoundation video index (default: ${VIDEO_DEVICE})
  --audio-device <idx>    AVFoundation audio index (required with --with-audio unless set)
  --framerate <n>         Capture framerate (default: ${FRAMERATE})
  --size <WxH>            Capture size (default: ${VIDEO_SIZE})
  --pixel-format <fmt>    Capture pixel format (default: ${PIXEL_FORMAT})
  --smoke-seconds <n>     Smoke duration seconds (default: ${SMOKE_SECONDS})

Environment overrides: LIVE_WEBCAM_HOST, LIVE_WEBCAM_PORT, LIVE_WEBCAM_PATH,
  LIVE_WEBCAM_VIDEO_DEVICE, LIVE_WEBCAM_AUDIO_DEVICE, LIVE_WEBCAM_FRAMERATE,
  LIVE_WEBCAM_SIZE, LIVE_WEBCAM_PIXEL_FORMAT, LIVE_WEBCAM_SMOKE_SECONDS

Typical flow:
  1. docker compose -f docker-compose.live.yml up -d mediamtx
     (recreate after mediamtx.yml changes: docker compose -f docker-compose.live.yml up -d --force-recreate mediamtx)
  2. ${SCRIPT_NAME} --list
  3. ${SCRIPT_NAME}                 # leave running (publishes to host 127.0.0.1:8554)
  4. In .env.worker (URL = what the *worker* dials):
       # Docker live-worker:
       LIVE_SOURCE_WEBCAM_URL={"url":"rtsp://host.docker.internal:8554/webcam"}
       # Host yarn live-worker instead:
       # LIVE_SOURCE_WEBCAM_URL={"url":"rtsp://127.0.0.1:8554/webcam"}
  5. Restart live-worker; open /live → connection_ref LIVE_SOURCE_WEBCAM_URL → Start


macOS permissions:
  System Settings → Privacy & Security → Camera (and Microphone if --with-audio)
  must allow the terminal app that runs ffmpeg (Terminal, iTerm, Cursor, etc.).
  Prefer running this script from Terminal.app / iTerm — Cursor agent shells often
  cannot complete AVFoundation open (list works; open hangs or returns I/O error).

Notes:
  - Default path "webcam" is additive; docker live-publisher keeps using /fixture.
  - Do not point this script at /fixture while live-publisher is running.
  - If capture fails with pixel-format errors, try --pixel-format nv12.
  - Built-in mic index changes with attached devices; always --list before --with-audio.
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -l|--list)
      LIST_ONLY=1
      shift
      ;;
    -s|--smoke)
      SMOKE=1
      shift
      ;;
    -a|--with-audio)
      WITH_AUDIO=1
      shift
      ;;
    --host)
      [[ $# -ge 2 ]] || die "--host requires a value"
      HOST="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || die "--port requires a value"
      PORT="$2"
      shift 2
      ;;
    --path)
      [[ $# -ge 2 ]] || die "--path requires a value"
      PATH_NAME="$2"
      shift 2
      ;;
    --video-device)
      [[ $# -ge 2 ]] || die "--video-device requires a value"
      VIDEO_DEVICE="$2"
      shift 2
      ;;
    --audio-device)
      [[ $# -ge 2 ]] || die "--audio-device requires a value"
      AUDIO_DEVICE="$2"
      shift 2
      ;;
    --framerate)
      [[ $# -ge 2 ]] || die "--framerate requires a value"
      FRAMERATE="$2"
      shift 2
      ;;
    --size)
      [[ $# -ge 2 ]] || die "--size requires a value"
      VIDEO_SIZE="$2"
      shift 2
      ;;
    --pixel-format)
      [[ $# -ge 2 ]] || die "--pixel-format requires a value"
      PIXEL_FORMAT="$2"
      shift 2
      ;;
    --smoke-seconds)
      [[ $# -ge 2 ]] || die "--smoke-seconds requires a value"
      SMOKE_SECONDS="$2"
      shift 2
      ;;
    *)
      die "unknown option: $1 (try --help)"
      ;;
  esac
done

require_ffmpeg() {
  if ! command -v ffmpeg >/dev/null 2>&1; then
    die "ffmpeg not found. On macOS: brew install ffmpeg"
  fi
  if ! ffmpeg -hide_banner -devices 2>/dev/null | grep -qi avfoundation; then
    # Older builds list devices differently; still try list_devices below.
    :
  fi
}

check_mediamtx() {
  local url="rtsp://${HOST}:${PORT}/"
  if command -v nc >/dev/null 2>&1; then
    if ! nc -z -G 2 "${HOST}" "${PORT}" >/dev/null 2>&1; then
      die "MediaMTX does not appear to listen on ${HOST}:${PORT}.
Start it with:
  docker compose -f docker-compose.live.yml up -d mediamtx
If you just edited test/fixtures/live/mediamtx.yml, recreate:
  docker compose -f docker-compose.live.yml up -d --force-recreate mediamtx"
    fi
    return 0
  fi
  # Fallback when nc is unavailable: try a short ffprobe (may fail if no stream yet).
  if ! (echo >/dev/tcp/"${HOST}"/"${PORT}") >/dev/null 2>&1; then
    die "cannot reach ${HOST}:${PORT}. Start MediaMTX:
  docker compose -f docker-compose.live.yml up -d mediamtx"
  fi
}

list_devices() {
  require_ffmpeg
  echo "AVFoundation devices (ffmpeg -f avfoundation -list_devices true -i \"\"):"
  echo
  # ffmpeg returns non-zero when listing devices; ignore exit status.
  ffmpeg -hide_banner -f avfoundation -list_devices true -i "" 2>&1 || true
  echo
  echo "Pick --video-device / --audio-device from the [n] indices above."
  echo "Built-in camera is often video 0; microphone often audio 2 on MacBook."
}

require_ffmpeg

if [[ "${LIST_ONLY}" -eq 1 ]]; then
  list_devices
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  die "this script targets macOS AVFoundation. On other OSes, publish with a local ffmpeg input to rtsp://${HOST}:${PORT}/${PATH_NAME}"
fi

check_mediamtx

if [[ "${WITH_AUDIO}" -eq 1 ]]; then
  if [[ -z "${AUDIO_DEVICE}" ]]; then
    die "--with-audio requires --audio-device <idx> (run --list to see indices)"
  fi
  # video:audio — both indices required when capturing mic.
  AV_INPUT="${VIDEO_DEVICE}:${AUDIO_DEVICE}"
else
  # Video-only: use a bare video index. Do NOT use ":none" — FFmpeg 8 reports
  # "Invalid device index" for that form on current Homebrew builds.
  AV_INPUT="${VIDEO_DEVICE}"
fi

RTSP_URL="rtsp://${HOST}:${PORT}/${PATH_NAME}"

echo "Publishing AVFoundation ${AV_INPUT} → ${RTSP_URL}"
echo "  size=${VIDEO_SIZE} fps=${FRAMERATE} pixel_format=${PIXEL_FORMAT} audio=$([[ ${WITH_AUDIO} -eq 1 ]] && echo on || echo off)"
echo "  Host publish URL: ${RTSP_URL}"
echo "  Docker live-worker secret tip:"
echo "    LIVE_SOURCE_WEBCAM_URL={\"url\":\"rtsp://host.docker.internal:${PORT}/${PATH_NAME}\"}"
echo "  (Do not use 127.0.0.1 inside the worker container — that is not the host.)"
echo "  Ctrl+C to stop."
echo

FFMPEG_ARGS=(
  -hide_banner
  -loglevel info
  -f avfoundation
  -pixel_format "${PIXEL_FORMAT}"
  -framerate "${FRAMERATE}"
  -video_size "${VIDEO_SIZE}"
  -i "${AV_INPUT}"
  -c:v libx264
  -pix_fmt yuv420p
  -tune zerolatency
  -preset ultrafast
  -g $((FRAMERATE * 2))
)

if [[ "${WITH_AUDIO}" -eq 1 ]]; then
  FFMPEG_ARGS+=(
    -c:a aac
    -ar 16000
    -ac 1
  )
else
  FFMPEG_ARGS+=(-an)
fi

FFMPEG_ARGS+=(
  -f rtsp
  -rtsp_transport tcp
  "${RTSP_URL}"
)

run_publish() {
  ffmpeg "${FFMPEG_ARGS[@]}"
}

if [[ "${SMOKE}" -eq 1 ]]; then
  echo "Smoke mode: will stop after ${SMOKE_SECONDS}s…"
  echo "Note: if macOS shows a Camera permission dialog for this terminal, approve it and re-run."
  set +e
  # Prefer GNU timeout when available so a stuck TCC prompt cannot hang forever.
  if command -v gtimeout >/dev/null 2>&1 || command -v timeout >/dev/null 2>&1; then
    TO_BIN="$(command -v gtimeout || command -v timeout)"
    # +2s grace beyond smoke window for encoder teardown.
    "${TO_BIN}" --signal=TERM --kill-after=3 "$((SMOKE_SECONDS + 2))" \
      ffmpeg "${FFMPEG_ARGS[@]}"
    status=$?
  else
    ffmpeg "${FFMPEG_ARGS[@]}" &
    pid=$!
    (
      sleep "${SMOKE_SECONDS}"
      kill "${pid}" >/dev/null 2>&1
    ) &
    waiter=$!
    wait "${pid}"
    status=$?
    kill "${waiter}" >/dev/null 2>&1 || true
    wait "${waiter}" 2>/dev/null || true
  fi
  set -e
  # 0 = clean; 124 = GNU timeout; 143/130/255 = SIGTERM/SIGINT.
  if [[ "${status}" -eq 0 || "${status}" -eq 124 || "${status}" -eq 143 || "${status}" -eq 255 || "${status}" -eq 130 ]]; then
    if curl -sf "http://${HOST}:9997/v3/paths/get/${PATH_NAME}" 2>/dev/null | grep -q '"ready"[[:space:]]*:[[:space:]]*true\|"online"[[:space:]]*:[[:space:]]*true'; then
      echo "Smoke publish OK (exit=${status}): MediaMTX path /${PATH_NAME} saw a publisher."
    else
      echo "Smoke ffmpeg exited (exit=${status}). MediaMTX /${PATH_NAME} was not observed ready — if this was a forced stop before the first keyframe, re-run with a longer --smoke-seconds, or run without --smoke in a Terminal that has Camera access."
    fi
    exit 0
  fi
  echo "error: smoke publish failed (exit=${status}).
Common causes:
  - macOS Camera permission denied / pending for this terminal (System Settings → Privacy & Security → Camera)
  - wrong --video-device / unsupported --size (try 640x480) or --pixel-format nv12
  - MediaMTX path '${PATH_NAME}' not authorized (recreate mediamtx after mediamtx.yml update)
  - another publisher already owns the path" >&2
  exit "${status}"
fi

run_publish
