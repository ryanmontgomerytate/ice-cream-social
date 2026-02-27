import { createPublicClient } from "@/lib/supabase/server";
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
}

type SearchRow = TranscriptSegment & {
  episode: EpisodeCard | EpisodeCard[] | null;
};

function normalizeEpisode(raw: EpisodeCard | EpisodeCard[] | null): EpisodeCard | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

export async function searchTranscriptSegments({
  q,
  page = DEFAULT_PAGE,
  perPage = DEFAULT_PER_PAGE,
}: SearchOptions): Promise<SearchQueryResult> {
  const query = q.trim();
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

  const supabase = await createPublicClient();
  const offset = (safePage - 1) * safePerPage;

  const { data, count, error } = await supabase
    .from("transcript_segments")
    .select(
      `
      id,
      episode_id,
      segment_idx,
      speaker,
      text,
      start_time,
      end_time,
      is_performance_bit,
      episode:episodes!inner(
        id,
        episode_number,
        title,
        description,
        published_date,
        duration,
        category,
        has_diarization,
        feed_source
      )
      `,
      { count: "exact" }
    )
    .textSearch("text_search", query, { type: "websearch", config: "english" })
    .order("published_date", { referencedTable: "episodes", ascending: false })
    .order("segment_idx", { ascending: true })
    .range(offset, offset + safePerPage - 1);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SearchRow[];
  const results: SearchResult[] = rows
    .map((row) => {
      const episode = normalizeEpisode(row.episode);
      if (!episode) return null;

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

      return {
        segment,
        episode,
        // PostgREST doesn't expose ts_rank directly in this query shape.
        // Keep deterministic ordering + placeholder rank for now.
        rank: 1,
      };
    })
    .filter((item): item is SearchResult => item !== null);

  const total = count ?? 0;
  return {
    query,
    results,
    total,
    page: safePage,
    per_page: safePerPage,
    has_more: offset + safePerPage < total,
  };
}
