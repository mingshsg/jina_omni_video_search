#!/usr/bin/env python3
"""Transcribe one drama audio file on a Mac for the container to reuse.

Run on the host, where MLX can use the Apple GPU. The drama retry reads
subtitles/host_<language>.srt from the shared media directory. No container
ASR service or cloud API key is needed.
"""

import argparse
import math
from pathlib import Path


def timestamp(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, remainder = divmod(millis, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def srt_from_segments(segments: list[dict]) -> str:
    cues = []
    for segment in segments:
        text = str(segment.get("text", "")).strip()
        start = float(segment.get("start", math.nan))
        end = float(segment.get("end", math.nan))
        if not text or not math.isfinite(start) or not math.isfinite(end):
            continue
        if start < 0 or end <= start:
            continue
        cues.append(f"{len(cues) + 1}\n{timestamp(start)} --> {timestamp(end)}\n{text}")
    if not cues:
        raise ValueError("Whisper returned no valid timed segments; no SRT was written")
    return "\n\n".join(cues) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", required=True, type=Path, help="Extracted drama audio in the shared media directory")
    parser.add_argument("--lang", required=True, choices=("en", "zh", "ko", "th"))
    parser.add_argument("--model", default="mlx-community/whisper-large-v3-turbo")
    args = parser.parse_args()

    audio = args.audio.expanduser().resolve(strict=True)
    if not audio.is_file() or audio.parent.name != "audio" or audio.stem != f"asr_{args.lang}":
        parser.error("--audio must point to a drama run's audio/asr_<lang>.mp3")
    subtitles_dir = audio.parent.parent / "subtitles"
    if not subtitles_dir.is_dir():
        parser.error(f"Drama subtitles directory is missing: {subtitles_dir}")
    output_path = subtitles_dir / f"host_{args.lang}.srt"
    if output_path.exists():
        parser.error(f"Host transcript already exists; inspect it before replacing: {output_path}")

    try:
        import mlx_whisper
    except ImportError as exc:
        parser.error(f"mlx_whisper is unavailable in this Python environment: {exc}")

    result = mlx_whisper.transcribe(
        str(audio),
        path_or_hf_repo=args.model,
        language=args.lang,
        task="transcribe",
        verbose=False,
    )
    body = srt_from_segments(result.get("segments", []))
    # Exclusive create leaves any existing subtitle untouched, including one
    # created while transcription was running.
    with output_path.open("x", encoding="utf-8") as output:
        output.write(body)
    print(f"Wrote {body.count(' --> ')} timed segments to {output_path}")


if __name__ == "__main__":
    main()
