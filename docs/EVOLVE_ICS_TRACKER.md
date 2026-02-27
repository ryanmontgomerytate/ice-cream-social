# Evolve ICS Tracker

Last updated: February 27, 2026

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
| Phase 1: Web read + hosted model | `in_progress` | Supabase schema + import pipeline; hosted import/verify modes; web episodes/search/wiki/episode detail reads live; hosted verify job wired in Actions. | Add wiki index/discovery page and tighten search ranking relevance. |
| Phase 2: Community editing + moderation | `not_started` | Requirements captured in `feedTheScoops.md`. | Implement auth, revision model, moderation queue, and abuse controls. |
| Phase 3: Phone-first polish | `not_started` | Responsive foundations present in web pages. | Add PWA manifest/install flow and mobile UX performance/accessibility pass. |
| Phase 4: Multi-show generalization | `not_started` | `shows` support exists in hosted schema. | Add show-scoped routing/config and API/UI show selection patterns. |

## Active Workstreams

| Workstream | Status | Notes |
|---|---|---|
| Hosted import parity | `done` | Full local import-source vs hosted verification passing locally. |
| GitHub hosted verification | `in_progress` | Secret/env wiring done; fallback hosted checks run in Actions; optional `SQLITE_DB_URL` still not configured. |
| Voice library SQLite migration | `in_progress` | Core runtime paths switched to SQLite store mode; optional UI actions pending. |
| Playwright modernization | `done` | Deterministic test harness in place and workflow enabled. |
| TikTok-style clip feed | `not_started` | Dedicated tracker created; implementation phases pending. |

## Current Blockers

| Blocker | Impact | Resolution path |
|---|---|---|
| No `SQLITE_DB_URL` secret for Actions | Full source-vs-hosted parity check skipped on hosted runner | Add downloadable DB snapshot URL secret or run verify on self-hosted runner with local DB. |

## Next 3 Priority Tasks

1. Add wiki index/discovery route and nav link in web app.
2. Start Phase 2 schema + API foundation for revisions/moderation queue.
3. Add guardrails to keep Rust formatting enforced before CI (local hook or dedicated check guidance).

## Update Rule

When any roadmap task is completed:
1. Update this tracker status row(s).
2. Append full technical details in `SESSIONS.md` (Done/Pending/Blockers/Tests Run).
3. If schema/architecture changed, update `ARCHITECTURE.md`.
