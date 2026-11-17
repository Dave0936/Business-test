import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { DraftRenderer } from "@/lib/sites/bespoke/render";

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>T</title><link rel="stylesheet" href="styles.css"></head>
<body><main id="main"><h1>Fresh from the North Sea</h1><img src="https://evil.example/x.png" alt=""><p>Hello</p></main><script src="script.js" defer></script></body></html>`;
const FILES = { "index.html": PAGE, "styles.css": "body{margin:0;background:#2463D8;color:#F5F0E6;font:700 64px/1 sans-serif} h1{padding:40px}", "script.js": "document.body.dataset.ok='1';" };

describe("draft renderer", () => {
  it("screenshots a page on desktop and phone from memory, without outside requests", async () => {
    const r = new DraftRenderer();
    try {
      const desktop = await r.render(FILES, "index.html", "desktop");
      if (desktop.error?.includes("not available")) return; // no browser in this environment
      expect(desktop.error).toBeUndefined();
      const jpeg = Buffer.from(desktop.jpegBase64!, "base64");
      expect(jpeg.subarray(0, 3).toString("hex")).toBe("ffd8ff");
      expect(desktop.note).toMatch(/index\.html on desktop \(1280px wide\)/);
      const phone = await r.render(FILES, "index.html", "phone");
      expect(phone.note).toMatch(/phone \(390px wide\)/);
      const sharp = (await import("sharp")).default;
      expect((await sharp(Buffer.from(phone.jpegBase64!, "base64")).metadata()).width).toBe(390);
      const wide = await r.render({ ...FILES, "styles.css": `${FILES["styles.css"]} .x{width:2000px;height:10px} ` , "index.html": PAGE.replace("<p>Hello</p>", '<div class="x"></div>') }, "index.html", "phone");
      expect(wide.note).toMatch(/scrolls sideways/);
    } finally {
      await r.close();
    }
  }, 60_000);
});
