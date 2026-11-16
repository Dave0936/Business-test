import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit-log";
import { handleJob, PermanentJobError, SendDeferredError, type JobRow } from "./handlers";
import { enqueue } from "./queue";

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export interface SliceOptions {
  maxJobs?: number;
  deadlineMs?: number;
  /**
   * Member mode: process only this organisation's user-safe jobs, using the member's own
   * session (RLS applies). Omit for the system worker (service role, all job types).
   */
  organisationId?: string;
  actorId?: string | null;
}

/** Process due jobs until none are left or the time budget runs out. */
export async function runWorkerSlice(db: SupabaseClient, opts: SliceOptions = {}): Promise<{ processed: number; failed: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  let processed = 0;
  let failed = 0;
  while (processed < (opts.maxJobs ?? 50) && Date.now() < deadline) {
    const { data: jobs, error } = opts.organisationId
      ? await db.rpc("claim_org_jobs", { p_org: opts.organisationId, p_worker: WORKER_ID, p_limit: 1 })
      : await db.rpc("claim_jobs", { p_worker: WORKER_ID, p_limit: 1 });
    if (error) throw new Error(`Could not claim jobs: ${error.message}`);
    const job = (jobs as JobRow[] | null)?.[0];
    if (!job) break;
    processed++;

    const complete = async (status: "queued" | "succeeded" | "failed", extra: { result?: unknown; error?: string; runAt?: Date; refund?: boolean } = {}) => {
      const { error: cErr } = await db.rpc("complete_job", {
        p_job: job.id, p_status: status, p_result: extra.result ?? null, p_error: extra.error ?? null,
        p_run_at: extra.runAt?.toISOString() ?? null, p_refund_attempt: extra.refund ?? false,
      });
      if (cErr) console.error("complete_job failed", job.id, cErr.message);
    };

    try {
      const result = await handleJob(db, job);
      await complete("succeeded", { result });
    } catch (e) {
      const msg = ((e as Error).message ?? String(e)).slice(0, 1000);
      if (e instanceof SendDeferredError) {
        await complete("queued", { error: msg, runAt: e.retryAt, refund: true });
        continue;
      }
      const permanent = e instanceof PermanentJobError;
      const retry = !permanent && job.attempts < job.max_attempts;
      if (retry) {
        await complete("queued", { error: msg, runAt: new Date(Date.now() + 2 ** job.attempts * 60_000) });
      } else {
        await complete("failed", { error: msg });
        failed++;
        if (job.run_id) await db.rpc("bump_run_stat", { p_run: job.run_id, p_key: `${job.type}_failed`, p_by: 1 });
        await writeAudit(db, {
          organisationId: job.organisation_id,
          actorId: opts.actorId ?? null,
          actorType: opts.actorId ? "user" : "system",
          action: "job.failed",
          entityType: "job",
          entityId: job.id,
          data: { type: job.type, error: msg, attempts: job.attempts },
        }).catch(() => undefined);
      }
    }
  }
  await db.rpc("finish_idle_runs", { p_org: opts.organisationId ?? null });
  return { processed, failed };
}

/** Start runs for workflows that are due. Called by the system worker and the cron endpoint. */
export async function scheduleDueWorkflows(db: SupabaseClient): Promise<number> {
  const { data: due } = await db.from("automation_workflows").select("*").eq("enabled", true).eq("paused", false).lte("next_run_at", new Date().toISOString()).limit(20);
  let started = 0;
  for (const wf of due ?? []) {
    // Claim the schedule slot first so two schedulers cannot both start it.
    const next = wf.frequency_minutes ? new Date(Date.now() + wf.frequency_minutes * 60_000).toISOString() : null;
    const { data: claimed } = await db.from("automation_workflows").update({ next_run_at: next, last_run_at: new Date().toISOString() }).eq("id", wf.id).eq("next_run_at", wf.next_run_at).select("id");
    if (!claimed?.length) continue;
    await startWorkflowRun(db, wf.organisation_id, wf.id, wf.config, null);
    started++;
  }
  // Daily retention sweep per organisation.
  const { data: orgs } = await db.from("organisations").select("id");
  for (const o of orgs ?? []) {
    await enqueue(db, { organisationId: o.id, type: "retention_sweep", payload: {}, idempotencyKey: `retention:${new Date().toISOString().slice(0, 10)}` });
  }
  return started;
}

export interface WorkflowConfig {
  provider: string;
  sectors: string[];
  locations: { countryCode: string; city: string; region?: string; lat?: number; lng?: number }[];
  leadsPerSearch: number;
  radiusKm?: number;
  pages?: number;
  excludeChains?: boolean;
  businessType?: string;
  minScore: number;
  prototypeLimit: number;
  agents: { audit: boolean; research: boolean; generate: boolean; email: boolean };
}

/** Create a run and queue one discovery job per location × sector. Works for members (RLS) and the worker. */
export async function startWorkflowRun(db: SupabaseClient, organisationId: string, workflowId: string | null, config: WorkflowConfig, actorId: string | null): Promise<string> {
  const { data: run, error } = await db.from("automation_runs").insert({ organisation_id: organisationId, workflow_id: workflowId, status: "running", stats: { searches: 0 } }).select("id").single();
  if (error) throw new Error(`Could not start run: ${error.message}`);
  const cascade = { ...config.agents, minScore: config.minScore, prototypeLimit: config.prototypeLimit };
  let searches = 0;
  for (const loc of config.locations) {
    for (const sector of config.sectors) {
      await enqueue(db, {
        organisationId,
        runId: run.id,
        type: "discover",
        payload: { provider: config.provider, query: { countryCode: loc.countryCode, city: loc.city, region: loc.region, lat: loc.lat, lng: loc.lng, industryId: sector, limit: config.leadsPerSearch, radiusKm: config.radiusKm, businessType: config.businessType, pages: config.pages, excludeChains: config.excludeChains }, cascade, actorId },
        idempotencyKey: `discover:${run.id}:${loc.countryCode}:${loc.city.toLowerCase()}:${sector}`,
      });
      searches++;
    }
  }
  await db.rpc("bump_run_stat", { p_run: run.id, p_key: "searches", p_by: searches });
  return run.id;
}
