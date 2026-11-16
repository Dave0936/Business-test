import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, platformCredential, type IntegrationKey } from "@/lib/env";
import { decryptSecret } from "@/lib/security/crypto";

export interface IntegrationInfo {
  key: IntegrationKey;
  name: string;
  purpose: string;
  envVars: string[];
  docs: string;
  /** What happens without it. */
  fallback: string;
  required: boolean;
}

export const INTEGRATIONS: IntegrationInfo[] = [
  { key: "anthropic", name: "Anthropic Claude", purpose: "Audit judgements, design briefs, website generation and email drafting.", envVars: ["ANTHROPIC_API_KEY"], docs: "https://platform.claude.com/", fallback: "Demo mode: deterministic templates, clearly labelled. No AI calls.", required: false },
  { key: "openstreetmap", name: "OpenStreetMap", purpose: "Free worldwide business discovery (ODbL).", envVars: ["OSM_CONTACT_EMAIL"], docs: "https://operations.osmfoundation.org/policies/nominatim/", fallback: "Always available; set a contact email per the usage policy.", required: false },
  { key: "google_places", name: "Google Places", purpose: "Business discovery with websites and phone numbers.", envVars: ["GOOGLE_PLACES_API_KEY"], docs: "https://developers.google.com/maps/documentation/places/web-service/text-search", fallback: "Provider hidden; use OpenStreetMap, CSV import or demo data.", required: false },
  { key: "serpapi", name: "SerpAPI (Google Maps)", purpose: "Find clients from Google Maps listings, with ratings, reviews and opening hours. Each page of 20 results uses one SerpAPI search credit.", envVars: ["SERPAPI_API_KEY"], docs: "https://serpapi.com/google-maps-api", fallback: "Provider hidden; use OpenStreetMap, Google Places, CSV import or demo data.", required: false },
  { key: "higgsfield", name: "Higgsfield", purpose: "AI photos and short videos for prototypes, with the cost shown before each run.", envVars: ["HIGGSFIELD_API_KEY_ID", "HIGGSFIELD_API_KEY_SECRET"], docs: "https://docs.higgsfield.ai/docs/authentication.md", fallback: "Prototypes use your own photos or none.", required: false },
  { key: "pinterest", name: "Pinterest", purpose: "Design references from your own Pinterest boards (a standard token works; public search needs approved access).", envVars: ["PINTEREST_ACCESS_TOKEN"], docs: "https://developers.pinterest.com/docs/api/v5/", fallback: "Manual reference submission and direct search links.", required: false },
  { key: "unsplash", name: "Unsplash", purpose: "Licensed stock photography for prototypes.", envVars: ["UNSPLASH_ACCESS_KEY"], docs: "https://unsplash.com/documentation", fallback: "Prototypes use original abstract artwork instead of photos.", required: false },
  { key: "cloudflare", name: "Cloudflare Pages", purpose: "Hosting approved prototypes.", envVars: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"], docs: "https://developers.cloudflare.com/pages/get-started/direct-upload/", fallback: "Deployment is unavailable. Nothing is reported as deployed.", required: false },
  { key: "resend", name: "Resend", purpose: "Sending approved emails and tracking delivery events.", envVars: ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"], docs: "https://resend.com/docs", fallback: "Sending is unavailable. Drafting and approval still work.", required: false },
];

export type IntegrationMode = "live" | "demo" | "off";

export async function integrationStatus(db: SupabaseClient, organisationId: string): Promise<Record<IntegrationKey, { mode: IntegrationMode; source: "platform" | "organisation" | null }>> {
  const { data } = await db.from("integration_connections").select("provider, status").eq("organisation_id", organisationId);
  const orgConnected = new Set((data ?? []).filter((r) => r.status === "connected").map((r) => r.provider));
  const out = {} as Record<IntegrationKey, { mode: IntegrationMode; source: "platform" | "organisation" | null }>;
  for (const i of INTEGRATIONS) {
    const org = orgConnected.has(i.key);
    const plat = platformCredential(i.key);
    const live = org || plat;
    out[i.key] = { mode: live ? "live" : i.key === "anthropic" ? "demo" : "off", source: org ? "organisation" : plat ? "platform" : null };
  }
  return out;
}

/**
 * Resolve a secret for server-side use only: the organisation's own connection first
 * (read through integration_secret(), which checks the caller's role), then the platform
 * environment variable. Never returned to the browser.
 */
export async function getSecret(db: SupabaseClient, organisationId: string, key: IntegrationKey): Promise<Record<string, string> | null> {
  const { data: ciphertext } = await db.rpc("integration_secret", { p_org: organisationId, p_provider: key });
  if (typeof ciphertext === "string" && ciphertext) {
    try {
      return JSON.parse(decryptSecret(ciphertext)) as Record<string, string>;
    } catch {
      /* undecryptable (key rotated?): fall through to platform credentials */
    }
  }
  switch (key) {
    case "cloudflare":
      return env.cloudflareApiToken && env.cloudflareAccountId ? { apiToken: env.cloudflareApiToken, accountId: env.cloudflareAccountId } : null;
    case "resend":
      return env.resendApiKey && env.resendFromEmail ? { apiKey: env.resendApiKey, fromEmail: env.resendFromEmail } : null;
    case "pinterest":
      return env.pinterestAccessToken ? { accessToken: env.pinterestAccessToken } : null;
    case "unsplash":
      return env.unsplashAccessKey ? { accessKey: env.unsplashAccessKey } : null;
    case "google_places":
      return env.googlePlacesApiKey ? { apiKey: env.googlePlacesApiKey } : null;
    case "serpapi":
      return env.serpApiKey ? { apiKey: env.serpApiKey } : null;
    case "higgsfield":
      return env.higgsfieldKeyId && env.higgsfieldKeySecret ? { keyId: env.higgsfieldKeyId, keySecret: env.higgsfieldKeySecret } : null;
    case "anthropic":
      return env.anthropicApiKey ? { apiKey: env.anthropicApiKey } : null;
    default:
      return null;
  }
}
