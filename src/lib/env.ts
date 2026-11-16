import "server-only";

/**
 * Server-side environment. Nothing here is ever sent to the browser.
 * Missing optional integrations put the app into a clearly labelled demo mode
 * for that integration instead of failing or faking results.
 */
function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  appUrl: opt("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  supabaseUrl: opt("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: opt("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: opt("SUPABASE_SERVICE_ROLE_KEY"),
  encryptionKey: opt("APP_ENCRYPTION_KEY"),
  cronSecret: opt("CRON_SECRET"),
  anthropicApiKey: opt("ANTHROPIC_API_KEY"),
  anthropicModel: opt("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
  googlePlacesApiKey: opt("GOOGLE_PLACES_API_KEY"),
  serpApiKey: opt("SERPAPI_API_KEY"),
  higgsfieldKeyId: opt("HIGGSFIELD_API_KEY_ID"),
  higgsfieldKeySecret: opt("HIGGSFIELD_API_KEY_SECRET"),
  overpassEndpoint: opt("OVERPASS_ENDPOINT") ?? "https://overpass-api.de/api/interpreter",
  nominatimEndpoint: opt("NOMINATIM_ENDPOINT") ?? "https://nominatim.openstreetmap.org/search",
  osmContactEmail: opt("OSM_CONTACT_EMAIL"),
  pinterestAccessToken: opt("PINTEREST_ACCESS_TOKEN"),
  unsplashAccessKey: opt("UNSPLASH_ACCESS_KEY"),
  cloudflareApiToken: opt("CLOUDFLARE_API_TOKEN"),
  cloudflareAccountId: opt("CLOUDFLARE_ACCOUNT_ID"),
  cloudflareProjectPrefix: opt("CLOUDFLARE_PROJECT_PREFIX") ?? "wo",
  resendApiKey: opt("RESEND_API_KEY"),
  resendWebhookSecret: opt("RESEND_WEBHOOK_SECRET"),
  resendFromEmail: opt("RESEND_FROM_EMAIL"),
  demoMode: opt("DEMO_MODE") === "true",
};

export function supabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

export type IntegrationKey =
  | "anthropic"
  | "google_places"
  | "serpapi"
  | "openstreetmap"
  | "higgsfield"
  | "pinterest"
  | "unsplash"
  | "cloudflare"
  | "resend";

/** Whether a platform-level credential exists (org-level secrets are checked separately). */
export function platformCredential(key: IntegrationKey): boolean {
  switch (key) {
    case "anthropic":
      return Boolean(env.anthropicApiKey);
    case "google_places":
      return Boolean(env.googlePlacesApiKey);
    case "serpapi":
      return Boolean(env.serpApiKey);
    case "higgsfield":
      return Boolean(env.higgsfieldKeyId && env.higgsfieldKeySecret);
    case "openstreetmap":
      return true; // public, keyless; usage policy applies
    case "pinterest":
      return Boolean(env.pinterestAccessToken);
    case "unsplash":
      return Boolean(env.unsplashAccessKey);
    case "cloudflare":
      return Boolean(env.cloudflareApiToken && env.cloudflareAccountId);
    case "resend":
      return Boolean(env.resendApiKey && env.resendFromEmail);
  }
}
