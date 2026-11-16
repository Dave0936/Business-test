"use server";
import { guarded, type ActionState } from "@/lib/actions";
import { clearDemoData, seedDemoData } from "@/lib/demo/seed";
import { writeAudit } from "@/lib/audit-log";

export async function loadDemoData(_prev: ActionState): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const r = await seedDemoData(ctx.supabase, ctx.organisationId, ctx.user.id);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "demo.loaded", data: r });
    return `Loaded ${r.businesses} fictional businesses: ${r.qualified} qualified, ${r.briefs} design briefs, ${r.prototypes} prototypes (${r.prototypesPassedQa} passed QA).`;
  }, ["/overview", "/leads"]);
}

export async function removeDemoData(_prev: ActionState): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const n = await clearDemoData(ctx.supabase, ctx.organisationId);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "demo.removed", data: { businesses: n } });
    return `Removed ${n} demo businesses and everything attached to them.`;
  }, ["/overview", "/leads", "/settings"]);
}
