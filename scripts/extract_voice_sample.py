#!/usr/bin/env python3
"""
Extract a single voice sample clip from an episode audio file and add it to the voice library.

Usage:
    python extract_voice_sample.py \
        --audio-file path/to/episode.mp3 \
        --start 42.3 --end 49.8 \
        --speaker-name "Matt Donnelly" \
        --output-dir scripts/voice_library/samples \
        [--sample-date 2023-04-15] \
        [--episode-id 123] \
        [--segment-idx 45] \
        [--transcript-text "Some text here"] \
        [--db-path data/ice_cream_social.db]
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def extract_clip_ffmpeg(audio_path: Path, start: float, end: float, out_path: Path) -> bool:
    """Extract audio clip using ffmpeg. Returns True on success."""
    duration = end - start
    try:
        result = subprocess.run([
            "ffmpeg", "-y",
            "-ss", str(start),
            "-i", str(audio_path),
            "-t", str(duration),
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            str(out_path)
        ], capture_output=True, timeout=60)
        return result.returncode == 0 and out_path.exists()
    except Exception as e:
        print(f"ffmpeg error: {e}", file=sys.stderr)
        return False


def extract_clip_soundfile(audio_path: Path, start: float, end: float, out_path: Path) -> bool:
    """Extract audio clip using soundfile (handles WAV). Falls back to ffmpeg."""
    try:
        import soundfile as sf
        info = sf.info(str(audio_path))
        sr = info.samplerate
        start_frame = int(start * sr)
        end_frame = int(end * sr)
        data, sr_out = sf.read(str(audio_path), start=start_frame, stop=end_frame)
        sf.write(str(out_path), data, sr_out)
        return out_path.exists()
    except Exception:
        return extract_clip_ffmpeg(audio_path, start, end, out_path)


def insert_db_record(db_path: Path, speaker_name: str, episode_id: int,
                     segment_idx: int, start: float, end: float,
                     transcript_text: str, file_path: str):
    """Insert a voice_samples DB record (idempotent)."""
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        INSERT INTO voice_samples (speaker_name, episode_id, segment_idx, start_time, end_time, transcript_text, file_path, source)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM voice_samples WHERE file_path = ?)
    """, (speaker_name, episode_id, segment_idx, start, end, transcript_text, file_path, "auto", file_path))
    conn.commit()
    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Extract a voice sample clip and add to voice library")
    parser.add_argument("--audio-file", required=True, type=Path, help="Path to episode audio file")
    parser.add_argument("--start", required=True, type=float, help="Start time in seconds")
    parser.add_argument("--end", required=True, type=float, help="End time in seconds")
    parser.add_argument("--speaker-name", required=True, help="Full speaker name")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="Output directory (default: voice_library/samples/{speaker_name}/)")
    parser.add_argument("--sample-date", type=str, default=None, help="ISO date YYYY-MM-DD of the episode")
    parser.add_argument("--episode-id", type=int, default=None, help="Episode DB id")
    parser.add_argument("--segment-idx", type=int, default=None, help="Segment index")
    parser.add_argument("--transcript-text", type=str, default=None, help="Transcript text for the segment")
    parser.add_argument("--db-path", type=Path, default=None, help="Path to SQLite database")
    parser.add_argument("--backend", type=str, default="pyannote", choices=["ecapa-tdnn", "pyannote"],
                        help="Embedding backend")
    args = parser.parse_args()

    audio_path = args.audio_file
    if not audio_path.is_absolute():
        audio_path = Path(__file__).parent.parent / audio_path

    if not audio_path.exists():
        print(json.dumps({"status": "error", "error": f"Audio file not found: {audio_path}"}))
        sys.exit(1)

    duration = args.end - args.start
    if duration < 1.0:
        print(json.dumps({"status": "skipped", "reason": "segment too short"}))
        sys.exit(0)

    # Determine output directory
    if args.output_dir:
        out_dir = args.output_dir if args.output_dir.is_absolute() else Path(__file__).parent.parent / args.output_dir
    else:
        out_dir = Path(__file__).parent / "voice_library" / "samples" / args.speaker_name.replace(" ", "_")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Unique filename
    if args.episode_id is not None and args.segment_idx is not None:
        prefix = f"ep{args.episode_id}_seg{args.segment_idx}"
    else:
        import time
        prefix = f"clip_{int(time.time())}"

    out_path = out_dir / f"{prefix}.wav"

    # Extract clip
    ok = extract_clip_soundfile(audio_path, args.start, args.end, out_path)
    if not ok:
        print(json.dumps({"status": "error", "error": "Failed to extract audio clip"}))
        sys.exit(1)

    # Add to voice library
    sys.path.insert(0, str(Path(__file__).parent))
    from voice_library import VoiceLibrary, get_hf_token

    hf_token = get_hf_token()
    try:
        library = VoiceLibrary(hf_token, quiet=True, backend=args.backend)
        library.add_speaker(args.speaker_name, out_path,
                             update_existing=True, sample_date=args.sample_date)
        sample_count = library.embeddings.get(args.speaker_name, {}).get("sample_count", 1)
        result = {
            "status": "success",
            "file_path": str(out_path),
            "sample_count": sample_count,
        }
    except Exception as e:
        # Still save the file but skip embedding update if backend prerequisites are missing.
        result = {
            "status": "success",
            "file_path": str(out_path),
            "sample_count": None,
            "warning": f"Embedding not updated: {e}",
        }

    # Insert DB record if db_path and episode_id given
    if args.db_path and args.episode_id is not None and args.segment_idx is not None:
        db_path = args.db_path if args.db_path.is_absolute() else Path(__file__).parent.parent / args.db_path
        if db_path.exists():
            try:
                insert_db_record(
                    db_path, args.speaker_name, args.episode_id, args.segment_idx,
                    args.start, args.end, args.transcript_text or "", str(out_path)
                )
            except Exception as e:
                result["db_warning"] = str(e)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
