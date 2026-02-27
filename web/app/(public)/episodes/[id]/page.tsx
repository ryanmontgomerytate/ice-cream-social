import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/server";
import { formatDate, formatDuration } from "@/lib/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface EpisodeDetail {
  id: number;
  episode_number: string | null;
  title: string;
  description: string | null;
  published_date: string | null;
  duration: number | null;
  category: string;
  feed_source: string;
  has_diarization: boolean;
}

interface SegmentPreview {
  id: number;
  segment_idx: number;
  speaker: string | null;
  text: string;
  start_time: number;
}

interface ChapterPreview {
  id: number;
  title: string | null;
  start_time: number;
  end_time: number | null;
  chapter_type: {
    name: string;
    color: string;
  } | { name: string; color: string }[] | null;
}

interface SpeakerPreview {
  id: number;
  diarization_label: string;
  segment_count: number | null;
  speaking_time_seconds: number | null;
  confidence: number | null;
  speaker: {
    name: string;
    short_name: string | null;
  } | { name: string; short_name: string | null }[] | null;
}

interface WikiEpisodeMeta {
  summary: string | null;
  wiki_url: string | null;
}

function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds == null) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function normalizeOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Episode ${id}` };
}

export default async function EpisodeDetailPage({ params }: PageProps) {
  const rawId = (await params).id;
  const id = parseInt(rawId, 10);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const supabase = await createPublicClient();

  const { data: episode, error: episodeError } = await supabase
    .from("episodes")
    .select(
      "id, episode_number, title, description, published_date, duration, category, feed_source, has_diarization"
    )
    .eq("id", id)
    .eq("visibility", "public")
    .maybeSingle<EpisodeDetail>();

  if (episodeError || !episode) {
    notFound();
  }

  const [segmentsRes, chaptersRes, speakersRes, wikiMetaRes] = await Promise.all([
    supabase
      .from("transcript_segments")
      .select("id, segment_idx, speaker, text, start_time")
      .eq("episode_id", id)
      .order("segment_idx", { ascending: true })
      .limit(250),
    supabase
      .from("episode_chapters")
      .select("id, title, start_time, end_time, chapter_type:chapter_types(name, color)")
      .eq("episode_id", id)
      .order("start_time", { ascending: true }),
    supabase
      .from("episode_speakers")
      .select("id, diarization_label, segment_count, speaking_time_seconds, confidence, speaker:speakers(name, short_name)")
      .eq("episode_id", id)
      .order("speaking_time_seconds", { ascending: false }),
    supabase
      .from("wiki_episode_meta")
      .select("summary, wiki_url")
      .eq("episode_id", id)
      .maybeSingle<WikiEpisodeMeta>(),
  ]);

  const segments = ((segmentsRes.data ?? []) as SegmentPreview[]).slice(0, 250);
  const chapters = ((chaptersRes.data ?? []) as unknown as ChapterPreview[]).map((chapter) => ({
    ...chapter,
    chapter_type: normalizeOne(chapter.chapter_type),
  }));
  const speakers = ((speakersRes.data ?? []) as unknown as SpeakerPreview[]).map((entry) => ({
    ...entry,
    speaker: normalizeOne(entry.speaker),
  }));
  const wikiMeta = wikiMetaRes.data ?? null;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/episodes"
          className="mb-3 inline-block text-sm text-gray-500 hover:text-gray-300"
        >
          ← Back to Episodes
        </Link>
        <h1 className="text-3xl font-bold text-white">
          {episode.episode_number ? `#${episode.episode_number} · ` : ""}
          {episode.title}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {episode.category} • {formatDate(episode.published_date) || "Unknown date"} •{" "}
          {formatDuration(episode.duration) || "Unknown duration"} • {episode.feed_source}
        </p>
      </div>

      {episode.description && (
        <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Description
          </h2>
          <p className="text-sm leading-relaxed text-gray-200">{episode.description}</p>
        </section>
      )}

      {wikiMeta?.summary && (
        <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Wiki Summary
          </h2>
          <p className="text-sm leading-relaxed text-gray-200">{wikiMeta.summary}</p>
          {wikiMeta.wiki_url && (
            <a
              href={wikiMeta.wiki_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-brand-400 hover:text-brand-300"
            >
              Open wiki page →
            </a>
          )}
        </section>
      )}

      {chapters.length > 0 && (
        <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Chapters
          </h2>
          <div className="flex flex-wrap gap-2">
            {chapters.map((chapter) => (
              <span
                key={chapter.id}
                className="rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: chapter.chapter_type?.color ?? "#52525b",
                  color: chapter.chapter_type?.color ?? "#d4d4d8",
                  backgroundColor: `${chapter.chapter_type?.color ?? "#27272a"}22`,
                }}
                title={
                  chapter.end_time != null
                    ? `${formatTimestamp(chapter.start_time)} - ${formatTimestamp(chapter.end_time)}`
                    : formatTimestamp(chapter.start_time)
                }
              >
                {(chapter.chapter_type?.name ?? "Chapter") +
                  (chapter.title ? `: ${chapter.title}` : "")}
              </span>
            ))}
          </div>
        </section>
      )}

      {speakers.length > 0 && (
        <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Speaker Assignments
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {speakers.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2 text-xs text-gray-300"
              >
                <div className="font-medium text-gray-100">
                  {entry.speaker?.name ?? entry.diarization_label}
                </div>
                <div className="mt-1 text-gray-500">
                  {entry.segment_count ?? 0} segments •{" "}
                  {formatDuration(entry.speaking_time_seconds) || "0m"}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Transcript Preview
        </h2>
        {segments.length === 0 && (
          <p className="text-sm text-gray-500">No transcript segments available.</p>
        )}
        {segments.length > 0 && (
          <ol className="space-y-3">
            {segments.map((segment) => (
              <li
                key={segment.id}
                id={`seg-${segment.segment_idx}`}
                className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2"
              >
                <div className="mb-1 text-xs text-gray-500">
                  <span>{formatTimestamp(segment.start_time)}</span>
                  {segment.speaker && (
                    <>
                      <span> • </span>
                      <span className="text-gray-300">{segment.speaker}</span>
                    </>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-gray-200">{segment.text}</p>
              </li>
            ))}
          </ol>
        )}
        {segments.length >= 250 && (
          <p className="mt-3 text-xs text-gray-500">
            Showing first 250 segments.
          </p>
        )}
      </section>
    </div>
  );
}
