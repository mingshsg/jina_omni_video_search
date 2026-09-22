# Live video worker image (Phase 1/2 scaffold).
# Separate from the Next.js app image: Node 22 Bookworm + apt ffmpeg.
# At acceptance: build, then record digest via:
#   docker images --digests
#   LIVE_WORKER_IMAGE_DIGEST=sha256:... yarn probe-live-worker
#
# Retention/spool: media until explicit delete; spool grows until disk full
# unless optional LIVE_*_MAX_BYTES caps are set.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false

COPY . .

# Spool is mounted at runtime; lock file lives at ${LIVE_SPOOL_DIR}/.worker.lock
ENV LIVE_SPOOL_DIR=/app/data/live-spool
VOLUME ["/app/data/live-spool"]

CMD ["yarn", "live-worker"]

LABEL org.opencontainers.image.title="jina-video-embedding-live-worker" \
  org.opencontainers.image.description="Live RTSP worker with FFmpeg"
