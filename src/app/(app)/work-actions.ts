"use server";

import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { runWorkerSlice } from "@/lib/jobs/worker";

export interface PendingWork {
  queued: number;
  running: number;
  /** Seconds until the next queued job is due (0 = due now, null = nothing queued). */
  nextInSeconds: number | null;
  processed: number;
}

/**
 * Move the organisation's queued work along with the member's own session (RLS applies).
 * Called by the in-app progress indicator while a tab is open; each call does one short
 * slice so it fits comfortably inside a serverless time limit.
 */
export async function continueWork(): Promise<PendingWork> {
  const ctx = await getOrgContext();
  let processed = 0;
  if (roleAtLeast(ctx.role, "staff")) {
    const r = await runWorkerSlice(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, deadlineMs: 20_000, maxJobs: 10 });
    processed = r.processed;
  }
  return { ...(await pendingWork(ctx.supabase, ctx.organisationId)), processed };
}

async function pendingWork(db: Awaited<ReturnType<typeof getOrgContext>>["supabase"], org: string) {
  const { data } = await db.rpc("org_pending_jobs", { p_org: org });
  const row = (data as { queued: number; running: number; next_run_at: string | null }[] | null)?.[0];
  const next = row?.next_run_at ? Math.max(0, Math.round((new Date(row.next_run_at).getTime() - Date.now()) / 1000)) : null;
  return { queued: Number(row?.queued ?? 0), running: Number(row?.running ?? 0), nextInSeconds: next };
}
