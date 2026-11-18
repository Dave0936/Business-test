import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiAvailable } from "@/lib/ai/client";
import { runSectionAgent, runSiteAgent, type SiteGenInput } from "@/lib/ai/agents/site-agent";
import { COUNTRIES, industryById } from "@/lib/industries";
import { getSecret } from "@/lib/integrations";
import { produceBrief } from "@/lib/design/research";
import type { DesignBrief } from "@/lib/design/brief";
import { runQaChecks, type QaReport } from "@/lib/qa/checks";
import { browserQa } from "@/lib/qa/browser";
import { demoContent } from "./demo-content";
import { withSelfHostedFonts } from "./fonts-server";
import { generatedImagesFor } from "./generated-images";
import { compressPhoto } from "./image-compress";
import { withVendor } from "./vendor-server";
import { imageQueries, renderSite } from "./render";
import { unsplashSearch } from "./images";
import type { ResolvedImage, SiteFiles, SiteSpec, Theme } from "./spec";

export const SITE_ASSETS_BUCKET = "site-assets";

export function slugify(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\[demo\]\s*/, "demo-").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "site";
}

interface BusinessForSite {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  region: string | null;
  country_code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  language: string | null;
  industry_id: string | null;
  website_url: string | null;
  is_demo: boolean;
}

export async function loadContext(db: SupabaseClient, organisationId: string, businessId: string) {
  const [{ data: b, error }, { data: org, error: oErr }] = await Promise.all([
    db.from("businesses").select("id, name, category, city, region, country_code, phone, email, address, language, industry_id, website_url, is_demo").eq("id", businessId).eq("organisation_id", organisationId).single(),
    db.from("organisations").select("name, agency_name, agency_website, agency_reply_email, settings").eq("id", organisationId).single(),
  ]);
  if (error) throw error;
  if (oErr) throw oErr;
  return { business: b as BusinessForSite, org };
}

export function themeFromBrief(brief: DesignBrief): Theme {
  return {
    colors: { primary: brief.palette.primary, secondary: brief.palette.secondary, accent: brief.palette.accent, background: brief.palette.background, surface: brief.palette.surface, text: brief.palette.text, muted: brief.palette.muted },
    fonts: { heading: brief.typography.heading, body: brief.typography.body },
    radius: "medium",
    heroLayout: brief.hero_layout,
    density: "comfortable",
  };
}

export async function resolveImages(db: SupabaseClient, organisationId: string, queries: string[], existing: Record<string, ResolvedImage> = {}): Promise<Record<string, ResolvedImage>> {
  const out: Record<string, ResolvedImage> = {};
  const creds = await getSecret(db, organisationId, "unsplash");
  for (const q of queries) {
    if (existing[q]) {
      out[q] = existing[q];
      continue;
    }
    if (creds?.accessKey) {
      const img = await unsplashSearch(creds.accessKey, q).catch(() => null);
      if (img) out[q] = img;
    }
  }
  return out;
}

/** Add uploaded images (stored in Supabase Storage) to the static bundle. */
export async function withUploads(db: SupabaseClient, spec: SiteSpec, files: SiteFiles): Promise<SiteFiles> {
  for (const img of Object.values(spec.images)) {
    if (img.kind !== "upload") continue;
    if (!img.storagePath) continue;
    const { data, error } = await db.storage.from(SITE_ASSETS_BUCKET).download(img.storagePath);
    if (error || !data) continue; // QA will report the missing asset
    // Photos travel inside every version, so large ones are compressed (WebP, max 1600 px).
    const small = await compressPhoto(new Uint8Array(await data.arrayBuffer()), data.type || "image/jpeg");
    files[img.src] = { base64: Buffer.from(small.bytes).toString("base64"), contentType: small.contentType };
  }
  return files;
}

export async function buildFiles(db: SupabaseClient, spec: SiteSpec): Promise<SiteFiles> {
  return withUploads(db, spec, renderSite(spec));
}

export async function qaVersion(db: SupabaseClient, spec: SiteSpec, files: SiteFiles): Promise<QaReport> {
  const browser = await browserQa(files);
  return runQaChecks(files, spec, {
    verified: { phone: spec.business.phone, email: spec.business.email, name: spec.business.name },
    agencyName: spec.agency.name,
    browser,
  });
}

/**
 * Store a new immutable version, make it current, run QA and move the site to
 * awaiting_approval if it passes. A failing site stays at "generated" and cannot be approved.
 */
export async function saveVersion(db: SupabaseClient, args: { organisationId: string; websiteId: string; businessId: string; spec: SiteSpec; note: string; actorId?: string | null; files?: SiteFiles }): Promise<{ versionId: string; report: QaReport; approvable: boolean }> {
  // Fonts are bundled with the site, so published concepts never load Google Fonts.
  // Fonts and any animation libraries the pages link are bundled with the site.
  const files = withVendor(withSelfHostedFonts(args.files ? await withUploads(db, args.spec, args.files) : await buildFiles(db, args.spec)));
  const { data: last } = await db.from("website_versions").select("version").eq("website_id", args.websiteId).order("version", { ascending: false }).limit(1).maybeSingle();
  const { data: v, error } = await db
    .from("website_versions")
    .insert({ organisation_id: args.organisationId, website_id: args.websiteId, version: (last?.version ?? 0) + 1, spec: args.spec, files, content_hash: "computed-by-db", generated_by: args.spec.generatedBy, change_note: args.note, created_by: args.actorId ?? null })
    .select("id")
    .single();
  if (error) throw error;

  // Changing the current version resets status (enforced by a DB trigger as well).
  const { error: uErr } = await db.from("generated_websites").update({ current_version_id: v.id, status: "generated" }).eq("id", args.websiteId).eq("organisation_id", args.organisationId);
  if (uErr) throw uErr;

  const report = await qaVersion(db, args.spec, files);
  const { error: qErr } = await db.from("quality_reports").insert({ organisation_id: args.organisationId, website_id: args.websiteId, version_id: v.id, passed: report.passed, checks: report.checks });
  if (qErr) throw qErr;

  // Template builds exist so the app can be tried without Claude. They can go to approval only
  // for fictional demo businesses; a real prospect's prototype must be built by Claude.
  const { data: biz } = await db.from("businesses").select("is_demo").eq("id", args.businessId).eq("organisation_id", args.organisationId).single();
  // A homepage draft is for agreeing the look; only the full site goes to approval.
  const approvable = report.passed && (args.spec.generatedBy !== "demo" || Boolean(biz?.is_demo)) && args.spec.scope !== "home";
  if (approvable) {
    const { error: sErr } = await db.from("generated_websites").update({ status: "awaiting_approval" }).eq("id", args.websiteId).eq("organisation_id", args.organisationId);
    if (sErr) throw sErr;
  }
  await db.from("businesses").update({ status: approvable ? "awaiting_deployment_approval" : "prototype_generated" }).eq("id", args.businessId).eq("organisation_id", args.organisationId)
    .in("status", ["new", "researching", "qualified", "not_qualified", "prototype_generated", "awaiting_deployment_approval", "deployed"]);
  await db.from("crm_activities").insert({
    organisation_id: args.organisationId, business_id: args.businessId, type: "prototype_version",
    summary: `${args.note} — quality checks ${report.passed ? "passed" : "failed"}${report.passed && !approvable ? (args.spec.scope === "home" ? " (homepage draft: build the rest of the site to send it for approval)" : " (demo build: not for approval)") : ""}`,
    data: { website_id: args.websiteId, version_id: v.id, passed: report.passed, approvable }, actor_id: args.actorId ?? null,
  });
  return { versionId: v.id, report, approvable };
}

/**
 * Run the quality checks again on the current version (for example after the checks were
 * improved). A passing site goes to approval; a site waiting for approval that now fails
 * goes back to "generated". Approved, rejected and changes-requested sites keep their status:
 * they need a new version.
 */
export async function recheckCurrentVersion(db: SupabaseClient, organisationId: string, websiteId: string, actorId: string | null): Promise<{ report: QaReport; approvable: boolean; status: string }> {
  const { data: site, error } = await db.from("generated_websites").select("id, status, business_id, current_version_id, businesses(is_demo)").eq("id", websiteId).eq("organisation_id", organisationId).single();
  if (error || !site?.current_version_id) throw new Error("This website has no version to check.");
  const { data: v, error: vErr } = await db.from("website_versions").select("id, spec, files").eq("id", site.current_version_id).single();
  if (vErr) throw vErr;
  const spec = v.spec as SiteSpec;
  const report = await qaVersion(db, spec, v.files as SiteFiles);
  const { error: qErr } = await db.from("quality_reports").insert({ organisation_id: organisationId, website_id: websiteId, version_id: v.id, passed: report.passed, checks: report.checks });
  if (qErr) throw qErr;
  const isDemo = Boolean((site.businesses as unknown as { is_demo: boolean } | null)?.is_demo);
  const approvable = report.passed && (spec.generatedBy !== "demo" || isDemo) && spec.scope !== "home";
  let status = site.status as string;
  if (approvable && ["generated", "quality_checked"].includes(status)) status = "awaiting_approval";
  else if (!approvable && status === "awaiting_approval") status = "generated";
  if (status !== site.status) {
    const { error: sErr } = await db.from("generated_websites").update({ status }).eq("id", websiteId).eq("organisation_id", organisationId);
    if (sErr) throw sErr;
  }
  await db.from("crm_activities").insert({
    organisation_id: organisationId, business_id: site.business_id, type: "prototype_rechecked",
    summary: `Quality checks run again — ${report.passed ? "passed" : "failed"}`,
    data: { website_id: websiteId, version_id: v.id, passed: report.passed }, actor_id: actorId,
  });
  return { report, approvable, status };
}

export async function generateWebsite(db: SupabaseClient, organisationId: string, businessId: string, opts: { actorId?: string | null; forceTemplate?: boolean } = {}) {
  const { business, org } = await loadContext(db, organisationId, businessId);
  const industry = industryById(business.industry_id);

  let { data: briefRow } = await db.from("design_briefs").select("id, brief").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!briefRow) {
    const r = await produceBrief(db, organisationId, businessId, opts.actorId, { forcePreset: opts.forceTemplate });
    ({ data: briefRow } = await db.from("design_briefs").select("id, brief").eq("id", r.briefId).single());
  }
  const brief = briefRow!.brief as DesignBrief;
  const language = business.language ?? COUNTRIES.find((c) => c.code === business.country_code)?.language ?? "en";

  const input: SiteGenInput = {
    business: { name: business.name, category: business.category, city: business.city, country_code: business.country_code, industryLabel: industry?.label ?? business.category ?? "local business", bookingRelevant: industry?.bookingRelevant ?? false },
    language,
    brief,
    existingSiteText: null,
  };
  const { data: audit } = await db.from("website_audits").select("observed").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  input.existingSiteText = (audit?.observed as { textExcerpt?: string } | null)?.textExcerpt ?? null;

  const useAi = aiAvailable() && !opts.forceTemplate;
  const generatedBy: SiteSpec["generatedBy"] = useAi ? "ai" : "demo";
  const content = useAi ? (await runSiteAgent({ db, organisationId, input })).output : demoContent(business.name, business.city, industry, brief);

  // Ensure required pages exist even if the model omitted one.
  if (!content.pages.some((p) => p.slug === "index")) throw new Error("Generated site has no home page");
  if (!content.pages.some((p) => p.slug === "contact")) {
    content.pages.push({ slug: "contact", nav_label: "Contact", title: `Contact · ${business.name}`, meta_description: `Contact ${business.name}.`, sections: [{ type: "contact", heading: "Get in touch", text: "Send a message using the form." }] });
  }

  let { data: site } = await db.from("generated_websites").select("id, slug").eq("business_id", businessId).eq("organisation_id", organisationId).maybeSingle();
  if (!site) {
    const slug = `${slugify(business.name)}-${businessId.slice(0, 6)}`;
    const { data, error } = await db.from("generated_websites").insert({ organisation_id: organisationId, business_id: businessId, brief_id: briefRow!.id, slug, status: "draft" }).select("id, slug").single();
    if (error) throw error;
    site = data;
  }

  const spec: SiteSpec = {
    version: 1,
    content,
    theme: themeFromBrief(brief),
    business: {
      name: business.name, city: business.city, region: business.region, countryCode: business.country_code,
      phone: business.phone, email: business.email, address: business.address, language,
    },
    agency: { name: org.agency_name || org.name, website: org.agency_website, email: org.agency_reply_email },
    images: {},
    slug: site.slug,
    generatedBy,
    kind: "template",
  };
  spec.images = { ...(await resolveImages(db, organisationId, imageQueries(spec))), ...(await generatedImagesFor(db, organisationId, businessId)) };

  const result = await saveVersion(db, { organisationId, websiteId: site.id, businessId, spec, note: generatedBy === "ai" ? "Generated by AI" : "Generated from template (AI not configured)", actorId: opts.actorId });
  return { websiteId: site.id, ...result };
}

export async function regenerateSection(db: SupabaseClient, args: { organisationId: string; websiteId: string; pageSlug: string; sectionIndex: number; instruction: string; actorId?: string | null }) {
  const { data: site, error } = await db.from("generated_websites").select("id, business_id, current_version_id, website_versions!generated_websites_current_version_fk(spec)").eq("id", args.websiteId).eq("organisation_id", args.organisationId).single();
  if (error) throw error;
  const spec = structuredClone((site.website_versions as unknown as { spec: SiteSpec }).spec);
  if (!spec.content) throw new Error("This site was written by the builder: use Revise with an instruction instead.");
  const content = spec.content;
  if (!aiAvailable()) throw new Error("Section regeneration needs ANTHROPIC_API_KEY. Edit the text directly instead.");
  const { business } = await loadContext(db, args.organisationId, site.business_id);
  const { data: briefRow } = await db.from("design_briefs").select("brief").eq("business_id", site.business_id).order("created_at", { ascending: false }).limit(1).single();
  const industry = industryById(business.industry_id);
  const r = await runSectionAgent({
    db, organisationId: args.organisationId,
    input: { business: { name: business.name, category: business.category, city: business.city, country_code: business.country_code, industryLabel: industry?.label ?? "business", bookingRelevant: industry?.bookingRelevant ?? false }, language: spec.business.language, brief: briefRow!.brief as DesignBrief },
    current: content, pageSlug: args.pageSlug, sectionIndex: args.sectionIndex, instruction: args.instruction,
  });
  const page = content.pages.find((p) => p.slug === args.pageSlug)!;
  if (r.output.type !== page.sections[args.sectionIndex].type) throw new Error("AI changed the section type; try again.");
  page.sections[args.sectionIndex] = r.output;
  spec.images = await resolveImages(db, args.organisationId, imageQueries(spec), spec.images);
  return saveVersion(db, { organisationId: args.organisationId, websiteId: args.websiteId, businessId: site.business_id, spec, note: `Regenerated ${r.output.type} section on ${args.pageSlug}`, actorId: args.actorId });
}
