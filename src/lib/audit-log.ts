import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  organisationId: string;
  actorId?: string | null;
  actorType?: "user" | "system" | "webhook";
  action: string;
  entityType?: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
}

/** Append to the immutable audit log. Failures are surfaced, not swallowed. */
export async function writeAudit(db: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await db.from("audit_logs").insert({
    organisation_id: e.organisationId,
    actor_id: e.actorId ?? null,
    actor_type: e.actorType ?? (e.actorId ? "user" : "system"),
    action: e.action,
    entity_type: e.entityType ?? null,
    entity_id: e.entityId ?? null,
    data: e.data ?? {},
  });
  if (error) throw new Error(`Audit log write failed: ${error.message}`);
}

export async function logActivity(
  db: SupabaseClient,
  a: { organisationId: string; businessId: string; type: string; summary: string; data?: Record<string, unknown>; actorId?: string | null },
): Promise<void> {
  const { error } = await db.from("crm_activities").insert({
    organisation_id: a.organisationId,
    business_id: a.businessId,
    type: a.type,
    summary: a.summary,
    data: a.data ?? {},
    actor_id: a.actorId ?? null,
  });
  if (error) throw new Error(`Activity log write failed: ${error.message}`);
}
