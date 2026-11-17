import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSecret } from "@/lib/integrations";
import { writeAudit } from "@/lib/audit-log";
import { evaluateDraft } from "./draft";
import { textToHtml } from "./template";

export class SendBlockedError extends Error {}
export class SendDeferredError extends Error {
  constructor(message: string, public retryAt: Date) {
    super(message);
  }
}

/**
 * Send one approved email. The backend enforces, in order:
 *  1. status is "approved" and the approval matches the current content hash
 *     (the database trigger checks this again when we set "sending");
 *  2. compliance and suppression re-checked at send time;
 *  3. no other email already sent to this address for the same business (duplicate prevention);
 *  4. the organisation's daily sending limit;
 *  5. Resend idempotency key = the draft's idempotency key, so retries never double-send.
 */
export async function sendApprovedEmail(db: SupabaseClient, organisationId: string, draftId: string, opts: { actorId?: string | null; resend?: Pick<Resend, "emails"> } = {}) {
  const { data: d, error } = await db
    .from("email_drafts")
    .select("id, business_id, to_email, subject, body_text, status, approval_id, content_hash, idempotency_key, compliance, kind")
    .eq("id", draftId)
    .eq("organisation_id", organisationId)
    .single();
  if (error) throw error;
  if (d.status === "sent") return { status: "sent", skipped: true };
  const { data: owner } = await db.from("businesses").select("deleted_at").eq("id", d.business_id).single();
  if (owner?.deleted_at) throw new SendBlockedError("This lead is in the recycle bin. Nothing is sent to it.");
  if (d.status !== "approved" && d.status !== "failed") throw new SendBlockedError(`Email is ${d.status}; only approved emails can be sent.`);

  const { data: approvals } = await db.from("approvals").select("id, decision, content_hash").eq("subject_type", "email").eq("subject_id", draftId).order("decided_at", { ascending: false }).limit(1);
  const latest = approvals?.[0];
  if (!latest || latest.decision !== "approved" || latest.content_hash !== d.content_hash || latest.id !== d.approval_id) {
    throw new SendBlockedError("No current approval for this exact content.");
  }

  const compliance = await evaluateDraft(db, organisationId, d);
  if (!compliance.allowed) {
    await db.from("email_drafts").update({ status: "blocked", compliance, last_error: compliance.reasons.join(" ") }).eq("id", draftId);
    throw new SendBlockedError(`Blocked at send time: ${compliance.reasons.join(" ")}`);
  }

  if (d.kind === "initial") {
    const { count: dup } = await db.from("email_drafts").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("business_id", d.business_id).eq("status", "sent").eq("kind", "initial").neq("id", draftId);
    if ((dup ?? 0) > 0) throw new SendBlockedError("An initial email has already been sent to this business.");
  }

  const { data: org } = await db.from("organisations").select("daily_email_limit, agency_reply_email, agency_name, name, inbound_reply_domain").eq("id", organisationId).single();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await db.from("email_drafts").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).eq("status", "sent").gte("sent_at", since.toISOString());
  if ((sentToday ?? 0) >= (org?.daily_email_limit ?? 0)) {
    const tomorrow = new Date(since.getTime() + 86400_000 + 8 * 3600_000);
    throw new SendDeferredError(`Daily sending limit (${org?.daily_email_limit}) reached; will retry tomorrow.`, tomorrow);
  }

  const creds = await getSecret(db, organisationId, "resend");
  if (!creds?.apiKey || !creds.fromEmail) throw new SendBlockedError("Resend is not connected (RESEND_API_KEY and RESEND_FROM_EMAIL). Nothing was sent.");

  // Database guard verifies approval again on this transition.
  const { error: lockErr } = await db.from("email_drafts").update({ status: "sending" }).eq("id", draftId).in("status", ["approved", "failed"]);
  if (lockErr) throw new SendBlockedError(lockErr.message);

  const stored = d.compliance as { unsubscribe_url?: string; unsubscribe_post_url?: string };
  // One-click unsubscribe (RFC 8058) posts to the API address; the body links to the page.
  const unsubscribeUrl = stored.unsubscribe_post_url ?? stored.unsubscribe_url;
  const replyTo = org?.inbound_reply_domain ? `replies+${draftId}@${org.inbound_reply_domain}` : org?.agency_reply_email ?? undefined;
  const fromName = org?.agency_name || org?.name || "WebOpportunity AI";
  const resend = opts.resend ?? new Resend(creds.apiKey);
  const { data, error: sendErr } = await resend.emails.send(
    {
      from: `${fromName} <${creds.fromEmail}>`,
      to: [d.to_email],
      subject: d.subject,
      text: d.body_text,
      html: textToHtml(d.body_text),
      replyTo,
      headers: unsubscribeUrl ? { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      tags: [{ name: "draft_id", value: draftId }, { name: "organisation_id", value: organisationId }],
    },
    { idempotencyKey: d.idempotency_key },
  );

  if (sendErr || !data?.id) {
    const msg = sendErr?.message ?? "Resend did not return a message id";
    await db.from("email_drafts").update({ status: "failed", last_error: msg }).eq("id", draftId);
    await writeAudit(db, { organisationId, actorId: opts.actorId ?? null, action: "email.send_failed", entityType: "email", entityId: draftId, data: { error: msg } });
    throw new Error(`Resend error: ${msg}`);
  }

  const followUp = new Date(Date.now() + 6 * 86400_000).toISOString();
  await db.from("email_drafts").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: data.id, last_error: null, follow_up_at: followUp, sent_by: opts.actorId ?? null }).eq("id", draftId);
  await db.from("businesses").update({ status: "contacted", follow_up_at: followUp }).eq("id", d.business_id).eq("organisation_id", organisationId).in("status", ["awaiting_email_approval", "deployed", "qualified", "contacted"]);
  await db.from("crm_activities").insert({ organisation_id: organisationId, business_id: d.business_id, type: "email_sent", summary: `Email sent to ${d.to_email}`, data: { draft_id: draftId, message_id: data.id }, actor_id: opts.actorId ?? null });
  await writeAudit(db, { organisationId, actorId: opts.actorId ?? null, action: "email.sent", entityType: "email", entityId: draftId, data: { message_id: data.id, approval_id: d.approval_id, to: d.to_email } });
  return { status: "sent", messageId: data.id };
}

/** Test send: only to the signed-in user's own address; never to the prospect. */
export async function sendTestEmail(db: SupabaseClient, organisationId: string, to: string, subject: string, body: string) {
  const creds = await getSecret(db, organisationId, "resend");
  if (!creds?.apiKey || !creds.fromEmail) throw new SendBlockedError("Resend is not connected. Test sending is unavailable.");
  const resend = new Resend(creds.apiKey);
  const { data, error } = await resend.emails.send({ from: creds.fromEmail, to: [to], subject: `[TEST] ${subject}`, text: body, html: textToHtml(body) });
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}
