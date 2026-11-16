import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getSecret } from "@/lib/integrations";
import { writeAudit } from "@/lib/audit-log";
import type { SiteFiles, SiteSpec } from "@/lib/sites/spec";
import { runQaChecks } from "@/lib/qa/checks";
import { ensureProject, projectNameFor, uploadWithWrangler, verifyLive, waitForDeployment } from "./cloudflare";

export class DeploymentBlockedError extends Error {}

/**
 * Deploy an approved website version. Runs in the worker with the service role.
 *
 * Preconditions, all re-checked here and again by database triggers:
 *  - the website is in status "approved";
 *  - the latest approval for the website is "approved" and matches the current version's content hash;
 *  - the version still passes QA.
 * The deployment record is created before upload (status pending) and is only marked
 * succeeded/verified when Cloudflare's API confirms success and the live URL serves this version.
 */
export async function deployApprovedWebsite(db: SupabaseClient, organisationId: string, websiteId: string, approvalId: string) {
  const { data: site, error } = await db
    .from("generated_websites")
    .select("id, business_id, slug, status, current_version_id, website_versions!generated_websites_current_version_fk(id, spec, files, content_hash)")
    .eq("id", websiteId)
    .eq("organisation_id", organisationId)
    .single();
  if (error) throw error;
  if (site.status !== "approved") throw new DeploymentBlockedError(`Website is ${site.status}, not approved.`);
  const version = site.website_versions as unknown as { id: string; spec: SiteSpec; files: SiteFiles; content_hash: string };

  const { data: approval } = await db.from("approvals").select("id, decision, content_hash, subject_id, subject_type").eq("id", approvalId).eq("organisation_id", organisationId).single();
  if (!approval || approval.subject_type !== "website" || approval.subject_id !== websiteId || approval.decision !== "approved" || approval.content_hash !== version.content_hash) {
    throw new DeploymentBlockedError("No valid approval for this exact version.");
  }
  const { data: latest } = await db.from("approvals").select("id").eq("subject_type", "website").eq("subject_id", websiteId).order("decided_at", { ascending: false }).limit(1).single();
  if (latest?.id !== approvalId) throw new DeploymentBlockedError("A later decision superseded this approval.");

  // Final build validation on exactly the approved files.
  const qa = runQaChecks(version.files, version.spec, { verified: { phone: version.spec.business.phone, email: version.spec.business.email, name: version.spec.business.name }, agencyName: version.spec.agency.name });
  if (!qa.passed) throw new DeploymentBlockedError("Final build validation failed; regenerate and re-approve.");

  const creds = (await getSecret(db, organisationId, "cloudflare")) as { apiToken?: string; accountId?: string } | null;
  const projectName = projectNameFor(env.cloudflareProjectPrefix, site.slug);

  // Idempotent: one deployment record per approval (unique constraint).
  const { data: existing } = await db.from("deployment_records").select("id, status").eq("approval_id", approvalId).maybeSingle();
  let recordId = existing?.id as string | undefined;
  if (existing && (existing.status === "verified" || existing.status === "succeeded")) return { recordId, status: existing.status, skipped: true };
  if (!recordId) {
    const { data: rec, error: rErr } = await db
      .from("deployment_records")
      .insert({ organisation_id: organisationId, business_id: site.business_id, website_id: websiteId, version_id: version.id, approval_id: approvalId, project_name: projectName, status: "pending" })
      .select("id")
      .single();
    if (rErr) throw rErr;
    recordId = rec.id;
  }

  const fail = async (msg: string) => {
    await db.from("deployment_records").update({ status: "failed", error: msg }).eq("id", recordId!);
    await writeAudit(db, { organisationId, action: "deployment.failed", entityType: "website", entityId: websiteId, data: { record_id: recordId, error: msg } });
    await db.from("crm_activities").insert({ organisation_id: organisationId, business_id: site.business_id, type: "deployment_failed", summary: `Deployment failed: ${msg}`, data: { record_id: recordId } });
    return { recordId, status: "failed" as const, error: msg };
  };

  if (!creds?.apiToken || !creds.accountId) return fail("Cloudflare is not connected (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID). Nothing was deployed.");

  try {
    await db.from("deployment_records").update({ status: "uploading" }).eq("id", recordId);
    const started = new Date();
    const project = await ensureProject({ apiToken: creds.apiToken, accountId: creds.accountId }, projectName);
    // Version marker lets us prove the live site is this exact build.
    const marker = `<meta name="wo-version" content="${version.content_hash.slice(0, 16)}">`;
    const files: SiteFiles = { ...version.files };
    for (const k of Object.keys(files)) if (k.endsWith(".html") && typeof files[k] === "string") files[k] = (files[k] as string).replace("<head>", `<head>\n${marker}`);

    const up = await uploadWithWrangler({ apiToken: creds.apiToken, accountId: creds.accountId }, projectName, files, `WebOpportunity AI approval ${approvalId}`);
    const dep = await waitForDeployment({ apiToken: creds.apiToken, accountId: creds.accountId }, projectName, started);
    const productionUrl = `https://${project.subdomain}`;
    await db.from("deployment_records").update({ status: "succeeded", provider_deployment_id: dep.id, url: productionUrl, error: null }).eq("id", recordId);

    const live = await verifyLive(productionUrl, marker);
    if (!live.ok) return fail(`Cloudflare reported success but the live URL could not be verified (${live.reason}). Deployment ${dep.id}. Wrangler: ${up.url ?? "no URL"}`);

    await db.from("deployment_records").update({ status: "verified", verified_at: new Date().toISOString() }).eq("id", recordId);
    await db.from("generated_websites").update({ status: "deployed" }).eq("id", websiteId);
    await db.from("businesses").update({ status: "deployed" }).eq("id", site.business_id).eq("organisation_id", organisationId).in("status", ["awaiting_deployment_approval", "prototype_generated", "qualified", "deployed"]);
    await db.from("crm_activities").insert({ organisation_id: organisationId, business_id: site.business_id, type: "deployed", summary: `Concept live at ${productionUrl}`, data: { record_id: recordId, url: productionUrl, deployment_id: dep.id } });
    await writeAudit(db, { organisationId, action: "deployment.verified", entityType: "website", entityId: websiteId, data: { record_id: recordId, url: productionUrl, deployment_id: dep.id, approval_id: approvalId } });
    return { recordId, status: "verified" as const, url: productionUrl };
  } catch (e) {
    return fail((e as Error).message.slice(0, 500));
  }
}
