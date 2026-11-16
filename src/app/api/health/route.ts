import { NextResponse } from "next/server";
import { env, supabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness and dependency check. Reports reachability only; never returns secrets. */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  if (!supabaseConfigured()) {
    checks.supabase = { ok: false, detail: "not configured" };
  } else {
    try {
      const res = await fetch(`${env.supabaseUrl}/auth/v1/health`, { headers: { apikey: env.supabaseAnonKey! }, cache: "no-store" });
      checks.supabase = { ok: res.ok, detail: `HTTP ${res.status}` };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      checks.supabase = { ok: false, detail: `${err.message}${err.cause ? `: ${err.cause.code ?? ""} ${err.cause.message ?? ""}` : ""}` };
    }
  }
  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
