# Voice Library — Architecture, Status & Known Gaps

*Last updated: February 2026*

---

## What the Voice Library Is

The voice library is the speaker auto-identification system. It has two jobs:

1. **Training** — build a "voice print" (averaged embedding vector) for each known speaker from WAV clip samples
2. **Identification** — during diarization, compare unknown `SPEAKER_XX` labels against voice prints and auto-assign names with confidence scores

---

## Two Separate Things: Samples vs Voice Prints

This is the most important architectural distinction to understand.

| Concept | Where Stored | What It Is |
|---|---|---|
| **Sample files** | `scripts/voice_library/samples/{Name}/` | Raw WAV audio clips of the speaker |
| **Voice print** | `scripts/voice_library/embeddings.json` | Averaged 512-dim embedding vector trained from samples |

**Having sample files does NOT automatically mean a voice print exists.** The samples must be *processed* through the embedding model (pyannote) to create a voice print. That processing step is "Rebuild Voice Prints."

### UI Indicators

| Badge | Meaning |
|---|---|
| Green **"Voice Print (Nx)"** | Voice print trained — ready for auto-assignment |
| Amber **"N clips — needs Rebuild"** | Sample files exist on disk, but Rebuild hasn't been run |
| No badge | No samples and no voice print |

---

## Full Pipeline

```
1. Sample files land on disk
   (manually placed, or from Harvest, or from Scoop Polish corrections)

2. "Rebuild Voice Prints" runs
   → voice_library.py rebuild
   → Scans samples/{Speaker}/*.wav
   → Loads pyannote embedding model (requires HF_TOKEN)
   → Averages embeddings → saves to embeddings.json

3. Diarization runs on a new episode
   → speaker_diarization.py --episode-date YYYY-MM-DD
   → Identifies SPEAKER_XX labels
   → identify_speakers_in_diarization() matches vs embeddings.json
   → Returns: speaker_names + speaker_confidence

4. Rust worker reads match results
   → For confidence ≥ 0.75: calls db.link_episode_speaker_auto()
   → episode_speakers row inserted with source='auto'

5. Human reviews in the UI
   → Confirms or corrects auto-assignments
   → On text correction approval in Scoop Polish:
      → extractVoiceSampleFromSegment() fires (fire-and-forget)
      → extract_voice_sample.py clips the audio
      → Calls add_speaker() → updates embeddings.json immediately
      → Inserts voice_samples DB record
```

---

## Era-Aware Temporal Weighting

The voice library applies a temporal decay when matching — a recording from 2014 gets a lower confidence boost against a 2024 voice print (and vice versa).

**Formula:** `adjusted_score = cosine_similarity × (0.5 + 0.5 × exp(-days_diff / 365))`

| Gap | Weight Applied |
|---|---|
| Same day | 1.0× (no penalty) |
| 1 year apart | ≈ 0.82× |
| 2 years apart | ≈ 0.68× |
| 5+ years apart | ≈ 0.51× (floor) |

This prevents Matt's 2014 USB-mic recordings from confidently matching against Paul's 2024 studio voice print.

---

## What Is Actually Working

| Feature | Status | Notes |
|---|---|---|
| Voice print training from WAV clips | ✅ Working | Requires HF_TOKEN + pyannote installed in venv |
| `Rebuild Voice Prints` button | ✅ Working | Now errors properly on missing HF_TOKEN (was silently showing 0) |
| Displaying speakers with clips but no print | ✅ Working (Feb 2026 fix) | Shows amber "needs Rebuild" badge |
| Era-aware temporal weighting | ✅ Implemented | Fires during diarization when `--episode-date` is passed |
| Auto-assignment during diarization | ✅ Implemented | Confidence ≥ 0.75 → `episode_speakers` with source='auto' |
| Scoop Polish → voice library feedback loop | ✅ Implemented | Fire-and-forget on text correction approval |
| `Harvest Samples` button | ✅ Implemented | Requires episodes with confirmed speaker assignments (see below) |

---

## Known Gaps & Gotchas

### 1. Rebuild Requires a HuggingFace Token

The pyannote embedding model (`pyannote/embedding`) requires authentication. Without `HF_TOKEN` set in `.env`, Rebuild will fail with an error toast. The token needs the `pyannote/embedding` model permission granted at huggingface.co.

**Setup:**
```bash
# In .env:
HF_TOKEN=hf_your_token_here
```

### 2. Harvest Has a Prerequisite: Confirmed Speaker Assignments

`Harvest Samples` only extracts audio from episodes where:
- Episode is downloaded (`is_downloaded=1`)
- Episode has been diarized (`has_diarization=1`)
- Episode has confirmed speaker assignments in `episode_speakers` (a human or auto-assignment has set `speaker_id IS NOT NULL`)

**In practice:** Until at least one episode goes through the full pipeline (download → transcribe → diarize → human assigns Matt/Paul labels), Harvest will find 0 episodes and add 0 samples. Harvest is most useful *after* a few dozen episodes are confirmed — at that point it bulk-extracts thousands of clips automatically.

### 3. Auto-Assignment Only Fires After Rebuild

Auto-assignment during diarization matches `SPEAKER_XX` labels against `embeddings.json`. If `embeddings.json` only contains `🔊 Intro` (the initial state), no human speakers will be auto-assigned — even if sample files exist on disk.

**The bootstrap order is:**
1. Manually place or harvest sample clips for Matt/Paul (or add from Transcript viewer)
2. Run **Rebuild Voice Prints** → embeddings.json now has Matt, Paul, etc.
3. Diarize an episode → auto-assignment fires with ≥0.75 confidence

### 4. Samples and Embeddings Can Drift

If you manually drop WAV files into `scripts/voice_library/samples/Matt_Donnelly/` *after* the last Rebuild, the embedding is stale — it doesn't know about the new clips. The amber "needs Rebuild" badge in the UI signals this state. Always run Rebuild after adding new clips manually.

### 5. Speaker Name Must Match Exactly

Auto-assignment and Scoop Polish feedback lookup speaker names case-insensitively in the `speakers` table, but the directory name must use underscores that convert to spaces matching the speaker's registered name exactly.

Example: Directory `Matt_Donnelly` → speaker name `"Matt Donnelly"` ✅
Example: Directory `Matt` → speaker name `"Matt Donnelly"` ❌ (no match)

### 6. The `🔊 Intro` Voice Print Is Real — Others Were Not

When you open the Speakers panel and see only `🔊 Intro` listed, that reflects the actual state of `embeddings.json`. The hosts Matt Donnelly and Paul Mattingly had sample files on disk (`Matt_Donnelly/`, `Paul_Mattingly/` directories) but no trained embeddings — they were completely invisible to the auto-assignment system.

The **February 2026 fix** made these speakers visible in the UI with amber "needs Rebuild" badges, accurately representing the state.

---

## File Locations Reference

| Path | What's Here |
|---|---|
| `scripts/voice_library/samples/{Name}/` | Raw WAV clips per speaker |
| `scripts/voice_library/embeddings.json` | Trained embedding vectors |
| `scripts/voice_library/sound_bites/` | Audio drop samples |
| `scripts/voice_library.py` | Core training + identification logic |
| `scripts/speaker_diarization.py` | Runs pyannote + voice library identification |
| `scripts/harvest_voice_samples.py` | Bulk-harvests clips from confirmed episodes |
| `scripts/extract_voice_sample.py` | Extracts a single clip (Scoop Polish feedback) |
| `data/ice_cream_social.db` → `voice_samples` | DB records tracking each clip's source episode/segment |
| `data/ice_cream_social.db` → `episode_speakers` | Label→speaker assignments (has `source` and `confidence` columns) |

---

## Quick Diagnostic Checklist

If auto-assignment isn't working, check in order:

1. **Is HF_TOKEN set in .env?**
   `grep HF_TOKEN .env` — should start with `hf_`

2. **Does embeddings.json have human speakers?**
   `python scripts/voice_library.py list` — should show Matt, Paul, etc.

3. **Did Rebuild run successfully?**
   Check Speakers panel — voices with clips should show green "Voice Print" badge, not amber.

4. **Is the episode diarized?**
   In the Episodes list, check that `has_diarization=1` for the episode.

5. **Were any matches found above threshold?**
   Check the Rust logs — diarize.rs logs `[auto-assign] label → speaker (confidence X.XX)`
