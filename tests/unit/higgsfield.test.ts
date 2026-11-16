import { describe, expect, it, vi } from "vitest";
import { deleteRequest, estimateUsd, imagePrompt, requestBody, requestStatus, submitImage, HIGGSFIELD_API } from "@/lib/providers/images/higgsfield";
import { assembleBespoke } from "@/lib/sites/bespoke/assemble";
import { makeChecker } from "@/lib/sites/bespoke/check";
import type { SiteSpec } from "@/lib/sites/spec";

const C = { keyId: "kid", keySecret: "ksecret" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const asFetch = (f: ReturnType<typeof vi.fn>) => f as unknown as typeof fetch;
const RID = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";

describe("Higgsfield image provider", () => {
  it("writes generic, safe prompts within the model's limit", () => {
    const p = imagePrompt("bright cafe counter\nwith pastries", "Natural light, real settings");
    expect(p).toMatch(/^bright cafe counter with pastries\. Natural light/);
    expect(p).toMatch(/No text, no lettering, no logos/);
    expect(p).toMatch(/no recognisable faces/);
    expect(imagePrompt("x".repeat(2000), "y").length).toBeLessThanOrEqual(800);
    expect(requestBody("p", "16:9")).toEqual({ prompt: "p", resolution: "1k", aspect_ratio: "16:9", prompt_extend: false });
  });

  it("estimates the price with the same body, authenticated", async () => {
    const f = vi.fn().mockResolvedValue(json({ usd: "0.035" }));
    expect(await estimateUsd(C, requestBody("cafe"), asFetch(f))).toBe(0.035);
    expect(f.mock.calls[0][0]).toBe(`${HIGGSFIELD_API}/estimate/z-image/turbo`);
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Key kid:ksecret");
    expect(JSON.parse(String(init.body))).toMatchObject({ prompt: "cafe", resolution: "1k" });
  });

  it("submits with an idempotency key and validates the request id", async () => {
    const f = vi.fn().mockResolvedValue(json({ status: "queued", request_id: RID }));
    expect(await submitImage(C, requestBody("cafe"), "img-1", asFetch(f))).toEqual({ requestId: RID });
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "idempotency-key": "img-1" });
    await expect(submitImage(C, requestBody("cafe"), "img-1", asFetch(vi.fn().mockResolvedValue(json({ request_id: "../../x" }))))).rejects.toThrow(/no request id/);
  });

  it("maps every terminal state, and only accepts https image links", async () => {
    const st = (body: unknown) => requestStatus(C, RID, asFetch(vi.fn().mockResolvedValue(json(body))));
    expect(await st({ status: "in_progress" })).toMatchObject({ status: "in_progress", imageUrl: null });
    expect(await st({ status: "completed", images: [{ url: "https://cdn.example/a.png" }] })).toMatchObject({ status: "completed", imageUrl: "https://cdn.example/a.png" });
    expect(await st({ status: "completed", images: [{ url: "http://cdn.example/a.png" }] })).toMatchObject({ imageUrl: null });
    expect(await st({ status: "nsfw" })).toMatchObject({ status: "nsfw", error: expect.stringMatching(/moderation.*not charged/) });
    expect(await st({ status: "failed", error: "boom" })).toMatchObject({ status: "failed", error: "boom" });
    expect(await st({ status: "weird" })).toMatchObject({ status: "failed" });
    await expect(requestStatus(C, "../evil", asFetch(vi.fn()))).rejects.toThrow(/Invalid request id/);
  });

  it("explains account problems plainly", async () => {
    await expect(estimateUsd(C, requestBody("x"), asFetch(vi.fn().mockResolvedValue(json({}, 401))))).rejects.toThrow(/rejected the credentials/);
    await expect(estimateUsd(C, requestBody("x"), asFetch(vi.fn().mockResolvedValue(json({}, 402))))).rejects.toThrow(/Not enough Higgsfield credits/);
    await expect(submitImage(C, requestBody("x"), "k", asFetch(vi.fn().mockResolvedValue(json({}, 423))))).rejects.toThrow(/not available to the account/);
  });

  it("deletes finished requests and never throws doing so", async () => {
    const f = vi.fn().mockRejectedValue(new Error("network"));
    await expect(deleteRequest(C, RID, asFetch(f))).resolves.toBeUndefined();
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
  });
});

describe("sites with AI photos", () => {
  const ctx = { facts: { name: "Harbour Kitchen", phone: null, email: null, address: null, city: null, language: "en-GB" }, agencyName: "Northlight", agencyWebsite: null };
  it("say so in the footer of every page", () => {
    const { files } = assembleBespoke({ "index.html": "<html><body><h1>x</h1></body></html>" }, { ...ctx, aiImages: true });
    expect(files["index.html"]).toMatch(/Some images are AI-generated illustrations, not photos of the business/);
    const { files: plain } = assembleBespoke({ "index.html": "<html><body><h1>x</h1></body></html>" }, ctx);
    expect(plain["index.html"]).not.toMatch(/AI-generated/);
  });
  it("count bundled photos as present during the builder's checks", () => {
    const spec = { theme: { colors: { primary: "#1f3a4d", secondary: "#eeeeee", accent: "#2a9d8f", background: "#ffffff", surface: "#ffffff", text: "#111111", muted: "#555555" } } } as SiteSpec;
    const src = { "index.html": '<!doctype html><html lang="en"><head><title>t</title></head><body><img src="assets/generated/a.png" alt="cafe"></body></html>' };
    const missing = makeChecker(ctx, spec)(src).failures.join(" ");
    const present = makeChecker(ctx, spec, ["assets/generated/a.png"])(src).failures.join(" ");
    expect(missing).toMatch(/missing asset assets\/generated\/a\.png/);
    expect(present).not.toMatch(/missing asset/);
  });
});
