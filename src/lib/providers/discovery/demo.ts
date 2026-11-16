import { industryById } from "@/lib/industries";
import type { DiscoveredBusiness, DiscoveryProvider } from "./types";

/**
 * Demo provider: clearly fictional sample businesses for trying the workflow
 * without any data provider configured.
 *  - Every record is flagged is_demo and named "[Demo] ...".
 *  - Websites use reserved .example domains and emails use the reserved
 *    .invalid TLD, so they can never reach a real business.
 *  - The sending service refuses demo records.
 */
const NAMES: Record<string, string[]> = {
  restaurant: ["Olive & Ash Kitchen", "The Copper Pot", "Saffron Table", "Harbourside Grill"],
  cafe: ["Morning Ritual Cafe", "Bean & Bloom", "The Reading Room Cafe", "Little Fern Coffee"],
  hotel: ["Seaview Guest House", "The Linden Hotel", "Old Mill Rooms", "Garden Court Hotel"],
  beauty_salon: ["Glow Studio", "Velvet Beauty Rooms", "Pure Skin Clinic", "The Nail Loft"],
  barbershop: ["Sharp & Co Barbers", "Fade Factory", "Old Town Barber", "Clipper Club"],
  dentist: ["Bright Smile Dental", "Parkside Dental Care", "Riverside Dentistry", "Pearl Dental Studio"],
  default: ["Northgate Services", "Brightwater Studio", "Cornerstone Partners", "Evergreen Works"],
};

// Deterministic variety so demo searches are repeatable.
const PATTERNS: { website: boolean; https: boolean; email: boolean }[] = [
  { website: false, https: false, email: true },
  { website: true, https: false, email: true },
  { website: true, https: true, email: true },
  { website: false, https: false, email: false },
];

export const demoProvider: DiscoveryProvider = {
  id: "demo",
  label: "Demo data (fictional)",
  description: "Fictional sample businesses for testing the workflow. Never contacts anyone.",
  terms: { storeRaw: true, retentionDays: null, restrictedFields: [], attribution: "Fictional demo data", licence: "demo" },
  async search(q) {
    const industry = industryById(q.industryId);
    const names = NAMES[q.industryId] ?? NAMES.default;
    const out: DiscoveredBusiness[] = [];
    const citySlug = q.city.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (let i = 0; i < Math.min(q.limit, 12); i++) {
      const base = names[i % names.length];
      const name = `[Demo] ${base}${i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ""}`;
      const slug = `${base.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${citySlug}-${i}`;
      const p = PATTERNS[i % PATTERNS.length];
      out.push({
        provider: "demo",
        externalId: `${q.countryCode}-${citySlug}-${q.industryId}-${i}`,
        name,
        category: industry?.label ?? q.industryId,
        countryCode: q.countryCode.toUpperCase(),
        region: q.region ?? null,
        city: q.city,
        address: null,
        postalCode: null,
        latitude: null,
        longitude: null,
        websiteUrl: p.website ? `${p.https ? "https" : "http"}://${slug}.example` : null,
        email: p.email ? `hello@${slug}.invalid` : null,
        phone: null,
        contactPageUrl: null,
        sourceUrl: null,
        raw: { demo: true, pattern: i % PATTERNS.length },
        isDemo: true,
      });
    }
    return out;
  },
};
