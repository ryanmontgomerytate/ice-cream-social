# Architecture

## Purpose

This file is the repository-level architecture source of truth for `ice-cream-social-app`.
It describes the current implemented system (desktop-first Tauri app) and the key storage/runtime boundaries that matter for ongoing development and future web/mobile migration.

Last updated: February 27, 2026

## System Overview

`ice-cream-social-app` is a desktop-first podcast transcription, diarization, indexing, and review application for "Matt and Mattingly's Ice Cream Social" (ICS).

Current architecture:
- Frontend: React + Vite (`scripts/dashboard-react`)
- App shell / backend: Tauri v2 + Rust (`src-tauri`)
- Primary database: SQLite (`data/ice_cream_social.db`) via `rusqlite`
- Audio/transcription/diarization workers: Rust orchestrates Python scripts and native CLIs
- Native transcription: `whisper.cpp` CLI
- Diarization + speaker ID: Python (`pyannote`, `speechbrain` ECAPA) + local voice library

## High-Level Runtime Architecture

## 1) Tauri Desktop App (entrypoint)

File: `src-tauri/src/lib.rs`

Responsibilities:
- Initialize SQLite database and run schema creation/migrations
- Start background worker (`TranscriptionWorker`)
- Register Tauri commands (IPC API for frontend)
- Spawn scheduled sub-agents (quality scan, extraction coordinator, wiki sync, hints prefetch)

Important current constraint:
- Several paths are currently hardcoded relative to the user home/Desktop project path (Mac-local workflow).

## 2) React Frontend

Path: `scripts/dashboard-react/`

Responsibilities:
- Episode browser, transcript editor/review UI, queue/status views, settings
- Calls backend through `scripts/dashboard-react/src/services/api.js`
- Auto-detects Tauri vs HTTP via `scripts/dashboard-react/src/services/tauri.js`

Current state:
- Tauri IPC is the primary integration path
- Some HTTP fallback exists, but many flows are Tauri-only (editing, diarization, voice samples, etc.)

## 3) Rust Command Layer (Tauri IPC)

Path: `src-tauri/src/commands/`

Major domains:
- `episodes.rs`: feed refresh, transcript fetch/edit, diarization reprocess, voice sample save
- `content.rs`: chapters, characters, flags, audio drops, indexing, classification helpers
- `speakers.rs`: speaker CRUD, voice library UI integration, rebuild/harvest commands
- `queue.rs`, `worker.rs`, `stats.rs`, `settings.rs`, `wiki.rs`, `diagnostics.rs`, `extraction.rs`

This layer is the application API boundary for the frontend.

## 4) Worker / Processing Pipeline

Rust worker paths:
- `src-tauri/src/worker/mod.rs`
- `src-tauri/src/worker/diarize.rs`
- `src-tauri/src/worker/transcribe.rs`
- `src-tauri/src/worker/subagents.rs`

Pipeline pattern:
1. Fetch/download episode audio
2. Transcribe with `whisper.cpp`
3. Index transcript segments into SQLite FTS
4. Diarize with Python (`speaker_diarization.py`)
5. Optionally apply voice-library speaker identification
6. Persist transcript/segments/metadata/status
7. Surface progress to UI via Tauri events

## Primary Data Architecture

## SQLite (canonical app data)

File: `data/ice_cream_social.db`

Core domains currently in SQLite:
- Episodes and variants (`episodes`, cross-feed linking)
- Transcripts and segments (`transcripts`, `transcript_segments`, `segments_fts`)
- Queue and worker state (`transcription_queue`)
- Speakers and diarization mapping (`speakers`, `episode_speakers`)
- Content modeling (`chapter_types`, `episode_chapters`, `characters`, `character_appearances`, `audio_drops`, `audio_drop_instances`)
- Review/correction workflows (`flagged_segments`, `transcript_corrections`, `segment_classifications`)
- Wiki/lore enrichment (`wiki_lore`, `wiki_episode_meta`, `wiki_lore_mentions`)
- Settings and diagnostics (`app_settings`, `pipeline_errors`)
- Voice sample clip metadata (`voice_samples`)

### Search

- Transcript full-text search is implemented with SQLite FTS5 (`segments_fts`) and triggers that mirror `transcript_segments`.

## Filesystem Data (local media + artifacts)

Key directories:
- `scripts/episodes/` - downloaded episode audio files
- `scripts/transcripts/` - transcript and diarization JSON files
- `scripts/voice_library/` - speaker/sound-bite samples, embeddings, model cache links

The filesystem currently stores operational artifacts that are referenced by DB rows (for example `audio_file_path`, `voice_samples.file_path`).

## Voice Library Architecture (Current + Migration Direction)

Primary implementation file:
- `scripts/voice_library.py`

Consumers:
- `scripts/speaker_diarization.py` (speaker identification after diarization)
- Tauri speaker/episode commands (`src-tauri/src/commands/speakers.rs`, `src-tauri/src/commands/episodes.rs`)

### Voice Library Files (current layout)

- `scripts/voice_library/samples/` - per-speaker sample audio clips
- `scripts/voice_library/sound_bites/` - non-person audio drops / recurring bites
- `scripts/voice_library/embeddings_pyannote.json` - pyannote centroids (legacy-compatible JSON)
- `scripts/voice_library/embeddings_ecapa.json` - ECAPA centroids (legacy-compatible JSON)
- `scripts/voice_library/embeddings.json` - legacy fallback file
- `scripts/voice_library/models/speechbrain_ecapa` - local cache path (symlinked into HF cache in current setup)

### Voice Library Storage Model (updated Feb 26, 2026)

The app now supports a SQLite-backed embedding store in addition to JSON files.

Implemented changes:
- `voice_library.py` supports `--store-mode auto|json|sqlite`
- Embedding metadata and vectors can be stored in SQLite (binary `float32` blobs)
- JSON files remain dual-written for compatibility/fallback
- `save_voice_samples` now passes sample metadata to `voice_library.py add` (voice sample id, episode id, segment idx, sample type, sample date)

New SQLite tables (created in `src-tauri/src/database/mod.rs`):
- `voice_embedding_models`
- `voice_embedding_samples`
- `voice_embedding_centroids`

### Current Voice Embedding Data Model

Canonical direction:
- Raw sample media stays on filesystem (`samples/`, `sound_bites/`)
- Embeddings and embedding metadata move into SQLite
- JSON embeddings become compatibility/export artifacts (not long-term source of truth)

Rationale:
- Reduces drift between sample files / DB / JSON
- Supports per-sample embeddings (not just averaged centroids)
- Improves future matching quality and hosting portability
- Enables future vector indexing (`sqlite-vec` local, `pgvector` hosted)

## API / Integration Boundaries

## Frontend -> Backend

Primary path:
- Tauri IPC commands (`tauri::command`) invoked from `scripts/dashboard-react/src/services/tauri.js`

Secondary path (legacy/dev):
- HTTP endpoints in Python Flask mode (`scripts/api_episodes.py`, `scripts/dashboard_server.py`)

Current practical truth:
- Desktop Tauri path is the active/authoritative workflow
- HTTP fallback is partial and not feature-complete for newer review/editor functions

## Rust -> Python / CLI tools

Rust invokes:
- `whisper-cli` (`whisper.cpp`) for transcription
- `speaker_diarization.py` for diarization + speaker mapping
- `voice_library.py` for embedding add/rebuild/info/compare
- `harvest_voice_samples.py` for sample harvesting
- optional other extraction/classification scripts

This means Python scripts are part of the runtime architecture, not just dev tooling.

## Domain Model Highlights (ICS-specific today)

The app is still ICS-first and contains ICS-specific concepts in schema and UI workflows:
- recurring chapter types (Scoop Mail, Jock vs Nerd, etc.)
- characters and character appearances
- sponsor/commercial/audio drop detection
- wiki sync to heyscoops fandom pages

This is acceptable for the current product stage, but future multi-show support should isolate:
- show-level configuration
- content visibility/rights policy
- taxonomy (chapters, entities, tags)

## Reliability / Performance Patterns

Implemented patterns:
- SQLite WAL mode for concurrent reads
- FTS indexing for transcript search
- Background worker with queue/state tracking
- Lazy model loading in `voice_library.py`
- Tauri event-based progress updates for long-running tasks

Known performance constraints:
- Voice library speaker matching is still exact linear scan over centroid embeddings
- Some Tauri commands call Python subprocesses synchronously on-demand
- Path assumptions and local filesystem coupling limit portability

## Security and Secrets

Rules (also reflected in `CLAUDE.md` / `AGENTS.md`):
- Do not hardcode tokens
- Use environment variables / `.env` (local only)
- `.env` and secret files are not to be read or committed

Current runtime note:
- HuggingFace token is used for pyannote model access
- Patreon feed access currently relies on local/private feed tokens at ingest time (no user entitlement/auth model in desktop app)

## Testing and SDLC State (Current)

Available coverage:
- Rust unit tests in `src-tauri/src/database/tests.rs` (DB/search/content logic)
- Minimal frontend tests in `scripts/dashboard-react/src/__tests__/`
- Playwright tests exist but CI workflow is currently disabled on push/PR (`.github/workflows/playwright.yml`)

Current gap:
- No architecture doc was present before this file was recreated
- CI and API-contract coverage need strengthening before hosted deployment work

## Environment Topology

Standard environments:
- `local` (current primary): Tauri desktop + local SQLite + local filesystem artifacts
- `staging` (target hosted pre-prod): production-like hosted stack for release validation
- `prod` (target hosted production): public user-facing environment with controlled deploy + rollback

Reference:
- `docs/operations/ENVIRONMENTS.md`

## SDLC Operations Artifacts

The repository now includes standard SDLC operations docs:
- Deployment + rollback checklist: `docs/operations/DEPLOYMENT_AND_ROLLBACK_CHECKLIST.md`
- Data backup/restore runbook: `docs/operations/BACKUP_RESTORE_RUNBOOK.md`
- Hosted import pipeline runbook: `docs/operations/HOSTED_IMPORT_PIPELINE.md`

These should be used for release execution and incident response.

## Hosted Phase 1 Bridge Artifacts

Phase 1 web migration artifacts are now staged in-repo:
- Hosted schema migrations:
  - `web/supabase/migrations/001_initial_schema.sql`
  - `web/supabase/migrations/002_search_ranked_rpc.sql`
  - `web/supabase/migrations/003_search_fast_rpc.sql`
- SQLite -> hosted export/import pipeline: `scripts/export_to_hosted.py`
- Hosted env templates:
  - `web/.env.example`
  - `scripts/.env.example`

Current intent:
- Keep desktop SQLite as the source of truth while hosted Postgres is populated by idempotent upsert imports.
- Restrict hosted scope to read-first public experience tables (episodes, transcript segments, speakers, characters, chapters, wiki, drops) plus import auditing.
- Preserve FK-safe import order and chunked segment loading to handle large transcript tables safely.

## Hosted Phase 2 Foundation (Community Editing + Moderation)

Phase 2 foundation schema is now added and migrated in hosted Supabase:
- `web/supabase/migrations/004_phase2_community_foundation.sql`

Added domains:
- Auth-linked profiles and role assignment:
  - `profiles`
  - `roles`
  - `user_role_assignments`
  - `show_memberships`
- Revision and moderation workflow:
  - `content_revisions`
  - `pending_edits`
  - `moderation_queue`
  - `moderation_actions`
  - `reports`
- Trust/abuse/audit telemetry:
  - `rate_limit_events`
  - `trust_scores`
  - `audit_log`
- Import observability extension:
  - `import_batch_items`

Current Phase 2 schema posture:
- RLS enabled on new tables.
- Anonymous access remains closed by default until auth + API policies are introduced.

## Hosted Phase 2 API Surface (Initial Read Endpoints)

Initial Phase 2 read APIs are now implemented in Next.js route handlers:
- `GET /api/v1/admin/revisions`
- `GET /api/v1/admin/pending-edits`
- `GET /api/v1/admin/moderation-queue`

Security posture for this initial slice:
- Endpoints require `ADMIN_API_KEY` via `x-admin-key` or `Authorization: Bearer`.
- Data fetches currently use the Supabase secret-key server client (`createAdminClient`) to bypass RLS.
- This is a bootstrap admin surface for internal moderation workflows; role-aware authenticated flows and RLS-backed policies are the next step.

Admin review UI:
- `/admin` now renders a minimal dashboard that loads pending edits, queue items, and unapproved revisions through these API routes.

## Target Direction (Short Version)

Near-term (desktop quality):
- Continue stabilizing transcript review, diarization, and voice library workflows
- Complete voice embedding migration from JSON-centric to SQLite-centric storage
- Reduce hardcoded path coupling

Mid-term (hosted web/mobile migration):
- Reuse React UI concepts/components with a hosted API
- Introduce user/auth/roles/moderation and rights-aware content visibility
- Move from local-only storage assumptions to hosted DB/object storage
- Keep heavy transcription/diarization hybrid/offline initially

## Change Management Rules for This File

Update `ARCHITECTURE.md` immediately when any of the following change:
- database schema (new tables/columns used by app logic)
- core pipeline stages (transcription/diarization/embedding/reprocess flow)
- primary frontend/backend boundary (Tauri IPC vs HTTP/API changes)
- storage source of truth (DB vs filesystem vs JSON/cache)
- deployment/runtime topology (desktop-only vs hosted services)
