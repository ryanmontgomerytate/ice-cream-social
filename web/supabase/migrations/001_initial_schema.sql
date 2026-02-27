-- ============================================================
-- Phase 1: Ice Cream Social — Hosted Postgres Schema (Supabase)
-- ============================================================
-- Scope: Public read experience only.
--        All writes via service role (import pipeline only).
--        Internal desktop-only tables are excluded.
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- IMPORT AUDIT
-- ============================================================

CREATE TABLE IF NOT EXISTS import_batches (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    schema_version      text NOT NULL DEFAULT '001',
    imported_at         timestamptz NOT NULL DEFAULT now(),
    episode_count       integer NOT NULL DEFAULT 0,
    segment_count       integer NOT NULL DEFAULT 0,
    character_count     integer NOT NULL DEFAULT 0,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'complete', 'failed')),
    error               text,
    notes               text
);

-- ============================================================
-- SHOWS (multi-show future-proofing)
-- ============================================================

CREATE TABLE IF NOT EXISTS shows (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            text NOT NULL,
    slug            text NOT NULL UNIQUE,
    description     text,
    rss_feed_url    text,
    artwork_url     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed the ICS show row (imported from local DB seed)
INSERT INTO shows (name, slug, description)
VALUES (
    'Matt and Mattingly''s Ice Cream Social',
    'ics',
    'A comedy podcast hosted by Matt Donnelly and Paul Mattingly.'
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- EPISODES
-- ============================================================

CREATE TABLE IF NOT EXISTS episodes (
    id              bigint PRIMARY KEY,             -- matches local SQLite id (for upsert)
    show_id         bigint NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    episode_number  text,
    title           text NOT NULL,
    description     text,
    audio_url       text NOT NULL UNIQUE,
    duration        double precision,
    published_date  timestamptz,
    feed_source     text DEFAULT 'patreon',
    category        text DEFAULT 'episode',
    category_number text,
    sub_series      text,
    canonical_id    bigint REFERENCES episodes(id),
    num_speakers    integer,
    has_diarization boolean NOT NULL DEFAULT false,
    metadata_json   jsonb,
    visibility      text NOT NULL DEFAULT 'public'
                    CHECK (visibility IN ('public', 'patron_only', 'admin_only')),
    imported_at     timestamptz NOT NULL DEFAULT now(),
    import_batch_id bigint REFERENCES import_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_episodes_published     ON episodes(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_category      ON episodes(category);
CREATE INDEX IF NOT EXISTS idx_episodes_canonical     ON episodes(canonical_id);
CREATE INDEX IF NOT EXISTS idx_episodes_show          ON episodes(show_id);
CREATE INDEX IF NOT EXISTS idx_episodes_feed_source   ON episodes(feed_source);
CREATE INDEX IF NOT EXISTS idx_episodes_visibility    ON episodes(visibility);

-- ============================================================
-- TRANSCRIPT SEGMENTS (with Postgres FTS via tsvector)
-- ============================================================

CREATE TABLE IF NOT EXISTS transcript_segments (
    id              bigint PRIMARY KEY,             -- matches local SQLite id
    episode_id      bigint NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    segment_idx     integer NOT NULL,
    speaker         text,
    text            text NOT NULL,
    start_time      double precision NOT NULL,
    end_time        double precision,
    is_performance_bit boolean NOT NULL DEFAULT false,
    -- Generated column for Postgres FTS
    text_search     tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED,
    UNIQUE (episode_id, segment_idx)
);

CREATE INDEX IF NOT EXISTS idx_segments_episode   ON transcript_segments(episode_id);
CREATE INDEX IF NOT EXISTS idx_segments_speaker   ON transcript_segments(speaker);
CREATE INDEX IF NOT EXISTS idx_segments_fts       ON transcript_segments USING GIN(text_search);

-- ============================================================
-- SPEAKERS
-- ============================================================

CREATE TABLE IF NOT EXISTS speakers (
    id          bigint PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    short_name  text,
    description text,
    is_host     boolean NOT NULL DEFAULT false,
    image_url   text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- EPISODE SPEAKERS (diarization label → known speaker mapping)
-- ============================================================

CREATE TABLE IF NOT EXISTS episode_speakers (
    id                    bigint PRIMARY KEY,
    episode_id            bigint NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    diarization_label     text NOT NULL,
    speaker_id            bigint REFERENCES speakers(id),
    speaking_time_seconds double precision,
    segment_count         integer,
    confidence            double precision,
    source                text DEFAULT 'manual',
    UNIQUE (episode_id, diarization_label)
);

CREATE INDEX IF NOT EXISTS idx_episode_speakers_episode ON episode_speakers(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_speakers_speaker ON episode_speakers(speaker_id);

-- ============================================================
-- CHARACTERS
-- ============================================================

CREATE TABLE IF NOT EXISTS characters (
    id               bigint PRIMARY KEY,
    name             text NOT NULL UNIQUE,
    short_name       text,
    description      text,
    catchphrase      text,
    first_episode_id bigint REFERENCES episodes(id),
    speaker_id       bigint REFERENCES speakers(id),
    image_url        text,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- CHARACTER APPEARANCES
-- ============================================================

CREATE TABLE IF NOT EXISTS character_appearances (
    id           bigint PRIMARY KEY,
    character_id bigint NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    episode_id   bigint NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    start_time   double precision,
    end_time     double precision,
    segment_idx  integer,
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_char_appearances_character ON character_appearances(character_id);
CREATE INDEX IF NOT EXISTS idx_char_appearances_episode   ON character_appearances(episode_id);

-- ============================================================
-- CHAPTER TYPES
-- ============================================================

CREATE TABLE IF NOT EXISTS chapter_types (
    id          bigint PRIMARY KEY,
    name        text NOT NULL UNIQUE,
    description text,
    color       text DEFAULT '#6366f1',
    icon        text,
    sort_order  integer DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- EPISODE CHAPTERS
-- ============================================================

CREATE TABLE IF NOT EXISTS episode_chapters (
    id                bigint PRIMARY KEY,
    episode_id        bigint NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    chapter_type_id   bigint NOT NULL REFERENCES chapter_types(id),
    title             text,
    start_time        double precision NOT NULL,
    end_time          double precision,
    start_segment_idx integer,
    end_segment_idx   integer,
    notes             text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episode_chapters_episode ON episode_chapters(episode_id);

-- ============================================================
-- AUDIO DROPS
-- ============================================================

CREATE TABLE IF NOT EXISTS audio_drops (
    id              bigint PRIMARY KEY,
    name            text NOT NULL UNIQUE,
    transcript_text text,
    description     text,
    category        text DEFAULT 'drop',
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- AUDIO DROP INSTANCES
-- ============================================================

CREATE TABLE IF NOT EXISTS audio_drop_instances (
    id            bigint PRIMARY KEY,
    audio_drop_id bigint NOT NULL REFERENCES audio_drops(id) ON DELETE CASCADE,
    episode_id    bigint NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    segment_idx   integer,
    start_time    double precision,
    end_time      double precision,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drop_instances_drop    ON audio_drop_instances(audio_drop_id);
CREATE INDEX IF NOT EXISTS idx_drop_instances_episode ON audio_drop_instances(episode_id);

-- ============================================================
-- WIKI LORE
-- ============================================================

CREATE TABLE IF NOT EXISTS wiki_lore (
    id               bigint PRIMARY KEY,
    name             text NOT NULL UNIQUE,
    category         text NOT NULL,
    description      text,
    wiki_url         text,
    wiki_page_id     integer,
    first_episode_id bigint REFERENCES episodes(id),
    aliases          text,
    last_synced      timestamptz,
    is_wiki_sourced  boolean NOT NULL DEFAULT true
);

-- ============================================================
-- WIKI LORE MENTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS wiki_lore_mentions (
    id               bigint PRIMARY KEY,
    lore_id          bigint NOT NULL REFERENCES wiki_lore(id) ON DELETE CASCADE,
    episode_id       bigint NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    segment_idx      integer,
    start_time       double precision,
    end_time         double precision,
    context_snippet  text,
    source           text DEFAULT 'auto',
    confidence       double precision DEFAULT 1.0,
    UNIQUE (lore_id, episode_id, segment_idx)
);

CREATE INDEX IF NOT EXISTS idx_wiki_mentions_lore    ON wiki_lore_mentions(lore_id);
CREATE INDEX IF NOT EXISTS idx_wiki_mentions_episode ON wiki_lore_mentions(episode_id);

-- ============================================================
-- WIKI EPISODE META
-- ============================================================

CREATE TABLE IF NOT EXISTS wiki_episode_meta (
    id                  bigint PRIMARY KEY,
    episode_id          bigint UNIQUE REFERENCES episodes(id) ON DELETE CASCADE,
    wiki_page_id        integer,
    wiki_url            text,
    summary             text,
    recording_location  text,
    air_date            timestamptz,
    topics_json         jsonb,
    guests_json         jsonb,
    bits_json           jsonb,
    scoopmail_json      jsonb,
    jock_vs_nerd        text,
    last_synced         timestamptz
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all public-facing tables
ALTER TABLE shows                ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_segments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE speakers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_speakers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE characters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_appearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE episode_chapters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_drops          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audio_drop_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_lore            ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_lore_mentions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE wiki_episode_meta    ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches       ENABLE ROW LEVEL SECURITY;

-- Public read: shows
CREATE POLICY "public_read_shows"
    ON shows FOR SELECT TO anon USING (true);

-- Public read: episodes (only public visibility)
CREATE POLICY "public_read_episodes"
    ON episodes FOR SELECT TO anon USING (visibility = 'public');

-- Public read: transcript segments (through episode visibility)
CREATE POLICY "public_read_segments"
    ON transcript_segments FOR SELECT TO anon
    USING (EXISTS (
        SELECT 1 FROM episodes e
        WHERE e.id = episode_id AND e.visibility = 'public'
    ));

-- Public read: speakers, episode_speakers, characters, character_appearances
CREATE POLICY "public_read_speakers"
    ON speakers FOR SELECT TO anon USING (true);

CREATE POLICY "public_read_episode_speakers"
    ON episode_speakers FOR SELECT TO anon USING (true);

CREATE POLICY "public_read_characters"
    ON characters FOR SELECT TO anon USING (true);

CREATE POLICY "public_read_character_appearances"
    ON character_appearances FOR SELECT TO anon USING (true);

-- Public read: chapter_types, episode_chapters
CREATE POLICY "public_read_chapter_types"
    ON chapter_types FOR SELECT TO anon USING (true);

CREATE POLICY "public_read_episode_chapters"
    ON episode_chapters FOR SELECT TO anon USING (true);

-- Public read: audio_drops, audio_drop_instances
CREATE POLICY "public_read_audio_drops"
    ON audio_drops FOR SELECT TO anon USING (true);

CREATE POLICY "public_read_audio_drop_instances"
    ON audio_drop_instances FOR SELECT TO anon USING (true);

-- Public read: wiki tables
CREATE POLICY "public_read_wiki_lore"
    ON wiki_lore FOR SELECT TO anon USING (true);

CREATE POLICY "public_read_wiki_lore_mentions"
    ON wiki_lore_mentions FOR SELECT TO anon USING (true);

CREATE POLICY "public_read_wiki_episode_meta"
    ON wiki_episode_meta FOR SELECT TO anon USING (true);

-- import_batches: no anon access (admin view only)
-- No SELECT policy for anon — service role bypasses RLS by default

-- ============================================================
-- Service role gets full access (RLS bypass via Supabase)
-- No explicit policies needed — service_role bypasses RLS.
-- All INSERT/UPDATE/DELETE are done via service role only.
-- ============================================================
