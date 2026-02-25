# Development Sessions Log

## Session: February 23, 2026

### Exception 1b — Character Episode Appearances in Characters Tab

**Goal**: Show which episodes each character appears in directly from Characters tab.

**Changes**:
- Added Rust command + DB query for `get_character_appearances_for_character`
- Registered new Tauri command in invoke handler
- Added frontend API wrappers for character appearance lookup
- Characters tab now supports expand/collapse episode list with timestamps and “Open” links

**Files modified**:
- `src-tauri/src/database/mod.rs`
- `src-tauri/src/commands/content.rs`
- `src-tauri/src/lib.rs`
- `scripts/dashboard-react/src/services/tauri.js`
- `scripts/dashboard-react/src/services/api.js`
- `scripts/dashboard-react/src/components/CharactersPanel.jsx`
- `scripts/dashboard-react/src/App.jsx`

**Current State**: Characters tab can expand per character to show episode appearances and open transcript modal at the relevant timestamp/segment.

### Exception Plan — P1 Remainders (2, 3a, 5, 6a, 7c, 8, 9b)

**Goal**: Complete remaining P1 items in `docs/EXCEPTION_PLAN.md`.

**Changes**:
- Added unassigned diarization labels to wrong-speaker picker
- Chapter picker now supports range selection with end-segment input
- Added saved micro-toast for immediate-save actions; added unsaved chip near Save button
- Added episode art thumbnail in transcript header with wiki fallback URL
- Rebuild voice prints now include sound bites during recalibration
- Chapter types are seeded if table is empty
- Deleting a voice sample triggers per-speaker rebuild with UI indicator

**Files modified**:
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`
- `scripts/dashboard-react/src/services/tauri.js`
- `scripts/dashboard-react/src/services/api.js`
- `src-tauri/src/commands/speakers.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/database/mod.rs`
- `scripts/voice_library.py`

**Current State**: Remaining P1 items implemented; no tests run yet.

### Exception Plan — P2 Items (1c, 5x, 6 AI, 7d, 9a)

**Goal**: Complete P2 architectural features in `docs/EXCEPTION_PLAN.md`.

**Changes**:
- Characters now link to speakers via `speaker_id` with UI selection and voiceprint rebuild
- Character voice flags now route diarization hints through linked speaker names
- Auto-create placeholder speakers (Speaker_XX) after diarization
- Auto-harvest voice samples per episode after diarization
- AI chapter detection command + UI review/apply flow
- Sponsor clip export from commercial chapters via ffmpeg (episode art + transcript bubble + sponsor overlay)

**Files modified**:
- `src-tauri/src/database/mod.rs`
- `src-tauri/src/database/models.rs`
- `src-tauri/src/commands/content.rs`
- `src-tauri/src/commands/episodes.rs`
- `src-tauri/src/worker/mod.rs`
- `src-tauri/src/lib.rs`
- `scripts/harvest_voice_samples.py`
- `scripts/dashboard-react/src/components/CharactersPanel.jsx`
- `scripts/dashboard-react/src/components/PropertiesPanel.jsx`
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`
- `scripts/dashboard-react/src/components/TranscriptModal.jsx`
- `scripts/dashboard-react/src/services/tauri.js`
- `scripts/dashboard-react/src/services/api.js`
- `src-tauri/src/database/tests.rs`
- `docs/EXCEPTION_PLAN.md`

**Current State**: All P2 items implemented; no tests run yet.

**Update**: Fixed compile errors in `export_sponsor_clip` and updated character tests; ran `cargo test --package ice-cream-social --lib database::tests` (48 passed).

### Queue Resource Controls — Pause Transcribe vs Diarize Lanes

**Goal**: Add explicit queue pause controls so embedding/voice-library work can run without competing with active transcription/diarization scheduling.

**Changes**:
- Added worker runtime gates for `pause_transcribe_queue` and `pause_diarize_queue`
- Paused lanes now stop pulling new jobs while allowing in-flight jobs to finish
- Auto-transcribe polling now respects `pause_transcribe_queue`
- Added default app settings keys for both pause flags
- Added Settings UI toggles for "Pause Transcription Queue" and "Pause Diarization Queue"

**Files modified**:
- `src-tauri/src/worker/mod.rs`
- `src-tauri/src/database/mod.rs`
- `scripts/dashboard-react/src/components/SettingsPanel.jsx`

**Verification**:
- Ran `cargo check --manifest-path src-tauri/Cargo.toml` (pass)

**Current State**: You can independently pause transcribe and diarize scheduling from Settings to free resources for ECAPA/voice-library maintenance work.

### ECAPA Dual-Backend Integration — Voice Library + Compare Flow

**Goal**: Implement ECAPA-TDNN as a true second embedding backend alongside pyannote, with backend selection and side-by-side comparison in the Speakers workflow.

**Changes**:
- Reworked `voice_library.py` to support backend-isolated embedding stores (`embeddings_ecapa.json` and `embeddings_pyannote.json`)
- Added backend-aware CLI support (`--backend`) to add/remove/info/rebuild/rebuild-speaker/identify
- Added new `compare` subcommand in `voice_library.py` for side-by-side ECAPA vs pyannote confidence output
- Wired diarization pipeline to pass configured embedding backend into `speaker_diarization.py`
- Updated episode voice-sample save path to pass backend into `voice_library.py add`
- Updated voice-harvest and single-clip extraction scripts to accept backend and initialize `VoiceLibrary` accordingly
- Added new Tauri commands in speakers domain:
  - `get_embedding_model`
  - `set_embedding_model`
  - `compare_embedding_backends`
- Updated all speaker-related Rust subprocess calls (`info`, `rebuild`, `rebuild-speaker`, `remove`, harvest, extract-clip) to pass backend
- Added SpeakersPanel backend selector UI + comparison modal/table
- Added frontend service wrappers for embedding model get/set and backend compare command
- Added default DB setting `embedding_model = pyannote`

**Files modified**:
- `scripts/voice_library.py`
- `scripts/speaker_diarization.py`
- `scripts/extract_voice_sample.py`
- `scripts/harvest_voice_samples.py`
- `src-tauri/src/worker/diarize.rs`
- `src-tauri/src/commands/episodes.rs`
- `src-tauri/src/commands/speakers.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/database/mod.rs`
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`
- `scripts/dashboard-react/src/services/tauri.js`
- `scripts/dashboard-react/src/services/api.js`

**Verification**:
- `python3 -m py_compile scripts/voice_library.py scripts/speaker_diarization.py scripts/extract_voice_sample.py scripts/harvest_voice_samples.py` (pass)
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: ECAPA and pyannote now operate as switchable backend processes for voice embeddings, and Speakers panel can run direct side-by-side backend comparison on diarized episodes.

### UX Adjustment — Move Embedding Backend Controls To Settings

**Goal**: Move ECAPA/pyannote controls out of Audio Identification and into Settings, matching the model-selection control style.

**Changes**:
- Removed embedding backend selector and compare modal from `SpeakersPanel`
- Added "Voice Embedding Backend" section in Settings with backend dropdown
- Added "Compare Embedding Backends" section in Settings with diarized-episode picker and compare results table
- Settings now loads current embedding backend via `get_embedding_model`

**Files modified**:
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`
- `scripts/dashboard-react/src/components/SettingsPanel.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)

**Current State**: Embedding backend selection + compare workflow now live under Settings instead of Audio Identification.

### Option 3 — Pipeline Identifier Badges In Stats + Recently Completed

**Goal**: Add clear model/pipeline identifiers in active stats and recently completed views.

**Changes**:
- Added durable episode-level pipeline identity storage on completion:
  - `episodes.transcription_model_used`
  - `episodes.embedding_backend_used`
- Worker now persists pipeline identity when finishing an episode
- Worker status API now includes current `embedding_model` in `worker_info`
- Added Current Activity badges for active pipeline identity (ASR model + embedding backend)
- Added Pipeline Stats identity card and Recently Completed table pipeline badges per episode

**Files modified**:
- `src-tauri/src/database/mod.rs`
- `src-tauri/src/worker/mod.rs`
- `src-tauri/src/commands/worker.rs`
- `scripts/dashboard-react/src/components/CurrentActivity.jsx`
- `scripts/dashboard-react/src/components/PipelineStats.jsx`
- `scripts/dashboard-react/src/App.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Stats now shows active pipeline identity while processing and records per-episode pipeline identity in Recently Completed rows.

### UX Adjustment — Pipeline Identity Badges In Blue Header Card

**Goal**: Place ASR/embedding identity where it is most visible during processing by moving badges into the blue Processing Pipeline card header.

**Changes**:
- Moved `ASR` + `Embed` badges into `CurrentActivity` blue gradient header and centered them
- Removed duplicate identity badge rows from the inner idle/processing body sections to reduce clutter
- Kept per-slot badges on transcribing/diarizing cards for stage-level visibility

**Files modified**:
- `scripts/dashboard-react/src/components/CurrentActivity.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Pipeline identity is now shown directly in the blue Processing Pipeline header, centered and always visible while the card is displayed.

### Reprocess UX + Scheduling — Per-Episode Backend And Priority Lane

**Goal**: Make ECAPA reprocess smoother from the episode view by selecting backend at reprocess time and running that episode before normal queued transcription starts.

**Changes**:
- Added reprocess backend selector in Transcript Editor (`current`, `pyannote`, `ecapa-tdnn`) next to the reprocess button
- Updated reprocess API path to pass `embeddingBackend` + `prioritizeTop` options to backend
- Extended `reprocess_diarization` command to accept optional backend override and top-priority scheduling
- Added queue-level `embedding_backend_override` column and DB support for per-episode diarization backend override
- Priority reprocess now uses high queue priority (`10000`) and enables `priority_reprocess_mode`
- While priority mode is active, `pause_transcribe_queue` is forced on (current transcribe can finish, but no new transcribe starts)
- Worker now auto-resumes transcribe queue when priority diarize-only items are cleared, restoring prior pause state
- Worker diarize jobs now consume per-episode backend override when present

**Files modified**:
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`
- `scripts/dashboard-react/src/services/tauri.js`
- `scripts/dashboard-react/src/services/api.js`
- `src-tauri/src/commands/episodes.rs`
- `src-tauri/src/database/mod.rs`
- `src-tauri/src/worker/mod.rs`
- `src-tauri/src/worker/diarize.rs`
- `ARCHITECTURE.md`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Reprocess now supports per-episode backend selection and is promoted into a priority diarization lane that runs before the next queued transcription starts, then automatically returns to normal queue behavior.

### Stats Fidelity Fix — Show Actual Active Backend/Model Per Slot

**Goal**: Ensure Stats/Current Activity reflects what is actually running (including reprocess backend overrides), not only global settings.

**Changes**:
- Added per-slot identity in worker state/status:
  - `transcription_model`
  - `embedding_backend`
- Worker now stamps these values on each active pipeline entry and carries them through slot sync
- `CurrentActivity` slot badges now read slot-level identity first (fallback to worker defaults)
- Blue header pipeline identity now summarizes active slots and shows `mixed (...)` when slots use different backends/models
- Updated worker status `worker_info.model` to read current DB `transcription_model` setting (instead of stale startup value)
- Added diarization queue visibility for reprocess intent in Stats queue table:
  - `Embed: <backend>` badge for per-episode override
  - `Priority` badge for top-priority reprocess items
- Extended queue list payload with `embedding_backend_override` and `priority`

**Files modified**:
- `src-tauri/src/worker/mod.rs`
- `src-tauri/src/commands/worker.rs`
- `src-tauri/src/database/mod.rs`
- `src-tauri/src/commands/stats.rs`
- `scripts/dashboard-react/src/components/CurrentActivity.jsx`
- `scripts/dashboard-react/src/components/Stats.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Stats now shows the actual active pipeline identity per slot and surfaces diarization queue override/priority markers so reprocess behavior is visible and auditable in UI.

### Reprocess Policy Update — Keep Transcribe Running By Default

**Goal**: Preserve top-priority diarization reprocess behavior while allowing normal transcription throughput unless explicitly configured otherwise.

**Changes**:
- Added new setting default:
  - `priority_reprocess_pause_transcribe = false`
- Updated `reprocess_diarization` behavior:
  - Priority reprocess still queues at top
  - Auto-pause of transcription queue now happens only when `priority_reprocess_pause_transcribe` is enabled
- Added Settings toggle:
  - "Pause Transcribe During Priority Reprocess"
  - OFF = concurrent transcribe + diarize (new default)
  - ON = temporarily pause new transcribe starts during top-priority reprocess

**Files modified**:
- `src-tauri/src/database/mod.rs`
- `src-tauri/src/commands/episodes.rs`
- `scripts/dashboard-react/src/components/SettingsPanel.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Priority reprocess remains first in diarization order, and transcription continues concurrently by default unless you enable the pause-on-reprocess setting.

### UX + Stats Cleanup — Episode-Local Compare + Reprocess Visibility

**Goal**: Improve compare/reprocess workflow usability and ensure Recently Completed reflects diarization-only reprocess runs.

**Changes**:
- Removed Settings-level "Compare Embedding Backends" episode dropdown workflow
- Added episode-local backend compare in Transcript Editor:
  - `Compare Backends` button appears on transcribed+diarized episodes
  - Inline compare results table shown directly in episode header controls
- Unified reprocess backend selector + reprocess action into a single grouped control for clearer UX
- Updated reprocess success message to avoid implying transcription is paused
- Fixed Recently Completed query to include diarization-only runs (not only rows with `transcribe_duration`)
- Added `last_queue_type` to recently completed payload and UI
- Recently Completed now:
  - shows `-` in Transcribe column for diarize-only reprocess rows
  - adds `Reprocess` badge in Pipeline column when last run queue type is `diarize_only`

**Files modified**:
- `scripts/dashboard-react/src/components/SettingsPanel.jsx`
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`
- `scripts/dashboard-react/src/components/PipelineStats.jsx`
- `src-tauri/src/database/mod.rs`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Compare is now run where you work (episode view), reprocess controls are visually unified, and diarization-only reprocess completions show up in Recently Completed with an explicit reprocess indicator.

### Compare Readiness UX — Explicit Per-Backend Voice Print Build Buttons

**Goal**: Make backend compare reliability obvious by exposing explicit rebuild controls for each embedding backend without relying on global backend switching.

**Changes**:
- Added backend-override support to `rebuild_voice_library` command:
  - optional `backend` arg (`ecapa-tdnn` / `pyannote`)
  - defaults to current setting when not provided
- Updated frontend speaker service wrappers to pass optional backend into rebuild call
- Added episode-local explicit build buttons in Transcript Editor compare area:
  - `Build ECAPA Prints`
  - `Build pyannote Prints`
- Added inline display of compare backend errors so missing/unbuilt backend is visible immediately

**Files modified**:
- `src-tauri/src/commands/speakers.rs`
- `scripts/dashboard-react/src/services/tauri.js`
- `scripts/dashboard-react/src/services/api.js`
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: You can now build ECAPA and pyannote voice prints independently from the episode compare UI, then run compare with clear backend-error visibility if one side is missing.

### Compare Hardening — Offline HF Toggle + JSON-Safe Compare Output

**Goal**: Reduce `compare` failures caused by transient Hugging Face network checks and stdout noise breaking JSON parsing.

**Changes**:
- Added new app setting default:
  - `hf_hub_offline = false`
- Added Settings toggle:
  - "Hugging Face Offline Mode"
  - OFF = allow network during compare/rebuild
  - ON = force cache-only (`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`)
- Updated Rust speaker command runners to apply HF runtime env for voice-library subprocesses:
  - compare
  - rebuild
  - rebuild-speaker
  - remove
  - delete-sample retrain path
- Updated `voice_library.py compare` path to suppress non-JSON stdout during backend mapping so Rust can reliably parse compare JSON.

**Files modified**:
- `src-tauri/src/commands/speakers.rs`
- `scripts/voice_library.py`
- `src-tauri/src/database/mod.rs`
- `scripts/dashboard-react/src/components/SettingsPanel.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Compare/rebuild can now run in explicit cache-only mode, and compare output is hardened against stdout contamination so failures are more likely to reflect real model/cache issues.

### Compare UX Reliability — Automatic Offline Fallback (No Toggle Required)

**Goal**: Make episode-level `Compare Backends` work from a single click without requiring users to manually toggle HF offline mode.

**Changes**:
- Added compare execution retry logic in Rust:
  - First run uses current settings
  - If stderr indicates Hugging Face DNS/network failure, automatically retries compare with cache-only env (`HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`)
- Added resilient JSON parse fallback:
  - If compare stdout parsing fails, one offline retry is attempted before returning error
- Kept `hf_hub_offline` setting as optional override, but it is no longer required for normal compare usage.

**Files modified**:
- `src-tauri/src/commands/speakers.rs`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)

**Current State**: `Compare Backends` now auto-recovers from common Hugging Face network failures by retrying from local cache automatically.

### Compare Table UX — Collapse Control + Assigned Label Visibility

**Goal**: Make compare results easier to scan and align the label column with episode-assigned speaker/drop mappings.

**Changes**:
- Added compare table collapse/expand control in Transcript Editor.
- Added compare summary header with tested-label count.
- Updated compare label cell to show:
  - raw diarization label (e.g. `SPEAKER_00`)
  - assigned display label from episode mappings (speaker or sound bite) on a second line when available.

**Files modified**:
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Compare results can be collapsed, and label rows now reflect your assigned label context instead of only raw diarization IDs.

### Navigation Layout — Main Tabs Moved Into Top Header

**Goal**: Place main app navigation tabs in the top white header area for a cleaner, unified navigation region.

**Changes**:
- Moved main tab nav (`Episodes`, `Search`, `Extraction`, `Audio ID`, `Characters`, `Sponsors`, `Stats`, `Settings`) from `App` content area into `Header`.
- Kept tab behavior/state unchanged by passing `activeMainTab` and `onSelectMainTab` props from `App` to `Header`.
- Added horizontal overflow handling in header nav for narrower widths.

**Files modified**:
- `scripts/dashboard-react/src/components/Header.jsx`
- `scripts/dashboard-react/src/App.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Main navigation now lives in the top white header band and remains fully functional.

### Layout Comfort Pass — Denser Header + Expandable Episode Workspace

**Goal**: Reduce cramped UI feel and let episode review area grow with transcript content instead of feeling hard-capped.

**Changes**:
- Tightened header vertical density:
  - smaller title text
  - smaller status pill
  - reduced tab vertical padding
- Reduced global page top/bottom padding in `App` to reclaim vertical space.
- Changed transcript review container from fixed viewport height to minimum viewport height so it can expand as content grows.
- Updated transcript editor body to use page scroll behavior (content can extend naturally) rather than forcing the transcript list into a fixed internal scroll region.

**Files modified**:
- `scripts/dashboard-react/src/components/Header.jsx`
- `scripts/dashboard-react/src/App.jsx`
- `scripts/dashboard-react/src/components/TranscriptReviewLayout.jsx`
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Header is more compact and the Episodes/transcript workspace can grow vertically with long episodes, matching the less-boxed feel of Stats.

### Global UX — Floating Back-To-Top Button

**Goal**: Improve long-page navigation with a quick return-to-top control.

**Changes**:
- Added app-level floating back-to-top button in bottom-right corner.
- Button appears only after scrolling down (`window.scrollY > 400`).
- Click action performs smooth scroll to top.

**Files modified**:
- `scripts/dashboard-react/src/App.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Users can jump back to top quickly from long episode/transcript views.

### Audio ID + Episode UX Pass — Placeholder Cleanup, Sticky Player, Pause-on-Select

**Goal**: Clean up placeholder speaker artifacts (`Speaker_XX`), make editing faster, and improve episode review ergonomics.

**Changes**:
- Added backend command to purge unlinked voice-library entries (embedding + files + DB sample records):
  - `purge_voice_library_entry`
- Added SpeakersPanel UI controls for cleanup:
  - per-entry `Delete` button for unlinked voice-library rows
  - bulk `Delete N placeholder(s)` for unlinked placeholder names
- Added placeholder guards to stop future placeholder sample pollution:
  - `save_voice_samples` now skips `SPEAKER_XX` / `Speaker_XX` / `Speaker XX`
  - `extract_voice_sample_from_segment` skips placeholder speaker names
  - `harvest_voice_samples.py` skips placeholder speaker names
- Speaker edit UX improvements:
  - editing a row now auto-scrolls to the add/edit form
  - full-name field now includes datalist suggestions for faster rename/search (e.g. `Jacob Smith`)
- Episode transcript UX improvements:
  - audio transport bar is sticky while scrolling transcript
  - clicking a segment (or speaker column) now auto-pauses playback for safer flagging

**Files modified**:
- `src-tauri/src/commands/speakers.rs`
- `src-tauri/src/commands/episodes.rs`
- `src-tauri/src/lib.rs`
- `scripts/harvest_voice_samples.py`
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`
- `scripts/dashboard-react/src/services/tauri.js`
- `scripts/dashboard-react/src/services/api.js`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Placeholder voice-library clutter can be cleaned from UI, future placeholder clip creation is blocked in key flows, player stays accessible while scrolling, and selecting segments now pauses playback.

### Audio ID Traceability + Delete Robustness Pass

**Goal**: Improve sample provenance visibility, fix speaker delete failures/undefined errors, and reduce confusion around clip naming/segment linkage.

**Changes**:
- Voice sample metadata:
  - Added `voice_samples.source` column (migration + defaults)
  - Added source tagging at write time:
    - `manual` via episode save flow
    - `harvest` via harvest script
    - `auto` via extract script
  - Exposed `source`, `episode_number`, and `segment_idx` through Tauri sample API to frontend
- UI provenance display:
  - Audio ID sample rows now show a source badge (`harvest`/`auto`/`manual`)
  - Episode label now prefixed with `Ep {episode_number}` when available
  - Added per-sample `seg #N` badge (bottom-right of sample row)
- Clip naming for new files:
  - Updated generated filenames to include episode number + DB id (`ep{number}_id{id}_...`) in save/harvest flows for clarity
- Speaker delete robustness:
  - `delete_speaker` now unlinks dependent references (`episode_speakers`, `characters`) before deleting speaker row
  - Fixed UI delete error rendering to avoid `undefined` messages
  - Added deleting state to Delete Speaker button (`Deleting…`)
- Voice-library purge improvements:
  - Purge now also removes matching speaker row if one exists by the same name
  - Added purge-running mini loader feedback in unlinked section

**Files modified**:
- `src-tauri/src/database/mod.rs`
- `src-tauri/src/database/models.rs`
- `src-tauri/src/commands/episodes.rs`
- `src-tauri/src/commands/speakers.rs`
- `scripts/harvest_voice_samples.py`
- `scripts/extract_voice_sample.py`
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Audio ID now surfaces where clips came from, speaker deletes are resilient with clearer UX feedback, and new clip names/segment badges reduce episode-id confusion.

### Audio ID Usability Follow-up — Voice Print Source Playback + Stronger Sample Delete Semantics

**Goal**: Make voice-print provenance actionable in Audio ID and ensure sample deletion fully removes its influence from embeddings.

**Changes**:
- Added voice-print source playback fallback in speaker expanded view:
  - when a voice print exists but no DB sample rows are listed, panel now attempts to load a source clip path and render a sample-like card with play control.
- Added source-clip destructive action:
  - `Delete clip + print` on fallback source card removes the source clip and refreshes the print state.
- Updated sample delete behavior:
  - deleting a sample now forces print refresh by:
    1) deleting clip record/file
    2) deleting current voice print
    3) rebuilding from remaining clips
  - this guarantees removed clips cannot linger in the embedding.
- Updated delete icon tooltip to explicitly state print refresh behavior.

**Files modified**:
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Voice-print source clips are now playable where available, and sample deletion semantics are stricter to prevent stale voice-print contamination.

### Audio ID Unification Pass — Backfill FS Clips Into Sample Table + Unified Sample-First UI

**Goal**: Eliminate split behavior between voice-print-only rows and sample rows so Audio ID presents a single, consistent sample workflow with play/jump/delete.

**Changes**:
- Backend sample-table backfill:
  - `get_voice_samples` now backfills filesystem clips into `voice_samples` idempotently before returning rows.
  - Added filename parsing support for legacy/new clip names:
    - `ep{episode_id}_seg{segment}`
    - `ep{display}_id{episode_id}_seg{segment}`
    - `ep{episode_id}_{start}s-{end}s`
    - `ep{display}_id{episode_id}_{start}s-{end}s`
  - If only segment index is available, start/end/text are hydrated from `transcript_segments`.
- UI unification in SpeakersPanel:
  - Removed separate green voice-print status card in expanded speaker panel.
  - Folded voice-print summary into the `Audio Samples` header line.
  - Kept `Delete print` action as a right-side control in the same samples section.
  - Updated wording to clarify semantics:
    - "Embedding uses X source clips" / "Voice Print (X src)".
  - Removed fallback “source clip (not in sample table)” special row; expected path is now regular sample rows.
  - Refined delete tooltip text: delete sample with auto-refresh of voice print.

**Files modified**:
- `src-tauri/src/commands/speakers.rs`
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Legacy file-only clips are reconciled into DB sample rows where parseable, and the Audio ID expanded speaker view is sample-first with unified controls and clearer embedding language.

### Episode Review UX — Clip-Local Save + Sticky Search/Save Controls

**Goal**: Reduce scroll-jump friction while reviewing segments and keep primary episode controls visible during long transcript scrolls.

**Changes**:
- Added clip-local quick save action in expanded segment toolbar:
  - shows when there are unsaved changes
  - runs same episode save flow as top control row
- Made search/view/save control row sticky while scrolling transcript:
  - sticks beneath the sticky audio player when audio is present
  - sticks under header when audio player is absent

**Files modified**:
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Marking samples/flags can be saved directly from the active clip toolbar, and top review controls remain accessible while scrolling.

### Episode Review UX Follow-up — Unified Sticky Control Stack + Visible Clip-Corner Save

**Goal**: Fix reports that controls were not staying pinned reliably and make save action obvious on the active clip itself.

**Changes**:
- Reworked sticky transcript controls into a single sticky container at `top-[88px]`:
  - combines audio player, search/view/save row, and shortcut hint
  - removes split sticky offsets that could desync (`top-[157px]` vs `top-[88px]`).
- Updated selected clip save affordance:
  - moved save button to the top-right corner of the selected segment content card
  - kept same save behavior/guards (`saving`, diarization lock, polish lock).

**Files modified**:
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Episode controls now pin as a single block while scrolling, and active clip save is visually anchored at the clip’s top-right for faster review flow.

### Sticky Controls Fix — Anchor Sticky To Transcript Scroll Container

**Goal**: Resolve report that transcript controls still were not sticking while scrolling.

**Changes**:
- Updated transcript center pane in review layout to be the explicit scrolling parent:
  - added `min-h-0 overflow-y-auto` to the center editor column when active.
- This gives sticky elements in `TranscriptEditor` a valid scroll container to attach to.

**Files modified**:
- `scripts/dashboard-react/src/components/TranscriptReviewLayout.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Sticky behavior is now wired to the editor pane scroll context instead of relying on outer layout/window behavior.

### Sticky Controls Fix 2 — Fixed-Height Review Shell To Stop Window Scroll

**Goal**: Resolve persistent non-sticky behavior by ensuring transcript review uses internal pane scrolling instead of page-level scrolling.

**Changes**:
- Converted transcript review root container from min-height to fixed viewport-relative height:
  - `min-h-[calc(100vh-170px)]` → `h-[calc(100vh-170px)] min-h-0`
- Kept center editor column as explicit scroller and set full height:
  - active center pane includes `h-full min-h-0 overflow-y-auto`

**Files modified**:
- `scripts/dashboard-react/src/components/TranscriptReviewLayout.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Transcript pane is now a bounded scroll container, enabling sticky controls in `TranscriptEditor` to anchor consistently.

### Sticky Controls Final Positioning — Pin To Top Of Transcript Pane

**Goal**: Remove visual gap where transcript cards appear above sticky controls.

**Changes**:
- Updated transcript controls sticky offset from `top-[88px]` to `top-0`.
- Raised stacking context for controls (`z-30`) to ensure they stay above transcript cards.

**Files modified**:
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Player/search/save controls now pin flush to the top of the transcript pane with no cards sliding above them.

### Properties Panel Scroll Behavior — Unified Right-Panel Scroll

**Goal**: Restore natural full-panel scrolling in Properties after sticky transcript fixes.

**Changes**:
- Made Properties panel itself the scroll container (`overflow-y-auto`).
- Removed inner accordion-only scroll lock so top sections (header/speakers) scroll with the rest.

**Files modified**:
- `scripts/dashboard-react/src/components/PropertiesPanel.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Transcript controls remain sticky at top of transcript pane; Properties now scrolls as one continuous panel.

### Properties Panel Scroll Fix 2 — Remove Flex Layout To Guarantee Full-Panel Scroll

**Goal**: Address report that unified Properties scrolling still wasn't visible.

**Changes**:
- Removed flex-column layout from Properties root to avoid flex/overflow interactions.
- Kept panel as a plain bounded scroller:
  - root now `h-full min-h-0 overflow-y-auto`
- Removed `flex-shrink-0` and `flex-1` layout dependencies in panel sections so content flows in a single scroll document.

**Files modified**:
- `scripts/dashboard-react/src/components/PropertiesPanel.jsx`

**Verification**:
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Properties is implemented as one direct scroll container (no nested flex scroll logic).

### Audio Sample Save Reliability + Unlinked Row Styling

**Goal**: Fix cases where episode-marked samples appeared saved but did not show in Audio ID, and remove yellow dashed styling for unlinked voice rows.

**Changes**:
- Manual sample save backend (`save_voice_samples`):
  - removed placeholder-name skip for user-initiated saves (`Speaker_XX` samples now persist instead of being dropped).
- Episode save UX (`TranscriptEditor`):
  - removed silent catch around `saveVoiceSamples`.
  - now reports extracted sample result count and warns if 0 extracted.
  - when marking a sample on a diarization label mapped to a sound bite, shows explicit info toast.
- Audio ID UI (`SpeakersPanel`):
  - unlinked “Voice Library Only” cards now use the same neutral card style as speaker rows (no yellow dashed blocks).

**Files modified**:
- `src-tauri/src/commands/episodes.rs`
- `scripts/dashboard-react/src/components/TranscriptEditor.jsx`
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Marked samples no longer fail silently, placeholder-labeled manual samples are persisted, and unlinked voice entries render as standard cards.

### Audio ID Unlinked Entries — Unified Expandable Rows With Play/Jump

**Goal**: Make unlinked voice entries behave like normal speaker cards so users can inspect/play source clips and jump to episode context.

**Changes**:
- Converted “Voice Library Only (not added as speaker)” entries to use shared expandable `renderRow` flow.
- Unlinked rows now include:
  - expandable sample list
  - clip playback
  - jump-to-source (when episode/time is resolvable)
  - inline “Add as Speaker” + delete actions in expanded panel.
- Kept purge-placeholder bulk action in section header.

**Files modified**:
- `scripts/dashboard-react/src/components/SpeakersPanel.jsx`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Unlinked voice entries are no longer static placeholder blocks; they are first-class rows with the same sample inspection controls as speakers.

### Voice Sample Persistence Fix — Correct DB Insert For Sample Rows

**Goal**: Ensure newly created and backfilled voice samples always persist DB rows (required for reliable source metadata and jump/play UX).

**Root Cause**:
- `insert_voice_sample` SQL had 8 target columns but only 7 selected values, causing insert failures.

**Changes**:
- Fixed `INSERT ... SELECT` placeholder list to include `?8` for `source`.

**Files modified**:
- `src-tauri/src/database/mod.rs`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Voice sample inserts now persist correctly; this unblocks consistent clip provenance/jump behavior for new saves and FS backfill flows.

### Legacy Filesystem Source Removal — Hard Purge + No Backfill

**Goal**: Enforce policy that new/active sample sources are only `manual` and `harvest` (plus existing `auto` extraction), with no filesystem-compatibility path.

**Changes**:
- Added DB helpers:
  - `get_voice_sample_files_by_source(source)`
  - `delete_voice_samples_by_source(source)`
- Added startup purge in `get_voice_library`:
  - hard-purges `voice_samples` rows where `source='filesystem'`
  - best-effort deletes corresponding files under `scripts/voice_library`
- Removed legacy sample backfill path from `get_voice_samples`:
  - no filesystem scanning
  - no filename parsing fallback
  - DB-backed records only
- Removed dead legacy helper code from `speakers.rs` to keep backend clean.

**Files modified**:
- `src-tauri/src/database/mod.rs`
- `src-tauri/src/commands/speakers.rs`

**Verification**:
- `cargo check --manifest-path src-tauri/Cargo.toml` (pass)
- `npm --prefix scripts/dashboard-react run build` (pass)

**Current State**: Filesystem legacy compatibility is removed; legacy `filesystem` samples are purged, and Audio ID now relies on persisted DB-backed sample rows only.
