// Live check against the public OpenStreetMap services. Run with LIVE_OSM=1 (needs network access).
import { expect, it } from "vitest";
import { openStreetMapProvider } from "@/lib/providers/discovery/openstreetmap";

it.runIf(process.env.LIVE_OSM === "1")("finds real cafes in Edinburgh with verifiable sources", async () => {
  const rows = await openStreetMapProvider.search({ countryCode: "GB", city: "Edinburgh", industryId: "cafe", limit: 15, radiusKm: 2 }, null);
  expect(rows.length).toBeGreaterThan(5);
  for (const r of rows) {
    expect(r.isDemo).toBe(false);
    expect(r.sourceUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\/(node|way)\/\d+$/);
    expect(r.name.length).toBeGreaterThan(0);
  }
  const withSite = rows.filter((r) => r.websiteUrl).length;
  const withEmail = rows.filter((r) => r.email).length;
  console.log(`OSM: ${rows.length} cafes, ${withSite} with a website, ${withEmail} with a published email; e.g. ${rows.slice(0, 3).map((r) => r.name).join(", ")}`);
}, 60_000);
