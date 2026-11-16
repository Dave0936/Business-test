import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fontFaceCss, googleFontFamilies, selfHostFonts, type FontManifest } from "@/lib/sites/fonts";
import { FONT_CHOICES } from "@/lib/design/brief";

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/fonts/manifest.json"), "utf8")) as FontManifest;
const fakeLoad = () => new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
const HEADERS = "/*\n  Content-Security-Policy: default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'\n";
const page = (href: string) => `<!doctype html><html><head><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${href}"><link rel="stylesheet" href="styles.css"></head><body><h1>Hi</h1></body></html>`;

describe("self-hosted fonts", () => {
  it("bundles every font the briefs may choose, with its licence", () => {
    for (const f of FONT_CHOICES) {
      expect(manifest[f], f).toBeTruthy();
      expect(fs.existsSync(path.join("data/fonts", manifest[f].id, "LICENSE")), f).toBe(true);
      expect(fs.existsSync(path.join("data/fonts", manifest[f].id, `latin-${manifest[f].weights[0]}.woff2`)), f).toBe(true);
    }
  });

  it("reads families from both Google Fonts URL formats", () => {
    expect(googleFontFamilies("https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&family=DM+Sans&display=swap")).toEqual(["Fraunces", "DM Sans"]);
    expect(googleFontFamilies("https://fonts.googleapis.com/css?family=Lora:400,700|Inter")).toEqual(["Lora", "Inter"]);
    expect(googleFontFamilies("https://evil.example/css2?family=Inter")).toEqual([]);
  });

  it("replaces Google Fonts with local files and tightens the security policy", () => {
    const { files, hosted } = selfHostFonts({ "index.html": page("https://fonts.googleapis.com/css2?family=Fraunces:wght@400;700&family=DM+Sans"), "_headers": HEADERS }, manifest, fakeLoad);
    expect(hosted).toEqual(["Fraunces", "DM Sans"]);
    const html = files["index.html"] as string;
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(html.indexOf("fonts/fonts.css")).toBeLessThan(html.indexOf("styles.css"));
    expect(files["fonts/fraunces-latin-400.woff2"]).toMatchObject({ contentType: "font/woff2" });
    expect(files["fonts/fonts.css"]).toMatch(/font-family:"DM Sans";font-style:normal;font-weight:700/);
    expect(files["fonts/fonts.css"]).toMatch(/unicode-range:U\+0100/);
    expect(files["_headers"]).toMatch(/font-src 'self'/);
    expect(files["_headers"]).not.toMatch(/googleapis/);
  });

  it("leaves the site alone when a font is not bundled or a file is missing", () => {
    const input = { "index.html": page("https://fonts.googleapis.com/css2?family=Comic+Neue"), "_headers": HEADERS };
    expect(selfHostFonts(input, manifest, fakeLoad).files).toEqual(input);
    const input2 = { "index.html": page("https://fonts.googleapis.com/css2?family=Inter") };
    expect(selfHostFonts(input2, manifest, () => null).files).toEqual(input2);
  });

  it("uses the nearest weight for single-weight display faces", () => {
    const { css } = fontFaceCss(manifest, ["Bebas Neue"]);
    expect(css.match(/@font-face/g)?.length).toBe(Object.keys(manifest["Bebas Neue"].subsets).length);
    expect(css).toMatch(/font-weight:400/);
  });
});

describe("fonts in language folders", () => {
  it("link back to the site root", () => {
    const { files } = selfHostFonts({ "index.html": page("https://fonts.googleapis.com/css2?family=Inter"), "fr/index.html": page("https://fonts.googleapis.com/css2?family=Inter") }, manifest, fakeLoad);
    expect(files["index.html"]).toMatch(/href="fonts\/fonts\.css"/);
    expect(files["fr/index.html"]).toMatch(/href="\.\.\/fonts\/fonts\.css"/);
  });
});
