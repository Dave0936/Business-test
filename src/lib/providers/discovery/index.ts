import { demoProvider } from "./demo";
import { googlePlacesProvider } from "./google-places";
import { openStreetMapProvider } from "./openstreetmap";
import type { DiscoveryProvider } from "./types";

/**
 * Provider registry. To add a licensed directory or search API, implement
 * DiscoveryProvider (with honest ProviderTerms) and register it here.
 * CSV import of licensed lists is handled separately in lib/crm/import.ts.
 */
export const DISCOVERY_PROVIDERS: DiscoveryProvider[] = [openStreetMapProvider, googlePlacesProvider, demoProvider];

export function getProvider(id: string): DiscoveryProvider | undefined {
  return DISCOVERY_PROVIDERS.find((p) => p.id === id);
}

export * from "./types";
