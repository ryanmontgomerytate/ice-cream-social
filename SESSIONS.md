# Development Sessions Log

## Session: February 27, 2026

### Current State Update (Phase 1 Search Relevance: Ranked RPC + Safe Fallback)

**Done:**
- Added hosted migration `web/supabase/migrations/002_search_ranked_rpc.sql` introducing `public.search_transcript_segments(...)`:
  - ranks by `ts_rank_cd(text_search, tsquery)`
  - ties broken by newest episode publish date
  - paginated with bounded page size.
- Updated `web/lib/search.ts` to:
  - use ranked RPC path by default
  - fall back to basic text-search path when RPC is not yet applied
  - keep timeout-safe warning behavior and diagnostics IDs.
- Updated `docs/EVOLVE_ICS_TRACKER.md` Phase 1 notes/next-step to reflect ranked search implementation and hosted migration validation.
- Commit scope intentionally limited to active Phase 1 files only (unrelated local modifications left untouched).

**Pending:**
- Apply migration `002_search_ranked_rpc.sql` in hosted Supabase environment and validate ranking quality against real query samples.

**Blockers:**
- None in local code/build; hosted ranking validation depends on migration being applied remotely.

**Tests Run:**
- `npm --prefix web run build` — **pass**

### Current State Update (Workflow Rule: Selective Task Commits)

**Done:**
- Updated `AGENTS.md` with a **Selective Commit Policy** to commit only files touched for the active task.
- Added guidance to avoid blocking on unrelated modified files and to use selective staging (`git add <paths>`).

**Pending:**
- Apply this policy consistently across future Codex/Claude commits.

**Blockers:**
- None.

**Tests Run:**
- Not applicable (docs/rules update only).

### Current State Update (Search Timeout Resilience + Better Error Diagnostics)

**Done:**
- Updated hosted search pipeline in `web/lib/search.ts` to reduce timeout risk and improve diagnosability:
  - switched from heavy joined search query to a two-step query shape (segments first, episodes hydrate second)
  - reduced expensive exact count path (`count: "planned"`)
  - added timeout-aware graceful fallback with user-visible warning instead of hard page crash
  - added diagnostics IDs (`search:<id>`) and structured server logs for easier debugging.
- Updated `web/app/(public)/search/page.tsx` to show warning + diagnostics ID when backend timeout occurs.

**Pending:**
- Validate in live/dev runtime against broad queries (e.g., short/common names) and tune ranking/query strategy further if needed.

**Blockers:**
- None.

**Tests Run:**
- `npm --prefix web run build` — **pass**

### Current State Update (Diarization Flywheel: Qwen Pause + Auto-Harvest)

**Done:**
- Split `reprocess_diarization` into two phases:
  - Phase 1 (`reprocess_diarization`): reads `_with_speakers.json`, finds speakers with confidence < 0.65, returns their segment indices to the frontend as `QwenPauseInfo`, emits `qwen_pause_ready` event — no requeue yet
  - Phase 2 (`confirm_reprocess_with_qwen_hints`): builds hints from DB flags + approved Qwen corrections, writes hints file, resets diarization, requeues at top priority
- Added `get_segment_indices_for_speakers()` DB method to `database/mod.rs`
- Registered `confirm_reprocess_with_qwen_hints` command in `lib.rs`
- Added `run_harvest_for_episode()` to `worker/diarize.rs` — fires `harvest_voice_samples.py --episode-id` automatically after every successful diarization run
- Updated `services/tauri.js` + `services/api.js` with new API methods
- Updated `TranscriptEditor.jsx` reprocess flow:
  - Phase 1 returns `QwenPauseInfo`; if `needs_review`, fires `run_qwen_polish` in background
  - Amber "Qwen Pause Active" banner appears with progress/done status, Scoop Polish pointer, and two action buttons: "Re-diarize with Qwen hints" (phase 2 with approved corrections) and "Skip Qwen, re-diarize now" (phase 2 immediately)
  - If `needs_review = false`, jumps straight to phase 2 (no user action required)
- `harvest_voice_samples.py` already had `--episode-id` support — no change needed

**Tests Run:**
- `cargo check --manifest-path src-tauri/Cargo.toml` — **pass**
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — **pass** (49 passed, 0 failed)
- `npm --prefix scripts/dashboard-react run build` — **pass**

**Pending:**
- Manual test with Episode 1291 (134 unknowns): verify Qwen pause appears, approvals flow through to requeue, Unknown count drops after re-diarize

### Current State Update (Phase 1 Progress: Wiki Index/Discovery Route + Nav)

**Done:**
- Added public wiki index/discovery route at `web/app/(public)/wiki/page.tsx` with:
  - search (`q`)
  - category filter tabs
  - pagination
  - links into existing lore detail pages (`/wiki/[slug]`)
- Added top-level navigation link to `/wiki` in `web/app/layout.tsx`.
- Updated roadmap tracker to reflect this Phase 1 milestone in `docs/EVOLVE_ICS_TRACKER.md`.

**Pending:**
- Continue Phase 1 by improving search ranking relevance/results quality.

**Blockers:**
- None.

**Tests Run:**
- `npm --prefix web run build` — **pass** (includes routes `/wiki` and `/wiki/[slug]`)

### Current State Update (Phase 0 SDLC Foundation: Rust fmt Blocker Cleared)

**Done:**
- Resolved the outstanding Rust formatting blocker by running `cargo fmt --all` for the `src-tauri` crate.
- Verified formatting, compile, and Rust unit tests all pass locally after formatting changes.
- Updated `docs/EVOLVE_ICS_TRACKER.md`:
  - `Phase 0: SDLC foundation` moved from `in_progress` -> `done`
  - removed Rust fmt blocker row
  - updated next priority tasks accordingly.

**Pending:**
- Trigger and confirm CI run from GitHub Actions to validate the previous `cargo fmt --check` failure is cleared in hosted CI.
- Update issue `#1` (`[Evolve] Phase 0: SDLC foundation`) to `status:done` and close once CI confirmation is complete.

**Blockers:**
- None locally.

**Tests Run:**
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` — **pass**
- `cargo check --manifest-path src-tauri/Cargo.toml` — **pass**
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — **pass** (49 passed, 0 failed)

### Current State Update (Uncommitted Changes Reviewed + Pushed)

**Done:**
- Reviewed current uncommitted workspace changes with a full status/diff audit and safety scan across changed files.
- Validated key stacks compile/build:
  - Next.js web app build
  - React dashboard build
  - Rust backend compile check
  - Shell/YAML syntax checks for new GitHub automation scripts/workflows
- Created tracker-backed GitHub Issues (`#1`-`#20`) from:
  - `docs/EVOLVE_ICS_TRACKER.md`
  - `docs/TIKTOK_CLIP_FEED_TRACKER.md`
- Cleaned project board duplicate draft cards and kept issue-backed cards only.
- Synced project board `Status` from issue `status:*` labels using `scripts/github/sync_project_status_from_labels.sh`.

**Pending:**
- Continue moving tracker items from `Todo` -> `In Progress` -> `Done` via labels during implementation.

**Blockers:**
- None.

**Tests Run:**
- `git diff --check` — **pass with non-blocking note** (blank line at EOF in `feedTheScoops.md`)
- `npm --prefix web run build` — **pass**
- `npm --prefix scripts/dashboard-react run build` — **pass**
- `cargo check --manifest-path src-tauri/Cargo.toml` — **pass**
- `bash -n scripts/github/create_tracker_issues.sh` — **pass**
- `bash -n scripts/github/sync_project_status_from_labels.sh` — **pass**
- `bash -n scripts/github/seed_tracker_project.sh` — **pass**
- `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/project-board-sync.yml'); YAML.load_file('.github/workflows/playwright.yml'); puts 'workflow yaml syntax ok'"` — **pass**
- `bash scripts/github/create_tracker_issues.sh` — **pass** (created issues)
- `bash scripts/github/sync_project_status_from_labels.sh` — **pass** (project statuses synced)

### Current State Update (GitHub Project Access Unblocked + Board Live)

**Done:**
- Verified `gh` token now includes `project` scope and confirmed project API access works.
- Created GitHub Project board: `ICS Roadmap + Clip Feed Tracker` (`https://github.com/users/ryanmontgomerytate/projects/1`).
- Seeded board items from both trackers using `scripts/github/seed_tracker_project.sh`.
- Wired repo automation settings:
  - variable `PROJECT_BOARD_URL`
  - secret `PROJECTS_TOKEN`
- Fixed workflow config mismatch by renaming invalid repo variable key usage from `GITHUB_PROJECT_URL` to `PROJECT_BOARD_URL` in:
  - `.github/workflows/project-board-sync.yml`
  - `docs/operations/GITHUB_PROJECT_BOARD.md`

**Pending:**
- Optional: add `status:*` labels to existing issues/PRs so automation maps them into explicit board columns beyond default Todo/Done behavior.

**Blockers:**
- None.

**Tests Run:**
- `gh project list --owner "@me" --limit 50 --format json` — **pass**
- `gh project create --owner "@me" --title "ICS Roadmap + Clip Feed Tracker" --format json` — **pass**
- `bash scripts/github/seed_tracker_project.sh` — **pass** (created/synced tracker items)
- `gh variable list --repo ryanmontgomerytate/ice-cream-social` — **pass** (`PROJECT_BOARD_URL` present)
- `gh secret list --repo ryanmontgomerytate/ice-cream-social` — **pass** (`PROJECTS_TOKEN` present)

### Current State Update (GitHub Project Board Mirror + Tracker Sync Automation)

**Done:**
- Added GitHub Project board runbook at `docs/operations/GITHUB_PROJECT_BOARD.md` with setup, status mapping, and Actions/PR automation wiring.
- Added tracker seeding script `scripts/github/seed_tracker_project.sh` to sync phase/workstream items from:
  - `docs/EVOLVE_ICS_TRACKER.md`
  - `docs/TIKTOK_CLIP_FEED_TRACKER.md`
- Added workflow `.github/workflows/project-board-sync.yml` to auto-add Issues/PRs to project board and sync `Status` from labels/state.
- Updated issue/PR templates for Kanban status flow:
  - default issue labels now include `status:not_started`
  - PR template includes status-label checklist item.
- Updated `CLAUDE.md` context-anchoring section to include tracker docs, `docs/VOICE_LIBRARY.md`, and the GitHub board runbook.
- Updated tracker docs to reference `docs/VOICE_LIBRARY.md` and the board runbook.

**Pending:**
- Complete `gh auth refresh -s read:project -s project` device auth so project board can be created/seeded from CLI in this environment.
- Create the actual GitHub Project board and run `bash scripts/github/seed_tracker_project.sh` once token scopes are granted.

**Blockers:**
- Current GitHub CLI token scopes are missing `read:project` and `project`, which blocks board creation/seeding from this session.

**Tests Run:**
- `bash -n scripts/github/seed_tracker_project.sh` — **pass**
- `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/project-board-sync.yml'); puts 'project-board-sync.yml syntax ok'"` — **pass**
- `bash scripts/github/seed_tracker_project.sh` — **expected fail** (`token missing project scopes`)

### Current State Update (TikTok-Style Clip Feed Tracker Added)

**Done:**
- Added dedicated tracker `docs/TIKTOK_CLIP_FEED_TRACKER.md` for the TikTok-style podcast clip feed roadmap with phase statuses, workstreams, blockers, and next priorities.
- Linked clip-feed tracker from `feedTheScoops.md` near top-level planning links.
- Linked clip-feed tracker from `docs/EVOLVE_ICS_TRACKER.md` and added clip-feed row to active workstreams.

**Pending:**
- Begin Phase 0 implementation tasks from tracker: hosted clip schema migration + feed API skeleton.

**Blockers:**
- None for tracker setup.

**Tests Run:**
- Not applicable (docs-only update).

### Current State Update (Roadmap Tracker Added Beyond feedTheScoops)

**Done:**
- Added dedicated execution tracker: `docs/EVOLVE_ICS_TRACKER.md` with phase statuses (0-4), active workstreams, blockers, and top priorities.
- Linked the live tracker from `feedTheScoops.md` near the top so planning context and execution tracking are separated cleanly.

**Pending:**
- Keep `docs/EVOLVE_ICS_TRACKER.md` updated whenever major roadmap milestones move between `not_started` / `in_progress` / `done`.

**Blockers:**
- None for tracker setup itself.

**Tests Run:**
- Not applicable (docs-only update).

### Current State Update (Session Pooler Secret Validation in CI)

**Done:**
- Triggered fresh CI run after updating `DATABASE_URL` to session pooler and confirmed `Hosted Import Verify` executes without the prior DB host reachability warning.
- Confirmed hosted-verify now runs fallback hosted integrity check path successfully (`Verify hosted integrity (fallback without local SQLite)` ✅).

**Pending:**
- Optional: provide `SQLITE_DB_URL` secret if you want non-fallback full source-vs-hosted parity verify in GitHub-hosted runners.

**Blockers:**
- None for secret/network access; remaining CI red status is unrelated (`Cargo fmt check` in Rust job).

**Tests Run:**
- `gh workflow run .github/workflows/ci.yml --ref main` — **triggered**
- `gh run watch 22495149282 --interval 5` — **observed** `Hosted Import Verify` pass; overall workflow failure only from Rust fmt job.

### Current State Update (GitHub Actions: Hosted Verify End-to-End Wiring)

**Done:**
- Pushed CI updates and executed real `workflow_dispatch` runs for `.github/workflows/ci.yml` via `gh`.
- Fixed invalid job-level secret expression parsing by moving secret checks to runtime prerequisite step.
- Bound `hosted-verify` to the correct environment containing `DATABASE_URL`: `hosted supabase`.
- Added hosted verification resiliency:
  - optional SQLite bootstrap via `SQLITE_DB_URL`
  - fallback `python scripts/export_to_hosted.py --mode verify-hosted` when local SQLite is unavailable
  - DB host reachability preflight to avoid hard failure on unreachable hosts.
- Added new importer mode `verify-hosted` in `scripts/export_to_hosted.py` for hosted-only integrity checks.
- Confirmed from live Actions logs:
  - `DATABASE_URL` secret is now available to the job (no missing-secret warning)
  - `Hosted Import Verify` job completes successfully.

**Pending:**
- Replace `DATABASE_URL` with an IPv4-reachable Supabase connection string (pooler URL) to enable actual hosted DB verification from GitHub-hosted runners (current direct host resolves IPv6-only and is unreachable).
- Optionally set `SQLITE_DB_URL` secret to a downloadable DB snapshot if you want full local-vs-hosted parity verification on hosted runners.

**Blockers:**
- Current Supabase DB host in `DATABASE_URL` is unreachable from GitHub-hosted runner network (`Network is unreachable` to IPv6 host), so verify execution is skipped by reachability guard.

**Tests Run:**
- `./venv/bin/python3.14 -m py_compile scripts/export_to_hosted.py` — **pass**
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode verify-hosted` — **pass** (local environment)
- `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); puts 'ci.yml syntax ok'"` — **pass**
- `gh workflow run .github/workflows/ci.yml --ref main` + `gh run watch ...` — **pass for Hosted Import Verify job** (warnings only for missing SQLite snapshot and unreachable DB host); overall CI remains red due unrelated `Cargo fmt check`.

### Current State Update (CI Environment Binding for Hosted Verify)

**Done:**
- Bound `hosted-verify` job to GitHub Environment `hosted` in `.github/workflows/ci.yml` (`environment: hosted`) so environment-level `DATABASE_URL` secrets are available to that job.

**Pending:**
- Confirm your environment name is exactly `hosted`; if you used a different name, update that single line in workflow to match.
- Trigger `CI` via `workflow_dispatch` and verify `hosted-verify` starts and can access secret.

**Blockers:**
- Hosted verify still requires `data/ice_cream_social.db` in runner checkout; on GitHub-hosted runners this step will warn/skip unless DB is supplied.

**Tests Run:**
- `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); puts 'ci.yml syntax ok'"` — **pass**

### Current State Update (CI Wiring: Hosted Verify Job)

**Done:**
- Updated `.github/workflows/ci.yml` to include `workflow_dispatch` so hosted verification can be run manually from Actions.
- Added new `hosted-verify` CI job that runs `python scripts/export_to_hosted.py --mode verify` when:
  - event is not `pull_request`
  - repository secret `DATABASE_URL` is set
- Added safe guard in the job for missing local source DB in checkout (`data/ice_cream_social.db`): job emits warning and skips verify step instead of failing entire CI.
- Added Python setup + `psycopg2-binary` install in the job to ensure importer connectivity to Postgres in GitHub runners.

**Pending:**
- Add repository secret `DATABASE_URL` in GitHub Settings -> Secrets and variables -> Actions.
- If you want this to actually execute in GitHub-hosted runners, provide `data/ice_cream_social.db` to CI (or run this job on a self-hosted runner that has the DB file).

**Blockers:**
- GitHub checkout does not include `data/ice_cream_social.db` by default (ignored in repo), so hosted verify step will skip unless DB is supplied in CI environment.

**Tests Run:**
- `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); puts 'ci.yml syntax ok'"` — **pass**

### Current State Update (Hosted Verification Mode + Data Sync Validation)

**Done:**
- Added `verify` mode to `scripts/export_to_hosted.py` so hosted validation can run through the same env-loading path as import (`--mode verify`).
- Implemented import-source-aware verification (counts now compare hosted rows vs each table’s actual import `SELECT`, not raw SQLite table counts), which correctly handles importer filters like `transcript_segments` episode join scope.
- Added small-table mismatch diagnostics in verify output (`missing_in_hosted_ids` / `extra_in_hosted_ids`) to speed root-cause analysis when counts diverge.
- Re-imported drifted tables and completed a full hosted verification pass with all tables in sync:
  - `shows=1`, `episodes=2218`, `speakers=10`, `episode_speakers=84`, `characters=2`, `character_appearances=1`, `chapter_types=11`, `episode_chapters=10`, `audio_drops=4`, `audio_drop_instances=4`, `wiki_lore=0`, `wiki_lore_mentions=0`, `wiki_episode_meta=7`, `transcript_segments=1851398`.

**Pending:**
- Optional: run `--mode verify` periodically (or in CI) after future local backfills/edits to detect hosted drift early.

**Blockers:**
- None.

**Tests Run:**
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode import` — **pass** (full hosted import completed)
- `./venv/bin/python3.14 -m py_compile scripts/export_to_hosted.py` — **pass**
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode verify` — **pass** (all configured tables `[ok]`)
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode import --tables episode_chapters transcript_segments` — **pass**
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode verify --tables episode_chapters` — **pass**

### Current State Update (Web Phase 1: Search + Episode/Wiki Read Pages)

**Done:**
- Replaced hosted search API stub with real Postgres FTS-backed endpoint in `web/app/api/v1/search/route.ts` using shared query logic.
- Added shared transcript search utility in `web/lib/search.ts` (query normalization, pagination, `text_search` lookup, episode join shaping).
- Replaced public Search page stub with working UI in `web/app/(public)/search/page.tsx` (query form, result list, pagination, deep links to episode segments).
- Replaced Episode detail stub in `web/app/(public)/episodes/[id]/page.tsx` with live hosted reads: episode metadata, wiki summary (if present), chapters, speaker assignments, transcript preview.
- Replaced Wiki lore stub in `web/app/(public)/wiki/[slug]/page.tsx` with live hosted reads: lore summary, aliases/wiki link, first episode link, recent mention list.

**Pending:**
- Manual browse verification in `npm --prefix web run dev` against live hosted data (empty-state copy and result quality checks).
- Optional follow-up: wire a visible Wiki index/discovery surface in nav/routes (currently wiki pages are deep-linkable by slug).

**Blockers:**
- None.

**Tests Run:**
- `npm --prefix web run build` — **pass** (Next.js 15 build + type check; dynamic routes generated: `/episodes/[id]`, `/search`, `/wiki/[slug]`, `/api/v1/search`)

### Current State Update (Sound Bite Signature Phrase Save/UI Sync Fix)

**Done:**
- Fixed stale UI refresh for sound-bite signature phrase saves by invalidating the `audioDrops` static cache after updates in `scripts/dashboard-react/src/services/api.js`.
- Updated both `contentAPI.updateAudioDropTranscript()` and `contentAPI.updateAudioDropWindow()` to call `invalidateStaticCache('audioDrops')` after successful Tauri writes.
- This keeps `SpeakersPanel` in sync when it re-fetches audio drops after save, so saved signature text no longer disappears immediately in UI.

**Pending:**
- Manual in-app verification in Tauri: edit a sound bite signature phrase in Audio Identification, click Save, confirm phrase remains after refresh/reopen.

**Blockers:**
- None.

**Tests Run:**
- `npm --prefix scripts/dashboard-react run build` — **pass** (Vite production build successful)

### Current State Update (Hosted Import FK + Error-Path Fix)

**Done:**
- Updated `scripts/export_to_hosted.py` to import `episodes` in two phases: first upsert with `canonical_id=NULL`, then apply canonical self-references in a batched update. This fixes `episodes_canonical_id_fkey` failures when a row references a not-yet-inserted episode id.
- Fixed import failure handling in `scripts/export_to_hosted.py` to `ROLLBACK` before writing failed `import_batches` status, preventing `InFailedSqlTransaction` from masking the root DB error.
- Added a small transaction-safety improvement: when `import_batches` row is created, it is committed immediately so later failure status updates can be recorded.

**Pending:**
- Re-run hosted import against Supabase to confirm full end-to-end success on real credentials/network (`--mode full` or at least `--mode import --tables episodes`).

**Blockers:**
- None in local code validation; Supabase connectivity/auth still depends on local environment credentials.

**Tests Run:**
- `./venv/bin/python3.14 -m py_compile scripts/export_to_hosted.py` — **pass**
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode import --tables episodes --dry-run` — **pass** (reported `episodes: 2218`)

### Current State Update (Hosted Import Canonical Cast Fix)

**Done:**
- Updated `scripts/export_to_hosted.py` `apply_episode_canonical_links()` SQL to cast `VALUES` payload columns explicitly (`id::bigint`, `canonical_id::bigint`) before updating `episodes.canonical_id`.
- This fixes Postgres error `operator does not exist: bigint = text` seen during canonical link backfill.

**Pending:**
- Re-run hosted import against Supabase to verify full import completion after the cast fix.

**Blockers:**
- None in local validation; end-to-end verification depends on remote DB run.

**Tests Run:**
- `./venv/bin/python3.14 -m py_compile scripts/export_to_hosted.py` — **pass**

### Current State Update (Hosted Import Timestamp Normalization Fix)

**Done:**
- Added robust timestamp normalization in `scripts/export_to_hosted.py` for hosted `timestamptz` columns so loose/localized source values (for example `April 16th, 2020`) are converted to ISO-8601 before Postgres upsert.
- Applied normalization to all affected hosted fields: `episodes.published_date`, `speakers.created_at`, `characters.created_at`, `character_appearances.created_at`, `chapter_types.created_at`, `episode_chapters.created_at`, `audio_drops.created_at`, `audio_drop_instances.created_at`, `wiki_lore.last_synced`, `wiki_episode_meta.air_date`, and `wiki_episode_meta.last_synced`.

**Pending:**
- Re-run full hosted import against Supabase (`--mode import` / `--mode full`) to confirm end-to-end completion on remote DB.

**Blockers:**
- None in local validation.

**Tests Run:**
- `./venv/bin/python3.14 -m py_compile scripts/export_to_hosted.py` — **pass**
- `./venv/bin/python3.14 - <<'PY' ... normalize_timestamptz(...) sample checks ... PY` — **pass** (`April 16th, 2020` normalized to `2020-04-16T00:00:00+00:00`)
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode import --tables episodes wiki_episode_meta wiki_lore --dry-run` — **pass**

### Current State Update (Hosted Import Row-Shape Guard Fix)

**Done:**
- Fixed `normalize_timestamptz_fields()` in `scripts/export_to_hosted.py` so it only normalizes fields that already exist in each row instead of injecting missing keys.
- This resolves hosted import failures where tables without `created_at` (for example `episode_speakers`) were receiving an unexpected `created_at` column in generated upsert SQL.

**Pending:**
- Re-run hosted import against Supabase to confirm full end-to-end completion after row-shape fix.

**Blockers:**
- None in local validation.

**Tests Run:**
- `./venv/bin/python3.14 -m py_compile scripts/export_to_hosted.py` — **pass**
- `./venv/bin/python3.14 - <<'PY' ... episode_speakers key-shape check ... PY` — **pass** (no `created_at` key present)

## Session: February 26, 2026 (continued)

### Current State Update (Phase 1: Web Read Experience + Hosted Data Model)

**Done:**
- `web/supabase/migrations/001_initial_schema.sql` — Full Postgres DDL: shows, episodes, transcript_segments (tsvector FTS), speakers, episode_speakers, characters, character_appearances, chapter_types, episode_chapters, audio_drops, audio_drop_instances, wiki_lore, wiki_lore_mentions, wiki_episode_meta, import_batches. RLS enabled (anon SELECT on public episodes; service role writes all).
- `scripts/export_to_hosted.py` — Rewritten by linter with psycopg2 + psycopg2.extras.execute_values. FK-safe order, chunked batches, `import_batches` lifecycle, JSONL exports under `exports/<timestamp>/`, import log at `exports/import_log.json`. Dry-run verified: 2,218 episodes, 1,765,487 transcript segments.
- `web/` — Full Next.js 15 scaffold (TypeScript, App Router, Tailwind, `@supabase/ssr`):
  - `lib/supabase/{client,server,middleware}.ts` — browser + server + session-refresh clients
  - `lib/types.ts` — full TypeScript types for all 15 hosted tables + utilities
  - `app/layout.tsx` — root layout with nav
  - `app/(public)/episodes/page.tsx` — **implemented** Server Component: paginated episode list, category filter tabs, title search, Suspense skeleton loading
  - `app/(public)/episodes/[id]/page.tsx` — stub
  - `app/(public)/search/page.tsx` — stub
  - `app/(public)/wiki/[slug]/page.tsx` — stub
  - `app/(auth)/login/page.tsx` — stub
  - `app/(admin)/admin/page.tsx` — stub
  - `app/api/v1/episodes/route.ts` — **implemented** REST endpoint with pagination, category, q, variants params
  - `app/api/v1/search/route.ts` — stub
  - `components/episodes/EpisodeCard.tsx` — episode card with category colors, duration, date
  - `web/.env.example`, `web/.gitignore`, `next.config.ts`, `tailwind.config.ts`
- `npm run build` passes clean (10 routes, middleware 78.9kB)

**Pending (Phase 1 next steps):**
- User creates Supabase project + fills in `web/.env.local`
- Run `python scripts/export_to_hosted.py --mode full` to populate Supabase
- Apply schema: paste `web/supabase/migrations/001_initial_schema.sql` in Supabase SQL editor (or `supabase db push`)
- `cd web && npm run dev` to test episodes page against live data

**Blockers:** None — waiting on Supabase project credentials.

---

## Session: February 26, 2026

### Current State Update (Supabase Connectivity Smoke Test)

- Ran `npm --prefix web run build` successfully with `.env` loaded by Next.js
- Started Next.js dev server and called `GET /api/v1/episodes?page=1&per_page=3`
- Response was `500` with: `Could not find the table 'public.episodes' in the schema cache`
- Interpretation: Supabase credentials are wired, but hosted schema is not applied yet (or wrong project/ref), so import/app reads cannot proceed

### Current State Update (Supabase New-Key Alias Support)

- Updated web Supabase env resolution to support both naming styles:
  - New: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
  - Back-compat: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Added `web/lib/supabase/env.ts` and switched `client.ts`, `server.ts`, and `middleware.ts` to use shared env getters with explicit missing-env errors
- Updated env templates to document new key naming while keeping compatible aliases:
  - `.env.example`
  - `web/.env.example`
  - `scripts/.env.example`

### Current State Update (Phase 1 Hosted Bridge: Export/Import Pipeline + Env Templates)

- Added `scripts/export_to_hosted.py` with SQLite -> hosted pipeline modes: `export`, `import`, `full`, plus `--dry-run` and `--tables` subset support
- Pipeline behavior:
  - FK-safe table order for hosted read-model scope (`shows` through `transcript_segments`)
  - Idempotent Postgres upserts via `ON CONFLICT`
  - Chunked import for large transcript table (`transcript_segments` at batch size 1000)
  - `import_batches` lifecycle updates (`in_progress` -> `complete`/`failed`) when table exists
  - Export JSONL artifacts + manifest logging under `exports/<timestamp>/` and `exports/import_log.json`
- Added hosted env templates:
  - `web/.env.example`
  - `scripts/.env.example`
- Updated `.gitignore` for hosted artifacts and local web env files:
  - `exports/`
  - `web/.env.local`
  - `web/.env.*.local`
- Updated `ARCHITECTURE.md` with a new "Hosted Phase 1 Bridge Artifacts" section
- Added runbook: `docs/operations/HOSTED_IMPORT_PIPELINE.md`

### Current State Update (AGENTS.md / WORKFLOW.md Consolidation)

- **Done:** Merged all additive content from `docs/gpt/WORKFLOW.md` into `AGENTS.md` — added Session Start Checklist (including "avoid repeating completed work"), When To Update Handoff trigger list, Rate Limit Strategy, concrete handoff example, and Current State format definition (Done/Pending/Blockers 3-bullet minimum). Replaced `docs/gpt/WORKFLOW.md` with a 4-line pointer to `AGENTS.md` to eliminate drift.
- **Pending:** None for this task. Open items from feedTheScoops review: close Phase 0 CI, write dependency map across the 4 plans, solo-adjusted timeline, audio hosting decision before clip feed, move voice library plan to ARCHITECTURE.md.
- **Blockers:** None.



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

### Current State Update (AGENTS.md Claude Memory Note)

- Added `~/.claude/projects/.../memory/` guidance to `AGENTS.md` for tool switching handoffs
- Clarified Claude memory is supplemental context only and does not override `CLAUDE.md`, `ARCHITECTURE.md`, or `SESSIONS.md`

### Current State Update (Shared MCP Memory Setup - Codex)

- Configured Codex CLI global MCP server `memory` using `@modelcontextprotocol/server-memory`
- Shared MCP memory file path set to `/Users/ryan/.agent-memory/ice-cream-social/memory.json` (created directory; file will be created by MCP server on first write)
- Added shared MCP memory path pointer to `AGENTS.md` and `CLAUDE.md` so Claude can be configured to use the same `MEMORY_FILE_PATH`

### Current State Update (Phase 0 SDLC Foundation Artifacts)

- Added environment definitions for `local`, `staging`, and `prod` in `docs/operations/ENVIRONMENTS.md`
- Added issue templates in `.github/ISSUE_TEMPLATE/`:
  - `feature_request.md`
  - `bug_report.md`
  - `moderation_safety_issue.md`
- Added PR template with required `Tests Run` checklist in `.github/pull_request_template.md`
- Re-enabled CI on PR/push via `.github/workflows/ci.yml` (frontend build + Rust check/tests)
- Added deployment and rollback checklist in `docs/operations/DEPLOYMENT_AND_ROLLBACK_CHECKLIST.md`
- Added backup/restore runbook in `docs/operations/BACKUP_RESTORE_RUNBOOK.md`
- Updated `ARCHITECTURE.md` with environment topology + links to operations artifacts

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


### Current State Update (Hosted Import MCP Schema Drift Fix)

- **Done:** Hardened `scripts/export_to_hosted.py` import path to read live Postgres public-column metadata and drop unmapped source columns before upsert; this prevents failures like `episode_speakers.created_at` against hosted schema. Added explicit validation for missing target table metadata and missing conflict columns, with one-time drift warnings per table.
- **Pending:** Re-run a real hosted import (`--mode import` or `--mode full`) against Supabase with `DATABASE_URL` set to confirm end-to-end completion past `episode_speakers`.
- **Blockers:** None.

Tests Run
- `python3 -m py_compile scripts/export_to_hosted.py` — **PASS** (no syntax errors)
- `python3 scripts/export_to_hosted.py --mode import --dry-run --tables episode_speakers wiki_lore wiki_lore_mentions wiki_episode_meta transcript_segments` — **PASS** (table counts printed; pipeline completed)

### Current State Update (Hosted Import Env Auto-Load)

- **Done:** Updated `scripts/export_to_hosted.py` to auto-load environment variables from `.env` and `scripts/.env` before import checks, and added parser support for both `KEY=value` and `KEY: value` assignment formats.
- **Pending:** Add a real `DATABASE_URL` value to local `.env` (or export it in shell) and rerun non-dry-run hosted import.
- **Blockers:** `DATABASE_URL` is still missing in current runtime environment, so import cannot connect.

Tests Run
- `python3 -m py_compile scripts/export_to_hosted.py` — **PASS** (no syntax errors)
- `python3 - <<'PY' ... _split_env_assignment(...) ... PY` — **PASS** (`=` and `:` env line parsing validated)
- `python3 scripts/export_to_hosted.py --mode import --dry-run --tables episode_speakers wiki_lore wiki_lore_mentions wiki_episode_meta transcript_segments` — **PASS** (dry-run counts printed; pipeline completed)

### Current State Update (Root Env Template Alignment)

- **Done:** Added `DATABASE_URL` placeholder and usage note to root `.env.example` so top-level env setup includes hosted import requirements.
- **Pending:** Populate `.env` with a real `DATABASE_URL` and rerun non-dry-run hosted import.
- **Blockers:** Cannot execute hosted import without user-provided DB connection value.

Tests Run
- `rg -n "DATABASE_URL" .env.example scripts/.env.example` — **PASS** (confirmed `DATABASE_URL` documented in both templates)

### Current State Update (Hosted Import Completed)

- **Done:** Completed hosted import for `shows`, `episodes`, `speakers`, `episode_speakers`, `wiki_lore`, `wiki_lore_mentions`, `wiki_episode_meta`, and `transcript_segments` using `scripts/export_to_hosted.py`.
- **Done:** Fixed hosted import blockers by (1) adding schema-aware column filtering in importer, (2) auto-loading `.env`/`scripts/.env` for `DATABASE_URL`, (3) documenting `DATABASE_URL` in root `.env.example`, and (4) filtering `transcript_segments` export to rows whose `episode_id` exists in `episodes` to avoid FK violations from orphan local rows.
- **Pending:** Optional follow-up import of additional content tables (`characters`, `chapter_types`, `episode_chapters`, `audio_drops`, `audio_drop_instances`, etc.) if you want the hosted mirror expanded.
- **Blockers:** None.

Tests Run
- `python3 -m py_compile scripts/export_to_hosted.py` — **PASS** (script compiles)
- `python3 scripts/export_to_hosted.py --mode import --dry-run --tables episode_speakers wiki_lore wiki_lore_mentions wiki_episode_meta transcript_segments` — **PASS** (dry-run counts)
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode import --tables shows episodes speakers episode_speakers wiki_lore wiki_lore_mentions wiki_episode_meta transcript_segments` — **PASS** (import completed; transcript segments loaded)
- Supabase MCP verification SQL — **PASS**:
  - `public.shows`: 1
  - `public.episodes`: 2218 (id range 2..2219)
  - `public.episode_speakers`: 84
  - `public.transcript_segments`: 1,787,899

### Current State Update (Hosted Import Pass - Characters/Chapters/Drops)

- **Done:** Ran hosted import pass for `shows`, `episodes`, `speakers`, `characters`, `chapter_types`, `episode_chapters`, `audio_drops`, and `audio_drop_instances` successfully.
- **Done:** Verified hosted row counts via Supabase MCP: `characters=2`, `chapter_types=10`, `episode_chapters=8`, `audio_drops=4`, `audio_drop_instances=4`.
- **Pending:** Optional remaining hosted imports for other content tables (for example `character_appearances`, `wiki_*` refresh, and any additional analytics/review tables) if needed.
- **Blockers:** None.

Tests Run
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode import --tables shows episodes speakers characters chapter_types episode_chapters audio_drops audio_drop_instances` — **PASS** (import completed with expected per-table counts)
- Supabase MCP SQL checks — **PASS** (table counts match import output)

### Current State Update (Hosted Import Pass - Character Appearances)

- **Done:** Imported `character_appearances` with FK-safe parent set (`shows`, `episodes`, `speakers`, `characters`) using hosted import pipeline.
- **Done:** Verified hosted counts across all import-target tables; `character_appearances` now present (`1` row), and previously-imported tables remain populated.
- **Pending:** Optional data quality review for intentionally sparse tables (`wiki_lore=0`, `wiki_lore_mentions=0`) if you expect non-zero source data.
- **Blockers:** None.

Tests Run
- `./venv/bin/python3.14 scripts/export_to_hosted.py --mode import --tables shows episodes speakers characters character_appearances` — **PASS** (import completed; `character_appearances: 1`)
- Supabase MCP SQL aggregate count check across all hosted import-target tables — **PASS** (counts returned as expected)


### Current State Update (Voice Store SQLite Cutover + Verification Tooling)

- **Done:** Enforced SQLite embedding store for Tauri runtime voice workflows by passing `--store-mode sqlite` (and DB path where applicable) across `voice_library.py` command invocations in `episodes.rs`, `speakers.rs`, and diarization worker (`worker/diarize.rs` via `--voice-store-mode sqlite`).
- **Done:** Added strict SQLite mode behavior in `scripts/voice_library.py` (`--store-mode sqlite` now fails fast if SQLite store is unavailable; JSON writes are skipped in SQLite mode).
- **Done:** Added new voice library maintenance commands in `scripts/voice_library.py`:
  - `rebuild-from-db` (recomputes centroids from `voice_embedding_samples`)
  - `verify` (reports integrity metrics: orphan rows, missing files, centroid coverage)
- **Done:** Updated auxiliary scripts to default to SQLite store for embeddings:
  - `scripts/harvest_voice_samples.py` now supports `--store-mode` and defaults to `sqlite`
  - `scripts/extract_voice_sample.py` now supports `--store-mode` and defaults to `sqlite`
  - `scripts/speaker_diarization.py` now supports `--voice-store-mode`/`--voice-db-path` and passes them into `VoiceLibrary`
- **Pending:** Optional UI wiring for `verify` / `rebuild-from-db` if you want one-click controls in Settings/Speakers panel.
- **Blockers:** None.

Tests Run
- `python3 -m py_compile scripts/voice_library.py scripts/speaker_diarization.py scripts/harvest_voice_samples.py scripts/extract_voice_sample.py` — **PASS** (all scripts compile)
- `./venv/bin/python3.14 scripts/voice_library.py verify --backend pyannote --db-path data/ice_cream_social.db --store-mode sqlite` — **PASS** (command executes and returns JSON integrity report)
- `./venv/bin/python3.14 scripts/voice_library.py rebuild-from-db --backend pyannote --db-path data/ice_cream_social.db --store-mode sqlite` — **PASS** (centroids rebuilt from DB samples)
- `cargo check --manifest-path src-tauri/Cargo.toml` — **PASS** (build check succeeded; existing dead_code warning unchanged)
- `cargo test --manifest-path src-tauri/Cargo.toml` — **PASS** (`49 passed, 0 failed`)

### Current State Update (Playwright Re-enabled + Voice Flow E2E Harness)

- **Done:** Re-enabled Playwright GitHub workflow on push/PR in `.github/workflows/playwright.yml` and updated it to install both root + dashboard dependencies before running tests.
- **Done:** Updated Playwright setup to current published version `@playwright/test@1.58.2` and added root npm scripts (`test:e2e`, headed/UI variants, browser install helper).
- **Done:** Replaced brittle legacy external/backend-dependent Playwright specs with deterministic local tests:
  - `tests/ice-cream-social.spec.ts` now validates voice sample + voiceprint UI flow via a dedicated harness page.
  - `tests/example.spec.ts` now validates local harness page load (no external site dependency).
- **Done:** Added `scripts/dashboard-react/public/e2e-voice-flow.html` harness that exercises the same frontend API calls used by UI (`save_voice_samples` + `get_voice_library`) in a mocked Tauri IPC mode.
- **Done:** Added Playwright-friendly Tauri mock support in `scripts/dashboard-react/src/services/tauri.js` (`window.__TAURI_MOCK__` support for `invoke`/`listen`).
- **Pending:** True native Tauri window E2E (real IPC + filesystem + DB in app window) would still require a dedicated Tauri-driver/WebDriver setup; current harness validates frontend command wiring deterministically.
- **Blockers:** None.

Tests Run
- `npm view @playwright/test version` — **PASS** (`1.58.2`)
- `npm install` — **PASS** (updated lockfile/deps)
- `npx playwright --version` — **PASS** (`Version 1.58.2`)
- `npx playwright install chromium` — **PASS** (installed Chromium + headless shell)
- `npx playwright test` — **PASS** (`2 passed`)
- `npm --prefix scripts/dashboard-react run build` — **PASS** (Vite production build succeeds)
