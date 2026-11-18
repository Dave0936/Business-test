import { describe, expect, it } from "vitest";
import { referencedVendor } from "@/lib/sites/vendor";
import { motionInstruction } from "@/lib/sites/bespoke/motion";
import { stubPage } from "@/lib/sites/bespoke/pages";
import { inlinePageAssets } from "@/lib/sites/preview-inline";

describe("animation toolkit", () => {
  it("finds only the vendor files a page links", () => {
    const files = { "index.html": '<link rel="stylesheet" href="vendor/lenis.css"><script src="vendor/motion.js" defer></script>', "fr/index.html": '<script src="../vendor/lenis.min.js"></script>', "styles.css": "vendor/motion.js" };
    expect(referencedVendor(files).sort()).toEqual(["vendor/lenis.css", "vendor/lenis.min.js", "vendor/motion.js"]);
    expect(referencedVendor({ "index.html": "<p>vendor/motion.js</p>" })).toEqual([]);
  });

  it("builds a motion-only instruction from the choices", () => {
    const t = motionInstruction(["scroll", "hero"], "bold");
    expect(t).toMatch(/^Add motion only/);
    expect(t).toMatch(/first screen/);
    expect(t).toMatch(/Lenis/);
    expect(t).not.toMatch(/hover and press/);
    expect(t).toMatch(/Bold:/);
    expect(t).toMatch(/prefers-reduced-motion/);
    expect(() => motionInstruction([], "subtle")).toThrow(/at least one/);
  });

  it("placeholder pages keep the homepage's animation libraries", () => {
    const home = '<html><head><link rel="stylesheet" href="vendor/lenis.css"></head><body><header><a href="index.html">X</a></header><main></main><footer>f</footer><script src="vendor/motion.js" defer></script><script src="script.js" defer></script></body></html>';
    const stub = stubPage(home, { file: "menu.html", label: "Menu" });
    expect(stub).toContain('href="vendor/lenis.css"');
    expect(stub.indexOf('src="vendor/motion.js"')).toBeLessThan(stub.indexOf('src="script.js"'));
  });

  it("preview keeps deferred scripts after the page, in order", () => {
    const files = { "index.html": '<html><head><script src="vendor/motion.js" defer></script><script src="script.js" defer></script></head><body><h1>Hi</h1></body></html>', "vendor/motion.js": "window.Motion={}", "script.js": "if(window.Motion){}" };
    const { html, scriptHashes } = inlinePageAssets("index.html", files);
    expect(scriptHashes).toHaveLength(2);
    expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf("window.Motion={}"));
    expect(html.indexOf("window.Motion={}")).toBeLessThan(html.indexOf("if(window.Motion)"));
  });
});
