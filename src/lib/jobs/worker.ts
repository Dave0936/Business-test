import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit-log";
import { handleJob, PermanentJobError, SendDeferredError, type JobRow } from "./handlers";
import { enqueue } from "./queue";

const WORKER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/** Process due jobs until none are left or the time budget runs out. */
export async function runWorkerSlice(db: SupabaseClient, opts: { maxJobs?: number; deadlineMs?: number } = {}): Promise<{ processed: number; failed: number }> {
  const deadline = Date.now() + (opts.deadlineMs ?? 50_000);
  let processed = 0;
  let failed = 0;
  while (processed < (opts.maxJobs ?? 50) && Date.now() < deadline) {
    const { data: jobs, error } = await db.rpc("claim_jobs", { p_worker: WORKER_ID, p_limit: 1 });
    if (error) throw error;
    const job = (jobs as JobRow[] | null)?.[0];
    if (!job) break;
    processed++;
    try {
      const result = await handleJob(db, job);
      await db.from("jobs").update({ status: "succeeded", result, finished_at: new Date().toISOString(), locked_at: null, last_error: null }).eq("id", job.id);
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 1000) ?? String(e);
      if (e instanceof SendDeferredError) {
        await db.from("jobs").update({ status: "queued", run_at: e.retryAt.toISOString(), attempts: job.attempts - 1, last_error: msg, locked_at: null }).eq("id", job.id);
        continue;
      }
      const permanent = e instanceof PermanentJobError;
      const retry = !permanent && job.attempts < job.max_attempts;
      const backoffMin = 2 ** job.attempts;
      await db.from("jobs").update(
        retry
          ? { status: "queued", run_at: new Date(Date.now() + backoffMin * 60_000).toISOString(), last_error: msg, locked_at: null }
          : { status: "failed", last_error: msg, finished_at: new Date().toISOString(), locked_at: null },
      ).eq("id", job.id);
      if (!retry) {
        failed++;
        if (job.run_id) await db.rpc("bump_run_stat", { p_run: job.run_id, p_key: `${job.type}_failed`, p_by: 1 });
        await writeAudit(db, { organisationId: job.organisation_id, action: "job.failed", entityType: "job", entityId: job.id, data: { type: job.type, error: msg, attempts: job.attempts } }).catch(() => undefined);
      }
    }
  }
  await db.rpc("finish_idle_runs");
  return { processed, failed };
}

/** Start runs for workflows that are due. Called by the worker loop and the cron endpoint. */
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
    await enqueue(db, { organisationId: o.id, type: "retention_sweep", payload: {}, idempotencyKey: `retention:${o.id}:${new Date().toISOString().slice(0, 10)}` });
  }
  return started;
}

export interface WorkflowConfig {
  provider: string;
  sectors: string[];
  locations: { countryCode: string; city: string; region?: string }[];
  leadsPerSearch: number;
  radiusKm?: number;
  minScore: number;
  prototypeLimit: number;
  agents: { audit: boolean; research: boolean; generate: boolean; email: boolean };
}

export async function startWorkflowRun(db: SupabaseClient, organisationId: string, workflowId: string | null, config: WorkflowConfig, actorId: string | null): Promise<string> {
  const { data: run, error } = await db.from("automation_runs").insert({ organisation_id: organisationId, workflow_id: workflowId, status: "running", stats: { searches: 0 } }).select("id").single();
  if (error) throw error;
  const cascade = { ...config.agents, minScore: config.minScore, prototypeLimit: config.prototypeLimit };
  let searches = 0;
  for (const loc of config.locations) {
    for (const sector of config.sectors) {
      await enqueue(db, {
        organisationId,
        runId: run.id,
        type: "discover",
        payload: { provider: config.provider, query: { countryCode: loc.countryCode, city: loc.city, region: loc.region, industryId: sector, limit: config.leadsPerSearch, radiusKm: config.radiusKm }, cascade, actorId },
        idempotencyKey: `discover:${run.id}:${loc.countryCode}:${loc.city}:${sector}`,
      });
      searches++;
    }
  }
  await db.rpc("bump_run_stat", { p_run: run.id, p_key: "searches", p_by: searches });
  return run.id;
}
