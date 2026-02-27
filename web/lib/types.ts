// ─────────────────────────────────────────────────────────────────────────────
// Hosted Supabase types (Phase 1 — read experience)
// Mirrors web/supabase/migrations/001_initial_schema.sql
// ─────────────────────────────────────────────────────────────────────────────

export type Visibility = "public" | "patron_only" | "admin_only";

export type ImportBatchStatus = "pending" | "in_progress" | "complete" | "failed";

// ─── Shows ────────────────────────────────────────────────────────────────────

export interface Show {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  rss_feed_url: string | null;
  artwork_url: string | null;
  created_at: string;
}

// ─── Episodes ─────────────────────────────────────────────────────────────────

export interface Episode {
  id: number;
  show_id: number;
  episode_number: string | null;
  title: string;
  description: string | null;
  audio_url: string;
  duration: number | null; // seconds
  published_date: string | null; // ISO-8601
  feed_source: string;
  category: string;
  category_number: string | null;
  sub_series: string | null;
  canonical_id: number | null;
  num_speakers: number | null;
  has_diarization: boolean;
  metadata_json: Record<string, unknown> | null;
  visibility: Visibility;
  imported_at: string;
  import_batch_id: number | null;
}

/** Lightweight card variant used for lists */
export interface EpisodeCard
  extends Pick<
    Episode,
    | "id"
    | "episode_number"
    | "title"
    | "description"
    | "published_date"
    | "duration"
    | "category"
    | "has_diarization"
    | "feed_source"
  > {}

// ─── Transcript Segments ──────────────────────────────────────────────────────

export interface TranscriptSegment {
  id: number;
  episode_id: number;
  segment_idx: number;
  speaker: string | null;
  text: string;
  start_time: number;
  end_time: number | null;
  is_performance_bit: boolean;
  /** text_search is a server-side tsvector — not returned in JSON responses */
}

// ─── Speakers ─────────────────────────────────────────────────────────────────

export interface Speaker {
  id: number;
  name: string;
  short_name: string | null;
  description: string | null;
  is_host: boolean;
  image_url: string | null;
  created_at: string;
}

export interface EpisodeSpeaker {
  id: number;
  episode_id: number;
  diarization_label: string;
  speaker_id: number | null;
  speaking_time_seconds: number | null;
  segment_count: number | null;
  confidence: number | null;
  source: string;
  speaker?: Speaker; // joined
}

// ─── Characters ───────────────────────────────────────────────────────────────

export interface Character {
  id: number;
  name: string;
  short_name: string | null;
  description: string | null;
  catchphrase: string | null;
  first_episode_id: number | null;
  speaker_id: number | null;
  image_url: string | null;
  created_at: string;
}

export interface CharacterAppearance {
  id: number;
  character_id: number;
  episode_id: number;
  start_time: number | null;
  end_time: number | null;
  segment_idx: number | null;
  notes: string | null;
  created_at: string;
  character?: Character; // joined
  episode?: EpisodeCard; // joined
}

// ─── Chapters ─────────────────────────────────────────────────────────────────

export interface ChapterType {
  id: number;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
}

export interface EpisodeChapter {
  id: number;
  episode_id: number;
  chapter_type_id: number;
  title: string | null;
  start_time: number;
  end_time: number | null;
  start_segment_idx: number | null;
  end_segment_idx: number | null;
  notes: string | null;
  created_at: string;
  chapter_type?: ChapterType; // joined
}

// ─── Audio Drops ──────────────────────────────────────────────────────────────

export interface AudioDrop {
  id: number;
  name: string;
  transcript_text: string | null;
  description: string | null;
  category: string;
  created_at: string;
}

export interface AudioDropInstance {
  id: number;
  audio_drop_id: number;
  episode_id: number;
  segment_idx: number | null;
  start_time: number | null;
  end_time: number | null;
  notes: string | null;
  created_at: string;
  audio_drop?: AudioDrop; // joined
}

// ─── Wiki ─────────────────────────────────────────────────────────────────────

export interface WikiLore {
  id: number;
  name: string;
  category: string;
  description: string | null;
  wiki_url: string | null;
  wiki_page_id: number | null;
  first_episode_id: number | null;
  aliases: string | null;
  last_synced: string | null;
  is_wiki_sourced: boolean;
}

export interface WikiLoreMention {
  id: number;
  lore_id: number;
  episode_id: number;
  segment_idx: number | null;
  start_time: number | null;
  end_time: number | null;
  context_snippet: string | null;
  source: string;
  confidence: number;
  wiki_lore?: WikiLore; // joined
}

export interface WikiEpisodeMeta {
  id: number;
  episode_id: number;
  wiki_page_id: number | null;
  wiki_url: string | null;
  summary: string | null;
  recording_location: string | null;
  air_date: string | null;
  topics_json: unknown[] | null;
  guests_json: unknown[] | null;
  bits_json: unknown[] | null;
  scoopmail_json: unknown[] | null;
  jock_vs_nerd: string | null;
  last_synced: string | null;
}

// ─── API responses ────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  per_page: number;
  total: number;
  has_more: boolean;
}

export interface EpisodesResponse extends PaginatedResponse<EpisodeCard> {
  categories: string[];
}

// ─── Search ───────────────────────────────────────────────────────────────────

export interface SearchResult {
  segment: TranscriptSegment;
  episode: EpisodeCard;
  rank: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Format seconds as "1h 23m" or "42m" */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Format published_date as "Jan 15, 2024" */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
