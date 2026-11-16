/** Industry catalogue shared by discovery, design research and site generation. */
export interface Industry {
  id: string;
  label: string;
  sector: "hospitality" | "food" | "beauty" | "healthcare" | "trades" | "automotive" | "property" | "fitness" | "professional" | "services" | "retail" | "other";
  /** OpenStreetMap tag filters, each "key=value" (OR-ed). */
  osm: string[];
  /** Google Places (New) includedType. */
  googleType?: string;
  /** Free-text query fallback. */
  query: string;
  bookingRelevant: boolean;
  /** Typical project value used only for clearly-labelled *estimated* opportunity value. */
  typicalProjectValue: number;
}

export const INDUSTRIES: Industry[] = [
  { id: "restaurant", label: "Restaurants", sector: "food", osm: ["amenity=restaurant"], googleType: "restaurant", query: "restaurant", bookingRelevant: true, typicalProjectValue: 2500 },
  { id: "cafe", label: "Cafes", sector: "food", osm: ["amenity=cafe"], googleType: "cafe", query: "cafe", bookingRelevant: false, typicalProjectValue: 1800 },
  { id: "hotel", label: "Hotels", sector: "hospitality", osm: ["tourism=hotel", "tourism=guest_house"], googleType: "lodging", query: "hotel", bookingRelevant: true, typicalProjectValue: 4500 },
  { id: "beauty_salon", label: "Beauty salons", sector: "beauty", osm: ["shop=beauty"], googleType: "beauty_salon", query: "beauty salon", bookingRelevant: true, typicalProjectValue: 2000 },
  { id: "barbershop", label: "Barbershops", sector: "beauty", osm: ["shop=hairdresser"], googleType: "barber_shop", query: "barbershop", bookingRelevant: true, typicalProjectValue: 1500 },
  { id: "dentist", label: "Dentists", sector: "healthcare", osm: ["amenity=dentist", "healthcare=dentist"], googleType: "dentist", query: "dentist", bookingRelevant: true, typicalProjectValue: 4000 },
  { id: "construction", label: "Construction", sector: "trades", osm: ["office=construction_company", "craft=builder"], googleType: "general_contractor", query: "construction company", bookingRelevant: false, typicalProjectValue: 3500 },
  { id: "plumber", label: "Plumbers", sector: "trades", osm: ["craft=plumber"], googleType: "plumber", query: "plumber", bookingRelevant: false, typicalProjectValue: 1800 },
  { id: "electrician", label: "Electricians", sector: "trades", osm: ["craft=electrician"], googleType: "electrician", query: "electrician", bookingRelevant: false, typicalProjectValue: 1800 },
  { id: "mechanic", label: "Mechanics", sector: "automotive", osm: ["shop=car_repair"], googleType: "car_repair", query: "car mechanic", bookingRelevant: true, typicalProjectValue: 2000 },
  { id: "estate_agent", label: "Estate agents", sector: "property", osm: ["office=estate_agent"], googleType: "real_estate_agency", query: "estate agent", bookingRelevant: false, typicalProjectValue: 5000 },
  { id: "gym", label: "Gyms", sector: "fitness", osm: ["leisure=fitness_centre"], googleType: "gym", query: "gym", bookingRelevant: true, typicalProjectValue: 3000 },
  { id: "cleaning", label: "Cleaning companies", sector: "services", osm: ["shop=dry_cleaning", "craft=cleaning"], query: "cleaning company", bookingRelevant: true, typicalProjectValue: 1500 },
  { id: "accountant", label: "Accountants", sector: "professional", osm: ["office=accountant"], googleType: "accounting", query: "accountant", bookingRelevant: true, typicalProjectValue: 3000 },
  { id: "solicitor", label: "Solicitors", sector: "professional", osm: ["office=lawyer"], googleType: "lawyer", query: "solicitor", bookingRelevant: true, typicalProjectValue: 4000 },
  { id: "consultant", label: "Consultants", sector: "professional", osm: ["office=consulting"], query: "consultant", bookingRelevant: true, typicalProjectValue: 3000 },
  { id: "retail", label: "Independent retail", sector: "retail", osm: ["shop=gift", "shop=clothes", "shop=florist"], googleType: "store", query: "independent shop", bookingRelevant: false, typicalProjectValue: 3500 },
  { id: "other_professional", label: "Other professional services", sector: "professional", osm: ["office=company"], query: "professional services", bookingRelevant: true, typicalProjectValue: 2500 },
];

export function industryById(id: string | null | undefined): Industry | undefined {
  return INDUSTRIES.find((i) => i.id === id);
}

export const OPPORTUNITY_TYPES = [
  { id: "no_website", label: "No website" },
  { id: "outdated_website", label: "Outdated website" },
  { id: "poor_mobile", label: "Poor mobile experience" },
  { id: "weak_functionality", label: "Weak website functionality" },
  { id: "poor_enquiry_booking", label: "Poor enquiry or booking" },
  { id: "unknown", label: "Not yet assessed" },
] as const;

export const LEAD_STATUSES = [
  "new", "researching", "qualified", "not_qualified", "prototype_generated",
  "awaiting_deployment_approval", "deployed", "awaiting_email_approval", "contacted",
  "replied", "interested", "meeting_requested", "converted", "not_interested", "suppressed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function humanise(s: string): string {
  return s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** ISO 3166-1 alpha-2 countries offered in search (any other code can be typed). */
export const COUNTRIES: { code: string; name: string; language: string }[] = [
  { code: "GB", name: "United Kingdom", language: "en" },
  { code: "IE", name: "Ireland", language: "en" },
  { code: "US", name: "United States", language: "en" },
  { code: "CA", name: "Canada", language: "en" },
  { code: "AU", name: "Australia", language: "en" },
  { code: "NZ", name: "New Zealand", language: "en" },
  { code: "FR", name: "France", language: "fr" },
  { code: "DE", name: "Germany", language: "de" },
  { code: "ES", name: "Spain", language: "es" },
  { code: "IT", name: "Italy", language: "it" },
  { code: "NL", name: "Netherlands", language: "nl" },
  { code: "PT", name: "Portugal", language: "pt" },
  { code: "AE", name: "United Arab Emirates", language: "en" },
  { code: "ZA", name: "South Africa", language: "en" },
  { code: "IN", name: "India", language: "en" },
  { code: "SG", name: "Singapore", language: "en" },
];
