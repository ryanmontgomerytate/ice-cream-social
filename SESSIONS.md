# Development Sessions Log

## Session: February 26, 2026

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

  ## Session: February 26, 2026

  Here is Claude's plan:                                                                                                                                                                       
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Plan: 5-Task Episode Editor & Pipeline Improvements                                                                                                                                          
                                                        
 Context

 Five improvements to the Ice Cream Social app spanning the diarization pipeline, settings UI, episode editor analytics, episode load performance, and the chapter selection UI. All tasks
 are independent and have no blocking dependencies on each other.

 Implementation order (lowest risk first):
 1. Chapter picker UI fix (CSS only)
 2. Unified diarization progress
 3. Merge chapter settings sections
 4. Episode loading speed
 5. Episode editor analytics (full stack)

 ---
 Task 1: Chapter Selection UI Fix

 Problem: The chapter type picker in the transcript editor can overflow; the start/stop segment inputs get cut off (can't scroll to the stop input). Chapter type list has no height
 constraint.

 File: scripts/dashboard-react/src/components/TranscriptEditor.jsx (~lines 1360–1420)

 Changes:
 - Wrap only the chapterTypes.map(...) render in <div className="max-h-48 overflow-y-auto"> so the list scrolls internally
 - Keep the {chapterRangeStart === idx && ...} start/stop input block as a sibling outside that scroll wrapper — it must always be visible below the list
 - Final structure:
 <div className="mt-2 p-2 bg-white rounded-lg border border-gray-200 shadow-sm">
   <div className="text-[10px] ...">Chapter type</div>
   <div className="max-h-48 overflow-y-auto">
     {chapterTypes.map(ct => <button key={ct.id} .../>)}
   </div>
   {chapterRangeStart === idx && chapterRangeType && (
     <div className="mt-2 ...">  {/* start/stop inputs here */}
     </div>
   )}
 </div>

 ---
 Task 2: Unified Diarization Progress in UI (ECAPA + Pyannote as One Process)

 Problem: Pyannote diarization emits DIARIZATION_PROGRESS: 0-100, but the subsequent voice identification stage (ECAPA or pyannote embeddings) emits nothing — UI progress bar stalls at 100%
  while voice ID runs silently.

 Goal: Map both stages into a unified 0-100 progress bar. Pyannote = 0–70%, voice ID = 70–100%.

 scripts/voice_library.py

 - Add optional progress_callback=None parameter to identify_speakers_in_diarization()
 - Inside the for speaker_label, segments in speaker_segments.items(): loop, call progress_callback(int((i+1)/total*100)) after each speaker is processed (backward-compatible: default None)

 scripts/speaker_diarization.py

 - In identify_speakers() method, define a closure that prints VOICE_ID_PROGRESS: N to stdout, pass it as progress_callback to identify_speakers_in_diarization()
 - Print VOICE_ID_PROGRESS: 0 before the call and VOICE_ID_PROGRESS: 100 after

 src-tauri/src/worker/diarize.rs (~lines 148–177)

 - Extend the stdout-reading match to handle VOICE_ID_PROGRESS: lines
 - Map: DIARIZATION_PROGRESS: N → combined N * 70 / 100, stage "diarizing"
 - Map: VOICE_ID_PROGRESS: N → combined 70 + N * 30 / 100, stage "identifying"

 scripts/dashboard-react/src/components/CurrentActivity.jsx

 - Add "identifying" entry to stageConfig (reuse purple theme, label: "Identifying Speakers", icon: 🔍)
 - No other JSX changes needed — stageConfig[slot.stage] handles it automatically

 ---
 Task 3: Merge Chapter Types + Chapter Label Rules in Settings

 Problem: ChapterTypesSection and ChapterLabelRulesSection are two separate flat-list sections. X (delete) button is in the summary row. User wants them merged using the CategoryRuleCard
 expansion pattern (X inside expanded area).

 File: scripts/dashboard-react/src/components/SettingsPanel.jsx

 Approach: Replace both sections with a single ChapterManagementSection that renders chapter types as expandable cards. Inside each expanded card, show the rules belonging to that type
 (hierarchical: type → rules).

 New component structure:
 ChapterManagementSection
   ├── loads getChapterTypes() + getChapterLabelRules() in one Promise.all
   ├── ChapterTypeCard (per type) — expansion pattern (chevron toggle)
   │    summary row: {icon} {name}  [{N rules}]  [▶]
   │    expanded content:
   │      - Color, icon, sort_order, name, description edit fields
   │      - [Delete Type] button  ← inside expanded, not in summary row
   │      - ─── Rules for this type ───
   │      - ChapterRuleRow[] (filtered by chapter_type_id)
   │        each row: match_type badge | pattern | priority | enabled | [Edit] | [X inside row expansion]
   │      - [+ Add Rule] button
   └── [+ Add Type] button

 Key patterns to follow:
 - Summary row chevron toggle: copy from CategoryRuleCard lines 73–106 in SettingsPanel.jsx
 - Delete button position: inside expanded content (like CategoryRuleCard lines 286–293)
 - Color swatch, emoji, sort_order: keep from existing ChapterTypeRow edit state (lines 526–575)
 - DEFAULT_COLORS constant already exists — reuse it
 - For rules within expanded: chapter_type_id is pre-known (the parent type's id), so omit it from the rule form

 Remove: ChapterTypesSection, ChapterTypeRow, ChapterLabelRulesSection, ChapterLabelRuleRow components. Verify no other references to these before deleting.

 In SettingsPanel render: Replace <ChapterTypesSection .../> and <ChapterLabelRulesSection .../> with <ChapterManagementSection onNotification={onNotification} />

 ---
 Task 4: Episode Loading Speed

 Problem: loadTranscript() fires 10 parallel Tauri calls on every episode switch. 4 of those (getChapterTypes, getCharacters, getAudioDrops, getVoiceLibrary) return static/global data that
 rarely changes — they're refetched unnecessarily on every episode switch.

 scripts/dashboard-react/src/services/api.js

 Add a module-level Map cache with a _cachedFetch(key, fetchFn) helper at the top of the file:

 const _staticCache = new Map()
 function _cachedFetch(key, fetchFn) {
   if (_staticCache.has(key)) return Promise.resolve(_staticCache.get(key))
   return fetchFn().then(result => { _staticCache.set(key, result); return result })
 }
 export function invalidateStaticCache(key) {
   key ? _staticCache.delete(key) : _staticCache.clear()
 }

 Wrap in contentAPI: getChapterTypes, getCharacters, getAudioDrops with _cachedFetch.

 Call invalidateStaticCache('chapterTypes') after any chapter type create/update/delete.
 Call invalidateStaticCache('characters') after any character create/update/delete.
 Call invalidateStaticCache('audioDrops') after any audio drop create/delete.

 scripts/dashboard-react/src/components/TranscriptEditor.jsx

 - Remove speakersAPI.getVoiceLibrary() from the Promise.all in loadTranscript()
 - Remove the voices destructuring + setVoiceLibrary(voices) call
 - Add background lazy-fetch after Promise.all resolves: if (voiceLibrary.length === 0) { speakersAPI.getVoiceLibrary().then(setVoiceLibrary).catch(() => {}) }
 - The activePicker === 'speaker' useEffect already refetches voice library when the speaker picker opens, so speakers are available when needed

 Result: Second and subsequent episode switches skip 3 IPC round-trips entirely (cache hits). Voice library loads lazily, not blocking transcript display.

 ---
 Task 5: Episode Editor Interaction Analytics

 Problem: No data is captured about how editors interact with episodes (corrections, flags, chapters, speed changes). This data could inform future auto-processing decisions.

 Backend

 src-tauri/src/database/mod.rs — add to init_schema():
 CREATE TABLE IF NOT EXISTS episode_interactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     episode_id INTEGER NOT NULL,
     action TEXT NOT NULL,
     segment_idx INTEGER,
     metadata TEXT,
     created_at TEXT DEFAULT (datetime('now', 'localtime')),
     FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
 );
 CREATE INDEX IF NOT EXISTS idx_interactions_episode ON episode_interactions(episode_id);

 src-tauri/src/database/models.rs — add structs:
 pub struct EpisodeInteraction { id, episode_id, action, segment_idx: Option<i64>, metadata: Option<String>, created_at }
 pub struct EpisodeInteractionSummary { action: String, count: i64 }

 src-tauri/src/database/mod.rs — add methods to impl Database:
 - log_episode_interaction(episode_id, action, segment_idx, metadata) — single INSERT
 - get_episode_interaction_summary(episode_id) — SELECT action, COUNT(*) GROUP BY action

 src-tauri/src/commands/content.rs — add two commands:
 - log_episode_interaction(episode_id, action, segment_idx, metadata) → Result<(), AppError>
 - get_episode_interaction_summary(episode_id) → Result<Vec<EpisodeInteractionSummary>, AppError>

 src-tauri/src/lib.rs — register both commands in invoke_handler

 Frontend

 scripts/dashboard-react/src/services/tauri.js — add both methods to contentAPI

 scripts/dashboard-react/src/services/api.js — add wrappers:
 - logEpisodeInteraction: fire-and-forget (no-op in HTTP mode, tauriInvoke in Tauri mode)
 - getEpisodeInteractionSummary: returns data

 scripts/dashboard-react/src/components/TranscriptEditor.jsx — add logInteraction helper:
 const logInteraction = useCallback((action, segmentIdx = null, metadata = null) => {
   if (!episode?.id || !isTauri) return
   contentAPI.logEpisodeInteraction(episode.id, action, segmentIdx, metadata)
 }, [episode?.id])

 Wire at these action points:

 ┌───────────────────────────────┬────────────────────────┬────────────────────────────────────┐
 │           Location            │         Action         │              Metadata              │
 ├───────────────────────────────┼────────────────────────┼────────────────────────────────────┤
 │ createChapter()               │ chapter_created        │ {chapter_type_id, end_segment_idx} │
 ├───────────────────────────────┼────────────────────────┼────────────────────────────────────┤
 │ handleFlagSegment()           │ segment_flagged        │ {flag_type, corrected_speaker}     │
 ├───────────────────────────────┼────────────────────────┼────────────────────────────────────┤
 │ handleAssignSpeakerName()     │ speaker_corrected      │ {original_label, display_name}     │
 ├───────────────────────────────┼────────────────────────┼────────────────────────────────────┤
 │ Playback speed button onClick │ playback_speed_changed │ {speed}                            │
 └───────────────────────────────┴────────────────────────┴────────────────────────────────────┘

 scripts/dashboard-react/src/components/PropertiesPanel.jsx — add:
 - useEffect on episode?.id that calls getEpisodeInteractionSummary and stores result
 - Compact display: "Interactions: 5 chapters | 3 flags | 2 corrections" in the episode properties area

 ---
 Verification

 ┌────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 │        Task        │                                                                               Test                                                                               │
 ├────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Chapter UI fix     │ Open chapter picker with many types → list scrolls; click a type → start/stop input visible without page scroll                                                  │
 ├────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Diarization        │ Queue an episode for diarization; watch CurrentActivity → bar fills 0–70% (Diarizing) then 70–100% (Identifying Speakers)                                        │
 │ progress           │                                                                                                                                                                  │
 ├────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Settings merge     │ Open Settings → one "Chapter Management" section; expand a type → see its rules + delete button inside expansion                                                 │
 ├────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Load speed         │ Switch episodes repeatedly; second switch should feel faster; verify cache invalidation via character edit then episode switch                                   │
 ├────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
 │ Analytics          │ Make flags/chapters/corrections on an episode; run SELECT action, COUNT(*) FROM episode_interactions WHERE episode_id=X GROUP BY action; in DB browser; verify   │
 │                    │ PropertiesPanel shows summary                                                                                                                                    │
 └────────────────────┴───────────────────────────────────