"use server";
import { z } from "zod";
import { getOrgContext, roleAtLeast } from "@/lib/auth";
import { guarded, kickWorker, str, type ActionState } from "@/lib/actions";
import { enqueue } from "@/lib/jobs/queue";
import { writeAudit } from "@/lib/audit-log";
import { quoteImages, startImages } from "@/lib/sites/generated-images";

export interface QuoteState extends ActionState {
  quote?: { count: number; totalUsd: number; slots: string[] };
}

/** Ask Higgsfield what the photos will cost. Nothing is generated or charged. */
export async function quoteImagesAction(_p: QuoteState, form: FormData): Promise<QuoteState> {
  const ctx = await getOrgContext();
  if (!roleAtLeast(ctx.role, "staff")) return { error: "Your role cannot generate images.", at: Date.now() };
  try {
    const businessId = z.string().uuid().parse(str(form, "businessId"));
    const q = await quoteImages(ctx.supabase, ctx.organisationId, businessId);
    if (!q.items.length) return { message: "Every photo in the brief's image list has already been generated.", at: Date.now() };
    return { quote: { count: q.items.length, totalUsd: q.totalUsd, slots: q.items.map((i) => i.slot) }, at: Date.now() };
  } catch (e) {
    return { error: (e as Error).message, at: Date.now() };
  }
}

export async function generateImagesAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const businessId = z.string().uuid().parse(id);
    const quoted = z.coerce.number().min(0).max(100).parse(str(form, "quotedTotal"));
    const r = await startImages(ctx.supabase, ctx.organisationId, businessId, ctx.user.id, quoted);
    for (const imageId of r.ids) {
      await enqueue(ctx.supabase, { organisationId: ctx.organisationId, type: "image", payload: { imageId }, idempotencyKey: `image:${imageId}:start`, maxAttempts: 5 });
    }
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "images.generation_started", entityType: "business", entityId: businessId, data: { count: r.ids.length, quoted_usd: r.totalUsd, provider: "higgsfield" } });
    kickWorker(ctx);
    return `Generating ${r.ids.length} photos (about $${r.totalUsd.toFixed(2)}). They appear here as they finish, and the next build uses them.`;
  }, `/design-research/${id}`);
}
