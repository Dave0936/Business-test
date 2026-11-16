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

/**
 * Enqueue a job through the enqueue_job() database function, which checks the caller's
 * role and only lets members queue user-safe job types (deploy and send are system-only).
 * Returns false if identical work already exists (keys are namespaced per organisation).
 */
export async function enqueue(db: SupabaseClient, a: EnqueueArgs): Promise<boolean> {
  const { data, error } = await db.rpc("enqueue_job", {
    p_org: a.organisationId,
    p_run: a.runId ?? null,
    p_type: a.type,
    p_payload: a.payload,
    p_key: a.idempotencyKey,
    p_run_at: (a.runAt ?? new Date()).toISOString(),
    p_max_attempts: a.maxAttempts ?? 3,
  });
  if (error) throw new Error(`Could not queue ${a.type}: ${error.message}`);
  return data === true;
}

export const monthKey = () => new Date().toISOString().slice(0, 7);
