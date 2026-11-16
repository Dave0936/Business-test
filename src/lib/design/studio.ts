import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSecret } from "@/lib/integrations";
import { boardPinsPage, searchPins, type PinRef } from "@/lib/providers/design/pinterest";
import { industryById, inferIndustryId } from "@/lib/industries";
import { aiAvailable } from "@/lib/ai/client";
import { runDesignAgent } from "@/lib/ai/agents/design-agent";
import { runJudgeAgent, runQuestionsAgent, type RefSummary } from "@/lib/ai/agents/studio-agents";
import { describeFetchError, safeFetch, assertSafeUrl } from "@/lib/security/safe-fetch";
import { extractSiteDesignFacts, type SiteDesignFacts } from "./site-facts";
import { sniffImage } from "./image-sniff";
import { DesignBriefSchema, ensureAccessiblePalette, presetBrief, type DesignBrief } from "./brief";
import {
  SITE_TYPES, applyAnswers, defaultSiteType, presetQuestions, reconcilePicks, rulePicks,
  type Pick, type SiteType, type StudioQuestion,
} from "./studio-rules";

export const UPLOAD_BUCKET = "site-assets";
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export interface Studio {
  id: string;
  organisation_id: string;
  business_id: string;
  idea: string | null;
  site_type: SiteType;
  round: number;
  picks: Pick[];
  picked_by: "ai" | "rules" | null;
  questions: StudioQuestion[];
  questions_by: "ai" | "preset" | null;
  pinterest_bookmark: string | null;
}

export interface StudioBusiness {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  country_code: string;
  opportunity_type: string | null;
  industry_id: string | null;
  sector: string | null;
}

export interface ReferenceRow {
  id: string;
  business_id: string | null;
  kind: string;
  source: string;
  verdict: "loved" | "rejected" | null;
  url: string;
  image_url: string | null;
  storage_path: string | null;
  title: string | null;
  attribution: string | null;
  analysis: { notes?: string; facts?: SiteDesignFacts; fetch_error?: string } | null;
  created_at: string;
}

const REF_COLUMNS = "id, business_id, kind, source, verdict, url, image_url, storage_path, title, attribution, analysis, created_at";

export async function loadBusiness(db: SupabaseClient, org: string, businessId: string): Promise<StudioBusiness> {
  const { data, error } = await db.from("businesses").select("id, name, category, city, country_code, opportunity_type, industry_id, sector").eq("id", businessId).eq("organisation_id", org).single();
  if (error) throw new Error("Business not found.");
  // Imported businesses often carry only a free-text category: infer the industry for presets.
  return { ...data, industry_id: data.industry_id ?? inferIndustryId(data.category) ?? null } as StudioBusiness;
}

export async function getOrCreateStudio(db: SupabaseClient, org: string, business: StudioBusiness, actorId: string | null): Promise<Studio> {
  const { data } = await db.from("design_studios").select("*").eq("business_id", business.id).eq("organisation_id", org).maybeSingle();
  if (data) return data as Studio;
  const industry = industryById(business.industry_id);
  const { data: created, error } = await db
    .from("design_studios")
    .upsert({ organisation_id: org, business_id: business.id, site_type: defaultSiteType(business.industry_id, industry?.sector ?? business.sector, business.category), created_by: actorId }, { onConflict: "business_id", ignoreDuplicates: false })
    .select("*")
    .single();
  if (error) throw error;
  return created as Studio;
}

export async function updateStudio(db: SupabaseClient, studio: Studio, patch: Partial<Omit<Studio, "id" | "organisation_id" | "business_id">>): Promise<Studio> {
  const { data, error } = await db.from("design_studios").update(patch).eq("id", studio.id).eq("organisation_id", studio.organisation_id).select("*").single();
  if (error) throw error;
  return data as Studio;
}

/** References for this business plus the team's sector-wide ones. */
export async function loadReferences(db: SupabaseClient, org: string, business: StudioBusiness): Promise<ReferenceRow[]> {
  const sectorKey = business.industry_id ?? business.sector ?? "none";
  const { data, error } = await db
    .from("design_references")
    .select(REF_COLUMNS)
    .eq("organisation_id", org)
    .or(`business_id.eq.${business.id},and(business_id.is.null,sector.in.(${[sectorKey, business.sector ?? "none"].map((s) => s.replace(/[^a-z0-9_]/gi, "")).join(",")}))`)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data ?? []) as ReferenceRow[];
}

// ---------------------------------------------------------------------------
// Collecting references
// ---------------------------------------------------------------------------

/**
 * Pinterest: the board the team assigned to this sector (one page per call, continuing where
 * the last call stopped), else partner search if the token has that access. Pins are stored
 * as links with Pinterest's own thumbnail URL; images are never copied.
 */
export async function collectPins(db: SupabaseClient, org: string, business: StudioBusiness, studio: Studio, fetchImpl: typeof fetch = fetch): Promise<{ added: number; note: string; studio: Studio }> {
  const creds = await getSecret(db, org, "pinterest");
  if (!creds?.accessToken) return { added: 0, note: "Pinterest is not connected. Add sites or pictures instead, or connect Pinterest under Integrations.", studio };
  const industry = industryById(business.industry_id);
  const sector = industry?.sector ?? business.sector ?? "";
  const { data: link } = await db.from("pinterest_board_links").select("board_id, board_name").eq("organisation_id", org).eq("sector", sector).maybeSingle();

  let pins: PinRef[] = [];
  let note: string;
  let bookmark = studio.pinterest_bookmark;
  try {
    if (link) {
      const page = await boardPinsPage(creds.accessToken, link.board_id, { limit: 12, bookmark }, fetchImpl);
      pins = page.pins;
      bookmark = page.bookmark;
      note = `From your Pinterest board “${link.board_name}”${page.bookmark ? "" : " (end of board)"}.`;
    } else {
      pins = await searchPins(creds.accessToken, `${industry?.label ?? business.category ?? "small business"} website design`, business.country_code, 12);
      note = "From Pinterest search.";
    }
  } catch (e) {
    const msg = (e as Error).message;
    return { added: 0, note: link ? `Pinterest error: ${msg}` : `No Pinterest board is assigned to this sector, and search is not available to this token (${msg}). Assign a board on the Design Research page.`, studio };
  }

  const rows = pins.map((p) => ({
    organisation_id: org, business_id: business.id, sector: business.industry_id, source: "pinterest", kind: "pin",
    url: p.link, image_url: safeImageUrl(p.imageUrl), title: p.title, attribution: p.attribution, external_id: p.id,
    licence_note: "Reference only. Not reproduced; the image stays hosted by Pinterest.",
  }));
  let added = 0;
  if (rows.length) {
    const { data, error } = await db.from("design_references").upsert(rows, { onConflict: "organisation_id,business_id,url", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    added = data?.length ?? 0;
  }
  const next = bookmark !== studio.pinterest_bookmark ? await updateStudio(db, studio, { pinterest_bookmark: bookmark }) : studio;
  return { added, note, studio: next };
}

function safeImageUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = assertSafeUrl(u);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A website the designer likes: stored as a link, with observed fonts, colours and preview image. */
export async function addSiteReference(db: SupabaseClient, org: string, businessId: string, rawUrl: string, notes: string | null, actorId: string): Promise<{ note: string }> {
  const url = assertSafeUrl(rawUrl).toString();
  let facts: SiteDesignFacts | null = null;
  let fetchError: string | null = null;
  try {
    const res = await safeFetch(url, { timeoutMs: 12_000, maxBytes: 2_000_000 });
    if (res.status < 400 && (res.headers["content-type"] ?? "text/html").includes("html")) facts = extractSiteDesignFacts(res.body, res.url);
    else fetchError = `The site answered HTTP ${res.status}.`;
  } catch (e) {
    fetchError = describeFetchError(e);
  }
  const host = new URL(url).hostname.replace(/^www\./, "");
  const { error } = await db.from("design_references").insert({
    organisation_id: org, business_id: businessId, source: /dribbble|behance|awwwards|land-book|siteinspire/i.test(host) ? "gallery" : "manual", kind: "site",
    url, image_url: safeImageUrl(facts?.previewImage), title: facts?.title?.slice(0, 200) ?? host, attribution: host,
    licence_note: "Reference only. Do not reproduce layouts, imagery, logos or wording.",
    analysis: { notes: notes ?? undefined, facts: facts ?? undefined, fetch_error: fetchError ?? undefined }, created_by: actorId,
  });
  if (error) {
    if (error.code === "23505") throw new Error("That site is already in this studio.");
    throw error;
  }
  return { note: facts ? `Added ${host}: ${facts.fonts.length} fonts and ${facts.colours.length} colours observed.` : `Added ${host} as a link. Its design could not be read (${fetchError}).` };
}

/** The designer's own picture (a sketch, a photo of the shop, a screenshot they have rights to). */
export async function addUploadReference(db: SupabaseClient, org: string, businessId: string, file: File, notes: string | null, actorId: string): Promise<{ note: string }> {
  if (!file || file.size === 0) throw new Error("Choose an image to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Images must be 2 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new Error("Only PNG, JPEG and WebP images can be uploaded.");
  const path = `${org}/design/${businessId}/${crypto.randomUUID()}.${kind.ext}`;
  const { error: upErr } = await db.storage.from(UPLOAD_BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  const title = (file.name || "Uploaded picture").replace(/[^\w .()-]/g, "").slice(0, 120);
  const { error } = await db.from("design_references").insert({
    organisation_id: org, business_id: businessId, source: "manual", kind: "upload", url: `storage://${UPLOAD_BUCKET}/${path}`, storage_path: path,
    title, attribution: "Uploaded by your team", licence_note: "Uploaded by the team, who confirmed they may use it as a reference.",
    analysis: notes ? { notes } : null, created_by: actorId,
  });
  if (error) {
    await db.storage.from(UPLOAD_BUCKET).remove([path]);
    throw error;
  }
  return { note: "Picture added." };
}

/** Short-lived links for uploaded pictures (the bucket is private). */
export async function signedUploadUrls(db: SupabaseClient, refs: ReferenceRow[]): Promise<Record<string, string>> {
  const paths = refs.filter((r) => r.storage_path).map((r) => r.storage_path!) ;
  if (!paths.length) return {};
  const { data } = await db.storage.from(UPLOAD_BUCKET).createSignedUrls(paths, 3600);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

export async function setVerdict(db: SupabaseClient, org: string, referenceId: string, verdict: "loved" | "rejected" | null): Promise<void> {
  const { error, count } = await db.from("design_references").update({ verdict }, { count: "exact" }).eq("id", referenceId).eq("organisation_id", org);
  if (error) throw error;
  if (!count) throw new Error("Reference not found.");
}

// ---------------------------------------------------------------------------
// Picks and questions
// ---------------------------------------------------------------------------

function summarise(r: ReferenceRow): RefSummary {
  return {
    id: r.id, kind: r.kind, source: r.source, verdict: r.verdict, title: r.title, url: r.storage_path ? "(uploaded picture)" : r.url, notes: r.analysis?.notes ?? null,
    facts: r.analysis?.facts ? { fonts: r.analysis.facts.fonts, colours: r.analysis.facts.colours, usesSerifHeadings: r.analysis.facts.usesSerifHeadings, description: r.analysis.facts.description } : null,
  };
}

export async function pickReferences(db: SupabaseClient, org: string, business: StudioBusiness, studio: Studio, opts: { newRound?: boolean } = {}): Promise<{ studio: Studio; note: string }> {
  const refs = await loadReferences(db, org, business);
  const usable = refs.filter((r) => r.verdict !== "rejected");
  if (!usable.length) throw new Error("Add or collect some references first (none, or all rejected).");
  const sections = SITE_TYPES[studio.site_type].sections;
  const previous = opts.newRound ? studio.picks : [];
  const forRules = refs.map((r) => ({ id: r.id, kind: r.kind, verdict: r.verdict, created_at: r.created_at }));

  let picks: Pick[];
  let pickedBy: "ai" | "rules";
  let note: string;
  if (aiAvailable()) {
    const industryLabel = industryById(business.industry_id)?.label ?? business.category ?? "local business";
    const pool = opts.newRound ? [...usable].sort((a, b) => Number(previous.some((p) => p.reference_id === a.id)) - Number(previous.some((p) => p.reference_id === b.id))) : usable;
    const r = await runJudgeAgent({ db, organisationId: org, business: { name: business.name, industryLabel, city: business.city }, idea: studio.idea, siteTypeLabel: SITE_TYPES[studio.site_type].label, sections, refs: pool.slice(0, 40).map(summarise) });
    const rec = reconcilePicks(r.output.picks, forRules, sections, previous);
    picks = rec.picks;
    pickedBy = "ai";
    note = `Claude picked ${picks.length} references${rec.dropped ? ` (${rec.dropped} invalid suggestions replaced by rules)` : ""}.`;
  } else {
    picks = rulePicks(forRules, sections, previous);
    pickedBy = "rules";
    note = `Picked ${picks.length} references by simple rules (Claude is not connected): loved first, then your own pictures and sites, newest first.`;
  }
  const next = await updateStudio(db, studio, { picks, picked_by: pickedBy, round: opts.newRound ? studio.round + 1 : studio.round, questions: [], questions_by: null });
  return { studio: next, note };
}

export async function prepareQuestions(db: SupabaseClient, org: string, business: StudioBusiness, studio: Studio): Promise<{ studio: Studio; note: string }> {
  const industry = industryById(business.industry_id);
  const preset = presetBrief(business.industry_id, business.name);
  if (aiAvailable() && studio.picks.length) {
    const refs = await loadReferences(db, org, business);
    const byId = new Map(refs.map((r) => [r.id, r]));
    const picks = studio.picks.filter((p) => byId.has(p.reference_id)).map((p) => ({ section: p.section, reason: p.reason, ref: summarise(byId.get(p.reference_id)!) }));
    const r = await runQuestionsAgent({ db, organisationId: org, business: { name: business.name, industryLabel: industry?.label ?? "local business" }, siteTypeLabel: SITE_TYPES[studio.site_type].label, picks });
    const seen = new Set<string>();
    const questions = r.output.questions.filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true))).map((q) => ({ ...q, answer: null }));
    return { studio: await updateStudio(db, studio, { questions, questions_by: "ai" }), note: `Claude wrote ${questions.length} questions about your picks.` };
  }
  const questions = presetQuestions(preset.ctas.map((c) => c.label)).map((q) => ({ ...q, answer: null }));
  return { studio: await updateStudio(db, studio, { questions, questions_by: "preset" }), note: "Standard questions (Claude is not connected)." };
}

export async function saveAnswers(db: SupabaseClient, studio: Studio, answers: Record<string, string>): Promise<Studio> {
  const questions = studio.questions.map((q) => {
    const a = answers[q.id];
    if (a === undefined) return q;
    const trimmed = a.trim().slice(0, 200);
    return { ...q, answer: trimmed || null };
  });
  return updateStudio(db, studio, { questions });
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export async function produceStudioBrief(db: SupabaseClient, org: string, business: StudioBusiness, studio: Studio, actorId: string | null, opts: { forcePreset?: boolean } = {}): Promise<{ briefId: string; generatedBy: "ai" | "demo"; adjustments: string[]; applied: string[] }> {
  const industry = industryById(business.industry_id);
  const refs = await loadReferences(db, org, business);
  const byId = new Map(refs.map((r) => [r.id, r]));
  const loved = refs.filter((r) => r.verdict === "loved");
  const lovedColours = loved.flatMap((r) => r.analysis?.facts?.colours ?? []);
  const answered = studio.questions.filter((q) => q.answer);

  const { data: audit } = await db.from("website_audits").select("problems, audit_score").eq("business_id", business.id).eq("organisation_id", org).order("created_at", { ascending: false }).limit(1).maybeSingle();

  let brief: DesignBrief;
  let generatedBy: "ai" | "demo";
  if (aiAvailable() && !opts.forcePreset) {
    const auditSummary = audit ? [`Current site score: ${audit.audit_score ?? "no site"}`, ...((audit.problems as { title: string; detail: string }[]) ?? []).slice(0, 8).map((p) => `- ${p.title}: ${p.detail}`)].join("\n") : "";
    const chosen = studio.picks.map((p) => byId.get(p.reference_id)).filter(Boolean) as ReferenceRow[];
    const pool = [...new Map([...chosen, ...loved, ...refs.filter((r) => r.verdict !== "rejected")].map((r) => [r.id, r])).values()].slice(0, 12);
    const r = await runDesignAgent({
      db, organisationId: org,
      business: { name: business.name, category: business.category, city: business.city, country_code: business.country_code, opportunity_type: business.opportunity_type ?? "unknown" },
      industryLabel: industry?.label ?? business.category ?? "local business", auditSummary,
      references: pool.map((x) => ({ id: x.id, source: x.source, title: x.title, url: x.storage_path ? "(uploaded picture)" : x.url, notes: x.analysis?.notes ?? null })),
      studio: { idea: studio.idea, siteTypeLabel: SITE_TYPES[studio.site_type].label, picks: studio.picks, answers: answered.map((q) => ({ question: q.question, answer: q.answer! })), loved: loved.map((x) => x.id), rejected: refs.filter((x) => x.verdict === "rejected").map((x) => x.id) },
    });
    brief = r.output;
    generatedBy = "ai";
  } else {
    brief = presetBrief(business.industry_id, business.name);
    brief.references_used = studio.picks.map((p) => ({ reference_id: p.reference_id, takeaway: `${p.section}: ${p.reason}` }));
    brief.originality_note = "Built from a sector preset and your studio choices (Claude is not connected). Abstract qualities only; nothing copied from references.";
    generatedBy = "demo";
  }
  // Answers are the designer's decisions: enforce them on any brief.
  const withAnswers = applyAnswers(brief, answered, { siteType: studio.site_type, bookingRelevant: industry?.bookingRelevant ?? false, lovedColours, setStructure: generatedBy === "demo" });
  const fixed = ensureAccessiblePalette(withAnswers.brief);
  const { data: row, error } = await db
    .from("design_briefs")
    .insert({ organisation_id: org, business_id: business.id, studio_id: studio.id, brief: { ...fixed.brief, accessibility_adjustments: fixed.adjustments }, generated_by: generatedBy, created_by: actorId })
    .select("id")
    .single();
  if (error) throw error;
  await db.from("crm_activities").insert({
    organisation_id: org, business_id: business.id, type: "design_brief",
    summary: generatedBy === "ai" ? "Design brief created by AI from the design studio" : "Design brief created from sector preset and studio choices (AI not configured)",
    data: { brief_id: row.id, picks: studio.picks.length, answers: answered.length }, actor_id: actorId,
  });
  return { briefId: row.id, generatedBy, adjustments: fixed.adjustments, applied: withAnswers.applied };
}

/** A designer's edits are saved as a new version; the palette is checked for contrast. */
export async function saveEditedBrief(db: SupabaseClient, org: string, businessId: string, studioId: string | null, input: unknown, actorId: string): Promise<{ briefId: string; adjustments: string[] }> {
  const parsed = DesignBriefSchema.safeParse(input);
  if (!parsed.success) throw new Error(`The brief is not valid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const fixed = ensureAccessiblePalette(parsed.data);
  const { data, error } = await db
    .from("design_briefs")
    .insert({ organisation_id: org, business_id: businessId, studio_id: studioId, brief: { ...fixed.brief, accessibility_adjustments: fixed.adjustments }, generated_by: "manual", created_by: actorId })
    .select("id")
    .single();
  if (error) throw error;
  return { briefId: data.id, adjustments: fixed.adjustments };
}

/**
 * Hands-off path used by automation: open (or reuse) the studio, collect pins if Pinterest is
 * connected, pick, and write a brief with whatever answers exist. Nothing is sent anywhere.
 */
export async function autoBrief(db: SupabaseClient, org: string, businessId: string, actorId: string | null, opts: { forcePreset?: boolean } = {}) {
  const business = await loadBusiness(db, org, businessId);
  let studio = await getOrCreateStudio(db, org, business, actorId);
  const before = await loadReferences(db, org, business);
  if (before.length < 5) studio = (await collectPins(db, org, business, studio)).studio;
  const refs = await loadReferences(db, org, business);
  if (!studio.picks.length && refs.some((r) => r.verdict !== "rejected")) studio = (await pickReferences(db, org, business, studio)).studio;
  return produceStudioBrief(db, org, business, studio, actorId, opts);
}
