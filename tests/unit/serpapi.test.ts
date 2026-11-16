import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSerpApiUrl, looksLikeChain, matchesKind, serpApiProvider } from "@/lib/providers/discovery/serpapi";

const sample = {
  local_results: [
    { position: 1, title: "The Little Bakehouse", place_id: "ChIJ1", type: "Cafe", types: ["Cafe", "Bakery"], rating: 4.7, reviews: 213, address: "12 High St, Leith", phone: "0131 496 0000", website: "https://littlebakehouse.co.uk/", operating_hours: { monday: "8am–4pm" }, gps_coordinates: { latitude: 55.97, longitude: -3.17 } },
    { position: 2, title: "Costa Coffee", place_id: "ChIJ2", type: "Coffee shop", rating: 4.0, reviews: 900 },
    { position: 3, title: "Leith Dental Practice", place_id: "ChIJ3", type: "Dentist" },
    { position: 4, title: "Harbour Cafe", place_id: "ChIJ4", type: "Cafe", website: "https://www.facebook.com/harbourcafe" },
    { position: 5, title: "Bean There", place_id: "ChIJ5", type: "Coffee shop" },
    { position: 6, title: "Bean There", place_id: "ChIJ6", type: "Coffee shop" },
    { position: 7, title: "Bean There", place_id: "ChIJ7", type: "Coffee shop" },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe("SerpAPI Google Maps adapter", () => {
  it("builds the request with coordinates, country and page offset", () => {
    const u = buildSerpApiUrl({ countryCode: "GB", city: "Edinburgh", industryId: "cafe", limit: 20, lat: 55.95, lng: -3.19 }, "KEY", 2);
    expect(u.origin + u.pathname).toBe("https://serpapi.com/search.json");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ engine: "google_maps", type: "search", q: "cafe", ll: "@55.95,-3.19,14z", gl: "gb", start: "40", api_key: "KEY" });
    const noCoords = buildSerpApiUrl({ countryCode: "FR", city: "Lyon", industryId: "dentist", limit: 20 }, "KEY", 0);
    expect(noCoords.searchParams.get("q")).toBe("dentist in Lyon");
  });

  it("detects chains by name and by repetition", () => {
    expect(looksLikeChain("Costa Coffee", [])).toBe(true);
    expect(looksLikeChain("STARBUCKS", [])).toBe(true);
    expect(looksLikeChain("Bean There", sample.local_results)).toBe(true);
    expect(looksLikeChain("The Little Bakehouse", sample.local_results)).toBe(false);
  });

  it("keeps only the requested kind of place", () => {
    expect(matchesKind({ type: "Cafe" }, ["cafe", "coffee"])).toBe(true);
    expect(matchesKind({ type: "Dentist" }, ["cafe", "coffee"])).toBe(false);
    expect(matchesKind({}, ["cafe"])).toBe(true);
  });

  it("maps listings, drops chains and other kinds, ignores social-media 'websites', and stores no raw data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(sample), { status: 200 }));
    const rows = await serpApiProvider.search({ countryCode: "GB", city: "Leith", industryId: "cafe", limit: 20, excludeChains: true }, { apiKey: "KEY" });
    expect(rows.map((r) => r.name)).toEqual(["The Little Bakehouse", "Harbour Cafe"]);
    const a = rows[0];
    expect(a).toMatchObject({ provider: "serpapi_google_maps", externalId: "ChIJ1", rating: 4.7, reviewsCount: 213, websiteUrl: "https://littlebakehouse.co.uk/", email: null, raw: null, isChain: false, openingHours: { monday: "8am–4pm" } });
    expect(rows[1].websiteUrl).toBeNull();
    const withChains = await serpApiProvider.search({ countryCode: "GB", city: "Leith", industryId: "cafe", limit: 20, excludeChains: false }, { apiKey: "KEY" });
    expect(withChains.filter((r) => r.isChain).length).toBe(4);
  });

  it("refuses to run without a key and reports API errors plainly", async () => {
    await expect(serpApiProvider.search({ countryCode: "GB", city: "Leith", industryId: "cafe", limit: 5 }, null)).rejects.toThrow(/not connected/);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Invalid API key." }), { status: 401 }));
    await expect(serpApiProvider.search({ countryCode: "GB", city: "Leith", industryId: "cafe", limit: 5 }, { apiKey: "bad" })).rejects.toThrow(/Invalid API key/);
  });

  it("states the credit cost", () => {
    expect(serpApiProvider.costNote!({ countryCode: "GB", city: "x", industryId: "cafe", limit: 5, pages: 3 })).toMatch(/^3 SerpAPI/);
  });
});
