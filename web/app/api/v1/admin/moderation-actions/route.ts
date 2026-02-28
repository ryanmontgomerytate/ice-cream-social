import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireModeratorAccess } from "@/lib/moderation-auth";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = new Set([
  "approve",
  "reject",
  "needs_changes",
  "resolve",
  "dismiss",
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
  return Sentry.startSpan(
    {
      op: "ics.moderation",
      name: "moderation-actions.post",
    },
    async () => {
      const access = await requireModeratorAccess();
      if (access.response) return access.response;
      const { supabase, userId } = access.context!;

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
        return NextResponse.json(
          { error: "queue_item_id must be a positive integer" },
          { status: 400 }
        );
      }

      if (!ALLOWED_ACTIONS.has(action)) {
        return NextResponse.json(
          {
            error:
              "Unsupported action. Use approve, reject, needs_changes, resolve, dismiss, assign, or unassign.",
          },
          { status: 400 }
        );
      }

      const { data, error } = await Sentry.startSpan(
        {
          op: "db.rpc",
          name: "apply_moderation_action",
          attributes: {
            queue_item_id: queueItemId,
            action,
          },
        },
        () =>
          supabase.rpc("apply_moderation_action", {
            p_queue_item_id: queueItemId,
            p_action: action,
            p_notes: notes,
            p_assigned_to: assignedTo,
          })
      );

      if (error) {
        const message = error.message || "Moderation action failed";
        let status = 500;

        if (/not found/i.test(message)) {
          status = 404;
        } else if (/required|unsupported|only valid|authentication/i.test(message)) {
          status = 400;
        } else if (/role required|permission|not allowed|forbidden/i.test(message)) {
          status = 403;
        }

        if (status >= 500) {
          Sentry.withScope((scope) => {
            scope.setLevel("error");
            scope.setTag("feature", "moderation");
            scope.setContext("moderation_action", {
              queue_item_id: queueItemId,
              action,
              user_id: userId,
              assigned_to: assignedTo,
              error: message,
            });
            Sentry.captureMessage("Moderation action RPC failed");
          });
        }

        return NextResponse.json({ error: message }, { status });
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
  );
}
