import { industryById } from "@/lib/industries";
import { ProviderError, type DiscoveredBusiness, type DiscoveryProvider } from "./types";

/**
 * Google Places API (New) Text Search.
 * Terms summary (check the current Google Maps Platform terms before production use):
 *  - place_id may be stored indefinitely;
 *  - other Places content may be cached for at most 30 days, then refreshed or deleted;
 *  - Google attribution must be shown where the data is displayed.
 * We therefore never store the raw payload, and mark address/phone/coordinates/website
 * as restricted so the retention sweep clears them after 30 days unless refreshed.
 * Google Places does not return email addresses.
 */
const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents",
  "places.location", "places.websiteUri", "places.internationalPhoneNumber", "places.primaryTypeDisplayName",
  "places.googleMapsUri", "places.businessStatus", "places.rating", "places.userRatingCount",
].join(",");

interface Place {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; types: string[] }[];
  location?: { latitude: number; longitude: number };
  websiteUri?: string;
  internationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text: string };
  googleMapsUri?: string;
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
}

export const googlePlacesProvider: DiscoveryProvider = {
  id: "google_places",
  label: "Google Places",
  description: "Strong coverage and website/phone data. Requires an API key; 30-day caching limit on most fields.",
  terms: {
    storeRaw: false,
    retentionDays: 30,
    restrictedFields: ["address", "phone", "latitude", "longitude", "website_url"],
    attribution: "Data from Google",
    licence: "Google Maps Platform Terms",
  },
  requires: "google_places",
  async search(q, credentials) {
    const apiKey = credentials?.apiKey;
    if (!apiKey) throw new ProviderError("google_places", "Google Places is not connected. Add a key in Integrations.");
    const industry = industryById(q.industryId);
    const results: DiscoveredBusiness[] = [];
    let pageToken: string | undefined;

    while (results.length < q.limit) {
      const body: Record<string, unknown> = {
        textQuery: `${q.businessType || industry?.query || q.industryId} in ${[q.city, q.region].filter(Boolean).join(", ")}`,
        regionCode: q.countryCode,
        languageCode: q.language ?? "en",
        pageSize: Math.min(20, q.limit - results.length),
      };
      if (industry?.googleType) body.includedType = industry.googleType;
      if (pageToken) body.pageToken = pageToken;

      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": `${FIELD_MASK},nextPageToken`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new ProviderError("google_places", `Search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { places?: Place[]; nextPageToken?: string };

      for (const p of json.places ?? []) {
        if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
        const comp = (t: string) => p.addressComponents?.find((c) => c.types.includes(t))?.longText ?? null;
        results.push({
          provider: "google_places",
          externalId: p.id,
          name: p.displayName?.text ?? "Unnamed",
          category: p.primaryTypeDisplayName?.text ?? industry?.label ?? null,
          countryCode: q.countryCode,
          region: comp("administrative_area_level_1") ?? q.region ?? null,
          city: comp("locality") ?? comp("postal_town") ?? q.city,
          address: p.formattedAddress ?? null,
          postalCode: comp("postal_code"),
          latitude: p.location?.latitude ?? null,
          longitude: p.location?.longitude ?? null,
          websiteUrl: p.websiteUri ?? null,
          email: null,
          phone: p.internationalPhoneNumber ?? null,
          contactPageUrl: null,
          sourceUrl: p.googleMapsUri ?? null,
          raw: null,
          isDemo: false,
          rating: p.rating ?? null,
          reviewsCount: p.userRatingCount ?? null,
        });
      }
      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
    return results.slice(0, q.limit);
  },
};
