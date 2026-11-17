import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assetEntries, assetHash, deploySite, headersFromFile, removeSite, verifyLive, workerNameFor, workerScript } from "@/lib/deploy/cloudflare";
import type { SiteFiles } from "@/lib/sites/spec";

const CREDS = { apiToken: "t0k", accountId: "acc1" };
const FILES: SiteFiles = {
  "index.html": "<!doctype html><html><head><title>x</title></head><body>Hi</body></html>",
  "styles.css": "body{color:red}",
  "assets/generated/a.png": { base64: Buffer.from("png-bytes").toString("base64"), contentType: "image/webp" },
  "_headers": "/*\n  X-Robots-Tag: noindex, nofollow\n  Content-Security-Policy: default-src 'self'\n/admin\n  X-Other: no\n",
  "robots.txt": "User-agent: *\nDisallow: /\n",
};

type Call = { url: string; method: string; auth: string | null; body: unknown };

/** A fake Cloudflare API that records calls. `missing` decides which hashes it asks for. */
function fakeCloudflare(opts: { missing?: (hashes: string[]) => string[][]; subdomain?: string | null; failPut?: boolean } = {}) {
  const calls: Call[] = [];
  const ok = (result: unknown, status = 200) => new Response(JSON.stringify({ success: true, errors: [], result }), { status });
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    let body: unknown = init?.body;
    if (typeof body === "string") body = JSON.parse(body);
    calls.push({ url: u, method, auth, body });
    if (u.endsWith("/workers/subdomain")) return opts.subdomain === null ? new Response(JSON.stringify({ success: false, errors: [{ code: 10007, message: "not found" }] }), { status: 404 }) : ok({ subdomain: opts.subdomain ?? "northlight" });
    if (u.includes("/assets-upload-session")) {
      const manifest = (body as { manifest: Record<string, { hash: string }> }).manifest;
      const hashes = Object.values(manifest).map((m) => m.hash);
      const buckets = opts.missing ? opts.missing(hashes) : [hashes];
      return ok({ jwt: buckets.length ? "upload-jwt" : "complete-jwt", buckets });
    }
    if (u.includes("/workers/assets/upload")) return ok({ jwt: "complete-jwt" }, 201);
    if (method === "PUT" && /\/workers\/scripts\/[^/]+$/.test(u)) return opts.failPut ? new Response(JSON.stringify({ success: false, errors: [{ code: 10021, message: "Uncaught error" }] }), { status: 400 }) : ok({ id: "wo-irmak", etag: "etag1" });
    if (u.endsWith("/subdomain") && method === "POST") return ok({ enabled: true });
    if (method === "DELETE") return u.includes("gone") ? new Response(JSON.stringify({ success: false, errors: [{ code: 10007, message: "workers.api.error.script_not_found" }] }), { status: 404 }) : ok(null);
    if (u.includes("workers.dev")) return new Response('<html><head><meta name="wo-version" content="abc"></head></html>', { status: 200 });
    return new Response("unexpected", { status: 500 });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe("Cloudflare deployment helpers", () => {
  it("names Workers safely", () => {
    expect(workerNameFor("wo", "Irmak Restaurant — Aberdeen!")).toBe("wo-irmak-restaurant-aberdeen");
    expect(workerNameFor("wo", "x".repeat(80)).length).toBeLessThanOrEqual(63);
    expect(workerNameFor("wo", "a".repeat(61) + "-b")).not.toMatch(/-$/);
  });

  it("publishes site files but not configuration files", () => {
    const paths = assetEntries(FILES).map((a) => a.path);
    expect(paths).toEqual(["/assets/generated/a.png", "/index.html", "/robots.txt", "/styles.css"]);
    expect(assetEntries(FILES).find((a) => a.path.endsWith(".png"))!.contentType).toBe("image/webp");
    expect(assetHash(Buffer.from("x"), "/a.html")).toMatch(/^[0-9a-f]{32}$/);
    expect(assetHash(Buffer.from("x"), "/a.html")).not.toBe(assetHash(Buffer.from("x"), "/a.css"));
  });

  it("turns the _headers file into the Worker's headers", () => {
    const h = headersFromFile(FILES["_headers"] as string);
    expect(h).toEqual({ "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'self'" });
    const js = workerScript(h);
    expect(js).toContain("env.ASSETS.fetch(request)");
    expect(js).toContain("noindex, nofollow");
  });

  it("uploads only the files Cloudflare lacks, then publishes the Worker on workers.dev", async () => {
    const { f, calls } = fakeCloudflare({ missing: (h) => [h.slice(0, 1)] });
    const r = await deploySite(CREDS, "wo-irmak", FILES, f);
    expect(r).toMatchObject({ workerName: "wo-irmak", url: "https://wo-irmak.northlight.workers.dev", uploaded: 1, reused: 3 });
    const upload = calls.find((c) => c.url.includes("/workers/assets/upload?base64=true"))!;
    expect(upload.auth).toBe("Bearer upload-jwt"); // the session token, not the API token
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.auth).toBe("Bearer t0k");
    const meta = JSON.parse(await ((put.body as FormData).get("metadata") as Blob).text());
    expect(meta.assets.jwt).toBe("complete-jwt");
    expect(meta.bindings).toEqual([{ name: "ASSETS", type: "assets" }]);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/workers/scripts/wo-irmak/subdomain"))).toBe(true);
  });

  it("skips uploading when Cloudflare already has every file", async () => {
    const { f, calls } = fakeCloudflare({ missing: () => [] });
    const r = await deploySite(CREDS, "wo-irmak", FILES, f);
    expect(r.uploaded).toBe(0);
    expect(calls.some((c) => c.url.includes("/assets/upload"))).toBe(false);
    const put = calls.find((c) => c.method === "PUT")!;
    expect(JSON.parse(await ((put.body as FormData).get("metadata") as Blob).text()).assets.jwt).toBe("complete-jwt");
  });

  it("reports Cloudflare's own error and never claims success", async () => {
    const { f } = fakeCloudflare({ failPut: true });
    await expect(deploySite(CREDS, "wo-irmak", FILES, f)).rejects.toThrow(/Cloudflare: Uncaught error/);
  });

  it("explains a missing workers.dev subdomain", async () => {
    const { f } = fakeCloudflare({ subdomain: null });
    await expect(deploySite(CREDS, "wo-irmak", FILES, f)).rejects.toThrow(/no workers.dev subdomain/);
  });

  it("treats an already-deleted Worker as removed", async () => {
    const { f } = fakeCloudflare();
    await expect(removeSite(CREDS, "wo-gone", f)).resolves.toBeUndefined();
    await expect(removeSite(CREDS, "wo-irmak", f)).resolves.toBeUndefined();
  });

  it("confirms the live page carries this version's marker", async () => {
    const { f } = fakeCloudflare();
    expect((await verifyLive("https://wo-irmak.northlight.workers.dev", '<meta name="wo-version" content="abc">', { f, waitMs: 1 })).ok).toBe(true);
    const r = await verifyLive("https://wo-irmak.northlight.workers.dev", '<meta name="wo-version" content="zzz">', { f, waitMs: 1, attempts: 2 });
    expect(r).toMatchObject({ ok: false });
    expect(r.reason).toMatch(/marker/);
  });
});
