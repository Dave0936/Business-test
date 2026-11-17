import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getSecret } from "@/lib/integrations";
import { writeAudit } from "@/lib/audit-log";
import type { SiteFiles, SiteSpec } from "@/lib/sites/spec";
import { runQaChecks } from "@/lib/qa/checks";
import { deploySite, removeSite, verifyLive, workerNameFor, type CloudflareCreds } from "./cloudflare";

export class DeploymentBlockedError extends Error {}

type Fetch = typeof fetch;

async function cloudflareCreds(db: SupabaseClient, organisationId: string): Promise<CloudflareCreds | null> {
  const c = (await getSecret(db, organisationId, "cloudflare")) as { apiToken?: string; accountId?: string } | null;
  return c?.apiToken && c.accountId ? { apiToken: c.apiToken, accountId: c.accountId } : null;
}

/** Marker added to every page so we can prove the live site is this exact version. */
export function versionMarker(contentHash: string): string {
  return `<meta name="wo-version" content="${contentHash.slice(0, 16)}">`;
}

export function withMarker(files: SiteFiles, marker: string): SiteFiles {
  const out: SiteFiles = { ...files };
  for (const k of Object.keys(out)) {
    const f = out[k];
    if (k.endsWith(".html") && typeof f === "string") out[k] = /<head[^>]*>/i.test(f) ? f.replace(/<head[^>]*>/i, (h) => `${h}\n${marker}`) : `${marker}\n${f}`;
  }
  return out;
}

/**
 * Deploy an approved website version. Called by the deployment service with the service role
 * (the database only lets the service write deployment records or mark a site deployed).
 *
 * Preconditions, all re-checked here and again by database triggers:
 *  - the website is "approved" (or "deployed", to publish again after it was taken offline);
 *  - the given approval is the latest decision and matches the current version's content hash;
 *  - the version still passes the static quality checks.
 * The record is only marked verified when Cloudflare accepted every step AND the live URL serves
 * this version's marker.
 */
export async function deployApprovedWebsite(db: SupabaseClient, organisationId: string, websiteId: string, approvalId: string, opts: { requestedBy?: string | null; fetch?: Fetch; verifyWaitMs?: number; creds?: CloudflareCreds } = {}) {
  const { data: site, error } = await db
    .from("generated_websites")
    .select("id, business_id, slug, status, current_version_id, website_versions!generated_websites_current_version_fk(id, spec, files, content_hash)")
    .eq("id", websiteId)
    .eq("organisation_id", organisationId)
    .single();
  if (error) throw error;
  if (site.status !== "approved" && site.status !== "deployed") throw new DeploymentBlockedError(`This website is ${site.status.replace(/_/g, " ")}, not approved.`);
  const version = site.website_versions as unknown as { id: string; spec: SiteSpec; files: SiteFiles; content_hash: string };

  const { data: approval } = await db.from("approvals").select("id, decision, content_hash, subject_id, subject_type").eq("id", approvalId).eq("organisation_id", organisationId).single();
  if (!approval || approval.subject_type !== "website" || approval.subject_id !== websiteId || approval.decision !== "approved" || approval.content_hash !== version.content_hash) {
    throw new DeploymentBlockedError("There is no approval for this exact version.");
  }
  const { data: latest } = await db.from("approvals").select("id").eq("subject_type", "website").eq("subject_id", websiteId).order("decided_at", { ascending: false }).limit(1).single();
  if (latest?.id !== approvalId) throw new DeploymentBlockedError("A later decision replaced this approval.");

  // Final validation on exactly the approved files.
  const qa = runQaChecks(version.files, version.spec, { verified: { phone: version.spec.business.phone, email: version.spec.business.email, name: version.spec.business.name }, agencyName: version.spec.agency.name });
  if (!qa.passed) throw new DeploymentBlockedError("The approved version no longer passes its quality checks. Build a new version and approve it.");

  const creds = opts.creds ?? (await cloudflareCreds(db, organisationId));
  const workerName = workerNameFor(env.cloudflareProjectPrefix, site.slug);

  // One record per approval: a failed or removed deployment is retried on the same record.
  const { data: existing } = await db.from("deployment_records").select("id, status, url, updated_at").eq("approval_id", approvalId).maybeSingle();
  let recordId = existing?.id as string | undefined;
  // An upload still in progress (started in the last 5 minutes) is not started twice.
  const inProgress = existing?.status === "uploading" && Date.now() - new Date(existing.updated_at).getTime() < 5 * 60_000;
  if (existing && (existing.status === "verified" || existing.status === "succeeded" || inProgress)) {
    return { recordId, status: existing.status as string, url: existing.url as string | null, skipped: true };
  }
  if (!recordId) {
    const { data: rec, error: rErr } = await db
      .from("deployment_records")
      .insert({ organisation_id: organisationId, business_id: site.business_id, website_id: websiteId, version_id: version.id, approval_id: approvalId, project_name: workerName, status: "pending", provider: "cloudflare_workers", requested_by: opts.requestedBy ?? null })
      .select("id")
      .single();
    if (rErr) throw rErr;
    recordId = rec.id;
  }

  const fail = async (msg: string) => {
    await db.from("deployment_records").update({ status: "failed", error: msg }).eq("id", recordId!);
    await writeAudit(db, { organisationId, actorId: opts.requestedBy ?? null, action: "deployment.failed", entityType: "website", entityId: websiteId, data: { record_id: recordId, error: msg } });
    await db.from("crm_activities").insert({ organisation_id: organisationId, business_id: site.business_id, type: "deployment_failed", summary: `Deployment failed: ${msg}`, data: { record_id: recordId }, actor_id: opts.requestedBy ?? null });
    return { recordId, status: "failed" as const, error: msg, url: null };
  };

  if (!creds) return fail("Cloudflare is not connected. Add it under Integrations. Nothing was deployed.");

  try {
    await db.from("deployment_records").update({ status: "uploading", error: null, removed_at: null, removed_by: null, requested_by: opts.requestedBy ?? null }).eq("id", recordId);
    const marker = versionMarker(version.content_hash);
    const up = await deploySite(creds, workerName, withMarker(version.files, marker), opts.fetch);
    // Cloudflare accepted the upload and the new version: record that, then prove it is live.
    await db.from("deployment_records").update({ status: "succeeded", provider_deployment_id: up.versionId, url: up.url, error: null, details: { uploaded: up.uploaded, reused: up.reused } }).eq("id", recordId);

    const live = await verifyLive(up.url, marker, { f: opts.fetch, waitMs: opts.verifyWaitMs });
    if (!live.ok) return fail(`Cloudflare accepted the upload, but ${up.url} could not be confirmed (${live.reason}). Try "Check again" in a minute.`);

    await db.from("deployment_records").update({ status: "verified", verified_at: new Date().toISOString() }).eq("id", recordId);
    if (site.status !== "deployed") await db.from("generated_websites").update({ status: "deployed" }).eq("id", websiteId).eq("organisation_id", organisationId);
    await db.from("businesses").update({ status: "deployed" }).eq("id", site.business_id).eq("organisation_id", organisationId).in("status", ["awaiting_deployment_approval", "prototype_generated", "qualified", "deployed"]);
    await db.from("crm_activities").insert({ organisation_id: organisationId, business_id: site.business_id, type: "deployed", summary: `Concept live at ${up.url}`, data: { record_id: recordId, url: up.url }, actor_id: opts.requestedBy ?? null });
    await writeAudit(db, { organisationId, actorId: opts.requestedBy ?? null, action: "deployment.verified", entityType: "website", entityId: websiteId, data: { record_id: recordId, url: up.url, approval_id: approvalId, worker: workerName } });
    return { recordId, status: "verified" as const, url: up.url };
  } catch (e) {
    return fail((e as Error).message.slice(0, 500));
  }
}

/** Check a deployment that Cloudflare accepted but we could not yet confirm (no new upload). */
export async function recheckDeployment(db: SupabaseClient, organisationId: string, recordId: string, opts: { actorId?: string | null; fetch?: Fetch; verifyWaitMs?: number } = {}) {
  const { data: rec, error } = await db.from("deployment_records").select("id, website_id, business_id, url, status, version_id, website_versions(content_hash)").eq("id", recordId).eq("organisation_id", organisationId).single();
  if (error) throw error;
  if (!rec.url) throw new Error("This deployment has no address to check. Deploy again instead.");
  if (rec.status === "removed") throw new Error("This deployment was taken offline.");
  const marker = versionMarker((rec.website_versions as unknown as { content_hash: string }).content_hash);
  const live = await verifyLive(rec.url, marker, { attempts: 3, f: opts.fetch, waitMs: opts.verifyWaitMs });
  if (!live.ok) return { ok: false, reason: live.reason };
  await db.from("deployment_records").update({ status: "verified", verified_at: new Date().toISOString(), error: null }).eq("id", recordId);
  const { data: site } = await db.from("generated_websites").select("status, current_version_id").eq("id", rec.website_id).single();
  if (site?.status === "approved" && site.current_version_id === rec.version_id) await db.from("generated_websites").update({ status: "deployed" }).eq("id", rec.website_id);
  await writeAudit(db, { organisationId, actorId: opts.actorId ?? null, action: "deployment.verified", entityType: "website", entityId: rec.website_id, data: { record_id: recordId, url: rec.url, recheck: true } });
  return { ok: true };
}

/** Take a deployed concept offline (deletes its Worker). Its approval and history are kept. */
export async function removeDeployment(db: SupabaseClient, organisationId: string, websiteId: string, actorId: string | null, f?: Fetch, testCreds?: CloudflareCreds) {
  const { data: records } = await db.from("deployment_records").select("id, project_name, status, url").eq("website_id", websiteId).eq("organisation_id", organisationId).in("status", ["verified", "succeeded", "uploading", "failed"]);
  if (!records?.length) throw new Error("This website has nothing deployed.");
  const creds = testCreds ?? (await cloudflareCreds(db, organisationId));
  if (!creds) throw new Error("Cloudflare is not connected, so the site cannot be taken offline from here. Delete the Worker in the Cloudflare dashboard.");
  for (const name of new Set(records.map((r) => r.project_name))) await removeSite(creds, name, f);
  const now = new Date().toISOString();
  await db.from("deployment_records").update({ status: "removed", removed_at: now, removed_by: actorId }).in("id", records.map((r) => r.id));
  const { data: site } = await db.from("generated_websites").select("status, business_id").eq("id", websiteId).single();
  if (site?.status === "deployed") await db.from("generated_websites").update({ status: "approved" }).eq("id", websiteId);
  if (site) {
    await db.from("businesses").update({ status: "awaiting_deployment_approval" }).eq("id", site.business_id).eq("organisation_id", organisationId).eq("status", "deployed");
    await db.from("crm_activities").insert({ organisation_id: organisationId, business_id: site.business_id, type: "deployment_removed", summary: "Concept taken offline", data: { website_id: websiteId }, actor_id: actorId });
  }
  await writeAudit(db, { organisationId, actorId, action: "deployment.removed", entityType: "website", entityId: websiteId, data: { records: records.map((r) => r.id), urls: [...new Set(records.map((r) => r.url).filter(Boolean))] } });
}
