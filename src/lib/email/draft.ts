import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { aiAvailable } from "@/lib/ai/client";
import { runEmailAgent } from "@/lib/ai/agents/email-agent";
import { randomToken, sha256 } from "@/lib/security/crypto";
import { COUNTRIES } from "@/lib/industries";
import { complianceFooter, renderTemplate } from "./template";
import { evaluateCompliance, pickRule, type ComplianceConfirmations, type ComplianceRule } from "./compliance";

export class DraftBlockedError extends Error {}

const SOURCE_LABEL: Record<string, string> = { business_website: "on its website", listing: "in a public business listing", manual: "as added by our team", unknown: "unknown source" };

export async function loadComplianceContext(db: SupabaseClient, organisationId: string, businessId: string, recipient: string) {
  const domain = recipient.split("@")[1]?.toLowerCase() ?? "";
  const [{ data: b }, { data: org }, { data: rules }, { data: sup }] = await Promise.all([
    db.from("businesses").select("country_code, subscriber_type, is_demo, email_source, name").eq("id", businessId).eq("organisation_id", organisationId).single(),
    db.from("organisations").select("name, agency_name, agency_postal_address, agency_reply_email, agency_website, settings").eq("id", organisationId).single(),
    db.from("compliance_rules").select("organisation_id, country_code, rule"),
    db.from("suppression_lists").select("email, domain, reason").eq("organisation_id", organisationId).or(`email.eq."${recipient.toLowerCase().replace(/["\\]/g, "")}",domain.eq."${domain.replace(/["\\]/g, "")}"`),
  ]);
  if (!b || !org) throw new Error("Business or organisation not found");
  const rule = pickRule((rules ?? []) as { organisation_id: string | null; country_code: string; rule: ComplianceRule }[], organisationId, b.country_code);
  const suppression = {
    email: (sup ?? []).some((s) => s.email?.toLowerCase() === recipient.toLowerCase()),
    domain: (sup ?? []).some((s) => s.domain?.toLowerCase() === domain),
    reason: sup?.[0]?.reason,
  };
  const settings = (org.settings ?? {}) as { lia?: { completed_at?: string } };
  return { business: b, org, rule, suppression, liaDone: Boolean(settings.lia?.completed_at) };
}

type StoredCompliance = { confirmations?: ComplianceConfirmations; unsubscribe_url?: string; unsubscribe_post_url?: string };

export async function evaluateDraft(db: SupabaseClient, organisationId: string, draft: { business_id: string; to_email: string; body_text: string; compliance?: StoredCompliance }) {
  const c = await loadComplianceContext(db, organisationId, draft.business_id, draft.to_email);
  const confirmations = { ...(draft.compliance?.confirmations ?? {}), legitimate_interests_assessed: c.liaDone };
  const result = evaluateCompliance({
    countryCode: c.business.country_code,
    subscriberType: c.business.subscriber_type,
    rule: c.rule,
    recipient: draft.to_email,
    isDemo: c.business.is_demo,
    suppression: c.suppression,
    agency: { name: c.org.agency_name || c.org.name, postalAddress: c.org.agency_postal_address, replyEmail: c.org.agency_reply_email },
    body: draft.body_text,
    unsubscribeUrl: draft.compliance?.unsubscribe_url ?? null,
    confirmations,
    emailSource: c.business.email_source,
  });
  return { ...result, confirmations, unsubscribe_url: draft.compliance?.unsubscribe_url ?? null, unsubscribe_post_url: draft.compliance?.unsubscribe_post_url ?? null };
}

/**
 * Create a personalised draft for a business whose concept has been deployed and verified.
 * The draft goes to "awaiting_approval" (or "blocked" if compliance rules forbid it).
 */
export async function draftEmail(db: SupabaseClient, organisationId: string, businessId: string, opts: { actorId?: string | null; kind?: "initial" | "follow_up"; templateId?: string; appUrl?: string } = {}) {
  const kind = opts.kind ?? "initial";
  const { data: b, error } = await db.from("businesses").select("id, name, category, city, country_code, email, email_source, language, is_demo").eq("id", businessId).eq("organisation_id", organisationId).single();
  if (error) throw error;
  if (!b.email) throw new DraftBlockedError("No published email address for this business. Contact them through their contact page or by phone instead.");

  const { data: dep } = await db.from("deployment_records").select("id, website_id, url, status").eq("business_id", businessId).eq("organisation_id", organisationId).eq("status", "verified").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!dep?.url) throw new DraftBlockedError("The concept must be approved, deployed and verified before an email can be drafted.");

  const [{ data: org }, { data: tpl }, { data: audit }] = await Promise.all([
    db.from("organisations").select("name, agency_name, agency_postal_address, agency_reply_email, agency_website").eq("id", organisationId).single(),
    opts.templateId
      ? db.from("email_templates").select("id, subject, body").eq("id", opts.templateId).eq("organisation_id", organisationId).single()
      : db.from("email_templates").select("id, subject, body").eq("organisation_id", organisationId).eq("purpose", kind === "initial" ? "initial" : "follow_up").order("created_at").limit(1).single(),
    db.from("website_audits").select("observed, problems").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!org || !tpl) throw new Error("Organisation or email template missing");
  const agencyName = org.agency_name || org.name;

  // Facts the email may mention: only observed audit facts.
  const facts = ((audit?.problems as { title: string; detail: string; basis?: string }[] | null) ?? [])
    .filter((p) => p.basis === "observed" || !p.basis)
    .slice(0, 4)
    .map((p) => `${p.title}: ${p.detail}`);
  if (!audit || (audit.observed as { noWebsite?: boolean }).noWebsite) facts.unshift("We could not find a website for the business.");

  const language = b.language ?? COUNTRIES.find((c) => c.code === b.country_code)?.language ?? "en";
  let parts: { subject: string; greeting_name: string; observation: string; reason: string; improvements: string };
  let generatedBy: "ai" | "demo" = "demo";
  if (aiAvailable() && kind === "initial") {
    const r = await runEmailAgent({ db, organisationId, language, business: b, facts, conceptUrl: dep.url, agencyName });
    parts = r.output;
    generatedBy = "ai";
  } else {
    parts = {
      subject: renderTemplate(tpl.subject, { business_name: b.name }),
      greeting_name: b.name,
      observation: facts[0] ? `While looking at local ${b.category?.toLowerCase() ?? "businesses"}, we noticed: ${facts[0].replace(/^[^:]+:\s*/, "")}` : `We came across ${b.name} while looking at local businesses.`,
      reason: `We're ${agencyName}, a small web studio. We put together a website concept for ${b.name} on our own initiative. You didn't ask for it and there's no obligation.`,
      improvements: "It shows a mobile-friendly layout, clear ways to get in touch, and your key information up front.",
    };
  }

  const token = randomToken();
  // The app's public address (from the request when available, so links never point at localhost).
  const base = (opts.appUrl ?? env.appUrl).replace(/\/$/, "");
  const unsubscribeUrl = `${base}/u/${token}`;
  const unsubscribePostUrl = `${base}/api/unsubscribe/${token}`;
  const body = renderTemplate(tpl.body, {
    business_name: b.name,
    greeting_name: parts.greeting_name,
    observation: parts.observation,
    reason: parts.reason,
    concept_url: dep.url,
    improvements: parts.improvements,
    signature: `${agencyName}${org.agency_reply_email ? `\n${org.agency_reply_email}` : ""}`,
  });
  const fullBody = `${body}\n\n${complianceFooter({ agencyName, postalAddress: org.agency_postal_address, replyEmail: org.agency_reply_email, agencyWebsite: org.agency_website, unsubscribeUrl, businessName: b.name, source: SOURCE_LABEL[b.email_source] ?? "public source" })}`;

  const draft = { business_id: businessId, to_email: b.email, body_text: fullBody, compliance: { unsubscribe_url: unsubscribeUrl, unsubscribe_post_url: unsubscribePostUrl } };
  const compliance = await evaluateDraft(db, organisationId, draft);

  const idempotencyKey = sha256(`${organisationId}:${businessId}:${b.email.toLowerCase()}:${kind}:${kind === "initial" ? "v1" : new Date().toISOString().slice(0, 10)}`);
  const { data: row, error: insErr } = await db
    .from("email_drafts")
    .insert({
      organisation_id: organisationId, business_id: businessId, website_id: dep.website_id, deployment_id: dep.id, template_id: tpl.id, kind,
      to_email: b.email, subject: parts.subject, body_text: fullBody,
      status: compliance.status === "blocked" ? "blocked" : "awaiting_approval",
      compliance, content_hash: "computed-by-db", idempotency_key: idempotencyKey, generated_by: generatedBy,
    })
    .select("id, status")
    .single();
  if (insErr) {
    if (insErr.code === "23505") throw new DraftBlockedError("An email to this business already exists. Duplicate prevented.");
    throw insErr;
  }
  await db.from("unsubscribe_tokens").insert({ token, organisation_id: organisationId, email: b.email.toLowerCase(), draft_id: row.id });
  if (row.status === "awaiting_approval") {
    await db.from("businesses").update({ status: "awaiting_email_approval" }).eq("id", businessId).eq("organisation_id", organisationId).in("status", ["deployed", "awaiting_deployment_approval", "qualified"]);
  }
  await db.from("crm_activities").insert({
    organisation_id: organisationId, business_id: businessId, type: "email_drafted",
    summary: row.status === "blocked" ? `Email drafted but blocked: ${compliance.reasons[0] ?? "compliance"}` : "Email drafted and awaiting approval",
    data: { draft_id: row.id, compliance_status: compliance.status }, actor_id: opts.actorId ?? null,
  });
  return { draftId: row.id as string, status: row.status as string, compliance };
}

/** Re-run the compliance checks on a draft (after settings, the lead or confirmations changed). */
export async function refreshCompliance(db: SupabaseClient, organisationId: string, draftId: string, confirm?: Partial<ComplianceConfirmations>) {
  const { data: d, error } = await db.from("email_drafts").select("id, business_id, to_email, body_text, status, compliance").eq("id", draftId).eq("organisation_id", organisationId).single();
  if (error) throw error;
  if (["sent", "sending", "cancelled"].includes(d.status)) throw new Error(`This email is ${d.status}; its checks can no longer change.`);
  const stored = (d.compliance ?? {}) as StoredCompliance;
  const compliance = await evaluateDraft(db, organisationId, { ...d, compliance: { ...stored, confirmations: { ...(stored.confirmations ?? {}), ...(confirm ?? {}) } } });
  // A draft that can no longer be sent is blocked; one that now can goes back to approval.
  const status = compliance.status === "blocked" ? "blocked" : d.status === "blocked" ? "awaiting_approval" : d.status;
  const { error: uErr } = await db.from("email_drafts").update({ compliance, status }).eq("id", draftId).eq("organisation_id", organisationId);
  if (uErr) throw uErr;
  return { compliance, status };
}

/**
 * Save an edited subject and body. The system footer (sender, address, opt-out link) must stay;
 * any edit voids an earlier approval (enforced by the database too).
 */
export async function updateDraftContent(db: SupabaseClient, organisationId: string, draftId: string, subject: string, body: string) {
  const { data: d, error } = await db.from("email_drafts").select("id, business_id, to_email, status, compliance").eq("id", draftId).eq("organisation_id", organisationId).single();
  if (error) throw error;
  if (["sent", "sending", "cancelled"].includes(d.status)) throw new Error(`This email is ${d.status} and can't be edited.`);
  const stored = (d.compliance ?? {}) as StoredCompliance;
  if (stored.unsubscribe_url && !body.includes(stored.unsubscribe_url)) throw new Error("Keep the footer with the unsubscribe link: it must stay in the email.");
  const compliance = await evaluateDraft(db, organisationId, { business_id: d.business_id, to_email: d.to_email, body_text: body, compliance: stored });
  const status = compliance.status === "blocked" ? "blocked" : "awaiting_approval";
  const { error: uErr } = await db.from("email_drafts").update({ subject, body_text: body, compliance, status, generated_by: "manual" }).eq("id", draftId).eq("organisation_id", organisationId);
  if (uErr) throw uErr;
  return { compliance, status };
}
