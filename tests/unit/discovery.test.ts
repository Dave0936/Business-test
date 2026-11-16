import { describe, expect, it } from "vitest";
import { findMatch, identityOf, isPlatformUrl, normalizeDomain, normalizeName, normalizePhone, type ExistingRecord } from "@/lib/crm/dedupe";
import { buildOverpassQuery, mapOverpassElement } from "@/lib/providers/discovery/openstreetmap";
import { demoProvider } from "@/lib/providers/discovery/demo";

describe("duplicate prevention", () => {
  it("normalises names across case, accents, punctuation and legal suffixes", () => {
    expect(normalizeName("Café Rouge Ltd.")).toBe(normalizeName("CAFE ROUGE"));
    expect(normalizeName("Smith & Sons Plumbing Limited")).toBe("smith and sons plumbing");
  });

  it("uses the registrable host and ignores social/listing pages", () => {
    expect(normalizeDomain("https://www.Example-Bakery.co.uk/menu")).toBe("example-bakery.co.uk");
    expect(normalizeDomain("example-bakery.co.uk")).toBe("example-bakery.co.uk");
    expect(normalizeDomain("https://facebook.com/somecafe")).toBeNull();
    expect(isPlatformUrl("https://www.instagram.com/x")).toBe(true);
  });

  it("normalises phones to E.164 per country", () => {
    expect(normalizePhone("0131 496 0000", "GB")).toBe("+441314960000");
    expect(normalizePhone("+44 (0)131 496 0000", "GB")).toBe("+441314960000");
    expect(normalizePhone("12", "GB")).toBeNull();
  });

  it("prefers domain, then phone, then name+place as the key", () => {
    expect(identityOf({ name: "A", countryCode: "GB", websiteUrl: "https://a.co.uk", phone: "0131 496 0000" }).dedupeKey).toBe("domain:a.co.uk");
    expect(identityOf({ name: "A", countryCode: "GB", phone: "0131 496 0000" }).dedupeKey).toBe("phone:+441314960000");
    expect(identityOf({ name: "A Cafe", countryCode: "gb", city: "Leith" }).dedupeKey).toBe("name:a cafe|gb|leith");
  });

  it("matches the same business found by two providers with different data", () => {
    const existing: ExistingRecord[] = [
      { id: "1", dedupe_key: "phone:+441314960000", website_domain: null, phone_e164: "+441314960000", normalized_name: "harbour cafe", country_code: "GB", city: "Leith" },
    ];
    // Second source adds a website, so its dedupe key differs, but the phone still matches.
    const second = identityOf({ name: "The Harbour Cafe", countryCode: "GB", city: "Leith", websiteUrl: "https://harbour.cafe", phone: "+44 131 496 0000" });
    expect(second.dedupeKey).toBe("domain:harbour.cafe");
    expect(findMatch({ ...second, countryCode: "GB", city: "Leith" }, existing)?.id).toBe("1");
    // Same name in another city is a different business.
    const other = identityOf({ name: "Harbour Cafe", countryCode: "GB", city: "Oban" });
    expect(findMatch({ ...other, countryCode: "GB", city: "Oban" }, existing)).toBeUndefined();
  });
});

describe("OpenStreetMap adapter", () => {
  it("builds a bounded Overpass query for every tag", () => {
    const q = buildOverpassQuery(["amenity=restaurant", "amenity=cafe"], 55.95, -3.19, 5000, 50);
    expect(q).toContain('node["amenity"="restaurant"]["name"](around:5000,55.95,-3.19);');
    expect(q).toContain('way["amenity"="cafe"]["name"](around:5000,55.95,-3.19);');
    expect(q).toMatch(/out center 150;$/);
  });

  it("maps only published contact details and records the source", () => {
    const b = mapOverpassElement(
      { type: "node", id: 42, lat: 55.9, lon: -3.2, tags: { name: "Harbour Cafe", "contact:email": "hi@harbour.cafe", phone: "0131 496 0000", "addr:street": "Shore", "addr:housenumber": "1", "addr:postcode": "EH6 6QW" } },
      { countryCode: "GB", city: "Edinburgh", industryId: "cafe", limit: 10 },
      "Cafes",
    )!;
    expect(b).toMatchObject({ provider: "openstreetmap", externalId: "node/42", name: "Harbour Cafe", email: "hi@harbour.cafe", websiteUrl: null, address: "1 Shore", sourceUrl: "https://www.openstreetmap.org/node/42", isDemo: false });
    expect(mapOverpassElement({ type: "node", id: 1, tags: {} }, { countryCode: "GB", city: "x", industryId: "cafe", limit: 1 }, "Cafes")).toBeNull();
  });
});

describe("demo provider", () => {
  it("is clearly fictional and uses reserved domains only", async () => {
    const rows = await demoProvider.search({ countryCode: "GB", city: "Leith", industryId: "cafe", limit: 12 }, null);
    expect(rows.length).toBe(12);
    for (const r of rows) {
      expect(r.isDemo).toBe(true);
      expect(r.name.startsWith("[Demo] ")).toBe(true);
      if (r.websiteUrl) expect(r.websiteUrl).toMatch(/\.example$/);
      if (r.email) expect(r.email).toMatch(/\.invalid$/);
      expect(r.phone).toBeNull();
    }
    // Deterministic: the same search yields the same external ids (no duplicates on re-run).
    const again = await demoProvider.search({ countryCode: "GB", city: "Leith", industryId: "cafe", limit: 12 }, null);
    expect(again.map((r) => r.externalId)).toEqual(rows.map((r) => r.externalId));
  });
});
