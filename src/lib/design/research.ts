import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSecret } from "@/lib/integrations";
import { searchPins, boardPins } from "@/lib/providers/design/pinterest";
import { industryById } from "@/lib/industries";
import { aiAvailable } from "@/lib/ai/client";
import { runDesignAgent } from "@/lib/ai/agents/design-agent";
import { ensureAccessiblePalette, presetBrief, type DesignBrief } from "./brief";

export async function collectReferences(db: SupabaseClient, organisationId: string, business: { id: string; industry_id: string | null; country_code: string; sector: string | null }): Promise<{ added: number; note: string }> {
  const industry = industryById(business.industry_id);
  const creds = await getSecret(organisationId, "pinterest");
  if (!creds?.accessToken || !industry) return { added: 0, note: "Pinterest not connected: use manual references or the search links." };

  let pins: Awaited<ReturnType<typeof searchPins>> = [];
  let note = "";
  try {
    pins = await searchPins(creds.accessToken, `${industry.label} website design`, business.country_code, 8);
    note = "Pinterest partner search";
  } catch {
    try {
      pins = await boardPins(creds.accessToken, industry.label, 8);
      note = pins.length ? "Pinterest board pins" : `No Pinterest board matching "${industry.label}"`;
    } catch (e) {
      return { added: 0, note: `Pinterest unavailable: ${(e as Error).message}` };
    }
  }
  const { data: existing } = await db.from("design_references").select("url").eq("organisation_id", organisationId).eq("business_id", business.id);
  const have = new Set((existing ?? []).map((r) => r.url));
  const rows = pins.filter((p) => !have.has(p.link)).map((p) => ({
    organisation_id: organisationId,
    business_id: business.id,
    sector: business.sector,
    source: "pinterest",
    url: p.link,
    image_url: p.imageUrl,
    title: p.title,
    attribution: p.attribution,
    licence_note: "Reference only. Not reproduced; image remains hosted by Pinterest.",
  }));
  if (rows.length) {
    const { error } = await db.from("design_references").insert(rows);
    if (error) throw error;
  }
  return { added: rows.length, note };
}

export async function produceBrief(db: SupabaseClient, organisationId: string, businessId: string, actorId?: string | null): Promise<{ briefId: string; generatedBy: "ai" | "demo"; adjustments: string[] }> {
  const { data: b, error } = await db.from("businesses").select("id, name, category, city, country_code, opportunity_type, industry_id, sector").eq("id", businessId).eq("organisation_id", organisationId).single();
  if (error) throw error;

  await collectReferences(db, organisationId, b);

  const [{ data: refs }, { data: audit }] = await Promise.all([
    db.from("design_references").select("id, source, title, url, analysis").eq("organisation_id", organisationId).or(`business_id.eq.${businessId},and(business_id.is.null,sector.eq.${b.sector ?? "none"})`).limit(12),
    db.from("website_audits").select("problems, improvements, recommendations, audit_score").eq("business_id", businessId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const industryLabel = industryById(b.industry_id)?.label ?? b.category ?? "local business";
  let brief: DesignBrief;
  let generatedBy: "ai" | "demo";
  if (aiAvailable()) {
    const auditSummary = audit
      ? [`Current site score: ${audit.audit_score ?? "no site"}`, ...((audit.problems as { title: string; detail: string }[]) ?? []).slice(0, 8).map((p) => `- ${p.title}: ${p.detail}`)].join("\n")
      : "";
    const r = await runDesignAgent({
      db, organisationId, business: b, industryLabel, auditSummary,
      references: (refs ?? []).map((r) => ({ id: r.id, source: r.source, title: r.title, url: r.url, notes: (r.analysis as { notes?: string } | null)?.notes ?? null })),
    });
    brief = r.output;
    generatedBy = "ai";
  } else {
    brief = presetBrief(b.industry_id, b.name);
    generatedBy = "demo";
  }
  const fixed = ensureAccessiblePalette(brief);

  const { data: row, error: insErr } = await db
    .from("design_briefs")
    .insert({ organisation_id: organisationId, business_id: businessId, brief: { ...fixed.brief, accessibility_adjustments: fixed.adjustments }, generated_by: generatedBy })
    .select("id")
    .single();
  if (insErr) throw insErr;

  await db.from("crm_activities").insert({
    organisation_id: organisationId, business_id: businessId, type: "design_brief",
    summary: generatedBy === "ai" ? "Design brief created by AI" : "Design brief created from sector preset (AI not configured)",
    data: { brief_id: row.id, references: refs?.length ?? 0 }, actor_id: actorId ?? null,
  });
  return { briefId: row.id, generatedBy, adjustments: fixed.adjustments };
}
