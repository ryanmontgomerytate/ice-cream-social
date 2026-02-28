-- ============================================================
-- Phase 1: Search relevance tuning (broad/common query quality)
-- ============================================================
-- Goals:
-- - Improve tie-break behavior for ranked search with normalized rank + phrase boost.
-- - Improve single-token/broad query quality without reintroducing statement timeouts.
-- - Keep fast path bounded by a recency candidate window, then rerank for relevance.
-- ============================================================

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
            websearch_to_tsquery('english', trim(search_query)) AS q,
            phraseto_tsquery('english', trim(search_query)) AS phrase_q
    ),
    ranked AS (
        SELECT
            ts.id,
            ts.episode_id,
            ts.segment_idx,
            ts.speaker,
            ts.text,
            ts.start_time,
            ts.end_time,
            ts.is_performance_bit,
            ts_rank_cd(ts.text_search, n.q, 32) AS rank_base,
            (ts.text_search @@ n.phrase_q) AS phrase_match,
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
    )
    SELECT
        r.id,
        r.episode_id,
        r.segment_idx,
        r.speaker,
        r.text,
        r.start_time,
        r.end_time,
        r.is_performance_bit,
        (r.rank_base + CASE WHEN r.phrase_match THEN 0.35 ELSE 0 END)::real AS rank,
        r.episode_number,
        r.episode_title,
        r.episode_description,
        r.episode_published_date,
        r.episode_duration,
        r.episode_category,
        r.episode_has_diarization,
        r.episode_feed_source
    FROM ranked r
    ORDER BY
        r.phrase_match DESC,
        r.rank_base DESC,
        r.episode_published_date DESC NULLS LAST,
        r.episode_id DESC,
        r.segment_idx ASC
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
            plainto_tsquery('english', trim(search_query)) AS q,
            phraseto_tsquery('english', trim(search_query)) AS phrase_q,
            LEAST(
                5000,
                GREATEST(200, GREATEST(COALESCE(page_number, 1), 1) * LEAST(GREATEST(COALESCE(page_size, 20), 1), 100) * 40)
            ) AS candidate_limit
    ),
    candidates AS (
        SELECT
            ts.id,
            ts.episode_id,
            ts.segment_idx,
            ts.speaker,
            ts.text,
            ts.start_time,
            ts.end_time,
            ts.is_performance_bit,
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
        LIMIT (SELECT candidate_limit FROM normalized)
    ),
    ranked AS (
        SELECT
            c.id,
            c.episode_id,
            c.segment_idx,
            c.speaker,
            c.text,
            c.start_time,
            c.end_time,
            c.is_performance_bit,
            ts_rank_cd(ts.text_search, n.q, 32) AS rank_base,
            (ts.text_search @@ n.phrase_q) AS phrase_match,
            c.episode_number,
            c.episode_title,
            c.episode_description,
            c.episode_published_date,
            c.episode_duration,
            c.episode_category,
            c.episode_has_diarization,
            c.episode_feed_source
        FROM candidates c
        JOIN transcript_segments ts ON ts.id = c.id
        CROSS JOIN normalized n
    )
    SELECT
        r.id,
        r.episode_id,
        r.segment_idx,
        r.speaker,
        r.text,
        r.start_time,
        r.end_time,
        r.is_performance_bit,
        (r.rank_base + CASE WHEN r.phrase_match THEN 0.25 ELSE 0 END)::real AS rank,
        r.episode_number,
        r.episode_title,
        r.episode_description,
        r.episode_published_date,
        r.episode_duration,
        r.episode_category,
        r.episode_has_diarization,
        r.episode_feed_source
    FROM ranked r
    ORDER BY
        r.phrase_match DESC,
        r.rank_base DESC,
        r.episode_published_date DESC NULLS LAST,
        r.episode_id DESC,
        r.segment_idx ASC
    LIMIT (SELECT s FROM normalized)
    OFFSET ((SELECT p FROM normalized) - 1) * (SELECT s FROM normalized);
$$;

GRANT EXECUTE ON FUNCTION public.search_transcript_segments_fast(text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.search_transcript_segments_fast(text, integer, integer) TO authenticated;
