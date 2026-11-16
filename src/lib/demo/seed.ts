import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { demoProvider } from "@/lib/providers/discovery/demo";
import { ingestDiscovered } from "@/lib/crm/ingest";
import { auditBusiness, type BusinessRow } from "@/lib/audit/run";
import { produceBrief } from "@/lib/design/research";
import { generateWebsite } from "@/lib/sites/builder";

const SEARCHES = [
  { countryCode: "GB", city: "Edinburgh", industryId: "restaurant" },
  { countryCode: "GB", city: "Manchester", industryId: "plumber" },
  { countryCode: "US", city: "Austin", industryId: "dentist" },
  { countryCode: "FR", city: "Lyon", industryId: "beauty_salon" },
  { countryCode: "AU", city: "Melbourne", industryId: "cafe" },
  { countryCode: "DE", city: "Hamburg", industryId: "gym" },
];

/**
 * Loads fictional demo data by running the real pipeline (search → de-duplicate →
 * audit → score → design brief → prototype → QA) over the demo provider.
 * Never uses AI credit, never fetches the internet, never deploys or emails.
 * Every record is flagged is_demo and named "[Demo] …".
 */
export async function seedDemoData(db: SupabaseClient, organisationId: string, actorId: string | null, opts: { prototypes?: number } = {}) {
  const created: string[] = [];
  for (const s of SEARCHES) {
    const found = await demoProvider.search({ ...s, limit: 8 }, null);
    const res = await ingestDiscovered(db, organisationId, found, demoProvider.terms, { industryId: s.industryId, actorId });
    created.push(...res.created);
  }

  // Spread discovery dates over the last five weeks so date filters have something to show.
  for (let i = 0; i < created.length; i++) {
    const daysAgo = (i * 7) % 35;
    await db.from("businesses").update({ discovered_at: new Date(Date.now() - daysAgo * 86400_000).toISOString() }).eq("id", created[i]);
  }

  const { data: rows } = await db
    .from("businesses")
    .select("id, organisation_id, name, category, sector, city, country_code, website_url, email, phone, contact_page_url, is_demo, industry_id")
    .eq("organisation_id", organisationId)
    .eq("is_demo", true)
    .is("lead_score", null);
  let qualified = 0;
  const qualifiedIds: string[] = [];
  for (const b of rows ?? []) {
    const r = await auditBusiness(db, b as BusinessRow, { threshold: 55, actorId });
    if (r.score.qualified) {
      qualified++;
      qualifiedIds.push(b.id);
    }
  }

  let briefs = 0;
  for (const id of qualifiedIds.slice(0, 10)) {
    await produceBrief(db, organisationId, id, actorId, { forcePreset: true });
    briefs++;
  }
  let prototypes = 0;
  let passed = 0;
  for (const id of qualifiedIds.slice(0, opts.prototypes ?? 3)) {
    const r = await generateWebsite(db, organisationId, id, { actorId, forceTemplate: true });
    prototypes++;
    if (r.report.passed) passed++;
  }
  return { businesses: created.length, audited: rows?.length ?? 0, qualified, briefs, prototypes, prototypesPassedQa: passed };
}

export async function clearDemoData(db: SupabaseClient, organisationId: string) {
  const { count, error } = await db.from("businesses").delete({ count: "exact" }).eq("organisation_id", organisationId).eq("is_demo", true);
  if (error) throw error;
  return count ?? 0;
}
