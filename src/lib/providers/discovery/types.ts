export interface DiscoveryQuery {
  countryCode: string;
  region?: string;
  city: string;
  /** Town centre (from GeoNames) when known; providers that support coordinates use it. */
  lat?: number;
  lng?: number;
  /** Result pages for paid providers (SerpAPI: 20 per page, one credit each). */
  pages?: number;
  /** Skip chains and franchises (default true). */
  excludeChains?: boolean;
  industryId: string;
  businessType?: string;
  radiusKm?: number;
  limit: number;
  language?: string;
}

/** Data retention and attribution terms that travel with every record from a provider. */
export interface ProviderTerms {
  /** Whether the raw provider payload may be stored. */
  storeRaw: boolean;
  /** Days before provider-restricted fields must be refreshed or removed; null = no limit. */
  retentionDays: number | null;
  /** Fields that fall under the retention limit (cleared by the retention sweep). */
  restrictedFields: ("address" | "phone" | "latitude" | "longitude" | "website_url" | "email")[];
  attribution: string;
  licence: string;
}

export interface DiscoveredBusiness {
  provider: string;
  externalId: string;
  name: string;
  category: string | null;
  countryCode: string;
  region: string | null;
  city: string | null;
  address: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  websiteUrl: string | null;
  /** Only an address the source itself publishes. Never guessed. */
  email: string | null;
  phone: string | null;
  contactPageUrl: string | null;
  sourceUrl: string | null;
  raw: unknown;
  isDemo: boolean;
  rating?: number | null;
  reviewsCount?: number | null;
  openingHours?: Record<string, string> | null;
  isChain?: boolean;
}

export interface DiscoveryProvider {
  id: string;
  label: string;
  description: string;
  terms: ProviderTerms;
  /** Integration whose credentials this provider needs (organisation connection or platform env). */
  requires?: "google_places" | "serpapi";
  /** Rough cost note shown before running, if the provider is paid. */
  costNote?: (q: DiscoveryQuery) => string;
  search(q: DiscoveryQuery, credentials: Record<string, string> | null): Promise<DiscoveredBusiness[]>;
}

export class ProviderError extends Error {
  constructor(public provider: string, message: string) {
    super(`${provider}: ${message}`);
  }
}
