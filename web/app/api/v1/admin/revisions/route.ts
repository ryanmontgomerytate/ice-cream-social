import { NextRequest, NextResponse } from "next/server";
import { requireModeratorAccess } from "@/lib/moderation-auth";
import type { ContentRevision } from "@/lib/types";

export const runtime = "nodejs";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * GET /api/v1/admin/revisions
 * Requires authenticated moderator/admin role.
 *
 * Query params:
 *   page          page number (default 1)
 *   per_page      page size (default 50, max 200)
 *   content_type  filter by revision content type
 *   content_id    filter by content id
 *   show_id       filter by show id
 *   approved      true|false
 */
export async function GET(request: NextRequest) {
  const access = await requireModeratorAccess();
  if (access.response) return access.response;
  const { supabase } = access.context!;

  const params = request.nextUrl.searchParams;
  const page = parsePositiveInt(params.get("page"), 1);
  const perPage = Math.min(parsePositiveInt(params.get("per_page"), PAGE_SIZE_DEFAULT), PAGE_SIZE_MAX);
  const offset = (page - 1) * perPage;

  const contentType = (params.get("content_type") ?? "").trim();
  const contentId = parsePositiveInt(params.get("content_id"), 0);
  const showId = parsePositiveInt(params.get("show_id"), 0);
  const approvedRaw = (params.get("approved") ?? "").trim().toLowerCase();

  let query = supabase
    .from("content_revisions")
    .select(
      "id, show_id, content_type, content_id, revision_number, operation, title, summary, payload, created_by, created_at, is_approved, approved_by, approved_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + perPage - 1);

  if (contentType) {
    query = query.eq("content_type", contentType);
  }

  if (contentId > 0) {
    query = query.eq("content_id", contentId);
  }

  if (showId > 0) {
    query = query.eq("show_id", showId);
  }

  if (approvedRaw === "true") {
    query = query.eq("is_approved", true);
  } else if (approvedRaw === "false") {
    query = query.eq("is_approved", false);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = count ?? 0;

  return NextResponse.json(
    {
      data: (data ?? []) as ContentRevision[],
      page,
      per_page: perPage,
      total,
      has_more: offset + perPage < total,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
