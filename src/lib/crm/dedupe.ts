import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * Duplicate prevention. A business is identified, in order of reliability, by:
 *   1. its website's registrable domain,
 *   2. its phone number in E.164 form,
 *   3. normalised name + country + city.
 * The strongest available identifier becomes the dedupe_key (unique per organisation),
 * and findMatch() also checks the weaker identifiers so the same business found by two
 * providers with slightly different data still merges.
 */

const LEGAL_SUFFIXES = /\b(ltd|limited|llc|inc|plc|gmbh|sarl|sas|bv|srl|sl|pty|co|company|the)\b\.?/g;

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9Ѐ-ӿ؀-ۿ一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Hosts that are not the business's own site.
const PLATFORM_HOSTS = [
  "facebook.com", "instagram.com", "linktr.ee", "google.com", "goo.gl", "business.site",
  "tripadvisor.com", "yelp.com", "booking.com", "wa.me", "twitter.com", "x.com", "tiktok.com",
];

export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\d?\./, "");
    if (!host.includes(".")) return null;
    if (PLATFORM_HOSTS.some((p) => host === p || host.endsWith(`.${p}`))) return null;
    return host;
  } catch {
    return null;
  }
}

/** True when the URL is a social/listing page rather than the business's own website. */
export function isPlatformUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
    return PLATFORM_HOSTS.some((p) => host === p || host.endsWith(`.${p}`));
  } catch {
    return false;
  }
}

export function normalizePhone(phone: string | null | undefined, country: string): string | null {
  if (!phone) return null;
  const p = parsePhoneNumberFromString(phone, country.toUpperCase() as CountryCode);
  return p && p.isValid() ? p.number : null;
}

export interface IdentityInput {
  name: string;
  countryCode: string;
  city?: string | null;
  websiteUrl?: string | null;
  phone?: string | null;
}

export interface Identity {
  dedupeKey: string;
  normalizedName: string;
  domain: string | null;
  phoneE164: string | null;
}

export function identityOf(b: IdentityInput): Identity {
  const normalizedName = normalizeName(b.name);
  const domain = normalizeDomain(b.websiteUrl);
  const phoneE164 = normalizePhone(b.phone, b.countryCode);
  const place = `${b.countryCode.toLowerCase()}|${normalizeName(b.city ?? "")}`;
  const dedupeKey = domain ? `domain:${domain}` : phoneE164 ? `phone:${phoneE164}` : `name:${normalizedName}|${place}`;
  return { dedupeKey, normalizedName, domain, phoneE164 };
}

export interface ExistingRecord {
  id: string;
  dedupe_key: string;
  website_domain: string | null;
  phone_e164: string | null;
  normalized_name: string;
  country_code: string;
  city: string | null;
}

/** Find an existing record that is the same business. */
export function findMatch(candidate: Identity & { countryCode: string; city?: string | null }, existing: ExistingRecord[]): ExistingRecord | undefined {
  return existing.find(
    (e) =>
      e.dedupe_key === candidate.dedupeKey ||
      (candidate.domain && e.website_domain === candidate.domain) ||
      (candidate.phoneE164 && e.phone_e164 === candidate.phoneE164) ||
      (e.normalized_name === candidate.normalizedName &&
        e.country_code.toUpperCase() === candidate.countryCode.toUpperCase() &&
        normalizeName(e.city ?? "") === normalizeName(candidate.city ?? "")),
  );
}
