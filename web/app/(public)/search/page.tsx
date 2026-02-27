import Link from "next/link";
import type { Metadata } from "next";
import { searchTranscriptSegments } from "@/lib/search";

export const metadata: Metadata = {
  title: "Search Transcripts",
  description: "Search across all Ice Cream Social episode transcripts.",
};

interface PageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
  }>;
}

const PAGE_SIZE = 20;

function formatTimestamp(seconds: number | null | undefined): string {
  if (seconds == null) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function buildHref(q: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/search${query ? `?${query}` : ""}`;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const page = Math.max(1, parseInt(params.page ?? "1", 10));

  const { results, total, has_more } = await searchTranscriptSegments({
    q,
    page,
    perPage: PAGE_SIZE,
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Search Transcripts</h1>
        <p className="text-sm text-gray-500">
          Full-text search across hosted transcript segments
        </p>
      </div>

      <form action="/search" method="GET" className="mb-6 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Try: Penn Jillette, scoop mail, Jock vs Nerd..."
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
        >
          Search
        </button>
      </form>

      {!q && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-6 text-sm text-gray-400">
          Enter a search term to find matching transcript lines.
        </div>
      )}

      {q && (
        <p className="mb-4 text-xs text-gray-600">
          {total.toLocaleString()} result{total !== 1 ? "s" : ""} for{" "}
          <span className="text-gray-300">&ldquo;{q}&rdquo;</span>
        </p>
      )}

      {q && results.length === 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-6 text-sm text-gray-400">
          No matches found. Try fewer words or different spellings.
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <article
              key={result.segment.id}
              className="rounded-xl border border-gray-800 bg-gray-900/70 p-4"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="rounded border border-gray-700 px-2 py-0.5 text-gray-300">
                  {result.episode.category}
                </span>
                {result.episode.episode_number && <span>#{result.episode.episode_number}</span>}
                <span>•</span>
                <span>{result.episode.title}</span>
                <span>•</span>
                <span>{formatTimestamp(result.segment.start_time)}</span>
                {result.segment.speaker && (
                  <>
                    <span>•</span>
                    <span className="text-gray-300">{result.segment.speaker}</span>
                  </>
                )}
              </div>
              <p className="text-sm leading-relaxed text-gray-200">
                {result.segment.text}
              </p>
              <div className="mt-3">
                <Link
                  href={`/episodes/${result.episode.id}#seg-${result.segment.segment_idx}`}
                  className="text-xs text-brand-400 hover:text-brand-300"
                >
                  Open episode context →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {q && total > PAGE_SIZE && (
        <div className="mt-8 flex items-center justify-center gap-3">
          {page > 1 && (
            <Link
              href={buildHref(q, page - 1)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white transition-colors"
            >
              ← Previous
            </Link>
          )}
          <span className="text-sm text-gray-500">Page {page}</span>
          {has_more && (
            <Link
              href={buildHref(q, page + 1)}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white transition-colors"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
