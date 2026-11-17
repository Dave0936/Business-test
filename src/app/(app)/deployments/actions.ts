"use server";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit-log";
import type { OrgContext } from "@/lib/auth";
import { deployApprovedWebsite, DeploymentBlockedError, recheckDeployment, removeDeployment } from "@/lib/deploy/deploy";

const PATHS = ["/deployments", "/approvals", "/builder", "/overview"];

/** The deployment service writes records the database lets only the service role write. */
function serviceClient() {
  if (!env.supabaseServiceRoleKey) throw new Error("Deployment needs SUPABASE_SERVICE_ROLE_KEY set on the server (Vercel environment variables). Nothing was deployed.");
  return createServiceClient();
}

/** Check, as the signed-in person (row-level security applies), that this site is theirs and approved. */
async function approvedSite(ctx: OrgContext, websiteId: string) {
  const { data: site } = await ctx.supabase.from("generated_websites").select("id, status, current_version_id").eq("id", websiteId).eq("organisation_id", ctx.organisationId).maybeSingle();
  if (!site) throw new Error("Website not found.");
  if (site.status !== "approved" && site.status !== "deployed") throw new Error("Only an approved version can be deployed. Review it under Prototype Approvals first.");
  const { data: approval } = await ctx.supabase.from("approvals").select("id, decision, version_id").eq("subject_type", "website").eq("subject_id", websiteId).order("decided_at", { ascending: false }).limit(1).maybeSingle();
  if (!approval || approval.decision !== "approved" || (approval.version_id && approval.version_id !== site.current_version_id)) {
    throw new Error("The current version has no approval. Review it under Prototype Approvals first.");
  }
  return { site, approvalId: approval.id as string };
}

/** Publish the approved version on Cloudflare. Owners and administrators only. */
export async function deployWebsiteAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const websiteId = z.string().uuid().parse(str(form, "websiteId"));
    const { approvalId } = await approvedSite(ctx, websiteId);
    const db = serviceClient();
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "deployment.requested", entityType: "website", entityId: websiteId, data: { approval_id: approvalId } });
    try {
      const r = await deployApprovedWebsite(db, ctx.organisationId, websiteId, approvalId, { requestedBy: ctx.user.id });
      if (r.status === "verified") return `Live at ${r.url}`;
      if ("skipped" in r && r.skipped) return r.status === "uploading" ? "A deployment of this version is already in progress." : `Already live at ${r.url}`;
      throw new Error("error" in r && r.error ? r.error : "Deployment failed.");
    } catch (e) {
      if (e instanceof DeploymentBlockedError) throw new Error(e.message);
      throw e;
    }
  }, PATHS);
}

/** Look at the live address again when Cloudflare accepted the upload but it wasn't confirmed yet. */
export async function recheckDeploymentAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const recordId = z.string().uuid().parse(str(form, "recordId"));
    const { data: rec } = await ctx.supabase.from("deployment_records").select("id").eq("id", recordId).eq("organisation_id", ctx.organisationId).maybeSingle();
    if (!rec) throw new Error("Deployment not found.");
    const r = await recheckDeployment(serviceClient(), ctx.organisationId, recordId, { actorId: ctx.user.id });
    if (!r.ok) throw new Error(`Still not confirmed (${r.reason}).`);
    return "Confirmed live.";
  }, PATHS);
}

/** Take a concept offline (for example when the business asks). Owners and administrators only. */
export async function removeDeploymentAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const websiteId = z.string().uuid().parse(str(form, "websiteId"));
    const { data: site } = await ctx.supabase.from("generated_websites").select("id").eq("id", websiteId).eq("organisation_id", ctx.organisationId).maybeSingle();
    if (!site) throw new Error("Website not found.");
    await removeDeployment(serviceClient(), ctx.organisationId, websiteId, ctx.user.id);
    return "Taken offline. The address no longer serves the concept.";
  }, PATHS);
}
