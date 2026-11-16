import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { autoBrief } from "./studio";

/**
 * Brief for a business without a designer in the loop (automation, demo data, the builder).
 * Goes through the design studio so picks and any answers already given are respected.
 */
export async function produceBrief(db: SupabaseClient, organisationId: string, businessId: string, actorId?: string | null, opts: { forcePreset?: boolean } = {}) {
  const r = await autoBrief(db, organisationId, businessId, actorId ?? null, opts);
  return { briefId: r.briefId, generatedBy: r.generatedBy, adjustments: r.adjustments };
}
