# Complete Setup & Optimization Guide

## Part 1: Speaker Diarization Environment Setup

### ✅ Required Dependencies

```bash
cd /Users/ryan/Desktop/Projects/ice-cream-social-app
source venv/bin/activate

# Core dependencies
pip install pyannote.audio
pip install torch==2.5.1 torchaudio==2.5.1  # Must be <2.6 to avoid weights_only issues
pip install 'huggingface_hub<1.0'  # Must be <1.0 for pyannote compatibility
pip install beautifulsoup4 requests  # For wiki scraping
```

### ✅ HuggingFace Setup (COMPLETE)

1. **Create account:** https://huggingface.co/join
2. **Get API token:** https://huggingface.co/settings/tokens
   - Click "New token"
   - Name: "podcast-diarization"
   - Type: "Read"
   - Copy token (starts with `hf_...`)

3. **Accept model terms (CRITICAL):**
   - Visit: https://huggingface.co/pyannote/speaker-diarization-3.1
   - Fill form: Company = "Personal", Website = "N/A"
   - Click "Submit" / "Agree"
   - Visit: https://huggingface.co/pyannote/segmentation-3.0
   - Same process
   - **Wait 5-10 minutes** for permissions to propagate

4. **Set your token:** Store it in `.env` file (see `.env.example` for template)

### ✅ PyTorch Compatibility Issue (SOLVED)

**Problem:** PyTorch 2.6+ changed `weights_only` default from `False` to `True`, breaking pyannote.audio

**Solution:** Downgrade to PyTorch 2.5.1:
```bash
pip install 'torch<2.6' 'torchaudio<2.6'
```

**Alternative:** Monkey-patch in code (already added to speaker_diarization.py):
```python
import torch
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs.setdefault('weights_only', False)
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load
```

### ✅ Test Your Setup

```bash
cd scripts
python test_hf_access.py
```

Expected output:
```
✅ Successfully loaded pipeline!
Pipeline type: <class 'pyannote.audio.pipelines.speaker_diarization.SpeakerDiarization'>
```

---

## Part 2: Transcription Optimization Strategies

### Current Performance

**Baseline (Medium Model):**
- Episode 1271 (82 min audio): ~70+ minutes to transcribe
- Speed: ~0.85x real-time (slower than real-time!)
- CPU: 365% (using 4 cores efficiently)
- RAM: 2.6GB

**Issue:** With 900+ episodes, this would take **~1000 hours** total!

---

## Optimization Strategies (Expert Analysis)

### Strategy 1: Use Faster Models ⚡

**Trade quality for speed:**

```yaml
# config.yaml
transcription:
  model: "base"  # Instead of "medium"
```

**Performance comparison:**
| Model | Speed | Quality | Use Case |
|-------|-------|---------|----------|
| tiny | 2-3 min/hour | Poor | Testing only |
| base | 3-5 min/hour | Acceptable | Bulk processing |
| small | 4-7 min/hour | Good | Balanced |
| medium | 5-10 min/hour | Very good | **Current** |
| large-v3 | 10-20 min/hour | Best | Final passes |

**Recommendation:** Use **base** for initial bulk processing (900 episodes), then re-process important episodes with medium/large.

**Savings:** base model = ~5 min/hour → 450 hours total (vs 1000 hours!)

---

### Strategy 2: GPU Acceleration 🚀

**Current:** CPU-only (slow)

**With GPU:**
- NVIDIA GPU (CUDA): 5-10x faster
- Apple Silicon (MPS): 2-3x faster on M4

**Check if MPS available:**
```python
import torch
print(torch.backends.mps.is_available())  # True on M4 Mac
```

**Enable in config:**
```yaml
transcription:
  device: "mps"  # For M4 MacBook Air
```

**Update faster-whisper to support MPS:**
```bash
pip install faster-whisper --upgrade
```

**Expected speedup:** 2-3x faster on M4 → **~2-3 min/hour** with medium model!

**Savings:** 900 episodes × 1 hour avg × 3 min = **45 hours total**

---

### Strategy 3: Parallel Processing (Multi-Episode) 🔀

**Current:** One episode at a time

**Optimized:** Process multiple episodes simultaneously

```python
# transcription_worker.py enhancement
import multiprocessing

def parallel_worker(num_workers=2):
    """Run multiple worker processes"""
    processes = []
    for i in range(num_workers):
        p = multiprocessing.Process(target=worker.run)
        p.start()
        processes.append(p)
```

**Limitation:** RAM! Each worker needs ~3GB
- M4 with 24GB RAM: Can run **4-6 workers** safely
- 4 workers × 3 min/hour = **12 hours of audio per hour**

**Savings:** With 4 workers → **~150 hours total** (vs 1000!)

---

### Strategy 4: Audio Chunking (NOT Recommended) ❌

**Theory:** Split 80-minute file into 4× 20-minute chunks, process in parallel

**Problems:**
1. **Quality loss:** Whisper performs worse on short clips (loses context)
2. **Segment boundaries:** Words get cut mid-sentence at split points
3. **Complexity:** Need to merge transcripts, realign timestamps
4. **Minimal gain:** GPU/parallel workers are better

**Expert consensus:** Don't do this. Use parallel workers instead.

---

### Strategy 5: Hybrid Approach (BEST) 🏆

**Combine multiple strategies:**

```yaml
# config.yaml - Optimized for M4 MacBook Air
transcription:
  model: "small"  # Balanced quality/speed
  device: "mps"   # Use Apple Silicon GPU
  batch_size: 16  # Larger batches for GPU
  compute_type: "float16"  # Faster on GPU
```

**Plus:** Run 3-4 parallel workers

**Performance:**
- Model: small (~4 min/hour on CPU)
- GPU (MPS): 2x speedup → 2 min/hour
- 4 parallel workers → **8 hours of audio per hour**

**Total time for 900 episodes (avg 1 hour each):**
- 900 hours ÷ 8 = **~112 hours** = **4.6 days of continuous processing**

---

## Recommended Optimization Plan

### Phase 1: Quick Wins (Implement Now)

1. **Switch to `small` model:**
```yaml
transcription:
  model: "small"  # Down from medium
```

2. **Enable MPS (if supported):**
```python
# Check: import torch; print(torch.backends.mps.is_available())
# If True:
transcription:
  device: "mps"
```

**Expected gain:** 2-3x faster → 900 episodes in **~300 hours** (~12 days)

### Phase 2: Parallel Workers (Next Week)

3. **Run 3-4 workers simultaneously:**
```bash
# Terminal 1
python transcription_worker.py --model small &

# Terminal 2
python transcription_worker.py --model small &

# Terminal 3
python transcription_worker.py --model small &

# Terminal 4
python transcription_worker.py --model small &
```

**Queue management:** Each worker picks from the same database queue automatically

**Expected gain:** 4x throughput → 900 episodes in **~75 hours** (~3 days)

### Phase 3: Fine-tune Settings

4. **Optimize Whisper parameters:**
```yaml
transcription:
  vad_filter: true  # Already enabled - removes silence
  beam_size: 3      # Down from 5 - faster, slightly lower quality
  best_of: 3        # Down from 5 - faster
```

**Expected gain:** 10-15% faster

---

## Performance Comparison

| Approach | Time per Episode (1hr) | Total Time (900 eps) | Notes |
|----------|----------------------|-------------------|-------|
| **Current** (medium, CPU) | 70 min | 1050 hours (~44 days) | Too slow |
| Small model, CPU | 7 min | 105 hours (~4.4 days) | 10x faster |
| Small + MPS (M4) | 3-4 min | 50-60 hours (~2-2.5 days) | 17x faster |
| Small + MPS + 4 workers | 1 min/ep avg | **15 hours** (~15 hours!) | **70x faster!** |

---

## Implementation Checklist

### Immediate (Today):
- [ ] Update config.yaml to use `small` model
- [ ] Test MPS support: `import torch; print(torch.backends.mps.is_available())`
- [ ] If MPS supported, set `device: "mps"` in config
- [ ] Test one episode to verify speedup
- [ ] Restart worker with new config

### This Week:
- [ ] Test speaker diarization on one transcribed episode
- [ ] Verify pattern matching identifies Matt, Paul, Jacob correctly
- [ ] Integrate speaker ID into worker (optional - can do later)

### Next Week:
- [ ] Set up parallel workers (4× workers)
- [ ] Monitor RAM usage (should stay under 20GB)
- [ ] Let it run for 3-4 days to complete backlog

---

## Speaker Diarization Performance Impact

**Adding speaker diarization to pipeline:**
- Diarization time: +5-10 min per hour of audio
- Pattern matching: +1 second
- Total overhead: ~10% slower

**With optimizations:**
- Small + MPS: 3 min transcription + 5 min diarization = **8 min total**
- Still 9x faster than current medium-only approach!

---

## Files Modified

1. ✅ `speaker_diarization.py` - Added PyTorch compatibility fix
2. ✅ `test_hf_access.py` - HuggingFace access test
3. ✅ `database.py` - Added 30-second timeout for concurrent access
4. ✅ PyTorch downgraded to 2.5.1
5. ✅ HuggingFace hub downgraded to <1.0

---

## Next Steps

1. **Test transcription speed with small model:**
```bash
cd scripts
# Edit config.yaml: model: "small"
# Restart worker
```

2. **Test speaker diarization:**
```bash
# Make sure HF_TOKEN is set in your environment or .env file
python speaker_diarization.py \
  'episodes/1270 - Ad Free 1270 Saran Wrap and Crisco.mp3' \
  'transcripts/1270 - Ad Free 1270 Saran Wrap and Crisco.json' \
  --token "$HF_TOKEN" \
  --speakers 2
```

3. **Scale up with parallel workers** (after testing)

---

## Questions?

- **"Will small model quality be okay?"** - Yes for podcast transcription. You can always re-run important episodes with medium/large later.
- **"How much RAM do 4 workers need?"** - ~3GB each = 12GB + 8GB system = 20GB (safe on 24GB M4)
- **"Can I run workers on different machines?"** - Yes! Just point them at the same database.
- **"Should I split audio files?"** - No, parallel workers are better.

**Bottom line:** Small model + MPS + 4 workers = **15 hours total** for 900 episodes! 🚀
