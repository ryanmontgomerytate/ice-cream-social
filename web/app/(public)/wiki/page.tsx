import type { Metadata } from "next";
import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/types";

export const metadata: Metadata = {
  title: "Wiki",
  description: "Browse lore, characters, and recurring bits from Ice Cream Social.",
};

export const revalidate = 21600;

const PAGE_SIZE = 48;

interface WikiLoreListRow {
  id: number;
  name: string;
  category: string;
  description: string | null;
  aliases: string | null;
  first_episode_id: number | null;
  last_synced: string | null;
  is_wiki_sourced: boolean;
}

interface PageProps {
  searchParams: Promise<{
    page?: string;
    category?: string;
    q?: string;
  }>;
}

function loreSlug(name: string): string {
  return encodeURIComponent(name.trim().replace(/\s+/g, "-"));
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
  return `/wiki${qs ? `?${qs}` : ""}`;
}

export default async function WikiIndexPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const category = params.category ?? "all";
  const q = (params.q ?? "").trim();
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await createPublicClient();

  const [categoryRes, loreRes] = await Promise.all([
    supabase.from("wiki_lore").select("category").order("category", { ascending: true }),
    (async () => {
      let query = supabase
        .from("wiki_lore")
        .select(
          "id, name, category, description, aliases, first_episode_id, last_synced, is_wiki_sourced",
          { count: "exact" }
        )
        .order("name", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (category !== "all") {
        query = query.eq("category", category);
      }

      if (q) {
        query = query.or(
          `name.ilike.%${q}%,aliases.ilike.%${q}%,description.ilike.%${q}%`
        );
      }

      return query;
    })(),
  ]);

  if (loreRes.error) {
    return (
      <p className="py-12 text-center text-red-400">
        Failed to load wiki entries: {loreRes.error.message}
      </p>
    );
  }

  const categories = Array.from(
    new Set((categoryRes.data ?? []).map((row) => row.category).filter(Boolean))
  );
  const loreEntries = (loreRes.data ?? []) as WikiLoreListRow[];
  const total = loreRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-2xl font-bold text-white">Wiki Lore</h1>
        <p className="text-sm text-gray-500">
          Discover recurring bits, characters, and lore references across ICS episodes.
        </p>
      </div>

      <form method="GET" action="/wiki" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search lore names, aliases, and descriptions…"
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-gray-500 focus:outline-none"
        />
        {category !== "all" && <input type="hidden" name="category" value={category} />}
        <button
          type="submit"
          className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-700"
        >
          Search
        </button>
        {q && (
          <Link
            href={buildHref({ category })}
            className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-500 transition-colors hover:text-gray-300"
          >
            ✕
          </Link>
        )}
      </form>

      <div className="flex flex-wrap gap-2">
        <Link
          href={buildHref({ category: "all", q, page: 1 })}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            category === "all"
              ? "bg-indigo-600 text-white"
              : "border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
          }`}
        >
          All
        </Link>
        {categories.map((value) => (
          <Link
            key={value}
            href={buildHref({ category: value, q, page: 1 })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === value
                ? "bg-indigo-600 text-white"
                : "border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
            }`}
          >
            {value}
          </Link>
        ))}
      </div>

      <p className="text-xs text-gray-600">
        {total.toLocaleString()} lore entr{total === 1 ? "y" : "ies"}
        {q && <span> matching &ldquo;{q}&rdquo;</span>}
      </p>

      {loreEntries.length === 0 ? (
        <p className="rounded-xl border border-gray-800 bg-gray-900/60 p-8 text-center text-gray-500">
          No lore entries found.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loreEntries.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
              <Link
                href={`/wiki/${loreSlug(entry.name)}`}
                className="text-lg font-semibold text-white transition-colors hover:text-brand-400"
              >
                {entry.name}
              </Link>
              <p className="mt-1 text-xs text-gray-500">
                {entry.category}
                {entry.is_wiki_sourced ? " • wiki sourced" : ""}
                {entry.last_synced ? ` • synced ${formatDate(entry.last_synced)}` : ""}
              </p>
              {entry.description ? (
                <p className="mt-3 text-sm text-gray-300">{entry.description}</p>
              ) : (
                <p className="mt-3 text-sm text-gray-500">No description available yet.</p>
              )}
              {entry.aliases && (
                <p className="mt-3 text-xs text-gray-400">
                  <span className="text-gray-300">Aliases:</span> {entry.aliases}
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          {page > 1 && (
            <Link
              href={buildHref({ page: page - 1, category, q })}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
            >
              ← Previous
            </Link>
          )}
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={buildHref({ page: page + 1, category, q })}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
