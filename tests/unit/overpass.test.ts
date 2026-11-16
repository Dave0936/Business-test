import { describe, expect, it, vi } from "vitest";
import { checkOverpassServers, overpass, overpassEndpoints } from "@/lib/providers/discovery/openstreetmap";

const ok = () => new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 1, lon: 1, tags: { name: "Cafe" } }] }), { status: 200 });
const timeout = () => Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));

describe("OpenStreetMap (Overpass) failover", () => {
  it("tries several public servers, including private.coffee", () => {
    const hosts = overpassEndpoints().map((e) => new URL(e).host);
    expect(hosts).toEqual(expect.arrayContaining(["overpass-api.de", "overpass.private.coffee", "overpass.kumi.systems"]));
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("moves on from a busy or slow server to one that answers", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockImplementationOnce(timeout)
      .mockResolvedValueOnce(ok());
    const r = await overpass("q", f as unknown as typeof fetch);
    expect(r.elements).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("explains in plain English when every server fails", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 504 })).mockImplementation(timeout);
    await expect(overpass("q", f as unknown as typeof fetch)).rejects.toThrow(/free OpenStreetMap servers did not answer from this site.*overloaded.*did not answer within 20 seconds.*SerpAPI/);
  });

  it("reports each server's health for the Integrations page", async () => {
    const f = vi.fn().mockImplementation((url: string) => (url.includes("kumi") ? timeout() : Promise.resolve(ok())));
    const r = await checkOverpassServers(f as unknown as typeof fetch);
    expect(r.find((x) => x.host === "overpass.kumi.systems")).toMatchObject({ ok: false });
    expect(r.filter((x) => x.ok).length).toBe(r.length - 1);
  });
});

describe("provider health", () => {
  it("marks a source unreachable for a day after a failure, until a check succeeds", async () => {
    const { isMarkedUnreachable } = await import("@/lib/providers/discovery/health");
    const now = Date.parse("2026-11-16T20:00:00Z");
    expect(isMarkedUnreachable(null, now)).toBe(false);
    expect(isMarkedUnreachable({ ok: false, checked_at: "2026-11-16T19:00:00Z" }, now)).toBe(true);
    expect(isMarkedUnreachable({ ok: false, checked_at: "2026-11-15T19:00:00Z" }, now)).toBe(false);
    expect(isMarkedUnreachable({ ok: true, checked_at: "2026-11-16T19:00:00Z" }, now)).toBe(false);
  });
});
