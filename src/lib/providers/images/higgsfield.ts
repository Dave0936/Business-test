/**
 * Higgsfield image generation (official API, https://docs.higgsfield.ai). Text-to-image with
 * Z-Image Turbo: estimate the cost first, submit, poll, then copy the image to our own storage
 * (Higgsfield keeps outputs for seven days) and delete the request.
 */

export const HIGGSFIELD_API = "https://api.higgsfield.ai";
export const IMAGE_MODEL = "z-image/turbo";
export type AspectRatio = "1:1" | "3:2" | "4:3" | "16:9" | "21:9" | "2:3" | "3:4" | "9:16";

export interface HiggsfieldCreds {
  keyId: string;
  keySecret: string;
}

export interface ImageRequestBody {
  prompt: string;
  resolution: "1k" | "2k";
  aspect_ratio: AspectRatio;
  prompt_extend: false;
}

export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export class HiggsfieldError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

function headers(c: HiggsfieldCreds, extra: Record<string, string> = {}) {
  return { authorization: `Key ${c.keyId}:${c.keySecret}`, "content-type": "application/json", accept: "application/json", ...extra };
}

async function json<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { detail?: unknown; message?: string; error?: string };
  if (!res.ok) {
    const msg = res.status === 401 ? "Higgsfield rejected the credentials." : res.status === 402 ? "Not enough Higgsfield credits." : res.status === 429 ? "Higgsfield rate limit reached; try again shortly." : [404, 423, 503].includes(res.status) ? "This Higgsfield model is not available to the account right now." : `Higgsfield ${what} failed (${res.status}).`;
    throw new HiggsfieldError(msg, res.status);
  }
  return body;
}

/** Build a safe prompt: generic scene, no text, logos or recognisable people. */
export function imagePrompt(subject: string, style: string): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const base = `${clean(subject)}. ${clean(style)}. Editorial photograph, natural light, realistic. No text, no lettering, no logos, no signage, no brand names, no recognisable faces.`;
  return base.slice(0, 800);
}

export function requestBody(prompt: string, aspect: AspectRatio = "3:2"): ImageRequestBody {
  return { prompt: prompt.slice(0, 800), resolution: "1k", aspect_ratio: aspect, prompt_extend: false };
}

export async function estimateUsd(c: HiggsfieldCreds, body: ImageRequestBody, f: Fetch = fetch): Promise<number> {
  const res = await f(`${HIGGSFIELD_API}/estimate/${IMAGE_MODEL}`, { method: "POST", headers: headers(c), body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const j = await json<{ usd?: string | number }>(res, "estimate");
  const usd = Number(j.usd);
  if (!Number.isFinite(usd) || usd < 0) throw new HiggsfieldError("Higgsfield returned no usable estimate.");
  return usd;
}

export async function submitImage(c: HiggsfieldCreds, body: ImageRequestBody, idempotencyKey: string, f: Fetch = fetch): Promise<{ requestId: string }> {
  const res = await f(`${HIGGSFIELD_API}/${IMAGE_MODEL}`, { method: "POST", headers: headers(c, { "idempotency-key": idempotencyKey }), body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const j = await json<{ request_id?: string }>(res, "submission");
  if (!j.request_id || !/^[0-9a-f-]{36}$/i.test(j.request_id)) throw new HiggsfieldError("Higgsfield returned no request id.");
  return { requestId: j.request_id };
}

export interface StatusResult {
  status: HfStatus;
  imageUrl: string | null;
  error: string | null;
}

/** Status by request id (we build the URL ourselves rather than following one from a response). */
export async function requestStatus(c: HiggsfieldCreds, requestId: string, f: Fetch = fetch): Promise<StatusResult> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new HiggsfieldError("Invalid request id.");
  const res = await f(`${HIGGSFIELD_API}/requests/${requestId}/status`, { headers: headers(c), signal: AbortSignal.timeout(20_000) });
  const j = await json<{ status?: string; images?: { url?: string }[]; error?: string | { message?: string } }>(res, "status check");
  const status = (["queued", "in_progress", "completed", "failed", "nsfw", "canceled"].includes(String(j.status)) ? j.status : "failed") as HfStatus;
  const url = j.images?.find((i) => typeof i.url === "string" && i.url.startsWith("https://"))?.url ?? null;
  const err = typeof j.error === "string" ? j.error : j.error?.message ?? null;
  return { status, imageUrl: status === "completed" ? url : null, error: status === "nsfw" ? "Rejected by Higgsfield's content moderation (not charged)." : status === "failed" ? err ?? "Generation failed (not charged)." : null };
}

/** Delete a finished request's files and parameters at Higgsfield once we have our copy. */
export async function deleteRequest(c: HiggsfieldCreds, requestId: string, f: Fetch = fetch): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return;
  await f(`${HIGGSFIELD_API}/requests/${requestId}`, { method: "DELETE", headers: headers(c), signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
}
