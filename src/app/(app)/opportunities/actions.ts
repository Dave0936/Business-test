"use server";
import { redirect } from "next/navigation";
import Papa from "papaparse";
import { z } from "zod";
import { guarded, kickWorker, str, type ActionState } from "@/lib/actions";
import { startWorkflowRun, type WorkflowConfig } from "@/lib/jobs/worker";
import { getProvider } from "@/lib/providers/discovery";
import { ingestDiscovered } from "@/lib/crm/ingest";
import { writeAudit } from "@/lib/audit-log";
import { createServiceClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { DiscoveredBusiness } from "@/lib/providers/discovery/types";

const SearchSchema = z.object({
  provider: z.string().min(1),
  countryCode: z.string().regex(/^[A-Za-z]{2}$/, "Choose a country."),
  region: z.string().max(80).optional(),
  cities: z.string().min(1, "Enter at least one city.").max(500),
  industryIds: z.array(z.string()).min(1, "Choose at least one industry."),
  businessType: z.string().max(80).optional(),
  radiusKm: z.coerce.number().min(1).max(50).default(5),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  minScore: z.coerce.number().int().min(0).max(100).default(55),
  audit: z.boolean(), research: z.boolean(), generate: z.boolean(),
  prototypeLimit: z.coerce.number().int().min(0).max(100).default(5),
});

export async function runSearch(_p: ActionState, form: FormData): Promise<ActionState> {
  let runId: string | null = null;
  const state = await guarded("staff", async (ctx) => {
    const parsed = SearchSchema.safeParse({
      provider: str(form, "provider"), countryCode: str(form, "countryCode"), region: str(form, "region") || undefined,
      cities: str(form, "cities"), industryIds: form.getAll("industryIds").map(String), businessType: str(form, "businessType") || undefined,
      radiusKm: str(form, "radiusKm") || 5, limit: str(form, "limit") || 50, minScore: str(form, "minScore") || 55,
      audit: form.get("audit") === "on", research: form.get("research") === "on", generate: form.get("generate") === "on",
      prototypeLimit: str(form, "prototypeLimit") || 5,
    });
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const d = parsed.data;
    const provider = getProvider(d.provider);
    if (!provider?.available()) throw new Error(provider?.unavailableReason?.() ?? "That data provider is not available.");
    if (!env.supabaseServiceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to run background jobs.");
    const config: WorkflowConfig = {
      provider: d.provider,
      sectors: d.industryIds,
      locations: d.cities.split(/[\n,;]/).map((c) => c.trim()).filter(Boolean).slice(0, 20).map((city) => ({ countryCode: d.countryCode.toUpperCase(), city, region: d.region })),
      leadsPerSearch: d.limit,
      radiusKm: d.radiusKm,
      minScore: d.minScore,
      prototypeLimit: d.prototypeLimit,
      agents: { audit: d.audit, research: d.audit && d.research, generate: d.audit && d.research && d.generate, email: true },
    };
    // Jobs and runs are written with the service role (members can only read them).
    const admin = createServiceClient();
    runId = await startWorkflowRun(admin, ctx.organisationId, null, config, ctx.user.id);
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "discovery.started", entityType: "automation_run", entityId: runId, data: { config } });
    kickWorker();
  });
  if (runId) redirect(`/automation/runs/${runId}`);
  return state;
}

const CsvRow = z.object({
  name: z.string().min(1),
  country_code: z.string().regex(/^[A-Za-z]{2}$/),
  city: z.string().optional(),
  website: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  category: z.string().optional(),
  source_url: z.string().optional(),
});

/** Import a licensed list. The user attests to the licence; the source is recorded per row. */
export async function importCsv(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    if (form.get("attest") !== "on") throw new Error("Confirm you are licensed to use this data for outreach.");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file.");
    if (file.size > 2_000_000) throw new Error("CSV must be under 2 MB.");
    const licence = str(form, "licence") || "User-supplied licensed list";
    const industryId = str(form, "industryId") || undefined;
    const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
    const rows: DiscoveredBusiness[] = [];
    const errors: string[] = [];
    parsed.data.slice(0, 2000).forEach((r, i) => {
      const v = CsvRow.safeParse(r);
      if (!v.success) return void errors.push(`Row ${i + 2}: ${v.error.issues[0].path.join(".")} ${v.error.issues[0].message}`);
      rows.push({
        provider: "csv_import", externalId: `${file.name}:${i}:${v.data.name}`, name: v.data.name, category: v.data.category ?? null,
        countryCode: v.data.country_code.toUpperCase(), region: null, city: v.data.city ?? null, address: null, postalCode: null, latitude: null, longitude: null,
        websiteUrl: v.data.website || null, email: v.data.email || null, phone: v.data.phone || null, contactPageUrl: null, sourceUrl: v.data.source_url ?? null, raw: null, isDemo: false,
      });
    });
    const res = await ingestDiscovered(ctx.supabase, ctx.organisationId, rows, { storeRaw: false, retentionDays: null, restrictedFields: [], attribution: licence, licence }, { industryId, actorId: ctx.user.id });
    await writeAudit(ctx.supabase, { organisationId: ctx.organisationId, actorId: ctx.user.id, action: "discovery.csv_import", data: { file: file.name, licence, created: res.created.length, merged: res.merged.length, errors: errors.length } });
    return `Imported ${res.created.length} new, merged ${res.merged.length} duplicates${errors.length ? `, ${errors.length} rows rejected (${errors.slice(0, 2).join("; ")})` : ""}.`;
  }, "/leads");
}

export async function addManual(_p: ActionState, form: FormData): Promise<ActionState> {
  return guarded("staff", async (ctx) => {
    const name = str(form, "name");
    const country = str(form, "countryCode").toUpperCase();
    if (!name || !/^[A-Z]{2}$/.test(country)) throw new Error("Name and country are required.");
    const source = str(form, "sourceUrl");
    if (!source) throw new Error("Add where you found this business (a URL), so the record is verifiable.");
    const rec: DiscoveredBusiness = {
      provider: "manual", externalId: `${ctx.user.id}:${Date.now()}`, name, category: str(form, "category") || null, countryCode: country, region: null,
      city: str(form, "city") || null, address: null, postalCode: null, latitude: null, longitude: null, websiteUrl: str(form, "website") || null,
      email: str(form, "email") || null, phone: str(form, "phone") || null, contactPageUrl: null, sourceUrl: source, raw: null, isDemo: false,
    };
    const res = await ingestDiscovered(ctx.supabase, ctx.organisationId, [rec], { storeRaw: false, retentionDays: null, restrictedFields: [], attribution: `Added manually from ${source}`, licence: "manual" }, { industryId: str(form, "industryId") || undefined, actorId: ctx.user.id });
    if (res.created[0]) await ctx.supabase.from("businesses").update({ email_source: rec.email ? "manual" : "unknown" }).eq("id", res.created[0]);
    return res.created.length ? "Business added." : "That business already exists; details merged.";
  }, "/leads");
}
