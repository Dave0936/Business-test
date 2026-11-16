import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type JobType = "discover" | "audit" | "research" | "generate" | "deploy" | "draft_email" | "send_email" | "retention_sweep";

export interface Cascade {
  audit: boolean;
  research: boolean;
  generate: boolean;
  email: boolean;
  minScore: number;
  prototypeLimit: number;
}

export const DEFAULT_CASCADE: Cascade = { audit: true, research: true, generate: true, email: true, minScore: 55, prototypeLimit: 10 };

export interface EnqueueArgs {
  organisationId: string;
  type: JobType;
  payload: Record<string, unknown>;
  /** Same key = same work. Re-enqueueing is a no-op, which is how runs avoid duplicating each other. */
  idempotencyKey: string;
  runId?: string | null;
  runAt?: Date;
  maxAttempts?: number;
}

/** Enqueue a job; returns false if an identical job already exists. */
export async function enqueue(db: SupabaseClient, a: EnqueueArgs): Promise<boolean> {
  const { data, error } = await db
    .from("jobs")
    .upsert(
      {
        organisation_id: a.organisationId,
        run_id: a.runId ?? null,
        type: a.type,
        payload: a.payload,
        idempotency_key: a.idempotencyKey,
        run_at: (a.runAt ?? new Date()).toISOString(),
        max_attempts: a.maxAttempts ?? 3,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export const monthKey = () => new Date().toISOString().slice(0, 7);
