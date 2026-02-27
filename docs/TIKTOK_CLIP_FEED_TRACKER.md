# TikTok-Style Clip Feed Tracker

Last updated: February 27, 2026

Purpose: execution tracker for the "TikTok-style podcast clip feed" roadmap in `feedTheScoops.md`.

Source strategy:
- Product/architecture plan: `feedTheScoops.md` (clip-feed section)
- System architecture constraints: `ARCHITECTURE.md`
- Delivery log: `SESSIONS.md`
- GitHub Project mirror runbook: `docs/operations/GITHUB_PROJECT_BOARD.md`

## Status Legend
- `done`: completed and validated
- `in_progress`: active implementation
- `blocked`: dependency/risk blocks progress
- `not_started`: planned but not yet implemented

## Phase Tracker

| Phase | Status | What is complete | What is next |
|---|---|---|---|
| Phase 0: Feed foundation | `not_started` | Plan defined (schema/API/ranking/moderation concepts documented). | Implement hosted clip schema + rights policy + import contract. |
| Phase 1: Internal alpha feed | `not_started` | Prerequisite hosted read stack exists (episodes/search/wiki). | Build vertical feed UI + seed clip generation + candidate feed endpoint. |
| Phase 2: Community submissions | `not_started` | Moderation concept and open-submission policy defined. | Add clip submission flow, moderation queue/actions, abuse controls. |
| Phase 3: Chains/reels/compilations | `not_started` | Data model direction defined (`clip_segments`, chains, character sets). | Build chain editor + character reel generation. |
| Phase 4: Social distribution/platformization | `not_started` | Future direction documented (cross-show, sharing, optional audiograms). | Add distribution pipeline + cross-show feed architecture. |

## Core Workstreams

| Workstream | Status | Notes |
|---|---|---|
| Clip data model + policies | `not_started` | Need `clips`, `clip_segments`, `clip_tags`, moderation + rights fields. |
| Feed API + ranking engine | `not_started` | Hybrid ranking spec exists; implementation not started. |
| Playback UX (mobile vertical feed) | `not_started` | Audio + waveform UX planned; no shipped feed route yet. |
| Moderation + safety | `not_started` | Required for open submissions; pending schema + admin UI. |
| Sharing + social metadata | `not_started` | Canonical clip URLs/OG payloads not yet implemented. |

## Current Blockers

| Blocker | Impact | Resolution path |
|---|---|---|
| Community edit/moderation stack not built yet | Clip submissions unsafe to launch | Deliver Phase 2 moderation primitives first (queue, actions, rollback, rate limits). |
| Clip schema not in hosted DB | No persisted feed catalog | Add clip tables + migrations in web/supabase. |
| Clip asset pipeline undefined for hosted runners | Playback reliability risk | Decide `audio_asset_url` generation/storage path (pre-render preferred). |

## Next 3 Priority Tasks

1. Create clip-feed hosted schema migration (`clips`, `clip_segments`, moderation/report tables, rights fields).
2. Add read-only feed API + vertical feed page using seeded admin clips.
3. Add admin-only clip publishing workflow before opening community submissions.

## Update Rule

When clip-feed scope changes:
1. Update this tracker statuses.
2. Add implementation/testing details in `SESSIONS.md`.
3. Update `ARCHITECTURE.md` if clip-feed storage/runtime design changes.
