import "server-only";

/**
 * Checks a credential against the provider before it is saved, using a cheap,
 * read-only call. Returns non-secret account details to show on the card.
 */
export interface VerifyResult { ok: boolean; detail: string; config?: Record<string, string> }

const FIELDS: Record<string, { name: string; label: string; secret: boolean; placeholder?: string }[]> = {
  serpapi: [{ name: "apiKey", label: "API key", secret: true }],
  google_places: [{ name: "apiKey", label: "API key", secret: true }],
  higgsfield: [{ name: "keyId", label: "API key ID", secret: false }, { name: "keySecret", label: "API key secret", secret: true }],
  pinterest: [{ name: "accessToken", label: "Access token", secret: true }],
  unsplash: [{ name: "accessKey", label: "Access key", secret: true }],
  cloudflare: [{ name: "accountId", label: "Account ID", secret: false }, { name: "apiToken", label: "API token (Cloudflare Pages: Edit)", secret: true }],
  resend: [{ name: "apiKey", label: "API key", secret: true }, { name: "fromEmail", label: "From address (verified domain)", secret: false, placeholder: "hello@youragency.com" }],
};

export function credentialFields(provider: string) {
  return FIELDS[provider] ?? [];
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
}

export async function verifyCredential(provider: string, c: Record<string, string>): Promise<VerifyResult> {
  try {
    switch (provider) {
      case "serpapi": {
        const r = await get(`https://serpapi.com/account.json?api_key=${encodeURIComponent(c.apiKey)}`);
        const j = (await r.json().catch(() => ({}))) as { error?: string; plan_name?: string; total_searches_left?: number; account_email?: string };
        if (!r.ok || j.error) {
          const e = j.error ?? `SerpAPI answered ${r.status}`;
          const hint = /invalid api key/i.test(e) ? " Copy the \"Private API Key\" from serpapi.com/manage-api-key (64 characters)." : /verif|confirm/i.test(e) ? " Finish verifying your SerpAPI account (email or phone), then try again." : "";
          return { ok: false, detail: `${e}${hint}` };
        }
        return { ok: true, detail: `${j.plan_name ?? "SerpAPI"}: ${j.total_searches_left ?? "?"} searches left`, config: { plan: j.plan_name ?? "", searchesLeft: String(j.total_searches_left ?? "") } };
      }
      case "google_places": {
        const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Goog-Api-Key": c.apiKey, "X-Goog-FieldMask": "places.id" },
          body: JSON.stringify({ textQuery: "cafe in London", pageSize: 1 }),
          signal: AbortSignal.timeout(15_000),
        });
        return r.ok ? { ok: true, detail: "Key works with the Places API (New)." } : { ok: false, detail: `Google answered ${r.status}. Enable "Places API (New)" for this key.` };
      }
      case "higgsfield": {
        // Unknown request id: 404 means the credentials were accepted, 401 means they were not.
        const r = await get("https://api.higgsfield.ai/requests/00000000-0000-0000-0000-000000000000/status", { authorization: `Key ${c.keyId}:${c.keySecret}` });
        if (r.status === 401) return { ok: false, detail: "Higgsfield rejected these credentials." };
        return { ok: true, detail: "Credentials accepted by Higgsfield." };
      }
      case "pinterest": {
        const r = await get("https://api.pinterest.com/v5/user_account", { authorization: `Bearer ${c.accessToken}` });
        const j = (await r.json().catch(() => ({}))) as { username?: string; message?: string };
        return r.ok ? { ok: true, detail: `Pinterest account ${j.username ?? ""}`.trim(), config: { username: j.username ?? "" } } : { ok: false, detail: j.message ?? `Pinterest answered ${r.status}` };
      }
      case "unsplash": {
        const r = await get("https://api.unsplash.com/photos?per_page=1", { authorization: `Client-ID ${c.accessKey}`, "accept-version": "v1" });
        return r.ok ? { ok: true, detail: "Unsplash key works." } : { ok: false, detail: `Unsplash answered ${r.status}` };
      }
      case "cloudflare": {
        const r = await get("https://api.cloudflare.com/client/v4/user/tokens/verify", { authorization: `Bearer ${c.apiToken}` });
        const j = (await r.json().catch(() => ({}))) as { success?: boolean; result?: { status?: string } };
        if (!j.success || j.result?.status !== "active") return { ok: false, detail: "Cloudflare did not accept this token." };
        const a = await get(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(c.accountId)}/pages/projects?per_page=1`, { authorization: `Bearer ${c.apiToken}` });
        return a.ok ? { ok: true, detail: "Token is active and can use Cloudflare Pages.", config: { accountId: c.accountId } } : { ok: false, detail: "Token works but cannot read Pages for that account ID." };
      }
      case "resend": {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.fromEmail ?? "")) return { ok: false, detail: "Enter the from address." };
        const r = await get("https://api.resend.com/domains", { authorization: `Bearer ${c.apiKey}` });
        const j = (await r.json().catch(() => ({}))) as { data?: { name: string; status: string }[]; message?: string };
        if (!r.ok) return { ok: false, detail: j.message ?? `Resend answered ${r.status}` };
        const domain = c.fromEmail.split("@")[1].toLowerCase();
        const d = j.data?.find((x) => x.name.toLowerCase() === domain);
        if (!d) return { ok: false, detail: `${domain} is not a domain in this Resend account.` };
        if (d.status !== "verified") return { ok: false, detail: `${domain} is not verified in Resend yet (${d.status}).` };
        return { ok: true, detail: `Sending from ${c.fromEmail}`, config: { fromEmail: c.fromEmail } };
      }
      default:
        return { ok: false, detail: "This integration cannot be connected here." };
    }
  } catch (e) {
    return { ok: false, detail: `Could not reach the provider to check the key (${(e as Error).message}).` };
  }
}
