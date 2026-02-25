#!/usr/bin/env python3
"""
qwen_inference.py — Test harness for Qwen2.5-Omni-3B audio transcription.

Downloads Qwen/Qwen2.5-Omni-3B from HuggingFace on first run (~6 GB, cached).
Uses Apple Silicon MPS GPU for inference.

Usage:
    # Must use python3.9 (has torch + MPS support in this venv)
    venv/bin/python3.9 scripts/qwen_inference.py --file "scripts/episodes/MyEpisode.mp3" --duration 300

Output:
    scripts/transcripts/<basename>_qwen_test.json
    + speed report printed to stdout as JSON
"""

import os
import sys
import json
import time
import argparse
import re
from pathlib import Path

MODEL_ID = "Qwen/Qwen2.5-Omni-3B"

STRUCTURED_PROMPT = """Transcribe this podcast audio. Output ONLY a JSON object — no markdown, no explanation.

Format: {"segments":[{"start":<float>,"end":<float>,"speaker":"SPEAKER_00","text":"<exact words spoken>","is_performance_bit":<true/false>,"tone_description":"<normal conversation|comedic character voice|ad read|storytelling|excited|crosstalk>"}],"speaker_count":<int>}

Rules: transcribe the EXACT words (no placeholders). New segment on speaker change. Same speaker = same SPEAKER_XX id. is_performance_bit=true only for character voices or comedy bits."""


TARGET_SR = 16000  # Qwen2.5-Omni uses Whisper audio encoder (requires 16kHz)

def crop_audio(audio_path: str, duration_secs: int):
    """Load, crop, resample to 16kHz mono. Returns (numpy_array, 16000)."""
    try:
        import soundfile as sf
        import numpy as np
        import librosa
    except ImportError as e:
        print(f"ERROR: Missing dependency — {e}. Run: pip install soundfile librosa", file=sys.stderr)
        sys.exit(1)

    data, sr = sf.read(audio_path, dtype='float32', always_2d=False)
    # Convert stereo to mono
    if data.ndim == 2:
        data = data.mean(axis=1)
    # Crop first
    samples = int(duration_secs * sr)
    if samples < len(data):
        data = data[:samples]
    else:
        duration_secs = len(data) / sr
    # Resample to 16kHz (Whisper feature extractor requirement)
    if sr != TARGET_SR:
        data = librosa.resample(data, orig_sr=sr, target_sr=TARGET_SR)
        print(f"Resampled {sr}Hz → {TARGET_SR}Hz, cropped to {duration_secs}s ({len(data)} samples)", file=sys.stderr)
    else:
        print(f"Audio: {duration_secs}s @ {TARGET_SR}Hz ({len(data)} samples)", file=sys.stderr)
    return data, TARGET_SR


def extract_json(text: str) -> dict:
    """Extract JSON from model response. Uses json-repair for truncated output."""
    from json_repair import repair_json

    # Strip markdown fences
    text = re.sub(r'```(?:json)?\s*', '', text).strip().replace('```', '').strip()

    start = text.find('{')
    if start == -1:
        raise ValueError(f"No JSON object in response:\n{text[:300]}")
    text = text[start:]

    # Try clean parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Repair and parse truncated JSON
    print("WARNING: JSON truncated, using json-repair to recover partial output", file=sys.stderr)
    repaired = repair_json(text, return_objects=True)
    if not isinstance(repaired, dict) or "segments" not in repaired:
        raise ValueError(f"json-repair could not recover structured output:\n{text[:300]}")
    repaired["_truncated"] = True
    return repaired


def run_inference(audio_path: str, duration: int) -> dict:
    """Run Qwen2.5-Omni-3B on the audio and return structured dict."""
    try:
        import torch
        from transformers import Qwen2_5OmniForConditionalGeneration, Qwen2_5OmniProcessor
    except ImportError as e:
        print(f"ERROR: Missing dependency — {e}", file=sys.stderr)
        print("Run: pip install 'transformers>=4.51.0' qwen-omni-utils", file=sys.stderr)
        sys.exit(1)

    # Device setup
    if torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float16
        print("Using Apple Silicon MPS GPU", file=sys.stderr)
    elif torch.cuda.is_available():
        device = "cuda"
        dtype = torch.bfloat16
        print("Using CUDA GPU", file=sys.stderr)
    else:
        device = "cpu"
        dtype = torch.float32
        print("WARNING: No GPU found, running on CPU (very slow)", file=sys.stderr)

    # Load model (downloads ~6 GB on first run, then cached)
    print(f"Loading {MODEL_ID}...", file=sys.stderr)
    print("(First run will download ~6 GB — subsequent runs use cache)", file=sys.stderr)

    processor = Qwen2_5OmniProcessor.from_pretrained(MODEL_ID)
    model = Qwen2_5OmniForConditionalGeneration.from_pretrained(
        MODEL_ID,
        dtype=dtype,
        device_map=device,
    )
    model.eval()
    print("Model loaded.", file=sys.stderr)

    # Load and crop audio
    audio_data, sr = crop_audio(audio_path, duration)

    # Build message for processor
    # System prompt is required as a separate role (not inside user content)
    messages = [
        {
            "role": "system",
            "content": [{"type": "text", "text": "You are a podcast transcription assistant. You output only valid JSON. No markdown, no explanation."}],
        },
        {
            "role": "user",
            "content": [
                {"type": "audio", "audio": audio_data},
                {"type": "text", "text": STRUCTURED_PROMPT},
            ]
        }
    ]

    # Apply chat template
    text = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=False,
    )

    # Extract audio arrays from messages (replaces qwen_omni_utils.process_mm_info,
    # which requires Python 3.10+ union syntax)
    audios = []
    for msg in messages:
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue  # skip system message (string content)
        for item in content:
            if isinstance(item, dict) and item.get("type") == "audio":
                audio_val = item["audio"]
                if isinstance(audio_val, str):
                    import soundfile as sf
                    audio_val, _ = sf.read(audio_val, dtype='float32', always_2d=False)
                audios.append(audio_val)

    inputs = processor(
        text=text,
        audio=audios if audios else None,
        return_tensors="pt",
        padding=True,
        sampling_rate=sr,
    ).to(device)

    print(f"Input tokens: {inputs['input_ids'].shape[-1]}", file=sys.stderr)
    print("Running inference...", file=sys.stderr)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=8192,
            do_sample=False,        # Greedy — more deterministic for structured output
            temperature=None,
            top_p=None,
            return_audio=False,     # Text-only output; skip the TTS talker module
        )

    # generate() returns (text_ids,) or just text_ids when return_audio=False
    output_ids = outputs[0] if isinstance(outputs, tuple) else outputs
    # Decode only newly generated tokens (not the input)
    input_len = inputs['input_ids'].shape[-1]
    generated = output_ids[:, input_len:] if output_ids.ndim == 2 else output_ids[input_len:]
    response = processor.batch_decode(
        generated.unsqueeze(0) if generated.ndim == 1 else generated,
        skip_special_tokens=True
    )[0]

    print(f"Raw response length: {len(response)} chars", file=sys.stderr)
    print(f"--- RAW RESPONSE (first 500 chars) ---", file=sys.stderr)
    print(response[:500], file=sys.stderr)
    print(f"--- END RAW ---", file=sys.stderr)

    return extract_json(response)


def main():
    parser = argparse.ArgumentParser(
        description="Test Qwen2.5-Omni-3B on a podcast audio file"
    )
    parser.add_argument("--file", required=True, help="Path to audio file (.mp3, .wav, .m4a)")
    parser.add_argument("--duration", type=int, default=300, help="Seconds of audio to test (default: 300 = 5 min)")
    parser.add_argument("--output", default=None, help="Output JSON path (default: auto-named next to input)")
    args = parser.parse_args()

    audio_path = Path(args.file)
    if not audio_path.exists():
        print(f"ERROR: File not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    # Auto-name output
    if args.output:
        out_path = Path(args.output)
    else:
        stem = audio_path.stem
        transcript_dir = Path(__file__).parent / "transcripts"
        transcript_dir.mkdir(exist_ok=True)
        out_path = transcript_dir / f"{stem}_qwen_test.json"

    print(f"Audio: {audio_path}", file=sys.stderr)
    print(f"Duration: {args.duration}s", file=sys.stderr)
    print(f"Output: {out_path}", file=sys.stderr)
    print("-" * 50, file=sys.stderr)

    t0 = time.time()

    try:
        result = run_inference(str(audio_path), args.duration)
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        error = {"status": "error", "message": str(e)}
        print(json.dumps(error))
        sys.exit(1)

    elapsed = time.time() - t0
    segments = result.get("segments", [])

    # Write output JSON
    with open(out_path, 'w') as f:
        json.dump(result, f, indent=2)

    # Report
    performance_bits = sum(1 for s in segments if s.get("is_performance_bit"))
    report = {
        "status": "success",
        "output_file": str(out_path),
        "segment_count": len(segments),
        "speaker_count": result.get("speaker_count", "?"),
        "performance_bits_detected": performance_bits,
        "audio_duration_secs": args.duration,
        "inference_elapsed_secs": round(elapsed, 1),
        "realtime_factor": round(elapsed / args.duration, 2),
        "note": f"{elapsed / args.duration:.1f}x realtime ({'fast' if elapsed < args.duration else 'slow'})"
    }

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
