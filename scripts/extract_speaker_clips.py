#!/usr/bin/env python3
"""
Extract Speaker Clips - Extract audio segments by speaker from diarized episodes.

This script helps build the voice library by extracting clean speaker clips
from already-diarized episodes.

Usage:
    # List speakers and their segments in an episode
    python extract_speaker_clips.py list 1264

    # Extract clips for a specific speaker label
    python extract_speaker_clips.py extract 1264 SPEAKER_00 --name "Matt Donnelly"

    # Extract all speakers to separate folders for review
    python extract_speaker_clips.py extract-all 1264

    # Add extracted clip to voice library
    python extract_speaker_clips.py add-to-library "Matt Donnelly" path/to/clip.wav
"""

import json
import argparse
from pathlib import Path
from typing import Dict, List, Optional
import subprocess
import sys

# Paths
SCRIPTS_DIR = Path(__file__).parent
TRANSCRIPTS_DIR = SCRIPTS_DIR / "transcripts"
EPISODES_DIR = SCRIPTS_DIR / "episodes"
CLIPS_DIR = SCRIPTS_DIR / "speaker_clips"

# Ensure clips directory exists
CLIPS_DIR.mkdir(exist_ok=True)


def find_episode_files(episode_number: str) -> tuple:
    """Find transcript and audio files for an episode number"""
    # Find transcript with speakers
    transcript_path = None
    for f in TRANSCRIPTS_DIR.glob("*_with_speakers.json"):
        if episode_number in f.name:
            transcript_path = f
            break

    if not transcript_path:
        # Try without _with_speakers
        for f in TRANSCRIPTS_DIR.glob("*.json"):
            if episode_number in f.name and "_with_speakers" not in f.name:
                # Check if _with_speakers version exists
                ws_path = f.with_name(f"{f.stem}_with_speakers.json")
                if ws_path.exists():
                    transcript_path = ws_path
                    break

    # Find audio file
    audio_path = None
    for f in EPISODES_DIR.glob("*.mp3"):
        if episode_number in f.name:
            audio_path = f
            break

    return transcript_path, audio_path


def load_diarization(transcript_path: Path) -> Dict:
    """Load diarization data from transcript"""
    with open(transcript_path) as f:
        data = json.load(f)

    return data.get("diarization", {})


def parse_timestamp(ts_str: str) -> float:
    """Parse timestamp string like '00:01:23,456' to seconds"""
    try:
        ts_str = ts_str.replace(',', '.')
        parts = ts_str.split(':')
        if len(parts) == 3:
            h, m, s = parts
            return float(h) * 3600 + float(m) * 60 + float(s)
        return 0.0
    except:
        return 0.0


def get_speaker_segments(transcript_path: Path) -> Dict[str, List[Dict]]:
    """Get segments grouped by speaker"""
    with open(transcript_path) as f:
        data = json.load(f)

    # First try diarization segments (raw timing data)
    diarization = data.get("diarization", {})
    segments = diarization.get("segments", [])

    if segments:
        # Group by speaker
        speaker_segments = {}
        for seg in segments:
            speaker = seg.get("speaker", "UNKNOWN")
            if speaker not in speaker_segments:
                speaker_segments[speaker] = []
            speaker_segments[speaker].append(seg)
        return speaker_segments

    # Fall back to transcription segments (whisper-cli format)
    trans_segments = data.get("transcription", [])
    if not trans_segments:
        return {}

    # Convert transcription segments to diarization format and group by speaker
    speaker_segments = {}
    for seg in trans_segments:
        speaker = seg.get("speaker", "UNKNOWN")
        if speaker not in speaker_segments:
            speaker_segments[speaker] = []

        # Parse timestamps
        timestamps = seg.get("timestamps", {})
        start = parse_timestamp(timestamps.get("from", "0"))
        end = parse_timestamp(timestamps.get("to", "0"))

        speaker_segments[speaker].append({
            "start": start,
            "end": end,
            "speaker": speaker,
            "text": seg.get("text", "")
        })

    return speaker_segments


def format_time(seconds: float) -> str:
    """Format seconds as HH:MM:SS"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def list_speakers(episode_number: str):
    """List all speakers and their segments in an episode"""
    transcript_path, audio_path = find_episode_files(episode_number)

    if not transcript_path:
        print(f"Error: No diarized transcript found for episode {episode_number}")
        print("Run diarization first: python re_diarize.py {episode_number}")
        return

    print(f"\nEpisode {episode_number}")
    print(f"Transcript: {transcript_path.name}")
    print(f"Audio: {audio_path.name if audio_path else 'NOT FOUND'}")
    print("=" * 60)

    speaker_segments = get_speaker_segments(transcript_path)

    if not speaker_segments:
        print("No speaker segments found. Diarization may not have completed.")
        return

    # Load identified speakers if available
    with open(transcript_path) as f:
        data = json.load(f)
    identified = data.get("diarization", {}).get("identified_speakers", {})

    for speaker, segments in sorted(speaker_segments.items()):
        total_time = sum(seg["end"] - seg["start"] for seg in segments)
        identified_name = identified.get(speaker)

        print(f"\n{speaker}", end="")
        if identified_name:
            print(f" -> {identified_name}", end="")
        print()
        print(f"  Segments: {len(segments)}")
        print(f"  Total speaking time: {format_time(total_time)} ({total_time:.1f}s)")

        # Show longest segments (best for voice samples)
        sorted_segs = sorted(segments, key=lambda s: s["end"] - s["start"], reverse=True)
        print(f"  Longest segments (best for voice samples):")
        for seg in sorted_segs[:5]:
            duration = seg["end"] - seg["start"]
            print(f"    {format_time(seg['start'])} - {format_time(seg['end'])} ({duration:.1f}s)")


def extract_clip(audio_path: Path, start: float, end: float, output_path: Path) -> bool:
    """Extract a clip from audio file using ffmpeg"""
    try:
        duration = end - start
        cmd = [
            "ffmpeg", "-y",
            "-i", str(audio_path),
            "-ss", str(start),
            "-t", str(duration),
            "-acodec", "pcm_s16le",  # WAV format for best quality
            "-ar", "16000",  # 16kHz for pyannote
            "-ac", "1",  # Mono
            str(output_path)
        ]
        subprocess.run(cmd, capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error extracting clip: {e}")
        return False
    except FileNotFoundError:
        print("Error: ffmpeg not found. Please install ffmpeg.")
        return False


def extract_speaker_clips(episode_number: str, speaker_label: str,
                          speaker_name: Optional[str] = None,
                          num_clips: int = 5, min_duration: float = 5.0):
    """Extract clips for a specific speaker"""
    transcript_path, audio_path = find_episode_files(episode_number)

    if not transcript_path:
        print(f"Error: No diarized transcript found for episode {episode_number}")
        return

    if not audio_path:
        print(f"Error: No audio file found for episode {episode_number}")
        return

    speaker_segments = get_speaker_segments(transcript_path)

    if speaker_label not in speaker_segments:
        print(f"Error: Speaker '{speaker_label}' not found in episode {episode_number}")
        print(f"Available speakers: {', '.join(speaker_segments.keys())}")
        return

    segments = speaker_segments[speaker_label]

    # Filter by minimum duration and sort by length
    valid_segments = [s for s in segments if s["end"] - s["start"] >= min_duration]
    valid_segments.sort(key=lambda s: s["end"] - s["start"], reverse=True)

    if not valid_segments:
        print(f"No segments >= {min_duration}s found for {speaker_label}")
        return

    # Create output directory
    name_slug = (speaker_name or speaker_label).replace(" ", "_").lower()
    output_dir = CLIPS_DIR / f"ep{episode_number}_{name_slug}"
    output_dir.mkdir(exist_ok=True)

    print(f"\nExtracting {min(num_clips, len(valid_segments))} clips for {speaker_label}")
    if speaker_name:
        print(f"Speaker name: {speaker_name}")
    print(f"Output directory: {output_dir}")
    print()

    extracted = []
    for i, seg in enumerate(valid_segments[:num_clips]):
        duration = seg["end"] - seg["start"]
        output_file = output_dir / f"clip_{i+1}_{format_time(seg['start']).replace(':', '')}.wav"

        print(f"  Extracting clip {i+1}: {format_time(seg['start'])} - {format_time(seg['end'])} ({duration:.1f}s)")

        if extract_clip(audio_path, seg["start"], seg["end"], output_file):
            extracted.append(output_file)
            print(f"    Saved: {output_file.name}")

    print(f"\nExtracted {len(extracted)} clips to: {output_dir}")

    if speaker_name and extracted:
        print(f"\nTo add to voice library, run:")
        print(f"  python voice_library.py add \"{speaker_name}\" {extracted[0]}")

        # Or merge clips for a longer sample
        if len(extracted) > 1:
            merged_path = output_dir / f"{name_slug}_merged.wav"
            print(f"\nOr merge clips for a better sample:")
            print(f"  python extract_speaker_clips.py merge {output_dir} --output {merged_path}")


def extract_all_speakers(episode_number: str, num_clips: int = 3, min_duration: float = 5.0):
    """Extract clips for all speakers in an episode"""
    transcript_path, audio_path = find_episode_files(episode_number)

    if not transcript_path:
        print(f"Error: No diarized transcript found for episode {episode_number}")
        return

    if not audio_path:
        print(f"Error: No audio file found for episode {episode_number}")
        return

    speaker_segments = get_speaker_segments(transcript_path)

    print(f"\nExtracting clips for all {len(speaker_segments)} speakers in episode {episode_number}")
    print("=" * 60)

    for speaker_label in sorted(speaker_segments.keys()):
        if speaker_label == "UNKNOWN":
            continue
        print(f"\n--- {speaker_label} ---")
        extract_speaker_clips(episode_number, speaker_label,
                            num_clips=num_clips, min_duration=min_duration)


def merge_clips(clip_dir: Path, output_path: Optional[Path] = None):
    """Merge multiple clips into a single file"""
    clip_files = sorted(clip_dir.glob("clip_*.wav"))

    if not clip_files:
        print(f"No clip files found in {clip_dir}")
        return

    if output_path is None:
        output_path = clip_dir / "merged.wav"

    # Create concat file for ffmpeg
    concat_file = clip_dir / "concat.txt"
    with open(concat_file, "w") as f:
        for clip in clip_files:
            f.write(f"file '{clip.absolute()}'\n")

    try:
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            str(output_path)
        ]
        subprocess.run(cmd, capture_output=True, check=True)
        print(f"Merged {len(clip_files)} clips into: {output_path}")

        # Clean up concat file
        concat_file.unlink()

        return output_path
    except subprocess.CalledProcessError as e:
        print(f"Error merging clips: {e}")
        return None


def add_to_library(speaker_name: str, audio_path: Path):
    """Add a clip to the voice library"""
    # Import voice library
    try:
        from voice_library import VoiceLibrary, get_hf_token
    except ImportError:
        print("Error: voice_library.py not found")
        return

    hf_token = get_hf_token()
    if not hf_token:
        print("Error: HuggingFace token not found")
        return

    library = VoiceLibrary(hf_token)
    library.add_speaker(speaker_name, audio_path)


def main():
    parser = argparse.ArgumentParser(description="Extract speaker clips from diarized episodes")
    subparsers = parser.add_subparsers(dest="command", help="Command")

    # List command
    list_parser = subparsers.add_parser("list", help="List speakers and segments in an episode")
    list_parser.add_argument("episode", help="Episode number (e.g., 1264)")

    # Extract command
    extract_parser = subparsers.add_parser("extract", help="Extract clips for a speaker")
    extract_parser.add_argument("episode", help="Episode number")
    extract_parser.add_argument("speaker", help="Speaker label (e.g., SPEAKER_00)")
    extract_parser.add_argument("--name", help="Speaker's real name")
    extract_parser.add_argument("--clips", type=int, default=5, help="Number of clips to extract")
    extract_parser.add_argument("--min-duration", type=float, default=5.0,
                               help="Minimum clip duration in seconds")

    # Extract-all command
    extract_all_parser = subparsers.add_parser("extract-all", help="Extract clips for all speakers")
    extract_all_parser.add_argument("episode", help="Episode number")
    extract_all_parser.add_argument("--clips", type=int, default=3, help="Clips per speaker")
    extract_all_parser.add_argument("--min-duration", type=float, default=5.0,
                                   help="Minimum clip duration")

    # Merge command
    merge_parser = subparsers.add_parser("merge", help="Merge clips into single file")
    merge_parser.add_argument("clip_dir", type=Path, help="Directory containing clips")
    merge_parser.add_argument("--output", type=Path, help="Output file path")

    # Add to library command
    add_parser = subparsers.add_parser("add-to-library", help="Add clip to voice library")
    add_parser.add_argument("name", help="Speaker's name")
    add_parser.add_argument("audio", type=Path, help="Path to audio clip")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if args.command == "list":
        list_speakers(args.episode)

    elif args.command == "extract":
        extract_speaker_clips(args.episode, args.speaker, args.name,
                            args.clips, args.min_duration)

    elif args.command == "extract-all":
        extract_all_speakers(args.episode, args.clips, args.min_duration)

    elif args.command == "merge":
        merge_clips(args.clip_dir, args.output)

    elif args.command == "add-to-library":
        add_to_library(args.name, args.audio)


if __name__ == "__main__":
    main()
