Operation Feed the Scoops

  # Plan: Evolve Ice Cream Social From Mac-Only Tauri App to Web + Phone-Ready Community Platform

  ## Summary

  ### Why build this

  Build a hosted fan knowledge/community experience for podcast moments (episodes, bits, characters, timestamps, relive-able moments), starting with Ice Cream Social and later reusable for
  other podcasts (and eventually YouTube-like series).

  ### Current-state assessment (repo-based)

  - Desktop-first app: Tauri + Rust backend + React frontend (src-tauri/, scripts/dashboard-react/).
  - React UI is reusable for web, but many core actions are still Tauri-only IPC (scripts/dashboard-react/src/services/tauri.js, scripts/dashboard-react/src/services/api.js).
  - Local embedded DB only (data/ice_cream_social.db, SQLite via rusqlite in src-tauri/src/database/mod.rs).
  - No visible user/auth/admin role system yet (no user/admin tables in SQLite).
  - CI is weak right now: Playwright workflow exists but is disabled for push/PR (.github/workflows/playwright.yml).
  - Backend unit tests exist (49 Rust tests listed), frontend tests are minimal.
  - Process gap: ARCHITECTURE.md is referenced as source-of-truth but missing in repo root.

  ### Decisions locked from your input

  - First public release target: Community contributions
  - Phone support: Mobile web first
  - Moderation model: Open wiki edits (high abuse risk, requires admin trust systems immediately)
  - Budget target: < $100/month
  - Processing model: Hybrid selective cloud
  - Productization approach: ICS-first, refactor later
  - Rights posture (your preference): Full transcripts public (legal/takedown risk must be actively managed)

  ———

  ## Product Plan (PM View)

  ## Product vision (v1 to v2)

  - v1: Public searchable fandom site for ICS with episode pages, timestamps, moments, wiki-style contributions, moderation queue.
  - v1.5: PWA/mobile polish, trust/reputation, contributor workflows.
  - v2: Multi-show platform model (other podcasts as tenants), optional YouTube series support.

  ## Core user jobs-to-be-done

  - Fans: “When did they do that bit?” / “Relive a moment”
  - Contributors: add timestamps, corrections, lore, tags, summaries
  - Admin/mods: approve/revert edits, block abuse, maintain quality
  - You (operator): publish safely, keep costs low, reuse architecture later

  ## v1 scope (decision-complete)

  - Public episode browse/search
  - Episode detail pages with:
      - metadata
      - transcript (or transcript + snippet mode fallback if rights issues)
      - timestamped segments
      - fan-contributed “moments”
      - links to official audio source
  - Wiki/lore pages for recurring bits/characters
  - User accounts (email magic link or OAuth)
  - Open editing with moderation safeguards:
      - revision history
      - moderation queue
      - rollback
      - rate limits
      - spam detection
  - Admin dashboard (basic)
  - Mobile-responsive web (PWA installable)

  ## Out of scope for v1 (explicit)

  - Native iOS/Android apps
  - Full cloud transcription/diarization pipeline
  - Social feed/comments/reactions
  - Billing/white-label self-serve tenant onboarding
  - Advanced ML moderation

  ## Success criteria (first 90 days after launch)

  - Users can reliably find episodes/moments from search on phone + desktop
  - Community edits can be reversed and moderated without DB surgery
  - No major downtime/data loss
  - Monthly infra stays under budget target
  - Clear path to onboard second podcast without schema rewrite

  ———

  ## Target Architecture (Architect View)

  ## Recommended architecture (low-cost + scalable enough)

  ### Frontend

  - Next.js web app (TypeScript) for SEO + mobile responsiveness + admin pages
  - PWA support for phones (installable, offline shell for browse pages)
  - Reuse UI concepts from current React app, but not direct copy of all editor/admin desktop workflows

  ### Backend / API

  - Supabase (Postgres + Auth + Storage + RLS) as primary hosted backend
  - Next.js API routes or Supabase Edge Functions for app-specific endpoints
  - Optional small worker service later (Railway/Fly) for import jobs / heavy syncs if needed

  ### Search

  - Start with Postgres full-text + trigram indexes
  - Add Meilisearch/Typesense only if search latency/relevance becomes a problem

  ### Storage

  - Postgres for structured data + revisions + moderation
  - Object storage (Supabase Storage or Cloudflare R2) for derived assets/images
  - Do not require re-hosting audio in v1; store official source links/embeds

  ### Processing (hybrid, per your choice)

  - Keep heavy transcription/diarization offline/admin-side (your Mac or dedicated batch machine)
  - Add cloud-side light jobs only:
      - import validated exports
      - moderation notifications
      - search indexing refresh
      - metadata sync

  ———

  ## Hosted vs Local: What Changes In Storage

  ## Today (local desktop)

  - Single SQLite file (data/ice_cream_social.db)
  - Tauri IPC commands call Rust DB methods directly
  - Local file paths (audio_file_path) assume your machine
  - No multi-user concurrency/auth/audit boundaries
  - Local trust = “you are the admin”

  ## Hosted (required changes)

  - Multi-user database with auth identities, roles, permissions, audit logs
  - No local filesystem assumptions in public app
  - Public/private separation:
      - published content
      - pending edits
      - moderation actions
  - Revisioned content model (wiki-style)
  - Rate limiting / abuse prevention data
  - Backups + restore process
  - Staging/prod environments
  - Secrets managed in hosted env, never local-only assumptions

  ———

  ## Data Model Plan (v1, ICS-first but future-friendly)

  ## Keep and migrate (map from current tables)

  Retain concepts from current schema:

  - episodes
  - transcript_segments
  - characters
  - character_appearances
  - chapter_types / episode_chapters
  - wiki_lore / lore mentions
  - flagged_segments
  - transcript_corrections
  - segment_classifications

  ## Add required hosted/community tables

  - users
  - profiles
  - roles (admin, moderator, trusted_editor, member)
  - user_role_assignments
  - shows (for future multi-podcast)
  - show_memberships (admin/mod scoped to show)
  - content_revisions
  - pending_edits
  - moderation_queue
  - moderation_actions
  - reports
  - rate_limit_events
  - trust_scores (or derived metrics view)
  - audit_log
  - import_batches
  - import_batch_items

  ## Recommended generalized core entities (prepare for podcast + YouTube later)

  - shows
      - source type (podcast_rss, youtube_channel, later others)
  - media_items (generic episode/video row)
      - ICS can map current episodes into this later
  - segments
  - entities (characters, bits, guests, topics)
  - entity_mentions
  - moments (fan-curated highlight objects with title + timestamp range)
  - revisions (for wiki and moments)

  ICS-first implementation shortcut:

  - Keep episodes table naming in v1 web launch.
  - Add show_id.
  - Design APIs so a later migration to media_items is behind the API layer, not client-breaking.

  ———

  ## Admin / Trust / Safety Plan (Critical because you chose open wiki edits)

  ## Minimum admin features required for launch

  - Admin login + role management
  - Moderation queue with filters:
      - new edits
      - suspected spam
      - mass edits
      - abuse reports
  - One-click actions:
      - approve
      - reject with reason
      - rollback to revision
      - lock page / lock episode
      - temporary user mute/suspend
  - Audit trail page (who changed what, when)

  ## Trust system (v1 simple, v1.5 stronger)

  ### v1

  - New users can edit, but edits from low-trust users default to pending
  - Trust score increases with approved edits
  - Rate limits by account + IP
  - Link limits / text length caps / flood protection
  - Basic spam heuristics (duplicate content, repeated links, rapid edits)

  ### v1.5

  - Trusted users can auto-publish low-risk edits
  - Risk-based moderation (high-risk always queued)
  - Abuse pattern dashboards

  ## Legal/content safeguards (must-have, especially with full public transcripts)

  - Terms of Use + Privacy Policy + Community Guidelines
  - DMCA/takedown contact and workflow
  - Content provenance fields (source_url, imported_by, imported_at)
  - Ability to unpublish transcript pages quickly (feature flag / visibility toggle)
  - Transcript visibility modes per show:
      - full transcript
      - excerpt-only
      - metadata-only
        This keeps you safe if rights posture changes later.

  ———

  ## Public APIs / Interfaces / Types To Add (Lead Developer Spec)

  ## Frontend client abstraction (required for reuse)

  Replace direct Tauri/HTTP branching with a stable interface:

  - BackendClient
      - getEpisodes(filters)
      - getEpisode(id)
      - searchSegments(query, filters)
      - getMoments(episodeId)
      - createEditProposal(payload)
      - createMoment(payload)
      - getWikiPage(slug)
      - submitWikiRevision(payload)
      - getModerationQueue(filters) (admin)
      - moderateAction(payload) (admin)

  Implementations:

  - TauriClient (existing desktop, internal tools)
  - WebClient (hosted API)

  ## New web API endpoints (REST v1)

  - GET /api/v1/shows/:showSlug/episodes
  - GET /api/v1/shows/:showSlug/episodes/:episodeId
  - GET /api/v1/shows/:showSlug/search
  - GET /api/v1/shows/:showSlug/wiki/:slug
  - POST /api/v1/shows/:showSlug/wiki/:slug/revisions
  - POST /api/v1/shows/:showSlug/moments
  - POST /api/v1/reports
  - GET /api/v1/admin/moderation-queue
  - POST /api/v1/admin/moderation-actions
  - POST /api/v1/import-batches (admin only, offline export import)

  ## Import/export contract (bridge from Mac app to hosted)

  Create a versioned export format from local DB for hosted sync:

  - schema_version
  - show
  - episodes[]
  - segments[] (chunked)
  - entities[]
  - chapters[]
  - moments[] (later)
  - wiki_pages[]
  - corrections[]
  - flags[]
  - checksums per chunk

  This lets your Mac remain the processing machine while the site stays hosted.

  ———

  ## Delivery Plan (Phased, implementation-ready)

  ## Phase 0: Stabilize SDLC foundation (1-2 weeks)

  - Create missing ARCHITECTURE.md (current + target architecture)
  - Define environments: local, staging, prod
  - Add issue templates:
      - feature
      - bug
      - moderation/safety issue
  - Add PR template with test checklist
  - Re-enable CI on PRs (at minimum lint/build/test)
  - Add deployment checklist and rollback checklist
  - Create data backup/restore runbook

  ## Phase 1: Web read experience + hosted data model (2-4 weeks)

  - Stand up Supabase project
  - Design and migrate initial hosted schema (episodes/segments/wiki/entities + users/roles/revisions/mod queue)
  - Build Next.js web app:
      - episode list/detail
      - search
      - wiki page read views
      - mobile responsive layouts
  - Build import pipeline from local SQLite export -> hosted Postgres
  - Seed ICS data (metadata + transcripts/segments + characters + chapters)

  ## Phase 2: Community editing + moderation (3-5 weeks)

  - Auth (magic link or OAuth)
  - Edit submission forms (wiki/moments/corrections)
  - Revision history and diff views
  - Moderation queue + admin actions
  - Rate limiting + anti-spam heuristics
  - Reports and abuse handling

  ## Phase 3: Phone-first polish (2-3 weeks)

  - PWA install + icons + manifest
  - Mobile navigation and performance tuning
  - Search UX optimized for thumbs
  - Timestamp deep links + “open in podcast app” behavior
  - Accessibility pass (keyboard, screen reader, contrast)

  ## Phase 4: Generalize for non-ICS shows (2-4 weeks)

  - Add show_id across web APIs and UI routing
  - Theme/config per show (branding, source links, visibility rules)
  - RSS ingestion adapter abstraction
  - Optional YouTube source adapter design (channel, video, caption segments) without full rollout yet

  ———

  ## Better SDLC (How to work like PM + Architect + Lead Dev + QA as a small team)

  ## Operating cadence (solo-founder friendly)

  ### Weekly structure

  - PM block (30-60 min): write/refresh one-page spec for next feature
  - Architect block (30-60 min): data/API decisions before coding
  - Dev block: implement in small PRs
  - QA block: test plan + manual acceptance + bug triage
  - Release block: deploy + monitor + log decisions in SESSIONS.md

  ## Required artifacts per feature (lightweight, not enterprise-heavy)

  - Feature Brief (why / user / success metric / scope)
  - Technical Spec (schema/API/UI flow)
  - Test Plan (happy path + edge cases + abuse cases)
  - Release Notes (what changed, migrations, rollback)

  ## Branching and review policy

  - Branch per feature/fix
  - Small PRs only
  - No direct changes to prod branch without passing CI
  - Use checklist-based self-review if solo

  ## Definition of Done (new standard)

  A feature is done only when:

  - code implemented
  - tests added/updated
  - manual QA scenarios run
  - docs updated (SESSIONS.md, ARCHITECTURE.md if schema/architecture changed)
  - monitoring/logging considered
  - rollback path documented (for DB/API changes)

  ———

  ## QA/Test Plan (QA/Tester Spec)

  ## Current gaps to address

  - Frontend automated tests are sparse
  - CI disabled for continuous feedback
  - No contract tests between UI and API
  - No moderation abuse-case tests yet

  ## Test pyramid for new hosted app

  - Unit tests:
      - revision diff logic
      - trust scoring
      - rate-limit decisions
      - validation/sanitization
  - Integration tests:
      - API + DB (auth, edits, moderation actions)
      - import pipeline chunk ingestion
  - E2E tests (Playwright):
      - search -> episode -> timestamp -> submit edit
      - moderator approve/reject/rollback
      - mobile viewport flows
  - Security/abuse tests:
      - spam burst
      - duplicate edits
      - XSS payloads in wiki content
      - permission bypass attempts
  - Data quality tests:
      - transcript segment ordering
      - timestamp bounds
      - orphan records after import

  ## Acceptance scenarios (must pass before public launch)

  - Anonymous user can browse/search on mobile
  - New user can submit an edit without breaking page rendering
  - Moderator can revert bad edit in <1 minute
  - Suspended user cannot continue editing via same session
  - Import job can refresh an episode without duplicating segments
  - Site remains usable if transcript page is temporarily disabled (rights fallback)

  ———

  ## Cost Plan (< $100/mo target)

  ## v1 recommended budget envelope

  - Hosting (Next.js): low/free tier initially
  - Supabase (DB/Auth/Storage): paid starter once traffic grows
  - Domain + email: low fixed cost
  - Optional error monitoring (Sentry free tier initially)
  - Optional CDN/image optimization: mostly bundled / low cost

  ## Cost controls (important)

  - Keep heavy AI/transcription off hosted infra at launch
  - Add quotas on edit frequency / API usage if abuse spikes

  ———

  ## Key Risks and Planned Mitigations

  - Open wiki edits increases spam/abuse risk
      - Mitigation: moderation queue, rate limits, trust gating, rollback, audit logs
  - Full transcripts public increases copyright/takedown risk
      - Mitigation: transcript visibility controls, takedown workflow, source linking, fast unpublish
  - Tauri/web divergence can create two codebases
      - Mitigation: shared domain types + BackendClient abstraction + API-first contracts
  - Low budget limits cloud processing
      - Mitigation: hybrid pipeline with offline ingestion and cloud serving only

  ———

  ## Explicit assumptions and defaults chosen

  - Hosted v1 is web/PWA only (no native mobile apps yet).
  - Your Mac (or another admin machine) remains the primary transcription/diarization engine initially.
  - ICS launches first; multi-show support is enabled by schema/API patterns, not full product UI in v1.
  - If legal pressure or rights constraints emerge, transcript visibility can be switched per show without redesign.
  - Admin/moderation is required at launch because you selected open edits.
  - We will not monetize ICS directly in v1; platform monetization exploration happens after stable multi-show architecture is proven.

  ## Revenue path later (without monetizing ICS directly)

  - Use ICS as a flagship/demo community
  - Productize reusable “Podcast Fandom Platform” for other creators:
      - hosted fandom wiki + moments search
      - moderation/admin tools
      - branded PWA
      - optional premium analytics or managed ingestion
  - Extend source adapters to YouTube channels/videos using the same show -> media item -> segment -> moment -> revision model




  Patreon supports OAuth and membership/entitlement data via API v2, so this is feasible. The key design choices are what exactly you want to gate and how strict the entitlement checks
  should be, because those choices change the schema, API, and moderation flow.

• Questions 3/3 answered
  • What should Patreon auth unlock in the hosted app for users?
    answer: Premium pages/transcripts (Recommended)
  • How should access be determined for ICS Patreon content?
    answer: Any active patron (Recommended)
  • How should Patreon auth fit with your general user accounts?
    answer: Primary app login + link Patreon (Recommended)

• Searched Patreon API v2 OAuth docs official

• Searched https://docs.patreon.com/

• Searched 'GET /api/oauth2/v2/identity' in https://docs.patreon.com/

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Yes. For your hosted app, the right first Patreon integration is:

  - Patreon OAuth login/link
  - server-side entitlement check
  - gate premium pages/transcripts in your app
  - do NOT expose your creator Patreon RSS token to users

  That matches your choices (primary app login + link Patreon, any active patron, premium pages/transcripts).

  ## What this feature is (PM framing)

  Goal:

  - Let a user connect Patreon to their account so your site can verify they are an active ICS patron and unlock Patreon-only ICS content in your site.

  Why:

  - You avoid manual access management.
  - You keep premium content access aligned with real Patreon membership.
  - You can still run your own fandom/community UX on top.

  ## Important architecture decision (the big one)

  Use Patreon for entitlement verification, not as your primary content delivery API (at least v1).

  Recommended v1:

  - Your app stores/serves the curated content (pages/transcripts/moments)
  - Patreon OAuth verifies membership status
  - Your API decides access (allow/deny) based on entitlement snapshot

  Avoid in v1:

  - Proxying Patreon audio downloads through your server
  - Shipping creator RSS auth tokens to clients
  - Using Patreon as the only identity provider

  ## Current repo reality (why this matters)

  Today Patreon is just a feed source tag (episodes.feed_source = 'patreon') and local/private ingestion.
  There is no user/auth/entitlement model yet.

  So this is not “add one endpoint”; it’s a new auth + access-control subsystem.

  ## Patreon API shape to build around (current docs)

  Patreon supports OAuth + API v2.
  Useful pieces:

  - OAuth authorization code flow
  - GET /api/oauth2/v2/identity for current user
  - memberships relationship / scopes
  - member entitlement via currently_entitled_tiers and patron_status (for stricter tier logic later)

  Patreon docs:

  - https://docs.patreon.com/
  - Patreon API help article (support posture): https://support.patreon.com/hc/en-us/articles/206525646-Patreon-API

  ## v1 Implementation Plan (Architect + Lead Dev spec)

  ### 1) Data model additions (hosted DB)

  Add tables:

  - users
  - user_identities (generic external identity links)
  - patreon_connections
      - user_id
      - patreon_user_id
      - access_token (encrypted at rest)
      - refresh_token (encrypted at rest)
      - token_expires_at
      - last_sync_at
      - last_sync_status
      - patron_status (snapshot)
      - currently_entitled_amount_cents (snapshot)
      - membership_active (derived boolean)
  - show_access_grants
      - user_id
      - show_id
      - source (patreon)
      - status (active, expired, revoked)
      - granted_at
      - expires_at (optional)
      - metadata_json (campaign/member/tier ids snapshot)
  - access_audit_log (optional but recommended)

  ### 2) Content gating fields

  Add per-content visibility fields (or central policy table):

  - episodes.visibility: public | patron_only | admin_only
  - Optional per transcript/page visibility if mixed within an episode

  This also helps with copyright controls later.

  ### 3) API endpoints to add (hosted)

  User-facing:

  - GET /api/v1/auth/patreon/start
  - GET /api/v1/auth/patreon/callback
  - POST /api/v1/auth/patreon/unlink
  - GET /api/v1/me/patreon-status

  Access-controlled content:

  - GET /api/v1/shows/:showSlug/episodes/:id (server enforces visibility)
  - GET /api/v1/shows/:showSlug/episodes/:id/transcript
  - GET /api/v1/shows/:showSlug/moments/...

  Admin:

  - POST /api/v1/admin/patreon/sync-user/:userId
  - POST /api/v1/admin/patreon/sync-campaign-members (later)
  - GET /api/v1/admin/patreon/sync-status

  ### 4) Auth flow (decision-complete)

  1. User logs into your app (email/OAuth).
  2. User clicks Link Patreon.
  3. Server redirects to Patreon OAuth (with state + PKCE if your stack supports it).
  4. Patreon redirects back with code.
  5. Server exchanges code for tokens (server-side only).
  6. Server calls Patreon identity endpoint and reads membership info.
  7. Server stores Patreon connection + entitlement snapshot.
  8. Server grants show_access_grants for ICS if active patron.
  9. UI updates to show linked status and unlocked content.

  ### 5) Entitlement rule (your chosen v1)

  - Allow if user has an active membership to your ICS Patreon campaign.
  - Ignore tiers initially (store tiers for future use).
  - Recheck entitlement:
      - on Patreon link callback
      - on login/session refresh (throttled)
      - before serving patron-only content if snapshot is stale (e.g., >24h)

  ### 6) Token/security requirements (critical)

  - Never store Patreon tokens in frontend/localStorage
  - Encrypt Patreon access/refresh tokens at rest
  - Keep Patreon client secret server-side only
  - Rotate and refresh tokens automatically
  - Add User-Agent header on Patreon API calls (Patreon docs note 403 risk otherwise)
  - Log minimal Patreon data (no raw token logs)
  - Unlink must revoke local tokens immediately

  ## QA/Test plan (for this feature)

  Unit tests:

  - entitlement evaluator (active membership => access)
  - stale snapshot refresh logic
  - visibility policy checks

  Integration tests:

  - OAuth callback success/failure
  - token refresh flow
  - patron-only endpoint returns 403 when unlinked/inactive
  - linking updates show_access_grants

  E2E tests:

  - user links Patreon -> premium ICS episode unlocks
  - inactive/non-patron user sees upgrade/locked state
  - unlink Patreon -> premium pages relock

  Security tests:

  - callback state mismatch rejected
  - user cannot access another user’s Patreon status
  - no tokens returned in API responses
  - rate limit on auth callbacks/status endpoints

  ## Product/UX notes you should include

  - “Connect Patreon” settings page
  - clear lock state on premium pages
  - fallback message if Patreon API is temporarily unavailable
  - manual override for admin (temporary grant) if Patreon sync breaks

  ## What not to do (common mistake)

  Do not reuse your creator Patreon RSS secret/token to “authenticate users.”
  That token grants broad feed access and is not user-specific entitlement.

  ## Next planning decision (if you want me to spec it)

  I can draft the exact endpoint contracts + DB schema for:

  1. Supabase + Next.js implementation, or
  2. Rust backend implementation first (if you want to prototype Patreon auth in the current Tauri/Rust code before web migration)

  Sources:

  - Patreon API docs: https://docs.patreon.com/
  - Patreon API Help Center article (updated Feb 19, 2025): https://support.patreon.com/hc/en-us/articles/206525646-Patreon-API



  › create a plan for we could have social media tiktok like feed of podcast segments to scroll and listen. (This is kind of an ultimate goal) This could be shareable across all social media
  platforms and its own stand alone platform. inspiration(https://github.com/rebane2001/xikipedia aslo the algorthrim) this could be from individual clips from different episodes, clips
  highed as chapters, clips strung toghter as bits, clips of a single character, clips of different charaters.


• I’ll ground this in your current app first by checking the clip/chapter/segment data you already have and then I’ll review the xikipedia inspiration repo so the feed plan is concrete and
  algorithm-aware.

• Explored
  └ Search chapter|clip|segment|character_appearances|audio_drop in content.rs

• Searched rebane2001 xikipedia github algorithm tiktok feed

• Searched https://github.com/rebane2001/xikipedia

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• I’ve got enough context to draft this in a way that reuses your existing segments, chapters, audio_drops, and character appearance concepts, and I also reviewed the Xikipedia-style local
  algorithm pattern. I need three product decisions before finalizing because they change the feed architecture a lot: what media is actually played, who can publish clips, and whether the
  first algorithm is local-personalized or server-ranked.

• Questions 3/3 answered
  • What should users actually listen/watch in the feed at first?
    answer: Audio clips + waveform (Recommended)
  • Who should be able to create/publish feed clips in the first version of this feature?
    answer: Open publish
  • How should the feed ranking work in the first release?
    answer: Hybrid local + global (Recommended)

• Searched rebane2001 xikipedia github algorithm

• Searched github rebane2001 xikipedia repository

• Searched https://github.com/rebane2001/xikipedia

• Proposed Plan


  # Plan: Build a TikTok-Style Podcast Clip Feed (Ultimate Goal) for ICS and Future Shows

  ## Summary

  Create a vertical, scrollable audio-first feed of podcast clips that users can browse, listen to, share, and contribute to. The feed should support:

  - single clips from episodes
  - chapter-based clips
  - multi-clip “bit” chains
  - character-focused clip sequences
  - cross-character compilations

  This starts as an ICS feature but should evolve into a reusable fandom platform for other podcasts (and later YouTube-like creators).

  ### Product direction locked (from prior decisions + this turn)

  - Mobile web first (PWA)
  - Open publish model for user clip submissions (high moderation burden)
  - Hybrid ranking: global baseline + local personalization (Xikipedia-inspired)
  - Playback v1 for feed: audio clips + waveform (not full audiogram pipeline yet)
  - Patreon auth should gate premium content in hosted app (future dependency for premium clips)

  ———

  ## Product Vision (PM)

  ## Why this exists

  Fans do not always want full episodes. They want:

  - “that moment”
  - recurring bits
  - character appearances
  - relivable highlights
  - a fast discovery experience

  A scroll feed turns a large archive into a discovery engine.

  ## Core user jobs

  - “I want to hear funny clips fast”
  - “I want more like this bit/character”
  - “I want to save/share this clip”
  - “I want to make a clip from a segment I found”
  - “I want to follow a theme (Sweet Bean / Jock vs Nerd / Scoop Mail / etc.)”

  ## North-star experience

  A user opens the app and immediately gets a vertical feed of clips with:

  - waveform + captions/snippets
  - episode title + timestamp
  - tags (character/chapter/bit)
  - swipe/scroll to next
  - save/share/remix into a “chain”

  ———

  ## Scope Definition (Decision Complete)

  ## Phase A (MVP feed foundation)

  - Audio-only vertical clip feed (mobile-first)
  - Public clips + premium clip lock states (Patreon-ready gating)
  - Clip detail metadata (episode, timestamp, tags)
  - Shareable links to clip pages
  - Basic actions: like, skip, save, report
  - Moderated clip publishing (despite “open publish” submissions)
  - Hybrid ranking (global + local)
  - Admin moderation queue for clips

  ## Phase B (creator/community growth)

  - User clip creation flow (segment/chapter based)
  - Multi-clip chains (“bits”)
  - Character playlists
  - Clip comments/reactions (optional)
  - Social sharing assets (OG cards, audiogram export)

  ## Phase C (ultimate platform)

  - Cross-show feed
  - Personalized channels (characters/bits/themes)
  - Stronger recommender system
  - Creator tools + embeddable players
  - YouTube/video source support via same feed primitives

  ———

  ## Product Model (Content Types in Feed)

  Define one unified feed item model with variants.

  ## Feed item variants

  - clip_single
      - one contiguous time range in one episode
  - clip_chapter
      - derived from episode_chapters
  - clip_chain
      - ordered list of clips (same bit across episode or multiple episodes)
  - clip_character_set
      - clips grouped by a character/entity
  - clip_compilation
      - themed collection (e.g., “Top Scoop Mail intros”)

  ## Clip sources (mapped to current data)

  Use existing tables as seed material:

  - transcript_segments -> primary clip boundaries/text
  - episode_chapters -> chapter clips
  - audio_drop_instances -> reusable known short bites
  - character_appearances -> character clips
  - flagged_segments / transcript_corrections -> quality review signals
  - future: segment_classifications when populated

  ———

  ## Architecture Plan (Architect)

  ## High-level system components

  - Clip Extraction/Assembly Pipeline (offline/admin + hosted import)
  - Feed Catalog Service (stores clip records + metadata)
  - Ranking Service (global scores + local session mixing)
  - Playback API (serves clip metadata + signed audio access strategy)
  - Moderation Service (submission queue, reports, review)
  - Share Service (deep links + social previews)

  ## Recommended runtime split (aligned with your roadmap)

  - Heavy media processing stays offline/admin-side first
  - Hosted app stores clip manifests + metadata and serves feed UX
  - Clip audio assets can be pre-generated and uploaded (short clips only)

  ## Audio strategy (v1)

  - Store clip manifests and audio source references
  - Prefer pre-rendered clip files for smooth mobile playback
  - Fallback: stream from source audio with byte/time seek only if licensing/infra allows

  Rationale:

  - Mobile UX needs instant playback
  - Runtime clipping per request is costly and brittle under budget constraints

  ———

  ## Data Model Additions (Hosted)

  ## New tables (core)

  - clips
      - id
      - show_id
      - source_episode_id
      - clip_type
      - title
      - description
      - start_time
      - end_time
      - duration_ms
      - audio_asset_url (nullable)
      - captions_text
      - visibility (public|patron_only|private|removed)
      - status (draft|pending_review|published|rejected)
      - source_kind (segment|chapter|character|manual|chain_generated)
      - source_ref_id (nullable)
      - created_by_user_id
      - published_at
      - quality_score
      - safety_score
  - clip_segments
      - for multi-clip chains/compilations
      - clip_id, order_index, episode_id, start_time, end_time
  - clip_tags
      - freeform and normalized tags
  - clip_entities
      - links to characters/bits/guests/etc.
  - clip_chains
      - optional explicit chain metadata
  - clip_engagement_events
      - view, play_start, play_complete, like, save, share, skip, report
  - user_feed_profiles
      - preferences and local-sync hints (minimal server side)
  - clip_reports
  - clip_moderation_queue
  - clip_moderation_actions
  - clip_revisions
      - title/metadata/tag edits and rollback support

  ## Reuse/mapping from current ICS DB during import

  - episodes -> hosted episodes/media_items
  - transcript_segments -> candidate clip boundaries + captions
  - episode_chapters -> chapter clips
  - characters + character_appearances -> entity clips
  - audio_drops + audio_drop_instances -> short canonical clips

  ———

  ## API / Interface Spec (Lead Developer)

  ## Public feed APIs

  - GET /api/v1/shows/:showSlug/feed
      - params: cursor, session_id, mode, filters, exclude_ids[]
      - returns: ranked feed items with playback metadata
  - POST /api/v1/feed/events
      - batched engagement events
  - GET /api/v1/clips/:clipId
      - clip detail + related clips
  - GET /api/v1/clips/:clipId/share
      - share metadata / canonical URL
  - POST /api/v1/clips/:clipId/report

  ## Creation/submission APIs

  - POST /api/v1/clips/submissions
      - user proposes a single clip
  - POST /api/v1/clip-chains/submissions
      - user proposes a chain/compilation
  - POST /api/v1/clips/:clipId/revisions
      - metadata/tag edits

  ## Moderation/admin APIs

  - GET /api/v1/admin/clips/moderation-queue
  - POST /api/v1/admin/clips/moderation-actions
  - POST /api/v1/admin/clips/rebuild-assets/:clipId
  - POST /api/v1/admin/clip-import-batches

  ## Frontend interfaces/types (shared)

  - FeedItem
  - ClipPlaybackManifest
  - ClipSubmissionPayload
  - ClipChainSubmissionPayload
  - FeedEventBatch
  - ModerationDecision
  - FeedSessionState
  - LocalRankingProfile

  ———

  ## Ranking Plan (Xikipedia-Inspired Hybrid Algorithm)

  ## Design goals

  - Good cold start without tracking-heavy infra
  - Learns quickly from user interactions
  - Supports privacy-friendly local personalization
  - Prevents monotony and rabbit holes

  ## v1 ranking architecture

  ### Global server score (baseline)

  Server computes a global_rank_score from:

  - recency (for newly published clips)
  - editor picks / curated boosts
  - engagement quality (completion rate > likes alone)
  - report penalty
  - diversity penalties (duplicate near-identical clips)
  - content quality score (caption completeness, audio clarity, moderation confidence)

  ### Local personalization (client-side, Xikipedia-inspired)

  Client keeps a local profile of interest weights by:

  - character
  - chapter type
  - tags
  - episode series
  - clip duration bucket
  - humor/story/guest type (when classifications exist)

  Actions adjust weights:

  - skip quickly: negative
  - listen > N seconds: positive
  - completion: strong positive
  - like/save/share: stronger positive
  - report/mute tag: strong negative

  ### Feed selection strategy (hybrid)

  For each next item, client requests a server candidate pool (e.g. 30-100 items), then local mixer selects:

  - 40% weighted by personalized score
  - 40% top-scoring global items
  - 20% exploration/randomized diversity

  This mirrors the Xikipedia-style balance of weighted/top/random exploration.

  ## Anti-stagnation rules

  - cooldown on recently seen clips
  - dedupe by same episode/time range
  - diversity caps (same character/tag repeated too often)
  - clip length mix (short/medium)
  - “freshness injection” quota

  ———

  ## Feed UX / Product Behavior

  ## Playback UX (v1)

  - vertical swipe/scroll cards
  - autoplay next clip (muted state not needed for audio-first; explicit tap-to-play acceptable if mobile browser restrictions require)
  - waveform scrubber
  - transcript snippet/captions
  - timestamp + jump to full episode page
  - related tags: Sweet Bean, Scoop Mail, Jock vs Nerd, etc.

  ## Clip composition types (required)

  - Single clip: one moment
  - Chapter clip: one chapter section
  - Bit chain: multiple moments stitched in order
  - Character reel: all clips tagged to one character
  - Character matchup: alternating clips by multiple characters (compilation)

  ## Sharing (platform and off-platform)

  - canonical clip URLs
  - Open Graph preview image/audio metadata
  - share payload includes:
      - show
      - episode title
      - timestamp
      - clip title
      - tags
  - optional future: auto-generated audiogram for IG/TikTok/X sharing

  ———

  ## Moderation / Trust / Safety (Critical because open publish)

  ## Publishing policy (v1 despite “open publish” goal)

  Interpret “open publish” as:

  - anyone can submit clips
  - published feed still passes automated checks + mod review (at least initially)

  Reason:

  - copyright, harassment, spam, and NSFW risks are too high for direct publish on a clip feed

  ## Required moderation controls

  - clip submission queue
  - waveform + transcript preview in moderation UI
  - approve / reject / redact / unpublish
  - rate limits per user/IP
  - duplicate clip detection
  - user suspension
  - report handling
  - audit trail for clip actions

  ## Safety checks before publish

  - duration limits (e.g. 10s-120s configurable)
  - transcript text sanitization
  - blocked terms / doxxing heuristics
  - duplicate or near-duplicate detection
  - copyright policy enforcement flags
  - premium visibility validation (Patreon-only clips not accidentally public)

  ———

  ## Copyright / Rights Controls (specific to clip feed)

  This feature increases legal risk versus plain transcript pages because clips are highly shareable.

  ## Required controls in architecture

  - visibility per clip (public, patron_only, private, removed)
  - rights_policy at show level (full clips allowed, excerpt only, metadata only)
  - max_public_clip_duration_seconds per show
  - takedown workflow:
      - rapid unpublish
      - preserve internal audit metadata
  - provenance fields:
      - source episode
      - source timestamps
      - created by
      - moderation decision

  ## Default recommendation

  - Start with shorter clips and strong source attribution
  - Keep one-click unpublish and policy toggles ready
  - Make clip generation policy configurable per show before multi-show launch

  ———

  ## Implementation Roadmap (Phased)

  ## Phase 0: Foundation (2-3 weeks)

  - Define hosted clip schema + APIs
  - Add clip visibility/rights policy model
  - Build import/export contract from local ICS DB to hosted clip candidates
  - Create ARCHITECTURE.md sections for feed/ranking/moderation
  - Add CI checks for feed APIs and client build

  ## Phase 1: Internal Alpha Feed (3-5 weeks)

  - Generate curated seed clips from:
      - chapter clips
      - audio drop instances
      - manual segment clips
  - Build mobile web vertical feed UI (audio-first)
  - Implement server candidate feed + local ranking profile
  - Track engagement events
  - Admin moderation UI for clips
  - Shareable clip URLs (basic)

  ## Phase 2: Community Clip Submissions (4-6 weeks)

  - User clip submission UI
  - Submission queue and moderation actions
  - Reports and abuse handling
  - Deduplication and spam throttling
  - Character and bit tagging workflow
  - Premium clip gating hooks (Patreon-linked accounts)

  ## Phase 3: Chains / Character Reels / Compilations (3-5 weeks)

  - Multi-segment chain model and editor
  - Character reel auto-generation (from character_appearances + tags)
  - Compilation templates (e.g., “best of X”)
  - Related clips and playlist-style autoplay

  ## Phase 4: Social Distribution + Platformization (4-8 weeks)

  - Audiogram/video render pipeline (optional worker)
  - Cross-post export metadata and platform presets
  - Cross-show feed architecture
  - Show-level theming and rights policies
  - YouTube source adapter design + pilot

  ———

  ## Testing Plan (QA/Tester)

  ## Unit tests

  - ranking score calculations (global + local mix)
  - cooldown/dedup/diversity rules
  - clip duration and boundary validation
  - visibility gating (public vs patron-only)
  - moderation state transitions

  ## Integration tests

  - feed endpoint returns valid playable items
  - engagement batching persisted correctly
  - clip submission -> moderation -> publish workflow
  - reports create moderation queue items
  - Patreon-linked user gets premium clips; unlinked user does not

  ## E2E tests (mobile viewport)

  - scroll feed -> play -> next autoplay/manual play
  - like/save/share/report flows
  - locked premium clip prompt flow
  - submit clip from episode page
  - moderator approves and clip appears in feed
  - local personalization changes subsequent ordering (deterministic test mode)

  ## QA edge cases

  - duplicate clips from same timestamps
  - clips with missing audio asset
  - stale feed cursor
  - abusive clip titles/tags

  ———

  ## Metrics / Success Criteria

  ## v1 feed metrics

  - clip play start rate
  - clip completion rate
  - average clips per session
  - share rate
  - save rate
  - report rate
  - moderation turnaround time
  - % of feed from exploration vs personalized picks consumed

  ## Quality guardrails

  - report rate below threshold
  - duplicate publish rate low
  - premium leakage incidents = 0
  - feed latency acceptable on mobile networks

  ———

  ## Assumptions and Defaults Chosen

  - Feed is audio-first initially (no mandatory video rendering pipeline).
  - Open publish is implemented as open submissions + moderated publishing, not direct publish.
  - Hybrid ranking uses client-side local personalization inspired by Xikipedia and server global scores.
  - ICS is first show; schema includes show_id so multi-show rollout doesn’t require redesign.
  - Patreon entitlement integration will gate premium clips later using linked app accounts.
  - Rights controls are built in from day one because clip sharing increases legal exposure.


  review how and why scripts/voice_library/embeddings.json
  scripts/voice_library/embeddings_*.json
  scripts/voice_library/samples/
• I’m going to inspect the local voice_library files and the code paths that write/read them first, then I’ll compare that design to common approaches used by diarization/embedding tools so
  the recommendations are grounded.

• Explored
  └ List voice_library

• I found the on-disk layout and where Rust/Tauri calls into it. Next I’m inspecting scripts/voice_library.py and the JSON payload shape/size so I can explain exactly why this storage exists
    List voice_library
    List samples
    List sound_bites

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
• Searched pyannote speaker embedding database storage recommendations

• Searched pyannote.audio embedding documentation official

• Searched pgvector official github README index types HNSW IVF

• Explored
  └ Read episodes.rs, speakers.rs, speaker_diarization.py

• Searched pyannote speaker embedding documentation official

• Searched pyannote.audio embedding model docs pyannote official

• Searched SpeechBrain speaker recognition inference SpeakerRecognition.from_hparams docs official speechbrain

• Searched pgvector official github postgres vector extension

• Searched https://github.com/asg017/sqlite-vec

• Searched https://docs.pyannote.ai/models

• Searched 'SpeakerRecognition.from_hparams' in https://speechbrain.readthedocs.io/en/latest/API/speechbrain.inference.speaker.html

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• I’ve gathered enough to explain the current design and compare alternatives. I’m doing one last check on the models/ folder (it showed 0B in du, which may mean symlinks/sparse files) so
  the storage recommendations cover model cache handling too.

• Explored
  └ List speechbrain_ecapa
    List speechbrain_ecapa

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• I’m ready to write the review. I’m grabbing exact line numbers for the key functions (_save_embeddings, rebuild, and sample extraction) so the recommendations can reference the real
  implementation directly.

• Explored
  └ Search savedir=cache_dir|SpeakerRecognition\.from_hparams|Model\.from_pretrained\( in voice_library.py
    Search def _save_embeddings|def _load_embeddings|def add_speaker\(|def identify_speakers_in_diarization\(|elif args.command == \"rebuild\" in voice_library.py
    Search pub async fn save_voice_samples\(|voice_library\.py\".*, \"add\"|pub async fn get_voice_library\(|pub async fn rebuild_voice_library\( in episodes.rs

──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Good target. I reviewed the actual implementation and on-disk data layout. Short version: the current storage is simple and works for a small local voice library, but it will become a
  bottleneck (and a source of drift) as you scale speakers/samples/backends.

  ## What this storage is and why it exists (current app)

  ### Files/directories

  - scripts/voice_library/embeddings_pyannote.json
  - scripts/voice_library/embeddings_ecapa.json
  - scripts/voice_library/embeddings.json (legacy)
  - scripts/voice_library/samples/ (speaker sample WAVs)
  - scripts/voice_library/sound_bites/ (non-person voice/audio drop samples)
  - scripts/voice_library/models/ (SpeechBrain model cache symlink dir)

  ### How it gets created

  - Tauri command save_voice_samples extracts WAV clips via ffmpeg and writes them into samples/ or sound_bites/, then calls voice_library.py add ... to compute/update embeddings.
      - src-tauri/src/commands/episodes.rs:1442
  - voice_library.py loads/saves backend-specific JSON files and averages embeddings over samples.
      - _load_embeddings: scripts/voice_library.py:95
      - _save_embeddings: scripts/voice_library.py:118
      - add_speaker: scripts/voice_library.py:187
  - Rebuild scans samples/ and sound_bites/, re-embeds everything, and rewrites JSON.
      - scripts/voice_library.py:621
      - Tauri wrapper rebuild_voice_library: src-tauri/src/commands/speakers.rs:869
  - SpeechBrain ECAPA model cache is stored under scripts/voice_library/models/speechbrain_ecapa, but those are symlinks into Hugging Face cache.
      - SpeakerRecognition.from_hparams(... savedir=cache_dir): scripts/voice_library.py:139

  ## What I found (current footprint)

  - Embedding JSONs are small right now (~417 KB total)
  - samples/ + sound_bites/ are ~5.4 MB total (small)
  - models/speechbrain_ecapa looked 0B at first because it is symlinks, but actual model size is ~85 MB when following links
  - Current embeddings:
      - ECAPA vectors are 192-dim
      - pyannote vectors are 512-dim

  This means storage pressure is not urgent today; the bigger issue is design/maintainability/perf as the library grows.

  ## Why this design made sense

  It is pragmatic for a local desktop app:

  - human-readable JSON
  - easy to debug/rebuild
  - Python-first embedding pipeline (pyannote/SpeechBrain)
  - Rust can call Python subprocesses without needing a shared binary format
  - raw WAVs are auditable and reusable for retraining

  That is a valid v1 local workflow.

  ## Main problems / scaling risks

  ### 1) JSON is rewritten on every update

  - _save_embeddings() writes the entire file each time.
  - Fine for 10-50 entries; increasingly wasteful for larger libraries.

  ### 2) Float JSON is bloated and slow

  - Embeddings are stored as decimal float arrays (tolist()), which is much larger/slower than binary (float32 blobs / .npy).

  ### 3) Only centroid embedding is stored (lossy)

  - You average samples into one vector + sample_count.
  - You lose:
      - per-sample variance
      - outlier detection
      - quality weighting
      - re-ranking against top-k samples
  - This limits matching quality as you add noisy clips.

  ### 4) Two sources of truth

  - Sample files on disk + DB records (voice_samples) + embeddings JSON
  - Rebuild helps, but drift is still possible (deleted files, stale embeddings, mismatched names)

  ### 5) Linear scan matching only

  - identify_speaker() computes cosine similarity against every stored embedding.
  - Fine now; not fine if you expand to lots of speakers/characters/sound bites across many shows.

  ### 6) Repo/path coupling

  - Several Tauri commands assume fixed project path under your Desktop.
  - Works on your Mac; bad for portability/deployment.

  ### 7) Backend siloing

  - embeddings_ecapa.json and embeddings_pyannote.json are separate (reasonable), but there’s no unified metadata/model versioning strategy.

  ## Storage optimization options (best-to-practical)

  ## Option A (lowest risk, best short-term ROI): Keep filesystem + optimize format

  Keep current architecture, but change embedding storage format:

  - metadata.json for names/sample counts/dates
  - embeddings_{backend}.npy or .npz for numeric matrix (float32)
  - optional name_to_row map

  Benefits:

  - much smaller/faster load/save
  - keeps Python pipeline simple
  - no DB migration needed yet

  Add:

  - atomic writes (write temp file + rename)
  - explicit schema version + backend/model version

  ## Option B (recommended medium-term): Move embeddings metadata + vectors into SQLite

  Use your existing DB as source of truth:

  - voice_embedding_samples (per sample embedding BLOB float32)
  - voice_embedding_centroids (derived centroid per speaker/backend)
  - voice_embedding_models (backend/model/version metadata)
  - keep audio sample files on disk/object storage

  Benefits:

  - single source of truth
  - transactional updates
  - easier moderation/cleanup/history
  - easier future hosting
  - easier joins with voice_samples, episodes, ratings

  This is the best app-level architecture for your project.

  ## Option C (later scale): Add vector index (sqlite-vec / pgvector / FAISS)

  When library grows across many shows:

  - local desktop: sqlite-vec (fits your SQLite/Tauri setup)
  - hosted multi-user: pgvector
  - large offline experimentation: FAISS

  Use only when needed. For current library size, exact cosine scan is okay.

  ## Option D (audio sample storage optimization)

  For sample clips:

  - keep canonical archive as FLAC instead of WAV (smaller lossless)
  - generate temporary 16k mono WAV on embedding/rebuild if required
  - dedupe by content hash
  - cap sample duration and sample count per speaker/backend
  - retain top-rated/high-confidence samples, archive the rest

  Good when sample volume starts growing fast.

  ## Recommended target design for this app (pragmatic)

  ### Now (keep momentum)

  - Keep raw sample files on disk (samples/, sound_bites/)
  - Keep JSON for 1 more iteration, but:
      - store float32
      - split metadata from vectors
      - add schema/model-version metadata
      - add atomic writes

  ### Next (best upgrade)

  - Move embeddings into SQLite tables as BLOB float32
  - Store per-sample embeddings and derived centroids
  - Rebuild becomes a DB refresh job, not a JSON rewrite
  - get_voice_library reads DB first, filesystem only for reconciliation

  ### Later (multi-show)

  - Add vector index (sqlite-vec local, pgvector hosted)
  - Add ANN only when exact scan becomes slow

  ## “Other tools” and better methods (what they typically do)

  - keep model weights in framework cache (HF cache / local cache dir)
  - store embeddings in binary arrays or vector DBs, not JSON float arrays
  - preserve per-sample embeddings and compute centroids/indexes as derived data
  - use ANN indexes only after scale justifies it

  Relevant references:

  - Pyannote docs (speaker/voice workflows): https://docs.pyannote.ai/
  - SpeechBrain speaker recognition docs (ECAPA usage): https://speechbrain.readthedocs.io/en/latest/API/speechbrain.inference.speaker.html
  - FAISS (vector similarity indexing): https://github.com/facebookresearch/faiss
  - sqlite-vec (SQLite vector search, good local fit): https://github.com/asg017/sqlite-vec
  - pgvector (Postgres vector extension, good hosted fit): https://github.com/pgvector/pgvector

  ## Specific improvements I’d prioritize for your app

  1. Make embedding storage versioned (schema_version, backend, model_id, dim, dtype)
  2. Store per-sample embeddings (not only averaged centroid)
  3. Quantize/store as float32 binary, not JSON floats
  4. Make DB the canonical metadata store; filesystem for media only
  5. Remove hardcoded project path assumptions in Tauri commands
  6. Treat models/ symlink cache as cache, not app data (document/cache path config)

  ## Why this matters for app optimization

  - Faster startup/load of voice library
  - Faster rebuilds and less file churn
  - Better diarization speaker-ID quality (outlier handling, weighting)
  - Easier migration to hosted/multi-show architecture
  - Lower risk of “sample files exist but embeddings stale” drift

  If you want, I can turn this into a concrete migration plan with an exact SQLite schema (voice_embedding_samples, voice_embedding_centroids) and a step-by-step transition path from the
  current JSON files.


› can you add that to the plan?


• Proposed Plan


  # Plan Addendum: Voice Library Storage Optimization and Embedding Architecture Upgrade

  ## Summary

  Add a dedicated workstream to modernize how speaker embeddings, sample clips, and model caches are stored. This reduces drift, improves speaker-ID quality, and prepares the app for
  hosted/multi-show scaling.

  This addendum is based on the current implementation in:

  - scripts/voice_library.py
  - src-tauri/src/commands/episodes.rs:1442
  - src-tauri/src/commands/speakers.rs:197
  - src-tauri/src/commands/speakers.rs:869

  Current state:

  - Embeddings stored as JSON float arrays (embeddings_*.json)
  - Raw sample clips stored on disk (samples/, sound_bites/)
  - Rebuild scans filesystem and rewrites whole JSON files
  - Tauri reads Python CLI + filesystem to infer state

  ———

  ## Why This Matters (Product + Performance)

  - Improves diarization speaker identification quality (store per-sample embeddings, not only centroids)
  - Reduces long-term maintenance risk (single source of truth)
  - Enables faster startup/load and future vector search
  - Makes voice library portable for web-hosted / multi-show architecture
  - Reduces mismatch between DB records, sample files, and JSON embeddings

  ———

  ## Current Storage Model (As-Is)

  ### Current artifacts

  - scripts/voice_library/embeddings_pyannote.json
  - scripts/voice_library/embeddings_ecapa.json
  - scripts/voice_library/embeddings.json (legacy)
  - scripts/voice_library/samples/*/*.wav
  - scripts/voice_library/sound_bites/*/*.wav
  - scripts/voice_library/models/speechbrain_ecapa (symlinks into HF cache)

  ### Current behavior

  - save_voice_samples extracts clips via ffmpeg and writes WAV files
  - voice_library.py add computes embedding and updates JSON
  - rebuild re-embeds from all sample files and rewrites backend JSON
  - Matching is linear scan over stored centroid embeddings

  ———

  ## Target Architecture (Storage)

  ## Canonical data split (decision complete)

  - Database (canonical metadata + embeddings):
      - sample metadata
      - per-sample embeddings
      - derived centroids
      - backend/model versions
  - Filesystem/Object storage (media assets only):
      - raw sample clips / sound bites
  - Model cache (cache only, non-canonical):
      - Hugging Face / SpeechBrain downloaded weights

  ## Storage strategy by phase

  ### Phase 1 (short-term, low risk)

  - Keep filesystem samples as-is
  - Keep JSON compatible reads
  - Add versioned metadata and atomic writes
  - Introduce export/import helper for embeddings

  ### Phase 2 (recommended target)

  - Move embeddings into SQLite tables (BLOB float32)
  - Store per-sample embeddings + derived centroids
  - Rebuild populates DB tables, not JSON
  - JSON becomes optional debug/export artifact

  ### Phase 3 (scale)

  - Add vector index (sqlite-vec locally; pgvector hosted later)
  - Support multi-show voice libraries and backend versioned indexes

  ———

  ## Schema Changes (Architect Spec)

  ## New tables (SQLite now, portable to Postgres later)

  ### voice_embedding_models

  Tracks backend/model metadata and compatibility.

  - id
  - backend (pyannote, ecapa-tdnn)
  - model_id (e.g. pyannote/embedding, speechbrain/spkrec-ecapa-voxceleb)
  - embedding_dim (192/512)
  - dtype (float32)
  - version_tag (app-defined)
  - created_at
  - is_active

  ### voice_embedding_samples

  One row per sample embedding (not averaged).

  - id
  - speaker_name
  - sample_type (speaker, sound_bite)
  - voice_sample_id (FK to existing voice_samples, nullable for legacy)
  - episode_id (nullable)
  - file_path
  - file_hash (dedupe)
  - backend_model_id (FK)
  - embedding_blob (float32 packed bytes)
  - embedding_norm (optional cached norm)
  - sample_date (nullable)
  - quality_rating (nullable / from UI)
  - source (manual, harvest, rebuild)
  - created_at

  ### voice_embedding_centroids

  Derived per speaker/backend summary for fast matching.

  - id
  - speaker_name
  - sample_type
  - backend_model_id
  - centroid_blob (float32 packed bytes)
  - sample_count
  - sample_dates_json (or normalized table later)
  - variance_json (optional future)
  - updated_at

  ### voice_library_state (optional)

  - key/value records for migration/versioning/rebuild timestamps

  ———

  ## Public/Internal Interfaces To Change (Lead Dev Spec)

  ## Python voice_library.py changes

  Add storage backend abstraction:

  - JsonEmbeddingStore (existing behavior)
  - SqliteEmbeddingStore (new default after migration)

  New CLI flags:

  - --store json|sqlite (default transitional = auto)
  - --db-path <path> for SQLite embedding store
  - export-json / import-json for debugging/migration

  Behavior changes:

  - add writes per-sample embedding row + updates centroid
  - rebuild rebuilds per-sample rows and centroids
  - info reads centroids and summarizes sample counts
  - identify can use centroids first; optional top-k sample re-rank later

  ## Rust/Tauri command changes

  - get_voice_library should prefer DB-backed embedding metadata, filesystem scan only for reconciliation
      - src-tauri/src/commands/speakers.rs:197
  - rebuild_voice_library remains same UI contract, but Python rebuild writes DB-backed embeddings
      - src-tauri/src/commands/speakers.rs:869
  - save_voice_samples should store sample metadata + invoke embedding writer with explicit DB path/store mode
      - src-tauri/src/commands/episodes.rs:1442

  ## No breaking UI API required (initially)

  Maintain current get_voice_library response shape:

  - name
  - short_name
  - sample_count
  - file_count
  - episode_count
  - has_embedding

  ———

  ## Matching/Algorithm Improvements (QA + Performance ROI)

  ## v1.1 improvements (same UX, better accuracy)

  - Keep centroid cosine matching for speed
  - Add sample-quality weighting when updating centroid
  - Track per-sample date and apply temporal weighting more accurately
  - Detect outlier samples (bad/noisy clips) and exclude from centroid build

  ## v1.2 improvements

  - Two-stage match:
      - centroid shortlist (fast)
      - top-k per-sample re-rank (more accurate)
  - This is a major quality improvement without full ANN/vector DB complexity

  ## v2 scale option

  - Vector index:
      - local desktop: sqlite-vec
      - hosted: pgvector
  - Only needed when sample counts grow significantly across shows/users

  ———

  ## Storage Optimization Options (Decisioned Recommendations)

  ## Recommended now

  - Store embeddings as binary float32 blobs in DB (not JSON float arrays)
  - Keep raw sample audio files on disk
  - Keep model cache in HF cache / symlink cache, not canonical app data
  - Add hash-based dedupe for sample files and embeddings

  ## Optional later

  - Convert sample archives from WAV to FLAC (lossless, smaller)
  - Keep temporary WAVs for embedding extraction if needed
  - Prune or archive low-quality duplicate samples per speaker

  ## Not recommended right now

  - Complex distributed vector DB
  - Full remote object-store migration for local-only voice library workflow
  - Removing raw samples entirely (you need them for rebuild/debug/retraining)

  ———

  ## Migration Plan (Implementation-Ready)

  ## Phase V0: Instrument and document (1-2 days)

  - Document current voice-library storage in ARCHITECTURE.md
  - Add schema version and backend/model metadata to JSON payloads (if still used)
  - Add metrics logging for:
      - library load time
      - rebuild duration
      - speaker count
      - sample count

  ## Phase V1: Add SQLite embedding tables (2-4 days)

  - Add DB migrations/tables listed above
  - Add binary embedding pack/unpack helpers (float32)
  - Add model metadata seeding (pyannote, ecapa-tdnn)

  ## Phase V2: Dual-write transition (3-5 days)

  - Update voice_library.py add/rebuild to write SQLite embeddings
  - Keep JSON writes enabled behind feature flag for fallback (dual_write=true)
  - Update info command to read SQLite first, JSON fallback

  ## Phase V3: Tauri read-path migration (2-4 days)

  - Update get_voice_library to use DB embedding metadata
  - Keep filesystem scan only for “untrained sample exists” detection
  - Surface migration status in settings/debug panel (optional)

  ## Phase V4: Accuracy/perf improvements (3-6 days)

  - Add per-sample quality weighting and outlier filtering
  - Implement centroid shortlist + top-k re-rank (optional flag)
  - Benchmark pyannote vs ECAPA with new storage path

  ## Phase V5: JSON deprecation (later)

  - Disable JSON writes by default
  - Keep export-json for portability/debug
  - Remove legacy embeddings.json read fallback after migration confidence period

  ———

  ## Test Cases and Scenarios (QA/Tester)

  ## Unit tests

  - float32 pack/unpack roundtrip for embeddings
  - centroid recompute from N samples
  - outlier exclusion behavior
  - model dimension mismatch handling (192 vs 512)
  - JSON->SQLite migration parser

  ## Integration tests

  - save_voice_samples creates sample file + DB sample row + embedding row
  - rebuild_voice_library repopulates centroids from filesystem
  - get_voice_library shows correct has_embedding and counts after migration
  - deleting sample updates centroids correctly
  - backend switch (pyannote vs ecapa-tdnn) isolates embeddings correctly

  ## Regression tests
  - diarization voice identification works with migrated data
  - rebuild progress events still emit correctly

  ## Performance checks

  - library load time before vs after migration
  - rebuild time per N samples
  - identify-speaker latency for growing library sizes

  ———

  ## Other Tools / Methods Review (what to align with)

  Adopt patterns common in speaker embedding systems:

  - model weights as cache (not app data)
  - embeddings in binary/vector storage (not JSON float text)
  - per-sample embeddings retained; centroids derived
  - ANN/vector index only when needed

  Potential future fits:

  - sqlite-vec for local similarity search
  - pgvector for hosted multi-show platform
  - FAISS for offline experiments/benchmarks

  ———

  ## Assumptions and Defaults Chosen

  - Voice sample audio files remain on disk for rebuild/debug (canonical media source).
  - Embeddings become DB-canonical data (not JSON-canonical).
  - JSON remains temporarily for compatibility during migration.
  - Matching stays exact cosine + centroid first until scale justifies ANN.
  - This work is a shared foundation for both current diarization accuracy and future hosted/multi-show architecture.