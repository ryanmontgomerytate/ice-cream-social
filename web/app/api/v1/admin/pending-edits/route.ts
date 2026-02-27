import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import type { ContentRevision, PendingEdit, PendingEditWithRevision } from "@/lib/types";

export const runtime = "nodejs";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * GET /api/v1/admin/pending-edits
 *
 * Query params:
 *   page      page number (default 1)
 *   per_page  page size (default 50, max 200)
 *   status    pending|approved|rejected|needs_changes|auto_approved|all
 */
export async function GET(request: NextRequest) {
  const authFailure = requireAdminApiKey(request);
  if (authFailure) return authFailure;

  const params = request.nextUrl.searchParams;
  const page = parsePositiveInt(params.get("page"), 1);
  const perPage = Math.min(parsePositiveInt(params.get("per_page"), PAGE_SIZE_DEFAULT), PAGE_SIZE_MAX);
  const offset = (page - 1) * perPage;
  const status = (params.get("status") ?? "pending").trim();

  const supabase = await createAdminClient();

  let pendingQuery = supabase
    .from("pending_edits")
    .select(
      "id, revision_id, status, risk_score, risk_reason, submitted_at, reviewed_by, reviewed_at, updated_at",
      { count: "exact" }
    )
    .order("submitted_at", { ascending: false })
    .range(offset, offset + perPage - 1);

  if (status && status !== "all") {
    pendingQuery = pendingQuery.eq("status", status);
  }

  const { data, count, error } = await pendingQuery;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pendingRows = (data ?? []) as PendingEdit[];
  const revisionIds = Array.from(new Set(pendingRows.map((row) => row.revision_id))).filter((id) => id > 0);

  let revisionMap = new Map<number, ContentRevision>();
  if (revisionIds.length > 0) {
    const { data: revisionData, error: revisionError } = await supabase
      .from("content_revisions")
      .select(
        "id, show_id, content_type, content_id, revision_number, operation, title, summary, payload, created_by, created_at, is_approved, approved_by, approved_at"
      )
      .in("id", revisionIds);

    if (revisionError) {
      return NextResponse.json({ error: revisionError.message }, { status: 500 });
    }

    revisionMap = new Map(
      ((revisionData ?? []) as ContentRevision[]).map((row) => [row.id, row])
    );
  }

  const rowsWithRevision: PendingEditWithRevision[] = pendingRows.map((row) => ({
    ...row,
    revision: revisionMap.get(row.revision_id) ?? null,
  }));

  const total = count ?? 0;

  return NextResponse.json(
    {
      data: rowsWithRevision,
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
