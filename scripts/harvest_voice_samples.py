#!/usr/bin/env python3
"""
Harvest voice samples from reviewed/diarized episodes.

Scans episodes where:
  - is_downloaded = 1 AND has_diarization = 1
  - episode_speakers has at least one row with speaker_id IS NOT NULL

For each episode, extracts the longest clean segments per speaker and
adds them to the voice library (via voice_library.add_speaker).

Usage:
    python harvest_voice_samples.py \
        --db-path data/ice_cream_social.db \
        --library-dir scripts/voice_library \
        --audio-base scripts/episodes \
        --min-secs 4.0 \
        --max-per-speaker-per-episode 5 \
        [--dry-run]
"""

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Optional

def is_placeholder_speaker_name(name: str) -> bool:
    if not name:
        return False
    if name.startswith("SPEAKER_"):
        return True
    compact = name.strip().lower().replace(" ", "").replace("_", "").replace("-", "")
    return compact.startswith("speaker") and compact[len("speaker"):].isdigit()


def get_episodes_with_speakers(db_path: Path, episode_id: Optional[int] = None) -> list:
    """Return episodes that have diarization AND at least one confirmed speaker assignment."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    sql = """
        SELECT DISTINCT
            e.id,
            e.audio_file_path,
            e.published_date,
            e.episode_number
        FROM episodes e
        INNER JOIN episode_speakers es ON es.episode_id = e.id
        INNER JOIN speakers s ON s.id = es.speaker_id
        WHERE e.is_downloaded = 1
          AND e.has_diarization = 1
          AND es.speaker_id IS NOT NULL
        ORDER BY e.published_date ASC
    """
    params = ()
    if episode_id is not None:
        sql = sql.replace("ORDER BY", "AND e.id = ? ORDER BY")
        params = (episode_id,)
    cur.execute(sql, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def get_speaker_label_map(db_path: Path, episode_id: int) -> dict:
    """Return {diarization_label: speaker_name} for an episode (confirmed assignments only)."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT es.diarization_label, s.name AS speaker_name
        FROM episode_speakers es
        INNER JOIN speakers s ON s.id = es.speaker_id
        WHERE es.episode_id = ?
          AND es.speaker_id IS NOT NULL
    """, (episode_id,))
    result = {row["diarization_label"]: row["speaker_name"] for row in cur.fetchall()}
    conn.close()
    return result


def get_segments_for_label(db_path: Path, episode_id: int, label: str,
                            min_secs: float, max_count: int) -> list:
    """Return longest segments for a diarization label, sorted by duration DESC."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT segment_idx, start_time, end_time, text
        FROM transcript_segments
        WHERE episode_id = ?
          AND speaker = ?
          AND (end_time - start_time) >= ?
        ORDER BY (end_time - start_time) DESC
        LIMIT ?
    """, (episode_id, label, min_secs, max_count))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def extract_audio_clip(audio_path: Path, start: float, end: float,
                        out_dir: Path, prefix: str) -> Optional[Path]:
    """Extract an audio clip using soundfile/librosa. Returns the output path or None."""
    try:
        import soundfile as sf
        import numpy as np
    except ImportError:
        # Fall back to ffmpeg if soundfile not available
        return extract_audio_clip_ffmpeg(audio_path, start, end, out_dir, prefix)

    try:
        data, sr = sf.read(str(audio_path), start=int(start * 44100), stop=int(end * 44100))
        out_path = out_dir / f"{prefix}.wav"
        sf.write(str(out_path), data, sr)
        return out_path
    except Exception:
        # Try with librosa for mp3 files
        return extract_audio_clip_ffmpeg(audio_path, start, end, out_dir, prefix)


def extract_audio_clip_ffmpeg(audio_path: Path, start: float, end: float,
                               out_dir: Path, prefix: str) -> Optional[Path]:
    """Extract audio clip using ffmpeg subprocess."""
    import subprocess
    out_path = out_dir / f"{prefix}.wav"
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
        if result.returncode == 0 and out_path.exists():
            return out_path
    except Exception:
        pass
    return None


def ensure_sample_db_record(db_path: Path, speaker_name: str, episode_id: int,
                             segment_idx: int, start_time: float, end_time: float,
                             transcript_text: str, file_path: str):
    """Insert a voice_samples DB record (idempotent — skips if file_path already exists)."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        INSERT INTO voice_samples (speaker_name, episode_id, segment_idx, start_time, end_time, transcript_text, file_path, source)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM voice_samples WHERE file_path = ?)
    """, (speaker_name, episode_id, segment_idx, start_time, end_time, transcript_text, file_path, "harvest", file_path))
    conn.commit()
    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Harvest voice samples from reviewed episodes")
    parser.add_argument("--db-path", type=Path, default=Path("data/ice_cream_social.db"))
    parser.add_argument("--library-dir", type=Path, default=Path("scripts/voice_library"))
    parser.add_argument("--audio-base", type=Path, default=Path("scripts/episodes"))
    parser.add_argument("--min-secs", type=float, default=4.0, help="Minimum segment length in seconds")
    parser.add_argument("--max-per-speaker-per-episode", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true", help="Report what would be done without extracting")
    parser.add_argument("--episode-id", type=int, default=None, help="Process only one episode ID")
    parser.add_argument("--backend", type=str, default="pyannote", choices=["ecapa-tdnn", "pyannote"],
                        help="Embedding backend")
    parser.add_argument("--store-mode", type=str, default="sqlite", choices=["auto", "json", "sqlite"],
                        help="Voice embedding store mode")
    args = parser.parse_args()

    # Resolve to absolute paths
    project_root = Path(__file__).parent.parent
    db_path = args.db_path if args.db_path.is_absolute() else project_root / args.db_path
    library_dir = args.library_dir if args.library_dir.is_absolute() else project_root / args.library_dir
    audio_base = args.audio_base if args.audio_base.is_absolute() else project_root / args.audio_base

    samples_dir = library_dir / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    # Import voice library
    sys.path.insert(0, str(Path(__file__).parent))
    from voice_library import VoiceLibrary, get_hf_token

    hf_token = get_hf_token()
    try:
        library = VoiceLibrary(
            hf_token,
            quiet=True,
            backend=args.backend,
            db_path=db_path,
            store_mode=args.store_mode,
        )
    except Exception as e:
        print(json.dumps({"status": "error", "error": f"Failed to initialize voice library: {e}"}))
        sys.exit(1)

    episodes = get_episodes_with_speakers(db_path, episode_id=args.episode_id)
    total = len(episodes)
    episodes_processed = 0
    samples_added = 0
    skipped = 0

    for ep_idx, ep in enumerate(episodes):
        episode_id = ep["id"]
        episode_number = str(ep.get("episode_number") or episode_id)
        published_date = ep.get("published_date", "")[:10] if ep.get("published_date") else None

        # Find audio file
        audio_path = None
        if ep.get("audio_file_path"):
            candidate = Path(ep["audio_file_path"])
            if not candidate.is_absolute():
                candidate = project_root / candidate
            if candidate.exists():
                audio_path = candidate

        if audio_path is None:
            # Try scanning audio_base
            ep_num = ep.get("episode_number", "")
            if ep_num:
                for ext in (".mp3", ".m4a", ".wav"):
                    for f in audio_base.glob(f"*{ep_num}*{ext}"):
                        audio_path = f
                        break
                if audio_path:
                    break

        if audio_path is None:
            skipped += 1
            print(f"HARVEST_PROGRESS: {ep_idx + 1}/{total}", flush=True)
            continue

        label_map = get_speaker_label_map(db_path, episode_id)
        if not label_map:
            skipped += 1
            print(f"HARVEST_PROGRESS: {ep_idx + 1}/{total}", flush=True)
            continue

        episodes_processed += 1

        for label, speaker_name in label_map.items():
            if is_placeholder_speaker_name(speaker_name):
                skipped += 1
                continue
            segments = get_segments_for_label(db_path, episode_id, label,
                                               args.min_secs, args.max_per_speaker_per_episode)
            # Per-speaker output directory
            speaker_dir = samples_dir / speaker_name.replace(" ", "_")
            speaker_dir.mkdir(exist_ok=True)

            for seg in segments:
                seg_idx = seg["segment_idx"]
                start = seg["start_time"]
                end = seg["end_time"]
                text = seg.get("text", "")

                epnum_compact = "".join(ch for ch in episode_number if ch.isalnum()) or str(episode_id)
                # Unique filename: ep{episodeNumber}_id{dbId}_seg{idx}.wav
                prefix = f"ep{epnum_compact}_id{episode_id}_seg{seg_idx}"
                out_file = speaker_dir / f"{prefix}.wav"

                if out_file.exists():
                    skipped += 1
                    continue

                if args.dry_run:
                    print(f"  [dry-run] Would extract {speaker_name} ep{episode_id} seg{seg_idx} "
                          f"{start:.1f}-{end:.1f}s", flush=True)
                    samples_added += 1
                    continue

                clipped = extract_audio_clip(audio_path, start, end, speaker_dir, prefix)
                if clipped and clipped.exists():
                    # Add to voice library
                    library.add_speaker(speaker_name, clipped,
                                         update_existing=True, sample_date=published_date)
                    # Record in DB
                    ensure_sample_db_record(
                        db_path, speaker_name, episode_id, seg_idx,
                        start, end, text, str(clipped)
                    )
                    samples_added += 1
                else:
                    skipped += 1

        print(f"HARVEST_PROGRESS: {ep_idx + 1}/{total}", flush=True)

    print(json.dumps({
        "status": "success",
        "episodes_processed": episodes_processed,
        "samples_added": samples_added,
        "skipped": skipped,
    }))


if __name__ == "__main__":
    main()
