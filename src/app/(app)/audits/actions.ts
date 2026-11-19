"use server";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { writeAudit } from "@/lib/audit-log";

/** Delete selected audits, or older audits (keeping each business's latest). Owners and administrators. */
export async function auditsSelectionAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const op = z.enum(["delete", "prune"]).parse(str(form, "op"));
    if (op === "prune") {
      const { data, error } = await ctx.supabase.rpc("prune_history", { p_org: ctx.organisationId, p_kind: "audits" });
      if (error) throw new Error(error.message);
      return data ? `Removed ${data} older audit${data === 1 ? "" : "s"}. Each business keeps its latest.` : "Nothing to remove: each business has only its latest audit.";
    }
    const ids = form.getAll("auditId").map(String).filter((x) => z.string().uuid().safeParse(x).success);
    if (!ids.length) throw new Error("Select at least one audit.");
    const { data, error } = await ctx.supabase.from("website_audits").delete().eq("organisation_id", ctx.organisationId).in("id", ids).select("id");
    if (error) throw new Error(error.message);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "audits.deleted", data: { count: data?.length ?? 0 } });
    return `Deleted ${data?.length ?? 0} audit${data?.length === 1 ? "" : "s"}. Lead scores are kept; audit again to refresh them.`;
  }, ["/audits", "/leads", "/overview"]);
}
