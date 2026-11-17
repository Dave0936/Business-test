import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { handleResendWebhook } from "@/lib/email/webhook";

/**
 * Resend delivery events (delivered, bounced, complained…). Public, but every event is verified
 * against the organisation's webhook signing secret before it is recorded.
 */
export async function POST(req: NextRequest) {
  if (!env.supabaseServiceRoleKey) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const body = await req.text();
  if (body.length > 256_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  const r = await handleResendWebhook(createServiceClient(), { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, body);
  return NextResponse.json({ result: r.message }, { status: r.status });
}
