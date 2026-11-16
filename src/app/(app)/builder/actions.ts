"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { guarded, kickWorker, str, type ActionState } from "@/lib/actions";
import { SiteContentSchema, ThemeSchema, type SiteSpec } from "@/lib/sites/spec";
import { imageQueries } from "@/lib/sites/render";
import { regenerateSection, resolveImages, saveVersion, SITE_ASSETS_BUCKET } from "@/lib/sites/builder";
import { enqueue } from "@/lib/jobs/queue";
import { writeAudit } from "@/lib/audit-log";
import type { OrgContext } from "@/lib/auth";

async function currentSpec(ctx: OrgContext, websiteId: string) {
  const { data, error } = await ctx.supabase
    .from("generated_websites")
    .select("id, business_id, website_versions!generated_websites_current_version_fk(spec)")
    .eq("id", websiteId)
    .eq("organisation_id", ctx.organisationId)
    .single();
  if (error) throw new Error("Website not found");
  return { site: data, spec: structuredClone((data.website_versions as unknown as { spec: SiteSpec }).spec) };
}

/** Save editor changes as a new version. Business facts are always reloaded from the database, never taken from the browser. */
export async function saveEdits(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const websiteId = z.string().uuid().parse(str(form, "websiteId"));
    const content = SiteContentSchema.parse(JSON.parse(str(form, "content")));
    const theme = ThemeSchema.parse(JSON.parse(str(form, "theme")));
    if (!content.pages.some((p) => p.slug === "index")) throw new Error("The site needs a home page.");
    const { site, spec } = await currentSpec(ctx, websiteId);
    const { data: b } = await ctx.supabase.from("businesses").select("name, city, region, country_code, phone, email, address").eq("id", site.business_id).single();
    const next: SiteSpec = {
      ...spec,
      content,
      theme,
      business: { ...spec.business, name: b!.name, city: b!.city, region: b!.region, countryCode: b!.country_code, phone: b!.phone, email: b!.email, address: b!.address },
      generatedBy: spec.generatedBy === "manual" ? "manual" : spec.generatedBy,
    };
    next.images = await resolveImages(ctx.supabase, ctx.organisationId, imageQueries(next), spec.images);
    const r = await saveVersion(ctx.supabase, { organisationId: ctx.organisationId, websiteId, businessId: site.business_id, spec: next, note: str(form, "note") || "Edited in builder", actorId: ctx.user.id });
    return r.report.passed ? "Saved as a new version. Quality checks passed; it is waiting for approval." : "Saved, but quality checks failed. Fix the issues listed before it can be approved.";
  }, "/builder");
}

const MAGIC: [string, number[]][] = [["image/jpeg", [0xff, 0xd8, 0xff]], ["image/png", [0x89, 0x50, 0x4e, 0x47]], ["image/webp", [0x52, 0x49, 0x46, 0x46]]];

/** Replace one image with an upload. Only JPEG/PNG/WebP (checked by content, not extension), max 5 MB; SVG is refused. */
export async function uploadImage(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const websiteId = z.string().uuid().parse(str(form, "websiteId"));
    const query = str(form, "query");
    const alt = str(form, "alt");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Images must be under 5 MB.");
    if (!alt) throw new Error("Describe the image (alt text) for accessibility.");
    if (form.get("rights") !== "on") throw new Error("Confirm you have the right to use this image.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = MAGIC.find(([, sig]) => sig.every((b, i) => bytes[i] === b))?.[0];
    if (!type || (type === "image/webp" && String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP")) throw new Error("Only JPEG, PNG or WebP images are accepted.");
    const { site, spec } = await currentSpec(ctx, websiteId);
    if (!imageQueries(spec).includes(query)) throw new Error("Unknown image slot.");
    const name = `${randomUUID()}.${type.split("/")[1].replace("jpeg", "jpg")}`;
    const storagePath = `${ctx.organisationId}/${websiteId}/${name}`;
    const { error } = await ctx.supabase.storage.from(SITE_ASSETS_BUCKET).upload(storagePath, bytes, { contentType: type, upsert: false });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    spec.images[query] = { src: `assets/uploads/${name}`, alt: alt.slice(0, 200), kind: "upload", storagePath, credit: null };
    const r = await saveVersion(ctx.supabase, { organisationId: ctx.organisationId, websiteId, businessId: site.business_id, spec, note: "Image replaced with upload", actorId: ctx.user.id });
    return r.report.passed ? "Image replaced. New version saved." : "Image replaced, but quality checks failed.";
  }, "/builder");
}

export async function regenerateSectionAction(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const r = await regenerateSection(ctx.supabase, {
      organisationId: ctx.organisationId,
      websiteId: z.string().uuid().parse(str(form, "websiteId")),
      pageSlug: str(form, "page"),
      sectionIndex: Number(str(form, "index")),
      instruction: str(form, "instruction").slice(0, 500),
      actorId: ctx.user.id,
    });
    return r.report.passed ? "Section regenerated. New version saved." : "Section regenerated, but quality checks failed.";
  }, "/builder");
}

export async function regenerateSite(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const businessId = z.string().uuid().parse(str(form, "businessId"));
    const { data: b } = await ctx.supabase.from("businesses").select("id").eq("id", businessId).eq("organisation_id", ctx.organisationId).single();
    if (!b) throw new Error("Not found");
    await enqueue(ctx.supabase, { organisationId: ctx.organisationId, type: "generate", payload: { businessId, actorId: ctx.user.id }, idempotencyKey: `generate:${businessId}:manual:${Date.now()}` });
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "website.regenerate", entityType: "business", entityId: businessId });
    kickWorker(ctx);
    return "Regenerating the whole site. A new version will appear here when it’s ready.";
  }, "/builder");
}

/** Restore an earlier version by saving it again as the newest version (history stays immutable). */
export async function restoreVersion(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const websiteId = z.string().uuid().parse(str(form, "websiteId"));
    const versionId = z.string().uuid().parse(str(form, "versionId"));
    const { data: v } = await ctx.supabase.from("website_versions").select("spec, version, website_id").eq("id", versionId).eq("website_id", websiteId).single();
    const { site } = await currentSpec(ctx, websiteId);
    if (!v) throw new Error("Version not found");
    const r = await saveVersion(ctx.supabase, { organisationId: ctx.organisationId, websiteId, businessId: site.business_id, spec: v.spec as SiteSpec, note: `Restored version ${v.version}`, actorId: ctx.user.id });
    return r.report.passed ? "Restored as a new version." : "Restored, but quality checks failed.";
  }, "/builder");
}
