"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { env } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit-log";
import { draftEmail, DraftBlockedError, refreshCompliance, updateDraftContent } from "@/lib/email/draft";
import { sendApprovedEmail, SendBlockedError, SendDeferredError, sendTestEmail } from "@/lib/email/send";

const PATHS = ["/emails", "/leads", "/overview"];
const Id = z.string().uuid();

/** The app's public address, for unsubscribe links (never localhost in production). */
async function publicBaseUrl(): Promise<string> {
  if (env.appUrl && !/localhost|127\.0\.0\.1/.test(env.appUrl)) return env.appUrl;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : env.appUrl;
}

/** Write a personalised email for a business whose concept is live. Opens the draft. */
export async function draftEmailAction(_p: ActionState, form: FormData): Promise<ActionState> {
  let draftId = "";
  const r = await guarded("staff", async (ctx) => {
    const businessId = Id.parse(str(form, "businessId"));
    const kind = z.enum(["initial", "follow_up"]).parse(str(form, "kind") || "initial");
    try {
      const d = await draftEmail(ctx.supabase, ctx.organisationId, businessId, { actorId: ctx.user.id, kind, appUrl: await publicBaseUrl() });
      draftId = d.draftId;
      await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "email.drafted", entityType: "email", entityId: d.draftId, data: { kind, status: d.status } });
    } catch (e) {
      if (e instanceof DraftBlockedError) throw new Error(e.message);
      throw e;
    }
  }, PATHS);
  if (r.ok && draftId) redirect(`/emails/${draftId}`);
  return r;
}

export async function saveDraftAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = Id.parse(str(form, "draftId"));
    const subject = z.string().min(3, "Add a subject.").max(150).parse(str(form, "subject"));
    const body = z.string().min(40, "The email is too short.").max(8000).parse(String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim());
    const r = await updateDraftContent(ctx.supabase, ctx.organisationId, id, subject, body);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "email.edited", entityType: "email", entityId: id, data: { status: r.status } });
    return r.status === "blocked" ? "Saved, but it can't be sent: see the checks." : "Saved. Any earlier approval no longer applies; it needs approving again.";
  }, PATHS);
}

export async function recheckEmailAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = Id.parse(str(form, "draftId"));
    const r = await refreshCompliance(ctx.supabase, ctx.organisationId, id);
    return r.compliance.allowed ? "Checked again: it can be approved." : `Checked again: ${r.compliance.reasons[0] ?? "it still can't be sent."}`;
  }, PATHS);
}

/** A person confirms the conditions a country's rules leave to judgement (for example CASL implied consent). */
export async function confirmConditionsAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const id = Id.parse(str(form, "draftId"));
    if (form.get("confirm") !== "on") throw new Error("Tick the box to confirm.");
    const r = await refreshCompliance(ctx.supabase, ctx.organisationId, id, { jurisdiction_conditions_confirmed: true });
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "email.conditions_confirmed", entityType: "email", entityId: id, data: { regime: r.compliance.regime } });
    return r.compliance.allowed ? "Confirmed. It can now be approved." : `Confirmed, but: ${r.compliance.reasons[0] ?? "it still can't be sent."}`;
  }, PATHS);
}

export async function decideEmailAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const id = Id.parse(str(form, "draftId"));
    const decision = z.enum(["approved", "changes_requested", "rejected"]).parse(str(form, "decision"));
    const comment = str(form, "comment").slice(0, 2000);
    if (decision !== "approved" && comment.length < 3) throw new Error(decision === "rejected" ? "Say why you are rejecting it." : "Say what needs to change.");
    if (decision === "approved" && form.get("read") !== "on") throw new Error("Confirm you have read the whole email, including the footer.");
    // Re-check compliance first so the database sees today's answer.
    if (decision === "approved") await refreshCompliance(ctx.supabase, ctx.organisationId, id);
    const { error } = await ctx.supabase.rpc("decide_approval", { p_subject_type: "email", p_subject_id: id, p_decision: decision, p_comment: comment || null });
    if (error) throw new Error(error.message);
    return decision === "approved" ? "Approved. It is not sent until someone clicks Send." : decision === "rejected" ? "Rejected; the email is cancelled." : "Changes requested. Edit it and it goes back for approval.";
  }, PATHS);
}

/** Send one approved email through Resend. The sending service runs with the service role. */
export async function sendEmailAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const id = Id.parse(str(form, "draftId"));
    const { data: d } = await ctx.supabase.from("email_drafts").select("id, status").eq("id", id).eq("organisation_id", ctx.organisationId).maybeSingle();
    if (!d) throw new Error("Email not found.");
    if (!env.supabaseServiceRoleKey) throw new Error("Sending needs SUPABASE_SERVICE_ROLE_KEY on the server. Nothing was sent.");
    try {
      const r = await sendApprovedEmail(createServiceClient(), ctx.organisationId, id, { actorId: ctx.user.id });
      return r.skipped ? "It was already sent." : "Sent. Resend accepted it for delivery.";
    } catch (e) {
      if (e instanceof SendBlockedError || e instanceof SendDeferredError) throw new Error(e.message);
      throw e;
    }
  }, PATHS);
}

/** Send a copy to yourself (marked [TEST]). Never to the business. */
export async function testSendAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = Id.parse(str(form, "draftId"));
    const { data: d } = await ctx.supabase.from("email_drafts").select("subject, body_text").eq("id", id).eq("organisation_id", ctx.organisationId).single();
    if (!d) throw new Error("Email not found.");
    const to = ctx.user.email;
    if (!to) throw new Error("Your account has no email address.");
    await sendTestEmail(ctx.supabase, ctx.organisationId, to, d.subject, d.body_text);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "email.test_sent", entityType: "email", entityId: id, data: {} });
    return `Test sent to ${to}.`;
  }, PATHS);
}

export async function cancelEmailAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = Id.parse(str(form, "draftId"));
    const { error, count } = await ctx.supabase.from("email_drafts").update({ status: "cancelled" }, { count: "exact" }).eq("id", id).eq("organisation_id", ctx.organisationId).in("status", ["draft", "review", "awaiting_approval", "approved", "blocked", "failed"]);
    if (error) throw error;
    if (!count) throw new Error("This email can no longer be cancelled.");
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "email.cancelled", entityType: "email", entityId: id, data: {} });
    return "Cancelled.";
  }, PATHS);
}

/** Replies arrive in your own inbox; record them here so the lead moves on. */
export async function markRepliedAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = Id.parse(str(form, "draftId"));
    const outcome = z.enum(["replied", "interested", "not_interested", "meeting_requested"]).parse(str(form, "outcome") || "replied");
    const { data: d } = await ctx.supabase.from("email_drafts").select("business_id, status").eq("id", id).eq("organisation_id", ctx.organisationId).single();
    if (!d || d.status !== "sent") throw new Error("Only a sent email can have a reply.");
    await ctx.supabase.from("businesses").update({ status: outcome, follow_up_at: null }).eq("id", d.business_id).eq("organisation_id", ctx.organisationId);
    await ctx.supabase.from("email_drafts").update({ follow_up_at: null }).eq("business_id", d.business_id).eq("organisation_id", ctx.organisationId).eq("status", "sent");
    await ctx.supabase.from("crm_activities").insert({ organisation_id: ctx.organisationId, business_id: d.business_id, type: "email_reply", summary: `Reply recorded: ${outcome.replace(/_/g, " ")}`, data: { draft_id: id }, actor_id: ctx.user.id });
    if (outcome === "not_interested") {
      const { data: b } = await ctx.supabase.from("businesses").select("email").eq("id", d.business_id).single();
      if (b?.email) {
        const { error } = await ctx.supabase.from("suppression_lists").insert({ organisation_id: ctx.organisationId, email: b.email.toLowerCase(), reason: "do_not_contact", source: "reply" });
        if (error && error.code !== "23505") throw error;
      }
    }
    return outcome === "not_interested" ? "Recorded. They won't be emailed again." : "Recorded.";
  }, PATHS);
}

export async function addSuppressionAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const value = str(form, "value").toLowerCase();
    const isDomain = !value.includes("@");
    if (isDomain ? !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value) : !z.string().email().safeParse(value).success) throw new Error("Enter an email address or a domain such as example.co.uk.");
    const { error } = await ctx.supabase.from("suppression_lists").insert({ organisation_id: ctx.organisationId, [isDomain ? "domain" : "email"]: value, reason: "manual", source: "emails_page" });
    if (error?.code === "23505") return "Already on the list.";
    if (error) throw error;
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "suppression.added", entityType: "suppression", data: { kind: isDomain ? "domain" : "email" } });
    return "Added. Nothing will be sent to it.";
  }, "/emails");
}

export async function removeSuppressionAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const id = Id.parse(str(form, "id"));
    const { data: row } = await ctx.supabase.from("suppression_lists").select("reason").eq("id", id).eq("organisation_id", ctx.organisationId).single();
    // People who opted out or complained stay suppressed: only manual entries can be removed.
    if (!row || !["manual", "do_not_contact"].includes(row.reason)) throw new Error("Only entries added by your team can be removed. Opt-outs, bounces and complaints are permanent.");
    const { error } = await ctx.supabase.from("suppression_lists").delete().eq("id", id).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "suppression.removed", entityType: "suppression", entityId: id, data: {} });
    return "Removed.";
  }, "/emails");
}
