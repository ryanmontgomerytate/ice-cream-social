import { NextRequest, NextResponse } from "next/server";
import { requireModeratorAccess } from "@/lib/moderation-auth";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = new Set([
  "approve",
  "reject",
  "needs_changes",
  "assign",
  "unassign",
]);

interface ModerationActionBody {
  queue_item_id?: number;
  action?: string;
  notes?: string;
  assigned_to?: string | null;
}

export async function POST(request: NextRequest) {
  const access = await requireModeratorAccess();
  if (access.response) return access.response;
  const { supabase } = access.context!;

  let body: ModerationActionBody;
  try {
    body = (await request.json()) as ModerationActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const queueItemId =
    typeof body.queue_item_id === "number" && Number.isFinite(body.queue_item_id)
      ? Math.floor(body.queue_item_id)
      : 0;
  const action = (body.action ?? "").trim().toLowerCase();
  const notes = body.notes?.trim() || null;
  const assignedTo = body.assigned_to?.trim() || null;

  if (queueItemId < 1) {
    return NextResponse.json({ error: "queue_item_id must be a positive integer" }, { status: 400 });
  }

  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "Unsupported action. Use approve, reject, needs_changes, assign, or unassign." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase.rpc("apply_moderation_action", {
    p_queue_item_id: queueItemId,
    p_action: action,
    p_notes: notes,
    p_assigned_to: assignedTo,
  });

  if (error) {
    const message = error.message || "Moderation action failed";

    if (/not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (/required|unsupported|only valid|authentication/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (/role required|permission|not allowed|forbidden/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      result: data,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
