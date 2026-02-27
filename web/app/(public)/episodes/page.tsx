import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { createPublicClient } from "@/lib/supabase/server";
import EpisodeCard from "@/components/episodes/EpisodeCard";
import type { EpisodeCard as EpisodeCardType } from "@/lib/types";

export const metadata: Metadata = {
  title: "Episodes",
  description: "Browse all Ice Cream Social episodes.",
};

// Revalidate page every 6 hours (ISR) — new episodes don't drop that often
export const revalidate = 21600;

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "episode", label: "Episodes" },
  { value: "fubts", label: "FUBTS" },
  { value: "scoopflix", label: "Scoopflix" },
  { value: "abracababble", label: "Abracababble" },
  { value: "shituational", label: "Shituational" },
  { value: "bonus", label: "Bonus" },
];

const PAGE_SIZE = 48;

interface PageProps {
  searchParams: Promise<{
    page?: string;
    category?: string;
    q?: string;
  }>;
}

async function EpisodeGrid({
  page,
  category,
  q,
}: {
  page: number;
  category: string;
  q: string;
}) {
  const supabase = await createPublicClient();
  const offset = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("episodes")
    .select(
      "id, episode_number, title, description, published_date, duration, category, has_diarization, feed_source",
      { count: "exact" }
    )
    .eq("visibility", "public")
    .is("canonical_id", null) // hide duplicate "Ad Free" variants
    .order("published_date", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (category && category !== "all") {
    query = query.eq("category", category);
  }

  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return (
      <p className="text-red-400 text-center py-12">
        Failed to load episodes: {error.message}
      </p>
    );
  }

  const episodes = (data ?? []) as EpisodeCardType[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (episodes.length === 0) {
    return (
      <p className="text-gray-500 text-center py-16">No episodes found.</p>
    );
  }

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        {total.toLocaleString()} episode{total !== 1 ? "s" : ""}{" "}
        {q && <span>matching &ldquo;{q}&rdquo;</span>}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {episodes.map((ep) => (
          <EpisodeCard key={ep.id} episode={ep} />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          {page > 1 && (
            <PaginationLink
              href={buildHref({ page: page - 1, category, q })}
              label="← Previous"
            />
          )}
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <PaginationLink
              href={buildHref({ page: page + 1, category, q })}
              label="Next →"
            />
          )}
        </div>
      )}
    </>
  );
}

function PaginationLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:border-gray-500 hover:text-white transition-colors"
    >
      {label}
    </Link>
  );
}

function buildHref({
  page,
  category,
  q,
}: {
  page?: number;
  category?: string;
  q?: string;
}) {
  const params = new URLSearchParams();
  if (page && page > 1) params.set("page", String(page));
  if (category && category !== "all") params.set("category", category);
  if (q) params.set("q", q);
  const qs = params.toString();
  return `/episodes${qs ? `?${qs}` : ""}`;
}

export default async function EpisodesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const category = params.category ?? "all";
  const q = params.q ?? "";

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-1">Episodes</h1>
        <p className="text-sm text-gray-500">
          Matt &amp; Mattingly&apos;s Ice Cream Social — episode archive
        </p>
      </div>

      {/* Search bar */}
      <form method="GET" action="/episodes" className="mb-5 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search episode titles…"
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none"
        />
        {category !== "all" && (
          <input type="hidden" name="category" value={category} />
        )}
        <button
          type="submit"
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
        >
          Search
        </button>
        {q && (
          <Link
            href={buildHref({ category })}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            ✕
          </Link>
        )}
      </form>

      {/* Category tabs */}
      <div className="mb-6 flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <Link
            key={cat.value}
            href={buildHref({ category: cat.value, q, page: 1 })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === cat.value
                ? "bg-indigo-600 text-white"
                : "border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
            }`}
          >
            {cat.label}
          </Link>
        ))}
      </div>

      {/* Episode grid — Suspense boundary for streaming */}
      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="h-40 rounded-xl bg-gray-800/50 animate-pulse"
              />
            ))}
          </div>
        }
      >
        <EpisodeGrid page={page} category={category} q={q} />
      </Suspense>
    </div>
  );
}
