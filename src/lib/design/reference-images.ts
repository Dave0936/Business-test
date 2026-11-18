import "server-only";
import { lookup } from "node:dns/promises";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSafeUrl, isPublicAddress, safeFetch } from "@/lib/security/safe-fetch";
import { sniffImage } from "./image-sniff";
import { launchChromium } from "@/lib/qa/chromium";
import { UPLOAD_BUCKET, type ReferenceRow } from "./studio";

/**
 * The actual pictures behind design references, so models can see the look rather than read
 * about it (Venari's method: the references ARE the look). Uploads come from our storage, pins
 * from their image address, websites from a screenshot of the first screen (taken once, then
 * kept in storage). Pictures from the web are untrusted: callers label them as such.
 */

export interface RefPicture {
  ref: ReferenceRow;
  jpegBase64: string;
}

type Block = Anthropic.Beta.BetaContentBlockParam;

const MAX_SIDE = 1100;

async function toJpeg(bytes: Uint8Array): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(Buffer.from(bytes)).rotate().resize({ width: MAX_SIDE, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    return out.toString("base64");
  } catch {
    return null;
  }
}

const hostOk = new Map<string, boolean>();
async function publicHost(raw: string): Promise<boolean> {
  try {
    const url = assertSafeUrl(raw);
    if (hostOk.has(url.hostname)) return hostOk.get(url.hostname)!;
    const addrs = await lookup(url.hostname, { all: true });
    const ok = addrs.length > 0 && addrs.every((a) => isPublicAddress(a.address));
    hostOk.set(url.hostname, ok);
    return ok;
  } catch {
    return false;
  }
}

/** First screen of a public website (1440x900), every request checked to be public. */
export async function screenshotSite(url: string): Promise<Uint8Array | null> {
  if (!(await publicHost(url))) return null;
  const { browser } = await launchChromium();
  if (!browser) return null;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, javaScriptEnabled: true });
    await context.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
      return (await publicHost(u)) ? route.continue() : route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 25_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);
    await page.waitForTimeout(1200);
    const png = await page.screenshot({ type: "png" });
    await context.close();
    return new Uint8Array(png);
  } catch {
    return null;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function bytesFor(db: SupabaseClient, org: string, ref: ReferenceRow): Promise<Uint8Array | null> {
  if (ref.storage_path) {
    const { data } = await db.storage.from(UPLOAD_BUCKET).download(ref.storage_path);
    return data ? new Uint8Array(await data.arrayBuffer()) : null;
  }
  if (ref.kind === "site" && /^https?:\/\//.test(ref.url)) {
    const shot = await screenshotSite(ref.url);
    if (shot) {
      // Keep it, so the next brief or build does not open the site again.
      const path = `${org}/refshots/${ref.id}.png`;
      const { error } = await db.storage.from(UPLOAD_BUCKET).upload(path, shot, { contentType: "image/png", upsert: true });
      if (!error) await db.from("design_references").update({ storage_path: path }).eq("id", ref.id).eq("organisation_id", org);
      return shot;
    }
  }
  if (ref.image_url) {
    try {
      const res = await safeFetch(ref.image_url, { timeoutMs: 15_000, maxBytes: 8_000_000 });
      if (res.status < 400 && !res.truncated && sniffImage(res.bytesBody)) return res.bytesBody;
    } catch {
      /* unreachable picture: skip it */
    }
  }
  return null;
}

/** Pictures for the given references, in order, skipping any that cannot be read. */
export async function referencePictures(db: SupabaseClient, org: string, refs: ReferenceRow[], max = 6): Promise<RefPicture[]> {
  const out: RefPicture[] = [];
  for (const ref of refs) {
    if (out.length >= max) break;
    const bytes = await bytesFor(db, org, ref);
    if (!bytes) continue;
    const jpeg = await toJpeg(bytes);
    if (jpeg) out.push({ ref, jpegBase64: jpeg });
  }
  return out;
}

/** Loved references first, then the picks, never rejected ones; at most `max`. */
export function chooseReferences(refs: ReferenceRow[], pickIds: string[], max = 6): ReferenceRow[] {
  const byId = new Map(refs.map((r) => [r.id, r]));
  const loved = refs.filter((r) => r.verdict === "loved");
  const picked = pickIds.map((id) => byId.get(id)).filter((r): r is ReferenceRow => Boolean(r) && r!.verdict !== "rejected");
  return [...new Map([...loved, ...picked].map((r) => [r.id, r])).values()].slice(0, max);
}

/** Content blocks: a label line, then each picture with its number and what we know about it. */
export function pictureBlocks(pictures: RefPicture[], notes: (ref: ReferenceRow) => string): Block[] {
  const blocks: Block[] = [];
  pictures.forEach((p, i) => {
    blocks.push({ type: "text", text: `Reference ${i + 1} (${p.ref.id}): ${notes(p.ref)}` });
    blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.jpegBase64 } });
  });
  return blocks;
}

export function refLabel(ref: ReferenceRow): string {
  const kind = ref.kind === "upload" ? "a picture our designer uploaded" : ref.kind === "pin" ? "a Pinterest pin" : ref.kind === "site" ? `the first screen of ${ref.attribution ?? "a website"}` : "a reference";
  return `${kind}${ref.verdict === "loved" ? ", loved by our designer" : ""}${ref.title ? ` (titled ${JSON.stringify(ref.title.slice(0, 80))})` : ""}`;
}
