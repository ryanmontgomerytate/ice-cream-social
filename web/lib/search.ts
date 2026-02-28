import { createPublicClient } from "@/lib/supabase/server";
import * as Sentry from "@sentry/nextjs";
import type { EpisodeCard, SearchResult, TranscriptSegment } from "@/lib/types";

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

interface SearchOptions {
  q: string;
  page?: number;
  perPage?: number;
}

export interface SearchQueryResult {
  query: string;
  results: SearchResult[];
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
  warning?: string;
  diagnostics_id?: string;
}

interface RpcSearchRow {
  id: number;
  episode_id: number;
  segment_idx: number;
  speaker: string | null;
  text: string;
  start_time: number;
  end_time: number | null;
  is_performance_bit: boolean;
  rank: number | null;
  episode_number: string | null;
  episode_title: string;
  episode_description: string | null;
  episode_published_date: string | null;
  episode_duration: number | null;
  episode_category: string;
  episode_has_diarization: boolean;
  episode_feed_source: string;
}

function createDiagnosticsId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isStatementTimeout(message: string): boolean {
  return /statement timeout/i.test(message);
}

function isMissingRankedSearchRpc(message: string): boolean {
  return /search_transcript_segments|could not find the function/i.test(message);
}

function isMissingFastSearchRpc(message: string): boolean {
  return /search_transcript_segments_fast|could not find the function/i.test(message);
}

function mapRpcRowToResult(row: RpcSearchRow): SearchResult {
  const segment: TranscriptSegment = {
    id: row.id,
    episode_id: row.episode_id,
    segment_idx: row.segment_idx,
    speaker: row.speaker ?? null,
    text: row.text,
    start_time: row.start_time,
    end_time: row.end_time ?? null,
    is_performance_bit: row.is_performance_bit,
  };

  const episode: EpisodeCard = {
    id: row.episode_id,
    episode_number: row.episode_number,
    title: row.episode_title,
    description: row.episode_description,
    published_date: row.episode_published_date,
    duration: row.episode_duration,
    category: row.episode_category,
    has_diarization: row.episode_has_diarization,
    feed_source: row.episode_feed_source,
  };

  return {
    segment,
    episode,
    rank: row.rank ?? 0,
  };
}

function captureSearchMessage(
  level: "warning" | "error",
  message: string,
  context: Record<string, unknown>
) {
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setTag("feature", "search");
    scope.setContext("search", context);
    Sentry.captureMessage(message);
  });
}

async function fallbackSearchWithoutRpc({
  query,
  page,
  perPage,
}: {
  query: string;
  page: number;
  perPage: number;
}): Promise<SearchQueryResult> {
  const supabase = await createPublicClient();
  const offset = (page - 1) * perPage;

  const { data, error } = await Sentry.startSpan(
    {
      op: "db.query",
      name: "fallback transcript search",
      attributes: {
        query_length: query.length,
        page,
        per_page: perPage,
      },
    },
    () =>
      supabase
        .from("transcript_segments")
        .select("id, episode_id, segment_idx, speaker, text, start_time, end_time, is_performance_bit")
        .textSearch("text_search", query, { type: "websearch", config: "english" })
        .order("episode_id", { ascending: false })
        .order("segment_idx", { ascending: true })
        .range(offset, offset + perPage)
  );

  if (error) {
    const diagnosticsId = createDiagnosticsId();

    console.error(`[search:${diagnosticsId}] fallback search failed`, {
      query,
      page,
      per_page: perPage,
      offset,
      error: error.message,
    });

    if (isStatementTimeout(error.message)) {
      captureSearchMessage("warning", "Fallback search timed out", {
        query,
        page,
        per_page: perPage,
        diagnostics_id: diagnosticsId,
      });
      return {
        query,
        results: [],
        total: 0,
        page,
        per_page: perPage,
        has_more: false,
        warning:
          "Search timed out on the backend. Try a more specific query or fewer broad terms.",
        diagnostics_id: diagnosticsId,
      };
    }

    captureSearchMessage("error", "Fallback search failed", {
      query,
      page,
      per_page: perPage,
      diagnostics_id: diagnosticsId,
      error: error.message,
    });
    throw new Error(`[search:${diagnosticsId}] ${error.message}`);
  }

  const segmentRows = (data ?? []) as TranscriptSegment[];
  const hasMore = segmentRows.length > perPage;
  const visibleSegments = hasMore ? segmentRows.slice(0, perPage) : segmentRows;

  const episodeIds = Array.from(new Set(visibleSegments.map((row) => row.episode_id)));
  let episodeMap = new Map<number, EpisodeCard>();

  if (episodeIds.length > 0) {
    const { data: episodes, error: episodesError } = await supabase
      .from("episodes")
      .select(
        "id, episode_number, title, description, published_date, duration, category, has_diarization, feed_source"
      )
      .in("id", episodeIds);

    if (episodesError) {
      const diagnosticsId = createDiagnosticsId();
      console.error(`[search:${diagnosticsId}] fallback episode hydrate failed`, {
        query,
        episode_ids: episodeIds.length,
        error: episodesError.message,
      });
      throw new Error(`[search:${diagnosticsId}] ${episodesError.message}`);
    }

    episodeMap = new Map(((episodes ?? []) as EpisodeCard[]).map((ep) => [ep.id, ep]));
  }

  const results: SearchResult[] = visibleSegments
    .map((segment) => {
      const episode = episodeMap.get(segment.episode_id);
      if (!episode) return null;
      return {
        segment,
        episode,
        rank: 0,
      };
    })
    .filter((item): item is SearchResult => item !== null);

  const total = offset + results.length + (hasMore ? 1 : 0);
  return {
    query,
    results,
    total,
    page,
    per_page: perPage,
    has_more: hasMore || offset + perPage < total,
  };
}

async function searchWithFastRpc({
  query,
  page,
  perPage,
}: {
  query: string;
  page: number;
  perPage: number;
}): Promise<SearchQueryResult> {
  const supabase = await createPublicClient();
  const offset = (page - 1) * perPage;

  const { data, error } = await Sentry.startSpan(
    {
      op: "db.rpc",
      name: "search_transcript_segments_fast",
      attributes: {
        query_length: query.length,
        page,
        per_page: perPage,
      },
    },
    () =>
      supabase.rpc("search_transcript_segments_fast", {
        search_query: query,
        page_number: page,
        page_size: perPage + 1,
      })
  );

  if (error) {
    const diagnosticsId = createDiagnosticsId();

    console.error(`[search:${diagnosticsId}] fast rpc failed`, {
      query,
      page,
      per_page: perPage,
      offset,
      error: error.message,
    });

    if (isStatementTimeout(error.message)) {
      captureSearchMessage("warning", "Fast search RPC timed out", {
        query,
        page,
        per_page: perPage,
        diagnostics_id: diagnosticsId,
      });
      return {
        query,
        results: [],
        total: 0,
        page,
        per_page: perPage,
        has_more: false,
        warning:
          "Search timed out on the backend. Try a more specific query or fewer broad terms.",
        diagnostics_id: diagnosticsId,
      };
    }

    if (isMissingFastSearchRpc(error.message)) {
      captureSearchMessage("warning", "Fast search RPC missing; using fallback query", {
        query,
        page,
        per_page: perPage,
        diagnostics_id: diagnosticsId,
      });
      console.warn(`[search:${diagnosticsId}] fast rpc not available; falling back to legacy query`);
      return fallbackSearchWithoutRpc({ query, page, perPage });
    }

    captureSearchMessage("error", "Fast search RPC failed", {
      query,
      page,
      per_page: perPage,
      diagnostics_id: diagnosticsId,
      error: error.message,
    });
    throw new Error(`[search:${diagnosticsId}] ${error.message}`);
  }

  const rows = (data ?? []) as RpcSearchRow[];
  const hasMore = rows.length > perPage;
  const visibleRows = hasMore ? rows.slice(0, perPage) : rows;
  const results = visibleRows.map(mapRpcRowToResult);
  const total = offset + results.length + (hasMore ? 1 : 0);

  return {
    query,
    results,
    total,
    page,
    per_page: perPage,
    has_more: hasMore,
  };
}

export async function searchTranscriptSegments({
  q,
  page = DEFAULT_PAGE,
  perPage = DEFAULT_PER_PAGE,
}: SearchOptions): Promise<SearchQueryResult> {
  const query = q.trim();
  const queryTokens = query.split(/\s+/).filter(Boolean);
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : DEFAULT_PAGE;
  const safePerPage = Number.isFinite(perPage)
    ? Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(perPage)))
    : DEFAULT_PER_PAGE;

  if (!query) {
    return {
      query: "",
      results: [],
      total: 0,
      page: safePage,
      per_page: safePerPage,
      has_more: false,
    };
  }

  return Sentry.startSpan(
    {
      op: "ics.search",
      name: "searchTranscriptSegments",
      attributes: {
        query_length: query.length,
        query_tokens: queryTokens.length,
        page: safePage,
        per_page: safePerPage,
      },
    },
    async () => {
      // Single-token queries are usually broad and can time out under full ranked sorting.
      // Use the fast RPC path (recency-bounded candidate window + lightweight rerank).
      if (queryTokens.length <= 1) {
        return searchWithFastRpc({
          query,
          page: safePage,
          perPage: safePerPage,
        });
      }

      const supabase = await createPublicClient();
      const offset = (safePage - 1) * safePerPage;

      // Preferred path: ranked RPC (ts_rank_cd + recency tie-break).
      const { data, error } = await Sentry.startSpan(
        {
          op: "db.rpc",
          name: "search_transcript_segments",
          attributes: {
            query_length: query.length,
            page: safePage,
            per_page: safePerPage,
          },
        },
        () =>
          supabase.rpc("search_transcript_segments", {
            search_query: query,
            page_number: safePage,
            page_size: safePerPage + 1,
          })
      );

      if (error) {
        const diagnosticsId = createDiagnosticsId();

        console.error(`[search:${diagnosticsId}] ranked rpc failed`, {
          query,
          page: safePage,
          per_page: safePerPage,
          offset,
          error: error.message,
        });

        if (isStatementTimeout(error.message)) {
          captureSearchMessage("warning", "Ranked search RPC timed out", {
            query,
            page: safePage,
            per_page: safePerPage,
            diagnostics_id: diagnosticsId,
          });

          try {
            const fallback = await searchWithFastRpc({
              query,
              page: safePage,
              perPage: safePerPage,
            });

            return {
              ...fallback,
              warning:
                fallback.warning ??
                "Ranked search timed out. Showing fallback results ordered by recency.",
              diagnostics_id: fallback.diagnostics_id ?? diagnosticsId,
            };
          } catch (fallbackError) {
            const fallbackMessage =
              fallbackError instanceof Error ? fallbackError.message : "fallback search failed";
            captureSearchMessage("error", "Search timeout fallback failed", {
              query,
              page: safePage,
              per_page: safePerPage,
              diagnostics_id: diagnosticsId,
              error: fallbackMessage,
            });

            console.error(`[search:${diagnosticsId}] fallback after timeout failed`, {
              query,
              page: safePage,
              per_page: safePerPage,
              error: fallbackMessage,
            });

            return {
              query,
              results: [],
              total: 0,
              page: safePage,
              per_page: safePerPage,
              has_more: false,
              warning:
                "Search timed out on the backend. Try a more specific query or fewer broad terms.",
              diagnostics_id: diagnosticsId,
            };
          }
        }

        if (isMissingRankedSearchRpc(error.message)) {
          captureSearchMessage("warning", "Ranked search RPC missing; using fast path", {
            query,
            page: safePage,
            per_page: safePerPage,
            diagnostics_id: diagnosticsId,
          });
          console.warn(
            `[search:${diagnosticsId}] ranked rpc not available; falling back to fast search path`
          );
          return searchWithFastRpc({
            query,
            page: safePage,
            perPage: safePerPage,
          });
        }

        captureSearchMessage("error", "Ranked search RPC failed", {
          query,
          page: safePage,
          per_page: safePerPage,
          diagnostics_id: diagnosticsId,
          error: error.message,
        });
        throw new Error(`[search:${diagnosticsId}] ${error.message}`);
      }

      const rows = (data ?? []) as RpcSearchRow[];
      const hasMore = rows.length > safePerPage;
      const visibleRows = hasMore ? rows.slice(0, safePerPage) : rows;
      const results = visibleRows.map(mapRpcRowToResult);
      const total = offset + results.length + (hasMore ? 1 : 0);

      return {
        query,
        results,
        total,
        page: safePage,
        per_page: safePerPage,
        has_more: hasMore,
      };
    }
  );
}
