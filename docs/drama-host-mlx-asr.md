# Run drama ASR on the Mac host

The app container extracts `audio/asr_<lang>.mp3` in the shared drama run
directory. If no matching subtitle exists and container ASR is not configured,
the first subtitle attempt fails but leaves that audio in place. Run the small
host script once per **spoken** language, then use the video's **Retry** action
in Library. The retry keeps the same run ID and reads
`subtitles/host_<lang>.srt` before trying any configured ASR. No cloud ASR key,
Ollama service, or Python package in the container is needed.

On an Apple Silicon Mac with `mlx_whisper` installed:

```bash
/usr/local/bin/python3 scripts/drama-mlx-whisper-host.py \
  --audio data/media/<video-id>/drama/<run-id>/audio/asr_en.mp3 \
  --lang en
```

The script writes `data/media/<video-id>/drama/<run-id>/subtitles/host_en.srt`
and refuses to overwrite an existing host transcript. Review the timed SRT
before retrying. For Chinese, Korean, or Thai speech, use the matching
`asr_zh.mp3`/`asr_ko.mp3`/`asr_th.mp3` and `--lang zh`/`ko`/`th`. `--lang`
requests transcription in that language; it does **not** translate speech.
When a run requests both `en` and `zh`, the app can translate the missing
language from one timed original through its configured EIS chat endpoint.
Keep the host ASR language matched to the speech. A retry retains the original
output-language selection.

The default model is `mlx-community/whisper-large-v3-turbo`; use `--model` to
choose a different locally available MLX Whisper model. The script runs only
on the host. Keep the media directory mounted into the app container as in
`docker-compose.yml`. App code changes require `docker compose up -d --build
app` before retrying in the browser; host script changes do not.

`subtitle_source=auto` checks video sidecars, embedded subtitles, then the
host transcript. `force_asr` also accepts the host transcript. An
`existing_only` run deliberately ignores ASR output and needs a video sidecar
or matching embedded subtitle instead.
