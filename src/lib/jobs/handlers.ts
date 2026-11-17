import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProvider, type DiscoveryQuery } from "@/lib/providers/discovery";
import { ingestDiscovered } from "@/lib/crm/ingest";
import { auditBusiness, type BusinessRow } from "@/lib/audit/run";
import { produceBrief } from "@/lib/design/research";
import { runBuildSlice, startBuild } from "@/lib/sites/bespoke/runner";
import { recordProviderHealth } from "@/lib/providers/discovery/health";
import { OSM_UNREACHABLE } from "@/lib/providers/discovery/openstreetmap";
import { processImage } from "@/lib/sites/generated-images";
import { generateWebsite } from "@/lib/sites/builder";
import { deployApprovedWebsite, DeploymentBlockedError } from "@/lib/deploy/deploy";
import { draftEmail, DraftBlockedError } from "@/lib/email/draft";
import { sendApprovedEmail, SendBlockedError, SendDeferredError } from "@/lib/email/send";
import { aiAvailable, monthToDateSpend } from "@/lib/ai/client";
import { getSecret } from "@/lib/integrations";
import { DEFAULT_CASCADE, enqueue, monthKey, type Cascade, type JobType } from "./queue";

export interface JobRow {
  id: string;
  organisation_id: string;
  run_id: string | null;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Errors that will not succeed on retry. */
export class PermanentJobError extends Error {}

async function bump(db: SupabaseClient, runId: string | null, key: string, by = 1) {
  if (runId) await db.rpc("bump_run_stat", { p_run: runId, p_key: key, p_by: by });
}

async function assertBudget(db: SupabaseClient, organisationId: string, runId: string | null) {
  if (!aiAvailable()) return;
  const { data: org } = await db.from("organisations").select("monthly_ai_budget_usd").eq("id", organisationId).single();
  const spent = await monthToDateSpend(db, organisationId);
  if (org && spent >= Number(org.monthly_ai_budget_usd)) {
    if (runId) await db.from("automation_runs").update({ status: "paused", error: `Paused: monthly AI budget of $${org.monthly_ai_budget_usd} reached ($${spent.toFixed(2)} spent).` }).eq("id", runId);
    throw new PermanentJobError(`Monthly AI budget reached ($${spent.toFixed(2)} of $${org.monthly_ai_budget_usd}).`);
  }
}

const cascadeOf = (p: Record<string, unknown>): Cascade => ({ ...DEFAULT_CASCADE, ...((p.cascade as Partial<Cascade>) ?? {}) });

export async function handleJob(db: SupabaseClient, job: JobRow): Promise<Record<string, unknown>> {
  const org = job.organisation_id;
  const p = job.payload;
  switch (job.type) {
    case "discover": {
      const provider = getProvider(String(p.provider));
      if (!provider) throw new PermanentJobError(`Unknown provider ${String(p.provider)}`);
      const credentials = provider.requires ? await getSecret(db, org, provider.requires) : null;
      if (provider.requires && !credentials) throw new PermanentJobError(`${provider.label} is not connected. Add its key in Integrations.`);
      const query = p.query as DiscoveryQuery;
      let found;
      try {
        found = await provider.search(query, credentials);
        if (provider.id === "openstreetmap") await recordProviderHealth(db, org, "openstreetmap", true, null);
      } catch (e) {
        if (provider.id === "openstreetmap" && (e as Error).message.includes(OSM_UNREACHABLE)) await recordProviderHealth(db, org, "openstreetmap", false, (e as Error).message);
        // Bad keys and exhausted quotas will not fix themselves on retry.
        if (/invalid api key|not connected|run out of searches|account.*(suspended|disabled)|HTTP 401|HTTP 403/i.test((e as Error).message)) throw new PermanentJobError((e as Error).message);
        throw e;
      }
      const res = await ingestDiscovered(db, org, found, provider.terms, { industryId: query.industryId, actorId: (p.actorId as string) ?? null });
      await bump(db, job.run_id, "discovered", found.length);
      await bump(db, job.run_id, "new_businesses", res.created.length);
      await bump(db, job.run_id, "duplicates_merged", res.merged.length);
      const cascade = cascadeOf(p);
      if (cascade.audit) {
        for (const id of [...res.created, ...res.merged]) {
          await enqueue(db, { organisationId: org, runId: job.run_id, type: "audit", payload: { businessId: id, cascade }, idempotencyKey: `audit:${id}:${monthKey()}` });
        }
      }
      return { found: found.length, created: res.created.length, merged: res.merged.length, skipped: res.skipped };
    }
    case "audit": {
      const cascade = cascadeOf(p);
      const { data: b, error } = await db.from("businesses").select("id, organisation_id, name, category, sector, city, country_code, website_url, email, phone, contact_page_url, is_demo, industry_id, status").eq("id", String(p.businessId)).eq("organisation_id", org).single();
      if (error) throw error;
      if (["suppressed", "converted", "not_interested"].includes(b.status)) return { skipped: `business is ${b.status}` };
      await assertBudget(db, org, job.run_id);
      const out = await auditBusiness(db, b as BusinessRow, { threshold: cascade.minScore, actorId: (p.actorId as string) ?? null });
      await bump(db, job.run_id, "audited");
      if (out.score.qualified) {
        await bump(db, job.run_id, "qualified");
        if (cascade.research) await enqueue(db, { organisationId: org, runId: job.run_id, type: "research", payload: { businessId: b.id, cascade }, idempotencyKey: `research:${b.id}:${monthKey()}` });
      }
      return { score: out.score.score, qualified: out.score.qualified, usedAi: out.usedAi };
    }
    case "research": {
      const cascade = cascadeOf(p);
      await assertBudget(db, org, job.run_id);
      const r = await produceBrief(db, org, String(p.businessId), (p.actorId as string) ?? null);
      await bump(db, job.run_id, "briefs");
      if (cascade.generate) {
        const { count } = job.run_id ? await db.from("jobs").select("id", { count: "exact", head: true }).eq("run_id", job.run_id).eq("type", "generate") : { count: 0 };
        if ((count ?? 0) < cascade.prototypeLimit) {
          await enqueue(db, { organisationId: org, runId: job.run_id, type: "generate", payload: { businessId: p.businessId, cascade }, idempotencyKey: `generate:${p.businessId}` });
        } else {
          await bump(db, job.run_id, "prototype_limit_reached");
        }
      }
      return { briefId: r.briefId, generatedBy: r.generatedBy };
    }
    case "generate": {
      await assertBudget(db, org, job.run_id);
      const actorId = (p.actorId as string) ?? null;
      let buildId = p.buildId ? String(p.buildId) : null;
      if (!buildId) {
        if (!aiAvailable()) {
          // Labelled template demo (Claude not connected); not approvable for real businesses.
          const r = await generateWebsite(db, org, String(p.businessId), { actorId });
          await bump(db, job.run_id, r.approvable ? "prototypes_ready_for_approval" : r.report.passed ? "demo_prototypes" : "prototypes_failed_qa");
          return { websiteId: r.websiteId, versionId: r.versionId, qaPassed: r.report.passed, template: true };
        }
        buildId = (await startBuild(db, org, String(p.businessId), actorId, { runId: job.run_id, queue: false })).buildId;
      }
      let r: Awaited<ReturnType<typeof runBuildSlice>>;
      try {
        r = await runBuildSlice(db, buildId, { deadlineMs: 45_000, runId: job.run_id });
      } catch (e) {
        // Last attempt: don't leave the build looking busy forever (it would block new builds).
        if (job.attempts >= job.max_attempts) {
          await db.from("site_builds").update({ status: "failed", error: `Could not save the build: ${(e as Error).message}`, finished_at: new Date().toISOString() }).eq("id", buildId).eq("organisation_id", org).in("status", ["queued", "running"]);
        }
        throw e;
      }
      if (r.status === "continue") {
        // More turns needed: queue the next slice (keeps each request inside serverless limits).
        await enqueue(db, { organisationId: org, runId: job.run_id, type: "generate", payload: { buildId, actorId }, idempotencyKey: `build:${buildId}:${Date.now()}` });
        return { buildId, status: "continuing" };
      }
      if (r.status === "succeeded") await bump(db, job.run_id, "prototypes_built");
      if (r.status === "failed") await bump(db, job.run_id, "builds_failed");
      // Stops here: deployment needs a person to approve.
      return { buildId, status: r.status, versionId: r.versionId ?? null };
    }
    case "image": {
      // One step per run; come back shortly while Higgsfield is still working.
      const r = await processImage(db, org, String(p.imageId));
      if (r === "poll") {
        await enqueue(db, { organisationId: org, runId: job.run_id, type: "image", payload: { imageId: p.imageId }, idempotencyKey: `image:${p.imageId}:${Date.now()}`, runAt: new Date(Date.now() + 8_000), maxAttempts: 5 });
      }
      return { imageId: p.imageId, status: r };
    }
    case "deploy": {
      try {
        const r = await deployApprovedWebsite(db, org, String(p.websiteId), String(p.approvalId));
        if (r.status === "verified") {
          const { data: site } = await db.from("generated_websites").select("business_id").eq("id", String(p.websiteId)).single();
          const { data: biz } = await db.from("businesses").select("email").eq("id", site!.business_id).single();
          if (biz?.email && p.draftEmail === true) {
            await enqueue(db, { organisationId: org, runId: job.run_id, type: "draft_email", payload: { businessId: site!.business_id }, idempotencyKey: `draft:${site!.business_id}:initial` });
          }
        }
        if (r.status === "failed") throw new PermanentJobError((r as { error?: string }).error ?? "Deployment failed");
        return r as Record<string, unknown>;
      } catch (e) {
        if (e instanceof DeploymentBlockedError) throw new PermanentJobError(e.message);
        throw e;
      }
    }
    case "draft_email": {
      try {
        await assertBudget(db, org, job.run_id);
        const r = await draftEmail(db, org, String(p.businessId), { actorId: (p.actorId as string) ?? null, kind: (p.kind as "initial" | "follow_up") ?? "initial" });
        return r as unknown as Record<string, unknown>;
      } catch (e) {
        if (e instanceof DraftBlockedError) throw new PermanentJobError(e.message);
        throw e;
      }
    }
    case "send_email": {
      try {
        return await sendApprovedEmail(db, org, String(p.draftId));
      } catch (e) {
        if (e instanceof SendBlockedError) throw new PermanentJobError(e.message);
        throw e;
      }
    }
    case "retention_sweep":
      return retentionSweep(db, org);
  }
}

/**
 * Enforce provider retention terms: when a restricted source (e.g. Google Places, 30 days)
 * expires and no unrestricted source backs the data, clear the restricted fields.
 */
export async function retentionSweep(db: SupabaseClient, organisationId: string): Promise<Record<string, unknown>> {
  const { data: expired } = await db.from("business_sources").select("id, business_id, provider").eq("organisation_id", organisationId).lt("retention_expires_at", new Date().toISOString()).limit(500);
  let cleared = 0;
  for (const s of expired ?? []) {
    const { count } = await db.from("business_sources").select("id", { count: "exact", head: true }).eq("business_id", s.business_id).is("retention_expires_at", null);
    if ((count ?? 0) === 0) {
      await db.from("businesses").update({ address: null, phone: null, phone_e164: null, latitude: null, longitude: null }).eq("id", s.business_id).eq("organisation_id", organisationId);
      cleared++;
    }
    await db.from("business_sources").update({ retention_expires_at: null, raw: null, source_url: null, attribution: `${s.provider} (expired, fields cleared)` }).eq("id", s.id);
  }
  // Leads in the recycle bin for 30 days are deleted permanently (runs with the service role).
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: binned } = await db.from("businesses").select("id").eq("organisation_id", organisationId).lt("deleted_at", cutoff).limit(200);
  let purged = 0;
  for (const b of binned ?? []) {
    const { data, error } = await db.rpc("purge_business", { p_business: b.id });
    if (!error && data) purged++;
  }
  return { expired: expired?.length ?? 0, cleared, purged };
}

export { SendDeferredError };
