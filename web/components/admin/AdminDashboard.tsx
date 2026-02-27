"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminPaginatedResponse,
  ContentRevision,
  ModerationActionType,
  ModerationQueueItemWithRef,
  PendingEditWithRevision,
} from "@/lib/types";

const ADMIN_KEY_STORAGE = "ics_admin_api_key";

async function fetchAdminEndpoint<T>(url: string, adminKey: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "x-admin-key": adminKey,
    },
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "Admin API request failed";
    throw new Error(message);
  }

  return payload as T;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminDashboard() {
  const [adminKey, setAdminKey] = useState("");
  const [pendingStatus, setPendingStatus] = useState("pending");
  const [queueStatus, setQueueStatus] = useState("open");
  const [queueType, setQueueType] = useState("all");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionQueueId, setActionQueueId] = useState<number | null>(null);
  const [pendingEdits, setPendingEdits] = useState<AdminPaginatedResponse<PendingEditWithRevision> | null>(
    null
  );
  const [moderationQueue, setModerationQueue] =
    useState<AdminPaginatedResponse<ModerationQueueItemWithRef> | null>(null);
  const [revisions, setRevisions] = useState<AdminPaginatedResponse<ContentRevision> | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
    if (stored) setAdminKey(stored);
  }, []);

  useEffect(() => {
    if (!adminKey) {
      window.localStorage.removeItem(ADMIN_KEY_STORAGE);
      return;
    }
    window.localStorage.setItem(ADMIN_KEY_STORAGE, adminKey);
  }, [adminKey]);

  const loadData = useCallback(async () => {
    if (!adminKey.trim()) {
      setError("Enter an admin API key to load moderation data.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const pendingQuery = new URLSearchParams({
        status: pendingStatus,
        page: "1",
        per_page: "25",
      });
      const queueQuery = new URLSearchParams({
        status: queueStatus,
        queue_type: queueType,
        page: "1",
        per_page: "25",
      });
      const revisionsQuery = new URLSearchParams({
        approved: "false",
        page: "1",
        per_page: "25",
      });

      const [pendingRes, queueRes, revisionRes] = await Promise.all([
        fetchAdminEndpoint<AdminPaginatedResponse<PendingEditWithRevision>>(
          `/api/v1/admin/pending-edits?${pendingQuery.toString()}`,
          adminKey
        ),
        fetchAdminEndpoint<AdminPaginatedResponse<ModerationQueueItemWithRef>>(
          `/api/v1/admin/moderation-queue?${queueQuery.toString()}`,
          adminKey
        ),
        fetchAdminEndpoint<AdminPaginatedResponse<ContentRevision>>(
          `/api/v1/admin/revisions?${revisionsQuery.toString()}`,
          adminKey
        ),
      ]);

      setPendingEdits(pendingRes);
      setModerationQueue(queueRes);
      setRevisions(revisionRes);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to load dashboard data";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [adminKey, pendingStatus, queueStatus, queueType]);

  const runQueueAction = useCallback(
    async (queueItemId: number, action: ModerationActionType) => {
      setActionError(null);
      setActionQueueId(queueItemId);

      try {
        const response = await fetch("/api/v1/admin/moderation-actions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            queue_item_id: queueItemId,
            action,
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          const message =
            typeof payload?.error === "string" ? payload.error : "Moderation action failed";
          throw new Error(message);
        }

        await loadData();
      } catch (requestError) {
        const message =
          requestError instanceof Error ? requestError.message : "Moderation action failed";
        setActionError(message);
      } finally {
        setActionQueueId(null);
      }
    },
    [loadData]
  );

  const summary = useMemo(
    () => [
      { label: "Pending Edits", value: pendingEdits?.total ?? 0 },
      { label: "Queue Items", value: moderationQueue?.total ?? 0 },
      { label: "Unapproved Revisions", value: revisions?.total ?? 0 },
    ],
    [pendingEdits?.total, moderationQueue?.total, revisions?.total]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Admin Review Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Phase 2 surface for pending edits, moderation queue, and revision review.
        </p>
      </div>

      <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Admin API key</span>
            <input
              type="password"
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
              placeholder="Enter ADMIN_API_KEY"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Pending status</span>
            <select
              value={pendingStatus}
              onChange={(event) => setPendingStatus(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
            >
              <option value="pending">pending</option>
              <option value="all">all</option>
              <option value="needs_changes">needs_changes</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="auto_approved">auto_approved</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Queue status</span>
            <select
              value={queueStatus}
              onChange={(event) => setQueueStatus(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
            >
              <option value="open">open</option>
              <option value="all">all</option>
              <option value="in_review">in_review</option>
              <option value="resolved">resolved</option>
              <option value="dismissed">dismissed</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs uppercase tracking-wide text-gray-500">Queue type</span>
            <select
              value={queueType}
              onChange={(event) => setQueueType(event.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white focus:border-gray-500 focus:outline-none"
            >
              <option value="all">all</option>
              <option value="pending_edit">pending_edit</option>
              <option value="report">report</option>
              <option value="system_flag">system_flag</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Loading..." : "Load moderation data"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Write actions use authenticated moderator/admin role checks (no API key bypass).
        </p>
        {actionError && <p className="mt-2 text-sm text-red-400">{actionError}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {summary.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{metric.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Pending Edits</h2>
        {!pendingEdits || pendingEdits.data.length === 0 ? (
          <p className="text-sm text-gray-500">No pending edits loaded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Risk</th>
                  <th className="pb-2 pr-4">Content</th>
                  <th className="pb-2 pr-4">Submitted</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {pendingEdits.data.map((item) => (
                  <tr key={item.id} className="border-t border-gray-800">
                    <td className="py-2 pr-4">#{item.id}</td>
                    <td className="py-2 pr-4">{item.status}</td>
                    <td className="py-2 pr-4">{item.risk_score}</td>
                    <td className="py-2 pr-4">
                      {item.revision ? `${item.revision.content_type} #${item.revision.content_id}` : "-"}
                    </td>
                    <td className="py-2 pr-4">{formatDateTime(item.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Moderation Queue</h2>
        {!moderationQueue || moderationQueue.data.length === 0 ? (
          <p className="text-sm text-gray-500">No queue items loaded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Priority</th>
                  <th className="pb-2 pr-4">Reference</th>
                  <th className="pb-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {moderationQueue.data.map((item) => (
                  <tr key={item.id} className="border-t border-gray-800">
                    <td className="py-2 pr-4">#{item.id}</td>
                    <td className="py-2 pr-4">{item.queue_type}</td>
                    <td className="py-2 pr-4">{item.status}</td>
                    <td className="py-2 pr-4">{item.priority}</td>
                    <td className="py-2 pr-4">
                      {item.ref ? `#${item.ref_id}` : `#${item.ref_id} (not hydrated)`}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => runQueueAction(item.id, "assign")}
                          disabled={actionQueueId === item.id}
                          className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Assign me
                        </button>
                        <button
                          type="button"
                          onClick={() => runQueueAction(item.id, "unassign")}
                          disabled={actionQueueId === item.id}
                          className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Unassign
                        </button>
                        {item.queue_type === "pending_edit" &&
                          item.status !== "resolved" &&
                          item.status !== "dismissed" && (
                            <>
                              <button
                                type="button"
                                onClick={() => runQueueAction(item.id, "approve")}
                                disabled={actionQueueId === item.id}
                                className="rounded border border-emerald-700/70 px-2 py-1 text-xs text-emerald-300 hover:border-emerald-500 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => runQueueAction(item.id, "needs_changes")}
                                disabled={actionQueueId === item.id}
                                className="rounded border border-amber-700/70 px-2 py-1 text-xs text-amber-300 hover:border-amber-500 hover:text-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Needs changes
                              </button>
                              <button
                                type="button"
                                onClick={() => runQueueAction(item.id, "reject")}
                                disabled={actionQueueId === item.id}
                                className="rounded border border-red-700/70 px-2 py-1 text-xs text-red-300 hover:border-red-500 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
        <h2 className="mb-3 text-lg font-semibold text-white">Recent Unapproved Revisions</h2>
        {!revisions || revisions.data.length === 0 ? (
          <p className="text-sm text-gray-500">No unapproved revisions loaded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="pb-2 pr-4">Revision</th>
                  <th className="pb-2 pr-4">Operation</th>
                  <th className="pb-2 pr-4">Content</th>
                  <th className="pb-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                {revisions.data.map((item) => (
                  <tr key={item.id} className="border-t border-gray-800">
                    <td className="py-2 pr-4">#{item.id}</td>
                    <td className="py-2 pr-4">{item.operation}</td>
                    <td className="py-2 pr-4">
                      {item.content_type} #{item.content_id}
                    </td>
                    <td className="py-2 pr-4">{formatDateTime(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
