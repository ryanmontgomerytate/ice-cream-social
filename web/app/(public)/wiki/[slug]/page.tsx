import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/types";

interface PageProps {
  params: Promise<{ slug: string }>;
}

interface LoreEntry {
  id: number;
  name: string;
  category: string;
  description: string | null;
  aliases: string | null;
  wiki_url: string | null;
  first_episode_id: number | null;
  last_synced: string | null;
  is_wiki_sourced: boolean;
}

interface MentionEntry {
  id: number;
  segment_idx: number | null;
  context_snippet: string | null;
  confidence: number | null;
  source: string;
  episode: {
    id: number;
    title: string;
    episode_number: string | null;
    published_date: string | null;
  } | { id: number; title: string; episode_number: string | null; published_date: string | null }[] | null;
}

function slugToName(slug: string): string {
  return decodeURIComponent(slug).replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return { title: slugToName(slug) };
}

export default async function WikiPage({ params }: PageProps) {
  const { slug } = await params;
  const nameGuess = slugToName(slug);
  const supabase = await createPublicClient();

  const baseSelect =
    "id, name, category, description, aliases, wiki_url, first_episode_id, last_synced, is_wiki_sourced";

  const exactMatch = await supabase
    .from("wiki_lore")
    .select(baseSelect)
    .ilike("name", nameGuess)
    .maybeSingle<LoreEntry>();

  let lore = exactMatch.data;

  if (!lore) {
    const fallback = await supabase
      .from("wiki_lore")
      .select(baseSelect)
      .ilike("name", `%${nameGuess}%`)
      .limit(1);
    lore = ((fallback.data ?? [])[0] as LoreEntry | undefined) ?? null;
  }

  if (!lore) {
    notFound();
  }

  const [mentionsRes, firstEpisodeRes] = await Promise.all([
    supabase
      .from("wiki_lore_mentions")
      .select(
        "id, segment_idx, context_snippet, confidence, source, episode:episodes!inner(id, title, episode_number, published_date)"
      )
      .eq("lore_id", lore.id)
      .order("published_date", { referencedTable: "episodes", ascending: false })
      .limit(40),
    lore.first_episode_id
      ? supabase
          .from("episodes")
          .select("id, title, episode_number, published_date")
          .eq("id", lore.first_episode_id)
          .maybeSingle<{ id: number; title: string; episode_number: string | null; published_date: string | null }>()
      : Promise.resolve({ data: null }),
  ]);

  const mentions = ((mentionsRes.data ?? []) as unknown as MentionEntry[]).map((mention) => ({
    ...mention,
    episode: normalizeOne(mention.episode),
  }));
  const firstEpisode = firstEpisodeRes.data;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/search"
          className="mb-3 inline-block text-sm text-gray-500 hover:text-gray-300"
        >
          ← Back to Search
        </Link>
        <h1 className="text-3xl font-bold text-white">{lore.name}</h1>
        <p className="mt-2 text-sm text-gray-500">
          {lore.category}
          {lore.last_synced ? ` • synced ${formatDate(lore.last_synced)}` : ""}
          {lore.is_wiki_sourced ? " • wiki sourced" : ""}
        </p>
      </div>

      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Lore Summary
        </h2>
        {lore.description ? (
          <p className="text-sm leading-relaxed text-gray-200">{lore.description}</p>
        ) : (
          <p className="text-sm text-gray-500">No description available yet.</p>
        )}

        {lore.aliases && (
          <p className="mt-3 text-xs text-gray-400">
            <span className="font-semibold text-gray-300">Aliases:</span> {lore.aliases}
          </p>
        )}

        {lore.wiki_url && (
          <a
            href={lore.wiki_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm text-brand-400 hover:text-brand-300"
          >
            Open fandom wiki page →
          </a>
        )}
      </section>

      {firstEpisode && (
        <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            First Known Episode
          </h2>
          <Link
            href={`/episodes/${firstEpisode.id}`}
            className="text-sm text-brand-400 hover:text-brand-300"
          >
            {firstEpisode.episode_number ? `#${firstEpisode.episode_number} · ` : ""}
            {firstEpisode.title}
          </Link>
          <p className="mt-1 text-xs text-gray-500">{formatDate(firstEpisode.published_date)}</p>
        </section>
      )}

      <section className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Recent Mentions
        </h2>
        {mentions.length === 0 && (
          <p className="text-sm text-gray-500">No mention rows imported yet.</p>
        )}
        {mentions.length > 0 && (
          <div className="space-y-3">
            {mentions.map((mention) => (
              <article key={mention.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                <div className="mb-1 text-xs text-gray-500">
                  {mention.episode ? (
                    <Link
                      href={`/episodes/${mention.episode.id}${
                        mention.segment_idx != null ? `#seg-${mention.segment_idx}` : ""
                      }`}
                      className="text-brand-400 hover:text-brand-300"
                    >
                      {mention.episode.episode_number
                        ? `#${mention.episode.episode_number} · `
                        : ""}
                      {mention.episode.title}
                    </Link>
                  ) : (
                    <span>Unknown episode</span>
                  )}
                  {mention.episode?.published_date && (
                    <span className="ml-2">{formatDate(mention.episode.published_date)}</span>
                  )}
                </div>
                <p className="text-sm text-gray-200">
                  {mention.context_snippet || "(No snippet provided)"}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  source: {mention.source}
                  {mention.confidence != null
                    ? ` • confidence ${mention.confidence.toFixed(2)}`
                    : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
