"use server";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { LEAD_STATUSES } from "@/lib/industries";
import { writeAudit } from "@/lib/audit-log";

/** Move a lead along the pipeline from the board. Each move is logged on the lead and in the audit log. */
export async function moveLead(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = z.string().uuid().parse(str(form, "id"));
    const status = z.enum(LEAD_STATUSES).parse(str(form, "status"));
    if (status === "converted") throw new Error("Open the lead to mark it converted, so the actual revenue is recorded.");
    const { data: before } = await ctx.supabase.from("businesses").select("status").eq("id", id).eq("organisation_id", ctx.organisationId).single();
    if (!before) throw new Error("Lead not found");
    const { error } = await ctx.supabase.from("businesses").update({ status }).eq("id", id).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    await ctx.supabase.from("crm_activities").insert({ organisation_id: ctx.organisationId, business_id: id, type: "status_changed", summary: `Status changed from ${before.status.replace(/_/g, " ")} to ${status.replace(/_/g, " ")}`, data: { from: before.status, to: status }, actor_id: ctx.user.id });
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "lead.status_changed", entityType: "business", entityId: id, data: { from: before.status, to: status } });
    return "Moved.";
  }, ["/crm", "/leads"]);
}

export async function completeFollowUp(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const id = z.string().uuid().parse(str(form, "id"));
    const next = str(form, "next");
    const follow = next ? new Date(Date.now() + Number(next) * 86400_000).toISOString() : null;
    const { error } = await ctx.supabase.from("businesses").update({ follow_up_at: follow }).eq("id", id).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    await ctx.supabase.from("crm_activities").insert({ organisation_id: ctx.organisationId, business_id: id, type: "follow_up", summary: follow ? `Follow-up done; next one in ${next} days` : "Follow-up done", actor_id: ctx.user.id });
    return "Follow-up recorded.";
  }, "/crm");
}
