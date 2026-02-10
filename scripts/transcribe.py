#!/usr/bin/env python3
"""
Ice Cream Social Podcast Transcription Pipeline
Transcribes podcast episodes using Faster-Whisper

Usage:
    python transcribe.py <audio_file_or_url>
    python transcribe.py episode.mp3
    python transcribe.py --batch episodes/

Requirements:
    pip install faster-whisper feedparser requests tqdm
"""

import argparse
import json
import os
import sys
import time
from datetime import timedelta
from pathlib import Path

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("Please install faster-whisper: pip install faster-whisper")
    sys.exit(1)

try:
    from tqdm import tqdm
except ImportError:
    # Fallback if tqdm not installed
    tqdm = lambda x, **kwargs: x

# Load configuration
try:
    from config import config
    if config:
        MODEL_SIZE = config.transcription.model
        DEVICE = config.transcription.device
        COMPUTE_TYPE = config.transcription.compute_type
        OUTPUT_DIR = config.paths.transcripts
    else:
        raise ImportError("Config not loaded")
except ImportError:
    print("Warning: Could not load config module. Using defaults.")
    MODEL_SIZE = "large-v3"
    DEVICE = "auto"
    COMPUTE_TYPE = "auto"
    OUTPUT_DIR = Path("transcripts")


def format_timestamp(seconds: float) -> str:
    """Convert seconds to HH:MM:SS format"""
    return str(timedelta(seconds=int(seconds)))


def transcribe_audio(
    audio_path: str,
    model: WhisperModel,
    output_format: str = "all"
) -> dict:
    """
    Transcribe an audio file and return results.
    
    Args:
        audio_path: Path to audio file
        model: Loaded WhisperModel
        output_format: 'text', 'json', 'srt', or 'all'
    
    Returns:
        dict with transcript data
    """
    print(f"\nTranscribing: {audio_path}")
    start_time = time.time()
    
    # Transcribe with word-level timestamps
    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,  # Filter out silence
    )
    
    # Convert generator to list and build output
    transcript_data = {
        "audio_file": str(audio_path),
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "segments": []
    }
    
    full_text_parts = []
    srt_parts = []
    
    print("Processing segments...")
    for i, segment in enumerate(segments):
        seg_dict = {
            "id": i,
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip(),
        }
        
        # Add word-level timestamps if available
        if segment.words:
            seg_dict["words"] = [
                {"word": w.word, "start": w.start, "end": w.end, "probability": w.probability}
                for w in segment.words
            ]
        
        transcript_data["segments"].append(seg_dict)
        full_text_parts.append(segment.text.strip())
        
        # Build SRT format
        srt_parts.append(
            f"{i + 1}\n"
            f"{format_timestamp(segment.start)} --> {format_timestamp(segment.end)}\n"
            f"{segment.text.strip()}\n"
        )
    
    transcript_data["full_text"] = " ".join(full_text_parts)
    transcript_data["srt"] = "\n".join(srt_parts)
    transcript_data["processing_time"] = time.time() - start_time
    
    print(f"Completed in {transcript_data['processing_time']:.1f} seconds")
    print(f"Detected language: {info.language} ({info.language_probability:.1%} confidence)")
    
    return transcript_data


def save_transcript(transcript_data: dict, output_dir: Path, base_name: str):
    """Save transcript in multiple formats"""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Save JSON (full data)
    json_path = output_dir / f"{base_name}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(transcript_data, f, indent=2, ensure_ascii=False)
    print(f"Saved JSON: {json_path}")
    
    # Save plain text
    txt_path = output_dir / f"{base_name}.txt"
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(transcript_data["full_text"])
    print(f"Saved text: {txt_path}")
    
    # Save SRT (subtitles)
    srt_path = output_dir / f"{base_name}.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(transcript_data["srt"])
    print(f"Saved SRT: {srt_path}")
    
    # Save markdown (good for AnythingLLM)
    md_path = output_dir / f"{base_name}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# {base_name}\n\n")
        f.write(f"**Duration**: {format_timestamp(transcript_data['duration'])}\n")
        f.write(f"**Language**: {transcript_data['language']}\n\n")
        f.write("---\n\n")
        f.write("## Transcript\n\n")
        for seg in transcript_data["segments"]:
            f.write(f"**[{format_timestamp(seg['start'])}]** {seg['text']}\n\n")
    print(f"Saved Markdown: {md_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe Ice Cream Social podcast episodes"
    )
    parser.add_argument(
        "input",
        help="Audio file path or directory for batch processing"
    )
    parser.add_argument(
        "--model",
        default=MODEL_SIZE,
        choices=["tiny", "base", "small", "medium", "large-v2", "large-v3"],
        help=f"Whisper model size (default: {MODEL_SIZE})"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR,
        help=f"Output directory (default: {OUTPUT_DIR})"
    )
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Process all audio files in directory"
    )
    
    args = parser.parse_args()
    
    # Load model
    print(f"Loading Whisper model: {args.model}")
    print("(This may take a moment on first run as the model downloads...)")
    model = WhisperModel(args.model, device=DEVICE, compute_type=COMPUTE_TYPE)
    print("Model loaded!\n")
    
    # Determine input files
    input_path = Path(args.input)
    
    if args.batch or input_path.is_dir():
        # Batch mode
        audio_extensions = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"}
        audio_files = [
            f for f in input_path.iterdir()
            if f.suffix.lower() in audio_extensions
        ]
        print(f"Found {len(audio_files)} audio files to process")
        
        for audio_file in tqdm(audio_files, desc="Transcribing"):
            try:
                transcript = transcribe_audio(str(audio_file), model)
                save_transcript(transcript, args.output_dir, audio_file.stem)
            except Exception as e:
                print(f"Error processing {audio_file}: {e}")
    else:
        # Single file mode
        if not input_path.exists():
            print(f"Error: File not found: {input_path}")
            sys.exit(1)
        
        transcript = transcribe_audio(str(input_path), model)
        save_transcript(transcript, args.output_dir, input_path.stem)
    
    print("\nDone!")


if __name__ == "__main__":
    main()
