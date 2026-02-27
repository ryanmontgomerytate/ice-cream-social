-- ============================================================
-- Phase 1: Fast transcript search RPC (no ranking)
-- ============================================================
-- Purpose:
-- - Avoid statement timeouts for broad queries by using a lighter path.
-- - Keep deterministic recency-first ordering without ts_rank computation.
-- ============================================================

-- Recreate ranked function with SECURITY DEFINER for predictable RLS performance.
CREATE OR REPLACE FUNCTION public.search_transcript_segments(
    search_query text,
    page_number integer DEFAULT 1,
    page_size integer DEFAULT 20
)
RETURNS TABLE (
    id bigint,
    episode_id bigint,
    segment_idx integer,
    speaker text,
    text text,
    start_time double precision,
    end_time double precision,
    is_performance_bit boolean,
    rank real,
    episode_number text,
    episode_title text,
    episode_description text,
    episode_published_date timestamptz,
    episode_duration double precision,
    episode_category text,
    episode_has_diarization boolean,
    episode_feed_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH normalized AS (
        SELECT
            GREATEST(COALESCE(page_number, 1), 1) AS p,
            LEAST(GREATEST(COALESCE(page_size, 20), 1), 100) AS s,
            websearch_to_tsquery('english', trim(search_query)) AS q
    )
    SELECT
        ts.id,
        ts.episode_id,
        ts.segment_idx,
        ts.speaker,
        ts.text,
        ts.start_time,
        ts.end_time,
        ts.is_performance_bit,
        ts_rank_cd(ts.text_search, n.q) AS rank,
        e.episode_number,
        e.title AS episode_title,
        e.description AS episode_description,
        e.published_date AS episode_published_date,
        e.duration AS episode_duration,
        e.category AS episode_category,
        e.has_diarization AS episode_has_diarization,
        e.feed_source AS episode_feed_source
    FROM normalized n
    JOIN transcript_segments ts ON ts.text_search @@ n.q
    JOIN episodes e ON e.id = ts.episode_id
    WHERE e.visibility = 'public'
    ORDER BY rank DESC, e.published_date DESC NULLS LAST, ts.episode_id DESC, ts.segment_idx ASC
    LIMIT (SELECT s FROM normalized)
    OFFSET ((SELECT p FROM normalized) - 1) * (SELECT s FROM normalized);
$$;

GRANT EXECUTE ON FUNCTION public.search_transcript_segments(text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_transcript_segments(text, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.search_transcript_segments_fast(
    search_query text,
    page_number integer DEFAULT 1,
    page_size integer DEFAULT 20
)
RETURNS TABLE (
    id bigint,
    episode_id bigint,
    segment_idx integer,
    speaker text,
    text text,
    start_time double precision,
    end_time double precision,
    is_performance_bit boolean,
    rank real,
    episode_number text,
    episode_title text,
    episode_description text,
    episode_published_date timestamptz,
    episode_duration double precision,
    episode_category text,
    episode_has_diarization boolean,
    episode_feed_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH normalized AS (
        SELECT
            GREATEST(COALESCE(page_number, 1), 1) AS p,
            LEAST(GREATEST(COALESCE(page_size, 20), 1), 100) AS s,
            plainto_tsquery('english', trim(search_query)) AS q
    )
    SELECT
        ts.id,
        ts.episode_id,
        ts.segment_idx,
        ts.speaker,
        ts.text,
        ts.start_time,
        ts.end_time,
        ts.is_performance_bit,
        NULL::real AS rank,
        e.episode_number,
        e.title AS episode_title,
        e.description AS episode_description,
        e.published_date AS episode_published_date,
        e.duration AS episode_duration,
        e.category AS episode_category,
        e.has_diarization AS episode_has_diarization,
        e.feed_source AS episode_feed_source
    FROM normalized n
    JOIN transcript_segments ts ON ts.text_search @@ n.q
    JOIN episodes e ON e.id = ts.episode_id
    WHERE e.visibility = 'public'
    ORDER BY e.published_date DESC NULLS LAST, ts.episode_id DESC, ts.segment_idx ASC
    LIMIT (SELECT s FROM normalized)
    OFFSET ((SELECT p FROM normalized) - 1) * (SELECT s FROM normalized);
$$;

GRANT EXECUTE ON FUNCTION public.search_transcript_segments_fast(text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_transcript_segments_fast(text, integer, integer) TO authenticated;
