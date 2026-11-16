"use server";
import { z } from "zod";
import { guarded, str, type ActionState } from "@/lib/actions";
import { assertSafeUrl } from "@/lib/security/safe-fetch";

const RefSchema = z.object({
  businessId: z.string().uuid().optional(),
  sector: z.string().max(40).optional(),
  url: z.string().url(),
  imageUrl: z.string().url().optional(),
  title: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  attribution: z.string().max(200).optional(),
});

/** Manual reference submission. Stored as a link only; images are not copied or re-hosted. */
export async function addReference(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const d = RefSchema.parse({
      businessId: str(form, "businessId") || undefined, sector: str(form, "sector") || undefined, url: str(form, "url"),
      imageUrl: str(form, "imageUrl") || undefined, title: str(form, "title") || undefined, notes: str(form, "notes") || undefined, attribution: str(form, "attribution") || undefined,
    });
    assertSafeUrl(d.url);
    if (d.imageUrl) assertSafeUrl(d.imageUrl);
    if (!d.businessId && !d.sector) throw new Error("Attach the reference to a business or a sector.");
    const source = /pinterest\./i.test(d.url) ? "pinterest" : /dribbble|behance|awwwards|land-book|siteinspire/i.test(d.url) ? "gallery" : "manual";
    const { error } = await ctx.supabase.from("design_references").insert({
      organisation_id: ctx.organisationId, business_id: d.businessId ?? null, sector: d.sector ?? null, source, url: d.url, image_url: d.imageUrl ?? null,
      title: d.title ?? null, attribution: d.attribution ?? new URL(d.url).hostname, licence_note: "Reference only. Do not reproduce layouts, imagery or logos.",
      analysis: d.notes ? { notes: d.notes } : null, created_by: ctx.user.id,
    });
    if (error) throw error;
    return "Reference saved.";
  }, "/design-research");
}

export async function removeReference(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("administrator", async (ctx) => {
    const { error } = await ctx.supabase.from("design_references").delete().eq("id", z.string().uuid().parse(str(form, "id"))).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    return "Removed.";
  }, "/design-research");
}
