import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSecret } from "@/lib/integrations";
import { writeAudit } from "@/lib/audit-log";

/**
 * Resend delivery events (sent through Svix). Each request is verified with the organisation's
 * webhook signing secret before anything is recorded; bounces and complaints suppress the address.
 */

const TOLERANCE_S = 5 * 60;

/** Verify a Svix signature: HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_". */
export function verifySvix(secret: string, h: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${body}`).digest();
  // The header can hold several space-separated "v1,<base64>" signatures (secret rotation).
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: { email_id?: string; to?: string[]; bounce?: { type?: string; message?: string } };
}

/** Which addresses an event should suppress, and why. */
export function suppressionFor(e: ResendEvent): "bounced" | "complained" | null {
  if (e.type === "email.complained") return "complained";
  // Only permanent bounces: a full mailbox or a temporary failure is not a reason to stop.
  if (e.type === "email.bounced" && !/transient|temporary|soft/i.test(e.data?.bounce?.type ?? "")) return "bounced";
  return null;
}

export type WebhookOutcome = { status: number; message: string };

/** Handle one webhook delivery. `db` is the service client (only the server writes email events). */
export async function handleResendWebhook(db: SupabaseClient, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string): Promise<WebhookOutcome> {
  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return { status: 400, message: "invalid JSON" };
  }
  const messageId = event.data?.email_id;
  if (!messageId) return { status: 200, message: "ignored: no email id" };

  // Find the organisation from our own record of the message, then verify with its secret.
  const { data: draft } = await db.from("email_drafts").select("id, organisation_id, business_id, to_email").eq("provider_message_id", messageId).maybeSingle();
  if (!draft) return { status: 200, message: "ignored: unknown message" };
  const creds = await getSecret(db, draft.organisation_id, "resend");
  if (!creds?.webhookSecret) return { status: 401, message: "no webhook secret configured" };
  if (!verifySvix(creds.webhookSecret, headers, body)) return { status: 401, message: "invalid signature" };

  const { error } = await db.from("email_events").insert({
    organisation_id: draft.organisation_id, draft_id: draft.id, provider: "resend", provider_event_id: headers.id!, provider_message_id: messageId,
    type: event.type, payload: event as unknown as Record<string, unknown>, occurred_at: event.created_at ?? new Date().toISOString(),
  });
  if (error?.code === "23505") return { status: 200, message: "duplicate" };
  if (error) throw error;

  const reason = suppressionFor(event);
  if (reason) {
    // The unique index is on lower(email); an existing entry (23505) is fine.
    const { error: sErr } = await db.from("suppression_lists").insert({ organisation_id: draft.organisation_id, email: draft.to_email.toLowerCase(), reason, source: "resend_webhook" });
    if (sErr && sErr.code !== "23505") throw sErr;
    await db.from("email_drafts").update({ status: "cancelled", last_error: `Address ${reason}` }).eq("organisation_id", draft.organisation_id).eq("to_email", draft.to_email).in("status", ["draft", "review", "awaiting_approval", "approved", "blocked", "failed"]);
    if (reason === "complained") await db.from("businesses").update({ status: "suppressed" }).eq("id", draft.business_id).eq("organisation_id", draft.organisation_id);
    await db.from("crm_activities").insert({ organisation_id: draft.organisation_id, business_id: draft.business_id, type: `email_${reason}`, summary: reason === "bounced" ? "Email bounced; the address is suppressed" : "Recipient marked the email as spam; the address is suppressed", data: { draft_id: draft.id } });
    await writeAudit(db, { organisationId: draft.organisation_id, actorType: "webhook", action: `email.${reason}`, entityType: "email", entityId: draft.id, data: { message_id: messageId } });
  }
  return { status: 200, message: "ok" };
}
