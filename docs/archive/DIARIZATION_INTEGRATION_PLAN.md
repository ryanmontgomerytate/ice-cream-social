# Speaker Diarization + Wiki Integration Plan

## Overview

Enhance transcriptions with speaker identification using:
1. **pyannote.audio** - AI speaker diarization
2. **Wiki scraping** - Episode metadata for context
3. **Smart mapping** - Auto-label speakers as Matt, Mattingly, Jacob, or Guests

---

## How It Works

### Phase 1: Transcription (Current)
```
Audio File → Faster-Whisper → Transcript JSON
```

### Phase 2: Enhanced Pipeline (NEW)
```
Audio File
    ↓
1. Faster-Whisper Transcription (30-60 min)
    ↓
2. Wiki Scraping (2-5 sec)
    ├─ Fetch episode metadata
    ├─ Extract guest names
    └─ Identify segments
    ↓
3. Speaker Diarization (5-10 min)
    ├─ Identify speaker changes
    └─ Label as SPEAKER_00, SPEAKER_01, etc.
    ↓
4. Speaker Mapping (instant)
    ├─ SPEAKER_00 → Matt Donnelly
    ├─ SPEAKER_01 → Paul Mattingly
    ├─ SPEAKER_02 → Jacob (if 3 speakers)
    └─ SPEAKER_03 → [Guest Name from wiki]
    ↓
5. Enhanced Transcript
    ├─ Speaker names on each segment
    ├─ Wiki metadata
    └─ Segment detection
```

---

## Output Example

### Before (Plain Transcript):
```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 5.2,
      "text": "Welcome to the Ice Cream Social"
    },
    {
      "start": 5.2,
      "end": 10.5,
      "text": "Today we have a special guest"
    }
  ]
}
```

### After (Enhanced with Diarization + Wiki):
```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 5.2,
      "text": "Welcome to the Ice Cream Social",
      "speaker": "SPEAKER_00",
      "speaker_name": "Matt Donnelly"
    },
    {
      "start": 5.2,
      "end": 10.5,
      "text": "Today we have a special guest",
      "speaker": "SPEAKER_01",
      "speaker_name": "Paul Mattingly"
    }
  ],
  "diarization": {
    "speakers": ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"],
    "num_speakers": 3,
    "speaker_mapping": {
      "SPEAKER_00": "Matt Donnelly",
      "SPEAKER_01": "Paul Mattingly",
      "SPEAKER_02": "Stacy Stardust"
    },
    "method": "pyannote.audio v3.1"
  },
  "wiki_metadata": {
    "episode_number": "1077",
    "title": "1077: The Man In The Boat With No Name",
    "date": "February 8th, 2024",
    "duration": "1 hour, 33 minutes",
    "guests": ["Stacy Stardust"],
    "segments": ["Jock vs. Nerd", "Scoopardy"],
    "url": "https://heyscoops.fandom.com/wiki/1077:_The_Man_In_The_Boat_With_No_Name"
  }
}
```

---

## Integration Options

### Option A: Sequential (RECOMMENDED for now)
**Pros:**
- Simpler to implement
- Easier to debug
- More reliable
- Can run diarization on already-transcribed episodes

**Cons:**
- Slightly slower (adds 5-10 min per episode)

**Implementation:**
```python
def process_episode_enhanced(audio_path, episode_number):
    # 1. Transcribe
    transcript = transcribe_audio(audio_path)

    # 2. Fetch wiki data
    wiki_data = wiki_scraper.get_episode_by_number(episode_number)

    # 3. Run diarization
    diarization = diarizer.diarize(audio_path,
                                   num_speakers=3 if wiki_data.has_guest else 2)

    # 4. Align speakers
    transcript = diarizer.align_with_transcript(diarization, transcript)

    # 5. Map speakers using wiki
    transcript = wiki_scraper.enhance_transcript_with_wiki(transcript, episode_number)

    return transcript
```

### Option B: Parallel Processing
**Pros:**
- Faster (saves 5-10 min)
- More efficient use of CPU

**Cons:**
- More complex
- Harder to debug
- Requires multiprocessing

**Implementation:**
```python
def process_episode_parallel(audio_path, episode_number):
    with concurrent.futures.ThreadPoolExecutor() as executor:
        # Start both at once
        transcribe_future = executor.submit(transcribe_audio, audio_path)
        diarize_future = executor.submit(diarize_audio, audio_path)
        wiki_future = executor.submit(fetch_wiki, episode_number)

        # Wait for both to complete
        transcript = transcribe_future.result()
        diarization = diarize_future.result()
        wiki_data = wiki_future.result()

        # Merge results
        return merge_results(transcript, diarization, wiki_data)
```

---

## Speaker Identification Strategy

### Known Speakers (from wiki research):
1. **Matt Donnelly** - Host, usually opens show → SPEAKER_00
2. **Paul Mattingly** - Co-host → SPEAKER_01
3. **Jacob** - Audio engineer, regular contributor → SPEAKER_02
4. **Guests** - Varies by episode → SPEAKER_02 or SPEAKER_03

### Mapping Logic:
```python
def map_speakers(num_speakers, has_guest=False, guest_names=None):
    mapping = {}

    if num_speakers >= 1:
        mapping["SPEAKER_00"] = "Matt Donnelly"

    if num_speakers >= 2:
        mapping["SPEAKER_01"] = "Paul Mattingly"

    if num_speakers >= 3:
        if has_guest and guest_names:
            mapping["SPEAKER_02"] = guest_names[0]  # Use wiki guest name
        else:
            mapping["SPEAKER_02"] = "Jacob"  # Assume Jacob if no guest

    if num_speakers >= 4:
        mapping["SPEAKER_03"] = guest_names[1] if len(guest_names) > 1 else "Guest"

    return mapping
```

---

## Wiki Integration Details

### Episode Page URL Format:
```
https://heyscoops.fandom.com/wiki/[NUMBER]:_[TITLE]
```

Examples:
- `1077:_The_Man_In_The_Boat_With_No_Name`
- `1165:_Frosty_the_Necro`

### Metadata Available:
- **Title** (with corrections if needed)
- **Air date**
- **Duration**
- **Guests** (names extracted from title or content)
- **Segments** (Jock vs Nerd, Scoopmail, etc.)
- **Topics** (main discussion points)
- **Location** (recording venue)

### Fallback Strategy:
If wiki page not found:
1. Use generic speaker labels (Matt, Mattingly, Jacob)
2. Log warning for manual review
3. Continue with diarization without guest names

---

## Database Schema Updates

### Add to `episodes` table:
```sql
ALTER TABLE episodes ADD COLUMN speaker_data TEXT;  -- JSON with speaker mapping
ALTER TABLE episodes ADD COLUMN wiki_url TEXT;      -- Link to wiki page
ALTER TABLE episodes ADD COLUMN has_wiki_data BOOLEAN DEFAULT 0;
```

### Example `speaker_data` JSON:
```json
{
  "SPEAKER_00": {
    "name": "Matt Donnelly",
    "role": "host",
    "segment_count": 145
  },
  "SPEAKER_01": {
    "name": "Paul Mattingly",
    "role": "host",
    "segment_count": 132
  },
  "SPEAKER_02": {
    "name": "Stacy Stardust",
    "role": "guest",
    "segment_count": 15
  }
}
```

---

## Worker Integration

### Updated Worker Flow:
```python
class TranscriptionWorker:
    def process_episode(self, audio_path, episode):
        # 1. Transcribe
        transcript = self.transcribe(audio_path)

        # 2. Extract episode number from title
        episode_num = self.extract_episode_number(episode.title)

        # 3. Fetch wiki data (optional, non-blocking)
        wiki_data = None
        try:
            wiki_data = self.wiki_scraper.get_episode_by_number(episode_num)
        except Exception as e:
            logger.warning(f"Wiki fetch failed: {e}")

        # 4. Run diarization if enabled
        if config.diarization.enabled:
            num_speakers = 3 if (wiki_data and wiki_data.get('has_guest')) else 2

            diarization = self.diarizer.diarize(
                audio_path,
                num_speakers=num_speakers
            )

            # 5. Align and map
            transcript = self.diarizer.align_with_transcript(diarization, transcript)

            if wiki_data:
                transcript = self.wiki_scraper.enhance_transcript_with_wiki(
                    transcript, episode_num
                )

        # 6. Save enhanced transcript
        self.save_transcript(transcript, episode)
```

---

## Configuration

### Add to `config.yaml`:
```yaml
speaker_diarization:
  enabled: true
  hf_token: "hf_YOUR_TOKEN_HERE"
  default_speakers: 2  # Matt & Mattingly
  max_speakers: 5      # Safety limit

wiki_integration:
  enabled: true
  base_url: "https://heyscoops.fandom.com/wiki"
  cache_duration: 86400  # Cache wiki data for 24 hours
  timeout: 10  # seconds
```

---

## Performance Impact

### Current Pipeline:
```
Transcription only: 30-60 min per hour of audio
```

### Enhanced Pipeline (Sequential):
```
Transcription:     30-60 min
Wiki fetch:        2-5 sec
Diarization:       5-10 min
Speaker mapping:   < 1 sec
─────────────────────────────
Total:             35-70 min per hour of audio
```

**Overhead:** +5-10 min (15-20% slower)

### Enhanced Pipeline (Parallel):
```
Transcription + Diarization (parallel): 30-60 min
Wiki fetch:                             2-5 sec
Speaker mapping:                        < 1 sec
─────────────────────────────────────────────────
Total:                                  30-60 min per hour of audio
```

**Overhead:** Minimal (+2-5 sec)

---

## Next Steps

### Phase 1: Setup & Test (Do First)
1. ✅ Get HuggingFace token
2. ✅ Accept pyannote model terms
3. ⏳ Test diarization on Episode 1 (already transcribed)
4. ⏳ Verify speaker alignment looks correct

### Phase 2: Wiki Integration
1. ⏳ Test wiki scraper on known episodes (1077, 1165, etc.)
2. ⏳ Update scraper to handle title format correctly
3. ⏳ Cache wiki data to avoid repeated requests

### Phase 3: Worker Integration
1. ⏳ Add diarization step to worker
2. ⏳ Add wiki fetching
3. ⏳ Implement speaker mapping logic
4. ⏳ Update database schema
5. ⏳ Test on new episodes

### Phase 4: Frontend Display
1. ⏳ Update transcript viewer to show speaker names
2. ⏳ Add speaker filtering (show only Matt's lines, etc.)
3. ⏳ Display wiki metadata in episode details
4. ⏳ Add segment detection highlights

---

## Testing Plan

### Test Episodes:
1. **Episode 1** (already transcribed) - 2 speakers
2. **Episode 1077** (has wiki page) - 3+ speakers with guest
3. **New episode** (end-to-end test)

### Success Criteria:
- ✅ Speaker diarization completes without errors
- ✅ 2-3 speakers detected correctly
- ✅ SPEAKER_00 and SPEAKER_01 consistently match Matt/Mattingly
- ✅ Guest speaker labeled correctly from wiki
- ✅ Transcript segments have speaker names
- ✅ Wiki metadata enriches episode data

---

## Recommendation

**Start with Option A (Sequential):**
1. Simpler to implement
2. Can test on already-transcribed episodes
3. Easy to debug
4. Can optimize to parallel later

**Steps:**
1. Get HF token and test diarization on Episode 1
2. Verify results look good
3. Add wiki integration
4. Test full pipeline on Episode 1077 (has wiki data + guest)
5. Integrate into worker if satisfied

**Ready to test?** Get your HuggingFace token and run:
```bash
python speaker_diarization.py \
  "episodes/1270 - Ad Free 1270 Saran Wrap and Crisco.mp3" \
  "transcripts/1270 - Ad Free 1270 Saran Wrap and Crisco.json" \
  --token "hf_YOUR_TOKEN" \
  --speakers 2
```
