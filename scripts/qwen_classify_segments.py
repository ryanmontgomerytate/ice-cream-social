#!/usr/bin/env python3
"""
qwen_classify_segments.py — Targeted segment classification using Qwen2.5-Omni-3B.

Runs AFTER Pyannote diarization. Given a list of segment timestamps (already
identified by Pyannote), uses Qwen to classify intent and identity:
  1. Is this a performance bit / character voice?
  2. Which character (from a known list)?
  3. Tone and speaker note.

Model is slow (~13x realtime including load), so this runs targeted on flagged
or suspected segments — NOT full episodes.

Usage:
    venv/bin/python3 scripts/qwen_classify_segments.py \
      --audio-file scripts/episodes/episode.mp3 \
      --segments '[{"segment_idx":42,"start":304.2,"end":318.7}]' \
      --characters '[{"name":"Sweet Bean","catchphrase":"Sweet Bean!"}]'

Output (stdout, after QWEN_PROGRESS lines):
    {"status":"success","results":[...],"elapsed_secs":124.3}
"""

import os
import sys
import json
import time
import argparse
import re
from pathlib import Path
from typing import List, Optional

MODEL_ID = "Qwen/Qwen2.5-Omni-3B"
TARGET_SR = 16000  # Qwen2.5-Omni uses Whisper audio encoder (requires 16kHz)

# Max clip length sent to Qwen (seconds). Longer clips add context on either
# side of the target segment, up to this cap.
CLIP_PAD_SECS = 5.0   # seconds of audio before/after segment boundary
MAX_CLIP_SECS = 60.0  # hard cap


def emit_progress(n: int, total: int) -> None:
    """Print QWEN_PROGRESS line for the Tauri subprocess monitor."""
    pct = int((n / max(total, 1)) * 100)
    print(f"QWEN_PROGRESS: {pct}", flush=True)


def load_audio(audio_path: str):
    """Load full audio, resample to 16kHz mono. Returns (numpy_array, 16000)."""
    try:
        import soundfile as sf
        import numpy as np
        import librosa
    except ImportError as e:
        print(f"ERROR: Missing dependency — {e}. Run: pip install soundfile librosa", file=sys.stderr)
        sys.exit(1)

    data, sr = sf.read(audio_path, dtype='float32', always_2d=False)
    if data.ndim == 2:
        data = data.mean(axis=1)
    if sr != TARGET_SR:
        data = librosa.resample(data, orig_sr=sr, target_sr=TARGET_SR)
        print(f"Resampled {sr}Hz → {TARGET_SR}Hz", file=sys.stderr)
    return data, TARGET_SR


def extract_clip(audio_data, sr: int, start: float, end: float) -> tuple:
    """
    Extract a padded audio clip around [start, end].
    Returns (clip_array, actual_start_sec) — actual_start_sec allows the
    caller to know where the clip starts in case it was clamped.
    """
    import numpy as np
    duration = len(audio_data) / sr

    clip_start = max(0.0, start - CLIP_PAD_SECS)
    clip_end = min(duration, end + CLIP_PAD_SECS)

    # Hard cap: if clip is still > MAX_CLIP_SECS, center the segment
    if (clip_end - clip_start) > MAX_CLIP_SECS:
        seg_mid = (start + end) / 2
        clip_start = max(0.0, seg_mid - MAX_CLIP_SECS / 2)
        clip_end = min(duration, clip_start + MAX_CLIP_SECS)

    s_idx = int(clip_start * sr)
    e_idx = int(clip_end * sr)
    clip = audio_data[s_idx:e_idx]
    return clip, clip_start


def build_character_context(characters: List[dict]) -> str:
    """Build the character list string for the prompt."""
    if not characters:
        return "No known recurring characters provided."
    parts = []
    for c in characters:
        name = c.get("name", "Unknown")
        phrase = c.get("catchphrase")
        if phrase:
            parts.append(f'"{name}" (catchphrase: "{phrase}")')
        else:
            parts.append(f'"{name}"')
    return ", ".join(parts)


def build_prompt(characters: List[dict]) -> str:
    char_list = build_character_context(characters)
    return (
        f"Listen to this short audio clip from a comedy podcast.\n"
        f"Known recurring characters: {char_list}.\n"
        f"Answer ONLY in JSON — no explanation:\n"
        f'{{ "is_performance_bit": bool, "character_name": string|null, '
        f'"speaker_note": string, "tone_description": string, "confidence": float 0-1 }}\n'
        f"is_performance_bit=true if the speaker is doing a character voice, bit, or comedic impression.\n"
        f"character_name: the character being voiced if it matches the known list, otherwise null."
    )


def extract_json_result(text: str) -> dict:
    """Extract JSON from model output. Attempts repair if malformed."""
    # Try json-repair if available, otherwise basic extraction
    text = re.sub(r'```(?:json)?\s*', '', text).strip().replace('```', '').strip()
    start = text.find('{')
    if start == -1:
        raise ValueError(f"No JSON in response: {text[:200]}")
    text = text[start:]

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try json-repair
    try:
        from json_repair import repair_json
        repaired = repair_json(text, return_objects=True)
        if isinstance(repaired, dict):
            return repaired
    except ImportError:
        pass

    raise ValueError(f"Could not parse JSON from model response: {text[:200]}")


def load_model():
    """Load Qwen2.5-Omni-3B model and processor. Returns (model, processor, device)."""
    try:
        import torch
        from transformers import Qwen2_5OmniForConditionalGeneration, Qwen2_5OmniProcessor
    except ImportError as e:
        print(f"ERROR: Missing dependency — {e}", file=sys.stderr)
        sys.exit(1)

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

    print(f"Loading {MODEL_ID}...", file=sys.stderr)
    processor = Qwen2_5OmniProcessor.from_pretrained(MODEL_ID)
    model = Qwen2_5OmniForConditionalGeneration.from_pretrained(
        MODEL_ID,
        dtype=dtype,
        device_map=device,
    )
    model.eval()
    print("Model loaded.", file=sys.stderr)
    return model, processor, device


def classify_clip(model, processor, device, clip_audio, sr: int, prompt_text: str) -> dict:
    """Run Qwen inference on a single clip. Returns parsed result dict."""
    import torch

    messages = [
        {
            "role": "system",
            "content": [{"type": "text", "text": "You are a podcast audio classifier. You output only valid JSON. No markdown, no explanation."}],
        },
        {
            "role": "user",
            "content": [
                {"type": "audio", "audio": clip_audio},
                {"type": "text", "text": prompt_text},
            ],
        },
    ]

    text = processor.apply_chat_template(
        messages,
        add_generation_prompt=True,
        tokenize=False,
    )

    # Collect audio arrays from messages
    audios = []
    for msg in messages:
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
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

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=256,
            do_sample=False,
            temperature=None,
            top_p=None,
            return_audio=False,
        )

    output_ids = outputs[0] if isinstance(outputs, tuple) else outputs
    input_len = inputs['input_ids'].shape[-1]
    generated = output_ids[:, input_len:] if output_ids.ndim == 2 else output_ids[input_len:]
    response = processor.batch_decode(
        generated.unsqueeze(0) if generated.ndim == 1 else generated,
        skip_special_tokens=True,
    )[0]

    print(f"Raw response: {response[:200]}", file=sys.stderr)
    return extract_json_result(response)


def main():
    parser = argparse.ArgumentParser(
        description="Classify transcript segments for performance bits using Qwen2.5-Omni-3B"
    )
    parser.add_argument("--audio-file", required=True, help="Path to episode audio file")
    parser.add_argument(
        "--segments",
        required=True,
        help='JSON array of segments: [{"segment_idx":42,"start":304.2,"end":318.7},...]',
    )
    parser.add_argument(
        "--characters",
        default="[]",
        help='JSON array of known characters: [{"name":"Sweet Bean","catchphrase":"Sweet Bean!"},...]',
    )
    args = parser.parse_args()

    audio_path = Path(args.audio_file)
    if not audio_path.exists():
        error = {"status": "error", "message": f"Audio file not found: {audio_path}"}
        print(json.dumps(error))
        sys.exit(1)

    try:
        segments = json.loads(args.segments)
    except json.JSONDecodeError as e:
        error = {"status": "error", "message": f"Invalid --segments JSON: {e}"}
        print(json.dumps(error))
        sys.exit(1)

    try:
        characters = json.loads(args.characters)
    except json.JSONDecodeError as e:
        error = {"status": "error", "message": f"Invalid --characters JSON: {e}"}
        print(json.dumps(error))
        sys.exit(1)

    if not segments:
        result = {"status": "success", "results": [], "elapsed_secs": 0.0}
        print(json.dumps(result))
        return

    total = len(segments)
    print(f"Classifying {total} segment(s) from: {audio_path.name}", file=sys.stderr)
    emit_progress(0, total)

    t0 = time.time()

    # Load full audio once
    print("Loading audio file...", file=sys.stderr)
    try:
        audio_data, sr = load_audio(str(audio_path))
    except Exception as e:
        error = {"status": "error", "message": f"Failed to load audio: {e}"}
        print(json.dumps(error))
        sys.exit(1)

    # Load model once (amortize ~60s load time)
    try:
        model, processor, device = load_model()
    except Exception as e:
        error = {"status": "error", "message": f"Failed to load model: {e}"}
        print(json.dumps(error))
        sys.exit(1)

    prompt_text = build_prompt(characters)
    results = []

    for i, seg in enumerate(segments):
        segment_idx = seg.get("segment_idx", i)
        start = float(seg.get("start", 0))
        end = float(seg.get("end", start + 10))

        print(f"Processing segment {segment_idx} ({start:.1f}s–{end:.1f}s)...", file=sys.stderr)

        try:
            clip, _clip_start = extract_clip(audio_data, sr, start, end)

            if len(clip) == 0:
                raise ValueError("Extracted clip is empty — check start/end times")

            raw = classify_clip(model, processor, device, clip, sr, prompt_text)

            # Normalize / validate fields
            is_bit = bool(raw.get("is_performance_bit", False))
            char_name = raw.get("character_name") or None
            if isinstance(char_name, str):
                char_name = char_name.strip() or None
                # Only keep if it matches one of the known characters (case-insensitive)
                if char_name and characters:
                    known_names = [c.get("name", "").lower() for c in characters]
                    if char_name.lower() not in known_names:
                        # Try partial match
                        matched = next(
                            (c["name"] for c in characters if char_name.lower() in c.get("name", "").lower() or c.get("name", "").lower() in char_name.lower()),
                            None
                        )
                        char_name = matched

            results.append({
                "segment_idx": segment_idx,
                "is_performance_bit": is_bit,
                "character_name": char_name,
                "speaker_note": str(raw.get("speaker_note", ""))[:500],
                "tone_description": str(raw.get("tone_description", ""))[:200],
                "confidence": float(raw.get("confidence", 0.5)),
            })

        except Exception as e:
            import traceback
            traceback.print_exc(file=sys.stderr)
            print(f"ERROR classifying segment {segment_idx}: {e}", file=sys.stderr)
            results.append({
                "segment_idx": segment_idx,
                "is_performance_bit": False,
                "character_name": None,
                "speaker_note": f"Classification failed: {e}",
                "tone_description": "",
                "confidence": 0.0,
            })

        emit_progress(i + 1, total)

    elapsed = time.time() - t0
    output = {
        "status": "success",
        "results": results,
        "elapsed_secs": round(elapsed, 1),
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
