import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { chooseReferences, pictureBlocks, refLabel, screenshotSite } from "@/lib/design/reference-images";
import type { ReferenceRow } from "@/lib/design/studio";

const ref = (id: string, over: Partial<ReferenceRow> = {}): ReferenceRow => ({ id, business_id: "b", kind: "pin", source: "pinterest", verdict: null, url: "https://www.pinterest.com/pin/1", image_url: "https://i.pinimg.com/x.jpg", storage_path: null, title: null, attribution: null, analysis: null, created_at: "2026-11-18T00:00:00Z", ...over });

describe("which references the models see", () => {
  it("loved first, then picks, never rejected, without duplicates", () => {
    const refs = [ref("a"), ref("b", { verdict: "loved" }), ref("c", { verdict: "rejected" }), ref("d"), ref("e", { verdict: "loved" })];
    expect(chooseReferences(refs, ["d", "c", "b"], 6).map((r) => r.id)).toEqual(["b", "e", "d"]);
    expect(chooseReferences(refs, ["d"], 2).map((r) => r.id)).toEqual(["b", "e"]);
  });

  it("labels each picture with what we know, and numbers them", () => {
    const blocks = pictureBlocks([{ ref: ref("a", { kind: "site", attribution: "jonesbarbq.com", verdict: "loved" }), jpegBase64: "AAAA" }], (r) => refLabel(r));
    expect(blocks[0]).toEqual({ type: "text", text: "Reference 1 (a): the first screen of jonesbarbq.com, loved by our designer" });
    expect(blocks[1]).toMatchObject({ type: "image", source: { media_type: "image/jpeg", data: "AAAA" } });
  });

  it("never opens local or private addresses for screenshots", async () => {
    expect(await screenshotSite("http://localhost:3000/")).toBeNull();
    expect(await screenshotSite("http://127.0.0.1:9001/2018-06-01/runtime/invocation/next")).toBeNull();
    expect(await screenshotSite("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(await screenshotSite("file:///etc/passwd")).toBeNull();
  });
});
