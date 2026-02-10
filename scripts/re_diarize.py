#!/usr/bin/env python3
"""
Re-run diarization on existing transcripts to fix speaker labels.

Usage:
    python re_diarize.py 1264  # Re-diarize specific episode by number
    python re_diarize.py --all # Re-diarize all transcripts missing speaker labels
"""

import os
import sys
import json
import argparse
from pathlib import Path

# Add scripts directory to path
sys.path.insert(0, str(Path(__file__).parent))

from speaker_diarization import SpeakerDiarizer, DIARIZATION_AVAILABLE

def get_hf_token():
    """Get HuggingFace token from .env file"""
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                # Check both HF_TOKEN and HUGGINGFACE_TOKEN
                if line.startswith("HF_TOKEN=") or line.startswith("HUGGINGFACE_TOKEN="):
                    return line.strip().split("=", 1)[1].strip('"\'')
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")

def find_transcript(episode_number: str) -> tuple:
    """Find transcript and audio files for an episode number"""
    transcripts_dir = Path(__file__).parent / "transcripts"
    episodes_dir = Path(__file__).parent / "episodes"

    # Look for transcript file containing the episode number
    for transcript_file in transcripts_dir.glob("*.json"):
        if f"{episode_number}" in transcript_file.name and "_with_speakers" not in transcript_file.name:
            # Found the base transcript, now find the audio
            audio_pattern = transcript_file.stem.replace(".json", "")
            for audio_file in episodes_dir.glob("*.mp3"):
                if audio_pattern in audio_file.name or f"{episode_number}" in audio_file.name:
                    return transcript_file, audio_file
            # Try matching by just episode number
            for audio_file in episodes_dir.glob("*.mp3"):
                if f" {episode_number}" in audio_file.name or f"_{episode_number}" in audio_file.name:
                    return transcript_file, audio_file
    return None, None

def needs_speaker_labels(transcript_path: Path) -> bool:
    """Check if transcript segments are missing speaker labels"""
    with_speakers_path = transcript_path.with_name(f"{transcript_path.stem}_with_speakers.json")

    if not with_speakers_path.exists():
        return True

    try:
        with open(with_speakers_path) as f:
            data = json.load(f)

        # Check if diarization was done
        if "diarization" not in data:
            return True

        # Check if segments have speaker labels
        segments = data.get("transcription", data.get("segments", []))
        if not segments:
            return True

        # Check first segment for speaker field
        if "speaker" not in segments[0]:
            return True

        return False
    except Exception as e:
        print(f"Error checking {with_speakers_path}: {e}")
        return True

def re_diarize_episode(transcript_path: Path, audio_path: Path, hf_token: str, num_speakers: int = None):
    """Re-run diarization on an episode

    Args:
        num_speakers: Expected speakers. None = auto-detect (recommended for episodes with guests)
    """
    print(f"\n{'='*60}")
    print(f"Re-diarizing: {transcript_path.name}")
    print(f"Audio: {audio_path.name}")
    if num_speakers:
        print(f"Expected speakers: {num_speakers}")
    else:
        print(f"Speaker detection: AUTO (recommended)")
    print(f"{'='*60}")

    # Load transcript
    with open(transcript_path) as f:
        transcript = json.load(f)

    # Initialize diarizer
    diarizer = SpeakerDiarizer(hf_token)

    # Run diarization (None = auto-detect)
    print("Running speaker diarization...")
    diarization = diarizer.diarize(audio_path, num_speakers=num_speakers)

    if diarization.get("error"):
        print(f"Diarization error: {diarization['error']}")
        return False

    print(f"Detected {diarization['num_speakers']} speakers, {diarization['total_segments']} segments")

    # Align with transcript
    print("Aligning speakers with transcript...")
    enhanced_transcript = diarizer.align_with_transcript(diarization, transcript)

    # Check if alignment worked
    segments = enhanced_transcript.get("transcription", enhanced_transcript.get("segments", []))
    speakers_found = set(seg.get("speaker", "UNKNOWN") for seg in segments[:10])
    print(f"Speaker labels in first 10 segments: {speakers_found}")

    # Save enhanced transcript
    output_path = transcript_path.with_name(f"{transcript_path.stem}_with_speakers.json")
    with open(output_path, 'w') as f:
        json.dump(enhanced_transcript, f, indent=2)

    print(f"Saved: {output_path}")
    return True

def main():
    parser = argparse.ArgumentParser(description="Re-run diarization on existing transcripts")
    parser.add_argument("episode", nargs="?", help="Episode number to re-diarize")
    parser.add_argument("--all", action="store_true", help="Re-diarize all transcripts missing speaker labels")
    # Always use auto-detect (None) - better for episodes with varying guest counts
    args = parser.parse_args()

    if not DIARIZATION_AVAILABLE:
        print("Error: pyannote.audio not available. Run: pip install pyannote.audio")
        sys.exit(1)

    hf_token = get_hf_token()
    if not hf_token:
        print("Error: HF_TOKEN not found in .env or environment")
        sys.exit(1)

    if args.episode:
        # Re-diarize specific episode
        transcript_path, audio_path = find_transcript(args.episode)
        if not transcript_path:
            print(f"Error: Transcript not found for episode {args.episode}")
            sys.exit(1)
        if not audio_path:
            print(f"Error: Audio file not found for episode {args.episode}")
            sys.exit(1)

        re_diarize_episode(transcript_path, audio_path, hf_token)  # Auto-detect speakers

    elif args.all:
        # Find all transcripts needing speaker labels
        transcripts_dir = Path(__file__).parent / "transcripts"
        episodes_dir = Path(__file__).parent / "episodes"

        to_process = []
        for transcript_file in transcripts_dir.glob("*.json"):
            if "_with_speakers" in transcript_file.name:
                continue
            if needs_speaker_labels(transcript_file):
                # Try to find matching audio
                audio_pattern = transcript_file.stem
                for audio_file in episodes_dir.glob("*.mp3"):
                    if audio_pattern in audio_file.name:
                        to_process.append((transcript_file, audio_file))
                        break

        if not to_process:
            print("No transcripts need re-diarization")
            return

        print(f"Found {len(to_process)} transcripts to re-diarize:")
        for t, a in to_process:
            print(f"  - {t.name}")

        confirm = input("\nProceed? [y/N] ")
        if confirm.lower() != 'y':
            return

        for transcript_path, audio_path in to_process:
            re_diarize_episode(transcript_path, audio_path, hf_token)  # Auto-detect speakers

    else:
        parser.print_help()

if __name__ == "__main__":
    main()
