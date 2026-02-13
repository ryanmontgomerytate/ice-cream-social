# Development Sessions Log

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