"use server";
import { z } from "zod";
import { after } from "next/server";
import { guarded, str, type ActionState } from "@/lib/actions";
import { writeAudit } from "@/lib/audit-log";
import { aiAvailable } from "@/lib/ai/client";
import {
  addSiteReference, addUploadReference, collectPins, discoverSites, getOrCreateStudio, loadBusiness, pickReferences,
  prepareQuestions, produceStudioBrief, saveAnswers, saveEditedBrief, setVerdict, updateStudio, writeCreativeBrief,
} from "@/lib/design/studio";
import { MAX_EXTRA_LANGUAGES, SITE_LANGUAGES, SITE_TYPE_IDS } from "@/lib/design/studio-rules";
import { FONT_CHOICES } from "@/lib/design/brief";

const Id = z.string().uuid();
const path = (id: string) => `/design-research/${id}`;

async function open(ctx: Parameters<Parameters<typeof guarded>[1]>[0], form: FormData) {
  const businessId = Id.parse(str(form, "businessId"));
  const business = await loadBusiness(ctx.supabase, ctx.organisationId, businessId);
  const studio = await getOrCreateStudio(ctx.supabase, ctx.organisationId, business, ctx.user.id);
  return { businessId, business, studio };
}

export async function saveStudioSetup(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { studio } = await open(ctx, form);
    const siteType = z.enum(SITE_TYPE_IDS as [string, ...string[]]).parse(str(form, "siteType"));
    const idea = str(form, "idea").slice(0, 600) || null;
    const languages = [...new Set(form.getAll("languages").map(String))].filter((l) => l in SITE_LANGUAGES);
    if (languages.length > MAX_EXTRA_LANGUAGES) throw new Error(`Choose up to ${MAX_EXTRA_LANGUAGES} extra languages.`);
    const typeChanged = siteType !== studio.site_type;
    // A new type means new sections, so earlier picks and questions no longer fit.
    await updateStudio(ctx.supabase, studio, { site_type: siteType as typeof studio.site_type, idea, languages, ...(typeChanged ? { picks: [], picked_by: null, questions: [], questions_by: null } : {}) });
    return typeChanged ? "Saved. The site type changed, so pick references again." : "Saved.";
  }, path(id));
}

export async function collectPinsAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { business, studio } = await open(ctx, form);
    const r = await collectPins(ctx.supabase, ctx.organisationId, business, studio);
    return r.added ? `Added ${r.added} pins. ${r.note}` : r.note;
  }, path(id));
}

export async function addSiteAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { businessId } = await open(ctx, form);
    const url = z.string().url().max(500).parse(str(form, "url"));
    const r = await addSiteReference(ctx.supabase, ctx.organisationId, businessId, url, str(form, "notes").slice(0, 600) || null, ctx.user.id);
    return r.note;
  }, path(id));
}

export async function uploadAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { businessId } = await open(ctx, form);
    if (form.get("rights") !== "on") throw new Error("Confirm you have the right to use this picture as a reference.");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose an image to upload.");
    const r = await addUploadReference(ctx.supabase, ctx.organisationId, businessId, file, str(form, "notes").slice(0, 600) || null, ctx.user.id);
    return r.note;
  }, path(id));
}

export async function verdictAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const verdict = z.enum(["loved", "rejected", "clear"]).parse(str(form, "verdict"));
    await setVerdict(ctx.supabase, ctx.organisationId, Id.parse(str(form, "referenceId")), verdict === "clear" ? null : verdict);
    return verdict === "loved" ? "Loved." : verdict === "rejected" ? "Rejected: it won't be picked." : "Cleared.";
  }, path(id));
}

export async function pickAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { business, studio } = await open(ctx, form);
    const r = await pickReferences(ctx.supabase, ctx.organisationId, business, studio, { newRound: form.get("round") === "new" });
    return r.note;
  }, path(id));
}

export async function questionsAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { business, studio } = await open(ctx, form);
    return (await prepareQuestions(ctx.supabase, ctx.organisationId, business, studio)).note;
  }, path(id));
}

export async function answersAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { studio } = await open(ctx, form);
    const answers: Record<string, string> = {};
    for (const q of studio.questions) {
      const v = str(form, `q_${q.id}`);
      const other = str(form, `q_${q.id}_other`);
      answers[q.id] = v === "__other" ? other : v;
    }
    await saveAnswers(ctx.supabase, studio, answers);
    return "Answers saved.";
  }, path(id));
}

export async function briefAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { business, studio } = await open(ctx, form);
    const r = await produceStudioBrief(ctx.supabase, ctx.organisationId, business, studio, ctx.user.id);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "design.brief_created", entityType: "design_brief", entityId: r.briefId, data: { business_id: business.id, generated_by: r.generatedBy } });
    const extra = [r.applied.length ? `Applied: ${r.applied.join(" ")}` : "", r.adjustments.length ? `Contrast fixes: ${r.adjustments.length}.` : ""].filter(Boolean).join(" ");
    return `${r.generatedBy === "ai" ? "Brief written by Claude." : "Brief built from the sector preset and your choices."} ${extra}`.trim();
  }, path(id));
}

const list = (v: string, max = 8) => v.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, max);
const font = z.enum(FONT_CHOICES);

export async function saveBriefAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { businessId, studio } = await open(ctx, form);
    const { data: last } = await ctx.supabase.from("design_briefs").select("brief").eq("business_id", businessId).eq("organisation_id", ctx.organisationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!last) throw new Error("Create a brief first, then edit it.");
    const prev = last.brief as Record<string, unknown>;
    const pages = list(str(form, "page_structure"), 10).map((line) => {
      const [page, rest = ""] = line.split(":");
      return { page: page.trim(), sections: rest.split(/→|->|,/).map((s) => s.trim()).filter(Boolean) };
    }).filter((p) => p.page && p.sections.length);
    const ctas = list(str(form, "ctas"), 4).map((label) => ({ label, purpose: "set by the designer" }));
    const next = {
      ...prev,
      positioning: str(form, "positioning"), audience: str(form, "audience"), visual_direction: str(form, "visual_direction"),
      mood_words: str(form, "mood_words").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6),
      palette: {
        primary: str(form, "c_primary"), secondary: str(form, "c_secondary"), accent: str(form, "c_accent"), background: str(form, "c_background"),
        surface: str(form, "c_surface"), text: str(form, "c_text"), muted: str(form, "c_muted"), rationale: str(form, "palette_rationale") || "Set by the designer.",
      },
      typography: { heading: font.parse(str(form, "font_heading")), body: font.parse(str(form, "font_body")), rationale: str(form, "type_rationale") || "Set by the designer." },
      hero_layout: str(form, "hero_layout"), hero_notes: str(form, "hero_notes"),
      page_structure: pages, ctas, image_style: str(form, "image_style"),
      image_queries: list(str(form, "image_queries"), 8), navigation: str(form, "navigation"),
      mobile_recommendations: list(str(form, "mobile_recommendations")), functionality: list(str(form, "functionality")),
    };
    delete (next as Record<string, unknown>).accessibility_adjustments;
    const r = await saveEditedBrief(ctx.supabase, ctx.organisationId, businessId, studio.id, next, ctx.user.id);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "design.brief_edited", entityType: "design_brief", entityId: r.briefId, data: { business_id: businessId } });
    return r.adjustments.length ? `Saved as a new version. Adjusted for contrast: ${r.adjustments.join(" ")}` : "Saved as a new version.";
  }, path(id));
}

export async function discoverSitesAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { business, studio } = await open(ctx, form);
    const r = await discoverSites(ctx.supabase, ctx.organisationId, business, studio, ctx.user.id);
    if (r.added) await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "design.sites_found_by_search", entityType: "business", entityId: business.id, data: { added: r.added } });
    return r.note;
  }, path(id));
}

/** The designer's own creative brief for this site: the main design direction for the builder. */
export async function saveCreativeBriefAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { studio } = await open(ctx, form);
    const text = String(form.get("creativeBrief") ?? "").replace(/\r\n/g, "\n").trim();
    if (text.length > 20000) throw new Error("Keep the creative brief under 20,000 characters.");
    const { error } = await ctx.supabase.from("design_studios").update({ creative_brief: text || null, creative_brief_by: text ? "person" : null, creative_brief_at: new Date().toISOString() }).eq("id", studio.id).eq("organisation_id", ctx.organisationId);
    if (error) throw error;
    if (text && aiAvailable()) {
      const fresh = await getOrCreateStudio(ctx.supabase, ctx.organisationId, await loadBusiness(ctx.supabase, ctx.organisationId, id), ctx.user.id);
      await produceStudioBrief(ctx.supabase, ctx.organisationId, await loadBusiness(ctx.supabase, ctx.organisationId, id), fresh, ctx.user.id);
    }
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "design.creative_brief_saved", entityType: "business", entityId: id, data: { length: text.length } });
    return text ? "Saved, and the structured brief now follows it. The next build uses it." : "Cleared.";
  }, path(id));
}

/** Claude looks at the loved references (the actual pictures) and writes the creative brief. */
export async function writeCreativeBriefAction(_p: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "businessId");
  return guarded("staff", async (ctx) => {
    const { business, studio } = await open(ctx, form);
    const r = await writeCreativeBrief(ctx.supabase, ctx.organisationId, business, studio, ctx.user.id);
    // Keep the structured brief in step with it (practical parts: audience, calls to action,
    // features), after the answer is sent so the creative brief shows straight away.
    after(async () => {
      try {
        await produceStudioBrief(ctx.supabase, ctx.organisationId, business, r.studio, ctx.user.id);
      } catch (e) {
        console.error("structured brief update failed", e);
      }
    });
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "design.creative_brief_written", entityType: "business", entityId: id, data: { pictures: r.pictures } });
    return r.pictures ? `Written (the structured brief is being updated to match) from ${r.pictures} reference picture${r.pictures === 1 ? "" : "s"}. Read it, edit anything, then build.` : "Written without reference pictures (none loved yet). Love some references and write it again for a brief led by them.";
  }, path(id));
}
