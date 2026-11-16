import { industryById } from "@/lib/industries";
import { ensureAccessiblePalette, presetBrief } from "@/lib/design/brief";
import { demoContent } from "@/lib/sites/demo-content";
import type { SiteSpec } from "@/lib/sites/spec";

export function demoSpec(overrides: Partial<SiteSpec["business"]> = {}, industryId = "restaurant"): SiteSpec {
  const brief = ensureAccessiblePalette(presetBrief(industryId, "Harbour Kitchen")).brief;
  const content = demoContent("Harbour Kitchen", "Leith", industryById(industryId), brief);
  return {
    version: 1,
    content,
    theme: { colors: brief.palette, fonts: { heading: brief.typography.heading, body: brief.typography.body }, radius: "medium", heroLayout: brief.hero_layout, density: "comfortable" },
    business: { name: "Harbour Kitchen", city: "Leith", region: null, countryCode: "GB", phone: "+44 131 496 0000", email: "hello@harbourkitchen.co.uk", address: "1 Shore", language: "en-GB", ...overrides },
    agency: { name: "Northlight Studio", website: "https://northlight.example.com", email: null },
    images: {},
    slug: "harbour-kitchen",
    generatedBy: "demo",
  };
}
