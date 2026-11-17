import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { runWorkerSlice } from "@/lib/jobs/worker";

// A route handler, not a server action: Next.js runs a page's server actions one at a time,
// so a long background step would otherwise hold up every button on the page.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Same-site calls only (the in-app progress indicator).
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let ctx;
  try {
    ctx = await getOrgContext();
  } catch {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  let processed = 0;
  if (roleAtLeast(ctx.role, "staff")) {
    const r = await runWorkerSlice(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, deadlineMs: 20_000, maxJobs: 10 });
    processed = r.processed;
  }
  const { data } = await ctx.supabase.rpc("org_pending_jobs", { p_org: ctx.organisationId });
  const row = (data as { queued: number; running: number; next_run_at: string | null }[] | null)?.[0];
  const next = row?.next_run_at ? Math.max(0, Math.round((new Date(row.next_run_at).getTime() - Date.now()) / 1000)) : null;
  return NextResponse.json({ queued: Number(row?.queued ?? 0), running: Number(row?.running ?? 0), nextInSeconds: next, processed }, { headers: { "cache-control": "no-store" } });
}
