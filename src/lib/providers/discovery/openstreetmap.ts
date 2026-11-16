import { env } from "@/lib/env";
import { industryById } from "@/lib/industries";
import { ProviderError, type DiscoveredBusiness, type DiscoveryProvider, type DiscoveryQuery } from "./types";

/**
 * OpenStreetMap via Nominatim (geocoding) + Overpass (POI search).
 * Data © OpenStreetMap contributors, ODbL 1.0 — storage permitted with attribution.
 * Usage policy: identify the app in the User-Agent, keep request volume low.
 */
const UA = () => `WebOpportunityAI/1.0 (${env.osmContactEmail ?? "set OSM_CONTACT_EMAIL"})`;

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
  available: () => true,
  async search(q) {
    const industry = industryById(q.industryId);
    if (!industry) throw new ProviderError("openstreetmap", `Unknown industry ${q.industryId}`);

    const geo = new URL(env.nominatimEndpoint);
    geo.searchParams.set("format", "jsonv2");
    geo.searchParams.set("limit", "1");
    geo.searchParams.set("countrycodes", q.countryCode.toLowerCase());
    geo.searchParams.set("q", [q.city, q.region].filter(Boolean).join(", "));
    const geoRes = await fetch(geo, { headers: { "user-agent": UA(), "accept-language": q.language ?? "en" } });
    if (!geoRes.ok) throw new ProviderError("openstreetmap", `Geocoding failed (${geoRes.status})`);
    const places = (await geoRes.json()) as { lat: string; lon: string }[];
    if (!places[0]) throw new ProviderError("openstreetmap", `Could not find ${q.city} in ${q.countryCode}`);

    const query = buildOverpassQuery(industry.osm, Number(places[0].lat), Number(places[0].lon), Math.round((q.radiusKm ?? 5) * 1000), q.limit);
    const res = await fetch(env.overpassEndpoint, {
      method: "POST",
      headers: { "user-agent": UA(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
    });
    if (!res.ok) throw new ProviderError("openstreetmap", `Overpass query failed (${res.status})`);
    const json = (await res.json()) as { elements: OverpassElement[] };
    return json.elements
      .map((el) => mapOverpassElement(el, q, industry.label))
      .filter((b): b is DiscoveredBusiness => b !== null)
      .slice(0, q.limit);
  },
};
