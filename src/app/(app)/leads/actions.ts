"use server";
import { z } from "zod";
import { guarded, kickWorker, str, type ActionState } from "@/lib/actions";
import { enqueue, monthKey, DEFAULT_CASCADE } from "@/lib/jobs/queue";
import type { OrgContext } from "@/lib/auth";
import { writeAudit } from "@/lib/audit-log";
import { LEAD_STATUSES } from "@/lib/industries";

const ID = z.string().uuid();

async function queueFor(businessIds: string[], type: "audit" | "research" | "generate" | "draft_email", ctx: OrgContext, force = false) {
  const { data: owned } = await ctx.supabase.from("businesses").select("id").eq("organisation_id", ctx.organisationId).in("id", businessIds);
  let queued = 0;
  for (const { id } of owned ?? []) {
    const key = type === "audit" ? `audit:${id}:${monthKey()}` : type === "research" ? `research:${id}:${monthKey()}` : type === "generate" ? `generate:${id}` : `draft:${id}:initial`;
    const ok = await enqueue(ctx.supabase, {
      organisationId: ctx.organisationId, type,
      payload: { businessId: id, actorId: ctx.user.id, cascade: { ...DEFAULT_CASCADE, research: false, generate: false } },
      idempotencyKey: force ? `${key}:manual:${Date.now()}` : key,
    });
    if (ok) queued++;
  }
  kickWorker(ctx);
  return queued;
}

export async function queueAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const type = z.enum(["audit", "research", "generate", "draft_email"]).parse(str(form, "type"));
    const ids = (form.getAll("businessId").map(String)).filter((x) => ID.safeParse(x).success);
    if (!ids.length) throw new Error("Select at least one business.");
    const n = await queueFor(ids, type, ctx, form.get("force") === "1");
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: `queue.${type}`, data: { count: n, ids: ids.slice(0, 50) } });
    const label = { audit: "audit", research: "design research", generate: "prototype generation", draft_email: "email drafting" }[type];
    return n ? `Queued ${label} for ${n} business${n === 1 ? "" : "es"}. Results appear here as they finish.` : `Already queued or done this month. Use "run again" to force.`;
  }, ["/leads", "/audits"]);
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(LEAD_STATUSES).optional(),
  subscriber_type: z.enum(["corporate", "individual", "unknown"]).optional(),
  notes: z.string().max(5000).optional(),
  follow_up_at: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  website_url: z.string().url().optional().or(z.literal("")),
  estimated_value: z.coerce.number().min(0).optional(),
  actual_revenue: z.coerce.number().min(0).optional(),
});

export async function updateLead(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const raw = Object.fromEntries([...form.entries()].filter(([k, v]) => !k.startsWith("$") && v !== "").map(([k, v]) => [k, String(v)]));
    const d = UpdateSchema.parse(raw);
    const { data: before } = await ctx.supabase.from("businesses").select("status, email, subscriber_type").eq("id", d.id).single();
    const patch: Record<string, unknown> = { ...d };
    delete patch.id;
    if (d.follow_up_at) patch.follow_up_at = new Date(d.follow_up_at).toISOString();
    if (d.email !== undefined && d.email !== before?.email) patch.email_source = d.email ? "manual" : "unknown";
    if (d.status === "converted" && !d.actual_revenue) throw new Error("Enter the actual revenue when marking a lead converted.");
    const { error } = await ctx.supabase.from("businesses").update(patch).eq("id", d.id).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    const changes = Object.keys(patch).join(", ");
    await ctx.supabase.from("crm_activities").insert({ organisation_id: ctx.organisationId, business_id: d.id, type: "updated", summary: d.status && d.status !== before?.status ? `Status changed to ${d.status.replace(/_/g, " ")}` : `Updated ${changes}`, data: patch, actor_id: ctx.user.id });
    if (d.status === "suppressed" && before?.email) {
      await ctx.supabase.from("suppression_lists").upsert({ organisation_id: ctx.organisationId, email: before.email.toLowerCase(), reason: "do_not_contact", source: "crm" }, { onConflict: "organisation_id,email", ignoreDuplicates: true });
    }
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "lead.updated", entityType: "business", entityId: d.id, data: { fields: Object.keys(patch) } });
    return "Saved.";
  }, ["/leads", "/crm"]);
}

export async function addNote(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = ID.parse(str(form, "id"));
    const note = str(form, "note");
    if (!note) throw new Error("Write a note first.");
    await ctx.supabase.from("crm_activities").insert({ organisation_id: ctx.organisationId, business_id: id, type: "note", summary: note.slice(0, 2000), actor_id: ctx.user.id });
    return "Note added.";
  }, "/leads");
}
