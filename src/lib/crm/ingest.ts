import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findMatch, identityOf, isPlatformUrl, type ExistingRecord } from "./dedupe";
import type { DiscoveredBusiness, ProviderTerms } from "@/lib/providers/discovery/types";
import { industryById } from "@/lib/industries";

export interface IngestResult {
  created: string[];
  merged: string[];
  skipped: number;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/**
 * Save discovered businesses, merging with existing records instead of duplicating.
 * Existing values are never overwritten by a new source; missing values are filled in.
 * Every record keeps a business_sources row with attribution and retention terms.
 */
export async function ingestDiscovered(
  db: SupabaseClient,
  organisationId: string,
  records: DiscoveredBusiness[],
  terms: ProviderTerms,
  opts: { industryId?: string; actorId?: string | null } = {},
): Promise<IngestResult> {
  const result: IngestResult = { created: [], merged: [], skipped: 0 };
  const sector = industryById(opts.industryId)?.sector ?? null;

  for (const rec of records) {
    if (!rec.name?.trim() || !/^[A-Za-z]{2}$/.test(rec.countryCode)) {
      result.skipped++;
      continue;
    }
    const ownSite = rec.websiteUrl && !isPlatformUrl(rec.websiteUrl) ? normaliseUrl(rec.websiteUrl) : null;
    const id = identityOf({ name: rec.name, countryCode: rec.countryCode, city: rec.city, websiteUrl: ownSite, phone: rec.phone });
    const email = rec.email && EMAIL_RE.test(rec.email.trim()) ? rec.email.trim().toLowerCase() : null;

    // Candidates sharing any identifier.
    const q = (v: string) => `"${v.replace(/["\\]/g, "")}"`;
    const ors = [`dedupe_key.eq.${q(id.dedupeKey)}`, `normalized_name.eq.${q(id.normalizedName)}`];
    if (id.domain) ors.push(`website_domain.eq.${q(id.domain)}`);
    if (id.phoneE164) ors.push(`phone_e164.eq.${q(id.phoneE164)}`);
    const { data: candidates, error: findErr } = await db
      .from("businesses")
      .select("id, dedupe_key, website_domain, phone_e164, normalized_name, country_code, city, website_url, email, phone, address, contact_page_url, latitude, longitude, postal_code, region")
      .eq("organisation_id", organisationId)
      .or(ors.join(","));
    if (findErr) throw findErr;

    const match = findMatch({ ...id, countryCode: rec.countryCode, city: rec.city }, (candidates ?? []) as ExistingRecord[]) as
      | (ExistingRecord & Record<string, unknown>)
      | undefined;

    let businessId: string;
    if (match) {
      businessId = match.id;
      const patch: Record<string, unknown> = {};
      const fill = (col: string, val: unknown) => {
        if (val !== null && val !== undefined && val !== "" && (match[col] === null || match[col] === undefined)) patch[col] = val;
      };
      fill("website_url", ownSite);
      fill("website_domain", id.domain);
      fill("email", email);
      fill("phone", rec.phone);
      fill("phone_e164", id.phoneE164);
      fill("address", rec.address);
      fill("postal_code", rec.postalCode);
      fill("region", rec.region);
      fill("contact_page_url", rec.contactPageUrl);
      fill("latitude", rec.latitude);
      fill("longitude", rec.longitude);
      if (Object.keys(patch).length) {
        const { error } = await db.from("businesses").update(patch).eq("id", businessId).eq("organisation_id", organisationId);
        if (error) throw error;
      }
      result.merged.push(businessId);
    } else {
      const { data: inserted, error } = await db
        .from("businesses")
        .insert({
          organisation_id: organisationId,
          name: rec.name.trim(),
          normalized_name: id.normalizedName,
          category: rec.category,
          sector,
          industry_id: opts.industryId ?? null,
          country_code: rec.countryCode.toUpperCase(),
          region: rec.region,
          city: rec.city,
          address: rec.address,
          postal_code: rec.postalCode,
          latitude: rec.latitude,
          longitude: rec.longitude,
          website_url: ownSite,
          website_domain: id.domain,
          email,
          phone: rec.phone,
          phone_e164: id.phoneE164,
          contact_page_url: rec.contactPageUrl,
          opportunity_type: ownSite ? "unknown" : "no_website",
          dedupe_key: id.dedupeKey,
          is_demo: rec.isDemo,
        })
        .select("id")
        .single();
      if (error) {
        // Lost a race with a concurrent search: treat as merge.
        if (error.code === "23505") {
          result.skipped++;
          continue;
        }
        throw error;
      }
      businessId = inserted.id;
      result.created.push(businessId);
      await db.from("crm_activities").insert({
        organisation_id: organisationId,
        business_id: businessId,
        type: "discovered",
        summary: `Discovered via ${rec.provider}`,
        data: { provider: rec.provider, external_id: rec.externalId, source_url: rec.sourceUrl },
        actor_id: opts.actorId ?? null,
      });
    }

    const retention = terms.retentionDays ? new Date(Date.now() + terms.retentionDays * 86400_000).toISOString() : null;
    const { error: srcErr } = await db.from("business_sources").upsert(
      {
        organisation_id: organisationId,
        business_id: businessId,
        provider: rec.provider,
        external_id: rec.externalId,
        source_url: rec.sourceUrl,
        attribution: terms.attribution,
        licence: terms.licence,
        raw: terms.storeRaw ? rec.raw : null,
        retention_expires_at: retention,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "organisation_id,provider,external_id" },
    );
    if (srcErr) throw srcErr;
  }
  return result;
}

export function normaliseUrl(url: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
