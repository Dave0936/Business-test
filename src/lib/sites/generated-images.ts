import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSecret } from "@/lib/integrations";
import { safeFetch } from "@/lib/security/safe-fetch";
import { sniffImage } from "@/lib/design/image-sniff";
import type { DesignBrief } from "@/lib/design/brief";
import {
  HiggsfieldError, deleteRequest, estimateUsd, imagePrompt, requestBody, requestStatus, submitImage,
  type AspectRatio, type HiggsfieldCreds,
} from "@/lib/providers/images/higgsfield";
import type { ResolvedImage } from "./spec";
import { compressPhoto } from "./image-compress";
import { aiAvailable } from "@/lib/ai/client";
import { runPhotoPromptAgent } from "@/lib/ai/agents/creative-agents";

export const MAX_IMAGES = 6;
const BUCKET = "site-assets";

export interface ImagePlanItem {
  slot: string;
  prompt: string;
  aspect: AspectRatio;
}

/** One photo per image search term in the latest brief (the first is the wide hero shot). */
export async function planImages(db: SupabaseClient, org: string, businessId: string): Promise<ImagePlanItem[]> {
  const { data: row } = await db.from("design_briefs").select("brief").eq("business_id", businessId).eq("organisation_id", org).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) throw new Error("Create a design brief first: the photos follow its image list and style.");
  const brief = row.brief as DesignBrief;
  const { data: done } = await db.from("generated_images").select("slot").eq("business_id", businessId).eq("organisation_id", org).in("status", ["queued", "submitted", "completed"]);
  const have = new Set((done ?? []).map((d) => d.slot));
  return (brief.image_queries ?? [])
    .slice(0, MAX_IMAGES)
    // The brief's image_style describes how images sit on the page (frames, sizes, counts):
    // never send that to the photo model. Photographic prompts are written at start time.
    .map((q, i) => ({ slot: q, prompt: imagePrompt(q), aspect: (i === 0 ? "16:9" : "3:2") as AspectRatio }))
    .filter((p) => !have.has(p.slot));
}

async function creds(db: SupabaseClient, org: string): Promise<HiggsfieldCreds> {
  const c = await getSecret(db, org, "higgsfield");
  if (!c?.keyId || !c?.keySecret) throw new Error("Higgsfield is not connected. Add it under Integrations.");
  return { keyId: c.keyId, keySecret: c.keySecret };
}

export interface Quote {
  items: ImagePlanItem[];
  perImageUsd: number;
  totalUsd: number;
}

export async function quoteImages(db: SupabaseClient, org: string, businessId: string, f: typeof fetch = fetch): Promise<Quote> {
  const items = await planImages(db, org, businessId);
  if (!items.length) return { items, perImageUsd: 0, totalUsd: 0 };
  const c = await creds(db, org);
  // All images use the same model and size; estimate each aspect once.
  const byAspect = new Map<string, number>();
  for (const it of items) if (!byAspect.has(it.aspect)) byAspect.set(it.aspect, await estimateUsd(c, requestBody(it.prompt, it.aspect), f));
  const totalUsd = items.reduce((s, it) => s + (byAspect.get(it.aspect) ?? 0), 0);
  return { items, perImageUsd: Math.max(...byAspect.values()), totalUsd: Math.round(totalUsd * 10000) / 10000 };
}

/** Start generation after the person has seen the quote. Refuses if the price went up. */
export async function startImages(db: SupabaseClient, org: string, businessId: string, actorId: string, quotedTotal: number, f: typeof fetch = fetch): Promise<{ ids: string[]; totalUsd: number }> {
  const q = await quoteImages(db, org, businessId, f);
  if (!q.items.length) throw new Error("There are no photos left to generate for this brief.");
  if (q.totalUsd > quotedTotal * 1.2 + 0.01) throw new Error(`The price changed to $${q.totalUsd.toFixed(2)}. Check the new estimate and confirm again.`);
  const per = q.totalUsd / q.items.length;
  // Claude turns each subject into a prompt for one real photograph in the brief's look.
  if (aiAvailable()) {
    try {
      const [{ data: briefRow }, { data: studio }, { data: biz }] = await Promise.all([
        db.from("design_briefs").select("brief").eq("business_id", businessId).eq("organisation_id", org).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        db.from("design_studios").select("creative_brief").eq("business_id", businessId).eq("organisation_id", org).maybeSingle(),
        db.from("businesses").select("name, category, city").eq("id", businessId).eq("organisation_id", org).single(),
      ]);
      const b = briefRow?.brief as DesignBrief | undefined;
      const look = [studio?.creative_brief ?? "", b ? `Mood: ${b.mood_words?.join(", ") ?? ""}. Palette: ${Object.values(b.palette ?? {}).join(", ")}. Photography notes: ${b.image_style ?? ""}` : ""].filter(Boolean).join("\n\n");
      const r = await runPhotoPromptAgent({ db, organisationId: org, business: `${biz?.name ?? "a local business"}, ${biz?.category ?? ""}${biz?.city ? ` in ${biz.city}` : ""}`, look, subjects: q.items.map((it) => it.slot) });
      const bySlot = new Map(r.output.prompts.map((p) => [p.slot, p.prompt]));
      q.items = q.items.map((it) => (bySlot.get(it.slot) ? { ...it, prompt: imagePrompt(it.slot, bySlot.get(it.slot)) } : it));
    } catch (e) {
      console.error("photo prompts failed; using plain photo prompts", e);
    }
  }
  const { data, error } = await db.from("generated_images").insert(q.items.map((it) => ({
    organisation_id: org, business_id: businessId, slot: it.slot, prompt: it.prompt, aspect: it.aspect, status: "queued", quoted_usd: per, created_by: actorId,
  }))).select("id");
  if (error) throw error;
  return { ids: (data ?? []).map((d) => d.id), totalUsd: q.totalUsd };
}

/** One step for one image: submit, or check, or copy the finished image. Returns "poll" to come back later. */
export async function processImage(db: SupabaseClient, org: string, imageId: string, f: typeof fetch = fetch): Promise<"poll" | "completed" | "failed"> {
  const { data: img, error } = await db.from("generated_images").select("*").eq("id", imageId).eq("organisation_id", org).single();
  if (error) throw error;
  if (img.status === "completed" || img.status === "failed") return img.status;
  const c = await creds(db, org);

  if (img.status === "queued") {
    let requestId: string;
    try {
      ({ requestId } = await submitImage(c, requestBody(img.prompt, img.aspect as AspectRatio), img.id, f));
    } catch (e) {
      // Problems a retry cannot fix (no credit, bad key, model unavailable): stop and say why.
      if (e instanceof HiggsfieldError && [401, 402, 403, 404, 422, 423].includes(e.status ?? 0)) {
        await db.from("generated_images").update({ status: "failed", error: e.message }).eq("id", img.id).eq("organisation_id", org);
        return "failed";
      }
      throw e;
    }
    await db.from("generated_images").update({ status: "submitted", request_id: requestId }).eq("id", img.id).eq("organisation_id", org);
    return "poll";
  }

  const st = await requestStatus(c, img.request_id, f);
  if (st.status === "queued" || st.status === "in_progress") return "poll";
  if (st.status !== "completed" || !st.imageUrl) {
    await db.from("generated_images").update({ status: "failed", error: st.error ?? `Ended as ${st.status} (not charged).` }).eq("id", img.id).eq("organisation_id", org);
    return "failed";
  }
  // Copy into our private storage straight away: Higgsfield keeps outputs for seven days.
  const res = await safeFetch(st.imageUrl, { timeoutMs: 30_000, maxBytes: 15_000_000 });
  const kind = res.status < 400 ? sniffImage(res.bytesBody) : null;
  if (!kind || res.truncated) {
    await db.from("generated_images").update({ status: "failed", error: "The finished image could not be downloaded." }).eq("id", img.id).eq("organisation_id", org);
    return "failed";
  }
  // Higgsfield returns large PNGs (about 1.5 MB); store a web-sized WebP copy instead.
  const small = await compressPhoto(res.bytesBody, kind.mime);
  const ext = small.contentType === "image/webp" ? "webp" : kind.ext;
  const path = `${org}/generated/${img.business_id}/${img.id}.${ext}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, small.bytes, { contentType: small.contentType, upsert: true });
  if (upErr) throw new Error(`Could not store the image: ${upErr.message}`);
  await db.from("generated_images").update({ status: "completed", storage_path: path, error: null }).eq("id", img.id).eq("organisation_id", org);
  await db.from("api_usage").insert({ organisation_id: org, provider: "higgsfield", operation: "image_generation", input_units: 1, output_units: 1, cost_usd: Number(img.quoted_usd ?? 0) });
  await deleteRequest(c, img.request_id, f);
  return "completed";
}

/** Completed AI photos for a business, as images the builders can place (bundled with the site). */
export async function generatedImagesFor(db: SupabaseClient, org: string, businessId: string): Promise<Record<string, ResolvedImage>> {
  const { data } = await db.from("generated_images").select("id, slot, storage_path").eq("business_id", businessId).eq("organisation_id", org).eq("status", "completed").order("created_at", { ascending: false });
  const out: Record<string, ResolvedImage> = {};
  for (const r of data ?? []) {
    if (out[r.slot] || !r.storage_path) continue;
    const ext = r.storage_path.split(".").pop();
    out[r.slot] = { src: `assets/generated/${r.id}.${ext}`, alt: r.slot, kind: "upload", storagePath: r.storage_path, credit: null, aiGenerated: true };
  }
  return out;
}

/** Set photos aside (bad or unwanted). They are never used, and their subjects can be generated again. */
export async function discardImages(db: SupabaseClient, org: string, businessId: string, imageId: string | null): Promise<number> {
  let q = db.from("generated_images").update({ status: "failed", error: "Discarded by our team" }, { count: "exact" }).eq("business_id", businessId).eq("organisation_id", org).in("status", ["completed", "failed", "queued"]);
  if (imageId) q = q.eq("id", imageId);
  const { error, count } = await q;
  if (error) throw error;
  return count ?? 0;
}
