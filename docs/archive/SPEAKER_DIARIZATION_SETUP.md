# Speaker Diarization Setup Guide

Speaker diarization identifies **who spoke when** in your podcast episodes, labeling different speakers (Matt, Mattingly, guests).

## Quick Start (5 minutes)

### Step 1: Get HuggingFace Token

1. **Create account** (if needed): https://huggingface.co/join
2. **Get API token**: https://huggingface.co/settings/tokens
   - Click "New token"
   - Name it "podcast-diarization"
   - Role: "read"
   - Copy the token (starts with `hf_...`)

### Step 2: Accept Model Terms

**IMPORTANT:** You must accept the terms for pyannote models:

1. Visit: https://huggingface.co/pyannote/speaker-diarization-3.1
2. Scroll down and click **"Agree and access repository"**
3. Also accept: https://huggingface.co/pyannote/segmentation-3.0

### Step 3: Test on Transcribed Episode

```bash
cd scripts

# Test diarization on Episode 1
python speaker_diarization.py \
  "episodes/1270 - Ad Free 1270 Saran Wrap and Crisco.mp3" \
  "transcripts/1270 - Ad Free 1270 Saran Wrap and Crisco.json" \
  --token "hf_YOUR_TOKEN_HERE" \
  --speakers 2
```

**Expected output:**
```
Loading speaker diarization pipeline...
✅ Diarization pipeline loaded
Running speaker diarization on: 1270 - Ad Free 1270 Saran Wrap and Crisco.mp3
✅ Diarization complete: 2 speakers, 347 segments
Aligning speakers with transcript...
✅ Speaker alignment complete

✅ Speaker diarization complete!
   Speakers found: 2
   Segments: 347
   Output: transcripts/1270 - Ad Free 1270 Saran Wrap and Crisco_with_speakers.json
```

## What Gets Created

### Original Transcript
```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 5.2,
      "text": "Welcome to the Ice Cream Social"
    }
  ]
}
```

### Enhanced Transcript (with speakers)
```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 5.2,
      "text": "Welcome to the Ice Cream Social",
      "speaker": "SPEAKER_00"
    }
  ],
  "diarization": {
    "speakers": ["SPEAKER_00", "SPEAKER_01"],
    "num_speakers": 2,
    "method": "pyannote.audio v3.1"
  }
}
```

## Integration with Worker

Once tested, add to `config.yaml`:

```yaml
speaker_diarization:
  enabled: true
  hf_token: "hf_YOUR_TOKEN_HERE"
  num_speakers: 2  # 2 for normal episodes, 3+ for guest episodes
```

The transcription worker will automatically:
1. Transcribe audio with faster-whisper
2. Run speaker diarization with pyannote
3. Merge results into single JSON with speaker labels

## Performance Notes

**Processing Time:**
- ~5-10 minutes for 1 hour of audio (on M4 MacBook Air)
- Runs on CPU (no GPU required)
- Can run in parallel with transcription

**Accuracy:**
- pyannote.audio v3.1 is state-of-the-art
- Typically 85-95% accuracy for 2-speaker podcasts
- Works best with clear audio and distinct voices

## Troubleshooting

### Error: "Failed to load diarization pipeline"
- Make sure you accepted terms at both URLs above
- Wait 5 minutes after accepting (HuggingFace needs to update permissions)
- Check your token is correct (starts with `hf_`)

### Error: "No module named 'pyannote'"
```bash
source venv/bin/activate
pip install pyannote.audio torch torchaudio
```

### "Too many speakers detected"
- Add `--speakers 2` to force 2 speakers (Matt & Mattingly)
- For guest episodes, use `--speakers 3` or omit for auto-detection

## Speaker Labels

**Initial labels:** `SPEAKER_00`, `SPEAKER_01`, etc.

**To identify who is who:**
- Compare voice characteristics in first few segments
- Matt is typically SPEAKER_00 (opens most episodes)
- Can manually label in database or add ML-based voice matching

## Next Steps

After testing:
1. ✅ Verify speaker alignment looks correct
2. Add HF token to config.yaml
3. Enable diarization in worker
4. Update database schema to store speaker data
5. Update frontend to display speakers

---

**Ready to test?** Run the command in Step 3 with your HuggingFace token!
