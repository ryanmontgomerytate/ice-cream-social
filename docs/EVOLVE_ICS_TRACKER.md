# Evolve ICS Tracker

Last updated: February 28, 2026

Purpose: execution tracker for the "Evolve ICS to web + phone-ready platform" plan.
Source strategy:
- Planning context: `feedTheScoops.md`
- Architecture source of truth: `ARCHITECTURE.md`
- Session-by-session log: `SESSIONS.md`
- Clip feed execution tracker: `docs/TIKTOK_CLIP_FEED_TRACKER.md`
- Voice library roadmap/deferred scope: `docs/VOICE_LIBRARY.md`
- GitHub Project mirror runbook: `docs/operations/GITHUB_PROJECT_BOARD.md`

## Status Legend
- `done`: completed and validated
- `in_progress`: active work in flight
- `blocked`: cannot proceed until dependency is resolved
- `not_started`: planned but not yet executed

## Phase Tracker

| Phase | Status | What is complete | What is next |
|---|---|---|---|
| Phase 0: SDLC foundation | `done` | CI workflow restored; issue/PR templates; deployment + backup runbooks; architecture doc restored; Rust fmt violations fixed in `src-tauri`. | Monitor CI for regressions and enforce formatting pre-commit/PR. |
| Phase 1: Web read + hosted model | `done` | Supabase schema + import pipeline; hosted import/verify modes; web episodes/search/wiki/episode detail reads live; hosted verify job wired in Actions; wiki index/discovery route shipped; ranked search RPC + fallback path implemented; migration applied and validated in hosted Supabase; fast search RPC timeout-degrade path added and validated; relevance/tie-break tuning applied (`006_search_relevance_tuning.sql`) and validated in hosted Supabase. | Monitor search quality/latency in production and capture follow-up tuning as incremental issues. |
| Phase 2: Community editing + moderation | `in_progress` | Hosted Phase 2 schema foundation migration added/applied (`profiles`, roles/memberships, revisions, pending edits, moderation queue/actions, reports, trust/rate-limit/audit, import batch items); admin dashboard shipped; moderation write action path shipped (`/api/v1/admin/moderation-actions`) with DB RPC + RLS moderator/admin policies; report/system_flag queue resolution shipped (`resolve`/`dismiss`) via migration `008_phase2_moderation_queue_resolution.sql`; non-stub login/auth status UX shipped (`/login` + `/api/v1/auth/me`); profile bootstrap helpers/trigger added and admin read APIs moved to authenticated moderator/admin checks. | Add richer role-management UX beyond bootstrap allowlists and improve moderator workflow ergonomics (history/triage context). |
| Phase 3: Phone-first polish | `not_started` | Responsive foundations present in web pages. | Add PWA manifest/install flow and mobile UX performance/accessibility pass. |
| Phase 4: Multi-show generalization | `not_started` | `shows` support exists in hosted schema. | Add show-scoped routing/config and API/UI show selection patterns. |

## Active Workstreams

| Workstream | Status | Notes |
|---|---|---|
| Hosted import parity | `done` | Full local import-source vs hosted verification passing locally. |
| GitHub hosted verification | `done` | Hosted verify workflow now reports/enforces verify mode: `parity` (SQLite+hosted), `integrity` fallback (hosted-only), and fails on `skipped`; runbook updated with `SQLITE_DB_URL` guidance for full parity on GitHub-hosted runners. |
| Voice library SQLite migration | `in_progress` | Core runtime paths switched to SQLite store mode; optional UI actions pending. |
| Web observability (Sentry) | `done` | Sentry integrated in Next.js runtime (client/server/edge/global error), smoke-tested event ingestion, and targeted spans added for search + moderation actions. |
| Phase 2 moderation schema | `done` | Phase 2 foundation tables migrated and validated in hosted Supabase. |
| Phase 2 moderation API (read) | `done` | Authenticated moderator/admin-gated read endpoints + `/admin` dashboard wired for pending edits, moderation queue, and revisions. |
| Phase 2 moderation API (write) | `in_progress` | `POST /api/v1/admin/moderation-actions` now supports approve/reject/needs_changes/assign/unassign plus report/system_flag resolve+dismiss using authenticated role checks and RLS-backed RPC. |
| Phase 2 auth UX + role bootstrap | `in_progress` | `/login` now supports Supabase sign-in/up/magic-link/sign-out and `/api/v1/auth/me`; profile auto-provision trigger/helper + optional env allowlist role bootstrap shipped. |
| Playwright modernization | `done` | Deterministic test harness in place and workflow enabled. |
| TikTok-style clip feed | `not_started` | Dedicated tracker created; implementation phases pending. |

## Current Blockers

None.

## Next 3 Priority Tasks

1. Add richer role-management UX for Phase 2 (beyond bootstrap allowlists).
2. Add moderation action history + triage context in `/admin` for faster queue handling.
3. Add guardrails to keep Rust formatting enforced before CI (local hook or dedicated check guidance).

## Update Rule

When any roadmap task is completed:
1. Update this tracker status row(s).
2. Append full technical details in `SESSIONS.md` (Done/Pending/Blockers/Tests Run).
3. If schema/architecture changed, update `ARCHITECTURE.md`.
