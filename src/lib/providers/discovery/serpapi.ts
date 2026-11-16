import { industryById } from "@/lib/industries";
import { normalizeDomain, normalizeName } from "@/lib/crm/dedupe";
import { ProviderError, type DiscoveredBusiness, type DiscoveryProvider, type DiscoveryQuery } from "./types";

/**
 * Google Maps results through SerpAPI (https://serpapi.com/google-maps-api).
 * Each page is 20 businesses and one SerpAPI search credit. Results are treated like
 * Google Places data: raw payloads are not stored and listing fields are refreshed or
 * cleared after 30 days by the retention sweep. Google Maps does not publish email
 * addresses; the website audit finds one on the business's own site where published.
 */
interface LocalResult {
  position?: number;
  title?: string;
  place_id?: string;
  data_id?: string;
  data_cid?: string;
  gps_coordinates?: { latitude: number; longitude: number };
  rating?: number;
  reviews?: number;
  type?: string;
  types?: string[];
  address?: string;
  phone?: string;
  website?: string;
  operating_hours?: Record<string, string>;
  unclaimed_listing?: boolean;
}

/** Well-known chains and franchises (lower-case, normalised). Extend as needed. */
const CHAINS = [
  "mcdonalds", "starbucks", "costa coffee", "costa", "greggs", "subway", "kfc", "burger king", "pret a manger", "pret", "nandos",
  "dominos", "dominos pizza", "pizza hut", "papa johns", "wetherspoon", "jd wetherspoon", "wagamama", "five guys", "caffe nero",
  "tim hortons", "dunkin", "dunkin donuts", "taco bell", "chipotle", "wendys", "premier inn", "travelodge", "holiday inn", "hilton",
  "marriott", "ibis", "novotel", "best western", "specsavers", "boots", "toni and guy", "supercuts", "great clips", "sport clips",
  "anytime fitness", "puregym", "the gym group", "snap fitness", "planet fitness", "f45", "f45 training", "orangetheory", "kwik fit",
  "halfords", "halfords autocentre", "national tyres", "midas", "jiffy lube", "foxtons", "purplebricks", "remax", "re max",
  "century 21", "keller williams", "coldwell banker", "mydentist", "bupa dental", "aspen dental", "hr block", "h and r block",
];
const CHAIN_SET = new Set(CHAINS);

export function looksLikeChain(name: string, all: LocalResult[]): boolean {
  const n = normalizeName(name).replace(/\b(restaurant|cafe|coffee|hotel|gym|dental|clinic)\b/g, "").trim();
  if (CHAIN_SET.has(normalizeName(name)) || CHAIN_SET.has(n)) return true;
  // The same brand appearing several times in one local search is a strong chain signal.
  const same = all.filter((r) => r.title && normalizeName(r.title) === normalizeName(name)).length;
  return same >= 3;
}

export function matchesKind(r: LocalResult, kindWords: string[] | undefined): boolean {
  if (!kindWords?.length) return true;
  const hay = [r.type, ...(r.types ?? [])].filter(Boolean).join(" ").toLowerCase();
  if (!hay) return true; // no type information: keep and let the audit decide
  return kindWords.some((w) => hay.includes(w));
}

export function mapLocalResult(r: LocalResult, q: DiscoveryQuery, category: string, all: LocalResult[]): DiscoveredBusiness | null {
  if (!r.title || !(r.place_id || r.data_id)) return null;
  const site = r.website && normalizeDomain(r.website) ? r.website : null;
  return {
    provider: "serpapi_google_maps",
    externalId: r.place_id ?? r.data_id!,
    name: r.title,
    category: r.type ?? category,
    countryCode: q.countryCode.toUpperCase(),
    region: q.region ?? null,
    city: q.city,
    address: r.address ?? null,
    postalCode: null,
    latitude: r.gps_coordinates?.latitude ?? null,
    longitude: r.gps_coordinates?.longitude ?? null,
    websiteUrl: site,
    email: null,
    phone: r.phone ?? null,
    contactPageUrl: null,
    sourceUrl: r.place_id ? `https://www.google.com/maps/place/?q=place_id:${r.place_id}` : null,
    raw: null,
    isDemo: false,
    rating: typeof r.rating === "number" ? r.rating : null,
    reviewsCount: typeof r.reviews === "number" ? r.reviews : null,
    openingHours: r.operating_hours ?? null,
    isChain: looksLikeChain(r.title, all),
  };
}

export function buildSerpApiUrl(q: DiscoveryQuery, apiKey: string, page: number): URL {
  const industry = industryById(q.industryId);
  const what = q.businessType || industry?.query || q.industryId;
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("q", q.lat !== undefined && q.lng !== undefined ? what : `${what} in ${[q.city, q.region].filter(Boolean).join(", ")}`);
  if (q.lat !== undefined && q.lng !== undefined) url.searchParams.set("ll", `@${q.lat},${q.lng},14z`);
  url.searchParams.set("hl", q.language ?? "en");
  url.searchParams.set("gl", q.countryCode.toLowerCase());
  url.searchParams.set("start", String(page * 20));
  url.searchParams.set("api_key", apiKey);
  return url;
}

export const serpApiProvider: DiscoveryProvider = {
  id: "serpapi",
  label: "Google Maps (SerpAPI)",
  description: "Google Maps listings with ratings, reviews and opening hours. Chains and other kinds of place are filtered out. Paid: one SerpAPI credit per 20 results.",
  terms: {
    storeRaw: false,
    retentionDays: 30,
    restrictedFields: ["address", "phone", "latitude", "longitude", "website_url"],
    attribution: "Google Maps data via SerpAPI",
    licence: "SerpAPI terms / Google Maps data",
  },
  requires: "serpapi",
  costNote: (q) => `${Math.max(1, Math.min(3, q.pages ?? 1))} SerpAPI search credit(s) per city and industry`,
  async search(q, credentials) {
    const apiKey = credentials?.apiKey;
    if (!apiKey) throw new ProviderError("serpapi", "SerpAPI is not connected. Add your key in Integrations.");
    const industry = industryById(q.industryId);
    const pages = Math.max(1, Math.min(3, q.pages ?? 1));
    const results: LocalResult[] = [];
    for (let page = 0; page < pages; page++) {
      const res = await fetch(buildSerpApiUrl(q, apiKey, page), { signal: AbortSignal.timeout(60_000) });
      const json = (await res.json().catch(() => ({}))) as { local_results?: LocalResult[]; error?: string };
      if (!res.ok || json.error) {
        if (page > 0 && /hasn't returned any results/i.test(json.error ?? "")) break;
        throw new ProviderError("serpapi", json.error ?? `HTTP ${res.status}`);
      }
      results.push(...(json.local_results ?? []));
      if ((json.local_results ?? []).length < 20) break;
    }
    const mapped = results
      .filter((r) => matchesKind(r, industry?.kindWords))
      .map((r) => mapLocalResult(r, q, industry?.label ?? "", results))
      .filter((b): b is DiscoveredBusiness => b !== null);
    return (q.excludeChains === false ? mapped : mapped.filter((b) => !b.isChain)).slice(0, q.limit);
  },
};
