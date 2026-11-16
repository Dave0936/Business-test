import type { SupabaseClient } from "@supabase/supabase-js";

/** A free source counts as unreachable for a day after a failed search or check (until a check succeeds). */
export const UNREACHABLE_FOR_MS = 24 * 60 * 60 * 1000;

export async function recordProviderHealth(db: SupabaseClient, org: string, provider: string, ok: boolean, detail: string | null): Promise<void> {
  await db.from("provider_health").upsert({ organisation_id: org, provider, ok, detail: detail?.slice(0, 500) ?? null, checked_at: new Date().toISOString() }, { onConflict: "organisation_id,provider" });
}

export function isMarkedUnreachable(row: { ok: boolean; checked_at: string } | null | undefined, now = Date.now()): boolean {
  return Boolean(row && !row.ok && now - new Date(row.checked_at).getTime() < UNREACHABLE_FOR_MS);
}
