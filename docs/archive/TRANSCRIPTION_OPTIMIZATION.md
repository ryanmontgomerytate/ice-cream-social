# Transcription Speed Optimization Guide
**Current Status:** Using faster-whisper with "medium" model

---

## 🎯 Current Performance

**Your Setup:**
- Model: `medium` (default)
- Device: M4 MacBook Air (ARM64, 24GB RAM)
- Speed: ~5-10 minutes per hour of audio
- Quality: Good accuracy

**Processing Time Examples:**
- 60-minute episode: ~5-10 minutes
- 90-minute episode: ~7-15 minutes
- 120-minute episode: ~10-20 minutes

---

## ⚡ Option 1: Use Smaller Model (Fastest)

### Change to "small" model
**Speed:** ~4-7 min per hour (30% faster)
**Quality:** Good for most use cases
**Trade-off:** Slightly less accurate than medium

**How to change:**
```bash
cd scripts
# Edit config.yaml
# Change: model: "medium"
# To:     model: "small"

# Or start worker with flag:
python transcription_worker.py --model small
```

### Change to "base" model
**Speed:** ~3-5 min per hour (50% faster)
**Quality:** Acceptable for most podcasts
**Trade-off:** More errors, especially with technical terms

### Change to "tiny" model
**Speed:** ~2-3 min per hour (60% faster)
**Quality:** Poor - not recommended
**Trade-off:** Many errors, only for testing

---

## 🔥 Option 2: Use Distil-Whisper (Recommended!)

**Distil-Whisper** is a distilled version of Whisper that's **6x faster** with similar quality!

### Benefits:
- ⚡ 6x faster than medium model
- ✅ Similar accuracy to medium
- 💾 Smaller memory footprint
- 🎯 Optimized for speed

### Speed Comparison:
| Model | Time per Hour | 60min Episode |
|-------|---------------|---------------|
| medium | 5-10 min | 5-10 min |
| distil-medium | 1-2 min | 1-2 min |
| distil-large-v3 | 2-3 min | 2-3 min |

### Installation:
```bash
source venv/bin/activate
pip install transformers accelerate

# Then modify transcription_worker.py to use distil-whisper
```

**Note:** Requires code changes to use Hugging Face transformers instead of faster-whisper.

---

## 🚀 Option 3: GPU Acceleration (If Available)

Your M4 has a powerful GPU that faster-whisper can use!

### Enable GPU:
```yaml
# config.yaml
transcription:
  device: "auto"  # Will use GPU if available
  compute_type: "auto"
```

**Expected speedup:** 2-3x faster with M4 GPU

### Check if GPU is being used:
```bash
# Look in worker log for:
# "Using device: mps" or "Using device: cuda"
tail -f logs/worker.log | grep -i device
```

---

## ⚙️ Option 4: Optimize Settings

### Enable VAD (Voice Activity Detection)
Already enabled in your config! This skips silence.

```yaml
transcription:
  vad_filter: true  # ✅ Already enabled
```

### Disable Word Timestamps (Faster)
If you don't need word-level timestamps:

```yaml
transcription:
  word_timestamps: false  # Saves 10-20% time
```

**Trade-off:** No word-level timing, only segment timing

---

## 🔄 Option 5: Parallel Processing

### Process Multiple Episodes at Once

**Current:** 1 worker, processes 1 episode at a time
**Future:** Multiple workers, process 2-3 episodes simultaneously

### How to implement:
1. Run multiple worker processes
2. Each picks from the same database queue
3. Add locking to prevent conflicts

**Expected speedup:** 2-3x throughput (not individual speed)

**Estimated effort:** 2-3 hours of development

---

## 📊 Recommended Configuration

### For Best Balance (Speed + Quality):
```yaml
# config.yaml
transcription:
  model: "small"           # 30% faster, still good quality
  device: "auto"           # Use M4 GPU
  compute_type: "auto"     # Automatic optimization
  word_timestamps: true    # Keep word timing
  vad_filter: true        # Skip silence
  beam_size: 3            # Faster than 5 (default)
```

### For Maximum Speed (Acceptable Quality):
```yaml
transcription:
  model: "base"            # 50% faster
  device: "auto"
  compute_type: "int8"     # Quantized for speed
  word_timestamps: false   # Skip word timing
  vad_filter: true
  beam_size: 1            # Fastest decoding
```

### For Best Quality (Slower):
```yaml
transcription:
  model: "large-v3"        # Slowest but best
  device: "auto"
  compute_type: "float16"
  word_timestamps: true
  vad_filter: true
  beam_size: 5
```

---

## 🎯 My Recommendation

**Try this first:**
1. Switch to "small" model (30% faster, good quality)
2. Ensure GPU is enabled (device: "auto")
3. Keep other settings as-is

**If you need even faster:**
1. Use "base" model (50% faster, acceptable quality)
2. Disable word timestamps (10-20% faster)
3. Reduce beam_size to 3 or 1

**For future (requires development):**
1. Implement distil-whisper (6x faster!)
2. Add parallel workers (2-3x throughput)

---

## 📈 Speed Comparison Table

| Configuration | Speed | Quality | Recommended For |
|---------------|-------|---------|-----------------|
| Current (medium) | 5-10 min/hr | Excellent | Current setup ✅ |
| Small model | 4-7 min/hr | Good | Quick wins! ⚡ |
| Base model | 3-5 min/hr | Fair | Maximum speed |
| Tiny model | 2-3 min/hr | Poor | Not recommended ❌ |
| Distil-medium | 1-2 min/hr | Excellent | Future upgrade 🚀 |
| Medium + GPU | 2-4 min/hr | Excellent | If GPU works 🎮 |
| Multiple workers | 2-3x throughput | Same | Future upgrade 🔄 |

---

## 🛠️ How to Change Model

### Quick Test (Temporary):
```bash
cd scripts
python transcription_worker.py --model small
```

### Permanent Change:
```bash
# Edit config.yaml
nano ../config.yaml

# Change line:
model: "medium"
# To:
model: "small"

# Save and restart worker
```

---

## ⚠️ Important Notes

### Quality vs Speed Trade-off:
- `medium` → `small`: Minimal quality loss, good speedup ✅
- `small` → `base`: Noticeable quality loss, significant speedup ⚠️
- `base` → `tiny`: Major quality loss, not recommended ❌

### Memory Usage:
| Model | RAM Required |
|-------|-------------|
| tiny | ~1 GB |
| base | ~1.5 GB |
| small | ~2 GB |
| medium | ~3 GB |
| large-v3 | ~5 GB |

Your M4 with 24GB RAM can easily handle any model!

### Disk Space:
Models are cached in `~/.cache/huggingface/`:
- First run downloads model
- Subsequent runs use cached version
- Each model: 100MB - 3GB

---

## 🎬 Next Steps

1. **Try "small" model first:**
   ```bash
   cd scripts
   python transcription_worker.py --model small
   ```

2. **Test on one episode:**
   - Add an episode to queue via UI
   - Watch it process
   - Check quality of transcript

3. **If quality is good:**
   - Update `config.yaml` to make permanent
   - Restart worker

4. **If you need even faster:**
   - Try "base" model
   - Or investigate distil-whisper integration

---

## 📞 Questions to Consider

1. **What's more important: speed or quality?**
   - If quality: Stay with medium or try small
   - If speed: Try small or base

2. **How many episodes do you plan to transcribe?**
   - A few: Keep medium for best quality
   - Hundreds: Switch to small for faster processing

3. **What's your timeline?**
   - No rush: Medium is fine
   - Need done fast: Small or base + multiple workers

4. **Willing to invest in development?**
   - Yes: Distil-whisper + parallel workers = 10x speedup!
   - No: Just change model to small/base

---

**Ready to try?** I can help you switch to a faster model and test it!
