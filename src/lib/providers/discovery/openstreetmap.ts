import { env } from "@/lib/env";
import { industryById } from "@/lib/industries";
import { ProviderError, type DiscoveredBusiness, type DiscoveryProvider, type DiscoveryQuery } from "./types";

/**
 * OpenStreetMap via Nominatim (geocoding) + Overpass (POI search).
 * Data © OpenStreetMap contributors, ODbL 1.0 — storage permitted with attribution.
 * Usage policy: identify the app in the User-Agent, keep request volume low.
 */
// OSM policy: identify the application and give a way to contact the operator.
const UA = () => `WebOpportunityAI/1.0 (${env.osmContactEmail ? `contact: ${env.osmContactEmail}` : `+${env.appUrl}`})`;

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export function buildOverpassQuery(tags: string[], lat: number, lon: number, radiusM: number, limit: number): string {
  const parts = tags.flatMap((t) => {
    const [k, v] = t.split("=");
    const sel = `["${k}"="${v}"]["name"]`;
    return [`node${sel}(around:${radiusM},${lat},${lon});`, `way${sel}(around:${radiusM},${lat},${lon});`];
  });
  return `[out:json][timeout:25];(${parts.join("")});out center ${Math.min(limit * 3, 300)};`;
}

export function mapOverpassElement(el: OverpassElement, q: DiscoveryQuery, category: string): DiscoveredBusiness | null {
  const t = el.tags ?? {};
  if (!t.name) return null;
  const website = t.website ?? t["contact:website"] ?? t.url ?? null;
  const email = t.email ?? t["contact:email"] ?? null;
  const phone = t.phone ?? t["contact:phone"] ?? null;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  return {
    provider: "openstreetmap",
    externalId: `${el.type}/${el.id}`,
    name: t.name,
    category,
    countryCode: (t["addr:country"] ?? q.countryCode).toUpperCase().slice(0, 2),
    region: q.region ?? null,
    city: t["addr:city"] ?? q.city,
    address: street || null,
    postalCode: t["addr:postcode"] ?? null,
    latitude: el.lat ?? el.center?.lat ?? null,
    longitude: el.lon ?? el.center?.lon ?? null,
    websiteUrl: website,
    email,
    phone,
    contactPageUrl: t["contact:webform"] ?? null,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    raw: { type: el.type, id: el.id, tags: t },
    isDemo: false,
  };
}

/** Public Overpass instances, tried in order; the configured endpoint comes first. */
export function overpassEndpoints(): string[] {
  return [...new Set([env.overpassEndpoint, "https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"].filter(Boolean) as string[])];
}

const PER_SERVER_TIMEOUT_MS = 20_000;
export const OSM_UNREACHABLE = "The free OpenStreetMap servers did not answer from this site.";

/** Plain description of one server's failure. */
function describeOverpassFailure(host: string, e: unknown, status?: number): string {
  if (status === 429) return `${host} is rate-limiting requests`;
  if (status === 504 || status === 503) return `${host} is overloaded`;
  if (status) return `${host} answered HTTP ${status}`;
  const err = e as Error;
  if (err?.name === "TimeoutError" || /aborted|timeout/i.test(err?.message ?? "")) return `${host} did not answer within ${PER_SERVER_TIMEOUT_MS / 1000} seconds`;
  return `${host}: ${err?.message ?? "request failed"}`;
}

export async function overpass(query: string, f: typeof fetch = fetch): Promise<{ elements: OverpassElement[]; endpoint: string }> {
  const errors: string[] = [];
  for (const endpoint of overpassEndpoints()) {
    const host = new URL(endpoint).host;
    try {
      const res = await f(endpoint, {
        method: "POST",
        headers: { "user-agent": UA(), "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(PER_SERVER_TIMEOUT_MS),
      });
      if (res.ok) return { ...((await res.json()) as { elements: OverpassElement[] }), endpoint };
      errors.push(describeOverpassFailure(host, null, res.status));
    } catch (e) {
      errors.push(describeOverpassFailure(host, e));
    }
  }
  throw new ProviderError("openstreetmap", `${OSM_UNREACHABLE} Details: ${errors.join("; ")}. For dependable searches, connect SerpAPI.`);
}

/** Try each Overpass server with a tiny query and report how each one answers (Integrations page). */
export async function checkOverpassServers(f: typeof fetch = fetch): Promise<{ host: string; ok: boolean; ms: number; detail: string }[]> {
  const query = '[out:json][timeout:10];node["amenity"="cafe"](around:300,51.5074,-0.1278);out 1;';
  return Promise.all(overpassEndpoints().map(async (endpoint) => {
    const host = new URL(endpoint).host;
    const started = Date.now();
    try {
      const res = await f(endpoint, { method: "POST", headers: { "user-agent": UA(), "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(PER_SERVER_TIMEOUT_MS) });
      const ms = Date.now() - started;
      return res.ok ? { host, ok: true, ms, detail: `answered in ${(ms / 1000).toFixed(1)} s` } : { host, ok: false, ms, detail: describeOverpassFailure(host, null, res.status) };
    } catch (e) {
      return { host, ok: false, ms: Date.now() - started, detail: describeOverpassFailure(host, e) };
    }
  }));
}

export const openStreetMapProvider: DiscoveryProvider = {
  id: "openstreetmap",
  label: "OpenStreetMap",
  description: "Open data (ODbL). Free, worldwide, coverage varies by area. Contact details only where mappers recorded them.",
  terms: {
    storeRaw: true,
    retentionDays: null,
    restrictedFields: [],
    attribution: "© OpenStreetMap contributors",
    licence: "ODbL-1.0",
  },
  async search(q) {
    const industry = industryById(q.industryId);
    if (!industry) throw new ProviderError("openstreetmap", `Unknown industry ${q.industryId}`);

    let lat = q.lat;
    let lng = q.lng;
    if (lat === undefined || lng === undefined) {
    const geo = new URL(env.nominatimEndpoint);
    geo.searchParams.set("format", "jsonv2");
    geo.searchParams.set("limit", "1");
    geo.searchParams.set("countrycodes", q.countryCode.toLowerCase());
    geo.searchParams.set("q", [q.city, q.region].filter(Boolean).join(", "));
    const geoRes = await fetch(geo, { headers: { "user-agent": UA(), "accept-language": q.language ?? "en" } });
    if (!geoRes.ok) throw new ProviderError("openstreetmap", `Geocoding failed (${geoRes.status})`);
    const places = (await geoRes.json()) as { lat: string; lon: string }[];
    if (!places[0]) throw new ProviderError("openstreetmap", `Could not find ${q.city} in ${q.countryCode}`);
    lat = Number(places[0].lat);
    lng = Number(places[0].lon);
    }

    const query = buildOverpassQuery(industry.osm, lat, lng, Math.round((q.radiusKm ?? 5) * 1000), q.limit);
    const json = await overpass(query);
    return json.elements
      .map((el) => mapOverpassElement(el, q, industry.label))
      .filter((b): b is DiscoveredBusiness => b !== null)
      .slice(0, q.limit);
  },
};
