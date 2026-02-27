import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiKey } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/server";
import type {
  ModerationQueueItem,
  ModerationQueueItemWithRef,
  PendingEdit,
  ReportSummary,
} from "@/lib/types";

export const runtime = "nodejs";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

/**
 * GET /api/v1/admin/moderation-queue
 *
 * Query params:
 *   page        page number (default 1)
 *   per_page    page size (default 50, max 200)
 *   status      open|in_review|resolved|dismissed|all
 *   queue_type  pending_edit|report|system_flag|all
 */
export async function GET(request: NextRequest) {
  const authFailure = requireAdminApiKey(request);
  if (authFailure) return authFailure;

  const params = request.nextUrl.searchParams;
  const page = parsePositiveInt(params.get("page"), 1);
  const perPage = Math.min(parsePositiveInt(params.get("per_page"), PAGE_SIZE_DEFAULT), PAGE_SIZE_MAX);
  const offset = (page - 1) * perPage;
  const status = (params.get("status") ?? "open").trim();
  const queueType = (params.get("queue_type") ?? "all").trim();

  const supabase = await createAdminClient();

  let queueQuery = supabase
    .from("moderation_queue")
    .select(
      "id, show_id, queue_type, ref_id, priority, status, assigned_to, notes, created_at, updated_at",
      { count: "exact" }
    )
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .range(offset, offset + perPage - 1);

  if (status && status !== "all") {
    queueQuery = queueQuery.eq("status", status);
  }

  if (queueType && queueType !== "all") {
    queueQuery = queueQuery.eq("queue_type", queueType);
  }

  const { data, count, error } = await queueQuery;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const queueRows = (data ?? []) as ModerationQueueItem[];

  const pendingEditRefIds = queueRows
    .filter((row) => row.queue_type === "pending_edit")
    .map((row) => row.ref_id);

  const reportRefIds = queueRows
    .filter((row) => row.queue_type === "report")
    .map((row) => row.ref_id);

  let pendingEditsById = new Map<number, PendingEdit>();
  if (pendingEditRefIds.length > 0) {
    const { data: pendingData, error: pendingError } = await supabase
      .from("pending_edits")
      .select(
        "id, revision_id, status, risk_score, risk_reason, submitted_at, reviewed_by, reviewed_at, updated_at"
      )
      .in("id", pendingEditRefIds);

    if (pendingError) {
      return NextResponse.json({ error: pendingError.message }, { status: 500 });
    }

    pendingEditsById = new Map(((pendingData ?? []) as PendingEdit[]).map((row) => [row.id, row]));
  }

  let reportsById = new Map<number, ReportSummary>();
  if (reportRefIds.length > 0) {
    const { data: reportData, error: reportError } = await supabase
      .from("reports")
      .select("id, target_type, target_id, reason, status, created_at")
      .in("id", reportRefIds);

    if (reportError) {
      return NextResponse.json({ error: reportError.message }, { status: 500 });
    }

    reportsById = new Map(((reportData ?? []) as ReportSummary[]).map((row) => [row.id, row]));
  }

  const rowsWithRef: ModerationQueueItemWithRef[] = queueRows.map((row) => {
    if (row.queue_type === "pending_edit") {
      return { ...row, ref: pendingEditsById.get(row.ref_id) ?? null };
    }
    if (row.queue_type === "report") {
      return { ...row, ref: reportsById.get(row.ref_id) ?? null };
    }
    return { ...row, ref: null };
  });

  const total = count ?? 0;

  return NextResponse.json(
    {
      data: rowsWithRef,
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
