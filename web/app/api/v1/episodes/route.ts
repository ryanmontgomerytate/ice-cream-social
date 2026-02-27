import { NextRequest, NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase/server";
import type { EpisodeCard } from "@/lib/types";

export const runtime = "nodejs";

const PAGE_SIZE_DEFAULT = 48;
const PAGE_SIZE_MAX = 200;

/**
 * GET /api/v1/episodes
 *
 * Query params:
 *   page      — page number (default: 1)
 *   per_page  — results per page (default: 48, max: 200)
 *   category  — filter by category (episode | fubts | scoopflix | ...)
 *   q         — title substring search
 *   variants  — include canonical variants (default: false)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const perPage = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("per_page") ?? String(PAGE_SIZE_DEFAULT), 10))
  );
  const category = searchParams.get("category") ?? "";
  const q = searchParams.get("q") ?? "";
  const includeVariants = searchParams.get("variants") === "true";

  const supabase = await createPublicClient();
  const offset = (page - 1) * perPage;

  let query = supabase
    .from("episodes")
    .select(
      "id, episode_number, title, description, published_date, duration, category, has_diarization, feed_source",
      { count: "exact" }
    )
    .eq("visibility", "public")
    .order("published_date", { ascending: false })
    .range(offset, offset + perPage - 1);

  // By default, hide Ad Free / canonical variants
  if (!includeVariants) {
    query = query.is("canonical_id", null);
  }

  if (category && category !== "all") {
    query = query.eq("category", category);
  }

  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const episodes = (data ?? []) as EpisodeCard[];
  const total = count ?? 0;

  return NextResponse.json(
    {
      data: episodes,
      page,
      per_page: perPage,
      total,
      has_more: offset + perPage < total,
    },
    {
      headers: {
        // Cache for 10 minutes at CDN edge
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
      },
    }
  );
}
