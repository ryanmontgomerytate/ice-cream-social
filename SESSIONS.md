# Development Sessions Log

## Session: February 20, 2026 (continued)

### Exception List Fixes — 11 Bug Reports from exception.md

**Goal**: Fix all actionable items in `exception.md`.

**Changes per exception:**

**#1 Multiple speakers flag** — `TranscriptEditor.jsx`
- Wrapped speaker checklist in `max-h-48 overflow-y-auto` scroll container
- Added "← Back" button at top of panel
- Cancel button now returns to flag type menu (`setActivePicker('flag')`)

**#2 Wrong speaker missing sound bites** — `TranscriptEditor.jsx`
- Added "Sound Bites" section below voice library in `flag-wrong-speaker` picker
- Uses existing `audioDrops` state from context

**#3 Queue row → open episode** — `Stats.jsx`, `PipelineStats.jsx`, `App.jsx`, `TranscriptReviewLayout.jsx`
- Added `onOpenEpisode` callback prop through the component tree
- Clicking `→` on a queue row switches to Episodes tab and opens the episode

**#4b Model shows "large-v3"** — `worker/mod.rs`, `worker/transcribe.rs`, `lib.rs`
- Changed `WorkerState::default()` model from `"large-v3"` to `"medium"`
- Changed transcribe fallback from `"large-v3"` to `"medium"`
- Worker init now reads `transcription_model` setting from DB

**#4a Done Today resets on restart** — `database/mod.rs`, `commands/worker.rs`
- Added `get_processed_today()` DB method counting today's episodes from DB
- `get_worker_status` now returns DB-sourced count instead of in-memory counter

**#5 Settings flickering + scroll** — `SettingsPanel.jsx`
- Replaced boolean `saving` with `savingKey` string — only disables the specific toggle being saved
- Added `overflow-y-auto max-h-[calc(100vh-200px)]` to content div

**#6 Qwen targets all flags** — `PropertiesPanel.jsx`
- `handleRunQwen` now filters to `character_voice` flags only
- Button shows `characterFlagCount` and is disabled when no character flags exist

**#7 Flags persist after reprocess** — `TranscriptEditor.jsx`
- Frontend now filters out `resolved: true` flags when loading flagged segments
- Backend already resolves flags in `handle_diarize_complete` (was already implemented)

**#9 New speakers not in dropdown** — `TranscriptEditor.jsx`, `TranscriptReviewContext.jsx`, `TranscriptReviewLayout.jsx`, `App.jsx`
- Added `isVisible` prop thread from App → Layout → Context → Editor
- TranscriptEditor refreshes voiceLibrary when tab becomes visible (using `prevVisibleRef`)

**#10 Voice ID count inaccurate** — `database/mod.rs`, `commands/speakers.rs`, `SpeakersPanel.jsx`
- Added `get_speaker_episode_counts()` DB method (counts distinct episodes per speaker)
- `get_voice_library` command now accepts `db` and returns `episode_count`
- SpeakersPanel shows "Voice ID (N ep)" instead of "Voice ID (Nx)"

**#11 Episode lost on tab switch** — `App.jsx`
- Switched Episodes tab from conditional render to `display:none`
- Component stays mounted across tab switches, preserving all state

**Deferred**: #4c/4d (card removal, qwen stats), chapter rule naming, #8 sound bites rebranding

**Current state**: All 11 actionable exceptions addressed. Rust and React both build clean.

---

## Session: February 20, 2026

### Qwen2.5-Omni-3B — Character & Performance Bit Classification (Full Implementation)

**Goal**: Implement the full Qwen classification pipeline as a targeted post-processor on flagged/suspected segments.

**Strategy**: Pyannote stays primary diarization. Qwen runs on short clips (≤60s) around flagged segments to classify:
1. Is this a performance bit / character voice?
2. Which character (from known list)?
3. Was Pyannote wrong about this segment?

**Files created/modified**:

**`scripts/qwen_classify_segments.py`** (new)
- Accepts `--audio-file`, `--segments` (JSON), `--characters` (JSON)
- Loads full audio once, then extracts padded clips per segment (±5s, ≤60s cap)
- Loads Qwen model once (amortize ~60s load time across all segments)
- Emits `QWEN_PROGRESS: N` to stdout for Tauri subprocess monitor
- Matches character names to known characters (fuzzy partial match)
- Outputs final JSON: `{"status","results":[...],"elapsed_secs"}`

**`src-tauri/src/database/mod.rs`** (modified)
- `ALTER TABLE transcript_segments ADD COLUMN is_performance_bit INTEGER DEFAULT 0`
- New `segment_classifications` table (id, episode_id, segment_idx, classifier, is_performance_bit, character_name, character_id, speaker_note, tone_description, confidence, approved 0/1/-1, created_at)
- New DB methods: `get_episode_audio_path`, `save_segment_classifications`, `get_segment_classifications`, `approve_segment_classification`, `reject_segment_classification`

**`src-tauri/src/database/models.rs`** (modified)
- Added `SegmentClassification` struct with joined `segment_text`, `segment_start_time`

**`src-tauri/src/commands/content.rs`** (modified)
- `run_qwen_classification(episode_id, segment_indices)` — spawns Python subprocess, streams QWEN_PROGRESS events, saves pending results to DB
- `get_segment_classifications(episode_id)` — returns all classifications
- `approve_segment_classification(id)` — writes is_performance_bit + optional character_appearance
- `reject_segment_classification(id)` — marks rejected, no segment writes

**`src-tauri/src/lib.rs`** (modified)
- Registered 4 new commands in invoke_handler

**`scripts/dashboard-react/src/services/tauri.js`** (modified)
- Added `runQwenClassification`, `getSegmentClassifications`, `approveSegmentClassification`, `rejectSegmentClassification`

**`scripts/dashboard-react/src/services/api.js`** (modified)
- Added wrappers in `contentAPI` for all 4 new Qwen commands

**`scripts/dashboard-react/src/components/PropertiesPanel.jsx`** (modified)
- Added `QwenClassificationCard` sub-component
- Added "Qwen Analysis" accordion section (visible when episode is downloaded + Tauri mode)
- "Analyze Flagged" button — sends flagged segment indices to Qwen
- Progress bar while running (listens for `qwen_progress` events)
- Classification cards: segment text, timestamp, is_performance_bit badge, character name, confidence bar, speaker note
- Approve / Reject / Approve All actions

### Current State
- Rust backend compiles clean
- React frontend builds clean
- Full Qwen classification pipeline from button → subprocess → DB → review UI
- Pending verification: actual end-to-end test with a downloaded episode

---

## Session: February 19, 2026

### Qwen2.5-Omni-3B Evaluation

**Goal**: Test Qwen2.5-Omni-3B as a single-pass replacement for the Whisper + Pyannote pipeline, focusing on `is_performance_bit` character-voice detection.

**Model downloaded**: `giangndm/qwen2.5-omni-3b-mlx-4bit` — but this was an MLX conversion with the audio encoder stripped. Deleted it. Downloaded the PyTorch version via HuggingFace `transformers` (~6 GB cached to `~/.cache/huggingface`).

**Script created**: `scripts/qwen_inference.py`
- Uses `venv/bin/python3.9` (has torch + MPS; python3.14 env lacks torch)
- Loads `Qwen/Qwen2.5-Omni-3B` via `Qwen2_5OmniForConditionalGeneration`
- Resamples audio: 44100 Hz → 16000 Hz (Whisper encoder requirement)
- Disabled TTS talker via `return_audio=False`
- Uses `json-repair` to recover truncated output

**Test result** (30s of Episode 1171, "High Fives for 2024"):
- Transcription quality: **accurate** — real words, correct timestamps, detected music intro
- Speed: **13.6× realtime** (30s audio → 407s processing)
- Speaker diarization: assigned all segments to SPEAKER_00 (no multi-speaker separation on 30s clip)
- `is_performance_bit`: fields lost in truncation

**Verdict**: Too slow for batch transcription (68× slower than Whisper). Quality is real.

**Decision**: Keep Whisper + Pyannote for transcription/diarization. Use Qwen later as a **post-processing text classifier** only — feed completed transcript text, ask it to flag `is_performance_bit` per segment. Essentially free in that mode.

**Dependencies added to `venv/lib/python3.9`**:
- `transformers 4.57.6`
- `torch 2.8.0`, `torchvision 0.23.0`, `torchaudio 2.8.0` (upgraded from 2.5.1)
- `soundfile`, `librosa`, `json-repair`, `accelerate`

### Diarization Pipeline Fix

**Problem**: Upgrading torch from 2.5.1 → 2.8.0 (required for Qwen) broke Pyannote. PyTorch 2.6+ changed `torch.load` default from `weights_only=False` → `True`. The existing monkey-patch in `speaker_diarization.py` used `setdefault` which doesn't override explicit `weights_only=True` passed by `lightning_fabric`.

**Fix**: Changed `kwargs.setdefault('weights_only', False)` → `kwargs['weights_only'] = False` (unconditional override) in `speaker_diarization.py:31`.

**Affected episodes** (failed during the bad window, need retry):
- Episode 899: The Bear, The Fish and The Baby Duckling
- Episode 900: Dick or Ditch
- Episode 901: One Beep Strike, Two Beeps Ball

**Verified**: `from pyannote.audio import Pipeline` imports cleanly with torch 2.8.0 after fix.

### Current State
- Diarization pipeline restored and working
- Episodes 899–901 need to be requeued for diarization
- `qwen_inference.py` retained as a test harness for future post-processing classifier work
- P3 (React Context refactor) + S1–S5 (Rust subagents) plan still pending

---

## Session: January 27, 2026

### Setup
- Created CLAUDE.md framework file with M4-native architecture guidelines
- Established "Native-First" stack strategy
- Defined context anchoring rules

### Current State
- Framework files created
- Ready to begin implementation of native transcription pipeline
- Need to create ARCHITECTURE.md with detailed database schema

### Next Steps
1. Create ARCHITECTURE.md with database schema
2. Set up validation script (`scripts/validate_env.py`)
3. Begin implementation of whisper.cpp integration
4. Set up SQLite with sqlite-vec extension

---

## Session: January 28, 2026

### Tasks Completed
- Fixed Tauri detection (`withGlobalTauri: true` in tauri.conf.json)
- Added `refresh_feed` command to fetch new episodes from RSS (916 episodes parsed)
- Added `get_transcript` command for viewing transcripts inline
- Fixed sorting in `get_episodes` query (sort_by, sort_desc, search params)
- Added transcript viewing UI in EpisodeCard component
- Consolidated documentation: archived 28 outdated .md files to `docs/archive/`
- Updated ARCHITECTURE.md to reflect Tauri/Rust architecture

### Current State
- Tauri app running with all commands functional
- 904 episodes in database (12 new from RSS pending upsert verification)
- Core documentation reduced to 3 files: CLAUDE.md, SESSIONS.md, ARCHITECTURE.md
- Frontend auto-detects Tauri mode and uses IPC

### Next Steps
1. Verify RSS refresh completed (916 entries parsed)
2. Add `download_episode` command for manual downloads
3. Improve CurrentActivity pane UI/documentation
4. Test transcription workflow end-to-end

### Issues/Blockers
- None currently

---

## Session: January 29, 2026

### Tasks Completed
- Fixed Tauri v2 IPC parameter naming (camelCase in JS → snake_case in Rust)
- Fixed NULL constraint issues in database (retry_count, added_date, added_to_queue_date)
- Added Apple Podcasts feed support (1288 episodes synced)
- Removed System Status tab from UI (simplified interface)
- Implemented real-time progress tracking for transcription:
  - Streams whisper-cli stderr for progress updates
  - Parses `whisper_print_progress_callback: progress = X%` output
  - Calculates elapsed time and estimated remaining
  - Emits Tauri events for UI updates
- Fixed pipe buffer deadlock (stdout → Stdio::null())
- Upgraded default model to large-v3 (3GB, ~5GB RAM usage)

### Current State
- Tauri app fully functional with real-time transcription progress
- 916 Patreon + 1288 Apple Podcasts episodes in database
- Transcription worker running with large-v3 model on Metal/M4
- Progress tracking working (updates every 5%)

### Next Steps
1. Add `download_episode` command for manual downloads
2. Implement diarization integration (Python subprocess)
3. Add sqlite-vec for vector search
4. Build transcript search UI

### Issues/Blockers
- None currently

---

## Session: February 3, 2026

### Tasks Completed
- Verified existing features: download_episode, diarization, search UI all already implemented
- Added `index_all_transcripts` Rust command for bulk FTS indexing
- Added transcript segment parsing for both whisper-cli and faster-whisper formats
- Added Tauri events for indexing progress (`indexing_progress`, `indexing_complete`)
- Updated SearchPanel with working "Index All" button and progress display
- Updated CLAUDE.md with Tauri prerequisites
- **Installed Ollama** with llama3.2:3b model (2GB)
- **Created Ollama integration module** (`src-tauri/src/ollama/mod.rs`)
- **Added extraction database tables**: `extraction_prompts`, `extraction_runs`
- **Created extraction commands**: get/create/update/delete prompts, run extraction, test prompt
- **Built ExtractionPanel UI** with:
  - Prompt list and editor
  - Content type selection (character, trivia, guest, segment, custom)
  - Run extraction on episodes
  - Test mode for iterating on prompts
  - JSON result display
- **Default extraction prompts**: Character Detection, Trivia Scores, Guest Detection, Segment Detection

### Current State
- Tauri app running with full LLM extraction capabilities
- Ollama running locally with llama3.2:3b model
- 917 episodes in database (59+ transcribed)
- Search UI functional with FTS5
- **New Extraction tab (🤖)** for user-defined LLM prompts
- Users can create custom prompts and iterate using test mode

### Next Steps
1. Test extraction on real episodes
2. Add sqlite-vec for semantic/vector search (embeddings)
3. Auto-save extracted content to detected_content table
4. Add extraction history view

### Issues/Blockers
- None currently

---

## Session: February 4, 2026

### Tasks Completed
- **Added Quick Add Character Appearance** to CharactersPanel:
  - Simple form: character name + episode dropdown + optional timestamp
  - Auto-creates character if it doesn't exist
  - Links character to episode with `addCharacterAppearance`
  - Autocomplete suggestions from existing characters via datalist
  - Timestamp parsing supports MM:SS and HH:MM:SS formats
- Recognized need for **two-workflow UX pattern**:
  - **Quick Add**: For facts user already knows (e.g., "Count Absorbo is in episode 1283")
  - **LLM Extraction**: For automated discovery across many episodes
- User tested Quick Add with "Count Absorbo" → Episode 1283 successfully

### Current State
- Tauri app running with dual content entry workflows
- Characters panel has both Quick Add (top) and detailed Add Character form
- First character added: "Count Absorbo" linked to Episode 1283
- Ollama + LLM extraction still available for bulk discovery

### Next Steps
1. Add Quick Add workflows to Sponsors and Speakers panels
2. sqlite-vec for semantic/vector search (embeddings)
3. Auto-save LLM extracted content to detected_content table
4. Bulk character discovery via LLM extraction

### Issues/Blockers
- None currently

---

## Session: February 10, 2026

### Tasks Completed
- **Consolidated Episodes + Review tabs into single Episodes tab**
  - Review tab's `TranscriptReviewLayout` now renders as the Episodes tab content
  - Removed old Episodes tab (grid layout with EpisodesBrowser + TranscriptionQueue)
  - Removed separate "Review" tab entry from navigation

### Removed from App.jsx
- `EpisodesBrowser` and `TranscriptionQueue` component imports
- `episodesRefreshKey` state
- `queue` state and `loadQueue` function (+ all event handler/refresh calls)
- `handleViewTranscript` function
- `queueAPI` import
- Socket.IO `queue_update` handler

### Kept
- `TranscriptModal` and `episodesAPI` (still used by Search panel's `onViewEpisode`)

### Current State
- Episodes tab now shows the transcript review UI directly
- 7 tabs: Episodes, Search, Extraction, Speakers, Characters, Sponsors, Settings
- Default tab remains `'episodes'`

### Next Steps
1. TBD

### Issues/Blockers
- None currently

---

## Session: February 11, 2026

### Tasks Completed

#### Pipeline Worker Refactor (continued from Feb 10)
- Split `worker/mod.rs` into scheduler + 3 task files: `download.rs`, `transcribe.rs`, `diarize.rs`
- Pipelined architecture with `tokio::sync::mpsc` channels and `CancellationToken`
- WorkerState now tracks multiple `PipelineSlot`s for concurrent operations
- Added `queue_type` column (`'full'` | `'diarize_only'`) to transcription_queue
- Added `requeue_for_diarization()` with race condition protection
- Frontend CurrentActivity.jsx renders multi-slot cards

#### Queue UI Improvements
- Added `queue_type` field to `TranscriptionQueueItem` Rust struct
- Updated all 3 queue DB queries (`get_queue`, `get_next_queue_item`, `get_upcoming_undownloaded`) to include `queue_type`
- Split sidebar queue counts into separate **transcription** (yellow) and **diarization** (orange) badges
- Redesigned queue summary badges as card-style squares (big number + label) instead of flat pills
- Added "Failed" filter button to episode list (only appears when failures exist)
- Added `failed_only` filter to `EpisodeFilters` (Rust) and `get_episodes` query
- Failed badge on episode cards now shows "Diarization Failed" vs "Failed" based on `queue_type`
- Hover tooltip on failed badges shows the error message

#### Reprocess Diarization Button UX
- Button greys out and shows "✓ Queued for Diarization" after clicking
- Disabled state prevents double-clicks
- Resets when switching episodes

#### Sidebar Rename
- Renamed "Episodes" panel header to "Library"

#### Security: Patreon RSS Token Scrubbed from Git
- **Identified:** Patreon auth token was hardcoded in `config.yaml` and committed to public GitHub repo
- **Scrubbed:** Installed `git-filter-repo`, replaced token with `REDACTED_PATREON_AUTH_TOKEN` across all history
- **Force pushed** rewritten history to GitHub
- Moved RSS feed URLs to `.env` (not committed)
- Updated `.env.example` with `PATREON_RSS_URL` and `APPLE_RSS_URL` placeholders
- Updated `config.yaml` to reference `env_var` names instead of hardcoded URLs
- Added `load_env_value()` helper in `lib.rs` for generic `.env` reading
- Added `resolve_feed_url()` in `episodes.rs` - checks `.env` first, falls back to `config.yaml` with warning
- Cleaned up `load_huggingface_token()` to use the new generic helper
- Removed hardcoded URLs from `scripts/download_episodes.py` (now reads from `.env` via `dotenv`)

#### Failed Queue Items Investigation
- All 6 failures are download errors: "Error reading download stream: error decoding response body"
- Likely expired/problematic Patreon CDN URLs for older episodes
- Not related to Mac sleeping - completed items show continuous processing with no gaps

#### Download Failure Handling
- `mark_failed()` now auto-detects download failures and removes from queue + resets `is_downloaded=0`
- Non-download failures stay in queue with incremented `retry_count`
- Added "Download Failed" vs "Diarization Failed" labels on episode card badges
- Enhanced error display in TranscriptEditor with categorized error cards and plain English explanations
- Added "Retry Download" button for download failures

#### Downloaded/Not Downloaded Filters
- Added `downloaded_only` and `not_downloaded_only` to `EpisodeFilters` (Rust backend + frontend)
- Filters are mutually exclusive in UI (clicking one clears the other)

#### Layout Collapse
- Library panel expands to full width when no transcript is loaded (no more tiny cards)
- Added `hasTranscript` and `transcriptLoading` states to TranscriptReviewLayout
- Properties panel hidden until transcript loads
- `showEditorPanels = selectedEpisode && (hasTranscript || transcriptLoading)`

#### Loading Spinner
- Ice cream sundae loading animation with neapolitan scoops (pink, vanilla, chocolate)
- Scoops animate dropping into a waffle cone
- Shows "Scooping up transcript..." message

#### Diarize-Only Pipeline Fix (Critical Bug)
- **Bug:** `try_fill_slots()` only pulled items from DB queue inside `if !*transcribe_busy` — diarize_only items could never be picked up while transcription was running (which is always, with 400+ items in queue)
- **Fix:** Added independent diarize-only scheduling block that runs regardless of transcribe slot state
- Added `get_next_diarize_only_item()` DB method that queries specifically for `queue_type = 'diarize_only'` pending items
- Handles audio download if needed before diarization

#### Auto-Queue Undiarized Episodes on Startup
- Worker now checks for transcribed episodes without diarization on startup
- Auto-queues them as `diarize_only` items so they don't fall through the cracks across app restarts
- Added `count_undiarized_transcribed()` and `queue_undiarized_transcribed()` DB methods

#### Stats Panel Overhaul (Episode Tracking)
- Renamed header from "Episodes" to "Episode Tracking"
- 6 stat squares in one row: Total | Downloaded | Transcribed | Diarized | In Queue | Failed
- Failed is now a square (same style as others) instead of a separate bar
- Added `diarized_episodes`, `in_transcription_queue`, `in_diarization_queue` to `AppStats` Rust struct
- Two progress bars: Transcription (green) and Diarization (purple)
- Diarization progress shows "X of Y transcribed (Z%)"

#### Top Tab Rename
- "Episodes" tab renamed to "Episode Tracking" in App.jsx navigation

### Current State
- Tauri app building and running with all changes
- ~456 episodes pending in transcription queue, 133 transcribed, 123 diarized, 6 failed
- Git history clean of secrets, force pushed to GitHub
- RSS feed URLs now loaded from `.env` file
- Queue UI shows split transcription/diarization counts
- Failed episodes filterable in Library sidebar
- Diarize-only pipeline working independently of transcription slot
- Undiarized episodes auto-queued on startup

### Next Steps
1. Consider retry logic for failed downloads (CDN URL refresh)
2. Auto-transcribe toggle should respect feed source preference
3. Clips/doomscroll feature exploration
4. Scalability planning for public release

### Issues/Blockers
- Patreon RSS token could not be rotated (Patreon reissues the same token)
- 6 episodes with download failures need investigation (possibly expired CDN links)

---

## Session: February 12, 2026

### Tasks Completed

#### Episode Categorization & Cross-Feed Linking
- **Schema migration:** Added 4 columns to episodes table: `category`, `category_number`, `sub_series`, `canonical_id`
- **Category rules table:** Data-driven `category_rules` table with regex patterns, seeded with 6 rules
- **Categories:** episode (1959), fubts (109), bonus (91), scoopflix (39), shituational (9), abracababble (6)
- **Cross-feed linking:** `canonical_id` FK links patreon "Ad Free" variants to apple canonical episodes — 660 pairs linked
- **Default view hides variants:** `get_episodes` adds `canonical_id IS NULL` by default, reducing visible episodes from 2213 to 1553
- **New commands:** `recategorize_all_episodes`, `link_cross_feed_episodes`, `get_category_rules`, `get_episode_variants`
- **Updated all 8+ Episode SELECT queries** to include 4 new columns (27 total fields on Episode struct)
- **Frontend:** Category filter tabs in EpisodeSidebar with icons/colors from DB, category badges on episode cards
- **Ran batch categorization** via Python script against live DB — all 2213 episodes categorized + linked
- **Cleanup:** Deleted 1 stale `feed_source='local'` test record

#### 91 "Bonus" Catch-All Episodes
- Titles with typos ("Episdoe", "Ad Free1216"), prefixes ("FIXED!", "ICS"), or bare numbers don't match standard patterns
- Plan: add keyword-based rule editor UI in Settings for non-technical users to manage

### Current State
- Tauri app compiles clean with all category changes
- Category tabs visible in sidebar: All | FUBTS | Scoopflix | Abracababble | Shituational | Episode | Bonus
- 660 cross-feed variants hidden by default
- Frontend shows category badges, sub-series, and proper numbering

#### Category Rule Editor UI (Settings Panel)
- **Keywords column:** Added `keywords TEXT` to `category_rules` table with migration for existing DBs
- **Updated categorization logic:** `categorize_episode()` now checks comma-separated keywords (case-insensitive) BEFORE regex — keyword matches take priority
- **4 new Tauri commands:** `add_category_rule`, `update_category_rule`, `delete_category_rule`, `test_category_rule`
- **Test Pattern feature:** Tests regex + keywords against all episode titles, returns match count + 20 samples with "matched_by" indicator (keyword vs regex)
- **Delete protection:** Cannot delete the bonus catch-all rule (priority 99)
- **Settings UI:** `CategoryRulesSection` and `CategoryRuleCard` components:
  - Expandable/collapsible cards sorted by priority
  - Edit mode: display_name, emoji icon, color picker, priority, regex fields
  - Keyword chips: add/remove tag-style interface
  - "Test Pattern" button with live match results (amber dots = keyword, indigo = regex)
  - "Re-categorize All" button, "Add Rule" button
- **API layer:** Added CRUD methods to `tauri.js` and `api.js`

#### Close Episode Button (Transcript Editor)
- Added `<<` chevron button in TranscriptEditor header (left of episode title)
- `handleCloseEpisode` in TranscriptReviewLayout clears all state and expands sidebar to full width
- Mirrors the `>>` collapse button on the Properties panel

#### Wiki Lore Integration (POC)
- **3 new SQLite tables:** `wiki_lore`, `wiki_lore_mentions`, `wiki_episode_meta`
- **New file: `src-tauri/src/commands/wiki.rs`**
  - Wikitext parser: `parse_episode_infobox()`, `split_template_fields()`, `clean_wikitext()`
  - MediaWiki API integration: searches heyscoops.fandom.com for episodes by number
  - `sync_wiki_episode` command: search → fetch page → parse infobox → store in DB
  - `get_wiki_episode_meta` command: retrieve stored wiki data
  - Episode alignment: matches via `category_number` (handles inconsistent wiki naming: "Episode 001:", "675:", "Epsiode 588:")
- **DB methods:** `upsert_wiki_episode_meta()`, `get_wiki_episode_meta()`, `find_episode_by_number()`
- **Wiki tab in PropertiesPanel:**
  - Auto-loads wiki metadata when episode changes
  - "Fetch from Fandom Wiki" button for episodes without data
  - Displays: wiki link, air date, summary, bits & characters, scoopmail, jock vs nerd
  - CC BY-SA attribution footer, re-sync button
- **License research:** CC BY-SA 3.0 is fine — just need attribution (which the UI includes)
- **Wiki stats:** 705 episode pages, 24 bits, 13 characters, 32 people, 17 jingles on the wiki

### Current State
- Tauri app compiles clean with all changes (warnings only)
- Category rule editor functional in Settings tab with keyword + regex support
- Wiki integration code complete, needs end-to-end testing with `cargo tauri dev`
- Close button works for returning to full-width library view
- Test episode for wiki POC: Episode 675 "Cross Bowlognese"

### Next Steps
1. **Test wiki sync** end-to-end with Episode 675 via `cargo tauri dev`
2. **Bulk wiki sync** — batch import for all 705 wiki-covered episodes
3. **Ollama suggest workflow** — "Analyze" button sends transcript + wiki context to LLM, returns accept/dismiss suggestion cards
4. **Wiki lore mentions** — scan transcripts for bit/character name mentions from wiki data
5. **Uncategorized episode review** — manually reassign the 91 "bonus" catch-all episodes using keyword rules

### Issues/Blockers
- None currently

## Session: February 13, 2026
│ Pipeline Timing Stats & UI Reorganization                                                                                                                                                               │
│                                                                                                                                                                                                         │
│ Context                                                                                                                                                                                                 │
│                                                                                                                                                                                                         │
│ We can't evaluate whether the current transcription/diarization setup is optimal because we have zero timing data. The processing_time column exists on episodes but is never written. We need          │
│ per-stage durations (download, transcribe, diarize) so we can see averages, spot outliers, and compare performance against audio length/file size. The Stats and CurrentActivity cards currently sit    │
│ above the tab bar taking space on every view — moving them into their own "Stats" tab cleans up the layout and gives room for the new timing table.                                                     │
│                                                                                                                                                                                                         │
│ Plan                                                                                                                                                                                                    │
│                                                                                                                                                                                                         │
│ 1. Database Schema — Add timing columns                                                                                                                                                                 │
│                                                                                                                                                                                                         │
│ File: src-tauri/src/database/mod.rs (init_schema())                                                                                                                                                     │
│                                                                                                                                                                                                         │
│ Add idempotent ALTER TABLEs (same pattern as existing migrations):                                                                                                                                      │
│ - episodes.download_duration REAL — seconds                                                                                                                                                             │
│ - episodes.transcribe_duration REAL — seconds                                                                                                                                                           │
│ - episodes.diarize_duration REAL — seconds                                                                                                                                                              │
│ - episodes.diarized_date TEXT — ISO timestamp                                                                                                                                                           │
│                                                                                                                                                                                                         │
│ Repurpose existing processing_time (never populated) as total pipeline duration.                                                                                                                        │
│                                                                                                                                                                                                         │
│ 2. Update Episode struct                                                                                                                                                                                │
│                                                                                                                                                                                                         │
│ File: src-tauri/src/database/models.rs                                                                                                                                                                  │
│                                                                                                                                                                                                         │
│ Add 4 fields after canonical_id: download_duration, transcribe_duration, diarize_duration, diarized_date.                                                                                               │
│                                                                                                                                                                                                         │
│ 3. Update ALL Episode SELECT queries & row mappings                                                                                                                                                     │
│                                                                                                                                                                                                         │
│ File: src-tauri/src/database/mod.rs                                                                                                                                                                     │
│                                                                                                                                                                                                         │
│ Search for every canonical_id: row.get(26) — there are ~5 Episode constructors. Add columns 27-30 to each SELECT and map them. This is the most error-prone step.                                       │
│                                                                                                                                                                                                         │
│ 4. Add duration to worker Result structs                                                                                                                                                                │
│                                                                                                                                                                                                         │
│ Files: src-tauri/src/worker/download.rs, transcribe.rs, diarize.rs                                                                                                                                      │
│                                                                                                                                                                                                         │
│ Add duration_seconds: Option<f64> to DownloadResult, TranscribeResult, DiarizeResult. Capture Instant::now() before work, compute .elapsed().as_secs_f64() after. transcribe.rs already has start_time  │
│ — reuse it.                                                                                                                                                                                             │
│                                                                                                                                                                                                         │
│ 5. Add timing DB methods                                                                                                                                                                                │
│                                                                                                                                                                                                         │
│ File: src-tauri/src/database/mod.rs                                                                                                                                                                     │
│                                                                                                                                                                                                         │
│ update_download_duration(episode_id, duration)                                                                                                                                                          │
│ update_transcribe_duration(episode_id, duration)                                                                                                                                                        │
│ update_diarize_duration(episode_id, duration)  // also sets diarized_date                                                                                                                               │
│ update_pipeline_duration(episode_id, duration)  // writes processing_time                                                                                                                               │
│ get_pipeline_timing_stats() -> PipelineTimingStats                                                                                                                                                      │
│ get_recently_completed_episodes(limit) -> Vec<CompletedEpisodeTiming>                                                                                                                                   │
│                                                                                                                                                                                                         │
│ 6. Update scheduler to save durations                                                                                                                                                                   │
│                                                                                                                                                                                                         │
│ File: src-tauri/src/worker/mod.rs                                                                                                                                                                       │
│                                                                                                                                                                                                         │
│ - Add entered_pipeline_at: Instant and download_duration/transcribe_duration to PipelineEntry                                                                                                           │
│ - handle_download_complete: save result.duration_seconds to DB + entry                                                                                                                                  │
│ - handle_transcribe_complete: save result.duration_seconds to DB + entry                                                                                                                                │
│ - handle_diarize_complete: save result.duration_seconds to DB                                                                                                                                           │
│ - finish_episode: compute total pipeline duration from entered_pipeline_at, save to DB                                                                                                                  │
│ - Only record durations on success, not errors                                                                                                                                                          │
│ - For diarize_only items: only update diarize_duration, don't overwrite pipeline total                                                                                                                  │
│                                                                                                                                                                                                         │
│ 7. New Tauri command                                                                                                                                                                                    │
│                                                                                                                                                                                                         │
│ File: src-tauri/src/commands/stats.rs                                                                                                                                                                   │
│                                                                                                                                                                                                         │
│ #[tauri::command]                                                                                                                                                                                       │
│ pub async fn get_pipeline_stats(db, limit) -> PipelineStatsResponse {                                                                                                                                   │
│     timing: db.get_pipeline_timing_stats(),                                                                                                                                                             │
│     recent: db.get_recently_completed_episodes(limit.unwrap_or(20)),                                                                                                                                    │
│ }                                                                                                                                                                                                       │
│                                                                                                                                                                                                         │
│ Register in src-tauri/src/lib.rs invoke_handler.                                                                                                                                                        │
│                                                                                                                                                                                                         │
│ 8. Frontend API methods                                                                                                                                                                                 │
│                                                                                                                                                                                                         │
│ Files: services/tauri.js, services/api.js                                                                                                                                                               │
│                                                                                                                                                                                                         │
│ Add statsAPI.getPipelineStats(limit) calling get_pipeline_stats.                                                                                                                                        │
│                                                                                                                                                                                                         │
│ 9. UI reorganization — Stats tab                                                                                                                                                                        │
│                                                                                                                                                                                                         │
│ File: scripts/dashboard-react/src/App.jsx                                                                                                                                                               │
│                                                                                                                                                                                                         │
│ - Remove <Stats> and <CurrentActivity> from always-visible area (lines 166-167)                                                                                                                         │
│ - Add { id: 'stats', label: 'Stats' } tab to nav (first position)                                                                                                                                       │
│ - Render <PipelineStats stats={stats} currentActivity={currentActivity} /> for that tab                                                                                                                 │
│ - Set default tab to 'stats'                                                                                                                                                                            │
│                                                                                                                                                                                                         │
│ 10. New PipelineStats component                                                                                                                                                                         │
│                                                                                                                                                                                                         │
│ File (NEW): scripts/dashboard-react/src/components/PipelineStats.jsx                                                                                                                                    │
│                                                                                                                                                                                                         │
│ Sections:                                                                                                                                                                                               │
│ 1. Existing <Stats> card — reused as-is (counts + progress bars)                                                                                                                                        │
│ 2. Existing <CurrentActivity> card — reused as-is                                                                                                                                                       │
│ 3. Average timing cards — row of 4-5 cards:                                                                                                                                                             │
│   - Avg transcribe time per hour of audio                                                                                                                                                               │
│   - Avg download / transcribe / diarize duration                                                                                                                                                        │
│   - Total hours processed                                                                                                                                                                               │
│ 4. Recently completed table — columns: Ep#, Title, Audio Length, Download, Transcribe, Diarize, Total, Date. Durations formatted as Xm Ys.                                                              │
│                                                                                                                                                                                                         │
│ Fetches getPipelineStats() on mount + every 30s.                                                                                                                                                        │
│                                                                                                                                                                                                         │
│ Verification                                                                                                                                                                                            │
│                                                                                                                                                                                                         │
│ 1. cargo check after steps 1-7                                                                                                                                                                          │
│ 2. cargo tauri dev — let an episode complete the full pipeline                                                                                                                                          │
│ 3. Check sqlite3 data/ice_cream_social.db "SELECT title, download_duration, transcribe_duration, diarize_duration, processing_time FROM episodes WHERE transcribe_duration IS NOT NULL LIMIT 5"         │
│ 4. Open Stats tab — verify counts, activity, timing averages, and table all render                                                                                                                      │
│ 5. Verify Episodes tab no longer shows Stats/CurrentActivity above it      


9 tasks (9 done)
  ✔ Add timing columns to database schema
  ✔ Update Episode struct with timing fields
  ✔ Update all Episode SELECT queries and row mappings
  ✔ Add duration to worker Result structs and capture timing
  ✔ Add timing DB methods and new structs
  ✔ Update scheduler to save durations
  ✔ Add Tauri command and register it
  ✔ Add frontend API methods and PipelineStats component
  ✔ Verify with cargo check

---

## Session: February 13, 2026

### Tasks Completed

#### Pipeline Timing (continued from Feb 12)
- Fixed 6 PipelineEntry construction sites missing `entered_pipeline_at`, `download_duration`, `transcribe_duration`
- Wired scheduler event handlers to save durations to DB on stage completion
- `finish_episode` computes total pipeline time from `entered_pipeline_at` and saves as `processing_time`
- Added `get_pipeline_stats` Tauri command (stats.rs) + registered in lib.rs
- Added `statsAPI.getPipelineStats()` to tauri.js and api.js
- Created PipelineStats.jsx component: reuses Stats/CurrentActivity cards, adds timing averages row + recently completed table

#### Episode Sidebar Cleanup
- Reorganized filter area with labeled rows: Status, Source, Category, Sort
- Added "Diarized" as a proper status filter (full stack: EpisodeFilters, DB query, frontend)
- Moved "Diarized" out of sort options
- Source buttons moved to own labeled row
- Replaced "Load More" with proper prev/next pagination (header + footer controls)

#### Wiki Search Improvements
- Added title-based fallback search: strips "Episode"/"Ad Free" prefix and trailing punctuation, searches wiki by clean title
- Added loose matching: if strict starts_with fails, checks if title contains episode number + partial title match
- Now tries 3 search queries instead of 2 before giving up

#### UI Tab Reorganization
- Renamed "Episode Tracking" tab to "Episodes"
- Moved Stats tab to just before Settings (was first)
- Default tab is now Episodes

### Current State
- All pipeline timing features complete and compiling
- Episode sidebar has proper pagination + labeled filter rows
- Wiki sync more resilient to naming differences between RSS and wiki
- cargo check passes clean



## Session: February 14, 2026

  This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.
                                 
     Analysis:                          
     Let me chronologically analyze the conversation:                   

     1. **First user message**: Implement a detailed plan for "Audio Identification Panel Redesign" - renaming the Speakers tab, adding new backend commands for voice samples,
     rewriting the SpeakersPanel.jsx component with expandable rows, two sections (Speakers/Sound Bites), lazy sample loading, play/delete per sample.
                                                       
     2. **My initial implementation**:                                                                                                                                           
        - Read all 6 key files (speakers.rs, lib.rs, tauri.js, api.js, SpeakersPanel.jsx, App.jsx)                                
        - Explored voice library directory structure (samples/ empty, sound_bites/Intro/ with 1 wav file)                                                                        
        - Discovered embeddings.json has speakers + "🔊 Intro" sound bite entry                                                                                                  
        - Added VoiceSample struct + get_voice_samples + delete_voice_sample commands to speakers.rs                                                                             
        - Registered commands in lib.rs                                                                                                                                          
        - Added API methods to tauri.js and api.js                                                                                                                               
        - Renamed tab from "Speakers"/"👥" to "Audio ID"/"🎙️ " in App.jsx                                                                                                         
        - Fully rewrote SpeakersPanel.jsx with expandable rows, two sections, lazy loading                                                                                       
                                      
     3. **Second user message**: "these tags are not lining up 4 samples, did you remove the previos samples?, only intro has one be sayd there are 4, also it was not linked to
     where the sample was taken from. also the loader and all loders going forward should be the ice cream cone one like in the episode editor"

     4. **My fix for the badge/loader issues**:
        - Discovered embeddings.json `sample_count` is embedding averaging count, not actual file count
        - Fixed VoiceSample struct name conflict (renamed to VoiceSampleFile to avoid collision with VoiceSample in episodes.rs)
        - Changed badge from "4 samples" to "Voice ID (4x)" to accurately represent embedding training count
        - Added green info bar showing source file when expanded
        - Replaced generic spinner with ice cream cone loader (IceCreamLoader component)
        - Added MiniIceCreamLoader for inline sample loading (3 bouncing neapolitan scoops)

     5. **Third user message**: "I just added intro to sample and it said it was saved it said but I didn't see it in audio ID?"

     6. **My investigation**:
        - Checked Tauri logs - confirmed save DID work (ep2213_94s-98s.wav saved)
        - Found the file was overwritten (same filename from previous save)
        - Realized the badge only showed "Voice ID (4x)" with no file count indicator
        - Added `file_count` field to VoiceLibrarySpeaker struct
        - Added `count_audio_files_for()` helper that scans filesystem
        - Updated get_voice_library to populate file_count
        - Added yellow "1 clip" badge to collapsed rows

     7. **Fourth user message**: "in Audio ID why can't I access the 4 clips here? all clips saved need to be accessed here. is there a way to have a rating to know if it is a
     good clip? also where is the feature to jump to where the clip is saved?"

     8. **My response**: Entered plan mode to design a larger solution:
        - The "4 clips" in Voice ID (4x) are embeddings, not saved audio files - the speaker path in save_voice_samples only calls voice_library.py add (saves embedding),
     doesn't extract audio via ffmpeg
        - Need to: save audio clips for speakers too, add voice_samples DB table, add rating, add jump-to-source
        - Launched Explore agent to understand the full flow
        - Wrote a plan file but got an error (file not read first)
        - Then the conversation was interrupted for summary

     Key technical findings:
     - save_voice_samples in episodes.rs has two paths:
       - Sound bite path: uses ffmpeg to extract audio clip, saves to sound_bites/{name}/
       - Speaker path: only calls voice_library.py add (embedding only, NO audio file saved)
     - This is why "Voice ID (4x)" shows 4 clips trained but 0 audio files for speakers
     - The voice_samples DB table doesn't exist yet - need to create it
     - Need rating system and episode source tracking

     Summary:
     1. Primary Request and Intent:
        The user initially requested implementation of an "Audio Identification Panel Redesign" plan that includes:
        - Renaming the "Speakers" tab to "Audio ID" with new icon
        - Adding backend commands `get_voice_samples` and `delete_voice_sample`
        - Rewriting SpeakersPanel.jsx with expandable rows, two sections (Speakers/Sound Bites), lazy sample loading, per-sample play/delete
        - Separating speakers from sound bites (like "Intro")

        After initial implementation, the user identified several issues:
        - Badge showing "4 samples" was misleading (it's embedding count, not files)
        - Loaders should use the ice cream cone animation from TranscriptEditor, not generic spinners
        - Sample was saved but not visible in Audio ID panel
        - **Most recent request**: All 4 clips trained into a voice print should be accessible as playable files in Audio ID. Wants a rating system for clip quality. Wants
     ability to jump to where a clip was saved from (episode + timestamp).

     2. Key Technical Concepts:
        - **Tauri v2 IPC**: Rust backend commands invoked via `@tauri-apps/api/core` invoke()
        - **Voice Library architecture**: `embeddings.json` stores averaged voice embeddings with `sample_count` (times averaged, NOT file count). `sample_file` references
     source episode filename, not a stored clip.
        - **Two save paths in save_voice_samples**: Sound bites extract audio via ffmpeg to `sound_bites/{name}/`. Speakers only call `voice_library.py add` which updates
     embedding but saves NO audio file.
        - **Database**: SQLite via rusqlite with `init_schema()` pattern using `CREATE TABLE IF NOT EXISTS` and ALTER TABLE migrations
        - **React frontend**: Services layer with `tauri.js` (direct IPC) and `api.js` (Tauri/HTTP facade)
        - **File naming convention**: `ep{episode_id}_{start:.0}s-{end:.0}s.wav`
        - **Ice cream cone loader**: Neapolitan scoops dropping into cone animation, established pattern in TranscriptEditor.jsx

     3. Files and Code Sections:

        - **`src-tauri/src/commands/speakers.rs`** — Core file for voice sample commands
          - Added `VoiceSampleFile` struct (renamed from VoiceSample to avoid conflict with episodes.rs)
          - Added `get_voice_samples(speaker_name)` — scans `samples/` and `sound_bites/{clean_name}/` for audio files
          - Added `delete_voice_sample(speaker_name, file_path)` — validates path within voice_library/, deletes file
          - Added `count_audio_files_for()` helper for filesystem scanning
          - Added `file_count` field to `VoiceLibrarySpeaker` struct
          - Updated `get_voice_library()` to populate `file_count` by scanning directories
          ```rust
          #[derive(Debug, Serialize)]
          pub struct VoiceSampleFile {
              pub file_path: String,
              pub file_name: String,
              pub file_size: u64,
              pub created: Option<String>,
          }

          #[derive(Debug, Serialize)]
          pub struct VoiceLibrarySpeaker {
              pub name: String,
              pub short_name: String,
              pub sample_count: i32,
              pub sample_file: Option<String>,
              pub file_count: i32,
          }
          ```

        - **`src-tauri/src/commands/episodes.rs`** (lines 1293-1410) — The save_voice_samples function
          - **Sound bite path** (lines 1335-1376): Uses ffmpeg to extract audio, saves to `sound_bites/{name}/`
          - **Speaker path** (lines 1377-1404): Only calls `voice_library.py add` — NO audio file extraction
          - This is the root cause: speaker clips are not saved as files
          ```rust
          // Sound bite path extracts audio:
          let output = std::process::Command::new("ffmpeg")
              .args(["-y", "-i", audio_path.as_str(),
                     "-ss", &format!("{:.3}", sample.start_time),
                     "-to", &format!("{:.3}", sample.end_time),
                     "-ar", "16000", "-ac", "1",
                     sample_path.to_str().unwrap()])
              .output()...

          // Speaker path only does embedding:
          let output = std::process::Command::new(&venv_python)
              .args([voice_library_script.to_str().unwrap(), "add",
                     &sample.speaker_name, audio_path.as_str(),
                     &format!("{:.3}", sample.start_time),
                     &format!("{:.3}", sample.end_time)])
              .output()...
          ```

        - **`src-tauri/src/lib.rs`** — Command registration
          - Added `commands::get_voice_samples` and `commands::delete_voice_sample` to invoke_handler

        - **`scripts/dashboard-react/src/services/tauri.js`** — Tauri IPC layer
          - Added `getVoiceSamples(speakerName)` and `deleteVoiceSample(speakerName, filePath)`

        - **`scripts/dashboard-react/src/services/api.js`** — API facade
          - Added `getVoiceSamples(speakerName)` and `deleteVoiceSample(speakerName, filePath)` with Tauri/fallback pattern

        - **`scripts/dashboard-react/src/App.jsx`** — Tab renamed
          - Changed `{ id: 'speakers', label: 'Speakers', icon: '👥' }` to `{ id: 'speakers', label: 'Audio ID', icon: '🎙️ ' }`

        - **`scripts/dashboard-react/src/components/SpeakersPanel.jsx`** — Full rewrite
          - `IceCreamLoader` component: Neapolitan scoops-into-cone animation
          - `MiniIceCreamLoader` component: 3 bouncing scoops for inline loading
          - Two sections: Speakers (hosts pinned top, sorted by episode count) and Sound Bites
          - Expandable rows with lazy sample loading via `get_voice_samples`
          - Per-sample play/delete controls
          - Badges: green "Voice ID (Nx)" for embedding count, yellow "N clips" for actual files
          - Green info bar showing "Voice print trained from N clips · Last source: {file}"
          - Unlinked entries at bottom with "Add as Speaker" action

        - **`src-tauri/src/database/mod.rs`** — Database schema reference
          - `episode_speakers` table has `diarization_label`, `speaker_id`, `audio_drop_id`
          - `get_audio_drop_for_label()` checks if a diarization label maps to a sound bite
          - `audio_drops` table with `reference_audio_path` column
          - No `voice_samples` table exists yet

        - **`src-tauri/src/database/models.rs`** — Struct definitions
          - Has patterns for FlaggedSegment, AudioDrop, EpisodeSpeakerAssignment etc.

        - **`scripts/voice_library/embeddings.json`** — Voice library data
          - Contains: Matt Donnelly (1 sample), Jacob Smith (2), Paul Mattingly (1), Mike Mills (1), Justin Robert Young (1), 🔊 Intro (4 samples)
          - `sample_count` = times embedding was averaged, `sample_file` = source episode filename

        - **TranscriptEditor.jsx ice cream loader** (lines 969-997) — Reference for loader animation
          ```jsx
          <div className="relative mx-auto mb-6 w-20 h-28">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-pink-400 shadow-md scoop-anim" style={{ animationDelay: '0s', zIndex: 3 }}></div>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-amber-100 shadow-md scoop-anim" style={{ animationDelay: '0.6s', zIndex: 2
     }}></div>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-amber-800 shadow-md scoop-anim" style={{ animationDelay: '1.2s', zIndex: 1
     }}></div>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2" style={{ width: 0, height: 0, borderLeft: '24px solid transparent', borderRight: '24px solid
     transparent', borderTop: '40px solid #d97706', zIndex: 4 }}></div>
          </div>
          ```

     4. Errors and Fixes:
        - **VoiceSample name collision**: `VoiceSample` struct existed in both `speakers.rs` (Serialize) and `episodes.rs` (Deserialize). Both modules use `pub use *` in
     `commands/mod.rs`. Fixed by renaming to `VoiceSampleFile` in speakers.rs.
        - **Badge showing misleading "4 samples"**: The `sample_count` from embeddings.json tracks embedding averaging count, not actual audio files. Fixed by changing badge
     text to "Voice ID (4x)" and adding separate `file_count` field that scans filesystem.
        - **Plan file write error**: Tried to Write plan file without reading it first. Got `File has not been read yet` error. This was at the very end of the conversation.
        - **User feedback on loaders**: User explicitly requested ice cream cone loaders be used everywhere, not generic spinners. Fixed by adding IceCreamLoader and
     MiniIceCreamLoader components.
        - **User feedback on sample visibility**: User saved a sample but couldn't see it in Audio ID. Investigation showed the save worked (confirmed via Tauri logs) but the
     collapsed row had no visual indicator of actual files. Fixed by adding `file_count` and yellow "N clips" badge.

     5. Problem Solving:
        - **Sample count vs file count**: Discovered that `sample_count` in embeddings.json means "times the embedding was averaged" not "number of audio files". Speakers have 0
      stored audio files (only embeddings). Sound bites store actual .wav files via ffmpeg extraction.
        - **Root cause of missing clips**: The `save_voice_samples` speaker path calls `voice_library.py add` which only creates/updates an embedding — it never saves the audio
     clip. Sound bite path correctly uses ffmpeg to extract audio. This is the fundamental issue the user identified in their last message.
        - **Transcript save flow**: `sample.speaker` = raw diarization label (e.g., "SPEAKER_01"), `sample.speakerName` = display name. `get_audio_drop_for_label()` correctly
     matches via `episode_speakers` table.

     6. All User Messages:
        - **Message 1**: "Implement the following plan: [detailed Audio Identification Panel Redesign plan with 7 sections covering backend commands, tab rename, SpeakersPanel
     rewrite, sample interaction design, API layer, and verification steps]"
        - **Message 2**: "these tags are not lining up 4 samples, did you remove the previos samples?, only intro has one be sayd there are 4, also it was not linked to where
     the sample was taken from. also the loader and all loders going forward should be the ice cream cone one like in the episode editor"
        - **Message 3**: "I just added intro to sample and it said it was saved it said but I didn't see it in audio ID?" [with screenshot showing transcript viewer with Intro
     segments and Properties panel showing 1 sample marked at Segment #19]
        - **Message 4**: "in Audio ID why can't I access the 4 clips here? all clips saved need to be accessed here. is there a way to have a rating to know if it is a good
     clip? also where is the feature to jump to where the clip is saved?" [with screenshot showing Sound Bites section expanded for Intro, showing "Voice ID (4x)" badge, "1
     clip" badge, green bar "Voice print trained from 4 clips", and only 1 audio file ep2213_94s-98s.wav]

     7. Pending Tasks:
        - **Save audio clips for speakers**: Modify `save_voice_samples` speaker path in `episodes.rs` to also extract audio via ffmpeg (same as sound bite path), saving to
     `samples/{Speaker_Name}/ep{id}_{start}s-{end}s.wav`
        - **Create `voice_samples` database table**: Track all clips with episode_id, speaker_name, segment_idx, start_time, end_time, file_path, rating
        - **Add rating system**: 1-5 star rating on each clip, persisted to DB, visible in expanded row
        - **Add jump-to-source**: Each clip shows source episode + timestamp, clickable to navigate to that episode at that timestamp
        - **Update `get_voice_samples`**: Return DB-backed data instead of filesystem-only scan
        - **New command `update_voice_sample_rating`**: Set rating on a voice sample
        - **API layer updates**: Add rating API method to tauri.js and api.js
        - **Frontend updates**: Star rating UI, source episode link in expanded sample rows

     8. Current Work:
        I was in **plan mode** designing the solution for the user's most recent request about making all clips accessible, adding rating, and jump-to-source. I had:
        - Entered plan mode
        - Launched an Explore agent that completed successfully with full analysis of the save flow
        - Attempted to write the plan file but got an error because I didn't read it first
        - The conversation was interrupted for summary at this point

     9. Optional Next Step:
        Read the existing plan file at `/Users/ryan/.claude/plans/distributed-booping-squid.md`, then write the final plan addressing the user's request: "in Audio ID why can't
     I access the 4 clips here? all clips saved need to be accessed here. is there a way to have a rating to know if it is a good clip? also where is the feature to jump to
     where the clip is saved?" — then call ExitPlanMode for approval, and implement:
        1. Add `voice_samples` DB table with rating field
        2. Fix `save_voice_samples` speaker path to extract audio via ffmpeg
        3. Add rating command and jump-to-source data
        4. Update SpeakersPanel.jsx with star ratings and source episode links

     If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at:
     /Users/ryan/.claude/projects/-Users-ryan-Desktop-Projects-ice-cream-social-app/0645969c-ac37-48bf-a2c7-687437542fe8.jsonl
     Please continue the conversation from where we left off without asking the user any further questions. Continue with the last task that you were asked to work on.
  ⎿  Referenced file src/components/SpeakersPanel.jsx
  ⎿  Read ../../src-tauri/src/commands/speakers.rs (396 lines)
  ⎿  Referenced file ../../../../../Library/Logs/com.icecreamsocial.app/Ice Cream Social.log
  ⎿  Read src/App.jsx (262 lines)
  ⎿  Referenced file src/services/api.js
  ⎿  Plan file referenced (~/.claude/plans/distributed-booping-squid.md)

∴ Thinking…

  Looking at the summary, I was in plan mode designing a solution for making all voice clips accessible, adding ratings, and jump-to-source. I need to write the plan and get
  approval. Let me read the current plan file first, then write the updated plan.

                                                                                                                                                 03:04 PM claude-opus-4-6
⏺ I was in plan mode designing the solution for making all voice clips accessible, adding ratings, and jump-to-source. Let me read the current plan file and write the updated
  plan.

## Session: February 19, 2026

   Session Plan: Remaining Work + Web Goal                                                                                                                                       │
│                                                                                                                                                                               │
│ Context                                                                                                                                                                       │
│                                                                                                                                                                               │
│ Picking up from Feb 18 session (melodic-strolling-matsumoto) and the exception.md bug log.                                                                                    │
│ Three things to address today:                                                                                                                                                │
│ 1. Outstanding exceptions (bugs/UX)                                                                                                                                           │
│ 2. Remaining capabilities audit items                                                                                                                                         │
│ 3. MCP clarification + new "Operation Feed the Scoops" web goal                                                                                                               │
│                                                                                                                                                                               │
│ ---                                                                                                                                                                           │
│ What Was Completed (Feb 18)                                                                                                                                                   │
│                                                                                                                                                                               │
│ From the capabilities audit:                                                                                                                                                  │
│ - P1 ✅ Typed Error Hierarchy (src-tauri/src/error.rs)                                                                                                                        │
│ - P2 ✅ FTS Auto-Index after pipeline (index_episode_from_file, fires in worker/update_speaker_names/save_transcript_edits)                                                   │
│ - P7 ✅ Stale-Request Protection for Search (useSearch hook in SearchPanel.jsx)                                                                                               │
│                                                                                                                                                                               │
│ From exception.md (from git commits):                                                                                                                                         │
│ - ✅ Item 5: Renamed "audio sample" → "Audio ID"                                                                                                                              │
│ - ✅ Item 6c: Added text label to "Jump to Source" button                                                                                                                     │
│ - ✅ Item 6e / Item 11: Delete sound bite button added                                                                                                                        │
│ - ✅ Item 8 (partial): flag picker without prompt(), new speaker in editor, inline speaker form                                                                               │
│ - ✅ Item 9iii: Search results jump to segment                                                                                                                                │
│                                                                                                                                                                               │
│ ---                                                                                                                                                                           │
│ Still Outstanding: Exception.md Bugs                                                                                                                                          │
│                                                                                                                                                                               │
│ High Priority (Core functionality broken)                                                                                                                                     │
│                                                                                                                                                                               │
│ #: 1                                                                                                                                                                          │
│ Issue: Flag segment bugs — "Other" flag button not working, "Wrong Speaker" flag broken, can't flag intro properly, multiple-speakers selection doesn't allow adding new      │
│ speaker                                                                                                                                                                       │
│ Notes: Blocking good diarization feedback loop                                                                                                                                │
│ ────────────────────────────────────────                                                                                                                                      │
│ #: 2                                                                                                                                                                          │
│ Issue: Reprocess diarization — No indication it goes into queue when clicked                                                                                                  │
│ Notes: Confusing UX                                                                                                                                                           │
│ ────────────────────────────────────────                                                                                                                                      │
│ #: 6a                                                                                                                                                                         │
│ Issue: Add as Speaker button jumps UI to "Add New Speaker" area instead of appearing below the card                                                                           │
│ Notes: Disorienting                                                                                                                                                           │
│ ────────────────────────────────────────                                                                                                                                      │
│ #: 6d                                                                                                                                                                         │
│ Issue: Jump to Source timestamp — Goes to right episode but audio player doesn't seek to correct time                                                                         │
│ Notes: Broken feature                                                                                                                                                         │
│ ────────────────────────────────────────                                                                                                                                      │
│ #: 7                                                                                                                                                                          │
│ Issue: Duplicate speakers (e.g., 2x "Jacob Smith" in ep 1288), only 5 colors for speaker tags                                                                                 │
│ Notes: Data/display bug                                                                                                                                                       │
│                                                                                                                                                                               │
│ Medium Priority (UX friction)                                                                                                                                                 │
│                                                                                                                                                                               │
│ ┌─────┬────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┬───────────────────┐                          │
│ │  #  │                                                         Issue                                                          │       Notes       │                          │
│ ├─────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┤                          │
│ │ 3   │ Stats tab: add "## In Queue to Diarization" stat box alongside transcription queue count                               │ Visibility        │                          │
│ ├─────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┤                          │
│ │ 4   │ Queue section: two collapsible/scrollable tables (transcribe queue + diarize queue), rename "Episode Tracking" section │ Organization      │                          │
│ ├─────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┤                          │
│ │ 8   │ Identity tooling: "+ New Speaker" textbox should appear in speaker section (not just sound bite section)               │ Workflow friction │                          │
│ ├─────┼────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────┤                          │
│ │ 10  │ Chapter labeling: settings page with rules to auto-label chapters from transcript text                                 │ New feature       │                          │
│ └─────┴────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┴───────────────────┘                          │
│                                                                                                                                                                               │
│ ---                                                                                                                                                                           │
│ Still Outstanding: Capabilities Audit (melodic-strolling-matsumoto)                                                                                                           │
│                                                                                                                                                                               │
│ Architectural Patterns Remaining                                                                                                                                              │
│                                                                                                                                                                               │
│ ┌─────┬───────────────────────────────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────┐                  │
│ │  #  │                                            Pattern                                            │                      Priority                      │                  │
│ ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────┤                  │
│ │ P3  │ React Context + Error Boundaries — refactor TranscriptReviewLayout's 14 useState declarations │ Medium                                             │                  │
│ ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────┤                  │
│ │ P4  │ Exponential Backoff + Circuit Breaker for downloads                                           │ Low                                                │                  │
│ ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────┤                  │
│ │ P5  │ sqlite-vec Semantic Search — embeddings in DB, acoustic similarity                            │ Low (big lift)                                     │                  │
│ ├─────┼───────────────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────┤                  │
│ │ P6  │ Diarization Hints from Human Corrections — use flagged_segments to improve reprocessing       │ Medium (depends on item 1 flags being fixed first) │                  │
│ └─────┴───────────────────────────────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────┘                  │
│                                                                                                                                                                               │
│ Subagents (Section 2) — All 5 Not Started                                                                                                                                     │
│                                                                                                                                                                               │
│ These are Rust/scheduled background jobs that run automatically:                                                                                                              │
│ - S1: Transcript Quality Agent (flag inconsistencies)                                                                                                                         │
│ - S2: Content Extraction Coordinator (batch character/trivia extraction)                                                                                                      │
│ - S3: Wiki Sync Agent                                                                                                                                                         │
│ - S4: Diarization Hints Generator (feeds into P6)                                                                                                                             │
│ - S5: Codebase Guard (pre-commit review)                                                                                                                                      │
│                                                                                                                                                                               │
│ Features Not Started                                                                                                                                                          │
│                                                                                                                                                                               │
│ - F2: Bulk Wiki Sync + Jock/Nerd trivia extraction                                                                                                                            │
│ - F3: sqlite-vec Speaker Deduplication (would fix duplicate Jacob Smith problem)                                                                                              │
│                                                                                                                                                                               │
│ ---                                                                                                                                                                           │
│ MCP Clarification: Why It Helps Without Making the App Depend on AI                                                                                                           │
│                                                                                                                                                                               │
│ The plan suggested these MCP servers for my use during coding sessions only — not for the app's runtime:                                                                      │
│                                                                                                                                                                               │
│ ┌─────────────────────────────────────────┬───────────────────────────────────────────────────────────────┬──────────────────────────────────────────────┐                    │
│ │               MCP Server                │                    What It Does for Coding                    │                  App Impact                  │                    │
│ ├─────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤                    │
│ │ @modelcontextprotocol/server-sqlite     │ Lets me query your DB directly during planning                │ Zero — I just read/inspect, don't add to app │                    │
│ ├─────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤                    │
│ │ @modelcontextprotocol/server-filesystem │ Lets me read project files faster without explicit Read calls │ Zero — dev tooling only                      │                    │
│ ├─────────────────────────────────────────┼───────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤                    │
│ │ @modelcontextprotocol/server-memory     │ Already installed — persistent knowledge graph                │ Zero — already in use                        │                    │
│ └─────────────────────────────────────────┴───────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┘                    │
│                                                                                                                                                                               │
│ Bottom line: MCP is like giving me better tools to work with your codebase. The app itself stays entirely local, native, and subscription-AI-free. Whisper still runs         │
│ offline, the pipeline is still Rust/SQLite. MCP doesn't touch any of that.                                                                                                    │
│                                                                                                                                                                               │
│ The sqlite MCP server would be the most useful — it means when you report a bug like "2 Jacob Smith in ep 1288" I could directly query the DB to investigate instead of       │
│ asking you to run queries.                                                                                                                                                    │
│                                                                                                                                                                               │
│ ---                                                                                                                                                                           │
│ New Goal: Operation Feed the Scoops (Web Version)                                                                                                                             │
│                                                                                                                                                                               │
│ Vision: Once the local app is solid, open it up so other Scoops fans can use it.                                                                                              │
│                                                                                                                                                                               │
│ You're creating feedTheScoops.md to track this. Key questions to answer there:                                                                                                │
│ - Self-hosted (VPS) vs. managed hosting?                                                                                                                                      │
│ - Auth: Patreon OAuth (only subscribers get access)?                                                                                                                          │
│ - Data sync: Does the local Tauri app become the "ingest server" and the web app reads a shared DB?                                                                           │
│ - What features go to web first? (Search is the obvious first win)                                                                                                            │
│                                                                                                                                                                               │
│ This doesn't need to be planned now — it's a flag-in-the-ground for after the current local app is solid.                                                                     │
│                                                                                                                                                                               │
│ ---                                                                                                                                                                           │
│ Recommended Work Order for This Session                                                                                                                                       │
│                                                                                                                                                                               │
│ 1. Fix broken flags (exception item 1) — gates diarization hint feedback loop                                                                                                 │
│ 2. Fix reprocess diarization queue indication (item 2) + add diarization queue stats (item 3)                                                                                 │
│ 3. Fix Jump to Source timestamp (item 6d)                                                                                                                                     │
│ 4. Fix duplicate speakers + more colors (item 7)                                                                                                                              │
│ 5. Queue tables redesign (item 4)                                                                                                                                             │
│ 6. P6: Diarization Hints — now flags are fixed, hints can actually be generated                                                                                               │
│ 7. Chapter labeling (item 10) — new settings feature                                                                                                                          │
│                                                                                                                                                                               │
│ MCP sqlite server install is quick and worth doing at start of session for better debugging.                                                                                  │
│                                                                                                                                                                               │
│ ---                                                                                                                                                                           │
│ Files Most Likely Touched                                                                                                                                                     │
│                                                                                                                                                                               │
│ - src-tauri/src/commands/speakers.rs — duplicate dedup, color expansion                                                                                                       │
│ - src-tauri/src/commands/episodes.rs — reprocess queue indication                                                                                                             │
│ - src-tauri/src/commands/stats.rs — diarization queue stat                                                                                                                    │
│ - src-tauri/src/database/mod.rs — diarization hints, queue queries                                                                                                            │
│ - scripts/dashboard-react/src/components/SpeakersPanel.jsx — Add as Speaker jump fix                                                                                          │
│ - scripts/dashboard-react/src/components/TranscriptSegment.jsx — flag bugs                                                                                                    │
│ - scripts/dashboard-react/src/components/StatsTab.jsx — queue stats display                                                                                                   │
│ - scripts/dashboard-react/src/components/AudioPlayer.jsx — timestamp seek fix

---

## Session: February 19, 2026

### Tasks Completed

**Exception.md Bug Fixes (from prior session + this session)**

- ✅ **Item 1 — Flag segment bugs** (TranscriptEditor.jsx):
  - `character_voice` flag: Added `needsCharacter` branch in onClick + `flag-character` sub-picker with character list and "+ New character..." input + Back button
  - `wrong_speaker` flag: Added explicit Save button (not just Enter key)
  - `other` flag: Added explicit Save button
  - `multiple_speakers` picker: Added text input + Add button for unlisted speaker names; chips to show/remove custom-added names
- ✅ **Item 6d — Jump to Source audio seek** (TranscriptModal.jsx):
  - Fixed cached-audio race condition: added `useEffect` that checks `audio.readyState >= 1` immediately, otherwise attaches one-time `loadedmetadata` listener
- ✅ **Item 7 — Duplicate speakers + more colors** (TranscriptEditor.jsx, PropertiesPanel.jsx):
  - Replaced 6-entry `SPEAKER_COLORS` dict with 12-color `SPEAKER_COLOR_PALETTE` array + modulo-based `getSpeakerColor` in both files
  - PropertiesPanel: Added `deduplicatedSpeakers` filter (deduplicates by display name) + changed `speakerCount` and render loop to use it
- ✅ **Item 8 — Identity tooling friction** (TranscriptEditor.jsx):
  - Speaker picker's "Assign to sound bite" section now always visible (not conditional on existing drops)
  - Added `+ New sound bite...` input to speaker picker (calls new `createDropAndAssign()` helper)
  - Existing `+ New speaker...` input was already in the speaker picker

**Confirmed Already Done (no changes needed)**
- Items 2, 3, 4 from exception.md (reprocess diarization UX, diarization queue stat, two-table queue section) — already in Stats.jsx
- Item 6a (Add as Speaker inline form) — already fixed with `inlineAddSpeaker` state in SpeakersPanel.jsx

### Current State
- All React changes build cleanly (`npm run build` passes)
- Flag system fully wired up: wrong_speaker, character_voice, multiple_speakers, audio_issue, other all have working pickers
- Speaker color palette extended to 12 colors with modulo wrapping
- Duplicate speaker deduplication active in PropertiesPanel

### Remaining from Plan
- P3: React Context + Error Boundaries for TranscriptReviewLayout (14 useState declarations)
- P6: Diarization Hints from Human Corrections (flagged_segments → diarization reprocessing hints)
- Item 10: Chapter labeling settings page with auto-label rules
- Subagents S1-S5: Not started

ompleted fixes:                                                                                                                                                               
                                                                                                                                                                                 
  1. Item 7 (duplicate speakers) — final step: Changed PropertiesPanel.jsx speaker render loop to use deduplicatedSpeakers (was already filtered, just not used in the map). Two 
  "Jacob Smith" labels now show as one.                                                                                                                                          
  2. Item 8 (identity tooling friction): In the pickerType === 'speaker' picker inside TranscriptEditor, the "Assign to sound bite" section now:
    - Always shows (was previously hidden when no drops existed)
    - Has a + New sound bite... text input that creates a drop and immediately assigns it to the speaker label via a new createDropAndAssign() helper
    - The existing + New speaker... input was already there

  Prior session work (carried over, already done):
  - Item 1 flags: character_voice, wrong_speaker, other, multiple_speakers all fixed
  - Item 6d: Jump to Source audio seek fixed for cached audio
  - Items 2/3/4: Already done in Stats.jsx
  - Speaker color palette expanded to 12 colors

  Still remaining from the plan: P6 (diarization hints), P3 (React context refactor), item 10 (chapter labeling), and subagents S1-S5.
  
  ## Session: February 20, 2026

### Tasks Completed

  All done. Here's what was completed:

  P3 (React Context refactor) — already done in the previous session; marked complete.

  S1–S4 (Rust subagent schedulers)
  - src-tauri/src/worker/subagents.rs — new file with 4 scheduler functions:
    - S1 quality_scan_agent — every 6 hrs, counts unresolved SPEAKER_XX labels + unindexed completed episodes, emits quality_alert
    - S2 extraction_coordinator_agent — every 2 hrs, surfaces episodes awaiting LLM extraction, emits extraction_queued
    - S3 wiki_sync_agent — daily at 3 AM, emits wiki_sync_ready (wiki sync is user-initiated via HTTP)
    - S4 hints_prefetch_agent — every hour, pre-generates {episode_id}_hints.json for episodes with unresolved speaker flags
  - 4 new DB methods added to database/mod.rs: count_unresolved_speaker_labels, count_unindexed_completed_episodes, get_unextracted_episode_ids, get_episodes_with_unresolved_speaker_flags
  - worker/mod.rs — added pub mod subagents;
  - lib.rs — 4 new tauri::async_runtime::spawn calls after the feed sync scheduler

  S5 (git pre-commit hook)
  - scripts/pre-commit — runs cargo fmt --check + cargo clippy when Rust files are staged; npm run build when React files are staged
  - scripts/install-hooks.sh — copies hook to .git/hooks/pre-commit and makes it executable

  Pipeline Errors close button — added an × button in the "Recent Pipeline Errors" header that hides the section for the current session.



  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Plan: Qwen2.5-Omni-3B for Character & Performance Bit Classification                                                                                                                                          
                                                                                                                                                                                                               
 Context                                                                                                                                                                                                       
                                                                                                                                                                                                               
 Pyannote diarizes purely by acoustic fingerprinting — when a host does a character voice or                                                                                                                   
 silly bit, it can create a phantom new speaker (SPEAKER_03) instead of keeping it as SPEAKER_00.                                                                                                              
 Qwen2.5-Omni-3B reasons about BOTH voice characteristics AND spoken content simultaneously,                                                                                                                   
 so it can recognize "the host is just doing a bit" and flag is_performance_bit: true while
 keeping the speaker ID consistent. The model is already downloaded to ~/.cache/huggingface                                                                                                                    
 and there's a working test harness in scripts/qwen_inference.py to build from.                                                                                                                                
                                                                                                                                                                                                               
 Since the model is slow (~13x realtime including load), this runs targeted on specific                                                                                                                        
 flagged/suspected segments — not full episodes. Output goes to a review panel for human                                                                                                                       
 approval before touching the database.

 ---
 Files to Create / Modify

 ┌───────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────┐
 │                               File                                │                                         Action                                         │
 ├───────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
 │ scripts/qwen_classify_segments.py                                 │ Create — new classification script                                                     │
 ├───────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
 │ src-tauri/src/database/mod.rs                                     │ Modify — add segment_classifications table + is_performance_bit to transcript_segments │
 ├───────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
 │ src-tauri/src/database/models.rs                                  │ Modify — add SegmentClassification struct                                              │
 ├───────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
 │ src-tauri/src/commands/content.rs                                 │ Modify — add run_qwen_classification command                                           │
 ├───────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
 │ src-tauri/src/lib.rs                                              │ Modify — register new command                                                          │
 ├───────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
 │ scripts/dashboard-react/src/services/tauri.js                     │ Modify — add runQwenClassification, getSegmentClassifications, approveClassification   │
 ├───────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
 │ scripts/dashboard-react/src/services/api.js                       │ Modify — add wrappers                                                                  │
 ├───────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────┤
 │ scripts/dashboard-react/src/components/TranscriptReviewLayout.jsx │ Modify — add "Analyze" button + classification review panel                            │
 └───────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────┘

 ---
 Step 1: Python Script — scripts/qwen_classify_segments.py

 Adapted from qwen_inference.py. Key differences:
 - Accepts a list of target segments (not a full file)
 - Extracts a 60s audio window around each segment using librosa slice (already in venv)
 - Accepts --characters JSON string listing known character names + catchphrases (context for the model)
 - Processes all segments in one model load (amortize the ~60s load time)
 - Emits QWEN_PROGRESS: N lines to stdout (same pattern as speaker_diarization.py)
 - Final output: single JSON object to stdout

 CLI signature:
 python qwen_classify_segments.py \
   --audio-file scripts/episodes/episode.mp3 \
   --segments '[{"segment_idx":42,"start":304.2,"end":318.7}, ...]' \
   --characters '[{"name":"Sweet Bean","catchphrase":"Sweet Bean!"},...]'

 Output JSON (stdout after all QWEN_PROGRESS lines):
 {
   "status": "success",
   "results": [
     {
       "segment_idx": 42,
       "is_performance_bit": true,
       "character_name": "Sweet Bean",
       "speaker_note": "Host doing exaggerated high-pitched character voice",
       "tone_description": "Comic, exaggerated, high-pitched",
       "confidence": 0.87
     }
   ],
   "elapsed_secs": 124.3
 }

 Prompt template sent to Qwen per clip:
 "Listen to this audio clip. Known recurring characters: {character_list}.
 Determine: (1) Is the speaker doing a performance bit or character voice?
 (2) If so, which character are they voicing (if any from the list)?
 (3) Note: keep the speaker ID consistent — a host doing a funny voice is still the same speaker.
 Respond only in JSON: {is_performance_bit, character_name, speaker_note, tone_description, confidence}"

 ---
 Step 2: Database Changes

 New column on transcript_segments

 ALTER TABLE transcript_segments ADD COLUMN is_performance_bit INTEGER DEFAULT 0;
 Written on approval, not during classification.

 New table segment_classifications

 CREATE TABLE segment_classifications (
     id INTEGER PRIMARY KEY,
     episode_id INTEGER NOT NULL,
     segment_idx INTEGER NOT NULL,
     classifier TEXT NOT NULL DEFAULT 'qwen_omni',
     is_performance_bit INTEGER DEFAULT 0,
     character_name TEXT,
     character_id INTEGER,          -- Matched to characters table (if found)
     speaker_note TEXT,
     tone_description TEXT,
     confidence REAL,
     approved INTEGER DEFAULT 0,   -- 0=pending, 1=approved, -1=rejected
     created_at TEXT,
     FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
     FOREIGN KEY (character_id) REFERENCES characters(id)
 );

 Add to init_schema() in src-tauri/src/database/mod.rs.

 New DB methods needed (in mod.rs)

 - save_segment_classifications(episode_id, results: Vec<...>)
 - get_segment_classifications(episode_id) → Vec<SegmentClassification>
 - approve_segment_classification(id) → updates approved=1, sets transcript_segments.is_performance_bit=1, optionally creates character_appearances entry
 - reject_segment_classification(id) → sets approved=-1

 ---
 Step 3: New Tauri Command — run_qwen_classification

 Location: src-tauri/src/commands/content.rs

 #[tauri::command]
 pub async fn run_qwen_classification(
     db: State<'_, Arc<Database>>,
     app: AppHandle,
     episode_id: i64,
     segment_indices: Vec<i32>,   // Which segments to analyze
 ) -> Result<(), AppError>

 Logic:
 1. Fetch episode audio path from DB (error if not downloaded)
 2. Fetch segments (start/end times) for the given indices from transcript_segments
 3. Fetch all characters from characters table for context prompt
 4. Spawn Python subprocess: venv/bin/python3 scripts/qwen_classify_segments.py ...
   - Pattern from src-tauri/src/worker/diarize.rs: piped stdout, emit progress events
 5. Parse QWEN_PROGRESS: N lines → emit qwen_progress Tauri event
 6. Parse final JSON from stdout
 7. Match character_name results against characters table (fuzzy match on name)
 8. Call db.save_segment_classifications(...) with pending status
 9. Emit qwen_complete event

 Register in src-tauri/src/lib.rs invoke handler.

 ---
 Step 4: Frontend — Review UI

 In TranscriptReviewLayout.jsx:

 Add "Analyze with Qwen" button in the episode toolbar (near existing FTS/chapter buttons).
 - Clicking opens a segment selector: "Analyze all flagged segments" or "Analyze selected"
 - Shows a progress bar while running (listening for qwen_progress event)
 - On qwen_complete, shows the classifications panel

 Classifications Panel (inline below toolbar or slide-in):
 - Cards per result showing: segment text, timestamp, is_performance_bit badge, character name, confidence bar, speaker note
 - Each card: ✓ Approve / ✗ Reject buttons
 - "Approve All" bulk action
 - On approve: calls approve_segment_classification(id) → writes to DB
   - If character identified: also creates a character_appearance entry

 ---
 Step 5: Chapter Identification (Deferred)

 Qwen can help here too (audio reasoning for detecting "we're now doing Scoop Mail" by tone +
 content) but this should be v2 — chapter detection works reasonably well with the existing
 text-based Ollama extraction. Add after character flow is validated.

 ---
 Verification

 1. Run cargo tauri dev — confirm no compile errors
 2. Open an episode with transcribed + downloaded audio
 3. Click "Analyze with Qwen" on 2-3 flagged segments
 4. Confirm progress events fire (progress bar moves)
 5. Review panel appears with results
 6. Approve one result — verify:
   - segment_classifications.approved = 1
   - transcript_segments.is_performance_bit = 1 for that segment_idx
   - If character matched: character_appearances row created
 7. Confirm rejected results have approved = -1 and nothing written to transcript_segments
 ~/.claude/plans/validated-yawning-elephant.md