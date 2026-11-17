import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { runWorkerSlice, scheduleDueWorkflows } from "@/lib/jobs/worker";

// Called by Vercel Cron (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const have = Buffer.from(got);
  return have.length === want.length && timingSafeEqual(have, want);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  if (!env.supabaseServiceRoleKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 503 });
  const db = createServiceClient();
  const started = await scheduleDueWorkflows(db, { retention: true });
  // Work through what is queued (system and user jobs) for most of the time allowed.
  const r = await runWorkerSlice(db, { deadlineMs: 240_000, maxJobs: 200 });
  return NextResponse.json({ started, processed: r.processed, failed: r.failed });
}
