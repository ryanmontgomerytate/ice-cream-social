# Development Sessions Log

## Session: February 26, 2026

### Current State Update (Voice Library Storage Migration Foundation)

- Added SQLite-backed voice embedding storage tables (models, per-sample embeddings, centroids) to app DB schema in `src-tauri/src/database/mod.rs`
- Updated `scripts/voice_library.py` to support a SQLite embedding store (`auto|json|sqlite`) while preserving JSON dual-write compatibility (`embeddings_*.json`)
- `voice_library.py add` now accepts metadata args (`--db-path`, `--sample-type`, `--voice-sample-id`, `--episode-id`, `--segment-idx`, `--file-path`, `--sample-date`) and writes per-sample embedding rows + centroid snapshots
- `rebuild` / `rebuild-speaker` now clear stale per-speaker SQLite sample rows before repopulating
- `save_voice_samples` in `src-tauri/src/commands/episodes.rs` now passes DB path + sample metadata into `voice_library.py add` for richer embedding records
- Validation: `python3 -m py_compile scripts/voice_library.py`, `cargo check --manifest-path src-tauri/Cargo.toml`, temp SQLite roundtrip via `SqliteVoiceEmbeddingStore`, and CLI smoke test `voice_library.py info --store-mode sqlite`
- Follow-up manual check: launch app once so the DB migration runs on your real `data/ice_cream_social.db`, then open Voice Library and confirm entries still load + rebuild works for both `pyannote` and `ecapa-tdnn`

### Current State Update (ARCHITECTURE.md Recreated)

- Recreated missing `ARCHITECTURE.md` as the repo architecture source of truth
- Documented current runtime architecture (Tauri/Rust + React + SQLite + Python workers)
- Documented storage boundaries (DB vs filesystem artifacts) and transcript/FTS model
- Added voice library storage section including new SQLite embedding tables (`voice_embedding_models`, `voice_embedding_samples`, `voice_embedding_centroids`) and JSON dual-write migration direction
- Included current SDLC/testing state and short target direction for hosted/web-mobile migration

### Current State Update (Transcript Modal / Episodes Tab Speaker Sync)

- Fixed speaker-label desync between `TranscriptModal` and `TranscriptEditor` by standardizing label resolution on a shared helper (`scripts/dashboard-react/src/services/speakerNameResolver.js`)
- `TranscriptModal` now loads `speakersAPI.getEpisodeSpeakerAssignments(episode.id)` and overlays DB-authoritative assignments (`speaker_name` / `audio_drop_name`) on top of transcript `speaker_names`, matching Episodes tab behavior
- `TranscriptModal` now reloads transcript data after `updateSpeakerNames()` saves and listens for `transcription_complete` events to refresh after reprocess/diarization
- `TranscriptEditor` now uses the same shared resolver to avoid future drift in merge logic
- Validation: `npm --prefix scripts/dashboard-react run build` passed

### Current State Update (Claude/Codex Test-Run Policy Docs)

- Updated `AGENTS.md` and `CLAUDE.md` to require a `Tests Run` summary for completed coding tasks (exact commands, pass/fail, short output/blocker note)
- Added explicit verification command guidance to `CLAUDE.md` so `cargo tauri dev` is clearly documented as runtime/manual testing, not the only validation step
- Added default backend unit test command documentation: `cargo test --manifest-path src-tauri/Cargo.toml`

Next Steps & Areas to Review                                                                                                                                                                
                                                                                                                                                                                            
  🔴 Test First (This Session's Changes)                                                                                                                                                      
                                                                                                                                                                                              
  Multiple flags per clip — this was a significant data model change:                                                                                                                         
  - Launch the app once so the DB migration runs (it auto-detects and recreates flagged_segments)                                                                                             
  - Open an episode and flag a clip with two different types (e.g. Missing Word + Multiple Speakers) — both badges should appear                                                              
  - Confirm old flags survived the migration (check a previously-flagged episode)                                                                                                             
  - Verify "Reprocess" still picks up the right hints — multiple_speakers + wrong_speaker flags should still appear in the hints count
                                                                                                                                                                                              
  Auto-scroll + color bar:                                                                                                                                                                    
  - Play an episode, let it run a few clips, then click the color bar on a segment behind the playhead — view should stay on that segment, not snap back                                      
  - Click elsewhere (deselect) — auto-scroll should resume following playback                                                                                                                 
  - Verify the color bar no longer opens the speaker picker (just selects the clip)                                                                                                           
                                                                                                                                                                                              
  Pending work badges:                                                                                                                                                                        
  - If any episodes have unresolved flags or pending corrections, they should show 🚩 and ✏️  badges in the sidebar                                                                            
  - "Needs Review" filter should narrow the list correctly                                                                                                                                    
                                                                                                                                                                                              
  ---                                                                                                                                                                                         
  🟡 Known Gaps (From SESSIONS.md / Recent Decisions)                                                                                                                                         
                                                                                                                                                                                              
  Approved corrections don't survive reprocess — this was explicitly flagged as a gap:                                                                                                        
  Approved Scoop Polish text corrections survive in transcript_corrections but the multi-speaker notes (has_multiple_speakers=1) never become reprocess hints. After a reprocess, the UI
  requires manual re-approval again.

  The fix path would be: after diarization completes, auto-re-apply approved corrections to the new transcript_segments.

  ECAPA + pyannote voice libraries are siloed — switching backends loses all voiceprints. The "second opinion" merge idea (take higher-confidence result) was noted but not implemented.

  No post-reprocess targeted Qwen re-run — after a reprocess, only segments whose speaker labels changed should be re-polished. Currently it's all-or-nothing.

  ---
  🟢 exception.md (Already Logged)

  The file notes: "filter by last episode I was working with" — you already have the 🕐 Recent filter in the sidebar (shows last 25 opened episodes). Might be worth confirming that covers
  the use case or if you want something more (e.g. "last episode with open picker/flag active").

  ---
  🔮 Logical Next Features

  Based on the trajectory of your workflow:

  ┌────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────┐
  │                        Feature                         │                                         Why                                          │
  ├────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ One-click "Resolve All" for a flag type                │ Once you've reprocessed, bulk-resolving 30 wrong_speaker flags one-by-one is tedious │
  ├────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Reprocess → auto-re-apply approved corrections         │ Closes the biggest gap in the guided reprocess pipeline                              │
  ├────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ "Jump to selected segment" button in toolbar           │ Resume auto-scroll from where you're currently working                               │
  ├────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ Voice library: auto-harvest after a successful diarize │ High-confidence segments (≥0.85) could automatically queue for sample extraction     │
  ├────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────┤
  │ PropertiesPanel: show per-flag-type count              │ "2 wrong speaker, 1 missing word" is more useful than "3 flags"                      │
  └────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────┘

### 5-Task Episode Editor & Pipeline Improvements

**Task 1: Chapter Selection UI Fix** (`TranscriptEditor.jsx`)
- Wrapped `chapterTypes.map()` in `<div className="max-h-48 overflow-y-auto">` so the type list scrolls independently
- Start/stop segment input block remains as a sibling outside the scroll wrapper — always visible below the list

**Task 2: Unified Diarization Progress** (`voice_library.py`, `speaker_diarization.py`, `worker/diarize.rs`, `CurrentActivity.jsx`)
- `identify_speakers_in_diarization()` now accepts `progress_callback=None`; calls it after each speaker processed
- `identify_speakers()` emits `VOICE_ID_PROGRESS: N` to stdout; `0` before, `100` after
- `diarize.rs`: `DIARIZATION_PROGRESS: N` → mapped to `0–70%` (stage `"diarizing"`) and `VOICE_ID_PROGRESS: N` → mapped to `70–100%` (stage `"identifying"`)
- `CurrentActivity.jsx`: Added `"identifying"` to `stageConfig` (purple theme, label "Identifying Speakers")

**Task 3: Merge Chapter Types + Rules in Settings** (`SettingsPanel.jsx`)
- New `ChapterRuleInlineRow`, `ChapterTypeCard`, `ChapterManagementSection` components
- `ChapterTypeCard` uses chevron-expand pattern; delete button lives inside expanded content
- Rules for each type shown hierarchically inside expanded card; inline add-rule form per type
- Replaced `<ChapterTypesSection>` + `<ChapterLabelRulesSection>` with `<ChapterManagementSection>`
- Old components kept as stubs (not rendered); `MATCH_TYPES` moved before new components

**Task 4: Episode Loading Speed Cache** (`api.js`, `TranscriptEditor.jsx`)
- Added `_staticCache` Map and `_cachedFetch()` helper + `invalidateStaticCache()` export to `api.js`
- `getChapterTypes`, `getCharacters`, `getAudioDrops` now cached; subsequent episode switches skip 3 IPC round-trips
- Cache invalidated after create/update/delete mutations for each resource
- Removed `speakersAPI.getVoiceLibrary()` from `loadTranscript()` Promise.all; lazy-loads after transcript renders if cache is empty

**Voice Embedding Backend + HF Offline Mode Removal** (`speakers.rs`, `SettingsPanel.jsx`)
- Removed DB-backed `embedding_model` setting and `hf_hub_offline_enabled` setting entirely
- Removed all related UI panels from Settings (Voice Embedding Backend, Hugging Face Offline Mode)
- Simplified `apply_hf_runtime_env_*` — hardcoded to `HF_HUB_OFFLINE=false` always; preserved network-failure auto-retry in `compare_embedding_backends`

**Pending Work Badges + Filter** (`models.rs`, `database/mod.rs`, `commands/episodes.rs`, `EpisodeSidebar.jsx`, `SettingsPanel.jsx`)
- Added `unresolved_flag_count: i64` and `pending_correction_count: i64` to `Episode` struct
- `get_episodes()` and `get_episode_by_id()` now LEFT JOIN flagged_segments and transcript_corrections to compute per-episode counts
- Added `has_pending_work_only` filter to `EpisodeFilters` (Rust) + SQL `IN` subquery
- `EpisodeSidebar.jsx`: "Needs Review" filter button (amber); 🚩 N unresolved flags badge + ✏️ N pending corrections badge on episode cards
- `SettingsPanel.jsx`: Improved explanatory text for Scoop Polish Corrections section — explains AI suggestions persist until reviewed

**Task 5: Episode Editor Interaction Analytics** (full stack)
- DB: `episode_interactions` table in `init_schema()`; `log_episode_interaction()` and `get_episode_interaction_summary()` methods
- Models: `EpisodeInteraction` and `EpisodeInteractionSummary` structs in `models.rs`
- Commands: `log_episode_interaction` and `get_episode_interaction_summary` in `commands/content.rs`; registered in `lib.rs`
- Frontend: `logEpisodeInteraction` (fire-and-forget) + `getEpisodeInteractionSummary` in `tauri.js` and `api.js`
- `TranscriptEditor.jsx`: `logInteraction` helper (useCallback); wired to `createChapter`, `createFlag`, `handleAssignSpeakerName`, playback speed button
- `PropertiesPanel.jsx`: loads summary on episode change; displays compact `"N chapter_created · M segment_flagged…"` line in footer

## Session: February 25, 2026

Plan 
What current reprocess actually uses                                                                                                                                                        
                                                                                                                                                                                              
  More than just voiceprints — but with notable gaps:                                                                                                                                         
                                                                                                                                                                                              
  Uses:                                                                                                                                                                                       
  - ✅ Unresolved wrong_speaker / multiple_speakers / character_voice flags → written to hints JSON                                                                                           
  - ✅ Voice library embeddings (with temporal era decay)                                                                                                                                     
  - ✅ num_speakers_hint derived from how many distinct corrected names are in flags
  - ✅ Episode date for temporal weighting on voice matches

  Gaps:
  - ❌ Resolved flags are excluded — once you mark a flag resolved, that correction never re-feeds the hints. If you re-diarize a second time, you've lost those anchors
  - ❌ Approved Qwen classifications not used — approved segment_classifications (is_performance_bit=1, character_name) never flow back into diarization hints
  - ❌ Approved Scoop Polish corrections not used — approved transcript_corrections survive the reprocess (they live in a separate table) but the multi-speaker notes
  (has_multiple_speakers=1, speaker_change_note) never become hints
  - ❌ Character voice hints are weak — a character_voice flag writes the character name as the corrected_speaker, but pyannote has no concept of "this is a performed voice, not a real
  person" — it still tries to match it against voice prints
  - ❌ ECAPA and pyannote voice libraries are completely siloed — switching backends means starting from zero voiceprints

  ---
  Ideas: Guided Reprocess incorporating Qwen + Scoop Polish

  1 — Richer hints file (fix the gaps)

  Extend the hints JSON to include all approved data sources:

  {
    "corrections": [
      // From unresolved wrong_speaker flags (existing)
      {"segment_idx": 5, "corrected_speaker": "Matt", "is_character": false, "anchor": true},
      // From approved Qwen classifications (NEW)
      {"segment_idx": 12, "corrected_speaker": "Sweet Bean", "is_character": true, "is_performance_bit": true},
      // From RESOLVED flags too (fix the gap — currently excluded)
      {"segment_idx": 2, "corrected_speaker": "Paul", "is_character": false, "anchor": true}
    ],
    "multiple_speakers_segments": [
      // From multiple_speakers flags + Scoop Polish has_multiple_speakers (NEW)
      {"segment_idx": 23, "primary_speaker": "Matt", "note": "~0.4s Paul says 'yeah'"}
    ],
    "exclude_from_voiceprint": [
      // Character voice segments — tell pyannote to ignore these for speaker ID (NEW)
      12, 34, 67
    ],
    "num_speakers_hint": 3
  }

  The exclude_from_voiceprint list is the key insight — currently pyannote wastes time trying to match Sweet Bean's voice against your voice library and probably misidentifies her as Paul
  (similar register). Telling the script to skip those segments during voice matching would clean up a lot of phantom speakers.

  2 — Post-reprocess: auto-apply approved corrections

  Approved Scoop Polish text corrections should survive any reprocess (they're in a separate table) and be re-applied to transcript_segments automatically after diarization completes. Right
  now they persist in the transcript_corrections table but the UI requires manual re-approval after reprocess. That's unnecessary friction.

  3 — Post-reprocess: targeted Qwen validation

  After a guided reprocess, only re-run Qwen Polish on segments whose speaker label changed from the previous run. Those are the highest-risk segments for transcription errors (voice ID
  uncertainty correlates with speech clarity issues).

  4 — ECAPA as a second-opinion, not an alternative

  Instead of choosing one backend, run both in parallel and take the higher-confidence result. The two models fail differently — pyannote is better at segmentation, ECAPA-TDNN is better at
  short clip verification. A simple merge rule: if pyannote confidence ≥ 0.75 use it, else try ECAPA, else flag as uncertain. This doubles the voice library value since you'd build prints
  for both backends.

  ---
  Data points extractable from episodes — feeding back into the initial pipeline

  From a single episode

  ┌─────────────────────────────┬───────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
  │           Signal            │        Where it comes from        │                                              How it improves pipeline                                               │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Corrected speaker per       │ Resolved flags                    │ Expands voice library with labeled clips → better auto-ID on future episodes                                        │
  │ segment                     │                                   │                                                                                                                     │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Character voice segments    │ Approved Qwen classifications     │ Builds character clip library for audio drop detection + excludes from speaker matching                             │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Transcript error patterns   │ Approved Scoop Polish             │ Podcast-specific vocabulary for a custom Whisper prompt (initial_prompt) — "Ice Cream Social, Scoops,               │
  │                             │                                   │ fartsinabag.biz" etc.                                                                                               │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Multi-speaker timestamps    │ Scoop Polish                      │ Can be cross-referenced with audio energy to detect crosstalk patterns                                              │
  │                             │ has_multiple_speakers             │                                                                                                                     │
  ├─────────────────────────────┼───────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ Jock vs Nerd segments       │ Qwen classification               │ Structural template for chapter auto-labeling                                                                       │
  └─────────────────────────────┴───────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

  From multiple episodes (the compounding value)

  Speaker clustering: If SPEAKER_00 in episode 697 and SPEAKER_02 in episode 698 both auto-assign to Matt with ≥0.85 confidence, you now know Matt's voice print is stable. Episodes where the
   auto-ID failed (confidence < 0.75) probably have audio quality issues — flag those for manual review before queueing.

  Episode structure priors: After 50 episodes are processed with approved chapters, you can extract a probabilistic template: "Intro at 0:00–2:00, Jock vs Nerd starts around 45–55 min mark."
   Feed that as chapter seed hints to new episodes — auto-label and let the user correct rather than detect from scratch.

  Vocabulary corpus for Whisper fine-tuning / prompting: Every approved Scoop Polish correction is a ground-truth (heard wrong → heard right) training pair. 500+ corrections = enough to
  build a custom initial_prompt for Whisper that dramatically reduces mishearings of show-specific terms.

  Voice drift tracking: The temporal decay weighting already handles this but only forward — you can mine backwards too. Episodes from 2014–2018 where Matt's voice is younger should have a
  separate voice print bucket. The sample_dates list in the voice library supports this but nobody's mining it yet.

  Cross-episode character consistency: If Sweet Bean appears in episodes 200, 350, 500, and 697 — you have audio clips and you can auto-detect likely character appearances in unprocessed
  episodes by scanning for segments matching Sweet Bean's known voice print (separate from regular speaker diarization pass).

  ---
  The highest-ROI short-term improvement is fixing the hints file to include resolved flags + approved Qwen classifications + exclude character voice segments from voice matching. That's a
  Rust-side change to reprocess_diarization in commands/episodes.rs — want me to implement that?
