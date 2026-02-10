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